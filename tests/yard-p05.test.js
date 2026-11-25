'use strict';
// P5 Ghost Satellite: the level-local parts against the formulas they stand for.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;
const P5 = SE.content.chapter('ch01').projectMap.P5, N = P5.numbers;
const part = (type, props) => Y.makeInstance(type, props);

suite('P5: hand working', () => {
  test('the Moon\'s g from G M / R^2 rounds to the placard\'s 1.62', () => { near(N.gMoonCalc, 1.6231, 1e-4); });
  test('Atwood counterweight for an 80 kg trainee is 57.3 kg', () => { near(N.mcIdeal, 57.29, 1e-3); near(N.mcStatic, 66.76, 1e-3); });
  test('g at 400 km is 8.69 m/s^2, so a 500 kg piece weighs 4.35 kN there', () => { near(N.gDebris, 8.6926, 1e-4); near(N.W_DEBRIS, 4346, 1e-3); });
  test('touching 450 kg balls of radius 240 mm attract with 58.6 uN', () => { near(N.F_BALL, 58.65e-6, 1e-3); });
  test('190 lb on Earth is 86.1 kg and 31.4 lb on the Moon', () => { near(N.M_SURV, 86.09, 1e-3); near(N.W_MOON_LB, 31.39, 1e-2); });
});

suite('P5: parts', () => {
  test('rope over the sheave: two masses accelerate at (m1 - m2) g / (m1 + m2)', () => {
    const d = { parts: [part('sheave', { id: 's', x: 0, y: 8, dials: { size: '1.2 m' } }),
      part('p05-dummy', { id: 'a', x: -0.6, y: 4.5, dials: { mass: '60 kg' } }), part('crate', { id: 'b', x: 0.6, y: 4.5, dials: { mass: '40 kg' } }),
      part('p05-rope', { id: 'r', a: { part: 'a', anchor: 'top' }, b: { part: 'b', anchor: 'top' } })] };
    const r = Y.judge({ design: d, goal: G.after(1), timeout: 2 });
    near(-r.state.vel('a').y, 0.2 * 9.81, 0.01);
    near(r.state.vel('b').y, 0.2 * 9.81, 0.01);
    near(r.state.read('r.tension'), 2 * 60 * 40 * 9.81 / 100, 0.01);
  });
  test('a rope with no sheave in the yard is refused', () => {
    const d = { parts: [part('crate', { id: 'a' }), part('crate', { id: 'b', x: 2 }), part('p05-rope', { a: { part: 'a' }, b: { part: 'b' } })] };
    ok(/sheave/.test(Y.build(d).errors[0].error));
  });
  test('two free bench balls pull together with G m1 m2 / r^2', () => {
    const d = { parts: [part('p05-sphere', { id: 'a', x: -1, y: 1, dials: { mass: '100 kg', radius: '150 mm' } }),
      part('p05-sphere', { id: 'b', x: 1, y: 1, dials: { mass: '300 kg', radius: '200 mm' } })] };
    const r = Y.judge({ design: d, goal: G.after(10), timeout: 11 });
    const F = SE.physics.gravity.G * 100 * 300 / 4;
    near(r.state.read('a.pull'), F, 1e-3);
    near(r.state.read('b.pull'), F, 1e-3);
    // x = (1/2)(F/m) t^2, less the one step before the field first acts
    near(r.state.read('a.drift'), 0.5 * F / 100 * 100, 0.02);
    near(r.state.read('b.drift'), -0.5 * F / 300 * 100, 0.02);
  });
  test('the G dial takes m^3/(kg s^2) or N m^2/kg^2 and refuses other units', () => {
    ok(Y.dial.parse('66.73(10^-12) m^3/(kg·s^2)', 'gravconst').ok);
    near(Y.dial.parse('6.673e-11 N·m^2/kg^2', 'gravconst').si, 6.673e-11, 1e-9);
    ok(!Y.dial.parse('66.7(10^-12) m^3/(kg·s)', 'gravconst').ok);
  });
});

suite('P5: jobs judge the physics', () => {
  const job = id => P5.jobs.find(j => j.id === id);
  function run(id, add) {
    const j = job(id), d = Y.cloneDesign(j.design);
    add.forEach(q => d.parts.push(Y.makeInstance(q.type, q)));
    return Y.judge({ design: d, site: j.yard.site, goal: j.goal, timeout: j.timeout });
  }
  const link = r => [{ type: 'cable', a: { part: 'mast', anchor: 'eye' }, b: { part: 'debris', anchor: 'top' }, dials: { rating: r } }];
  test('debris link: any rating between the weight at 400 km and weight + snag passes', () => {
    ['4.35 kN', '4.6 kN', '4.7 kN'].forEach(r => ok(run('P5.debris', link(r)).pass, r));
    ['4.3 kN', '4.75 kN', '4.91 kN', '1100 lb'].forEach(r => ok(!run('P5.debris', link(r)).pass, r));
  });
  test('the debris job runs at g for 400 km, not 9.81', () => { near(job('P5.debris').yard.site.g, N.gDebris); });
  test('lunar rig: a counterweight from the placard\'s 1.62 also passes', () => {
    const r = run('P5.rig', [{ id: 'cw', type: 'crate', x: 0.6, y: 4.6, dials: { mass: '57.32 kg' } },
      { type: 'p05-rope', a: { part: 'trainee', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }]);
    ok(r.pass, r.reason);
  });
  test('lunar balance: a counterweight in slugs is just as good', () => {
    const r = run('P5.balance', [{ id: 'cw', type: 'crate', x: 0.6, y: 3.6, dials: { mass: '5.90 slug' } },
      { type: 'p05-rope', a: { part: 'survivor', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }]);
    ok(r.pass, r.reason);
  });
  test('lunar rig: moving the site to the Moon is not allowed', () => {
    const r = run('P5.rig', [{ type: 'site', x: 3, y: 0.7, dials: { body: 'Moon' } }]);
    ok(!r.pass && /annex/.test(r.reason), r.reason);
  });
  test('lunar rig: the library counterweight works as well as a crate', () => {
    const r = run('P5.rig', [{ id: 'cw', type: 'counterweight', x: 0.6, y: 4.6, dials: { mass: '57.3 kg' } },
      { type: 'p05-rope', a: { part: 'trainee', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }]);
    ok(r.pass, r.reason);
  });
  test('the platform\'s site marker gives the Moon\'s G M / R^2', () => {
    const j = job('P5.hover'), b = Y.build(j.design, j.yard.site);
    near(b.world.gravity.y, -N.gMoonCalc, 1e-6);
  });
  test('debris: a site marker at 400 km agrees with the mast, one at sea level is refused', () => {
    ok(run('P5.debris', link('4.5 kN').concat([{ type: 'site', x: 3, y: 0, dials: { altitude: '400 km' } }])).pass);
    ok(!run('P5.debris', link('4.8 kN').concat([{ type: 'site', x: 3, y: 0 }])).pass);
  });
  test('lunar balance: the jets are off for this one', () => {
    const r = run('P5.balance', [{ type: 'push', a: { part: 'survivor' }, dials: { force: '31.3 lb', angle: '90 deg', time: '5 s' } }]);
    ok(!r.pass && /jets are off/.test(r.reason), r.reason);
  });
  test('hover: the Moon weight in newtons works as well as pounds', () => {
    ok(run('P5.hover', [{ type: 'push', a: { part: 'survivor' }, dials: { force: '139 N', angle: '90 deg', time: '5 s' } }]).pass);
  });
  test('the bench controller keeps up when the player changes the masses', () => {
    const j = job('P5.coil'), d = Y.cloneDesign(j.design);
    d.parts.find(p => p.id === 'coil').dials.G = '66.73(10^-12) m^3/(kg·s^2)';
    d.parts.find(p => p.id === 'massA').dials.mass = '400 kg';
    ok(Y.judge({ design: d, site: j.yard.site, goal: j.goal, timeout: j.timeout }).pass);
  });
  test('every job opens with the whole library in the bin', () => {
    P5.jobs.forEach(j => { const bin = j.yard.bin.map(e => e.type); Y.library().forEach(t => ok(bin.includes(t), j.id + ' is missing ' + t)); });
  });
});
