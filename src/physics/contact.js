/*
 * Contact constraints: one per manifold between two fixtures.
 *
 * Interface the world calls each step (see world.js):
 *   prepare(ct, h, cfg)            once per step, before the substeps
 *   warmStart(ct)                  each substep
 *   solve(ct, invH, useBias, cfg)  each substep; useBias false = relax pass
 *   restitute(ct, cfg)             once, after the substeps
 *   pointForces(ct, h)             [{ point, normal, tangent }] in N, for gauges
 *   continuous(world, bodies)      once, after restitution: sweeps fast bodies
 *                                  so they can't jump thin walls (see below)
 * Each contact point keeps normalImpulse / tangentImpulse (N·s per substep),
 * which broadphase.js carries over between steps by feature id.
 *
 * Method (Box2D 3 contact_solver.c, written fresh for this engine):
 *
 * Anchors. Each point stores rA, rB from the body centres of mass at the
 * start of the step and an "adjusted separation" s0 - dot(rB - rA, n). The
 * current separation inside a substep is then rebuilt from how far the bodies
 * have moved, s = dot(dB - dA, n) + adjusted, where dX is the anchor's world
 * position now minus the centre at the start of the step. No narrowphase is
 * re-run between substeps.
 *
 * Softness. Penetration is corrected by a soft constraint (soft.js). At rest
 * a soft contact behaves like a spring of stiffness k = m_eff·ω², so under a
 * load F it sits at a penetration F / (m_eff ω²). The effective mass m_eff
 * is set by the *lighter* body (and for a corner point it is smaller still,
 * because the point can also rotate the body). So a heavy crate on a light
 * one sinks by about (M/m)·g/ω², and a tall column of light boxes is soft in
 * rocking and buckles under its own weight.
 *
 * Rules, following Box2D 3: contactHertz is capped at a quarter of the
 * substep rate, and contacts against a static or kinematic body get twice
 * that (4x the stiffness), because there is no second body to share the
 * error. The doubled value is held to the same cap: a light box squeezed
 * between a stiff floor and a heavy load is a two-spring system, and above
 * the cap it is under-resolved by the substep and gets squirted out.
 *
 * Tuning (proposed world.cfg defaults: contactHertz 60, contactDampingRatio
 * 4). At 4 substeps of 1/60 s the cap is 60 Hz. At Box2D's 30 Hz a 20-box
 * column buckles within 15 s, and 1000 kg on 10 kg sinks 35 mm at the top
 * contact. At 60 Hz both hold (9 mm per contact for the 100:1 stack), and a
 * damping ratio of 4 instead of 10 lets the rocking modes settle.
 *
 * Speculative points (s > 0) push only hard enough to close the gap this
 * substep (bias = s/h, rigid), so fast bodies stop at the surface. Overlap
 * correction is clamped to cfg.maxPushVelocity so deep overlaps separate
 * gently instead of exploding.
 *
 * Friction. Coulomb, solved after the normal impulses each iteration, with
 * the cone set by the point's current normal impulse. A point uses the static
 * coefficient muS while it sticks (|vt| at the start of the step under
 * STICK_SPEED) and the kinetic coefficient muK while it slides. So a crate
 * breaks loose when the pull exceeds muS·N and then needs only muK·N to keep
 * going, which is the behaviour the game teaches. Fixtures may carry muS /
 * muK; both fall back to `friction`. Pairs mix by geometric mean.
 *
 * Rolling resistance (Box2D 3.1). A fixture's dimensionless
 * `rollingResistance` c gives a resisting couple of at most c·r·N on the
 * relative spin of the two bodies, r being the larger rounded radius (circle
 * radius). In textbook terms the lever arm a = c·r, so a wheel of weight W
 * needs a horizontal push P ≈ W·a/r = c·W to keep rolling.
 *
 * Conveyor belts. A fixture's `tangentSpeed` (m/s) moves its surface along
 * rightPerp(outward normal), i.e. to +x along the top face of a level belt.
 * Friction drives the relative tangential velocity at the point to the sum
 * of both surfaces' speeds instead of to zero.
 *
 * Restitution is applied once after the substeps, using the relative normal
 * velocity measured before the step, and only to points that approached
 * faster than cfg.restitutionThreshold and actually pushed this step.
 *
 * Results for gauges, set at the end of every step:
 *   ct.normalForce    sum of point normal forces, N (impulse / h, last substep)
 *   ct.frictionForce  sum of point friction forces, N (signed along ct.tangent)
 *   ct.rollingTorque  rolling-resistance couple, N·m
 *   cp.totalNormalImpulse  N·s summed over the whole step (all substeps)
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var softness = P.softness;

  // Below this tangential speed (m/s) a point counts as sticking: static μ.
  var STICK_SPEED = 0.01;

  function fixtureMuS(f) { return f.muS != null ? f.muS : f.friction; }
  function fixtureMuK(f) { return f.muK != null ? f.muK : f.friction; }
  function shapeRadius(s) { return s.type === 'circle' ? s.radius : (s.radius || 0); }

  /* ------------------------------------------------------------- prepare */
  function prepareContact(ct, h, cfg) {
    var A = ct.fa.body, B = ct.fb.body, n = ct.manifold.normal;
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var nx = n.x, ny = n.y, tx = ny, ty = -nx;           // tangent = rightPerp(n)
    ct.normal = n; ct.tangent = M.v(tx, ty);

    ct.muS = P.mixFriction(fixtureMuS(ct.fa), fixtureMuS(ct.fb));
    ct.muK = P.mixFriction(fixtureMuK(ct.fa), fixtureMuK(ct.fb));
    ct.friction = ct.muK;                                 // kept for older callers
    ct.restitution = P.mixRestitution(ct.fa.restitution, ct.fb.restitution);
    ct.tangentSpeed = (ct.fa.tangentSpeed || 0) + (ct.fb.tangentSpeed || 0);
    var rr = Math.max(ct.fa.rollingResistance || 0, ct.fb.rollingResistance || 0);
    ct.rollingResistance = rr * Math.max(shapeRadius(ct.fa.shape), shapeRadius(ct.fb.shape));
    var kR = iA + iB;
    ct.rollingMass = kR > 0 ? 1 / kR : 0;
    if (ct.rollingImpulse == null) ct.rollingImpulse = 0;

    // Contact stiffness: capped at a quarter of the substep rate, doubled
    // against bodies that cannot move (see header).
    var hertz = Math.min(cfg.contactHertz, 0.25 / h);
    if (mA === 0 || mB === 0) hertz = Math.min(2 * hertz, 0.25 / h);
    ct.soft = softness(hertz, cfg.contactDampingRatio, h);

    var pts = ct.points;
    for (var i = 0; i < pts.length; i++) {
      var cp = pts[i];
      var rAx = cp.point.x - A.c.x, rAy = cp.point.y - A.c.y;
      var rBx = cp.point.x - B.c.x, rBy = cp.point.y - B.c.y;
      cp.rA = M.v(rAx, rAy); cp.rB = M.v(rBx, rBy);
      cp.adjustedSeparation = cp.separation - ((rBx - rAx) * nx + (rBy - rAy) * ny);

      var rnA = rAx * ny - rAy * nx, rnB = rBx * ny - rBy * nx;
      var kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      cp.normalMass = kN > 0 ? 1 / kN : 0;
      var rtA = rAx * ty - rAy * tx, rtB = rBx * ty - rBy * tx;
      var kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
      cp.tangentMass = kT > 0 ? 1 / kT : 0;

      // relative velocity at the point before the step: drives restitution
      // and decides whether the point starts the step sticking or sliding
      var dvx = (B.v.x - B.w * rBy) - (A.v.x - A.w * rAy);
      var dvy = (B.v.y + B.w * rBx) - (A.v.y + A.w * rAx);
      cp.relativeVelocity = dvx * nx + dvy * ny;
      var vt = dvx * tx + dvy * ty - ct.tangentSpeed;
      cp.sliding = Math.abs(vt) > STICK_SPEED;
      cp.maxNormalImpulse = 0;
      cp.totalNormalImpulse = 0;
      if (cp.normalImpulse == null) cp.normalImpulse = 0;
      if (cp.tangentImpulse == null) cp.tangentImpulse = 0;
    }
  }

  // A beam or truss solver (structures.js) took this contact over this step.
  function claimed(ct) {
    var w = ct.structureSolver && ct.fa.body.world;
    return !!w && ct.structureStep === w.stepCount;
  }

  /* ----------------------------------------------------------- warm start */
  function warmStartContact(ct) {
    if (claimed(ct)) return;               // solved with its beam or truss (structures.js)
    var A = ct.fa.body, B = ct.fb.body, n = ct.normal, t = ct.tangent;
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var vAx = A.v.x, vAy = A.v.y, wA = A.w, vBx = B.v.x, vBy = B.v.y, wB = B.w;
    var pts = ct.points;
    for (var i = 0; i < pts.length; i++) {
      var cp = pts[i], rA = cp.rA, rB = cp.rB;
      var px = cp.normalImpulse * n.x + cp.tangentImpulse * t.x;
      var py = cp.normalImpulse * n.y + cp.tangentImpulse * t.y;
      vAx -= mA * px; vAy -= mA * py; wA -= iA * (rA.x * py - rA.y * px);
      vBx += mB * px; vBy += mB * py; wB += iB * (rB.x * py - rB.y * px);
    }
    wA -= iA * ct.rollingImpulse; wB += iB * ct.rollingImpulse;
    store(A, vAx, vAy, wA); store(B, vBx, vBy, wB);
  }

  // Write velocities back without disturbing bodies that cannot move.
  function store(b, vx, vy, w) {
    if (b.invM === 0 && b.invI === 0) return;
    b.v = M.v(vx, vy); b.w = w;
  }

  /* ---------------------------------------------------------------- solve */
  function solveContact(ct, invH, useBias, cfg) {
    if (claimed(ct)) return 0;             // solved with its beam or truss (structures.js)
    var A = ct.fa.body, B = ct.fb.body, n = ct.normal, nx = n.x, ny = n.y, tx = ct.tangent.x, ty = ct.tangent.y;
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var vAx = A.v.x, vAy = A.v.y, wA = A.w, vBx = B.v.x, vBy = B.v.y, wB = B.w;
    // centre displacement since the start of the step and the rotation change
    var dcAx = A.c.x - A.c0.x, dcAy = A.c.y - A.c0.y, dcBx = B.c.x - B.c0.x, dcBy = B.c.y - B.c0.y;
    var daA = A.angle - A.angle0, daB = B.angle - B.angle0;
    var cA = Math.cos(daA), sA = Math.sin(daA), cB = Math.cos(daB), sB = Math.sin(daB);
    var soft = ct.soft, pts = ct.points, count = pts.length, total = 0, i, cp, rA, rB;
    var maxPush = cfg.maxPushVelocity;

    // normal constraints first, so friction sees this iteration's normal impulse
    for (i = 0; i < count; i++) {
      cp = pts[i]; rA = cp.rA; rB = cp.rB;
      // current anchor positions relative to the old centres: dc + R(dθ) r
      var dAx = dcAx + cA * rA.x - sA * rA.y, dAy = dcAy + sA * rA.x + cA * rA.y;
      var dBx = dcBx + cB * rB.x - sB * rB.y, dBy = dcBy + sB * rB.x + cB * rB.y;
      var s = (dBx - dAx) * nx + (dBy - dAy) * ny + cp.adjustedSeparation;

      var bias = 0, massScale = 1, impulseScale = 0;
      if (s > 0) bias = s * invH;                       // speculative: close the gap, no further
      else if (useBias) {
        bias = Math.max(soft.biasRate * s, -maxPush);
        massScale = soft.massScale; impulseScale = soft.impulseScale;
      }
      var dvx = (vBx - wB * rB.y) - (vAx - wA * rA.y);
      var dvy = (vBy + wB * rB.x) - (vAy + wA * rA.x);
      var vn = dvx * nx + dvy * ny;
      var imp = -cp.normalMass * massScale * (vn + bias) - impulseScale * cp.normalImpulse;
      var next = Math.max(cp.normalImpulse + imp, 0);
      imp = next - cp.normalImpulse; cp.normalImpulse = next;
      if (imp > cp.maxNormalImpulse) cp.maxNormalImpulse = imp;
      cp.totalNormalImpulse += imp > 0 ? imp : 0;
      total += next;
      var px = imp * nx, py = imp * ny;
      vAx -= mA * px; vAy -= mA * py; wA -= iA * (rA.x * py - rA.y * px);
      vBx += mB * px; vBy += mB * py; wB += iB * (rB.x * py - rB.y * px);
    }

    // friction: Coulomb cone on each point's own normal impulse
    var tSpeed = ct.tangentSpeed;
    for (i = 0; i < count; i++) {
      cp = pts[i]; rA = cp.rA; rB = cp.rB;
      var dtx = (vBx - wB * rB.y) - (vAx - wA * rA.y);
      var dty = (vBy + wB * rB.x) - (vAy + wA * rA.x);
      var vt = dtx * tx + dty * ty - tSpeed;
      var mu = cp.sliding ? ct.muK : ct.muS;
      var maxF = mu * cp.normalImpulse;
      var timp = -cp.tangentMass * vt;
      var tnext = M.clamp(cp.tangentImpulse + timp, -maxF, maxF);
      timp = tnext - cp.tangentImpulse; cp.tangentImpulse = tnext;
      var qx = timp * tx, qy = timp * ty;
      vAx -= mA * qx; vAy -= mA * qy; wA -= iA * (rA.x * qy - rA.y * qx);
      vBx += mB * qx; vBy += mB * qy; wB += iB * (rB.x * qy - rB.y * qx);
    }

    // rolling resistance: a couple on the relative spin, capped at c·r·N
    if (ct.rollingResistance > 0 && ct.rollingMass > 0) {
      var maxR = ct.rollingResistance * total;
      var rimp = -ct.rollingMass * (wB - wA);
      var rnext = M.clamp(ct.rollingImpulse + rimp, -maxR, maxR);
      rimp = rnext - ct.rollingImpulse; ct.rollingImpulse = rnext;
      wA -= iA * rimp; wB += iB * rimp;
    }

    store(A, vAx, vAy, wA); store(B, vBx, vBy, wB);
    return total;
  }

  /* ---------------------------------------------------------- restitution */
  function restituteContact(ct, cfg) {
    // gauges first: forces from the last substep, before any bounce impulse
    recordForces(ct, ct.h);
    if (ct.restitution === 0) return;
    var A = ct.fa.body, B = ct.fb.body, n = ct.normal, nx = n.x, ny = n.y;
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    var vAx = A.v.x, vAy = A.v.y, wA = A.w, vBx = B.v.x, vBy = B.v.y, wB = B.w;
    var pts = ct.points, any = false;
    // A face contact has two points solved one after the other, so one pass
    // leaves them with unequal bounce speeds and spins the bodies. A few
    // passes converge both to -e·v (the clamp at zero keeps it from ever
    // pulling, so this can only remove energy, never add it).
    for (var pass = 0; pass < (pts.length > 1 ? 6 : 1); pass++)
    for (var i = 0; i < pts.length; i++) {
      var cp = pts[i], rA = cp.rA, rB = cp.rB;
      if (cp.relativeVelocity > -cfg.restitutionThreshold || cp.maxNormalImpulse === 0) continue;
      var dvx = (vBx - wB * rB.y) - (vAx - wA * rA.y);
      var dvy = (vBy + wB * rB.x) - (vAy + wA * rA.x);
      var vn = dvx * nx + dvy * ny;
      var imp = -cp.normalMass * (vn + ct.restitution * cp.relativeVelocity);
      var next = Math.max(cp.normalImpulse + imp, 0);
      imp = next - cp.normalImpulse; cp.normalImpulse = next;
      if (imp > cp.maxNormalImpulse) cp.maxNormalImpulse = imp;
      cp.totalNormalImpulse += imp > 0 ? imp : 0;
      var px = imp * nx, py = imp * ny;
      vAx -= mA * px; vAy -= mA * py; wA -= iA * (rA.x * py - rA.y * px);
      vBx += mB * px; vBy += mB * py; wB += iB * (rB.x * py - rB.y * px);
      any = true;
    }
    if (any) { store(A, vAx, vAy, wA); store(B, vBx, vBy, wB); }
  }

  /* --------------------------------------------------------------- gauges */
  function recordForces(ct, h) {
    var invH = h > 0 ? 1 / h : 0, fn = 0, ft = 0, pts = ct.points;
    for (var i = 0; i < pts.length; i++) { fn += pts[i].normalImpulse; ft += pts[i].tangentImpulse; }
    ct.normalForce = fn * invH;
    ct.frictionForce = ft * invH;
    ct.rollingTorque = (ct.rollingImpulse || 0) * invH;
  }

  // Per-point forces in N for a substep h (world.substeps / dt):
  // [{ point, normal (N, >= 0), tangent (N, signed along ct.tangent), force {x, y} on body B }]
  function pointForces(ct, h) {
    h = h || ct.h;
    var invH = h > 0 ? 1 / h : 0, n = ct.normal || ct.manifold.normal, t = ct.tangent || M.rightPerp(n);
    return ct.points.map(function (cp) {
      var fn = cp.normalImpulse * invH, ft = cp.tangentImpulse * invH;
      return { point: cp.point, normal: fn, tangent: ft, force: M.v(fn * n.x + ft * t.x, fn * n.y + ft * t.y) };
    });
  }

  function prepareWithStep(ct, h, cfg) { ct.h = h; prepareContact(ct, h, cfg); }

  /* ----------------------------------------------------------- continuous */
  // Speculative points only exist for pairs that start the step within
  // SPECULATIVE of each other, so a body that moves further than that in one
  // step can jump a thin wall. After the substeps, every dynamic body that
  // moved more than half its smallest extent (Box2D 3's "fast body" test)
  // plus the speculative margin is swept from its start pose to its end pose against every shape it may
  // collide with, static or dynamic (those at their end pose). If the sweep
  // hits and the end pose is too deep for a contact to resolve (see the
  // depth test below), the body is moved back to the time of impact,
  // LINEAR_SLOP short of the surface, and keeps its velocity: next step that gap is a speculative
  // contact, which stops it at the surface (and restitution bounces it).
  // Time of impact is found by conservative advancement on the GJK distance:
  // the closing speed along the separating normal is bounded by
  // dot(Δc, n) + |Δθ|·rMax, so stepping t by (d - target) / bound never
  // overshoots.
  // A pair that already starts within SPECULATIVE is skipped: it has a
  // speculative contact, and sweeping it would stall a fast body that slides
  // along the floor.

  function shapeExtents(shape, lc) {
    // min: smallest distance from the shape's centroid to its surface;
    // max: largest distance from the body centre to the surface
    var r = shape.radius || 0, pts, i, mn = Infinity, mx = 0, ce;
    if (shape.type === 'circle') { pts = [shape.center]; mn = r; ce = shape.center; }
    else if (shape.type === 'capsule') { pts = [shape.center1, shape.center2]; mn = r; }
    else if (shape.type === 'polygon') {
      pts = shape.vertices; ce = shape.centroid || pts[0];
      for (i = 0; i < shape.count; i++) mn = Math.min(mn, M.dot(shape.normals[i], M.sub(pts[i], ce)) + r);
    } else { pts = [shape.point1, shape.point2]; mn = r; }
    for (i = 0; i < pts.length; i++) mx = Math.max(mx, M.dist(pts[i], lc) + r);
    return { min: mn, max: mx };
  }

  function bodyExtents(b) {
    if (b._ccd && b._ccd.n === b.fixtures.length && b._ccd.lc === b.localCenter) return b._ccd;
    var mn = Infinity, mx = 0;
    b.fixtures.forEach(function (f) {
      if (f.sensor) return;
      var e = shapeExtents(f.shape, b.localCenter);
      mn = Math.min(mn, e.min); mx = Math.max(mx, e.max);
    });
    if (!isFinite(mn)) mn = 0;
    b._ccd = { n: b.fixtures.length, lc: b.localCenter, min: Math.max(mn, P.LINEAR_SLOP), max: mx };
    return b._ccd;
  }

  function poseAt(b, t) {
    var a = b.angle0 + t * (b.angle - b.angle0), q = M.rot(a);
    var c = M.lerp(b.c0, b.c, t);
    return { p: M.sub(c, M.rotate(q, b.localCenter)), q: q };
  }

  // Fraction of the sweep at which shape (on body b) first comes within
  // `target` of shapeB at xfB; 1 if never, 0 if it starts that close.
  var toiNormal = null;                                  // separating normal at the last hit
  function timeOfImpact(b, shape, shapeB, xfB, target, rMax) {
    toiNormal = null;
    var dc = M.sub(b.c, b.c0), dA = Math.abs(b.angle - b.angle0), t = 0;
    for (var iter = 0; iter < 64; iter++) {
      var d = P.query.shapeDistance(shape, poseAt(b, t), shapeB, xfB);
      if (d.distance <= target + 0.25 * P.LINEAR_SLOP) return t;
      toiNormal = d.normal;
      var bound = M.dot(dc, d.normal) + dA * rMax;
      if (bound <= 1e-9) return 1;                       // separating for the rest of the sweep
      t += (d.distance - target) / bound;
      if (t >= 1) return 1;
    }
    return t;
  }

  // Extent of a shape along direction n.
  function thickness(shape, xf, n) {
    var core = P.shapeCore(shape, xf), lo = Infinity, hi = -Infinity;
    for (var i = 0; i < core.count; i++) { var d = M.dot(core.v[i], n); if (d < lo) lo = d; if (d > hi) hi = d; }
    return hi - lo + 2 * (core.radius || 0);
  }

  // Fixtures whose boxes may overlap lo..hi. Uses the broadphase trees when
  // they exist: static boxes are exact; dynamic boxes were fattened at the
  // start of the step, so the query is grown by the furthest any body moved.
  function candidates(world, lo, hi, reach) {
    var st = world._bp;
    if (!st || !st.dyn || !st.stat) return P.query.boxQuery(world, lo, hi);
    var out = [];
    var add = function (px) { out.push(px.fixture); };
    st.stat.query(lo.x, lo.y, hi.x, hi.y, add);
    st.dyn.query(lo.x - reach, lo.y - reach, hi.x + reach, hi.y + reach, add);
    return out;
  }

  function continuous(world, bodies) {
    var slop = P.LINEAR_SLOP, spec = P.SPECULATIVE, bp = P.broadphase, reach = 0, i;
    for (i = 0; i < bodies.length; i++) {
      if (bodies[i].c0) reach = Math.max(reach, M.dist(bodies[i].c, bodies[i].c0) + Math.abs(bodies[i].angle - bodies[i].angle0) * bodyExtents(bodies[i]).max);
    }
    for (i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.type !== 'dynamic' || b.awake === false || !b.c0) continue;
      var ext = bodyExtents(b);
      var travel = M.dist(b.c, b.c0) + Math.abs(b.angle - b.angle0) * ext.max;
      // the speculative margin already covers the first SPECULATIVE metres
      if (travel < 0.5 * ext.min + spec) continue;

      // swept box: start and end boxes of the body
      var t0 = poseAt(b, 0), t1 = b.transform();
      var lo = M.v(Infinity, Infinity), hi = M.v(-Infinity, -Infinity);
      b.fixtures.forEach(function (f) {
        if (f.sensor) return;
        [P.aabb(f.shape, t0), P.aabb(f.shape, t1)].forEach(function (bb) {
          lo.x = Math.min(lo.x, bb.lo.x); lo.y = Math.min(lo.y, bb.lo.y);
          hi.x = Math.max(hi.x, bb.hi.x); hi.y = Math.max(hi.y, bb.hi.y);
        });
      });
      var others = candidates(world, lo, hi, reach);
      var best = 1;
      for (var k = 0; k < others.length; k++) {
        var fo = others[k], o = fo.body;
        if (o === b || fo.sensor) continue;
        var xfO = o.transform(), ob = P.aabb(fo.shape, xfO);
        if (ob.lo.x > hi.x || ob.hi.x < lo.x || ob.lo.y > hi.y || ob.hi.y < lo.y) continue;
        for (var j = 0; j < b.fixtures.length; j++) {
          var f = b.fixtures[j];
          if (f.sensor || (bp && bp.shouldCollide && !bp.shouldCollide(world, f, fo))) continue;
          // already close at the start: the speculative contact has it
          if (P.query.shapeDistance(f.shape, t0, fo.shape, xfO).distance < spec) continue;
          var t = timeOfImpact(b, f.shape, fo.shape, xfO, slop, ext.max);
          if (t >= best || !toiNormal) continue;
          // Only rewind when the end pose is past the point the next step's
          // contact could resolve: penetration along n beyond a quarter of
          // the two shapes' combined depth (half is where the narrowphase
          // would push out the far side). A body landing on thick ground is
          // left to the contact; moving a jointed body back would tear its
          // joints apart for a frame.
          var depth = M.dot(M.sub(b.c, M.lerp(b.c0, b.c, t)), toiNormal);
          if (depth > 0.25 * (thickness(f.shape, t1, toiNormal) + thickness(fo.shape, xfO, toiNormal))) best = t;
        }
      }
      if (best < 1) {
        var c = M.lerp(b.c0, b.c, best), a = b.angle0 + best * (b.angle - b.angle0);
        b.c = c; b.angle = a; b.q = M.rot(a);
        b.toiCount = (b.toiCount || 0) + 1;
      }
    }
  }

  P.contactSolver = {
    prepare: prepareWithStep, warmStart: warmStartContact, solve: solveContact,
    restitute: restituteContact, pointForces: pointForces, continuous: continuous,
    timeOfImpact: timeOfImpact, STICK_SPEED: STICK_SPEED
  };
})(globalThis.SE);
