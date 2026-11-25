/*
 * Pulleys and block-and-tackle rigs.
 *
 * Both are built on a rope path: a single line made of straight runs between
 * points that are fixed in the world or carried by bodies. Each run i has a
 * factor k_i (how many parts of line it stands for), and the line keeps
 *   sum k_i |q_i - p_i| <= length
 * with tension T >= 0 the same everywhere along it. Each body gets the pull of
 * every run that ends on it, so a 4-part tackle puts 4T on the load block.
 * Sheaves are treated as frictionless points, so T is uniform.
 *
 *   new SE.phys.PulleyJoint({
 *     bodyA, bodyB, localAnchorA, localAnchorB (or worldAnchorA/B),
 *     groundAnchorA, groundAnchorB, world points the two sides hang from
 *     ratio,                        lengthA + ratio·lengthB = constant (default 1)
 *     length,                       that constant (default: as built)
 *     EA,                           optional axial stiffness of the line, N
 *     breakForce })                 rates the line on side A
 * Each side only pulls: tensionA() = T and tensionB() = ratio·T, in N. With
 * ratio 1 and two hanging masses this is the Atwood machine.
 *
 *   P.pulley.tackle(world, {
 *     block: { body, localAnchor },   the fixed upper block (body null = world point)
 *     load:  { body, localAnchor },   the moving block / hook
 *     n,                               parts of line supporting the load
 *     haul:  { body, localAnchor }     the free end, pulled by a body, or
 *     winch: { body, localAnchor, ...WinchJoint options }  wound on a drum
 *   })
 * returns a PulleyJoint (haul) or a WinchJoint (winch) whose line tension is
 * W/n for a load W held still: mechanical advantage n.
 *
 * P.RopePath is exported for winch.js and other line-based joints.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  /* ----------------------------------------------------------- rope path */
  // runs: [{ a: { body | null, local }, b: { body | null, local }, k }]
  // A null body means `local` is a world point.
  function RopePath(runs) {
    this.runs = runs;
    var bodies = [];
    runs.forEach(function (r) {
      [r.a, r.b].forEach(function (e) { if (e.body && bodies.indexOf(e.body) < 0) bodies.push(e.body); });
    });
    this.bodies = bodies;
    this.lin = bodies.map(function () { return M.v(0, 0); });
    this.ang = bodies.map(function () { return 0; });
  }

  function endPoint(e) {
    if (!e.body) return { p: e.local, r: null };
    var B = e.body, r = M.rotate(B.q, M.sub(e.local, B.localCenter));
    return { p: M.add(B.c, r), r: r };
  }

  // Current length and the Jacobian of length with respect to each body's velocity.
  RopePath.prototype.update = function () {
    var bodies = this.bodies, lin = this.lin, ang = this.ang, total = 0, i;
    for (i = 0; i < bodies.length; i++) { lin[i] = M.v(0, 0); ang[i] = 0; }
    for (i = 0; i < this.runs.length; i++) {
      var run = this.runs[i], a = endPoint(run.a), b = endPoint(run.b);
      var d = M.sub(b.p, a.p), L = M.len(d);
      run.len = L;
      total += run.k * L;
      if (L < 1e-9) continue;
      var u = M.scale(d, run.k / L);
      if (run.b.body) { var ib = bodies.indexOf(run.b.body); lin[ib] = M.add(lin[ib], u); ang[ib] += M.cross(b.r, u); }
      if (run.a.body) { var ia = bodies.indexOf(run.a.body); lin[ia] = M.sub(lin[ia], u); ang[ia] -= M.cross(a.r, u); }
    }
    this.total = total;
    var K = 0;
    for (i = 0; i < bodies.length; i++) K += bodies[i].invM * M.lenSq(lin[i]) + bodies[i].invI * ang[i] * ang[i];
    this.mass = K > 0 ? 1 / K : 0;
    return total;
  };

  // Rate of change of the path length, m/s.
  RopePath.prototype.rate = function () {
    var s = 0;
    for (var i = 0; i < this.bodies.length; i++) {
      var B = this.bodies[i];
      s += M.dot(this.lin[i], B.v) + this.ang[i] * B.w;
    }
    return s;
  };

  // Apply a tension impulse T·h (N·s); positive pulls the line's ends in.
  RopePath.prototype.pull = function (imp) {
    for (var i = 0; i < this.bodies.length; i++) {
      var B = this.bodies[i];
      B.v = M.mulAdd(B.v, -B.invM * imp, this.lin[i]);
      B.w -= B.invI * this.ang[i] * imp;
    }
  };

  // Force the line puts on one body for tension T (N).
  RopePath.prototype.forceOn = function (body, T) {
    var i = this.bodies.indexOf(body);
    return i < 0 ? M.v(0, 0) : M.scale(this.lin[i], -T);
  };

  // { force, torque, point } on one body for tension T: the resultant of
  // every run pulling on it, placed at the first point the line touches it,
  // with torque the couple left over when several runs pull on one body
  // (a drum and a sheave on the same crane). null if the line misses it.
  RopePath.prototype.reactionOn = function (body, T) {
    var F = M.v(0, 0), point = null, moment = 0;
    for (var i = 0; i < this.runs.length; i++) {
      var run = this.runs[i], a = endPoint(run.a), b = endPoint(run.b);
      var d = M.sub(b.p, a.p), L = M.len(d);
      if (L < 1e-9) continue;
      var u = M.scale(d, run.k * T / L);           // pull on a toward b
      [[run.a, a, u], [run.b, b, M.neg(u)]].forEach(function (e) {
        if (e[0].body !== body) return;
        if (!point) point = e[1].p;
        F = M.add(F, e[2]);
        moment += M.cross(M.sub(e[1].p, point), e[2]);
      });
    }
    return point ? { force: F, torque: moment, point: point } : null;
  };

  /*
   * One substep of a line held to rest length L, whose rest length is moving
   * in at `speed` m/s (0 for a fixed line). acc is the accumulated tension
   * impulse, kept in [0, cap]. Returns the new accumulated impulse.
   *   s = length - L (stretch), ds/dt = rate + speed
   * Inextensible: speculative while slack, joint softness when stretched.
   * With an elastic line (spring from lineSpring) the spring acts in every
   * pass, pulling only. A line too stiff for the substep to resolve is solved
   * as inextensible at its stretched length L + T/k instead.
   */
  function solveLine(path, L, speed, acc, cap, h, useBias, jointSoft, spring) {
    path.update();
    var mass = path.mass;
    if (mass === 0) return acc;
    if (spring && !spring.soft) L += acc / (h * spring.k);
    var s = path.total - L, sdot = path.rate() + speed, imp;
    if (spring && spring.soft) {
      var sp = spring.soft;
      imp = mass * sp.massScale * (sdot + sp.biasRate * s) - sp.impulseScale * acc;
    } else if (s < 0) {
      imp = mass * (sdot + s / h);
    } else if (useBias) {
      imp = mass * jointSoft.massScale * (sdot + jointSoft.biasRate * s) - jointSoft.impulseScale * acc;
    } else {
      imp = mass * sdot;
    }
    var next = M.clamp(acc + imp, 0, cap);
    path.pull(next - acc);
    return next;
  }

  // Spring for a line of axial stiffness EA and length L: { k, soft }, with
  // soft null when the line's frequency is above the joint stiffness the
  // solver resolves (cfg.jointHertz); such a line is solved as stiff.
  function lineSpring(EA, L, path, h, zeta, cfg) {
    if (!EA) return null;
    path.update();
    if (path.mass === 0) return null;
    var k = EA / Math.max(L, 1e-3), hz = Math.sqrt(k / path.mass) / (2 * Math.PI);
    return { k: k, soft: hz > cfg.jointHertz ? null : P.softness(hz, zeta, h) };
  }

  /* ------------------------------------------------------------ line blocks */
  /*
   * Line blocks: a direct solve for groups of lines that share bodies.
   *
   * Solved one at a time (Gauss-Seidel), a chain of rods, ropes and stiff
   * springs between light nodes can't carry a heavy load: each link only
   * "sees" the two bodies it joins, so a 500 kg load on 0.2 kg nodes
   * stretches rigid rods by centimetres, and a light hook block between a
   * winch line and a sling keeps the load from lifting at all. So every
   * group of line-type constraints joined through dynamic bodies is solved
   * together each substep as one small bounded problem in the line pulls λ:
   *   u' = u - (A + G) Δλ,   λ = λ0 + Δλ in [lo, hi],   A = J M⁻¹ Jᵀ
   * Rows:
   *   rod                   two-sided, u' = target            (lo = -∞)
   *   rope, pulley, winch   pulls only (lo = 0); slack rows may close their
   *                         gap in one substep, no further; a winch row is
   *                         capped at its max pull and moves with the drum
   *   spring (k, c)         implicit (backward Euler) in the solve pass:
   *                         G = 1/(h² k + h c), so the pull is exactly
   *                         h (k (s + h u') + c u') and the spring can only
   *                         lose energy; it is left alone in the relax pass
   *   kink                  a light node's sideways speed against its
   *                         neighbours, compliance 1/(h² k), where taut lines
   *                         make its kink stiffer than a substep can follow
   *                         (solve pass only; see kinkRows)
   * target = −β·s (β the joint bias rate) in the solve pass, 0 in relax.
   * After the relax pass a line more than the slop off its length is moved
   * back to within it (projectBlock).
   * The bounds are met exactly by an active-set loop on the dense system
   * (blocks are capped at MAX_ROWS). Soft springs (ω·h < 0.5) and joints
   * with motors or extra limits keep their own solve.
   *
   * Each joint keeps its own accumulated impulse, so readings are unchanged.
   * The block's first joint (its leader) warm-starts and solves the block;
   * the others skip. world.lineBlockSolve = false turns this off.
   */
  var MAX_ROWS = 64;

  function isDyn(b) { return b.type === 'dynamic' && (b.invM > 0 || b.invI > 0); }
  function moving(b) { return b.type !== 'static' && b.awake !== false; }

  // Row description for a joint, or null if it keeps its own solve.
  function rowFor(j, h, cfg) {
    if (j.broken) return null;
    var r = null;
    if (j.type === 'winch' || j.type === 'pulley') {
      var sp = lineSpring(j.EA, j.length, j.path, h, j.dampingRatio, cfg);
      if (sp && sp.soft) return null;
      r = { joint: j, kind: j.type, path: j.path, lo: 0, field: 'impulse', g: 0, k: 0 };
      if (sp) { r.g = 1 / (h * h * sp.k); r.k = sp.k; r.kind = j.type; r.spring = true; }
      return r;
    }
    if (j.type !== 'distance' || j.maxMotorForce > 0) return null;
    if (!j.linePath) j.linePath = new RopePath([{ a: { body: j.bodyA, local: j.localAnchorA }, b: { body: j.bodyB, local: j.localAnchorB }, k: 1 }]);
    if (j.spring) {
      if (j.minLength > 0 || j.maxLength < Infinity) return null;
      var m = j.effMass(j.geometry());
      if (!(m > 0)) return null;
      var k, c;
      if (j.stiffness > 0) {
        k = j.stiffness;
        c = j.damping != null ? j.damping : 2 * j.dampingRatio * Math.sqrt(k * m);
      } else {
        var om = 2 * Math.PI * j.hertz; k = m * om * om; c = 2 * j.dampingRatio * m * om;
      }
      if (Math.sqrt(k / m) * h < 0.5) return null;      // soft: explicit, energy-keeping
      return { joint: j, kind: 'spring', path: j.linePath, lo: j.rope ? 0 : -Infinity, field: 'upperImpulse',
        g: 1 / (h * h * k + h * c), k: k, rest: j.length, spring: true };
    }
    if (j.minLength >= j.maxLength) return { joint: j, kind: 'rod', path: j.linePath, lo: -Infinity, field: 'upperImpulse', g: 0 };
    if (j.minLength === 0 && j.maxLength < Infinity) return { joint: j, kind: 'rope', path: j.linePath, lo: 0, field: 'upperImpulse', g: 0 };
    return null;
  }

  function buildBlocks(world, h, cfg) {
    world._lbStep = world.stepCount; world._lbTime = world.time;
    var parent = new Map();
    function find(b) { var p = parent.get(b); if (p === b) return b; var q = find(p); parent.set(b, q); return q; }
    var rows = [];
    world.joints.forEach(function (j) {
      j.lineBlock = null;
      if (!(moving(j.bodyA) || moving(j.bodyB))) return;
      var r = rowFor(j, h, cfg);
      if (!r) return;
      var dyn = r.path.bodies.filter(isDyn);
      if (!dyn.length) return;
      dyn.forEach(function (b) { if (!parent.has(b)) parent.set(b, b); });
      for (var i = 1; i < dyn.length; i++) { var a = find(dyn[0]), b = find(dyn[i]); if (a !== b) parent.set(a, b); }
      r.root = dyn[0];
      rows.push(r);
    });
    var groups = new Map();
    rows.forEach(function (r) {
      var key = find(r.root);
      if (!groups.has(key)) groups.set(key, []);
      var g = groups.get(key);
      if (g.length < MAX_ROWS) g.push(r);
    });
    var soft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    groups.forEach(function (g) {
      var blk = { rows: g, leader: g[0].joint, step: world.stepCount, beta: soft.biasRate, h: h, pointed: null };
      g.forEach(function (r) { r.joint.lineBlock = blk; r.joint.linePeak = 0; });
    });
  }

  // Called first thing in each line joint's prepare(); returns its block or null.
  function prepareLine(j, h, cfg) {
    var world = j.bodyA.world || j.bodyB.world;
    if (!world || world.lineBlockSolve === false) { j.lineBlock = null; return null; }
    if (world._lbStep !== world.stepCount || world._lbTime !== world.time || world._lbH !== h) { world._lbH = h; buildBlocks(world, h, cfg); }
    return activeBlock(j);
  }
  // The joint's block if it is being solved in one this step.
  function activeBlock(j) {
    var blk = j.lineBlock, world = j.bodyA.world || j.bodyB.world;
    return blk && world && blk.step === world.stepCount ? blk : null;
  }

  // A_ij = sum over shared bodies of invM (lin_i · lin_j) + invI ang_i ang_j
  function coupling(pi, pj) {
    var a = 0;
    for (var x = 0; x < pi.bodies.length; x++) {
      var y = pj.bodies.indexOf(pi.bodies[x]);
      if (y < 0) continue;
      var B = pi.bodies[x];
      a += B.invM * M.dot(pi.lin[x], pj.lin[y]) + B.invI * pi.ang[x] * pj.ang[y];
    }
    return a;
  }

  // Solve K x = b on the index set `idx` (Gaussian elimination, partial pivot;
  // zero entries are skipped, so a chain costs little more than its band).
  function solveDense(K, b, idx) {
    var n = idx.length, m = new Array(n), i, k, r, c;
    for (i = 0; i < n; i++) { var row = new Array(n + 1), Ki = K[idx[i]]; for (c = 0; c < n; c++) row[c] = Ki[idx[c]]; row[n] = b[i]; m[i] = row; }
    for (k = 0; k < n; k++) {
      var piv = k;
      for (r = k + 1; r < n; r++) if (Math.abs(m[r][k]) > Math.abs(m[piv][k])) piv = r;
      var t = m[k]; m[k] = m[piv]; m[piv] = t;
      var mk = m[k], d = mk[k];
      if (Math.abs(d) < 1e-300) continue;
      for (r = k + 1; r < n; r++) {
        var mr = m[r], f = mr[k];
        if (f === 0) continue;
        f /= d;
        for (c = k; c <= n; c++) if (mk[c] !== 0) mr[c] -= f * mk[c];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var sum = m[i][n];
      for (k = i + 1; k < n; k++) if (m[i][k] !== 0) sum -= m[i][k] * x[k];
      x[i] = Math.abs(m[i][i]) < 1e-300 ? 0 : sum / m[i][i];
    }
    return x;
  }

  function rowCap(r) { return r.kind === 'winch' ? r.joint.capH : Infinity; }
  function rowAcc(r) { return r.joint ? r.joint[r.field] : r.acc; }

  /*
   * A light body pulled hard at anchors off its centre (a hook block between
   * a line and a sling) has a stiff swinging mode, ω² ≈ Σ T·r / I. Past
   * ω·h ≈ 1 straight-line position steps can't follow it and it spins up, so
   * such a body is a point for the lines (their angular terms are dropped):
   * it hangs where they hold it, but they don't twist it. The pull is judged
   * by the larger of the present one and what a winch in the block can pull.
   */
  function pointBodies(blk, h) {
    var lever = new Map(), full = 0;
    blk.rows.forEach(function (r) { if (r.kind === 'winch' && isFinite(r.joint.capH)) full = Math.max(full, r.joint.capH * r.joint.parts / h); });
    blk.rows.forEach(function (r) {
      var T = Math.max(Math.abs(rowAcc(r)) / h, full);
      r.path.runs.forEach(function (run) {
        [run.a, run.b].forEach(function (e) {
          var B = e.body;
          if (!B || !(B.invI > 0)) return;
          var arm = M.len(M.sub(e.local, B.localCenter));
          if (arm > 0) lever.set(B, (lever.get(B) || 0) + run.k * T * arm);
        });
      });
    });
    var pointed = [];
    lever.forEach(function (kRot, B) { if (kRot * B.invI * h * h > 1) pointed.push(B); });
    return pointed;
  }
  function updateRows(blk) {
    var rows = blk.rows;
    for (var i = 0; i < rows.length; i++) rows[i].path.update();
    (blk.pointed || []).forEach(function (B) {
      rows.forEach(function (r) { var x = r.path.bodies.indexOf(B); if (x >= 0) r.path.ang[x] = 0; });
    });
  }

  function warmStartBlock(blk) {
    if (!blk.pointed) { blk.rows.forEach(function (r) { r.path.update(); }); blk.pointed = pointBodies(blk, blk.h); }
    updateRows(blk);
    blk.rows.forEach(function (r) { r.path.pull(rowAcc(r)); });
  }

  /*
   * A light node between two taut lines has a stiff sideways mode: the
   * lines' pull straightens a kink with stiffness k ≈ T1/L1 + T2/L2, up to
   * twice that for a zigzag along the chain. The solve fixes each line's
   * direction at the start of a substep, so that stiffness acts explicitly
   * and past ω·h ≈ 1 the kinks ring up (0.2 kg nodes under a 1 t load whip
   * about at 30 m/s). For such nodes the block gets one more row each, the
   * node's sideways speed against the chord of its neighbours, with
   * compliance 1/(h²k): solved with the lines, that is implicit Euler on the
   * kink stiffness. Only the part of k past ω·h ≈ 0.7 is taken, so kinks the
   * step can follow, and a chain swinging as a whole (no kink), are left alone.
   */
  var KINK_Z0 = 0.5;
  function kinkNodes(blk) {
    var ends = new Map();
    blk.rows.forEach(function (r) {
      if (r.path.runs.length !== 1) return;
      var run = r.path.runs[0];
      [[run.a, run.b], [run.b, run.a]].forEach(function (pr) {
        var B = pr[0].body;
        if (!B || !isDyn(B)) return;
        if (!ends.has(B)) ends.set(B, []);
        ends.get(B).push({ row: r, own: pr[0], other: pr[1], k: run.k });
      });
    });
    var nodes = [];
    ends.forEach(function (list, B) { if (list.length === 2) nodes.push({ body: B, sides: list }); });
    return nodes;
  }
  // a row over up to three body points: rate = Σ c_i · n · v(p_i)
  function KinkPath(pts, n) {
    var bodies = [], lin = [], ang = [];
    pts.forEach(function (pt) {
      var B = pt.e.body;
      if (!B || B.type !== 'dynamic') return;
      var x = bodies.indexOf(B), r = M.sub(pt.p, B.c), l = M.scale(n, pt.c), a = M.cross(r, l);
      if (x < 0) { bodies.push(B); lin.push(l); ang.push(a); } else { lin[x] = M.add(lin[x], l); ang[x] += a; }
    });
    this.bodies = bodies; this.lin = lin; this.ang = ang;
  }
  KinkPath.prototype.rate = RopePath.prototype.rate;
  KinkPath.prototype.pull = RopePath.prototype.pull;
  function kinkRows(blk, h) {
    if (!blk.kinks) blk.kinks = kinkNodes(blk);
    var out = [], pointed = blk.pointed || [];
    blk.kinks.forEach(function (nd) {
      var s1 = nd.sides[0], s2 = nd.sides[1];
      var T1 = s1.k * Math.max(0, rowAcc(s1.row)) / h, T2 = s2.k * Math.max(0, rowAcc(s2.row)) / h;
      if (!(T1 > 0 && T2 > 0)) return;
      var pb = endPoint(s1.own).p, pa = endPoint(s1.other).p, pc = endPoint(s2.other).p;
      var L1 = M.dist(pa, pb), L2 = M.dist(pb, pc), ch = M.sub(pc, pa), cl = M.len(ch);
      if (!(L1 > 1e-6 && L2 > 1e-6 && cl > 1e-6)) return;
      // a sharp bend is not a kink of a taut line
      if (M.dot(M.sub(pb, pa), M.sub(pc, pb)) < 0.9 * L1 * L2) return;
      var n = M.v(-ch.y / cl, ch.x / cl), al = L2 / (L1 + L2), be = L1 / (L1 + L2);
      var path = new KinkPath([{ e: s1.own, p: pb, c: 1 }, { e: s1.other, p: pa, c: -al }, { e: s2.other, p: pc, c: -be }], n);
      path.bodies.forEach(function (B, x) { if (pointed.indexOf(B) >= 0) path.ang[x] = 0; });
      var w = 0;
      path.bodies.forEach(function (B, x) { w += B.invM * M.lenSq(path.lin[x]) + B.invI * path.ang[x] * path.ang[x]; });
      var k = 2 * (T1 / L1 + T2 / L2), kStep = KINK_Z0 / (h * h * w);
      if (!(w > 0) || k <= kStep) return;
      out.push({ kind: 'kink', path: path, lo: -Infinity, g: 1 / (h * h * (k - kStep)), acc: 0 });
    });
    return out;
  }

  /*
   * After the relax pass any of the block's lines more than the slop off its
   * length is put back to within the slop by moving the bodies (velocities are left alone), solved together like the
   * impulses. A chain of light nodes under a heavy load straightens its kinks
   * faster than a substep can follow; without this the links stretch while
   * they whip about and the position bias then feeds energy back in. Rods
   * are held both ways; ropes, winch lines and pulleys only when overlong.
   * A winch at its cap and spring rows are left to the velocity solve.
   */
  var PROJECT_PASSES = 2;
  function rowLength(r) {
    var j = r.joint;
    if (r.kind === 'winch') return j.length;
    if (r.kind === 'pulley' || r.kind === 'rod') return j.length;
    return j.maxLength;
  }
  function projectBlock(blk) {
    var rows = blk.rows, n = rows.length, i, k;
    for (var pass = 0; pass < PROJECT_PASSES; pass++) {
      updateRows(blk);
      var act = [], s = [];
      for (i = 0; i < n; i++) {
        var r = rows[i];
        if (r.spring) continue;
        if (r.kind === 'winch' && r.joint.impulse >= r.joint.capH * (1 - 1e-9)) continue;
        // the velocity solve's bias handles small errors (and keeps a
        // swinging rod's energy); only what is past the slop is moved out
        var e = r.path.total - rowLength(r), over = Math.abs(e) - P.LINEAR_SLOP;
        if ((r.kind !== 'rod' && !(e > 0)) || !(over > 0)) continue;
        act.push(i); s.push(e > 0 ? over : -over);
      }
      if (!act.length) return;
      var K = new Array(n);
      for (var a = 0; a < act.length; a++) {
        i = act[a]; K[i] = [];
        for (var b2 = 0; b2 < act.length; b2++) { k = act[b2]; K[i][k] = b2 < a ? K[k][i] : coupling(rows[i].path, rows[k].path); }
        K[i][i] *= 1 + 1e-7;
      }
      var mu = solveDense(K, s, act), moved = new Map();
      for (a = 0; a < act.length; a++) {
        var row = rows[act[a]], m = mu[a];
        if (row.kind !== 'rod' && m < 0) m = 0;   // a line can't push
        if (!m) continue;
        var pth = row.path;
        for (k = 0; k < pth.bodies.length; k++) {
          var B = pth.bodies[k];
          if (!(B.invM > 0 || B.invI > 0) || B.type !== 'dynamic') continue;
          B.c = M.mulAdd(B.c, -B.invM * m, pth.lin[k]);
          if (pth.ang[k]) { B.angle -= B.invI * pth.ang[k] * m; moved.set(B, true); }
        }
      }
      moved.forEach(function (_, B) { B.q = M.rot(B.angle); });
    }
    updateRows(blk);
  }

  function solveBlock(blk, h, useBias) {
    var rows = blk.rows, n = rows.length, i, k;
    if (useBias) rows.forEach(function (r) { if (r.joint.beforeBlock) r.joint.beforeBlock(h); });
    rows.forEach(function (r) { r.path.update(); });
    blk.pointed = pointBodies(blk, h);
    updateRows(blk);
    var lines = rows;
    if (useBias) { var kinks = kinkRows(blk, h); if (kinks.length) { rows = rows.concat(kinks); n = rows.length; } }
    var acc = new Array(n), lo = new Array(n), hi = new Array(n), rhs = new Array(n), fixed = new Array(n);
    for (i = 0; i < n; i++) {
      var r = rows[i], j = r.joint, u = r.path.rate(), L;
      acc[i] = rowAcc(r); lo[i] = r.lo; hi[i] = rowCap(r);
      if (r.kind === 'kink') { fixed[i] = false; rhs[i] = u; continue; }
      if (r.kind === 'winch') { u += j.speed; L = j.length; }
      else if (r.kind === 'pulley') L = j.length;
      else if (r.kind === 'spring') L = r.rest;
      else if (r.kind === 'rod') L = j.length;
      else L = j.maxLength;
      var s = r.path.total - L;
      fixed[i] = false;
      if (r.spring) {
        // implicit spring: solve pass only
        if (!useBias) { fixed[i] = true; rhs[i] = 0; continue; }
        rhs[i] = u - r.g * acc[i] + r.g * h * r.k * s;
        if (r.lo === 0 && s < 0 && acc[i] <= 0) { /* slack line spring: let the bounds decide */ }
        continue;
      }
      var target;
      if (r.lo === 0 && s < -P.LINEAR_SLOP) target = -s / h;     // slack: may close the gap, no further
      else target = useBias ? -blk.beta * s : 0;
      rhs[i] = u - target;
    }
    var K = new Array(n);
    for (i = 0; i < n; i++) {
      K[i] = new Array(n);
      for (k = 0; k < n; k++) K[i][k] = k < i ? K[k][i] : coupling(rows[i].path, rows[k].path);
      // a hair of compliance on every row: identical rows (two slings side by
      // side) then share their load equally instead of one taking it all
      K[i][i] = K[i][i] * (1 + 1e-7) + rows[i].g;
    }
    // active set: 0 free, 1 at lo, 2 at hi, 3 fixed (Δ = 0)
    var state = new Array(n), d = new Array(n);
    for (i = 0; i < n; i++) { state[i] = fixed[i] ? 3 : 0; d[i] = 0; }
    for (var iter = 0; iter < 2 * n + 6; iter++) {
      var free = [], b = [];
      for (i = 0; i < n; i++) {
        if (state[i] === 1) d[i] = lo[i] - acc[i];
        else if (state[i] === 2) d[i] = hi[i] - acc[i];
        else if (state[i] === 3) d[i] = 0;
        else free.push(i);
      }
      for (var q = 0; q < free.length; q++) {
        var fi = free[q], v = rhs[fi], Kf = K[fi];
        for (k = 0; k < n; k++) if (state[k] !== 0 && d[k] !== 0) v -= Kf[k] * d[k];
        b.push(v);
      }
      var x = free.length ? solveDense(K, b, free) : [];
      for (q = 0; q < free.length; q++) d[free[q]] = x[q];
      var changed = false;
      for (i = 0; i < n; i++) {
        var lam = acc[i] + d[i];
        if (state[i] === 0) {
          if (lam < lo[i] - 1e-12 * Math.max(1, Math.abs(lo[i]))) { state[i] = 1; changed = true; }
          else if (lam > hi[i] * (1 + 1e-12)) { state[i] = 2; changed = true; }
        } else if (state[i] !== 3) {
          var w = rhs[i];
          for (k = 0; k < n; k++) if (d[k] !== 0) w -= K[i][k] * d[k];
          if ((state[i] === 1 && w > 1e-12) || (state[i] === 2 && w < -1e-12)) { state[i] = 0; changed = true; }
        }
      }
      if (!changed) break;
    }
    for (i = 0; i < n; i++) {
      var next = M.clamp(acc[i] + d[i], lo[i], hi[i]);
      rows[i].path.pull(next - acc[i]);
      if (!rows[i].joint) continue;
      rows[i].joint[rows[i].field] = next;
      // Solved rigidly, a snatch lasts a single substep; breakage reads the
      // step's largest pull so a line still snaps on it.
      if (!useBias) rows[i].joint.linePeak = Math.max(rows[i].joint.linePeak || 0, Math.abs(next));
    }
    if (useBias) lines.forEach(function (r) { if (r.joint.afterBlock) r.joint.afterBlock(h); });
    else projectBlock(blk);
  }

  P.lineBlocks = { prepare: prepareLine, active: activeBlock, warmStart: warmStartBlock, solve: solveBlock };

  /* ---------------------------------------------------------- pulley joint */
  function PulleyJoint(def) {
    Joint.call(this, def);
    this.type = 'pulley';
    if (def.worldAnchorA) this.localAnchorA = this.bodyA.localPoint(def.worldAnchorA);
    if (def.worldAnchorB) this.localAnchorB = this.bodyB.localPoint(def.worldAnchorB);
    var gA = def.groundAnchorA || def.groundA, gB = def.groundAnchorB || def.groundB;
    this.groundAnchorA = M.v(gA.x, gA.y);
    this.groundAnchorB = M.v(gB.x, gB.y);
    this.ratio = def.ratio || 1;
    this.EA = def.EA || 0;
    this.dampingRatio = def.dampingRatio == null ? 0.1 : def.dampingRatio;
    this.path = new RopePath([
      { a: { body: null, local: this.groundAnchorA }, b: { body: this.bodyA, local: this.localAnchorA }, k: 1 },
      { a: { body: null, local: this.groundAnchorB }, b: { body: this.bodyB, local: this.localAnchorB }, k: this.ratio }
    ]);
    this.length = def.length != null ? def.length : this.path.update();
    this.impulse = 0;
  }
  PulleyJoint.prototype = Object.create(Joint.prototype);

  PulleyJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    prepareLine(this, h, cfg);
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.spring = lineSpring(this.EA, this.length, this.path, h, this.dampingRatio, cfg);
  };
  PulleyJoint.prototype.warmStart = function () {
    var blk = activeBlock(this);
    if (blk) { if (blk.leader === this) warmStartBlock(blk); return; }
    this.path.update(); this.path.pull(this.impulse);
  };
  PulleyJoint.prototype.solve = function (h, useBias) {
    var blk = activeBlock(this);
    if (blk) { if (blk.leader === this) solveBlock(blk, h, useBias); return; }
    this.impulse = solveLine(this.path, this.length, 0, this.impulse, Infinity, h, useBias, this.jointSoft, this.spring);
  };
  PulleyJoint.prototype.tensionA = function () { return this.impulse * this.invH; };
  PulleyJoint.prototype.tensionB = function () { return this.ratio * this.impulse * this.invH; };
  PulleyJoint.prototype.tension = PulleyJoint.prototype.tensionA;
  PulleyJoint.prototype.force = function () {
    var T = this.tensionA();
    return activeBlock(this) && this.linePeak ? Math.max(T, this.linePeak * this.invH) : T;
  };
  PulleyJoint.prototype.lengthA = function () { this.path.update(); return this.path.runs[0].len; };
  PulleyJoint.prototype.lengthB = function () { this.path.update(); return this.path.runs[1].len; };
  PulleyJoint.prototype.isSlack = function () { return this.path.update() < this.length - P.LINEAR_SLOP; };
  PulleyJoint.prototype.reactionOn = function (body) { return this.path.reactionOn(body, this.tensionA()); };
  PulleyJoint.prototype.reaction = function () {
    this.path.update();
    return { force: this.path.forceOn(this.bodyB, this.tensionA()), torque: 0 };
  };

  /* -------------------------------------------------------- block and tackle */
  function end(e) { return { body: e.body || null, local: e.localAnchor ? M.v(e.localAnchor.x, e.localAnchor.y) : M.v(0, 0) }; }

  function tackle(world, o) {
    var n = o.n || 2, block = end(o.block), load = end(o.load);
    var blockPoint = block.body ? block.body.worldPoint(block.local) : block.local;
    var j;
    if (o.winch) {
      var def = Object.assign({}, o.winch, {
        bodyA: o.winch.body, localAnchorA: o.winch.localAnchor,
        bodyB: load.body, localAnchorB: load.local,
        via: block, parts: n
      });
      delete def.body; delete def.localAnchor;
      j = new P.WinchJoint(def);
    } else {
      var haul = end(o.haul);
      j = new PulleyJoint({
        bodyA: haul.body, localAnchorA: haul.local, groundAnchorA: blockPoint,
        bodyB: load.body, localAnchorB: load.local, groundAnchorB: blockPoint,
        ratio: n, EA: o.EA, breakForce: o.breakForce, label: o.label
      });
    }
    j.mechanicalAdvantage = n;
    if (world) world.addJoint(j);
    return j;
  }

  // scenes (serialize.js) rebuild a pulley from these definition fields
  (P.jointTypes = P.jointTypes || {}).pulley = { ctor: PulleyJoint,
    fields: ['groundAnchorA', 'groundAnchorB', 'ratio', 'length', 'EA', 'dampingRatio'] };

  P.RopePath = RopePath;
  P.solveLine = solveLine;
  P.lineSpring = lineSpring;
  P.PulleyJoint = PulleyJoint;
  P.pulley = { tackle: tackle };
})(globalThis.SE);
