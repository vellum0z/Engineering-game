'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const SE = globalThis.SE;
const B = SE.physics.bench;
const stub = { shake() {}, burst() {}, flash() {} };

function runHeadless(params, runOpts, seconds) {
  const s = new SE.scenes.bench();
  s.init(stub, params);
  s.resize(800, 500);
  s.run(runOpts);
  const n = Math.round((seconds || 20) * 240);
  for (let i = 0; i < n && !s.result; i++) s.step(1 / 240);
  return s;
}

suite('bench: fence rounding bias', () => {
  // Four boards cut to 3 s.f.:
  //   1.235: dropped exact 5 after odd 3   book 1.24  up 1.24  trunc 1.23
  //   2.345: dropped exact 5 after even 4  book 2.34  up 2.35  trunc 2.34
  //   1.004:                               book 1.00  up 1.00  trunc 1.00
  //   2.996:                               book 3.00  up 3.00  trunc 2.99
  // true total 7.580; book 7.58 (0), up 7.59 (+1 cm), truncate 7.56 (-2 cm)
  const L = [1.235, 2.345, 1.004, 2.996];
  test('true total', () => near(B.fenceDrift(L, 3, 'book').trueTotal, 7.58, 1e-12));
  test('book rule: no drift', () => { const r = B.fenceDrift(L, 3, 'book'); near(r.total, 7.58, 1e-12); near(r.drift, 0, 1e-12); });
  test('always-up rule: +10 mm', () => { const r = B.fenceDrift(L, 3, 'up'); near(r.total, 7.59, 1e-12); near(r.drift, 0.010, 1e-9); });
  test('truncate: -20 mm', () => { const r = B.fenceDrift(L, 3, 'truncate'); near(r.total, 7.56, 1e-12); near(r.drift, -0.020, 1e-9); });
  test('running drift accumulates per board', () => {
    const r = B.fenceDrift(L, 3, 'truncate');
    near(r.running[0], -0.005, 1e-9); near(r.running[1], -0.010, 1e-9); near(r.running[3], -0.020, 1e-9);
  });
  test('board pile is deterministic, 4 s.f., many exact 5s', () => {
    const a = B.makeBoards(7, 30, 0.6), b = B.makeBoards(7, 30, 0.6);
    eq(a.join(), b.join());
    ok(a.every(x => SE.sigfig.countSigFigs(x.toFixed(3)).max === 4), 'all 4 s.f.');
    ok(a.filter(x => Math.round(x * 1000) % 10 === 5).length >= 12, 'plenty end in 5');
  });
  test('default pile: book seals, up jams, truncate breaches', () => {
    const L2 = B.makeBoards(7, 30, 0.6);
    ok(Math.abs(B.fenceDrift(L2, 3, 'book').drift) < 0.02, 'book small');
    ok(B.fenceDrift(L2, 3, 'up').drift > 0.04, 'up overruns');
    ok(B.fenceDrift(L2, 3, 'truncate').drift < -0.04, 'truncate gaps');
  });
  test('scene outcomes', () => {
    eq(runHeadless({ mode: 'fence' }, { rule: 'book' }).result.outcome, 'sealed');
    eq(runHeadless({ mode: 'fence' }, { rule: 'up' }).result.outcome, 'jammed');
    eq(runHeadless({ mode: 'fence' }, { rule: 'truncate' }).result.outcome, 'breached');
  });
});

suite('bench: chained rounding', () => {
  // 1.25 * 1.25 = 1.5625 -> 1.56 at 3 s.f.; * 3 = 4.68 vs exact 4.6875
  const steps = [{ op: 'mul', args: ['x', 'x'] }, function (r) { return r[0] * 3; }];
  test('ops and function steps', () => {
    const c = B.chainError(steps, { inputs: { x: 1.25 } });
    near(c.exact, 4.6875, 1e-12); near(c.rounded, 4.68, 1e-12); near(c.error, -0.0075, 1e-9);
  });
  test('crane boom: exact vs rounded bolt', () => {
    // L = sqrt(4.37^2 + 6.85^2) = 8.125232; s = 5 L / 7 = 5.803737 m
    // rounded: 19.1 + 46.9 = 66.0, sqrt 8.12, /7 = 1.16, *5 = 5.80 m
    const c = B.chainError(B.craneSteps(), { inputs: { h: 4.37, r: 6.85, bays: 7, k: 5 } });
    near(c.exact, 5 * Math.hypot(4.37, 6.85) / 7, 1e-12);
    near(c.rounded, 5.80, 1e-12);
  });
  test('scene: rounding each step misfits, full precision fits', () => {
    eq(runHeadless({ mode: 'chain' }, { keep: 'round' }).result.outcome, 'misfit');
    eq(runHeadless({ mode: 'chain' }, { keep: 'full' }).result.outcome, 'fits');
  });
});

suite('bench: uncertainty propagation', () => {
  test('sum: RSS and worst case', () => {
    const r = B.propagate('sum', [2, 3], [0.3, 0.4]);
    near(r.value, 5); near(r.abs, 0.5); near(r.worstAbs, 0.7); near(r.rel, 0.1);
  });
  test('difference', () => {
    const r = B.propagate('difference', [10, 4], [0.3, 0.4]);
    near(r.value, 6); near(r.abs, 0.5); near(r.rel, 0.5 / 6);
  });
  test('product: relative RSS', () => {
    // 3 % and 4 % -> 5 % RSS, 7 % worst; 20 * 0.05 = 1.0
    const r = B.propagate('product', [4, 5], [0.12, 0.2]);
    near(r.value, 20); near(r.rel, 0.05); near(r.abs, 1.0); near(r.worstRel, 0.07); near(r.worstAbs, 1.4);
  });
  test('quotient', () => {
    const r = B.propagate('quotient', [10, 2], [0.3, 0.08]);
    near(r.value, 5); near(r.rel, 0.05); near(r.abs, 0.25);
  });
  test('power: rel scales by |p|', () => {
    const r = B.propagate('power', [2, 3], [0.02]);
    near(r.value, 8); near(r.rel, 0.03); near(r.abs, 0.24);
  });
  test('justified figures', () => {
    eq(B.sigFigsJustified(1022.33, 1.06), 4);
    eq(B.sigFigsJustified(20, 1.0), 2);
    eq(B.sigFigsJustified(0.012345, 0.0004), 3);  // 0.0123 ± 0.0004
  });
  test('vernier reading', () => {
    const r = B.vernierRead(48.367, 0.02);
    eq(r.nv, 50); eq(r.main, 48); eq(r.k, 18); near(r.reading, 48.36);
  });
  test('caliper scene', () => {
    const s = runHeadless({ mode: 'caliper' }, { sf: 4 });
    eq(s.result.outcome, 'justified');
    near(s.result.detail.area, 48.36 * 21.14, 1e-12);
    eq(runHeadless({ mode: 'caliper' }, { sf: 6 }).result.outcome, 'overclaimed');
  });
});
