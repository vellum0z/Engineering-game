/*
 * Shared solver pieces: soft constraints and contact constraints.
 *
 * The engine uses the "soft step" scheme Box2D 3 settled on after comparing
 * solvers (box2d.org/posts/2024/02/solver2d): each frame is split into
 * substeps; in each substep velocities are integrated, constraints are solved
 * with a soft (spring-damper) position correction, positions are integrated,
 * and a relax pass re-solves without the correction so it adds no energy.
 * Restitution is applied once after the substeps.
 *
 * A soft constraint behaves like a stiff spring with natural frequency
 * `hertz` and damping ratio `zeta`. For substep h:
 *   omega = 2 pi hertz,  a1 = 2 zeta + h omega,  a2 = h omega a1,  a3 = 1/(1 + a2)
 *   biasRate = omega / a1,  massScale = a2 a3,  impulseScale = a3
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  function softness(hertz, zeta, h) {
    if (!hertz) return { biasRate: 0, massScale: 1, impulseScale: 0 };
    var omega = 2 * Math.PI * hertz, a1 = 2 * zeta + h * omega, a2 = h * omega * a1, a3 = 1 / (1 + a2);
    return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
  }

  // Anchor displacement since the start of the step: (c - c0) + (rotate(dq, r) - r).
  function anchorShift(body, r) {
    var dc = M.sub(body.c, body.c0);
    var da = body.angle - body.angle0;
    if (da === 0) return dc;
    var q = M.rot(da);
    return M.add(dc, M.sub(M.rotate(q, r), r));
  }

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

  function applyPair(A, B, rA, rB, Pv) {
    A.v = M.mulAdd(A.v, -A.invM, Pv); A.w -= A.invI * M.cross(rA, Pv);
    B.v = M.mulAdd(B.v, B.invM, Pv); B.w += B.invI * M.cross(rB, Pv);
  }

  function warmStartContact(ct) {
    var A = ct.fa.body, B = ct.fb.body;
    ct.points.forEach(function (cp) {
      var Pv = M.add(M.scale(ct.normal, cp.normalImpulse), M.scale(ct.tangent, cp.tangentImpulse));
      applyPair(A, B, cp.rA, cp.rB, Pv);
    });
  }

  function relVel(A, B, rA, rB) {
    return M.sub(M.add(B.v, M.crossSV(B.w, rB)), M.add(A.v, M.crossSV(A.w, rA)));
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

  P.softness = softness;
  P.anchorShift = anchorShift;
  P.applyPair = applyPair;
  P.relVel = relVel;
  P.contactSolver = { prepare: prepareContact, warmStart: warmStartContact, solve: solveContact, restitute: restituteContact };
})(globalThis.SE);
