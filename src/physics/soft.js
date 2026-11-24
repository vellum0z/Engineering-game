/*
 * Soft-constraint core shared by contacts and every joint.
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

  
  function applyPair(A, B, rA, rB, Pv) {
    A.v = M.mulAdd(A.v, -A.invM, Pv); A.w -= A.invI * M.cross(rA, Pv);
    B.v = M.mulAdd(B.v, B.invM, Pv); B.w += B.invI * M.cross(rB, Pv);
  }

  function relVel(A, B, rA, rB) {
    return M.sub(M.add(B.v, M.crossSV(B.w, rB)), M.add(A.v, M.crossSV(A.w, rA)));
  }

  P.softness = softness;
  P.anchorShift = anchorShift;
  P.applyPair = applyPair;
  P.relVel = relVel;
})(globalThis.SE);
