'use strict';
// H5 The Long Fall: the drop tower measures g, the site moves g with r.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;

suite('yard H5: the long fall', () => {
  const lv = SE.content.chapter('ch01').levels.find(l => l.id === 'H5');
  function drop(set) {
    const d = Y.cloneDesign(lv.yard.design);
    d.parts.find(p => p.id === 'watch').dials.start = 'release';
    Object.keys(set || {}).forEach(id => Object.assign(d.parts.find(p => p.id === id).dials, set[id]));
    const r = Y.judge({ design: d, site: lv.yard.site, goal: G.after(8), timeout: 9 });
    const t = r.state.read('watch.t');
    return { t, g: 2 * 20 / (t * t), T: r.state.read('scale.tension'), site: r.state.read('site.g'), r };
  }
  test('the site sets sea-level g (about 9.81)', () => { near(drop().site, Y.site.g('Earth', 0, 0), 1e-9); near(drop().site, 9.81, 0.01); });
  // the stopwatch ticks once a frame, so the drop time is good to 1/60 s (about 1.6 % in g over 20 m)
  test('the drop tower measures g to within one stopwatch tick', () => { const m = drop(); ok(Math.abs(m.t - Math.sqrt(40 / m.site)) <= 1 / 60 + 1e-9, 'g from drop ' + m.g + ' vs ' + m.site); });
  test('the stopwatch started on Run includes the latch second', () => {
    const d = Y.cloneDesign(lv.yard.design);
    const r = Y.judge({ design: d, site: lv.yard.site, goal: G.after(8), timeout: 9 });
    near(r.state.read('watch.t') - drop().t, 1, 0.03);
  });
  test('a heavier crate falls in the same time', () => { near(drop({ drop: { mass: '200 kg' } }).t, drop().t, 0.02); });
  test('the hook reads W = mg', () => { const m = drop(); near(m.T, 50 * m.site, 0.5); });
  test('at r = 2R the hook reads a quarter', () => { const a = drop(), b = drop({ site: { altitude: '6371 km' } }); near(b.T / a.T, b.site / a.site, 1e-3); ok(Math.abs(b.T / a.T - 0.25) <= 0.005); near(b.site, Y.site.g('Earth', 6371e3, 0), 1e-9); });
  test('on the Moon g is about a sixth', () => { const m = drop({ site: { body: 'Moon' } }); near(m.site, Y.site.g('Moon', 0, 0), 1e-9); near(m.site, 1.62, 0.01); ok(Math.abs(m.g / m.site - 1) < 0.01); });
});
