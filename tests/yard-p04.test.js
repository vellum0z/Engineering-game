'use strict';
// P4 Calibration Bench in the yard: hand-checked figures, and what each bench
// machine does with a setting (reference builds are run in yard.test.js).
const { suite, test, eq, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, B = SE.physics.bench;

const P4 = SE.content.chapter('ch01').projects.find(p => p.id === 'P4');
const K = P4.keys;
const job = id => P4.jobs.find(j => j.id === id);
function run(id, dials) {
  const j = job(id), d = Y.cloneDesign(j.design);
  Object.assign(d.parts[0].dials, dials);
  return Y.judge({ design: d, site: P4.yard.site, goal: j.goal, timeout: j.timeout });
}

suite('P4 calibration bench (yard)', () => {
  test('hand-checked figures', () => {
    near(K.FEED, 18.152173913e-3, 1e-9);
    near(K.RAM_A, 0.0126676870, 1e-8);
    near(K.RELIEF, 43.848e6, 1e-4);
    near(K.STAY, 6.4172088, 1e-7);
    near(K.STAY_SHEET, 6.42, 1e-9);
    near(K.AREA.value, 7105.2228, 1e-9);
    eq(K.AREA_SF, 4);
  });
  test('every job is a manual yard job with a graded setting', () => {
    eq(P4.jobs.length, 5);
    P4.jobs.forEach(j => { ok(j.goal && j.design && j.grade && j.hints.length === 3, j.id); });
    ok(P4.jobs.every(j => !j.choices && !j.spec), 'no answer boxes');
  });
  test('the reference figures also grade correct', () => {
    const want = { 'P4.feed': '18.2 mm/s', 'P4.press': '43.8 MPa', 'P4.cut': '2.06 m', 'P4.stay': '6.417 m', 'P4.area': '7105 mm^2' };
    P4.jobs.forEach(j => { ok(SE.checker.check(want[j.id], j.grade.spec).correct, j.id); });
  });
  test('feed: the table stops where the real screw takes it', () => {
    const r = run('P4.feed', { feed: '18.2 mm/s' }), t = r.state.part('table');
    ok(r.pass, r.reason);
    near(t.hole, K.FEED * 0.465 / 0.0182, 1e-9);
    near(t.hole - 0.465, -1.23e-3, 0.01);
  });
  test('feed: two figures miss the flange hole by more than the 2 mm of play', () => {
    const r = run('P4.feed', { feed: '18 mm/s' });
    ok(!r.pass && /won't go/.test(r.reason), r.reason);
    near(r.state.part('table').hole - 0.465, 3.93e-3, 0.01);
  });
  test('press: dead-heads at the setting; under 483 kN stalls, over 750 kN cracks the frame', () => {
    ok(run('P4.press', { relief: '38.5 MPa' }).pass);
    ok(/stalls/.test(run('P4.press', { relief: '38.0 MPa' }).reason));
    ok(run('P4.press', { relief: '59.0 MPa' }).pass);
    ok(/cracked/.test(run('P4.press', { relief: '59.5 MPa' }).reason));
  });
  test('press: the slug shears at the plate\'s 483 kN, not at the setting', () => {
    let at = null;
    const j = job('P4.press'), d = Y.cloneDesign(j.design);
    d.parts[0].dials.relief = '55 MPa';
    Y.judge({ design: d, site: P4.yard.site, goal: j.goal, timeout: j.timeout,
      setup: s => s.world.on('break', e => { if (e.joint.label === 'slug') at = e.force; }) });
    ok(at != null); near(at, 483e3, 0.04);   // a 3-step sustained overload at 250 kN/s
  });
  test('cut: the crew reads the rule from your two boards', () => {
    const L = K.PILE;
    near(L[2], 2.065, 1e-12); near(L[10], 2.375, 1e-12);
    eq(run('P4.cut', { board3: '2.06 m', board11: '2.38 m' }).state.part('walk').rule, 'book');
    eq(run('P4.cut', { board3: '2.07 m', board11: '2.38 m' }).state.part('walk').rule, 'up');
    eq(run('P4.cut', { board3: '2.06 m', board11: '2.37 m' }).state.part('walk').rule, 'truncate');
    near(B.fenceDrift(L, 3, 'book').drift, 0.013, 1e-6);
  });
  test('stay: the pin goes home within 0.5 mm of the node, so the 4th figure matters', () => {
    ok(run('P4.stay', { mark: '6417 mm' }).pass);
    ok(!run('P4.stay', { mark: '6.418 m' }).pass);
    ok(!run('P4.stay', { mark: '6.42 m' }).pass);
  });
  test('area: the stamp must sit where the uncertainty puts the last digit', () => {
    ok(K.stampVerdict('7105 mm^2', 7105e-6).pass);
    ok(/changes from one reading/.test(K.stampVerdict('7105.2 mm^2', 7105.2e-6).why));
    ok(/throwing away/.test(K.stampVerdict('7.11(10^3) mm^2', 7110e-6).why));
    ok(K.stampVerdict('7.105(10^-3) m^2', 7105e-6).pass, 'any unit, same figures');
    const spread = Math.max(...K.READS.map(r => r.area)) - Math.min(...K.READS.map(r => r.area));
    ok(spread > 1 && spread < 10, 'the readings scatter in the units place: ' + spread);
  });
});
