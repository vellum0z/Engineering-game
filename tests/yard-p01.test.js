'use strict';
// P1 Ridge Station Winch: the job parts behave like the physics they stand for.
const { suite, test, near, ok } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;
const P1 = SE.content.chapter('ch01').projects.find(p => p.id === 'P1');
const job = id => P1.jobs.find(j => j.id === id);
const G_SITE = SE.physics.gravity.gSite(12, 2400);

function rig(id, dials) {
  const j = job(id), d = Y.cloneDesign(j.design);
  Object.assign(d.parts.find(p => p.id === 'gov').dials, dials);
  return { design: d, site: (j.yard && j.yard.site) || P1.yard.site };
}

suite('P1 ridge station winch', () => {
  test('the yard runs at the ridge gravity (hand-check 9.775 m/s²)', () => {
    near(G_SITE, 9.775153, 1e-5);
    near(P1.yard.site.g, G_SITE, 1e-12);
  });
  test('a hover at T = m g_site holds still with the trim barely used', () => {
    const { design, site } = rig('P1.hover', { tension: '18.08 kN' });
    const r = Y.judge({ design, site, goal: G.after(20), timeout: 21 });
    const gov = r.state.part('gov');
    near(gov.setting, 18080, 1e-9);
    ok(Math.abs(r.state.pos('gen').y - 1.9) < 0.005, 'drift ' + (r.state.pos('gen').y - 1.9));
    ok(Math.abs(gov.trimUsed) / gov.trimLimit < 0.2, 'trim ' + gov.trimUsed);
  });
  test('the governor keeps 4 figures of whatever is typed', () => {
    const { design, site } = rig('P1.hover', { tension: '18084.04 N' });
    near(Y.build(design, site).parts.gov.setting, 18080, 1e-9);
  });
  test('a 9.81 setting saturates the trim and the leftover force accelerates the load (a = ΣF/m)', () => {
    const { design, site } = rig('P1.hover', { tension: '18.15 kN' });
    const r = Y.judge({ design, site, goal: G.after(3), timeout: 4 });
    const W = 1850 * G_SITE, residual = 18150 - W - 0.002 * 18150;
    const gov = r.state.part('gov');
    near(gov.trimUsed, -gov.trimLimit, 1e-9);
    // after saturation the acceleration is the residual over the mass
    const v1 = r.state.vel('gen').y;
    const r2 = Y.judge({ design, site, goal: G.after(4), timeout: 5 });
    near((r2.state.vel('gen').y - v1) / 1, residual / 1850, 0.02 * residual / 1850);
  });
  test('the backup winch in mass mode pulls m · (its measured g)', () => {
    const { design, site } = rig('P1.slug', { mass: '126.8 slug' });
    const b = Y.build(design, site);
    near(b.parts.gov.setting, 126.8 * 14.59 * G_SITE, 1e-6);
  });
  test('the backup dial only takes the units printed on it', () => {
    ok(Y.build(rig('P1.lb', { tension: '18.08 kN' }).design, P1.yard.site).errors.length > 0);
    ok(Y.build(rig('P1.slug', { mass: '1850 kg' }).design, P1.yard.site).errors.length > 0);
    ok(Y.build(rig('P1.hover', { tension: '4066 lb' }).design, P1.yard.site).errors.length > 0);
  });
  test('the depot checkweigher reads m · 9.81 for each crate', () => {
    const j = job('P1.tags'), d = Y.cloneDesign(j.design);
    [['crystal', '728 mN'], ['bearing', '626 N'], ['xfmr', '82.9 kN']].forEach(([id, t]) => { d.parts.find(p => p.id === id).dials.tag = t; });
    const r = Y.judge({ design: d, site: j.yard.site, goal: G.after(2.5), timeout: 3 });
    [['crystal', 0.0742], ['bearing', 63.8], ['xfmr', 8450]].forEach(([id, m]) => {
      near(r.state.part('cw-' + id).reading, m * 9.81, 5e-4 * m * 9.81);
    });
  });
});
