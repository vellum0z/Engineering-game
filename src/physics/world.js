/*
 * The physics world: bodies, joints, contacts and the step loop.
 *
 *   var w = new SE.phys.World({ gravity: {x: 0, y: -9.81}, substeps: 4 });
 *   var ground = w.add(new SE.phys.Body({ type: 'static', shapes: [SE.phys.box(20, 0.5)] }));
 *   var crate  = w.add(new SE.phys.Body({ position: {x: 0, y: 2}, shapes: [SE.phys.box(0.5, 0.5)], mass: 250 }));
 *   w.on('break', function (e) { ... e.joint, e.force });
 *   w.step(1 / 60);
 *
 * Step order (Box2D 3 "soft step"):
 *   1. broadphase (dynamic AABB trees) and narrowphase -> contact manifolds,
 *      matched to last step's contacts so their impulses warm-start
 *   2. prepare contacts and joints for substep h = dt / substeps
 *   3. for each substep: integrate velocities, warm start, solve with soft
 *      position correction, integrate positions, relax (solve without it)
 *   4. restitution, joint postStep hooks, breakage, sleeping, 'step' event
 *
 * Each stage lives in its own file and is called through SE.phys:
 *   broadphase.js  P.broadphase.update(world)     pairs + manifolds -> world.contacts
 *   contact.js     P.contactSolver.*              contact constraints
 *   joint.js + one file per joint type            prepare / warmStart / solve / force
 *   breakage.js    P.breakage.check(world, dt)    snapping and 'break' events
 *   islands.js     P.islands.update(world, dt)    sleeping
 * This file only orders the stages, so module work never needs to edit it.
 *
 * Events (world.on(type, fn)): 'impact' { a, b, speed, point },
 * 'break' { joint, force }, 'step' { dt }. Every event also gets type and time.
 *
 * Defaults follow Box2D 3: contacts at 30 Hz stiffness with damping ratio 10
 * and a 3 m/s cap on push-out speed; joints at twice the contact stiffness.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, CS = null;

  // Stage modules, looked up at step time so each file can be replaced or
  // extended without touching this one.
  function stages() {
    return { bp: P.broadphase, cs: P.contactSolver, isl: P.islands, brk: P.breakage };
  }

  function World(def) {
    def = def || {};
    CS = P.contactSolver;
    this.gravity = def.gravity ? M.v(def.gravity.x, def.gravity.y) : M.v(0, -9.81);
    this.substeps = def.substeps || 4;
    this.cfg = {
      contactHertz: def.contactHertz || 60,
      contactDampingRatio: def.contactDampingRatio || 4,
      jointHertz: def.jointHertz || 60,
      jointDampingRatio: def.jointDampingRatio || 2,
      maxPushVelocity: def.maxPushVelocity || 3,
      restitutionThreshold: def.restitutionThreshold || 1,
      maxLinearSpeed: def.maxLinearSpeed || 400,
      enableSleep: def.enableSleep !== false
    };
    this.bodies = [];
    this.joints = [];
    this.contacts = new Map();        // key -> contact
    this.time = 0;
    this.stepCount = 0;
    this.listeners = {};
    this.events = [];
  }

  World.prototype.add = function (body) {
    body.world = this; this.bodies.push(body); return body;
  };
  World.prototype.remove = function (body) {
    this.bodies = this.bodies.filter(function (b) { return b !== body; });
    this.joints = this.joints.filter(function (j) { return j.bodyA !== body && j.bodyB !== body; });
    var self = this;
    this.contacts.forEach(function (ct, k) { if (ct.fa.body === body || ct.fb.body === body) self.contacts.delete(k); });
  };
  World.prototype.addJoint = function (joint) { this.joints.push(joint); return joint; };
  World.prototype.removeJoint = function (joint) { this.joints = this.joints.filter(function (j) { return j !== joint; }); };

  World.prototype.on = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return this; };
  World.prototype.emit = function (type, e) {
    e.type = type; e.time = this.time;
    if (type !== 'step') this.events.push(e);
    (this.listeners[type] || []).forEach(function (fn) { fn(e); });
  };

  // Bodies joined by a joint don't collide unless the joint says so.
  World.prototype.jointed = function (a, b) {
    for (var i = 0; i < this.joints.length; i++) {
      var j = this.joints[i];
      if (!j.collideConnected && ((j.bodyA === a && j.bodyB === b) || (j.bodyA === b && j.bodyB === a))) return true;
    }
    return false;
  };

  /* ---------------------------------------------------------------- step */
  World.prototype.step = function (dt) {
    var self = this, n = this.substeps, h = dt / n, invH = 1 / h, cfg = this.cfg, S = stages();
    this.dt = dt;
    CS = S.cs;
    var awake = function (b) { return b.type !== 'static' && b.awake !== false; };
    var active = function (A, B) { return awake(A) || awake(B); };
    this.joints.forEach(function (j) { if (j.preStep) j.preStep(dt); });
    S.bp.update(this);
    var contacts = Array.from(this.contacts.values()).filter(function (ct) { return active(ct.fa.body, ct.fb.body); });
    var joints = this.joints.filter(function (j) { return active(j.bodyA, j.bodyB); });
    var dyn = this.bodies.filter(function (b) { return b.type === 'dynamic' && awake(b); });
    var moving = this.bodies.filter(awake);
    this.bodies.forEach(function (b) { b.c0 = M.v(b.c.x, b.c.y); b.angle0 = b.angle; });
    contacts.forEach(function (ct) { CS.prepare(ct, h, cfg); });
    joints.forEach(function (j) { j.prepare(h, cfg); });
    // impact events for new contacts, with the approach speed
    contacts.forEach(function (ct) {
      if (!ct.isNew) return;
      var vMin = Math.min.apply(null, ct.points.map(function (p) { return p.relativeVelocity; }));
      if (vMin < -0.05) self.emit('impact', { a: ct.fa.body, b: ct.fb.body, speed: -vMin, point: ct.points[0].point });
    });
    var g = this.gravity;
    for (var s = 0; s < n; s++) {
      // integrate velocities
      dyn.forEach(function (b) {
        var ld = 1 / (1 + h * b.linearDamping), ad = 1 / (1 + h * b.angularDamping);
        b.v = M.v((b.v.x + h * (b.invM * b.force.x + b.gravityScale * g.x)) * ld,
                  (b.v.y + h * (b.invM * b.force.y + b.gravityScale * g.y)) * ld);
        b.w = (b.w + h * b.invI * b.torque) * ad;
      });
      joints.forEach(function (j) { j.warmStart(); });
      contacts.forEach(function (ct) { CS.warmStart(ct); });
      joints.forEach(function (j) { j.solve(h, true, cfg); });
      contacts.forEach(function (ct) { CS.solve(ct, invH, true, cfg); });
      // integrate positions
      moving.forEach(function (b) {
        var sp = M.len(b.v);
        if (sp > cfg.maxLinearSpeed) b.v = M.scale(b.v, cfg.maxLinearSpeed / sp);
        b.c = M.mulAdd(b.c, h, b.v);
        b.angle += h * b.w; b.q = M.rot(b.angle);
      });
      // relax: remove the energy the position correction added
      joints.forEach(function (j) { j.solve(h, false, cfg); });
      contacts.forEach(function (ct) { CS.solve(ct, invH, false, cfg); });
    }
    contacts.forEach(function (ct) { CS.restitute(ct, cfg); });
    dyn.forEach(function (b) { b.force = M.v(0, 0); b.torque = 0; b.lastApplied = b.appliedLog; b.appliedLog = []; });
    this.joints.forEach(function (j) { if (j.postStep) j.postStep(dt); });
    S.brk.check(this, dt);
    S.isl.update(this, dt);
    this.time += dt;
    this.stepCount++;
    this.emit('step', { dt: dt });
  };

  // Advance by `seconds` in fixed steps (used by tests and fast-forward).
  World.prototype.run = function (seconds, dt, each) {
    dt = dt || 1 / 60;
    var steps = Math.round(seconds / dt);
    for (var i = 0; i < steps; i++) { this.step(dt); if (each && each(this) === false) break; }
  };

  World.prototype.bodyAt = function (pw) {
    for (var i = this.bodies.length - 1; i >= 0; i--) if (this.bodies[i].containsPoint(pw)) return this.bodies[i];
    return null;
  };

  // Total contact force on a body from everything it touches (N), e.g. what a load cell reads.
  World.prototype.contactForceOn = function (body, dt) {
    var F = M.v(0, 0), invDt = this.substeps / dt;
    this.contacts.forEach(function (ct) {
      var sign = ct.fb.body === body ? 1 : (ct.fa.body === body ? -1 : 0);
      if (!sign) return;
      ct.points.forEach(function (cp) {
        F = M.mulAdd(F, sign * cp.normalImpulse * invDt, ct.normal);
        F = M.mulAdd(F, sign * cp.tangentImpulse * invDt, ct.tangent);
      });
    });
    return F;
  };

  P.World = World;
})(globalThis.SE);
