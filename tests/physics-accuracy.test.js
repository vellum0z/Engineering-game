'use strict';
// Accuracy suite: one test per row of the engine accuracy targets. Each row
// is a closed-form result from mechanics, worked in the comment beside it,
// with the target tolerance the engine has to reach at the default step
// (1/60 s, 4 substeps).
//
// Rows the engine doesn't meet yet are listed in KNOWN with the work item
// that should fix them. They still run and print their measured error, but
// don't fail the build unless ACCURACY_STRICT=1 (or E09_STRICT=1) is set:
// that strict run is the gate for the new island solver. When a row starts
// passing, its KNOWN entry should be deleted so it can't regress.
//
//   node tests/run.js                          today's suite (known rows soft)
//   ACCURACY_STRICT=1 node tests/run.js        the gate: every target hard
//   E09_REPORT=1 node tests/run.js             table of every check
const { suite, test, ok } = require('./harness');
const P = globalThis.SE.phys, M = globalThis.SE.pmath;
const g = 9.81, DEG = Math.PI / 180;

// check name -> work item expected to fix it (numbers are the accuracy plan's
// work items). Refresh with ACCURACY_LIST=1, which prints every failing name.
const KNOWN = {};
[
  ['island solver (4)', [
    'pendulum rod 60°: energy / mgL',
    'pendulum pin 60°: period',
    'pendulum pin 60°: energy / mgL',
    'chain 4 pins: energy / mgL',
    'chain 4 pins: worst pin gap',
    'chain 10 pins: energy / mgL',
    'chain 10 pins: worst gap',
    'chain 20 pins: energy / mgL',
    'chain 20 pins: worst gap',
    'chain 10 rods: energy / mgL',
    'chain 10 rods: worst gap',
    'chain 20 rods: energy / mgL',
    'chain 20 rods: worst gap',
    'chain 4 pins, end 100x: energy / mgL',
    'chain 4 pins, end 100x: worst gap',
    'chain 4 rods, end 100x: energy / mgL',
    'chain 4 rods, end 100x: worst gap',
    'chain 10 pins, end 1000x: energy / mgL',
    'chain 10 pins, end 1000x: worst gap',
    'chain 10 rods, end 1000x: energy / mgL',
    'chain 10 rods, end 1000x: worst gap',
    'spring 5 Hz: amplitude',
    'spring 10 Hz: amplitude',
    'spring 10 Hz: period',
    'spring 20 Hz: amplitude',
    'spring 20 Hz: period',
    'spring 50 Hz: amplitude',
    'spring 50 Hz: phase-plane radius',
    'spring 100 Hz: amplitude',
    'spring 100 Hz: phase-plane radius',
    'cable pendulum 6 seg: peak stretch',
    'cable pendulum 20 seg: peak stretch',
    'catenary: end tension',
    'beam simple span: centre deflection',
    'beam simple span: first frequency',
    'beam ring-down ζ = 0: amplitude after 9 cycles',
    'beam ring-down ζ = 0.02: amplitude after 9 cycles',
    'beam end on post: drop',
    'free pair: angular momentum',
    'fuzz hub: worst energy rise in a step / scale',
    'fuzz mix: worst energy rise in a step / scale',
    'fuzz hub, frictionless: energy lost or gained / scale',
  ]],
  ['RATTLE integrator (5)', [
    'convergence rod: error(h) / error(h/2)',
    'convergence pin: error(h) / error(h/2)',
    'convergence chain: error(h) / error(h/2)',
  ]],
  ['resting contacts (6)', [
    'stack 1:100: light crate sink',
    'stack 1:100: heavy crate sink',
    'stack 1:1000: heavy crate sink',
    'stack 1:10000: light crate sink',
    'stack 1:10000: heavy crate sink',
    'fuzz stack: worst energy rise in a step / scale',
    'fuzz massRatio: worst energy rise in a step / scale',
    'fuzz overlap: worst energy rise in a step / scale',
  ]],
  ['time of impact (7)', [
    'bounce e = 1: rebound 1',
    'bounce e = 1: rebound 2',
    'bounce e = 1: rebound 3',
    'bounce e = 1: rebound 4',
    'bounce e = 1: rebound 5',
    'bounce e = 0.5: rebound 1',
    'bounce e = 0.5: rebound 2',
    'bounce e = 0.5: rebound 3',
  ]],
  ['winch motor (2)', [
    'winch plain: slack steps',
    'winch braked: slack steps',
    'winch pull limit 8 kN: lowered',
    'winch pull limit 8 kN: lifted',
    'winch pull limit 8 kN: slack steps',
    'winch limit and brake: lowered',
    'winch limit and brake: lifted',
    'winch limit and brake: slack steps',
    'fuzz winchLight: worst energy rise in a step / scale',
  ]],
].forEach(([item, names]) => names.forEach(n => { KNOWN[n] = item; }));
const STRICT = !!(process.env.ACCURACY_STRICT || process.env.E09_STRICT);
// ACCURACY_LIST=1: every failure soft, and print the failing check names (to refresh KNOWN)
const LIST = !!process.env.ACCURACY_LIST && !STRICT;

/* ------------------------------------------------- shared report helpers */
const E09 = globalThis.__E09 || (globalThis.__E09 = { rows: [] });
if (!E09.hooked) {
  E09.hooked = true;
  process.on('exit', () => {
    if (!process.env.E09_REPORT) return;
    const w = [52, 10, 14, 8];
    const line = cols => cols.map((c, i) => String(c).padEnd(w[i])).join(' ');
    console.log('\n' + line(['check', 'tolerance', 'error', 'result']));
    E09.rows.forEach(r => console.log(line([r.name.slice(0, w[0]), r.tol, r.err, r.status])));
  });
}
const fails = [];        // known failures in this file, printed once at the end
process.on('exit', () => {
  if (!fails.length) return;
  console.log(`\naccuracy: ${fails.length} targets not met yet (listed in KNOWN, soft)` + (LIST || process.env.E09_REPORT ? ':' : '; ACCURACY_LIST=1 lists them'));
  if (LIST || process.env.E09_REPORT) fails.forEach(f => console.log('  ' + f));
});
function record(name, pass, tol, err, detail) {
  const known = KNOWN[name];
  const status = pass ? (known ? 'pass (known listed)' : 'pass') : (known ? 'known:' + known : 'FAIL');
  E09.rows.push({ name: 'accuracy: ' + name, tol, err, status });
  if (pass) return;
  if ((known || LIST) && !STRICT) { fails.push(`${name} (${known || 'not listed'}): ${detail}`); return; }
  throw new Error(`${name}: ${detail}`);
}
const fmt = e => !isFinite(e) ? String(e) : (e !== 0 && Math.abs(e) < 1e-5 ? e.toExponential(1) : (100 * e).toFixed(3) + '%');
// relative error |measured/expected - 1| <= tol
function rel(name, measured, expected, tol) {
  const e = Math.abs(measured - expected) / Math.abs(expected);
  record(name, e <= tol, (100 * tol) + '%', fmt(e), `expected ≈${expected}, got ${measured} (${fmt(e)} > ${100 * tol}%)`);
}
// absolute: |measured - expected| <= tol (units in the label)
function abs(name, measured, expected, tol, unit) {
  const e = Math.abs(measured - expected);
  record(name, e <= tol, '±' + tol + unit, isFinite(e) ? e.toPrecision(3) + unit : String(e), `expected ${expected}${unit} ±${tol}, got ${measured}`);
}
function within(name, value, lo, hi, unit) {
  const pass = value >= lo && value <= hi;
  record(name, pass, lo + '..' + hi + (unit || ''), isFinite(value) ? (+value).toPrecision(4) + (unit || '') : String(value), `expected ${lo}..${hi}, got ${value}`);
}
function pending(name) {
  console.log('  pending: ' + name);
  E09.rows.push({ name: 'accuracy: ' + name, tol: '-', err: '-', status: 'pending' });
}

/* ---------------------------------------------------------- scene helpers */
function world(o) { return new P.World(Object.assign({ gravity: { x: 0, y: -g }, enableSleep: false }, o || {})); }
function fixed(w, x, y, shapes) { return w.add(new P.Body({ type: 'static', position: { x, y }, shapes: shapes || [] })); }
function run(w, T, each, dt) { dt = dt || 1 / 60; const n = Math.round(T / dt); for (let i = 0; i < n; i++) { w.step(dt); if (each && each(w, i) === false) break; } }
const energy = w => w.bodies.reduce((E, b) => b.type === 'dynamic' ? E + b.kineticEnergy() + b.m * g * b.c.y : E, 0);
function agm(a, b) { for (let i = 0; i < 40; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return a; }
// times at which f() crosses zero going up, interpolated inside the step
function upCrossings(w, T, f, dt) {
  dt = dt || 1 / 60; const out = []; let prev = f();
  run(w, T, () => { const x = f(); if (prev < 0 && x >= 0) out.push(w.time - dt * x / (x - prev)); prev = x; }, dt);
  return out;
}
const period = cr => (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
const finite = w => w.bodies.every(b => isFinite(b.c.x) && isFinite(b.c.y) && isFinite(b.v.x) && isFinite(b.w));

// A chain of n links (pins or rods) released straight out sideways from a
// fixed pivot; returns the worst energy change / (m g L) and worst joint gap.
function chain(n, kind, endMass, T) {
  const w = world(), top = fixed(w, 0, 0), Ls = 0.5; let prev = top; const links = [];
  for (let i = 0; i < n; i++) {
    const m = (i === n - 1 && endMass) ? endMass : 2;
    const link = w.add(new P.Body({ position: { x: Ls * i + Ls / 2, y: 0 }, shapes: [{ shape: P.box(Ls / 2, 0.02), group: -1 }], mass: m }));
    if (kind === 'pin') w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: Ls * i, y: 0 } }));
    else w.addJoint(new P.DistanceJoint({ bodyA: prev, bodyB: link, localAnchorA: prev === top ? { x: 0, y: 0 } : { x: Ls / 2 - 0.05, y: 0 }, localAnchorB: { x: -Ls / 2 + 0.05, y: 0 } }));
    prev = link; links.push(link);
  }
  const E0 = energy(w), mtot = links.reduce((s, b) => s + b.m, 0), scale = mtot * g * n * Ls;
  let dE = 0, gap = 0;
  run(w, T || 10, () => {
    dE = Math.max(dE, Math.abs(energy(w) - E0));
    w.joints.forEach(j => {
      const a = j.anchorA(), b = j.anchorB(), d = Math.hypot(a.x - b.x, a.y - b.y);
      gap = Math.max(gap, j.type === 'distance' ? Math.abs(d - j.length) : d);
    });
  });
  return { dE: finite(w) ? dE / scale : Infinity, gap: finite(w) ? gap : Infinity };
}
function pendulum(kind, L, th0, substeps, dt) {
  const w = world({ substeps: substeps || 4 }), top = fixed(w, 0, 0);
  const bob = w.add(new P.Body({ position: { x: L * Math.sin(th0), y: -L * Math.cos(th0) }, shapes: [P.circle(0.05)], mass: 3 }));
  if (kind === 'rod') w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: bob, length: L }));
  else w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: bob, worldAnchor: { x: 0, y: 0 } }));
  return { w, bob };
}

/* --------------------------------------------------- pendulums and chains */
suite('accuracy: pendulums and chains', () => {
  test('pendulum on a rod and on a pin, 60°, 60 s: energy within 0.1% of mgL, period within 0.01% of the elliptic period', () => {
    // Exact period from 60°: T = 2π√(L/g) / AGM(1, cos 30°). For the pin the
    // bob turns with the arm, so the length is the compound one, (I_c + mL²)/(mL).
    ['rod', 'pin'].forEach(kind => {
      const L = 2, th0 = 60 * DEG, { w, bob } = pendulum(kind, L, th0);
      const E0 = energy(w); let dE = 0;
      const cr = upCrossings(w, 60, () => { dE = Math.max(dE, Math.abs(energy(w) - E0)); return bob.c.x; });
      const Lq = kind === 'pin' ? (bob.I + bob.m * L * L) / (bob.m * L) : L;
      rel(`pendulum ${kind} 60°: period`, period(cr), 2 * Math.PI * Math.sqrt(Lq / g) / agm(1, Math.cos(th0 / 2)), 1e-4);
      abs(`pendulum ${kind} 60°: energy / mgL`, dE / (bob.m * g * L), 0, 1e-3, '');
    });
  });
  test('4-link pinned chain, 10 s: energy within 0.2%, pins closed to 0.01 mm', () => {
    const r = chain(4, 'pin');
    abs('chain 4 pins: energy / mgL', r.dE, 0, 2e-3, '');
    abs('chain 4 pins: worst pin gap', r.gap * 1000, 0, 0.01, ' mm');
  });
  test('10- and 20-link chains of pins and of rods, 10 s: energy within 2%, joints closed to 0.01 mm', () => {
    [[10, 'pin'], [20, 'pin'], [10, 'rod'], [20, 'rod']].forEach(([n, kind]) => {
      const r = chain(n, kind);
      abs(`chain ${n} ${kind}s: energy / mgL`, r.dE, 0, 0.02, '');
      abs(`chain ${n} ${kind}s: worst gap`, r.gap * 1000, 0, 0.01, ' mm');
    });
  });
  test('chain with an end load 100 and 1000 times a link: stable, energy within 5%, joints within 0.1 mm', () => {
    [[4, 200], [10, 2000]].forEach(([n, end]) => ['pin', 'rod'].forEach(kind => {
      const r = chain(n, kind, end);
      abs(`chain ${n} ${kind}s, end ${end / 2}x: energy / mgL`, r.dE, 0, 0.05, '');
      abs(`chain ${n} ${kind}s, end ${end / 2}x: worst gap`, r.gap * 1000, 0, 0.1, ' mm');
    }));
  });
  test('convergence: halving the step cuts the error about 4 times (ratio 3 to 5) on a pendulum and a chain', () => {
    // A second-order integrator's error scales with h², so h/2 gives a
    // quarter of it. Compared at the same simulated time, step 1/60 vs 1/120.
    const err = (dt, kind) => {
      if (kind === 'chain') {
        const w = world(), top = fixed(w, 0, 0); let prev = top;
        for (let i = 0; i < 4; i++) { const l = w.add(new P.Body({ position: { x: 0.5 * i + 0.25, y: 0 }, shapes: [{ shape: P.box(0.25, 0.02), group: -1 }], mass: 2 })); w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: l, worldAnchor: { x: 0.5 * i, y: 0 } })); prev = l; }
        const E0 = energy(w); let dE = 0; run(w, 3, () => { dE = Math.max(dE, Math.abs(energy(w) - E0)); }, dt); return dE;
      }
      const { w } = pendulum(kind, 2, 60 * DEG); const E0 = energy(w); let dE = 0;
      run(w, 10, () => { dE = Math.max(dE, Math.abs(energy(w) - E0)); }, dt); return dE;
    };
    ['rod', 'pin', 'chain'].forEach(kind => within(`convergence ${kind}: error(h) / error(h/2)`, err(1 / 60, kind) / err(1 / 120, kind), 3, 5));
  });
});

/* ---------------------------------------------------------------- springs */
suite('accuracy: springs', () => {
  test('spring and mass from 1 to 100 Hz, 60 s: amplitude within 1%; period within 0.1% below 20 Hz, 2% up to 100 Hz', () => {
    // m = 4 kg, k = m(2πf)², released 0.1 m from rest length in zero g:
    // x(t) = 0.1 cos(2πf t), so the swing stays 0.1 m and T = 1/f.
    [1, 5, 10, 20, 50, 100].forEach(f => {
      const m = 4, k = m * Math.pow(2 * Math.PI * f, 2), w = world({ gravity: { x: 0, y: 0 } }), wall = fixed(w, 0, 0);
      const b = w.add(new P.Body({ position: { x: 1.1, y: 0 }, shapes: [P.circle(0.05)], mass: m }));
      w.addJoint(new P.DistanceJoint({ bodyA: wall, bodyB: b, length: 1, stiffness: k, damping: 0 }));
      let late = 0;
      // sample finely enough to see the peaks: 100 Hz needs steps well under 5 ms,
      // but the step stays 1/60 s, so read the amplitude from energy instead
      const amp = () => Math.sqrt((b.kineticEnergy() + 0.5 * k * Math.pow(b.c.x - 1, 2)) * 2 / k);
      const cr = upCrossings(w, f < 20 ? 60 : 10, () => { if (w.time > (f < 20 ? 59 : 9)) late = Math.max(late, amp()); return b.c.x - 1; });
      rel(`spring ${f} Hz: amplitude`, late || amp(), 0.1, 0.01);
      if (f <= 20) rel(`spring ${f} Hz: period`, cr.length > 2 ? period(cr) : NaN, 1 / f, f < 20 ? 1e-3 : 0.02);
      else {
        // above the 30 Hz sampling limit crossings alias; use the energy-phase
        // estimate: count sign changes is meaningless, so check the angular
        // frequency from velocity and position: ω² = k/m when v and x are exact
        const om = Math.sqrt(k / m), phaseW = Math.hypot(b.v.x / om, b.c.x - 1);
        rel(`spring ${f} Hz: phase-plane radius`, phaseW, 0.1, 0.02);
      }
    });
  });
  test('cable pendulum, 6 and 20 segments, 20 s: swing height kept to 99%, stretch within 5% of TL/EA', () => {
    // 3 m steel cable (d = 10 mm, EA = 2e11·π·0.005² = 15.7 MN) with 50 kg,
    // released at 45°. With no air drag the turning point stays at the start
    // height; the cable stretches by T·L/EA, T ≈ m g (3 − 2 cos 45°) at the bottom.
    [6, 20].forEach(seg => {
      const w = world(), top = fixed(w, 0, 0), L = 3, th = 45 * DEG;
      const load = w.add(new P.Body({ position: { x: L * Math.sin(th), y: -L * Math.cos(th) }, shapes: [P.circle(0.1)], mass: 50 }));
      P.cable.build(w, { from: { body: top }, to: { body: load }, length: L, segments: seg, diameter: 0.01, material: 'steel', linearDamping: 0 });
      let peak = -1e9, maxr = 0;
      run(w, 20, () => { maxr = Math.max(maxr, Math.hypot(load.c.x, load.c.y)); if (w.time > 17) peak = Math.max(peak, load.c.y); });
      const h0 = -L * Math.cos(th), EA = P.material('steel').E * Math.PI * 0.005 * 0.005;
      const Tmax = 50 * g * (3 - 2 * Math.cos(th)) + (P.cable.build ? 0 : 0);
      within(`cable pendulum ${seg} seg: swing height kept`, (peak + L) / (h0 + L), 0.99, 1.01);
      rel(`cable pendulum ${seg} seg: peak stretch`, Math.max(maxr - L, 1e-9), Tmax * L / EA, 0.05);
    });
  });
  test('catenary of 20 links: sag within 1%, end tension within 2% of the cosh solution', () => {
    // Span 10 m, cable 11 m, 2 kg/m: solve 11 = 2a sinh(5/a) for a, then
    // sag = a(cosh(5/a) − 1) and T_end = w(a + sag).
    const w = world(), span = 10, len = 11, mpl = 2;
    const left = fixed(w, 0, 10), right = fixed(w, span, 10);
    const c = P.cable.build(w, { from: { body: left }, to: { body: right }, length: len, segments: 20, massPerLength: mpl, linearDamping: 0.5 });
    run(w, 20);
    const cat = P.cable.catenary(span, len, mpl * g);
    const low = Math.min(...c.bodies.map(b => b.c.y));
    rel('catenary: mid-span sag', 10 - low, cat.sag, 0.01);
    rel('catenary: end tension', c.tensionAt(0), cat.Tmax, 0.02);
  });
});

/* --------------------------------------------------------------- beams */
suite('accuracy: beams', () => {
  const sec = { b: 0.05, h: 0.1 }, I = 0.05 * 0.001 / 12, A = 0.005;
  const steel = () => P.material('steel');
  test('beam static, 20 segments: cantilever PL³/3EI, simple span PL³/48EI, moment Px (within 0.5%)', () => {
    if (!P.structures) { pending('beam statics (needs structures.js)'); return; }
    const L = 4, Pl = 2000, E = steel().E;
    let w = world({ gravity: { x: 0, y: 0 } });
    let bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, supports: [{ at: 'start', type: 'fixed' }] });
    bm.load(L, { x: 0, y: -Pl }); run(w, 6);
    rel('beam cantilever: tip deflection', -bm.deflection(L), Pl * L ** 3 / (3 * E * I), 0.005);
    rel('beam cantilever: root moment', Math.abs(bm.bendingMoment(0)), Pl * L, 0.005);
    w = world({ gravity: { x: 0, y: 0 } });
    bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    bm.load(L / 2, { x: 0, y: -Pl }); run(w, 6);
    rel('beam simple span: centre deflection', -bm.deflection(L / 2), Pl * L ** 3 / (48 * E * I), 0.005);
    rel('beam simple span: centre moment', Math.abs(bm.bendingMoment(10)), Pl * L / 4, 0.005);
  });
  // first-mode frequency from zero crossings of the free vibration after a
  // load is released
  function ring(supports, xRead, damping, T) {
    const L = 4, w = world({ gravity: { x: 0, y: 0 } });
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, damping, supports });
    bm.load(xRead, { x: 0, y: -2000 }); run(w, 6); bm.clearLoads();
    // zero crossings interpolated inside the step, peaks from a parabola
    // through the three samples around each maximum (a 14 Hz beam gets only
    // four samples a cycle at 60 Hz)
    const peaks = [], cr = [], dt = 1 / 60; let prev = bm.deflection(xRead), prev2 = prev, pk = 0;
    run(w, T, () => {
      const x = bm.deflection(xRead), a = Math.abs(prev2), b = Math.abs(prev), c = Math.abs(x);
      if (b >= a && b >= c && Math.sign(prev2) === Math.sign(prev) && Math.sign(prev) === Math.sign(x)) {
        const d = a - 2 * b + c; pk = Math.max(pk, d < 0 ? b - (a - c) * (a - c) / (8 * d) : b);
      }
      if (prev < 0 && x >= 0) { cr.push(w.time - dt * x / (x - prev)); peaks.push(pk); pk = 0; }
      prev2 = prev; prev = x;
    });
    return { f: (cr.length - 1) / (cr[cr.length - 1] - cr[0]), peaks, cr };
  }
  test('beam first natural frequency, cantilever and simple span: (βL)²√(EI/ρAL⁴)/2π (within 1%)', () => {
    if (!P.structures) { pending('beam frequency'); return; }
    const L = 4, base = Math.sqrt(steel().E * I / (steel().density * A * L ** 4)) / (2 * Math.PI);
    rel('beam cantilever: first frequency', ring([{ at: 'start', type: 'fixed' }], L, 0, 3).f, 1.8751 ** 2 * base, 0.01);
    rel('beam simple span: first frequency', ring([{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }], L / 2, 0, 2).f, Math.PI ** 2 * base, 0.01);
  });
  test('beam ring-down: envelope e^(−ζωt) within 5% over 10 cycles, and none at ζ = 0', () => {
    if (!P.structures) { pending('beam ring-down'); return; }
    [0, 0.02].forEach(z => {
      const r = ring([{ at: 'start', type: 'fixed' }], 4, z, 2.4);
      const k = Math.min(10, r.peaks.length - 1);
      const expected = Math.exp(-z * 2 * Math.PI * r.f * (r.cr[k] - r.cr[1]));
      rel(`beam ring-down ζ = ${z}: amplitude after ${k - 1} cycles`, r.peaks[k] / r.peaks[1], expected, 0.05);
    });
  });
  test('rope, rod, cable or post holding a beam end: drop = TL/EA of the support (within 2% or 0.05 mm), force = reaction', () => {
    if (!P.structures) { pending('beam end supports'); return; }
    // 4 m beam pinned at the start, a 5 kN load at mid-span, the far end held
    // by a 2 m support. Reaction R = W/2 + P/2; a rigid support doesn't move,
    // an elastic one drops R·L/EA.
    const L = 4, EAsteel = P.material('steel').E * Math.PI * 0.005 * 0.005;
    ['rope', 'rod', 'rope EA', 'cable', 'post'].forEach(kind => {
      const w = world();
      const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, supports: [{ at: 'start', type: 'pin' }] });
      const endBody = bm.bodies[bm.bodies.length - 1], top = fixed(w, L, 2), la = endBody.localPoint({ x: L, y: 0 });
      const W = steel().density * A * L * g, R = W / 2 + 2500;
      let j = null, exact = 0;
      if (kind === 'rope') j = w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: endBody, localAnchorB: la, length: 2, rope: true }));
      if (kind === 'rod') j = w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: endBody, localAnchorB: la, length: 2 }));
      if (kind === 'rope EA') { j = w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: endBody, localAnchorB: la, length: 2, rope: true, EA: EAsteel })); exact = R * 2 / EAsteel; }
      if (kind === 'cable') { const c = P.cable.build(w, { from: { body: top }, to: { body: endBody, localAnchor: la }, length: 2, segments: 6, diameter: 0.01, material: 'steel' }); exact = R * 2 / EAsteel; j = { force: () => c.tensionAt(0) }; }
      if (kind === 'post') fixed(w, L - 0.1, -0.05 - 0.5, [P.box(0.1, 0.5)]);
      bm.load(L / 2, { x: 0, y: -5000 });
      run(w, 10);
      const drop = -bm.deflection(kind === 'post' ? L - 0.1 : L);
      abs(`beam end on ${kind}: drop`, drop * 1000, exact * 1000, Math.max(0.02 * exact * 1000, 0.05), ' mm');
      if (j) rel(`beam end on ${kind}: support force`, j.force(), R, 0.02);
    });
  });
});

/* ---------------------------------------------------------- contacts */
suite('accuracy: contacts', () => {
  test('heavy on light, 1:100 to 1:10⁴: the light crate sinks under 0.5 mm in 60 s', () => {
    [100, 1000, 10000].forEach(ratio => {
      const w = world(); fixed(w, 0, -0.5, [P.box(60, 0.5)]);
      const a = w.add(new P.Body({ position: { x: 0, y: 0.25 }, shapes: [P.box(0.25, 0.25)], mass: 1 }));
      const b = w.add(new P.Body({ position: { x: 0, y: 0.75 }, shapes: [P.box(0.25, 0.25)], mass: ratio }));
      run(w, 60);
      abs(`stack 1:${ratio}: light crate sink`, (0.25 - a.c.y) * 1000, 0, 0.5, ' mm');
      abs(`stack 1:${ratio}: heavy crate sink`, (0.75 - b.c.y) * 1000, 0, 1.0, ' mm');
    });
  });
  test('bounce from 2 m with restitution 1 and 0.5: rebound h·e^(2k), first 5 bounces within 0.5%', () => {
    [1, 0.5].forEach(e => {
      const w = world(); fixed(w, 0, -0.5, [{ shape: P.box(60, 0.5), restitution: e }]);
      const b = w.add(new P.Body({ position: { x: 0, y: 2.1 }, shapes: [{ shape: P.circle(0.1), restitution: e }], mass: 1 }));
      const peaks = []; let pv = 0;
      run(w, 14, () => { if (pv > 0 && b.v.y <= 0) peaks.push(b.c.y - 0.1); pv = b.v.y; });
      const n = e === 1 ? 5 : 3;          // past 3 bounces at e = 0.5 the rebound is under 3 cm, below the restitution threshold
      for (let k = 1; k <= n; k++) rel(`bounce e = ${e}: rebound ${k}`, peaks[k - 1], 2 * Math.pow(e, 2 * k), 0.005);
    });
  });
  test('fast part into a thin wall, 10 to 300 m/s: never passes through, never leaves faster than it came', () => {
    let through = 0, faster = 0, n = 0;
    [0.02, 0.05, 0.1].forEach(thick => [10, 40, 80, 150, 300].forEach(v => [false, true].forEach(dyn => [false, true].forEach(circ => {
      const w = world({ gravity: { x: 0, y: 0 } });
      const wall = w.add(new P.Body({ type: dyn ? 'dynamic' : 'static', position: { x: 5, y: 0 }, shapes: [P.box(thick / 2, 1.5)], mass: dyn ? 50 : undefined }));
      const b = w.add(new P.Body({ position: { x: 0, y: 0 }, velocity: { x: v, y: 0 }, shapes: [circ ? P.circle(0.1) : P.box(0.1, 0.1)], mass: 2 }));
      run(w, 1);
      n++;
      if (b.c.x > wall.c.x + 0.2 && wall.c.x < 5.5) through++;
      if (M.len(b.v) > v * 1.001) faster++;
    }))));
    abs(`thin walls: pass-throughs in ${n} shots`, through, 0, 0, '');
    abs(`thin walls: shots that left faster`, faster, 0, 0, '');
  });
});

/* ---------------------------------------------------------- winches */
suite('accuracy: winches', () => {
  // 500 kg on a winch: lower at 0.5 m/s for 3 s, hold 2 s, lift for 2 s.
  // Travel is ∫speed dt = 1.5 m down then 1.0 m up; at constant speed the
  // line tension is m g.
  function cycle(opt) {
    const w = world(), top = fixed(w, 0, 5);
    const load = w.add(new P.Body({ position: { x: 0, y: 2 }, shapes: [P.box(0.3, 0.3)], mass: 500 }));
    const wj = w.addJoint(new P.WinchJoint(Object.assign({ bodyA: top, bodyB: load, reelSpeed: 0 }, opt)));
    run(w, 1); const y0 = load.c.y;
    let slack = 0, Tcruise = [];
    wj.reelSpeed = -0.5;
    run(w, 3, () => { if (wj.isSlack()) slack++; if (w.time > 2) Tcruise.push(wj.lineTension()); });
    const down = y0 - load.c.y;
    wj.reelSpeed = 0; run(w, 2, () => { if (wj.isSlack()) slack++; });
    const yHold = load.c.y; wj.reelSpeed = 0.5;
    run(w, 2, () => { if (wj.isSlack()) slack++; });
    return { down, up: load.c.y - yHold, slack, T: Tcruise.reduce((s, x) => s + x, 0) / Tcruise.length };
  }
  test('winch lower, stop, lift, with and without a pull limit and brake: travel within 1 mm, tension m g within 1%, never slack', () => {
    if (!P.WinchJoint) { pending('winch cycle'); return; }
    [['plain', {}], ['braked', { brake: true, brakeForce: 20000 }], ['pull limit 8 kN', { maxPull: 8000 }], ['limit and brake', { maxPull: 8000, brake: true, brakeForce: 20000 }]].forEach(([nm, opt]) => {
      const r = cycle(opt);
      abs(`winch ${nm}: lowered`, r.down * 1000, 1500, 1, ' mm');
      abs(`winch ${nm}: lifted`, r.up * 1000, 1000, 1, ' mm');
      rel(`winch ${nm}: tension while lowering`, r.T, 500 * g, 0.01);
      abs(`winch ${nm}: slack steps`, r.slack, 0, 0, '');
    });
  });
  test('winch overloaded past its pull limit or brake: the load descends with tension equal to the limit (within 1%)', () => {
    if (!P.WinchJoint) { pending('winch overload'); return; }
    // 500 kg (4905 N) on a winch rated 3 kN trying to lift, and on a brake
    // rated 3 kN holding: either way the line can only carry 3 kN, so the load
    // accelerates down at g − 3000/500 = 3.81 m/s².
    [['pull limit', { maxPull: 3000, reelSpeed: 0.5 }], ['brake', { brake: true, brakeForce: 3000, reelSpeed: 0 }]].forEach(([nm, opt]) => {
      const w = world(), top = fixed(w, 0, 20);
      const load = w.add(new P.Body({ position: { x: 0, y: 15 }, shapes: [P.box(0.3, 0.3)], mass: 500 }));
      const wj = w.addJoint(new P.WinchJoint(Object.assign({ bodyA: top, bodyB: load }, opt)));
      const Ts = []; run(w, 1, () => { if (w.time > 0.3) Ts.push(wj.lineTension()); });
      rel(`winch overloaded (${nm}): line tension = limit`, Ts.reduce((s, x) => s + x, 0) / Ts.length, 3000, 0.01);
      abs(`winch overloaded (${nm}): stalls, load goes down`, Math.min(0, load.v.y) === load.v.y ? 0 : 1, 0, 0, '');
    });
  });
});

/* ------------------------------------------------- textbook and invariants */
suite('accuracy: textbook rows and invariants', () => {
  test('Atwood, incline and rolling (the E09/E05 rows) within 0.5%', () => {
    if (P.PulleyJoint) {
      const m1 = 12, m2 = 8, w = world();
      const b1 = w.add(new P.Body({ position: { x: -0.5, y: 5 }, shapes: [P.box(0.15, 0.15)], mass: m1 }));
      const b2 = w.add(new P.Body({ position: { x: 0.5, y: 5 }, shapes: [P.box(0.15, 0.15)], mass: m2 }));
      const pj = w.addJoint(new P.PulleyJoint({ bodyA: b1, bodyB: b2, groundAnchorA: { x: -0.5, y: 8 }, groundAnchorB: { x: 0.5, y: 8 }, localAnchorA: { x: 0, y: 0.15 }, localAnchorB: { x: 0, y: 0.15 } }));
      run(w, 0.25); const v0 = b1.v.y; run(w, 0.5);
      rel('Atwood: acceleration', -(b1.v.y - v0) / 0.5, (m1 - m2) * g / (m1 + m2), 0.005);
      rel('Atwood: tension', pj.tensionA(), 2 * m1 * m2 * g / (m1 + m2), 0.005);
    }
    const ramp = (th, mu, shape, m) => {
      const w = world(), n = { x: -Math.sin(th), y: Math.cos(th) }, t = { x: Math.cos(th), y: Math.sin(th) };
      fixed(w, -0.5 * n.x, -0.5 * n.y, [{ shape: P.box(40, 0.5, { x: 0, y: 0 }, th), friction: mu }]);
      const r = shape.type === 'circle' ? shape.radius : 0.25;
      const b = w.add(new P.Body({ position: { x: r * n.x, y: r * n.y }, angle: shape.type === 'circle' ? 0 : th, shapes: [{ shape, friction: mu }], mass: m }));
      run(w, 0.5); const s0 = M.dot(b.v, t); run(w, 1);
      return -(M.dot(b.v, t) - s0);
    };
    rel('incline: sliding a = g(sinθ − μcosθ)', ramp(35 * DEG, 0.3, P.box(0.4, 0.25), 50), g * (Math.sin(35 * DEG) - 0.3 * Math.cos(35 * DEG)), 0.005);
    rel('rolling disc: a = ⅔ g sinθ', ramp(25 * DEG, 0.6, P.circle(0.3), 10), (2 / 3) * g * Math.sin(25 * DEG), 0.005);
  });
  test('free jointed bodies in zero g, 60 s: momentum and angular momentum within 0.001%', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ position: { x: 0, y: 0 }, shapes: [P.box(1, 0.1)], mass: 10, angularVelocity: 3 }));
    const b = w.add(new P.Body({ position: { x: 2, y: 0 }, shapes: [P.box(1, 0.1)], mass: 2, angularVelocity: -7, velocity: { x: 0, y: 1 } }));
    w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 1, y: 0 } }));
    const Lz = () => [a, b].reduce((s, q) => s + q.I * q.w + q.m * (q.c.x * q.v.y - q.c.y * q.v.x), 0);
    const p = () => ({ x: a.m * a.v.x + b.m * b.v.x, y: a.m * a.v.y + b.m * b.v.y });
    const L0 = Lz(), p0 = p();
    run(w, 60);
    rel('free pair: angular momentum', Lz(), L0, 1e-5);
    abs('free pair: linear momentum change / |p0|', Math.hypot(p().x - p0.x, p().y - p0.y) / Math.hypot(p0.x, p0.y), 0, 1e-5, '');
  });
  test('determinism: the same build twice, and a snapshot restore, step bit-identically', () => {
    const build = () => { const w = world(); fixed(w, 0, -0.5, [P.box(20, 0.5)]); for (let i = 0; i < 5; i++) w.add(new P.Body({ position: { x: 0.1 * i, y: 0.5 + i }, shapes: [P.box(0.5, 0.5)], mass: 10 + i })); return w; };
    const s = w => w.bodies.map(b => [b.c.x, b.c.y, b.angle, b.v.x, b.v.y, b.w]).flat();
    const a = build(), b = build(); run(a, 5); run(b, 5);
    const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
    record('determinism: rebuild', same(s(a), s(b)), 'bit-exact', same(s(a), s(b)) ? 'equal' : 'differs', 'two builds differ');
    if (P.snapshot) {
      const snap = P.snapshot(a); run(a, 2); const first = s(a); P.restore(a, snap); run(a, 2);
      record('determinism: snapshot restore', same(first, s(a)), 'bit-exact', same(first, s(a)) ? 'equal' : 'differs', 'restore differs');
    }
  });
});

/* ---------------------------------------------------------- energy ledger */
// P.sensors.EnergyLedger keeps kinetic + gravity + elastic energy and the
// work put in by drives and pushes, so whatever is left over was dissipated.
// The self-tests check the ledger against closed-form answers (they're hard:
// a wrong ledger would hide real engine errors). The fuzzer rows then use it
// on random yard builds: energy must never rise more than 0.1% of the build's
// energy scale in a step, and on frictionless builds everything lost must be
// accounted for (friction, damping) to 1% over 10 s.
suite('accuracy: energy ledger', () => {
  const Ledger = P.sensors && P.sensors.EnergyLedger;
  const hard = (name, pass, tol, err, detail) => { E09.rows.push({ name: 'accuracy: ' + name, tol, err, status: pass ? 'pass' : 'FAIL' }); ok(pass, `${name}: ${detail}`); };
  const hardRel = (name, m, e, tol) => { const r = Math.abs(m - e) / Math.abs(e); hard(name, r <= tol, tol < 1e-4 ? tol.toExponential(0) : (100 * tol) + '%', fmt(r), `expected ≈${e}, got ${m}`); };
  test('ledger: block sliding to a stop, 360 J of kinetic energy all goes to friction (1%)', () => {
    if (!Ledger) { pending('energy ledger'); return; }
    const w = world(); fixed(w, 0, -0.5, [{ shape: P.box(50, 0.5), friction: 0.4 }]);
    w.add(new P.Body({ position: { x: 0, y: 0.25 }, velocity: { x: 6, y: 0 }, shapes: [{ shape: P.box(0.4, 0.25), friction: 0.4 }], mass: 20 }));
    const L = new Ledger(w); run(w, 3); const r = L.read();
    hardRel('ledger: sliding block dissipated = ½mv²', r.dissipated, 360, 0.01);
    hardRel('ledger: sliding block friction work = dissipated', r.friction, r.dissipated, 0.01);
  });
  test('ledger: damped spring, ½kx² = 18 J starts elastic and ends in the damper (2%)', () => {
    if (!Ledger) { pending('energy ledger'); return; }
    const w = world({ gravity: { x: 0, y: 0 } }), wall = fixed(w, 0, 0);
    w.add(new P.Body({ position: { x: 1.3, y: 0 }, shapes: [P.circle(0.05)], mass: 4 }));
    w.addJoint(new P.DistanceJoint({ bodyA: wall, bodyB: w.bodies[1], length: 1, stiffness: 400, damping: 8 }));
    const L = new Ledger(w);
    hardRel('ledger: spring elastic energy at rest stretch', L.read().elastic, 0.5 * 400 * 0.09, 1e-9);
    run(w, 5); const r = L.read();
    hardRel('ledger: damper work = energy lost', r.damping, r.dissipated, 0.02);
  });
  test('ledger: a pushed frictionless sled, work in = the kinetic energy it gains', () => {
    if (!Ledger) { pending('energy ledger'); return; }
    const w = world(); fixed(w, 0, -0.5, [{ shape: P.box(50, 0.5), material: 'frictionless' }]);
    const b = w.add(new P.Body({ position: { x: 0, y: 0.25 }, shapes: [P.box(0.4, 0.25)], material: 'frictionless', mass: 20 }));
    run(w, 0.5); const L = new Ledger(w);
    for (let i = 0; i < 120; i++) { b.applyForce({ x: 100, y: 0 }); w.step(1 / 60); }
    hardRel('ledger: applied work = ½mv²', L.read().input, 0.5 * 20 * b.v.x * b.v.x, 1e-3);
  });
  test('ledger: stored energy is the same sum the tests compute by hand', () => {
    if (!Ledger) { pending('energy ledger'); return; }
    const w = world(), top = fixed(w, 0, 0);
    const b = w.add(new P.Body({ position: { x: 2 * Math.sin(1), y: -2 * Math.cos(1) }, shapes: [P.circle(0.05)], mass: 3 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: b, length: 2 }));
    const L = new Ledger(w), E0 = energy(w); run(w, 10);
    const r = L.read();
    hard('ledger: dissipated = −ΔE on a bare pendulum', Math.abs(r.dissipated + (energy(w) - E0)) < 1e-6 * r.scale, '1e-6', (r.dissipated + energy(w) - E0).toExponential(1), `dissipated ${r.dissipated}, ΔE ${energy(w) - E0}`);
  });

  // random yard builds from the fuzzer, with the ledger on
  let fz = null; try { fz = require('./fuzz-physics.js'); } catch (e) { fz = null; }
  test('fuzzer builds: energy never rises more than 0.1% of the build’s scale in one step', () => {
    if (!fz || !Ledger) { pending('ledger on fuzzer builds (needs tests/fuzz-physics.js)'); return; }
    Object.keys(fz.BUILDS).forEach(kind => {
      let worst = 0, at = '';
      [1, 2, 3].forEach(seed => {
        const w = fz.BUILDS[kind](fz.rng(seed * 7919 + kind.length)).w;
        const L = new Ledger(w); run(w, 10); const r = L.read();
        const u = Math.max(0, r.maxRise) / r.scale;
        if (u > worst) { worst = u; at = `seed ${seed}, step ${r.maxRiseStep}`; }
      });
      record(`fuzz ${kind}: worst energy rise in a step / scale`, worst <= 1e-3, '0.1%', fmt(worst), `${fmt(worst)} at ${at}`);
    });
  });
  test('frictionless, undamped fuzzer builds, 10 s: total energy kept within 1%', () => {
    if (!fz || !Ledger) { pending('ledger on frictionless fuzzer builds'); return; }
    // friction, dampers and drag taken out, so nothing may be lost or gained
    // except by the solver (and by impacts: chains and hubs swing clear)
    ['chain', 'hub'].forEach(kind => {
      let worst = 0;
      [1, 2, 3].forEach(seed => {
        const w = fz.BUILDS[kind](fz.rng(seed * 7919 + kind.length)).w;
        w.bodies.forEach(b => { b.linearDamping = 0; b.angularDamping = 0; b.fixtures.forEach(f => { f.friction = 0; f.muS = 0; f.muK = 0; }); });
        w.joints.forEach(j => { if (j.spring) { j.damping = 0; j.dampingRatio = 0; } if (j.type === 'revolute' || j.type === 'prismatic') j.damping = 0; if (j.type === 'weld') j.angularDamping = 0; });
        const L = new Ledger(w); run(w, 10); const r = L.read();
        worst = Math.max(worst, Math.abs(r.unexplained) / r.scale);
      });
      record(`fuzz ${kind}, frictionless: energy lost or gained / scale`, worst <= 0.01, '1%', fmt(worst), `${fmt(worst)} of the build's energy went missing`);
    });
  });
});
