'use strict';
const { suite, test, eq, near, ok } = require('./harness');

const SE = globalThis.SE;
const Gr = SE.physics.gravity;
const stub = () => ({ shake() {}, burst() {}, flash() {} });

function headless(params) {
  const s = new SE.scenes.gravity();
  s.init(stub(), params);
  s.resize(800, 500);
  return s;
}
function simulate(s, seconds) {
  const n = Math.round(seconds / SE.PHYS_DT);
  for (let i = 0; i < n; i++) s.step(SE.PHYS_DT);
}

suite('gravity: law of gravitation', () => {
  test('G is the course value', () => near(Gr.G, 66.73e-12, 1e-12));
  // 66.73e-12 * 8 * 12 / 0.64 = 1.000950e-8 N
  test('force(8, 12, 0.8) ≈ 1.00e-8 N', () => near(Gr.force(8, 12, 0.8), 1.00095e-8, 1e-5));
  test('doubling r quarters the force', () => near(Gr.force(5, 7, 2) / Gr.force(5, 7, 1), 0.25, 1e-12));
  test('tripling r gives a ninth', () => near(Gr.force(5, 7, 3) / Gr.force(5, 7, 1), 1 / 9, 1e-12));
  // 66.73e-12 * 5.9722e24 / 6.371e6^2 = 3.98525e14 / 4.05896e13 = 9.8184
  test('gAt(Earth, R) ≈ 9.82', () => near(Gr.gAt(Gr.EARTH_MASS, Gr.EARTH_RADIUS), 9.8184, 1e-4));
  // Moon: 4.89932e12 / 3.01856e12 = 1.6231
  test('Moon surface g ≈ 1.62', () => near(Gr.gAt(Gr.MOON_MASS, Gr.MOON_RADIUS), 1.6231, 1e-3));
  // Mars: 4.28213e13 / 1.14887e13 = 3.7272
  test('Mars surface g ≈ 3.73', () => near(Gr.gAt(Gr.MARS_MASS, Gr.MARS_RADIUS), 3.7272, 1e-3));
  test('g at one Earth radius up is a quarter', () => near(Gr.gAltitude('earth', Gr.EARTH_RADIUS) / Gr.gAltitude('earth', 0), 0.25, 1e-12));
  test('STANDARD_G', () => eq(Gr.STANDARD_G, 9.80665));
});

suite('gravity: latitude and site', () => {
  test('gLatitude(0) = 9.780327', () => near(Gr.gLatitude(0), 9.780327, 1e-12));
  // 9.780327 * (1 + 0.0026512 - 0.0000058) = 9.806198
  test('gLatitude(45) ≈ 9.806', () => near(Gr.gLatitude(45), 9.806198, 1e-6));
  // 9.780327 * 1.0053024 = 9.832186
  test('gLatitude(90) ≈ 9.832', () => near(Gr.gLatitude(90), 9.832186, 1e-6));
  test('symmetric about the equator', () => near(Gr.gLatitude(-30), Gr.gLatitude(30), 1e-14));
  // 1000 m up: 9.806198 - 0.003086
  test('gSite free-air correction', () => near(Gr.gSite(45, 1000), 9.806198 - 0.003086, 1e-6));
  test('gSite at sea level is gLatitude', () => eq(Gr.gSite(20, 0), Gr.gLatitude(20)));
  // w^2 R = (7.292115e-5)^2 * 6.371e6 = 0.033878 m/s^2
  test('centripetal at the equator ≈ 0.0339', () => near(Gr.centripetal(0), 0.033878, 1e-4));
  test('centripetal at 60° is half', () => near(Gr.centripetal(60), Gr.centripetal(0) / 2, 1e-12));
  test('centripetal vanishes at the pole', () => ok(Math.abs(Gr.centripetal(90)) < 1e-15));
  test('split adds up, rotation is the bigger part at the pole', () => {
    const s = Gr.latitudeSplit(90);
    near(s.rotation + s.shape, s.total, 1e-12);
    near(s.total, 0.051859, 1e-4);          // 9.832186 - 9.780327
    near(s.rotation, 0.033878, 1e-4);
    ok(s.shape > 0.017 && s.shape < 0.019, 'shape part ≈ 0.018, got ' + s.shape);
  });
});

suite('gravity: wrecking balls', () => {
  // 2000 kg steel ball: R = cbrt(3*2000 / (4 pi 7850)) = cbrt(0.060823) = 0.39327 m
  const r = Gr.spherePull({ m1: 2000, density: 7850, gap: 0, Lc: 6, g: 9.80665 });
  test('ball radius from density', () => near(r.R1, 0.39327, 1e-4));
  // F = 66.73e-12 * 4e6 / 0.78654^2 = 2.6692e-4 / 0.61865 = 4.3146e-4 N
  test('touching pull', () => near(r.F, 4.3146e-4, 1e-3));
  // theta = F / W = 4.3146e-4 / 19613.3 = 2.1998e-8 rad, delta = 6 * theta = 0.132 µm
  test('deflection angle ≈ F/W', () => near(r.theta1, r.F / (2000 * 9.80665), 1e-12));
  test('theta ≈ 2.20e-8 rad', () => near(r.theta1, 2.1998e-8, 1e-3));
  test('cable deflection ≈ 0.132 µm', () => near(r.deflection1, 1.3199e-7, 1e-3));
  test('a gap weakens the pull', () => ok(Gr.spherePull({ m1: 2000, gap: 1 }).F < r.F));
  test('unequal balls: lighter one swings more', () => {
    const u = Gr.spherePull({ m1: 1000, m2: 4000 });
    ok(u.theta1 > u.theta2);
    near(u.theta1 / u.theta2, 4, 1e-12);
  });
});

suite('gravity: altitude dial', () => {
  test('dial ends', () => { near(Gr.altFromDial(0), 0, 1e-12); near(Gr.altFromDial(1000), 40000, 1e-9); });
  test('dial round trip', () => near(Gr.altFromDial(Gr.dialFromAlt(6371)), 6371, 1e-9));
});

suite('gravity: scene runs headless', () => {
  test('altitude run arrives with the inverse-square weight', () => {
    const s = headless({ mode: 'altitude', crateMass: 50 });
    s.run({ targetAltitude: 6371, duration: 2 });
    simulate(s, 2.1);
    eq(s.state, 'arrived');
    near(s.alt, 6.371e6, 1e-9);
    near(s.scaleTarget(), 0.25, 1e-9);
    ok(s.readouts().length === 4);
    ok(s.controls().some(c => c.key === 'altDial'));
  });
  test('two-body run checks a prediction', () => {
    const s = headless({ mode: 'twobody', m1: 8, m2: 12, r: 0.8 });
    const F = Gr.force(8, 12, 1.6);
    let res;
    s.run({ r: 1.6, predicted: F }).then(x => { res = x; });
    simulate(s, 2);
    eq(s.state, 'done');
    near(s.r, 1.6, 1e-12);
    eq(s.prediction.result, 'correct');
    near(Gr.force(8, 12, s.r) / Gr.force(8, 12, s.r0), 0.25, 1e-12);
    void res;
  });
  test('two-body wrong prediction', () => {
    const s = headless({ mode: 'twobody', m1: 8, m2: 12, r: 0.8 });
    s.run({ r: 1.6, predicted: Gr.force(8, 12, 0.8) / 2 });
    simulate(s, 2);
    eq(s.prediction.result, 'wrong');
  });
  test('two-body separation cannot go below touching', () => {
    const s = headless({ mode: 'twobody' });
    s.set('r', 0.001);
    ok(s.r > 0.1);
  });
  test('spheres settle at tan(theta) = F/W', () => {
    const s = headless({ mode: 'spheres', ballMass: 2000, Lc: 6 });
    s.run({ duration: 12 });
    simulate(s, 12.1);
    eq(s.state, 'settled');
    near(s.th1, s.sphereState().theta1, 1e-3);
    near(s.th2, s.sphereState().theta2, 1e-3);
  });
  test('site mode controls and readouts', () => {
    const s = headless({ mode: 'site', latitude: 45, siteAltitude: 1000 });
    eq(s.controls().length, 2);
    s.run();
    simulate(s, 1);
    eq(s.state, 'done');
    ok(s.readouts()[1].indexOf('9.80311') >= 0, s.readouts()[1]);
  });
});
