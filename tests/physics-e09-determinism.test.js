'use strict';
// Cross-module acceptance suite, part 3: determinism.
//
// The game replays a player's build to judge it and the editor rewinds runs,
// so the same scene stepped the same way must give the same numbers, bit for
// bit: no dependence on Map/Set order, body ids, wall-clock time, other worlds
// stepping in between, or Math.random.
const { suite, test, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;


/* ------------------------------------------------- shared report helpers */
// The three e09 files share one table through a global, printed on exit.
const E09 = globalThis.__E09 || (globalThis.__E09 = { rows: [] });
if (!E09.hooked) {
  E09.hooked = true;
  process.on('exit', () => {
    if (!process.env.E09_REPORT) return;
    const w = [52, 10, 14, 8];
    const line = cols => cols.map((c, i) => String(c).padEnd(w[i])).join(' ');
    console.log('\n' + line(['check', 'tolerance', 'error', 'result']));
    E09.rows.forEach(r => console.log(line([r.name.slice(0, w[0]), r.tol, r.err, r.status])));
  });
}
function fmtErr(e) { return e < 1e-5 && e > 0 ? e.toExponential(1) : (100 * e).toFixed(3) + '%'; }
function fmtTol(t) { return t < 1e-4 ? t.toExponential(0) : (100 * t) + '%'; }
// Relative check: |measured - expected| / |expected| <= tol.
function check(name, measured, expected, tol) {
  const err = Math.abs(measured - expected) / Math.abs(expected);
  const pass = err <= tol;
  E09.rows.push({ name, tol: fmtTol(tol), err: fmtErr(err), status: pass ? 'pass' : 'FAIL' });
  if (!pass) throw new Error(`${name}: expected ≈${expected}, got ${measured} (${fmtErr(err)} > ${100 * tol}%)`);
}
// Absolute check, for quantities whose expected value is zero or an angle.
function checkAbs(name, measured, expected, tol, unit) {
  const err = Math.abs(measured - expected);
  const pass = err <= tol;
  E09.rows.push({ name, tol: '±' + tol + (unit || ''), err: err.toExponential(2) + (unit || ''), status: pass ? 'pass' : 'FAIL' });
  if (!pass) throw new Error(`${name}: expected ${expected}${unit || ''} ±${tol}, got ${measured}`);
}
function pending(name) {
  console.log('  pending: ' + name);
  E09.rows.push({ name, tol: '-', err: '-', status: 'pending' });
}
function row(name, pass, detail) {
  E09.rows.push({ name, tol: 'bit-exact', err: detail, status: pass ? 'pass' : 'FAIL' });
  ok(pass, name + ': ' + detail);
}

/* ---------------------------------------------------------- the scene */
// A mixed scene that touches every merged stage: a crate stack and a small
// pyramid (contacts, friction, warm starting), a pendulum on a rope, a pinned
// chain, a welded arm, a spring, and discs rolling down a ramp into the pile.
function build() {
  const w = new P.World({ gravity: { x: 0, y: -g } });
  const ground = w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(30, 0.5)] }));
  w.add(new P.Body({ type: 'static', position: { x: -8, y: 2 }, angle: -0.35, shapes: [P.box(4, 0.2)] }));
  for (let i = 0; i < 6; i++) w.add(new P.Body({ position: { x: 3, y: 0.5 + i }, shapes: [P.box(0.5, 0.5)], mass: 40, material: 'cargo' }));
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= 3 - row; k++) {
      w.add(new P.Body({ position: { x: -2 + k * 0.62 + row * 0.31, y: 0.3 + row * 0.6 }, shapes: [P.box(0.3, 0.3)], mass: 10, material: 'timber' }));
    }
  }
  for (let i = 0; i < 3; i++) w.add(new P.Body({ position: { x: -10 + i * 0.7, y: 4.5 + i * 0.3 }, shapes: [P.circle(0.25)], mass: 5, material: 'rubber' }));
  const beam = w.add(new P.Body({ type: 'static', position: { x: 8, y: 6 }, shapes: [P.box(3, 0.1)] }));
  const bob = w.add(new P.Body({ position: { x: 10, y: 4 }, shapes: [P.circle(0.2)], mass: 8 }));
  w.addJoint(new P.DistanceJoint({ bodyA: beam, bodyB: bob, localAnchorA: { x: 0, y: -0.1 }, rope: true }));
  let prev = beam;
  for (let i = 0; i < 5; i++) {
    const link = w.add(new P.Body({ position: { x: 6 - 0.2 - i * 0.4, y: 5.9 }, shapes: [{ shape: P.box(0.2, 0.03), group: 3 }], mass: 1 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: 6 - i * 0.4, y: 5.9 } }));
    prev = link;
  }
  const arm = w.add(new P.Body({ position: { x: 11.5, y: 6 }, shapes: [P.box(0.5, 0.05)], mass: 6 }));
  w.addJoint(new P.WeldJoint({ bodyA: beam, bodyB: arm, worldAnchor: { x: 11, y: 6 }, angularStiffness: 400, angularDamping: 5 }));
  const hang = w.add(new P.Body({ position: { x: 7, y: 4.5 }, shapes: [P.box(0.2, 0.2)], mass: 4 }));
  w.addJoint(new P.DistanceJoint({ bodyA: beam, bodyB: hang, localAnchorA: { x: -1, y: -0.1 }, localAnchorB: { x: 0, y: 0.2 }, stiffness: 300, damping: 4 }));
  void ground;
  return w;
}
// Every number the solver carries for every body, joint and contact.
function state(w) {
  const out = [];
  w.bodies.forEach(b => out.push(b.c.x, b.c.y, b.angle, b.v.x, b.v.y, b.w));
  w.joints.forEach(j => {
    ['impulse', 'linearImpulse', 'angularImpulse'].forEach(k => {
      const v = j[k]; if (v == null) return;
      if (typeof v === 'number') out.push(v); else out.push(v.x, v.y);
    });
  });
  w.contacts.forEach(ct => ct.points.forEach(cp => out.push(cp.normalImpulse, cp.tangentImpulse)));
  out.push(w.time, w.contacts.size);
  return out;
}
function firstDiff(a, b) {
  if (a.length !== b.length) return 'state length ' + a.length + ' vs ' + b.length;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return 'entry ' + i + ': ' + a[i] + ' vs ' + b[i];
  return null;
}
const STEPS = 600, dt = 1 / 60;

suite('e09 determinism', () => {
  test('the same scene built twice and stepped 600 times is bit-identical', () => {
    const a = build(), b = build();
    for (let i = 0; i < STEPS; i++) a.step(dt);
    for (let i = 0; i < STEPS; i++) b.step(dt);
    const sa = state(a), sb = state(b);
    const d = firstDiff(sa, sb);
    ok(sa.every(Number.isFinite), 'non-finite value in the state');
    row('determinism: rebuild, 600 steps', !d, d || sa.length + ' values equal');
  });
  test('two worlds stepped in lockstep do not disturb each other', () => {
    const ref = build(); for (let i = 0; i < STEPS; i++) ref.step(dt);
    const a = build(), b = build();
    for (let i = 0; i < STEPS; i++) { a.step(dt); b.step(dt); }
    const d = firstDiff(state(ref), state(a)) || firstDiff(state(ref), state(b));
    row('determinism: interleaved worlds', !d, d || 'equal');
  });
  test('the scene is not trivially at rest: things move a lot in 10 s', () => {
    // guards the tests above against comparing two frozen worlds
    const w = build(), s0 = state(w); for (let i = 0; i < STEPS; i++) w.step(dt);
    const s1 = state(w); let moved = 0;
    for (let i = 0; i < w.bodies.length * 6; i += 6) moved += Math.hypot(s1[i] - s0[i], s1[i + 1] - s0[i + 1]);
    ok(moved > 5, 'bodies moved only ' + moved + ' m in total');
  });
  test('snapshot after 300 steps, run 300, restore, run 300 again: bit-identical', () => {
    if (!P.snapshot || !P.restore) { pending('snapshot/restore determinism (needs serialize.js, E10)'); return; }
    const w = build();
    for (let i = 0; i < 300; i++) w.step(dt);
    const snap = P.snapshot(w);
    for (let i = 0; i < 300; i++) w.step(dt);
    const first = state(w);
    P.restore(w, snap);
    for (let i = 0; i < 300; i++) w.step(dt);
    const d = firstDiff(first, state(w));
    row('determinism: snapshot/restore', !d, d || 'equal');
  });
  test('JSON scene round trip steps the same as the original', () => {
    if (!P.toScene || !P.fromScene) { pending('toScene/fromScene determinism (needs serialize.js, E10)'); return; }
    const a = build();
    const b = P.fromScene(JSON.parse(JSON.stringify(P.toScene(a))));
    for (let i = 0; i < 300; i++) { a.step(dt); b.step(dt); }
    const sa = state(a), sb = state(b);
    let worst = 0;
    for (let i = 0; i < a.bodies.length * 6; i++) worst = Math.max(worst, Math.abs(sa[i] - sb[i]));
    checkAbs('determinism: JSON round trip, body state', worst, 0, 1e-12);
  });
});
