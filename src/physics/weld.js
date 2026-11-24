/*
 * WeldJoint: glues two bodies together at an anchor.
 *
 *   new SE.phys.WeldJoint({
 *     bodyA, bodyB, worldAnchor | localAnchorA/B, referenceAngle,
 *     angularStiffness (N·m/rad, 0 = rigid), angularDamping (N·m·s/rad),
 *     linearStiffness (N/m, 0 = rigid),      linearDamping (N·s/m),
 *     breakForce (N), breakTorque (N·m)
 *   })
 *
 * The point part works like a pin; the angular part holds the relative angle
 * where it was when the weld was made. A finite angularStiffness turns the
 * angular part into a torsion spring (how beams made of welded segments
 * bend: a segment joint of a beam with flexural rigidity EI and segment
 * length s has k = EI / s). A finite linearStiffness does the same for the
 * point part: a zero-length 2D spring F = −k·d − c·ḋ between the anchors.
 *
 * Rigid parts use the engine's soft joint constraint and correct position
 * only in the biased pass; spring parts are solved implicitly in every pass
 * (see P.springDelta in revolute.js), so a static spring reads exactly k·C.
 *
 * Readouts (N, N·m):
 *   force()     magnitude of the force the weld carries
 *   torque()    couple the weld applies to B (signed, counter-clockwise +).
 *               The point force acts through the anchor, so this is also the
 *               full moment about the anchor: the bending moment at the
 *               weld, which breakage.js compares with breakTorque
 *   reaction()  { force: {x, y} on body B, torque }
 *   angle()     relative rotation from the welded angle, rad
 *   offset()    anchor separation {x, y}, m (non-zero only for springs)
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  function WeldJoint(def) {
    Joint.call(this, def);
    this.type = 'weld';
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    this.referenceAngle = def.referenceAngle != null ? def.referenceAngle : this.bodyB.angle - this.bodyA.angle;
    this.angularStiffness = def.angularStiffness || 0;
    this.angularDamping = def.angularDamping || 0;
    this.linearStiffness = def.linearStiffness || 0;
    this.linearDamping = def.linearDamping || 0;
    this.breakTorque = def.breakTorque == null ? Infinity : def.breakTorque;
    this.linearImpulse = M.v(0, 0);
    this.angularImpulse = 0;
  }
  WeldJoint.prototype = Object.create(Joint.prototype);

  WeldJoint.prototype.angle = function () { return this.bodyB.angle - this.bodyA.angle - this.referenceAngle; };
  WeldJoint.prototype.offset = function () { return M.sub(this.anchorB(), this.anchorA()); };

  WeldJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h; this.h = h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.axialK = this.bodyA.invI + this.bodyB.invI;
    this.axialMass = this.axialK > 0 ? 1 / this.axialK : 0;
    this.angularSpring = this.angularStiffness > 0 || this.angularDamping > 0;
    this.linearSpring = this.linearStiffness > 0 || this.linearDamping > 0;
    P.jointBlock.prepare(this);
  };

  WeldJoint.prototype.warmStart = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    P.applyPair(A, B, a.r, b.r, this.linearImpulse);
    A.w -= A.invI * this.angularImpulse; B.w += B.invI * this.angularImpulse;
  };

  // Springs are solved here; rigid parts go to the joint's group (see
  // P.jointBlock in revolute.js) or, without one, to blockSolveOwn.
  WeldJoint.prototype.solve = function (h, useBias) {
    if (this.angularSpring) this.solveAngular(h, useBias);
    if (this.linearSpring) this.solvePoint(h, useBias);
    if (this.block) { if (this.blockLeader) P.jointBlock.solve(this.block, h, useBias); }
    else this.blockSolveOwn(h, useBias);
  };
  WeldJoint.prototype.blockSolveOwn = function (h, useBias) {
    if (!this.angularSpring) this.solveAngular(h, useBias);
    if (!this.linearSpring) this.solvePoint(h, useBias);
  };

  WeldJoint.prototype.solveAngular = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB, imp;
    if (!(this.axialK > 0)) return;
    var C = this.angle(), Cdot = B.w - A.w;
    if (this.angularSpring) {
      imp = P.springDelta(this.angularStiffness, this.angularDamping, h, C, Cdot, this.axialK, this.angularImpulse);
    } else {
      var bias = 0, ms = 1, is = 0;
      if (useBias) { bias = this.jointSoft.biasRate * C; ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
      imp = -this.axialMass * ms * (Cdot + bias) - is * this.angularImpulse;
    }
    this.angularImpulse += imp;
    A.w -= A.invI * imp; B.w += B.invI * imp;
  };

  WeldJoint.prototype.solvePoint = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB), rA = a.r, rB = b.r;
    var cd = P.relVel(A, B, rA, rB), K = P.pointK(A, B, rA, rB), li;
    var dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, L = this.linearImpulse;
    if (this.linearSpring) {
      // Δ = −(I + G K)⁻¹ (G Ċ + h k d + λ): the matrix form of P.springDelta
      var k = this.linearStiffness, G = h * (h * k + this.linearDamping);
      var s = P.solve2({ k11: 1 + G * K.k11, k12: G * K.k12, k22: 1 + G * K.k22 },
        G * cd.x + h * k * dx + L.x, G * cd.y + h * k * dy + L.y);
      li = M.v(-s.x, -s.y);
    } else {
      var bx = 0, by = 0, pms = 1, pis = 0;
      if (useBias) {
        bx = dx * this.jointSoft.biasRate; by = dy * this.jointSoft.biasRate;
        pms = this.jointSoft.massScale; pis = this.jointSoft.impulseScale;
      }
      var r = P.solve2(K, cd.x + bx, cd.y + by);
      li = M.v(-pms * r.x - pis * L.x, -pms * r.y - pis * L.y);
    }
    this.linearImpulse = M.add(L, li);
    P.applyPair(A, B, rA, rB, li);
  };

  // Rigid rows for P.jointBlock: 0, 1 = anchor x, y; 2 = relative angle.
  WeldJoint.prototype.blockSlots = function () {
    var s = [];
    if (!this.linearSpring) s.push(0, 1);
    if (!this.angularSpring && this.axialK > 0) s.push(2);
    return s;
  };
  WeldJoint.prototype.blockRow = function (slot, r) {
    if (slot < 2) { P.pointRow(this, slot, r); return; }
    r.ja[0] = 0; r.ja[1] = 0; r.ja[2] = -1;
    r.jb[0] = 0; r.jb[1] = 0; r.jb[2] = 1;
    r.C = this.angle();
  };
  WeldJoint.prototype.blockImpulse = function (slot) {
    return slot === 2 ? this.angularImpulse : (slot ? this.linearImpulse.y : this.linearImpulse.x);
  };
  WeldJoint.prototype.blockAdd = function (slot, d) {
    if (slot === 2) this.angularImpulse += d;
    else this.linearImpulse = slot ? M.v(this.linearImpulse.x, this.linearImpulse.y + d) : M.v(this.linearImpulse.x + d, this.linearImpulse.y);
  };

  WeldJoint.prototype.force = function () { return M.len(this.linearImpulse) * this.invH; };
  WeldJoint.prototype.torque = function () { return this.angularImpulse * this.invH; };
  WeldJoint.prototype.reaction = function () {
    return { force: M.scale(this.linearImpulse, this.invH), torque: this.angularImpulse * this.invH };
  };

  P.WeldJoint = WeldJoint;
  (P.jointTypes = P.jointTypes || {}).weld = {
    ctor: WeldJoint,
    fields: ['referenceAngle', 'angularStiffness', 'angularDamping', 'linearStiffness', 'linearDamping']
  };
})(globalThis.SE);
