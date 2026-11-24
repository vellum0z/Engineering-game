'use strict';
// H7 Trade Ledger: the caravan sling, the bollard and the numbers the jobs rest on.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals, D = Y.dial;
const LB = 4.448, IN = 0.0254;

suite('H7 trade ledger', () => {
  const lv = SE.content.chapter('ch01').levels.find(l => l.id === 'H7');
  const part = (type, props) => Y.makeInstance(type, props);

  test('is a yard level with no multiple-choice or answer-box steps', () => {
    ok(lv && lv.yard, 'H7 has a yard block');
    SE.content.walkSteps(lv.steps, s => ok(['predict', 'classify', 'task', 'derive'].indexOf(s.type) < 0, 'step type ' + s.type));
  });

  test('sling plates read in FPS and mean the 4-figure factors', () => {
    const plates = Y.partDef('h07-sling').dials[0].choice;
    const want = { '120 lb': 120, '250 lb': 250, '600 lb': 600, '1 kip': 1000, '2.5 kip': 2500, '4 ton': 8000 };
    plates.forEach(p => near(D.parse(p, 'force').si, want[p] * LB, 1e-6));
  });

  test('a sling holds a still load just under its plate and snaps just over it', () => {
    const cap = 250 * LB;
    [[0.95, true], [1.05, false]].forEach(([f, holds]) => {
      const m = f * cap / 9.81;
      const d = { parts: [part('hook', { id: 'h', x: 0, y: 4.6 }), part('crate', { id: 'c', x: 0, y: 2.6, dials: { mass: m.toFixed(3) + ' kg' } }),
        part('h07-sling', { id: 's', a: { part: 'h', anchor: 'eye' }, b: { part: 'c', anchor: 'top' }, dials: { plate: '250 lb' } })] };
      const r = Y.judge({ design: d, goal: G.all(G.noBreaks(), G.after(3)), timeout: 4 });
      ok(r.pass === holds, f + ' of the plate: ' + r.reason);
      if (holds) near(r.state.read('s.tension'), m * 9.81, 0.02 * m * 9.81);
    });
  });

  test('the bollard weighs what its size and density say: 361.9 kg, 3550 N, 798 lb', () => {
    const b = Y.build({ parts: [part('h07-bollard', { id: 'b', x: 0, y: 0.6 })] });
    const m = b.parts.b.body.m;
    near(m, 2400 * Math.PI * 0.2 * 0.2 * 1.2, 1e-6);
    near(m, 361.9, 0.05);
    near(m * 9.81 / LB, 798.2, 0.1);
  });

  test('the bollard job: 1 kip is the lightest plate that holds', () => {
    const W = 361.9 * 9.81;
    ok(600 * LB < W && 1000 * LB > W, 'window');
    near(W / (1000 * LB), 0.80, 0.01);
  });

  test('the hatch window: 27.2 psi to 46.9 psi on a 100 mm bore', () => {
    const psi = LB / (IN * IN), A = Math.PI * 0.1 * 0.1 / 4, W = 150 * 9.81, strap = 2 * 120 * LB;
    near(D.parse('32.0 psi', 'pressure').si, 32 * psi, 1e-6);
    near(32 * psi, 220.6e3, 50);
    near(32 * psi * A, 1733, 1);
    near(W / A / psi, 27.2, 0.05);
    near((W + strap) / A / psi, 46.9, 0.05);
  });

  test('every job has a passing and a failing reference build', () => {
    SE.content.walkSteps(lv.steps, s => {
      if (s.type !== 'job') return;
      const sol = lv.solutions[s.id] || [];
      ok(sol.some(b => b.pass !== false) && sol.some(b => b.pass === false), s.id);
    });
  });
});
