'use strict';
// H8 · Stamp the Plate: the governed hoist pulls exactly what its plates say.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;

function level() { return SE.content.chapter('ch01').levels.find(l => l.id === 'H8'); }
function rig(dials, mass) {
  const d = Y.cloneDesign(level().yard.design);
  Object.assign(d.parts.find(p => p.id === 'gov').dials, dials || {});
  if (mass) d.parts.find(p => p.id === 'gen').dials.mass = mass;
  return d;
}
function run(design, t) { return Y.judge({ design, site: level().yard.site, goal: G.after(t), timeout: t + 1 }); }

suite('H8 governed hoist', () => {
  test('a hold plate equal to the weight hangs the load still (a = 0)', () => {
    const r = run(rig({ hold: '2.45 kN' }), 3);
    near(r.state.pos('gen').y, 4, 1e-6); near(r.state.vel('gen').y, 0, 1e-6);
    near(r.state.read('gov.tension'), 2450, 1e-6);
  });
  test('the same force in any prefix holds the same way', () => {
    ['2450 N', '0.00245 MN', '2 450 000 mN'].forEach(h => near(run(rig({ hold: h }), 2).state.pos('gen').y, 4, 1e-6, h));
  });
  test('pull above the weight accelerates the load at (T − W)/m', () => {
    const m = 2450 / 9.81, T = 2600, t = 1;
    const r = run(rig({ hold: '2.6 kN' }), t);
    near(r.state.vel('gen').y, (T - 2450) / m * t, 0.02);
  });
  test('a mega for a kilo snaps the 12 kN line', () => {
    const r = run(rig({ hold: '2.45 MN' }), 1);
    ok(r.state.breaks.length === 1 && Math.abs(r.state.breaks[0].force - 2.45e6) < 1);
  });
  test('no prefix drops the load to the slab', () => {
    const r = run(rig({ hold: '2.45 N' }), 3);
    ok(r.state.pos('gen').y < 0.6, 'y = ' + r.state.pos('gen').y);
  });
  test('strict firmware refuses a correct value in an illegal form, and the worn brake slips', () => {
    const r = run(rig({ hold: '2450 N', firmware: 'strict' }), 3);
    const gv = r.built.parts.gov;
    ok(gv.halt && gv.halt.key === 'hold' && /0\.1 and 1000/.test(gv.halt.msg), JSON.stringify(gv.halt));
    ok(r.state.pos('gen').y < 0.6, 'y = ' + r.state.pos('gen').y);
  });
  test('strict firmware refuses a prefix in the denominator and accepts the same value written right', () => {
    const bad = Y.build(rig({ hold: '2.45 kN', lower: '0.25 mm/ms', dwell: '3 s', firmware: 'strict' }), level().yard.site);
    ok(bad.parts.gov.halt && bad.parts.gov.halt.key === 'lower');
    const good = Y.build(rig({ hold: '2.45 kN', lower: '250 mm/s', dwell: '3 s', firmware: 'strict' }), level().yard.site);
    ok(!good.parts.gov.halt);
  });
  test('after the dwell it lowers at the lower plate speed', () => {
    const r = run(rig({ hold: '2.45 kN', dwell: '1 s', lower: '0.25 m/s' }), 3);
    near(r.state.vel('gen').y, -0.25, 0.01); near(r.state.pos('gen').y, 4 - 0.25 * 2, 0.03);
  });
  test('the dial refuses a moment on the hold plate', () => {
    const b = Y.build(rig({ hold: '2.45 kN·m' }), level().yard.site);
    ok(b.errors.some(e => e.part === 'gov' && e.key === 'hold'));
  });
});
