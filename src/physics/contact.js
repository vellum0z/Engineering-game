/*
 * Contact constraints: one per manifold between two fixtures.
 *
 * Interface the world calls each step (see world.js):
 *   prepare(ct, h, cfg)            once per step, before the substeps
 *   warmStart(ct)                  each substep
 *   solve(ct, invH, useBias, cfg)  each substep; useBias false = relax pass
 *   restitute(ct, cfg)             once, after the substeps
 * Each contact point keeps normalImpulse / tangentImpulse (N·s per substep),
 * which broadphase.js carries over between steps by feature id.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var softness = P.softness, anchorShift = P.anchorShift, applyPair = P.applyPair, relVel = P.relVel;

/* ---------------------------------------------------------- contacts */
  // One contact constraint = one manifold between two fixtures.
  function prepareContact(ct, h, cfg) {
    var A = ct.fa.body, B = ct.fb.body, n = ct.manifold.normal;
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    ct.normal = n; ct.tangent = M.rightPerp(n);
    ct.friction = P.mixFriction(ct.fa.friction, ct.fb.friction);
    ct.restitution = P.mixRestitution(ct.fa.restitution, ct.fb.restitution);
    ct.soft = softness(cfg.contactHertz, cfg.contactDampingRatio, h);
    ct.points.forEach(function (cp) {
      cp.rA = M.sub(cp.point, A.c);
      cp.rB = M.sub(cp.point, B.c);
      var rnA = M.cross(cp.rA, n), rnB = M.cross(cp.rB, n);
      var kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      cp.normalMass = kN > 0 ? 1 / kN : 0;
      var t = ct.tangent, rtA = M.cross(cp.rA, t), rtB = M.cross(cp.rB, t);
      var kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
      cp.tangentMass = kT > 0 ? 1 / kT : 0;
      var dv = M.sub(B.velocityAt(cp.point), A.velocityAt(cp.point));
      cp.relativeVelocity = M.dot(dv, n);
      cp.maxNormalImpulse = 0;
    });
  }


  function warmStartContact(ct) {
    var A = ct.fa.body, B = ct.fb.body;
    ct.points.forEach(function (cp) {
      var Pv = M.add(M.scale(ct.normal, cp.normalImpulse), M.scale(ct.tangent, cp.tangentImpulse));
      applyPair(A, B, cp.rA, cp.rB, Pv);
    });
  }


  function solveContact(ct, invH, useBias, cfg) {
    var A = ct.fa.body, B = ct.fb.body, n = ct.normal, t = ct.tangent;
    var total = 0;
    ct.points.forEach(function (cp) {
      // current separation, tracked through the bodies' motion this step
      var s = cp.separation + M.dot(M.sub(anchorShift(B, cp.rB), anchorShift(A, cp.rA)), n);
      var bias = 0, massScale = 1, impulseScale = 0;
      if (s > 0) bias = s * invH;                      // speculative: close the gap, no further
      else if (useBias) {
        bias = Math.max(ct.soft.biasRate * s, -cfg.maxPushVelocity);
        massScale = ct.soft.massScale; impulseScale = ct.soft.impulseScale;
      }
      var vn = M.dot(relVel(A, B, cp.rA, cp.rB), n);
      var imp = -cp.normalMass * massScale * (vn + bias) - impulseScale * cp.normalImpulse;
      var next = Math.max(cp.normalImpulse + imp, 0);
      imp = next - cp.normalImpulse; cp.normalImpulse = next;
      cp.maxNormalImpulse = Math.max(cp.maxNormalImpulse, imp);
      total += next;
      applyPair(A, B, cp.rA, cp.rB, M.scale(n, imp));
    });
    ct.points.forEach(function (cp) {
      var vt = M.dot(relVel(A, B, cp.rA, cp.rB), t);
      var imp = -cp.tangentMass * vt;
      var maxF = ct.friction * cp.normalImpulse;
      var next = M.clamp(cp.tangentImpulse + imp, -maxF, maxF);
      imp = next - cp.tangentImpulse; cp.tangentImpulse = next;
      applyPair(A, B, cp.rA, cp.rB, M.scale(t, imp));
    });
    return total;
  }

  function restituteContact(ct, cfg) {
    if (ct.restitution === 0) return;
    var A = ct.fa.body, B = ct.fb.body, n = ct.normal;
    ct.points.forEach(function (cp) {
      if (cp.relativeVelocity > -cfg.restitutionThreshold || cp.maxNormalImpulse === 0) return;
      var vn = M.dot(relVel(A, B, cp.rA, cp.rB), n);
      var imp = -cp.normalMass * (vn + ct.restitution * cp.relativeVelocity);
      var next = Math.max(cp.normalImpulse + imp, 0);
      imp = next - cp.normalImpulse; cp.normalImpulse = next;
      applyPair(A, B, cp.rA, cp.rB, M.scale(n, imp));
    });
  }

  P.contactSolver = { prepare: prepareContact, warmStart: warmStartContact, solve: solveContact, restitute: restituteContact };
})(globalThis.SE);
