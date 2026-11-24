/*
 * Salvage Engineer — synthesized sound.
 *
 * Every sound is built at runtime from WebAudio primitives: oscillators,
 * a shared white-noise buffer pushed through filters, and gain envelopes.
 * No audio files are loaded, so the game still works from file://.
 *
 * Signal chain:  voice -> master gain -> gentle compressor -> speakers.
 *
 * The AudioContext is created lazily, inside play() or unlock() only.
 * At load time this file touches nothing, so it is safe in Node and in
 * browsers without WebAudio: every public call is then a quiet no-op.
 */
(function (SE) {
  'use strict';

  var ctx = null;          // AudioContext, created on demand
  var master = null;       // master gain (user volume)
  var comp = null;         // soft compressor on the master bus
  var noiseBuf = null;     // 2 s of white noise, shared by every voice
  var failed = false;      // set once if WebAudio is missing or broken

  var enabled = true;
  var volume = 0.7;

  // Ambient bed state.
  var ambientWanted = false;
  var amb = null;          // { gain, nodes[], timer }

  // Rate limiting: last start time per sound name (in ms, wall clock) and
  // the minimum spacing for each. Fast UI sounds get short gaps; long,
  // heavy sounds get long ones so they never pile up into mush.
  var lastPlayed = {};
  var MIN_GAP = {
    typewriter: 45, click: 40, beep: 60, ratchet: 50, motor: 120,
    snap: 120, clang: 60, thud: 90, crash: 200, stall: 400,
    success: 250, fail: 250, unlock: 300, stamp: 150, groan: 700,
    whoosh: 80, creak: 250, splash: 200
  };
  var DEFAULT_GAP = 50;
  var MAX_VOICES = 24;     // hard cap on overlapping sounds
  var active = 0;

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ---------------------------------------------------------------- setup

  function getCtx() {
    if (ctx) return ctx;
    if (failed) return null;
    try {
      var g = typeof globalThis !== 'undefined' ? globalThis : {};
      var AC = g.AudioContext || g.webkitAudioContext;
      if (!AC) return null;   // checked again next call; cheap
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      // Gentle: only catches peaks when several impacts land together.
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = enabled ? volume : 0;
      master.connect(comp);
      comp.connect(ctx.destination);

      var len = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return ctx;
    } catch (e) {
      failed = true; ctx = null; master = null;
      return null;
    }
  }

  function applyMaster() {
    if (!master || !ctx) return;
    try {
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(enabled ? volume : 0, t, 0.03);
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------- helpers
  // All helpers schedule nodes relative to t0 and route into `out`.

  // Attack/decay envelope on a fresh gain node.
  function env(t0, peak, attack, decay, out) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.001, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(out);
    return g;
  }

  // Oscillator with optional pitch sweep. Returns the end time.
  function tone(out, t0, o) {
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + (o.sweep || o.decay));
    if (o.detune) osc.detune.value = o.detune;
    var g = env(t0, o.gain, o.attack || 0.002, o.decay, out);
    var dest = g;
    if (o.lp) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7;
      f.connect(g); dest = f;
    }
    osc.connect(dest);
    var end = t0 + (o.attack || 0.002) + o.decay + 0.02;
    osc.start(t0); osc.stop(end);
    return end;
  }

  // Filtered noise burst. Filter frequency can sweep from f to f2.
  function noise(out, t0, o) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + (o.sweep || o.decay));
    f.Q.value = o.q == null ? 1 : o.q;
    var g = env(t0, o.gain, o.attack || 0.001, o.decay, out);
    src.connect(f); f.connect(g);
    var end = t0 + (o.attack || 0.001) + o.decay + 0.02;
    // Random offset into the buffer so repeats never sound identical.
    src.start(t0, Math.random() * 1.5); src.stop(end);
    return end;
  }

  // Inharmonic partials of struck metal (ratios roughly those of a free
  // bar / thick plate), each decaying at its own rate.
  function metal(out, t0, base, gain, decay, ratios) {
    ratios = ratios || [1, 2.76, 5.40, 8.93];
    var end = t0;
    for (var i = 0; i < ratios.length; i++) {
      end = Math.max(end, tone(out, t0, {
        type: 'sine', f: base * ratios[i] * (1 + (Math.random() - 0.5) * 0.01),
        gain: gain / (1 + i * 0.8), decay: decay / (1 + i * 0.5)
      }));
    }
    return end;
  }

  // setTimeout that never keeps a Node process alive.
  function later(fn, ms) {
    var h = setTimeout(fn, ms);
    if (h && h.unref) h.unref();
    return h;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------- sounds
  // Each takes (out, t0, p) where p is a pitch multiplier, and returns the
  // time when its last node stops.

  var SOUNDS = {
    // Steel cable parting: a hard broadband crack, a high whip that sweeps
    // down as the free end recoils, and the strands ringing afterwards.
    snap: function (out, t, p) {
      noise(out, t, { filter: 'highpass', f: 2500 * p, q: 0.5, gain: 0.9, decay: 0.05 });
      noise(out, t, { filter: 'bandpass', f: 6000 * p, f2: 900 * p, sweep: 0.35, q: 3, gain: 0.35, decay: 0.4 });
      tone(out, t + 0.005, { type: 'sawtooth', f: 1800 * p, f2: 220 * p, sweep: 0.3, gain: 0.12, decay: 0.32, lp: 4000 });
      return metal(out, t + 0.01, 620 * p, 0.12, 1.2, [1, 1.51, 2.93, 4.12]);
    },

    // Metal on metal: sharp transient plus long inharmonic ring.
    clang: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 3000 * p, q: 0.8, gain: 0.5, decay: 0.04 });
      return metal(out, t, rnd(310, 350) * p, 0.35, 0.9);
    },

    // Heavy load landing: low body thump, dirt scuff, short sub drop.
    thud: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 110 * p, f2: 42 * p, sweep: 0.18, gain: 0.9, decay: 0.32 });
      tone(out, t, { type: 'triangle', f: 70 * p, f2: 35 * p, sweep: 0.2, gain: 0.4, decay: 0.25 });
      return noise(out, t, { filter: 'lowpass', f: 700 * p, q: 0.7, gain: 0.5, decay: 0.15 });
    },

    // Wood and scrap collapsing: big impact, splintering noise, then a
    // scatter of small debris hits rattling down.
    crash: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 95 * p, f2: 38 * p, sweep: 0.25, gain: 0.8, decay: 0.4 });
      noise(out, t, { filter: 'lowpass', f: 3500 * p, f2: 400, sweep: 0.5, q: 0.6, gain: 0.7, decay: 0.55 });
      noise(out, t + 0.02, { filter: 'bandpass', f: 1400 * p, q: 4, gain: 0.25, decay: 0.2 });
      metal(out, t + 0.03, 260 * p, 0.12, 0.6);
      var end = t + 0.6;
      for (var i = 0; i < 9; i++) {
        var ti = t + 0.08 + i * rnd(0.04, 0.09) + i * i * 0.004;
        end = Math.max(end, noise(out, ti, { filter: 'bandpass', f: rnd(900, 4000) * p, q: 6, gain: rnd(0.08, 0.2) / (1 + i * 0.25), decay: rnd(0.02, 0.06) }));
        if (i % 3 === 1) metal(out, ti, rnd(500, 900) * p, 0.04, 0.2, [1, 2.76]);
      }
      return end;
    },

    // Winch motor bogging down: a buzzy saw whose pitch sags and wobbles
    // under load before cutting out.
    stall: function (out, t, p) {
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140 * p, t);
      osc.frequency.linearRampToValueAtTime(115 * p, t + 0.25);
      osc.frequency.linearRampToValueAtTime(125 * p, t + 0.35);
      osc.frequency.exponentialRampToValueAtTime(38 * p, t + 0.9);
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 9;
      var lfoG = ctx.createGain(); lfoG.gain.value = 10 * p;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.03);
      g.gain.setValueAtTime(0.3, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
      osc.connect(f); f.connect(g); g.connect(out);
      osc.start(t); lfo.start(t); osc.stop(t + 1); lfo.stop(t + 1);
      noise(out, t, { filter: 'bandpass', f: 400 * p, q: 2, gain: 0.08, decay: 0.85 });
      tone(out, t + 0.9, { type: 'square', f: 60 * p, gain: 0.08, decay: 0.05, lp: 600 });
      return t + 1;
    },

    // UI click: a tiny dry tick.
    click: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 3500 * p, q: 3, gain: 0.35, decay: 0.018 });
      return tone(out, t, { type: 'triangle', f: 1600 * p, gain: 0.08, decay: 0.02 });
    },

    // Bolt seating home, then a clean two-note confirmation.
    success: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 150 * p, f2: 70 * p, sweep: 0.08, gain: 0.5, decay: 0.12 });
      noise(out, t, { filter: 'bandpass', f: 1800 * p, q: 2, gain: 0.35, decay: 0.04 });
      metal(out, t + 0.002, 900 * p, 0.05, 0.15, [1, 2.76]);
      tone(out, t + 0.12, { type: 'triangle', f: 784 * p, gain: 0.18, decay: 0.35 });
      return tone(out, t + 0.22, { type: 'triangle', f: 1175 * p, gain: 0.2, decay: 0.6 });
    },

    // Low descending buzzer.
    fail: function (out, t, p) {
      tone(out, t, { type: 'square', f: 196 * p, f2: 98 * p, sweep: 0.5, gain: 0.14, decay: 0.55, lp: 1200 });
      return tone(out, t, { type: 'sawtooth', f: 199 * p, f2: 96 * p, sweep: 0.5, gain: 0.1, decay: 0.55, lp: 900 });
    },

    // New tool: a quick ratchet run, then a rising shimmer.
    unlock: function (out, t, p) {
      for (var i = 0; i < 5; i++) {
        noise(out, t + i * 0.045, { filter: 'bandpass', f: (2400 + i * 200) * p, q: 5, gain: 0.25, decay: 0.025 });
      }
      var notes = [880, 1109, 1319, 1760];
      var end = t;
      for (var j = 0; j < notes.length; j++) {
        end = tone(out, t + 0.25 + j * 0.06, { type: 'sine', f: notes[j] * p, gain: 0.09, attack: 0.01, decay: 0.7 });
        tone(out, t + 0.25 + j * 0.06, { type: 'sine', f: notes[j] * p * 2.01, gain: 0.03, attack: 0.01, decay: 0.5 });
      }
      return end;
    },

    // Plate stamp: heavy press thunk with a short metallic slap.
    stamp: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 180 * p, f2: 60 * p, sweep: 0.06, gain: 0.7, decay: 0.12 });
      noise(out, t, { filter: 'lowpass', f: 2000 * p, q: 0.8, gain: 0.5, decay: 0.06 });
      return metal(out, t, 480 * p, 0.06, 0.18, [1, 2.3, 3.9]);
    },

    // Single pawl click over a gear tooth.
    ratchet: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 2800 * p, q: 6, gain: 0.35, decay: 0.022 });
      return tone(out, t, { type: 'square', f: 900 * p, gain: 0.05, decay: 0.015, lp: 3000 });
    },

    // Zombie groan: a slow, hoarse vowel. A saw source through two formant
    // bandpasses, with pitch drifting down and a rough tremolo.
    groan: function (out, t, p) {
      var dur = rnd(1.1, 1.6);
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      var f0 = rnd(85, 105) * p;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f0 * 1.12, t + dur * 0.3);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
      var lfo = ctx.createOscillator(); lfo.frequency.value = rnd(5, 8);
      var lfoG = ctx.createGain(); lfoG.gain.value = f0 * 0.04;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.25);
      g.gain.setValueAtTime(0.3, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out);
      var formants = [[500, 0.8], [900, 0.5], [2400, 0.15]];
      for (var i = 0; i < formants.length; i++) {
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 6;
        bp.frequency.setValueAtTime(formants[i][0] * p, t);
        bp.frequency.linearRampToValueAtTime(formants[i][0] * p * 0.8, t + dur);
        var fg = ctx.createGain(); fg.gain.value = formants[i][1];
        osc.connect(bp); bp.connect(fg); fg.connect(g);
      }
      osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      noise(out, t, { filter: 'bandpass', f: 1200 * p, q: 1.5, gain: 0.06, attack: 0.2, decay: dur - 0.2 });
      return t + dur + 0.05;
    },

    // Air movement: noise with a bandpass sweeping up and back down.
    whoosh: function (out, t, p) {
      var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300 * p, t);
      f.frequency.exponentialRampToValueAtTime(2200 * p, t + 0.18);
      f.frequency.exponentialRampToValueAtTime(500 * p, t + 0.4);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t, Math.random()); src.stop(t + 0.45);
      return t + 0.45;
    },

    // Creak: stick-slip friction. A rapid train of tiny clicks whose rate
    // wanders, filtered through a resonant body.
    creak: function (out, t, p) {
      var body = ctx.createBiquadFilter();
      body.type = 'bandpass'; body.frequency.value = 700 * p; body.Q.value = 5;
      var g = ctx.createGain(); g.gain.value = 1.4; body.connect(g); g.connect(out);
      var dur = rnd(0.5, 0.8), tt = t, k = 0;
      while (tt < t + dur) {
        var phase = (tt - t) / dur;
        var amp = Math.sin(Math.PI * phase) * 0.6;
        tone(body, tt, { type: 'square', f: rnd(300, 380) * p, gain: amp, decay: 0.006 });
        tt += 1 / (28 + 20 * Math.sin(phase * 6 + k * 0.1)) ;
        k++;
      }
      return t + dur + 0.05;
    },

    // Splash: a broad noise burst, a falling bubble chirp, then droplets.
    splash: function (out, t, p) {
      noise(out, t, { filter: 'lowpass', f: 4000 * p, f2: 600, sweep: 0.4, q: 0.5, gain: 0.6, decay: 0.5 });
      tone(out, t, { type: 'sine', f: 600 * p, f2: 180 * p, sweep: 0.12, gain: 0.2, decay: 0.15 });
      var end = t + 0.5;
      for (var i = 0; i < 6; i++) {
        var ti = t + 0.12 + i * rnd(0.05, 0.12);
        end = Math.max(end, tone(out, ti, { type: 'sine', f: rnd(900, 1800) * p, f2: rnd(1800, 3000) * p, sweep: 0.03, gain: 0.05, decay: 0.05 }));
      }
      return end;
    },

    // Controller beep: a square blip through a lowpass, like a cheap panel.
    beep: function (out, t, p) {
      return tone(out, t, { type: 'square', f: 1320 * p, gain: 0.08, attack: 0.003, decay: 0.09, lp: 3500 });
    },

    // Soft key tick for text appearing.
    typewriter: function (out, t, p) {
      return noise(out, t, { filter: 'bandpass', f: rnd(2200, 3200) * p, q: 4, gain: 0.16, decay: 0.012 });
    },

    // Short winch whirr: geared motor spinning up and coasting off.
    motor: function (out, t, p) {
      var osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(60 * p, t);
      osc.frequency.exponentialRampToValueAtTime(180 * p, t + 0.12);
      osc.frequency.setValueAtTime(180 * p, t + 0.3);
      osc.frequency.exponentialRampToValueAtTime(90 * p, t + 0.5);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 3;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.06);
      g.gain.setValueAtTime(0.18, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
      osc.connect(f); f.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 0.55);
      noise(out, t, { filter: 'bandpass', f: 1800 * p, q: 3, gain: 0.06, attack: 0.05, decay: 0.45 });
      return t + 0.55;
    }
  };

  // --------------------------------------------------------------- ambient
  // Wind: looping noise through a lowpass whose cutoff is swept by a slow
  // LFO. Drone: two detuned low saws, heavily filtered. Every so often a
  // groan plays far away (quiet and dark). The whole bed sits very low.

  function startAmbient() {
    if (amb || !getCtx()) return;
    try {
      var t = ctx.currentTime;
      var bed = ctx.createGain();
      bed.gain.setValueAtTime(0.0001, t);
      bed.gain.linearRampToValueAtTime(0.05, t + 3);
      bed.connect(master);
      var nodes = [];

      var wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
      var wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 500; wf.Q.value = 1.5;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      var lfoG = ctx.createGain(); lfoG.gain.value = 300;
      lfo.connect(lfoG); lfoG.connect(wf.frequency);
      var wg = ctx.createGain(); wg.gain.value = 0.9;
      wind.connect(wf); wf.connect(wg); wg.connect(bed);
      wind.start(t); lfo.start(t);
      nodes.push(wind, lfo);

      var df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 180;
      var dg = ctx.createGain(); dg.gain.value = 0.25;
      df.connect(dg); dg.connect(bed);
      [55, 55.4, 82.6].forEach(function (f) {
        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(df); o.start(t); nodes.push(o);
      });

      // Distant groans go through their own dark filter at low gain.
      var far = ctx.createBiquadFilter(); far.type = 'lowpass'; far.frequency.value = 600;
      var farG = ctx.createGain(); farG.gain.value = 0.35;
      far.connect(farG); farG.connect(bed);

      amb = { gain: bed, nodes: nodes, far: far, timer: null };
      scheduleGroan();
    } catch (e) { amb = null; }
  }

  function scheduleGroan() {
    if (!amb || typeof setTimeout === 'undefined') return;
    amb.timer = later(function () {
      if (!amb) return;
      try { SOUNDS.groan(amb.far, ctx.currentTime + 0.05, rnd(0.8, 1.05)); } catch (e) { /* ignore */ }
      scheduleGroan();
    }, rnd(12000, 30000));
  }

  function stopAmbient() {
    if (!amb) return;
    var a = amb; amb = null;
    try {
      if (a.timer) clearTimeout(a.timer);
      var t = ctx.currentTime;
      a.gain.gain.cancelScheduledValues(t);
      a.gain.gain.setTargetAtTime(0.0001, t, 0.5);
      a.nodes.forEach(function (n) { try { n.stop(t + 2.5); } catch (e) { /* ignore */ } });
      later(function () { try { a.gain.disconnect(); } catch (e) { /* ignore */ } }, 3000);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ public API

  var audio = {
    // Names a scene can pass to play().
    names: Object.keys(SOUNDS),

    play: function (name, opts) {
      try {
        if (!enabled || !SOUNDS[name]) return false;
        var ms = now();
        var gap = MIN_GAP[name] != null ? MIN_GAP[name] : DEFAULT_GAP;
        if (lastPlayed[name] != null && ms - lastPlayed[name] < gap) return false;
        if (active >= MAX_VOICES) return false;
        if (!getCtx()) return false;
        if (ctx.state === 'suspended') return false;   // not unlocked yet
        lastPlayed[name] = ms;

        opts = opts || {};
        var v = opts.volume == null ? 1 : Math.max(0, Math.min(2, +opts.volume || 0));
        var p = opts.pitch == null ? 1 : Math.max(0.25, Math.min(4, +opts.pitch || 1));
        var out = ctx.createGain();
        out.gain.value = v;
        out.connect(master);
        var t0 = ctx.currentTime + 0.005;
        var end = SOUNDS[name](out, t0, p);
        active++;
        var life = Math.max(50, (end - ctx.currentTime) * 1000 + 100);
        later(function () {
          active = Math.max(0, active - 1);
          try { out.disconnect(); } catch (e) { /* ignore */ }
        }, life);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Call from the first click/keypress: browsers keep the context
    // suspended until a user gesture resumes it.
    unlock: function () {
      try {
        if (!getCtx()) return;
        if (ctx.state === 'suspended' && ctx.resume) {
          var r = ctx.resume();
          if (r && r.then) r.then(function () { if (ambientWanted && enabled) startAmbient(); }, function () {});
        } else if (ambientWanted && enabled) {
          startAmbient();
        }
      } catch (e) { /* ignore */ }
    },

    setEnabled: function (on) {
      try {
        enabled = !!on;
        applyMaster();
        if (!enabled) stopAmbient();
        else if (ambientWanted && ctx && ctx.state !== 'suspended') startAmbient();
      } catch (e) { /* ignore */ }
    },

    setVolume: function (v) {
      try {
        v = +v;
        if (!isFinite(v)) return;
        volume = Math.max(0, Math.min(1, v));
        applyMaster();
      } catch (e) { /* ignore */ }
    },

    // Quiet wind/drone bed. Remembers the request if the context does not
    // exist yet; unlock() then starts it.
    ambient: function (on) {
      try {
        ambientWanted = !!on;
        if (!ambientWanted) { stopAmbient(); return; }
        if (enabled && ctx && ctx.state !== 'suspended') startAmbient();
      } catch (e) { /* ignore */ }
    }
  };

  Object.defineProperty(audio, 'enabled', { get: function () { return enabled; }, set: audio.setEnabled, enumerable: true });
  Object.defineProperty(audio, 'volume', { get: function () { return volume; }, set: audio.setVolume, enumerable: true });
  Object.defineProperty(audio, 'ambientOn', { get: function () { return ambientWanted; }, enumerable: true });

  // Drops the context and all state. Used by tests that swap in a fake
  // AudioContext; the game never needs it.
  audio._reset = function () {
    try { stopAmbient(); } catch (e) { /* ignore */ }
    try { if (ctx && ctx.close) ctx.close(); } catch (e) { /* ignore */ }
    ctx = master = comp = noiseBuf = null; amb = null;
    failed = false; ambientWanted = false; active = 0; lastPlayed = {};
    enabled = true; volume = 0.7;
  };

  SE.audio = audio;
})(globalThis.SE);
