'use strict';
// Scoring: part weights, hint and retry costs, grades and chapter mastery.
const { suite, test, eq, ok } = require('./harness');
const Sc = globalThis.SE.scoring;

function parts(over) {
  return { parts: Object.assign({ value: true, units: true, sigfigs: true, form: true, rounding: true }, over || {}) };
}

suite('scoring: weights', () => {
  test('weights add to 100', () => {
    const W = Sc.WEIGHTS;
    eq(W.value + W.units + W.figures + W.method, 100);
    eq(W.value, 50); eq(W.units, 20); eq(W.figures, 15); eq(W.method, 15);
  });
  test('everything right is 100', () => eq(Sc.partsScore(parts()), 100));
  test('wrong value only: 100 − 50 = 50', () => eq(Sc.partsScore(parts({ value: false })), 50));
  test('wrong units and value: figures 15 + method 15 = 30', () => {
    eq(Sc.partsScore(parts({ value: false, units: false })), 30);
  });
  test('half the figures points when only one of sig figs / rounding is right', () => {
    // 50 + 20 + round(7.5) + 15 = 50 + 20 + 8 + 15 = 93
    eq(Sc.partsScore(parts({ sigfigs: false })), 93);
    eq(Sc.partsScore(parts({ rounding: false })), 93);
  });
  test('no figures points when both are wrong: 85', () => {
    eq(Sc.partsScore(parts({ sigfigs: false, rounding: false })), 85);
  });
  test('figures are awarded automatically when the task does not test them (sf: null)', () => {
    eq(Sc.partsScore(parts({ sigfigs: false, rounding: false }), { sf: null }), 100);
    // sf undefined still means "tested" (the checker defaults to 3)
    eq(Sc.partsScore(parts({ sigfigs: false, rounding: false }), {}), 85);
  });
  test('wrong form loses the method points: 85', () => eq(Sc.partsScore(parts({ form: false })), 85));
  test('everything wrong is 0', () => {
    eq(Sc.partsScore(parts({ value: false, units: false, sigfigs: false, rounding: false, form: false })), 0);
  });
  test('with a real checker result', () => {
    // "3.55 N" for 3.5587 N: value inside tolerance, misrounded → 93
    const r = globalThis.SE.checker.check('3.55 N', { value: 3.5587, unit: 'N' });
    eq(Sc.partsScore(r, { value: 3.5587, unit: 'N' }), 93);
    const p = globalThis.SE.checker.check('kN', { value: 1, unit: 'N' });
    eq(Sc.partsScore(p, {}), 0);
  });
});

suite('scoring: hints and retries', () => {
  test('hint costs are 0, 5, 15, 30 for the highest tier opened', () => {
    eq(Sc.HINT_COST.join(','), '0,5,15,30');
    eq(Sc.taskScore({ result: parts(), hintTier: 0 }), 100);
    eq(Sc.taskScore({ result: parts(), hintTier: 1 }), 95);
    eq(Sc.taskScore({ result: parts(), hintTier: 2 }), 85);
    eq(Sc.taskScore({ result: parts(), hintTier: 3 }), 70);
  });
  test('tiers above 3 cost the same as 3', () => eq(Sc.taskScore({ result: parts(), hintTier: 7 }), 70));
  test('each wrong attempt costs 4, capped at 20', () => {
    eq(Sc.taskScore({ result: parts(), wrongAttempts: 1 }), 96);
    eq(Sc.taskScore({ result: parts(), wrongAttempts: 2 }), 92);
    eq(Sc.taskScore({ result: parts(), wrongAttempts: 5 }), 80);
    eq(Sc.taskScore({ result: parts(), wrongAttempts: 12 }), 80);
  });
  test('hints and retries stack: 100 − 30 − 20 = 50', () => {
    eq(Sc.taskScore({ result: parts(), hintTier: 3, wrongAttempts: 5 }), 50);
    // 85 − 15 − 8 = 62
    eq(Sc.taskScore({ result: parts({ form: false }), hintTier: 2, wrongAttempts: 2 }), 62);
  });
  test('never below 0 or above 100', () => {
    // 30 − 30 − 20 = −20 → 0
    eq(Sc.taskScore({ result: parts({ value: false, units: false }), hintTier: 3, wrongAttempts: 5 }), 0);
    eq(Sc.taskScore({ base: 140 }), 100);
  });
  test('a precomputed base score', () => {
    eq(Sc.taskScore({ base: 77, hintTier: 1 }), 72);
    eq(Sc.taskScore({}), 0);
  });
});

suite('scoring: grades', () => {
  test('boundaries S ≥ 95, A ≥ 85, B ≥ 70, else C', () => {
    eq(Sc.grade(100), 'S');
    eq(Sc.grade(95), 'S');
    eq(Sc.grade(94), 'A');
    eq(Sc.grade(85), 'A');
    eq(Sc.grade(84), 'B');
    eq(Sc.grade(70), 'B');
    eq(Sc.grade(69), 'C');
    eq(Sc.grade(0), 'C');
  });
  test('one nudge hint still earns an S; a method hint does not', () => {
    eq(Sc.grade(Sc.taskScore({ result: parts(), hintTier: 1 })), 'S'); // 95
    eq(Sc.grade(Sc.taskScore({ result: parts(), hintTier: 2 })), 'A'); // 85
  });
});

suite('scoring: mastery', () => {
  test('mean of best scores, untouched tasks count as zero', () => {
    // (100 + 85 + 0) / 3 = 61.67 → 62
    eq(Sc.mastery(['a', 'b', 'c'], { a: { score: 100 }, b: { score: 85 } }), 62);
  });
  test('all perfect is 100', () => eq(Sc.mastery(['a', 'b'], { a: { score: 100 }, b: { score: 100 } }), 100));
  test('bests for tasks outside the list are ignored', () => {
    eq(Sc.mastery(['a'], { a: { score: 70 }, z: { score: 100 } }), 70);
  });
  test('rounds to the nearest whole point', () => {
    // (95 + 96) / 2 = 95.5 → 96
    eq(Sc.mastery(['a', 'b'], { a: { score: 95 }, b: { score: 96 } }), 96);
  });
  test('no tasks is 0', () => eq(Sc.mastery([], {}), 0));
});

suite('scoring: labels', () => {
  test('every checker error kind has a label', () => {
    ['parse', 'unit', 'concept', 'conversion', 'prefix', 'sign', 'algebra', 'rounding', 'sigfig', 'form'].forEach(k => {
      ok(typeof Sc.KIND_LABEL[k] === 'string' && Sc.KIND_LABEL[k].length > 0, k);
    });
  });
});
