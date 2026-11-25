'use strict';
// Materials, beams, trusses and breakage, checked against the textbook
// formulas the game teaches. Every tolerance is in the test name.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;

function world(g) { return new P.World({ gravity: { x: 0, y: g == null ? 0 : -g } }); }
// Run for `seconds`, ramping a load from 0 to its full value over `ramp`
// seconds so the structure is loaded quasi-statically (a suddenly applied
// load would overshoot to twice its static effect).
function rampLoad(w, ld, F, ramp, seconds) {
  let t = 0;
  w.run(seconds, 1 / 60, () => {
    t += 1 / 60;
    const r = Math.min(1, t / ramp);
    ld.F.x = F.x * r; ld.F.y = F.y * r;
  });
}
function breaks(w) { const list = []; w.on('break', e => list.push(e)); return list; }

suite('physics e06: materials and ratings', () => {
  test('P.material stays backward compatible and gains muS, muK, ultimate, label', () => {
    const s = P.material('steel');
    near(s.friction, 0.55, 1e-12); near(s.density, 7850, 1e-12);
    ok(s.muS >= s.muK && s.muK > 0, 'muS ' + s.muS + ' muK ' + s.muK);
    ok(s.ultimate > s.yield, 'ultimate above yield');
    ok(typeof s.label === 'string' && s.color, 'label and colour hint');
    ok(P.material(s) === s, 'objects pass straight through');
    Object.keys(P.MATERIALS).forEach(k => {
      const m = P.MATERIALS[k];
      ok(m.muS != null && m.muK != null && m.ultimate > 0 && m.E > 0 && m.density > 0, k + ' is complete');
    });
  });
  test('10 mm steel wire rope breaks at 55–70 kN (EN 12385-4: K·d²·R_r = 0.356 × 100 × 1770 N = 63 kN)', () => {
    const F = P.rating.cable('wireRope', 0.010);
    ok(F > 55e3 && F < 70e3, 'rated ' + F);
    near(F, 0.356 * 100 * 1770, 1e-9);
    near(P.rating.cable('wireRope', 0.010, 5), F / 5, 1e-12);    // a 5:1 working load
  });
  test('10 mm grade 80 chain breaks at 2 × πd²/4 × 800 MPa = 126 kN (within 1%)', () => {
    near(P.rating.cable('chain80', 0.010), 125.7e3, 0.01);
  });
  test('1/2 in manila and nylon match Cordage Institute strengths (10.6 kN, 27 kN, within 10%)', () => {
    near(P.rating.cable('manila', 0.0127), 10.6e3, 0.10);
    near(P.rating.cable('nylon', 0.0127), 27.0e3, 0.10);
  });
  test('rod, weld, pin and moment ratings follow σ·A, 0.6σ_u·t·L, 0.6σ_u·n·πd²/4, σ_y·S', () => {
    near(P.rating.rod('steel', 1e-4), 25e3, 1e-12);                         // 250 MPa × 100 mm²
    near(P.rating.weld('steel', 0.005 * 0.707, 0.1), 0.6 * 400e6 * 0.003535 * 0.1, 1e-9);
    const single = P.rating.pin('steel', 0.02);
    near(single, 0.6 * 400e6 * Math.PI * 1e-4, 1e-9);
    near(P.rating.pin('steel', 0.02, { double: true }), 2 * single, 1e-12);
    near(P.rating.moment('steel', P.section.rect(0.05, 0.1).S), 250e6 * 0.05 * 0.01 / 6, 1e-9);
  });
});

suite('physics e06: beams', () => {
  // Steel 100 × 200 mm, 4 m: EI = 200e9 × 0.1 × 0.2³/12 = 1.333e7 N·m².
  test('cantilever, tip load: deflection PL³/(3EI) within 3% and root moment PL within 1% (20 segments)', () => {
    const w = world();
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, section: { b: 0.1, h: 0.2 },
      material: 'steel', segments: 20, supports: [{ at: 'start', type: 'fixed' }] });
    const Pl = 10e3, ld = bm.load(4, { x: 0, y: 0 });
    rampLoad(w, ld, { x: 0, y: -Pl }, 1, 3);
    // hand check: 10e3 × 64 / (3 × 1.333e7) = 16.0 mm
    near(-bm.deflection(4), Pl * 64 / (3 * bm.EI), 0.03);
    near(-bm.bendingMoment(0), Pl * 4, 0.01);           // hogging: negative in Hibbeler's sign
    near(-bm.bendingMoment(10), Pl * 2, 0.01);          // M(x) = -P(L - x), linear
    near(bm.shearForce(5), Pl, 0.01);                   // V = +P all along
  });
  test('simply supported, centre load: deflection PL³/(48EI) within 3%, reactions P/2 within 1%', () => {
    const w = world();
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, section: { b: 0.1, h: 0.2 },
      material: 'steel', segments: 20, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    const Pl = 20e3, ld = bm.load(2, { x: 0, y: 0 });
    rampLoad(w, ld, { x: 0, y: -Pl }, 1, 3);
    // hand check: 20e3 × 64 / (48 × 1.333e7) = 2.0 mm
    near(-bm.deflection(2), Pl * 64 / (48 * bm.EI), 0.03);
    near(bm.supports[0].joint.reaction().force.y, Pl / 2, 0.01);
    near(bm.supports[1].joint.reaction().force.y, Pl / 2, 0.01);
    near(bm.bendingMoment(10), Pl * 4 / 4, 0.01);       // PL/4, sagging (positive)
  });
  test('a beam under its own weight: cantilever tip sag wL⁴/(8EI) within 3%', () => {
    const w = world(9.81);
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, section: { b: 0.05, h: 0.1 },
      material: 'timber', segments: 20, supports: [{ at: 'start', type: 'fixed' }] });
    w.run(3);
    const q = 550 * 0.005 * 9.81;                       // w = ρ A g = 27 N/m
    near(-bm.deflection(3), q * 81 / (8 * bm.EI), 0.03);
    near(-bm.bendingMoment(0), q * 9 / 2, 0.01);        // wL²/2
  });
  test('a cantilever breaks when the root moment passes σ_y·S: 0.95 holds, 1.05 breaks on moment', () => {
    // steel 50 × 100 mm: S = bh²/6 = 8.33e-5 m³, M_y = 20.8 kN·m; L = 2 m so P = 10.4 kN
    const run = (frac) => {
      const w = world(), list = breaks(w);
      const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, section: { b: 0.05, h: 0.1 },
        material: 'steel', segments: 20, supports: [{ at: 'start', type: 'fixed' }] });
      const Py = frac * bm.limits.moment / 2, ld = bm.load(2, { x: 0, y: 0 });
      rampLoad(w, ld, { x: 0, y: -Py }, 1, 2);
      return { list, bm };
    };
    const hold = run(0.95), snap = run(1.05);
    ok(hold.list.length === 0, 'broke at 0.95 M_y: ' + hold.list.map(e => e.reason));
    ok(snap.list.length === 1 && snap.list[0].reason === 'moment', 'expected one moment break, got ' + snap.list.map(e => e.reason));
    ok(snap.list[0].part.structure === snap.bm && snap.list[0].part.index === 0, 'the root failed');
    ok(snap.bm.bodies[19].c.y < -1, 'the freed beam is carried off by the load');
  });
  test('beam API: moments sum to statics along the span (within 1%)', () => {
    const w = world();
    const bm = P.structures.beam(w, { start: { x: 0, y: 1 }, end: { x: 6, y: 1 }, section: { b: 0.1, h: 0.3 },
      material: 'steel', segments: 12, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    const ld = bm.load(2, { x: 0, y: 0 });                  // 12 kN at a = 2 m, b = 4 m
    rampLoad(w, ld, { x: 0, y: -12e3 }, 1, 3);
    // R_A = Pb/L = 8 kN; M at x = 2 m is R_A·a = 16 kN·m, at x = 4 m it is R_B·2 = 8 kN·m
    near(bm.bendingMoment(4), 16e3, 0.01);
    near(bm.bendingMoment(8), 8e3, 0.01);
    near(bm.shearForce(2), 8e3, 0.01);
    near(bm.shearForce(10), -4e3, 0.01);
  });
});

// Method of joints, done the textbook way: two equilibrium equations per
// node, unknowns are the member forces (+ tension) and the support reactions.
function methodOfJoints(nodes, members, supports, loads) {
  const unknowns = members.length + supports.reduce((s, sp) => s + (sp.type === 'pin' ? 2 : 1), 0);
  const rows = nodes.length * 2, A = [], b = [];
  for (let r = 0; r < rows; r++) { A.push(new Array(unknowns).fill(0)); b.push(0); }
  members.forEach(([i, j], k) => {
    const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y, L = Math.hypot(dx, dy);
    A[2 * i][k] += dx / L; A[2 * i + 1][k] += dy / L;      // tension pulls node i toward j
    A[2 * j][k] -= dx / L; A[2 * j + 1][k] -= dy / L;
  });
  let c = members.length;
  supports.forEach(sp => {
    if (sp.type === 'pin') { A[2 * sp.node][c++] = 1; A[2 * sp.node + 1][c++] = 1; }
    else { A[2 * sp.node + 1][c++] = 1; }
  });
  loads.forEach(l => { b[2 * l.node] -= l.F.x; b[2 * l.node + 1] -= l.F.y; });
  // Gaussian elimination with partial pivoting
  const n = rows;
  for (let col = 0; col < n; col++) {
    let p = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]]; [b[col], b[p]] = [b[p], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < n; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

suite('physics e06: trusses', () => {
  // 3-panel Pratt truss, 2 m panels, 2 m deep: bottom 0-1-2-3, top 4-5.
  const nodes = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 2 }];
  const members = [[0, 1], [1, 2], [2, 3], [4, 5], [0, 4], [5, 3], [1, 4], [2, 5], [4, 2]];
  const supports = [{ node: 0, type: 'pin' }, { node: 3, type: 'roller' }];
  test('3-panel Pratt truss: every member force matches the method of joints within 2%', () => {
    const w = world();
    const tr = P.structures.truss(w, { nodes, members, material: 'steel', area: 2e-3, I: 1e-6, supports });
    const loads = [{ node: 1, F: { x: 0, y: -20e3 } }, { node: 2, F: { x: 0, y: -10e3 } }, { node: 5, F: { x: 5e3, y: 0 } }];
    const lds = loads.map(l => tr.load(l.node, { x: 0, y: 0 }));
    let t = 0;
    w.run(3, 1 / 60, () => { t += 1 / 60; const r = Math.min(1, t); lds.forEach((ld, i) => { ld.F.x = loads[i].F.x * r; ld.F.y = loads[i].F.y * r; }); });
    const exact = methodOfJoints(nodes, members, supports, loads);
    // hand check at joint 0 (no horizontal-load case): R0y = (20·4 + 10·2)/6 = 16.7 kN,
    // F04 = -R0y/sin45 ≈ -23.6 kN, F01 = +16.7 kN; the 5 kN push at node 5 shifts these.
    members.forEach((m, i) => {
      const sim = tr.memberForce(i), ref = exact[i];
      ok(Math.abs(sim - ref) <= 0.02 * Math.max(Math.abs(ref), 1e3),
        'member ' + m + ': sim ' + sim.toFixed(0) + ' N vs method of joints ' + ref.toFixed(0) + ' N');
    });
    near(tr.reaction(0).y, exact[9 + 1], 0.02);
    near(tr.reaction(1).y, exact[9 + 2], 0.02);
  });
  test('the same truss under gravity still matches (member weight averaged out, within 2%)', () => {
    const w = world(9.81);
    const tr = P.structures.truss(w, { nodes, members, material: 'steel', area: 2e-3, I: 1e-6, supports, nodeMass: 1 });
    const ld = tr.load(2, { x: 0, y: 0 });
    rampLoad(w, ld, { x: 0, y: -30e3 }, 1, 3);
    // lump every body's weight onto the nodes it hangs from: half a member at each end
    const loads = [{ node: 2, F: { x: 0, y: -30e3 } }];
    nodes.forEach((n, i) => loads.push({ node: i, F: { x: 0, y: -1 * 9.81 } }));
    tr.members.forEach(m => { const W = m.body.m * 9.81 / 2; loads.push({ node: m.a, F: { x: 0, y: -W } }, { node: m.b, F: { x: 0, y: -W } }); });
    const exact = methodOfJoints(nodes, members, supports, loads);
    members.forEach((m, i) => {
      const sim = tr.memberForce(i), ref = exact[i];
      ok(Math.abs(sim - ref) <= 0.02 * Math.max(Math.abs(ref), 1e3), 'member ' + m + ': ' + sim.toFixed(0) + ' vs ' + ref.toFixed(0));
    });
  });
  // Steel strut, 20 mm round bar, 2 m: I = πd⁴/64 = 7.85e-9 m⁴,
  // P_cr = π² × 200e9 × 7.85e-9 / 2² = 3.88 kN (crushing σ_y·A = 78.5 kN is far above).
  const strut = (frac, k) => {
    const w = world(); if (k) w.cfg.breakHysteresis = k;
    const list = breaks(w);
    const tr = P.structures.truss(w, { nodes: [{ x: 0, y: 0 }, { x: 0, y: 2 }], members: [[0, 1]], material: 'steel',
      area: Math.PI * 0.01 * 0.01, supports: [{ node: 0, type: 'pin' }, { node: 1, type: 'roller', normal: { x: 1, y: 0 } }] });
    const Pcr = Math.PI * Math.PI * 200e9 * (Math.PI * Math.pow(0.02, 4) / 64) / 4;
    near(tr.members[0].limits.buckling, Pcr, 1e-9);
    const ld = tr.load(1, { x: 0, y: 0 });
    rampLoad(w, ld, { x: 0, y: -frac * Pcr }, 1, 2);
    return { list, tr, Pcr };
  };
  test('a slender strut buckles above π²EI/L² and holds below it (±5%)', () => {
    const hold = strut(0.95), snap = strut(1.05);
    ok(hold.list.length === 0, 'buckled at 0.95 P_cr');
    near(-hold.tr.memberForce(0), 0.95 * hold.Pcr, 0.01);
    ok(snap.list.length === 1 && snap.list[0].reason === 'buckling', 'expected a buckling break, got ' + snap.list.map(e => e.reason));
    ok(snap.tr.members[0].broken && snap.list[0].joints.length === 2, 'the member is released from both pins');
  });
  test('a tie breaks in tension at σ_y·A: 0.95 holds, 1.05 breaks', () => {
    const run = (frac) => {
      const w = world(), list = breaks(w);
      const A = 1e-4;     // 100 mm² steel: σ_y·A = 25 kN
      const tr = P.structures.truss(w, { nodes: [{ x: 0, y: 0 }, { x: 0, y: -1.5 }], members: [[0, 1]], material: 'steel',
        area: A, supports: [{ node: 0, type: 'pin' }] });
      const ld = tr.load(1, { x: 0, y: 0 });
      rampLoad(w, ld, { x: 0, y: -frac * 250e6 * A }, 1, 2);
      return list;
    };
    ok(run(0.95).length === 0, 'tie broke at 0.95');
    const l = run(1.05);
    ok(l.length === 1 && l[0].reason === 'tension', 'expected a tension break, got ' + l.map(e => e.reason));
  });
});

suite('physics e06: breakage', () => {
  // A body pinned at its centre of mass: the pin carries exactly the applied
  // force on the step it is applied, so a one-step spike is a clean test.
  function spike(k, steps) {
    const w = world(); if (k) w.cfg.breakHysteresis = k;
    const list = breaks(w);
    const anchor = w.add(new P.Body({ type: 'static', position: { x: 0, y: 0 } }));
    const b = w.add(new P.Body({ position: { x: 0, y: 0 }, shapes: [P.box(0.2, 0.2)], mass: 10 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: anchor, bodyB: b, worldAnchor: { x: 0, y: 0 }, breakForce: 1000 }));
    for (let i = 0; i < 10; i++) { if (i >= 2 && i < 2 + steps) b.applyForce({ x: 2000, y: 0 }); w.step(1 / 60); }
    return list;
  }
  test('default hysteresis (1 step): a one-step spike breaks a part, reason force', () => {
    const l = spike(0, 1);
    ok(l.length === 1 && l[0].reason === 'force' && l[0].part === null, JSON.stringify(l.map(e => e.reason)));
  });
  test('breakHysteresis = 3: a one- or two-step spike is survived, three steps break it', () => {
    ok(spike(3, 1).length === 0, 'one-step spike broke it');
    ok(spike(3, 2).length === 0, 'two-step spike broke it');
    ok(spike(3, 3).length === 1, 'three-step overload did not break it');
  });
  test('plain welds still break on torque with reason torque', () => {
    const w = world(9.81), list = breaks(w);
    const wall = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.1, 1)] }));
    const arm = w.add(new P.Body({ position: { x: 1.1, y: 5 }, shapes: [P.box(1, 0.05)], mass: 20 }));
    w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0.1, y: 5 }, breakTorque: 150 }));
    w.run(1);
    ok(list.length === 1 && list[0].reason === 'torque', list.map(e => e.reason).join());
  });
});

suite('physics e06: stability and cost', () => {
  test('a loaded steel beam settles with no NaN and no jitter (tip speed < 1 mm/s after 3 s)', () => {
    const w = world(9.81);
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, section: { b: 0.1, h: 0.25 },
      material: 'steel', segments: 30, supports: [{ at: 'start', type: 'fixed' }, { at: 'end', type: 'roller' }] });
    bm.load(1.5, { x: 0, y: -30e3 });                   // applied suddenly
    w.run(3);
    bm.bodies.forEach(b => ok(isFinite(b.c.x) && isFinite(b.c.y), 'NaN'));
    ok(Math.abs(bm.bodies[29].v.y) < 1e-3 && Math.abs(bm.bodies[15].v.y) < 1e-3, 'still moving ' + bm.bodies[15].v.y);
  });
  test('a 200-body scene of beams and a truss steps in under 4 ms', () => {
    const w = world(9.81);
    for (let k = 0; k < 4; k++) {
      P.structures.beam(w, { start: { x: 0, y: k * 3 }, end: { x: 8, y: k * 3 }, section: { b: 0.1, h: 0.2 },
        material: 'steel', segments: 40, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    }
    const nodes = []; for (let i = 0; i <= 6; i++) nodes.push({ x: 2 * i, y: 20 }, { x: 2 * i, y: 22 });
    const members = [];
    for (let i = 0; i < 6; i++) members.push([2 * i, 2 * i + 2], [2 * i + 1, 2 * i + 3], [2 * i, 2 * i + 1], [2 * i, 2 * i + 3]);
    members.push([12, 13]);
    P.structures.truss(w, { nodes, members, material: 'steel', area: 2e-3, I: 1e-6, supports: [{ node: 0 }, { node: 12, type: 'roller' }] });
    ok(w.bodies.length >= 200, 'only ' + w.bodies.length + ' bodies');
    w.run(0.5);
    const t0 = process.hrtime.bigint();
    w.run(1);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 60;
    ok(ms < 4, ms.toFixed(2) + ' ms per step');
  });
});

// Ropes, props and pins on a structure are solved with it (structures.js), so
// they are as stiff as the beam. H3's timber cantilever: 2.4 m, 80 × 120 mm,
// EI = 11e9 × 0.08 × 0.12³ / 12 = 1.267e5 N·m², 3.2 kN at the tip.
suite('physics e06: ropes, props and pins on a beam', () => {
  const L = 2.4, Pl = 3200, g = 9.81;
  function cantilever(opts) {
    const w = world(g); if (opts && opts.off) w.structureCoupling = false;
    const list = breaks(w);
    const wall = w.add(new P.Body({ type: 'static', position: { x: -0.1, y: 3 }, shapes: [P.box(0.1, 2)] }));
    const bm = P.structures.beam(w, { start: { x: 0, y: 3 }, end: { x: L, y: 3 }, section: { b: 0.08, h: 0.12 },
      material: 'timber', segments: 20, damping: 0.1, supports: [{ at: 'start', type: 'fixed' }], ground: wall });
    const q = bm.bodies[0].m / bm.dx * g;                 // self-weight, N/m
    return { w, bm, wall, list, q, tip: bm.bodies[19] };
  }
  // cantilever deflections (down positive): tip load P at L, and the beam's weight q
  const vP = (EI, P0, x) => P0 * x * x * (3 * L - x) / (6 * EI);
  const vW = (EI, q, x) => q * x * x * (6 * L * L - 4 * L * x + x * x) / (24 * EI);

  // Stay from a hook at (0.1, 4.4) to the tip. Compatibility: the rope
  // stretches T·Lr/(EA_r) by as much as the tip moves away from the hook.
  // The tip moves down by (P − T e_y) f + v_w (f = L³/3EI + L/κGA, bending
  // plus shear) and toward the wall by T e_x L/(EA) (the beam is squeezed):
  //   T = e_y (P f + v_w) / (Lr/EA_r + e_y² f + e_x² L/EA)
  function stayed(EAr) {
    const c = cantilever();
    const hook = c.w.add(new P.Body({ type: 'static', position: { x: 0.1, y: 4.4 } }));
    const rope = c.w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: c.tip, localAnchorB: c.tip.localPoint({ x: L, y: 3 }), rope: true, EA: EAr }));
    rampLoad(c.w, c.bm.load(L, { x: 0, y: 0 }), { x: 0, y: -Pl }, 1, 4);
    const EI = c.bm.EI, EA = 11e9 * 0.0096, Lr = Math.hypot(2.3, 1.4), ex = -2.3 / Lr, ey = 1.4 / Lr;
    const f = L ** 3 / (3 * EI) + L / ((5 / 6) * (11e9 / 2.6) * 0.0096), vw = c.q * L ** 4 / (8 * EI);
    const T = ey * (Pl * f + vw) / ((EAr ? Lr / EAr : 0) + ey * ey * f + ex * ex * L / EA);
    return { c, rope, T, v: (Pl - T * ey) * f + vw };
  }
  test('stayed cantilever, wire-rope stay (EA = 3.56 MN): stay tension and tip deflection match the indeterminate hand calc within 5%', () => {
    const s = stayed(3.56e6);
    // hand check: T ≈ 5.79 kN (the stay takes 1.4/2.69 × 5.79 = 3.0 of the 3.2 kN), tip ≈ 8.6 mm instead of 120 mm
    near(s.rope.tension(), s.T, 0.05);
    near(-s.c.bm.deflection(L), s.v, 0.05);
    ok(s.c.list.length === 0, 'something broke');
  });
  test('stayed cantilever, inextensible stay: it takes the whole tip load (T = P·Lr/1.4 within 5%) and the tip barely moves (< 1 mm)', () => {
    const s = stayed(0);
    near(s.rope.tension(), s.T, 0.05);
    near(s.rope.tension(), Pl * Math.hypot(2.3, 1.4) / 1.4, 0.05);
    ok(-s.c.bm.deflection(L) < 1e-3, 'tip sagged ' + s.c.bm.deflection(L));
  });
  test('propped cantilever (frictionless prop 0.7 m from the tip): prop reaction and tip deflection match the formula within 5%', () => {
    const c = cantilever(), a = 1.7, r = 0.02;
    const prop = c.w.add(new P.Body({ type: 'static', position: { x: a, y: 3 - 0.06 - r }, shapes: [{ shape: P.circle(r), material: 'frictionless' }] }));
    rampLoad(c.w, c.bm.load(L, { x: 0, y: 0 }), { x: 0, y: -Pl }, 1, 4);
    const EI = c.bm.EI;
    // the prop removes the deflection at a: R a³/(3EI) = v_P(a) + v_w(a)  (≈ 5.26 kN)
    const R = (vP(EI, Pl, a) + vW(EI, c.q, a)) / (a ** 3 / (3 * EI));
    const tip = vP(EI, Pl, L) + vW(EI, c.q, L) - R * a * a * (3 * L - a) / (6 * EI);     // ≈ 8.2 mm
    const ct = [...c.w.contacts.values()].filter(k => k.fa.body === prop || k.fb.body === prop);
    const Rsim = ct.reduce((s, k) => s + (k.normalForce || 0), 0);
    near(Rsim, R, 0.05);
    near(-c.bm.deflection(L), tip, 0.05);
    ok(ct.every(k => k.points.every(p => p.separation > -1e-3)), 'the prop sank into the beam');
  });
  test('a 326 kg crate hung from the tip is picked up at once: the rope never goes slack or stretches (< 1 mm), static T = mg within 1%', () => {
    // steel here, so the beam is stiff (static tip sag ≈ 7.7 mm)
    const w = world(g);
    const bm = P.structures.beam(w, { start: { x: 0, y: 3 }, end: { x: L, y: 3 }, section: { b: 0.08, h: 0.12 },
      material: 'steel', segments: 20, damping: 0.1, supports: [{ at: 'start', type: 'fixed' }] });
    const tip = bm.bodies[19];
    const crate = w.add(new P.Body({ position: { x: L, y: 1.5 }, shapes: [P.box(0.3, 0.3)], mass: 326 }));
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: tip, bodyB: crate, localAnchorA: tip.localPoint({ x: L, y: 3 }), localAnchorB: { x: 0, y: 0.3 }, rope: true }));
    let stretch = 0, slip = 0, first = null;
    w.run(4, 1 / 60, () => {
      stretch = Math.max(stretch, rope.currentLength() - rope.maxLength);
      slip = Math.max(slip, Math.abs(crate.v.y - tip.velocityAt(rope.anchorA()).y));
      if (first == null) first = rope.tension();
    });
    ok(stretch < 1e-3, 'rope stretched ' + stretch);
    ok(slip < 0.02, 'crate and tip moved apart at ' + slip + ' m/s');
    ok(first > 300, 'rope carried only ' + first + ' N in the first step');
    near(rope.tension(), 326 * g, 0.01);
    const q = bm.bodies[0].m / bm.dx * g;
    near(-bm.deflection(L), 326 * g * L ** 3 / (3 * bm.EI) + q * L ** 4 / (8 * bm.EI), 0.05);
  });
  test('a pinned steel strut under the beam props it like a support at the pin (within 5%), and the pins stay closed', () => {
    const c = cantilever(), M = SE.pmath, a = 1.2;
    const pA = { x: 0, y: 1.6 }, pB = { x: a, y: 2.94 };            // pinned to the beam's underside
    const ax = M.norm(M.sub(pB, pA)), len = M.dist(pA, pB);
    const strut = c.w.add(new P.Body({ position: M.lerp(pA, pB, 0.5), angle: Math.atan2(ax.y, ax.x),
      shapes: [{ shape: P.box(len / 2, 0.01), group: -77 }], mass: 8 }));
    const j1 = c.w.addJoint(new P.RevoluteJoint({ bodyA: c.wall, bodyB: strut, worldAnchor: pA }));
    const j2 = c.w.addJoint(new P.RevoluteJoint({ bodyA: c.bm.pointAt(a).body, bodyB: strut, worldAnchor: pB }));
    rampLoad(c.w, c.bm.load(L, { x: 0, y: 0 }), { x: 0, y: -Pl }, 1, 4);
    const EI = c.bm.EI;
    // the strut pushes up R and outward R·dx/dy at the underside, 0.06 m below
    // the centreline, so the beam also takes a couple M0 = 0.06·R·dx/dy at a
    const m0 = 0.06 * ax.x / ax.y;
    const R = (vP(EI, Pl, a) + vW(EI, c.q, a)) / (a ** 3 / (3 * EI) + m0 * a * a / (2 * EI));
    const tip = vP(EI, Pl, L) + vW(EI, c.q, L) - R * a * a * (3 * L - a) / (6 * EI)
      - m0 * R * (a * a / 2 + a * (L - a)) / EI;
    near(-c.bm.deflection(L), tip, 0.05);
    ok(M.dist(j2.anchorA(), j2.anchorB()) < 1e-3 && M.dist(j1.anchorA(), j1.anchorB()) < 1e-3, 'a pin opened');
    ok(c.list.length === 0, 'something broke');
  });
  test('world.structureCoupling = false falls back to solving ropes on their own (the old, soft behaviour)', () => {
    const c = cantilever({ off: true });
    const hook = c.w.add(new P.Body({ type: 'static', position: { x: 0.1, y: 4.4 } }));
    const rope = c.w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: c.tip, localAnchorB: c.tip.localPoint({ x: L, y: 3 }), rope: true }));
    rampLoad(c.w, c.bm.load(L, { x: 0, y: 0 }), { x: 0, y: -Pl }, 1, 2);
    ok(rope.tension() < 0.8 * Pl * Math.hypot(2.3, 1.4) / 1.4, 'uncoupled rope should be soft here: ' + rope.tension());
  });
});
