/*
 * Scoring. Motivation and feedback only: nothing is ever locked by a grade.
 *
 * A task is worth 100 points:
 *   value   50  correct within tolerance
 *   units   20  correct dimensions
 *   figures 15  correct significant figures / notation / rounding
 *   method  15  correct SI form, or a dimensionally homogeneous method
 * Parts a task does not test are awarded automatically.
 * Hints cost 5 (nudge), 15 (method) and 30 (worked step) in total for the
 * highest tier opened. Each wrong submission before the correct one costs 4,
 * capped at 20.
 */
(function (SE) {
  'use strict';

  var WEIGHTS = { value: 50, units: 20, figures: 15, method: 15 };
  var HINT_COST = [0, 5, 15, 30];

  function partsScore(result, spec) {
    spec = spec || {};
    var p = result.parts;
    var s = 0;
    if (p.value) s += WEIGHTS.value;
    if (p.units) s += WEIGHTS.units;
    var figuresTested = spec.sf !== null;
    if (!figuresTested || (p.sigfigs && p.rounding)) s += WEIGHTS.figures;
    else if (p.sigfigs || p.rounding) s += Math.round(WEIGHTS.figures / 2);
    if (p.form) s += WEIGHTS.method;
    return s;
  }

  function taskScore(opts) {
    // opts: { result, spec, hintTier, wrongAttempts }
    var base = opts.result ? partsScore(opts.result, opts.spec) : (opts.base || 0);
    var hint = HINT_COST[Math.min(opts.hintTier || 0, 3)];
    var retry = Math.min(20, 4 * (opts.wrongAttempts || 0));
    return Math.max(0, Math.min(100, base - hint - retry));
  }

  function grade(score) {
    if (score >= 95) return 'S';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    return 'C';
  }

  // Chapter mastery: mean of best scores over every required task, with
  // untouched tasks counting as zero.
  function mastery(taskIds, bests) {
    if (!taskIds.length) return 0;
    var sum = 0;
    taskIds.forEach(function (id) { sum += (bests[id] && bests[id].score) || 0; });
    return Math.round(sum / taskIds.length);
  }

  var KIND_LABEL = {
    parse: 'Unreadable input',
    unit: 'Unit error',
    concept: 'Concept error',
    conversion: 'Conversion error',
    prefix: 'Prefix / powers-of-ten error',
    sign: 'Sign error',
    algebra: 'Algebra error',
    rounding: 'Rounding error',
    sigfig: 'Significant-figure error',
    form: 'SI-form error'
  };

  SE.scoring = { WEIGHTS: WEIGHTS, HINT_COST: HINT_COST, partsScore: partsScore, taskScore: taskScore, grade: grade, mastery: mastery, KIND_LABEL: KIND_LABEL };
})(globalThis.SE);
