'use strict';
// Build yard: dials, designs, the judge, and every yard job's reference solution.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;

suite('yard: dials', () => {
  const D = Y.dial;
  test('force dials take any force unit and give newtons', () => {
    near(D.parse('2.5 kN', 'force').si, 2500); near(D.parse('300 lb', 'force').si, 300 * 4.448, 1e-9);
  });
  test('a prefix slip is a valid force (the part does what it was told)', () => { near(D.parse('12 mN', 'force').si, 0.012); });
  test('the wrong kind of unit is refused with a reason', () => {
    const r = D.parse('5 kg', 'force'); ok(!r.ok && /mass/.test(r.error) && /force dial/.test(r.error), r.error);
  });
  test('a bare number on a unit dial asks for the unit', () => { ok(/unit/.test(D.parse('4.5', 'force').error)); });
  test('angles are radians inside', () => { near(D.parse('30 deg', 'angle').si, Math.PI / 6); });
  test('format groups thousands and keeps figures', () => { eq(D.format(18500, 'kg', 3), '18 500 kg'); eq(D.format(2500, 'kN', 3, 'force'), '2.50 kN'); });
});

suite('yard: designs and the judge', () => {
  const part = (type, props) => Y.makeInstance(type, props);
  test('a push of F for t on a frictionless cart gives v = Ft/m', () => {
    const design = { parts: [part('cart', { id: 'cart', x: 0, y: 0.25, dials: { mass: '120 kg' } }), part('push', { a: { part: 'cart' }, dials: { force: '120 N', time: '2 s' } })] };
    const r = Y.judge({ design, goal: G.after(4), timeout: 5 });
    ok(r.pass); near(r.state.vel('cart').x, 2, 1e-6);
  });
  test('a delayed push starts on time', () => {
    const design = { parts: [part('cart', { id: 'cart', x: 0, y: 0.25, dials: { mass: '100 kg' } }), part('push', { a: { part: 'cart' }, dials: { force: '100 N', time: '1 s', start: '2 s' } })] };
    const r = Y.judge({ design, goal: G.after(1.99), timeout: 5 });
    near(r.state.vel('cart').x, 0, 1e-9);
    const r2 = Y.judge({ design, goal: G.after(3.5), timeout: 5 });
    near(r2.state.vel('cart').x, 1, 1e-6);
  });
  test('a cable holds below its rating and snaps above it', () => {
    [[50, true], [150, false]].forEach(([m, holds]) => {
      const d = { parts: [part('hook', { id: 'h', x: 0, y: 6 }), part('crate', { id: 'c', x: 0, y: 4, dials: { mass: m + ' kg' } }),
        part('cable', { id: 'k', a: { part: 'h', anchor: 'eye' }, b: { part: 'c', anchor: 'top' }, dials: { rating: '1 kN' } })] };
      const r = Y.judge({ design: d, goal: G.all(G.noBreaks(), G.after(2)), timeout: 3 });
      ok(r.pass === holds, m + ' kg: ' + r.reason);
      if (holds) near(r.state.read('k.tension'), m * 9.81, 0.01);
    });
  });
  test('an unreadable dial blocks the run and names the problem', () => {
    const r = Y.judge({ design: { parts: [part('crate', { dials: { mass: '5 N' } })] }, goal: G.after(1) });
    ok(!r.pass && /mass dial/.test(r.reason), r.reason);
  });
  test('removing a part takes its connectors with it (design model)', () => {
    const d = { parts: [part('crate', { id: 'c' }), part('push', { id: 'q', a: { part: 'c' } })] };
    const b = Y.build(d); ok(!b.errors.length && b.parts.q && b.parts.c);
  });
});

// Every yard job in Act I must be winnable: each level lists reference
// builds in `solutions` (step id -> design changes) checked here headless.
suite('yard: Act I jobs have working reference solutions', () => {
  const ch = SE.content.chapter('ch01');
  ch.levels.filter(lv => lv.yard).forEach(lv => {
    SE.content.walkSteps(lv.steps, s => {
      if (s.type !== 'job') return;
      test(lv.id + ' ' + s.id + ': reference build passes, the start does not', () => {
        const sol = (lv.solutions || {})[s.id];
        ok(sol, 'no reference solution for ' + s.id);
        const start = (s.yard && s.yard.design) || lv.yard.design;
        const site = (s.yard && s.yard.site) || lv.yard.site;
        const timeout = s.timeout || 30;
        const blank = Y.judge({ design: start, site, goal: s.goal, timeout });
        ok(!blank.pass, 'passes with nothing built');
        [].concat(sol).forEach((build, k) => {
          const d = Y.cloneDesign(start);
          (build.add || []).forEach(p => d.parts.push(Y.makeInstance(p.type, p)));
          Object.keys(build.set || {}).forEach(id => Object.assign(d.parts.find(p => p.id === id).dials, build.set[id]));
          const r = Y.judge({ design: d, site, goal: s.goal, timeout });
          ok(r.pass === (build.pass !== false), 'solution ' + k + ': ' + (r.reason || 'passed but should fail'));
        });
      });
    });
  });
});

suite('yard: Act I manual jobs have working reference solutions', () => {
  const ch = SE.content.chapter('ch01');
  ch.projects.filter(p => p.yard).forEach(p => {
    let design = p.yard.design || { parts: [] };
    p.jobs.forEach(j => {
      if (j.design) design = j.design;
      const start = design;
      test(p.id + ' ' + j.id + ': reference build passes, the start does not', () => {
        const sol = (p.solutions || {})[j.id];
        ok(sol, 'no reference solution for ' + j.id);
        const site = (j.yard && j.yard.site) || p.yard.site, timeout = j.timeout || 30;
        ok(!Y.judge({ design: start, site, goal: j.goal, timeout }).pass, 'passes with nothing built');
        [].concat(sol).forEach((build, k) => {
          const d = Y.cloneDesign(start);
          (build.add || []).forEach(q => d.parts.push(Y.makeInstance(q.type, q)));
          Object.keys(build.set || {}).forEach(id => Object.assign(d.parts.find(q => q.id === id).dials, build.set[id]));
          const r = Y.judge({ design: d, site, goal: j.goal, timeout });
          ok(r.pass === (build.pass !== false), 'solution ' + k + ': ' + (r.reason || 'passed but should fail'));
        });
      });
    });
  });
});
