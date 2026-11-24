'use strict';
// Physics engine: checked against textbook results. A game that teaches
// mechanics has to agree with the formulas it teaches.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;

function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, opts || {})); }
function ground(w, mat) {
  return w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [{ shape: P.box(50, 0.5), material: mat || 'steel' }] }));
}
function crate(w, x, y, m, opts) {
  return w.add(new P.Body(Object.assign({ position: { x: x, y: y }, shapes: [P.box(0.5, 0.5)], mass: m, material: 'cargo' }, opts || {})));
}

suite('physics: mass properties', () => {
  test('1 m square at 1000 kg/m² has m = 1000 kg and I = m(w² + h²)/12', () => {
    const md = P.massData(P.box(0.5, 0.5), 1000);
    near(md.mass, 1000, 1e-9); near(md.I, 1000 * 2 / 12, 1e-9);
  });
  test('circle: m = ρπr², I = ½mr²', () => {
    const md = P.massData(P.circle(0.5), 1000);
    near(md.mass, 1000 * Math.PI * 0.25, 1e-9); near(md.I, 0.5 * md.mass * 0.25, 1e-9);
  });
  test('an offset box has its centroid where it was put', () => {
    const b = new P.Body({ shapes: [P.box(1, 0.5, { x: 2, y: 0 })] });
    near(b.localCenter.x, 2, 1e-9); near(b.localCenter.y, 0, 1e-9);
  });
  test('mass override keeps the shape and scales I', () => {
    const b = new P.Body({ shapes: [P.box(0.5, 0.5)], mass: 250 });
    near(b.m, 250, 1e-12); near(b.I, 250 * 2 / 12, 1e-9);
  });
});

suite('physics: free fall and projectiles', () => {
  test('drop for 1 s: v = gt and y = ½gt² (within 1%)', () => {
    const w = world(), b = crate(w, 0, 100, 10);
    w.run(1);
    near(b.v.y, -g, 1e-6); near(100 - b.c.y, 0.5 * g, 0.01);
  });
  test('projectile range R = v² sin 2θ / g (within 1%)', () => {
    const w = world(), v0 = 20, th = Math.PI / 4;
    const b = w.add(new P.Body({ position: { x: 0, y: 0 }, velocity: { x: v0 * Math.cos(th), y: v0 * Math.sin(th) }, shapes: [P.circle(0.05)] }));
    let x = null; let prevY = 0, prevX = 0;
    w.run(4, 1 / 240, () => { if (b.c.y < 0 && prevY >= 0) { x = prevX + (b.c.x - prevX) * prevY / (prevY - b.c.y); return false; } prevY = b.c.y; prevX = b.c.x; });
    near(x, v0 * v0 * Math.sin(2 * th) / g, 0.01);
  });
});

suite('physics: contact and statics', () => {
  test('a crate at rest on the ground: no drift, no sinking, contact force = mg', () => {
    const w = world(); ground(w); const b = crate(w, 0, 0.5, 250);
    w.run(3);
    ok(Math.abs(b.v.y) < 1e-3 && Math.abs(b.v.x) < 1e-3, 'still moving: ' + JSON.stringify(b.v));
    ok(b.c.y > 0.5 - 0.01, 'sank to ' + b.c.y);
    near(w.contactForceOn(b, 1 / 60).y, 250 * g, 0.01);
  });
  test('a 10-crate stack stays standing for 10 s', () => {
    const w = world(); ground(w);
    const boxes = [];
    for (let i = 0; i < 10; i++) boxes.push(crate(w, 0, 0.5 + i * 1.0, 50));
    w.run(10);
    const top = boxes[9];
    ok(Math.abs(top.c.x) < 0.05, 'top drifted to x = ' + top.c.x);
    ok(top.c.y > 9.4, 'stack sagged to ' + top.c.y);
    boxes.forEach(b => ok(Math.abs(b.v.x) + Math.abs(b.v.y) < 0.02, 'crate still moving'));
  });
  test('heavy on light: a 1000 kg crate on a 10 kg crate (mass ratio 100) holds', () => {
    const w = world(); ground(w);
    const small = crate(w, 0, 0.5, 10), big = crate(w, 0, 1.5, 1000);
    w.run(5);
    ok(big.c.y > 1.45 && small.c.y > 0.45, 'crushed: ' + big.c.y + ', ' + small.c.y);
  });
  test('sliding to a stop: distance v²/(2μg) (within 3%)', () => {
    const w = world(); ground(w);
    const b = w.add(new P.Body({ position: { x: 0, y: 0.5 }, velocity: { x: 5, y: 0 }, shapes: [{ shape: P.box(0.5, 0.5), friction: 0.5 }], mass: 100 }));
    w.bodies[0].fixtures[0].friction = 0.5;
    w.run(3);
    near(b.c.x, 25 / (2 * 0.5 * g), 0.03);
  });
  test('frictionless ice: a pushed sled keeps its speed (Newton\'s first law)', () => {
    const w = world(); ground(w, 'frictionless');
    const b = w.add(new P.Body({ position: { x: 0, y: 0.5 }, velocity: { x: 2, y: 0 }, shapes: [P.box(0.5, 0.5)], material: 'frictionless', mass: 80 }));
    w.run(3);
    near(b.v.x, 2, 0.001); near(b.c.x, 6, 0.01);
  });
  test('a ball with e = 0.5 dropped from 2 m bounces to about e²h = 0.5 m', () => {
    const w = world(); ground(w);
    w.bodies[0].fixtures[0].restitution = 0;
    const b = w.add(new P.Body({ position: { x: 0, y: 2.1 }, shapes: [{ shape: P.circle(0.1), restitution: 0.5 }], mass: 1 }));
    let bounced = false, peak = 0;
    w.run(2.5, 1 / 120, () => { if (b.v.y > 0) bounced = true; if (bounced) peak = Math.max(peak, b.c.y - 0.1); });
    near(peak, 0.5, 0.1);
  });
  test('a fast crate does not pass through a thin floor', () => {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: 0 }, shapes: [P.box(5, 0.05)] }));
    const b = crate(w, 0, 3, 50, { velocity: { x: 0, y: -40 } });
    w.run(1);
    ok(b.c.y > 0, 'fell through: y = ' + b.c.y);
  });
});

suite('physics: ropes, springs and pins', () => {
  function ceiling(w) { return w.add(new P.Body({ type: 'static', position: { x: 0, y: 10 }, shapes: [P.box(1, 0.1)] })); }
  test('a hanging load: rope tension = mg (within 0.5%)', () => {
    const w = world(), c = ceiling(w), load = crate(w, 0, 6, 250);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, localAnchorA: { x: 0, y: -0.1 }, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    w.run(2);
    near(rope.tension(), 250 * g, 0.005);
  });
  test('a 100 kg load snaps a rope rated 900 N, and a 1000 N rope holds it', () => {
    [[900, true], [1000, false]].forEach(([rating, snaps]) => {
      const w = world(), c = ceiling(w), load = crate(w, 0, 6, 100);
      const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, localAnchorA: { x: 0, y: -0.1 }, localAnchorB: { x: 0, y: 0.5 }, rope: true, breakForce: rating }));
      let broke = null; w.on('break', e => { broke = e; });
      w.run(2);
      ok(!!broke === snaps, rating + ' N: ' + (broke ? 'broke at ' + broke.force.toFixed(0) + ' N' : 'held'));
      if (snaps) ok(load.c.y < 3, 'load should be falling');
    });
  });
  test('a slack rope carries no force', () => {
    const w = world(), c = ceiling(w), load = crate(w, 0, 6, 50);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, localAnchorA: { x: 0, y: -0.1 }, localAnchorB: { x: 0, y: 0.5 }, rope: true, length: 6 }));
    w.run(0.2);
    near(rope.tension(), 0, 1e-9); ok(rope.isSlack());
  });
  test('pendulum period 2π√(L/g) for small swings (within 1%)', () => {
    const w = world(), c = ceiling(w), L = 2, th = 5 * Math.PI / 180;
    const bob = w.add(new P.Body({ position: { x: L * Math.sin(th), y: 10 - L * Math.cos(th) }, shapes: [P.circle(0.05)], mass: 5 }));
    w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: bob, length: L }));
    const crossings = []; let prev = bob.c.x;
    w.run(8, 1 / 240, (wd) => { if (prev > 0 && bob.c.x <= 0) crossings.push(wd.time); prev = bob.c.x; });
    near((crossings[2] - crossings[0]) / 2, 2 * Math.PI * Math.sqrt(L / g), 0.01);
  });
  test('spring k = 400 N/m with 4 kg: static stretch mg/k and period 2π√(m/k) (within 2%)', () => {
    const w = world(), c = ceiling(w);
    const m = w.add(new P.Body({ position: { x: 0, y: 8 }, shapes: [P.circle(0.1)], mass: 4 }));
    const sp = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: m, length: 2, stiffness: 400, damping: 0 }));
    const ys = [], ts = [];
    w.run(4, 1 / 240, (wd) => { ys.push(m.c.y); ts.push(wd.time); });
    const mid = (Math.max(...ys) + Math.min(...ys)) / 2;
    near(10 - 2 - mid, 4 * g / 400, 0.02);
    const up = []; for (let i = 1; i < ys.length; i++) if (ys[i - 1] < mid && ys[i] >= mid) up.push(ts[i]);
    near((up[up.length - 1] - up[0]) / (up.length - 1), 2 * Math.PI * Math.sqrt(4 / 400), 0.02);
    ok(sp.force() > 0);
  });
  test('a rod swinging on a pin: period 2π√(2L/3g) (within 2%)', () => {
    const w = world(), c = ceiling(w), L = 2, th = 5 * Math.PI / 180;
    const pivot = { x: 0, y: 9.9 };
    const rod = w.add(new P.Body({ position: { x: pivot.x + (L / 2) * Math.sin(th), y: pivot.y - (L / 2) * Math.cos(th) }, angle: th, shapes: [P.box(0.02, L / 2)], mass: 10 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: c, bodyB: rod, worldAnchor: pivot }));
    const crossings = []; let prev = rod.angle;
    w.run(8, 1 / 240, (wd) => { if (prev > 0 && rod.angle <= 0) crossings.push(wd.time); prev = rod.angle; });
    near((crossings[2] - crossings[0]) / 2, 2 * Math.PI * Math.sqrt(2 * L / (3 * g)), 0.02);
  });
  test('a pin carries the weight it holds up', () => {
    const w = world(), c = ceiling(w);
    const bar = w.add(new P.Body({ position: { x: 0, y: 9 }, shapes: [P.box(0.05, 0.9)], mass: 30 }));
    const pin = w.addJoint(new P.RevoluteJoint({ bodyA: c, bodyB: bar, worldAnchor: { x: 0, y: 9.9 } }));
    w.run(2);
    near(pin.force(), 30 * g, 0.01);
  });
});

suite('physics: welds', () => {
  test('a welded cantilever holds its weight and carries the root moment', () => {
    const w = world();
    const wall = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.1, 1)] }));
    const arm = w.add(new P.Body({ position: { x: 1.1, y: 5 }, shapes: [P.box(1, 0.05)], mass: 20 }));
    const weld = w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0.1, y: 5 } }));
    w.run(2);
    ok(Math.abs(arm.angle) < 0.01, 'arm drooped by ' + arm.angle);
    near(weld.force(), 20 * g, 0.01);
    near(Math.abs(weld.torque()), 20 * g * 1.0, 0.02);  // weight acts 1 m from the weld
  });
  test('a weld rated below the root moment snaps on torque', () => {
    const w = world();
    const wall = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(0.1, 1)] }));
    const arm = w.add(new P.Body({ position: { x: 1.1, y: 5 }, shapes: [P.box(1, 0.05)], mass: 20 }));
    w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0.1, y: 5 }, breakTorque: 150 }));
    let e = null; w.on('break', x => { e = x; });
    w.run(1);
    ok(e && e.reason === 'torque', 'expected a torque break');
  });
});
