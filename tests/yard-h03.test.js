'use strict';
// H3 · Good Enough Models: the level's parts reproduce the models they teach.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;

const lv = SE.content.chapter('ch01').levels.find(l => l.id === 'H3');
const site = lv.yard.site;
const part = (type, props) => Y.makeInstance(type, props);

function slide(shape, runners, force) {
  const d = Y.cloneDesign(lv.yard.design);
  Object.assign(d.parts.find(p => p.id === 'load').dials, { shape, runners });
  d.parts.find(p => p.id === 'shove').dials.force = force;
  const r = Y.judge({ design: d, site, goal: G.after(8), timeout: 9 });
  return r.state.part('load');
}

function shelf(material, extra, load) {
  const parts = [part('h03-shelf', { id: 'shelf', x: 0, y: 3, dials: Object.assign({ material, length: '2.4 m', depth: '120 mm', width: '80 mm' }, extra || {}) })];
  if (load) parts.push(part(load.type, Object.assign({ id: 'load', a: { part: 'shelf' } }, load)));
  const r = Y.judge({ design: { parts }, site, goal: G.after(5), timeout: 6 });
  return r.state.part('shelf');
}
const weightOf = sh => sh.beam.bodies.reduce((a, b) => a + b.m, 0) * 9.81;

suite('H3: particle', () => {
  test('a point, a 1 m crate and a 4.5 m sled travel the same distance under the same shove', () => {
    const d = ['point', 'crate 1 m', 'ladder sled 4.5 m'].map(s => slide(s, 'greased', '120 N').travel());
    // a = (120 - 0.10·60·9.81)/60 for 3 s, then -μg to rest
    const a1 = (120 - 0.1 * 60 * 9.81) / 60, v = a1 * 3, x = 0.5 * a1 * 9 + v * v / (2 * 0.1 * 9.81);
    d.forEach(t => near(t, x, 0.01));
  });
  test('a tall crate on bare runners tips under 400 N; the point model slides', () => {
    ok(Math.abs(slide('tall crate 2 m', 'bare', '400 N').tilt()) > 1.2, 'tall crate should go over');
    near(slide('point', 'bare', '400 N').tilt(), 0, 1e-9);
  });
});

suite('H3: rigid body', () => {
  test('the steel shelf sags PL³/(3EI) under a slung load', () => {
    const bare = shelf('steel').sag(), loaded = shelf('steel', null, { type: 'h03-hang', dials: { mass: (3200 / 9.81) + ' kg', at: '2.4 m' } }).sag();
    const I = 0.08 * 0.12 ** 3 / 12;
    near(loaded - bare, 3200 * 2.4 ** 3 / (3 * 200e9 * I), 0.01);
  });
  test('stiff shelves give the rigid model\'s wall moment; rubber does not', () => {
    ['steel', 'aluminium', 'timber'].forEach(m => {
      const sh = shelf(m, null, { type: 'h03-hang', dials: { mass: '100 kg', at: '2.4 m' } });
      near(sh.moment(), 100 * 9.81 * 2.4 + weightOf(sh) * 1.2, 0.01, m);
    });
    const rub = shelf('rubber', null, { type: 'h03-hang', dials: { mass: '100 kg', at: '2.4 m' } });
    ok(rub.moment() < 0.5 * (100 * 9.81 * 2.4 + weightOf(rub) * 1.2), 'rubber should fall well short of W·L');
  });
});

suite('H3: concentrated force', () => {
  test('one point at the middle of spread sandbags gives the same wall reactions', () => {
    const spread = shelf('steel', null, { type: 'h03-bags', dials: { mass: '300 kg', spread: '1.2 m', centre: '1.8 m' } });
    const point = shelf('steel', null, { type: 'h03-bags', dials: { mass: '300 kg', spread: '0 m', centre: '1.8 m' } });
    near(point.moment(), spread.moment(), 0.001);
    near(point.shear(), spread.shear(), 0.001);
    near(point.sag(), spread.sag(), 0.02);
  });
  test('the same point at the tip overstates the wall moment', () => {
    const spread = shelf('steel', null, { type: 'h03-bags', dials: { mass: '300 kg', spread: '1.2 m', centre: '1.8 m' } });
    const tip = shelf('steel', null, { type: 'h03-bags', dials: { mass: '300 kg', spread: '0 m', centre: '2.4 m' } });
    ok(tip.moment() > spread.moment() * 1.15);
  });
});
