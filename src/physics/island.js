/*
 * Island solver: every connection of a mechanism solved together, and an
 * integrator that keeps its energy.
 *
 *   world.islandSolve = true;        // or new P.World({ islandSolve: true })
 *
 * With the flag on, world.step() hands the frame to P.island.step(). Contacts
 * still use the soft-step contact solver; everything else (pins, welds,
 * sliders, rods, ropes, springs, pulley and winch lines, beam and truss
 * links, roller supports) becomes rows of one linear system per island, an
 * island being a group of bodies joined by such rows.
 *
 * Why. Solved one joint at a time, a load crosses a light body only as fast
 * as that body's own mass lets it, so a rope on a beam end or a chain with a
 * heavy hook is soft, and the position correction that hides this drains or
 * adds energy. A real mechanism has no such softness: its stiffness is the
 * EA/L and EI/L of its parts. So the rows carry their real stiffness, and
 * rigid rows are held exactly.
 *
 * Rows. A row is one scalar equation C(q) on a few bodies with Jacobian J
 * (dC/dt = J v) and multiplier λ, the impulse along Jᵀ:
 *   rigid       C = 0                               pin, weld, rod, slider
 *   elastic     F = −k C − c dC/dt                  spring, steel rope, beam link
 *   one-sided   λ within [lo, hi]·h/2               rope (pulls only), limits
 *   velocity    J v = vt, force within [lo, hi]     motors, winch drums
 * See "Row interface" below for the fields.
 *
 * Integrator, per substep h. Rigid rows use RATTLE (the SHAKE/RATTLE of
 * molecular dynamics codes), elastic rows the implicit midpoint rule:
 *   1. half kick           v += (h/2)·a
 *   2. position stage      find λ so that q1 = q0 + h·(v + M⁻¹ Dᵀ λ) meets
 *                            rigid    C(q1) = 0,          D = J(q0)
 *                            elastic  λ = (h/2)·F_mid,    D = J(q_mid)
 *                          with F_mid = −k (C0 + C1)/2 − c (C1 − C0)/h.
 *                          Newton iteration on the island's system
 *                            (J(q1) M⁻¹ Dᵀ + Γ/h) Δλ = −g/h,  Γ = 1/(hk/4 + c/2)
 *                          until every residual g is under 1e-9 m. The
 *                          matrix is not symmetric (J at the end against D
 *                          at the start), so it is factored by LU in an
 *                          envelope (reverse Cuthill-McKee order), with a
 *                          backtracking line search when a step overshoots.
 *                          A body shared by many rows (a hub) keeps its own
 *                          velocity change as an unknown, so the factor
 *                          stays sparse.
 *   3. half kick, and the elastic rows' second half impulse (same λ, same D)
 *   4. velocity stage      μ so that J(q1)·(v + M⁻¹ Jᵀ μ) = 0 on rigid rows
 * The force a row carried in the substep is (λ + μ)/h, or 2λ/h for elastic
 * rows; adapters write it to the joint's usual impulse fields, so force(),
 * tension(), reaction() and breakage read as before.
 *
 * What that buys. RATTLE applies each constraint force along the direction
 * it had at the start of the substep and removes the velocity left along it
 * at the end. It is symplectic and time-reversible: the energy error stays
 * bounded at O(h²) instead of drifting, linear and angular momentum are kept
 * exactly, and halving h divides the error by four. The midpoint rule keeps
 * the energy of a linear spring exactly at any stiffness, so a steel rope or
 * beam link far stiffer than the substep stays stable without numerical
 * damping, and at rest λ = −(h/2) k C exactly: the static answer is the real
 * elastic one. The only energy a row removes is its declared damping c.
 *
 * Its limits. Both rules are second order, so a motion with angular
 * frequency ω is followed with a period error of about (ωh)²/12 (midpoint)
 * or (ωh)²/24 (RATTLE), and RATTLE needs ωh < 2 for the fastest swinging
 * mode of the rigid rows (a light node between two taut links: ω² = 2T/(mL)).
 * So the substep count adapts (world.islandAdaptive, default on):
 *   per frame, substeps double up to world.maxSubsteps (32) until springs
 *   and a beam's or truss's first mode turn at most 0.11 rad per substep
 *   (0.1 % period), the stiffest tension mode at most 1 rad and a body on a
 *   lever arm at most 0.2 rad;
 *   per substep, a substep that turns out too coarse is undone and done as
 *   two halves: down to maxSubsteps for the estimates above, and down to
 *   world.maxSplit (1024 per frame) when its solve gave up or an island
 *   that nothing drives (no motor, winch or contact) gained or lost more
 *   than 3e-5 of its kinetic energy. A chain snapping taut under a heavy
 *   load is resolved this way. At most 8·maxSubsteps substeps are tried in
 *   a frame.
 * world.substeps then reads the size of the last substep (dt / h), which
 * is what force readouts divide by. Elastic rows stiffer than that are not
 * resolved in time: they stay exact statically and stable, but ring slower
 * than in reality.
 *
 * Beams and trusses (structures.js): their damping ratio is that of their
 * first mode, applied as stiffness-proportional damping c = (2ζ/ω₁)·k on
 * every link, with ω₁ found from the structure's stiffness and mass
 * matrices. So a beam with damping 0 rings without losing amplitude and one
 * with ζ rings down as e^(−ζω₁t), as a real one does.
 *
 * Contacts and joints this file does not know are solved as before, and
 * where they touch an island they take turns with it, four rounds a substep
 * (world.islandPasses).
 *
 * One-sided and clamped rows use an active set inside the same iteration: a
 * row at a bound leaves the system, a row whose residual pushes back into
 * the allowed side rejoins. A rope going taut is inelastic: the stretching
 * speed is removed in the velocity stage. An elastic rope or stop that goes
 * slack or taut inside a substep gets the force that hands over exactly the
 * energy it stores or gives back. If the iteration does not reach its
 * tolerance the substep is split (above); when it can't be, the best
 * iterate is kept and world.islandStats.fallbacks counts it.
 *
 * Redundant rows (closed loops, two pins on one pair) get a compliance of
 * 1e-9 of their own diagonal in the matrix, so it stays solvable and equal
 * redundant rows share the load.
 *
 * Row interface (also for other modules, e.g. resting contacts):
 *   var r = new P.island.Row([bodyA, bodyB, ...]);
 *   r.J    Float64Array(3·n): dC/d(vx, vy, w) for each body in turn
 *   r.C    position error, m or rad
 *   r.k    stiffness N/m (Infinity = rigid);  r.c  damping N·s/m
 *   r.lo, r.hi   force bounds, N (a rope: hi = 0; a contact normal: lo = 0)
 *   r.vel, r.vt  velocity row and its target, m/s
 *   r.rate       speed of a moving position target, m/s (a winch line)
 *   r.cone, r.coneMu   bound this row's force by coneMu·|force of r.cone|
 *                (friction under a normal row)
 *   r.on         false takes the row out for this substep
 *   r.g    optional Float64Array(n): geometric stiffness per newton and per
 *          unit inertia of each body, 1/(kg·m), for the substep rule
 *   r.total      (read) impulse the row applied in the last substep, N·s
 * Rows come from adapters: { rows, key, update(h), eval(), store(invH, h) }
 * plus optional started(), kick(hh), posDone(h). eval() fills J and C of
 * every row from the bodies' current c, angle and q. Joints get theirs from
 * P.island.register(JointClass, function (joint) { return adapter; });
 * anything else from P.island.addSource(function (world, h) { return
 * [adapter, ...]; }), called once per frame; an adapter object returned on
 * consecutive frames keeps its rows' impulses as the next starting guess.
 *
 * Readouts: world.islandStats { substeps, islands, rows, iterations,
 * fallbacks, residual } (substeps is the count taken this frame),
 * P.island.energy(world) { elastic, dissipated }.
 *
 * Snapshots (serialize.js) skip the `_isl` fields and save the row impulses
 * and substep state through P.island.saveState / loadState, so a restored
 * world replays bit for bit. Tests: SE_ISLAND=1 node tests/run.js runs the
 * whole suite with the flag on; tests/physics-island.test.js holds the
 * accuracy targets.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  var TOL = 1e-9;              // position residual, m or rad
  var VTOL = 1e-9;             // velocity residual, m/s or rad/s
  var MAX_NEWTON = 30;
  var HUB_ROWS = 9;            // a body with this many rows gets unknowns of its own
  var EPS = 1e-9;              // relative compliance that keeps redundant rows solvable
  var MAX_SUBSTEPS = 32;       // steady substeps per frame
  var MAX_SPLIT = 1024;        // finest a single substep may be cut, per frame
  var BUDGET = 8;              // substeps tried per frame, at most this many times maxSubsteps
  var PASSES = 4;              // rounds between the islands and the contacts on them
  var ENERGY_TOL = 3e-5;       // energy a substep may gain or lose, of the island's kinetic energy
  var SPRING_ANGLE = 0.11;     // rad per substep at a spring's own frequency
  var STIFF_ANGLE = 0.5;       // springs that can't get under this are not resolved
  var GEO_ANGLE = 1.0;         // rad per substep of the fastest tension mode
  var TURN_ANGLE = 0.2;        // rad a body on a lever arm may turn per substep
  var MAX_CORRECTION = 4;      // m/s (rad/s): how fast an error that was already there is closed

  function isDyn(b) { return b.type === 'dynamic' && (b.invM > 0 || b.invI > 0); }

  /* ------------------------------------------------------------------ rows */
  function Row(bodies) {
    var n = bodies.length;
    this.b = bodies; this.n = n;
    this.J = new Float64Array(3 * n);     // latest Jacobian
    this.D = new Float64Array(3 * n);     // direction the impulse acts along
    this.Db = null;                       // D of the best iterate (elastic rows)
    this.g = null;
    this.C = 0; this.C0 = 0;
    this.k = Infinity; this.c = 0;
    this.lo = -Infinity; this.hi = Infinity;
    this.vel = false; this.vt = 0; this.rate = 0;
    this.cone = null; this.coneMu = 0;
    this.on = true;
    this.lam = 0; this.mu = 0; this.total = 0;
    this.jc = false;
    this.ps = 0; this.vs = 0;             // active set: 0 free, 1 at hi, -1 at lo, 2 out
    this.el = false; this.vp = false;
    this.gam = 0; this.beta = 0; this.tgt = 0;
    this.blo = -Infinity; this.bhi = Infinity;
    this.res = 0; this.kd = 0; this.pos = -1;
    this.lamB = 0; this.psB = 0; this.dl = 0;
    this.live = false;                    // has a body the island moves
  }

  function rowVel(r, vec) {
    var s = 0, b = r.b;
    for (var i = 0, o = 0; i < r.n; i++, o += 3) {
      var B = b[i];
      s += vec[o] * B.v.x + vec[o + 1] * B.v.y + vec[o + 2] * B.w;
    }
    return s;
  }
  function rowPush(r, vec, imp) {
    var b = r.b;
    for (var i = 0, o = 0; i < r.n; i++, o += 3) {
      var B = b[i];
      if (!B._isl) continue;
      B.v.x += B.invM * vec[o] * imp; B.v.y += B.invM * vec[o + 1] * imp; B.w += B.invI * vec[o + 2] * imp;
    }
  }

  // Impulse bounds for one half of the substep.
  function bounds(r, hh, stage) {
    if (r.cone) {
      var nrm = r.cone, lim = r.coneMu * Math.abs(stage ? nrm.mu : nrm.lam);
      r.blo = -lim; r.bhi = lim;
    } else { r.blo = r.lo * hh; r.bhi = r.hi * hh; }
  }
  function clampState(v, r) { return v >= r.bhi && r.bhi < Infinity ? 1 : (v <= r.blo && r.blo > -Infinity ? -1 : 0); }

  /* ------------------------------------------------------ joint adapters */
  // Anchor arms from each centre of mass and the anchor separation d = pB - pA.
  function anchors(j, o) {
    var A = j.bodyA, B = j.bodyB, la = j.localAnchorA, lb = j.localAnchorB;
    var ax = la.x - A.localCenter.x, ay = la.y - A.localCenter.y;
    var bx = lb.x - B.localCenter.x, by = lb.y - B.localCenter.y;
    o.rax = A.q.c * ax - A.q.s * ay; o.ray = A.q.s * ax + A.q.c * ay;
    o.rbx = B.q.c * bx - B.q.s * by; o.rby = B.q.s * bx + B.q.c * by;
    o.dx = B.c.x + o.rbx - A.c.x - o.rax; o.dy = B.c.y + o.rby - A.c.y - o.ray;
    return o;
  }
  // Row along the unit vector n between the anchors. `shift`: n is fixed in
  // body A, so A's lever arm reaches to B's anchor (the gradient of n(θA)·d).
  function along(r, o, nx, ny, shift) {
    var ax = o.rax + (shift ? o.dx : 0), ay = o.ray + (shift ? o.dy : 0), J = r.J;
    J[0] = -nx; J[1] = -ny; J[2] = -(ax * ny - ay * nx);
    J[3] = nx; J[4] = ny; J[5] = o.rbx * ny - o.rby * nx;
  }
  function angular(r) { var J = r.J; J[0] = 0; J[1] = 0; J[2] = -1; J[3] = 0; J[4] = 0; J[5] = 1; return r; }
  function canTurn(A, B) { return (isDyn(A) ? A.invI : 0) + (isDyn(B) ? B.invI : 0) > 0; }
  function pinGeo(r, o, A, B) {
    r.g[0] = A.invI * Math.sqrt(o.rax * o.rax + o.ray * o.ray);
    r.g[1] = B.invI * Math.sqrt(o.rbx * o.rbx + o.rby * o.rby);
  }

  function revoluteAdapter(j) {
    var A = j.bodyA, B = j.bodyB, bs = [A, B], o = {};
    var rx = new Row(bs), ry = new Row(bs), sp = angular(new Row(bs)), mo = angular(new Row(bs));
    var lw = angular(new Row(bs)), up = angular(new Row(bs));
    rx.g = new Float64Array(2); ry.g = new Float64Array(2);
    mo.vel = true; lw.lo = 0; up.hi = 0;
    return {
      joint: j, rows: [rx, ry, sp, mo, lw, up],
      update: function () {
        var turn = canTurn(A, B);
        sp.on = turn && (j.stiffness > 0 || j.damping > 0); sp.k = j.stiffness; sp.c = j.damping;
        mo.on = turn && j.enableMotor && j.maxMotorTorque > 0;
        mo.vt = j.motorSpeed; mo.lo = -j.maxMotorTorque; mo.hi = j.maxMotorTorque;
        lw.on = turn && j.enableLimit && j.lowerAngle > -Infinity;
        up.on = turn && j.enableLimit && j.upperAngle < Infinity;
      },
      eval: function () {
        anchors(j, o);
        along(rx, o, 1, 0); rx.C = o.dx;
        along(ry, o, 0, 1); ry.C = o.dy;
        pinGeo(rx, o, A, B); pinGeo(ry, o, A, B);
        var ang = B.angle - A.angle - j.referenceAngle;
        sp.C = ang - j.springAngle; lw.C = ang - j.lowerAngle; up.C = ang - j.upperAngle;
      },
      store: function (invH, h) {
        j.invH = invH; j.h = h; j.block = null;
        j.impulse = M.v(rx.total, ry.total);
        j.springImpulse = sp.total; j.motorImpulse = mo.total;
        j.lowerImpulse = lw.total; j.upperImpulse = -up.total;
      }
    };
  }

  function weldAdapter(j) {
    var A = j.bodyA, B = j.bodyB, bs = [A, B], o = {};
    var px = new Row(bs), py = new Row(bs), an = angular(new Row(bs));
    px.g = new Float64Array(2); py.g = new Float64Array(2);
    return {
      joint: j, rows: [px, py, an],
      update: function () {
        var lin = j.linearStiffness > 0 || j.linearDamping > 0, ang = j.angularStiffness > 0 || j.angularDamping > 0;
        px.k = py.k = lin ? j.linearStiffness : Infinity; px.c = py.c = lin ? j.linearDamping : 0;
        an.on = canTurn(A, B);
        an.k = ang ? j.angularStiffness : Infinity; an.c = ang ? j.angularDamping : 0;
      },
      eval: function () {
        anchors(j, o);
        along(px, o, 1, 0); px.C = o.dx;
        along(py, o, 0, 1); py.C = o.dy;
        pinGeo(px, o, A, B); pinGeo(py, o, A, B);
        an.C = B.angle - A.angle - j.referenceAngle;
      },
      store: function (invH, h) {
        j.invH = invH; j.h = h; j.block = null;
        j.linearImpulse = M.v(px.total, py.total); j.angularImpulse = an.total;
      }
    };
  }

  function prismaticAdapter(j) {
    var A = j.bodyA, B = j.bodyB, bs = [A, B], o = {};
    var pp = new Row(bs), an = angular(new Row(bs)), sp = new Row(bs), mo = new Row(bs), lw = new Row(bs), up = new Row(bs);
    mo.vel = true; lw.lo = 0; up.hi = 0;
    function axis() { var l = j.localAxisA; return { x: A.q.c * l.x - A.q.s * l.y, y: A.q.s * l.x + A.q.c * l.y }; }
    return {
      joint: j, rows: [pp, an, sp, mo, lw, up],
      update: function () {
        an.on = canTurn(A, B);
        sp.on = j.stiffness > 0 || j.damping > 0; sp.k = j.stiffness; sp.c = j.damping;
        mo.on = j.enableMotor && j.maxMotorForce > 0; mo.vt = j.motorSpeed; mo.lo = -j.maxMotorForce; mo.hi = j.maxMotorForce;
        lw.on = j.enableLimit && j.lowerTranslation > -Infinity;
        up.on = j.enableLimit && j.upperTranslation < Infinity;
      },
      eval: function () {
        anchors(j, o);
        var a = axis(), tr = a.x * o.dx + a.y * o.dy;
        along(pp, o, -a.y, a.x, true); pp.C = -a.y * o.dx + a.x * o.dy;
        along(sp, o, a.x, a.y, true); mo.J.set(sp.J); lw.J.set(sp.J); up.J.set(sp.J);
        sp.C = tr - j.restTranslation; lw.C = tr - j.lowerTranslation; up.C = tr - j.upperTranslation;
        an.C = B.angle - A.angle - j.referenceAngle;
      },
      // force-controlled ram: a constant push along the axis, through B's anchor
      kick: function (hh) {
        if (!j.motorForce) return;
        anchors(j, o);
        var a = axis(), imp = j.motorForce * hh, ax = o.rax + o.dx, ay = o.ray + o.dy;
        if (A._isl) { A.v = M.v(A.v.x - A.invM * imp * a.x, A.v.y - A.invM * imp * a.y); A.w -= A.invI * imp * (ax * a.y - ay * a.x); }
        if (B._isl) { B.v = M.v(B.v.x + B.invM * imp * a.x, B.v.y + B.invM * imp * a.y); B.w += B.invI * imp * (o.rbx * a.y - o.rby * a.x); }
      },
      store: function (invH, h) {
        j.invH = invH; j.h = h; j.block = null;
        j.perpImpulse = pp.total; j.angularImpulse = an.total;
        j.springImpulse = sp.total; j.motorImpulse = mo.total;
        j.lowerImpulse = lw.total; j.upperImpulse = -up.total;
      }
    };
  }

  function distanceAdapter(j) {
    var A = j.bodyA, B = j.bodyB, bs = [A, B], o = {};
    var main = new Row(bs), lw = new Row(bs), up = new Row(bs), mo = new Row(bs), rigid = false;
    main.g = new Float64Array(2); up.g = main.g;
    mo.vel = true; lw.lo = 0; up.hi = 0;
    return {
      joint: j, rows: [main, lw, up, mo],
      update: function () {
        rigid = j.isRigid();
        var spring = j.spring && j.minLength < j.maxLength;
        main.on = rigid || spring;
        main.k = Infinity; main.c = 0; main.hi = Infinity;
        if (!rigid && spring) {
          var m = j.effMass(j.geometry()), k, c;
          if (j.stiffness > 0) {
            k = j.stiffness;
            c = j.damping != null ? j.damping : 2 * j.dampingRatio * Math.sqrt(k * m);
          } else {
            var w = 2 * Math.PI * j.hertz;
            k = m * w * w; c = 2 * j.dampingRatio * m * w;
          }
          main.k = k; main.c = c;
          if (j.rope) main.hi = 0;                     // a line only pulls
          if (!(k > 0 || c > 0)) main.on = false;
        }
        lw.on = !rigid && j.minLength > 0;
        up.on = !rigid && j.maxLength < Infinity;
        mo.on = j.maxMotorForce > 0; mo.vt = j.motorSpeed; mo.lo = -j.maxMotorForce; mo.hi = j.maxMotorForce;
      },
      eval: function () {
        anchors(j, o);
        var L = Math.sqrt(o.dx * o.dx + o.dy * o.dy), ux = 0, uy = 1;
        if (L > 1e-9) { ux = o.dx / L; uy = o.dy / L; }
        along(main, o, ux, uy); lw.J.set(main.J); up.J.set(main.J); mo.J.set(main.J);
        main.C = L - j.length; lw.C = L - j.minLength; up.C = L - j.maxLength;
        var Lg = Math.max(L, 1e-3), ra = Math.sqrt(o.rax * o.rax + o.ray * o.ray), rb = Math.sqrt(o.rbx * o.rbx + o.rby * o.rby);
        main.g[0] = A.invM / Lg + A.invI * ra * (1 + ra / Lg);
        main.g[1] = B.invM / Lg + B.invI * rb * (1 + rb / Lg);
      },
      store: function (invH, h, st) {
        j.invH = invH; j.h = h; j.stiff = false; j.explicit = false;
        linePeak(j, Math.max(Math.abs(main.total), Math.abs(lw.total), Math.abs(up.total)), h, st);
        j.impulse = rigid ? main.total : 0;
        j.springImpulse = rigid ? 0 : main.total;
        j.lowerImpulse = lw.total; j.upperImpulse = -up.total; j.motorImpulse = mo.total;
      }
    };
  }

  // Rods and lines report the frame's largest pull to breakage through the
  // fields their force() already reads (linePeak, lineBlock).
  function linePeak(j, total, h, st) {
    if (j._islPeakAt !== st.tok) { j._islPeakAt = st.tok; j._islPeak = 0; }
    var F = Math.abs(total) / h;
    if (F > j._islPeak) j._islPeak = F;
    j.linePeak = j._islPeak * h; j.lineBlock = st.blk;
  }

  // Lines along a P.RopePath (pulley.js): C = Σ k·|run| − length.
  function evalPath(r, path) {
    path.update();
    var n = path.bodies.length, J = r.J, g = r.g, i;
    for (i = 0; i < n; i++) { J[3 * i] = path.lin[i].x; J[3 * i + 1] = path.lin[i].y; J[3 * i + 2] = path.ang[i]; g[i] = 0; }
    for (i = 0; i < path.runs.length; i++) {
      var run = path.runs[i], L = Math.max(run.len, 1e-3);
      [run.a, run.b].forEach(function (e) {
        var Bd = e.body;
        if (!Bd) return;
        var arm = M.len(M.sub(e.local, Bd.localCenter));
        g[path.bodies.indexOf(Bd)] += run.k * (Bd.invM / L + Bd.invI * arm * (1 + arm / L));
      });
    }
  }
  function lineStiffness(r, EA, zeta, L, path) {
    if (!EA) { r.k = Infinity; r.c = 0; return; }
    path.update();
    r.k = EA / Math.max(L, 1e-3);
    r.c = 2 * zeta * Math.sqrt(r.k * path.mass);
  }

  function pulleyAdapter(j) {
    var path = j.path, line = new Row(path.bodies);
    line.g = new Float64Array(path.bodies.length); line.hi = 0;
    return {
      joint: j, rows: [line],
      update: function () { lineStiffness(line, j.EA, j.dampingRatio, j.length, path); },
      eval: function () { evalPath(line, path); line.C = path.total - j.length; },
      store: function (invH, h, st) { j.invH = invH; j.h = h; j.impulse = -line.total; linePeak(j, line.total, h, st); }
    };
  }

  /*
   * Winch. The drum is a motor on the line: it takes line in at its speed
   * (the row's target moves at −speed) and can pull with at most cap().
   * While the row sits at that cap the line length is no longer the drum's
   * to set: after the position stage the line out is read back from the
   * path, so the load overhauls the drum under a tension equal to the cap.
   */
  function winchAdapter(j) {
    var path = j.path, line = new Row(path.bodies), L0 = j.length, Lend = j.length, Lref = j.length;
    line.g = new Float64Array(path.bodies.length); line.hi = 0;
    return {
      joint: j, rows: [line],
      update: function (h) {
        var dv = j.accel * h, t = j.reelSpeed, was = j.speed;
        j.speed = Math.abs(t - j.speed) <= dv ? t : j.speed + (t > j.speed ? dv : -dv);
        L0 = j.length;
        // the drum turns at the mean of its old and new speed over the substep
        var free = L0 - (j.accel < Infinity ? 0.5 * (was + j.speed) : j.speed) * h;
        Lend = M.clamp(free, j.minLength, j.maxLength);
        j.atLimit = Lend !== free;
        line.rate = j.atLimit ? -(L0 - Lend) / h : -j.speed;
        line.lo = -j.cap();
        lineStiffness(line, j.EA, j.dampingRatio, L0, path);
        Lref = L0;
      },
      started: function () { Lref = Lend; },
      eval: function () { evalPath(line, path); line.C = path.total - Lref; },
      posDone: function (h) {
        j.length = Lend;
        if (line.ps === -1) {
          var out = path.total - (j.EA ? j.cap() / line.k : 0);
          if (out > Lend) {
            j.length = Math.min(out, j.maxLength);
            j.speed = (L0 - j.length) / h;
            j.capped = true;
          }
        }
        Lref = j.length;
      },
      store: function (invH, h, st) {
        j.invH = invH; j.h = h; j.impulse = -line.total;
        linePeak(j, line.total, h, st);
        // work the drum did on the line this frame, J (tension × line taken
        // in, substep by substep), for the energy ledger
        if (j._islWorkAt !== st.tok) { j._islWorkAt = st.tok; j.frameWork = 0; }
        j.frameWork += -line.total * invH * (L0 - j.length);
        if (j.atLimit) j.speed = 0;
      },
      save: function () { return [j.length, j.speed, j.capped, j.atLimit]; },
      load: function (s) { j.length = s[0]; j.speed = s[1]; j.capped = s[2]; j.atLimit = s[3]; }
    };
  }

  /*
   * Damping of a beam or truss. Its damping ratio ζ is that of the first
   * vibration mode of the structure on its own supports, and the damping is
   * proportional to stiffness (a Kelvin–Voigt material): every link row gets
   * c = β·k with β = 2ζ/ω₁, so mode n has ratio ζ·ωₙ/ω₁ and the first mode
   * rings down as e^(−ζω₁t). ω₁ comes from the structure's stiffness and
   * mass matrices by inverse iteration; modes that take no strain (a beam on
   * one pin can swing) are set aside.
   */
  function firstFrequency(links) {
    var bodies = [], ix = new Map(), i, k, q, l, row;
    links.forEach(function (ln) {
      if (ln.broken) return;
      [ln.bodyA, ln.bodyB].forEach(function (b) { if (isDyn(b) && !ix.has(b)) { ix.set(b, bodies.length); bodies.push(b); } });
    });
    var n = 3 * bodies.length;
    if (!n || n > 900) return 0;
    var K = new Float64Array(n * n), Md = new Float64Array(n), kmax = 0, jv = new Float64Array(6), at = [0, 0];
    for (i = 0; i < bodies.length; i++) { Md[3 * i] = bodies[i].m; Md[3 * i + 1] = bodies[i].m; Md[3 * i + 2] = bodies[i].I || 1e-9; }
    links.forEach(function (ln) { if (!ln.broken) for (q = 0; q < 3; q++) if (ln.k[q] > kmax) kmax = ln.k[q]; });
    for (l = 0; l < links.length; l++) {
      var ln = links[l];
      if (ln.broken) continue;
      ln.updateRows();
      at[0] = ix.has(ln.bodyA) ? 3 * ix.get(ln.bodyA) : -1; at[1] = ix.has(ln.bodyB) ? 3 * ix.get(ln.bodyB) : -1;
      for (q = 0; q < ln.rows.length; q++) {
        row = ln.rows[q];
        var kk = ln.k[row.comp] > 0 ? ln.k[row.comp] : 100 * kmax;      // a rigid row
        if (row.ja) { jv[0] = row.ja[0]; jv[1] = row.ja[1]; jv[2] = row.ja[2]; jv[3] = row.jb[0]; jv[4] = row.jb[1]; jv[5] = row.jb[2]; }
        else { jv[0] = row.ax; jv[1] = row.ay; jv[2] = row.aw; jv[3] = row.bx; jv[4] = row.by; jv[5] = row.bw; }
        for (i = 0; i < 6; i++) {
          var ri = at[i < 3 ? 0 : 1]; if (ri < 0) continue; ri += i % 3;
          for (k = 0; k < 6; k++) {
            var ck = at[k < 3 ? 0 : 1]; if (ck < 0) continue;
            K[ri * n + ck + k % 3] += kk * jv[i] * jv[k];
          }
        }
      }
    }
    var scale = 0;
    for (i = 0; i < n; i++) if (K[i * n + i] / Md[i] > scale) scale = K[i * n + i] / Md[i];
    if (!(scale > 0)) return 0;
    // Cholesky of K + σM; the small shift keeps it solvable when a mode is free
    var sigma = 1e-10 * scale;
    for (i = 0; i < n; i++) K[i * n + i] += sigma * Md[i];
    for (i = 0; i < n; i++) {
      for (k = 0; k <= i; k++) {
        var sum = K[i * n + k];
        for (q = 0; q < k; q++) sum -= K[i * n + q] * K[k * n + q];
        if (i === k) { if (!(sum > 0)) return 0; K[i * n + i] = Math.sqrt(sum); }
        else K[i * n + k] = sum / K[k * n + k];
      }
    }
    function solve(y) {
      var a, b2, t;
      for (a = 0; a < n; a++) { t = y[a]; for (b2 = 0; b2 < a; b2++) t -= K[a * n + b2] * y[b2]; y[a] = t / K[a * n + a]; }
      for (a = n - 1; a >= 0; a--) { t = y[a]; for (b2 = a + 1; b2 < n; b2++) t -= K[b2 * n + a] * y[b2]; y[a] = t / K[a * n + a]; }
    }
    function mdot(a, b2) { var t = 0; for (var e = 0; e < n; e++) t += a[e] * Md[e] * b2[e]; return t; }
    var found = [];
    for (var mode = 0; mode < 8; mode++) {
      var x = new Float64Array(n), y = new Float64Array(n), lam = 0, last = -1;
      for (i = 0; i < n; i++) x[i] = 1 + 0.37 * Math.sin(1.7 * i + mode);
      for (var it = 0; it < 200; it++) {
        for (q = 0; q < found.length; q++) { var pr = mdot(found[q], x); for (i = 0; i < n; i++) x[i] -= pr * found[q][i]; }
        var nm = Math.sqrt(mdot(x, x));
        if (!(nm > 0)) return 0;
        for (i = 0; i < n; i++) { x[i] /= nm; y[i] = Md[i] * x[i]; }
        solve(y);
        lam = 1 / mdot(x, y) - sigma;                                // Rayleigh quotient, ω²
        x.set(y);
        if (Math.abs(lam - last) <= 1e-10 * Math.abs(lam) + 1e-14 * scale) break;
        last = lam;
      }
      if (lam > 1e-8 * scale) return Math.sqrt(lam);
      for (q = 0; q < found.length; q++) { var p2 = mdot(found[q], x); for (i = 0; i < n; i++) x[i] -= p2 * found[q][i]; }
      var nn = Math.sqrt(mdot(x, x));
      for (i = 0; i < n; i++) x[i] /= nn;
      found.push(x);
    }
    return 0;
  }
  function structureOmega(s) {
    if (s._islW1 == null) s._islW1 = s.solver && s.solver.links ? firstFrequency(s.solver.links) : 0;
    return s._islW1;
  }
  function structureBeta(s) {
    var w1 = s.damping > 0 ? structureOmega(s) : 0;
    return w1 > 0 ? 2 * s.damping / w1 : 0;
  }

  // Beam and truss connections (structures.js): rows along the link's axis,
  // its normal and the relative angle, each with its own stiffness.
  function linkAdapter(j) {
    var A = j.bodyA, B = j.bodyB, bs = [A, B], o = {};
    var comps = j.rows.map(function (r) { return r.comp; });
    var rows = comps.map(function (c) { var r = new Row(bs); return c === 2 ? angular(r) : r; });
    return {
      joint: j, rows: rows,
      // the structure's first mode is what the step has to follow
      omega: function () { var s = j.part && j.part.structure; return s ? structureOmega(s) : 0; },
      update: function () {
        var s = j.part && j.part.structure, beta = s && s.damping != null ? structureBeta(s) : -1;
        for (var i = 0; i < rows.length; i++) {
          var k = j.k[comps[i]];
          rows[i].k = k > 0 ? k : Infinity;
          rows[i].c = k > 0 ? (beta >= 0 ? beta * k : (j.c[comps[i]] || 0)) : 0;
          if (comps[i] === 2) rows[i].on = canTurn(A, B);
        }
      },
      eval: function () {
        anchors(j, o);
        var l = j.localAxisA, ux = A.q.c * l.x - A.q.s * l.y, uy = A.q.s * l.x + A.q.c * l.y;
        for (var i = 0; i < rows.length; i++) {
          var c = comps[i], r = rows[i];
          if (c === 0) { along(r, o, ux, uy, true); r.C = ux * o.dx + uy * o.dy; }
          else if (c === 1) { along(r, o, -uy, ux, true); r.C = -uy * o.dx + ux * o.dy; }
          else r.C = B.angle - A.angle - j.referenceAngle;
        }
      },
      store: function (invH) {
        j.invH = invH;
        j.lambda[0] = 0; j.lambda[1] = 0; j.lambda[2] = 0;
        for (var i = 0; i < rows.length; i++) j.lambda[comps[i]] = rows[i].total;
      }
    };
  }

  function lineSupportAdapter(j) {
    var A = j.bodyA, B = j.bodyB, o = {}, r = new Row([A, B]);
    return {
      joint: j, rows: [r],
      update: function () {},
      eval: function () {
        anchors(j, o);
        var l = j.localNormalA, nx = A.q.c * l.x - A.q.s * l.y, ny = A.q.s * l.x + A.q.c * l.y;
        along(r, o, nx, ny, true); r.C = nx * o.dx + ny * o.dy;
      },
      store: function (invH) { j.invH = invH; j.impulse = r.total; }
    };
  }

  var registry = [], sources = [];
  function register(Ctor, make) { if (Ctor) registry.unshift({ ctor: Ctor, make: make }); }
  function addSource(fn) { sources.push(fn); }
  function adapterOf(j) {
    if (j._islandAdapter !== undefined) return j._islandAdapter;
    var a = null;
    if (j.bodyA && j.bodyB && j.bodyA !== j.bodyB) {
      for (var i = 0; i < registry.length; i++) if (j instanceof registry[i].ctor) { a = registry[i].make(j); break; }
    }
    if (a) a.key = 'j' + j.id;
    j._islandAdapter = a;
    return a;
  }
  register(P.RevoluteJoint, revoluteAdapter);
  register(P.WeldJoint, weldAdapter);
  register(P.PrismaticJoint, prismaticAdapter);
  register(P.DistanceJoint, distanceAdapter);
  register(P.PulleyJoint, pulleyAdapter);
  register(P.WinchJoint, winchAdapter);
  register(P.StructureLink, linkAdapter);
  register(P.LineSupport, lineSupportAdapter);

  /* -------------------------------------------------------------- islands */
  function state(world) {
    return world._island || (world._island = { sig: null, islands: [], adapters: [], legacy: [], n: 0, base: 0,
      calm: 0, need: 0, dissipated: 0, hc: 0, hr: 0, shown: 0 });
  }

  // Group the rows into islands. Kept while the same joints join the same
  // moving bodies; each island keeps its row order and matrix layout.
  function build(world, joints, h) {
    var st = state(world), adapters = [], legacy = [], sig = [];
    function flag(b) { return isDyn(b) ? 'd' : 's'; }
    joints.forEach(function (j) {
      if (j.broken || (P.StructureSolver && j instanceof P.StructureSolver)) return;
      var a = adapterOf(j);
      if (!a) { legacy.push(j); return; }
      adapters.push(a);
    });
    sources.forEach(function (src) { (src(world, h) || []).forEach(function (a) { adapters.push(a); }); });
    adapters.forEach(function (a) {
      var s = a.key;
      for (var i = 0; i < a.rows.length; i++) { var bs = a.rows[i].b; for (var k = 0; k < bs.length; k++) s += flag(bs[k]); }
      sig.push(s);
    });
    sig = sig.join(',');
    st.legacy = legacy;
    if (sig === st.sig) return st;
    st.sig = sig;
    st.islands.forEach(function (isl) { isl.bodies.forEach(function (b) { b._isl = null; }); });
    st.adapters = adapters;

    var parent = new Map();
    function find(b) { var p = parent.get(b); if (p === b) return b; var r = find(p); parent.set(b, r); return r; }
    adapters.forEach(function (a) {
      a.rows.forEach(function (r) {
        var first = null;
        r.live = false;
        for (var i = 0; i < r.n; i++) {
          var b = r.b[i];
          if (!isDyn(b)) continue;
          if (b.awake === false) b.wake();
          r.live = true;
          if (!parent.has(b)) parent.set(b, b);
          if (first) { var ra = find(first), rb = find(b); if (ra !== rb) parent.set(ra, rb); } else first = b;
        }
      });
    });
    var groups = new Map(), islands = [];
    parent.forEach(function (p, b) {
      var root = find(b), isl = groups.get(root);
      if (!isl) { isl = { bodies: [], rows: [], adapters: [], mids: [] }; groups.set(root, isl); islands.push(isl); }
      b._isl = isl; b._islIx = isl.bodies.length; isl.bodies.push(b);
    });
    adapters.forEach(function (a) {
      var isl = null;
      a.rows.forEach(function (r) {
        if (!r.live) { r.on = false; r.total = 0; return; }
        for (var i = 0; i < r.n; i++) if (r.b[i]._isl) { isl = r.b[i]._isl; break; }
        isl.rows.push(r);
      });
      if (isl) isl.adapters.push(a);
    });
    islands.forEach(layout);
    st.islands = islands;
    return st;
  }

  /*
   * Order of the unknowns and the envelope the factor lives in. The unknowns
   * are the rows' impulses, in reverse Cuthill-McKee order so chains and
   * beams stay banded. A body that many rows share (a hub with twenty arms)
   * would couple all of them and fill the matrix, so its velocity change is
   * kept as three unknowns of its own instead: its rows then meet only in
   * those three columns. Hub unknowns come after the rows that also hold an
   * ordinary body; rows that hold nothing but hubs come last, where the hubs
   * before them give them a pivot.
   */
  function layout(isl) {
    var rows = isl.rows, n = rows.length, nb = isl.bodies.length, i, k;
    var byBody = isl.bodies.map(function () { return []; });
    rows.forEach(function (r, ri) {
      r.hubOnly = true; r._hubbed = false;
      for (var s = 0; s < r.n; s++) if (r.b[s]._isl === isl) byBody[r.b[s]._islIx].push({ row: r, o: 3 * s, i: ri });
    });
    var hubs = [];
    isl.bodies.forEach(function (b, ib) { b._islHub = byBody[ib].length >= HUB_ROWS ? hubs.push({ body: b, ib: ib, pos: 0 }) : 0; });
    byBody.forEach(function (l, ib) { l.forEach(function (e) { if (isl.bodies[ib]._islHub) e.row._hubbed = true; else e.row.hubOnly = false; }); });
    var adj = rows.map(function () { return []; });
    byBody.forEach(function (l, ib) {
      if (isl.bodies[ib]._islHub) return;
      for (var a = 0; a < l.length; a++) for (var b = 0; b < l.length; b++) if (a !== b) adj[l[a].i].push(l[b].i);
    });
    var seen = new Uint8Array(n), order = [];
    var byDeg = rows.map(function (r, x) { return x; }).sort(function (a, b) { return adj[a].length - adj[b].length || a - b; });
    byDeg.forEach(function (s) {
      if (seen[s]) return;
      seen[s] = 1; var q = [s];
      for (var hd = 0; hd < q.length; hd++) {
        var nbs = adj[q[hd]].filter(function (x) { return !seen[x]; });
        nbs.sort(function (a, b) { return adj[a].length - adj[b].length || a - b; });
        nbs.forEach(function (x) { if (!seen[x]) { seen[x] = 1; q.push(x); } });
      }
      order = order.concat(q);
    });
    order.reverse();
    // rows with an ordinary body, then the hubs, then the hub-only rows
    var p = 0;
    order.forEach(function (ri) { if (!rows[ri].hubOnly) rows[ri].pos = p++; });
    hubs.forEach(function (hb) { hb.pos = p; p += 3; });
    order.forEach(function (ri) { if (rows[ri].hubOnly) rows[ri].pos = p++; });
    var nu = p, first = new Int32Array(nu), size = 0;
    for (k = 0; k < nu; k++) first[k] = k;
    function reach(a, b) { if (a < b) { if (a < first[b]) first[b] = a; } else if (b < first[a]) first[a] = b; }
    rows.forEach(function (r, ri) { adj[ri].forEach(function (x) { reach(r.pos, rows[x].pos); }); });
    hubs.forEach(function (hb) {
      byBody[hb.ib].forEach(function (e) { for (var c = 0; c < 3; c++) reach(e.row.pos, hb.pos + c); });
      reach(hb.pos, hb.pos + 1); reach(hb.pos, hb.pos + 2);
    });
    for (k = 0; k < nu; k++) size += k - first[k] + 1;
    isl.n = n; isl.nu = nu; isl.hubs = hubs; isl.first = first; isl.size = size;
    // one factor for each stage
    isl.fac = [0, 1].map(function () {
      var f = { L: [], U: [], diag: new Float64Array(nu), dinv: new Float64Array(nu) };
      for (var e = 0; e < nu; e++) { f.L.push(new Float64Array(e - first[e])); f.U.push(new Float64Array(e - first[e])); }
      return f;
    });
    isl.x = new Float64Array(nu);
    byBody.forEach(function (l) { l.sort(function (a, b) { return a.row.pos - b.row.pos; }); });
    isl.blist = byBody;
    isl.x0 = new Float64Array(nb); isl.y0 = new Float64Array(nb); isl.a0 = new Float64Array(nb);
    isl.bvx = new Float64Array(nb); isl.bvy = new Float64Array(nb); isl.bw = new Float64Array(nb);
  }

  /* --------------------------------------------------------- linear algebra */
  // The Newton matrix A = L M⁻¹ Dᵀ over the rows that are in the system for
  // this stage, plus each row's compliance on the diagonal. Row p of A is
  // how residual p changes with impulse q: its left vector is the row's
  // Jacobian where the bodies are now, the right one the direction impulse
  // q acts along, so in the position stage A is not symmetric (J(q1) against
  // J(q0)). Rows that are out get a unit diagonal, so the layout never
  // changes.
  function inSystem(r, stage) { return stage ? (r.vp && r.vs === 0) : (r.on && r.ps === 0); }
  function assemble(isl, stage, h) {
    var fc = isl.fac[stage], lo = fc.L, up = fc.U, diag = fc.diag, first = isl.first, bs = isl.bodies, rows = isl.rows, nu = isl.nu, k, c;
    for (k = 0; k < nu; k++) { lo[k].fill(0); up[k].fill(0); diag[k] = 0; }
    if (!stage) for (k = 0; k < rows.length; k++) rows[k].kd = 0;
    for (var ib = 0; ib < bs.length; ib++) {
      var B = bs[ib], im = B.invM, ii = B.invI, l = isl.blist[ib], hub = B._islHub ? isl.hubs[B._islHub - 1] : null;
      if (hub) for (c = 0; c < 3; c++) diag[hub.pos + c] = (c < 2 ? im : ii) > 0 ? 1 / (c < 2 ? im : ii) : 1;
      for (var p = 0; p < l.length; p++) {
        var rp = l[p].row;
        if (!inSystem(rp, stage)) continue;
        var left = !(!stage && rp.el && rp.nc);                  // a row with no say on C has only its diagonal
        var Lp = stage || rp.vel ? rp.D : rp.J, Dp = rp.D, op = l[p].o, pp = rp.pos;
        var ax = im * Lp[op], ay = im * Lp[op + 1], aw = ii * Lp[op + 2];
        if (left && !stage) rp.kd += ax * Dp[op] + ay * Dp[op + 1] + aw * Dp[op + 2];
        if (hub) {
          // row p against the hub's velocity change, and the hub's balance M·δv = Σ Dᵀ·δλ
          for (c = 0; c < 3; c++) {
            if (!((c < 2 ? im : ii) > 0)) continue;
            var hp = hub.pos + c;
            if (hp > pp) { if (left) up[hp][pp - first[hp]] += Lp[op + c]; lo[hp][pp - first[hp]] -= Dp[op + c]; }
            else { if (left) lo[pp][hp - first[pp]] += Lp[op + c]; up[pp][hp - first[pp]] -= Dp[op + c]; }
          }
          continue;
        }
        if (!left) continue;
        for (var q = 0; q < l.length; q++) {
          var rq = l[q].row;
          if (!inSystem(rq, stage)) continue;
          var Dq = rq.D, oq = l[q].o, pq = rq.pos, val = ax * Dq[oq] + ay * Dq[oq + 1] + aw * Dq[oq + 2];
          if (pq < pp) lo[pp][pq - first[pp]] += val;
          else if (pq > pp) up[pq][pp - first[pq]] += val;
          else diag[pp] += val;
        }
      }
    }
    for (k = 0; k < rows.length; k++) {
      var r = rows[k], d = r.pos;
      if (inSystem(r, stage)) {
        diag[d] += (!stage && r.el) ? r.gam / h : EPS * (stage ? Math.abs(diag[d]) : r.kd);
        if (!(diag[d] !== 0) && !r._hubbed) diag[d] = 1;          // nothing it could move
      } else diag[d] = 1;
    }
  }

  // LU inside the envelope, no pivoting (A is a small rotation away from
  // symmetric positive definite): envL holds L by rows, envU holds U by
  // columns, dinv the inverse pivots.
  function factorize(isl, stage) {
    var fc = isl.fac[stage], lo = fc.L, up = fc.U, diag = fc.diag, dinv = fc.dinv, first = isl.first, n = isl.nu;
    for (var i = 0; i < n; i++) {
      var li = lo[i], ui = up[i], fi = first[i], j, k, d0 = diag[i], d = d0;
      for (j = fi; j < i; j++) {
        var lj = lo[j], uj = up[j], fj = first[j], sl = li[j - fi], su = ui[j - fi];
        for (k = fi > fj ? fi : fj; k < j; k++) { sl -= li[k - fi] * uj[k - fj]; su -= lj[k - fj] * ui[k - fi]; }
        ui[j - fi] = su;
        li[j - fi] = sl * dinv[j];
      }
      for (k = fi; k < i; k++) d -= li[k - fi] * ui[k - fi];
      dinv[i] = Math.abs(d) > 1e-13 * Math.abs(d0) ? 1 / d : 0;      // a dependent row is left to the others
    }
  }
  function backsolve(isl, stage) {
    var fc = isl.fac[stage], lo = fc.L, up = fc.U, first = isl.first, dinv = fc.dinv, n = isl.nu, x = isl.x, i, k, e, f, s;
    for (i = 0; i < n; i++) { s = x[i]; e = lo[i]; f = first[i]; for (k = f; k < i; k++) s -= e[k - f] * x[k]; x[i] = s; }
    for (i = n - 1; i >= 0; i--) { s = x[i] * dinv[i]; x[i] = s; e = up[i]; f = first[i]; for (k = f; k < i; k++) x[k] -= e[k - f] * s; }
  }

  /* ------------------------------------------------------------ the stages */
  function evalAll(isl) { for (var i = 0; i < isl.adapters.length; i++) isl.adapters[i].eval(); }
  function ownVelocities(isl) {
    for (var i = 0; i < isl.bodies.length; i++) { var B = isl.bodies[i]; B.v = { x: B.v.x, y: B.v.y }; }
  }
  function drift(isl, h) {
    var bs = isl.bodies;
    for (var i = 0; i < bs.length; i++) {
      var B = bs[i];
      B.c.x = isl.x0[i] + h * B.v.x; B.c.y = isl.y0[i] + h * B.v.y;
      B.angle = isl.a0[i] + h * B.w; B.q.c = Math.cos(B.angle); B.q.s = Math.sin(B.angle);
    }
  }

  // Start of a substep, after the first half kick: directions at q0 and last
  // substep's impulses as the starting guess, so contacts see realistic
  // velocities.
  function begin(isl, h, sc) {
    var bs = isl.bodies, rows = isl.rows, i, r, hh = 0.5 * h;
    for (i = 0; i < bs.length; i++) { var B = bs[i]; isl.x0[i] = B.c.x; isl.y0[i] = B.c.y; isl.a0[i] = B.angle; }
    ownVelocities(isl);
    for (i = 0; i < isl.adapters.length; i++) isl.adapters[i].update(h);
    evalAll(isl);
    isl.mids.length = 0;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.on) { r.lam = 0; r.mu = 0; r.total = 0; r.ps = 2; r.vs = 2; r.el = false; continue; }
      r.C0 = r.C; r.D.set(r.J);
      r.el = !r.vel && r.k < Infinity;
      r.tgt = 0;
      if (r.el) {
        var den = 0.25 * h * r.k + 0.5 * r.c;
        if (!(den > 0)) { r.on = false; r.lam = 0; r.mu = 0; r.total = 0; r.ps = 2; r.vs = 2; continue; }
        r.gam = 1 / den; r.beta = (0.25 * h * r.k - 0.5 * r.c) * r.gam;
        r.g0 = r.gam; r.b0 = r.beta; r.ce = r.c; r.md = 0; r.nc = false;
        r.one = r.hi === 0 && r.lo < 0 ? 1 : (r.lo === 0 && r.hi > 0 ? -1 : 0);
      } else if (!r.vel) {
        // an error that was already there closes at a limited speed
        var corr = MAX_CORRECTION * h;
        if (r.C0 > corr && r.lo < 0) r.tgt = r.C0 - corr;
        else if (r.C0 < -corr && r.hi > 0) r.tgt = r.C0 + corr;
      }
      r.lam *= sc; r.mu *= sc;
    }
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.on) continue;
      bounds(r, hh, 0);
      if (r.lam > r.bhi) r.lam = r.bhi;
      if (r.lam < r.blo) r.lam = r.blo;
      r.ps = clampState(r.lam, r);
      if (r.lam !== 0) rowPush(r, r.D, r.lam);
    }
    for (i = 0; i < isl.adapters.length; i++) {
      var a = isl.adapters[i];
      if (a.started) a.started(h);
      if (a.rows.some(function (x) { return x.el; })) isl.mids.push(a);
    }
  }

  // Elastic rows act along their direction at the midpoint of the substep.
  // Re-aim them at the midpoint of the current iterate; returns how far that
  // moves any body (m or rad).
  function redirect(isl, h) {
    var bs = isl.bodies, i, shift = 0;
    for (i = 0; i < bs.length; i++) {
      var B = bs[i], am = 0.5 * (isl.a0[i] + B.angle);
      B.c.x = 0.5 * (isl.x0[i] + B.c.x); B.c.y = 0.5 * (isl.y0[i] + B.c.y);
      B.angle = am; B.q.c = Math.cos(am); B.q.s = Math.sin(am);
    }
    for (i = 0; i < isl.mids.length; i++) isl.mids[i].eval();
    for (i = 0; i < isl.rows.length; i++) {
      var r = isl.rows[i];
      if (!r.on || !r.el) continue;
      var lam = r.lam, J = r.J, D = r.D;
      if (lam !== 0) {
        for (var s = 0, o = 0; s < r.n; s++, o += 3) {
          var Bd = r.b[s];
          if (!Bd._isl) continue;
          var dx = Bd.invM * (J[o] - D[o]) * lam, dy = Bd.invM * (J[o + 1] - D[o + 1]) * lam, dw = Bd.invI * (J[o + 2] - D[o + 2]) * lam;
          Bd.v.x += dx; Bd.v.y += dy; Bd.w += dw;
          var m = h * Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw));
          if (m > shift) shift = m;
        }
      }
      D.set(J);
    }
    return shift;
  }

  // A line or stop with stiffness holds one way only: its energy is
  // U = ½k·c² on the taut side (c > 0) and nothing on the slack side. For a
  // substep that crosses between them the midpoint force is replaced by
  // −(U₁ − U₀)/(c₁ − c₀), which hands over exactly the energy the line
  // stores or gives back. s is the part of the substep spent taut.
  function oneSided(r, h) {
    var c0 = r.one * r.C0, c1 = r.one * r.C, md, s;
    if (c0 >= 0) {
      if (c1 >= 0) { md = 0; r.nc = false; r.gam = r.g0; r.beta = r.b0; r.ce = r.c; }
      else { md = 1; s = c0 / (c0 - c1); r.nc = true; r.gam = r.g0; r.beta = s * 0.25 * h * r.k * r.g0; r.ce = 0; }
    } else if (c1 <= 0) { md = 2; r.nc = true; r.gam = r.g0; r.beta = 0; r.ce = 0; }
    else { md = 3; s = Math.max(c1 / (c1 - c0), 1e-9); r.nc = false; r.gam = r.g0 / s; r.beta = 0; r.ce = r.c * s; }
    var changed = md !== r.md || md === 3;
    r.md = md;
    return changed;
  }

  function residual(r, h) {
    if (r.vel) return h * (rowVel(r, r.D) - r.vt);
    if (r.el) return (r.nc ? 0 : r.C) + r.gam * r.lam + r.beta * r.C0;
    return r.C - r.tgt;
  }

  function keepBest(isl) {
    var bs = isl.bodies, rows = isl.rows, i;
    for (i = 0; i < bs.length; i++) { isl.bvx[i] = bs[i].v.x; isl.bvy[i] = bs[i].v.y; isl.bw[i] = bs[i].w; }
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      r.lamB = r.lam; r.psB = r.ps;
      if (r.el) { if (!r.Db) r.Db = new Float64Array(r.D.length); r.Db.set(r.D); }
    }
  }
  function restoreBest(isl) {
    var bs = isl.bodies, rows = isl.rows, i;
    for (i = 0; i < bs.length; i++) { bs[i].v.x = isl.bvx[i]; bs[i].v.y = isl.bvy[i]; bs[i].w = isl.bw[i]; }
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      r.lam = r.lamB; r.ps = r.psB;
      if (r.el && r.Db) r.D.set(r.Db);
    }
  }

  // Position stage: Newton on the half-step impulses λ. Leaves the bodies at
  // q1 = q0 + h·v. Returns the iterations used; isl.failed if it gave up.
  // again: a later round of the same substep, so the last factor still fits
  function solvePosition(isl, h, stats, again) {
    var bs = isl.bodies, rows = isl.rows, n = isl.n, x = isl.x, hh = 0.5 * h, i, r;
    for (i = 0; i < bs.length; i++) { var B = bs[i]; B.c = { x: B.c.x, y: B.c.y }; B.q = { c: B.q.c, s: B.q.s }; }
    ownVelocities(isl);
    var refactor = !again, fresh = again ? 0 : 2, best = Infinity, done = false, worse = 0, it, err = 0, prev = Infinity, back = 0, switched = false;
    for (it = 0; it < MAX_NEWTON; it++) {
      drift(isl, h);
      var shift = 0;
      if (isl.mids.length) { shift = redirect(isl, h); drift(isl, h); }
      evalAll(isl);
      err = shift;
      for (i = 0; i < n; i++) {
        r = rows[i];
        if (!r.on) continue;
        if (r.el && r.one && oneSided(r, h)) refactor = true;
        var g = residual(r, h);
        r.res = g;
        bounds(r, hh, 0);
        if (r.ps === 0) { if (Math.abs(g) > err) err = Math.abs(g); }
        else if (r.jc) r.jc = false;      // just stopped at its limit: the others move first
        else if (r.ps === 1) { if (g > TOL) { r.ps = 0; refactor = true; if (g > err) err = g; } }
        else if (r.ps === -1) { if (g < -TOL) { r.ps = 0; refactor = true; if (-g > err) err = -g; } }
      }
      if (!(err < Infinity)) break;
      if (it > 0 && err > prev && back < 6 && !switched) {
        // the last step overshot (a bad starting guess, as when a chain
        // snaps taut): take half of it back and look again
        for (i = 0; i < n; i++) {
          r = rows[i];
          if (!r.on || r.dl === 0) continue;
          r.dl *= 0.5; r.lam -= r.dl; rowPush(r, r.D, -r.dl);
          if (r.ps !== 0 && r.lam > r.blo && r.lam < r.bhi) r.ps = 0;
        }
        back++; refactor = true;
        continue;
      }
      back = 0; switched = refactor;      // a row met or left a limit: the error may rise once
      if (err < best) { best = err; keepBest(isl); worse = 0; } else if (++worse > 4) break;
      if (err <= TOL) { done = true; break; }
      // Newton with the matrix for the current q1; once it is converging
      // fast the last factor is reused
      if (refactor || it < fresh || err > 0.1 * prev) { assemble(isl, 0, h); factorize(isl, 0); refactor = false; }
      prev = err;
      x.fill(0);
      for (i = 0; i < n; i++) { r = rows[i]; r.dl = 0; if (r.on && r.ps === 0) x[r.pos] = -r.res / h; }
      backsolve(isl, 0);
      // A row that would pass its limit stops there, and the step is solved
      // again without it: the other rows' share of this step assumed it
      // could carry more, and taking it anyway can throw a part clean
      // across a rope's circle to the far side.
      var hit = false;
      for (i = 0; i < n; i++) {
        r = rows[i];
        if (!r.on || r.ps !== 0) continue;
        var to = r.lam + x[r.pos];
        if (to > r.bhi || to < r.blo) { hit = true; break; }
      }
      for (i = 0; i < n; i++) {
        r = rows[i];
        if (!r.on || r.ps !== 0) continue;
        var nl = r.lam + x[r.pos];
        if (nl > r.bhi) { nl = r.bhi; r.ps = 1; r.jc = true; refactor = true; switched = true; }
        else if (nl < r.blo) { nl = r.blo; r.ps = -1; r.jc = true; refactor = true; switched = true; }
        else if (hit) continue;
        var d = nl - r.lam;
        r.lam = nl; r.dl = d;
        if (d !== 0) rowPush(r, r.D, d);
      }
    }
    if (!done) {
      // keep the iterate that came closest
      restoreBest(isl);
      drift(isl, h); evalAll(isl);
      isl.failed = true; stats.fallbacks++;
    }
    if (best > stats.residual && best < Infinity) stats.residual = best;
    for (i = 0; i < isl.adapters.length; i++) if (isl.adapters[i].posDone) isl.adapters[i].posDone(h);
    return it + 1;
  }

  // After the second half kick: the elastic rows' second half impulse, then
  // the velocity stage's starting guess along the directions at q1.
  function second(isl, h, st) {
    var rows = isl.rows, hh = 0.5 * h, i, r;
    ownVelocities(isl);
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.on || !r.el) continue;
      if (r.lam !== 0) rowPush(r, r.D, r.lam);
      if (r.ce > 0) { var rt = (r.C - r.C0) / h, dis = r.ce * rt * rt * h; st.dissipated += dis; isl.diss += dis; }
    }
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      r.vp = false;
      if (!r.on || r.el) { r.mu = 0; r.vs = 2; continue; }
      // a slack rope or an open limit has nothing to hold
      if ((r.ps === 1 && r.bhi === 0) || (r.ps === -1 && r.blo === 0)) { r.mu = 0; r.vs = 2; continue; }
      r.vp = true;
      r.D.set(r.J);
    }
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.vp) continue;
      bounds(r, hh, 1);
      if (r.mu > r.bhi) r.mu = r.bhi;
      if (r.mu < r.blo) r.mu = r.blo;
      r.vs = clampState(r.mu, r);
      if (r.mu !== 0) rowPush(r, r.D, r.mu);
    }
  }

  // Velocity stage: linear, so one solve per change of the active set.
  function solveVelocity(isl, h, again) {
    var rows = isl.rows, n = isl.n, x = isl.x, hh = 0.5 * h, i, r;
    ownVelocities(isl);
    var refactor = !again;
    for (var pass = 0; pass < 12; pass++) {
      var err = 0;
      for (i = 0; i < n; i++) {
        r = rows[i];
        if (!r.vp) continue;
        var g = rowVel(r, r.D) - (r.vel ? r.vt : r.rate);
        r.res = g;
        bounds(r, hh, 1);
        if (r.vs === 0) { if (Math.abs(g) > err) err = Math.abs(g); }
        else if (r.vs === 1) { if (g > VTOL) { r.vs = 0; refactor = true; if (g > err) err = g; } }
        else if (r.vs === -1) { if (g < -VTOL) { r.vs = 0; refactor = true; if (-g > err) err = -g; } }
      }
      if (err <= VTOL) break;
      if (refactor) { assemble(isl, 1, h); factorize(isl, 1); refactor = false; }
      x.fill(0);
      for (i = 0; i < n; i++) { r = rows[i]; if (r.vp && r.vs === 0) x[r.pos] = -r.res; }
      backsolve(isl, 1);
      for (i = 0; i < n; i++) {
        r = rows[i];
        if (!r.vp || r.vs !== 0) continue;
        var nm = r.mu + x[r.pos];
        if (nm > r.bhi) { nm = r.bhi; r.vs = 1; refactor = true; }
        else if (nm < r.blo) { nm = r.blo; r.vs = -1; refactor = true; }
        var d = nm - r.mu;
        r.mu = nm;
        if (d !== 0) rowPush(r, r.D, d);
      }
    }
    for (i = 0; i < n; i++) { r = rows[i]; r.total = r.on ? (r.el ? 2 * r.lam : r.lam + r.mu) : 0; }
  }

  /* --------------------------------------------------------- substep count */
  // Substeps per frame this island asked for in the substep just done, from
  // its forces and spins (see the header).
  function demand(isl, h, dt) {
    var bs = isl.bodies, ads = isl.adapters, invH = 1 / h, need = 0, a, i, k, r, b;
    for (i = 0; i < bs.length; i++) { bs[i]._gw = 0; bs[i]._gm = 0; bs[i]._ga = 0; bs[i]._arm = false; }
    // A body swings fast between two pulls, not on one: a bob on a single
    // rope or pin is a slow pendulum whatever the tension. So each body
    // counts the pull of all its connections but the largest.
    for (a = 0; a < ads.length; a++) {
      var ar = ads[a].rows;
      for (i = 0; i < ar.length; i++) {
        r = ar[i];
        if (!r.on || !r.g) continue;
        var F = Math.abs(r.total) * invH;
        for (k = 0; k < r.n; k++) {
          b = r.b[k];
          if (b._isl !== isl) continue;
          if (r.J[3 * k + 2] !== 0) b._arm = true;
          b._ga += F * r.g[k];
        }
      }
      for (i = 0; i < ar.length; i++) {
        r = ar[i];
        for (k = 0; k < r.n; k++) {
          b = r.b[k];
          if (b._isl !== isl || !b._ga) continue;
          b._gw += b._ga; if (b._ga > b._gm) b._gm = b._ga; b._ga = 0;
        }
      }
    }
    for (i = 0; i < bs.length; i++) {
      b = bs[i];
      var wg = Math.sqrt(4 * (b._gw - b._gm)) * dt / GEO_ANGLE;
      if (wg > need) need = wg;
      // a body turning on a lever arm swings its constraint directions round
      if (b._arm) { var wr = Math.abs(b.w) * dt / TURN_ANGLE; if (wr > need) need = wr; }
    }
    return need;
  }
  // Springs: their own frequency against the frame, from stiffness and the
  // masses they join. Known before the frame starts.
  function springDemand(st, dt, maxN) {
    var need = 0;
    st.islands.forEach(function (isl) {
      var seen = null;
      for (var a = 0; a < isl.adapters.length; a++) {
        var ad = isl.adapters[a], s = ad.omega && ad.joint.part && ad.joint.part.structure;
        if (!s || s === seen) continue;
        seen = s;
        var ws = ad.omega() * dt / SPRING_ANGLE;
        if (ws > need) need = ws;
      }
      for (var i = 0; i < isl.rows.length; i++) {
        var r = isl.rows[i];
        if (!r.on || !r.el || !(r.k > 0) || !(r.kd > 0)) continue;
        if (r.total === 0 && (r.hi === 0 || r.lo === 0)) continue;       // slack line
        var w = Math.sqrt(r.k * r.kd) * dt;                              // rad per frame
        if (w / maxN <= STIFF_ANGLE && w / SPRING_ANGLE > need) need = w / SPRING_ANGLE;
      }
    });
    return need;
  }
  function pickSubsteps(world, st) {
    if (world.substeps !== st.shown || !st.base) st.base = world.substeps;   // the caller changed it
    var base = st.base, maxN = Math.max(base, world.maxSubsteps || MAX_SUBSTEPS);
    if (world.islandAdaptive === false) { st.n = base; return base; }
    var want = base;
    while (want < st.need && want * 2 <= maxN) want *= 2;
    var cur = st.n >= base ? st.n : base;
    if (want >= cur) { cur = want; st.calm = 0; }
    else if (++st.calm >= 30) { cur = Math.max(want, cur / 2); st.calm = 0; }   // step back down slowly
    st.n = cur;
    return cur;
  }

  // Energy audit. An island that nothing drives (no motor, winch, contact
  // or capped row) must end a substep with the energy it began
  // with, less what its dampers took. bodyEnergy is kinetic plus the
  // potential of gravity and the applied forces (constant over a frame).
  function conservative(isl) {
    var rows = isl.rows, bs = isl.bodies, i, k, r;
    for (i = 0; i < bs.length; i++) if (bs[i]._touched) return false;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r.on) continue;
      if (r.vel || r.rate !== 0 || r.cone) return false;
      if ((r.lo !== 0 && r.lo > -Infinity) || (r.hi !== 0 && r.hi < Infinity)) return false;
      for (k = 0; k < r.n; k++) { var b = r.b[k]; if (b._isl !== isl && (b.v.x !== 0 || b.v.y !== 0 || b.w !== 0)) return false; }
    }
    return true;
  }
  function bodyEnergy(isl, g, out) {
    var bs = isl.bodies, E = 0, K = 0;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], ke = 0.5 * b.m * (b.v.x * b.v.x + b.v.y * b.v.y) + 0.5 * b.I * b.w * b.w;
      K += ke;
      E += ke - (b.m * b.gravityScale * g.x + b.force.x) * b.c.x - (b.m * b.gravityScale * g.y + b.force.y) * b.c.y - b.torque * b.angle;
    }
    out.K = K;
    return E;
  }
  // What the solve tolerance alone can move the energy by: every force in the
  // island working over a few tolerances.
  function energyFloor(isl, g, h) {
    var bs = isl.bodies, rows = isl.rows, F = 0, i;
    for (i = 0; i < bs.length; i++) {
      var b = bs[i];
      F += Math.abs(b.m * b.gravityScale * g.x + b.force.x) + Math.abs(b.m * b.gravityScale * g.y + b.force.y) + Math.abs(b.torque);
    }
    for (i = 0; i < rows.length; i++) if (rows[i].on) F += Math.abs(rows[i].total) / h;
    return 20 * TOL * F + 1e-12;
  }
  function elasticEnergy(isl, start) {
    var rows = isl.rows, U = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.on || !r.el) continue;
      var C = start ? r.C0 : r.C;
      if ((r.hi === 0 && C < 0) || (r.lo === 0 && C > 0)) continue;      // slack
      U += 0.5 * r.k * C * C;
    }
    return U;
  }

  /* ------------------------------------------------- undoing one substep */
  function Snapshot() { this.n = 0; this.b = new Float64Array(0); this.r = new Float64Array(0); this.c = new Float64Array(0); this.misc = []; }
  function grow(arr, n) { return arr.length >= n ? arr : new Float64Array(2 * n); }
  function save(snap, st, moving, contacts) {
    var i, k = 0, b;
    snap.b = grow(snap.b, 5 * moving.length);
    for (i = 0; i < moving.length; i++) { b = moving[i]; snap.b[k++] = b.c.x; snap.b[k++] = b.c.y; snap.b[k++] = b.angle; snap.b[k++] = b.v.x; snap.b[k++] = b.v.y; snap.b[k++] = b.w; }
    var nr = 0;
    st.islands.forEach(function (isl) { nr += isl.rows.length; });
    snap.r = grow(snap.r, 5 * nr + st.islands.length); k = 0;
    st.islands.forEach(function (isl) {
      for (var q = 0; q < isl.rows.length; q++) { var r = isl.rows[q]; snap.r[k++] = r.lam; snap.r[k++] = r.mu; snap.r[k++] = r.ps; snap.r[k++] = r.vs; snap.r[k++] = r.total; }
    });
    var nc = 0;
    contacts.forEach(function (ct) { nc += 1 + 4 * ct.points.length; });
    snap.c = grow(snap.c, nc); k = 0;
    contacts.forEach(function (ct) {
      snap.c[k++] = ct.rollingImpulse || 0;
      for (var q = 0; q < ct.points.length; q++) { var cp = ct.points[q]; snap.c[k++] = cp.normalImpulse; snap.c[k++] = cp.tangentImpulse; snap.c[k++] = cp.maxNormalImpulse; snap.c[k++] = cp.totalNormalImpulse; }
    });
    snap.misc.length = 0;
    st.adapters.forEach(function (a) { if (a.save) snap.misc.push(a.save()); });
    st.legacy.forEach(function (j) { snap.misc.push(j.impulse && typeof j.impulse === 'object' ? M.v(j.impulse.x, j.impulse.y) : j.impulse); });
    snap.dissipated = st.dissipated; snap.hc = st.hc; snap.hr = st.hr;
    return snap;
  }
  function load(snap, st, moving, contacts) {
    var i, k = 0, b;
    for (i = 0; i < moving.length; i++) {
      b = moving[i];
      b.c = M.v(snap.b[k], snap.b[k + 1]); b.angle = snap.b[k + 2]; b.q = M.rot(b.angle);
      b.v = M.v(snap.b[k + 3], snap.b[k + 4]); b.w = snap.b[k + 5]; k += 6;
    }
    k = 0;
    st.islands.forEach(function (isl) {
      for (var q = 0; q < isl.rows.length; q++) { var r = isl.rows[q]; r.lam = snap.r[k++]; r.mu = snap.r[k++]; r.ps = snap.r[k++]; r.vs = snap.r[k++]; r.total = snap.r[k++]; }
    });
    k = 0;
    contacts.forEach(function (ct) {
      ct.rollingImpulse = snap.c[k++];
      for (var q = 0; q < ct.points.length; q++) { var cp = ct.points[q]; cp.normalImpulse = snap.c[k++]; cp.tangentImpulse = snap.c[k++]; cp.maxNormalImpulse = snap.c[k++]; cp.totalNormalImpulse = snap.c[k++]; }
    });
    k = 0;
    st.adapters.forEach(function (a) { if (a.save) a.load(snap.misc[k++]); });
    st.legacy.forEach(function (j) { var v = snap.misc[k++]; j.impulse = v && typeof v === 'object' ? M.v(v.x, v.y) : v; });
    st.dissipated = snap.dissipated; st.hc = snap.hc; st.hr = snap.hr;
  }

  /* ---------------------------------------------------------------- frame */
  function step(world, dt) {
    var cfg = world.cfg, CS = P.contactSolver, st = state(world), g = world.gravity;
    world.dt = dt;
    var awake = function (b) { return b.type !== 'static' && b.awake !== false; };
    var active = function (A, B) { return awake(A) || awake(B); };
    world.joints.forEach(function (j) { if (j.preStep) j.preStep(dt); });
    P.broadphase.update(world);

    st.tok = {}; st.blk = { step: world.stepCount };
    var n = pickSubsteps(world, st);
    var maxN = Math.max(st.base, world.maxSubsteps || MAX_SUBSTEPS), adaptive = world.islandAdaptive !== false;
    var joints = world.joints.filter(function (j) { return active(j.bodyA, j.bodyB); });
    build(world, joints, dt / n);
    var islands = st.islands, legacy = st.legacy;
    var contacts = Array.from(world.contacts.values()).filter(function (ct) { return active(ct.fa.body, ct.fb.body); });
    var dyn = world.bodies.filter(function (b) { return b.type === 'dynamic' && awake(b); });
    var moving = world.bodies.filter(awake);
    var loose = moving.filter(function (b) { return !b._isl; });
    world.bodies.forEach(function (b) { b.c0 = M.v(b.c.x, b.c.y); b.angle0 = b.angle; });
    contacts.forEach(function (ct) { CS.prepare(ct, dt / n, cfg); });
    legacy.forEach(function (j) { j.prepare(dt / n, cfg); });
    contacts.forEach(function (ct) {
      if (!ct.isNew) return;
      var vMin = Math.min.apply(null, ct.points.map(function (p) { return p.relativeVelocity; }));
      if (vMin < -0.05) world.emit('impact', { a: ct.fa.body, b: ct.fb.body, speed: -vMin, point: ct.points[0].point });
    });
    var stats = world.islandStats || (world.islandStats = { fallbacks: 0 });
    stats.islands = islands.length; stats.iterations = 0; stats.residual = 0; stats.substeps = 0;
    stats.rows = islands.reduce(function (s, isl) { return s + isl.n; }, 0);
    var need = 0, hLast = dt / n, passes = world.islandPasses || PASSES;
    // contacts and outside joints that meet an island
    var touching = contacts.filter(function (ct) { return ct.fa.body._isl || ct.fb.body._isl; }), mixed = false;
    islands.forEach(function (isl) { isl.mixed = false; });
    touching.forEach(function (ct) { [ct.fa.body, ct.fb.body].forEach(function (b) { if (b._isl) b._isl.mixed = mixed = true; }); });
    legacy.forEach(function (j) { [j.bodyA, j.bodyB].forEach(function (b) { if (b._isl) b._isl.mixed = mixed = true; }); });

    // Half a substep of gravity, applied forces and damping. The damping is
    // applied on the outside of each half so the substep stays symmetric.
    function kick(hh, first) {
      for (var i = 0; i < dyn.length; i++) {
        var b = dyn[i];
        if (!b._isl) {
          // a body with no connections takes the whole kick up front, as
          // the contact solver expects
          if (first) {
            var h2 = 2 * hh, l2 = 1 / (1 + h2 * b.linearDamping), a2 = 1 / (1 + h2 * b.angularDamping);
            b.v = M.v((b.v.x + h2 * (b.invM * b.force.x + b.gravityScale * g.x)) * l2,
                      (b.v.y + h2 * (b.invM * b.force.y + b.gravityScale * g.y)) * l2);
            b.w = (b.w + h2 * b.invI * b.torque) * a2;
          }
          continue;
        }
        var ld = 1 / (1 + hh * b.linearDamping), ad = 1 / (1 + hh * b.angularDamping);
        var ax = hh * (b.invM * b.force.x + b.gravityScale * g.x), ay = hh * (b.invM * b.force.y + b.gravityScale * g.y);
        var aw = hh * b.invI * b.torque, vx = b.v.x, vy = b.v.y, w = b.w;
        if (!first) { vx += ax; vy += ay; w += aw; }
        if (ld !== 1 || ad !== 1) {
          var lost = 0.5 * b.m * (vx * vx + vy * vy) * (1 - ld * ld) + 0.5 * b.I * w * w * (1 - ad * ad);
          st.dissipated += lost; b._isl.diss += lost;
          vx *= ld; vy *= ld; w *= ad;
        }
        if (first) { vx += ax; vy += ay; w += aw; }
        var sp = Math.sqrt(vx * vx + vy * vy);
        if (sp > cfg.maxLinearSpeed) { vx *= cfg.maxLinearSpeed / sp; vy *= cfg.maxLinearSpeed / sp; }
        b.v = M.v(vx, vy); b.w = w;
      }
      for (var a = 0; a < st.adapters.length; a++) if (st.adapters[a].kick) st.adapters[a].kick(hh);
    }

    // One substep of size h. Returns the substeps per frame it turned out to
    // need (Infinity when an island's position solve gave up).
    function substep(h) {
      var invH = 1 / h, i, asked = 0, isl;
      if (adaptive) for (i = 0; i < islands.length; i++) { isl = islands[i]; isl.E0 = bodyEnergy(isl, g, isl); isl.K0 = isl.K; isl.diss = 0; }
      if (st.hc && st.hc !== h) {
        // stored contact impulses are per substep
        var sc = h / st.hc;
        contacts.forEach(function (ct) {
          if (ct.rollingImpulse) ct.rollingImpulse *= sc;
          ct.points.forEach(function (cp) { if (cp.normalImpulse) cp.normalImpulse *= sc; if (cp.tangentImpulse) cp.tangentImpulse *= sc; });
        });
      }
      st.hc = h;
      kick(0.5 * h, true);
      var sc = st.hr ? h / st.hr : 1;                 // stored impulses are per substep
      st.hr = h;
      for (i = 0; i < islands.length; i++) { islands[i].failed = false; begin(islands[i], h, sc); }
      if (adaptive) for (i = 0; i < islands.length; i++) islands[i].E0 += elasticEnergy(islands[i], true);
      legacy.forEach(function (j) { j.warmStart(); });
      contacts.forEach(function (ct) { CS.warmStart(ct); });
      legacy.forEach(function (j) { j.solve(h, true, cfg); });
      contacts.forEach(function (ct) { CS.solve(ct, invH, true, cfg); });
      loose.forEach(function (b) {
        var sp = M.len(b.v);
        if (sp > cfg.maxLinearSpeed) b.v = M.scale(b.v, cfg.maxLinearSpeed / sp);
        b.c = M.mulAdd(b.c, h, b.v);
        b.angle += h * b.w; b.q = M.rot(b.angle);
      });
      for (i = 0; i < islands.length; i++) stats.iterations += solvePosition(islands[i], h, stats);
      // Contacts and the joints left outside are solved against the islands
      // in turn, a few rounds, so each sees what the other did.
      for (var pass = 1; pass < passes && mixed; pass++) {
        legacy.forEach(function (j) { j.solve(h, true, cfg); });
        touching.forEach(function (ct) { CS.solve(ct, invH, true, cfg); });
        for (i = 0; i < islands.length; i++) if (islands[i].mixed) stats.iterations += solvePosition(islands[i], h, stats, true);
      }
      kick(0.5 * h, false);
      for (i = 0; i < islands.length; i++) second(islands[i], h, st);
      legacy.forEach(function (j) { j.solve(h, false, cfg); });
      contacts.forEach(function (ct) { CS.solve(ct, invH, false, cfg); });
      for (i = 0; i < islands.length; i++) solveVelocity(islands[i], h);
      for (pass = 1; pass < passes && mixed; pass++) {
        legacy.forEach(function (j) { j.solve(h, false, cfg); });
        touching.forEach(function (ct) { CS.solve(ct, invH, false, cfg); });
        for (i = 0; i < islands.length; i++) if (islands[i].mixed) solveVelocity(islands[i], h, true);
      }
      // the engine's speed limit, as the other path applies it after its solve
      for (i = 0; i < islands.length; i++) {
        var ib = islands[i].bodies;
        for (var q2 = 0; q2 < ib.length; q2++) {
          var sb = ib[q2], sp2 = Math.sqrt(sb.v.x * sb.v.x + sb.v.y * sb.v.y);
          if (sp2 > cfg.maxLinearSpeed) sb.v = M.scale(sb.v, cfg.maxLinearSpeed / sp2);
        }
      }
      deep = 0;
      for (i = 0; i < islands.length; i++) {
        // a solve that gave up asks for a finer step; with contacts on the
        // island the coupling to them, not the step, is usually what failed
        if (islands[i].failed) { if (islands[i].mixed) asked = Infinity; else deep = Infinity; continue; }
        var d = demand(islands[i], h, dt);
        if (d > asked) asked = d;
      }
      if (adaptive && deep < Infinity) {
        for (i = 0; i < contacts.length; i++) {
          var ct = contacts[i], hit = false;
          for (var q = 0; q < ct.points.length; q++) if (ct.points[q].normalImpulse > 0) hit = true;
          if (hit) { ct.fa.body._touched = true; ct.fb.body._touched = true; }
        }
        for (i = 0; i < legacy.length; i++) { legacy[i].bodyA._touched = true; legacy[i].bodyB._touched = true; }
        for (i = 0; i < islands.length; i++) {
          isl = islands[i];
          if (isl.mixed || !conservative(isl)) continue;
          var dE = bodyEnergy(isl, g, isl) + elasticEnergy(isl, false) + isl.diss - isl.E0;
          // the error falls as h², so this is how much finer it has to be
          var over = Math.abs(dE) / (ENERGY_TOL * Math.max(isl.K, isl.K0) + energyFloor(isl, g, h));
          if (over > 1) { var de = dt / h * Math.min(4, Math.sqrt(over)); if (de > deep) deep = de; }
        }
        for (i = 0; i < moving.length; i++) moving[i]._touched = false;
      }
      return asked;
    }

    // Advance by h; if that substep turns out too coarse for what happened in
    // it (a chain snapping taut, a solve that gave up), take it back and do
    // it as two halves.
    // The estimates of how fast things turn and pull may split a substep
    // down to maxSubsteps per frame; a solve that gave up or an energy audit
    // that failed may go on to maxSplit, within a budget of substeps per
    // frame.
    var snaps = st.snaps || (st.snaps = []), deep = 0, tries = 0;
    var maxSplit = Math.max(maxN, world.maxSplit || MAX_SPLIT), budget = BUDGET * maxN;
    function advance(h, depth) {
      var rate = dt / h, snap = null;
      var canSplit = adaptive && 2 * rate <= maxSplit + 1e-9 && tries < budget;
      if (canSplit) snap = save(snaps[depth] || (snaps[depth] = new Snapshot()), st, moving, contacts);
      var failsBefore = stats.fallbacks, resBefore = stats.residual;
      var asked = substep(h);
      tries++;
      var split = (asked > 1.25 * rate && 2 * rate <= maxN + 1e-9) || deep > 1.25 * rate;
      if (asked === Infinity) asked = 2 * rate;
      if (snap && split) {
        load(snap, st, moving, contacts);
        stats.fallbacks = failsBefore; stats.residual = resBefore;
        advance(0.5 * h, depth + 1); advance(0.5 * h, depth + 1);
        return;
      }
      stats.substeps++;
      hLast = h;
      if (asked > need) need = asked;
      if (deep > need && deep < Infinity) need = deep;
      for (var i = 0; i < st.adapters.length; i++) st.adapters[i].store(1 / h, h, st);
    }
    for (var s = 0; s < n; s++) advance(dt / n, 0);

    // impulses are left per substep of the last size used; readouts divide
    // by dt / world.substeps
    world.substeps = Math.round(dt / hLast); st.shown = world.substeps;
    st.need = Math.max(need, springDemand(st, dt, maxN));

    contacts.forEach(function (ct) { CS.restitute(ct, cfg); });
    if (CS.continuous) CS.continuous(world, dyn);
    dyn.forEach(function (b) { b.force = M.v(0, 0); b.torque = 0; b.lastApplied = b.appliedLog; b.appliedLog = []; });
    world.joints.forEach(function (j) { if (j.postStep) j.postStep(dt); });
    P.breakage.check(world, dt);
    P.islands.update(world, dt);
    world.time += dt;
    world.stepCount++;
    world.emit('step', { dt: dt });
  }

  // Energy held in the elastic rows now and removed by declared damping
  // (row dampers, body linear and angular damping) since the world began, J.
  function energy(world) {
    var st = state(world), U = 0;
    st.islands.forEach(function (isl) {
      isl.rows.forEach(function (r) {
        if (!r.on || r.vel || !(r.k < Infinity)) return;
        var C = r.C;
        if ((r.hi === 0 && C < 0) || (r.lo === 0 && C > 0)) return;      // slack
        U += 0.5 * r.k * C * C;
      });
    });
    return { elastic: U, dissipated: st.dissipated };
  }

  // Snapshots (serialize.js): fields starting `_isl` are skipped by the
  // generic copy and saved here: the substep bookkeeping and every row's
  // impulses, so a restored world replays bit for bit.
  var SCALARS = ['n', 'base', 'calm', 'need', 'dissipated', 'hc', 'hr', 'shown'];
  function saveState(world) {
    var st = world._island;
    if (!st) return null;
    var out = { rows: new Map(), extra: new Map() };
    SCALARS.forEach(function (k) { out[k] = st[k]; });
    world.joints.forEach(function (j) {
      var a = j._islandAdapter;
      if (!a) return;
      var v = new Float64Array(5 * a.rows.length);
      a.rows.forEach(function (r, i) { v[5 * i] = r.lam; v[5 * i + 1] = r.mu; v[5 * i + 2] = r.ps; v[5 * i + 3] = r.vs; v[5 * i + 4] = r.total; });
      out.rows.set(j, v);
      if (a.save) out.extra.set(j, a.save());
    });
    return out;
  }
  function loadState(world, saved) {
    var old = world._island;
    if (old) old.islands.forEach(function (isl) { isl.bodies.forEach(function (b) { b._isl = null; }); });
    if (!saved) { world._island = undefined; world.joints.forEach(function (j) { j._islandAdapter = undefined; }); return; }
    var st = state(world);
    SCALARS.forEach(function (k) { st[k] = saved[k]; });
    st.sig = null; st.islands = []; st.adapters = []; st.legacy = [];
    world.joints.forEach(function (j) {
      var v = saved.rows.get(j), a = j._islandAdapter;
      if (!v) { j._islandAdapter = undefined; return; }
      if (!a) a = adapterOf(j);
      a.rows.forEach(function (r, i) { r.lam = v[5 * i]; r.mu = v[5 * i + 1]; r.ps = v[5 * i + 2]; r.vs = v[5 * i + 3]; r.total = v[5 * i + 4]; });
      if (a.load && saved.extra.has(j)) a.load(saved.extra.get(j));
    });
  }

  P.island = {
    step: step, Row: Row, register: register, addSource: addSource, energy: energy,
    saveState: saveState, loadState: loadState,
    defaultOn: false,
    limits: { tolerance: TOL, maxSubsteps: MAX_SUBSTEPS, springAngle: SPRING_ANGLE, tensionAngle: GEO_ANGLE }
  };
})(globalThis.SE);
