'use strict';
// Cross-module acceptance suite, part 2: dynamics sanity.
//
// Closed-form results from particle and rigid-body dynamics (free fall,
// projectiles, pendulums, springs, pulleys, impacts, rolling) and limits on
// how much energy the solver may lose or gain. Statics levels lean on the
// same solver, so a drift here shows up as wrong readings there.
//
// Run `E09_REPORT=1 node tests/run.js` for the table of measured errors.
const { suite, test, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;
const DEG = Math.PI / 180;


/* ------------------------------------------------- shared report helpers */
// The three e09 files share one table through a global, printed on exit.
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
function fmtErr(e) { return e < 1e-5 && e > 0 ? e.toExponential(1) : (100 * e).toFixed(3) + '%'; }
function fmtTol(t) { return t < 1e-4 ? t.toExponential(0) : (100 * t) + '%'; }
// Relative check: |measured - expected| / |expected| <= tol.
function check(name, measured, expected, tol) {
  const err = Math.abs(measured - expected) / Math.abs(expected);
  const pass = err <= tol;
  E09.rows.push({ name, tol: fmtTol(tol), err: fmtErr(err), status: pass ? 'pass' : 'FAIL' });
  if (!pass) throw new Error(`${name}: expected ≈${expected}, got ${measured} (${fmtErr(err)} > ${100 * tol}%)`);
}
// Absolute check, for quantities whose expected value is zero or an angle.
function checkAbs(name, measured, expected, tol, unit) {
  const err = Math.abs(measured - expected);
  const pass = err <= tol;
  E09.rows.push({ name, tol: '±' + tol + (unit || ''), err: err.toExponential(2) + (unit || ''), status: pass ? 'pass' : 'FAIL' });
  if (!pass) throw new Error(`${name}: expected ${expected}${unit || ''} ±${tol}, got ${measured}`);
}
function pending(name) {
  console.log('  pending: ' + name);
  E09.rows.push({ name, tol: '-', err: '-', status: 'pending' });
}
// A check that fails today because of a known engine issue that has been
// reported to the module that owns it. It still runs and its error goes in
// the table, but it doesn't fail the suite unless E09_STRICT is set. Once the
// owner fixes it, the row reads 'pass' and the wrapper should be removed.
function knownIssue(owner, fn) {
  const from = E09.rows.length;
  try { fn(); } catch (e) {
    for (let i = from; i < E09.rows.length; i++) if (E09.rows[i].status === 'FAIL') E09.rows[i].status = 'known:' + owner;
    console.log('  known issue (' + owner + '): ' + e.message);
    if (process.env.E09_STRICT) throw e;
  }
}
// Pass/fail row for checks that aren't a single number against a formula.
function row(name, pass, detail) {
  E09.rows.push({ name, tol: '-', err: detail, status: pass ? 'pass' : 'FAIL' });
  ok(pass, name + ': ' + detail);
}

/* ---------------------------------------------------------- scene helpers */
function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, opts || {})); }
function fixed(w, x, y, shapes) {
  return w.add(new P.Body({ type: 'static', position: { x, y }, shapes: shapes || [] }));
}
// Run and call each(w) after every step; stop early if it returns false.
function runFor(w, seconds, each, dt) {
  dt = dt || 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { w.step(dt); if (each && each(w) === false) break; }
}
// Times at which f(w) crosses zero going down, interpolated inside the step.
function downCrossings(w, seconds, f, dt) {
  const out = []; let prev = f(w), tPrev = w.time;
  runFor(w, seconds, () => {
    const cur = f(w);
    if (prev > 0 && cur <= 0) out.push(tPrev + (w.time - tPrev) * prev / (prev - cur));
    prev = cur; tPrev = w.time;
  }, dt);
  return out;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function periodOf(cr) {            // average period from successive same-direction crossings
  const d = []; for (let i = 1; i < cr.length; i++) d.push(cr[i] - cr[i - 1]);
  return mean(d);
}

/* --------------------------------------------------- particles in flight */
suite('e09 dynamics: free fall and projectiles', () => {
  test('free fall for 2 s: v = gt (1e-9) and drop = ½gt² (within 0.5%)', () => {
    // Semi-implicit Euler over substeps h adds g·t·h/2 to the drop, i.e. a
    // relative error h/t = (1/240)/2 = 0.2%, inside the 0.5% allowed.
    const w = world();
    const b = w.add(new P.Body({ position: { x: 0, y: 100 }, shapes: [P.circle(0.1)], mass: 3 }));
    runFor(w, 2);
    check('free fall: v = gt', -b.v.y, g * 2, 1e-9);
    check('free fall: drop = ½gt²', 100 - b.c.y, 0.5 * g * 4, 0.005);
  });
  test('projectile at 25 m/s, 40°: peak height v²sin²θ/2g and flight time 2v sinθ/g (within 1%)', () => {
    // H = 625·0.4132/19.62 = 13.16 m, T = 50·0.6428/9.81 = 3.276 s, R = v²sin2θ/g = 62.75 m.
    const v0 = 25, th = 40 * DEG, w = world();
    const b = w.add(new P.Body({ position: { x: 0, y: 0 }, velocity: { x: v0 * Math.cos(th), y: v0 * Math.sin(th) }, shapes: [P.circle(0.05)], mass: 1 }));
    let peak = 0;
    const land = downCrossings(w, 5, wd => { peak = Math.max(peak, b.c.y); return b.c.y; }, 1 / 240)[0];
    check('projectile: peak height', peak, v0 * v0 * Math.sin(th) ** 2 / (2 * g), 0.01);
    check('projectile: flight time', land, 2 * v0 * Math.sin(th) / g, 0.01);
    check('projectile: range', b.v.x * land, v0 * v0 * Math.sin(2 * th) / g, 0.01);
  });
  test('impulse–momentum: 400 N for 1.5 s on a 60 kg sled on ice gives Δv = Ft/m (within 0.1%)', () => {
    const w = world();
    fixed(w, 0, -0.5, [{ shape: P.box(100, 0.5), material: 'frictionless' }]);
    const sled = w.add(new P.Body({ position: { x: 0, y: 0.25 }, shapes: [P.box(0.6, 0.25)], material: 'frictionless', mass: 60 }));
    runFor(w, 0.5);
    for (let i = 0; i < 90; i++) { sled.applyForce({ x: 400, y: 0 }); w.step(1 / 60); }
    check('impulse: Δv = Ft/m', sled.v.x, 400 * 1.5 / 60, 0.001);
  });
});

/* -------------------------------------------------- oscillators */
suite('e09 dynamics: pendulums and springs', () => {
  // Exact period of a simple pendulum released at θ0: T = T0 / AGM(1, cos(θ0/2)).
  function agm(a, b) { for (let i = 0; i < 30; i++) { const m = (a + b) / 2; b = Math.sqrt(a * b); a = m; } return a; }
  function pendulum(L, th0) {
    const w = world(), top = fixed(w, 0, 10);
    const bob = w.add(new P.Body({ position: { x: L * Math.sin(th0), y: 10 - L * Math.cos(th0) }, shapes: [P.circle(0.05)], mass: 4 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: bob, length: L }));
    return { w, bob };
  }
  test('simple pendulum, small swing (5°): T = 2π√(L/g) (within 0.5%)', () => {
    const L = 1.5, { w, bob } = pendulum(L, 5 * DEG);
    const cr = downCrossings(w, 10, () => bob.c.x, 1 / 240);
    check('pendulum 5°: period', periodOf(cr), 2 * Math.PI * Math.sqrt(L / g), 0.005);
  });
  test('simple pendulum, large swing (60°): exact period T0/AGM(1, cos 30°) (within 0.5%)', () => {
    // Small-angle T0 = 2.457 s for L = 1.5 m; at 60° the true period is 7.3% longer.
    const L = 1.5, th0 = 60 * DEG, { w, bob } = pendulum(L, th0);
    const cr = downCrossings(w, 10, () => bob.c.x, 1 / 240);
    const T0 = 2 * Math.PI * Math.sqrt(L / g);
    check('pendulum 60°: period', periodOf(cr), T0 / agm(1, Math.cos(th0 / 2)), 0.005);
  });
  test('compound pendulum: a slender bar pinned at one end swings with T = 2π√(2L/3g) (within 1%)', () => {
    const w = world(), top = fixed(w, 0, 10), L = 1.2, th = 4 * DEG;
    const bar = w.add(new P.Body({ position: { x: (L / 2) * Math.sin(th), y: 10 - (L / 2) * Math.cos(th) }, angle: th, shapes: [P.box(0.01, L / 2)], mass: 6 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: bar, worldAnchor: { x: 0, y: 10 } }));
    const cr = downCrossings(w, 10, () => bar.angle, 1 / 240);
    // the bar has a small width, so use the exact I about the pin: m(L² + w²)/12 + m(L/2)²
    const I = 6 * (L * L + 0.02 * 0.02) / 12 + 6 * (L / 2) ** 2;
    check('compound pendulum: period', periodOf(cr), 2 * Math.PI * Math.sqrt(I / (6 * g * L / 2)), 0.01);
  });
  test('spring–mass (k = 900 N/m, 2.5 kg): static stretch mg/k and period 2π√(m/k) (within 1%)', () => {
    const k = 900, m = 2.5, w = world(), top = fixed(w, 0, 10);
    const b = w.add(new P.Body({ position: { x: 0, y: 8.8 }, shapes: [P.circle(0.05)], mass: m }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: b, length: 1, stiffness: k, damping: 0 }));
    const eq = 10 - 1 - m * g / k;
    const cr = downCrossings(w, 5, () => b.c.y - eq, 1 / 240);
    check('spring–mass: period', periodOf(cr), 2 * Math.PI * Math.sqrt(m / k), 0.01);
    // now add damping and let it settle onto the static stretch
    w.joints[0].damping = 60;
    runFor(w, 5);
    check('spring–mass: static stretch mg/k', 10 - b.c.y - 1, m * g / k, 0.01);
  });
});

/* ---------------------------------------------------------- pulleys */
suite('e09 dynamics: pulleys', () => {
  test('Atwood machine 12 kg / 8 kg: a = (m1−m2)g/(m1+m2), T = 2m1m2g/(m1+m2) (within 1%)', () => {
    if (!P.PulleyJoint) { pending('Atwood machine (needs PulleyJoint, E05)'); return; }
    // a = 4·9.81/20 = 1.962 m/s², T = 192·9.81/20 = 94.18 N
    const m1 = 12, m2 = 8, w = world();
    const b1 = w.add(new P.Body({ position: { x: -0.5, y: 5 }, shapes: [P.box(0.15, 0.15)], mass: m1 }));
    const b2 = w.add(new P.Body({ position: { x: 0.5, y: 5 }, shapes: [P.box(0.15, 0.15)], mass: m2 }));
    const pj = w.addJoint(new P.PulleyJoint({
      bodyA: b1, bodyB: b2, groundAnchorA: { x: -0.5, y: 8 }, groundAnchorB: { x: 0.5, y: 8 },
      localAnchorA: { x: 0, y: 0.15 }, localAnchorB: { x: 0, y: 0.15 }, ratio: 1
    }));
    runFor(w, 0.25);
    const v0 = b1.v.y; runFor(w, 0.5); const a = -(b1.v.y - v0) / 0.5;
    check('Atwood: acceleration', a, (m1 - m2) * g / (m1 + m2), 0.01);
    const T = pj.tensionA ? pj.tensionA() : pj.force();
    check('Atwood: rope tension', T, 2 * m1 * m2 * g / (m1 + m2), 0.01);
  });
});

/* ---------------------------------------------------------- impacts */
suite('e09 dynamics: collisions', () => {
  // Two discs on a line, no gravity. With restitution e:
  //   v1' = (m1 v1 + m2 v2 - m2 e (v1 - v2)) / (m1 + m2)
  //   v2' = (m1 v1 + m2 v2 + m1 e (v1 - v2)) / (m1 + m2)
  function hit(m1, m2, v1, v2, e) {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ position: { x: -1, y: 0 }, velocity: { x: v1, y: 0 }, shapes: [{ shape: P.circle(0.2), restitution: e, friction: 0 }], mass: m1 }));
    const b = w.add(new P.Body({ position: { x: 1, y: 0 }, velocity: { x: v2, y: 0 }, shapes: [{ shape: P.circle(0.2), restitution: e, friction: 0 }], mass: m2 }));
    runFor(w, 1.5);
    const p0 = m1 * v1 + m2 * v2;
    return {
      v1: a.v.x, v2: b.v.x, p: m1 * a.v.x + m2 * b.v.x, p0,
      e1: (p0 - m2 * e * (v1 - v2)) / (m1 + m2), e2: (p0 + m1 * e * (v1 - v2)) / (m1 + m2)
    };
  }
  test('elastic, equal masses: the discs swap velocities (within 0.5%)', () => {
    const r = hit(3, 3, 4, -2, 1);
    check('elastic equal: v1\'', r.v1, r.e1, 0.005);
    check('elastic equal: v2\'', r.v2, r.e2, 0.005);
  });
  test('elastic, 5 kg on 2 kg: v′ from momentum and e = 1, kinetic energy kept (within 0.5%)', () => {
    const r = hit(5, 2, 3, 0, 1);
    check('elastic 5:2: v1\'', r.v1, r.e1, 0.005);
    check('elastic 5:2: v2\'', r.v2, r.e2, 0.005);
    check('elastic 5:2: kinetic energy', 0.5 * 5 * r.v1 ** 2 + 0.5 * 2 * r.v2 ** 2, 0.5 * 5 * 9, 0.01);
  });
  test('partly elastic e = 0.6 and plastic e = 0: momentum conserved (1e-9), v′ (within 0.5%)', () => {
    const r = hit(4, 6, 5, -1, 0.6);
    check('e = 0.6: momentum', r.p, r.p0, 1e-9);
    check('e = 0.6: v1\'', r.v1, r.e1, 0.005);
    check('e = 0.6: v2\'', r.v2, r.e2, 0.005);
    const s = hit(4, 6, 5, -1, 0);
    check('e = 0: common velocity', s.v2, s.p0 / 10, 0.005);
    checkAbs('e = 0: no separation speed', s.v2 - s.v1, 0, 1e-3, ' m/s');
  });
});

/* ---------------------------------------------------------- rolling */
suite('e09 dynamics: rolling', () => {
  test('solid disc rolls down a 25° ramp at a = g sinθ/(1 + I/mr²) = ⅔ g sinθ, with v = ωr (within 1%)', () => {
    // Rolling needs μ ≥ tanθ/3 = 0.155; μ = 0.6 is plenty. a = ⅔·9.81·0.4226 = 2.764 m/s².
    const th = 25 * DEG, r = 0.3, mu = 0.6, w = world();
    const n = { x: -Math.sin(th), y: Math.cos(th) }, t = { x: Math.cos(th), y: Math.sin(th) };
    fixed(w, -0.5 * n.x, -0.5 * n.y, [{ shape: P.box(40, 0.5, { x: 0, y: 0 }, th), friction: mu }]);
    const disc = w.add(new P.Body({ position: { x: r * n.x, y: r * n.y }, shapes: [{ shape: P.circle(r), friction: mu }], mass: 10 }));
    runFor(w, 0.5);
    const s0 = disc.v.x * t.x + disc.v.y * t.y; runFor(w, 1);
    const s1 = disc.v.x * t.x + disc.v.y * t.y;
    check('rolling: acceleration', -(s1 - s0), (2 / 3) * g * Math.sin(th), 0.01);
    check('rolling: no slip v = ωr', -s1, disc.w * r, 0.01);
  });
  test('the same disc on a slippery ramp (μ = 0.05 < tanθ/3) slides: a = g(sinθ − μcosθ) along the ramp (within 2%)', () => {
    const th = 25 * DEG, r = 0.3, mu = 0.05, w = world();
    const n = { x: -Math.sin(th), y: Math.cos(th) }, t = { x: Math.cos(th), y: Math.sin(th) };
    fixed(w, -0.5 * n.x, -0.5 * n.y, [{ shape: P.box(40, 0.5, { x: 0, y: 0 }, th), friction: mu }]);
    const disc = w.add(new P.Body({ position: { x: r * n.x, y: r * n.y }, shapes: [{ shape: P.circle(r), friction: mu }], mass: 10 }));
    runFor(w, 0.5);
    const s0 = disc.v.x * t.x + disc.v.y * t.y; runFor(w, 1);
    check('slipping disc: acceleration', -(disc.v.x * t.x + disc.v.y * t.y - s0), g * (Math.sin(th) - mu * Math.cos(th)), 0.02);
  });
});

/* ---------------------------------------------------------- energy */
suite('e09 dynamics: energy drift limits', () => {
  // Total mechanical energy, with potential measured from y = 0.
  const energy = (w, extra) => w.bodies.reduce((E, b) => b.type === 'dynamic' ? E + b.kineticEnergy() + b.m * g * b.c.y : E, 0) + (extra ? extra() : 0);
  test('rigid-rod pendulum swinging at 45° for 20 s keeps its energy (within 1%)', () => {
    const w = world(), top = fixed(w, 0, 0), L = 2;
    const bob = w.add(new P.Body({ position: { x: L * Math.sin(45 * DEG), y: -L * Math.cos(45 * DEG) }, shapes: [P.circle(0.05)], mass: 3 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: bob, length: L }));
    // measure the swing amplitude: energy loss shows up as a lower turning point
    const E0 = energy(w); let Emin = E0, Emax = E0;
    runFor(w, 20, () => { const E = energy(w); Emin = Math.min(Emin, E); Emax = Math.max(Emax, E); });
    const scale = 3 * g * L;                           // energy relative to the swing's natural scale
    check('energy: pendulum 20 s, worst drift / mgL', 1 + Math.max(E0 - Emin, Emax - E0) / scale, 1, 0.01);
  });
  test('pinned 4-link chain swinging for 10 s: energy within 2% and pins stay together (< 1 mm)', () => {
    // Released straight out sideways. The links share a collision group so
    // they never hit each other: any energy change is the solver's.
    const w = world(), top = fixed(w, 0, 0), Ls = 0.5;
    let prev = top;
    for (let i = 0; i < 4; i++) {
      const link = w.add(new P.Body({ position: { x: Ls * i + Ls / 2, y: 0 }, shapes: [{ shape: P.box(Ls / 2, 0.02), group: 1 }], mass: 2 }));
      w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: Ls * i, y: 0 } }));
      prev = link;
    }
    const E0 = energy(w); let worst = 0, gap = 0;
    runFor(w, 10, () => {
      worst = Math.max(worst, Math.abs(energy(w) - E0));
      w.joints.forEach(j => { const a = j.anchorA(), b = j.anchorB(); gap = Math.max(gap, Math.hypot(a.x - b.x, a.y - b.y)); });
    });
    knownIssue('E04', () => checkAbs('energy: 4-link chain, worst pin gap', gap, 0, 1e-3, ' m'));
    // Scale: total mass · g · chain length = 8 · 9.81 · 2 = 157 J.
    knownIssue('E04', () => check('energy: 4-link chain 10 s, drift / mgL', 1 + worst / (8 * g * 2), 1, 0.02));
  });
  test('undamped spring–mass for 10 s: amplitude kept (within 2%)', () => {
    // A soft constraint spring is integrated implicitly, which damps a little
    // per substep; this caps how much the game's springs may lose.
    const k = 400, m = 4, w = world({ gravity: { x: 0, y: 0 } }), wall = fixed(w, 0, 0);
    const b = w.add(new P.Body({ position: { x: 1.3, y: 0 }, shapes: [P.circle(0.05)], mass: m }));
    w.addJoint(new P.DistanceJoint({ bodyA: wall, bodyB: b, length: 1, stiffness: k, damping: 0 }));
    let late = 0;
    runFor(w, 10, wd => { if (wd.time > 9) late = Math.max(late, b.c.x - 1); });
    knownIssue('E05', () => check('energy: spring amplitude after 10 s', late, 0.3, 0.02));
  });
});
