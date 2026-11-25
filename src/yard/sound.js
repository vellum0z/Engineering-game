/*
 * Yard sounds: hooks the yard's events to SE.audio so the yard stays free
 * of sound code. Loaded after yard.js; it wraps a few Yard methods and
 * listens to every emit. Each hook is a no-op when sound can't be heard.
 *
 *   place / move / remove / dial / select  -> build sounds
 *   picking a part from the bin, the first end of a line  -> pickup, hook
 *   run / pause / reset / blocked  -> machine sounds; the music gets busier
 *     while a run is going and calms down after
 *   result  -> the yard plays good/bad itself; the music dips under it
 *   winch drums turning  -> gear ticks as line pays in or out; stall once
 *   poke (grabbing a body mid-run)  -> boing
 */
(function (SE) {
  'use strict';
  var Y = SE.yard;
  if (!Y || !Y.Yard) return;
  var P = Y.Yard.prototype;

  function A() { return SE.audio && SE.audio.live && SE.audio.live() ? SE.audio : null; }
  function play(name, opts) { var a = A(); if (a) a.play(name, opts); }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  var lastPlace = 0;
  var EVENTS = {
    place: function (e) { lastPlace = now(); var d = e.part && Y.partDef(e.part.type); play(d && d.connector ? 'hook' : 'place', { pitch: d && d.category === 'Site' ? 0.8 : 1 }); },
    move: function () { play('place', { volume: 0.6, pitch: 1.1 }); },
    remove: function () { play('remove'); },
    dial: function () { play('dial'); },
    select: function (e) { if (e.part && now() - lastPlace > 150) play('select'); },
    blocked: function () { play('blocked'); },
    run: function (e, yard) {
      play('run');
      var a = A(); if (a) a.setIntensity(1);
      var w = yard.built && yard.built.world;
      if (w && w.joints.some(function (j) { return j.type === 'winch' && j.reelSpeed; })) play('motor', { volume: 0.7 });
    },
    reset: function () { play('reset'); if (SE.audio && SE.audio.setIntensity) SE.audio.setIntensity(0); },
    result: function () { if (SE.audio && SE.audio.setIntensity) SE.audio.setIntensity(0); var a = A(); if (a) a.duck(1.4); },
    poke: function () { play('poke'); },
    step: function (e, yard) { winchTicks(yard); }
  };

  // Gear ticks paced by how fast the line moves, and one stall groan.
  function winchTicks(yard) {
    if (!A()) return;
    var w = yard.built && yard.built.world; if (!w) return;
    var dt = 1 / 60;
    var mem = yard._winchSound || (yard._winchSound = { w: null, d: [], slip: [] });
    if (mem.w !== w) { mem.w = w; mem.d = []; mem.slip = []; }
    for (var i = 0, k = 0; i < w.joints.length; i++) {
      var j = w.joints[i];
      if (j.type !== 'winch') continue;
      if (j.broken) { k++; continue; }
      var v = Math.abs(j.speed || 0);
      mem.d[k] = (mem.d[k] || 0) + v * dt;
      if (mem.d[k] > 0.06) { mem.d[k] = 0; play('winch', { pitch: Math.min(1.6, 0.85 + v), volume: 0.8 }); }
      mem.slip[k] = j.slipping && j.reelSpeed > 0 && v < 1e-3 ? (mem.slip[k] || 0) + dt : 0;
      if (mem.slip[k] > 0.4 && mem.slip[k] - dt <= 0.4) play('stall', { volume: 0.6 });
      k++;
    }
  }

  var emit = P.emit;
  P.emit = function (t, e) {
    var h = EVENTS[t];
    if (h) { try { h(e || {}, this); } catch (err) { /* sound never breaks the yard */ } }
    return emit.apply(this, arguments);
  };

  var startPlacing = P.startPlacing;
  P.startPlacing = function (entry) {
    var was = this.placing && this.placing.entry;
    var r = startPlacing.apply(this, arguments);
    try {
      if (was === entry) play('remove', { volume: 0.5, pitch: 1.3 });
      else if (now() - lastPlace > 150) play('pickup');   // not when a repeat part re-arms itself
    } catch (err) { /* ignore */ }
    return r;
  };

  var placeClick = P.placeClick;
  P.placeClick = function () {
    var before = this.placing && this.placing.stage, parts = (this.design.parts || []).length;
    var r = placeClick.apply(this, arguments);
    try {
      var after = this.placing && this.placing.stage;
      var added = (this.design.parts || []).length !== parts;
      if (!added && after != null && after !== before) play('hook');
      else if (!added && this.placing && after === before) play('blocked', { volume: 0.6 });   // clicked off an anchor
    } catch (err) { /* ignore */ }
    return r;
  };

  var pause = P.pause;
  P.pause = function () {
    var r = pause.apply(this, arguments);
    try { if (this.mode === 'run') play('pause'); } catch (err) { /* ignore */ }
    return r;
  };
})(globalThis.SE);
