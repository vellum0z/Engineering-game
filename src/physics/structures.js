/*
 * Structures: beams and trusses built from ordinary bodies, so the same world
 * that drops crates also bends beams and loads truss members.
 *
 * Sections
 *   P.section.rect(b, h)  P.section.circle(d)  P.section.tube(dOut, dIn)
 *   P.section.custom({ A, I, c, depth })
 * return { A (m²), I (m⁴, about the bending axis), c (m, centroid to outer
 * fibre), S = I/c (m³), depth (m, drawn thickness) }.
 *
 * Beams
 *   var bm = P.structures.beam(world, {
 *     start: {x, y}, end: {x, y}, section: { b, h } | { I, A, c },
 *     material: 'steel', segments: 20, damping: 0.02,
 *     supports: [{ at: 'start' | 'end' | x, type: 'fixed' | 'pin' | 'roller', normal }],
 *     ground,             // static body the supports attach to (one is made if omitted)
 *     massPerLength       // kg/m, default density·A
 *   });
 * The beam is a chain of N rigid segments (a Hencky bar chain). Neighbouring
 * segments are welded with an angular spring k = EI/Δ (Δ = L/N): a segment of
 * length Δ under moment M turns by MΔ/EI, so the spring stores exactly the
 * curvature that piece of beam would. A fixed support stands for half a
 * segment of flexibility, so its spring is 2EI/Δ. With that end correction
 * the chain reproduces Euler–Bernoulli deflections to O(1/N²):
 *   cantilever, tip load:      PL³/(3EI) · (1 + 1/(2N²))   (+0.13 % at N = 20)
 *   simple span, centre load:  PL³/(48EI) · (1 + 2/N²)     (+0.5 % at N = 20)
 * The welds' point part is elastic too, with the segment's axial (EA/Δ) and
 * shear (κGA/Δ, κ = 5/6) stiffness, i.e. a Timoshenko beam; for ordinary
 * proportions that adds well under 1 % to the bending deflection.
 *
 * The section's limits: moment σ_y·S (outer fibre yields), axial σ_y·A,
 * shear σ_y/√3 · A/1.5 (peak shear in a rectangle is 1.5·V/A). breakage.js
 * checks every weld against them and reports 'moment', 'tension' or 'force'.
 *
 * The returned beam has
 *   bodies, links (index = station 0..N; null where nothing joins),
 *   supports [{ joint, station, type }], length, dx, EI, limits
 *   bendingMoment(i)  internal moment at station i (x = i·Δ), N·m, Hibbeler's
 *                     sign: positive sags (compresses the side the normal
 *                     points to, the top of a left-to-right beam)
 *   shearForce(i)     N, Hibbeler's sign (up on the end side's cut face)
 *   axialForce(i)     N, + tension
 *   deflection(x)     displacement of the centreline at distance x from the
 *                     start, along the left normal (up for left-to-right), m
 *   load(x, F)        a load re-applied every step; returns { x, F } whose F
 *                     (N vector) can be changed; clearLoads()
 *
 * Trusses
 *   var tr = P.structures.truss(world, {
 *     nodes: [{x, y}...], members: [[i, j]...], material, area,
 *     I,                  // for buckling; default solid round bar A²/(4π)
 *     supports: [{ node, type: 'pin' | 'roller', normal }],
 *     nodeMass, ground
 *   });
 * Nodes are small bodies (gusset plates); each member is a slender body
 * pinned to its two nodes, so it can carry force only along its axis (a
 * two-force member). Each pin is elastic with stiffness 2EA/L, so the two
 * pins in series stretch like the bar (EA/L); statically indeterminate
 * trusses therefore share load by stiffness, as real ones do.
 *   tr.memberForce(i)   signed axial force from the pin reactions, + tension
 *   tr.reaction(k)      force on the truss from support k (N vector)
 *   tr.load(node, F), tr.clearLoads(), tr.nodes, tr.members[{ a, b, body,
 *   pins, length, limits: { tension, compression, crushing, buckling }, broken }]
 * Members fail in tension at σ_y·A and in compression at min(σ_y·A, π²EI/L²).
 *
 * How it is solved. A steel beam cut into 20 segments is far too stiff for
 * the world's one-pass Gauss–Seidel joints: its welds would ring at several
 * kHz against a 240 Hz substep, and the beam either sags like rope or blows
 * up. So each structure adds one StructureSolver to world.joints, which
 * solves all its connections together, exactly, every substep. Every
 * connection is an implicit (backward Euler) spring row:
 *   (J M⁻¹ Jᵀ + Γ) Δλ = -(J v + β C) - Γ λ,    Γ = 1/(h(hk + c)),  β = k/(hk + c)
 * which is Box2D's soft constraint written for the whole structure at once.
 * The matrix is factored once per substep (LDLᵀ over the profile, so a
 * beam's banded matrix costs O(N)) and back-substituted in each solve. Implicit
 * springs are stable at any stiffness, and at rest λ = -h(kC) exactly, so
 * the steady state is the real elastic structure.
 *
 * The connections themselves are Link joints in world.joints, so contact
 * filtering, breakage, sensors and 'break' events see ordinary joints with
 * force(), torque(), reaction() and anchors; their own solve() is empty.
 * Removing a link (breakage does) takes its rows out on the next step.
 *
 * Saving: each structure keeps `def`, a JSON copy of its build definition
 * (ground left out), and its solver and links are flagged `internal` /
 * part-of-structure, so a scene file can store the call instead of the
 * bodies and joints it made.
 *
 * Supports: 'fixed' welds to ground, 'pin' holds a point, 'roller' holds a
 * point only along `normal` (default: the beam's normal, or straight up for
 * a truss) and leaves it free to slide and turn. P.LineSupport is the same
 * roller as a stand-alone joint for parts that are not structures.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var groupSeq = 0x5e000;
  var NU = 0.3, KAPPA = 5 / 6;      // Poisson's ratio, shear coefficient

  /* ------------------------------------------------------------- sections */
  function done(s) { s.S = s.I / s.c; s.depth = s.depth || 2 * s.c; return s; }
  var section = {
    rect: function (b, h) { return done({ A: b * h, I: b * h * h * h / 12, c: h / 2, depth: h, b: b, h: h }); },
    circle: function (d) { return done({ A: Math.PI * d * d / 4, I: Math.PI * Math.pow(d, 4) / 64, c: d / 2, depth: d }); },
    tube: function (dOut, dIn) {
      return done({ A: Math.PI * (dOut * dOut - dIn * dIn) / 4, I: Math.PI * (Math.pow(dOut, 4) - Math.pow(dIn, 4)) / 64, c: dOut / 2, depth: dOut });
    },
    custom: function (s) { return done({ A: s.A, I: s.I, c: s.c != null ? s.c : (s.depth || 0.1) / 2, depth: s.depth }); }
  };
  function toSection(s) {
    if (!s) return section.rect(0.1, 0.2);
    if (s.S != null && s.A != null && s.I != null) return s;
    if (s.I != null) return section.custom(s);
    if (s.d != null) return section.circle(s.d);
    return section.rect(s.b, s.h);
  }

  /* ----------------------------------------------------------------- links */
  // One connection inside a structure.
  //   type 'weld'   point (2 rows) + angle (1 row)
  //        'pin'    point (2 rows)
  //        'roller' point along one normal (1 row)
  // Point rows run along two directions fixed in body A (axis, normal), or
  // world x/y when no axis is given. k = [k along axis, k along normal,
  // k angular], c the same for damping.
  function Link(def) {
    P.Joint.call(this, def);
    this.type = def.type;
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    var ax = M.norm(def.axis || M.v(1, 0));
    this.localAxisA = M.invRotate(this.bodyA.q, ax);
    this.referenceAngle = this.bodyB.angle - this.bodyA.angle;
    this.k = def.k; this.c = def.c || [0, 0, 0];
    this.lambda = [0, 0, 0];
    this.part = def.part || null;
    this.limits = def.limits || null;
    this.bIsEnd = def.bIsEnd !== false;
    this.invH = 0;
    var self = this, n = def.type === 'weld' ? 3 : def.type === 'pin' ? 2 : 1;
    this.rows = [];
    for (var i = 0; i < n; i++) {
      // roller: its one row is along the normal (component 1)
      var comp = def.type === 'roller' ? 1 : i;
      this.rows.push({ link: self, comp: comp, A: this.bodyA, B: this.bodyB,
        ax: 0, ay: 0, aw: 0, bx: 0, by: 0, bw: 0, C: 0, gamma: 0, beta: 0, index: 0 });
    }
  }
  Link.prototype = Object.create(P.Joint.prototype);
  Link.prototype.prepare = function () {};
  Link.prototype.warmStart = function () {};
  Link.prototype.solve = function () {};

  // Refresh the rows' Jacobians and position errors from the current state.
  Link.prototype.updateRows = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    var ux = M.rotate(A.q, this.localAxisA), d = M.sub(b.p, a.p);
    var rA = this.type === 'roller' ? M.add(a.r, d) : a.r, rB = b.r;
    for (var i = 0; i < this.rows.length; i++) {
      var row = this.rows[i];
      if (row.comp === 2) {
        row.ax = 0; row.ay = 0; row.aw = -1; row.bx = 0; row.by = 0; row.bw = 1;
        row.C = B.angle - A.angle - this.referenceAngle;
      } else {
        var n = row.comp === 0 ? ux : M.perp(ux);
        row.ax = -n.x; row.ay = -n.y; row.aw = -M.cross(rA, n);
        row.bx = n.x; row.by = n.y; row.bw = M.cross(rB, n);
        row.C = M.dot(n, d);
      }
    }
  };

  // Constraint force on body B (N) and torque (N·m).
  Link.prototype.reaction = function () {
    var ux = M.rotate(this.bodyA.q, this.localAxisA), nx = M.perp(ux), l = this.lambda, s = this.invH;
    return { force: M.v((l[0] * ux.x + l[1] * nx.x) * s, (l[0] * ux.y + l[1] * nx.y) * s), torque: l[2] * s };
  };
  Link.prototype.force = function () { return M.len(this.reaction().force); };
  Link.prototype.torque = function () { return this.lambda[2] * this.invH; };

  // Section forces at a beam link: moment, axial (+ tension), shear (Hibbeler signs).
  // bIsEnd: body B is on the end side of the cut (false for a support at the end).
  Link.prototype.loads = function () {
    var r = this.reaction(), sg = this.bIsEnd ? 1 : -1;
    var F = M.scale(r.force, sg);          // start side on end side
    var ux = M.rotate(this.bodyA.q, this.localAxisA), nx = M.perp(ux);
    return { moment: -sg * r.torque, axial: -M.dot(F, ux), shear: M.dot(F, nx) };
  };

  /* --------------------------------------------------- the direct solver */
  function StructureSolver(structure, links, world) {
    var b0 = links[0].bodyB;
    P.Joint.call(this, { bodyA: b0, bodyB: b0, collideConnected: true, label: structure.label + ':solver' });
    this.type = 'structure';
    this.internal = true;
    this.structure = structure;
    this.links = links;
    this.world = world;
    this.rows = [];
    this.n = 0;
    this.K = null; this.first = null; this.D = null; this.x = null;
  }
  StructureSolver.prototype = Object.create(P.Joint.prototype);
  StructureSolver.prototype.force = function () { return 0; };

  StructureSolver.prototype.prepare = function (h) {
    var world = this.world, inWorld = new Set(world.joints), rows = [];
    this.invH = 1 / h;
    this.links.forEach(function (l) {
      if (l.broken || !inWorld.has(l)) { l.broken = true; return; }
      l.invH = 1 / h;
      l.updateRows();
      l.rows.forEach(function (row) {
        var k = l.k[row.comp], c = l.c[row.comp], den = h * k + c;
        row.gamma = 1 / (h * den);
        row.beta = k / den;
        row.index = rows.length;
        rows.push(row);
      });
    });
    this.rows = rows; this.n = rows.length;
  };

  // Build K = J M⁻¹ Jᵀ + Γ from the current geometry and factor it. Done at
  // the start of every substep: a structure that is spinning (say a beam
  // knocked loose) turns too far within one step for a step-old matrix.
  StructureSolver.prototype.factor = function () {
    var rows = this.rows, n = this.n;
    if (!n) return;
    if (!this.K || this.K.length < n * n) {
      this.K = new Float64Array(n * n); this.D = new Float64Array(n);
      this.first = new Int32Array(n); this.x = new Float64Array(n);
    } else this.K.fill(0, 0, n * n);
    var K = this.K, first = this.first;
    for (var i = 0; i < n; i++) first[i] = i;
    // K = J M⁻¹ Jᵀ, accumulated body by body over the rows touching it
    var byBody = new Map();
    rows.forEach(function (row) {
      [[row.A, 0], [row.B, 1]].forEach(function (e) {
        var body = e[0];
        if (body.invM === 0 && body.invI === 0) return;
        var list = byBody.get(body); if (!list) byBody.set(body, list = []);
        list.push({ i: row.index, x: e[1] ? row.bx : row.ax, y: e[1] ? row.by : row.ay, w: e[1] ? row.bw : row.aw });
      });
    });
    byBody.forEach(function (list, body) {
      for (var p = 0; p < list.length; p++) {
        for (var q = 0; q <= p; q++) {
          var u = list[p], v = list[q];
          var val = body.invM * (u.x * v.x + u.y * v.y) + body.invI * u.w * v.w;
          var r = Math.max(u.i, v.i), cc = Math.min(u.i, v.i);
          K[r * n + cc] += val;
          if (cc < first[r]) first[r] = cc;
        }
      }
    });
    for (i = 0; i < n; i++) K[i * n + i] += rows[i].gamma;
    // LDLᵀ inside the profile (row i only has entries from first[i] on;
    // fill-in stays inside that envelope)
    var D = this.D;
    for (i = 0; i < n; i++) {
      var fi = first[i];
      for (var j = fi; j <= i; j++) {
        var s = K[i * n + j], k0 = Math.max(fi, first[j]);
        for (var k = k0; k < j; k++) s -= K[i * n + k] * D[k] * K[j * n + k];
        if (j < i) K[i * n + j] = s / D[j];
        else D[i] = s > 1e-300 ? s : 1e-300;
      }
    }
  };

  function applyRow(row, imp) {
    var A = row.A, B = row.B;
    if (A.invM || A.invI) { A.v = M.v(A.v.x + A.invM * row.ax * imp, A.v.y + A.invM * row.ay * imp); A.w += A.invI * row.aw * imp; }
    if (B.invM || B.invI) { B.v = M.v(B.v.x + B.invM * row.bx * imp, B.v.y + B.invM * row.by * imp); B.w += B.invI * row.bw * imp; }
  }

  StructureSolver.prototype.warmStart = function () {
    var rows = this.rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].link.rows[0] === rows[i]) rows[i].link.updateRows();
    this.factor();
    for (i = 0; i < rows.length; i++) applyRow(rows[i], rows[i].link.lambda[rows[i].comp]);
  };

  StructureSolver.prototype.solve = function () {
    var rows = this.rows, n = this.n, K = this.K, D = this.D, first = this.first, x = this.x;
    if (!n) return;
    var i, k;
    for (i = 0; i < n; i++) {
      var row = rows[i];
      if (row.link.rows[0] === row) row.link.updateRows();
      var A = row.A, B = row.B;
      var Cdot = row.ax * A.v.x + row.ay * A.v.y + row.aw * A.w + row.bx * B.v.x + row.by * B.v.y + row.bw * B.w;
      x[i] = -(Cdot + row.beta * row.C) - row.gamma * row.link.lambda[row.comp];
    }
    // L y = b, D z = y, Lᵀ x = z
    for (i = 0; i < n; i++) { var s = x[i]; for (k = first[i]; k < i; k++) s -= K[i * n + k] * x[k]; x[i] = s; }
    for (i = 0; i < n; i++) x[i] /= D[i];
    for (i = n - 1; i >= 0; i--) { var xi = x[i]; for (k = first[i]; k < i; k++) x[k] -= K[i * n + k] * xi; }
    for (i = 0; i < n; i++) {
      rows[i].link.lambda[rows[i].comp] += x[i];
      applyRow(rows[i], x[i]);
    }
  };

  /* ------------------------------------------------------- roller support */
  // Stand-alone point-on-line joint for ordinary parts: the anchor on B stays
  // on the line through A's anchor with normal `normal` (fixed to A).
  //   new P.LineSupport({ bodyA, bodyB, worldAnchor | localAnchorA/B, normal })
  function LineSupport(def) {
    P.Joint.call(this, def);
    this.type = 'roller';
    if (def.worldAnchor) {
      this.localAnchorA = this.bodyA.localPoint(def.worldAnchor);
      this.localAnchorB = this.bodyB.localPoint(def.worldAnchor);
    }
    this.localNormalA = M.invRotate(this.bodyA.q, M.norm(def.normal || M.v(0, 1)));
    this.impulse = 0;
  }
  LineSupport.prototype = Object.create(P.Joint.prototype);
  LineSupport.prototype.geometry = function () {
    var A = this.bodyA, B = this.bodyB;
    var a = this.frame(A, this.localAnchorA), b = this.frame(B, this.localAnchorB);
    var d = M.sub(b.p, a.p), n = M.rotate(A.q, this.localNormalA);
    return { rA: M.add(a.r, d), rB: b.r, n: n, C: M.dot(n, d) };
  };
  LineSupport.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
  };
  LineSupport.prototype.warmStart = function () {
    var g = this.geometry();
    P.applyPair(this.bodyA, this.bodyB, g.rA, g.rB, M.scale(g.n, this.impulse));
  };
  LineSupport.prototype.solve = function (h, useBias) {
    var A = this.bodyA, B = this.bodyB, g = this.geometry();
    var cA = M.cross(g.rA, g.n), cB = M.cross(g.rB, g.n);
    var k = A.invM + B.invM + A.invI * cA * cA + B.invI * cB * cB;
    if (k <= 0) return;
    var Cdot = M.dot(g.n, P.relVel(A, B, g.rA, g.rB)), bias = 0, ms = 1, is = 0;
    if (useBias) { bias = this.jointSoft.biasRate * g.C; ms = this.jointSoft.massScale; is = this.jointSoft.impulseScale; }
    var imp = -(ms / k) * (Cdot + bias) - is * this.impulse;
    this.impulse += imp;
    P.applyPair(A, B, g.rA, g.rB, M.scale(g.n, imp));
  };
  LineSupport.prototype.force = function () { return Math.abs(this.impulse) * this.invH; };
  LineSupport.prototype.reaction = function () {
    return { force: M.scale(M.rotate(this.bodyA.q, this.localNormalA), this.impulse * this.invH), torque: 0 };
  };

  /* ---------------------------------------------------------------- shared */
  function groundFor(world, def) {
    if (def.ground) return def.ground;
    return world.add(new P.Body({ type: 'static', position: M.v(0, 0), label: 'ground' }));
  }
  // The build definition without the ground body, so a scene file can save
  // a structure as the call that made it and rebuild it.
  function plainDef(def) {
    var o = {};
    Object.keys(def).forEach(function (k) { if (k !== 'ground') o[k] = def[k]; });
    var mat = def.material;
    if (mat && typeof mat === 'object') o.material = mat.name;
    return JSON.parse(JSON.stringify(o));
  }
  function finish(world, s, links, def) {
    s.def = plainDef(def);
    links.forEach(function (l) { world.addJoint(l); });
    s.solver = world.addJoint(new StructureSolver(s, links, world));
    (world.structures = world.structures || []).push(s);
    // Loads are plain forces, cleared after every step: put them back.
    world.on('step', function () { s.applyLoads(); });
    return s;
  }
  function loadsApi(s, pointOf) {
    s.loads = [];
    s.applyLoads = function () {
      s.loads.forEach(function (ld) {
        var at = pointOf(ld);
        if (at && (ld.F.x || ld.F.y)) at.body.applyForce(ld.F, at.point);
      });
    };
    s.clearLoads = function () { s.loads.length = 0; };
  }

  /* ------------------------------------------------------------------ beam */
  function beam(world, def) {
    var mat = P.material(def.material || 'steel');
    var sec = toSection(def.section);
    var N = Math.max(1, def.segments || 20);
    var p0 = M.v(def.start.x, def.start.y), p1 = M.v(def.end.x, def.end.y);
    var L = M.dist(p0, p1), u = M.norm(M.sub(p1, p0)), n = M.perp(u), angle = Math.atan2(u.y, u.x);
    var dx = L / N, E = mat.E, G = E / (2 * (1 + NU));
    var EI = E * sec.I, kBend = EI / dx, kAx = E * sec.A / dx, kSh = KAPPA * G * sec.A / dx;
    var mSeg = (def.massPerLength != null ? def.massPerLength : mat.density * sec.A) * dx;
    var zeta = def.damping != null ? def.damping : 0.02;
    var group = def.group || ++groupSeq;
    var limits = { moment: mat.yield * sec.S, axial: mat.yield * sec.A, shear: mat.yield / Math.sqrt(3) * sec.A / 1.5 };
    var s = { kind: 'beam', label: def.label || 'beam', material: mat, section: sec, length: L, dx: dx, EI: EI,
      segments: N, start: p0, end: p1, axis: u, normal: n, limits: limits, bodies: [], links: [], supports: [] };
    var stationPoint = function (i) { return M.mulAdd(p0, i * dx, u); };

    for (var i = 0; i < N; i++) {
      s.bodies.push(world.add(new P.Body({
        position: M.mulAdd(p0, (i + 0.5) * dx, u), angle: angle,
        shapes: [{ shape: P.box(dx / 2, sec.depth / 2), material: mat, group: group }],
        mass: mSeg, label: s.label + '#' + i, userData: { structure: s, index: i }
      })));
    }
    var links = [];
    function link(type, A, B, station, f, bIsEnd, normal) {
      var J = 1 / ((A.invI + B.invI) || 1);
      var kA = f * kBend;
      var l = new Link({ type: type, bodyA: A, bodyB: B, worldAnchor: stationPoint(station),
        axis: type === 'roller' ? M.rightPerp(normal) : u,       // roller row runs along perp(axis) = normal
        k: [f * kAx, f * kSh, kA], c: [0, 0, 2 * zeta * Math.sqrt(kA * J)],
        part: { structure: s, index: station, kind: 'beam' }, limits: limits, bIsEnd: bIsEnd,
        label: s.label + ':' + type + '@' + station });
      links.push(l);
      return l;
    }
    s.links[0] = null; s.links[N] = null;
    for (var st = 1; st < N; st++) s.links[st] = link('weld', s.bodies[st - 1], s.bodies[st], st, 1, true);

    var ground = (def.supports && def.supports.length) ? groundFor(world, def) : null;
    s.ground = ground;
    (def.supports || []).forEach(function (sp) {
      var x = sp.at === 'start' ? 0 : sp.at === 'end' ? L : (sp.x != null ? sp.x : sp.at);
      var station = Math.max(0, Math.min(N, Math.round(x / dx)));
      var type = sp.type === 'fixed' ? 'weld' : (sp.type || 'pin');
      var atEnd = station === N;
      var seg = s.bodies[atEnd ? N - 1 : station];
      // half a segment of beam between the support and the first weld
      var l = link(type, ground, seg, station, 2, !atEnd, sp.normal ? M.norm(sp.normal) : n);
      s.supports.push({ joint: l, station: station, type: sp.type || 'pin' });
      if ((station === 0 || atEnd) && !s.links[station]) s.links[station] = l;
    });

    function live(l) { return l && !l.broken; }
    s.bendingMoment = function (i) { var l = s.links[i]; return live(l) && l.type === 'weld' ? l.loads().moment : 0; };
    s.axialForce = function (i) { var l = s.links[i]; return live(l) ? l.loads().axial : 0; };
    s.shearForce = function (i) { var l = s.links[i]; return live(l) ? l.loads().shear : 0; };
    s.pointAt = function (x) {
      var k = Math.max(0, Math.min(N - 1, Math.floor(x / dx)));
      return { body: s.bodies[k], point: s.bodies[k].worldPoint(M.v(x - (k + 0.5) * dx, 0)) };
    };
    s.deflection = function (x) { return M.dot(M.sub(s.pointAt(x).point, M.mulAdd(p0, x, u)), n); };
    loadsApi(s, function (ld) { return s.pointAt(ld.x); });
    s.load = function (x, F) {
      var ld = { x: x, F: M.v(F.x, F.y) };
      s.loads.push(ld);
      var at = s.pointAt(x); at.body.applyForce(ld.F, at.point);
      return ld;
    };
    return finish(world, s, links, def);
  }

  /* ----------------------------------------------------------------- truss */
  function truss(world, def) {
    var mat = P.material(def.material || 'steel');
    var A = def.area || 1e-3;
    var I = def.I != null ? def.I : A * A / (4 * Math.PI);       // solid round bar
    var depth = def.depth || Math.sqrt(4 * A / Math.PI);
    var group = def.group || ++groupSeq;
    var s = { kind: 'truss', label: def.label || 'truss', material: mat, area: A, I: I,
      nodes: [], members: [], supports: [] };
    var pts = def.nodes.map(function (p) { return M.v(p.x, p.y); });
    var attached = pts.map(function () { return 0; });
    var defs = def.members.map(function (m) {
      var a = Array.isArray(m) ? m[0] : m.a, b = Array.isArray(m) ? m[1] : m.b;
      var len = M.dist(pts[a], pts[b]), mass = mat.density * A * len;
      attached[a] += mass; attached[b] += mass;
      return { a: a, b: b, length: len, mass: mass };
    });
    var rNode = Math.max(0.04, 0.8 * depth);
    s.nodes = pts.map(function (p, i) {
      // a gusset plate weighs roughly a tenth of what frames into it
      var mass = def.nodeMass != null ? def.nodeMass : Math.max(0.1, 0.1 * attached[i]);
      return world.add(new P.Body({ position: p, shapes: [{ shape: P.circle(rNode), material: mat, group: group }],
        mass: mass, label: s.label + ':n' + i, userData: { structure: s, node: i } }));
    });
    var links = [], kMax = 0;
    s.members = defs.map(function (m, i) {
      var pa = pts[m.a], pb = pts[m.b], ax = M.norm(M.sub(pb, pa));
      var body = world.add(new P.Body({
        position: M.lerp(pa, pb, 0.5), angle: Math.atan2(ax.y, ax.x),
        shapes: [{ shape: P.box(m.length / 2, depth / 2), material: mat, group: group }],
        mass: m.mass, label: s.label + ':m' + i, userData: { structure: s, index: i }
      }));
      var kPin = 2 * mat.E * A / m.length;           // two pins in series = EA/L
      kMax = Math.max(kMax, kPin);
      var pins = [[m.a, pa], [m.b, pb]].map(function (e) {
        var l = new Link({ type: 'pin', bodyA: s.nodes[e[0]], bodyB: body, worldAnchor: e[1], k: [kPin, kPin, 0],
          part: { structure: s, index: i, kind: 'member' }, label: s.label + ':m' + i + '@n' + e[0] });
        links.push(l);
        return l;
      });
      var crush = mat.yield * A, euler = P.rating.buckling(mat, I, m.length);
      return { a: m.a, b: m.b, body: body, pins: pins, length: m.length, broken: false,
        limits: { tension: mat.yield * A, compression: Math.min(crush, euler), crushing: crush, buckling: euler } };
    });

    var ground = (def.supports && def.supports.length) ? groundFor(world, def) : null;
    s.ground = ground;
    (def.supports || []).forEach(function (sp) {
      var type = sp.type === 'roller' ? 'roller' : 'pin';
      var nrm = M.norm(sp.normal || M.v(0, 1)), kS = 10 * kMax;   // foundations: stiffer than any member
      var l = new Link({ type: type, bodyA: ground, bodyB: s.nodes[sp.node], worldAnchor: pts[sp.node],
        axis: type === 'roller' ? M.rightPerp(nrm) : M.v(1, 0), k: [kS, kS, 0],
        part: { structure: s, index: sp.node, kind: 'support' }, label: s.label + ':' + type + '@n' + sp.node });
      links.push(l);
      s.supports.push({ joint: l, node: sp.node, type: type });
    });

    // Signed axial force, + tension. Each pin's reaction is the force on the
    // member at that end; tension pulls each end toward its node, away from
    // the other end. Averaging both ends cancels the member's own weight,
    // which the pins share as shear.
    s.memberForce = function (i) {
      var m = s.members[i];
      if (m.broken) return 0;
      var ea = m.pins[0].anchorB(), eb = m.pins[1].anchorB(), ax = M.norm(M.sub(eb, ea));
      var Fa = m.pins[0].reaction().force, Fb = m.pins[1].reaction().force;
      return 0.5 * (-M.dot(Fa, ax) + M.dot(Fb, ax));
    };
    s.reaction = function (k) { return s.supports[k].joint.reaction().force; };
    loadsApi(s, function (ld) { var b = s.nodes[ld.node]; return { body: b, point: b.c }; });
    s.load = function (node, F) {
      var ld = { node: node, F: M.v(F.x, F.y) };
      s.loads.push(ld);
      s.nodes[node].applyForce(ld.F);
      return ld;
    };
    // Called by breakage.js: take a failed member out of the truss.
    s.release = function (i) {
      var m = s.members[i];
      m.broken = true;
      m.pins.forEach(function (j) { j.broken = true; world.removeJoint(j); });
    };
    return finish(world, s, links, def);
  }

  P.section = section;
  P.LineSupport = LineSupport;
  P.StructureLink = Link;
  P.StructureSolver = StructureSolver;
  P.structures = { beam: beam, truss: truss };
})(globalThis.SE);
