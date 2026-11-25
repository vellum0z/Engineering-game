/*
 * Salvage Engineer — synthesized sound.
 *
 * Every sound is built at runtime from WebAudio primitives: oscillators,
 * a shared white-noise buffer pushed through filters, and gain envelopes.
 * No audio files are loaded, so the game still works from file://.
 *
 * Signal chain:  voice -> master gain -> gentle compressor -> speakers.
 *                music notes -> music bus (with a duck gain) -> master.
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

  // Music: ambient(true) asks for it; it plays while sound and music are on.
  var ambientWanted = false;

  // Rate limiting: last start time per sound name (in ms, wall clock) and
  // the minimum spacing for each. Fast UI sounds get short gaps; long,
  // heavy sounds get long ones so they never pile up into mush.
  var lastPlayed = {};
  var MIN_GAP = {
    typewriter: 45, click: 40, beep: 60, ratchet: 50, motor: 120,
    snap: 120, clang: 60, thud: 90, crash: 200, stall: 400,
    success: 250, fail: 250, unlock: 300, stamp: 150, groan: 700,
    whoosh: 80, creak: 250, splash: 200,
    place: 60, pickup: 60, select: 50, remove: 60, dial: 30, hook: 60, run: 200, pause: 120,
    reset: 200, blocked: 300, good: 400, bad: 400, poke: 150, winch: 55
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
    },

    // ---- yard sounds: short, bright and friendly, so building and
    // ---- testing feels like tinkering rather than being graded.

    // A part set down in the yard: a solid little thunk with a tick of metal.
    place: function (out, t, p) {
      p *= rnd(0.94, 1.06);
      tone(out, t, { type: 'sine', f: 190 * p, f2: 95 * p, sweep: 0.07, gain: 0.55, decay: 0.11 });
      noise(out, t, { filter: 'lowpass', f: 1400 * p, q: 0.8, gain: 0.28, decay: 0.04 });
      return metal(out, t + 0.004, 760 * p, 0.05, 0.16, [1, 2.76]);
    },

    // Picking a part from the bin: a rising "bloop".
    pickup: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 480 * p, f2: 980 * p, sweep: 0.07, gain: 0.272, decay: 0.09 });
      return tone(out, t + 0.05, { type: 'triangle', f: 1320 * p, gain: 0.085, decay: 0.06 });
    },

    // Selecting a part: a soft two-step blip.
    select: function (out, t, p) {
      tone(out, t, { type: 'triangle', f: 988 * p, gain: 0.153, decay: 0.05 });
      return tone(out, t + 0.035, { type: 'triangle', f: 1319 * p, gain: 0.119, decay: 0.07 });
    },

    // Taking a part away: a falling pop.
    remove: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 1800 * p, q: 2, gain: 0.15, decay: 0.03 });
      return tone(out, t, { type: 'sine', f: 720 * p, f2: 210 * p, sweep: 0.12, gain: 0.2, decay: 0.14 });
    },

    // Turning a dial: a crisp detent tick.
    dial: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 4200 * p, q: 5, gain: 0.374, decay: 0.012 });
      return tone(out, t, { type: 'triangle', f: 2100 * p, gain: 0.068, decay: 0.02 });
    },

    // Clipping the first end of a cable or winch line onto an anchor.
    hook: function (out, t, p) {
      noise(out, t, { filter: 'highpass', f: 3000 * p, q: 0.7, gain: 0.204, decay: 0.015 });
      return metal(out, t + 0.002, 1250 * p, 0.09, 0.22, [1, 2.76, 5.4]);
    },

    // Run: a lever clunks over and the machine winds up with a bright ding.
    run: function (out, t, p) {
      tone(out, t, { type: 'sine', f: 150 * p, f2: 80 * p, sweep: 0.06, gain: 0.45, decay: 0.1 });
      noise(out, t, { filter: 'bandpass', f: 1600 * p, q: 1.5, gain: 0.25, decay: 0.035 });
      tone(out, t + 0.05, { type: 'sawtooth', f: 180 * p, f2: 520 * p, sweep: 0.22, gain: 0.07, decay: 0.24, lp: 1800 });
      tone(out, t + 0.24, { type: 'triangle', f: 1047 * p, gain: 0.12, decay: 0.25 });
      return tone(out, t + 0.31, { type: 'triangle', f: 1568 * p, gain: 0.1, decay: 0.35 });
    },

    // Pause: two notes stepping down.
    pause: function (out, t, p) {
      tone(out, t, { type: 'triangle', f: 880 * p, gain: 0.09, decay: 0.06 });
      return tone(out, t + 0.07, { type: 'triangle', f: 659 * p, gain: 0.08, decay: 0.09 });
    },

    // Reset: a quick tape-rewind zip back to the start.
    reset: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 3500 * p, f2: 500 * p, sweep: 0.24, q: 2.5, gain: 0.22, decay: 0.26 });
      tone(out, t, { type: 'triangle', f: 1100 * p, f2: 330 * p, sweep: 0.24, gain: 0.07, decay: 0.26 });
      return tone(out, t + 0.27, { type: 'sine', f: 523 * p, gain: 0.1, decay: 0.08 });
    },

    // The build can't run yet: a gentle "nuh-uh", not an alarm.
    blocked: function (out, t, p) {
      tone(out, t, { type: 'square', f: 392 * p, gain: 0.05, decay: 0.08, lp: 1600 });
      return tone(out, t + 0.11, { type: 'square', f: 330 * p, gain: 0.05, decay: 0.12, lp: 1400 });
    },

    // Objective met: a bouncy marimba run up the scale and a bell on top.
    good: function (out, t, p) {
      var notes = [698, 880, 1047, 1397], end = t;
      for (var i = 0; i < notes.length; i++) {
        var ti = t + i * 0.075;
        tone(out, ti, { type: 'sine', f: notes[i] * p, gain: 0.2, decay: 0.32 });
        end = Math.max(end, tone(out, ti, { type: 'sine', f: notes[i] * p * 3.9, gain: 0.04, decay: 0.06 }));
      }
      tone(out, t + 0.33, { type: 'triangle', f: 1760 * p, gain: 0.08, attack: 0.005, decay: 0.6 });
      tone(out, t + 0.33, { type: 'triangle', f: 2093 * p, gain: 0.06, attack: 0.005, decay: 0.7 });
      return Math.max(end, metal(out, t + 0.33, 1397 * p, 0.06, 0.9, [1, 2.76]));
    },

    // Objective not met: a playful "wah-wah" that says "try again", with a
    // little wobble so it reads as a shrug, not a punishment.
    bad: function (out, t, p) {
      var steps = [[415, 392], [370, 330]], end = t;
      for (var i = 0; i < steps.length; i++) {
        var ti = t + i * 0.2;
        var osc = ctx.createOscillator(); osc.type = 'triangle';
        osc.frequency.setValueAtTime(steps[i][0] * p, ti);
        osc.frequency.exponentialRampToValueAtTime(steps[i][1] * p, ti + 0.18);
        var lfo = ctx.createOscillator(); lfo.frequency.value = 7;
        var lg = ctx.createGain(); lg.gain.value = i ? 8 * p : 0;
        lfo.connect(lg); lg.connect(osc.frequency);
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
        f.frequency.setValueAtTime(400, ti);
        f.frequency.linearRampToValueAtTime(1800, ti + 0.06);
        f.frequency.exponentialRampToValueAtTime(500, ti + 0.2 + i * 0.15);
        var g = env(ti, 0.2, 0.01, 0.2 + i * 0.2, out);
        osc.connect(f); f.connect(g);
        var stop = ti + 0.25 + i * 0.22;
        osc.start(ti); lfo.start(ti); osc.stop(stop); lfo.stop(stop);
        end = stop;
      }
      return end;
    },

    // Grabbing a body mid-run with the mouse: a springy boing.
    poke: function (out, t, p) {
      var osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(220 * p, t);
      osc.frequency.exponentialRampToValueAtTime(330 * p, t + 0.05);
      var lfo = ctx.createOscillator(); lfo.frequency.setValueAtTime(18, t);
      lfo.frequency.exponentialRampToValueAtTime(6, t + 0.3);
      var lg = ctx.createGain(); lg.gain.setValueAtTime(40 * p, t);
      lg.gain.exponentialRampToValueAtTime(2, t + 0.3);
      lfo.connect(lg); lg.connect(osc.frequency);
      var g = env(t, 0.16, 0.004, 0.3, out);
      osc.connect(g);
      osc.start(t); lfo.start(t); osc.stop(t + 0.33); lfo.stop(t + 0.33);
      return t + 0.33;
    },

    // Winch drum turning: one gear tooth plus a short motor buzz.
    winch: function (out, t, p) {
      noise(out, t, { filter: 'bandpass', f: 2400 * p, q: 6, gain: 0.306, decay: 0.02 });
      return tone(out, t, { type: 'sawtooth', f: 110 * p, gain: 0.085, decay: 0.05, lp: 900 });
    }
  };

  // ----------------------------------------------------------------- music
  // A light, bouncy loop for the yard: junk-percussion drums (a kick, a
  // tin-can snare, bottle-cap hats), a plucky bass, offbeat keyboard stabs
  // and a marimba melody in F major. Everything is synthesized and
  // scheduled a little ahead of time on the audio clock.
  //
  // Form, 32 bars at 104 BPM (about 74 s), then it loops with fresh
  // melodies in sections 2 and 3 (the hook in section 1 stays the same):
  //   1  A  hook melody        Fmaj7  Dm7  Gm7  C7
  //   2  A  new melody         (same chords)
  //   3  B  new melody         Bbmaj7 Am7  Gm7  C7
  //   4  A  breather: no melody, a few bell answers
  // Intensity 0 (building) keeps the drums light; intensity 1 (a run in
  // progress) adds 16th-note hats, a shaker and a bell counter-line.

  var BPM = 104;
  var STEP = 60 / BPM / 4;       // one 16th note, in seconds
  var SWING = 0.16;              // late offbeat 16ths, as a fraction of a step
  var LOOKAHEAD = 0.25;          // seconds scheduled ahead of the clock
  var MUSIC_LEVEL = 0.26;        // music bus gain under the master volume

  var CHORDS = {
    F: [53, 57, 60, 64], Dm: [50, 53, 57, 60], Gm: [55, 58, 62, 65], C: [48, 52, 55, 58],
    Bb: [46, 50, 53, 57], Am: [45, 48, 52, 55]
  };
  var ROOT = { F: 41, Dm: 38, Gm: 43, C: 36, Bb: 46, Am: 45 };
  var PROG_A = ['F', 'Dm', 'Gm', 'C'], PROG_B = ['Bb', 'Am', 'Gm', 'C'];
  // F major pentatonic (F G A C D) from D4 up to C6.
  var SCALE = [];
  for (var m = 62; m <= 84; m++) if ([5, 7, 9, 0, 2].indexOf(m % 12) >= 0) SCALE.push(m);
  // Melody rhythms: [step, length in steps].
  var MOTIFS = [
    [[0, 2], [2, 2], [4, 3], [7, 1], [8, 4]],
    [[0, 3], [3, 3], [6, 2], [8, 2], [10, 4]],
    [[2, 2], [4, 2], [6, 1], [7, 3], [10, 2], [12, 4]],
    [[0, 2], [3, 1], [4, 4], [10, 2], [12, 2], [14, 2]]
  ];
  var ENDING = [[0, 3], [3, 3], [6, 10]];

  var musicOn = true;            // the player's music setting
  var intensity = 0;
  var mus = null;                // { bus, duck, timer, step, next, loop, phrases }

  function mfreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  // Small seeded generator so a melody is the same every time it repeats.
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var x = Math.imul(s ^ (s >>> 15), 1 | s);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function nearestScale(n) {
    var best = 0;
    for (var i = 1; i < SCALE.length; i++) if (Math.abs(SCALE[i] - n) < Math.abs(SCALE[best] - n)) best = i;
    return best;
  }
  function nearestChordTone(idx, chord) {
    var pcs = CHORDS[chord].map(function (n) { return n % 12; });
    var best = idx, d = 99;
    for (var i = 0; i < SCALE.length; i++) {
      if (pcs.indexOf(SCALE[i] % 12) < 0) continue;
      if (Math.abs(i - idx) < d) { d = Math.abs(i - idx); best = i; }
    }
    return best;
  }

  // One 4-bar phrase: bars 1 and 3 share a contour (call and answer), bar 4
  // lands on a long chord tone. Returns per bar a list of [step, len, midi].
  function makePhrase(seed, prog) {
    var r = seeded(seed);
    var a = MOTIFS[Math.floor(r() * MOTIFS.length)];
    var b = MOTIFS[Math.floor(r() * MOTIFS.length)];
    var moves = [-2, -1, -1, 1, 1, 2, 0];
    var contour = a.map(function () { return moves[Math.floor(r() * moves.length)]; });
    var start = 4 + Math.floor(r() * 4);
    function bar(rhythm, chord, cont, from) {
      var idx = nearestChordTone(from, chord), out = [];
      for (var i = 0; i < rhythm.length; i++) {
        if (i) idx = Math.max(0, Math.min(SCALE.length - 1, idx + (cont ? cont[i] : moves[Math.floor(r() * moves.length)])));
        if (i === rhythm.length - 1) idx = nearestChordTone(idx, chord);
        out.push([rhythm[i][0], rhythm[i][1], SCALE[idx]]);
      }
      return out;
    }
    var b1 = bar(a, prog[0], contour, start);
    var b2 = bar(b, prog[1], null, nearestScale(b1[b1.length - 1][2]));
    var b3 = bar(a, prog[2], contour, start + 1);
    var b4 = bar(ENDING, prog[3], null, nearestScale(b3[b3.length - 1][2]));
    return [b1, b2, b3, b4];
  }

  // -- instruments; each writes into `out` at time t
  function mKick(out, t, g) {
    tone(out, t, { type: 'sine', f: 150, f2: 46, sweep: 0.11, gain: 0.6 * g, decay: 0.22 });
    noise(out, t, { filter: 'lowpass', f: 1800, q: 0.7, gain: 0.12 * g, decay: 0.012 });
  }
  function mCan(out, t, g) {       // tin-can snare
    noise(out, t, { filter: 'bandpass', f: 2300, q: 1.1, gain: 0.32 * g, decay: 0.09 });
    tone(out, t, { type: 'triangle', f: 340, f2: 290, sweep: 0.06, gain: 0.16 * g, decay: 0.07 });
    metal(out, t, 560, 0.035 * g, 0.12, [1, 2.3]);
  }
  function mHat(out, t, g, open) {
    noise(out, t, { filter: 'highpass', f: 7500, q: 0.7, gain: 0.11 * g, decay: open ? 0.11 : 0.025 });
  }
  function mShaker(out, t, g) {
    noise(out, t, { filter: 'bandpass', f: 5200, q: 1.5, gain: 0.05 * g, attack: 0.012, decay: 0.045 });
  }
  function mBass(out, t, n, len) {
    var f = mfreq(n), d = Math.min(0.32, len * STEP * 0.95);
    tone(out, t, { type: 'triangle', f: f, gain: 0.42, attack: 0.004, decay: d });
    tone(out, t, { type: 'sawtooth', f: f, gain: 0.09, attack: 0.004, decay: d * 0.7, lp: 520, q: 2 });
  }
  function mKeys(out, t, chord, g) {
    var v = CHORDS[chord];
    for (var i = 0; i < v.length; i++) {
      tone(out, t, { type: 'triangle', f: mfreq(v[i] + 12), gain: 0.045 * g, attack: 0.003, decay: 0.16 });
      tone(out, t, { type: 'sine', f: mfreq(v[i] + 24), gain: 0.012 * g, attack: 0.003, decay: 0.09 });
    }
  }
  function mMarimba(out, t, n, len, g) {
    var f = mfreq(n), d = Math.min(0.55, 0.18 + len * STEP * 0.5);
    tone(out, t, { type: 'sine', f: f, gain: 0.2 * g, attack: 0.002, decay: d });
    tone(out, t, { type: 'sine', f: f * 3.93, gain: 0.04 * g, attack: 0.001, decay: 0.05 });
    noise(out, t, { filter: 'bandpass', f: f * 2, q: 4, gain: 0.03 * g, decay: 0.01 });
  }
  function mBell(out, t, n, g) {
    var f = mfreq(n);
    tone(out, t, { type: 'sine', f: f, gain: 0.05 * g, attack: 0.003, decay: 0.7 });
    tone(out, t, { type: 'sine', f: f * 2.76, gain: 0.015 * g, attack: 0.002, decay: 0.3 });
  }

  function phraseFor(section, loop) {
    var key = section + ':' + (section === 0 ? 0 : loop);
    if (!mus.phrases[key]) mus.phrases[key] = makePhrase(1013 + section * 7919 + (section === 0 ? 0 : loop * 104729), section === 2 ? PROG_B : PROG_A);
    return mus.phrases[key];
  }

  function scheduleStep(k, t) {
    var out = mus.bus;
    var s = k % 16, barN = Math.floor(k / 16) % 32, loop = Math.floor(k / 512);
    var section = Math.floor(barN / 8), inPhrase = barN % 4, inSection = barN % 8;
    var prog = section === 2 ? PROG_B : PROG_A;
    var chord = prog[inPhrase];
    var hot = intensity > 0;
    var fill = inSection === 7;

    // drums
    if (s === 0 || s === 8 || (s === 6 && barN % 2) || (s === 14 && inPhrase === 3 && !fill) || (s === 11 && hot && barN % 2 === 0)) mKick(out, t, s === 0 ? 1 : 0.8);
    if (s === 4 || s === 12) mCan(out, t, 1);
    if (fill && s >= 13) mCan(out, t, 0.45 + (s - 13) * 0.2);
    if (s === 15 && barN % 4 === 1) mCan(out, t, 0.25);
    if (s % 2 === 0) mHat(out, t, s % 4 === 2 ? 1 : 0.6, s === 14 && inPhrase === 1);
    else if (hot) mHat(out, t, 0.35);
    if (hot && s % 2 === 1) mShaker(out, t, 1);

    // bass: root, a bounce up the octave and a walk into the next chord
    var root = ROOT[chord];
    var nextChord = inPhrase === 3 ? (section === 1 ? PROG_B[0] : PROG_A[0]) : prog[inPhrase + 1];
    var bassPat = { 0: [root, 3], 3: [root, 2], 6: [root + 7, 2], 8: [root + 12, 2], 10: [root, 2], 14: [ROOT[nextChord] - 1, 2] };
    if (bassPat[s] && !(s === 14 && inPhrase !== 3 && barN % 2 === 0)) mBass(out, t, bassPat[s][0], bassPat[s][1]);

    // offbeat stabs give the loop its upbeat lilt
    if (s === 2 || s === 6 || s === 10 || s === 14) mKeys(out, t, chord, s === 6 || s === 14 ? 1 : 0.65);

    // melody
    if (section < 3) {
      var ph = phraseFor(section, loop)[inPhrase];
      var g = hot ? 1 : 0.8;
      for (var i = 0; i < ph.length; i++) if (ph[i][0] === s) mMarimba(out, t, ph[i][2], ph[i][1], g);
    } else if ((s === 0 || s === 3 || s === 6) && inPhrase % 2 === 1) {
      var tones = CHORDS[chord];
      mBell(out, t, tones[[3, 2, 1][s / 3]] + 24, 1);
    }
    // bell counter-line while a run is going
    if (hot && section < 3 && s === 8 && inPhrase % 2 === 0) mBell(out, t, CHORDS[chord][2] + 24, 0.9);
    if (fill && s === 15) mBell(out, t, 89, 0.8);
  }

  function pump() {
    if (!mus || !ctx) return;
    var t = ctx.currentTime;
    // After the tab sleeps the clock runs ahead: skip, don't burst.
    if (mus.next < t - 0.05) { var miss = Math.ceil((t - mus.next) / STEP); mus.step += miss; mus.next += miss * STEP; }
    while (mus.next < t + LOOKAHEAD) {
      var when = mus.next + (mus.step % 2 ? SWING * STEP : 0);
      try { scheduleStep(mus.step, when); } catch (e) { /* ignore */ }
      mus.step++;
      mus.next += STEP;
    }
  }

  function startMusic() {
    if (mus || !musicOn || !getCtx()) return;
    try {
      var t = ctx.currentTime;
      var bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 1.5);
      var duck = ctx.createGain(); duck.gain.value = 1;
      // a touch of lowpass keeps the loop soft behind the sound effects
      var tone_ = ctx.createBiquadFilter(); tone_.type = 'lowpass'; tone_.frequency.value = 9000;
      bus.connect(tone_); tone_.connect(duck); duck.connect(master);
      mus = { bus: bus, duck: duck, timer: null, step: 0, next: t + 0.1, phrases: {} };
      pump();
      mus.timer = setInterval(pump, 40);
      if (mus.timer && mus.timer.unref) mus.timer.unref();
    } catch (e) { mus = null; }
  }

  function stopMusic() {
    if (!mus) return;
    var a = mus; mus = null;
    try {
      clearInterval(a.timer);
      var t = ctx.currentTime;
      a.bus.gain.cancelScheduledValues(t);
      a.bus.gain.setTargetAtTime(0.0001, t, 0.25);
      later(function () { try { a.duck.disconnect(); } catch (e) { /* ignore */ } }, 2000);
    } catch (e) { /* ignore */ }
  }

  function syncMusic() {
    if (ambientWanted && enabled && musicOn && ctx && ctx.state !== 'suspended') startMusic();
    else stopMusic();
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
          if (r && r.then) r.then(syncMusic, function () {});
        } else syncMusic();
      } catch (e) { /* ignore */ }
    },

    setEnabled: function (on) {
      try {
        enabled = !!on;
        applyMaster();
        syncMusic();
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
        syncMusic();
      } catch (e) { /* ignore */ }
    },

    // The player's music setting, separate from sound effects.
    setMusic: function (on) {
      try { musicOn = !!on; syncMusic(); } catch (e) { /* ignore */ }
    },

    // 0 while building, 1 while a run is going (busier drums, bells).
    setIntensity: function (n) { intensity = n > 0 ? 1 : 0; },

    // Dip the music for a moment so a jingle stands out.
    duck: function (seconds) {
      try {
        if (!mus || !ctx) return;
        var t = ctx.currentTime, g = mus.duck.gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(0.35, t, 0.04);
        g.setTargetAtTime(1, t + (seconds || 1.2), 0.4);
      } catch (e) { /* ignore */ }
    },

    // True when a call to play() can be heard (context running, sound on).
    live: function () { return !!(enabled && ctx && ctx.state === 'running'); }
  };

  Object.defineProperty(audio, 'enabled', { get: function () { return enabled; }, set: audio.setEnabled, enumerable: true });
  Object.defineProperty(audio, 'volume', { get: function () { return volume; }, set: audio.setVolume, enumerable: true });
  Object.defineProperty(audio, 'ambientOn', { get: function () { return ambientWanted; }, enumerable: true });
  Object.defineProperty(audio, 'musicOn', { get: function () { return musicOn; }, enumerable: true });
  Object.defineProperty(audio, 'musicPlaying', { get: function () { return !!mus; }, enumerable: true });
  Object.defineProperty(audio, 'intensity', { get: function () { return intensity; }, enumerable: true });

  // Drops the context and all state. Used by tests that swap in a fake
  // AudioContext; the game never needs it.
  audio._reset = function () {
    try { stopMusic(); } catch (e) { /* ignore */ }
    try { if (ctx && ctx.close) ctx.close(); } catch (e) { /* ignore */ }
    ctx = master = comp = noiseBuf = null; mus = null;
    failed = false; ambientWanted = false; active = 0; lastPlayed = {};
    enabled = true; volume = 0.7; musicOn = true; intensity = 0;
  };
  // Tests: schedule `steps` 16ths of music right now (no timer needed).
  audio._musicSteps = function (steps) {
    if (!mus) return 0;
    for (var i = 0; i < steps; i++) { scheduleStep(mus.step, mus.next); mus.step++; mus.next += STEP; }
    return mus.step;
  };

  SE.audio = audio;
})(globalThis.SE);
