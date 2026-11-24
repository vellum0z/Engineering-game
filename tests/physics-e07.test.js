'use strict';
// Sensors, gauges, free-body diagrams and the recorder. Every reading is
// checked against a hand calculation, since these numbers are what the
// player is taught with.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, P = SE.phys, M = SE.pmath, S = P.sensors;
const g = 9.81;

function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, opts || {})); }
function ground(w, opts) {
  return w.add(new P.Body(Object.assign({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(50, 0.5)], label: 'floor' }, opts || {})));
}
function crate(w, x, y, m, opts) {
  return w.add(new P.Body(Object.assign({ position: { x: x, y: y }, shapes: [P.box(0.5, 0.5)], mass: m, material: 'cargo' }, opts || {})));
}
function sumKind(fbd, kind) {
  return fbd.forces.filter(f => f.kind === kind).reduce((s, f) => M.add(s, f.vector), M.v(0, 0));
}

suite('sensors: free-body diagrams', () => {
  test('crate at rest: W = mg down, N = mg up, ΣF ≈ 0 (1e-3 relative), ΣM ≈ 0', () => {
    // 250 kg crate on the floor: W = 250 × 9.81 = 2452.5 N, the floor pushes back the same.
    const w = world(); const floor = ground(w); const b = crate(w, 0, 0.5, 250);
    w.run(3);
    const fbd = S.freeBody(w, b), mg = 250 * g;
    const W = sumKind(fbd, 'weight'), N = sumKind(fbd, 'contact-normal');
    near(W.y, -mg, 1e-12); near(N.y, mg, 1e-3);
    ok(fbd.forces.filter(f => f.kind === 'contact-normal').every(f => f.from === floor), 'normal comes from the floor');
    ok(Math.abs(fbd.resultant.x) < 1e-3 * mg && Math.abs(fbd.resultant.y) < 1e-3 * mg, 'ΣF = ' + JSON.stringify(fbd.resultant));
    // moment scale: mg × half-width = 1226 N·m
    ok(Math.abs(fbd.moment) < 1e-3 * mg * 0.5, 'ΣM = ' + fbd.moment);
  });

  test('beam on two rollers with an off-centre load: reactions match the hand calc (1%), ΣF = ΣM = 0 about any point', () => {
    // 4 m beam, 100 kg, rollers at x = 0 and x = 4, load P = 2000 N down at x = 1.
    // ΣM about A: R_B·4 = W·2 + P·1 = 981·2 + 2000 = 3962 -> R_B = 990.5 N
    // ΣFy:        R_A = 981 + 2000 − 990.5 = 1990.5 N
    const w = world();
    const A = w.add(new P.Body({ type: 'static', position: { x: 0, y: 0 }, shapes: [P.circle(0.1)], label: 'A' }));
    const B = w.add(new P.Body({ type: 'static', position: { x: 4, y: 0 }, shapes: [P.circle(0.1)], label: 'B' }));
    const beam = w.add(new P.Body({ position: { x: 2, y: 0.2 }, shapes: [{ shape: P.box(2.1, 0.1), friction: 0.6 }], mass: 100 }));
    const load = { x: 1, y: 0.3 }, Pl = 2000;
    // the load is re-applied before every step (forces clear after each one)
    for (let i = 0; i < 180; i++) { beam.applyForce({ x: 0, y: -Pl }, load); w.step(1 / 60); }
    const fbd = S.freeBody(w, beam);
    const RA = fbd.forces.filter(f => f.from === A).reduce((s, f) => s + f.vector.y, 0);
    const RB = fbd.forces.filter(f => f.from === B).reduce((s, f) => s + f.vector.y, 0);
    near(RA, 1990.5, 0.01, 'R_A'); near(RB, 990.5, 0.01, 'R_B');
    ok(fbd.forces.some(f => f.kind === 'applied' && Math.abs(f.vector.y + Pl) < 1e-9), 'applied load listed');
    const tol = 1e-3 * (981 + Pl);
    ok(Math.abs(fbd.resultant.y) < tol && Math.abs(fbd.resultant.x) < tol, 'ΣF = ' + JSON.stringify(fbd.resultant));
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: -7, y: 3 }].forEach(o => {
      ok(Math.abs(fbd.momentAbout(o)) < tol * 4, 'ΣM about ' + JSON.stringify(o) + ' = ' + fbd.momentAbout(o));
    });
  });

  test('sled pulled across ice: ΣF from the free body = m·a from the accelerometer (1%)', () => {
    // 80 kg sled, frictionless, pulled by 120 N: a = 1.5 m/s².
    const w = world(); ground(w, { shapes: [{ shape: P.box(50, 0.5), friction: 0 }] });
    const sled = w.add(new P.Body({ position: { x: 0, y: 0.25 }, shapes: [{ shape: P.box(0.8, 0.25), friction: 0 }], mass: 80 }));
    const acc = new S.Accelerometer(sled);
    for (let i = 0; i < 60; i++) { sled.applyForce({ x: 120, y: 0 }); w.step(1 / 60); }
    const fbd = S.freeBody(w, sled);
    const a = acc.vector();
    near(fbd.resultant.x, 80 * a.x, 0.01, 'ΣFx vs m·ax');
    near(a.x, 1.5, 0.01, 'a = F/m');
    ok(Math.abs(fbd.resultant.y) < 0.01 * 80 * g, 'ΣFy = ' + fbd.resultant.y);
    near(acc.read(), 1.5, 0.01);
  });

  test('a hanging crate on a pin lists the joint force, equal and opposite on the two bodies', () => {
    const w = world();
    const hook = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.2, 0.2)] }));
    const b = crate(w, 0, 4, 40);
    w.addJoint(new P.RevoluteJoint({ bodyA: hook, bodyB: b, worldAnchor: { x: 0, y: 4.5 }, label: 'pin' }));
    w.run(2);
    const onB = S.freeBody(w, b).forces.find(f => f.kind === 'joint');
    const onA = S.freeBody(w, hook).forces.find(f => f.kind === 'joint');
    near(onB.vector.y, 40 * g, 1e-3); eq(onB.label, 'pin');
    near(onA.vector.y, -onB.vector.y, 1e-12);
    near(S.freeBody(w, b).resultant.y, 0, 0.04);
    const jf = S.jointForces(w);
    eq(jf.length, 1); near(jf[0].force, 40 * g, 1e-3);
  });
});

suite('sensors: gauges', () => {
  test('load cell on a hanging rope reads mg (0.1%)', () => {
    // 25 kg crate on a 2 m rope: T = 25 × 9.81 = 245.25 N.
    const w = world();
    const beam = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(1, 0.1)] }));
    const b = crate(w, 0, 2.5, 25);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: beam, bodyB: b, localAnchorA: { x: 0, y: -0.1 }, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    const cell = new S.LoadCell(rope);
    w.run(3);
    eq(cell.unit, 'N');
    near(cell.read(w), 25 * g, 1e-3);
  });

  test('spring scale with k reads mg and stretches mg/k (1%)', () => {
    // k = 2000 N/m, 10 kg: T = 98.1 N, x = 98.1 / 2000 = 0.04905 m.
    const w = world(), k = 2000, m = 10;
    const hook = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.1, 0.1)] }));
    const b = w.add(new P.Body({ position: { x: 0, y: 4 }, shapes: [P.circle(0.1)], mass: m }));
    const spring = w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: b, length: 1, stiffness: k, damping: 2 * Math.sqrt(k * m) }));
    const scale = new S.SpringScale(spring);
    w.run(4);
    near(scale.read(w), m * g, 0.01, 'reading');
    near(scale.stretch(w), m * g / k, 0.01, 'stretch');
    const fbd = S.freeBody(w, b);
    ok(fbd.forces.some(f => f.kind === 'spring'), 'spring force listed');
  });

  test('load cell between two bodies reads the contact normal force', () => {
    const w = world(); const floor = ground(w); const b = crate(w, 0, 0.5, 60);
    w.run(2);
    near(new S.LoadCell(floor, b).read(w), 60 * g, 1e-3);
    near(new S.LoadCell(floor, b).vector(w).y, 60 * g, 1e-3);
  });

  test('speedometer, tape measure and angle gauge match the state', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const b = w.add(new P.Body({ position: { x: 1, y: 2 }, velocity: { x: 3, y: 4 }, angularVelocity: 0.5, shapes: [P.box(0.5, 0.5)] }));
    w.run(1);
    near(new S.Speedometer(b).read(w), 5, 1e-9);
    near(new S.Speedometer(b, { component: 'x' }).read(w), 3, 1e-9);
    // a point 1 m right of the centre moves at v + ω × r
    const rim = new S.Speedometer(b, { point: { x: 1, y: 0 } }).read(w);
    const vr = b.velocityAt(b.worldPoint({ x: 1, y: 0 }));
    near(rim, M.len(vr), 1e-9);
    near(new S.TapeMeasure({ x: 1, y: 2 }, { body: b }).read(w), 5, 1e-6);
    near(new S.AngleGauge(b).read(w), 0.5, 1e-6);
    near(new S.AngleGauge(b, { degrees: true }).read(w), 0.5 * 180 / Math.PI, 1e-6);
  });

  test('stopwatch timed from release to impact matches √(2h/g) (one step)', () => {
    // drop from 5 m (bottom of the crate 5 m above the floor): t = √(2·5/9.81) = 1.0096 s
    const w = world(); ground(w); const b = crate(w, 0, 5.5, 10);
    const sw = new S.Stopwatch(w, { stop: 'impact' });
    w.run(2);
    ok(!sw.running(), 'stopped on impact');
    ok(Math.abs(sw.read() - Math.sqrt(2 * 5 / g)) < 1 / 60 + 1e-9, 't = ' + sw.read());
  });

  test('stopwatch with condition functions', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const b = w.add(new P.Body({ velocity: { x: 2, y: 0 }, shapes: [P.circle(0.1)] }));
    const sw = new S.Stopwatch(w, { start: () => b.c.x >= 1, stop: () => b.c.x >= 3 });
    w.run(3);
    near(sw.read(), 1, 0.02);
  });

  test('energy meter: a frictionless pendulum keeps its total energy within 1% over 10 s', () => {
    // 2 m pendulum released from horizontal: E = m g h stays put; KE ↔ PE swap.
    const w = world();
    const pivot = w.add(new P.Body({ type: 'static', position: { x: 0, y: 0 }, shapes: [P.circle(0.05)] }));
    const bob = w.add(new P.Body({ position: { x: 2, y: 0 }, shapes: [P.circle(0.1)], mass: 5 }));
    w.addJoint(new P.DistanceJoint({ bodyA: pivot, bodyB: bob }));
    const meter = new S.EnergyMeter(w);
    const E0 = meter.read(w);
    let lo = E0, hi = E0, maxKE = 0;
    w.run(10, 1 / 60, () => { const e = meter.parts(w); lo = Math.min(lo, e.total); hi = Math.max(hi, e.total); maxKE = Math.max(maxKE, e.kinetic); });
    const scale = 5 * g * 2;                         // energy swapped each swing
    ok(hi - lo < 0.01 * scale, 'energy drifted by ' + (hi - lo) + ' J of ' + scale);
    near(maxKE, scale, 0.01, 'all PE turns into KE at the bottom');
  });

  test('energy meter counts spring energy ½kx²', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ type: 'static', shapes: [P.circle(0.05)] }));
    const b = w.add(new P.Body({ position: { x: 1.2, y: 0 }, shapes: [P.circle(0.05)], mass: 1 }));
    w.addJoint(new P.DistanceJoint({ bodyA: a, bodyB: b, length: 1, stiffness: 500 }));
    near(new S.EnergyMeter(w).parts(w).elastic, 0.5 * 500 * 0.04, 1e-9);
  });

  test('momentum meter: Σmv is conserved when two free bodies collide', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ position: { x: 0, y: 0 }, velocity: { x: 3, y: 0 }, shapes: [P.box(0.5, 0.5)], mass: 2 }));
    w.add(new P.Body({ position: { x: 3, y: 0 }, shapes: [P.box(0.5, 0.5)], mass: 4 }));
    const pm = new S.MomentumMeter(w);
    eq(pm.unit, 'N·s');
    near(pm.read(w), 6, 1e-12);
    w.run(3);
    near(pm.vector(w).x, 6, 1e-6); ok(a.v.x < 3, 'they collided');
  });

  test('reading sensors does not change the simulation', () => {
    function scene(watch) {
      const w = world(); ground(w); const b = crate(w, 0, 3, 50, { angle: 0.3 });
      for (let i = 0; i < 180; i++) {
        w.step(1 / 60);
        if (watch) { S.freeBody(w, b); S.jointForces(w); new S.LoadCell(w.bodies[0], b).read(w); new S.EnergyMeter(w).read(w); }
      }
      return [b.c.x, b.c.y, b.angle];
    }
    const a = scene(false), b = scene(true);
    a.forEach((x, i) => eq(b[i], x));
  });
});

suite('sensors: recorder', () => {
  function sledScene(withRecorder) {
    const w = world(); ground(w, { shapes: [{ shape: P.box(50, 0.5), friction: 0 }] });
    const sled = w.add(new P.Body({ position: { x: 0, y: 0.25 }, shapes: [{ shape: P.box(0.8, 0.25), friction: 0 }], mass: 80 }));
    const hook = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.1, 0.1)] }));
    const b = crate(w, 0, 3, 20);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: b, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    let rec = null;
    if (withRecorder) rec = new P.Recorder(w, { gauges: { speed: new S.Speedometer(sled), tension: new S.LoadCell(rope) }, every: 2 });
    w.run(2, 1 / 60, () => { sled.applyForce({ x: 120, y: 0 }); });
    return { w, sled, b, rec };
  }

  test('series length, peaks and CSV header are right; v = a·t on the plot', () => {
    const { rec, w } = sledScene(true);
    // 120 steps sampled every 2nd -> 60 samples
    eq(rec.length(), 60);
    const sp = rec.series('speed');
    eq(sp.t.length, 60); eq(sp.v.length, 60); eq(sp.unit, 'm/s');
    // the pull starts after the first step, so at t = 2 s: v = (120 / 80)(2 − 1/60) = 2.975 m/s
    near(sp.max, 1.5 * (2 - 1 / 60), 0.01);
    near(sp.peak, sp.max, 1e-12);
    // the crate drops onto its rope and then hangs, so the peak is at least the resting mg
    ok(rec.peak('tension') >= 20 * g * 0.999, 'peak tension ' + rec.peak('tension'));
    near(rec.series('tension').last, 20 * g, 0.01);
    const csv = rec.toCSV().split('\n');
    eq(csv[0], 't [s],speed [m/s],tension [N]');
    eq(csv.length, 62);                              // header + 60 rows + trailing newline
    near(Number(csv[1].split(',')[0]), 1 / 60, 1e-9);
    rec.stop();
    w.run(1);
    eq(rec.length(), 60, 'no samples after stop');
    eq(w.listeners.step.indexOf(rec.listener), -1);
  });

  test('a recorder does not change the sim: identical positions with and without it', () => {
    const a = sledScene(false), b = sledScene(true);
    eq(b.sled.c.x, a.sled.c.x); eq(b.sled.c.y, a.sled.c.y);
    eq(b.b.c.x, a.b.c.x); eq(b.b.c.y, a.b.c.y); eq(b.b.angle, a.b.angle);
  });

  test('custom function gauges and a gauge added later', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const rec = new P.Recorder(w, { gauges: { t2: wo => wo.time * 2 } });
    w.run(0.5);
    rec.add('one', S.gauge(() => 1, 'm'));
    w.run(0.5);
    const s = rec.series('one');
    eq(s.v[0], null); eq(s.v[s.v.length - 1], 1);
    near(rec.max('t2'), 2, 1e-9);
  });
});
