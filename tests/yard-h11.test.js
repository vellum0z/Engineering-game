'use strict';
// H11 The Engineer's Loop: the lift, the governor test and the chalk sketch
// behave the way the level's text says they do.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard;

const lv = SE.content.chapter('ch01').levels.find(l => l.id === 'H11');
const steps = [];
SE.content.walkSteps(lv.steps, s => steps.push(s));
const watches = steps.filter(s => s.type === 'watch');
const sketchStep = steps.find(s => s.type === 'build' && s.yard && s.yard.design && s.yard.design.parts.some(p => p.id === 'sketch'));
const job = steps.find(s => s.id === 'H11.lift');
const site = lv.yard.site;

const W = (1000 * Math.PI / 4 * 2.6 * 2.6 * 3.2 + 1100) * 9.81;   // 177.46 kN
const LB = SE.units.LBF;

function run(step, mut, timeout) {
  const d = Y.cloneDesign(step.yard.design);
  mut(d);
  return Y.judge({ design: d, site, goal: step.yard.goal || step.goal, timeout: timeout || 30 });
}
const part = (d, id) => d.parts.find(p => p.id === id);
function withRope(rope, pull) {
  return d => {
    d.parts.push(Y.makeInstance('h11-sling', { id: 'sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope } }));
    part(d, 'winch').dials.pull = pull;
  };
}

// A stand-in for the runner's ctx, enough for the sketch step's `until`.
function sketchCtx(dials) {
  const d = Y.cloneDesign(sketchStep.yard.design);
  Object.assign(part(d, 'sketch').dials, dials);
  return {
    si: (id, key) => {
      const i = part(d, id), dl = Y.partDef(i.type).dials.find(x => x.key === key);
      const r = Y.dial.parse(i.dials[key], dl.q); return r.ok ? r.si : NaN;
    },
    text: (id, key) => part(d, id).dials[key]
  };
}

suite('H11: the tank and the rope rack', () => {
  test('the tank weighs what the work order adds up to: 18.1 Mg, 177 kN', () => {
    const b = Y.build(lv.yard.design, site);
    ok(!b.errors.length, JSON.stringify(b.errors));
    near(b.parts.tank.body.m, 18090, 1e-3);
    near(b.parts.tank.body.m * 9.81, W, 1e-9);
  });
  test('rack ropes break at their tags, converted: B 160 kN, C 200 kN, E 400 kN', () => {
    const b = Y.build({ parts: lv.yard.design.parts.concat(['B · 36 000 lb', 'C · 45 kip', 'E · 90 kip'].map((rope, k) =>
      Y.makeInstance('h11-sling', { id: 's' + k, a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope } }))) }, site);
    near(b.parts.s0.joint.breakForce, 36000 * LB, 1e-12);
    near(b.parts.s1.joint.breakForce, 45000 * LB, 1e-12);
    near(b.parts.s2.joint.breakForce, 90000 * LB, 1e-12);
    ok(b.parts.s0.joint.breakForce < 1.02 * W && b.parts.s1.joint.breakForce > 1.02 * W);
  });
});

suite('H11: phase 1, steady lift tension is the weight', () => {
  [500, 1000].forEach(m => test(m + ' kg crate rising steadily: T = mg', () => {
    const r = run(watches[0], d => { part(d, 'crate').dials.mass = m + ' kg'; });
    ok(r.state.memo.steadyT, 'no steady reading');
    near(r.state.memo.steadyT, m * 9.81, 0.01);
  }));
  test('a crate heavier than the winch can pull stays on the pad', () => {
    const r = run(watches[0], d => { part(d, 'crate').dials.mass = '1300 kg'; });
    ok(r.state.pos('crate').y < 0.52, 'crate lifted');
  });
});

suite('H11: phase 4, the governor test', () => {
  const proof = watches[2];
  test('pull 2 % over W lifts the tank; the chain reads W within 1.5 %', () => {
    const r = run(proof, d => { part(d, 'winch').dials.pull = '181 kN'; });
    ok(r.state.pos('tank').y - 1.9 > 1, 'did not lift');
    near(r.state.memo.steadyT, W, 0.015);
  });
  test('a big pull lifts too, and the steady chain tension is W', () => {
    const r = run(proof, d => { part(d, 'winch').dials.pull = '250 kN'; });
    near(r.state.memo.steadyT, W, 0.005);
  });
  ['177 kN', '170 kN', '181 N'].forEach(p => test('pull ' + p + ' (W itself, water only, prefix slip) stalls', () => {
    const r = run(proof, d => { part(d, 'winch').dials.pull = p; });
    ok(r.state.pos('tank').y - 1.9 < 0.03, 'it lifted');
  }));
});

suite('H11: phase 2, the chalk sketch', () => {
  const u = dials => sketchStep.until(sketchCtx(dials), 'change');
  test('a blank sketch just waits', () => eq(u({}), false));
  test('metres for millimetres runs off the yard', () => ok(/millimetre became a metre/.test(u({ diameter: '2600 m' }))));
  test('the radius for the diameter is caught', () => ok(/half the tank/.test(u({ diameter: '1300 mm' }))));
  test('the tank height as the water depth is caught', () => ok(/brim/.test(u({ diameter: '2600 mm', height: '3800 mm', depth: '3800 mm' }))));
  test('the true sketch passes, in any length unit', () => {
    eq(u({ diameter: '2600 mm', height: '3800 mm', depth: '3200 mm' }), true);
    eq(u({ diameter: '2.6 m', height: '3.8 m', depth: '320 cm' }), true);
  });
});

suite('H11: the lift job', () => {
  const lift = mut => { const d = Y.cloneDesign(job.yard.design); mut(d); return Y.judge({ design: d, site, goal: job.goal, timeout: job.timeout }); };
  test('rope C at 181 kN lands the tank at deck level with full marks', () => {
    const r = lift(withRope('C · 45 kip', '181 kN'));
    ok(r.pass, r.reason);
    ok(r.state.pos('tank').y - 1.9 >= 9, 'below the deck');
    eq(job.margin(r.state), 0);
  });
  test('the heavier chain E works but costs points', () => {
    const r = lift(withRope('E · 90 kip', '181 kN'));
    ok(r.pass, r.reason); ok(job.margin(r.state) > 0, 'no penalty');
  });
  test('a pull above the rope\'s rating snatches it as the drum starts', () => {
    const r = lift(withRope('C · 45 kip', '210 kN'));
    ok(!r.pass && r.state.breaks.length && r.time < 1, r.reason);
  });
  test('rope A parts under the weight', () => { ok(!lift(withRope('A · 150 kN', '181 kN')).pass); });
});
