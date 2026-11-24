'use strict';
// H10 Measure Twice: the palisade and the mast boom, judged by the simulation.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard;

const lv = SE.content.chapter('ch01').levels.find(l => l.id === 'H10');
const jobs = {};
SE.content.walkSteps(lv.steps, s => { if (s.type === 'job') jobs[s.id] = s; });

function fence(list) {
  const dials = {}; list.forEach((t, i) => { dials['b' + (i + 1)] = t; });
  return { parts: [Y.makeInstance('h10-fence', { id: 'fence', x: 0, y: 0, dials })] };
}
function settle(design, seconds) {
  const b = Y.build(design, { g: 9.81, floor: 'concrete' });
  ok(!b.errors.length, b.errors.length && b.errors[0].error);
  for (let i = 0; i < (seconds || 4) * 60; i++) b.world.step(1 / 60);
  return b;
}
function boom(dials) {
  return { parts: [Y.makeInstance('h10-boom', { id: 'boom', x: 0.5, y: 0.6, dials: Object.assign({ hole: '6.37 m', play: '12 mm', rise: '3.53 m', reach: '6.78 m', bays: '6', node: '5' }, dials) })] };
}

suite('H10: the palisade', () => {
  const BOOK = ['1.24 m', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.34 m'];
  test('the course rule closes the run: six boards flat, no gap', () => {
    const st = settle(fence(BOOK)).parts.fence.status();
    eq(st.flat, 6); ok(Math.abs(st.gap) < 0.001, 'gap ' + st.gap);
  });
  test('chopping every reading leaves a 3 cm gap at the end post', () => {
    const st = settle(fence(['1.24 m', '1.37 m', '1.43 m', '1.16 m', '1.28 m', '1.33 m'])).parts.fence.status();
    eq(st.flat, 6); near(st.gap, 0.03, 0.01);
  });
  test('the clerk\'s 2-figure list (1200 mm ...) leaves a 4 cm gap', () => {
    const st = settle(fence(['1200 mm', '1400 mm', '1400 mm', '1200 mm', '1300 mm', '1300 mm'])).parts.fence.status();
    eq(st.flat, 6); near(st.gap, 0.04, 0.01);
  });
  test('rounding every 5 up overruns 2 cm and the last board rides up on the end post', () => {
    const b = settle(fence(['1.25 m', '1.38 m', '1.43 m', '1.17 m', '1.29 m', '1.34 m'])), st = b.parts.fence.status();
    eq(st.notFlat.join(), '5'); near(st.gap, -0.02, 0.01);
    ok(b.parts.fence.boards[5].c.y > 0.1, 'last board should sit up on the post');
  });
  test('one exact 5 rounded the wrong way is enough to fail', () => {
    const d = fence(['1.24 m', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.33 m']);
    const r = Y.judge({ design: d, site: lv.yard.site, goal: jobs['H10.fence'].goal, timeout: 15 });
    ok(!r.pass && /1\.0 cm/.test(r.reason), r.reason);
  });
  test('the saw refuses a cut between two centimetre stops', () => {
    const b = Y.build(fence(['1.245 m', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.34 m']));
    ok(b.errors.length && /saw stops/.test(b.errors[0].error), JSON.stringify(b.errors));
  });
  test('engineering notation cuts the same board as a prefix', () => {
    const a = settle(fence(['1.24(10^3) mm', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.34 m'])).parts.fence.status();
    eq(a.flat, 6); ok(Math.abs(a.gap) < 0.001);
  });
  test('the job grades board 1 for figures and the exact-5 rounding', () => {
    const spec = jobs['H10.fence'].grade.spec;
    ok(SE.checker.check('1.24 m', spec).correct, '1.24 m');
    ok(!SE.checker.check('1.25 m', spec).correct, '1.25 m rounds a 5 after an even digit up');
    ok(!SE.checker.check('1240 mm', spec).correct, '1240 mm has ambiguous trailing zeros');
  });
});

suite('H10: the mast boom', () => {
  test('the stay pin sits at 5/6 of the boom length', () => {
    const b = Y.build(boom({})).parts.boom;
    near(b.L, Math.sqrt(58.4293), 1e-9); near(b.pinX, 6.369922, 1e-6);
  });
  test('rounding every line of the sheet to 3 s.f. gives 6.40 m; full precision gives 6.37 m', () => {
    // 12.5 + 46.0 = 58.5, sqrt -> 7.65, /6 -> 1.28 (1.275 to even), x5 -> 6.40
    const r = x => SE.sigfig.roundSig(x, 3, 'book').value;
    const s = r(5 * r(r(Math.sqrt(r(r(3.53 * 3.53) + r(6.78 * 6.78)))) / 6));
    near(s, 6.40, 1e-9);
    near(SE.sigfig.roundSig(5 / 6 * Math.sqrt(3.53 * 3.53 + 6.78 * 6.78), 3, 'book').value, 6.37, 1e-9);
  });
  test('a hole inside the play seats the boom; one outside leaves it up on the stay pin', () => {
    const good = settle(boom({ hole: '6.37 m' }), 2).parts.boom.status();
    ok(good.lift < 0.002, 'lift ' + good.lift);
    const bad = settle(boom({ hole: '6.40 m' }), 2).parts.boom.status();
    near(bad.lift, 0.03, 0.05); near(bad.offset, 0.0301, 0.01);
  });
  test('close the slot to 1 mm and 6.37 m still seats (0.08 mm out), 6.38 m does not', () => {
    ok(settle(boom({ hole: '6.37 m', play: '1 mm' }), 2).parts.boom.status().lift < 0.002);
    ok(settle(boom({ hole: '6.38 m', play: '1 mm' }), 2).parts.boom.status().lift > 0.02);
  });
  test('the job grades the hole to 3 s.f. with full-precision rounding', () => {
    const spec = jobs['H10.boom'].grade.spec;
    ok(SE.checker.check('6.37 m', spec).correct);
    ok(!SE.checker.check('6.40 m', spec).correct);
    ok(!SE.checker.check('6.4 m', spec).correct);
  });
  test('a stay node at the tip is refused', () => {
    const b = Y.build(boom({ node: '6' }));
    ok(b.errors.length && /node/.test(b.errors[0].error));
  });
});

suite('H10: no answer boxes', () => {
  test('every step is a yard step or reading, never a choice or an input', () => {
    SE.content.walkSteps(lv.steps, s => ok(['say', 'build', 'watch', 'rule', 'reveal', 'job', 'free', 'deeper', 'summary'].indexOf(s.type) >= 0, s.type));
    ok(!lv.proveIt, 'no prove-it answer boxes');
  });
});
