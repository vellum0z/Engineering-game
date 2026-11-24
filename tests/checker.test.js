'use strict';
// Answer checker: accepted forms, error classification, tolerance, options.
const { suite, test, eq, near, ok } = require('./harness');
const C = globalThis.SE.checker;

const kinds = r => r.errors.map(e => e.kind).join(',');
// A 4.62 kN force, e.g. a 471 kg load's weight: 471 · 9.81 = 4620.51 N.
const F = { value: 4620.51, unit: 'N' };

suite('checker: correct answers in equivalent forms', () => {
  test('4.62 kN is correct', () => {
    const r = C.check('4.62 kN', F);
    ok(r.correct, kinds(r));
    eq(r.kind, null);
    eq(r.correctRounding, '4.62');
  });
  test('4.62(10^3) N, 4.62(10³) N, 4.62e3 N and 4.62 × 10^3 N are correct', () => {
    ['4.62(10^3) N', '4.62(10³) N', '4.62e3 N', '4.62 × 10^3 N'].forEach(s => {
      const r = C.check(s, F);
      ok(r.correct, s + ': ' + kinds(r));
    });
  });
  test('4620 N has the right value but ambiguous sig figs', () => {
    const r = C.check('4620 N', F);
    ok(!r.correct);
    ok(r.parts.value); ok(r.parts.units);
    eq(r.parts.sigfigs, false);
    eq(r.kind, 'sigfig');
    ok(/ambiguous/.test(r.errors[0].msg));
  });
  test('4620. N (decimal point) has 4 s.f., so it is a sig-fig error, not ambiguous', () => {
    // 4620 is the correct 4 s.f. rounding of 4620.4, so only the count is wrong
    const r = C.check('4620. N', { value: 4620.4, unit: 'N' });
    eq(r.kind, 'sigfig');
    ok(/you gave 4/.test(r.errors[0].msg), r.errors[0].msg);
  });
  test('compound units: 9.81 m/s² and 9.81 N/kg are the same thing', () => {
    const g = { value: 9.80665, unit: 'm/s^2' };
    ok(C.check('9.81 m/s^2', g).correct);
    ok(C.check('9.81 N/kg', g).correct);
  });
  test('FPS answer: 1.00 lb for 4.448 N', () => {
    ok(C.check('1.00 lb', { value: 4.448, unit: 'N' }).correct);
  });
  test('negative expected values', () => {
    ok(C.check('-4.62 kN', { value: -4620.51, unit: 'N' }).correct);
  });
  test('readAs echoes how the input was read', () => {
    eq(C.check('4.62(10^3) kg·m/s^2', F).readAs, '4.62(10³) kg·m/s²');
  });
  test('ms gets a note about the millisecond reading', () => {
    const r = C.check('5.00 ms', { value: 0.005, unit: 's' });
    ok(r.correct);
    eq(r.notes.length, 1);
    ok(/m·s/.test(r.notes[0]));
  });
});

suite('checker: error kinds', () => {
  test('parse: no number, unknown unit', () => {
    const a = C.check('kN', F);
    eq(a.kind, 'parse'); ok(!a.correct);
    eq(a.parts.sigfigs, false);
    eq(C.check('4.62 kQ', F).kind, 'parse');
    eq(C.check('', F).kind, 'parse');
  });
  test('unit: a length where a force is needed', () => {
    const r = C.check('4.62 km', F);
    eq(r.kind, 'unit');
    eq(r.parts.units, false); eq(r.parts.value, false);
    ok(/length/.test(r.errors[0].msg) && /force/.test(r.errors[0].msg));
  });
  test('concept: mass given for a weight', () => {
    // writing the mass 471 kg for a 4.62 kN weight
    const r = C.check('471 kg', F);
    eq(r.kind, 'concept');
    ok(/W = mg/.test(r.errors[0].msg));
  });
  test('concept: weight given for a mass', () => {
    eq(C.check('4.62 kN', { value: 471, unit: 'kg' }).kind, 'concept');
  });
  test('concept: right units, off by g (forgot to multiply by 9.81)', () => {
    // 20.0 kg → W = 20.0 · 9.81 = 196.2 N; writing "20.0 N" is W/g
    const r = C.check('20.0 N', { value: 196.2, unit: 'N' });
    eq(r.kind, 'concept');
    ok(/9\.81/.test(r.errors[0].msg));
  });
  test('concept: g = 32.2 ft/s² in FPS', () => {
    // 10.0 slug → W = 322 lb = 1432.256 N; "10.0 lb" is off by 32.2
    const r = C.check('10.0 lb', { value: 322 * 4.448, unit: 'N' });
    eq(r.kind, 'concept');
    ok(/32\.2/.test(r.errors[0].msg));
  });
  test('conversion: lb↔N factor skipped', () => {
    // 100 lb = 444.8 N; "100 N" is 1/4.448 of it
    const r = C.check('100 N', { value: 444.8, unit: 'N', sf: null });
    eq(r.kind, 'conversion');
    ok(/4\.448/.test(r.errors.find(e => e.kind === 'conversion').msg));
  });
  test('conversion: ft↔m factor applied the wrong way', () => {
    // 10.0 ft = 3.048 m; dividing instead gives 10/0.3048 = 32.8 m
    const r = C.check('32.8 m', { value: 3.048, unit: 'm' });
    eq(r.kind, 'conversion');
    ok(/0\.3048/.test(r.errors[0].msg));
  });
  test('conversion: area factor is the square of the length factor', () => {
    // 1.00 ft² = 0.092903 m²; "1.00 m²" is off by 1/0.3048²
    const r = C.check('1.00 m^2', { value: 0.3048 * 0.3048, unit: 'm^2' });
    eq(r.kind, 'conversion');
    ok(/0\.3048²/.test(r.errors[0].msg), r.errors[0].msg);
    ok(/area units square/.test(r.errors[0].msg), r.errors[0].msg);
  });
  test('conversion: 144 is named as the in²↔ft² factor, not 12 applied twice', () => {
    ok(/12² = 144/.test(C.classifyRatio(144, {}).msg));
  });
  test('conversion: in↔ft factor 12', () => {
    // 6.00 in = 0.1524 m; "6.00 ft" = 1.8288 m is 12× too big
    eq(C.check('6.00 ft', { value: 0.1524, unit: 'm' }).kind, 'conversion');
  });
  test('conversion: slug↔kg factor', () => {
    // 2.00 slug = 29.18 kg; "2.00 kg" is 1/14.59 of it
    const r = C.check('2.00 kg', { value: 29.18, unit: 'kg' });
    eq(r.kind, 'conversion');
    ok(/14\.59/.test(r.errors[0].msg));
  });
  test('prefix: ×1000 slip (wrote N for kN)', () => {
    const r = C.check('4.62 N', F);
    eq(r.kind, 'prefix');
    ok(/10\^-3/.test(r.errors[0].msg) && /prefix/.test(r.errors[0].msg), r.errors[0].msg);
  });
  test('prefix: ×1000 slip the other way (MN for kN)', () => {
    const r = C.check('4.62 MN', F);
    eq(r.kind, 'prefix');
    ok(/10\^3/.test(r.errors[0].msg));
  });
  test('prefix kind but a decimal-place message for 10^1 slips', () => {
    const r = C.check('462 N', F);
    eq(r.kind, 'prefix');
    ok(/decimal place/.test(r.errors[0].msg));
  });
  test('sign', () => {
    eq(C.check('-4.62 kN', F).kind, 'sign');
  });
  test('algebra: factor of 2', () => {
    // 2310.255 N ≈ 2.31 kN, exactly half
    eq(C.check('2.31 kN', F).kind, 'algebra');
  });
  test('algebra: some other ratio reports the factor', () => {
    const r = C.check('7.00 kN', F);
    eq(r.kind, 'algebra');
    // 7000 / 4620.51 = 1.51497…
    ok(/1\.51/.test(r.errors[0].msg), r.errors[0].msg);
  });
  test('rounding: within 3 % but outside tolerance looks like early rounding', () => {
    // 4.70 kN vs 4.62 kN is +1.7 %
    const r = C.check('4.70 kN', F);
    eq(r.kind, 'rounding');
    eq(r.parts.value, false);
  });
  test('rounding: right sig figs, value in tolerance, wrong last digit', () => {
    // 3.5587 → 3.56; "3.55" is 0.25 % off (inside 0.5 %) but misrounded
    const r = C.check('3.55 N', { value: 3.5587, unit: 'N' });
    ok(!r.correct);
    ok(r.parts.value);
    eq(r.parts.rounding, false);
    eq(r.kind, 'rounding');
    eq(r.correctRounding, '3.56');
    ok(/should be 3\.56/.test(r.errors[0].msg));
    ok(/more than half/.test(r.errors[0].msg), r.errors[0].msg);
  });
  test('rounding hint for the exact-5 rule', () => {
    // 75.25 → 75.2 (even 2 stays). "75.3" is misrounded.
    const r = C.check('75.3 N', { value: 75.25, unit: 'N' });
    eq(r.kind, 'rounding');
    ok(/exactly 5/.test(r.errors[0].msg) && /even/.test(r.errors[0].msg), r.errors[0].msg);
    // 0.1275 → 0.128 (odd 7 goes up). "0.127" is misrounded.
    const s = C.check('0.127 m', { value: 0.1275, unit: 'm' });
    eq(s.kind, 'rounding');
    ok(/odd/.test(s.errors[0].msg));
  });
  test('exact-5 rounding is checked through a prefix', () => {
    // 0.1035 m = 103.5 mm → 104 mm; the float division 0.1035/0.001 is
    // 103.49999999999999, which must not turn this into a rounding error.
    ok(C.check('104 mm', { value: 0.1035, unit: 'm' }).correct);
    eq(C.check('103 mm', { value: 0.1035, unit: 'm' }).kind, 'rounding');
  });
  test('sigfig: too many figures', () => {
    const r = C.check('3.559 N', { value: 3.5587, unit: 'N' });
    eq(r.kind, 'sigfig');
    eq(r.parts.rounding, true, '3.559 is the correct 4 s.f. rounding');
    ok(/Report 3/.test(r.errors[0].msg) && /gave 4/.test(r.errors[0].msg));
  });
  test('sigfig: too few figures', () => {
    // 4.6 kN is 0.44 % off, inside tolerance, so only the count is wrong
    const r = C.check('4.6 kN', { value: 4620.51, unit: 'N', tol: 0.005 });
    ok(r.errors.some(e => e.kind === 'sigfig'));
  });
  test('sf: null skips the count, sf: 4 asks for four', () => {
    ok(C.check('4.6205 kN', { value: 4620.51, unit: 'N', sf: null }).correct);
    ok(C.check('4.621 kN', { value: 4620.51, unit: 'N', sf: 4 }).correct);
    eq(C.check('4.62 kN', { value: 4620.51, unit: 'N', sf: 4 }).kind, 'sigfig');
  });
  test('form: centi prefix and out-of-range number', () => {
    const L = { value: 0.0462, unit: 'm', form: 'si' };
    ok(C.check('46.2 mm', L).correct);
    const a = C.check('4.62 cm', L);
    eq(a.kind, 'form'); eq(a.parts.form, false);
    eq(a.errors[0].code, 'non-eng-prefix');
    const b = C.check('0.0462 m', L);
    eq(b.kind, 'form');
    ok(b.errors.some(e => e.code === 'range'));
  });
  test('form si-units skips the range rule', () => {
    ok(C.check('0.0462 m', { value: 0.0462, unit: 'm', form: 'si-units' }).correct);
    eq(C.check('46.2 mm/ms', { value: 46.2, unit: 'm/s', form: 'si-units' }).kind, 'form');
  });
  test('the most important kind is the headline', () => {
    // wrong prefix and wrong figure count: prefix outranks sigfig
    const r = C.check('4.6 N', F);
    eq(r.kind, 'prefix');
    ok(r.errors.some(e => e.kind === 'sigfig'));
  });
  test('custom mistakes from the spec', () => {
    const spec = { value: 100, unit: 'N', mistakes: [{ ratio: 1.5, kind: 'concept', msg: 'Used the wrong lever arm.' }] };
    const r = C.check('150 N', spec);
    eq(r.kind, 'concept');
    eq(r.errors[0].msg, 'Used the wrong lever arm.');
    const t = C.check('120 N', { value: 100, unit: 'N', mistakes: [{ test: x => x > 1.1 && x < 1.3, msg: 'custom test' }] });
    eq(t.errors[0].msg, 'custom test');
  });
  test('a negative custom ratio matches only the reversed sign', () => {
    const spec = { value: -2, unit: 'm/s^2', mistakes: [{ ratio: -4.6, kind: 'algebra', msg: 'slip' }] };
    eq(C.check('9.20 m/s^2', spec).errors[0].msg, 'slip');
    ok(C.check('-9.20 m/s^2', spec).errors.every(e => e.msg !== 'slip'));
  });
  test('expected zero', () => {
    ok(C.check('0 N', { value: 0, unit: 'N', sf: null }).parts.value);
    ok(!C.check('1 N', { value: 0, unit: 'N', sf: null }).parts.value);
  });
});

suite('checker: tolerance', () => {
  // 100.0 N expected; parts.value is what the tolerance decides.
  test('default 0.5 %', () => {
    ok(C.check('100.4 N', { value: 100, unit: 'N', sf: 4 }).parts.value, '0.4 % in');
    ok(C.check('99.5 N', { value: 100, unit: 'N', sf: 3 }).parts.value, '0.5 % is the edge, inclusive');
    ok(!C.check('100.6 N', { value: 100, unit: 'N', sf: 4 }).parts.value, '0.6 % out');
  });
  test('custom tolerance', () => {
    ok(C.check('102 N', { value: 100, unit: 'N', tol: 0.02 }).parts.value);
    ok(!C.check('103 N', { value: 100, unit: 'N', tol: 0.02 }).parts.value);
    ok(!C.check('100.1 N', { value: 100, unit: 'N', tol: 0, sf: 4 }).parts.value);
  });
  test('tolerance is relative, also for negatives', () => {
    ok(C.check('-100.4 N', { value: -100, unit: 'N', sf: 4 }).parts.value);
  });
});

suite('checker: exactRounding', () => {
  test('misrounded digits fail the value too', () => {
    const r = C.check('3.55 N', { value: 3.5587, unit: 'N', exactRounding: true });
    eq(r.parts.value, false);
    eq(r.parts.rounding, false);
    eq(r.kind, 'rounding');
  });
  test('book rounding of exact-5 cases passes', () => {
    ok(C.check('75.2 N', { value: 75.25, unit: 'N', exactRounding: true }).correct);
    ok(C.check('0.128 m', { value: 0.1275, unit: 'm', exactRounding: true }).correct);
    ok(C.check('0.256 m', { value: 0.2555, unit: 'm', exactRounding: true }).correct);
    ok(C.check('7.56 kN', { value: 7555, unit: 'N', exactRounding: true }).correct);
  });
  test('round-half-up of an exact 5 is rejected', () => {
    const r = C.check('75.3 N', { value: 75.25, unit: 'N', exactRounding: true });
    ok(!r.correct);
    eq(r.parts.value, false);
  });
});

suite('checker: expressIn', () => {
  test('a named unit', () => {
    const spec = { value: 4620.51, unit: 'N', expressIn: 'kN' };
    ok(C.check('4.62 kN', spec).correct);
    const r = C.check('4.62(10^3) N', spec);
    eq(r.kind, 'form');
    ok(/Express this in kN/.test(r.errors[0].msg));
  });
  test('a compound unit', () => {
    const spec = { value: 1.5, unit: 'm/s', expressIn: 'km/h' };
    // 1.5 m/s = 5.4 km/h
    ok(C.check('5.40 km/h', spec).correct);
    eq(C.check('1.50 m/s', spec).kind, 'form');
  });
  test('system SI', () => {
    const spec = { value: 4.448, unit: 'N', expressIn: 'SI' };
    ok(C.check('4.45 N', spec).correct);
    eq(C.check('1.00 lb', spec).kind, 'form');
    // minutes are not SI either
    eq(C.check('1.00 min', { value: 60, unit: 's', expressIn: 'SI' }).kind, 'form');
  });
  test('system FPS, which also accepts minutes and hours', () => {
    const spec = { value: 4.448, unit: 'N', expressIn: 'FPS' };
    ok(C.check('1.00 lb', spec).correct);
    eq(C.check('4.45 N', spec).kind, 'form');
    // 88.0 ft/s = 5280 ft/min
    ok(!C.check('5.28 ft/min', { value: 88 * 0.3048 / 1000, unit: 'm/s', expressIn: 'FPS' }).errors.some(e => e.kind === 'form'));
  });
});

suite('checker: classifyRatio and homogeneity', () => {
  test('classifyRatio directly', () => {
    eq(C.classifyRatio(1000, {}).kind, 'prefix');
    eq(C.classifyRatio(0.001, {}).kind, 'prefix');
    eq(C.classifyRatio(4.448, {}).kind, 'conversion');
    eq(C.classifyRatio(1 / 14.59, {}).kind, 'conversion');
    eq(C.classifyRatio(144, {}).kind, 'conversion');
    eq(C.classifyRatio(4.448 * 4.448, {}).kind, 'conversion');
    ok(/square/.test(C.classifyRatio(4.448 * 4.448, {}).msg));
    eq(C.classifyRatio(9.81, {}).kind, 'concept');
    eq(C.classifyRatio(-1, {}).kind, 'sign');
    eq(C.classifyRatio(0.5, {}).kind, 'algebra');
    eq(C.classifyRatio(1.02, {}).kind, 'rounding');
  });
  test('homogeneity', () => {
    const U = globalThis.SE.units;
    const N = U.dim(1, 1, -2), m = U.dim(1);
    eq(C.homogeneity([N, N, N]).ok, true);
    const h = C.homogeneity([N, m, N, U.dim(0, 1)]);
    eq(h.ok, false);
    eq(h.bad.join(','), '1,3');
  });
});
