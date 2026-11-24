'use strict';
// P2 Caravan Manifest: the job-only parts do what the hand-checks say.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard;
const P2 = () => SE.content.chapter('ch01').projects.find(p => p.id === 'P2');
const job = id => P2().jobs.find(j => j.id === id);
const LB = 4.448, FT = 0.3048, G = 9.81;

function design(id, dials, add) {
  const d = Y.cloneDesign(job(id).design);
  Object.keys(dials || {}).forEach(pid => Object.assign(d.parts.find(p => p.id === pid).dials, dials[pid]));
  (add || []).forEach(p => d.parts.push(Y.makeInstance(p.type, p)));
  return d;
}
const run = (id, d, t) => Y.judge({ design: d, site: P2().yard.site, goal: Y.goals.after(t), timeout: t + 1 });

suite('P2 caravan manifest: parts against the hand-checks', () => {
  test('the convoy weighs 8.75 ton + 14.2 kip + 3 x 3880 lb = 193 kN', () => {
    const b = Y.build(design('P2.convoy', { convoy: { crates: '3' } }), P2().yard.site), c = b.parts.convoy;
    const W = (c.body.m + c.crates.reduce((s, x) => s + x.m, 0)) * G;
    near(W, 43340 * LB, 1e-6); near(W / 1000, 192.8, 0.05);
  });
  test('left-behind crates wait on the near bank and do not move', () => {
    const r = run('P2.convoy', design('P2.convoy', { convoy: { crates: '1' } }), 3);
    ok(r.state.part('convoy').crates.length === 1);
  });
  test('the bridge reads the live load of two crates and the rig (176 kN)', () => {
    const d = design('P2.convoy', { convoy: { crates: '2' } });
    const r = Y.judge({ design: d, site: P2().yard.site, goal: s => s.t > 11 ? 'pass' : null, timeout: 12 });
    near(r.state.read('bridge.load') / 1000, 175.5, 1.5);
  });
  test('a push of F for t on the rail car gives v = F t / m with m = 30 800 lb / g', () => {
    const m = 30800 * LB / G;
    const r = run('P2.couple', design('P2.couple', null, [{ type: 'push', a: { part: 'car' }, dials: { force: '10 kN', time: '2 s' } }]), 3);
    near(r.state.vel('car').x, 20000 / m, 1e-3);
  });
  test('4 mi/h is 1.79 m/s', () => { near(4 * 5280 * FT / 3600, 1.788, 1e-3); });
  test('the tanker carries rho A h of mud at 3.42 slug/ft^3 = 1762 kg/m^3', () => {
    const b = Y.build(design('P2.mud', { tanker: { fill: '1.5 m' } }), P2().yard.site);
    near(b.parts.tanker.cargo, 1.5 * 3.42 * 14.59 / Math.pow(FT, 3), 1e-6);
    const r = run('P2.mud', design('P2.mud', { tanker: { fill: '1.5 m' } }), 2);
    near(r.state.read('tanker.load'), b.parts.tanker.cargo * G, 30);
  });
  test('the air bag settles where p A (h0/h)^1.3 = W', () => {
    const W = 118 * LB / (0.0254 * 0.0254) * Math.PI / 4 * Math.pow(8 * 0.0254, 2), A = Math.PI / 4 * 0.25 * 0.25;
    const r = run('P2.air', design('P2.air', { flatbed: { pressure: '500 kPa' } }), 5);
    near(r.state.read('flatbed.height'), 0.3 * Math.pow(500e3 * A / W, 1 / 1.3), 1e-3);
  });
  test('a counterweight block weighs 968 lb, so three put 2 904 lb on the wagon', () => {
    const r = run('P2.blocks', design('P2.blocks', { wagon: { blocks: '3' } }), 2);
    near(r.state.read('wagon.load') / LB, 3 * 968.1, 5);
  });
  test('a non-whole crate count is refused before the run', () => {
    const b = Y.build(design('P2.convoy', { convoy: { crates: '1.5' } }), P2().yard.site);
    ok(b.errors.length && /whole number/.test(b.errors[0].error), JSON.stringify(b.errors));
  });
});
