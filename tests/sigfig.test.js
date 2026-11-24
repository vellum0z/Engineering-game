'use strict';
// Significant figures: the course rounding rule, counting, engineering form.
const { suite, test, eq, near, ok } = require('./harness');
const S = globalThis.SE.sigfig;

const r3 = x => S.roundSig(x, 3).text;

suite('sigfig: rounding to 3 s.f. with the course rule', () => {
  // first dropped digit > 5: up
  test('3.5587 → 3.56 (dropped 8 > 5)', () => eq(r3(3.5587), '3.56'));
  test('0.5896 → 0.590 (9 → carries, trailing zero kept)', () => {
    eq(r3(0.5896), '0.590');
    eq(S.roundSig(0.5896, 3).digits, '590');
  });
  test('9.3866 → 9.39', () => eq(r3(9.3866), '9.39'));
  // first dropped digit < 5: leave
  test('1.341 → 1.34', () => eq(r3(1.341), '1.34'));
  test('0.3762 → 0.376', () => eq(r3(0.3762), '0.376'));
  test('9.871 → 9.87', () => eq(r3(9.871), '9.87'));
  // exactly 5: odd kept digit goes up, even stays
  test('75.25 → 75.2 (exact 5 after an even 2)', () => eq(r3(75.25), '75.2'));
  test('0.1275 → 0.128 (exact 5 after an odd 7; as a double this is 0.12749…)', () => {
    eq(r3(0.1275), '0.128');
  });
  test('0.2555 → 0.256 (exact 5 after an odd 5)', () => eq(r3(0.2555), '0.256'));
  test('5 followed by anything nonzero is more than half: 75.2501 → 75.3', () => {
    eq(r3(75.2501), '75.3');
  });
  test('string input is rounded on its digits', () => {
    eq(r3('0.1275'), '0.128');
    eq(r3('75.250'), '75.2');
  });
  test('negative values round on their magnitude', () => {
    eq(r3(-3.5587), '-3.56');
    eq(r3(-75.25), '-75.2');
    eq(S.roundSig(-75.25, 3).value, -75.2);
  });
});

suite('sigfig: whole-number problems', () => {
  test('58 342 → 58 300', () => eq(r3(58342), '58300'));
  test('68.534 → 68.5', () => eq(r3(68.534), '68.5'));
  test('2553 → 2550', () => eq(r3(2553), '2550'));
  test('7555 → 7560 (exact 5 after an odd 5)', () => eq(r3(7555), '7560'));
  test('value field is the rounded number', () => {
    eq(S.roundSig(58342, 3).value, 58300);
    eq(S.roundSig(7555, 3).value, 7560);
  });
});

suite('sigfig: carries and padding', () => {
  test('999.6 → 1000 at 3 s.f. (carry adds a digit, kept digits stay 3)', () => {
    const r = S.roundSig(999.6, 3);
    eq(r.text, '1000');
    eq(r.digits, '100');
    eq(r.point, 4);
    eq(r.value, 1000);
  });
  test('0.0009996 → 0.00100 at 3 s.f.', () => {
    const r = S.roundSig(0.0009996, 3);
    eq(r.text, '0.00100');
    eq(r.value, 0.001);
  });
  test('9.995 → 10.0 (exact 5 after odd 9 carries all the way)', () => {
    eq(r3(9.995), '10.0');
  });
  test('short numbers are padded with significant zeros', () => {
    eq(r3(2), '2.00');
    eq(r3(0.5), '0.500');
    eq(r3(100), '100');
  });
  test('tiny and huge doubles in exponent form', () => {
    // String(5e-7) is "5e-7"; the digit work must not see the "e"
    eq(r3(5e-7), '0.000000500');
    eq(r3(1.23456e21), '1230000000000000000000');
  });
  test('zero', () => {
    eq(S.roundSig(0, 3).text, '0');
    eq(S.roundSig(0, 3).value, 0);
  });
  test('other rules: up and truncate', () => {
    eq(S.roundSig(75.25, 3, 'up').text, '75.3');
    eq(S.roundSig(75.24, 3, 'up').text, '75.2');
    eq(S.roundSig(9.879, 3, 'truncate').text, '9.87');
  });
  test('roundedUp flag', () => {
    eq(S.roundSig(3.5587, 3).roundedUp, true);
    eq(S.roundSig(1.341, 3).roundedUp, false);
  });
});

suite('sigfig: countSigFigs', () => {
  const c = t => { const r = S.countSigFigs(t); return r && [r.min, r.max, r.ambiguous].join(','); };
  test('plain decimals', () => {
    eq(c('4.62'), '3,3,false');
    eq(c('9.80665'), '6,6,false');
    eq(c('100.0'), '4,4,false');
  });
  test('leading zeros never count', () => {
    eq(c('0.00340'), '3,3,false');  // 3, 4, and the trailing 0 after the point
    eq(c('0.5'), '1,1,false');
    eq(c('0.0009996'), '4,4,false');
    eq(c('007'), '1,1,false');
  });
  test('trailing zeros of a whole number are ambiguous: 23 400 has 3 to 5', () => {
    eq(c('23400'), '3,5,true');
    eq(c('23 400'), '3,5,true');
    eq(c('4620'), '3,4,true');
  });
  test('a decimal point makes trailing zeros significant', () => {
    eq(c('23400.'), '5,5,false');
    eq(c('23400.0'), '6,6,false');
  });
  test('whole numbers without trailing zeros are exact counts', () => {
    eq(c('2553'), '4,4,false');
    eq(c('7'), '1,1,false');
  });
  test('signs, digit-group spaces and exponent tails are ignored', () => {
    eq(c('-4.62'), '3,3,false');
    eq(c('9.806 65'), '6,6,false');
    eq(c('1.20e3'), '3,3,false');
  });
  test('zero itself', () => {
    eq(c('0'), '1,1,false');
    eq(c('0.00'), '2,2,false');
  });
  test('not a number', () => {
    eq(S.countSigFigs('abc'), null);
    eq(S.countSigFigs(''), null);
    eq(S.countSigFigs('.'), null);
  });
});

suite('sigfig: engineering notation', () => {
  test('formatEng uses exponents in multiples of 3', () => {
    eq(S.formatEng(23400, 3), '23.4(10³)');
    eq(S.formatEng(1234567, 3), '1.23(10⁶)');
    eq(S.formatEng(0.000123, 3), '123(10⁻⁶)');
    eq(S.formatEng(0.0462, 3), '46.2(10⁻³)');
  });
  test('no exponent between 1 and 1000', () => {
    eq(S.formatEng(4.62, 3), '4.62');
    eq(S.formatEng(462, 3), '462');
    eq(S.formatEng(1, 3), '1.00');
  });
  test('significant trailing zeros are kept', () => {
    eq(S.formatEng(23400, 5), '23.400(10³)');
  });
  test('rounding that carries moves to the next power of 1000', () => {
    // 999.6 → 1000 → 1.00(10³)
    eq(S.formatEng(999.6, 3), '1.00(10³)');
  });
  test('negative and zero', () => {
    eq(S.formatEng(-4620, 3), '-4.62(10³)');
    eq(S.formatEng(0, 3), '0');
  });
  test('toEngineering exposes mantissa and exponent', () => {
    const t = S.toEngineering(23400, 3);
    eq(t.mantissa, '23.4'); eq(t.exp, 3);
  });
  test('supNum', () => {
    eq(S.supNum(-12), '⁻¹²');
    eq(S.supNum(3), '³');
  });
});

suite('sigfig: withPrefix', () => {
  test('picks the prefix and rounds', () => {
    eq(S.withPrefix(4620, 'N', 3), '4.62 kN');
    eq(S.withPrefix(0.0462, 'm', 3), '46.2 mm');
    eq(S.withPrefix(250, 'N', 3), '250 N');
  });
  test('999.6 N rounds to 1.00 kN, not "1000 N"', () => {
    eq(S.withPrefix(999.6, 'N', 3), '1.00 kN');
  });
  test('exact-5 case survives the prefix division', () => {
    // 0.1035 / 0.001 is 103.49999999999999 as a double; the true value is
    // 103.5 mm, and 3 is odd, so it rounds up to 104 mm.
    eq(S.withPrefix(0.1035, 'm', 3), '104 mm');
  });
  test('mass on the gram', () => eq(S.withPrefix(5, 'g', 3), '5.00 kg'));
});

suite('sigfig: decompose and numberToPlainString', () => {
  test('decompose', () => {
    const d = S.decompose(0.00340);
    eq(d.digits, '34'); eq(d.point, -2); eq(d.sign, 1);
    const e = S.decompose('-1.5e3');
    eq(e.digits, '15'); eq(e.point, 4); eq(e.sign, -1);
    ok(S.decompose(0).zero);
  });
  test('numberToPlainString never uses exponent form', () => {
    eq(S.numberToPlainString(1e-7), '0.0000001');
    eq(S.numberToPlainString(1.5e22), '15000000000000000000000');
    eq(S.numberToPlainString(12.5), '12.5');
  });
});
