'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const G = globalThis.SE.physics.gate;
const DEG = Math.PI / 180;

function stubStage() { return { shake() {}, burst() {}, flash() {} }; }
function scene(params) {
  const s = new globalThis.SE.scenes.gate();
  s.init(stubStage(), params);
  s.resize(800, 500);
  return s;
}
function steps(s, seconds) { const n = Math.round(seconds * 240); for (let i = 0; i < n; i++) s.step(1 / 240); }

suite('gate: torque and inertia', () => {
  test('I = mL^2/3 for a 120 kg, 3 m gate is 360 kg m^2', () => near(G.gateInertia(120, 3), 360));
  test('tau = F d sin(theta): 600 N at 2.8 m, square on = 1680 N m', () => near(G.torque(600, 2.8, 90 * DEG), 1680));
  test('a push along the gate (theta = 0) gives no torque', () => near(G.torque(600, 2.8, 0), 0, 1e-9));
  test('at 30 deg only half the push turns the gate (300 N of 600)', () => near(G.perpComponent(600, 30 * DEG), 300, 1e-12));
  test('the same push 0.2 m from the hinge: 120 N m, 14x less', () => near(G.torque(600, 0.2, 90 * DEG), 120));
});

suite('gate: simulated swing', () => {
  const base = { L: 3, mass: 120, angle0: 25, H: 0, friction: 0 };

  test('push along the gate does nothing: held at 25 deg, omega 0', () => {
    const r = G.simulateGate(Object.assign({}, base, { F: 600, d: 2.8, theta: 0 }), 3);
    eq(r.outcome, 'held'); near(r.detail.angle, 25, 1e-9); near(r.detail.omega, 0, 1e-12);
  });

  test('600 N near the hinge barely moves it in 1 s; at the tip it slams shut', () => {
    // near hinge: alpha = (120 - 40)/360 = 0.2222 rad/s^2, 1 s -> 0.1111 rad = 6.37 deg
    const near0 = G.simulateGate(Object.assign({}, base, { friction: 40, F: 600, d: 0.2, theta: 90 }), 1);
    eq(near0.outcome, 'held');
    near(near0.detail.angle, 25 - 6.366, 0.01);
    // tip: alpha = (1680 - 40)/360 = 4.556, closes after 0.438 s at 1.99 rad/s (tip 5.98 m/s)
    const far = G.simulateGate(Object.assign({}, base, { friction: 40, F: 600, d: 2.8, theta: 90 }), 1);
    eq(far.outcome, 'slammed');
    near(far.detail.time, 0.4376, 0.02);
    near(-far.detail.omega, 1.994, 0.02);
  });

  test('balanced torques F d = H dh hold the gate still', () => {
    const r = G.simulateGate({ L: 3, mass: 120, angle0: 25, H: 400, dh: 2, F: 400 * 2 / 2.8, d: 2.8, theta: 90, friction: 0 }, 4);
    eq(r.outcome, 'held'); near(r.detail.angle, 25, 1e-6);
  });

  test('hinge friction holds a small imbalance (30 N m < 40 N m)', () => {
    const r = G.simulateGate({ L: 3, mass: 120, angle0: 25, H: 0, F: 30, d: 1, theta: 90, friction: 40 }, 3);
    eq(r.outcome, 'held'); eq(r.detail.omega, 0);
  });

  test('horde alone opens the gate: alpha = (800-40)/360, reaches 80 deg at ~0.954 s', () => {
    const r = G.simulateGate({ L: 3, mass: 120, angle0: 25, H: 400, dh: 2, F: 0, friction: 40, openAngle: 80 }, 3);
    eq(r.outcome, 'opened'); near(r.detail.time, 0.9536, 0.01);
  });

  test('a gentle push closes without slamming (tip 1.48 m/s < 2.5)', () => {
    const r = G.simulateGate(Object.assign({}, base, { F: 100, d: 1, theta: 90, slamSpeed: 2.5 }), 4);
    eq(r.outcome, 'closed'); near(r.detail.tipSpeed, 1.477, 0.01); near(r.detail.time, 1.772, 0.01);
  });

  test('pushing from the outside face (theta = -90) opens it', () => {
    eq(G.simulateGate(Object.assign({}, base, { F: 600, d: 2.8, theta: -90 }), 3).outcome, 'opened');
  });

  test('scene steps headless and matches the pure simulation', () => {
    const p = { L: 3, mass: 120, angle0: 25, H: 400, dh: 2, F: 600, d: 2.8, theta: 90, friction: 40 };
    const s = scene(p);
    s.run({ duration: 3 });
    steps(s, 3);
    const ref = G.simulateGate(p, 3);
    eq(s.result.outcome, ref.outcome);
    near(s.result.detail.time, ref.detail.time, 1e-9);
    ok(s.controls().length >= 6, 'controls');
    ok(s.readouts().length > 0, 'readouts');
  });

  test('pointer drag sets push point and a square push', () => {
    const s = scene({ angle0: 0, F: 0 });
    const c = s.cam;
    s.pointer({ type: 'pointerdown', x: c.x(2), y: c.y(0) });
    s.pointer({ type: 'pointermove', x: c.x(2), y: c.y(-1), buttons: 1 });   // from inside, pushing outward
    s.pointer({ type: 'pointerup', x: c.x(2), y: c.y(-1) });
    near(s.p.d, 2, 1e-9); eq(s.p.theta, 90); near(s.p.F, 800, 1e-9);        // 1 m of drag = Fmax/2.5
  });
});

suite('gate: cantilever beam', () => {
  const E = 200e9, I = G.secondMoment(0.1, 0.15);
  test('I = b h^3 / 12 = 2.8125e-5 m^4 for 100 x 150 mm', () => near(I, 2.8125e-5));
  test('steel tip deflection 1000 N at 3 m: 1.6 mm', () => near(G.tipDeflection(1000, 3, E, I), 1.6e-3));
  test('rubber, same beam: 32 m (rigid body model hopeless)', () => near(G.tipDeflection(1000, 3, 1e7, I), 32));
  test('y(L) equals delta', () => near(G.deflection(3, 1000, 3, E, I), G.tipDeflection(1000, 3, E, I)));
  test('root stress 8 MPa', () => near(G.rootStress(1000, 3, 0.15, I), 8e6));
  test('uniform load over the whole beam deflects 3/8 of the tip load', () => near(G.spreadLoad(1000, 3, E, I, 3).tip / G.tipDeflection(1000, 3, E, I), 0.375));
  test('pallet 1.2 m at the tip: spread/point = 45.8784/64.8 = 0.708', () => near(G.spreadLoad(1000, 3, E, I, 1.2).tip / G.tipDeflection(1000, 3, E, I), 45.8784 / 64.8, 1e-9));
  test('numeric shape agrees with the closed-form tip for a spread load', () => {
    const L = G.spreadLoad(1000, 3, E, I, 1.2);
    near(L.at(3).y, L.tip, 1e-3);
  });
  test('analysis flags: steel rigid fair, rubber not; wheel concentrated fair, pallet not', () => {
    ok(G.beamAnalysis({ material: 'steel' }).rigidFair);
    ok(!G.beamAnalysis({ material: 'rubber' }).rigidFair);
    const wheel = G.beamAnalysis({ patch: 'wheel' }), pallet = G.beamAnalysis({ patch: 'pallet' });
    near(wheel.contactRatio, 0.005); ok(wheel.concentratedFair);
    near(pallet.contactRatio, 0.4); ok(!pallet.concentratedFair);
  });
  test('exaggeration for 1.6 mm on 3 m: x200', () => eq(G.exaggeration(1.6e-3, 3), 200));

  test('scene: steel holds, rubber sags, overload fails (yield at 31.25 kN)', () => {
    let s = scene({ mode: 'beam', material: 'steel' });
    s.run(); steps(s, 3); eq(s.result.outcome, 'held');
    s = scene({ mode: 'beam', material: 'rubber' });
    s.run(); steps(s, 3); eq(s.result.outcome, 'sagged');
    s = scene({ mode: 'beam', material: 'steel', P: 40000 });
    s.run(); steps(s, 4); eq(s.result.outcome, 'failed');
    near(s.result.detail.P, 31250, 0.005);
  });
});

suite('gate: concentrated-force model', () => {
  test('pallet: resultant at the centroid (2.4 m) predicts the tip within 0.6 %', () => {
    // point at a = 2.4: P a^2 (3L - a)/(6EI) -> 5.76*6.6 = 38.016 vs spread 38.232 (same 1/(6EI) factor)
    const A = G.beamAnalysis({ patch: 'pallet' });
    near(A.resultantAt, 2.4);
    near(A.modelError, 38.016 / 38.232 - 1, 1e-9);
  });
});
