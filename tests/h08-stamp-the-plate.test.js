/*
 * H8 · Stamp the Plate: equally valid answers the canonical keys don't
 * cover, and the labels the level's strict firmware must refuse.
 */
'use strict';
const { suite, test, ok } = require('./harness');
const SE = globalThis.SE;

function level() { return SE.content.allChapters().find(c => c.id === 'ch01').levels.find(l => l.id === 'H8'); }
function input(taskId, key) {
  let found = null;
  SE.content.walkSteps(level().steps, s => { if (s.id === taskId) found = s.inputs.find(i => i.key === key); });
  return found;
}
function passes(taskId, key, text) { return SE.checker.check(text, input(taskId, key).spec).correct; }

suite('H8 stamp the plate', () => {
  test('276 mg is as good as 0.276 g', () => ok(passes('H8.prefix-range', 'shim', '276 mg')));
  test('ug is accepted for μg', () => ok(passes('H8.prefix-range', 'drift', '8.72 ug')));
  test('Gs/kg and Ms/g are the same legal label', () => {
    const spec = { value: 1e9, unit: 's/kg', sf: null, form: 'si' };
    ok(SE.checker.check('1 Gs/kg', spec).correct && SE.checker.check('1 Ms/g', spec).correct);
  });
  test('a correct value in an illegal form fails only on form', () => {
    const r = SE.checker.check('2450 N', { value: 2450, unit: 'N', sf: null, form: 'si' });
    ok(!r.correct && r.parts.value && !r.parts.form);
  });
  test('ms reads as a millisecond, not a metre-second', () => {
    const q = SE.units.parseQuantity('250 ms');
    ok(SE.units.dimsName(q.dims) === 'time' && Math.abs(q.value - 0.25) < 1e-12);
  });
  test('the exponent applies to the prefix: 3 mN² = 3(10⁻⁶) N²', () => {
    const q = SE.units.parseQuantity('3 mN^2');
    ok(Math.abs(q.value - 3e-6) < 1e-18);
  });
  test('worked example values', () => {
    ok(SE.checker.check('200 kN^2', { value: 40e-3 * 5e9, unit: 'N^2', sf: null, form: 'si' }).correct);
    ok(SE.checker.check('75.0 Gm·N^2', { value: 0.3 * 0.25e12, unit: 'm·N^2', sf: 3, form: 'si' }).correct);
    ok(SE.checker.check('60.0 kN^3/kg', { value: 36e18 / 600e6, unit: 'N^3/kg', sf: 3, form: 'si' }).correct);
  });
});
