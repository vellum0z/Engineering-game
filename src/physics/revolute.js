/*
 * RevoluteJoint: a pin. The two anchors stay together; rotation is free.
 *   new SE.phys.RevoluteJoint({ bodyA, bodyB, worldAnchor | localAnchorA/B, breakForce })
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

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

  RevoluteJoint.prototype.reaction = function () {
    return { force: M.scale(this.impulse, this.invH), torque: 0 };
  };

  P.RevoluteJoint = RevoluteJoint;
})(globalThis.SE);
