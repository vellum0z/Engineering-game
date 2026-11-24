'use strict';
// Rigging: ropes, pulleys, block and tackle, winches and cables, checked
// against the closed-form results a statics or dynamics course uses.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;

function world() { return new P.World({ gravity: { x: 0, y: -g } }); }
function ceiling(w, y) { return w.add(new P.Body({ type: 'static', position: { x: 0, y: y == null ? 10 : y }, shapes: [P.box(3, 0.1)] })); }
function weight(w, x, y, m, r) { return w.add(new P.Body({ position: { x: x, y: y }, shapes: [P.circle(r || 0.2)], mass: m })); }
function crate(w, x, y, m) { return w.add(new P.Body({ position: { x: x, y: y }, shapes: [P.box(0.5, 0.5)], mass: m, material: 'cargo' })); }

suite('physics e05: distance joint limits, motor and stretch', () => {
  test('rope with EA: static stretch δ = mgL/(EA) (within 2%)', () => {
    // 100 kg on 4 m of line with EA = 2e5 N: δ = 981·4/2e5 = 19.6 mm
    const w = world(), c = ceiling(w), m = 100, L = 4, EA = 2e5;
    const load = weight(w, 0, 10 - L, m);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, rope: true, EA: EA, length: L, dampingRatio: 1 }));
    w.run(3);
    near(rope.currentLength() - L, m * g * L / EA, 0.02);
    near(rope.tension(), m * g, 0.005);
  });
  test('a stretchy rope is still slack-free below its length: no tension, no push', () => {
    const w = world(), c = ceiling(w);
    const load = weight(w, 0, 6, 10);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, rope: true, EA: 1e5, length: 6 }));
    w.run(0.3);
    near(rope.tension(), 0, 1e-9); ok(rope.isSlack());
  });
  test('maxLength stops a free-swinging bar at its tether length (within 1%)', () => {
    const w = world(), c = ceiling(w);
    const load = weight(w, 0, 8, 5);
    const j = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, length: 2, minLength: 0.5, maxLength: 3, hertz: 0.0001 }));
    w.run(3);
    near(10 - load.c.y, 3, 0.01);
    near(j.tension(), 5 * g, 0.01);
  });
  test('minLength holds a strut apart under a load', () => {
    const w = world(), floor = w.add(new P.Body({ type: 'static', position: { x: 0, y: 0 }, shapes: [P.box(3, 0.1)] }));
    const top = weight(w, 0, 2, 20);
    const j = w.addJoint(new P.DistanceJoint({ bodyA: floor, bodyB: top, minLength: 1.5, maxLength: 4, hertz: 0.0001 }));
    w.run(3);
    near(top.c.y, 1.5, 0.01);
    near(j.tension(), -20 * g, 0.01);     // compression
  });
  test('setLength shortens a rope and lifts the load', () => {
    const w = world(), c = ceiling(w), load = weight(w, 0, 6, 50);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, rope: true }));
    w.run(0.5); rope.setLength(3); w.run(3);
    near(10 - load.c.y, 3, 0.01);
  });
  test('length motor reels at motorSpeed and stalls at maxMotorForce', () => {
    // a motor rated 1500 N lifts 100 kg (981 N) at 0.4 m/s; one rated 800 N can't
    [[1500, true], [800, false]].forEach(([Fm, lifts]) => {
      const w = world(), c = ceiling(w), load = weight(w, 0, 6, 100);
      const j = w.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: load, minLength: 0, maxLength: 10, hertz: 0.0001, motorSpeed: -0.4, maxMotorForce: Fm }));
      const y0 = load.c.y; w.run(1);
      if (lifts) { near(load.v.y, 0.4, 0.01); near(j.tension(), 100 * g, 0.01); }
      else { ok(load.c.y < y0, 'should be pulled down: ' + load.c.y); near(j.tension(), Fm, 0.01); }
    });
  });
});

suite('physics e05: pulleys and block and tackle', () => {
  test('Atwood machine 12 kg / 8 kg: a = (m1−m2)g/(m1+m2), T = 2m1m2g/(m1+m2) (within 1%)', () => {
    // a = 4/20 g = 1.962 m/s², T = 192/20 g = 94.18 N
    const w = world(), m1 = 12, m2 = 8;
    const A = weight(w, -0.5, 6, m1), B = weight(w, 0.5, 6, m2);
    const pj = w.addJoint(new P.PulleyJoint({ bodyA: A, bodyB: B, groundAnchorA: { x: -0.5, y: 10 }, groundAnchorB: { x: 0.5, y: 10 } }));
    const t = 1; w.run(t);
    const a = (m1 - m2) * g / (m1 + m2);
    near(6 - A.c.y, 0.5 * a * t * t, 0.01, 'm1 drop');
    near(B.c.y - 6, 0.5 * a * t * t, 0.01, 'm2 rise');
    near(pj.tensionA(), 2 * m1 * m2 * g / (m1 + m2), 0.01);
    near(pj.tensionB(), pj.tensionA(), 1e-9);
  });
  test('pulley ratio 2: T_B = 2 T_A and the lighter side balances twice its weight', () => {
    // 2 kg on side A balances 4 kg on side B when lA + 2 lB = const
    const w = world();
    const A = weight(w, -1, 6, 4), B = weight(w, 1, 6, 2);
    const pj = w.addJoint(new P.PulleyJoint({ bodyA: B, bodyB: A, groundAnchorA: { x: 1, y: 10 }, groundAnchorB: { x: -1, y: 10 }, ratio: 2 }));
    w.run(2);
    near(pj.tensionA(), 2 * g, 0.01); near(pj.tensionB(), 4 * g, 0.01);
    ok(Math.abs(A.v.y) < 1e-3 && Math.abs(B.v.y) < 1e-3, 'should balance');
  });
  test('each side of a pulley only pulls: a resting side goes slack', () => {
    const w = world();
    const floor = w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(5, 0.5)] }));
    const A = weight(w, -1, 0.2, 10), B = weight(w, 1, 0.2, 10);
    const pj = w.addJoint(new P.PulleyJoint({ bodyA: A, bodyB: B, groundAnchorA: { x: -1, y: 5 }, groundAnchorB: { x: 1, y: 5 }, length: 10 }));
    w.run(1);
    near(pj.tensionA(), 0, 1e-6); void floor;
  });
  test('block and tackle n = 4 held by a braked winch: line tension = W/4 (within 2%)', () => {
    const w = world(), c = ceiling(w), m = 400;
    const hookBlock = crate(w, 0, 6, m);
    const drum = w.add(new P.Body({ type: 'static', position: { x: 2, y: 9 }, shapes: [P.circle(0.15)] }));
    const wj = P.pulley.tackle(w, { block: { body: c, localAnchor: { x: 0, y: -0.1 } }, load: { body: hookBlock, localAnchor: { x: 0, y: 0.5 } }, n: 4,
      winch: { body: drum, brake: true } });
    w.run(2);
    near(wj.lineTension(), m * g / 4, 0.02);
    near(wj.hookForce(), m * g, 0.02);
    near(wj.mechanicalAdvantage, 4, 0);
  });
  test('block and tackle n = 4 lifting at constant speed: line tension W/4, load rises at 1/4 line speed (within 2%)', () => {
    const w = world(), c = ceiling(w), m = 400;
    const hookBlock = crate(w, 0, 5, m);
    const drum = w.add(new P.Body({ type: 'static', position: { x: 2, y: 9 }, shapes: [P.circle(0.15)] }));
    const wj = P.pulley.tackle(w, { block: { body: c, localAnchor: { x: 0, y: -0.1 } }, load: { body: hookBlock, localAnchor: { x: 0, y: 0.5 } }, n: 4,
      winch: { body: drum, reelSpeed: 0.8, accel: 2 } });
    w.run(1.5);
    near(hookBlock.v.y, 0.2, 0.02);
    near(wj.lineTension(), m * g / 4, 0.02);
  });
  test('tackle with a hauling body: 4 parts let 25 kg hold 100 kg', () => {
    const w = world(), c = ceiling(w);
    const load = weight(w, 0, 6, 100, 0.3), counter = weight(w, 0, 3, 25);
    const pj = P.pulley.tackle(w, { block: { body: null, localAnchor: { x: 0, y: 9.9 } }, load: { body: load }, haul: { body: counter }, n: 4 });
    w.run(2);
    ok(Math.abs(load.v.y) < 1e-3 && Math.abs(counter.v.y) < 1e-3, 'should balance');
    near(pj.tensionA(), 25 * g, 0.01); near(pj.tensionB(), 100 * g, 0.01); void c;
  });
});

suite('physics e05: winches', () => {
  function rig(opts) {
    const w = world(), c = ceiling(w), m = 250;
    const load = crate(w, 0, 6, m);
    const wj = w.addJoint(new P.WinchJoint(Object.assign({ bodyA: c, localAnchorA: { x: 0, y: -0.1 }, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, brake: true }, opts)));
    return { w, load, wj, m };
  }
  test('winch lifting 250 kg: T = m(g + a) during the ramp, mg at 0.5 m/s (within 1%)', () => {
    // ramp 1 m/s² for 0.5 s: T = 250·10.81 = 2702.5 N; then 250·9.81 = 2452.5 N
    const { w, load, wj, m } = rig({});
    w.run(0.5);
    wj.reelSpeed = 0.5; wj.accel = 1;
    w.run(0.25);
    near(wj.lineTension(), m * (g + 1), 0.01, 'ramp');
    w.run(1);
    near(load.v.y, 0.5, 0.01, 'speed');
    near(wj.lineTension(), m * g, 0.01, 'constant speed');
    near(wj.drumTorque(0.2), m * g * 0.2, 0.01, 'drum torque');
  });
  test('line out shrinks by reelSpeed·t', () => {
    const { w, wj } = rig({ reelSpeed: 0.5 });
    const L0 = wj.lineOut(); w.run(2);
    near(L0 - wj.lineOut(), 1, 0.01);
  });
  test('stalls when maxPull < mg: no lift, tension = maxPull', () => {
    const { w, load, wj } = rig({ reelSpeed: 0.5, maxPull: 2000 });
    const y0 = load.c.y; w.run(1);
    ok(load.c.y < y0, 'load should not rise: ' + load.c.y);
    ok(wj.stalled(), 'should report stalled');
    near(wj.lineTension(), 2000, 0.01);
  });
  test('brake holds the load when stopped; a weak brake slips', () => {
    const strong = rig({ maxPull: 1000, brakeForce: 5000 });
    const y0 = strong.load.c.y; strong.w.run(3);
    ok(Math.abs(strong.load.c.y - y0) < 0.01, 'held: moved ' + (strong.load.c.y - y0));
    near(strong.wj.lineTension(), strong.m * g, 0.01);
    const weak = rig({ brakeForce: 1500 });
    const y1 = weak.load.c.y; weak.w.run(1);
    ok(weak.load.c.y < y1 - 0.5, 'should slip: ' + (weak.load.c.y - y1));
    near(weak.wj.lineTension(), 1500, 0.01);
  });
  test('paying out lowers the load at the line speed', () => {
    const { w, load, wj } = rig({ reelSpeed: -0.5 });
    w.run(1);
    near(load.v.y, -0.5, 0.01); ok(wj.lineTension() > 0);
  });
  test('winch line snaps over its breakForce and the load falls', () => {
    const { w, load, wj } = rig({ reelSpeed: 0.5, accel: 5, breakForce: 2600 });
    let broke = null; w.on('break', e => { broke = e; });
    w.run(1.5);
    ok(broke && broke.joint === wj, 'line should snap');
    ok(load.v.y < -1, 'load should fall: ' + load.v.y);
  });
});

suite('physics e05: cables and chains', () => {
  function posts(w, span, y) {
    return [-span / 2, span / 2].map(x => w.add(new P.Body({ type: 'static', position: { x: x, y: y }, shapes: [P.box(0.1, 0.1)] })));
  }
  test('catenary helper: a long-span limit matches the parabola sag = wS²/(8H)', () => {
    const c = P.cable.catenary(100, 100.5, 10);
    near(c.sag, 10 * 100 * 100 / (8 * c.H), 0.01);
  });
  test('cable of 20 links between two posts: mid-span sag and end tension match the catenary (within 5%)', () => {
    // 11 m of 12 mm steel cable (0.888 kg/m) over a 10 m span: catenary sag ≈ 2.06 m
    const w = world(), span = 10, length = 11;
    const [a, b] = posts(w, span, 8);
    const cab = P.cable.build(w, { from: { body: a }, to: { body: b }, length: length, segments: 20, material: 'steel', diameter: 0.012, linearDamping: 2 });
    w.run(8);
    const wpl = cab.massPerLength * g;
    const cat = P.cable.catenary(span, length, wpl);
    const mid = (cab.bodies[9].c.y + cab.bodies[10].c.y) / 2;
    const low = Math.min(...cab.bodies.map(n => n.c.y));
    near(8 - low, cat.sag, 0.05, 'sag');
    ok(Math.abs(mid - low) < 0.05, 'lowest point at mid-span');
    near(cab.tensionAt(0), cat.Tmax, 0.05, 'end tension');
    near(cab.tensionAt(19), cat.Tmax, 0.05, 'other end');
    ok(cab.tensionAt(10) < cab.tensionAt(0), 'tension is least at mid-span');
  });
  test('a chain does not collide with itself but drapes on the ground', () => {
    const w = world();
    const floor = w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(10, 0.5)] }));
    const [a, b] = posts(w, 2, 1);
    const cab = P.cable.build(w, { from: { body: a }, to: { body: b }, length: 6, segments: 12, material: 'steel', diameter: 0.02,
      path: [{ x: -2, y: 0.5 }, { x: 2, y: 0.5 }] });
    w.run(4);
    ok(cab.bodies.every(n => n.c.y > 0), 'stays above the ground');
    ok(cab.bodies.some(n => n.c.y < 0.05), 'lies on the ground'); void floor;
  });
  test('an overloaded cable snaps at its weakest link, the break event names it, and the load falls', () => {
    const w = world(), c = ceiling(w);
    const load = crate(w, 0, 5, 200);
    const cab = P.cable.build(w, { from: { body: c, localAnchor: { x: 0, y: -0.1 } }, to: { body: load, localAnchor: { x: 0, y: 0.5 } },
      segments: 8, massPerLength: 2, EA: 5e5, breakForce: i => (i === 5 ? 1500 : 3000), label: 'hoist cable' });
    const breaks = []; w.on('break', e => breaks.push(e));
    w.run(2);
    ok(breaks.length >= 1, 'should snap');
    near(breaks[0].joint.userData.link, 5, 0, 'weakest link');
    ok(breaks[0].joint.label === 'hoist cable link 5', breaks[0].joint.label);
    ok(!cab.intact());
    ok(load.c.y < 2, 'load should fall: ' + load.c.y);
  });
  test('a cable rated above the load holds it: tension = load + cable weight below each link (within 2%, mean of the 10th second)', () => {
    // 200 kg on 4.4 m of 2 kg/m cable in 8 links: the top link carries the
    // load plus 7 of the 8 link masses (the nodes below it), the bottom link
    // only the load. A 200 kg load on 1.1 kg nodes is a 180:1 mass ratio, so
    // the load bobs on the link constraints for a few seconds before settling.
    const w = world(), c = ceiling(w);
    const load = crate(w, 0, 5, 200);
    const cab = P.cable.build(w, { from: { body: c, localAnchor: { x: 0, y: -0.1 } }, to: { body: load, localAnchor: { x: 0, y: 0.5 } },
      segments: 8, massPerLength: 2, EA: 5e5, breakForce: 5000 });
    let top = 0, bottom = 0, n = 0;
    w.run(10, 1 / 60, wd => { if (wd.time > 9) { top += cab.tensionAt(0); bottom += cab.tensionAt(7); n++; } });
    ok(cab.intact());
    const L = cab.length;
    near(top / n, 200 * g + 2 * L * g * 7 / 8, 0.02, 'top link');
    near(bottom / n, 200 * g, 0.02, 'bottom link');
    ok(cab.weakest() === 0, 'top link is nearest its rating');
  });
});

suite('physics e05: rigging in free-body diagrams and saved scenes', () => {
  test('pulley reactionOn: each hanging mass feels T straight up along its rope', () => {
    const w = world(), m1 = 12, m2 = 8;
    const A = weight(w, -0.5, 6, m1), B = weight(w, 0.5, 6, m2);
    const pj = w.addJoint(new P.PulleyJoint({ bodyA: A, bodyB: B, groundAnchorA: { x: -0.5, y: 10 }, groundAnchorB: { x: 0.5, y: 10 } }));
    w.run(0.5);
    const T = 2 * m1 * m2 * g / (m1 + m2), ra = pj.reactionOn(A), rb = pj.reactionOn(B);
    near(ra.force.y, T, 0.01); near(rb.force.y, T, 0.01);
    ok(Math.abs(ra.force.x) < 1e-9 && ra.torque === 0);
    near(ra.point.y, A.c.y, 1e-9);
  });
  test('winch with a 2-part tackle over a sheave: the crane carries the line pull at the drum and both falls at the sheave', () => {
    // load 100 kg on 2 falls: T = 490.5 N. The run from drum (2, 9.9) to sheave
    // (0, 9.9) pulls the drum toward the sheave with T and the sheave toward
    // the drum with T, which cancel; the two falls pull the sheave down by 2T.
    // Resultant on the crane: (0, -2T).
    const w = world(), c = ceiling(w), m = 100;
    const load = weight(w, 0, 6, m);
    const wj = w.addJoint(new P.WinchJoint({ bodyA: c, localAnchorA: { x: 2, y: -0.1 }, bodyB: load, via: { body: c, local: { x: 0, y: -0.1 } }, parts: 2, brake: true }));
    w.run(1);
    const T = m * g / 2, r = wj.reactionOn(c), rl = wj.reactionOn(load);
    near(wj.lineTension(), T, 0.01);
    near(r.force.y, -2 * T, 0.01); ok(Math.abs(r.force.x) < 1e-6 * T, 'drum and sheave pulls cancel in x');
    near(rl.force.y, 2 * T, 0.01);
  });
  test('snapshot mid-lift and restore: the winch replays exactly', () => {
    const w = world(), c = ceiling(w), load = crate(w, 0, 6, 250);
    const wj = w.addJoint(new P.WinchJoint({ bodyA: c, localAnchorA: { x: 0, y: -0.1 }, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, reelSpeed: 0.5, accel: 1 }));
    w.run(0.3);
    const snap = P.snapshot(w);
    w.run(0.5); const y1 = load.c.y, L1 = wj.lineOut();
    P.restore(w, snap); w.run(0.5);
    ok(load.c.y === y1 && wj.lineOut() === L1, 'replay differs');
  });
});
