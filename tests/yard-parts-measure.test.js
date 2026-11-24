'use strict';
// Measuring parts: each one checked against the result it stands for.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;
const part = (type, props) => Y.makeInstance(type, props);
const run = (parts, t, site, goal) => Y.judge({ design: { parts }, site, goal: goal || G.after(t), timeout: t + 1 });

suite('yard parts: measure', () => {
  test('every measuring part is in the library and builds with its defaults', () => {
    ['springscale', 'weight', 'loadcell', 'stopwatch', 'tape', 'pendulum', 'balance', 'caliper'].forEach(t => {
      ok(Y.library().indexOf(t) >= 0, t + ' in library');
      eq(Y.partDef(t).category, 'Measure', t);
    });
    const b = Y.build({ parts: [part('pendulum', { x: 0, y: 3 }), part('balance', { x: 3, y: 0 }), part('stopwatch', { x: -3, y: 2 }), part('weight', { id: 'w', x: 6, y: 0.2 })] });
    eq(b.errors.length, 0, JSON.stringify(b.errors));
  });

  // spring scale: F = k x, read on any face
  const hang = (load, scaleDials, site) => [
    part('hook', { id: 'h', x: 0, y: 4 }), load,
    part('springscale', { id: 's', a: { part: 'h', anchor: 'eye' }, b: { part: load.id, anchor: 'top' }, dials: scaleDials || {} })];
  test('a spring scale settles at the weight it carries, stretched by W/k', () => {
    const r = run(hang(part('crate', { id: 'c', x: 0, y: 3, dials: { mass: '20 kg' } }), { k: '5 kN/m' }), 6);
    near(r.state.read('s.force'), 20 * 9.81, 0.01);
    near(r.state.read('s.stretch'), 20 * 9.81 / 5000, 0.02);
  });
  test('a stiffer spring reads the same weight but stretches less', () => {
    const r = run(hang(part('crate', { id: 'c', x: 0, y: 3, dials: { mass: '20 kg' } }), { k: '50 kN/m' }), 6);
    near(r.state.read('s.force'), 20 * 9.81, 0.01);
    near(r.state.read('s.stretch'), 20 * 9.81 / 50000, 0.03);
  });
  test('a spring scale over its capacity snaps', () => {
    const r = run(hang(part('crate', { id: 'c', x: 0, y: 3, dials: { mass: '50 kg' } }), { capacity: '100 lb' }), 3, null, G.all(G.noBreaks(), G.after(3)));
    ok(!r.pass && /broke/.test(r.reason), r.reason);
  });

  // weights: stamps -> mass
  test('stamped weights: kg is mass, a pound stamp weighs that many pounds, a slug is 14.59 kg', () => {
    near(Y.weightMass('5 kg'), 5); near(Y.weightMass('10 lb'), 10 * 4.448 / 9.81); near(Y.weightMass('1 slug'), 14.59);
    const b = Y.build({ parts: [part('weight', { id: 'w', dials: { nominal: '25 lb' } })] });
    near(b.parts.w.body.m, 25 * 4.448 / 9.81, 1e-9);
  });
  test('a 10 lb weight on a spring scale reads 10 lb on an lb face', () => {
    const r = run(hang(part('weight', { id: 'w', x: 0, y: 3, dials: { nominal: '10 lb' } }), { face: 'lb' }), 6);
    near(r.state.read('s.force') / 4.448, 10, 0.01);
  });
  test('the same 10 kg weighs less on the Moon (W = m g), the scale shows it', () => {
    const earth = run(hang(part('weight', { id: 'w', x: 0, y: 3 }), {}), 6, { g: 9.81 });
    const moon = run(hang(part('weight', { id: 'w', x: 0, y: 3 }), {}), 8, { g: 1.62 });
    near(earth.state.read('s.force'), 98.1, 0.01); near(moon.state.read('s.force'), 16.2, 0.01);
  });

  // load cell
  test('a load cell in line reads the weight it holds and fails over its rating', () => {
    const d = m => [part('hook', { id: 'h', x: 0, y: 4 }), part('crate', { id: 'c', x: 0, y: 3, dials: { mass: m } }),
      part('loadcell', { id: 'L', a: { part: 'h', anchor: 'eye' }, b: { part: 'c', anchor: 'top' }, dials: { rating: '2 kN' } })];
    const r = run(d('150 kg'), 2, null, G.all(G.noBreaks(), G.after(2)));
    ok(r.pass, r.reason); near(r.state.read('L.force'), 150 * 9.81, 0.005);
    const r2 = run(d('250 kg'), 2, null, G.all(G.noBreaks(), G.after(2)));
    ok(!r2.pass, 'overloaded cell should fail');
  });

  // stopwatch
  test('a stopwatch from run to impact times a drop: t = √(2h/g)', () => {
    const r = run([part('crate', { id: 'c', x: 0, y: 5.5, dials: { mass: '10 kg' } }), part('stopwatch', { id: 'sw', x: 3, y: 2 })], 2.5);
    near(r.state.read('sw.t'), Math.sqrt(2 * 5 / 9.81), 0.025);
  });
  test('loads settling onto a balance don\'t stop a drop timer', () => {
    const r = run([part('crate', { id: 'c', x: 4, y: 5.5, dials: { mass: '10 kg' } }), part('stopwatch', { id: 'sw', x: 3, y: 2 }),
      part('balance', { id: 'B', x: 0, y: 0 }), part('weight', { x: -0.5, y: 0.6 }), part('weight', { x: 0.5, y: 0.6 })], 2.5);
    near(r.state.read('sw.t'), Math.sqrt(2 * 5 / 9.81), 0.025);
  });
  test('a stopwatch set to stop after a time reads that time', () => {
    const r = run([part('stopwatch', { id: 'sw', x: 3, y: 2, dials: { stop: 'time', limit: '1.5 s' } })], 3);
    near(r.state.read('sw.t'), 1.5, 0.012);
  });
  test('a stopwatch between two zones times a cart at constant speed', () => {
    const parts = [part('surface', { x: 10, y: -0.1, dials: { length: '30 m', material: 'frictionless' } }),
      part('cart', { id: 'cart', x: 0, y: 0.25, dials: { mass: '100 kg' }, v: { x: 2 } }),
      part('zone', { id: 'z1', x: 4, y: 0.75, dials: { width: '0.2 m' } }), part('zone', { id: 'z2', x: 10, y: 0.75, dials: { width: '0.2 m' } }),
      part('stopwatch', { id: 'sw', x: 0, y: 3, dials: { start: 'zone', stop: 'zone' } })];
    const r = run(parts, 6);
    near(r.state.read('sw.t'), 3, 0.02);
  });
  test('start on release waits until something moves', () => {
    const parts = [part('cart', { id: 'cart', x: 0, y: 0.25, dials: { mass: '100 kg' } }),
      part('push', { a: { part: 'cart' }, dials: { force: '100 N', time: '1 s', start: '1 s' } }),
      part('stopwatch', { id: 'sw', x: 0, y: 3, dials: { start: 'release', stop: 'time', limit: '5 s' } })];
    const r = run(parts, 3);
    near(r.state.read('sw.t'), 2, 0.03);
  });

  // tape
  test('a tape between two points reads the straight distance (3-4-5)', () => {
    const r = run([part('hook', { id: 'a', x: 0, y: 1 }), part('hook', { id: 'b', x: 3, y: 5 }),
      part('tape', { id: 't', a: { part: 'a', anchor: 'eye' }, b: { part: 'b', anchor: 'eye' } })], 0.1);
    near(r.state.read('t.length'), 5); near(r.state.read('t.dx'), 3); near(r.state.read('t.dy'), 4);
  });
  test('a tape follows a falling part', () => {
    const r = run([part('hook', { id: 'a', x: 0, y: 10 }), part('crate', { id: 'c', x: 0, y: 9, dials: { mass: '5 kg' } }),
      part('tape', { id: 't', a: { part: 'a', anchor: 'eye' }, b: { part: 'c', anchor: 'top' } })], 1);
    near(r.state.read('t.length'), 0.5 + 0.5 * 9.81 * 1, 0.01);
  });

  // pendulum
  const T = (L, g, th) => 2 * Math.PI * Math.sqrt(L / g) * (1 + th * th / 16);
  test('a pendulum times its swings: T = 2π√(L/g)', () => {
    const r = run([part('pendulum', { id: 'p', x: 0, y: 3, dials: { length: '1 m', angle: '8 deg' } })], 10);
    near(r.state.read('p.period'), T(1, 9.81, 8 * Math.PI / 180), 0.005);
    ok(r.state.read('p.swings') >= 3);
  });
  test('four times the length doubles the period; mass makes no difference', () => {
    const a = run([part('pendulum', { id: 'p', x: 0, y: 6, dials: { length: '1 m', mass: '1 kg' } })], 12);
    const b = run([part('pendulum', { id: 'p', x: 0, y: 6, dials: { length: '4 m', mass: '20 kg', line: 'rod' } })], 20);
    near(b.state.read('p.period') / a.state.read('p.period'), 2, 0.01);
  });
  test('a pendulum on the Moon measures the Moon\'s g', () => {
    const r = run([part('pendulum', { id: 'p', x: 0, y: 3, dials: { length: '0.5 m', angle: '5 deg' } })], 20, { g: 1.62 });
    const Tm = r.state.read('p.period'), g = 4 * Math.PI * Math.PI * 0.5 / (Tm * Tm);
    near(g, 1.62, 0.01);
  });

  // balance
  const bal = (l, r) => [part('balance', { id: 'B', x: 0, y: 0 }),
    part('weight', { id: 'wl', x: -0.5, y: 0.6, dials: { nominal: l } }), part('weight', { id: 'wr', x: 0.5, y: 0.6, dials: { nominal: r } })];
  test('a beam balance hangs level with equal weights', () => {
    const r = run(bal('5 kg', '5 kg'), 6);
    ok(Math.abs(r.state.read('B.tilt')) < 0.5 * Math.PI / 180, 'tilt ' + r.state.read('B.tilt'));
  });
  test('the heavier pan goes down, and 1 slug outweighs 10 kg', () => {
    const r = run(bal('2 kg', '5 kg'), 6);
    ok(r.state.read('B.tilt') > 5 * Math.PI / 180, 'right down: ' + r.state.read('B.tilt'));
    const r2 = run(bal('1 slug', '10 kg'), 6);
    ok(r2.state.read('B.tilt') < -5 * Math.PI / 180, 'left down: ' + r2.state.read('B.tilt'));
  });
  test('a balance compares masses, so it agrees on the Moon', () => {
    const r = run(bal('5 lb', '5 lb'), 10, { g: 1.62 });
    ok(Math.abs(r.state.read('B.tilt')) < 0.5 * Math.PI / 180);
  });

  // caliper
  test('a caliper reads a part\'s width and height to 0.01 mm', () => {
    const r = run([part('crate', { id: 'c', x: 0, y: 0.5 }), part('weight', { id: 'w', x: 3, y: 0.12 }),
      part('caliper', { id: 'k1', a: { part: 'c' } }), part('caliper', { id: 'k2', a: { part: 'w' } })], 0.1);
    near(r.state.read('k1.width'), 1, 1e-9); near(r.state.read('k1.height'), 1, 1e-9);
    near(r.state.read('k2.width'), 0.3, 1e-9);
    near(Math.round(r.state.read('k2.width') / 1e-5), r.state.read('k2.width') / 1e-5, 1e-6);
  });

  test('plates print the stamp and rating', () => {
    ok(/25 lb/.test(Y.PARTS.weight.plate(part('weight', { dials: { nominal: '25 lb' } }))[0]));
    ok(/3 kN/.test(Y.PARTS.loadcell.plate(part('loadcell', { dials: { rating: '3 kN' } }))[0]));
  });
});
