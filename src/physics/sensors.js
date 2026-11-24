/*
 * Sensors: the read-only measuring layer between the engine and the HUD.
 *
 * Nothing in this file changes the simulation. Every reading is SI; the HUD
 * converts for display with SE.units.
 *
 * Free-body diagrams
 *   var fbd = P.sensors.freeBody(world, body, { perPoint: false, dt })
 *   fbd.forces    [{ kind, from, point, vector, label, torque? }]
 *                 kind: 'weight' | 'contact-normal' | 'friction' | 'joint'
 *                       | 'spring' | 'applied' | 'damping'
 *                 from: the other body (null for weight, applied, damping)
 *   fbd.resultant ΣF (N)
 *   fbd.moment    ΣM about the centre of mass (N·m, counter-clockwise +)
 *   fbd.momentAbout(point)  ΣM about any world point
 * The forces are the ones the solver used in the last substep of the last
 * step: a constraint's accumulated impulse divided by the substep h. With the
 * soft step that impulse is the steady force, so a body at rest gives
 * ΣF ≈ 0 and ΣM ≈ 0, and a moving body gives ΣF ≈ m·a.
 *
 * Contact points of one manifold are merged into a single normal force at
 * the centroid of the normal forces (exact for parallel forces, all ≥ 0) and
 * a single friction force at the same point. perPoint: true lists each point.
 *
 * Applied forces come from body.lastApplied: every applyForce / applyTorque
 * call that acted during the last step, with its point of application.
 *
 * Joints report through their reaction(): { force on body B, torque }.
 * Body A gets the opposite. A joint whose two sides aren't equal and opposite
 * (a pulley) can define reactionOn(body) -> { force, torque, point }.
 *
 * Gauges: objects with read(world) -> number (SI) and a unit string.
 *   new P.sensors.LoadCell(joint, { axis })          N, signed (tension +)
 *   new P.sensors.LoadCell(bodyA, bodyB)             N, contact normal force
 *   new P.sensors.SpringScale(distanceJoint)         N; stretch(world) in m
 *   new P.sensors.Speedometer(body, { point, component: 'x' | 'y' })  m/s
 *   new P.sensors.Accelerometer(body, { component })  m/s², Δv over the last step
 *   new P.sensors.AngleGauge(body | [bodyA, bodyB], { degrees: false })  rad
 *   new P.sensors.TapeMeasure(a, b)                  m; a, b = {x, y} or { body, local }
 *   new P.sensors.Stopwatch(world, { start, stop })  s; start/stop = event name or fn(world)
 *   new P.sensors.EnergyMeter(world, { bodies, datum })  J; parts(world) for the split
 *   new P.sensors.MomentumMeter(world, { bodies, component })  N·s
 *   P.sensors.gauge(fn, unit)                        any custom reading
 *   P.sensors.jointForces(world)  every joint's reaction, for the stress overlay
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  /* ------------------------------------------------------------ helpers */
  // Length of the last step (before the first step there are no forces yet).
  function stepDt(world, opts) {
    return (opts && opts.dt) || world.dt || 1 / 60;
  }
  function invSubstep(world, opts) { return world.substeps / stepDt(world, opts); }
  function pick(vec, component) { return component === 'x' ? vec.x : component === 'y' ? vec.y : M.len(vec); }
  function isSpring(j) { return j.type === 'distance' && !j.rope && (j.stiffness > 0 || j.hertz > 0); }

  /* --------------------------------------------------- joint reactions */
  // { force on `body`, torque on `body`, point } for one joint, or null.
  function jointOn(j, body) {
    if (j.reactionOn) return j.reactionOn(body);
    if (j.bodyA !== body && j.bodyB !== body) return null;
    var r = j.reaction(), onB = j.bodyB === body;
    var point = onB ? j.anchorB() : j.anchorA();
    return {
      force: onB ? M.v(r.force.x, r.force.y) : M.neg(r.force),
      torque: onB ? (r.torque || 0) : -(r.torque || 0),
      point: point
    };
  }

  function jointForces(world) {
    return world.joints.map(function (j) {
      var r = j.reaction();
      var limit = j.breakForce, F = j.force(), T = j.torque ? Math.abs(j.torque()) : 0;
      var util = isFinite(limit) && limit > 0 ? F / limit : 0;
      if (j.breakTorque != null && isFinite(j.breakTorque) && j.breakTorque > 0) util = Math.max(util, T / j.breakTorque);
      return {
        joint: j, label: j.label || j.type, type: j.type,
        anchorA: j.anchorA(), anchorB: j.anchorB(),
        force: F, vector: M.v(r.force.x, r.force.y), torque: r.torque || 0,
        tension: j.tension ? j.tension() : null,
        utilisation: util            // force / rating, 1 = about to break
      };
    });
  }

  /* -------------------------------------------------------- free body */
  function freeBody(world, body, opts) {
    opts = opts || {};
    var forces = [], invH = invSubstep(world, opts), g = world.gravity;
    var add = function (kind, from, point, vector, label, torque) {
      forces.push({ kind: kind, from: from, point: point, vector: vector, label: label, torque: torque || 0 });
    };
    var dynamic = body.type === 'dynamic';

    // weight acts at the centre of mass
    if (dynamic && body.gravityScale !== 0) {
      add('weight', null, M.v(body.c.x, body.c.y), M.scale(g, body.m * body.gravityScale), 'W');
    }

    // contacts: the normal points from fa to fb, so fb is pushed along +n
    world.contacts.forEach(function (ct) {
      var sign = ct.fb.body === body ? 1 : (ct.fa.body === body ? -1 : 0);
      if (!sign || !ct.normal) return;
      var other = sign > 0 ? ct.fa.body : ct.fb.body;
      var n = ct.normal, t = ct.tangent;
      if (opts.perPoint) {
        ct.points.forEach(function (cp) {
          if (cp.normalImpulse > 0) add('contact-normal', other, cp.point, M.scale(n, sign * cp.normalImpulse * invH), 'N');
          if (cp.tangentImpulse !== 0) add('friction', other, cp.point, M.scale(t, sign * cp.tangentImpulse * invH), 'F');
        });
        return;
      }
      var Jn = 0, Jt = 0, px = 0, py = 0;
      ct.points.forEach(function (cp) {
        Jn += cp.normalImpulse; Jt += cp.tangentImpulse;
        px += cp.normalImpulse * cp.point.x; py += cp.normalImpulse * cp.point.y;
      });
      if (Jn <= 0) return;
      var at = M.v(px / Jn, py / Jn);
      add('contact-normal', other, at, M.scale(n, sign * Jn * invH), 'N');
      if (Jt !== 0) add('friction', other, at, M.scale(t, sign * Jt * invH), 'F');
    });

    // joints and springs
    world.joints.forEach(function (j) {
      var r = jointOn(j, body);
      if (!r) return;
      var other = j.bodyA === body ? j.bodyB : j.bodyA;
      add(isSpring(j) ? 'spring' : 'joint', other || null, r.point, r.force, j.label || j.type, r.torque);
    });

    // applied loads recorded during the last step
    (body.lastApplied || []).forEach(function (e) {
      var at = e.point ? M.v(e.point.x, e.point.y) : M.v(body.c.x, body.c.y);
      add('applied', null, at, M.v(e.vector.x, e.vector.y), e.torque ? 'T' : 'P', e.torque);
    });

    // linear and angular damping act like drag: -m c v and -I c ω
    if (dynamic && (body.linearDamping || body.angularDamping)) {
      add('damping', null, M.v(body.c.x, body.c.y), M.scale(body.v, -body.m * body.linearDamping), 'D',
        -body.I * body.angularDamping * body.w);
    }

    var R = M.v(0, 0);
    forces.forEach(function (f) { R = M.add(R, f.vector); });
    var momentAbout = function (o) {
      var sum = 0;
      forces.forEach(function (f) { sum += M.cross(M.sub(f.point, o), f.vector) + f.torque; });
      return sum;
    };
    return { body: body, forces: forces, resultant: R, moment: momentAbout(body.c), momentAbout: momentAbout };
  }

  /* ------------------------------------------------------------ gauges */
  function gauge(fn, unit) { return { read: fn, unit: unit || '' }; }

  // Load cell on a joint (signed: tension +) or between two bodies (contact).
  function LoadCell(a, b, opts) {
    if (a && a.reaction) { this.joint = a; opts = b || {}; }
    else { this.bodyA = a; this.bodyB = b; opts = opts || {}; }
    this.axis = opts.axis ? M.norm(opts.axis) : null;
    this.unit = 'N';
  }
  LoadCell.prototype.vector = function (world) {
    if (this.joint) { var r = this.joint.reaction(); return M.v(r.force.x, r.force.y); }
    // contact force on bodyB from bodyA
    var F = M.v(0, 0), A = this.bodyA, B = this.bodyB, invH = invSubstep(world);
    world.contacts.forEach(function (ct) {
      var sign = ct.fb.body === B && ct.fa.body === A ? 1 : (ct.fa.body === B && ct.fb.body === A ? -1 : 0);
      if (!sign || !ct.normal) return;
      ct.points.forEach(function (cp) {
        F = M.mulAdd(F, sign * cp.normalImpulse * invH, ct.normal);
        F = M.mulAdd(F, sign * cp.tangentImpulse * invH, ct.tangent);
      });
    });
    return F;
  };
  LoadCell.prototype.read = function (world) {
    var j = this.joint;
    if (j) {
      if (this.axis) return M.dot(this.vector(world), this.axis);
      return j.tension ? j.tension() : j.force();
    }
    // between bodies: the normal (squeezing) force, always ≥ 0
    var A = this.bodyA, B = this.bodyB, N = 0, invH = invSubstep(world);
    world.contacts.forEach(function (ct) {
      if (!((ct.fa.body === A && ct.fb.body === B) || (ct.fa.body === B && ct.fb.body === A))) return;
      ct.points.forEach(function (cp) { N += cp.normalImpulse * invH; });
    });
    return N;
  };

  // Spring scale: a spring DistanceJoint; reads its tension, stretch() in m.
  function SpringScale(joint) { this.joint = joint; this.unit = 'N'; }
  SpringScale.prototype.read = function () { return this.joint.tension(); };
  SpringScale.prototype.stretch = function () { return this.joint.geometry().L - this.joint.length; };

  function Speedometer(body, opts) {
    opts = opts || {};
    this.body = body; this.point = opts.point || null; this.component = opts.component || null; this.unit = 'm/s';
  }
  Speedometer.prototype.read = function () {
    var b = this.body;
    return pick(this.point ? b.velocityAt(b.worldPoint(this.point)) : b.v, this.component);
  };

  // Accelerometer: Δv / Δt across the last step. It watches the world's
  // 'step' event from the moment it is made, so it reads 0 until it has
  // seen one step. Before the first step it uses the body's velocity as made.
  function Accelerometer(body, opts) {
    opts = opts || {};
    this.body = body; this.component = opts.component || null; this.unit = 'm/s²';
    this.prev = M.v(body.v.x, body.v.y); this.curr = this.prev; this.dt = 0;
    this.a = M.v(0, 0);
    var self = this, world = opts.world || body.world;
    if (world) world.on('step', function (e) {
      self.prev = self.curr; self.curr = M.v(body.v.x, body.v.y);
      self.a = M.scale(M.sub(self.curr, self.prev), 1 / e.dt);
    });
  }
  Accelerometer.prototype.vector = function () { return M.v(this.a.x, this.a.y); };
  Accelerometer.prototype.read = function () { return pick(this.a, this.component); };

  // Angle of one body, or of bodyB relative to bodyA.
  function AngleGauge(a, opts) {
    opts = opts || {};
    this.bodies = Array.isArray(a) ? a : [a];
    this.degrees = !!opts.degrees; this.unit = this.degrees ? '°' : 'rad';
    this.zero = opts.zero || 0;
  }
  AngleGauge.prototype.read = function () {
    var b = this.bodies, ang = b.length > 1 ? b[1].angle - b[0].angle : b[0].angle;
    ang -= this.zero;
    return this.degrees ? ang * 180 / Math.PI : ang;
  };

  // Tape measure between two points; each is a world point or { body, local }.
  function where(p) { return p.body ? p.body.worldPoint(p.local || p.body.localCenter) : p; }
  function TapeMeasure(a, b, opts) { this.a = a; this.b = b; this.component = (opts || {}).component || null; this.unit = 'm'; }
  TapeMeasure.prototype.vector = function () { return M.sub(where(this.b), where(this.a)); };
  TapeMeasure.prototype.read = function () { return pick(this.vector(), this.component); };

  // Stopwatch: start and stop on an event name ('impact', 'break', ...) or a
  // condition fn(world) checked after every step. No start = starts now.
  function Stopwatch(world, opts) {
    opts = opts || {};
    var self = this;
    this.world = world; this.unit = 's';
    this.startTime = null; this.stopTime = null;
    this.startOn = opts.start || null; this.stopOn = opts.stop || null;
    var start = function () { if (self.startTime == null) self.startTime = world.time; };
    var stop = function () { if (self.startTime != null && self.stopTime == null) self.stopTime = world.time; };
    if (!this.startOn) start();
    else if (typeof this.startOn === 'string') world.on(this.startOn, start);
    if (typeof this.stopOn === 'string') world.on(this.stopOn, stop);
    world.on('step', function () {
      if (typeof self.startOn === 'function' && self.startTime == null && self.startOn(world)) start();
      if (typeof self.stopOn === 'function' && self.startTime != null && self.stopTime == null && self.stopOn(world)) stop();
    });
  }
  Stopwatch.prototype.running = function () { return this.startTime != null && this.stopTime == null; };
  Stopwatch.prototype.read = function () {
    if (this.startTime == null) return 0;
    return (this.stopTime != null ? this.stopTime : this.world.time) - this.startTime;
  };

  // Energy: kinetic + gravitational potential (−m g·c, relative to datum) +
  // elastic energy ½kx² in spring DistanceJoints. Springs set by hertz get
  // k = m_eff ω² for the masses they join.
  function bodiesOf(world, opts) {
    return (opts.bodies || world.bodies).filter(function (b) { return b.type === 'dynamic'; });
  }
  function EnergyMeter(world, opts) {
    this.world = world; this.opts = opts || {}; this.unit = 'J';
  }
  EnergyMeter.prototype.parts = function (world) {
    world = world || this.world;
    var g = world.gravity, d = this.opts.datum || M.v(0, 0), kinetic = 0, potential = 0, elastic = 0;
    var list = bodiesOf(world, this.opts);
    list.forEach(function (b) {
      kinetic += b.kineticEnergy();
      potential -= b.m * b.gravityScale * M.dot(g, M.sub(b.c, d));
    });
    world.joints.forEach(function (j) {
      if (!isSpring(j)) return;
      if (this.opts.bodies && list.indexOf(j.bodyA) < 0 && list.indexOf(j.bodyB) < 0) return;
      var k = j.stiffness;
      if (!(k > 0)) { var w = 2 * Math.PI * j.hertz; k = j.effMass(j.geometry()) * w * w; }
      var x = j.geometry().L - j.length;
      elastic += 0.5 * k * x * x;
    }, this);
    return { kinetic: kinetic, potential: potential, elastic: elastic, total: kinetic + potential + elastic };
  };
  EnergyMeter.prototype.read = function (world) { return this.parts(world).total; };

  function MomentumMeter(world, opts) {
    this.world = world; this.opts = opts || {}; this.unit = 'N·s';
  }
  MomentumMeter.prototype.vector = function (world) {
    var p = M.v(0, 0);
    bodiesOf(world || this.world, this.opts).forEach(function (b) { p = M.mulAdd(p, b.m, b.v); });
    return p;
  };
  MomentumMeter.prototype.read = function (world) { return pick(this.vector(world), this.opts.component); };

  P.sensors = {
    freeBody: freeBody, jointForces: jointForces, gauge: gauge,
    LoadCell: LoadCell, SpringScale: SpringScale, Speedometer: Speedometer, Accelerometer: Accelerometer,
    AngleGauge: AngleGauge, TapeMeasure: TapeMeasure, Stopwatch: Stopwatch,
    EnergyMeter: EnergyMeter, MomentumMeter: MomentumMeter
  };
})(globalThis.SE);
