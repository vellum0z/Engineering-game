'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const SE = globalThis.SE;
const P = SE.physics.track;
const DT = 1 / 240;

function scene(params) {
  const s = new SE.scenes.track();
  s.init({ shake() {}, burst() {}, flash() {} }, params);
  s.resize(800, 500);
  return s;
}
function sim(s, seconds) { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) s.step(DT); }
function simUntilDone(s, max) { const n = Math.round((max || 30) / DT); for (let i = 0; i < n && !s.result; i++) s.step(DT); return s.result; }

suite('track physics', () => {
  test('static friction holds below mu_s m g', () => {
    // m = 50, mu = 0.4, mu_s = 0.48: breakaway = 0.48*50*9.81 = 235.44 N
    near(P.breakaway(50, 0.48, 9.81), 235.44, 1e-12);
    const r = P.forces(200, 0, 50, 0.4, 0.48, 9.81);
    eq(r.moving, false); eq(r.a, 0); eq(r.f, -200);
    eq(P.forces(240, 0, 50, 0.4, 0.48, 9.81).moving, true);
  });
  test('kinetic acceleration and closed forms', () => {
    // (300 - 0.4*50*9.81)/50 = (300 - 196.2)/50 = 2.076 m/s^2
    near(P.accel(300, 50, 0.4), 2.076, 1e-12);
    near(P.timeToReach(10, 5, 0), 2, 1e-12);                // sqrt(2*10/5)
    near(P.stoppingDistance(4, 0.2), 16 / 3.924, 1e-12);    // v^2 / (2 mu g) = 4.0775 m
  });
  test('advance cuts the step at the stopping instant', () => {
    const r = P.advance({ x: 0, v: 0.001, m: 10, mu: 0.5, muS: 0.6 }, 0, 9.81, DT);
    eq(r.v, 0); ok(r.stopped);
    near(r.x, 0.001 * 0.001 / (2 * 0.5 * 9.81), 1e-9);
  });
  test('leaking mass', () => {
    eq(P.massAt(100, 10, 40, 3), 70);
    eq(P.massAt(100, 10, 40, 30), 40);
    near(P.leakSpeed(100, 100, 10, 3), 10 * Math.log(100 / 70), 1e-12);
  });
});

suite('track scene', () => {
  test('push below breakaway: no motion (statics, a = 0 at rest)', () => {
    const s = scene({ surface: 'concrete', bodies: [{ id: 'c', m: 50, x: 5, mu: 0.4, kind: 'crate' }] });
    s.run({ duration: 2, forces: { c: 200 } });
    const res = simUntilDone(s, 3);
    eq(res.outcome, 'stopped');
    eq(s.body('c').x, 5);
    eq(s.body('c').f, -200);
  });
  test('push above breakaway accelerates at (F - mu m g)/m', () => {
    const s = scene({ surface: 'concrete', bodies: [{ id: 'c', m: 50, x: 2, mu: 0.4, kind: 'crate' }] });
    s.run({ duration: 20, forces: { c: 300 } });
    sim(s, 2);
    // v = 2.076*2 = 4.152 m/s, dx = 0.5*2.076*4 = 4.152 m
    near(s.body('c').v, 4.152, 1e-6);
    near(s.body('c').x, 2 + 4.152, 1e-6);
  });
  test('ice, no force: constant velocity, equal ghost spacing', () => {
    const s = scene({ surface: 'ice', trail: true, bodies: [{ id: 's', m: 80, x: 1, v: 2, mu: 0, kind: 'sled' }] });
    s.run({ duration: 3 });
    const res = simUntilDone(s, 4);
    eq(res.outcome, 'timeout');
    near(s.body('s').x, 7, 1e-6);          // 1 + 2*3
    eq(s.body('s').a, 0);
    const tr = s.getTrail('s');
    for (let i = 1; i < tr.length; i++) near(tr[i].x - tr[i - 1].x, 1.0, 1e-6, 'spacing');
  });
  test('more mass, less acceleration for the same force', () => {
    const s = scene({ surface: 'ice', bodies: [{ id: 'a', m: 20, x: 2, mu: 0, kind: 'cart' }, { id: 'b', m: 80, x: 8, mu: 0, kind: 'cart' }] });
    s.run({ duration: 1, forces: { a: 100, b: 100 } });
    sim(s, 0.5);
    near(s.body('a').a, 5, 1e-12); near(s.body('b').a, 1.25, 1e-12);
  });
  test('reaches the goal: arrival time and speed', () => {
    // a = 100/20 = 5, d = 10 m: t = 2 s, v = 10 m/s
    const s = scene({ surface: 'ice', bodies: [{ id: 's', m: 20, x: 2, mu: 0, kind: 'sled' }] });
    s.run({ duration: 10, goalX: 12, forces: { s: 100 } });
    const res = simUntilDone(s, 10);
    eq(res.outcome, 'reached');
    near(res.detail.arrivalTime, 2, 0.003);
    near(res.detail.arrivalSpeed, 10, 0.003);
  });
  test('spring push-apart: equal and opposite impulses', () => {
    // 60 N for 0.5 s = 30 N s each: v1 = -30/10 = -3, v2 = 30/20 = +1.5
    const s = scene({ surface: 'ice', bodies: [{ id: 'L', m: 10, x: 10, mu: 0, kind: 'cart', w: 1.6 }, { id: 'R', m: 20, x: 11.6, mu: 0, kind: 'cart', w: 1.6 }] });
    s.run({ duration: 1, springs: [{ a: 'L', b: 'R', F: 60, duration: 0.5 }] });
    sim(s, 0.25);
    eq(s.body('L').gauge, 60); eq(s.body('R').gauge, 60);
    sim(s, 0.5);
    near(s.body('L').v, -3, 1e-9); near(s.body('R').v, 1.5, 1e-9);
    near(10 * s.body('L').v + 20 * s.body('R').v, 0, 1e-9);
  });
  test('friction stops a sliding crate at v^2/(2 mu g)', () => {
    const s = scene({ surface: 'concrete', bodies: [{ id: 'c', m: 30, x: 1, v: 4, mu: 0.2, kind: 'crate' }] });
    s.run({ duration: 10 });
    const res = simUntilDone(s, 10);
    eq(res.outcome, 'stopped');
    near(s.body('c').x - 1, 16 / (2 * 0.2 * 9.81), 1e-6);
  });
  test('bumper rating decides whether it breaks', () => {
    const mk = () => scene({ surface: 'ice', length: 20, bodies: [{ id: 's', m: 80, x: 15, v: 5, mu: 0, kind: 'sled' }] });
    let s = mk(); s.run({ duration: 5, bumperRating: 3 });
    let res = simUntilDone(s, 5);
    eq(res.outcome, 'bumperBroken'); near(res.detail.impactSpeed, 5, 1e-9);
    s = mk(); s.run({ duration: 5, bumperRating: 6 });
    res = simUntilDone(s, 5);
    ok(res.outcome !== 'bumperBroken'); eq(res.detail.bumperBroken, false);
  });
  test('zombies catch a stuck sled', () => {
    // rear edge at 5 - 0.9 = 4.1; pack front from -4 at 2 m/s: t = 8.1/2 = 4.05 s
    const s = scene({ surface: 'ice', zombieStart: -4, bodies: [{ id: 's', m: 80, x: 5, mu: 0, kind: 'sled' }] });
    s.run({ duration: 10, goalX: 20, zombieSpeed: 2 });
    const res = simUntilDone(s, 10);
    eq(res.outcome, 'caught');
    near(res.detail.time, 4.05, 0.002);
  });
  test('leaking sled: a = F/m(t), not d(mv)/dt with the v dm/dt term', () => {
    const s = scene({ surface: 'ice', bodies: [{ id: 's', m: 100, x: 1, mu: 0, kind: 'sled', leak: 10, mDry: 40 }] });
    s.run({ duration: 10, forces: { s: 100 } });
    sim(s, 3);
    near(s.body('s').v, 10 * Math.log(100 / 70), 2e-3);   // 3.567 m/s
  });
  test('data log samples t, x, v, a', () => {
    const s = scene({ surface: 'ice', bodies: [{ id: 's', m: 10, x: 1, mu: 0, kind: 'sled' }] });
    s.run({ duration: 2, forces: { s: 10 } });
    sim(s, 1);
    const log = s.getLog('s');
    ok(log.length >= 20);
    const last = log[log.length - 1];
    ok('t' in last && 'x' in last && 'v' in last && 'a' in last);
    near(last.a, 1, 1e-12);
  });
  test('sandbox controls and set', () => {
    const s = scene({ surface: 'concrete', bodies: [{ id: 'c', m: 50, x: 3, mu: 0.3, kind: 'cart' }] });
    eq(s.controls().map(c => c.key).join(','), 'mass,force,mu,v0');
    s.set('mu', 0); s.set('force', 50);
    sim(s, 1);
    near(s.body('c').v, 1, 1e-9);
    ok(s.readouts().length >= 1);
  });
});
