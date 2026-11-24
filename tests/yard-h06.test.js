'use strict';
// H6 Three Rulers: the rail and scale-bench experiments give the numbers the level teaches.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;

suite('H6 three rulers: yard experiments', () => {
  const part = (type, props) => Y.makeInstance(type, props);
  const lv = () => SE.content.chapter('ch01').levels.find(l => l.id === 'H6');
  const cart = (mass) => [part('cart', { id: 'cart', x: -30, y: 0.25, dials: { mass } })];
  const coast = (mass, force, time) => {
    const d = { parts: cart(mass).concat([part('push', { a: { part: 'cart' }, dials: { force, time } })]) };
    return Y.judge({ design: d, goal: G.after(Number.parseFloat(time) + 1), timeout: 10 }).state.vel('cart').x;
  };
  test('one heave (250 N for 1 s) on one sack (40 kg) gives 6.25 m/s^2 = 70.3 pace/breath^2', () => {
    const a = coast('40 kg', '250 N', '1 s');
    near(a, 6.25, 1e-3); near(a * 9 / 0.8, 70.3, 0.01);
  });
  test('the derived heave, 3.56 N for one breath, leaves the sack at 1 pace per breath', () => {
    near(coast('40 kg', '3.56 N', '3 s'), 0.8 / 3, 0.003);
  });
  test('1 lb for 1 s on 1 slug gives 1 ft/s; 1 N for 1 s on 1 kg gives 1 m/s', () => {
    near(coast('1 slug', '1 lb', '1 s'), 0.3048, 1e-3);
    near(coast('1 kg', '1 N', '1 s'), 1, 1e-3);
  });
  test('the mass dial refuses pounds (a force)', () => { ok(!Y.dial.parse('172 lb', 'mass').ok); });

  const hang = (nominal) => {
    const d = { parts: [part('hook', { id: 'hook', x: 0, y: 4.3 }), part('weight', { id: 'w', x: 0, y: 2.2, dials: { nominal } }),
      part('springscale', { id: 'sc', a: { part: 'hook', anchor: 'eye' }, b: { part: 'w', anchor: 'top' } })] };
    const r = Y.judge({ design: d, goal: G.after(3), timeout: 4 });
    return r.state.read('sc.force');
  };
  test('calibration weights: 1 kg reads 9.81 N, 5 kg 49.1 N', () => { near(hang('1 kg'), 9.81, 0.01); near(hang('5 kg'), 49.05, 0.01); });
  test('FPS weights: 10 lb reads 10.0 lb, 1 slug reads 32.2 lb', () => {
    near(hang('10 lb') / 4.448, 10, 0.01); near(hang('1 slug') / 4.448, 32.18, 0.01);
  });
  test('the level has no multiple choice or answer boxes left', () => {
    const L = lv(); ok(L.yard && !L.proveIt);
    SE.content.walkSteps(L.steps, s => ok(['predict', 'task', 'classify', 'try', 'derive'].indexOf(s.type) < 0, 'old step type ' + s.type));
  });
  test('Teo: 172 lb is 5.34 slug, 77.9 kg, 765 N', () => {
    near(172 / 32.2, 5.34, 0.001); near(172 / 32.2 * 14.59, 77.9, 0.001); near(172 * 4.448, 765, 0.001);
  });
});
