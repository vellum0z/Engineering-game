/*
 * Joints: constraints between two bodies.
 *
 * Every joint has the same interface, which world.js calls each step:
 *   prepare(h, cfg)              once per step, before the substeps
 *   warmStart()                  each substep, re-applies last impulse
 *   solve(h, useBias, cfg)       each substep (useBias false = relax pass)
 *   force()                      magnitude of the constraint force, N
 * and the same definition fields:
 *   bodyA, bodyB, localAnchorA, localAnchorB (body-origin frame, m),
 *   collideConnected (default false), breakForce (N, default Infinity),
 *   label, userData.
 * After each step the world compares force() with breakForce and breaks the
 * joint (removes it and fires a 'break' event) when it is exceeded. That is
 * how a cable snaps or a pin shears: the simulation decides, not a script.
 *
 * Joints here:
 *   DistanceJoint  rigid rod, spring (stiffness N/m + damping N·s/m, or
 *                  hertz + dampingRatio), or rope
 *                  (rope: true, pulls only, slack below its length)
 *   RevoluteJoint  pin: the two anchors stay together, free rotation
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var nextId = 1;

  function Joint(def) {
    this.id = nextId++;
    this.bodyA = def.bodyA; this.bodyB = def.bodyB;
    this.localAnchorA = def.localAnchorA ? M.v(def.localAnchorA.x, def.localAnchorA.y) : M.v(0, 0);
    this.localAnchorB = def.localAnchorB ? M.v(def.localAnchorB.x, def.localAnchorB.y) : M.v(0, 0);
    this.collideConnected = !!def.collideConnected;
    this.breakForce = def.breakForce == null ? Infinity : def.breakForce;
    this.label = def.label || '';
    this.userData = def.userData || null;
    this.broken = false;
    this.invH = 0;
  }
  // World anchor and its offset from the centre of mass, from current state.
  Joint.prototype.frame = function (body, local) {
    var r = M.rotate(body.q, M.sub(local, body.localCenter));
    return { r: r, p: M.add(body.c, r) };
  };
  Joint.prototype.anchorA = function () { return this.frame(this.bodyA, this.localAnchorA).p; };
  Joint.prototype.anchorB = function () { return this.frame(this.bodyB, this.localAnchorB).p; };

  /* ------------------------------------------------------ distance / rope */
  function DistanceJoint(def) {
    Joint.call(this, def);
    this.type = 'distance';
    var pa = this.anchorA(), pb = this.anchorB();
    this.length = def.length != null ? def.length : M.dist(pa, pb);
    this.rope = !!def.rope;
    this.hertz = def.hertz || 0;                // 0 = rigid
    this.dampingRatio = def.dampingRatio == null ? 0.7 : def.dampingRatio;
    this.stiffness = def.stiffness || 0;        // N/m; overrides hertz each step
    this.damping = def.damping || 0;            // N·s/m, with stiffness
    this.impulse = 0;
  }
  DistanceJoint.prototype = Object.create(Joint.prototype);

  DistanceJoint.prototype.geometry = function () {
    var a = this.frame(this.bodyA, this.localAnchorA), b = this.frame(this.bodyB, this.localAnchorB);
    var d = M.sub(b.p, a.p), L = M.len(d);
    return { rA: a.r, rB: b.r, axis: L > 1e-9 ? M.scale(d, 1 / L) : M.v(0, 1), L: L };
  };

  DistanceJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    if (this.stiffness > 0) {
      // a real spring: k (N/m) and c (N·s/m) -> frequency and damping ratio for this pair of masses
      var m = this.effMass(this.geometry());
      if (m > 0) {
        this.hertz = Math.sqrt(this.stiffness / m) / (2 * Math.PI);
        this.dampingRatio = (this.damping || 0) / (2 * Math.sqrt(this.stiffness * m));
      }
    }
    this.springSoft = P.softness(this.hertz, this.dampingRatio, h);
    if (this.rope && this.geometry().L < this.length) this.impulse = 0;
  };

  DistanceJoint.prototype.effMass = function (g) {
    var A = this.bodyA, B = this.bodyB;
    var crA = M.cross(g.rA, g.axis), crB = M.cross(g.rB, g.axis);
    var k = A.invM + B.invM + A.invI * crA * crA + B.invI * crB * crB;
    return k > 0 ? 1 / k : 0;
  };

  DistanceJoint.prototype.warmStart = function () {
    var g = this.geometry();
    P.applyPair(this.bodyA, this.bodyB, g.rA, g.rB, M.scale(g.axis, this.impulse));
  };

  DistanceJoint.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB, g = this.geometry();
    var C = g.L - this.length;
    var mass = this.effMass(g);
    var vr = M.dot(P.relVel(A, B, g.rA, g.rB), g.axis);
    var bias = 0, ms = 1, is = 0;
    if (this.hertz > 0 && !this.rope) {
      // a physical spring acts in every pass, including relax
      bias = this.springSoft.biasRate * C; ms = this.springSoft.massScale; is = this.springSoft.impulseScale;
    } else if (this.rope && C < 0) {
      bias = C * this.invH;                     // slack: may close the gap, no further
    } else if (useBias) {
      bias = this.jointSoft.biasRate * C; ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale;
    }
    var imp = -mass * ms * (vr + bias) - is * this.impulse;
    var next = this.impulse + imp;
    if (this.rope) next = Math.min(next, 0);    // a rope can only pull
    imp = next - this.impulse; this.impulse = next;
    P.applyPair(A, B, g.rA, g.rB, M.scale(g.axis, imp));
  };

  DistanceJoint.prototype.force = function () { return Math.abs(this.impulse) * this.invH; };
  // Positive = tension (pulling the ends together), negative = compression.
  DistanceJoint.prototype.tension = function () { return -this.impulse * this.invH; };
  DistanceJoint.prototype.isSlack = function () { return this.rope && this.geometry().L < this.length - P.LINEAR_SLOP; };

  /* ------------------------------------------------------------ revolute */
  function RevoluteJoint(def) {
    Joint.call(this, def);
    this.type = 'revolute';
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    this.impulse = M.v(0, 0);
  }
  RevoluteJoint.prototype = Object.create(Joint.prototype);

  RevoluteJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
  };
  RevoluteJoint.prototype.warmStart = function () {
    var a = this.frame(this.bodyA, this.localAnchorA), b = this.frame(this.bodyB, this.localAnchorB);
    P.applyPair(this.bodyA, this.bodyB, a.r, b.r, this.impulse);
  };
  RevoluteJoint.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    var rA = a.r, rB = b.r;
    var Cdot = P.relVel(A, B, rA, rB);
    var bias = M.v(0, 0), ms = 1, is = 0;
    if (useBias) {
      var C = M.sub(b.p, a.p);
      bias = M.scale(C, this.jointSoft.biasRate); ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale;
    }
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var k11 = mA + mB + rA.y * rA.y * iA + rB.y * rB.y * iB;
    var k12 = -rA.y * rA.x * iA - rB.y * rB.x * iB;
    var k22 = mA + mB + rA.x * rA.x * iA + rB.x * rB.x * iB;
    var det = k11 * k22 - k12 * k12; if (det !== 0) det = 1 / det;
    var bx = Cdot.x + bias.x, by = Cdot.y + bias.y;
    var sx = det * (k22 * bx - k12 * by), sy = det * (k11 * by - k12 * bx);   // K^-1 b
    var imp = M.v(-ms * sx - is * this.impulse.x, -ms * sy - is * this.impulse.y);
    this.impulse = M.add(this.impulse, imp);
    P.applyPair(A, B, rA, rB, imp);
  };
  RevoluteJoint.prototype.force = function () { return M.len(this.impulse) * this.invH; };

  P.Joint = Joint;
  P.DistanceJoint = DistanceJoint;
  P.RevoluteJoint = RevoluteJoint;
})(globalThis.SE);
