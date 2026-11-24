'use strict';
// Contact solver: stacking, Coulomb friction (static and kinetic), rolling
// resistance, conveyors, restitution and robustness. Each physical claim is
// checked against the textbook formula, with the tolerance in the test name.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;
const CS = P.contactSolver;
const g = 9.81;
const DT = 1 / 60;

// Proposed world.cfg defaults: contactHertz 60 (= a quarter of the 240 Hz
// substep rate) and contactDampingRatio 4. At Box2D's 30 Hz / 10 a 20-box
// column is too compliant and buckles; see contact.js.
const TUNED = { contactHertz: 60, contactDampingRatio: 4 };
function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, TUNED, opts || {})); }
function stepWith(w, seconds, fn) { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) { fn(); w.step(DT); } }
function ground(w, fixture) {
  return w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 },
    shapes: [Object.assign({ shape: P.box(100, 0.5) }, fixture || {})] }));
}
function box(w, x, y, m, fixture, opts) {
  return w.add(new P.Body(Object.assign({ position: { x: x, y: y }, mass: m,
    shapes: [Object.assign({ shape: P.box(0.5, 0.5), material: 'cargo' }, fixture || {})] }, opts || {})));
}
function totalKE(w) { return w.bodies.reduce((s, b) => s + (b.type === 'dynamic' ? b.kineticEnergy() : 0), 0); }
function contactBetween(w, a, b) {
  for (const ct of w.contacts.values()) {
    if ((ct.fa.body === a && ct.fb.body === b) || (ct.fa.body === b && ct.fb.body === a)) return ct;
  }
  return null;
}

suite('physics E03: mass ratios', () => {
  // A soft contact settles at a penetration F / (m_eff ω²). The light body
  // sets m_eff, so these are the hard cases for a soft solver.
  // Hand check: a corner point of the 10 kg box has m_eff ≈ 4 kg, so the
  // 4905 N on each point sits at 4905 / (4 · (2π·60)²) ≈ 9 mm, at both the
  // top and the bottom contact.
  test('heavy on light: 1000 kg on 10 kg holds 10 s: sinks < 1.5 cm per contact, slides < 5 mm, settles < 1 mm/s', () => {
    const w = world(); ground(w);
    const small = box(w, 0, 0.5, 10), big = box(w, 0, 1.5, 1000);
    w.run(10);
    ok(0.5 - small.c.y < 0.015, 'small crate sank ' + (0.5 - small.c.y));
    ok((big.c.y - small.c.y) > 1 - 0.015, 'big crate sank into small by ' + (1 - (big.c.y - small.c.y)));
    ok(Math.abs(big.c.x) < 0.005 && Math.abs(small.c.x) < 0.005, 'slid to x = ' + big.c.x + ', ' + small.c.x);
    ok(Math.hypot(big.v.x, big.v.y) < 1e-3, 'still rocking at ' + Math.hypot(big.v.x, big.v.y) + ' m/s');
  });
  test('light on heavy: 10 kg on 1000 kg holds, each contact sinks < 1 cm', () => {
    const w = world(); ground(w);
    const big = box(w, 0, 0.5, 1000), small = box(w, 0, 1.5, 10);
    w.run(5);
    ok(0.5 - big.c.y < 0.01, 'big crate sank ' + (0.5 - big.c.y));
    ok((small.c.y - big.c.y) > 1 - 0.01, 'small crate sank by ' + (1 - (small.c.y - big.c.y)));
    ok(totalKE(w) < 1e-3, 'still moving, KE = ' + totalKE(w));
  });
});

suite('physics E03: stacking', () => {
  test('20-box column stands for 20 s: top drift after settling < 2 cm, KE < 1e-4 J', () => {
    const w = world(); ground(w);
    const boxes = [];
    for (let i = 0; i < 20; i++) boxes.push(box(w, 0, 0.5 + i, 1));
    const top = boxes[19];
    w.run(1);                                            // settle onto the soft contacts
    const x0 = top.c.x, y0 = top.c.y;
    w.run(19);
    const drift = Math.hypot(top.c.x - x0, top.c.y - y0);
    ok(drift < 0.02, 'top drifted ' + drift + ' m');
    ok(totalKE(w) < 1e-4, 'jitter: KE = ' + totalKE(w));
  });
  test('10-row pyramid (55 boxes) stands for 20 s: top drift after settling < 2 cm, KE < 1e-4 J', () => {
    const w = world(); ground(w);
    let top = null;
    for (let row = 0; row < 10; row++) {
      for (let i = 0; i < 10 - row; i++) top = box(w, (i - (9 - row) / 2) * 1.05, 0.5 + row, 1);
    }
    w.run(1);
    const x0 = top.c.x, y0 = top.c.y;
    w.run(19);
    const drift = Math.hypot(top.c.x - x0, top.c.y - y0);
    ok(drift < 0.02, 'top drifted ' + drift + ' m');
    ok(totalKE(w) < 1e-4, 'jitter: KE = ' + totalKE(w));
  });
});

suite('physics E03: static and kinetic friction', () => {
  const muS = 0.6, muK = 0.4;
  const rough = { muS: muS, muK: muK };
  function incline(theta) {
    // a long static slab tilted by theta, and a 10 kg block resting on it
    const w = world();
    w.add(new P.Body({ type: 'static', angle: theta, shapes: [Object.assign({ shape: P.box(50, 0.5) }, rough)] }));
    const n = { x: -Math.sin(theta), y: Math.cos(theta) };
    const b = box(w, n.x * 1.0, n.y * 1.0, 10, rough, { angle: theta });
    return { w: w, b: b };
  }
  test('incline below atan(μs): the block stays put (moves < 1 mm in 3 s)', () => {
    const th = Math.atan(muS) - 0.05;                    // 26.0°, tan = 0.49 < 0.6
    const s = incline(th), p0 = { x: s.b.c.x, y: s.b.c.y };
    s.w.run(3);
    const moved = Math.hypot(s.b.c.x - p0.x, s.b.c.y - p0.y);
    ok(moved < 1e-3, 'crept ' + moved + ' m');
  });
  test('incline above atan(μs): slides with a = g(sin θ − μk cos θ) (within 2%)', () => {
    const th = Math.atan(muS) + 0.05;                    // 33.9°
    const s = incline(th), dir = { x: -Math.cos(th), y: -Math.sin(th) };
    s.w.run(1);
    const v1 = s.b.v.x * dir.x + s.b.v.y * dir.y;
    s.w.run(1);
    const v2 = s.b.v.x * dir.x + s.b.v.y * dir.y;
    // hand check: sin 33.9° = 0.558, cos = 0.830, a = 9.81(0.558 - 0.332) = 2.21 m/s²
    near(v2 - v1, g * (Math.sin(th) - muK * Math.cos(th)), 0.02);
  });
  test('ramped pull: the crate breaks loose at P = μs·mg (within 3%)', () => {
    const w = world(); ground(w, rough);
    const m = 100, b = box(w, 0, 0.5, m, rough);
    w.run(0.5);                                          // settle
    const rate = 50;                                     // N/s
    let t = 0, P0 = null;
    w.run(30, DT, () => {
      t += DT;
      if (Math.abs(b.v.x) > 1e-3) { P0 = rate * t; return false; }
      b.applyForce({ x: rate * t, y: 0 }, b.c);           // acts during the next step
    });
    // hand check: μs m g = 0.6 · 100 · 9.81 = 588.6 N
    ok(P0 !== null, 'never moved');
    near(P0, muS * m * g, 0.03);
  });
  test('once sliding, keeping constant speed takes P = μk·mg (within 3%)', () => {
    const w = world(); ground(w, rough);
    const m = 100, b = box(w, 0, 0.5, m, rough, { velocity: { x: 2, y: 0 } });
    const push = () => b.applyForce({ x: muK * m * g, y: 0 }, b.c);
    stepWith(w, 0.5, push);
    const v1 = b.v.x;
    stepWith(w, 1, push);
    const v2 = b.v.x;
    // net force = P - F_friction = m a, so the friction the crate needed is
    // P - m a; it should equal μk m g = 392.4 N, and the speed should hold
    const a = (v2 - v1) / 1;
    near(muK * m * g - m * a, muK * m * g, 0.03);
    near(v2, 2, 0.03, 'speed drifted');
    // the gauge on the contact reads the same friction force
    const ct = contactBetween(w, w.bodies[0], b);
    near(Math.abs(ct.frictionForce), muK * m * g, 0.03, 'frictionForce gauge');
    near(ct.normalForce, m * g, 0.03, 'normalForce gauge');
  });
  test('pointForces: per-point normal forces sum to mg for a crate at rest (within 1%)', () => {
    const w = world(); ground(w);
    const m = 50, b = box(w, 0, 0.5, m);
    w.run(2);
    const ct = contactBetween(w, w.bodies[0], b);
    const f = CS.pointForces(ct, DT / w.substeps);
    ok(f.length === 2, 'expected 2 points, got ' + f.length);
    near(f[0].normal + f[1].normal, m * g, 0.01);
    near(f[0].normal, f[1].normal, 0.01, 'load should split evenly');
  });
  test('fixtures without muS / muK use friction for both: v²/(2μg) stop (within 3%)', () => {
    const w = world(); ground(w, { friction: 0.3 });
    const b = box(w, 0, 0.5, 20, { friction: 0.3 }, { velocity: { x: 4, y: 0 } });
    w.run(3);
    near(b.c.x, 16 / (2 * 0.3 * g), 0.03);
  });
});

suite('physics E03: restitution and momentum', () => {
  // two frictionless disks, zero gravity, head-on
  function collide(e, m1, v1, m2, v2) {
    const w = new P.World({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ position: { x: -2, y: 0 }, velocity: { x: v1, y: 0 }, mass: m1,
      shapes: [{ shape: P.circle(0.5), friction: 0, restitution: e }] }));
    const b = w.add(new P.Body({ position: { x: 2, y: 0 }, velocity: { x: v2, y: 0 }, mass: m2,
      shapes: [{ shape: P.circle(0.5), friction: 0, restitution: e }] }));
    const p0 = m1 * v1 + m2 * v2;
    let maxErr = 0;
    w.run(3, DT, () => { maxErr = Math.max(maxErr, Math.abs(m1 * a.v.x + m2 * b.v.x - p0)); });
    return { a: a, b: b, p0: p0, maxErr: maxErr };
  }
  // textbook (Hibbeler 15.4): v1' = [m1 v1 + m2 v2 - m2 e (v1 - v2)] / (m1 + m2), and symmetric
  function expected(e, m1, v1, m2, v2) {
    return { v1: (m1 * v1 + m2 * v2 - m2 * e * (v1 - v2)) / (m1 + m2),
             v2: (m1 * v1 + m2 * v2 + m1 * e * (v1 - v2)) / (m1 + m2) };
  }
  [[1, 2, 3, 1, -1], [0.5, 2, 3, 1, -1], [0.8, 1, 4, 5, 0], [0, 3, 2, 2, -2]].forEach(([e, m1, v1, m2, v2]) => {
    test(`head-on e = ${e}, ${m1} kg at ${v1} m/s vs ${m2} kg at ${v2} m/s: momentum to 1e-6, velocities within 2%`, () => {
      const r = collide(e, m1, v1, m2, v2), x = expected(e, m1, v1, m2, v2);
      ok(r.maxErr <= 1e-6 * Math.abs(r.p0 || 1), 'momentum drifted by ' + r.maxErr);
      // e = 0 gives a common velocity; compare against the scale of the problem
      const scale = Math.max(Math.abs(v1), Math.abs(v2));
      ok(Math.abs(r.a.v.x - x.v1) <= 0.02 * scale, 'v1 = ' + r.a.v.x + ', expected ' + x.v1);
      ok(Math.abs(r.b.v.x - x.v2) <= 0.02 * scale, 'v2 = ' + r.b.v.x + ', expected ' + x.v2);
    });
  });
  test('below the restitution threshold (1 m/s) contacts do not bounce', () => {
    const w = world(); ground(w, { restitution: 0.8 });
    const b = w.add(new P.Body({ position: { x: 0, y: 0.52 }, velocity: { x: 0, y: -0.5 }, mass: 1,
      shapes: [{ shape: P.circle(0.5), restitution: 0.8 }] }));
    w.run(1);
    ok(Math.abs(b.v.y) < 1e-3, 'bounced: v = ' + b.v.y);
  });
});

suite('physics E03: rolling', () => {
  function roller(rr) {
    const w = world(); ground(w, { friction: 0.6, rollingResistance: rr });
    const r = 0.5, v0 = 3;
    const b = w.add(new P.Body({ position: { x: 0, y: r }, velocity: { x: v0, y: 0 }, angularVelocity: -v0 / r,
      shapes: [{ shape: P.circle(r), material: 'rubber', friction: 0.6, rollingResistance: rr }], mass: 10 }));
    return { w: w, b: b, r: r, v0: v0 };
  }
  test('without rolling resistance a rolling disk keeps its speed (within 0.5% over 5 s)', () => {
    const s = roller(0);
    s.w.run(5);
    near(s.b.v.x, s.v0, 0.005);
    near(-s.b.w * s.r, s.v0, 0.005, 'not rolling');
  });
  test('with rolling resistance it decelerates at a = c·r·N·r / (I + m r²) and stops (within 3%)', () => {
    const c = 0.05, s = roller(c);
    // hand check: couple M = c r · m g = 0.05·0.5·98.1 = 2.45 N·m; I = ½ m r² = 1.25,
    // a = M r / (I + m r²) = 2.45·0.5 / 3.75 = 0.327 m/s², so 3 m/s stops in 9.2 s
    const I = 0.5 * s.b.m * s.r * s.r;
    const aTh = c * s.r * s.b.m * g * s.r / (I + s.b.m * s.r * s.r);
    s.w.run(1);
    const v1 = s.b.v.x;
    s.w.run(2);
    near((v1 - s.b.v.x) / 2, aTh, 0.03);
    s.w.run(10);
    ok(Math.abs(s.b.v.x) < 1e-3 && Math.abs(s.b.w) < 1e-2, 'still rolling: v = ' + s.b.v.x);
  });
});

suite('physics E03: conveyor belts', () => {
  test('a crate dropped on a belt (tangentSpeed 1.5 m/s) is carried at the belt speed (within 1%)', () => {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [{ shape: P.box(50, 0.5), friction: 0.8, tangentSpeed: 1.5 }] }));
    const b = box(w, 0, 0.55, 20, { friction: 0.8 });
    w.run(2);
    near(b.v.x, 1.5, 0.01);
  });
});

suite('physics E03: robustness', () => {
  test('200 boxes dropped in a pile: no NaN, energy never rises more than 1% between steps', () => {
    const w = world(); ground(w);
    w.add(new P.Body({ type: 'static', position: { x: -6, y: 20 }, shapes: [P.box(0.5, 20)] }));
    w.add(new P.Body({ type: 'static', position: { x: 6, y: 20 }, shapes: [P.box(0.5, 20)] }));
    const bodies = [];
    for (let i = 0; i < 200; i++) {
      const col = i % 10, row = Math.floor(i / 10);
      bodies.push(box(w, -4.5 + col * 1.0 + (row % 2) * 0.2, 3 + row * 1.1, 1, {}, { angle: (i * 0.37) % 0.5 }));
    }
    const energy = () => bodies.reduce((s, b) => s + b.kineticEnergy() + b.m * g * b.c.y, 0);
    let prev = energy(), worst = 0, bad = false;
    w.run(8, DT, () => {
      const e = energy();
      if (!isFinite(e)) { bad = true; return false; }
      worst = Math.max(worst, (e - prev) / prev);
      prev = e;
    });
    ok(!bad, 'NaN or infinite energy');
    ok(worst <= 0.01, 'energy rose by ' + (worst * 100).toFixed(2) + '% in one step');
    ok(bodies.every(b => b.c.y > 0 && b.c.y < 30 && Math.abs(b.c.x) < 5.5), 'a box escaped the bin');
  });
});
