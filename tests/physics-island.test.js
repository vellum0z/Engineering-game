'use strict';
// Island solver (island.js, world.islandSolve): every joint of a connected
// group solved together, rigid rows by RATTLE and elastic rows by the
// implicit midpoint rule. Each test is a row of the accuracy table: a closed
// form, a tolerance (in the test name) and the working in a comment.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81, DEG = Math.PI / 180;

function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g }, enableSleep: false, islandSolve: true }, opts || {})); }
function anchor(w, x, y) { return w.add(new P.Body({ type: 'static', position: { x: x || 0, y: y || 0 } })); }
function run(w, seconds, each) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) { w.step(1 / 60); if (each) each(w, i); } }
// kinetic + gravitational energy of the moving bodies, J
function mechanical(w) {
  return w.bodies.reduce((E, b) => b.type === 'dynamic' ? E + b.kineticEnergy() - b.m * (w.gravity.x * b.c.x + w.gravity.y * b.c.y) : E, 0);
}
// complete elliptic integral K(k) by the arithmetic-geometric mean
function ellipK(k) { let a = 1, b = Math.sqrt(1 - k * k); for (let i = 0; i < 30; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return Math.PI / (2 * a); }

// A bob on a rod (distance joint) or a rigid bar on a pin, released from rest
// at 60° from the vertical. Returns the largest energy error over the run as
// a fraction of m·g·L, and the period from the downward crossings of θ = 0.
function pendulum(kind, substeps, seconds, fixedStep) {
  const w = world({ substeps }), top = anchor(w, 0, 0), L = 2, th0 = 60 * DEG;
  let body, T0;
  if (kind === 'rod') {
    body = w.add(new P.Body({ position: { x: L * Math.sin(th0), y: -L * Math.cos(th0) }, shapes: [{ shape: P.circle(0.05), group: -1 }], mass: 5 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: body, length: L }));
    // the joint holds the centre, so the bob is a point mass: T = 4·√(L/g)·K(sin(θ0/2))
    T0 = 4 * Math.sqrt(L / g) * ellipK(Math.sin(th0 / 2));
  } else {
    // uniform bar pinned at one end: equivalent length I_pin/(m·d) with d = L/2
    body = w.add(new P.Body({ position: { x: L / 2 * Math.sin(th0), y: -L / 2 * Math.cos(th0) }, angle: th0 - Math.PI / 2, shapes: [{ shape: P.box(L / 2, 0.02), group: -1 }], mass: 5 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: body, worldAnchor: { x: 0, y: 0 } }));
    const Ipin = body.I + body.m * (L / 2) * (L / 2);
    T0 = 4 * Math.sqrt(Ipin / (body.m * g * L / 2)) * ellipK(Math.sin(th0 / 2));
  }
  if (fixedStep) w.islandAdaptive = false;
  const E0 = mechanical(w), cross = [];
  let worst = 0, prev = body.c.x;
  run(w, seconds, () => {
    worst = Math.max(worst, Math.abs(mechanical(w) - E0));
    const x = body.c.x;
    if (prev > 0 && x <= 0) cross.push(w.time - (x / (x - prev)) / 60);     // linear interpolation inside the frame
    prev = x;
  });
  const T = (cross[cross.length - 1] - cross[0]) / (cross.length - 1);
  return { energy: worst / (body.m * g * L), period: T / T0 - 1, body };
}

suite('island solver: pendulums', () => {
  ['rod', 'pin'].forEach(kind => test(kind + ' pendulum from 60°, 60 s, 4 substeps: energy within 0.1% of mgL, period within 0.01% of the elliptic formula', () => {
    const r = pendulum(kind, 4, 60);
    ok(r.energy < 1e-3, 'energy error ' + (100 * r.energy).toFixed(4) + '%');
    ok(Math.abs(r.period) < 1e-4, 'period error ' + (100 * r.period).toFixed(5) + '%');
  }));

  ['rod', 'pin'].forEach(kind => test(kind + ' pendulum: halving the step cuts the energy error about 4 times (ratio between 3 and 5), so the method is second order', () => {
    // fixed 1 and 2 substeps (the automatic refinement off), where the
    // error is large enough to measure cleanly
    const a = pendulum(kind, 1, 30, true).energy, b = pendulum(kind, 2, 30, true).energy;
    ok(a / b > 3 && a / b < 5, 'ratio ' + (a / b).toFixed(2) + ' (' + a.toExponential(2) + ' / ' + b.toExponential(2) + ')');
  }));
});

// n bars of 0.5 m, 2 kg, pinned end to end (or joined by short rods between
// offset anchors), fixed at the top and released horizontal. Nothing removes
// energy, so kinetic + gravitational must stay where it started.
function chain(n, kind, endMass, seconds) {
  const w = world(), top = anchor(w, 0, 0), s = 0.5, links = [];
  let prev = top;
  for (let i = 0; i < n; i++) {
    const m = i === n - 1 && endMass ? endMass : 2;
    const link = w.add(new P.Body({ position: { x: s * i + s / 2, y: 0 }, shapes: [{ shape: P.box(s / 2, 0.02), group: -1 }], mass: m }));
    if (kind === 'pin') w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: s * i, y: 0 } }));
    else w.addJoint(new P.DistanceJoint({ bodyA: prev, bodyB: link, localAnchorA: prev === top ? { x: 0, y: 0 } : { x: s / 2 - 0.05, y: 0 }, localAnchorB: { x: -s / 2 + 0.05, y: 0 }, length: prev === top ? 0.05 : 0.1 }));
    prev = link; links.push(link);
  }
  // energy scale: the chain's weight times its length
  const scale = links.reduce((a, b) => a + b.m, 0) * g * n * s, E0 = mechanical(w);
  let worst = 0, gap = 0;
  run(w, seconds || 10, () => {
    worst = Math.max(worst, Math.abs(mechanical(w) - E0));
    w.joints.forEach(j => { const a = j.anchorA(), b = j.anchorB(); gap = Math.max(gap, Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - (j.length || 0))); });
  });
  return { energy: worst / scale, gap, w };
}

suite('island solver: chains', () => {
  test('pinned chain, 4 links, 10 s: energy within 0.2%, pins closed within 0.01 mm', () => {
    const r = chain(4, 'pin');
    ok(r.energy < 2e-3, 'energy ' + (100 * r.energy).toFixed(3) + '%');
    ok(r.gap < 1e-5, 'gap ' + (r.gap * 1000).toExponential(2) + ' mm');
  });
  [['pin', 10], ['pin', 20], ['rod', 10]].forEach(([kind, n]) => test(kind + ' chain, ' + n + ' links, 10 s: energy within 2%, joints closed within 0.01 mm', () => {
    const r = chain(n, kind);
    ok(r.energy < 0.02, 'energy ' + (100 * r.energy).toFixed(3) + '%');
    ok(r.gap < 1e-5, 'gap ' + (r.gap * 1000).toExponential(2) + ' mm');
  }));
  [['pin', 4, 200], ['pin', 10, 2000], ['rod', 4, 200]].forEach(([kind, n, m]) => test(kind + ' chain, ' + n + ' links with a ' + m + ' kg end link (' + m / 2 + '× the rest): stable, energy within 5%, joints within 0.1 mm, finer steps taken on its own', () => {
    const r = chain(n, kind, m);
    ok(r.energy < 0.05, 'energy ' + (100 * r.energy).toFixed(3) + '%');
    ok(r.gap < 1e-4, 'gap ' + (r.gap * 1000).toExponential(2) + ' mm');
    ok(r.w.islandStats.fallbacks === 0, 'solves that gave up: ' + r.w.islandStats.fallbacks);
  }));

  test('catenary of 20 pinned links: sag within 1% and end tension within 2% of the cosh formulas', () => {
    // Chain of length Lc = 10 m and w = 39.24 N/m hung across S = 8 m.
    // Catenary y = a·cosh(x/a): Lc = 2a·sinh(S/2a) gives a (solved by
    // bisection), sag = a·(cosh(S/2a) − 1), end tension T = w·(a + sag).
    const n = 20, s = 0.5, S = 8, mLink = 2, wl = mLink * g / s;
    const w = world(), left = anchor(w, 0, 0), right = anchor(w, S, 0);
    // start as a V of straight links, joined by pins
    const half = n / 2, drop = Math.sqrt(s * half * s * half - S * S / 4), links = [], pins = [];
    const pt = (i) => i <= half ? { x: S / 2 * i / half, y: -drop * i / half } : { x: S / 2 + S / 2 * (i - half) / half, y: -drop * (n - i) / half };
    let prev = left;
    for (let i = 0; i < n; i++) {
      const a = pt(i), b = pt(i + 1);
      const link = w.add(new P.Body({ position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x),
        shapes: [{ shape: P.box(s / 2, 0.02), group: -1 }], mass: mLink, linearDamping: 2, angularDamping: 2 }));
      pins.push(w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: a })));
      prev = link; links.push(link);
    }
    pins.push(w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: right, worldAnchor: { x: S, y: 0 } })));
    run(w, 20);
    let lo = 0.5, hi = 50;
    for (let i = 0; i < 80; i++) { const a = (lo + hi) / 2; if (2 * a * Math.sinh(S / (2 * a)) > n * s) lo = a; else hi = a; }
    const a = (lo + hi) / 2, sag = a * (Math.cosh(S / (2 * a)) - 1), T = wl * (a + sag);
    near(-pins[half].anchorB().y, sag, 0.01, 'sag');
    const F = pins[0].reaction().force;
    near(Math.hypot(F.x, F.y), T, 0.02, 'end tension');
  });
});

suite('island solver: springs', () => {
  // 4 kg on a spring in zero gravity, pulled 0.3 m and let go: x = A·cos(ωt)
  // with ω = √(k/m). The phase is followed with atan2(−v/ω, x), unwrapped
  // against the expected advance per frame, so fast springs don't alias.
  function spring(hz, seconds) {
    const m = 4, wn = 2 * Math.PI * hz, k = m * wn * wn, A = 0.3;
    const w = world({ gravity: { x: 0, y: 0 } }), top = anchor(w, 0, 0);
    const b = w.add(new P.Body({ position: { x: 1 + A, y: 0 }, shapes: [{ shape: P.circle(0.05), group: -1 }], mass: m }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: b, length: 1, stiffness: k, damping: 0 }));
    let phase = 0, last = 0, amin = Infinity, amax = 0;
    run(w, seconds, () => {
      const x = b.c.x - 1, v = b.v.x, ph = Math.atan2(-v / wn, x);
      let d = ph - last;
      d += Math.round((wn / 60 - d) / (2 * Math.PI)) * 2 * Math.PI;
      phase += d; last = ph;
      const amp = Math.hypot(x, v / wn); amin = Math.min(amin, amp); amax = Math.max(amax, amp);
    });
    return { period: wn / (phase / seconds) - 1, lo: amin / A, hi: amax / A };
  }
  [1, 5, 10, 19].forEach(hz => test(hz + ' Hz spring, 60 s, no damping: amplitude within 1%, period within 0.1% of 2π√(m/k)', () => {
    const r = spring(hz, 60);
    ok(r.lo > 0.99 && r.hi < 1.01, 'amplitude ' + r.lo.toFixed(4) + '..' + r.hi.toFixed(4));
    ok(Math.abs(r.period) < 1e-3, 'period error ' + (100 * r.period).toFixed(4) + '%');
  }));
  [50, 100].forEach(hz => test(hz + ' Hz spring, 60 s, no damping: amplitude within 1%, period within 2%', () => {
    const r = spring(hz, 60);
    ok(r.lo > 0.99 && r.hi < 1.01, 'amplitude ' + r.lo.toFixed(4) + '..' + r.hi.toFixed(4));
    ok(Math.abs(r.period) < 0.02, 'period error ' + (100 * r.period).toFixed(4) + '%');
  }));

  test('a damped spring loses what its damper takes: energy left + dissipated = start (within 0.1%)', () => {
    // k = 2000 N/m, c = 20 N·s/m on 4 kg, pulled 0.3 m: E0 = ½·k·A² = 90 J
    const w = world({ gravity: { x: 0, y: 0 } }), top = anchor(w, 0, 0);
    const b = w.add(new P.Body({ position: { x: 1.3, y: 0 }, shapes: [{ shape: P.circle(0.05), group: -1 }], mass: 4 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: b, length: 1, stiffness: 2000, damping: 20 }));
    run(w, 1);
    const e = P.island.energy(w), left = b.kineticEnergy() + e.elastic;
    ok(left < 0.2 * 90, 'most of it should be gone: ' + left.toFixed(2) + ' J');
    near(left + e.dissipated, 90, 1e-3);
  });
});

suite('island solver: cables', () => {
  [6, 20].forEach(seg => test('cable pendulum, ' + seg + ' segments, 20 s: swing height kept within 1%, stretch at the bottom within 5% of T·L/EA', () => {
    // 3 m steel cable, 10 mm (1.85 kg), 50 kg load released at 45°. At the
    // bottom v² = 2gL(1 − cos 45°), so the pull is M·g·(3 − 2·cos 45°); the
    // cable's own mass counts about half (mean along its length), M = 50.9 kg,
    // T = 792 N, and the stretch is T·L/EA with EA = E·π·d²/4: 0.151 mm.
    // Nothing damps the cable's ripples, so the stretch is averaged over the
    // bottom passes after the first two.
    const w = world(), top = anchor(w, 0, 0), L = 3, th = 45 * DEG, m = 50;
    const load = w.add(new P.Body({ position: { x: L * Math.sin(th), y: -L * Math.cos(th) }, shapes: [{ shape: P.circle(0.1), group: -1 }], mass: m }));
    const c = P.cable.build(w, { from: { body: top }, to: { body: load }, length: L, segments: seg, diameter: 0.01, material: 'steel', linearDamping: 0 });
    const area = Math.PI * 0.005 * 0.005, EA = P.material('steel').E * area, mc = P.material('steel').density * area * L;
    const T = (m + mc / 2) * g * (3 - 2 * Math.cos(th)), h0 = load.c.y + L, passes = [];
    let peak = -Infinity, prev = load.c.x;
    run(w, 20, (wd) => {
      if (prev * load.c.x <= 0) passes.push(c.joints.reduce((s, j) => s + j.currentLength(), 0) - L);
      prev = load.c.x;
      if (wd.time > 16) peak = Math.max(peak, load.c.y + L);            // highest point of the last swings
    });
    near(peak, h0, 0.01, 'swing height');
    const later = passes.slice(2);
    near(later.reduce((a, b) => a + b, 0) / later.length, T * L / EA, 0.05, 'stretch');
  }));
});

suite('island solver: beams', () => {
  const L = 4, sec = { b: 0.05, h: 0.1 }, I = 0.05 * Math.pow(0.1, 3) / 12, A = 0.005;
  const E = P.material('steel').E, rho = P.material('steel').density;

  // Cantilever under a tip load, settled with heavy damping, then released
  // with the damping under test. Returns the static sag, the frequency from
  // upward zero crossings and the positive peaks of the tip.
  function cantilever(N, zeta) {
    const w = world({ gravity: { x: 0, y: 0 } });
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: N, damping: 1, supports: [{ at: 'start', type: 'fixed' }] });
    bm.load(L, { x: 0, y: -2000 });
    run(w, 4);
    const sag = -bm.deflection(L), moment = bm.bendingMoment(0);
    bm.clearLoads(); bm.damping = zeta;
    const cross = [], peaks = [];
    let prev = -1, pk = 0;
    run(w, 2.3, () => {
      const x = bm.deflection(L);
      if (prev < 0 && x >= 0) cross.push(w.time - (x / (x - prev)) / 60);
      if (prev > 0 && x <= 0) { peaks.push(pk); pk = 0; }
      pk = Math.max(pk, x); prev = x;
    });
    return { sag, moment, f: (cross.length - 1) / (cross[cross.length - 1] - cross[0]), peaks };
  }

  test('cantilever, 20 segments: tip sag P·L³/(3EI) and root moment P·L within 0.5%', () => {
    // P = 2 kN, L = 4 m, steel 50 × 100 mm: I = 4.167e-6 m⁴
    const r = cantilever(20, 0.02);
    near(r.sag, 2000 * L * L * L / (3 * E * I), 5e-3, 'sag');
    near(Math.abs(r.moment), 2000 * L, 5e-3, 'moment');
  });
  test('cantilever first natural frequency (1.8751)²·√(EI/ρAL⁴)/2π within 1%', () => {
    const r = cantilever(20, 0);
    near(r.f, 1.8751 * 1.8751 / (2 * Math.PI) * Math.sqrt(E * I / (rho * A * Math.pow(L, 4))), 0.01);
  });
  test('ring-down over ten cycles: with ζ = 0.02 and 0.05 the envelope is e^(−ζωt) within 5%', () => {
    [0.02, 0.05].forEach(zeta => {
      const r = cantilever(20, zeta), n = 10;
      // n cycles take n/f seconds: the envelope falls by e^(−ζ·2π·n)
      near(r.peaks[n] / r.peaks[0], Math.exp(-zeta * 2 * Math.PI * n), 0.05, 'ζ = ' + zeta + ':');
    });
  });
  test('with ζ = 0 a released cantilever keeps its energy (kinetic + elastic within 0.1% over 2 s, ten cycles)', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, damping: 1, supports: [{ at: 'start', type: 'fixed' }] });
    bm.load(L, { x: 0, y: -2000 });
    run(w, 4);
    bm.clearLoads(); bm.damping = 0;
    const total = () => w.bodies.reduce((s, b) => s + (b.type === 'dynamic' ? b.kineticEnergy() : 0), 0) + P.island.energy(w).elastic;
    w.step(1 / 60);
    const E0 = total();
    // strain energy of the static shape: ½·P·δ = ½·2000·0.0512 = 51 J
    near(E0, 0.5 * 2000 * 2000 * L * L * L / (3 * E * I), 0.01, 'strain energy at release');
    let worst = 0;
    run(w, 2, () => { worst = Math.max(worst, Math.abs(total() - E0)); });
    ok(worst / E0 < 1e-3, 'energy moved by ' + (100 * worst / E0).toFixed(4) + '%');
  });
  test('simple span, 20 segments, centre load: deflection P·L³/(48EI)·(1 + 2/N²) and first frequency π²·√(EI/ρAL⁴)/2π within 1%', () => {
    const w = world({ gravity: { x: 0, y: 0 } }), N = 20;
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: N, damping: 1,
      supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    bm.load(L / 2, { x: 0, y: -5000 });
    run(w, 4);
    // the bar chain is softer than the beam by 2/N² (structures.js)
    near(-bm.deflection(L / 2), 5000 * L * L * L / (48 * E * I) * (1 + 2 / (N * N)), 0.01, 'deflection');
    bm.clearLoads(); bm.damping = 0;
    const cross = [];
    let prev = -1;
    run(w, 2, () => { const x = bm.deflection(L / 2); if (prev < 0 && x >= 0) cross.push(w.time - (x / (x - prev)) / 60); prev = x; });
    const f = (cross.length - 1) / (cross[cross.length - 1] - cross[0]);
    near(f, Math.PI / 2 * Math.sqrt(E * I / (rho * A * Math.pow(L, 4))), 0.01, 'frequency');
  });

  // Beam pinned at the left, its right end hung from a point 2 m above by a
  // rope, a rod, an elastic rope or a segmented cable; 5 kN at midspan.
  // Statics: the hanger carries R = W/2 + P/2 and, if elastic, stretches by
  // R·Lh/EA, which is how far the beam end drops.
  ['rope', 'rod', 'elastic rope', 'cable'].forEach(kind => test('beam end hung from a ' + kind + ': hanger force within 2%, end drop within 2% or 0.05 mm of R·L/EA', () => {
    const w = world();
    const bm = P.structures.beam(w, { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, section: sec, material: 'steel', segments: 20, damping: 0.5, supports: [{ at: 'start', type: 'pin' }] });
    const end = bm.bodies[19], top = anchor(w, L, 2), la = end.localPoint({ x: L, y: 0 });
    const W = rho * A * L * g, R = W / 2 + 2500, EA = E * Math.PI * 0.005 * 0.005;
    let force, drop = 0;
    if (kind === 'cable') {
      const c = P.cable.build(w, { from: { body: top }, to: { body: end, localAnchor: la }, length: 2, segments: 6, diameter: 0.01, material: 'steel' });
      force = () => c.tensionAt(c.joints ? c.joints.length - 1 : 0); drop = R * 2 / EA;
    } else {
      const def = { bodyA: top, bodyB: end, localAnchorB: la, length: 2 };
      if (kind !== 'rod') def.rope = true;
      if (kind === 'elastic rope') { def.EA = EA; drop = R * 2 / EA; }
      const j = w.addJoint(new P.DistanceJoint(def));
      force = () => j.force();
    }
    bm.load(L / 2, { x: 0, y: -5000 });
    run(w, 8);
    near(force(), R, 0.02, 'hanger force');
    ok(Math.abs(-bm.deflection(L) - drop) < Math.max(0.02 * drop, 5e-5), 'end drop ' + (-bm.deflection(L) * 1000).toFixed(3) + ' mm, expected ' + (drop * 1000).toFixed(3));
  }));
});

suite('island solver: winch', () => {
  // 500 kg on a winch line with a 1 m/s² drum ramp. Lowering at 0.5 m/s for
  // 3 s: the ramp takes 0.5 s and covers 0.125 m, so travel = 0.125 + 0.5·2.5
  // = 1.375 m. Stopping covers another 0.125 m. Lifting for 2 s: 0.125 +
  // 0.5·1.5 = 0.875 m. Tension is m·(g + a): m·g at steady speed, m·(g − 1)
  // while the lowering speeds up.
  function lower(opts) {
    const w = world(), top = anchor(w, 0, 5), m = 500;
    const load = w.add(new P.Body({ position: { x: 0, y: 2 }, shapes: [P.box(0.3, 0.3)], mass: m }));
    const wj = w.addJoint(new P.WinchJoint(Object.assign({ bodyA: top, bodyB: load, reelSpeed: 0, accel: 1 }, opts)));
    run(w, 1);
    const out = { m, slack: 0 }, y0 = load.c.y;
    const watch = () => { if (wj.isSlack()) out.slack++; };
    wj.reelSpeed = -0.5;
    run(w, 0.25, watch); out.rampT = wj.lineTension();
    run(w, 2.75, watch); out.lowered = y0 - load.c.y; out.steadyT = wj.lineTension(); out.v = load.v.y;
    wj.reelSpeed = 0; run(w, 2, watch); out.stopped = y0 - load.c.y; out.heldT = wj.lineTension();
    wj.reelSpeed = 0.5; run(w, 2, watch); out.lifted = y0 - out.stopped - load.c.y + 2 * out.stopped - out.stopped;
    out.lifted = (y0 - out.stopped) - load.c.y; out.liftT = wj.lineTension();
    return out;
  }
  [['no limit', {}], ['a 20 kN brake', { brake: true, brakeForce: 20000 }], ['an 8 kN pull limit', { maxPull: 8000 }], ['limit and brake', { maxPull: 8000, brake: true, brakeForce: 20000 }]]
    .forEach(([name, opts]) => test('lower, stop, lift with ' + name + ': travel within 1 mm, tension m(g + a) within 1%, never slack', () => {
      const r = lower(opts);
      ok(Math.abs(r.lowered - 1.375) < 1e-3, 'lowered ' + r.lowered.toFixed(4) + ' m');
      ok(Math.abs(r.stopped - 1.5) < 1e-3, 'after stopping ' + r.stopped.toFixed(4) + ' m');
      ok(Math.abs(-r.lifted - 0.875) < 1e-3, 'lifted ' + (-r.lifted).toFixed(4) + ' m');
      near(r.v, -0.5, 1e-3, 'lowering speed');
      near(r.rampT, r.m * (g - 1), 0.01, 'tension while speeding up');
      near(r.steadyT, r.m * g, 0.01, 'tension at steady speed');
      near(r.heldT, r.m * g, 0.01, 'tension held');
      near(r.liftT, r.m * g, 0.01, 'tension lifting');
      ok(r.slack === 0, 'slack frames: ' + r.slack);
    }));

  test('a 4 kN winch told to lift 500 kg: line tension equals the limit (within 1%) and the load descends at g − T/m (within 1%)', () => {
    // m·g = 4905 N > 4000 N, so the load overhauls the drum: a = g − 4000/500 = 1.81 m/s²
    const w = world(), top = anchor(w, 0, 20), m = 500;
    const load = w.add(new P.Body({ position: { x: 0, y: 15 }, shapes: [P.box(0.3, 0.3)], mass: m }));
    const wj = w.addJoint(new P.WinchJoint({ bodyA: top, bodyB: load, reelSpeed: 0.5, maxPull: 4000 }));
    const y0 = load.c.y;
    run(w, 2);
    near(wj.lineTension(), 4000, 0.01, 'tension');
    near(y0 - load.c.y, 0.5 * (g - 8) * 4, 0.01, 'fall in 2 s');
    ok(!wj.isSlack(), 'line stays taut');
  });
  test('a 6 kN brake holds 500 kg (creep < 0.1 mm in 5 s); a 4 kN brake lets it down with tension at the brake force (within 1%)', () => {
    [[6000, true], [4000, false]].forEach(([brakeForce, holds]) => {
      const w = world(), top = anchor(w, 0, 20), m = 500;
      const load = w.add(new P.Body({ position: { x: 0, y: 15 }, shapes: [P.box(0.3, 0.3)], mass: m }));
      const wj = w.addJoint(new P.WinchJoint({ bodyA: top, bodyB: load, reelSpeed: 0, brake: true, brakeForce }));
      const y0 = load.c.y;
      run(w, 5);
      if (holds) { ok(y0 - load.c.y < 1e-4, 'crept ' + ((y0 - load.c.y) * 1000).toFixed(3) + ' mm'); near(wj.lineTension(), m * g, 0.01, 'held tension'); }
      else { near(wj.lineTension(), brakeForce, 0.01, 'slipping tension'); near(y0 - load.c.y, 0.5 * (g - brakeForce / m) * 25, 0.01, 'fall in 5 s'); }
    });
  });
  test('a 60 kN winch stalled on a 12 t load through a 20 kg hook and sling: line at the limit, sling at limit − hook weight (within 1%), hook still (< 1 mm)', () => {
    // The load weighs 118 kN, so it stays on the ground and the winch sits at
    // its limit. The hook is in balance between the line (60 kN up), its own
    // weight and the sling: T_sling = 60 000 − 20·g.
    const w = world(), top = anchor(w, 0, 12), cap = 60000, mh = 20;
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(20, 0.5)] }));
    const hook = w.add(new P.Body({ position: { x: 0, y: 6 }, shapes: [P.circle(0.15)], mass: mh }));
    const load = w.add(new P.Body({ position: { x: 0, y: 0.5 }, shapes: [P.box(0.5, 0.5)], mass: 12000 }));
    const wj = w.addJoint(new P.WinchJoint({ bodyA: top, bodyB: hook, reelSpeed: 1.5, maxPull: cap }));
    const sling = w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    let moved = 0;
    run(w, 3, () => { moved = Math.max(moved, Math.hypot(hook.c.x, hook.c.y - 6)); });
    ok(moved < 1e-3, 'hook moved ' + (moved * 1000).toFixed(2) + ' mm');
    near(wj.lineTension(), cap, 0.01, 'line tension');
    near(sling.tension(), cap - mh * g, 0.01, 'sling tension');
    ok(Math.abs(load.c.y - 0.5) < 2e-3, 'load left the ground');
  });
});

suite('island solver: conservation', () => {
  test('free jointed bodies, zero gravity, 60 s: linear and angular momentum within 0.001%, energy within 0.1%', () => {
    // three bars pinned in a row and a ball on a rod, thrown spinning: no
    // outside force, so p, L (about the origin) and kinetic energy are constant
    const w = world({ gravity: { x: 0, y: 0 } }), bars = [];
    for (let i = 0; i < 3; i++) bars.push(w.add(new P.Body({ position: { x: i, y: 0 }, shapes: [{ shape: P.box(0.5, 0.05), group: -1 }], mass: 3 + 2 * i })));
    w.addJoint(new P.RevoluteJoint({ bodyA: bars[0], bodyB: bars[1], worldAnchor: { x: 0.5, y: 0 } }));
    w.addJoint(new P.RevoluteJoint({ bodyA: bars[1], bodyB: bars[2], worldAnchor: { x: 1.5, y: 0 } }));
    const ball = w.add(new P.Body({ position: { x: 2.5, y: 1 }, shapes: [{ shape: P.circle(0.2), group: -1 }], mass: 4 }));
    w.addJoint(new P.DistanceJoint({ bodyA: bars[2], bodyB: ball, localAnchorA: { x: 0.5, y: 0 }, length: 1 }));
    bars[0].v = { x: 0, y: 2 }; bars[2].v = { x: 1, y: -3 }; bars[1].w = 4; ball.v = { x: -2, y: 1 };
    const sums = () => w.bodies.reduce((s, b) => ({ px: s.px + b.m * b.v.x, py: s.py + b.m * b.v.y,
      L: s.L + b.I * b.w + b.m * (b.c.x * b.v.y - b.c.y * b.v.x), K: s.K + b.kineticEnergy() }), { px: 0, py: 0, L: 0, K: 0 });
    w.step(1 / 60);                       // the joints take up the mismatched starting speeds
    const s0 = sums(), p0 = Math.hypot(s0.px, s0.py);
    let dp = 0, dL = 0, dK = 0;
    run(w, 60, () => { const s = sums(); dp = Math.max(dp, Math.hypot(s.px - s0.px, s.py - s0.py)); dL = Math.max(dL, Math.abs(s.L - s0.L)); dK = Math.max(dK, Math.abs(s.K - s0.K)); });
    ok(dp / p0 < 1e-5, 'momentum ' + (100 * dp / p0).toExponential(2) + '%');
    ok(dL / Math.abs(s0.L) < 1e-5, 'angular momentum ' + (100 * dL / Math.abs(s0.L)).toExponential(2) + '%');
    ok(dK / s0.K < 1e-3, 'energy ' + (100 * dK / s0.K).toExponential(2) + '%');
  });

  test('snapshot, run 2 s, restore, run 2 s again: bit-identical (chain, spring, winch, beam)', () => {
    const w = world(), top = anchor(w, 0, 10);
    let prev = top;
    for (let i = 0; i < 5; i++) {
      const link = w.add(new P.Body({ position: { x: 0.25 + 0.5 * i, y: 10 }, shapes: [{ shape: P.box(0.25, 0.02), group: -1 }], mass: 2 }));
      w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: 0.5 * i, y: 10 } })); prev = link;
    }
    const bob = w.add(new P.Body({ position: { x: 5, y: 8 }, shapes: [{ shape: P.circle(0.1), group: -1 }], mass: 4 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: bob, localAnchorA: { x: 5, y: 0 }, length: 1.5, stiffness: 3000, damping: 5 }));
    const load = w.add(new P.Body({ position: { x: -3, y: 6 }, shapes: [P.box(0.3, 0.3)], mass: 200 }));
    w.addJoint(new P.WinchJoint({ bodyA: top, bodyB: load, localAnchorA: { x: -3, y: 0 }, reelSpeed: 0.3, accel: 1, maxPull: 5000 }));
    P.structures.beam(w, { start: { x: 8, y: 5 }, end: { x: 11, y: 5 }, section: { b: 0.05, h: 0.1 }, material: 'timber', segments: 8, supports: [{ at: 'start', type: 'fixed' }] });
    const state = () => w.bodies.map(b => [b.c.x, b.c.y, b.angle, b.v.x, b.v.y, b.w].join(',')).join(';') + '|' + w.substeps;
    run(w, 1);
    const snap = P.snapshot(w);
    run(w, 2);
    const first = state();
    P.restore(w, snap);
    run(w, 2);
    ok(state() === first, 'replay differs');
  });
});
