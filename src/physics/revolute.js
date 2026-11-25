/*
 * RevoluteJoint: a pin. The two anchors stay together; rotation is free
 * unless a limit, motor or rotational spring is switched on.
 *
 *   new SE.phys.RevoluteJoint({
 *     bodyA, bodyB, worldAnchor | localAnchorA/B, referenceAngle,
 *     enableLimit, lowerAngle, upperAngle,          // rad, relative to referenceAngle
 *     enableMotor, motorSpeed (rad/s), maxMotorTorque (N·m),
 *     stiffness (N·m/rad), damping (N·m·s/rad), springAngle (rad, rest angle),
 *     breakForce (N), breakTorque (N·m)
 *   })
 *
 * The joint angle is angle() = (angle B − angle A) − referenceAngle, so a new
 * pin reads 0 and positive is counter-clockwise rotation of B relative to A.
 *
 * Solve order per substep (as in Box2D 3's revolute joint):
 *   1. spring   implicit spring-damper on the joint angle; it acts in the
 *               relax pass too, because it is a physical spring, not error
 *               correction
 *   2. motor    drives the relative angular speed toward motorSpeed with an
 *               accumulated impulse clamped to ±maxMotorTorque·h
 *   3. limits   one-sided constraints at the lower and upper angle. When the
 *               limit is still open the bias is C/h (speculative: the joint
 *               may close the gap this substep but not overshoot); once it
 *               is violated it is pushed back softly like any joint
 *   4. point    2×2 soft constraint that keeps the anchors together
 *
 * Readouts, all in SI:
 *   force()      magnitude of the pin force, N
 *   torque()     torque the joint applies to B about the pin: spring + motor
 *                + limits, N·m (what breakTorque is compared with)
 *   reaction()   { force: {x, y} on body B, torque }
 *   motorTorque(), springTorque(), limitTorque(), angle(), angularSpeed()
 *
 * This file also holds the helpers the other rigid joints (weld.js,
 * prismatic.js) share, because it loads first: P.springDelta (implicit
 * spring rows), P.pointK / P.solve2 (2×2 point constraint) and
 * P.jointBlock, the direct solve for groups of connected joints.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  /*
   * Implicit (backward Euler) spring-damper impulse for one scalar row.
   * A spring F = −k C − c Ċ over a substep h, solved so that the velocity
   * after the impulse is used for the damping and the position update:
   *   λ = −h (k (C + h Ċ⁺) + c Ċ⁺),  Ċ⁺ = Ċ₀ + K λ
   * With warm starting, accumulated impulse λ_acc and current Ċ (which
   * already contains λ_acc), the increment is
   *   Δ = −(G Ċ + h k C + λ_acc) / (1 + G K),   G = h (h k + c)
   * In equilibrium λ = −h k C exactly, so a static spring reads k·C no matter
   * what masses it joins (the soft-constraint "hertz" form only gets this
   * right when the effective mass is the one the hertz was computed for).
   * K is the inverse effective mass of the row.
   */
  function springDelta(k, c, h, C, Cdot, K, acc) {
    var G = h * (h * k + c);
    return -(G * Cdot + h * k * C + acc) / (1 + G * K);
  }
  P.springDelta = springDelta;

  // Inverse effective mass matrix of a point-to-point constraint, returned as
  // its three distinct entries; solve2 applies K⁻¹ to a vector.
  function pointK(A, B, rA, rB) {
    var mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    return {
      k11: mA + mB + rA.y * rA.y * iA + rB.y * rB.y * iB,
      k12: -rA.y * rA.x * iA - rB.y * rB.x * iB,
      k22: mA + mB + rA.x * rA.x * iA + rB.x * rB.x * iB
    };
  }
  function solve2(K, bx, by) {
    var det = K.k11 * K.k22 - K.k12 * K.k12; if (det !== 0) det = 1 / det;
    return { x: det * (K.k22 * bx - K.k12 * by), y: det * (K.k11 * by - K.k12 * bx) };
  }
  P.pointK = pointK;
  P.solve2 = solve2;

  /*
   * Caps on how fast a joint may push its error closed. Position correction
   * asks for a speed biasRate·C; when a long lever on a light body opens a
   * joint by centimetres, that speed spins the body so fast that the
   * linearised constraint is wrong by the next substep, the error grows, and
   * the build explodes. Capping the push (as contacts cap theirs with
   * maxPushVelocity) keeps every correction small enough to stay linear;
   * a big error then closes over a few frames instead of in one substep.
   */
  P.MAX_JOINT_PUSH = 3;   // m/s
  P.MAX_JOINT_TURN = 3;   // rad/s
  function capBias(v, max) { return v > max ? max : (v < -max ? -max : v); }
  // Scale the vector (bx, by) down to length max; returns the factor.
  function capBias2(bx, by, max) { var l = Math.sqrt(bx * bx + by * by); return l > max ? max / l : 1; }
  P.capBias = capBias;
  P.capBias2 = capBias2;

  /*
   * Joint blocks: a direct solve for chains and frames of rigid joints.
   *
   * One Gauss-Seidel pass per substep cannot carry a load down a chain of
   * light bodies: each soft joint behaves like a spring of stiffness
   * m_eff·ω², with m_eff the effective mass of just the two bodies it joins,
   * so a 20-segment welded beam folds under its own weight and a pinned chain
   * stretches by centimetres. Instead, the rigid rows (pin points, weld
   * angles, slider perpendiculars) of every group of joints that share
   * dynamic bodies are solved together:
   *   Δλ = −ms · A⁻¹ (Ċ + biasRate · C) − is · λ      (A = J M⁻¹ Jᵀ)
   * which is the engine's soft constraint with the effective mass of the
   * whole group instead of one pair, and Δλ = −A⁻¹ Ċ in the relax pass.
   *
   * Pin points also get a turning correction. Positions are integrated in a
   * straight line (c += v h, angle += w h), so an anchor on a spinning body
   * ends each substep off the line its velocity pointed along, by
   * R(w h) r − r − w h (ẑ × r) ≈ −½ (w h)² r: the centripetal part. A
   * velocity-only solve lets that open the pin every substep and the relax
   * pass then throws the radial velocity away, which bleeds energy from
   * anything that swings fast (a 4-link chain lost 20% in 10 s). Both passes
   * therefore aim for Ċ = −drift / h, the chord the anchors really travel,
   * so the pin stays closed to second order and the swing keeps its energy.
   * The correction is capped at DRIFT_CAP: on a light part spinning on a
   * long lever it grows with w², and uncapped it fed its own spin.
   *
   * Groups and their row ordering (reverse Cuthill-McKee, so a chain costs
   * O(n) and a truss stays banded) are kept while the joints don't change.
   * A is factored (LDLᵀ in that envelope) again only when some body in the
   * group has turned by more than BLOCK_REFACTOR_ANGLE since the last
   * factor (less, in proportion, when the group is ill-conditioned), checked
   * every pass. Redundant rows (closed loops, two pins on one pair) show up
   * as pivots below PIVOT_TOL and are left to the other rows. Springs,
   * motors and limits stay in each joint's own solve.
   *
   * Safety: each solve checks that it reduced the rows' error. If not (a
   * near-singular or stale factor), it takes its impulses back, refactors
   * and tries once more; if that fails too the group falls back to each
   * joint solving on its own until it is rebuilt. And see the energy guard
   * below, which stops jammed builds from pumping energy in.
   *
   * A joint takes part by implementing
   *   blockSlots()       -> array of its rigid row ids this step (may be empty)
   *   blockRow(slot, r)  fill r.ja/r.jb ([x, y, angular] Jacobians for A, B),
   *                      r.C (position error) and optionally r.drift (m, the
   *                      turning drift above) from the current state
   *   blockImpulse(slot) / blockAdd(slot, d)   its accumulated row impulse
   * and, in solve(), skipping its rigid rows when this.block is set and
   * calling P.jointBlock.solve(this.block, h, useBias) when this.blockLeader.
   * Set world.jointBlockSolve = false to fall back to plain Gauss-Seidel.
   *
   * Any joint type can contribute rows (DistanceJoint rods, for example):
   *   - in prepare(), call P.jointBlock.prepare(this) after setting jointSoft
   *   - implement blockSlots / blockRow / blockImpulse / blockAdd as above,
   *     and blockSolveOwn(h, useBias), which solves those same rows alone
   *     (used when the group cannot be factored)
   *   - in solve(), skip the rows when this.block is set, and call
   *     P.jointBlock.solve(this.block, h, useBias) if this.blockLeader
   *   - in postStep(dt), call P.jointBlock.guard(this.block, dt) if
   *     this.blockLeader; optional storedEnergy() (J) for springs and
   *     driveWork(dt) (J) for motors keep the guard from fighting them
   * Rows must be equalities: a one-sided row (a rope) can join only while it
   * is taut, and should leave the group when it goes slack.
   */
  var PIVOT_TOL = 1e-6;               // pivot / diagonal below this: the row depends on the others
  var DRIFT_CAP = 1;                  // m/s: most the turning correction may ask for
  var BLOCK_MAX_ENVELOPE = 400000;     // matrix entries; past this, Gauss-Seidel
  var BLOCK_REFACTOR_ANGLE = 0.001;    // rad a body may turn before A is refactored

  function isMoving(b) { return b.type !== 'static' && b.awake !== false; }
  function isDynamic(b) { return b.invM > 0 || b.invI > 0; }

  // Called from each block-capable joint's prepare(); builds the groups once
  // per step for the whole world.
  function blockPrepare(joint) {
    joint.block = null; joint.blockLeader = false;
    var world = joint.bodyA.world || joint.bodyB.world;
    if (!world || world.jointBlockSolve === false) return;
    if (world._blockStep !== world.stepCount || world._blockTime !== world.time) buildBlocks(world);
    var blk = world._blockOf && world._blockOf.get(joint);
    if (blk) { joint.block = blk; joint.blockLeader = blk.joints[0] === joint; }
  }

  // Groups (and their row ordering and factor) are kept from step to step
  // while the set of joints and their rigid rows stays the same.
  function buildBlocks(world) {
    world._blockStep = world.stepCount; world._blockTime = world.time;
    var sig = [];
    world.joints.forEach(function (j) {
      if (!j.blockSlots || j.broken) return;
      if (!(isMoving(j.bodyA) || isMoving(j.bodyB))) return;
      if (!isDynamic(j.bodyA) && !isDynamic(j.bodyB)) return;
      sig.push(j.id + ':' + j.blockSlots().length);
    });
    sig = sig.join(',');
    if (world._blockOf && world._blockSig === sig) return;
    world._blockSig = sig;
    var of = world._blockOf = new Map();
    var parent = new Map();
    function find(b) { var p = parent.get(b); if (p === b) return b; var r = find(p); parent.set(b, r); return r; }
    function key(b) { if (!parent.has(b)) parent.set(b, b); return b; }
    var members = [];
    world.joints.forEach(function (j) {
      if (!j.blockSlots || j.broken) return;
      var A = j.bodyA, B = j.bodyB;
      if (!(isMoving(A) || isMoving(B))) return;
      var dA = isDynamic(A), dB = isDynamic(B);
      if (!dA && !dB) return;
      members.push(j);
      if (dA) key(A);
      if (dB) key(B);
      if (dA && dB) { var ra = find(A), rb = find(B); if (ra !== rb) parent.set(ra, rb); }
    });
    var groups = new Map();
    members.forEach(function (j) {
      var root = find(isDynamic(j.bodyA) ? j.bodyA : j.bodyB);
      var g = groups.get(root); if (!g) { g = { joints: [], step: -1 }; groups.set(root, g); }
      g.joints.push(j);
    });
    groups.forEach(function (g) { g.joints.forEach(function (j) { of.set(j, g); }); });
  }

  // Builds the group's rows and orders them. Runs on the group's first
  // solve, after every member has prepared and warm-started.
  function factor(blk) {
    var rows = [];
    blk.joints.forEach(function (j) {
      j.blockSlots().forEach(function (slot) {
        rows.push({ joint: j, slot: slot, A: j.bodyA, B: j.bodyB, ja: [0, 0, 0], jb: [0, 0, 0], C: 0, drift: 0 });
      });
    });
    var n = rows.length;
    blk.rows = rows; blk.ok = n > 0;
    if (!n) return;
    // row adjacency through shared dynamic bodies
    var byBody = new Map();
    rows.forEach(function (r, i) {
      [r.A, r.B].forEach(function (b) {
        if (!isDynamic(b)) return;
        var l = byBody.get(b); if (!l) { l = []; byBody.set(b, l); } l.push(i);
      });
    });
    var adj = rows.map(function () { return []; });
    byBody.forEach(function (l) {
      for (var a = 0; a < l.length; a++) for (var b = 0; b < l.length; b++) if (a !== b) adj[l[a]].push(l[b]);
    });
    // reverse Cuthill-McKee ordering, component by component
    var seen = new Uint8Array(n), order = [];
    var byDeg = rows.map(function (r, i) { return i; }).sort(function (a, b) { return adj[a].length - adj[b].length; });
    byDeg.forEach(function (s) {
      if (seen[s]) return;
      seen[s] = 1; var q = [s];
      for (var h = 0; h < q.length; h++) {
        var nb = adj[q[h]].filter(function (x) { return !seen[x]; });
        nb.sort(function (a, b) { return adj[a].length - adj[b].length; });
        nb.forEach(function (x) { if (!seen[x]) { seen[x] = 1; q.push(x); } });
      }
      order = order.concat(q);
    });
    order.reverse();
    var pos = new Int32Array(n); order.forEach(function (r, k) { pos[r] = k; });
    var first = new Int32Array(n), size = 0;
    for (var k = 0; k < n; k++) {
      var f = k; adj[order[k]].forEach(function (x) { if (pos[x] < f) f = pos[x]; });
      first[k] = f; size += k - f + 1;
    }
    if (size > BLOCK_MAX_ENVELOPE) { blk.ok = false; return; }
    blk.order = order; blk.first = first;
    blk.env = []; for (k = 0; k < n; k++) blk.env.push(new Float64Array(k - first[k] + 1));
    blk.dinv = new Float64Array(n); blk.diag0 = new Float64Array(n);
    blk.rhs = new Float64Array(n); blk.lam = new Float64Array(n);
    var bodies = [];
    byBody.forEach(function (l, b) { bodies.push(b); });
    blk.bodies = bodies; blk.ang0 = new Float64Array(bodies.length);
    blk.invM0 = new Float64Array(bodies.length); blk.invI0 = new Float64Array(bodies.length);
    blk.factored = false;
  }

  // A = J M⁻¹ Jᵀ only changes when a body turns (lever arms rotate) or its
  // mass changes, so a frame or a resting beam keeps its factor. Anything
  // turning faster than BLOCK_REFACTOR_ANGLE per substep refactors every
  // substep; a stale factor would make the solve diverge.
  function needsRefactor(blk) {
    if (!blk.factored) return true;
    var bs = blk.bodies;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (Math.abs(b.angle - blk.ang0[i]) > blk.turnTol || b.invM !== blk.invM0[i] || b.invI !== blk.invI0[i]) return true;
    }
    return false;
  }

  // Numeric LDLᵀ of A = J M⁻¹ Jᵀ for the current geometry. Run at the start
  // of every substep: within a step a fast-swinging chain turns far enough
  // that a factor from the step start no longer converges.
  function refactor(blk) {
    blk.factored = true; blk.factoredAt = blk.passes;
    blk.bodies.forEach(function (b, i) { blk.ang0[i] = b.angle; blk.invM0[i] = b.invM; blk.invI0[i] = b.invI; });
    var rows = blk.rows, order = blk.order, first = blk.first, env = blk.env;
    var dinv = blk.dinv, diag0 = blk.diag0, n = rows.length, k, c, kk, worst = 1;
    for (k = 0; k < n; k++) { var r = rows[order[k]]; r.joint.blockRow(r.slot, r); }
    for (k = 0; k < n; k++) {
      var ri = rows[order[k]], e = env[k];
      for (c = first[k]; c <= k; c++) e[c - first[k]] = entry(ri, rows[order[c]]);
      diag0[k] = e[k - first[k]];
    }
    // L stored below the diagonal, D on it
    for (var i = 0; i < n; i++) {
      var ei = env[i], fi = first[i];
      for (var jj = fi; jj < i; jj++) {
        var ej = env[jj], fj = first[jj], s = ei[jj - fi];
        for (kk = Math.max(fi, fj); kk < jj; kk++) s -= ei[kk - fi] * ej[kk - fj] * env[kk][kk - first[kk]];
        ei[jj - fi] = dinv[jj] ? s * dinv[jj] : 0;
      }
      var d = ei[i - fi];
      for (kk = fi; kk < i; kk++) d -= ei[kk - fi] * ei[kk - fi] * env[kk][kk - first[kk]];
      if (d > PIVOT_TOL * diag0[i] && d > 0) { ei[i - fi] = d; dinv[i] = 1 / d; worst = Math.max(worst, diag0[i] / d); }
      else { ei[i - fi] = 0; dinv[i] = 0; }          // dependent row
    }
    // An ill-conditioned group (a light part on long levers between heavy
    // ones) amplifies any change in geometry, so it refactors after
    // proportionally smaller turns.
    blk.turnTol = Math.min(BLOCK_REFACTOR_ANGLE, 0.05 / worst);
  }

  // One entry of J M⁻¹ Jᵀ between rows p and q.
  function entry(p, q) {
    var s = 0;
    [p.A, p.B].forEach(function (bp, ip) {
      if (!isDynamic(bp)) return;
      var jp = ip ? p.jb : p.ja;
      if (q.A === bp) s += bp.invM * (jp[0] * q.ja[0] + jp[1] * q.ja[1]) + bp.invI * jp[2] * q.ja[2];
      if (q.B === bp) s += bp.invM * (jp[0] * q.jb[0] + jp[1] * q.jb[1]) + bp.invI * jp[2] * q.jb[2];
    });
    return s;
  }

  function rowVel(r) {
    var A = r.A, B = r.B;
    return r.ja[0] * A.v.x + r.ja[1] * A.v.y + r.ja[2] * A.w + r.jb[0] * B.v.x + r.jb[1] * B.v.y + r.jb[2] * B.w;
  }
  function rowApply(r, d) {
    var A = r.A, B = r.B;
    if (A.invM || A.invI) { A.v = M.v(A.v.x + A.invM * r.ja[0] * d, A.v.y + A.invM * r.ja[1] * d); A.w += A.invI * r.ja[2] * d; }
    if (B.invM || B.invI) { B.v = M.v(B.v.x + B.invM * r.jb[0] * d, B.v.y + B.invM * r.jb[1] * d); B.w += B.invI * r.jb[2] * d; }
  }

  function blockSolve(blk, h, useBias, retry) {
    if (!blk.built) { blk.built = true; factor(blk); }
    blk.passes = (blk.passes || 0) + (retry ? 0 : 1);
    if (blk.ok && !retry && needsRefactor(blk)) refactor(blk);
    if (!blk.ok) {
      // too big to factor, or the factor misbehaved: each joint solves its
      // own rows
      blk.joints.forEach(function (j) { j.blockSolveOwn(h, useBias); });
      return;
    }
    var soft = blk.joints[0].jointSoft, ms = 1, is = 0, br = 0;
    if (useBias) { ms = soft.massScale; is = soft.impulseScale; br = soft.biasRate; }
    var rows = blk.rows, order = blk.order, first = blk.first, env = blk.env, dinv = blk.dinv;
    var n = rows.length, b = blk.rhs, x = blk.lam, i, k, r, e0 = 0, e1 = 0, d;
    var push = blk.push || (blk.push = new Float64Array(n)), applied = blk.applied || (blk.applied = new Float64Array(n));
    for (k = 0; k < n; k++) {
      r = rows[order[k]]; r.joint.blockRow(r.slot, r);
      push[k] = capBias(br * r.C, r.angular ? P.MAX_JOINT_TURN : P.MAX_JOINT_PUSH) + capBias(r.drift / h, DRIFT_CAP);
      b[k] = rowVel(r) + push[k];
      if (dinv[k]) e0 += b[k] * b[k];
    }
    // x = A⁻¹ b
    for (i = 0; i < n; i++) { var s = b[i], e = env[i], f = first[i]; for (k = f; k < i; k++) s -= e[k - f] * x[k]; x[i] = s; }
    for (i = 0; i < n; i++) x[i] *= dinv[i];
    for (i = n - 1; i >= 0; i--) { var ee = env[i], ff = first[i], xi = x[i]; for (k = ff; k < i; k++) x[k] -= ee[k - ff] * xi; }
    for (k = 0; k < n; k++) {
      d = -ms * x[k];
      if (!isFinite(d)) d = 0;
      applied[k] = d;
      rowApply(rows[order[k]], d);
    }
    // Safety net: the exact solve leaves each row at (1 − ms) of what it was
    // asked to fix. If the rows end up further off than they started, the
    // factor is wrong for this geometry (near-singular or stale): take the
    // impulses back and let the group's joints solve on their own until the
    // group is rebuilt.
    // (rows the factor dropped as dependent are left out: when a loop or a
    // doubled joint asks for something inconsistent they cannot reach zero)
    for (k = 0; k < n; k++) { if (!dinv[k]) continue; r = rows[order[k]]; var res = rowVel(r) + push[k]; e1 += res * res; }
    if (!(e1 <= (1 - ms + 0.5) * (1 - ms + 0.5) * e0 + 1e-18)) {
      for (k = 0; k < n; k++) rowApply(rows[order[k]], -applied[k]);
      if (!retry && blk.factoredAt !== blk.passes) { refactor(blk); blockSolve(blk, h, useBias, true); return; }
      blk.ok = false;
      blk.joints.forEach(function (j) { j.blockSolveOwn(h, useBias); });
      return;
    }
    // then the soft part: relax the accumulated impulse by impulseScale
    for (k = 0; k < n; k++) {
      r = rows[order[k]];
      if (is) { d = -is * r.joint.blockImpulse(r.slot); rowApply(r, d); applied[k] += d; }
      r.joint.blockAdd(r.slot, applied[k]);
    }
  }

  /*
   * Energy guard, run once per step by the group's leader (postStep). A
   * passive group of rigid joints cannot gain energy: kinetic + gravity +
   * spring energy only goes down, apart from work done by applied forces.
   * A build that jams (a welded frame driven into the ground or through
   * another part, which the contacts keep pushing out while the joints hold
   * it in) can still pump energy in every substep. When the group's energy
   * rises by more than a small allowance in one step, its velocities are
   * scaled down by just enough to remove the gain: the jammed part looks
   * stuck instead of exploding. Motors and rams in the group are allowed
   * the work they can really do in a step: force (or torque) times their
   * set speed, at most.
   */
  var GUARD_ALLOW = 0.002;             // fraction of kinetic energy a step may gain (impacts from outside)
  // Energy is remembered per body and per joint (not per group), so the
  // guard keeps working while groups are rebuilt as parts sleep and wake.
  function blockGuard(blk, dt) {
    if (!blk.bodies) return;
    var world = blk.joints[0].bodyA.world || blk.joints[0].bodyB.world;
    if (!world) return;
    var g = world.gravity, step = world.stepCount, prev = 0, E = 0, K = 0, work = 0, known = true;
    blk.bodies.forEach(function (b) {
      var k = b.kineticEnergy(), e = k - b.m * (g.x * b.c.x + g.y * b.c.y);
      K += k; E += e;
      if (b._guardStep === step - 1) prev += b._guardE; else known = false;
      (b.lastApplied || []).forEach(function (f) { work += Math.abs((f.vector.x * b.v.x + f.vector.y * b.v.y) * dt) + Math.abs(f.torque * b.w * dt); });
    });
    blk.joints.forEach(function (j) {
      if (j.driveWork) work += j.driveWork(dt);
      if (j.storedEnergy) { var s = j.storedEnergy(); E += s; if (j._guardStep === step - 1) prev += j._guardE; else known = false; }
    });
    if (known) {
      var excess = E - prev - work - GUARD_ALLOW * K - 1e-3;
      if (excess > 0 && K > 0) {
        var f = Math.sqrt(Math.max(0, K - excess) / K);
        blk.bodies.forEach(function (b) { b.v = M.scale(b.v, f); b.w *= f; });
        blk.guarded = (blk.guarded || 0) + 1;
      }
    }
    blk.bodies.forEach(function (b) { b._guardE = b.kineticEnergy() - b.m * (g.x * b.c.x + g.y * b.c.y); b._guardStep = step; });
    blk.joints.forEach(function (j) { if (j.storedEnergy) { j._guardE = j.storedEnergy(); j._guardStep = step; } });
  }

  P.jointBlock = { prepare: blockPrepare, solve: blockSolve, guard: blockGuard };

  // Jacobian of one component of a point-to-point constraint (anchor B −
  // anchor A): x row is vB.x − wB rB.y − vA.x + wA rA.y, y row likewise.
  function pointRow(joint, slot, r) {
    var A = joint.bodyA, B = joint.bodyB;
    var a = joint.frame(A, joint.localAnchorA), b = joint.frame(B, joint.localAnchorB);
    var h = joint.h || 0;
    var dB = turnDrift(b.r, B.w * h), dA = turnDrift(a.r, A.w * h);
    if (slot === 0) {
      r.ja[0] = -1; r.ja[1] = 0; r.ja[2] = a.r.y;
      r.jb[0] = 1; r.jb[1] = 0; r.jb[2] = -b.r.y;
      r.C = b.p.x - a.p.x;
      r.drift = dB.x - dA.x;
    } else {
      r.ja[0] = 0; r.ja[1] = -1; r.ja[2] = -a.r.x;
      r.jb[0] = 0; r.jb[1] = 1; r.jb[2] = b.r.x;
      r.C = b.p.y - a.p.y;
      r.drift = dB.y - dA.y;
    }
  }
  // How far an anchor at lever arm r moves off the straight line v·h when
  // its body turns by angle t this substep: R(t) r − r − t (ẑ × r).
  function turnDrift(r, t) {
    if (t === 0) return { x: 0, y: 0 };
    var c = Math.cos(t) - 1, s = Math.sin(t) - t;
    return { x: c * r.x - s * r.y, y: s * r.x + c * r.y };
  }
  P.pointRow = pointRow;

  /* ------------------------------------------------------------ revolute */
  function RevoluteJoint(def) {
    Joint.call(this, def);
    this.type = 'revolute';
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    this.referenceAngle = def.referenceAngle != null ? def.referenceAngle : this.bodyB.angle - this.bodyA.angle;
    this.enableLimit = def.enableLimit != null ? !!def.enableLimit : (def.lowerAngle != null || def.upperAngle != null);
    this.lowerAngle = def.lowerAngle != null ? def.lowerAngle : -Infinity;
    this.upperAngle = def.upperAngle != null ? def.upperAngle : Infinity;
    this.enableMotor = def.enableMotor != null ? !!def.enableMotor : def.maxMotorTorque != null;
    this.motorSpeed = def.motorSpeed || 0;
    this.maxMotorTorque = def.maxMotorTorque || 0;
    this.stiffness = def.stiffness || 0;
    this.damping = def.damping || 0;
    this.springAngle = def.springAngle || 0;
    this.breakTorque = def.breakTorque == null ? Infinity : def.breakTorque;
    this.impulse = M.v(0, 0);
    this.springImpulse = 0;
    this.motorImpulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
  }
  RevoluteJoint.prototype = Object.create(Joint.prototype);

  RevoluteJoint.prototype.angle = function () {
    return this.bodyB.angle - this.bodyA.angle - this.referenceAngle;
  };
  RevoluteJoint.prototype.angularSpeed = function () { return this.bodyB.w - this.bodyA.w; };

  RevoluteJoint.prototype.setLimits = function (lower, upper) {
    this.lowerAngle = Math.min(lower, upper); this.upperAngle = Math.max(lower, upper); this.enableLimit = true;
  };
  RevoluteJoint.prototype.setMotor = function (speed, maxTorque) {
    this.motorSpeed = speed; if (maxTorque != null) this.maxMotorTorque = maxTorque; this.enableMotor = true;
    this.bodyA.wake(); this.bodyB.wake();
  };

  RevoluteJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h; this.h = h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    var k = this.bodyA.invI + this.bodyB.invI;
    this.axialK = k;
    this.axialMass = k > 0 ? 1 / k : 0;
    if (!this.enableLimit) { this.lowerImpulse = 0; this.upperImpulse = 0; }
    if (!this.enableMotor) this.motorImpulse = 0;
    if (!(this.stiffness > 0 || this.damping > 0)) this.springImpulse = 0;
    P.jointBlock.prepare(this);
  };

  RevoluteJoint.prototype.axialImpulse = function () {
    return this.springImpulse + this.motorImpulse + this.lowerImpulse - this.upperImpulse;
  };

  RevoluteJoint.prototype.warmStart = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    P.applyPair(A, B, a.r, b.r, this.impulse);
    var ax = this.axialImpulse();
    A.w -= A.invI * ax; B.w += B.invI * ax;
  };

  RevoluteJoint.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB, iA = A.invI, iB = B.invI;
    var fixedRotation = this.axialK === 0;

    // 1. rotational spring
    if ((this.stiffness > 0 || this.damping > 0) && !fixedRotation) {
      var Cs = this.angle() - this.springAngle;
      var ds = springDelta(this.stiffness, this.damping, h, Cs, B.w - A.w, this.axialK, this.springImpulse);
      this.springImpulse += ds;
      A.w -= iA * ds; B.w += iB * ds;
    }

    // 2. motor
    if (this.enableMotor && !fixedRotation) {
      var dm = -this.axialMass * (B.w - A.w - this.motorSpeed);
      var maxM = this.maxMotorTorque * h, old = this.motorImpulse;
      this.motorImpulse = M.clamp(old + dm, -maxM, maxM);
      dm = this.motorImpulse - old;
      A.w -= iA * dm; B.w += iB * dm;
    }

    // 3. limits
    if (this.enableLimit && !fixedRotation) {
      var ang = this.angle(), bias, ms, is, imp, next, C;
      if (this.lowerAngle > -Infinity) {
        C = ang - this.lowerAngle; bias = 0; ms = 1; is = 0;
        if (C > 0) bias = C * this.invH;                     // speculative
        else if (useBias) { bias = capBias(this.jointSoft.biasRate * C, P.MAX_JOINT_TURN); ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
        imp = -this.axialMass * ms * (B.w - A.w + bias) - is * this.lowerImpulse;
        next = Math.max(this.lowerImpulse + imp, 0);
        imp = next - this.lowerImpulse; this.lowerImpulse = next;
        A.w -= iA * imp; B.w += iB * imp;
      }
      if (this.upperAngle < Infinity) {
        C = this.upperAngle - ang; bias = 0; ms = 1; is = 0;
        if (C > 0) bias = C * this.invH;
        else if (useBias) { bias = capBias(this.jointSoft.biasRate * C, P.MAX_JOINT_TURN); ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
        // sign flipped: the upper limit pushes B clockwise
        imp = -this.axialMass * ms * (A.w - B.w + bias) - is * this.upperImpulse;
        next = Math.max(this.upperImpulse + imp, 0);
        imp = next - this.upperImpulse; this.upperImpulse = next;
        A.w += iA * imp; B.w -= iB * imp;
      }
    }

    // 4. point constraint, with the joint's group or on its own
    if (this.block) { if (this.blockLeader) P.jointBlock.solve(this.block, h, useBias); }
    else this.blockSolveOwn(h, useBias);
  };

  RevoluteJoint.prototype.blockSolveOwn = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    var rA = a.r, rB = b.r;
    var Cdot = P.relVel(A, B, rA, rB);
    var bx = 0, by = 0, pms = 1, pis = 0;
    if (useBias) {
      bx = (b.p.x - a.p.x) * this.jointSoft.biasRate; by = (b.p.y - a.p.y) * this.jointSoft.biasRate;
      var cap = capBias2(bx, by, P.MAX_JOINT_PUSH); bx *= cap; by *= cap;
      pms = this.jointSoft.massScale; pis = this.jointSoft.impulseScale;
    }
    var s = solve2(pointK(A, B, rA, rB), Cdot.x + bx, Cdot.y + by);
    var pv = M.v(-pms * s.x - pis * this.impulse.x, -pms * s.y - pis * this.impulse.y);
    this.impulse = M.add(this.impulse, pv);
    P.applyPair(A, B, rA, rB, pv);
  };

  // Rigid rows for P.jointBlock: slot 0 = x, 1 = y of the anchor separation.
  RevoluteJoint.prototype.blockSlots = function () { return [0, 1]; };
  RevoluteJoint.prototype.blockRow = function (slot, r) { pointRow(this, slot, r); };
  RevoluteJoint.prototype.blockImpulse = function (slot) { return slot ? this.impulse.y : this.impulse.x; };
  RevoluteJoint.prototype.blockAdd = function (slot, d) {
    this.impulse = slot ? M.v(this.impulse.x, this.impulse.y + d) : M.v(this.impulse.x + d, this.impulse.y);
  };

  RevoluteJoint.prototype.force = function () { return M.len(this.impulse) * this.invH; };
  RevoluteJoint.prototype.torque = function () { return this.axialImpulse() * this.invH; };
  RevoluteJoint.prototype.motorTorque = function () { return this.motorImpulse * this.invH; };
  RevoluteJoint.prototype.springTorque = function () { return this.springImpulse * this.invH; };
  RevoluteJoint.prototype.limitTorque = function () { return (this.lowerImpulse - this.upperImpulse) * this.invH; };

  RevoluteJoint.prototype.reaction = function () {
    return { force: M.scale(this.impulse, this.invH), torque: this.torque() };
  };

  // A running motor keeps both bodies awake (sleeping skips joints whose
  // bodies are all asleep).
  RevoluteJoint.prototype.postStep = function (dt) { if (this.blockLeader && this.block) P.jointBlock.guard(this.block, dt); };
  // Most work the motor can do in a step: its torque times its set speed
  // (a motor never drives faster than motorSpeed), for the energy guard.
  RevoluteJoint.prototype.driveWork = function (dt) {
    return this.enableMotor ? Math.abs(this.motorTorque()) * Math.min(Math.abs(this.angularSpeed()), Math.abs(this.motorSpeed)) * dt : 0;
  };
  RevoluteJoint.prototype.storedEnergy = function () {
    if (!(this.stiffness > 0)) return 0;
    var c = this.angle() - this.springAngle; return 0.5 * this.stiffness * c * c;
  };
  RevoluteJoint.prototype.preStep = function () {
    if (this.enableMotor && this.motorSpeed !== 0 && this.maxMotorTorque > 0) { this.bodyA.wake(); this.bodyB.wake(); }
  };

  P.RevoluteJoint = RevoluteJoint;
  (P.jointTypes = P.jointTypes || {}).revolute = {
    ctor: RevoluteJoint,
    fields: ['referenceAngle', 'enableLimit', 'lowerAngle', 'upperAngle', 'enableMotor', 'motorSpeed',
      'maxMotorTorque', 'stiffness', 'damping', 'springAngle']
  };
})(globalThis.SE);
