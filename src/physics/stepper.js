/*
 * Fixed-step clock for the physics world.
 *
 *   var st = new SE.phys.Stepper(world, { dt: 1 / 60, maxSteps: 5 });
 *   // each animation frame:
 *   st.advance(frameSeconds);                 // runs 0..n fixed steps
 *   var pose = SE.phys.lerpPose(body, st.alpha);  // { position, angle } to draw
 *
 * Physics always steps at a fixed dt (60 Hz by default) so results don't
 * depend on the monitor. advance() adds real time (times timeScale) to an
 * accumulator and takes as many whole steps as fit. The leftover fraction
 * of a step is `alpha` (0..1); drawing each body between its pose before
 * and after the last step by alpha gives smooth motion at any refresh rate
 * ("Fix your timestep", Glenn Fiedler).
 *
 * If a frame takes far too long (a tab in the background, a breakpoint),
 * trying to catch up would make the next frame slower still. So one call
 * takes at most maxSteps x timeScale steps and throws the rest of the time
 * away: the sim runs slower than real time rather than spiralling.
 *
 *   st.pause(); st.resume(); st.paused
 *   st.stepOnce()                 one step, paused or not (frame advance)
 *   st.timeScale = 0.25           0.1 (slow motion) .. 8 (fast forward)
 *   st.runUntil(pred, { timeout: 10 })  -> { ok, time, elapsed, steps, reason }
 * runUntil steps headless, as fast as it can, until pred(world) is truthy
 * (reason 'done', or the string pred returned), the timeout passes
 * (reason 'timeout') or a body's state stops being finite ('diverged').
 * The job judge uses it to fast-forward a run.
 *
 * Interpolation: the stepper listens for the world's 'step' event and keeps
 * each body's pose from the start and end of that step on body.prevPose.
 * lerpPose(body, alpha) blends them; a body that was moved since (dragged in
 * the editor, setTransform) or never stepped is drawn where it is.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var EPS = 1e-9;                    // s; absorbs rounding in summed frame times
  var MIN_SCALE = 0.1, MAX_SCALE = 8;

  // Body origin from a centre-of-mass position and angle.
  function origin(body, c, angle) {
    var q = M.rot(angle), lc = body.localCenter;
    return M.v(c.x - (q.c * lc.x - q.s * lc.y), c.y - (q.s * lc.x + q.c * lc.y));
  }

  function recordPoses(world) {
    var bodies = world.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.type === 'static') continue;
      var c0 = b.c0 || b.c, a0 = b.angle0 != null ? b.angle0 : b.angle;
      b.prevPose = { position: origin(b, c0, a0), angle: a0, cx: b.c.x, cy: b.c.y, endAngle: b.angle };
    }
  }

  function lerpPose(body, alpha) {
    var pp = body.prevPose, pos = body.position;
    if (!pp || pp.cx !== body.c.x || pp.cy !== body.c.y || pp.endAngle !== body.angle) {
      return { position: pos, angle: body.angle };
    }
    var t = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
    return {
      position: M.v(pp.position.x + (pos.x - pp.position.x) * t, pp.position.y + (pos.y - pp.position.y) * t),
      angle: pp.angle + (body.angle - pp.angle) * t
    };
  }

  function Stepper(world, opts) {
    opts = opts || {};
    this.world = world;
    this.dt = opts.dt || 1 / 60;
    this.maxSteps = opts.maxSteps || 5;
    this.accumulator = 0;
    this.paused = !!opts.paused;
    this.droppedTime = 0;            // real seconds thrown away by the catch-up cap
    this._timeScale = 1;
    this.timeScale = opts.timeScale == null ? 1 : opts.timeScale;
    world.on('step', function () { recordPoses(world); });
  }

  Object.defineProperty(Stepper.prototype, 'timeScale', {
    get: function () { return this._timeScale; },
    set: function (s) { this._timeScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, +s || 1)); }
  });

  // Fraction of the next step already accumulated, for render interpolation.
  Object.defineProperty(Stepper.prototype, 'alpha', {
    get: function () { return Math.max(0, Math.min(1, this.accumulator / this.dt)); }
  });

  // Add real time; returns the number of physics steps taken.
  Stepper.prototype.advance = function (realSeconds) {
    if (this.paused || !(realSeconds > 0)) return 0;
    var dt = this.dt, scale = this._timeScale;
    this.accumulator += realSeconds * scale;
    var cap = Math.max(1, Math.ceil(this.maxSteps * Math.max(1, scale) - EPS));
    var n = 0;
    while (this.accumulator >= dt - EPS && n < cap) {
      this.world.step(dt);
      this.accumulator -= dt;
      n++;
    }
    if (this.accumulator >= dt - EPS) {
      // over the cap: keep the partial step for interpolation, drop the rest
      var keep = this.accumulator % dt;
      this.droppedTime += (this.accumulator - keep) / scale;
      this.accumulator = keep;
    }
    return n;
  };

  Stepper.prototype.pause = function () { this.paused = true; return this; };
  Stepper.prototype.resume = function () { this.paused = false; return this; };
  Stepper.prototype.stepOnce = function () { this.world.step(this.dt); return this; };
  // Forget accumulated time, e.g. after a Reset.
  Stepper.prototype.reset = function () { this.accumulator = 0; this.droppedTime = 0; return this; };

  function diverged(world) {
    var bs = world.bodies;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (!isFinite(b.c.x) || !isFinite(b.c.y) || !isFinite(b.angle) || !isFinite(b.v.x) || !isFinite(b.v.y) || !isFinite(b.w)) return true;
    }
    return false;
  }

  // Step headless until pred(world) is truthy or `timeout` sim seconds pass.
  Stepper.prototype.runUntil = function (pred, opts) {
    opts = opts || {};
    var world = this.world, dt = this.dt;
    var timeout = opts.timeout == null ? 10 : opts.timeout;
    var maxSteps = Math.ceil(timeout / dt - EPS), start = world.time;
    var result = function (ok, steps, reason) {
      return { ok: ok, time: world.time, elapsed: world.time - start, steps: steps, reason: reason };
    };
    var r = pred(world);
    if (r) return result(true, 0, typeof r === 'string' ? r : 'done');
    for (var i = 1; i <= maxSteps; i++) {
      world.step(dt);
      if (diverged(world)) return result(false, i, 'diverged');
      r = pred(world);
      if (r) return result(true, i, typeof r === 'string' ? r : 'done');
    }
    return result(false, maxSteps, 'timeout');
  };

  P.Stepper = Stepper;
  P.lerpPose = lerpPose;
})(globalThis.SE);
