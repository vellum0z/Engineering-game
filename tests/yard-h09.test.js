'use strict';
// H9 Balance the Books: the brake controller's unit audit and what each
// formula does to the plow.
const { suite, test, ok, near, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard;

function level() { return SE.content.chapter('ch01').levels.find(l => l.id === 'H9'); }
function runDepot(formula, t) {
  const A = level().api, d = Y.cloneDesign(A.DEPOT.design);
  d.parts.push(Y.makeInstance('h09-controller', { id: 'c', a: { part: 'plow' }, dials: { formula, s: '25 m', t: t == null ? '5 s' : t } }));
  return Y.judge({ design: d, site: A.DEPOT.site, goal: A.goals.depot, timeout: 20 });
}

suite('H9 brake controller', () => {
  test('the audit gives each term its units', () => {
    const r = level().api.audit('a = 2*s/t - 2*v/t^2');
    ok(r.ok && !r.homogeneous);
    eq(r.terms.map(x => x.units).join(' | '), 'm/s | m/s³');
  });
  test('the rearranged formula balances in m/s²', () => {
    const r = level().api.audit('a = 2*s/t^2 - 2*v/t');
    ok(r.homogeneous && r.terms.every(x => x.units === 'm/s²'));
  });
  test('a pure number does not balance against an acceleration', () => { ok(!level().api.audit('a = -1').homogeneous); });
  test('the controller refuses symbols it does not know and a missing "a ="', () => {
    ok(/only knows/.test(level().api.audit('a = F/m').error));
    ok(/a =/.test(level().api.audit('s = v*t').error));
  });
  test('a formula that uses t needs the timer set', () => {
    const r = runDepot('a = -v/t', '');
    ok(!r.pass && /stop time/.test(r.reason), r.reason);
  });
  test('the slip commands +9.20 m/s² and drives the plow into the barricade', () => {
    const r = runDepot('a = 2*s/t - 2*v/t^2');
    ok(!r.pass && /barricade/.test(r.reason), r.reason);
    near(r.built.parts.c.a, 9.2, 1e-9);
  });
  test('a = 2s/t² − 2v/t gives −2.00 m/s² and stops on the line in 5 s', () => {
    const r = runDepot('a = 2*s/t^2 - 2*v/t');
    ok(r.pass, r.reason); near(r.built.parts.c.a, -2, 1e-9);
    near(r.state.pos('plow').x, 27, 0.05);
  });
  test('homogeneous slips (sign, the ½) still crash', () => {
    ['a = 2*s/t^2 + 2*v/t', 'a = s/t^2 - v/t'].forEach(f => {
      ok(level().api.audit(f).homogeneous, f);
      const r = runDepot(f); ok(!r.pass && /barricade/.test(r.reason), f + ': ' + r.reason);
    });
  });
  test('a command over the ram rating blows it and the plow runs on', () => {
    const r = runDepot('a = -20*v/t');
    ok(!r.pass && /blew its seals/.test(r.reason), r.reason);
  });
  test('braking never drives the plow backwards', () => {
    const A = level().api, d = Y.cloneDesign(A.DEPOT.design);
    d.parts.push(Y.makeInstance('h09-controller', { id: 'c', a: { part: 'plow' }, dials: { formula: 'a = -2*v/t', s: '25 m', t: '5 s' } }));
    const r2 = Y.judge({ design: d, site: A.DEPOT.site, goal: Y.goals.after(8), timeout: 9 });
    ok(r2.state.vel('plow').x >= -1e-9 && Math.abs(r2.state.vel('plow').x) < 1e-6);
    near(r2.state.pos('plow').x, 2 + 12.5, 0.05);
  });
});
