/*
 * WeldJoint: glues two bodies together at an anchor.
 *   new SE.phys.WeldJoint({ bodyA, bodyB, worldAnchor | localAnchorA/B,
 *     angularStiffness (N·m/rad, 0 = rigid), angularDamping (N·m·s/rad),
 *     breakForce (N), breakTorque (N·m) })
 * The point part works like a pin; the angular part holds the relative
 * angle where it was when the weld was made. A finite angularStiffness turns
 * it into a torsion spring, which is how beams made of welded segments bend.
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
    this.breakTorque = def.breakTorque == null ? Infinity : def.breakTorque;
    this.linearImpulse = M.v(0, 0);
    this.angularImpulse = 0;
  }
  WeldJoint.prototype = Object.create(Joint.prototype);

  WeldJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    var kA = this.bodyA.invI + this.bodyB.invI;
    this.axialMass = kA > 0 ? 1 / kA : 0;
    this.springSoft = null;
    if (this.angularStiffness > 0 && this.axialMass > 0) {
      var hz = Math.sqrt(this.angularStiffness / this.axialMass) / (2 * Math.PI);
      var zeta = this.angularDamping / (2 * Math.sqrt(this.angularStiffness * this.axialMass));
      this.springSoft = P.softness(hz, zeta, h);
    }
  };

  WeldJoint.prototype.warmStart = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    P.applyPair(A, B, a.r, b.r, this.linearImpulse);
    A.w -= A.invI * this.angularImpulse; B.w += B.invI * this.angularImpulse;
  };

  WeldJoint.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB;
    // angular part
    var C = B.angle - A.angle - this.referenceAngle, bias = 0, ms = 1, is = 0;
    if (this.springSoft) { bias = this.springSoft.biasRate * C; ms = this.springSoft.massScale; is = this.springSoft.impulseScale; }
    else if (useBias) { bias = this.jointSoft.biasRate * C; ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
    var Cdot = B.w - A.w;
    var imp = -this.axialMass * ms * (Cdot + bias) - is * this.angularImpulse;
    this.angularImpulse += imp;
    A.w -= A.invI * imp; B.w += B.invI * imp;
    // point part, same as a pin
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB), rA = a.r, rB = b.r;
    var cd = P.relVel(A, B, rA, rB), bv = M.v(0, 0); ms = 1; is = 0;
    if (useBias) { bv = M.scale(M.sub(b.p, a.p), this.jointSoft.biasRate); ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var k11 = mA + mB + rA.y * rA.y * iA + rB.y * rB.y * iB;
    var k12 = -rA.y * rA.x * iA - rB.y * rB.x * iB;
    var k22 = mA + mB + rA.x * rA.x * iA + rB.x * rB.x * iB;
    var det = k11 * k22 - k12 * k12; if (det !== 0) det = 1 / det;
    var bx = cd.x + bv.x, by = cd.y + bv.y;
    var sx = det * (k22 * bx - k12 * by), sy = det * (k11 * by - k12 * bx);
    var li = M.v(-ms * sx - is * this.linearImpulse.x, -ms * sy - is * this.linearImpulse.y);
    this.linearImpulse = M.add(this.linearImpulse, li);
    P.applyPair(A, B, rA, rB, li);
  };

  WeldJoint.prototype.force = function () { return M.len(this.linearImpulse) * this.invH; };
  WeldJoint.prototype.torque = function () { return this.angularImpulse * this.invH; };
  WeldJoint.prototype.reaction = function () {
    return { force: M.scale(this.linearImpulse, this.invH), torque: this.angularImpulse * this.invH };
  };

  P.WeldJoint = WeldJoint;
})(globalThis.SE);
