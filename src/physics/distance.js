/*
 * DistanceJoint: a rod, spring or rope between two anchors.
 *
 *   new SE.phys.DistanceJoint({ bodyA, bodyB, localAnchorA, localAnchorB,
 *     length,                       rest length, m (default: current distance)
 *     rope: true,                   pulls only; slack when shorter than length
 *     minLength, maxLength,         limits, m
 *     stiffness, damping,           a real spring: k (N/m), c (N·s/m)
 *     hertz, dampingRatio,          or the same spring given by frequency
 *     EA,                           axial stiffness of a line, N: k = EA / length
 *     motorSpeed, maxMotorForce,    length motor: m/s (+ = lengthen), N
 *     breakForce })
 *
 * Modes, following Box2D 3's distance joint:
 *   rod     no spring, minLength = maxLength = length: a rigid link
 *   spring  stiffness, hertz or EA set: the spring acts between minLength
 *           (default 0) and maxLength (default unlimited)
 *   rope    rope: true. Without EA it is inextensible: maxLength = length,
 *           minLength = 0. With EA it is a pull-only spring, so a taut rope
 *           stretches by δ = T·L/(EA) and a slack one carries nothing.
 * The spring acts in every pass, including relax, because it is a physical
 * spring and not position correction. Limits use speculative bias while
 * open (the gap may close in one substep but not overshoot) and the world's
 * joint softness once they are violated.
 *
 * setLength(L) changes the rest length (and maxLength of a rope, and the
 * stiffness EA/L of a line), which is how a crane pays out or reels in a
 * fixed-rate line. tension() is positive when the joint pulls its ends
 * together; force() is its magnitude, the number breakage compares with
 * breakForce.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  function DistanceJoint(def) {
    Joint.call(this, def);
    this.type = 'distance';
    var pa = this.anchorA(), pb = this.anchorB();
    this.length = def.length != null ? def.length : M.dist(pa, pb);
    this.rope = !!def.rope;
    this.EA = def.EA || 0;
    this.stiffness = def.stiffness || (this.EA ? this.EA / Math.max(this.length, 1e-3) : 0);
    this.damping = def.damping;                 // N·s/m; undefined = use dampingRatio
    this.hertz = def.hertz || 0;
    this.dampingRatio = def.dampingRatio == null ? (this.EA ? 0.1 : 0.7) : def.dampingRatio;
    this.spring = this.stiffness > 0 || this.hertz > 0;
    var freeMin = this.spring || this.rope;
    this.minLength = def.minLength != null ? def.minLength : (freeMin ? 0 : this.length);
    this.maxLength = def.maxLength != null ? def.maxLength
      : (this.spring ? Infinity : this.length);
    this.motorSpeed = def.motorSpeed || 0;
    this.maxMotorForce = def.maxMotorForce || 0;
    // accumulated impulses (N·s per substep), each along the A -> B axis
    this.impulse = 0;          // rigid rod
    this.springImpulse = 0;
    this.lowerImpulse = 0;     // >= 0, pushes apart at minLength
    this.upperImpulse = 0;     // >= 0, pulls together at maxLength
    this.motorImpulse = 0;
  }
  DistanceJoint.prototype = Object.create(Joint.prototype);

  DistanceJoint.prototype.setLength = function (L) {
    L = Math.max(0, L);
    this.length = L;
    this.bodyA.wake(); this.bodyB.wake();
    if (this.EA) this.stiffness = this.EA / Math.max(L, 1e-3);
    if (!this.spring) {
      if (this.rope) this.maxLength = L;
      else { this.minLength = L; this.maxLength = L; }
    }
  };

  // a running length motor keeps its bodies awake
  DistanceJoint.prototype.preStep = function () {
    if (this.maxMotorForce > 0 && this.motorSpeed !== 0) { this.bodyA.wake(); this.bodyB.wake(); }
  };

  DistanceJoint.prototype.isRigid = function () { return !this.spring && this.minLength >= this.maxLength; };

  DistanceJoint.prototype.geometry = function () {
    var a = this.frame(this.bodyA, this.localAnchorA), b = this.frame(this.bodyB, this.localAnchorB);
    var d = M.sub(b.p, a.p), L = M.len(d);
    return { rA: a.r, rB: b.r, axis: L > 1e-9 ? M.scale(d, 1 / L) : M.v(0, 1), L: L };
  };

  DistanceJoint.prototype.effMass = function (g) {
    var A = this.bodyA, B = this.bodyB;
    var crA = M.cross(g.rA, g.axis), crB = M.cross(g.rB, g.axis);
    var k = A.invM + B.invM + A.invI * crA * crA + B.invI * crB * crB;
    return k > 0 ? 1 / k : 0;
  };

  DistanceJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    var hz = this.hertz, zeta = this.dampingRatio, m = this.effMass(this.geometry());
    if (this.stiffness > 0) {
      // k (N/m) and c (N·s/m) -> frequency and damping ratio for this pair of masses
      if (m > 0) {
        hz = Math.sqrt(this.stiffness / m) / (2 * Math.PI);
        if (this.damping != null) zeta = this.damping / (2 * Math.sqrt(this.stiffness * m));
      }
    }
    // A spring stiffer than the joints the solver resolves would ring or gain
    // energy at this substep; such a line (a steel cable, say) is held at its
    // stretched length L + T/k as a stiff constraint instead.
    this.stiff = this.stiffness > 0 && hz > cfg.jointHertz;
    // A soft spring (omega·h well below 1) is applied as a force k·x + c·v
    // once per substep: symplectic Euler for the spring, implicit for the
    // damper. An undamped spring then keeps its energy instead of bleeding it
    // off like the soft-constraint form, and a damped one rests at k·x = load.
    var omega = 2 * Math.PI * hz;
    this.explicit = this.spring && !this.stiff && m > 0 && omega * h < 0.5;
    this.kEff = m * omega * omega;
    this.cEff = 2 * zeta * m * omega;
    this.springSoft = P.softness(hz, zeta, h);
    if (!this.isRigid() && !(this.stiff && !this.rope)) this.impulse = 0;
    if (!this.spring || this.stiff) this.springImpulse = 0;
    if (!this.stiff && !(this.maxLength < Infinity)) this.upperImpulse = 0;
    if (!(this.maxMotorForce > 0)) this.motorImpulse = 0;
  };

  DistanceJoint.prototype.axial = function () {
    return this.impulse + this.springImpulse + this.lowerImpulse - this.upperImpulse + this.motorImpulse;
  };

  DistanceJoint.prototype.warmStart = function () {
    var world = this.bodyA.world || this.bodyB.world;
    if (world && this.lineBlockStep === world.stepCount) return;   // the winch warm-starts it
    var g = this.geometry(), imp = this.axial() - (this.explicit ? this.springImpulse : 0);
    P.applyPair(this.bodyA, this.bodyB, g.rA, g.rB, M.scale(g.axis, imp));
  };

  DistanceJoint.prototype.solve = function (h, useBias) {
    // a winch is solving this rope together with its line this step (winch.js)
    var world = this.bodyA.world || this.bodyB.world;
    if (world && this.lineBlockStep === world.stepCount) return;
    var A = this.bodyA, B = this.bodyB, g = this.geometry();
    var mass = this.effMass(g);
    if (mass === 0) return;
    var soft = this.jointSoft;
    var vr = function () { return M.dot(P.relVel(A, B, g.rA, g.rB), g.axis); };
    var push = function (imp) { P.applyPair(A, B, g.rA, g.rB, M.scale(g.axis, imp)); };
    // one-sided limit: sign +1 keeps L >= target (pushes), -1 keeps L <= target (pulls)
    var limit = function (target, acc, sign) {
      var C = sign * (g.L - target), bias = 0, ms = 1, is = 0;
      if (C > 0) bias = C / h;                    // open: may close, not overshoot
      else if (useBias) { bias = soft.biasRate * C; ms = soft.massScale; is = soft.impulseScale; }
      var imp = -mass * ms * (sign * vr() + bias) - is * acc;
      var next = Math.max(0, acc + imp);
      push(sign * (next - acc));
      return next;
    };
    var rigid = function (target, acc) {
      var C = g.L - target, bias = 0, ms = 1, is = 0;
      if (useBias) { bias = soft.biasRate * C; ms = soft.massScale; is = soft.impulseScale; }
      var imp = -mass * ms * (vr() + bias) - is * acc;
      push(imp);
      return acc + imp;
    };
    var imp, next;

    if (this.maxMotorForce > 0) {
      var maxImp = this.maxMotorForce * h;
      imp = mass * (this.motorSpeed - vr());
      next = M.clamp(this.motorImpulse + imp, -maxImp, maxImp);
      imp = next - this.motorImpulse; this.motorImpulse = next; push(imp);
    }

    if (this.stiff) {
      // stiffer than the substep can resolve: hold the stretched length L + T/k
      if (this.rope) this.upperImpulse = limit(this.length + this.upperImpulse / (h * this.stiffness), this.upperImpulse, -1);
      else this.impulse = rigid(this.length - this.impulse / (h * this.stiffness), this.impulse);
      return;
    }

    if (this.explicit && this.minLength < this.maxLength) {
      if (useBias) {
        // spring explicit, damper implicit (on the velocity after this
        // impulse), so a damped spring still rests at exactly k·x = load
        imp = -h * (this.kEff * (g.L - this.length) + this.cEff * vr()) / (1 + h * this.cEff / mass);
        if (this.rope) imp = Math.min(imp, 0);   // a line only pulls
        this.springImpulse = imp; push(imp);
      }
    } else if (this.spring && this.minLength < this.maxLength) {
      var sp = this.springSoft, C = g.L - this.length;
      imp = -mass * sp.massScale * (vr() + sp.biasRate * C) - sp.impulseScale * this.springImpulse;
      next = this.springImpulse + imp;
      if (this.rope) next = Math.min(next, 0);   // a line only pulls
      imp = next - this.springImpulse; this.springImpulse = next; push(imp);
    }

    if (this.isRigid()) { this.impulse = rigid(this.length, this.impulse); return; }
    if (this.minLength > 0) this.lowerImpulse = limit(this.minLength, this.lowerImpulse, 1);
    if (this.maxLength < Infinity) this.upperImpulse = limit(this.maxLength, this.upperImpulse, -1);
  };

  // Positive = tension (pulling the ends together), negative = compression.
  DistanceJoint.prototype.tension = function () { return -this.axial() * this.invH; };
  DistanceJoint.prototype.force = function () {
    var F = Math.abs(this.axial()) * this.invH;
    // a rope a winch solved this step reports the step's largest pull (winch.js)
    var world = this.bodyA.world || this.bodyB.world;
    if (world && this.lineBlockStep === world.stepCount && this.linePeak) F = Math.max(F, this.linePeak * this.invH);
    return F;
  };
  DistanceJoint.prototype.currentLength = function () { return this.geometry().L; };
  DistanceJoint.prototype.isSlack = function () {
    if (!this.rope) return false;
    var L = this.geometry().L;
    return this.spring ? L < this.length - P.LINEAR_SLOP : L < this.maxLength - P.LINEAR_SLOP;
  };

  DistanceJoint.prototype.reaction = function () {
    var g = this.geometry();
    return { force: M.scale(g.axis, this.axial() * this.invH), torque: 0 };
  };

  P.DistanceJoint = DistanceJoint;
})(globalThis.SE);
