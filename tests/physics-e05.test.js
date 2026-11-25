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

suite('physics e05: line blocks (winch line, hook block and sling solved together)', () => {
  // H11's lift: an 18.3 t load (179.4 kN) on a sling under a hook block, the
  // line run from a drum at the jib foot over a sheave at the tip, 185 kN max pull.
  function jibLift(hookMass, maxPull) {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(30, 0.5)] }));
    const jib = w.add(new P.Body({ type: 'static', position: { x: -8, y: 0 }, shapes: [P.box(0.3, 0.3)] }));
    const tank = w.add(new P.Body({ position: { x: 0.2, y: 0.5 }, shapes: [P.box(1.5, 0.5)], mass: 179.4e3 / g, material: 'steel' }));
    const hook = w.add(new P.Body({ position: { x: 0.2, y: 2.5 }, shapes: [P.box(0.2, 0.2)], mass: hookMass, material: 'steel' }));
    const line = w.addJoint(new P.WinchJoint({ bodyA: jib, bodyB: hook, localAnchorB: { x: 0, y: 0.2 }, via: { body: jib, local: { x: 8.2, y: 17.35 } },
      reelSpeed: 0.5, maxPull: maxPull || 185e3, brake: true }));
    const sling = w.addJoint(new P.DistanceJoint({ bodyA: hook, localAnchorA: { x: 0, y: -0.2 }, bodyB: tank, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    return { w, tank, hook, line, sling };
  }
  [5, 10, 40, 200].forEach(m => test(m + ' kg hook block: 185 kN lifts the 18.3 t load at the reel speed; line − sling = hook weight (within 1%)', () => {
    // (185 − 179.4 − hook) kN on 18.3 t accelerates it to 0.5 m/s within
    // about 2 s; then it rises at 0.5 m/s: about 4 m in 10 s
    const { w, tank, hook, line, sling } = jibLift(m);
    w.run(10);
    ok(tank.c.y - 0.5 > 3.5, 'rose ' + (tank.c.y - 0.5).toFixed(3) + ' m');
    near(tank.v.y, 0.5, 0.01, 'speed');
    near(sling.tension(), 179.4e3, 0.01, 'sling = load weight');
    near(line.lineTension() - sling.tension(), m * g, 0.01, 'line − sling');
    ok(Math.abs(hook.angle) < 1e-6, 'hook block stays square: ' + hook.angle);
    ok(line.path.update() - line.lineOut() < 1e-3, 'line not stretched');
  }));
  test('a hook block too heavy to add to the load stalls the same winch', () => {
    const { w, tank, line } = jibLift(2000);   // 199 kN > 185 kN
    w.run(3);
    ok(tank.c.y - 0.5 < 0.01, 'lifted'); ok(line.stalled(), 'should stall');
  });
  test('a snatch (drum at speed at once, 1.8 MN pull) is what breakage sees (lastForce): the step\'s peak, not the settled pull', () => {
    // the load goes from rest to 0.5 m/s in one substep: m·Δv/h ≈ 9 kN·s / (1/240 s), capped at 1.81 MN
    const { w, sling } = jibLift(200, 1810e3);
    w.step(1 / 60);
    ok(sling.lastForce > 1e6, 'peak ' + sling.lastForce.toFixed(0));
    w.step(1 / 60);
    ok(sling.lastForce < 250e3, 'settled ' + sling.lastForce.toFixed(0));
  });
});

suite('physics e05: mixed chains hold their lengths', () => {
  // a fuzz-style hanging chain: links of 0.4 m on light nodes, a heavy load
  // at the bottom, dropped from straight and left to bounce for 10 s
  function chain(kinds, nodeMass, load, opts) {
    opts = opts || {};
    const w = world(), top = w.add(new P.Body({ type: 'static', position: { x: 0, y: 20 }, shapes: [P.box(0.5, 0.15)] }));
    let prev = top, anchor = { x: 0, y: -0.15 }, y = 19.85;
    const joints = [];
    kinds.forEach((kind, i) => {
      y -= 0.4;
      const b = w.add(new P.Body({ position: { x: opts.dx ? opts.dx * (i + 1) : 0.01 * Math.sin(i * 1.7), y }, shapes: [{ shape: P.circle(0.05), group: -7 }], mass: nodeMass }));
      const def = { bodyA: prev, bodyB: b, localAnchorA: anchor, localAnchorB: { x: 0, y: 0 } };
      if (kind === 'rope') def.rope = true;
      if (typeof kind === 'number') { def.stiffness = kind; def.damping = opts.damping || 0; }
      joints.push(w.addJoint(new P.DistanceJoint(def)));
      prev = b; anchor = { x: 0, y: 0 };
    });
    const crateBody = load ? w.add(new P.Body({ position: { x: prev.c.x, y: y - 0.6 }, shapes: [P.box(0.3, 0.3)], mass: load })) : null;
    if (crateBody) joints.push(w.addJoint(new P.DistanceJoint({ bodyA: prev, bodyB: crateBody, localAnchorB: { x: 0, y: 0.3 }, rope: true })));
    return { w, joints, load: crateBody };
  }
  function energy(w) {
    let E = 0;
    w.bodies.forEach(b => { if (b.type === 'dynamic') E += b.kineticEnergy() + b.m * g * b.c.y; });
    w.joints.forEach(j => { if (j.stiffness > 0) { const x = j.geometry().L - j.length; E += 0.5 * j.stiffness * x * x; } });
    return E;
  }
  function watch(w, joints, seconds) {
    let gap = 0, speed = 0;
    for (let s = 0; s < seconds * 60; s++) {
      w.step(1 / 60);
      joints.forEach(j => { if (!j.rope && !(j.stiffness > 0)) gap = Math.max(gap, Math.abs(j.geometry().L - j.length)); });
      w.bodies.forEach(b => { speed = Math.max(speed, Math.hypot(b.v.x, b.v.y)); });
    }
    return { gap, speed };
  }
  test('rods and ropes on 0.2 kg nodes under a 450 kg load bouncing on two soft springs: rods drift < 5 cm, nothing whips about', () => {
    // the load stretches the 1300 N/m spring by metres; at the bottom of
    // each bounce the rods above carry twice its weight (the light nodes'
    // sideways mode is then far stiffer than one substep can follow)
    const kinds = ['rope', 'rod', 'rod', 'rod', 'rod', 'rope', 'rod', 4000, 'rod', 'rod', 'rope', 'rod', 'rod', 'rod', 'rod', 1300, 'rod', 'rod', 'rope'];
    const { w, joints } = chain(kinds, 0.2, 450);
    const r = watch(w, joints, 10);
    ok(r.gap < 0.05, 'worst rod gap ' + (r.gap * 100).toFixed(1) + ' cm');
    ok(r.speed < 20, 'fastest body ' + r.speed.toFixed(1) + ' m/s');
  });
  test('a 25-link rod, rope and spring chain swinging with a 300 kg load: rods drift < 5 cm', () => {
    const kinds = [];
    for (let i = 0; i < 25; i++) kinds.push(['rod', 'rope', 'rod', 20000][i % 4]);
    const { w, joints } = chain(kinds, 0.3, 300, { dx: 0.15 });
    const r = watch(w, joints, 10);
    ok(r.gap < 0.05, 'worst rod gap ' + (r.gap * 100).toFixed(1) + ' cm');
  });
  test('stiff springs (2e5 N/m on 0.2 kg nodes) never gain energy: 10 undamped links with a 20 kg load, swinging', () => {
    const kinds = []; for (let i = 0; i < 10; i++) kinds.push(2e5);
    const { w } = chain(kinds, 0.2, 20, { dx: 0.2 });
    const E0 = energy(w);
    let Emax = E0;
    for (let s = 0; s < 600; s++) { w.step(1 / 60); Emax = Math.max(Emax, energy(w)); }
    ok(Emax <= E0 + 0.01 * Math.abs(E0) + 1, 'gained ' + (Emax - E0).toFixed(2) + ' J of ' + E0.toFixed(0));
  });
  test('soft springs mixed with stiff ones (200 to 2e5 N/m, light nodes) never gain energy', () => {
    const kinds = [2e5, 300, 'rod', 5e4, 'rope', 800, 2e5, 'rod', 1500, 2e5];
    const { w } = chain(kinds, 0.2, 50, { dx: 0.1, damping: 0 });
    const E0 = energy(w);
    let Emax = E0;
    for (let s = 0; s < 600; s++) { w.step(1 / 60); Emax = Math.max(Emax, energy(w)); }
    ok(Emax <= E0 + 0.01 * Math.abs(E0) + 1, 'gained ' + (Emax - E0).toFixed(2) + ' J of ' + E0.toFixed(0));
  });
  test('two slings side by side from one hook to one lifting eye share the load equally (within 1%)', () => {
    const w = world(), c = ceiling(w);
    const hook = w.add(new P.Body({ position: { x: 0, y: 8 }, shapes: [P.box(0.15, 0.15)], mass: 10 }));
    const load = crate(w, 0, 6, 2000);
    w.addJoint(new P.WinchJoint({ bodyA: c, bodyB: hook, localAnchorB: { x: 0, y: 0.15 }, brake: true }));
    const s1 = w.addJoint(new P.DistanceJoint({ bodyA: hook, localAnchorA: { x: 0, y: -0.15 }, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    const s2 = w.addJoint(new P.DistanceJoint({ bodyA: hook, localAnchorA: { x: 0, y: -0.15 }, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    w.run(2);
    near(s1.tension() + s2.tension(), 2000 * g, 0.01, 'total');
    near(s1.tension(), s2.tension(), 0.01, 'each');
  });
});

suite('physics e05: winch at its cap while paying out', () => {
  // the yard's case: a 2400 kg crate thrown up at 0.8 m/s under a winch
  // on a fixed hook, paying out at 0.03 m/s; the line is slack at first,
  // then snatches tight as the crate falls back
  function lower(pull) {
    const w = world();
    const hk = w.add(new P.Body({ type: 'static', position: { x: 0, y: 8 }, shapes: [P.box(0.2, 0.2)] }));
    const c = w.add(new P.Body({ position: { x: 0, y: 4 }, velocity: { x: 0, y: 0.8 }, shapes: [P.box(0.5, 0.5)], mass: 2400 }));
    const line = w.addJoint(new P.WinchJoint({ bodyA: hk, localAnchorA: { x: 0, y: -0.2 }, bodyB: c, localAnchorB: { x: 0, y: 0.5 }, reelSpeed: -0.03, maxPull: pull, brake: true }));
    return { w, c, line };
  }
  test('pull > weight (40 kN): catches the falling load and lowers it at the set speed, tension = weight (within 1%)', () => {
    const { w, c, line } = lower(40e3);
    w.run(1);
    near(c.v.y, -0.03, 0.02, 'vy after 1 s:');
    near(line.lineTension(), 2400 * g, 0.01, 'tension:');
  });
  test('pull < weight (20 kN): the load runs down at (W − pull)/m = 1.48 m/s², tension = pull, nowhere near free fall', () => {
    const { w, c, line } = lower(20e3);
    w.run(0.8);
    near(line.lineTension(), 20e3, 0.01, 'tension:');
    ok(c.v.y > -3, 'vy ' + c.v.y.toFixed(2) + ' (free fall would be ' + (-g * 0.8).toFixed(2) + ')');
    ok(line.slipping, 'slipping');
  });
});
