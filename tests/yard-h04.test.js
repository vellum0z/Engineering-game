'use strict';
// H4 Newton's Yard: the runs the level builds its laws from.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;
const site = { g: 9.81, floor: 'concrete' };
const part = (type, props) => Y.makeInstance(type, props);

function railDesign(m, pull, speed) {
  return { parts: [
    part('cart', { id: 'cart', x: 2, y: 0.25, dials: { mass: m } }),
    part('hook', { id: 'bollard', x: 26, y: 0.25 }),
    part('winch', { id: 'w', a: { part: 'bollard', anchor: 'eye' }, b: { part: 'cart', anchor: 'right' }, dials: { pull, speed } })
  ] };
}

suite('H4: first law on the rail', () => {
  test('once the cart catches the line, tension drops to zero and the speed holds', () => {
    let v4 = NaN;
    const r = Y.judge({ design: railDesign('50 kg', '100 N', '1 m/s'), site, goal: G.after(8), timeout: 9,
      each: s => { if (Math.abs(s.t - 4) < 1e-6) v4 = s.vel('cart').x; } });
    near(v4, 1, 0.01); near(r.state.vel('cart').x, 1, 0.01);
    ok(Math.abs(r.state.read('w.tension')) < 1, 'tension ' + r.state.read('w.tension'));
  });
});

suite('H4: second law from three winch runs', () => {
  [['50 kg', 100, 2], ['50 kg', 200, 4], ['100 kg', 200, 2]].forEach(([m, F, a]) => {
    test(m + ', ' + F + ' N gives a = ' + a + ' m/s²', () => {
      const r = Y.judge({ design: railDesign(m, F + ' N', '12 m/s'), site, goal: G.after(3), timeout: 4 });
      near(r.state.vel('cart').x / r.time, a, 0.01);
      near(r.state.read('w.tension'), F, 0.01 * F);
    });
  });
});

suite('H4: third law with the spring pack', () => {
  const d = () => ({ parts: [
    part('cart', { id: 'A', x: 9, y: 0.25, dials: { mass: '40 kg' } }),
    part('cart', { id: 'B', x: 10.8, y: 0.25, dials: { mass: '200 kg' } }),
    part('h04-kicker', { id: 'k', a: { part: 'A', anchor: 'right' }, b: { part: 'B', anchor: 'left' }, dials: { force: '200 N', time: '0.4 s' } })
  ] });
  test('equal gauges, opposite pushes, accelerations in inverse ratio to mass', () => {
    let onA = 0, onB = 0;
    const r = Y.judge({ design: d(), site, goal: G.after(2), timeout: 3,
      each: s => { if (s.t < 0.3) { onA = s.read('k.onA'); onB = s.read('k.onB'); } } });
    near(onA, 200, 1e-9); near(onB, 200, 1e-9);
    const vA = r.state.vel('A').x, vB = r.state.vel('B').x;
    near(vA, -2.0, 0.01); near(vB, 0.4, 0.002);
    near(40 * vA + 200 * vB, 0, 0.5);     // momentum: equal and opposite
  });
  test('the pack drops away: no force after it has fired', () => {
    const r = Y.judge({ design: d(), site, goal: G.after(1), timeout: 2 });
    near(r.state.read('k.onA'), 0, 1e-12);
  });
});
