'use strict';
// P6 Settlement Standard in the yard: the numbers behind each job, the graded
// settings, and what the simulation does with common slips.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard;

const P6 = SE.content.chapter('ch01').projects.find(p => p.id === 'P6');
const job = id => P6.jobs.find(j => j.id === id);

function run(id, build) {
  const j = job(id), d = Y.cloneDesign(j.design);
  (build.add || []).forEach(q => d.parts.push(Y.makeInstance(q.type, q)));
  Object.keys(build.set || {}).forEach(pid => Object.assign(d.parts.find(q => q.id === pid).dials, build.set[pid]));
  return Y.judge({ design: d, site: (j.yard && j.yard.site) || P6.yard.site, goal: j.goal, timeout: j.timeout || 30 });
}
const winch = (pull, extra) => ({ id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: Object.assign({ pull }, extra || {}) });

suite('P6 settlement standard: graded settings', () => {
  P6.jobs.filter(j => j.grade).forEach(j => {
    const g = j.grade;
    test(j.id + ' canonical setting "' + g.answer + '" passes its spec', () => {
      const r = SE.checker.check(g.answer, g.spec);
      ok(r.correct, r.errors.map(e => e.kind + ': ' + e.msg).join(' | '));
    });
    (g.wrong || []).forEach(w => test(j.id + ' rejects "' + w.input + '" as ' + w.kind, () => {
      const r = SE.checker.check(w.input, g.spec);
      ok(!r.correct, 'accepted'); eq(r.kind, w.kind, 'error kind');
    }));
  });
  test('the site runs on the pendulum g, 9.800 m/s² to 4 s.f.', () => {
    eq(SE.sigfig.roundSig(P6.yard.site.g, 4).text, '9.800');
  });
});

suite('P6 settlement standard: the comparator', () => {
  test('with no rider the beam goes down on the lab standard side', () => {
    const r = run('P6.kilo', { set: { comparator: { cert: '0.99970 kg' } } });
    ok(!r.pass && /lab standard/.test(r.reason), r.reason);
  });
  test('about 5° per gram: 0.300 g of difference settles near 1.5°', () => {
    const r = run('P6.kilo', { set: { comparator: { cert: '0.99970 kg' } } });
    near(Math.abs(r.state.part('comparator').tilt()) * 180 / Math.PI, 1.5, 0.05);
  });
  test('a rider 0.01 g off does not read level', () => {
    ok(!run('P6.kilo', { set: { comparator: { rider: '0.310 g', cert: '0.99969 kg' } } }).pass);
  });
});

suite('P6 settlement standard: shipping', () => {
  const crew = t => { const r = run('P6.ship', { set: { trailer: { ticket: t } } }); return { r, cls: r.built.parts.trailer.cls.name }; };
  test('the ledger\'s 272 lb sends a wheelbarrow, and its axle snaps', () => {
    const { r, cls } = crew('272 lb'); eq(cls, 'wheelbarrow'); ok(!r.pass && /axle/.test(r.reason), r.reason);
  });
  test('2.72 kip sends the utility trailer and the tank reaches the tower base', () => {
    const { r, cls } = crew('2.72 kip'); eq(cls, 'utility trailer'); ok(r.pass, r.reason);
  });
  test('an SI ticket of the right size works too (the grade asks for FPS)', () => { ok(crew('12.1 kN').r.pass); });
  test('an oversized ticket takes the flatbed and costs margin', () => {
    const { r, cls } = crew('5 kip'); eq(cls, 'flatbed'); ok(r.pass); eq(job('P6.ship').margin(r.state), 15);
  });
});

suite('P6 settlement standard: proof hover and lift', () => {
  test('every graded part is placed by the job, so the grade can find it by id', () => {
    P6.jobs.filter(j => j.grade).forEach(j => ok(j.design.parts.some(p => p.id === j.grade.part), j.id + ' grades ' + j.grade.part));
  });
  test('12.10 kN lifts the tank clear by about a centimetre in six seconds', () => {
    const r = run('P6.hover', { set: { winch: { pull: '12.10 kN' } } });
    ok(r.pass, r.reason);
    const rise = r.state.pos('tank').y - 0.5;
    ok(rise > 0.005 && rise < 0.015, 'rise ' + rise);
  });
  test('standard gravity (12.11 kN) creeps off the chalk mark', () => {
    const r = run('P6.hover', { set: { winch: { pull: '12.11 kN' } } }); ok(!r.pass && /creeping/.test(r.reason), r.reason);
  });
  test('a pull below the weight leaves the tank on the slab, not through it', () => {
    const r = run('P6.hover', { set: { winch: { pull: '12.09 kN' } } });
    ok(!r.pass && /never leaves/.test(r.reason), r.reason);
    near(r.state.pos('tank').y, 0.5, 0.01);
  });
  test('lift-off at 12.6 kN is measured at 0.40 m/s²', () => {
    const r = run('P6.lift', { add: [winch('12.6 kN', { rating: '3000 lb', speed: '0.5 m/s' })], set: { plate: { mass: '1.23 Mg' } } });
    ok(r.pass, r.reason); near(r.state.memo.a, 0.405, 0.03);
  });
  test('a 1000x prefix slip on the pull is refused by the crane log, not ignored', () => {
    const r = run('P6.lift', { add: [winch('12.6 MN', { rating: '3000 lb', speed: '0.5 m/s' })] });
    ok(!r.pass, 'passed');
  });
  test('the heaviest line on the rack holds but costs margin', () => {
    const r = run('P6.lift', { add: [winch('12.6 kN', { rating: '15.0 kN', speed: '0.5 m/s' })] });
    ok(r.pass, r.reason); eq(job('P6.lift').margin(r.state), 10);
  });
  test('the 3/8 in wire rope (2.50 kip) parts at lift-off', () => {
    const r = run('P6.lift', { add: [winch('12.6 kN', { rating: '2.50 kip', speed: '0.5 m/s' })] });
    ok(!r.pass && /broke/.test(r.reason), r.reason);
  });
  test('a chain is not on the rack, so the crew refuses it', () => {
    const r = run('P6.lift', { add: [{ type: 'chain', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' } }] });
    ok(!r.pass && /rack/.test(r.reason), r.reason);
  });
  test('a two-fall tackle halves the line tension, so the lightest rack line holds with no points off', () => {
    const sol = P6.solutions['P6.lift'][1], r = run('P6.lift', sol);
    ok(r.pass, r.reason); eq(job('P6.lift').margin(r.state), 0);
  });
});

suite('P6 settlement standard: any rig that works', () => {
  test('with the tow off, the ledger figure still snaps the wheelbarrow axle', () => {
    const r = run('P6.ship', { set: { trailer: { ticket: '272 lb', haul: '0 m' } } });
    ok(!r.pass && /axle/.test(r.reason), r.reason);
  });
  test('every job has at least two passing reference builds', () => {
    P6.jobs.forEach(j => ok([].concat(P6.solutions[j.id]).filter(b => b.pass !== false).length >= 2, j.id));
  });
  test('every job has an objective of about ten words or fewer', () => {
    P6.jobs.forEach(j => ok(j.objective && j.objective.split(/\s+/).length <= 12, j.id + ': ' + j.objective));
  });
});
