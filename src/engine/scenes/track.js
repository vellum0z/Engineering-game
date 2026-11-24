/*
 * Track scene: a straight, level rail yard with carts, sleds and crates.
 * Used for Newton's laws, statics versus dynamics, and mass as resistance to
 * acceleration.
 *
 * Physics (each body a particle moving along x, level ground, N = m g):
 *   net force       F_net = F_applied + f
 *   kinetic         f = -sign(v) mu_k m g                 while v != 0
 *   static          at rest: if |F_applied| <= mu_s m g the body stays put
 *                   and friction exactly cancels the push (f = -F_applied);
 *                   otherwise it breaks loose and kinetic friction takes over.
 *   acceleration    a = F_net / m
 * Within one fixed step the force is constant, so the step is integrated
 * exactly (x += v dt + a dt^2 / 2). When friction brings a body to rest
 * part-way through a step, the step is cut at the stopping instant and the
 * static check runs again on the next step.
 *
 * a = 0 is the statics case, and it includes constant velocity: a sled on
 * ice with no net force keeps sliding at the same speed. The ghost trail
 * makes that visible (equal spacing = constant v, growing spacing = a > 0).
 *
 * Variable mass (sand-leaking sled): m(t) = max(mDry, m0 - leak * t).
 * Newton's second law in momentum form for a body that sheds mass is
 *   F = m dv/dt + (v - u) dm/dt ... with u the velocity of the lost mass.
 * Sand leaking through a hole in the floor falls straight down relative to
 * the sled, so it leaves with the sled's own velocity (u = v) and carries
 * its momentum away with it. The second term vanishes and
 *   a = F / m(t)
 * still holds with the current mass. Writing F = d(mv)/dt = m a + v dm/dt
 * naively would claim the sled speeds up just by leaking, which is wrong:
 * that form only applies when the mass leaves at rest in the ground frame.
 * Friction also uses the current mass, since the normal force drops as the
 * sand drains.
 *
 * Body-body contact: bodies on the same track collide along x with momentum
 * conserved and a small restitution (0.3 above 0.2 m/s closing speed,
 * otherwise perfectly inelastic, so a cart pushing another moves as one).
 *
 * Params:
 *   bodies: [{ id, m (kg), x (m, body centre), v (m/s), mu (kinetic),
 *              muS (static, default 1.2 mu), label, kind: 'cart'|'sled'|'crate',
 *              w (m, length, default by kind), leak (kg/s), mDry (kg) }]
 *   surface: 'ice' | 'concrete' | 'rail' (sets the default mu and the look)
 *   g (m/s^2, 9.81), length (m, bumper face position, 30),
 *   target (id the outcome tracks, default first body), goalX (m),
 *   bumperRating (m/s, Infinity), zombieSpeed (m/s, 0 = pack idles),
 *   zombieStart (m, pack front, -3), zombies (count, 5),
 *   showVectors, trail (ghost marks every 0.5 s), log (record samples),
 *   live (physics runs without run(), for the sandbox), units ('SI'|'FPS').
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;
  SE.physics = SE.physics || {};

  var KIND_W = { cart: 1.6, sled: 1.8, crate: 1.0 };
  var SURFACE_MU = { ice: 0, concrete: 0.5, rail: 0.01 };
  var FRICTION_COLOR = '#ff6b6b';
  var TRAIL_DT = 0.5;
  var LOG_DT = 0.05;

  // a timed force is on for t in [t0, t1); the epsilon absorbs clock round-off
  // so a 0.5 s push lasts exactly 120 fixed steps
  function on(e, t) { return t >= e.t0 - 1e-9 && t < e.t1 - 1e-9; }
  function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

  // ---------------------------------------------------------------- physics
  /*
   * Friction and acceleration for a body of mass m under applied force F
   * (all along x), given its current velocity. Returns { f, a, moving }.
   */
  function forces(F, v, m, mu, muS, g) {
    var N = m * g;
    if (v === 0) {
      if (Math.abs(F) <= muS * N) return { f: -F, a: 0, moving: false };
      var fk = -sign(F) * mu * N;
      return { f: fk, a: (F + fk) / m, moving: true };
    }
    var f = -sign(v) * mu * N;
    return { f: f, a: (F + f) / m, moving: true };
  }

  /*
   * Advance one body by dt with applied force F held constant over the step.
   * b: { x, v, m, mu, muS }. Returns a new { x, v, a, f, stopped }.
   */
  function advance(b, F, g, dt) {
    var r = forces(F, b.v, b.m, b.mu, b.muS, g);
    if (!r.moving) return { x: b.x, v: 0, a: 0, f: r.f, stopped: false };
    var v1 = b.v + r.a * dt;
    // kinetic friction reversed nothing: if v changes sign mid-step the body
    // stopped at t* = -v/a, so cut the step there and let statics decide next
    if (b.v !== 0 && sign(v1) !== sign(b.v)) {
      var ts = -b.v / r.a;
      return { x: b.x + b.v * ts + 0.5 * r.a * ts * ts, v: 0, a: r.a, f: r.f, stopped: true };
    }
    return { x: b.x + b.v * dt + 0.5 * r.a * dt * dt, v: v1, a: r.a, f: r.f, stopped: false };
  }

  // Mass of a leaking body at time t.
  function massAt(m0, leak, mDry, t) {
    if (!leak) return m0;
    return Math.max(mDry == null ? 0 : mDry, m0 - leak * t);
  }

  // Closed-form helpers for level design and tests.
  function accel(F, m, mu, g) { g = g == null ? 9.81 : g; var f = mu * m * g; return Math.abs(F) <= f ? 0 : (F - sign(F) * f) / m; }
  function breakaway(m, muS, g) { return muS * m * (g == null ? 9.81 : g); }
  function timeToReach(d, a, v0) {
    v0 = v0 || 0;
    if (a === 0) return v0 > 0 ? d / v0 : Infinity;
    var disc = v0 * v0 + 2 * a * d;
    if (disc < 0) return Infinity;
    return (-v0 + Math.sqrt(disc)) / a;
  }
  function stoppingDistance(v0, mu, g) { g = g == null ? 9.81 : g; return mu > 0 ? v0 * v0 / (2 * mu * g) : Infinity; }
  // Speed of a leaking sled from rest under constant F on ice: v = (F/leak) ln(m0/m).
  function leakSpeed(F, m0, leak, t) { return F / leak * Math.log(m0 / (m0 - leak * t)); }

  SE.physics.track = {
    forces: forces, advance: advance, massAt: massAt, accel: accel, breakaway: breakaway,
    timeToReach: timeToReach, stoppingDistance: stoppingDistance, leakSpeed: leakSpeed,
    SURFACE_MU: SURFACE_MU
  };

  // ------------------------------------------------------------------ scene
  function Track() {}

  Track.prototype.init = function (stage, p) {
    this.stage = stage;
    this.p = Object.assign({
      bodies: [{ id: 'sled', m: 80, x: 4, v: 0, kind: 'sled', label: 'SLED' }],
      surface: 'ice', g: 9.81, length: 30, target: null, goalX: null,
      bumperRating: Infinity, zombieSpeed: 0, zombieStart: -3, zombies: 5,
      showVectors: true, trail: false, log: true, live: false, units: 'SI'
    }, p);
    this.reset();
  };

  Track.prototype.reset = function () {
    var p = this.p, self = this;
    var muDef = SURFACE_MU[p.surface] != null ? SURFACE_MU[p.surface] : 0;
    this.bodies = p.bodies.map(function (d, i) {
      var mu = d.mu != null ? d.mu : muDef;
      return {
        id: d.id || ('b' + i), kind: d.kind || 'cart', label: d.label || '',
        m0: d.m, m: d.m, x: d.x, v: d.v || 0, a: 0, f: 0, F: 0, Fnet: 0,
        mu: mu, muS: d.muS != null ? d.muS : mu * 1.2,
        w: d.w || KIND_W[d.kind || 'cart'] || 1.4,
        leak: d.leak || 0, mDry: d.mDry != null ? d.mDry : 0,
        spin: 0, trail: [], log: [], sand: [], gauge: 0
      };
    });
    this.byId = {};
    this.bodies.forEach(function (b) { self.byId[b.id] = b; });
    this.targetId = p.target || (this.bodies[0] && this.bodies[0].id);
    this.forceSet = {};
    this.timed = [];           // { id, F, t0, t1, kind: 'push'|'spring', pair }
    this.time = 0;
    this.state = p.live ? 'live' : 'idle';
    this.bumper = { rating: p.bumperRating, broken: false, impact: 0, hitT: -9 };
    this.goalX = p.goalX;
    this.zombieSpeed = p.zombieSpeed || 0;
    this.zombieFront = p.zombieStart;
    this.chase = false;
    this.caught = false;
    this.arrival = null;
    this.result = null;
    this.nextTrail = 0;
    this.nextLog = 0;
    this.refF = 1;
    this.settle = false;
    this.duration = 12;
    this.zr = D.rng(17);
    this.zOffsets = [];
    for (var i = 0; i < p.zombies; i++) this.zOffsets.push(i * 0.9 + this.zr() * 0.6);
    this.record();
  };

  Track.prototype.resize = function (w, h) {
    var L = this.p.length;
    var span = L + 8.5;                       // zombie zone on the left, winch on the right
    // bodies are drawn true to scale, so a long yard gets a window about 15 m
    // wide that follows the tracked body, plus a minimap of the whole track
    var scale = Math.min((w - 20) / Math.min(span, 15), (h - 150) / 4.5);
    this.viewW = w;
    this.cam = new SE.Camera({ scale: scale, ox: 10 + 5 * scale, oy: h - 58 });
    this.camOx = null;
    this.follow = span * scale > w - 20;
  };

  // Pan the camera toward the tracked body (drawing only, never physics).
  Track.prototype.updateCamera = function (w) {
    var cam = this.cam, L = this.p.length, s = cam.scale;
    var left = 10 + 5 * s, right = w - 10 - (L + 3.5) * s;
    var want;
    if (!this.follow) want = (left + right) / 2;
    else {
      var T = this.byId[this.targetId], focus = T ? T.x : L / 2;
      // during a chase keep the pack in view when the gap allows
      if (this.chase && T && (T.x - this.zombieFront) * s < w * 0.6) focus = (T.x + this.zombieFront) / 2 + 1;
      want = Math.min(left, Math.max(right, w * 0.45 - focus * s));
    }
    if (this.camOx == null || Math.abs(want - this.camOx) > w) this.camOx = want;
    else this.camOx += (want - this.camOx) * 0.12;
    cam.ox = this.camOx;
  };

  Track.prototype.drawMinimap = function (ctx, w) {
    var L = this.p.length, mw = Math.min(280, w * 0.34), mx = w - mw - 12, my = 12, mh = 40, self = this;
    var x0 = -5, x1 = L + 3.5, sx = function (x) { return mx + 10 + (x - x0) / (x1 - x0) * (mw - 20); };
    ctx.save();
    ctx.fillStyle = 'rgba(15,30,50,0.82)'; D.roundRect(ctx, mx, my, mw, mh, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    var ty = my + 27;
    ctx.strokeStyle = C.blueInk; ctx.beginPath(); ctx.moveTo(sx(0), ty); ctx.lineTo(sx(L), ty); ctx.stroke();
    for (var k = 0; k <= L; k += 5) { ctx.beginPath(); ctx.moveTo(sx(k), ty - 2); ctx.lineTo(sx(k), ty + 2); ctx.stroke(); }
    // viewport bracket
    var cam = this.cam, v0 = cam.wx(0), v1 = cam.wx(w);
    ctx.strokeStyle = 'rgba(236,226,198,0.35)';
    ctx.strokeRect(Math.max(mx + 4, sx(v0)), my + 5, Math.min(mx + mw - 4, sx(v1)) - Math.max(mx + 4, sx(v0)), mh - 10);
    // pack, goal, bumper, bodies
    ctx.fillStyle = C.rot; ctx.fillRect(sx(x0), ty - 7, Math.max(2, sx(this.zombieFront) - sx(x0)), 6);
    if (this.goalX != null) { ctx.fillStyle = C.good; ctx.fillRect(sx(this.goalX) - 1, my + 8, 2, 22); }
    ctx.fillStyle = this.bumper.broken ? C.bad : C.hazard; ctx.fillRect(sx(L), ty - 9, 3, 11);
    this.bodies.forEach(function (b) {
      ctx.fillStyle = b.id === self.targetId ? C.paper : C.rustHi;
      ctx.fillRect(sx(b.x - b.w / 2), ty - 6, Math.max(3, sx(b.x + b.w / 2) - sx(b.x - b.w / 2)), 5);
    });
    ctx.restore();
    D.text(ctx, 'YARD ' + L + ' m', mx + 10, my + 14, { color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace', shadow: false });
  };

  // ---- applied forces
  Track.prototype.setForce = function (id, Fx) { this.forceSet[id] = Fx; this.wake(); };
  Track.prototype.push = function (id, F, duration) {
    this.timed.push({ id: id, F: F, t0: this.time, t1: this.time + (duration || 0.3), kind: 'push' });
    this.wake();
  };
  // Equal and opposite forces on two bodies (Newton's third law): the one on
  // the left is pushed left, the one on the right is pushed right.
  Track.prototype.springApart = function (idA, idB, F, duration) {
    var A = this.byId[idA], B = this.byId[idB];
    if (!A || !B) return;
    var left = A.x <= B.x ? A : B, right = left === A ? B : A;
    var t0 = this.time, t1 = this.time + (duration || 0.4), mag = Math.abs(F);
    var pair = { a: left.id, b: right.id, F: mag, t0: t0, t1: t1 };
    this.timed.push({ id: left.id, F: -mag, t0: t0, t1: t1, kind: 'spring', pair: pair });
    this.timed.push({ id: right.id, F: mag, t0: t0, t1: t1, kind: 'spring', pair: pair });
    this.wake();
  };
  Track.prototype.wake = function () { if (this.state === 'idle') this.state = 'live'; };
  Track.prototype.start = Track.prototype.wake;

  Track.prototype.appliedForce = function (b) {
    var F = this.forceSet[b.id] || 0, t = this.time;
    for (var i = 0; i < this.timed.length; i++) {
      var e = this.timed[i];
      if (e.id === b.id && on(e, t)) F += e.F;
    }
    return F;
  };
  Track.prototype.springForce = function (b) {
    var t = this.time, s = 0;
    this.timed.forEach(function (e) { if (e.kind === 'spring' && e.id === b.id && on(e, t)) s += e.F; });
    return s;
  };
  Track.prototype.pendingTimed = function () {
    var t = this.time;
    return this.timed.some(function (e) { return t < e.t1; });
  };

  /*
   * run(opts) resets the scene and starts the clock.
   * opts: duration (s, 12), goalX (m), zombieSpeed (m/s), bumperRating (m/s),
   *   target (body id), forces ({id: N}), pushes ([{id, F, duration, at}]),
   *   springs ([{a, b, F, duration, at}]), settle (keep going after the goal
   *   until the target stops or the bumper breaks; default true when the
   *   bumper has a finite rating).
   * Resolves { outcome: 'reached'|'caught'|'bumperBroken'|'stopped'|'timeout', detail }.
   */
  Track.prototype.run = function (opts) {
    opts = opts || {};
    var self = this;
    this.reset();
    if (opts.target) this.targetId = opts.target;
    if (opts.goalX != null) this.goalX = opts.goalX;
    if (opts.zombieSpeed != null) this.zombieSpeed = opts.zombieSpeed;
    if (opts.bumperRating != null) this.bumper.rating = opts.bumperRating;
    this.duration = opts.duration || 12;
    this.settle = opts.settle != null ? opts.settle : isFinite(this.bumper.rating);
    this.chase = this.zombieSpeed > 0;
    var fs = opts.forces || {};
    Object.keys(fs).forEach(function (id) { self.forceSet[id] = fs[id]; });
    (opts.pushes || []).forEach(function (q) { self.timed.push({ id: q.id, F: q.F, t0: q.at || 0, t1: (q.at || 0) + (q.duration || 0.3), kind: 'push' }); });
    (opts.springs || []).forEach(function (q) {
      var save = self.time; self.time = q.at || 0; self.springApart(q.a, q.b, q.F, q.duration); self.time = save;
    });
    this.state = 'running';
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  Track.prototype.finish = function (outcome) {
    if (this.result) return;
    var T = this.byId[this.targetId];
    var detail = {
      target: this.targetId, time: this.time, x: T ? T.x : null, v: T ? T.v : null,
      reached: !!this.arrival, arrivalTime: this.arrival ? this.arrival.t : null,
      arrivalSpeed: this.arrival ? this.arrival.v : null, goalX: this.goalX,
      bumperBroken: this.bumper.broken, impactSpeed: this.bumper.impact, bumperRating: this.bumper.rating,
      caught: this.caught, zombieGap: T ? (T.x - T.w / 2) - this.zombieFront : null
    };
    this.result = { outcome: outcome, detail: detail };
    this.state = 'done';
    if (this.resolve) {
      var r = this.resolve, res = this.result; this.resolve = null;
      setTimeout(function () { r(res); }, 700);
    }
  };

  Track.prototype.step = function (dt) {
    var p = this.p, self = this;
    // the pack shuffles in place until a chase starts
    if (!this.chase || this.state === 'idle') { this.zombieFront = p.zombieStart + Math.sin(this.time * 0.7) * 0.05; }
    if (this.state === 'idle') return;
    var L = p.length, g = p.g;

    // integrate each body with its own applied force
    this.bodies.forEach(function (b) {
      b.m = massAt(b.m0, b.leak, b.mDry, self.time);
      var F = self.appliedForce(b);
      var r = advance(b, F, g, dt);
      b.F = F; b.f = r.f; b.a = r.a; b.Fnet = F + r.f;
      b.spin += (r.x - b.x) / 0.32;
      b.x = r.x; b.v = r.v;
      b.gauge = Math.abs(self.springForce(b));
      if (b.leak && b.m > b.mDry && b.sand.length < 400 && Math.floor((self.time + dt) * 10) !== Math.floor(self.time * 10)) b.sand.push(b.x);
      self.refF = Math.max(self.refF, Math.abs(F), Math.abs(r.f));
    });
    this.collide();
    this.time += dt;

    // bumper at x = L (body front face against it)
    this.bodies.forEach(function (b) {
      var front = b.x + b.w / 2;
      if (self.bumper.broken) { if (front > L + 1.4) { b.x = L + 1.4 - b.w / 2; b.v = 0; } return; }
      if (front >= L && b.v > 0) {
        var vi = b.v;
        b.x = L - b.w / 2;
        if (vi > self.bumper.rating) {
          self.bumper.broken = true; self.bumper.impact = vi; self.bumper.hitT = self.time;
          b.v = vi * 0.25;      // it ploughs on into the berm, losing most of its speed
          if (self.cam) {
            self.stage.shake(Math.min(24, 8 + vi * 2.5));
            self.stage.flash('rgba(255,170,90,ALPHA)', 0.35, 0.3);
            self.stage.burst(self.cam.x(L), self.cam.y(0.6), { n: 50, color: C.rust, kind: 'debris', speed: 320 + vi * 30, angle: -Math.PI * 0.35, spread: 2.2 });
            self.stage.burst(self.cam.x(L), self.cam.y(0.6), { n: 30, color: '#ffd27a', speed: 380 });
            self.stage.burst(self.cam.x(L), self.cam.y(0), { n: 26, color: '#a08870', kind: 'dust', speed: 150, gravity: -30 });
          }
          SE.audio && SE.audio.play('crash');
        } else {
          if (vi > 0.05 && self.time - self.bumper.hitT > 0.2) {
            if (self.cam) { self.stage.shake(Math.min(10, 1 + vi * 3)); self.stage.burst(self.cam.x(L), self.cam.y(0.6), { n: 10, color: '#ffd27a', speed: 160 }); }
            SE.audio && SE.audio.play('clang');
          }
          self.bumper.impact = Math.max(self.bumper.impact, vi);
          self.bumper.hitT = self.time;
          b.v = vi > 0.2 ? -0.15 * vi : 0;   // buffer spring gives back a little
          if (b.v === 0) { b.a = 0; b.Fnet = 0; }  // resting on the buffer: its reaction balances the push
        }
      }
      if (b.x - b.w / 2 < -1 && b.v <= 0) { b.x = -1 + b.w / 2; b.v = 0; b.a = 0; b.Fnet = 0; }
    });

    // zombie pack
    var T = this.byId[this.targetId];
    if (this.chase && !this.caught && !this.arrival) {
      this.zombieFront += this.zombieSpeed * dt;
      if (T && this.zombieFront >= T.x - T.w / 2) { this.caught = true; this.zombieFront = T.x - T.w / 2; }
    } else if (this.caught && T) this.zombieFront = Math.min(this.zombieFront + this.zombieSpeed * dt, T.x - T.w / 2);

    this.record();
    if (this.state !== 'running') return;

    // outcome checks
    if (this.bumper.broken) { this.finish('bumperBroken'); return; }
    if (this.caught) { SE.audio && SE.audio.play('fail'); if (this.cam && T) this.stage.burst(this.cam.x(T.x - T.w / 2), this.cam.y(0.8), { n: 30, color: C.blood, speed: 200 }); this.finish('caught'); return; }
    if (T && this.goalX != null && !this.arrival && T.x >= this.goalX) {
      this.arrival = { t: this.time, v: T.v };
      SE.audio && SE.audio.play('success');
      if (!this.settle) { this.finish('reached'); return; }
    }
    var allRest = this.bodies.every(function (b) { return b.v === 0 && b.a === 0; });
    if (allRest && !this.pendingTimed() && this.time > 0.3 && !(this.chase && !this.arrival)) {
      this.finish(this.arrival ? 'reached' : 'stopped'); return;
    }
    if (this.time >= this.duration) this.finish(this.arrival ? 'reached' : 'timeout');
  };

  // 1D contact between neighbouring bodies (momentum conserved).
  Track.prototype.collide = function () {
    var bs = this.bodies.slice().sort(function (a, b) { return a.x - b.x; });
    for (var i = 0; i < bs.length - 1; i++) {
      var A = bs[i], B = bs[i + 1];
      var gap = (B.x - B.w / 2) - (A.x + A.w / 2);
      if (gap >= 0) continue;
      var mt = A.m + B.m;
      // separate without moving the centre of mass
      A.x += gap * B.m / mt; B.x -= gap * A.m / mt;
      var closing = A.v - B.v;
      if (closing > 0) {
        var e = closing > 0.2 ? 0.3 : 0;
        var vcm = (A.m * A.v + B.m * B.v) / mt;
        A.v = vcm - e * B.m / mt * closing;
        B.v = vcm + e * A.m / mt * closing;
        if (Math.abs(A.v) < 1e-9) A.v = 0;
        if (Math.abs(B.v) < 1e-9) B.v = 0;
        if (closing > 0.5) {
          if (this.cam) this.stage.burst(this.cam.x(A.x + A.w / 2), this.cam.y(0.6), { n: 8, color: '#ffd27a', speed: 140 });
          SE.audio && SE.audio.play('thud');
        }
      }
    }
  };

  Track.prototype.record = function () {
    var t = this.time;
    if (t >= this.nextTrail - 1e-9) {
      this.bodies.forEach(function (b) { b.trail.push({ t: t, x: b.x }); });
      this.nextTrail += TRAIL_DT;
    }
    if (this.p.log && t >= this.nextLog - 1e-9) {
      this.bodies.forEach(function (b) { b.log.push({ t: t, x: b.x, v: b.v, a: b.a }); });
      this.nextLog += LOG_DT;
    }
  };

  Track.prototype.getLog = function (id) { var b = this.byId[id || this.targetId]; return b ? b.log.slice() : []; };
  Track.prototype.getTrail = function (id) { var b = this.byId[id || this.targetId]; return b ? b.trail.slice() : []; };
  Track.prototype.body = function (id) { return this.byId[id || this.targetId]; };

  // ---- sandbox
  Track.prototype.controls = function () {
    var id = this.targetId, b = this.byId[id] || {};
    var def = this.p.bodies.filter(function (d, i) { return (d.id || ('b' + i)) === id; })[0] || {};
    return [
      { key: 'mass', label: 'Mass', min: 5, max: 500, step: 5, value: b.m0 || 50, unit: 'kg' },
      { key: 'force', label: 'Applied force', min: -800, max: 800, step: 10, value: this.forceSet[this.targetId] || 0, unit: 'N' },
      { key: 'mu', label: 'Friction μk', min: 0, max: 1, step: 0.01, value: b.mu || 0, unit: '' },
      { key: 'v0', label: 'Initial velocity', min: -5, max: 8, step: 0.1, value: def.v || 0, unit: 'm/s' }
    ];
  };

  Track.prototype.set = function (key, value) {
    var id = this.targetId, def = this.p.bodies.filter(function (d, i) { return (d.id || ('b' + i)) === id; })[0];
    var b = this.byId[id];
    if (!b || !def) return;
    if (key === 'force') { this.setForce(id, value); return; }
    if (key === 'mass') { def.m = value; b.m0 = b.m = value; }
    if (key === 'mu') { def.mu = value; def.muS = value * 1.2; b.mu = value; b.muS = value * 1.2; }
    if (key === 'v0') {
      // a new initial velocity restarts the motion from the start position
      def.v = value;
      var F = this.forceSet[id];
      this.reset(); if (F) this.forceSet[id] = F;
    }
    this.wake();
  };

  Track.prototype.readouts = function () {
    var self = this;
    var out = this.bodies.map(function (b) {
      return (b.label || b.id) + ': m = ' + fmtNum(b.m) + ' kg, v = ' + fmtSigned(b.v, 2) + ' m/s, a = ' + fmtSigned(b.a, 3) + ' m/s², F_net = ' + fmtForce(b.Fnet, self.p.units);
    });
    if (this.goalX != null) out.push('goal at x = ' + fmtNum(this.goalX) + ' m');
    return out;
  };

  // ------------------------------------------------------------------ draw
  Track.prototype.draw = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, self = this, L = p.length;
    this.updateCamera(w);
    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, cam.y(0), 70);
    this.drawSurface(ctx, w, t);
    this.drawScale(ctx);
    if (this.goalX != null) this.drawGoal(ctx, t);
    this.drawBumper(ctx, t);
    this.drawWinch(ctx);

    // sand piles left behind by leaking sleds
    this.bodies.forEach(function (b) {
      ctx.fillStyle = 'rgba(214,190,130,0.8)';
      b.sand.forEach(function (sx, i) { var r = cam.len(0.06 + (i % 3) * 0.02); ctx.beginPath(); ctx.ellipse(cam.x(sx), cam.y(0) + 1, r * 1.8, r, 0, Math.PI, 0); ctx.fill(); });
    });

    // ghost trail
    if (p.trail) this.bodies.forEach(function (b) {
      b.trail.forEach(function (m, i) {
        var sx = cam.x(m.x);
        ctx.save(); ctx.globalAlpha = 0.16 + 0.1 * (i % 2);
        self.drawBody(ctx, b, m.x, t, true);
        ctx.restore();
        ctx.strokeStyle = C.blueInk; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, cam.y(0) + 6); ctx.lineTo(sx, cam.y(0) + 16); ctx.stroke();
        if (i % 2 === 0) D.text(ctx, m.t.toFixed(0) + 's', sx, cam.y(0) + 28, { color: C.blueInk, align: 'center', font: '600 10px "IBM Plex Mono", monospace' });
      });
    });

    // zombie pack
    var zf = this.zombieFront;
    this.zOffsets.forEach(function (off, i) {
      var zx = zf - 0.3 - off;
      if (cam.x(zx) < -40) return;
      D.zombie(ctx, cam.x(zx), cam.y(0), cam.len(1.75), t * (self.chase ? 2 : 1), i + 5);
    });

    // springs between pairs
    var tt = this.time;
    this.timed.forEach(function (e) {
      if (e.kind !== 'spring' || e.F < 0) return;
      var A = self.byId[e.pair.a], B = self.byId[e.pair.b];
      if (!A || !B) return;
      var x1 = A.x + A.w / 2, x2 = B.x - B.w / 2;
      var active = tt >= e.t0 && tt < e.t1;
      if (x2 - x1 > 0.8 && !active) return;
      drawSpring(ctx, cam.x(x1), cam.x(Math.max(x1 + 0.08, Math.min(x2, x1 + 0.8))), cam.y(0.55), cam.len(0.18), active);
    });

    // cable from the winch, plus shovers for pushes
    this.bodies.forEach(function (b) {
      if (b.F > 0 && self.forceSet[b.id] > 0) {
        ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
        var hx = cam.x(b.x + b.w / 2), hy = cam.y(0.55);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(cam.x(L + 1.75), cam.y(0.95)); ctx.stroke();
      }
      self.timed.forEach(function (e) {
        if (e.kind === 'push' && e.id === b.id && tt >= e.t0 && tt < e.t1) {
          var behind = e.F > 0 ? b.x - b.w / 2 - 0.35 : b.x + b.w / 2 + 0.35;
          ctx.save(); ctx.translate(cam.x(behind), cam.y(0)); ctx.rotate(e.F > 0 ? 0.22 : -0.22);
          D.survivor(ctx, 0, 0, cam.len(1.7), t); ctx.restore();
        }
      });
    });

    this.bodies.forEach(function (b) { self.drawBody(ctx, b, b.x, t, false); });

    if (p.showVectors) this.bodies.forEach(function (b) { self.drawVectors(ctx, b); });
    this.bodies.forEach(function (b) { if (b.gauge > 0) gauge(ctx, cam.x(b.x), cam.y(b.kind === 'cart' ? 1.4 : 1.0) - 88, b.gauge, self.refF, p.units); });

    // readout panel
    var lines = ['t     ' + this.time.toFixed(2) + ' s   ' + p.surface];
    this.bodies.forEach(function (b) {
      lines.push((b.label || b.id).slice(0, 10) + '  m ' + fmtNum(b.m) + ' kg');
      lines.push('  v ' + fmtSigned(b.v, 2) + ' m/s  a ' + fmtSigned(b.a, 3) + ' m/s²');
      lines.push('  ΣF ' + fmtForce(b.Fnet, p.units));
    });
    if (this.chase) lines.push('pack  ' + this.zombieSpeed.toFixed(2) + ' m/s');
    if (isFinite(this.bumper.rating)) lines.push('bumper ' + this.bumper.rating.toFixed(1) + ' m/s rated');
    readout(ctx, 12, 12, lines);
    if (this.follow) this.drawMinimap(ctx, w);
  };

  Track.prototype.drawSurface = function (ctx, w, t) {
    var cam = this.cam, L = this.p.length, y0 = cam.y(0), x0 = cam.x(-1), x1 = cam.x(L + 0.2);
    var s = this.p.surface, r = D.rng(9);
    ctx.save();
    if (s === 'ice') {
      var g = ctx.createLinearGradient(0, y0 - 4, 0, y0 + 14);
      g.addColorStop(0, '#d9ecf4'); g.addColorStop(1, '#6f93a6');
      ctx.fillStyle = g; ctx.fillRect(x0, y0 - 3, x1 - x0, 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      for (var i = 0; i < 24; i++) { var cx = x0 + r() * (x1 - x0); ctx.beginPath(); ctx.moveTo(cx, y0 + 2 + r() * 8); ctx.lineTo(cx + 8 + r() * 20, y0 + 2 + r() * 8); ctx.stroke(); }
      // moving glint
      var gx = x0 + ((t * 60) % (x1 - x0 + 200)) - 100;
      var gl = ctx.createLinearGradient(gx - 60, 0, gx + 60, 0);
      gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(Math.max(x0, gx - 60), y0 - 3, 120, 4);
    } else if (s === 'concrete') {
      ctx.fillStyle = D.rustPattern(ctx, '#77736b', 21); ctx.fillRect(x0, y0 - 2, x1 - x0, 16);
      ctx.strokeStyle = 'rgba(30,25,20,0.6)'; ctx.lineWidth = 1;
      for (var j = 0; j < 12; j++) { var qx = x0 + r() * (x1 - x0); D.sketchLine(ctx, qx, y0, qx + 6 - r() * 12, y0 + 14, { passes: 1, wobble: 2 }); }
      for (var k = 0; k <= L; k += 4) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(cam.x(k), y0 - 2, 1.5, 16); }
    } else {
      // rail: sleepers and two steel rails seen in elevation
      ctx.fillStyle = C.woodDark;
      for (var q = -1; q <= L; q += 0.7) ctx.fillRect(cam.x(q), y0 + 2, cam.len(0.35), 10);
      ctx.fillStyle = '#2a2420'; ctx.fillRect(x0, y0 + 9, x1 - x0, 6);
      ctx.fillStyle = C.steelHi; ctx.fillRect(x0, y0 - 3, x1 - x0, 4);
      ctx.fillStyle = C.steel; ctx.fillRect(x0, y0 + 1, x1 - x0, 2);
    }
    ctx.restore();
  };

  Track.prototype.drawScale = function (ctx) {
    var cam = this.cam, L = this.p.length, y = cam.y(0) + 44;
    ctx.save();
    ctx.strokeStyle = 'rgba(143,184,232,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cam.x(0), y); ctx.lineTo(cam.x(L), y); ctx.stroke();
    for (var x = 0; x <= L + 1e-9; x += 1) {
      var big = x % 5 === 0;
      ctx.beginPath(); ctx.moveTo(cam.x(x), y - (big ? 6 : 3)); ctx.lineTo(cam.x(x), y); ctx.stroke();
      if (big) D.text(ctx, x + ' m', cam.x(x), y + 12, { color: C.blueInk, align: 'center', font: '600 10px "IBM Plex Mono", monospace', shadow: false });
    }
    ctx.restore();
  };

  Track.prototype.drawGoal = function (ctx, t) {
    var cam = this.cam, gx = cam.x(this.goalX), gy = cam.y(0), hgt = cam.len(2.6);
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(143,207,106,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(gx, gy + 8); ctx.lineTo(gx, gy - hgt); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.steel; ctx.fillRect(gx - 2, gy - hgt - 4, 3, hgt * 0.4);
    var wave = Math.sin(t * 3) * 3;
    ctx.fillStyle = this.arrival ? C.good : C.hazard;
    ctx.beginPath(); ctx.moveTo(gx + 1, gy - hgt - 4); ctx.quadraticCurveTo(gx + 14, gy - hgt + wave - 4, gx + 26, gy - hgt + 2); ctx.lineTo(gx + 1, gy - hgt + 10); ctx.fill();
    ctx.restore();
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    D.labelBox(ctx, 'GATE ' + fmtNum(this.goalX) + ' m', gx, gy - hgt - 18, C.good);
  };

  Track.prototype.drawBumper = function (ctx, t) {
    var cam = this.cam, L = this.p.length, bx = cam.x(L), y0 = cam.y(0), u = cam.len(1);
    ctx.save();
    if (!this.bumper.broken) {
      // buffer stop: two raked posts, a beam with hazard face and spring buffers
      var dt = this.time - this.bumper.hitT, squash = dt < 0.25 ? (1 - dt / 0.25) * 0.12 * Math.min(1, this.bumper.impact) : 0;
      ctx.fillStyle = D.rustPattern(ctx, C.rust, 6);
      ctx.fillRect(bx + u * 0.25, y0 - u * 1.05, u * 0.35, u * 1.05);
      ctx.beginPath(); ctx.moveTo(bx + u * 0.5, y0 - u * 0.95); ctx.lineTo(bx + u * 1.3, y0); ctx.lineTo(bx + u * 1.0, y0); ctx.lineTo(bx + u * 0.4, y0 - u * 0.7); ctx.fill();
      D.hazardStripes(ctx, bx + u * 0.18, y0 - u * 0.95, u * 0.14, u * 0.6);
      ctx.fillStyle = C.steelHi;
      [0.45, 0.75].forEach(function (yy) { ctx.fillRect(bx - u * (0.12 - squash), y0 - u * yy - 4, u * (0.3 - squash), 8); ctx.beginPath(); ctx.arc(bx - u * (0.12 - squash), y0 - u * yy, 7, 0, Math.PI * 2); ctx.fill(); });
    } else {
      // wreckage
      var r = D.rng(3);
      ctx.fillStyle = D.rustPattern(ctx, C.rustDark, 6);
      for (var i = 0; i < 6; i++) {
        ctx.save(); ctx.translate(bx + u * (0.3 + r() * 1.4), y0 - u * 0.08 - r() * 4); ctx.rotate(r() * 3 - 1.5);
        ctx.fillRect(-u * 0.3, -u * 0.06, u * (0.3 + r() * 0.4), u * 0.12); ctx.restore();
      }
      D.hazardStripes(ctx, bx + u * 0.6, y0 - u * 0.18, u * 0.5, u * 0.1);
      if (this.time - this.bumper.hitT < 3) { ctx.fillStyle = 'rgba(80,70,60,' + (0.4 * (1 - (this.time - this.bumper.hitT) / 3)) + ')'; ctx.beginPath(); ctx.arc(bx + u * 0.8, y0 - u * 1.2 - (this.time - this.bumper.hitT) * 20, u * 0.8, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    if (isFinite(this.bumper.rating)) {
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      D.labelBox(ctx, (this.bumper.broken ? 'SMASHED ' + this.bumper.impact.toFixed(2) : 'rated ' + this.bumper.rating.toFixed(1)) + ' m/s', bx + u * 0.6, y0 - u * 1.35, this.bumper.broken ? C.bad : C.hazard);
    }
  };

  Track.prototype.drawWinch = function (ctx) {
    var cam = this.cam, L = this.p.length, u = cam.len(1), wx = cam.x(L + 1.75), y0 = cam.y(0);
    var T = this.byId[this.targetId], pull = 0, self = this;
    this.bodies.forEach(function (b) { if (self.forceSet[b.id] > 0) pull = Math.max(pull, self.forceSet[b.id]); });
    ctx.save();
    // frame
    ctx.fillStyle = D.rustPattern(ctx, '#5a3a26', 8);
    ctx.fillRect(wx - u * 0.5, y0 - u * 0.25, u * 1.3, u * 0.25);
    ctx.fillStyle = C.iron; ctx.fillRect(wx - u * 0.35, y0 - u * 1.25, u * 0.12, u * 1.0); ctx.fillRect(wx + u * 0.45, y0 - u * 1.25, u * 0.12, u * 1.0);
    // drum turns with the cable payout
    var ang = T ? -T.x / 0.3 : 0, dr = u * 0.32;
    ctx.translate(wx + u * 0.11, y0 - u * 0.95 + dr); ctx.rotate(ang);
    ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(0, 0, dr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 1;
    for (var k = -3; k <= 3; k++) { ctx.beginPath(); ctx.arc(0, 0, dr * (0.6 + 0.05 * k), 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = C.iron; ctx.lineWidth = 3;
    for (var s = 0; s < 3; s++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(s * 2.09) * dr, Math.sin(s * 2.09) * dr); ctx.stroke(); }
    ctx.restore();
    if (pull > 0) { ctx.font = '600 11px "IBM Plex Mono", monospace'; D.labelBox(ctx, 'WINCH ' + fmtForce(pull, this.p.units), wx + u * 0.1, y0 - u * 1.6, C.force); }
  };

  Track.prototype.drawBody = function (ctx, b, x, t, ghost) {
    var cam = this.cam, y0 = cam.y(0), bw = cam.len(b.w), lx = cam.x(x - b.w / 2), u = cam.len(1);
    ctx.save();
    if (b.kind === 'cart') {
      var r = u * 0.26, deckY = y0 - r * 2 - u * 0.05, tubH = u * 0.75;
      ctx.fillStyle = ghost ? C.blueInk : D.rustPattern(ctx, C.rust, 4);
      ctx.beginPath(); ctx.moveTo(lx, deckY - tubH); ctx.lineTo(lx + bw, deckY - tubH); ctx.lineTo(lx + bw - u * 0.15, deckY); ctx.lineTo(lx + u * 0.15, deckY); ctx.closePath(); ctx.fill();
      if (!ghost) {
        ctx.strokeStyle = C.rustDark; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = C.rustDark; ctx.fillRect(lx - 2, deckY - tubH - 4, bw + 4, 5);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (var rv = 1; rv < 4; rv++) ctx.fillRect(lx + bw * rv / 4, deckY - tubH + 4, 2, tubH - 8);
        ctx.fillStyle = C.iron; ctx.fillRect(lx + u * 0.1, deckY, bw - u * 0.2, u * 0.08);
      }
      [lx + bw * 0.25, lx + bw * 0.75].forEach(function (wx) { wheel(ctx, wx, y0 - r, r, ghost ? 0 : b.spin, ghost); });
      if (!ghost && b.label) plate(ctx, b.label, lx + bw / 2, deckY - tubH / 2);
    } else if (b.kind === 'sled') {
      var h = u * 0.55, base = y0 - u * 0.22;
      // runners curl up at the front
      ctx.strokeStyle = ghost ? C.blueInk : C.steelHi; ctx.lineWidth = Math.max(2, u * 0.06);
      ctx.beginPath(); ctx.moveTo(lx, y0 - 2); ctx.lineTo(lx + bw - u * 0.25, y0 - 2); ctx.quadraticCurveTo(lx + bw + u * 0.05, y0 - 2, lx + bw, base - u * 0.1); ctx.stroke();
      ctx.lineWidth = 2;
      for (var st = 0; st < 3; st++) { var sx = lx + u * 0.2 + st * (bw - u * 0.5) / 2; ctx.beginPath(); ctx.moveTo(sx, y0 - 2); ctx.lineTo(sx, base); ctx.stroke(); }
      ctx.fillStyle = ghost ? C.blueInk : D.rustPattern(ctx, C.wood, 2);
      ctx.fillRect(lx, base - u * 0.1, bw - u * 0.1, u * 0.1);
      if (!ghost) {
        // cargo: sand sacks (shrink as a leaking sled drains) under a tarp
        var frac = b.leak ? Math.max(0.15, (b.m - b.mDry) / Math.max(1e-9, b.m0 - b.mDry)) : 1;
        ctx.fillStyle = '#b89a62';
        var sacks = 3;
        for (var sk = 0; sk < sacks; sk++) {
          var sw = (bw - u * 0.3) / sacks, sh = h * (b.leak ? frac : 0.85);
          D.roundRect(ctx, lx + u * 0.05 + sk * sw, base - u * 0.1 - sh, sw - 3, sh, 5); ctx.fill();
        }
        ctx.strokeStyle = C.woodDark; ctx.lineWidth = 1.5;
        ctx.strokeRect(lx, base - u * 0.1, bw - u * 0.1, u * 0.1);
        if (b.leak && b.m > b.mDry) {
          ctx.fillStyle = 'rgba(214,190,130,0.9)';
          for (var gq = 0; gq < 6; gq++) { var ph = (t * 3 + gq / 6) % 1; ctx.fillRect(cam.x(x) - 1, base + ph * (y0 - base), 2, 2); }
        }
        if (b.label) plate(ctx, b.label, lx + bw / 2 - u * 0.05, base - u * 0.1 - h * 0.45);
      }
    } else {
      var cs = u * 0.95;
      if (ghost) { ctx.strokeStyle = C.blueInk; ctx.lineWidth = 2; ctx.strokeRect(lx, y0 - cs, bw, cs); }
      else D.crate(ctx, lx, y0, bw, cs, { label: b.label });
    }
    ctx.restore();
  };

  Track.prototype.drawVectors = function (ctx, b) {
    var cam = this.cam, u = this.p.units;
    var top = cam.y(b.kind === 'cart' ? 1.4 : 1.0), cx = cam.x(b.x);
    var Ls = 80, ref = Math.max(this.refF, 1);
    var mid = cam.y(0.45);
    if (Math.abs(b.F) > 1e-9) D.arrow(ctx, cx, mid - 6, cx + Ls * b.F / ref, mid - 6, C.force, 'F ' + fmtForce(b.F, u), { width: 3.5, ly: -6 });
    if (Math.abs(b.f) > 1e-9) D.arrow(ctx, cx, cam.y(0) + 2, cx + Ls * b.f / ref, cam.y(0) + 2, FRICTION_COLOR, 'f ' + fmtForce(b.f, u), { width: 3, ly: 26 });
    var aLen = Math.max(-110, Math.min(110, b.a * 22));
    if (Math.abs(b.a) > 1e-6) D.arrow(ctx, cx, top - 18, cx + aLen, top - 18, C.accel, 'a ' + fmtSigned(b.a, 3) + ' m/s²', { width: 2.5, ly: -4 });
    var vLen = Math.max(-130, Math.min(130, b.v * 16));
    if (Math.abs(b.v) > 1e-6) D.arrow(ctx, cx, top - 46, cx + vLen, top - 46, C.vel, 'v ' + fmtSigned(b.v, 2) + ' m/s', { width: 2.5, ly: -4 });
  };

  // ---------------------------------------------------------------- helpers
  function wheel(ctx, x, y, r, ang, ghost) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = ghost ? C.blueInk : '#1d1916'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    if (!ghost) {
      ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(ang);
      ctx.strokeStyle = C.iron; ctx.lineWidth = 2;
      for (var s = 0; s < 5; s++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(s * 1.2566) * r * 0.7, Math.sin(s * 1.2566) * r * 0.7); ctx.stroke(); }
      ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function plate(ctx, label, x, y) {
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    D.labelBox(ctx, label, x, y, C.paper, 'rgba(20,17,15,0.75)');
  }

  function drawSpring(ctx, x1, x2, y, amp, active) {
    ctx.save();
    ctx.strokeStyle = active ? C.hazard : C.steel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y);
    var n = 10;
    for (var i = 1; i < n; i++) ctx.lineTo(x1 + (x2 - x1) * i / n, y + (i % 2 ? -amp : amp));
    ctx.lineTo(x2, y); ctx.stroke();
    ctx.restore();
  }

  // Dial force gauge. Both carts in a spring push read the same magnitude.
  function gauge(ctx, x, y, F, ref, units) {
    var r = 17;
    ctx.save();
    ctx.fillStyle = 'rgba(20,17,15,0.85)'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    for (var k = 0; k <= 8; k++) { var a = Math.PI * 0.75 + k / 8 * Math.PI * 1.5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75); ctx.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); ctx.stroke(); }
    var na = Math.PI * 0.75 + Math.min(1, F / Math.max(ref, 1)) * Math.PI * 1.5;
    ctx.strokeStyle = C.bad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(na) * r * 0.85, y + Math.sin(na) * r * 0.85); ctx.stroke();
    ctx.restore();
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    D.labelBox(ctx, fmtForce(F, units), x, y - r - 14, C.hazard);
  }

  function fmtNum(x) { return SE.sigfig.roundSig(x, 3).text; }
  function fmtSigned(x, d) { var s = x.toFixed(d); if (Number(s) === 0) s = (0).toFixed(d); return (Number(s) >= 0 ? '+' : '') + s; }
  function fmtForce(N, units) {
    if (Math.abs(N) < 1e-9) return '0 N';
    return (SE.sceneUtil && SE.sceneUtil.fmtForce) ? SE.sceneUtil.fmtForce(N, units) : SE.sigfig.roundSig(N, 4).text + ' N';
  }
  function readout(ctx, x, y, lines) {
    if (SE.sceneUtil && SE.sceneUtil.readout) return SE.sceneUtil.readout(ctx, x, y, lines);
  }

  SE.scenes.track = Track;
})(globalThis.SE);
