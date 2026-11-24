/*
 * The job judge: runs a design and says whether the job is done.
 *
 * The simulation is the only judge. A goal is a function called after every
 * step with a state object; it returns
 *   undefined / null      keep running
 *   true | 'pass'         the job is done
 *   { fail: 'why' }       the job failed (stop and say why)
 *   'string'              same as { fail: string }
 *
 *   var goal = SE.yard.goals.all(
 *     SE.yard.goals.noBreaks(),
 *     SE.yard.goals.restIn('crate', { x0: 9, x1: 11 }, { maxSpeed: 0.05, hold: 0.5 }));
 * Guards (noBreaks, never) only ever fail; inside all() they are checked on
 * every step and don't hold up the pass.
 *   var r = SE.yard.judge({ design, site, goal, timeout: 20 });
 *   -> { pass, reason, time, steps, state, built }
 *
 * The same goal is used live by the yard (checked each step while the player
 * watches) and headless by tests and the automated play-through, so what
 * passes on screen passes in CI.
 *
 * State `s` (one per run):
 *   s.t, s.dt, s.world, s.built, s.part(id) -> built part, s.body(id) -> its main body
 *   s.pos(id), s.vel(id), s.speed(id)       centre of mass, m and m/s
 *   s.breaks [{ part, joint, force, t }], s.impacts [{ a, b, speed, t }]
 *   s.peak(key, value) -> running max of |value| under key (for margins)
 *   s.held(key, cond, seconds) -> true once cond has been true for `seconds` in a row
 *   s.read(readoutId) -> SI value of a readout (see design.js)
 *   s.memo  scratch object for custom goals
 */
(function (SE) {
  'use strict';
  SE.yard = SE.yard || {};

  function partOf(x) { return x && x.userData && x.userData.part; }

  function State(built, dt) {
    var s = this;
    this.built = built; this.world = built.world; this.dt = dt; this.t = 0;
    this.breaks = []; this.impacts = []; this.memo = {};
    this._held = {}; this._peak = {};
    this.world.on('break', function (e) { s.breaks.push({ part: partOf(e.joint), joint: e.joint, force: e.force, reason: e.reason, t: s.world.time }); });
    this.world.on('impact', function (e) { s.impacts.push({ a: partOf(e.a), b: partOf(e.b), speed: e.speed, t: s.world.time }); });
  }
  State.prototype.part = function (id) { return this.built.parts[id] || null; };
  State.prototype.body = function (id) { var p = this.part(id); return p ? p.body || p.bodies[0] : null; };
  State.prototype.pos = function (id) { var b = this.body(id); return b ? { x: b.c.x, y: b.c.y } : null; };
  State.prototype.vel = function (id) { var b = this.body(id); return b ? { x: b.v.x, y: b.v.y } : null; };
  State.prototype.speed = function (id) { var v = this.vel(id); return v ? Math.sqrt(v.x * v.x + v.y * v.y) : 0; };
  State.prototype.peak = function (key, v) { var a = Math.abs(v); if (!(key in this._peak) || a > this._peak[key]) this._peak[key] = a; return this._peak[key]; };
  State.prototype.peakOf = function (key) { return this._peak[key] || 0; };
  State.prototype.held = function (key, cond, seconds) {
    if (!cond) { delete this._held[key]; return false; }
    if (this._held[key] == null) this._held[key] = this.t;
    return this.t - this._held[key] >= seconds - 1e-9;
  };
  State.prototype.read = function (id) {
    var r = this.built.readouts.filter(function (x) { return x.id === id; })[0];
    return r ? r.read(this.world) : NaN;
  };
  State.prototype.tick = function () { this.t = this.world.time; };

  function verdict(v) {
    if (v == null || v === false) return null;
    if (v === true || v === 'pass') return { pass: true };
    if (typeof v === 'string') return { pass: false, reason: v };
    if (v.fail) return { pass: false, reason: v.fail };
    if (v.pass) return { pass: true, reason: v.reason };
    return null;
  }

  // Headless run: build, step until the goal decides or the timeout passes.
  function judge(opts) {
    var dt = opts.dt || 1 / 60;
    var built = opts.built || SE.yard.build(opts.design, opts.site);
    if (built.errors.length) return { pass: false, reason: 'Not ready: ' + built.errors[0].error, errors: built.errors, built: built, time: 0, steps: 0 };
    var s = new State(built, dt);
    if (opts.setup) opts.setup(s);
    var timeout = opts.timeout || 30, steps = 0, v = null;
    while (built.world.time < timeout - 1e-9) {
      built.world.step(dt); steps++; s.tick();
      if (opts.each) opts.each(s);
      v = verdict(opts.goal(s));
      if (v) break;
      if (!finiteWorld(built.world)) { v = { pass: false, reason: 'The simulation blew up.' }; break; }
    }
    if (!v) v = verdict(opts.onTimeout ? opts.onTimeout(s) : null) || { pass: false, reason: opts.timeoutText || 'Time ran out before the job was done.' };
    return { pass: v.pass, reason: v.reason || '', time: built.world.time, steps: steps, state: s, built: built };
  }

  function finiteWorld(w) {
    for (var i = 0; i < w.bodies.length; i++) { var b = w.bodies[i]; if (!isFinite(b.c.x) || !isFinite(b.c.y)) return false; }
    return true;
  }

  /* ------------------------------------------------------------- goals */
  var allIds = 0;
  var goals = {
    // pass when every goal has passed (each latches), fail as soon as one fails
    all: function () {
      // guards (never, noBreaks) are checked every step and never latch
      // latches live on the run's state, so one goal object can judge many runs
      var gs = Array.prototype.slice.call(arguments), key = 'all#' + (allIds++);
      return function (s) {
        var done = s.memo[key] || (s.memo[key] = gs.map(function (g) { return !!g.guard; }));
        for (var i = 0; i < gs.length; i++) {
          if (done[i] && !gs[i].guard) continue;
          var v = verdict(gs[i](s));
          if (v && !v.pass) return { fail: v.reason };
          if (v && v.pass) done[i] = true;
        }
        return done.every(Boolean) ? 'pass' : null;
      };
    },
    // fail if anything snaps (optionally only parts in `ids`)
    noBreaks: function (ids, text) {
      return guard(function (s) {
        var b = s.breaks.filter(function (x) { return !ids || ids.indexOf(x.part) >= 0; })[0];
        if (b) return { fail: text || ('The ' + labelOf(s, b.part) + ' broke at ' + SE.yard.dial.format(b.force, SE.yard.dial.autoUnit(b.force, 'force'), 3, 'force') + '.') };
        return null;
      });
    },
    // guard: never latches, fails whenever pred(s) returns a string
    never: function (pred) { return guard(function (s) { var r = pred(s); return r ? { fail: r } : null; }); },
    // a part's centre comes to rest inside a box
    restIn: function (id, box, o) {
      o = o || {};
      var maxSpeed = o.maxSpeed == null ? 0.05 : o.maxSpeed, hold = o.hold == null ? 0.5 : o.hold;
      return function (s) {
        var p = s.pos(id); if (!p) return { fail: 'The ' + id + ' is missing.' };
        var inside = inBox(p, box);
        return s.held('restIn:' + id, inside && s.speed(id) <= maxSpeed, hold) ? 'pass' : null;
      };
    },
    // a part's centre enters a box (moving or not)
    reach: function (id, box) { return function (s) { var p = s.pos(id); return p && inBox(p, box) ? 'pass' : null; }; },
    // condition must hold for `seconds`
    holdFor: function (key, pred, seconds) { return function (s) { return s.held(key, !!pred(s), seconds) ? 'pass' : null; }; },
    // pass if `g` passes before time t, else fail with text
    before: function (t, g, text) {
      return function (s) { var v = verdict(g(s)); if (v) return v.pass ? 'pass' : { fail: v.reason }; return s.t > t ? { fail: text || 'Too slow.' } : null; };
    },
    // custom pass/fail from a predicate after `t` seconds (for "watch what happens" runs)
    after: function (t, fn) { return function (s) { return s.t >= t - 1e-9 ? (fn ? fn(s) : 'pass') : null; }; }
  };
  function guard(fn) { fn.guard = true; return fn; }
  function inBox(p, b) {
    return (b.x0 == null || p.x >= b.x0) && (b.x1 == null || p.x <= b.x1) && (b.y0 == null || p.y >= b.y0) && (b.y1 == null || p.y <= b.y1);
  }
  function labelOf(s, id) { var p = s.part(id); return p ? (p.inst.label || p.def.name.toLowerCase()) : 'part'; }

  /* ------------------------------------------------------------- score */
  // Job score (0..100): passing is worth 100, minus hints, failed runs and
  // whatever the job's margin rule takes off (oversized parts, a hard landing).
  function score(job, record) {
    var margin = 0;
    if (job.margin && record.state) margin = Math.max(0, Math.min(40, job.margin(record.state) || 0));
    return SE.scoring.taskScore({ base: record.pass ? 100 - margin : 0, hintTier: record.hintTier || 0, wrongAttempts: record.failedRuns || 0 });
  }

  SE.yard.State = State;
  SE.yard.judge = judge;
  SE.yard.verdict = verdict;
  SE.yard.goals = goals;
  SE.yard.inBox = inBox;
  SE.yard.jobScore = score;
})(globalThis.SE);
