/*
 * PrismaticJoint: a slider. Body B moves along an axis fixed in body A and
 * cannot turn relative to A. With a motor it is a hydraulic ram.
 *
 *   new SE.phys.PrismaticJoint({
 *     bodyA, bodyB, worldAnchor | localAnchorA/B, referenceAngle,
 *     localAxisA | worldAxis,                       // direction of travel (unit), default +x
 *     enableLimit, lowerTranslation, upperTranslation,  // m from the anchor
 *     enableMotor, motorSpeed (m/s), maxMotorForce (N), // speed-controlled ram
 *     motorForce (N), maxRamSpeed (m/s, default: no limit),  // force-controlled ram
 *     stiffness (N/m), damping (N·s/m), restTranslation (m),  // spring along the axis
 *     breakForce (N), breakTorque (N·m)
 *   })
 *
 * translation() is the distance of B's anchor from A's anchor along the
 * axis, so a new joint reads 0 and positive is extension along the axis.
 *
 * The game sets rams by force (kN): a force-controlled ram pushes B along
 * +axis (and A the opposite way, through the same point) with exactly
 * motorForce, so a crate on ice accelerates at exactly F/m. It never pulls.
 * maxRamSpeed is an optional stroke speed limit (a real ram's pump limits
 * the flow): set it and the ram stops pushing once it is that fast. A
 * speed-controlled ram drives toward motorSpeed but never pushes harder than
 * maxMotorForce, so it stalls against a load that needs more.
 *
 * Solve order per substep, following Box2D 3's prismatic joint: spring,
 * motor and limits on the axis, then the two rigid rows (perpendicular
 * offset and relative angle), which go to the joint's group solve when it
 * has one (see P.jointBlock in revolute.js). With d = anchor B − anchor A,
 * axis a and its perpendicular n in A's frame:
 *   axial Ċ  = a·(vB − vA) + (rB × a) wB − ((d + rA) × a) wA
 *   perp  Ċ  = n·(vB − vA) + (rB × n) wB − ((d + rA) × n) wA
 *   angle Ċ  = wB − wA
 *
 * Readouts (N, N·m):
 *   axialForce()  signed force B feels along the axis from spring, motor,
 *                 limits and motorForce; positive pushes B out along +axis
 *   force()       magnitude of the joint force on B (axial and side load)
 *   torque()      couple that keeps B from turning
 *   reaction()    { force: {x, y} on body B, torque }
 *   translation(), speed() (m/s, + = extending), motorForce, axis()
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  function PrismaticJoint(def) {
    Joint.call(this, def);
    this.type = 'prismatic';
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    var ax = def.localAxisA || (def.worldAxis ? M.invRotate(this.bodyA.q, def.worldAxis) : M.v(1, 0));
    this.localAxisA = M.norm(ax);
    this.referenceAngle = def.referenceAngle != null ? def.referenceAngle : this.bodyB.angle - this.bodyA.angle;
    this.enableLimit = def.enableLimit != null ? !!def.enableLimit : (def.lowerTranslation != null || def.upperTranslation != null);
    this.lowerTranslation = def.lowerTranslation != null ? def.lowerTranslation : -Infinity;
    this.upperTranslation = def.upperTranslation != null ? def.upperTranslation : Infinity;
    this.enableMotor = def.enableMotor != null ? !!def.enableMotor : def.maxMotorForce != null;
    this.motorSpeed = def.motorSpeed || 0;
    this.maxMotorForce = def.maxMotorForce || 0;
    this.motorForce = def.motorForce || 0;
    this.maxRamSpeed = def.maxRamSpeed != null ? def.maxRamSpeed : Infinity;
    this.ramImpulse = 0;
    this.stiffness = def.stiffness || 0;
    this.damping = def.damping || 0;
    this.restTranslation = def.restTranslation || 0;
    this.breakTorque = def.breakTorque == null ? Infinity : def.breakTorque;
    this.perpImpulse = 0;
    this.angularImpulse = 0;
    this.springImpulse = 0;
    this.motorImpulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
  }
  PrismaticJoint.prototype = Object.create(Joint.prototype);

  PrismaticJoint.prototype.axis = function () { return M.rotate(this.bodyA.q, this.localAxisA); };

  // Current geometry: anchors, lever arms and the axial and perpendicular
  // Jacobian terms.
  PrismaticJoint.prototype.geometry = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    var d = M.sub(b.p, a.p), axis = M.rotate(A.q, this.localAxisA), perp = M.perp(axis);
    var dA = M.add(d, a.r);
    return {
      rA: a.r, rB: b.r, d: d, axis: axis, perp: perp,
      a1: M.cross(dA, axis), a2: M.cross(b.r, axis),
      s1: M.cross(dA, perp), s2: M.cross(b.r, perp)
    };
  };

  PrismaticJoint.prototype.translation = function () { return M.dot(M.sub(this.anchorB(), this.anchorA()), this.axis()); };
  PrismaticJoint.prototype.speed = function () {
    var g = this.geometry(), A = this.bodyA, B = this.bodyB;
    return M.dot(g.axis, M.sub(B.v, A.v)) + g.a2 * B.w - g.a1 * A.w;
  };
  PrismaticJoint.prototype.angle = function () { return this.bodyB.angle - this.bodyA.angle - this.referenceAngle; };

  PrismaticJoint.prototype.setLimits = function (lower, upper) {
    this.lowerTranslation = Math.min(lower, upper); this.upperTranslation = Math.max(lower, upper); this.enableLimit = true;
  };
  PrismaticJoint.prototype.setMotor = function (speed, maxForce) {
    this.motorSpeed = speed; if (maxForce != null) this.maxMotorForce = maxForce; this.enableMotor = true;
    this.bodyA.wake(); this.bodyB.wake();
  };
  PrismaticJoint.prototype.setMotorForce = function (F) { this.motorForce = F; this.bodyA.wake(); this.bodyB.wake(); };

  function applyAxial(A, B, axis, a1, a2, imp) {
    A.v = M.mulAdd(A.v, -A.invM * imp, axis); A.w -= A.invI * a1 * imp;
    B.v = M.mulAdd(B.v, B.invM * imp, axis); B.w += B.invI * a2 * imp;
  }

  PrismaticJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h; this.h = h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.axialK2 = this.bodyA.invI + this.bodyB.invI;
    if (!this.enableLimit) { this.lowerImpulse = 0; this.upperImpulse = 0; }
    if (!this.enableMotor) this.motorImpulse = 0;
    if (!(this.stiffness > 0 || this.damping > 0)) this.springImpulse = 0;
    P.jointBlock.prepare(this);
  };

  PrismaticJoint.prototype.axialImpulse = function () {
    return this.springImpulse + this.motorImpulse + this.ramImpulse + this.lowerImpulse - this.upperImpulse;
  };

  // Runs once at the start of every substep, so it is also where the
  // force-controlled ram adds its push: F·h along the axis per substep.
  PrismaticJoint.prototype.warmStart = function () {
    var A = this.bodyA, B = this.bodyB, g = this.geometry();
    var ax = this.axialImpulse();
    var px = g.perp.x * this.perpImpulse + g.axis.x * ax, py = g.perp.y * this.perpImpulse + g.axis.y * ax;
    var LA = this.perpImpulse * g.s1 + this.angularImpulse + ax * g.a1;
    var LB = this.perpImpulse * g.s2 + this.angularImpulse + ax * g.a2;
    A.v = M.v(A.v.x - A.invM * px, A.v.y - A.invM * py); A.w -= A.invI * LA;
    B.v = M.v(B.v.x + B.invM * px, B.v.y + B.invM * py); B.w += B.invI * LB;
  };

  PrismaticJoint.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB, g = this.geometry();
    var k = A.invM + B.invM + A.invI * g.a1 * g.a1 + B.invI * g.a2 * g.a2;
    var mass = k > 0 ? 1 / k : 0, imp, Cdot;
    var vel = function () { return M.dot(g.axis, M.sub(B.v, A.v)) + g.a2 * B.w - g.a1 * A.w; };
    var tr = M.dot(g.d, g.axis);

    // spring along the axis
    if ((this.stiffness > 0 || this.damping > 0) && k > 0) {
      imp = P.springDelta(this.stiffness, this.damping, h, tr - this.restTranslation, vel(), k, this.springImpulse);
      this.springImpulse += imp;
      applyAxial(A, B, g.axis, g.a1, g.a2, imp);
    }

    // speed-controlled motor
    if (this.enableMotor && k > 0) {
      imp = -mass * (vel() - this.motorSpeed);
      var old = this.motorImpulse, maxI = this.maxMotorForce * h;
      this.motorImpulse = M.clamp(old + imp, -maxI, maxI);
      imp = this.motorImpulse - old;
      applyAxial(A, B, g.axis, g.a1, g.a2, imp);
    }

    // force-controlled ram: pushes with exactly motorForce (F = ma) and
    // never pulls back. With a stroke speed limit (maxRamSpeed) it pushes
    // only while slower than that in the push direction, like a ram whose
    // pump limits the flow.
    if (this.motorForce !== 0 && k > 0) {
      var dir = this.motorForce > 0 ? 1 : -1;
      imp = -mass * (vel() - dir * this.maxRamSpeed);
      var oldR = this.ramImpulse, maxR = Math.abs(this.motorForce) * h;
      this.ramImpulse = dir > 0 ? M.clamp(oldR + imp, 0, maxR) : M.clamp(oldR + imp, -maxR, 0);
      imp = this.ramImpulse - oldR;
      applyAxial(A, B, g.axis, g.a1, g.a2, imp);
    } else this.ramImpulse = 0;

    // translation limits (speculative while open, soft once violated). The
    // end stop a force ram pushes into is held rigid, so it stops the ram
    // where it is instead of giving by F/k of the joint softness; the push
    // back is still capped and the impulse is bounded by the ram's force.
    if (this.enableLimit && k > 0) {
      var C, bias, ms, is, next, f;
      if (this.lowerTranslation > -Infinity) {
        C = tr - this.lowerTranslation; bias = 0; ms = 1; is = 0;
        if (C > 0) bias = C * this.invH;
        else if (useBias) { bias = this.jointSoft.biasRate * C; f = P.capScale(bias, P.MAX_JOINT_PUSH); bias *= f; if (this.motorForce >= 0) { ms = this.jointSoft.massScale; is = f * this.jointSoft.impulseScale; } }
        imp = -mass * ms * (vel() + bias) - is * this.lowerImpulse;
        next = Math.max(this.lowerImpulse + imp, 0);
        imp = next - this.lowerImpulse; this.lowerImpulse = next;
        applyAxial(A, B, g.axis, g.a1, g.a2, imp);
      }
      if (this.upperTranslation < Infinity) {
        C = this.upperTranslation - tr; bias = 0; ms = 1; is = 0;
        if (C > 0) bias = C * this.invH;
        else if (useBias) { bias = this.jointSoft.biasRate * C; f = P.capScale(bias, P.MAX_JOINT_PUSH); bias *= f; if (this.motorForce <= 0) { ms = this.jointSoft.massScale; is = f * this.jointSoft.impulseScale; } }
        imp = -mass * ms * (-vel() + bias) - is * this.upperImpulse;
        next = Math.max(this.upperImpulse + imp, 0);
        imp = next - this.upperImpulse; this.upperImpulse = next;
        applyAxial(A, B, g.axis, g.a1, g.a2, -imp);
      }
    }

    // perpendicular and angular rows
    if (this.block) { if (this.blockLeader) P.jointBlock.solve(this.block, h, useBias); }
    else this.blockSolveOwn(h, useBias, g);
  };

  // 2×2 solve of the perpendicular and angular rows on their own.
  PrismaticJoint.prototype.blockSolveOwn = function (h, useBias, g) {
    var A = this.bodyA, B = this.bodyB;
    g = g || this.geometry();
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var k11 = mA + mB + iA * g.s1 * g.s1 + iB * g.s2 * g.s2;
    var k12 = iA * g.s1 + iB * g.s2;
    var k22 = iA + iB; if (k22 === 0) k22 = 1;     // both bodies fixed-rotation
    var c1 = M.dot(g.perp, M.sub(B.v, A.v)) + g.s2 * B.w - g.s1 * A.w, c2 = B.w - A.w;
    var b1 = 0, b2 = 0, ms = 1, is = 0;
    if (useBias) {
      b1 = P.capBias(this.jointSoft.biasRate * M.dot(g.perp, g.d), P.MAX_JOINT_PUSH); b2 = P.capBias(this.jointSoft.biasRate * this.angle(), P.MAX_JOINT_TURN);
      ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale;
    }
    var s = P.solve2({ k11: k11, k12: k12, k22: k22 }, c1 + b1, c2 + b2);
    var i1 = -ms * s.x - is * this.perpImpulse, i2 = -ms * s.y - is * this.angularImpulse;
    this.perpImpulse += i1; this.angularImpulse += i2;
    var LA = i1 * g.s1 + i2, LB = i1 * g.s2 + i2;
    A.v = M.mulAdd(A.v, -mA * i1, g.perp); A.w -= iA * LA;
    B.v = M.mulAdd(B.v, mB * i1, g.perp); B.w += iB * LB;
  };

  // Rigid rows for P.jointBlock: 0 = perpendicular offset, 1 = angle. Their
  // lever arms grow with the stroke, so the group refactors as it slides.
  PrismaticJoint.prototype.blockSlides = true;
  PrismaticJoint.prototype.blockSlots = function () { return this.axialK2 > 0 ? [0, 1] : [0]; };
  PrismaticJoint.prototype.blockRow = function (slot, r) {
    if (slot === 0) {
      var g = this.geometry();
      r.ja[0] = -g.perp.x; r.ja[1] = -g.perp.y; r.ja[2] = -g.s1;
      r.jb[0] = g.perp.x; r.jb[1] = g.perp.y; r.jb[2] = g.s2;
      r.C = M.dot(g.perp, g.d);
    } else {
      r.ja[0] = 0; r.ja[1] = 0; r.ja[2] = -1;
      r.jb[0] = 0; r.jb[1] = 0; r.jb[2] = 1;
      r.C = this.angle(); r.angular = true;
    }
  };
  PrismaticJoint.prototype.blockImpulse = function (slot) { return slot ? this.angularImpulse : this.perpImpulse; };
  PrismaticJoint.prototype.blockAdd = function (slot, d) { if (slot) this.angularImpulse += d; else this.perpImpulse += d; };

  PrismaticJoint.prototype.axialForce = function () { return this.axialImpulse() * this.invH; };
  PrismaticJoint.prototype.motorForceNow = function () { return (this.motorImpulse + this.ramImpulse) * this.invH; };
  PrismaticJoint.prototype.reaction = function () {
    var axis = this.axis(), perp = M.perp(axis), fa = this.axialForce(), fp = this.perpImpulse * this.invH;
    return { force: M.v(axis.x * fa + perp.x * fp, axis.y * fa + perp.y * fp), torque: this.torque() };
  };
  PrismaticJoint.prototype.force = function () { return M.len(this.reaction().force); };
  PrismaticJoint.prototype.torque = function () { return this.angularImpulse * this.invH; };

  // A running ram keeps both bodies awake (sleeping skips joints whose
  // bodies are all asleep).
  PrismaticJoint.prototype.postStep = function (dt) { if (this.blockLeader && this.block) P.jointBlock.guard(this.block, dt); };
  // Most work the ram or motor can do in a step, for the energy guard:
  // force times the speed it is allowed to drive at. A ram's speed is the
  // one it started the step with plus what its own force adds in the step
  // (not the speed at the end, which a blow-up would make as large as it
  // likes).
  PrismaticJoint.prototype.driveWork = function (dt) {
    var v = Math.abs(this.speed()), W = 0;
    if (this.motorForce !== 0) {
      var F = Math.abs(this.motorForce), vr = v;
      if (this.stepSpeed0 != null) vr = Math.min(v, this.stepSpeed0 + F * dt * (this.stepAxialInvMass || 0));
      W += F * Math.min(vr, this.maxRamSpeed) * dt;
    }
    if (this.enableMotor) W += Math.abs(this.motorImpulse * this.invH) * Math.min(v, Math.abs(this.motorSpeed)) * dt;
    return W;
  };
  PrismaticJoint.prototype.storedEnergy = function () {
    if (!(this.stiffness > 0)) return 0;
    var c = this.translation() - this.restTranslation; return 0.5 * this.stiffness * c * c;
  };
  PrismaticJoint.prototype.preStep = function () {
    if (this.motorForce !== 0 || (this.enableMotor && this.motorSpeed !== 0 && this.maxMotorForce > 0)) {
      this.bodyA.wake(); this.bodyB.wake();
    }
    // speed at the start of the step and the axial inverse mass, so the
    // energy guard can bound what the ram may add this step (driveWork)
    if (this.motorForce !== 0) {
      var A = this.bodyA, B = this.bodyB, g = this.geometry();
      this.stepSpeed0 = Math.abs(this.speed());
      this.stepAxialInvMass = A.invM + B.invM + A.invI * g.a1 * g.a1 + B.invI * g.a2 * g.a2;
    }
  };

  P.PrismaticJoint = PrismaticJoint;
  (P.jointTypes = P.jointTypes || {}).prismatic = {
    ctor: PrismaticJoint,
    fields: ['localAxisA', 'referenceAngle', 'enableLimit', 'lowerTranslation', 'upperTranslation',
      'enableMotor', 'motorSpeed', 'maxMotorForce', 'motorForce', 'maxRamSpeed', 'stiffness', 'damping', 'restTranslation']
  };
})(globalThis.SE);
