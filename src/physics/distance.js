/*
 * DistanceJoint: keeps two anchors a set distance apart.
 *   rigid rod   (default)
 *   spring      stiffness (N/m) + damping (N·s/m), or hertz + dampingRatio
 *   rope        rope: true. Pulls only; slack when shorter than length.
 * tension() is positive when the joint pulls its ends together.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

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

  DistanceJoint.prototype.reaction = function () {
    var g = this.geometry();
    return { force: M.scale(g.axis, this.impulse * this.invH), torque: 0 };
  };

  P.DistanceJoint = DistanceJoint;
})(globalThis.SE);
