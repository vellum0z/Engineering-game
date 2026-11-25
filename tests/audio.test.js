'use strict';
const { suite, test, eq, ok } = require('./harness');
const SE = globalThis.SE;

// A minimal stand-in for the WebAudio graph: every node accepts connect(),
// start(), stop(), and exposes AudioParams that record scheduling calls.
// Enough to run each synth voice end to end and catch bad calls.
function makeFakeAudioContext() {
  function param(v) {
    return {
      value: v,
      setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; },
      exponentialRampToValueAtTime(x) { if (!(x > 0)) throw new Error('exp ramp to ' + x); this.value = x; },
      setTargetAtTime(x) { this.value = x; }, cancelScheduledValues() {}
    };
  }
  function node(extra) {
    return Object.assign({ connect() {}, disconnect() {}, start() {}, stop() {} }, extra);
  }
  let created = 0;
  class FakeCtx {
    constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = 'suspended'; this.destination = node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() {}
    createGain() { created++; return node({ gain: param(1) }); }
    createOscillator() { created++; return node({ type: 'sine', frequency: param(440), detune: param(0) }); }
    createBiquadFilter() { created++; return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createBufferSource() { created++; return node({ buffer: null, loop: false, playbackRate: param(1) }); }
    createDynamicsCompressor() {
      return node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) });
    }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  }
  FakeCtx.count = () => created;
  return FakeCtx;
}

suite('audio', () => {
  test('module loads with the full API', () => {
    ok(SE.audio, 'SE.audio exists');
    ['play', 'setEnabled', 'setVolume', 'unlock', 'ambient'].forEach(k => eq(typeof SE.audio[k], 'function', k));
    eq(typeof SE.audio.enabled, 'boolean');
  });

  test('every sound named in the brief exists', () => {
    const want = ['snap', 'clang', 'thud', 'crash', 'stall', 'click', 'success', 'fail', 'unlock', 'stamp',
      'ratchet', 'groan', 'whoosh', 'creak', 'splash', 'beep', 'typewriter', 'motor',
      // yard sounds (the yard plays good/bad on a result)
      'place', 'pickup', 'select', 'remove', 'dial', 'hook', 'run', 'pause', 'reset', 'blocked',
      'good', 'bad', 'poke', 'winch'];
    want.forEach(n => ok(SE.audio.names.indexOf(n) >= 0, 'missing sound ' + n));
  });

  test('calls are silent no-ops without an AudioContext', () => {
    SE.audio._reset();
    ok(typeof globalThis.AudioContext === 'undefined', 'Node has no AudioContext');
    eq(SE.audio.play('snap'), false);
    eq(SE.audio.play('typewriter', { volume: 0.5, pitch: 2 }), false);
    eq(SE.audio.play('no-such-sound'), false);
    SE.audio.unlock();
    SE.audio.ambient(true);
    SE.audio.ambient(false);
    SE.audio.setEnabled(false);
    SE.audio.setEnabled(true);
    SE.audio.setVolume(0.3);
  });

  test('settings: enabled and volume', () => {
    SE.audio._reset();
    SE.audio.setEnabled(false);
    eq(SE.audio.enabled, false);
    SE.audio.setEnabled(true);
    eq(SE.audio.enabled, true);
    SE.audio.setVolume(0.25);
    eq(SE.audio.volume, 0.25);
    SE.audio.setVolume(5);
    eq(SE.audio.volume, 1, 'clamped high');
    SE.audio.setVolume(-1);
    eq(SE.audio.volume, 0, 'clamped low');
    SE.audio.setVolume('nonsense');
    eq(SE.audio.volume, 0, 'bad input ignored');
  });

  test('with a fake context: every voice builds, rate limit and mute work', () => {
    SE.audio._reset();
    const Fake = makeFakeAudioContext();
    globalThis.AudioContext = Fake;
    try {
      eq(SE.audio.play('clang'), false, 'suspended context stays quiet');
      SE.audio.unlock();
      // in batches under the voice cap (voices free up on timers, not here)
      SE.audio.names.forEach((n, i) => {
        if (i && i % 20 === 0) { SE.audio._reset(); globalThis.AudioContext = Fake; SE.audio.play('click'); SE.audio.unlock(); }
        eq(SE.audio.play(n, { pitch: 1.1, volume: 0.8 }), true, n);
      });
      const last = SE.audio.names[SE.audio.names.length - 1];
      eq(SE.audio.play(last), false, 'identical sound right away is rate-limited');
      SE.audio.setEnabled(false);
      const before = Fake.count();
      eq(SE.audio.play('beep'), false, 'muted');
      eq(Fake.count(), before, 'muted play builds no nodes');
      SE.audio.setEnabled(true);
      SE.audio.ambient(true);
      eq(SE.audio.ambientOn, true);
      SE.audio.ambient(false);
    } finally {
      SE.audio._reset();
      delete globalThis.AudioContext;
    }
  });

  test('music: waits for unlock, follows sound and music settings, every bar builds', () => {
    SE.audio._reset();
    const Fake = makeFakeAudioContext();
    globalThis.AudioContext = Fake;
    try {
      SE.audio.ambient(true);
      eq(SE.audio.musicPlaying, false, 'no context yet');
      SE.audio.play('click');          // creates the (suspended) context
      SE.audio.ambient(true);
      eq(SE.audio.musicPlaying, false, 'suspended: waits for unlock');
      SE.audio.unlock();               // the fake resumes at once
      SE.audio.ambient(true);
      eq(SE.audio.musicPlaying, true, 'plays once unlocked');
      // a full 32-bar loop and a bit, quiet and busy, builds without bad calls
      SE.audio._musicSteps(16 * 36);
      SE.audio.setIntensity(1); eq(SE.audio.intensity, 1);
      SE.audio._musicSteps(16 * 36);
      SE.audio.duck(1);
      SE.audio.setMusic(false); eq(SE.audio.musicPlaying, false, 'music setting off');
      SE.audio.setMusic(true); eq(SE.audio.musicPlaying, true, 'back on');
      SE.audio.setEnabled(false); eq(SE.audio.musicPlaying, false, 'muting sound stops music');
      SE.audio.setEnabled(true); eq(SE.audio.musicPlaying, true);
      SE.audio.ambient(false); eq(SE.audio.musicPlaying, false);
    } finally {
      SE.audio._reset();
      delete globalThis.AudioContext;
    }
  });

  test('yard hooks: build, run and reset events play without touching the yard', () => {
    SE.audio._reset();
    const Fake = makeFakeAudioContext();
    globalThis.AudioContext = Fake;
    try {
      SE.audio.play('click'); SE.audio.unlock();
      const y = new SE.yard.Yard({ parts: 'library' });
      let heard = 0; const real = SE.audio.play;
      SE.audio.play = function () { heard++; return real.apply(this, arguments); };
      try {
        y.emit('place', { part: { type: 'block' } });
        y.emit('dial', {});
        y.emit('run', {}); eq(SE.audio.intensity, 1, 'run picks the music up');
        y.emit('reset', {}); eq(SE.audio.intensity, 0, 'reset calms it');
        ok(heard >= 4, 'sounds played: ' + heard);
      } finally { SE.audio.play = real; }
    } finally {
      SE.audio._reset();
      delete globalThis.AudioContext;
    }
  });
});
