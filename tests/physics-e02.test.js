'use strict';
// Broadphase, filtering, contact/sensor events and sleeping.
const { suite, test, near, ok, eq } = require('./harness');
const P = globalThis.SE.phys;
const M = globalThis.SE.pmath;
const g = 9.81;

function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g } }, opts || {})); }
function ground(w, opts) {
  return w.add(new P.Body(Object.assign({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(60, 0.5)] }, opts || {})));
}
function crate(w, x, y, m, opts) {
  return w.add(new P.Body(Object.assign({ position: { x: x, y: y }, shapes: [P.box(0.5, 0.5)], mass: m, material: 'cargo' }, opts || {})));
}
// Small deterministic PRNG so failures reproduce.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// The rebuild-every-step sort-and-sweep this module replaced, kept here only
// as the baseline for the speed test.
function legacyUpdate(world) {
  const items = [], pad = P.SPECULATIVE;
  world.bodies.forEach(b => {
    const t = b.transform();
    b.fixtures.forEach((f, i) => {
      const bb = P.aabb(f.shape, t);
      items.push({ f, b, key: b.id + ':' + i, t, lo: M.v(bb.lo.x - pad, bb.lo.y - pad), hi: M.v(bb.hi.x + pad, bb.hi.y + pad) });
    });
  });
  items.sort((a, b) => a.lo.x - b.lo.x);
  const next = new Map();
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const B = items[j];
      if (B.lo.x > A.hi.x) break;
      if (B.lo.y > A.hi.y || B.hi.y < A.lo.y) continue;
      if (A.b === B.b || (A.b.type !== 'dynamic' && B.b.type !== 'dynamic')) continue;
      if (A.f.sensor || B.f.sensor || world.jointed(A.b, B.b)) continue;
      const first = A.b.id < B.b.id ? A : B, second = first === A ? B : A;
      const man = P.collide(first.f.shape, first.t, second.f.shape, second.t);
      if (!man) continue;
      const key = first.key + '|' + second.key, old = world.contacts.get(key);
      const points = man.points.map(p => {
        const cp = { point: p.point, separation: p.separation, id: p.id, normalImpulse: 0, tangentImpulse: 0 };
        if (old) old.points.forEach(o => { if (o.id === p.id) { cp.normalImpulse = o.normalImpulse; cp.tangentImpulse = o.tangentImpulse; } });
        return cp;
      });
      const ct = { key, fa: first.f, fb: second.f, manifold: man, points, touching: man.points.some(p => p.separation < P.LINEAR_SLOP) };
      ct.isNew = !old || !old.touching;
      next.set(key, ct);
    }
  }
  world.contacts = next;
}

// Every fixture pair the brute force says should be considered: padded boxes
// overlap and the filter allows it. Returns { pairs: Set, contacts: Set }.
function bruteForce(w) {
  const fx = [];
  w.bodies.forEach(b => {
    const t = b.transform();
    b.fixtures.forEach((f, i) => {
      const bb = P.aabb(f.shape, t), pad = P.SPECULATIVE;
      fx.push({ f, b, t, key: b.id + ':' + i, lx: bb.lo.x - pad, ly: bb.lo.y - pad, ux: bb.hi.x + pad, uy: bb.hi.y + pad });
    });
  });
  const pairs = new Set(), contacts = new Set();
  for (let i = 0; i < fx.length; i++) for (let j = i + 1; j < fx.length; j++) {
    const A = fx[i], B = fx[j];
    if (A.lx > B.ux || A.ux < B.lx || A.ly > B.uy || A.uy < B.ly) continue;
    if (!P.broadphase.shouldCollide(w, A.f, B.f)) continue;
    const first = A.b.id < B.b.id ? A : B, second = first === A ? B : A;
    const key = first.key + '|' + second.key;
    pairs.add(key);
    if (P.collide(first.f.shape, first.t, second.f.shape, second.t)) contacts.add(key);
  }
  return { pairs, contacts };
}

function time(fn, reps) {
  fn();                                          // warm up the JIT
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / reps;
}

suite('physics E02: dynamic AABB tree', () => {
  test('stays balanced and consistent through 2000 random inserts, moves and removals', () => {
    const tree = new P.DynamicTree(), r = rng(7), live = [];
    for (let i = 0; i < 2000; i++) {
      const op = r();
      if (op < 0.5 || live.length < 10) {
        const x = r() * 100, y = r() * 100, s = 0.2 + r() * 2;
        live.push(tree.createProxy(x, y, x + s, y + s, { i }));
      } else if (op < 0.8) {
        const id = live[Math.floor(r() * live.length)], x = r() * 100, y = r() * 100;
        tree.moveProxy(id, x, y, x + 1, y + 1);
      } else {
        const k = Math.floor(r() * live.length);
        tree.destroyProxy(live[k]); live.splice(k, 1);
      }
    }
    eq(tree.validate(), live.length, 'leaf count');
    // AVL balance keeps height within 1.44 log2(n) + 2
    ok(tree.height() <= 1.44 * Math.log2(live.length) + 2, 'height ' + tree.height() + ' for ' + live.length + ' leaves');
  });

  test('a box query returns exactly the overlapping leaves', () => {
    const tree = new P.DynamicTree(), r = rng(11), boxes = [];
    for (let i = 0; i < 300; i++) {
      const x = r() * 50, y = r() * 50, s = r() * 3;
      const b = { lx: x, ly: y, ux: x + s, uy: y + s };
      b.id = tree.createProxy(b.lx, b.ly, b.ux, b.uy, b);
      boxes.push(b);
    }
    for (let q = 0; q < 50; q++) {
      const x = r() * 50, y = r() * 50, qb = { lx: x, ly: y, ux: x + 5, uy: y + 5 };
      const got = new Set(); tree.query(qb.lx, qb.ly, qb.ux, qb.uy, d => got.add(d));
      const want = boxes.filter(b => !(b.lx > qb.ux || b.ux < qb.lx || b.ly > qb.uy || b.uy < qb.ly));
      eq(got.size, want.length, 'query ' + q);
      want.forEach(b => ok(got.has(b), 'missed a leaf'));
    }
  });
});

suite('physics E02: broadphase pairs', () => {
  test('pair set covers the brute-force O(n²) box check on 300 moving bodies for 120 steps, and contacts match it exactly', () => {
    const w = world(), r = rng(3);
    ground(w);
    w.add(new P.Body({ type: 'static', position: { x: -16, y: 10 }, shapes: [P.box(0.5, 12)] }));
    w.add(new P.Body({ type: 'static', position: { x: 16, y: 10 }, shapes: [P.box(0.5, 12)] }));
    for (let i = 0; i < 300; i++) {
      const shape = i % 4 === 3 ? P.circle(0.2 + r() * 0.3) : P.box(0.15 + r() * 0.35, 0.15 + r() * 0.35);
      w.add(new P.Body({ position: { x: -14 + r() * 28, y: 0.6 + r() * 25 }, angle: r() * 6,
        velocity: { x: (r() - 0.5) * 8, y: (r() - 0.5) * 8 }, angularVelocity: (r() - 0.5) * 4, shapes: [shape] }));
    }
    let checked = 0;
    for (let s = 0; s < 120; s++) {
      w.step(1 / 60);
      P.broadphase.update(w);                 // pairs for the positions we now compare against
      const bf = bruteForce(w), mine = new Set(P.broadphase.pairs(w));
      bf.pairs.forEach(k => { if (!mine.has(k)) throw new Error('step ' + s + ': missing pair ' + k); });
      const cts = new Set(w.contacts.keys());
      eq(cts.size, bf.contacts.size, 'step ' + s + ' contact count');
      bf.contacts.forEach(k => ok(cts.has(k), 'step ' + s + ': missing contact ' + k));
      checked += bf.pairs.size;
    }
    ok(checked > 1000, 'scene too sparse to be a test: ' + checked);
  });

  test('impulses carry over by feature id between steps (warm starting)', () => {
    const w = world(); ground(w); const b = crate(w, 0, 0.5, 100);
    w.run(1);
    const ct = Array.from(w.contacts.values())[0];
    const before = ct.points.map(p => p.normalImpulse);
    b.wake(); b.applyImpulse({ x: 0, y: 0 });
    P.broadphase.update(w);
    const after = w.contacts.get(ct.key).points.map(p => p.normalImpulse);
    ok(before.length === 2 && before[0] > 0, 'no resting impulse');
    before.forEach((v, i) => near(after[i], v, 1e-12));
  });

  test('500 resting boxes: broadphase + narrowphase at least 1.5× faster (timing, kept loose for busy CI) than the per-step rebuild', () => {
    function scene(opts) {
      const w = world(opts); ground(w);
      for (let c = 0; c < 100; c++) for (let k = 0; k < 5; k++) crate(w, -50 + c * 1.05, 0.5 + k, 20);
      w.run(3);
      return w;
    }
    const wMine = scene(), wOld = scene({}), wAwake = scene();
    wAwake.cfg.enableSleep = false; wAwake.bodies.forEach(b => b.wake()); wAwake.step(1 / 60);
    ok(wMine.bodies.every(b => b.type === 'static' || b.awake === false), 'scene did not settle to sleep');
    const tMine = time(() => P.broadphase.update(wMine), 300);
    const tAwake = time(() => P.broadphase.update(wAwake), 100);
    const tOld = time(() => legacyUpdate(wOld), 100);
    console.log('    E02 bench, 500 resting boxes: rebuild ' + tOld.toFixed(3) + ' ms, tree (asleep) ' + tMine.toFixed(3) +
      ' ms (' + (tOld / tMine).toFixed(0) + '×), tree (forced awake) ' + tAwake.toFixed(3) + ' ms (' + (tOld / tAwake).toFixed(1) + '×)');
    ok(tOld / tMine >= 1.5, 'only ' + (tOld / tMine).toFixed(1) + '× faster');
  });

  test('a 200-body scene steps in under 4 ms', () => {
    const w = world(), r = rng(5); ground(w);
    for (let i = 0; i < 200; i++) crate(w, -40 + (i % 40) * 2, 0.5 + Math.floor(i / 40) * 1.2 + r() * 0.1, 10, { angle: r() * 0.1 });
    w.cfg.enableSleep = false;
    const ms = time(() => w.step(1 / 60), 60);
    console.log('    E02 bench, 200 awake bodies: ' + ms.toFixed(2) + ' ms per step');
    ok(ms < 4, ms.toFixed(2) + ' ms');
  });
});

suite('physics E02: filtering', () => {
  const fix = (filter, sensor) => ({ body: {}, sensor: !!sensor, filter: Object.assign({ category: 1, mask: 0xFFFFFFFF, group: 0 }, filter) });
  test('category and mask must both accept (Box2D rule)', () => {
    ok(P.broadphase.filtersPass(fix({ category: 2, mask: 1 }), fix({ category: 1, mask: 2 })), 'mutual');
    ok(!P.broadphase.filtersPass(fix({ category: 2, mask: 1 }), fix({ category: 1, mask: 4 })), 'one-sided must fail');
    ok(!P.broadphase.filtersPass(fix({ category: 2, mask: 4 }), fix({ category: 2, mask: 2 })), 'A rejects B');
  });
  test('same positive group always collides, same negative group never, different groups fall back to masks', () => {
    ok(P.broadphase.filtersPass(fix({ group: 3, mask: 0 }), fix({ group: 3, mask: 0 })), 'positive overrides masks');
    ok(!P.broadphase.filtersPass(fix({ group: -3 }), fix({ group: -3 })), 'negative never');
    ok(P.broadphase.filtersPass(fix({ group: -3 }), fix({ group: -4 })), 'different groups use masks');
    ok(!P.broadphase.filtersPass(fix({ group: 2, mask: 0 }), fix({ group: 5 })), 'different groups, mask 0');
  });
  test('in the sim: a crate masked off the ground falls through it, a normal crate lands', () => {
    const w = world(); ground(w);
    const ghost = crate(w, -2, 2, 10, { shapes: [{ shape: P.box(0.5, 0.5), filter: { category: 2, mask: 0xFFFFFFFE } }] });
    const solid = crate(w, 2, 2, 10);
    w.run(2);
    ok(ghost.c.y < -5, 'ghost stopped at ' + ghost.c.y);
    near(solid.c.y, 0.5, 0.02);
  });
  test('in the sim: two crates in the same negative group pass through each other, joined bodies do not collide', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = crate(w, -2, 0, 10, { shapes: [{ shape: P.box(0.5, 0.5), group: -1 }], velocity: { x: 2, y: 0 } });
    const b = crate(w, 2, 0, 10, { shapes: [{ shape: P.box(0.5, 0.5), group: -1 }], velocity: { x: -2, y: 0 } });
    w.run(2);
    near(a.v.x, 2, 1e-9); near(b.v.x, -2, 1e-9);
    ok(a.c.x > 1.5 && b.c.x < -1.5, 'did not pass through');
    const w2 = world({ gravity: { x: 0, y: 0 } });
    const c = crate(w2, 0, 0, 10), d = crate(w2, 0.5, 0, 10);
    w2.addJoint(new P.DistanceJoint({ bodyA: c, bodyB: d }));
    w2.run(0.5);
    eq(w2.contacts.size, 0, 'jointed bodies made a contact');
  });
  test('sensors never make contacts; static–static never collides', () => {
    const w = world();
    const s1 = w.add(new P.Body({ type: 'static', shapes: [P.box(1, 1)] }));
    const s2 = w.add(new P.Body({ type: 'static', position: { x: 0.5, y: 0 }, shapes: [P.box(1, 1)] }));
    const s3 = crate(w, 0, 0, 1, { shapes: [{ shape: P.box(0.5, 0.5), sensor: true }], gravityScale: 0 });
    w.step(1 / 60);
    eq(w.contacts.size, 0);
    ok(!P.broadphase.shouldCollide(w, s1.fixtures[0], s2.fixtures[0]) && !P.broadphase.shouldCollide(w, s1.fixtures[0], s3.fixtures[0]));
  });
});

suite('physics E02: contact and sensor events', () => {
  test('a ball bouncing once fires contactBegin and contactEnd exactly once each', () => {
    const w = world(); ground(w);
    const ball = w.add(new P.Body({ position: { x: 0, y: 2 }, shapes: [{ shape: P.circle(0.2), restitution: 0.5 }] }));
    let begin = 0, end = 0, evt = null;
    w.on('contactBegin', e => { begin++; evt = e; });
    w.on('contactEnd', () => end++);
    // falls ~1.8 m (0.61 s), bounces to ~0.45 m and is back down after ~0.6 s more
    let apex = false;
    w.run(3, 1 / 60, () => { if (ball.v.y > 0) apex = true; if (apex && ball.v.y < -0.5 && ball.c.y < 0.3) return false; });
    eq(begin, 1, 'begins'); eq(end, 1, 'ends');
    ok(evt.a.type === 'static' || evt.b.type === 'static', 'event names the bodies');
    ok(Math.abs(evt.normal.y) > 0.99, 'normal ' + JSON.stringify(evt.normal));
  });

  test('a crate entering and leaving a sensor box fires sensorBegin then sensorEnd, and is not pushed', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const dock = w.add(new P.Body({ type: 'static', position: { x: 5, y: 0 }, shapes: [{ shape: P.box(1, 1), sensor: true }], label: 'dock' }));
    const box = crate(w, 0, 0, 50, { velocity: { x: 2, y: 0 } });
    const log = [];
    let inside = 0;
    w.on('sensorBegin', e => log.push(['begin', e.sensorBody.label, e.visitorBody === box, w.time]));
    w.on('sensorEnd', e => log.push(['end', e.sensorBody.label, e.visitorBody === box, w.time]));
    w.run(6, 1 / 60, () => { if (P.broadphase.sensorVisitors(w, dock).length) inside++; });
    eq(log.length, 2, JSON.stringify(log));
    eq(log[0][0], 'begin'); eq(log[1][0], 'end');
    ok(log[0][1] === 'dock' && log[0][2], 'begin names sensor and visitor');
    // front edge reaches x = 4 at t = 3.5/2 = 1.75 s; back edge leaves x = 6 at t = 6.5/2 = 3.25 s
    near(log[0][3], 1.75, 0.02); near(log[1][3], 3.25, 0.02);
    near(box.v.x, 2, 1e-12);
    ok(inside > 80 && inside < 95, 'visitor listed for ' + inside + ' steps');
    eq(w.contacts.size, 0);
  });

  test('removing a touching body fires contactEnd', () => {
    const w = world(); ground(w); const b = crate(w, 0, 0.5, 10);
    let end = 0; w.on('contactEnd', () => end++);
    w.run(0.5); w.remove(b); w.step(1 / 60);
    eq(end, 1); eq(w.contacts.size, 0);
  });
});

suite('physics E02: sleeping', () => {
  // dropped with 5 cm gaps so the stack has to land and settle first
  function stack(w, n) { const out = []; for (let i = 0; i < n; i++) out.push(crate(w, 0, 0.55 + i * 1.05, 50)); return out; }
  const asleep = bs => bs.every(b => b.awake === false);
  const awake = bs => bs.every(b => b.awake !== false);

  test('a 5-crate stack dropped with 5 cm gaps falls asleep within 4 s (once its contact forces settle), stands within 5 mm of plumb', () => {
    const w = world(); ground(w); const s = stack(w, 5);
    let t = null;
    w.run(4, 1 / 60, () => { if (t == null && asleep(s)) t = w.time; });
    ok(t != null, 'still awake after 4 s: ' + s.map(b => b.sleepTime.toFixed(2)).join(','));
    console.log('    E02 stack asleep at t = ' + t.toFixed(2) + ' s');
    s.forEach((b, i) => { near(b.c.y, 0.5 + i, 0.02); near(b.c.x, 0, 5e-3); eq(b.v.x, 0); eq(b.w, 0); });
    // contact force still reads correctly while asleep: the top crate's net contact force is its weight
    near(w.contactForceOn(s[4], 1 / 60).y, 50 * g, 0.02);
  });

  test('a slow-settling cable structure sleeps only once its forces have settled: tension matches the never-sleeping run within 0.1%', () => {
    // Ring on two rigid cables (50° and 20°) with a 150 kg crate on a rope
    // below it. The soft joints creep for a while after the bodies look still;
    // sleeping then would freeze a tension about 1% off equilibrium.
    function build(sleep) {
      const w = world(); w.cfg.enableSleep = sleep;
      const sky = w.add(new P.Body({ type: 'static', shapes: [] }));
      const ring = w.add(new P.Body({ shapes: [P.circle(0.05)], mass: 2 }));
      const load = w.add(new P.Body({ position: { x: 0, y: -2 }, shapes: [P.box(0.3, 0.3)], mass: 150 }));
      const a = 50 * Math.PI / 180, b = 20 * Math.PI / 180;
      const cA = w.addJoint(new P.DistanceJoint({ bodyA: sky, bodyB: ring, localAnchorA: { x: -2.5 * Math.cos(a), y: 2.5 * Math.sin(a) } }));
      w.addJoint(new P.DistanceJoint({ bodyA: sky, bodyB: ring, localAnchorA: { x: 3 * Math.cos(b), y: 3 * Math.sin(b) } }));
      w.addJoint(new P.DistanceJoint({ bodyA: ring, bodyB: load, localAnchorB: { x: 0, y: 0.3 }, rope: true }));
      w.run(4);
      return { cA, load };
    }
    const on = build(true), off = build(false);
    ok(on.load.awake === false, 'structure never slept');
    near(on.cA.tension(), off.cA.tension(), 1e-3);
  });

  test('a ball hitting the sleeping stack wakes the whole island', () => {
    const w = world(); ground(w); const s = stack(w, 5);
    w.run(5);
    ok(asleep(s), 'stack not asleep');
    const ball = w.add(new P.Body({ position: { x: -3, y: 4.5 }, velocity: { x: 12, y: 0 }, shapes: [P.circle(0.25)], mass: 20 }));
    let woke = null;
    w.run(1, 1 / 60, () => { if (woke == null && awake(s)) woke = w.time; });
    ok(woke != null, 'stack never woke');
    ok(Math.abs(s[4].c.x) > 0.05 || Math.abs(s[4].v.x) > 0.05, 'top crate was not knocked');
    ok(ball.awake !== false);
  });

  test('a sleeping load under a rope that breaks wakes and falls', () => {
    const w = world();
    const beam = w.add(new P.Body({ type: 'static', position: { x: 0, y: 5 }, shapes: [P.box(1, 0.1)] }));
    const load = crate(w, 0, 3, 100);
    const rope = w.addJoint(new P.DistanceJoint({ bodyA: beam, bodyB: load, localAnchorA: { x: 0, y: -0.1 }, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    w.run(2);
    ok(load.awake === false, 'hanging load did not sleep');
    let broke = 0; w.on('break', () => broke++);
    rope.breakForce = 500;                 // below the 981 N it carries
    w.step(1 / 60);
    eq(broke, 1, 'rope did not break');
    ok(load.awake !== false, 'load still asleep after the rope broke');
    const y0 = load.c.y;
    w.run(0.5);
    // free fall: ½ g t² = 1.23 m after 0.5 s
    near(y0 - load.c.y, 0.5 * g * 0.25, 0.03);
  });

  test('forces, impulses, setTransform, a direct velocity and a new joint each wake a sleeping body', () => {
    const cases = {
      force: b => b.applyForce({ x: 100, y: 0 }),
      impulse: b => b.applyImpulse({ x: 10, y: 0 }),
      torque: b => b.applyTorque(50),
      setTransform: b => b.setTransform({ x: 3, y: 0.5 }, 0),
      velocity: b => { b.v = { x: 1, y: 0 }; },
      joint: (b, w) => w.addJoint(new P.DistanceJoint({ bodyA: w.bodies[0], bodyB: b, localAnchorA: { x: 0, y: 3 }, localAnchorB: { x: 0, y: 0 } }))
    };
    Object.keys(cases).forEach(name => {
      const w = world(); ground(w); const b = crate(w, 0, 0.5, 10);
      w.run(1.5);
      ok(b.awake === false, name + ': did not sleep');
      cases[name](b, w);
      w.step(1 / 60);
      ok(b.awake !== false, name + ': did not wake');
    });
  });

  test('waking one crate of a sleeping stack wakes all of it; a separate stack stays asleep', () => {
    const w = world(); ground(w);
    const s1 = stack(w, 3), s2 = [crate(w, 5, 0.5, 50), crate(w, 5, 1.5, 50)];
    w.run(5);
    ok(asleep(s1) && asleep(s2), 'not asleep');
    s1[2].applyImpulse({ x: 1, y: 0 });
    w.step(1 / 60);
    ok(awake(s1), 'stack 1 not fully awake');
    ok(asleep(s2), 'stack 2 woke');
  });

  test('a moving kinematic platform keeps its rider awake; enableSleep = false keeps everything awake', () => {
    const w = world();
    const plat = w.add(new P.Body({ type: 'kinematic', position: { x: 0, y: 0 }, velocity: { x: 0.02, y: 0 }, shapes: [P.box(3, 0.2)] }));
    const rider = crate(w, 0, 0.7, 10);
    w.run(3);
    ok(rider.awake !== false, 'rider slept on a moving platform');
    near(rider.c.x, 0.02 * 3, 0.1);
    const w2 = world(); ground(w2); const b = crate(w2, 0, 0.5, 10);
    w2.cfg.enableSleep = false;
    w2.run(3);
    ok(b.awake !== false, 'slept with sleeping off');
    const w3 = world(); ground(w3); const c = crate(w3, 0, 0.5, 10, { allowSleep: false });
    w3.run(3);
    ok(c.awake !== false, 'allowSleep false slept');
  });
});

suite('physics E02: snapshot / restore', () => {
  test('restoring a busy scene (pair churn, sleeping, a sensor) replays bit-identically, twice', () => {
    const w = world(), r = rng(9); ground(w);
    w.add(new P.Body({ type: 'static', position: { x: 3, y: 0.5 }, shapes: [{ shape: P.box(1, 0.5), sensor: true }] }));
    for (let i = 0; i < 120; i++) {
      w.add(new P.Body({ position: { x: -6 + r() * 12, y: 0.6 + r() * 12 }, angle: r() * 6,
        shapes: [i % 3 ? P.box(0.2 + r() * 0.3, 0.2 + r() * 0.3) : P.circle(0.25)] }));
    }
    const sig = () => w.bodies.map(b => [b.c.x, b.c.y, b.angle, b.awake]).flat();
    let events;
    ['contactBegin', 'contactEnd', 'sensorBegin', 'sensorEnd'].forEach(t => w.on(t, () => events++));
    w.run(0.5);
    const snap = P.snapshot(w);
    events = 0; w.run(5);
    const ref = sig(), refEvents = events;
    ok(w.bodies.some(b => b.awake === false), 'nothing fell asleep, so sleeping is not exercised');
    for (let k = 0; k < 2; k++) {
      P.restore(w, snap);
      events = 0; w.run(5);
      const got = sig();
      eq(events, refEvents, 'replay ' + k + ' event count');
      for (let i = 0; i < ref.length; i++) if (got[i] !== ref[i]) throw new Error('replay ' + k + ': value ' + i + ' differs: ' + got[i] + ' vs ' + ref[i]);
    }
  });
});
