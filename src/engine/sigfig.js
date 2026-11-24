/*
 * Significant figures, rounding and engineering notation.
 *
 * Rounding follows the convention used in the course text:
 *   - first dropped digit greater than 5 (or 5 followed by anything nonzero):
 *     round up;
 *   - first dropped digit less than 5: leave it;
 *   - exactly 5 (nothing nonzero after it): round to make the kept digit
 *     even, i.e. an odd preceding digit is rounded up, an even one is kept.
 *     75.25 -> 75.2, 0.1275 -> 0.128, 0.2555 -> 0.256.
 * The "exactly 5" case is round-half-to-even. It is unbiased: over many
 * values, half of the exact-5 cases go up and half stay, so repeated
 * rounding does not drift upward.
 *
 * All rounding is done on decimal digit strings, never on binary floats, so
 * 0.1275 really ends in 5 here (as a double it is 0.12749999...).
 */
(function (SE) {
  'use strict';

  // Decompose a number (or numeric string) into sign, digit string with no
  // leading zeros, and the decimal exponent of its first digit:
  //   value = sign * 0.d1d2d3... * 10^(point)
  function decompose(x) {
    var s = typeof x === 'string' ? x.trim() : numberToPlainString(x);
    var sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    var e = 0;
    var em = /[eE]([+-]?\d+)$/.exec(s);
    if (em) { e = Number(em[1]); s = s.slice(0, em.index); }
    var dot = s.indexOf('.');
    var intPart = dot < 0 ? s : s.slice(0, dot);
    var fracPart = dot < 0 ? '' : s.slice(dot + 1);
    var digits = intPart + fracPart;
    var point = intPart.length + e;
    var lead = 0;
    while (lead < digits.length - 1 && digits[lead] === '0') lead++;
    digits = digits.slice(lead);
    point -= lead;
    if (/^0+$/.test(digits)) return { sign: 1, digits: '0', point: 1, zero: true };
    return { sign: sign, digits: digits, point: point };
  }

  // Shortest round-trip decimal, avoiding exponent form for readability.
  function numberToPlainString(x) {
    if (!isFinite(x)) return String(x);
    var s = String(x);
    if (!/e/i.test(s)) return s;
    var d = decompose(s);
    return compose(d.sign, d.digits, d.point);
  }

  function compose(sign, digits, point) {
    var s;
    if (point <= 0) s = '0.' + '0'.repeat(-point) + digits;
    else if (point >= digits.length) s = digits + '0'.repeat(point - digits.length);
    else s = digits.slice(0, point) + '.' + digits.slice(point);
    return (sign < 0 ? '-' : '') + s;
  }

  function incrementDigits(d) {
    // add 1 to a digit string; may grow by one digit
    var arr = d.split('');
    var i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === '9') { arr[i] = '0'; i--; }
      else { arr[i] = String(Number(arr[i]) + 1); return { digits: arr.join(''), carry: false }; }
    }
    return { digits: '1' + arr.join(''), carry: true };
  }

  /*
   * Round to n significant figures with the course's rule.
   * Returns { sign, digits (exactly n chars), point, value, text }.
   */
  function roundSig(x, n, rule) {
    rule = rule || 'book';
    var d = decompose(x);
    if (d.zero) return { sign: 1, digits: '0'.repeat(n), point: 1, value: 0, text: '0' };
    var digits = d.digits;
    if (digits.length < n) digits = digits + '0'.repeat(n - digits.length);
    var kept = digits.slice(0, n);
    var dropped = digits.slice(n);
    var up = false;
    if (dropped.length) {
      var first = Number(dropped[0]);
      var restNonZero = /[1-9]/.test(dropped.slice(1));
      if (rule === 'up') up = first >= 5;               // "always round 5 up"
      else if (rule === 'truncate') up = false;
      else if (first > 5) up = true;
      else if (first < 5) up = false;
      else if (restNonZero) up = true;                  // more than half
      else up = Number(kept[kept.length - 1]) % 2 === 1; // exactly half: odd goes up
    }
    var point = d.point;
    if (up) {
      var inc = incrementDigits(kept);
      kept = inc.digits;
      if (inc.carry) { point += 1; kept = kept.slice(0, n); }
    }
    var text = compose(d.sign, kept, point);
    return { sign: d.sign, digits: kept, point: point, value: Number(text), text: text, roundedUp: up };
  }

  /*
   * Count significant figures in a written mantissa (no exponent part).
   * Trailing zeros of a whole number without a decimal point are ambiguous:
   * "23400" could have 3, 4 or 5.
   */
  function countSigFigs(text) {
    var s = String(text).replace(/[\s  ]/g, '').replace(/^[+-]/, '');
    s = s.replace(/[eE][+-]?\d+$/, '');
    if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
    var hasPoint = s.indexOf('.') >= 0;
    var digits = s.replace('.', '');
    var firstNZ = digits.search(/[1-9]/);
    if (firstNZ < 0) {
      // zero itself: "0.00" has 2 decimals of precision; treat as count of
      // zeros after the point (a convention; rarely matters)
      var dec = hasPoint ? s.split('.')[1].length : 1;
      return { min: Math.max(1, dec), max: Math.max(1, dec), ambiguous: false };
    }
    var sig = digits.slice(firstNZ);
    if (hasPoint) return { min: sig.length, max: sig.length, ambiguous: false };
    var trailing = /0*$/.exec(sig)[0].length;
    if (trailing === 0) return { min: sig.length, max: sig.length, ambiguous: false };
    return { min: sig.length - trailing, max: sig.length, ambiguous: true };
  }

  /*
   * Engineering notation: mantissa in [1, 1000) and exponent a multiple of 3,
   * written to n significant figures. 23400 (3 s.f.) -> "23.4(10^3)".
   */
  function toEngineering(x, n) {
    var r = roundSig(x, n);
    if (r.value === 0) return { mantissa: '0', exp: 0, text: '0' };
    var e = r.point - 1;                 // exponent of first digit
    var e3 = Math.floor(e / 3) * 3;
    var mant = compose(r.sign, r.digits, r.point - e3);
    // keep trailing zeros that are significant, e.g. 23.400
    return { mantissa: mant, exp: e3, text: e3 === 0 ? mant : mant + '(10' + supNum(e3) + ')' };
  }

  function formatEng(x, n) {
    var t = toEngineering(x, n);
    if (t.exp === 0) return t.mantissa;
    return t.mantissa + '(10' + supNum(t.exp) + ')';
  }

  function supNum(e) {
    var map = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
    return String(e).split('').map(function (c) { return map[c]; }).join('');
  }

  /*
   * Express an SI value with the best engineering prefix for a single unit
   * symbol, rounded to n s.f. -> "4.62 kN". For compound units pass a
   * function or use SE.units.bestPrefix directly.
   */
  function withPrefix(valueSI, sym, n, exp, rest) {
    var bp = SE.units.bestPrefix(valueSI, sym, exp || 1);
    // bp.num comes from a float division (0.1035 / 0.001 = 103.49999999999999);
    // trim that noise so exact-5 cases round by the rules.
    var r = roundSig(Number(bp.num.toPrecision(15)), n || 3);
    // rounding can push 999.6 up to 1000; re-pick the prefix if so
    if (Math.abs(r.value) >= 1000) {
      bp = SE.units.bestPrefix(r.value * Math.pow(SE.units.pow10(bp.prefix ? SE.units.PREFIXES[bp.prefix].p : 0), exp || 1) * Math.pow(SE.units.UNITS[sym].f * SE.units.pow10(SE.units.UNITS[sym].p10 || 0), exp || 1), sym, exp || 1);
      r = roundSig(bp.num, n || 3);
    }
    return r.text + ' ' + bp.prefix + sym + (exp && exp !== 1 ? SE.units.sup(exp) : '') + (rest || '');
  }

  // Number of decimals a value shows when written to n s.f. (for inputs/UI)
  function fixedForSig(x, n) {
    var r = roundSig(x, n);
    return r.text;
  }

  SE.sigfig = {
    decompose: decompose,
    compose: compose,
    roundSig: roundSig,
    countSigFigs: countSigFigs,
    toEngineering: toEngineering,
    formatEng: formatEng,
    withPrefix: withPrefix,
    fixedForSig: fixedForSig,
    numberToPlainString: numberToPlainString,
    supNum: supNum
  };
})(globalThis.SE);
