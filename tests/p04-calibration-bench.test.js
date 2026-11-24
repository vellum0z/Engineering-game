'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const SE = globalThis.SE;
const B = SE.physics.bench;

const P4 = SE.content.chapter('ch01').projects.find(p => p.id === 'P4');
const D = id => P4.deliverables.find(d => d.id === id);
const ans = (id, input) => {
  const d = D(id), r = SE.checker.check(input, d.spec);
  return { result: r, si: r.parsed && r.parsed.ok ? r.parsed.value : null, spec: d.spec };
};

suite('P4 calibration bench', () => {
  test('hand-checked keys', () => {
    near(D('P4.feed').spec.value, 18.152173913e-3, 1e-9);
    near(D('P4.ram').spec.value, 0.0126676870, 1e-8);
    near(D('P4.frame').spec.value, 253.763440860e6, 1e-9);
    near(D('P4.stay').spec.value, 6.4172088, 1e-7);
    near(D('P4.area').spec.value, 7105.2228e-6, 1e-9);
    eq(D('P4.area').spec.sf, 4);
  });
  test('feed: 3 s.f. fits, 2 s.f. and a prefix slip misfit', () => {
    const c = D('P4.feed').consequence;
    ok(/drops through/.test(c({}, ans('P4.feed', '18.2 mm/s'))));
    ok(/won't go/.test(c({}, ans('P4.feed', '18 mm/s'))));
    ok(/end stop/.test(c({}, ans('P4.feed', '18.2 μm/s'))));
  });
  test('ram: correct punches, prefix slips stall or crack', () => {
    const c = D('P4.ram').consequence;
    ok(/clean/.test(c({}, ans('P4.ram', '12.7(10^-3) m^2'))));
    ok(/stalls/.test(c({}, ans('P4.ram', '12.7 m^2'))));
    ok(/cracks/.test(c({}, ans('P4.ram', '12.7(10^-6) m^2'))));
  });
  test('frame: correct breaks through, too stiff hangs, too soft shatters', () => {
    const c = D('P4.frame').consequence;
    ok(/clean break/.test(c({}, ans('P4.frame', '254 MN/m'))));
    ok(/hanging/.test(c({}, ans('P4.frame', '254 GN/m'))));
    ok(/shattered/.test(c({}, ans('P4.frame', '254 kN/m'))));
  });
  test('scaffold pile: book seals, 5-up jams, truncate gaps', () => {
    const L = B.makeBoards(23, 30, 0.6);
    near(L[2], 2.065, 1e-12); near(L[10], 2.375, 1e-12);
    ok(Math.abs(B.fenceDrift(L, 3, 'book').drift) < 0.04);
    ok(B.fenceDrift(L, 3, 'up').drift > 0.04);
    ok(B.fenceDrift(L, 3, 'truncate').drift < -0.04);
  });
  test('stay: full precision fits, round-every-step misfits', () => {
    const c = B.chainError(B.craneSteps(), { n: 3, inputs: { h: 3.92, r: 7.26, bays: 9, k: 7 } });
    ok(Math.abs(Math.round(c.exact * 1000) / 1000 - c.exact) <= 0.0005);
    ok(Math.abs(c.rounded - c.exact) > 0.0005);
  });
});
