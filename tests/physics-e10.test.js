'use strict';
// Runtime layer: snapshots, JSON scenes and the fixed-step clock.
const { suite, test, eq, near, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;

function ground(w) {
  return w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(50, 0.5)], label: 'ground' }));
}

// A stack with warm-started contacts, a pendulum, and a welded shelf that a
// falling crate snaps at about t = 1.5 s (fall of 11 m: t = sqrt(2*11/g) = 1.50 s).
function busyWorld() {
  const w = new P.World({ gravity: { x: 0, y: -g } });
  const gr = ground(w);
  for (let i = 0; i < 4; i++) {
    w.add(new P.Body({ position: { x: -3, y: 0.5 + i * 1.0 }, shapes: [P.box(0.5, 0.5)], mass: 50, material: 'cargo' }));
  }
  const pivot = w.add(new P.Body({ type: 'static', position: { x: 6, y: 5 }, shapes: [P.circle(0.05)] }));
  const bob = w.add(new P.Body({ position: { x: 7.5, y: 5 }, shapes: [P.circle(0.2)], mass: 10 }));
  w.addJoint(new P.RevoluteJoint({ bodyA: pivot, bodyB: bob, localAnchorA: { x: 0, y: 0 }, localAnchorB: { x: -1.5, y: 0 } }));
  // shelf welded to a wall; crate lands near its free end
  const wall = w.add(new P.Body({ type: 'static', position: { x: 2, y: 2 }, shapes: [P.box(0.1, 2)] }));
  const shelf = w.add(new P.Body({ position: { x: 2.6, y: 3 }, shapes: [P.box(0.5, 0.05)], mass: 20 }));
  w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: shelf, worldAnchor: { x: 2.1, y: 3 }, breakTorque: 400, label: 'shelf weld' }));
  w.add(new P.Body({ position: { x: 2.9, y: 3.05 + 0.25 + 11 }, shapes: [P.box(0.25, 0.25)], mass: 100 }));
  return { w, gr };
}

function state(w) {
  return w.bodies.map(b => [b.c.x, b.c.y, b.angle, b.v.x, b.v.y, b.w]);
}
function sameExactly(a, b, what) {
  eq(a.length, b.length, what + ' body count');
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < a[i].length; k++) {
      if (a[i][k] !== b[i][k]) throw new Error(`${what}: body ${i} field ${k} differs: ${a[i][k]} vs ${b[i][k]}`);
    }
  }
}

suite('physics E10: snapshot / restore', () => {
  test('snapshot at 1 s, run 2 s, restore, run 2 s: bit-identical (stack, pendulum, breaking weld)', () => {
    const { w } = busyWorld();
    w.run(1);
    ok(w.contacts.size > 0, 'stack should have contacts to warm-start');
    const snap = P.snapshot(w);
    const t0 = w.time, n0 = w.stepCount, ev0 = w.events.length, joints0 = w.joints.length;
    w.run(2);
    const first = state(w), ev1 = w.events.length;
    ok(w.events.some(e => e.type === 'break'), 'the shelf weld should break in the replayed window');
    eq(w.joints.length, joints0 - 1, 'weld removed');
    P.restore(w, snap);
    eq(w.time, t0, 'time'); eq(w.stepCount, n0, 'stepCount');
    eq(w.events.length, ev0, 'event log'); eq(w.joints.length, joints0, 'broken weld is back');
    ok(!w.joints.some(j => j.broken), 'no joint flagged broken after restore');
    w.run(2);
    sameExactly(state(w), first, 'replay');
    eq(w.events.length, ev1, 'same events in the replay');
  });

  test('a snapshot can be restored more than once', () => {
    const { w } = busyWorld();
    w.run(0.5);
    const snap = P.snapshot(w);
    w.run(1); const a = state(w);
    P.restore(w, snap); w.run(1); const b = state(w);
    P.restore(w, snap); w.run(1); const c = state(w);
    sameExactly(a, b, 'second run'); sameExactly(a, c, 'third run');
  });

  test('restore removes bodies and joints added after the snapshot and brings back removed ones', () => {
    const { w } = busyWorld();
    const snap = P.snapshot(w), count = w.bodies.length;
    const extra = w.add(new P.Body({ position: { x: 20, y: 3 }, shapes: [P.box(0.5, 0.5)] }));
    const victim = w.bodies[1];
    w.remove(victim);
    P.restore(w, snap);
    ok(!w.bodies.includes(extra), 'extra body gone');
    ok(w.bodies.includes(victim), 'removed body back');
    eq(w.bodies.length, count);
  });

  test('fields created after the snapshot (peakForce, prevPose) are cleared on restore', () => {
    const { w } = busyWorld();
    const snap = P.snapshot(w);
    w.run(0.2);
    ok(w.joints[0].peakForce > 0, 'peakForce set by breakage');
    P.restore(w, snap);
    eq(w.joints[0].peakForce, undefined);
  });
});

suite('physics E10: JSON scenes', () => {
  function rigWorld() {
    const w = new P.World({ gravity: { x: 0, y: -g }, substeps: 4, contactHertz: 25 });
    ground(w);
    const anchor = w.add(new P.Body({ type: 'static', position: { x: 0, y: 6 }, shapes: [P.box(3, 0.1)], material: 'timber' }));
    const a = w.add(new P.Body({ position: { x: -2, y: 4 }, angle: 0.3, shapes: [P.box(0.3, 0.2, { x: 0.1, y: 0 })], mass: 30, material: 'steel', label: 'rod end', userData: { part: 'crate', id: 7 } }));
    const b = w.add(new P.Body({ position: { x: 0, y: 4 }, shapes: [{ shape: P.circle(0.25), material: 'rubber', friction: 0.8 }], velocity: { x: 1, y: 0 }, linearDamping: 0.1 }));
    const c = w.add(new P.Body({ position: { x: 2, y: 4 }, shapes: [P.box(0.25, 0.25)], material: 'cargo', angularVelocity: 2, gravityScale: 0.5 }));
    const d = w.add(new P.Body({ position: { x: 2.8, y: 4 }, shapes: [P.box(0.25, 0.25)], material: 'cargo' }));
    w.addJoint(new P.DistanceJoint({ bodyA: anchor, bodyB: a, localAnchorA: { x: -2, y: 0 }, localAnchorB: { x: 0, y: 0 }, breakForce: 1e6, label: 'rod' }));
    w.addJoint(new P.DistanceJoint({ bodyA: anchor, bodyB: b, localAnchorA: { x: 0, y: 0 }, localAnchorB: { x: 0, y: 0 }, stiffness: 2000, damping: 20 }));
    w.addJoint(new P.DistanceJoint({ bodyA: anchor, bodyB: c, localAnchorA: { x: 2, y: 0 }, localAnchorB: { x: 0, y: 0.25 }, rope: true, length: 2.2 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: -1, y: 4 }, collideConnected: true }));
    w.addJoint(new P.WeldJoint({ bodyA: c, bodyB: d, worldAnchor: { x: 2.5, y: 4 }, angularStiffness: 500, angularDamping: 5, breakTorque: 1e5 }));
    if (P.PulleyJoint) {
      const e = w.add(new P.Body({ position: { x: -4, y: 3 }, shapes: [P.circle(0.2)], mass: 12 }));
      const f = w.add(new P.Body({ position: { x: 4, y: 3 }, shapes: [P.circle(0.2)], mass: 8 }));
      w.addJoint(new P.PulleyJoint({ bodyA: e, bodyB: f, groundAnchorA: { x: -4, y: 7 }, groundAnchorB: { x: 4, y: 7 }, ratio: 1.5, EA: 1e5 }));
      w.addJoint(new P.WinchJoint({ bodyA: anchor, localAnchorA: { x: 1, y: 0 }, bodyB: f, via: { body: anchor, local: { x: 3, y: 0 } }, parts: 2, reelSpeed: 0.2, maxPull: 400, accel: 1 }));
    }
    return w;
  }

  test('scene covers every registered joint type in this build', () => {
    const types = new Set(rigWorld().joints.map(j => j.type));
    Object.keys(P.jointTypes).forEach(t => ok(types.has(t), 'test scene is missing joint type ' + t));
  });

  test('toScene -> JSON -> fromScene, 300 steps: same state within 1e-12', () => {
    const A = rigWorld();
    const json = JSON.stringify(P.toScene(A));
    const B = P.fromScene(json);
    eq(B.bodies.length, A.bodies.length); eq(B.joints.length, A.joints.length);
    for (let i = 0; i < 300; i++) { A.step(1 / 60); B.step(1 / 60); }
    const sa = state(A), sb = state(B);
    let worst = 0;
    sa.forEach((r, i) => r.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - sb[i][k])); }));
    ok(worst <= 1e-12, 'largest difference ' + worst);
    ok(sa.some(r => Math.abs(r[3]) + Math.abs(r[4]) > 0.01), 'scene should actually move');
  });

  test('scene keeps definitions: materials by name, overrides, labels, userData, settings', () => {
    const scene = JSON.parse(JSON.stringify(P.toScene(rigWorld())));
    eq(scene.version, P.SCENE_VERSION);
    eq(scene.cfg.contactHertz, 25);
    const B = P.fromScene(scene);
    eq(B.cfg.contactHertz, 25);
    const a = B.bodies[2], b = B.bodies[3];
    eq(a.label, 'rod end'); eq(a.userData.id, 7); eq(a.m, 30); eq(a.fixtures[0].material.name, 'steel');
    eq(b.fixtures[0].material.name, 'rubber'); eq(b.fixtures[0].friction, 0.8); eq(b.linearDamping, 0.1);
    eq(B.bodies[4].gravityScale, 0.5);
    eq(B.joints[0].breakForce, 1e6); eq(B.joints[0].label, 'rod');
    eq(B.joints[1].breakForce, Infinity, 'infinite limits come back as Infinity');
    ok(B.joints[2].rope); eq(B.joints[2].length, 2.2);
    ok(B.joints[3].collideConnected);
    eq(B.joints[4].angularStiffness, 500); eq(B.joints[4].breakTorque, 1e5);
    // a second round trip is a fixed point
    eq(JSON.stringify(P.toScene(B)), JSON.stringify(scene));
  });

  test('unknown joint types and versions throw clear errors', () => {
    const w = rigWorld();
    w.joints[0].type = 'teleporter';
    let msg = '';
    try { P.toScene(w); } catch (e) { msg = e.message; }
    ok(/teleporter/.test(msg), 'toScene error names the type: ' + msg);
    const scene = P.toScene(rigWorld());
    scene.joints[0].type = 'teleporter';
    msg = '';
    try { P.fromScene(scene); } catch (e) { msg = e.message; }
    ok(/teleporter/.test(msg), 'fromScene error names the type: ' + msg);
    msg = '';
    try { P.fromScene({ version: 99, bodies: [], joints: [] }); } catch (e) { msg = e.message; }
    ok(/version/.test(msg), msg);
  });

  test('joint modules can register a { ctor, fields } entry', () => {
    function Tether(def) { P.DistanceJoint.call(this, def); this.type = 'tether'; this.colour = def.colour || 'red'; }
    Tether.prototype = Object.create(P.DistanceJoint.prototype);
    P.jointTypes.tether = { ctor: Tether, fields: ['length', 'colour'] };
    try {
      const w = new P.World();
      const s = w.add(new P.Body({ type: 'static', shapes: [P.circle(0.1)] }));
      const b = w.add(new P.Body({ position: { x: 1, y: 0 }, shapes: [P.circle(0.1)] }));
      w.addJoint(new Tether({ bodyA: s, bodyB: b, colour: 'blue' }));
      const B = P.fromScene(JSON.stringify(P.toScene(w)));
      ok(B.joints[0] instanceof Tether); eq(B.joints[0].colour, 'blue'); eq(B.joints[0].length, 1);
    } finally { delete P.jointTypes.tether; }
  });
});

suite('physics E10: stepper', () => {
  function freshStepper(opts) {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    ground(w);
    const crate = w.add(new P.Body({ position: { x: 0, y: 5 }, shapes: [P.box(0.5, 0.5)], mass: 10 }));
    return { w, crate, st: new P.Stepper(w, opts) };
  }
  function feed(st, frames) { frames.forEach(f => st.advance(f)); }

  test('1 s of real time = exactly 60 steps with 7 ms frames', () => {
    const { w, st } = freshStepper();
    const frames = Array(142).fill(0.007).concat([0.006]);
    feed(st, frames);
    eq(w.stepCount, 60);
  });
  test('1 s of real time = exactly 60 steps with 33 ms frames', () => {
    const { w, st } = freshStepper();
    feed(st, Array(30).fill(0.033).concat([0.010]));
    eq(w.stepCount, 60);
  });
  test('10 s in uneven frames (5–40 ms) = exactly 600 steps', () => {
    const { w, st } = freshStepper({ maxSteps: 10 });
    let left = 10, seed = 1;
    while (left > 1e-12) {
      seed = (seed * 16807) % 2147483647;
      const f = Math.min(left, 0.005 + 0.035 * seed / 2147483647);
      st.advance(f); left -= f;
    }
    eq(w.stepCount, 600);
  });
  test('maxSteps caps catch-up and drops the rest', () => {
    const { w, st } = freshStepper({ maxSteps: 5 });
    eq(st.advance(1), 5); eq(w.stepCount, 5);
    ok(st.alpha >= 0 && st.alpha < 1, 'alpha ' + st.alpha);
    near(st.droppedTime + 5 / 60 + st.accumulator, 1, 1e-9);
    ok(st.accumulator < 1 / 60, 'only a partial step is kept');
    const n = st.advance(1 / 60);
    ok(n === 1 || n === 2, 'next normal frame takes one step (two if the kept part completes one): ' + n);
  });
  test('pause stops time; stepOnce still steps; resume continues', () => {
    const { w, st } = freshStepper();
    st.pause();
    eq(st.advance(0.5), 0); eq(w.time, 0);
    st.stepOnce(); eq(w.stepCount, 1);
    st.resume(); st.advance(1 / 60); eq(w.stepCount, 2);
  });
  test('timeScale: 0.5x gives 30 steps per second, 2x gives 120, clamped to 0.1..8', () => {
    let s = freshStepper(); s.st.timeScale = 0.5; feed(s.st, Array(60).fill(1 / 60)); eq(s.w.stepCount, 30);
    s = freshStepper(); s.st.timeScale = 2; feed(s.st, Array(60).fill(1 / 60)); eq(s.w.stepCount, 120);
    s.st.timeScale = 100; eq(s.st.timeScale, 8); s.st.timeScale = 0.001; eq(s.st.timeScale, 0.1);
  });
  test('8x fast-forward at 60 fps is not throttled by maxSteps', () => {
    const s = freshStepper({ maxSteps: 5 }); s.st.timeScale = 8;
    feed(s.st, Array(60).fill(1 / 60)); eq(s.w.stepCount, 480);
  });
  test('lerpPose blends the last step: alpha 0 = start pose, 1 = end pose', () => {
    const { crate, st } = freshStepper();
    st.advance(0.1);
    const y1 = crate.position.y, y0 = crate.prevPose.position.y;
    ok(y0 > y1, 'falling');
    near(P.lerpPose(crate, 0).position.y, y0, 1e-12);
    near(P.lerpPose(crate, 1).position.y, y1, 1e-12);
    near(P.lerpPose(crate, 0.5).position.y, (y0 + y1) / 2, 1e-12);
    crate.setTransform({ x: 3, y: 3 }, 0);
    eq(P.lerpPose(crate, 0).position.y, 3, 'moved body is drawn where it is');
  });
  test('runUntil: dropped crate hits the floor at t = sqrt(2h/g) within one step', () => {
    const { w, crate, st } = freshStepper();
    // bottom face starts 4.5 m above the floor: t = sqrt(9/9.81) = 0.958 s
    const landed = () => crate.c.y - 0.5 < P.LINEAR_SLOP;
    const r = st.runUntil(landed, { timeout: 3 });
    ok(r.ok, JSON.stringify(r)); eq(r.reason, 'done');
    const tPred = Math.sqrt(2 * 4.5 / g);
    ok(Math.abs(r.time - tPred) <= 1 / 60, `hit at ${r.time}, predicted ${tPred}`);
    eq(r.steps, w.stepCount);
  });
  test('runUntil times out cleanly and passes a reason string through', () => {
    const { w, st } = freshStepper();
    const r = st.runUntil(() => false, { timeout: 0.5 });
    ok(!r.ok); eq(r.reason, 'timeout'); eq(r.steps, 30); near(r.elapsed, 0.5, 1e-9);
    const r2 = st.runUntil(wd => wd.time > 0.6 && 'passed', { timeout: 1 });
    ok(r2.ok); eq(r2.reason, 'passed');
    ok(w.time > 0.6);
  });
  test('runUntil reports a diverged world', () => {
    const { crate, st } = freshStepper();
    crate.v = { x: NaN, y: 0 };
    const r = st.runUntil(() => false, { timeout: 1 });
    ok(!r.ok); eq(r.reason, 'diverged');
  });
});

// A loaded steel cantilever (50 x 100 mm, L = 2 m, M_y = σ_y·S = 20.8 kN·m)
// carrying 0.6 M_y at its tip, which a 300 kg crate dropped 11 m lands on at
// t = sqrt(2*11/g) = 1.50 s and snaps on moment. Plus a truss on a supplied
// ground body, and plain joints tied to structure bodies on both sides of
// the structures in the joint list.
function structureWorld() {
  const w = new P.World({ gravity: { x: 0, y: -g } });
  const gr = ground(w);
  const anchor = w.add(new P.Body({ type: 'static', position: { x: 4, y: 6 }, shapes: [P.box(0.2, 0.1)] }));
  const hang = w.add(new P.Body({ position: { x: 4, y: 4.5 }, shapes: [P.box(0.2, 0.2)], mass: 20 }));
  w.addJoint(new P.DistanceJoint({ bodyA: anchor, bodyB: hang, localAnchorB: { x: 0, y: 0.2 }, rope: true }));
  const bm = P.structures.beam(w, { start: { x: 0, y: 3 }, end: { x: 2, y: 3 }, section: { b: 0.05, h: 0.1 },
    material: 'steel', segments: 20, supports: [{ at: 'start', type: 'fixed' }], label: 'shelf' });
  bm.load(2, { x: 0, y: -0.6 * bm.limits.moment / 2 });
  w.add(new P.Body({ position: { x: 1.8, y: 3.05 + 0.25 + 11 }, shapes: [P.box(0.25, 0.25)], mass: 300, label: 'crate' }));
  const tr = P.structures.truss(w, { nodes: [{ x: 8, y: 0.2 }, { x: 10, y: 0.2 }, { x: 9, y: 1.9 }],
    members: [[0, 1], [1, 2], [2, 0]], material: 'steel', area: 4e-4, ground: gr,
    supports: [{ node: 0, type: 'pin' }, { node: 1, type: 'roller' }] });
  tr.load(2, { x: 0, y: -5000 });
  // a pendulum hung from a beam segment, added after the beam
  const bob = w.add(new P.Body({ position: { x: 1.0, y: 2.0 }, shapes: [P.circle(0.1)], mass: 5 }));
  w.addJoint(new P.RevoluteJoint({ bodyA: bm.bodies[10], bodyB: bob, worldAnchor: { x: 1.0, y: 3.0 } }));
  return { w, bm, tr };
}

suite('physics E10: structures in scenes and snapshots', () => {
  test('scene saves beams and trusses as definitions, not their parts', () => {
    const { w } = structureWorld();
    const scene = JSON.parse(JSON.stringify(P.toScene(w)));
    eq(scene.version, 2);
    eq(scene.structures.length, 2);
    eq(scene.structures[0].kind, 'beam'); eq(scene.structures[1].kind, 'truss');
    eq(scene.structures[0].ground, undefined, 'beam made its own ground');
    eq(scene.structures[1].ground, 0, 'truss ground is body 0');
    eq(scene.structures[0].loads.length, 1); eq(scene.structures[1].loads[0].node, 2);
    ok(scene.joints.every(j => j.structure != null || j.type !== 'structure'), 'no solver in the joint list');
    eq(scene.joints.filter(j => j.structure != null).length, 2, 'one placeholder per structure');
    eq(scene.bodies.filter(b => b.structure === 0).length, 21, '20 segments + own ground');
    eq(scene.bodies.filter(b => b.structure === 1).length, 6, '3 nodes + 3 members');
  });

  test('beam + truss scene round trip, 300 steps: same state within 1e-12, and a fixed point', () => {
    const A = structureWorld().w;
    const json = JSON.stringify(P.toScene(A));
    const B = P.fromScene(json);
    eq(B.bodies.length, A.bodies.length); eq(B.joints.length, A.joints.length);
    eq(B.structures.length, 2);
    eq(JSON.stringify(P.toScene(B)), json, 'second toScene is identical');
    for (let i = 0; i < 300; i++) { A.step(1 / 60); B.step(1 / 60); }
    const sa = state(A), sb = state(B);
    let worst = 0;
    sa.forEach((r, i) => r.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - sb[i][k])); }));
    ok(worst <= 1e-12, 'largest difference ' + worst);
    const bA = A.events.filter(e => e.type === 'break').length, bB = B.events.filter(e => e.type === 'break').length;
    ok(bA > 0, 'the beam should snap within 5 s'); eq(bB, bA, 'same breaks after loading');
  });

  test('version 1 scenes (no structures) still load', () => {
    const w = new P.World();
    const s0 = w.add(new P.Body({ type: 'static', shapes: [P.circle(0.1)] }));
    const b = w.add(new P.Body({ position: { x: 1, y: 0 }, shapes: [P.circle(0.1)] }));
    w.addJoint(new P.DistanceJoint({ bodyA: s0, bodyB: b }));
    const scene = P.toScene(w);
    scene.version = 1; delete scene.structures;
    const B = P.fromScene(JSON.stringify(scene));
    eq(B.bodies.length, 2); eq(B.joints.length, 1); eq(B.joints[0].length, 1);
  });

  test('snapshot at 1 s, run 2 s (beam snaps on moment at 1.5 s), restore, run 2 s: bit-identical', () => {
    const { w, bm } = structureWorld();
    w.run(1);
    ok(!w.events.some(e => e.type === 'break'), 'nothing broken before the snapshot');
    const snap = P.snapshot(w);
    const joints0 = w.joints.length;
    w.run(2);
    const first = state(w), ev = w.events.filter(e => e.type === 'break');
    ok(ev.length > 0 && ev[0].reason === 'moment', 'beam should break on moment: ' + ev.map(e => e.reason));
    ok(w.joints.length < joints0, 'links removed');
    P.restore(w, snap);
    eq(w.joints.length, joints0, 'links back');
    ok(bm.links.every(l => !l || !l.broken), 'no link flagged broken');
    eq(bm.loads.length, 1);
    w.run(2);
    sameExactly(state(w), first, 'replay');
    eq(w.events.filter(e => e.type === 'break').length, ev.length, 'same breaks in the replay');
  });

  test('a load handle kept by the level still drives the beam after restore', () => {
    const { w, bm } = structureWorld();
    const ld = bm.loads[0];
    const snap = P.snapshot(w);
    w.run(0.5);
    P.restore(w, snap);
    ok(bm.loads[0] === ld, 'same load object');
  });
});
