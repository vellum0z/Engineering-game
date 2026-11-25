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
 * Outside parts. Ropes, rods and springs (DistanceJoint), pins, welds and
 * sliders (the E04 block joints) and contacts that touch a structure body
 * are taken into the same solve each step, so a stay, a prop or a hung load
 * is as stiff as the beam it acts on instead of a soft one-pass joint on a
 * 0.5 kg segment. Ropes and contacts are one-sided rows (λ ≥ 0, friction
 * |λt| ≤ μλn), solved by projected Gauss–Seidel on their Schur complement
 * while the beam's own rows stay exact. Bodies pinned or rodded to the
 * structure count as part of it; contacts between two such bodies, deep
 * overlaps and impacts are taken as stiff springs instead of hard rows so
 * nothing is pushed apart at once. world.structureCoupling = false turns
 * this off and leaves those parts to their own solvers.
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
  var DEEP_OVERLAP = 0.02;          // m: deeper contacts get the soft contact push
  var RIGID_EPS = 1e-6;             // relative compliance of rigid rows
  var REFACTOR_ANGLE = 0.01;        // rad a body may turn before the relax pass refactors

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
      var row = newRow('link', this.bodyA, this.bodyB);
      row.link = self; row.comp = def.type === 'roller' ? 1 : i;
      this.rows.push(row);
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
      var row = this.rows[i], ja = row.ja, jb = row.jb;
      if (row.comp === 2) {
        ja[0] = 0; ja[1] = 0; ja[2] = -1; jb[0] = 0; jb[1] = 0; jb[2] = 1;
        row.C = B.angle - A.angle - this.referenceAngle;
      } else {
        var n = row.comp === 0 ? ux : M.perp(ux);
        ja[0] = -n.x; ja[1] = -n.y; ja[2] = -M.cross(rA, n);
        jb[0] = n.x; jb[1] = n.y; jb[2] = M.cross(rB, n);
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

  /* ------------------------------------------------------------------ rows */
  // A scalar constraint row: Jacobians ja / jb ([x, y, angular] for bodies
  // A and B), position error C, and how it is solved:
  //   mode 'spring'  implicit spring k, c (Γ, β below), both passes
  //        'rigid'   Γ = 0, soft position correction in the biased pass
  //        'uni'     like rigid but its total impulse stays >= 0, and an
  //                  open gap (C > 0) may close this substep, not overshoot
  //        'uniSpring' a spring that only pulls or pushes (λ >= 0)
  //        'friction' |λ| <= μ λ(normal row), drives the slip speed to `target`
  function newRow(kind, A, B) {
    return { kind: kind, A: A, B: B, ja: [0, 0, 0], jb: [0, 0, 0], C: 0, drift: 0, mode: 'spring',
      k: 0, c: 0, gamma: 0, beta: 0, target: 0, mu: 0, normal: null, index: 0, x: 0 };
  }
  function isDyn(b) { return b.type === 'dynamic' && b.awake !== false && (b.invM > 0 || b.invI > 0); }

  function rowLambda(r) {
    switch (r.kind) {
      case 'link': return r.link.lambda[r.comp];
      case 'block': return r.joint.blockImpulse(r.slot);
      case 'dist': return r.joint._sLambda;
      case 'cn': return r.cp.normalImpulse;
      default: return r.cp.tangentImpulse;      // 'ct'
    }
  }
  function rowAdd(r, d) {
    switch (r.kind) {
      case 'link': r.link.lambda[r.comp] += d; break;
      case 'block': r.joint.blockAdd(r.slot, d); break;
      case 'dist': r.joint._sLambda += d; break;
      case 'cn':
        r.cp.normalImpulse += d;
        if (d > r.cp.maxNormalImpulse) r.cp.maxNormalImpulse = d;
        if (d > 0) r.cp.totalNormalImpulse += d;
        break;
      default: r.cp.tangentImpulse += d;
    }
  }
  function rowVel(r) {
    var A = r.A, B = r.B, ja = r.ja, jb = r.jb;
    return ja[0] * A.v.x + ja[1] * A.v.y + ja[2] * A.w + jb[0] * B.v.x + jb[1] * B.v.y + jb[2] * B.w;
  }
  function rowApply(r, d) {
    var A = r.A, B = r.B;
    if (isDyn(A)) { A.v = M.v(A.v.x + A.invM * r.ja[0] * d, A.v.y + A.invM * r.ja[1] * d); A.w += A.invI * r.ja[2] * d; }
    if (isDyn(B)) { B.v = M.v(B.v.x + B.invM * r.jb[0] * d, B.v.y + B.invM * r.jb[1] * d); B.w += B.invI * r.jb[2] * d; }
  }
  // One entry of J M⁻¹ Jᵀ between rows p and q.
  function entry(p, q) {
    var s = 0;
    for (var ip = 0; ip < 2; ip++) {
      var b = ip ? p.B : p.A;
      if (!isDyn(b)) continue;
      var jp = ip ? p.jb : p.ja;
      if (q.A === b) s += b.invM * (jp[0] * q.ja[0] + jp[1] * q.ja[1]) + b.invI * jp[2] * q.ja[2];
      if (q.B === b) s += b.invM * (jp[0] * q.jb[0] + jp[1] * q.jb[1]) + b.invI * jp[2] * q.jb[2];
    }
    return s;
  }

  // A rope whose far end is a node of a longer line (a cable's last link)
  // is left to the line blocks (pulley.js), which solve the whole line
  // directly; taking only its last link would split the line between two
  // solvers that fight over the light node.
  function lineNode(world, j, bodies) {
    var o = bodies.has(j.bodyA) ? j.bodyB : j.bodyA;
    if (!o || o.type !== 'dynamic' || bodies.has(o)) return false;
    for (var i = 0; i < world.joints.length; i++) {
      var k = world.joints[i];
      if (k !== j && !k.broken && (k.bodyA === o || k.bodyB === o) && (k.type === 'distance' || k.type === 'winch' || k.type === 'pulley')) return true;
    }
    return false;
  }
  // Distance joints the solver can take over: rods, inextensible ropes and
  // springs given by a stiffness (k or EA). Motors, extra limits and
  // frequency-only springs stay with the joint.
  function distMode(j) {
    if (j.maxMotorForce > 0) return null;
    if (!j.spring) {
      if (j.isRigid()) return { mode: 'rigid', sign: 1 };
      if (j.rope && j.minLength <= 0 && j.maxLength < Infinity) return { mode: 'uni', sign: -1 };
      return null;
    }
    if (!(j.stiffness > 0) || j.minLength > 0) return null;
    if (j.rope) return { mode: 'uniSpring', sign: -1 };
    return j.maxLength === Infinity ? { mode: 'spring', sign: 1 } : null;
  }
  // Rows of a taken-over distance joint, along the line A -> B times sign
  // (sign -1 for a rope, so its impulse is the pull and stays >= 0).
  function distUpdate(r) {
    var j = r.joint, g = j.geometry(), s = r.sign, u = g.axis;
    r.ja[0] = -s * u.x; r.ja[1] = -s * u.y; r.ja[2] = -s * M.cross(g.rA, u);
    r.jb[0] = s * u.x; r.jb[1] = s * u.y; r.jb[2] = s * M.cross(g.rB, u);
    var target = r.mode === 'uni' ? j.maxLength : j.length;
    r.C = s * (g.L - target);
  }
  // Store the solver's impulse where the joint's own readouts find it.
  function distWrite(j, sign) {
    var axial = sign * j._sLambda;          // impulse on B along A -> B
    j.impulse = 0; j.springImpulse = 0; j.lowerImpulse = 0; j.upperImpulse = 0; j.motorImpulse = 0;
    if (j.rope) j.upperImpulse = -axial;
    else if (j.isRigid() || j.stiff) j.impulse = axial;
    else j.springImpulse = axial;
    j.linePeak = 0;
  }
  // Contact point rows, using the contact solver's anchors from the start of
  // the step and its rebuilt separation (see contact.js).
  function contactUpdate(r) {
    var ct = r.ct, cp = r.cp, A = r.A, B = r.B, n = ct.normal;
    var d = r.kind === 'cn' ? n : ct.tangent, rA = cp.rA, rB = cp.rB;
    r.ja[0] = -d.x; r.ja[1] = -d.y; r.ja[2] = -M.cross(rA, d);
    r.jb[0] = d.x; r.jb[1] = d.y; r.jb[2] = M.cross(rB, d);
    if (r.kind === 'cn') {
      var dA = M.add(M.sub(A.c, A.c0), M.rotate(M.rot(A.angle - A.angle0), rA));
      var dB = M.add(M.sub(B.c, B.c0), M.rotate(M.rot(B.angle - B.angle0), rB));
      r.C = M.dot(M.sub(dB, dA), n) + cp.adjustedSeparation;
    } else {
      r.C = 0;
      r.mu = cp.sliding ? ct.muK : ct.muS;
      r.target = ct.tangentSpeed || 0;
    }
  }
  function updateRow(r) {
    if (r.kind === 'link') { if (r.link.rows[0] === r) r.link.updateRows(); }
    else if (r.kind === 'block') r.joint.blockRow(r.slot, r);
    else if (r.kind === 'dist') distUpdate(r);
    else contactUpdate(r);
  }

  /* --------------------------------------------------- the direct solver */
  // Marker set as joint.block on joints this solver has taken over, so
  // their own solve skips the rows we solve (see P.jointBlock in revolute.js).
  function StructureSolver(structure, links, world) {
    var b0 = links[0].bodyB;
    P.Joint.call(this, { bodyA: b0, bodyB: b0, collideConnected: true, label: structure.label + ':solver' });
    this.type = 'structure';
    this.internal = true;
    this.structure = structure;
    this.links = links;
    this.world = world;
    this.bodySet = new Set();
    links.forEach(function (l) { [l.bodyA, l.bodyB].forEach(function (b) { if (b.type === 'dynamic') this.bodySet.add(b); }, this); }, this);
    this.mark = { structureSolver: this, step: -1 };
    this.rowsS = []; this.rowsU = [];
    this.adoptedJoints = []; this.adoptedDist = []; this.adoptedContacts = [];
    this.lineBlockStep = -1;
  }
  StructureSolver.prototype = Object.create(P.Joint.prototype);
  StructureSolver.prototype.force = function () { return 0; };

  // The world skips joints whose two bodies are asleep. A broken structure
  // can be partly asleep (one piece resting, another falling), so before
  // each step point bodyA/bodyB at a body that is still awake.
  StructureSolver.prototype.preStep = function () {
    var A = this.bodyA;
    if (A.awake !== false && this.bodySet.has(A)) return;
    var self = this;
    this.bodySet.forEach(function (b) { if (b.awake !== false && (self.bodyA.awake === false || !self.bodySet.has(self.bodyA))) { self.bodyA = b; self.bodyB = b; } });
  };

  // Everything this structure solves, besides its own links:
  //  - distance joints (ropes, rods, stiff springs) and contacts touching its
  //    bodies, claimed here in prepare (contacts are prepared before joints,
  //    and a claimed rope skips its own warm start and solve);
  //  - rigid joints (pins, welds, sliders) touching its bodies, together with
  //    the whole joint group they belong to, claimed in the first warm start
  //    of the step, after every joint's prepare has set up its group.
  StructureSolver.prototype.prepare = function (h, cfg) {
    var world = this.world, self = this, inWorld = new Set(world.joints), bodies = this.bodySet;
    this.invH = 1 / h; this.h = h; this.cfg = cfg;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.links.forEach(function (l) {
      if (l.broken || !inWorld.has(l)) { l.broken = true; return; }
      l.invH = 1 / h;
    });
    var step = world.stepCount, claim = world._lineBlockClaim || (world._lineBlockClaim = new Map());
    this.lineBlockStep = step;
    this.adoptedDist = [];
    if (world.structureCoupling !== false) {
      world.joints.forEach(function (j) {
        if (j.type !== 'distance' || j.broken) return;
        if (!(bodies.has(j.bodyA) || bodies.has(j.bodyB))) return;
        var owner = claim.get(j);
        if (owner && owner !== self && owner.lineBlockStep === step) return;   // another structure has it
        var dm = distMode(j);
        if (!dm || lineNode(world, j, bodies)) return;
        claim.set(j, self);
        j.structureStep = step;
        if (j._sSolver !== self || j._sLambda == null) { j._sLambda = dm.sign * j.axial(); j._sSolver = self; }
        self.adoptedDist.push({ joint: j, mode: dm.mode, sign: dm.sign });
      });
    }
    // Bodies held to the structure by rigid joints (a strut pinned to a
    // beam, say). Contacts between two of them are left to the soft contact
    // solver: such parts are often built overlapping a little, and rigid rows
    // on both sides of an overlap would fight with unbounded force.
    var tied = new Set(bodies), queue = Array.from(bodies), adj = rigidJointsByBody(world);
    while (queue.length) {
      var body = queue.pop(), near = adj.get(body) || [];
      for (var ji = 0; ji < near.length; ji++) {
        var jj = near[ji];
        var other = jj.bodyA === body ? jj.bodyB : jj.bodyA;
        if (other.type === 'dynamic' && !tied.has(other)) { tied.add(other); queue.push(other); }
      }
    }
    this.adoptedContacts.forEach(function (ct) { if (ct.structureSolver === self) ct.structureSolver = null; });
    this.adoptedContacts = [];
    var moving = function (b) { return b.type !== 'static' && b.awake !== false; };
    if (world.structureCoupling !== false) {
      world.contacts.forEach(function (ct) {
        if (ct.structureSolver && ct.structureStep === step) return;   // another structure has it
        var A = ct.fa.body, B = ct.fb.body;
        // Contacts on anything this solver moves rigidly (the structure and
        // the parts pinned to it) are solved here too: a separate soft
        // contact solve pushing on rigidly solved bodies rings up.
        if (!(tied.has(A) || tied.has(B))) return;
        if (!(moving(A) || moving(B)) || !ct.normal || !ct.points.length) return;   // not prepared this step
        // Parts built overlapping (a strut pinned to a beam often overlaps
        // the next segment), or a fast hit that went deep, keep the contact
        // solver's soft push, k = m_eff·ω² as in contact.js, but solved here
        // with everything else: rigid rows on both sides of an overlap that
        // cannot open would need unbounded force, and a separate soft solve
        // fighting this exact one can ring up.
        // An impact (approach faster than the restitution threshold) is
        // cushioned the same way: a rigid stop would hand a light segment the
        // whole momentum of a falling crate in one substep and snap the beam
        // everywhere at once. The next step, at rest, the contact is rigid.
        ct._sSoft = (tied.has(A) && tied.has(B)) || ct.points.some(function (cp) {
          return cp.separation < -DEEP_OVERLAP || cp.relativeVelocity < -cfg.restitutionThreshold;
        });
        ct.structureSolver = self; ct.structureStep = step;
        self.adoptedContacts.push(ct);
      });
    }
    this.built = -1;
  };

  // Pins, welds, sliders and rigid rods by body, built once per step and
  // shared by every structure in the world.
  function rigidJointsByBody(world) {
    if (world._sAdjStep === world.stepCount && world._sAdjTime === world.time) return world._sAdj;
    var adj = new Map();
    world.joints.forEach(function (j) {
      if (j.broken || !(j.blockSlots || (j.type === 'distance' && j.isRigid && j.isRigid()))) return;
      [j.bodyA, j.bodyB].forEach(function (b) { var l = adj.get(b); if (!l) adj.set(b, l = []); l.push(j); });
    });
    world._sAdj = adj; world._sAdjStep = world.stepCount; world._sAdjTime = world.time;
    return adj;
  }

  // Rigid joints touching the structure, with their whole joint group.
  StructureSolver.prototype.adoptJoints = function () {
    var world = this.world, self = this, bodies = this.bodySet, mark = this.mark, step = world.stepCount;
    mark.step = step;
    var list = [], seen = new Set();
    if (world.structureCoupling === false) { this.adoptedJoints = list; return; }
    world.joints.forEach(function (j) {
      if (!j.blockSlots || j.broken || seen.has(j)) return;
      if (!(bodies.has(j.bodyA) || bodies.has(j.bodyB))) return;
      if (j.block && j.block.structureSolver && j.block.structureSolver !== self && j.block.step === step) return;
      var grp = j.block && j.block.joints ? j.block.joints : [j];
      grp.forEach(function (m) {
        if (seen.has(m) || m.broken) return;
        if (m.block && m.block.structureSolver && m.block.structureSolver !== self && m.block.step === step) return;
        seen.add(m); list.push(m);
        m.block = mark; m.blockLeader = false;
      });
    });
    this.adoptedJoints = list;
  };

  // Build the row lists: S rows (bilateral: links, rigid joint rows, rods,
  // springs) go into the factored matrix; U rows (ropes, contact normals,
  // friction) are solved on its Schur complement with clamping.
  StructureSolver.prototype.buildRows = function () {
    var S = [], U = [], self = this, h = this.h;
    this.links.forEach(function (l) {
      if (l.broken) return;
      l.rows.forEach(function (r) {
        r.mode = 'spring'; r.k = l.k[r.comp]; r.c = l.c[r.comp];
        S.push(r);
      });
    });
    this.adoptedJoints.forEach(function (j) {
      j.blockSlots().forEach(function (slot) {
        var r = j._sRows && j._sRows[slot];
        if (!r) { r = newRow('block', j.bodyA, j.bodyB); r.joint = j; r.slot = slot; (j._sRows = j._sRows || {})[slot] = r; }
        r.mode = 'rigid';
        S.push(r);
      });
    });
    this.adoptedDist.forEach(function (d) {
      var j = d.joint, r = j._sRow || (j._sRow = newRow('dist', j.bodyA, j.bodyB));
      r.joint = j; r.sign = d.sign; r.mode = d.mode;
      if (d.mode === 'spring' || d.mode === 'uniSpring') {
        r.k = j.stiffness;
        var m = j.effMass(j.geometry());
        r.c = j.damping != null ? j.damping : 2 * (j.dampingRatio || 0) * Math.sqrt(j.stiffness * m);
      }
      (d.mode === 'uni' || d.mode === 'uniSpring' ? U : S).push(r);
    });
    this.adoptedContacts.forEach(function (ct) {
      var A = ct.fa.body, B = ct.fb.body;
      var cfg = self.cfg, hz = Math.min(cfg.contactHertz, 0.25 / h);
      if (!isDyn(A) || !isDyn(B)) hz = Math.min(2 * hz, 0.25 / h);
      var om = 2 * Math.PI * hz;
      ct._sRows = ct.points.map(function (cp) {
        var rn = newRow('cn', A, B); rn.ct = ct; rn.cp = cp; rn.mode = 'uni';
        if (ct._sSoft) { rn.mode = 'uniSpring'; rn.k = cp.normalMass * om * om; rn.c = 2 * cfg.contactDampingRatio * cp.normalMass * om; }
        var rt = newRow('ct', A, B); rt.ct = ct; rt.cp = cp; rt.mode = 'friction'; rt.normal = rn;
        U.push(rn, rt);
        return rn;
      });
    });
    S.concat(U).forEach(function (r) {
      if (r.mode === 'spring' || r.mode === 'uniSpring') {
        var den = h * r.k + r.c;
        r.gamma = den > 0 ? 1 / (h * den) : 0; r.beta = den > 0 ? r.k / den : 0;
      } else { r.gamma = 0; r.beta = 0; }
    });
    S.forEach(function (r, i) { r.index = i; });
    U.forEach(function (r, i) { r.index = i; });
    this.rowsS = S; this.rowsU = U;
    this.built = this.world.stepCount;
  };

  // Build K = J M⁻¹ Jᵀ + Γ for the S rows from the current geometry and
  // factor it (LDLᵀ inside the profile; a dependent row, e.g. two rigid
  // ropes along one line, gets a zero pivot and is left to the others).
  // Then the U rows' coupling Y = A⁻¹ K_SU and their Schur complement.
  // Done at the start of every substep: a structure that is spinning (a beam
  // knocked loose) turns too far within one step for a step-old matrix.
  StructureSolver.prototype.factor = function () {
    var S = this.rowsS, U = this.rowsU, n = S.length, m = U.length, i, j, k;
    S.forEach(updateRow); U.forEach(updateRow);
    // Rigid rows get a tiny compliance (1e-6 of their own diagonal): it keeps
    // the matrix positive definite when rigid parts close a loop (two struts
    // and the ground make a triangle) and costs nanometres of drift.
    S.concat(U).forEach(function (r) { if (r.mode === 'rigid' || r.mode === 'uni' || r.mode === 'friction') r.gamma = RIGID_EPS * entry(r, r); });
    if (!this.K || this.K.length < n * n) {
      this.K = new Float64Array(Math.max(1, n * n)); this.D = new Float64Array(n + 1); this.Dinv = new Float64Array(n + 1);
      this.first = new Int32Array(n + 1); this.x = new Float64Array(n + 1); this.z = new Float64Array(n + 1);
    } else this.K.fill(0, 0, n * n);
    var K = this.K, first = this.first;
    for (i = 0; i < n; i++) first[i] = i;
    var byBody = new Map();
    S.forEach(function (row) {
      for (var e = 0; e < 2; e++) {
        var body = e ? row.B : row.A;
        if (!isDyn(body)) continue;
        var list = byBody.get(body); if (!list) byBody.set(body, list = []);
        if (list[list.length - 1] !== row) list.push(row);
      }
    });
    this.byBody = byBody;
    // remember how the bodies were turned, see solve()
    var turnedSet = new Set();
    for (i = 0; i < n + m; i++) {
      var tr = i < n ? S[i] : U[i - n];
      if (isDyn(tr.A)) turnedSet.add(tr.A);
      if (isDyn(tr.B)) turnedSet.add(tr.B);
    }
    var turned = this.turned = Array.from(turnedSet);
    this.turnAngles = turned.map(function (b) { return b.angle; });
    byBody.forEach(function (list) {
      for (var p = 0; p < list.length; p++) {
        for (var q = 0; q <= p; q++) {
          var r = Math.max(list[p].index, list[q].index), cc = Math.min(list[p].index, list[q].index);
          K[r * n + cc] = entry(list[p], list[q]);
          if (cc < first[r]) first[r] = cc;
        }
      }
    });
    var D = this.D, Dinv = this.Dinv, diag0 = new Float64Array(n);
    for (i = 0; i < n; i++) { K[i * n + i] += S[i].gamma; diag0[i] = K[i * n + i]; }
    for (i = 0; i < n; i++) {
      var fi = first[i];
      for (j = fi; j <= i; j++) {
        var s = K[i * n + j], k0 = Math.max(fi, first[j]);
        for (k = k0; k < j; k++) s -= K[i * n + k] * D[k] * K[j * n + k];
        if (j < i) K[i * n + j] = s * Dinv[j];
        else if (s > 1e-9 * diag0[i] && s > 0) { D[i] = s; Dinv[i] = 1 / s; }
        else { D[i] = 0; Dinv[i] = 0; }
      }
    }
    // U rows: coupling columns and Schur complement
    this.m = m;
    if (!m) return;
    if (!this.Y || this.Y.length < n * m) this.Y = new Float64Array(Math.max(1, n * m));
    if (!this.KSU || this.KSU.length < n * m) this.KSU = new Float64Array(Math.max(1, n * m));
    if (!this.SU || this.SU.length < m * m) this.SU = new Float64Array(m * m);
    var Y = this.Y, KSU = this.KSU, SU = this.SU, col = new Float64Array(n);
    KSU.fill(0, 0, n * m);
    for (j = 0; j < m; j++) {
      var u = U[j];
      col.fill(0);
      for (var e = 0; e < 2; e++) {
        var body = e ? u.B : u.A;
        var list = byBody.get(body);
        if (list) list.forEach(function (row) { col[row.index] = entry(row, u); });
      }
      for (i = 0; i < n; i++) KSU[i * m + j] = col[i];
      this.backSolve(col);
      for (i = 0; i < n; i++) Y[i * m + j] = col[i];
    }
    for (i = 0; i < m; i++) {
      for (j = 0; j <= i; j++) {
        var v = entry(U[i], U[j]);
        for (k = 0; k < n; k++) v -= KSU[k * m + i] * Y[k * m + j];
        if (i === j) v += U[i].gamma;
        SU[i * m + j] = v; SU[j * m + i] = v;
      }
    }
  };

  // x := A⁻¹ x with the factor above (L y = b, D z = y, Lᵀ x = z).
  StructureSolver.prototype.backSolve = function (x) {
    var n = this.rowsS.length, K = this.K, Dinv = this.Dinv, first = this.first, i, k;
    for (i = 0; i < n; i++) { var s = x[i]; for (k = first[i]; k < i; k++) s -= K[i * n + k] * x[k]; x[i] = s; }
    for (i = 0; i < n; i++) x[i] *= Dinv[i];
    for (i = n - 1; i >= 0; i--) { var xi = x[i]; for (k = first[i]; k < i; k++) x[k] -= K[i * n + k] * xi; }
  };

  StructureSolver.prototype.warmStart = function () {
    if (this.mark.step !== this.world.stepCount) this.adoptJoints();
    if (this.built !== this.world.stepCount) this.buildRows();
    this.factor();
    // Links, taken-over ropes and contacts are warm-started here. Taken-over
    // rigid joints warm-start themselves (their warmStart always runs).
    var all = this.rowsS.concat(this.rowsU);
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r.kind === 'block') continue;
      rowApply(r, rowLambda(r));
    }
  };

  // Right-hand side of one row: Δλ solves (K + Γ) Δλ = rhs.
  function rowRhs(r, h, useBias, br, maxPush) {
    var v = rowVel(r);
    switch (r.mode) {
      case 'spring': case 'uniSpring':
        if (r.kind === 'cn' && r.C > 0) return -(v + r.C / h) - r.gamma * rowLambda(r);   // speculative gap
        return -(v + r.beta * r.C) - r.gamma * rowLambda(r);
      // Rigid, one-sided and friction rows carry gamma only to keep the
      // matrix well posed (RIGID_EPS). Its -gamma·λ term is a compliance
      // velocity, so it is left out where no position term balances it (the
      // relax pass, and friction always): otherwise a loaded row at rest
      // keeps a creep speed of gamma·λ and its bodies never sleep.
      case 'rigid':
        // position correction capped like contact push-out, so a joint torn
        // open by a violent hit closes gently instead of adding energy
        return -(v + (useBias ? M.clamp(br * r.C, -maxPush, maxPush) : 0) + r.drift / h) - (useBias ? r.gamma * rowLambda(r) : 0);
      case 'uni':
        if (r.C > 0) return -(v + r.C / h);   // open: may close, not overshoot
        return -(v + (useBias ? Math.max(br * r.C, -maxPush) : 0)) - (useBias ? r.gamma * rowLambda(r) : 0);
      default:                                                   // friction
        return -(v - r.target);
    }
  }

  StructureSolver.prototype.solve = function (h, useBias, cfg) {
    var S = this.rowsS, U = this.rowsU, n = S.length, m = this.m || 0;
    if (!n && !m) return;
    cfg = cfg || this.cfg;
    // The relax pass comes after positions moved. A part spinning fast (a
    // piece knocked off a breaking beam) turns enough in one substep that the
    // factor from before the move no longer converges: build it again.
    if (!useBias && this.turned) {
      for (var t = 0; t < this.turned.length; t++) {
        if (Math.abs(this.turned[t].angle - this.turnAngles[t]) > REFACTOR_ANGLE) { this.factor(); m = this.m || 0; break; }
      }
    }
    var br = this.jointSoft.biasRate, maxPush = cfg.maxPushVelocity || 3, i, j, k;
    for (i = 0; i < n; i++) updateRow(S[i]);
    for (i = 0; i < m; i++) updateRow(U[i]);
    var z = this.z;
    for (i = 0; i < n; i++) z[i] = rowRhs(S[i], h, useBias, br, maxPush);
    this.backSolve(z);                                           // z = A⁻¹ r_S
    if (m) {
      var Y = this.Y, KSU = this.KSU, SU = this.SU;
      var rU = this.rU && this.rU.length >= m ? this.rU : (this.rU = new Float64Array(m));
      var xU = this.xU && this.xU.length >= m ? this.xU : (this.xU = new Float64Array(m));
      var lam0 = this.lam0 && this.lam0.length >= m ? this.lam0 : (this.lam0 = new Float64Array(m));
      for (j = 0; j < m; j++) {
        var s = rowRhs(U[j], h, useBias, br, maxPush);
        for (k = 0; k < n; k++) s -= KSU[k * m + j] * z[k];
        rU[j] = s; xU[j] = 0; lam0[j] = rowLambda(U[j]);
      }
      // projected Gauss-Seidel on the (small, dense) Schur complement
      for (var it = 0; it < 40; it++) {
        var change = 0;
        for (j = 0; j < m; j++) {
          var d = SU[j * m + j];
          if (!(d > 0)) continue;
          var res = rU[j];
          for (k = 0; k < m; k++) res -= SU[j * m + k] * xU[k];
          var nx = xU[j] + res / d, tot = lam0[j] + nx, u = U[j];
          if (u.mode === 'uni' || u.mode === 'uniSpring') { if (tot < 0) nx = -lam0[j]; }
          else if (u.mode === 'friction') {
            var ni = u.normal.index, lim = u.mu * Math.max(0, lam0[ni] + xU[ni]);
            if (tot > lim) nx = lim - lam0[j]; else if (tot < -lim) nx = -lim - lam0[j];
          }
          change = Math.max(change, Math.abs(nx - xU[j]));
          xU[j] = nx;
        }
        if (change < 1e-12) break;
      }
      for (i = 0; i < n; i++) { var c = 0; for (j = 0; j < m; j++) c += Y[i * m + j] * xU[j]; z[i] -= c; }
      for (j = 0; j < m; j++) { rowAdd(U[j], xU[j]); rowApply(U[j], xU[j]); }
    }
    for (i = 0; i < n; i++) { rowAdd(S[i], z[i]); rowApply(S[i], z[i]); }
    this.adoptedDist.forEach(function (d) { distWrite(d.joint, d.sign); });
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
    s.ownsGround = !!s.ground && !def.ground;     // made by groundFor, so a scene rebuilds it
    links.forEach(function (l) { world.addJoint(l); });
    s.solver = world.addJoint(new StructureSolver(s, links, world));
    (world.structures = world.structures || []).push(s);
    // Loads are plain forces, cleared after every step: put them back.
    world.on('step', function () { s.applyLoads(); });
    return s;
  }
  function loadsApi(s, pointOf) {
    s.loads = [];
    // A sleeping body keeps its load as part of the rest it fell asleep in,
    // so an unchanged load is not put back on it (applyForce would wake it
    // every step); a changed one is, and wakes it.
    s.applyLoads = function () {
      s.loads.forEach(function (ld) {
        var at = pointOf(ld);
        if (!at || !(ld.F.x || ld.F.y)) return;
        var a = ld._applied, pos = ld.x != null ? ld.x : ld.node;
        var same = a && a.body === at.body && a.pos === pos && a.x === ld.F.x && a.y === ld.F.y;
        if (at.body.awake === false && same) return;
        at.body.applyForce(ld.F, at.point);
        ld._applied = { body: at.body, pos: pos, x: ld.F.x, y: ld.F.y };
      });
    };
    s.clearLoads = function () {
      s.loads.forEach(function (ld) { if (ld._applied) ld._applied.body.wake(); });
      s.loads.length = 0;
    };
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
    var group = def.group || -(++groupSeq);   // negative: parts of one structure never collide with each other
    var limits = { moment: mat.yield * sec.S, axial: mat.yield * sec.A, shear: mat.yield / Math.sqrt(3) * sec.A / 1.5 };
    var s = { kind: 'beam', label: def.label || 'beam', material: mat, section: sec, length: L, dx: dx, EI: EI,
      segments: N, start: p0, end: p1, axis: u, normal: n, limits: limits, damping: zeta, bodies: [], links: [], supports: [] };
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
    var group = def.group || -(++groupSeq);   // negative: parts of one structure never collide with each other
    var s = { kind: 'truss', label: def.label || 'truss', material: mat, area: A, I: I,
      damping: def.damping != null ? def.damping : 0.02, nodes: [], members: [], supports: [] };
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
  // True if a structure in j's world will solve distance joint j this step,
  // so the line blocks (pulley.js) leave it out whichever is prepared first.
  function claims(j) {
    var world = j.bodyA.world || j.bodyB.world;
    if (!world || world.structureCoupling === false || j.type !== 'distance' || j.broken || !distMode(j)) return false;
    if (world._sBodiesStep !== world.stepCount || world._sBodiesTime !== world.time) {
      var set = new Set();
      world.joints.forEach(function (s) { if (s.type === 'structure') s.bodySet.forEach(function (b) { set.add(b); }); });
      world._sBodies = set; world._sBodiesStep = world.stepCount; world._sBodiesTime = world.time;
    }
    var held = world._sBodies.has(j.bodyA) ? j.bodyA : world._sBodies.has(j.bodyB) ? j.bodyB : null;
    if (!held) return false;
    var own = null;
    world.joints.forEach(function (s) { if (s.type === 'structure' && s.bodySet.has(held)) own = s.bodySet; });
    return !lineNode(world, j, own);
  }

  P.structures = { beam: beam, truss: truss, claims: claims };
})(globalThis.SE);
