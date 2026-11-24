'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const SE = globalThis.SE;
const P = SE.physics.scales;
const stub = { shake() {}, burst() {}, flash() {} };

function scene(params) {
  const s = new SE.scenes.scales();
  s.init(stub, params);
  s.resize(800, 500);
  return s;
}
function stepUntil(s, cond, maxSeconds) {
  const dt = 1 / 240, n = Math.round((maxSeconds || 60) / dt);
  for (let i = 0; i < n && !cond(); i++) s.step(dt);
}

suite('scales: weight and units', () => {
  test('W = m g at each location (12 kg)', () => {
    // 12 * 9.81 = 117.72, 12 * 9.775 = 117.30, 12 * 1.62 = 19.44, 12 * 3.71 = 44.52
    near(P.weight(12, P.location('earth').g), 117.72, 1e-12);
    near(P.weight(12, P.location('ridge').g), 117.30, 1e-12);
    near(P.weight(12, P.location('moon').g), 19.44, 1e-12);
    near(P.weight(12, P.location('mars').g), 44.52, 1e-12);
  });
  test('course conversion factors', () => {
    near(P.nToLb(117.72), 26.4658, 1e-4);          // 117.72 / 4.448
    near(P.kgToSlug(12), 0.822481, 1e-5);          // 12 / 14.59
    near(P.lbToN(1), 4.448, 1e-12);
    near(P.slugToKg(1), 14.59, 1e-12);
    near(P.location('earth').gFPS, 32.2, 1e-12);
    near(P.location('moon').gFPS, 5.30, 1e-12);
    near(P.msToFts(3.71), 12.172, 1e-4);           // 3.71 / 0.3048
  });
  test('FPS weight from slug * ft/s^2 agrees to rounding', () => {
    // 0.822481 slug * 32.2 = 26.4839 lb vs 26.4658 lb from N / 4.448
    const viaSlug = P.kgToSlug(12) * 32.2;
    near(viaSlug, 26.4839, 1e-4);
    ok(Math.abs(viaSlug - P.nToLb(117.72)) / viaSlug < 1e-3);
  });
});

suite('scales: spring', () => {
  test('Hooke extension x = W / k', () => {
    near(P.springExtension(117.72, 600), 0.1962, 1e-12);
    near(P.springK(60, 0.1), 600, 1e-12);
  });
  test('damped needle overshoots by exp(-zeta pi / sqrt(1 - zeta^2)) then settles at mg/k', () => {
    // zeta 0.12: exp(-0.12 pi / 0.99277) = exp(-0.37974) = 0.68404
    const r = P.simulateSpring({ m: 12, k: 600, g: 9.81, zeta: 0.12 });
    near(r.xEq, 0.1962, 1e-12);
    near(r.x, 0.1962, 2e-3);
    near(r.peak / r.xEq - 1, P.overshootRatio(0.12), 1e-2);
    near(P.overshootRatio(0.12), 0.68404, 1e-4);
    ok(r.t < 20);
  });
});

suite('scales: beam balance', () => {
  test('equal masses balance and g cancels', () => {
    eq(P.balanceTilt(12, 12), 0);
    // tan(theta) = (m1 - m2) L / (Mb d) = 1 * 0.3 / 0.05 = 6, no g anywhere
    near(Math.tan(P.balanceTilt(13, 12)), 6, 1e-12);
  });
});

suite('scales: calibration fit', () => {
  test('least squares through origin', () => {
    eq(P.fitK([]), null);
    near(P.fitK([{ x: 0.1, W: 60 }, { x: 0.2, W: 120 }]), 600, 1e-12);
    // sum(Wx) = 5 + 26 = 31, sum(x^2) = 0.05  -> 620
    near(P.fitK([{ x: 0.1, W: 50 }, { x: 0.2, W: 130 }]), 620, 1e-12);
  });
});

suite('scales: Atwood rig', () => {
  test('Atwood acceleration and tension, hand-checked', () => {
    // a = (80 - 40) 9.81 / 120 = 3.27; T = 2 * 80 * 40 * 9.81 / 120 = 523.2
    near(P.atwoodAccel(80, 40, 9.81), 3.27, 1e-12);
    near(P.atwoodTension(80, 40, 9.81), 523.2, 1e-12);
    // static offload ignores the counterweight's inertia: 9.81 * 40 / 80 = 4.905
    near(P.staticOffloadAccel(80, 40, 9.81), 4.905, 1e-12);
    // check both free bodies: m g - T = m a and T - mc g = mc a
    const a = P.atwoodAccel(80, 40, 9.81), T = P.atwoodTension(80, 40, 9.81);
    near(80 * 9.81 - T, 80 * a, 1e-12);
    near(T - 40 * 9.81, 40 * a, 1e-12);
  });
  test('counterweight for Moon g', () => {
    // mc = 80 (9.81 - 1.62) / (9.81 + 1.62) = 655.2 / 11.43 = 57.3228
    near(P.counterweightFor(80, 1.62, 9.81), 57.3228, 1e-5);
    near(P.atwoodAccel(80, P.counterweightFor(80, 1.62, 9.81), 9.81), 1.62, 1e-12);
    // static: 80 (1 - 1.62 / 9.81) = 66.789
    near(P.counterweightFor(80, 1.62, 9.81, 'static'), 66.789, 1e-4);
  });
  test('jump height and outcome classes', () => {
    near(P.jumpHeight(2, 1.62), 4 / 3.24, 1e-12);   // 1.2346 m
    eq(P.jumpHeight(2, 0), Infinity);
    eq(P.rigOutcome(1.62, 1.62, 0.15), 'moonlike');
    eq(P.rigOutcome(1.0, 1.62, 0.15), 'tooHeavy');
    eq(P.rigOutcome(3.27, 1.62, 0.15), 'tooLight');
  });
});

suite('scales: scene headless', () => {
  test('compare: Moon reading is m g_moon and balance stays level', () => {
    const s = scene({ mode: 'compare', mass: 12 });
    s.run({ location: 'moon' });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'settled');
    near(s.result.detail.reading, 19.44, 1e-9);
    near(s.result.detail.W_lb, 19.44 / 4.448, 1e-9);
    eq(s.result.detail.balanced, true);
    eq(s.result.detail.balanceTilt, 0);
    ok(s.result.detail.overshoot > 0.5, 'needle overshoots when released from rest');
  });
  test('compare: switching Earth -> Mars re-settles at 44.52 N', () => {
    const s = scene({ mode: 'compare', mass: 12, units: 'FPS' });
    s.run({ location: 'earth' });
    stepUntil(s, () => s.result);
    near(s.result.detail.reading, 117.72, 1e-9);
    s.result = null;
    s.run({ location: 'mars' });
    stepUntil(s, () => s.result);
    near(s.result.detail.reading, 44.52, 1e-9);
    near(s.result.detail.readingUnits, 44.52 / 4.448, 1e-9);
    ok(s.spring.x < 117.72 / 600, 'spring shortened');
  });
  test('compare: overload pegs the dial', () => {
    const s = scene({ mode: 'compare', mass: 40, capacity: 300 });
    s.run({ location: 'earth' });   // 392.4 N > 300 N
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'overload');
  });
  test('calibrate: marks build k and run returns the reading', () => {
    const s = scene({ mode: 'calibrate', k: 735 });
    s.run({ mass: 5, g: 9.81 });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'uncalibrated');
    s.setMarks([{ mass: 2, g: 9.81 }, { mass: 10, g: 9.81 }]);
    near(s.getMarks()[1].x, 98.1 / 735, 1e-12);
    near(s.calK(), 735, 1e-12);
    s.result = null;
    s.run({ mass: 7, g: 9.81 });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'accurate');
    near(s.result.detail.reading, 68.67, 1e-9);   // 7 * 9.81
    // a mislabelled mark (wrote 30 N where 19.62 N hung) skews the fit
    s.setMarks([{ mass: 2, g: 9.81, W: 30 }]);
    s.result = null;
    s.run({ mass: 7, g: 9.81 });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'miscalibrated');
    near(s.result.detail.reading, 68.67 * 30 / 19.62, 1e-9);
  });
  test('calibrate: markCurrent pencils the settled position', () => {
    const s = scene({ mode: 'calibrate', k: 500, refMass: 4, g: 9.81 });
    stepUntil(s, () => !s.springLive);
    const mk = s.markCurrent();
    near(mk.x, 39.24 / 500, 1e-9);
    near(s.calK(), 500, 1e-9);
  });
  test('rig: ideal counterweight gives a moonlike jump of v0^2/(2*1.62)', () => {
    const s = scene({ mode: 'rig', survivorMass: 80, v0: 2 });
    s.run({ counterweightKg: P.counterweightFor(80, 1.62, 9.81) });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'moonlike');
    near(s.result.detail.aEff, 1.62, 1e-9);
    near(s.result.detail.height, 1.2346, 1e-4);
    near(s.result.detail.reached, 1.2346, 5e-3);
  });
  test('rig: light and heavy counterweights', () => {
    const s = scene({ mode: 'rig' });
    s.run({ counterweightKg: 40 });
    stepUntil(s, () => s.result);
    eq(s.result.outcome, 'tooLight');
    near(s.result.detail.aEff, 3.27, 1e-9);
    const s2 = scene({ mode: 'rig' });
    s2.run({ counterweightKg: 75 });   // a = 5 * 9.81 / 155 = 0.3165 -> rides to the stop
    stepUntil(s2, () => s2.result);
    eq(s2.result.outcome, 'tooHeavy');
    eq(s2.result.detail.hitStop, true);
  });
  test('controls exist for each mode', () => {
    ['compare', 'calibrate', 'rig'].forEach(m => ok(scene({ mode: m }).controls().length >= 3));
  });
});
