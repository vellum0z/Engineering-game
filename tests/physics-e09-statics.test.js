'use strict';
// Cross-module acceptance suite, part 1: statics.
//
// Every scenario here is a classic statics set-up worked out by hand in the
// comments, then built from ordinary engine parts (bodies, pins, rods,
// contacts) and left to settle. The engine has to land on the hand answer,
// because the game grades players against these same formulas.
//
// Run `E09_REPORT=1 node tests/run.js` to print the measured error of every
// check as a table at the end.
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

/* ---------------------------------------------------------- scene helpers */
function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, opts || {})); }
function fixed(w, x, y, shapes) {
  return w.add(new P.Body({ type: 'static', position: { x, y }, shapes: shapes || [] }));
}
function ball(w, x, y, m, opts) {
  return w.add(new P.Body(Object.assign({ position: { x, y }, shapes: [P.circle(0.05)], mass: m }, opts || {})));
}
// Step with a callback run before every step (forces only last one step).
function runFor(w, seconds, before, dt) {
  dt = dt || 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { if (before) before(w, i); w.step(dt); }
}
// A rope/rod from a fixed point to the centre of a body.
function tie(w, ground, at, body) {
  return w.addJoint(new P.DistanceJoint({ bodyA: ground, bodyB: body, localAnchorA: ground.localPoint(at), localAnchorB: { x: 0, y: 0 } }));
}

/* ------------------------------------------------- particle equilibrium */
suite('e09 statics: particle equilibrium', () => {
  test('load on two cables at 35° and 60°: tensions from ΣFx = ΣFy = 0 (within 1%)', () => {
    // Load W hangs at the origin. Cable 1 goes up-left at a = 35° above
    // horizontal, cable 2 up-right at b = 60°.
    //   ΣFx: T2 cos b = T1 cos a
    //   ΣFy: T1 sin a + T2 sin b = W
    // => T1 = W cos b / sin(a + b),  T2 = W cos a / sin(a + b).
    // With W = 80·9.81 = 784.8 N: sin 95° = 0.99619, T1 = 393.9 N, T2 = 645.3 N.
    const a = 35 * DEG, b = 60 * DEG, m = 80, W = m * g;
    const w = world(), sky = fixed(w, 0, 0);
    const load = ball(w, 0, 0, m);
    const c1 = tie(w, sky, { x: -3 * Math.cos(a), y: 3 * Math.sin(a) }, load);
    const c2 = tie(w, sky, { x: 2 * Math.cos(b), y: 2 * Math.sin(b) }, load);
    runFor(w, 2);
    check('two cables: T1', c1.tension(), W * Math.cos(b) / Math.sin(a + b), 0.01);
    check('two cables: T2', c2.tension(), W * Math.cos(a) / Math.sin(a + b), 0.01);
    checkAbs('two cables: load stays put (m)', Math.hypot(load.c.x, load.c.y), 0, 1e-3, ' m');
  });

  test('ring held by three cables, one carrying a hanging load (within 1%)', () => {
    // A 2 kg ring at the origin; cable C hangs straight down from it to a
    // 150 kg crate, so T_C = 150 g. Cables A (up-left, 50°) and B (up-right,
    // 20°) hold the ring. Equilibrium of the ring with its own weight w_r:
    //   T_A cos 50° = T_B cos 20°
    //   T_A sin 50° + T_B sin 20° = T_C + w_r
    // => T_A = (T_C + w_r) cos 20° / sin 70°, T_B = (T_C + w_r) cos 50° / sin 70°.
    const aA = 50 * DEG, aB = 20 * DEG, mr = 2, mc = 150;
    const w = world(), sky = fixed(w, 0, 0);
    const ring = ball(w, 0, 0, mr);
    const crate = w.add(new P.Body({ position: { x: 0, y: -2 }, shapes: [P.box(0.3, 0.3)], mass: mc }));
    const cA = tie(w, sky, { x: -2.5 * Math.cos(aA), y: 2.5 * Math.sin(aA) }, ring);
    const cB = tie(w, sky, { x: 3 * Math.cos(aB), y: 3 * Math.sin(aB) }, ring);
    const cC = w.addJoint(new P.DistanceJoint({ bodyA: ring, bodyB: crate, localAnchorA: { x: 0, y: 0 }, localAnchorB: { x: 0, y: 0.3 }, rope: true }));
    runFor(w, 3);
    const down = (mc + mr) * g, s = Math.sin(aA + aB);
    check('three cables: T_C = W', cC.tension(), mc * g, 0.01);
    check('three cables: T_A', cA.tension(), down * Math.cos(aB) / s, 0.01);
    check('three cables: T_B', cB.tension(), down * Math.cos(aA) / s, 0.01);
  });
});

/* ------------------------------------------ rigid body: pin and roller */
suite('e09 statics: rigid-body supports', () => {
  test('beam on a pin and a roller: reactions from ΣM = 0 (within 1%)', () => {
    // A 6 m, 120 kg beam: pin at A (x = 0), roller at B (x = 5 m), so it
    // overhangs 1 m. A load P = 2 kN pushes at x = 6 m, 30° off vertical
    // (components Px = +1000 N, Py = -1732 N). Weight 1177 N acts at x = 3.
    //   ΣM_A: B·5 - W·3 - |Py|·6 = 0      => B  = (3W + 6|Py|)/5
    //   ΣFy : Ay = W + |Py| - B
    //   ΣFx : Ax = -Px  (the roller is frictionless, so A takes all of it)
    // The load's line of action passes through the beam's top surface, so its
    // horizontal part adds Px·(h/2) about A; included below.
    const L = 6, hh = 0.1, m = 120, W = m * g, Pmag = 2000, th = 30 * DEG;
    const Px = Pmag * Math.sin(th), Py = -Pmag * Math.cos(th);
    const w = world(), base = fixed(w, 0, 0);
    // roller: a frictionless knife-edge support with its top at y = 0
    const roller = fixed(w, 5, -0.25, [{ shape: P.box(0.05, 0.25), material: 'frictionless' }]);
    const beam = w.add(new P.Body({ position: { x: L / 2, y: hh }, shapes: [{ shape: P.box(L / 2, hh), material: 'frictionless' }], mass: m }));
    const pin = w.addJoint(new P.RevoluteJoint({ bodyA: base, bodyB: beam, worldAnchor: { x: 0, y: hh } }));
    const at = { x: L / 2, y: hh };                // load point in beam frame: right end, top face
    runFor(w, 3, () => beam.applyForce({ x: Px, y: Py }, beam.worldPoint(at)));
    // Moments about the pin (0, hh): the load acts at (6, 2hh) => lever arm for Px is hh.
    const B = (W * 3 + (-Py) * L + Px * hh) / 5;
    const Ay = W + (-Py) - B;
    const R = pin.reaction().force;                // on the beam
    check('pin + roller: roller B', w.contactForceOn(beam, 1 / 60).y, B, 0.01);
    check('pin + roller: pin Ay', R.y, Ay, 0.01);
    check('pin + roller: pin Ax', R.x, -Px, 0.01);
    checkAbs('pin + roller: beam stays level (deg)', beam.angle / DEG, 0, 0.1, '°');
    void roller;
  });

  test('two-force member: a weightless strut pushes along its own axis (±0.5°, 1%)', () => {
    // Wall bracket. Horizontal arm AB, 2 m, 40 kg, pinned to the wall at A
    // (0, 0); strut CD from the wall at C (0, -1.5) to D on the arm at x = 1.5.
    // A 300 kg load hangs from B (x = 2). The strut has no weight and pins at
    // both ends, so its force must lie along CD.
    //   ΣM_A on the arm: F_y·1.5 = W_arm·1 + W_load·2,  F_y = F sin(φ),
    //   φ = atan(1.5/1.5) = 45°  =>  F = (W_arm + 2 W_load) / (1.5 sin 45°).
    const w = world(), wall = fixed(w, -0.1, 0);
    const mArm = 40, mLoad = 300;
    const arm = w.add(new P.Body({ position: { x: 1, y: 0 }, shapes: [P.box(1, 0.04)], mass: mArm }));
    const C = { x: 0, y: -1.5 }, D = { x: 1.5, y: 0 };
    const len = Math.hypot(D.x - C.x, D.y - C.y), phi = Math.atan2(D.y - C.y, D.x - C.x);
    const strut = w.add(new P.Body({ position: { x: (C.x + D.x) / 2, y: (C.y + D.y) / 2 }, angle: phi, shapes: [P.box(len / 2, 0.03)], mass: 10, gravityScale: 0 }));
    const load = ball(w, 2, -0.8, mLoad);
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 } }));
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: strut, worldAnchor: C }));
    const pinD = w.addJoint(new P.RevoluteJoint({ bodyA: arm, bodyB: strut, worldAnchor: D }));
    w.addJoint(new P.DistanceJoint({ bodyA: arm, bodyB: load, localAnchorA: { x: 1, y: 0 }, localAnchorB: { x: 0, y: 0 }, rope: true }));
    runFor(w, 3);
    const F = (mArm * g * 1 + mLoad * g * 2) / (1.5 * Math.sin(phi));
    const R = pinD.reaction().force;               // on the strut, from the arm
    // The arm pushes down-left on the strut, i.e. along -CD: compression.
    const dir = Math.atan2(-R.y, -R.x);
    checkAbs('two-force member: force along strut (deg)', dir / DEG, phi / DEG, 0.5, '°');
    check('two-force member: strut force', Math.hypot(R.x, R.y), F, 0.01);
  });

  test('three-hinged frame: pin forces from member free bodies (within 1%)', () => {
    // Members AB and BC are pinned at B; A (0, 0) and C (4, 0) are pinned to
    // the ground; B is at (1.5, 2). Both members are weightless. A 5 kN load
    // pushes straight down on AB at its midpoint M (0.75, 1).
    // BC is a two-force member, so the force it puts on AB at B is F·u with
    // u the unit vector from C to B. Moments about A for member AB:
    //   (B - A) × (F u) + (M - A) × (0, -P) = 0
    // gives F; then ΣF on AB gives A = (0, P) - F u.
    const P0 = 5000;
    const A = { x: 0, y: 0 }, B = { x: 1.5, y: 2 }, Cp = { x: 4, y: 0 };
    const w = world(), ground = fixed(w, 0, -1);
    function bar(p, q) {
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      return w.add(new P.Body({ position: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, angle: Math.atan2(q.y - p.y, q.x - p.x), shapes: [P.box(L / 2, 0.04)], mass: 20, gravityScale: 0 }));
    }
    const ab = bar(A, B), bc = bar(B, Cp);
    const pinA = w.addJoint(new P.RevoluteJoint({ bodyA: ground, bodyB: ab, worldAnchor: A }));
    const pinB = w.addJoint(new P.RevoluteJoint({ bodyA: bc, bodyB: ab, worldAnchor: B }));
    w.addJoint(new P.RevoluteJoint({ bodyA: ground, bodyB: bc, worldAnchor: Cp }));
    const Mloc = ab.localPoint({ x: 0.75, y: 1 });
    runFor(w, 3, () => ab.applyForce({ x: 0, y: -P0 }, ab.worldPoint(Mloc)));
    const ux = (B.x - Cp.x), uy = (B.y - Cp.y), ul = Math.hypot(ux, uy);
    const u = { x: ux / ul, y: uy / ul };
    // (B - A) × u · F = -(M - A) × (0, -P) = 0.75 P
    const F = 0.75 * P0 / (B.x * u.y - B.y * u.x);
    const RB = pinB.reaction().force, RA = pinA.reaction().force;   // both on AB
    check('frame: pin B, x', RB.x, F * u.x, 0.01);
    check('frame: pin B, y', RB.y, F * u.y, 0.01);
    check('frame: pin A, x', RA.x, -F * u.x, 0.01);
    check('frame: pin A, y', RA.y, P0 - F * u.y, 0.01);
  });
});

/* --------------------------------------------------------------- friction */
suite('e09 statics: friction', () => {
  // Block on a real tilted ramp (rotated static box), both surfaces with
  // friction mu, so the mixed coefficient is sqrt(mu·mu) = mu.
  function ramp(theta, mu) {
    const w = world();
    const n = { x: -Math.sin(theta), y: Math.cos(theta) }, t = { x: Math.cos(theta), y: Math.sin(theta) };
    // ramp top surface passes through the origin
    fixed(w, -0.5 * n.x, -0.5 * n.y, [{ shape: P.box(20, 0.5, { x: 0, y: 0 }, theta), friction: mu }]);
    const block = w.add(new P.Body({ position: { x: 0.25 * n.x, y: 0.25 * n.y }, angle: theta, shapes: [{ shape: P.box(0.4, 0.25), friction: mu }], mass: 50 }));
    return { w, block, t };
  }
  test('block on an incline holds when tan θ < μ (moves < 1 mm in 3 s)', () => {
    const mu = 0.4, theta = Math.atan(0.9 * mu);
    const { w, block, t } = ramp(theta, mu);
    const x0 = block.c.x, y0 = block.c.y;
    runFor(w, 3);
    const s = (block.c.x - x0) * t.x + (block.c.y - y0) * t.y;
    checkAbs('incline: holds below angle of repose (m)', s, 0, 1e-3, ' m');
  });
  test('block on an incline slides at a = g(sin θ − μ cos θ) when tan θ > μ (within 2%)', () => {
    // θ = 35°, μ = 0.3: a = 9.81 (0.5736 - 0.3·0.8192) = 3.216 m/s².
    const mu = 0.3, theta = 35 * DEG;
    const { w, block, t } = ramp(theta, mu);
    runFor(w, 0.5);
    const v0 = block.v.x * t.x + block.v.y * t.y;
    runFor(w, 1);
    const v1 = block.v.x * t.x + block.v.y * t.y;
    check('incline: sliding acceleration', -(v1 - v0) / 1, g * (Math.sin(theta) - mu * Math.cos(theta)), 0.02);
  });

  // Ladder: uniform, length L between two small round end caps (radius r),
  // leaning on a frictionless wall, floor friction mu. With θ measured from
  // the floor and the bottom cap centre as the moment point:
  //   floor:  N_f = W,  F = N_w  (F is friction, toward the wall)
  //   ΣM:     N_w L sin θ + F r - W (L/2) cos θ = 0
  // so the friction needed is F = W L cos θ / (2 (L sin θ + r)), and the
  // ladder slips when that exceeds μW. For r → 0 this is the textbook
  // tan θ = 1 / (2μ). We solve the exact version for θ_c by bisection.
  function ladderAngle(mu, L, r) {
    let lo = 1 * DEG, hi = 89 * DEG;
    for (let i = 0; i < 60; i++) {
      const th = (lo + hi) / 2;
      const need = L * Math.cos(th) / (2 * (L * Math.sin(th) + r));
      if (need > mu) lo = th; else hi = th;
    }
    return (lo + hi) / 2;
  }
  function ladder(theta, mu) {
    const L = 4, r = 0.04, w = world();
    // floor top at y = 0; wall face at x = 0, ladder leans on it from the left
    fixed(w, 0, -0.5, [{ shape: P.box(20, 0.5), friction: mu }]);
    fixed(w, 0.5, 5, [{ shape: P.box(0.5, 10), friction: 0 }]);
    const bx = -(L * Math.cos(theta) + r), by = r;   // bottom cap centre
    const c = { x: bx + 0.5 * L * Math.cos(theta), y: by + 0.5 * L * Math.sin(theta) };
    const body = w.add(new P.Body({
      position: c, angle: theta, mass: 30,
      shapes: [
        { shape: P.box(L / 2, 0.02), friction: mu },                        // rails, tucked inside the caps
        { shape: P.circle(r, { x: -L / 2, y: 0 }), friction: mu },          // foot
        { shape: P.circle(r, { x: L / 2, y: 0 }), friction: 0 }             // top, on the smooth wall
      ]
    }));
    return { w, body, bx, L, r };
  }
  test('ladder on a smooth wall slips below the predicted angle and holds above it (±1°)', () => {
    // μ = 0.35 => θ_c ≈ atan(1/0.7) = 55.0° (the round caps move it by < 0.1°).
    const mu = 0.35, thc = ladderAngle(mu, 4, 0.04);
    checkAbs('ladder: caps barely shift θ_c (deg)', thc / DEG, Math.atan(1 / (2 * mu)) / DEG, 0.5, '°');
    [[thc + 1 * DEG, false], [thc - 1 * DEG, true]].forEach(([th, slips]) => {
      const s = ladder(th, mu);
      runFor(s.w, 3);
      const foot = s.body.worldPoint({ x: -s.L / 2, y: 0 });
      const moved = Math.abs(foot.x - s.bx);
      E09.rows.push({ name: `ladder at θc ${slips ? '-' : '+'} 1°: foot moved`, tol: slips ? '> 0.1 m' : '< 5 mm', err: moved.toFixed(4) + ' m', status: (slips ? moved > 0.1 : moved < 0.005) ? 'pass' : 'FAIL' });
      if (slips) ok(moved > 0.1, `ladder at ${(th / DEG).toFixed(1)}° should slip, foot moved ${moved} m`);
      else ok(moved < 0.005, `ladder at ${(th / DEG).toFixed(1)}° should hold, foot moved ${moved} m`);
    });
  });

  // Crate (width b, height H, mass m) on a floor with friction μ, pushed
  // horizontally at height h with a steady force P.
  //   sliding starts when P = μ W
  //   tipping about the front edge starts when P h = W b/2, i.e. P = W b / (2h)
  // so the crate tips first exactly when W b/(2h) < μ W, that is h > b/(2μ).
  // With b = 1 m and μ = 0.5 the switch-over height is 1 m. Each case is run
  // 3% below and 3% above its threshold force: below, nothing may move;
  // above, the predicted failure (and only that one) must happen.
  function push(h, P0) {
    const b = 1, H = 2, mu = 0.5, m = 100, w = world();
    fixed(w, 0, -0.5, [{ shape: P.box(20, 0.5), friction: mu }]);
    const crate = w.add(new P.Body({ position: { x: 0, y: H / 2 }, shapes: [{ shape: P.box(b / 2, H / 2), friction: mu }], mass: m }));
    const at = { x: -b / 2, y: h - H / 2 };            // back face, height h above the floor
    runFor(w, 0.5);                                    // settle on the floor first
    const foot0 = crate.worldPoint({ x: b / 2, y: -H / 2 }).x;
    // push for 2 s, or until the crate has clearly started to tip over
    for (let i = 0; i < 120 && -crate.angle < 5 * DEG; i++) {
      crate.applyForce({ x: P0, y: 0 }, crate.worldPoint(at));
      w.step(1 / 60);
    }
    const foot = crate.worldPoint({ x: b / 2, y: -H / 2 });   // front bottom edge
    return { slid: foot.x - foot0, tilt: -crate.angle / DEG };
  }
  function row(name, pass, detail) {
    E09.rows.push({ name, tol: '-', err: detail, status: pass ? 'pass' : 'FAIL' });
    ok(pass, name + ': ' + detail);
  }
  const W = 100 * g;
  test('crate pushed low (h = 0.6 m < b/2μ) holds at 0.97 μW and slides without tipping at 1.03 μW', () => {
    const lo = push(0.6, 0.97 * 0.5 * W), hi = push(0.6, 1.03 * 0.5 * W);
    row('tip vs slide: low push, 0.97 μW holds', Math.abs(lo.slid) < 1e-3 && lo.tilt < 0.1, `slid ${lo.slid.toExponential(2)} m, tilt ${lo.tilt.toFixed(3)}°`);
    row('tip vs slide: low push, 1.03 μW slides', hi.slid > 0.1 && hi.tilt < 0.5, `slid ${hi.slid.toFixed(3)} m, tilt ${hi.tilt.toFixed(3)}°`);
  });
  test('crate pushed high (h = 1.6 m > b/2μ) holds at 0.97 Wb/2h and tips without sliding at 1.03 Wb/2h', () => {
    const Pt = W * 1 / (2 * 1.6);
    const lo = push(1.6, 0.97 * Pt), hi = push(1.6, 1.03 * Pt);
    row('tip vs slide: high push, 0.97 Wb/2h holds', Math.abs(lo.slid) < 1e-3 && lo.tilt < 0.1, `slid ${lo.slid.toExponential(2)} m, tilt ${lo.tilt.toFixed(3)}°`);
    row('tip vs slide: high push, 1.03 Wb/2h tips', hi.tilt > 3 && Math.abs(hi.slid) < 0.01, `slid ${hi.slid.toFixed(4)} m, tilt ${hi.tilt.toFixed(2)}°`);
  });
});

/* --------------------------------------------------------------- centroid */
suite('e09 statics: centroid', () => {
  // L-shaped plate made of two rectangles (lengths in m, body frame):
  //   foot  2.0 × 0.4 centred at (1.0, 0.2)  area 0.80
  //   upright 0.4 × 1.6 centred at (0.2, 1.2) area 0.64
  //   x̄ = (0.80·1.0 + 0.64·0.2) / 1.44 = 0.6444 m
  //   ȳ = (0.80·0.2 + 0.64·1.2) / 1.44 = 0.6444 m
  const xb = (0.8 * 1.0 + 0.64 * 0.2) / 1.44, yb = (0.8 * 0.2 + 0.64 * 1.2) / 1.44;
  function plate(pinLocal) {
    const w = world(), wall = fixed(w, 0, 0);
    const body = w.add(new P.Body({ position: { x: 0, y: 0 }, material: 'aluminium', shapes: [P.box(1.0, 0.2, { x: 1.0, y: 0.2 }), P.box(0.2, 0.8, { x: 0.2, y: 1.2 })] }));
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: body, worldAnchor: body.worldPoint(pinLocal) }));
    return { w, body };
  }
  test('composite L-plate: engine centroid matches Σ x̄A / ΣA (1e-9)', () => {
    const { body } = plate({ x: xb, y: yb });
    checkAbs('centroid: x̄', body.localCenter.x, xb, 1e-9, ' m');
    checkAbs('centroid: ȳ', body.localCenter.y, yb, 1e-9, ' m');
  });
  test('L-plate pinned at its centroid balances in any pose; pinned 5 cm off it swings (±0.2°)', () => {
    const on = plate({ x: xb, y: yb });
    on.body.setTransform(on.body.position, 0); runFor(on.w, 5);
    checkAbs('centroid: pinned at G stays put (deg)', on.body.angle / DEG, 0, 0.2, '°');
    const off = plate({ x: xb + 0.05, y: yb });
    runFor(off.w, 2);
    ok(Math.abs(off.body.angle) > 5 * DEG, 'off-centroid pin should swing, angle ' + off.body.angle / DEG + '°');
  });
});
