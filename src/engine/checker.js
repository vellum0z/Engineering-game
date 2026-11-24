/*
 * Answer checker.
 *
 * Takes what the player typed (a number with units) and an answer spec, and
 * reports each part separately: value, units (dimensions), significant
 * figures, SI form and rounding. When something is wrong it classifies the
 * error (unit, prefix, conversion, rounding, sig fig, algebra, concept) so
 * the feedback can name the mistake instead of just saying "wrong".
 *
 * Spec fields:
 *   value     exact expected value in SI base units (number)
 *   unit      unit string whose dimensions the answer must have (e.g. 'N')
 *   dims      alternatively, a dimension vector
 *   sf        required significant figures (default 3; null to skip)
 *   form      'any' | 'si' (SI usage rules incl. 0.1-1000 range) |
 *             'si-units' (SI rules except the range) | 'exact-unit'
 *   expressIn unit string the answer must be written in (form 'exact-unit'),
 *             or a system name 'SI' / 'FPS'
 *   tol       relative tolerance for "value correct" (default 0.5 %)
 *   exactRounding  true: digits must equal the course rounding exactly
 *   mistakes  extra diagnoses: [{ ratio, kind, msg }] matched against
 *             player/expected
 */
(function (SE) {
  'use strict';
  var U = SE.units, S = SE.sigfig;

  var KNOWN_FACTORS = [
    { f: 4.448, name: 'the lb↔N factor (4.448)' },
    { f: 14.59, name: 'the slug↔kg factor (14.59)' },
    { f: 0.3048, name: 'the ft↔m factor (0.3048)' },
    { f: 0.3048 * 0.3048, name: 'the ft²↔m² factor (0.3048²) — area units square the length factor' },
    { f: Math.pow(0.3048, 3), name: 'the ft³↔m³ factor (0.3048³) — volume units cube the length factor' },
    { f: 12, name: 'the in↔ft factor (12)' },
    { f: 144, name: 'the in²↔ft² factor (12² = 144)' },
    { f: 1728, name: 'the in³↔ft³ factor (12³ = 1728)' },
    { f: 0.0254, name: 'the in↔m factor (0.0254)' },
    { f: 0.0254 * 0.0254, name: 'the in²↔m² factor (0.0254²)' },
    { f: 5280, name: 'the mi↔ft factor (5280)' },
    { f: 3600, name: 'the h↔s factor (3600)' },
    { f: 60, name: 'the min↔s factor (60)' },
    { f: 2000, name: 'the ton↔lb factor (2000)' },
    { f: 9.81, name: 'g = 9.81 m/s² — mass and weight got mixed up', kind: 'concept' },
    { f: 32.2, name: 'g = 32.2 ft/s² — mass and weight got mixed up', kind: 'concept' },
    { f: 9.81 / 32.2, name: 'the wrong value of g for the unit system', kind: 'concept' }
  ];

  function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

  function classifyRatio(r, spec) {
    var ar = Math.abs(r);
    var custom = (spec.mistakes || []).filter(function (m) {
      if (typeof m.test === 'function') return m.test(r);
      return approx(ar, m.ratio, m.tol || 0.004);
    })[0];
    if (custom) return { kind: custom.kind || 'concept', msg: custom.msg };
    if (r < 0) return { kind: 'sign', msg: 'The sign is reversed. Check the direction or the subtraction.' };
    var lg = Math.log10(ar);
    var k = Math.round(lg);
    if (k !== 0 && Math.abs(lg - k) < 0.002) {
      if (k % 3 === 0) return { kind: 'prefix', msg: 'Off by exactly 10^' + k + ' — a prefix (×1000 steps) was dropped or applied twice.' };
      return { kind: 'prefix', msg: 'Off by exactly 10^' + k + ' — a decimal place or exponent slipped.' };
    }
    for (var i = 0; i < KNOWN_FACTORS.length; i++) {
      var F = KNOWN_FACTORS[i];
      if (approx(ar, F.f, 0.004) || approx(ar, 1 / F.f, 0.004)) {
        var dir = ar > 1 ? 'multiplied where you should divide (or the reverse)' : 'divided where you should multiply (or the reverse)';
        if (F.kind === 'concept') return { kind: 'concept', msg: 'Off by ' + F.name + '.' };
        return { kind: 'conversion', msg: 'Off by ' + F.name + ': the factor was ' + dir + ', or skipped.' };
      }
    }
    // The factor applied twice / squared slip. Checked in a second pass so a
    // listed factor (0.3048², 144) is named before it matches as a square.
    for (var j = 0; j < KNOWN_FACTORS.length; j++) {
      var G = KNOWN_FACTORS[j];
      if (approx(ar, G.f * G.f, 0.004) || approx(ar, 1 / (G.f * G.f), 0.004)) {
        return { kind: 'conversion', msg: 'Off by the square of ' + G.name + ': a factor was applied twice in the same direction.' };
      }
    }
    if (approx(ar, 2, 0.004) || approx(ar, 0.5, 0.004)) return { kind: 'algebra', msg: 'Off by a factor of 2 — check for a ½ or a doubled term.' };
    if (Math.abs(ar - 1) < 0.03) return { kind: 'rounding', msg: 'Very close: the error looks like rounding too early. Keep full precision until the final answer.' };
    return { kind: 'algebra', msg: 'The value is off by a factor of ' + S.roundSig(ar, 3).text + '. Re-check the algebra and each conversion step.' };
  }

  function check(input, spec) {
    var res = {
      input: input, parsed: null, correct: false,
      parts: { value: false, units: false, sigfigs: true, form: true, rounding: true },
      errors: [], notes: [], kind: null
    };
    var q = U.parseQuantity(input);
    res.parsed = q;
    if (!q.ok) {
      res.kind = 'parse';
      res.parts.sigfigs = res.parts.form = res.parts.rounding = false;
      res.errors.push({ kind: 'parse', msg: q.error || 'Could not read that. Try "4.62 kN" or "23.4(10^3) N".' });
      return res;
    }
    var expDims = spec.dims || (spec.unit ? U.unitInfo(spec.unit).dims : U.dim());

    // units / dimensions
    res.parts.units = U.dimsEqual(q.dims, expDims);
    if (!res.parts.units) {
      var got = U.dimsName(q.dims), want = U.dimsName(expDims);
      var massForce = (got === 'mass' && want === 'force') || (got === 'force' && want === 'mass');
      res.errors.push({
        kind: massForce ? 'concept' : 'unit',
        msg: massForce
          ? 'You gave a ' + got + ' but this needs a ' + want + '. Mass and weight are different quantities: W = mg.'
          : 'Wrong units: you gave ' + (got || U.dimsToString(q.dims)) + ' (' + U.dimsToSI(q.dims) + '), this needs ' + (want || U.dimsToString(expDims)) + ' (' + U.dimsToSI(expDims) + ').'
      });
    }

    // value (only meaningful when dimensions agree)
    var tol = spec.tol != null ? spec.tol : 0.005;
    if (res.parts.units) {
      var x = spec.value;
      var vp = q.value;
      if (x === 0) res.parts.value = Math.abs(vp) < 1e-12;
      else res.parts.value = Math.abs(vp - x) <= tol * Math.abs(x) * (1 + 1e-9);
      if (!res.parts.value) {
        var c = classifyRatio(vp / x, spec);
        res.errors.push(c);
      }
    } else {
      res.parts.value = false;
    }

    // significant figures
    var sf = spec.sf === undefined ? 3 : spec.sf;
    var count = S.countSigFigs(q.number.mantissa);
    res.sigfigCount = count;
    if (sf != null && count) {
      if (count.ambiguous && count.min <= sf && count.max >= sf) {
        res.parts.sigfigs = false;
        res.errors.push({ kind: 'sigfig', msg: q.number.mantissa + ' is ambiguous: its trailing zeros may or may not be significant. Use a prefix or engineering notation so exactly ' + sf + ' digits show.' });
      } else if (count.min !== sf || count.max !== sf) {
        res.parts.sigfigs = false;
        res.errors.push({ kind: 'sigfig', msg: 'Report ' + sf + ' significant figures; you gave ' + (count.ambiguous ? count.min + '–' + count.max : count.min) + '.' });
      }
    }

    // rounding: are the reported digits the correct rounding of the true value?
    if (res.parts.units && count && !count.ambiguous && spec.value !== 0) {
      var inUnits = spec.value / q.factor / U.pow10(q.number.exp10) * q.number.sign;
      // Unit and exponent scaling is a float division (0.1035 / 0.001 gives
      // 103.49999999999999), which would turn an exact-5 case into "less
      // than half". Trim that last-bit noise before rounding by the rules.
      inUnits = Number(inUnits.toPrecision(15));
      var r = S.roundSig(inUnits, count.min);
      var written = Number(q.number.mantissa);
      var correctDigits = Math.abs(written - Math.abs(r.value)) <= 1e-9 * Math.max(1, Math.abs(written));
      res.correctRounding = r.text;
      if (!correctDigits) {
        if (spec.exactRounding) { res.parts.value = false; }
        if (res.parts.value || spec.exactRounding) {
          res.parts.rounding = false;
          var lastPlaceOff = Math.abs(written - Math.abs(r.value));
          var ulp = S.decompose(r.text);
          res.errors.push({ kind: 'rounding', msg: 'Rounded value should be ' + r.text.replace('-', '') + ', not ' + q.number.mantissa + '. ' + roundingHint(inUnits, count.min) });
        }
      }
    }

    // SI form
    var form = spec.form || 'any';
    if (form === 'si' || form === 'si-units') {
      var issues = U.checkSIForm(q, { skipRange: form === 'si-units' });
      var seen = {};
      issues = issues.filter(function (i) { if (seen[i.code]) return false; seen[i.code] = 1; return true; });
      if (issues.length) {
        res.parts.form = false;
        issues.forEach(function (i) { res.errors.push({ kind: 'form', code: i.code, msg: i.msg }); });
      }
    }
    if (spec.expressIn) {
      if (spec.expressIn === 'SI' || spec.expressIn === 'FPS') {
        var wrongSys = q.unit.factors.filter(function (f) { return U.UNITS[f.sym].sys !== spec.expressIn && !(spec.expressIn === 'FPS' && U.UNITS[f.sym].sys === 'other'); });
        if (wrongSys.length) { res.parts.form = false; res.errors.push({ kind: 'form', msg: 'Express this in ' + (spec.expressIn === 'SI' ? 'SI units' : 'U.S. Customary (FPS) units') + '.' }); }
      } else {
        var want2 = U.unitInfo(spec.expressIn);
        if (Math.abs(q.factor / want2.factor - 1) > 1e-9) {
          res.parts.form = false;
          res.errors.push({ kind: 'form', msg: 'Express this in ' + want2.pretty + '.' });
        }
      }
    }

    // ambiguity echo: tell the player how a prefix-like unit was read
    U.ambiguousPrefixReadings(q).forEach(function (a) {
      res.notes.push('Read "' + a.written + '" as ' + a.asPrefix + '. For a product of units write ' + a.asProduct + '.');
    });
    res.readAs = q.number.mantissa + (q.number.hasExp ? '(10' + S.supNum(q.number.exp10) + ')' : '') + ' ' + U.formatFactors(q.unit.factors);

    // overall
    res.correct = res.parts.value && res.parts.units && res.parts.sigfigs && res.parts.form && res.parts.rounding;
    // most important error kind for the headline
    var order = ['parse', 'concept', 'unit', 'conversion', 'prefix', 'sign', 'algebra', 'rounding', 'sigfig', 'form'];
    res.errors.sort(function (a, b) { return order.indexOf(a.kind) - order.indexOf(b.kind); });
    res.kind = res.errors.length ? res.errors[0].kind : null;
    return res;
  }

  function roundingHint(x, n) {
    var d = S.decompose(x);
    var digits = d.digits + '0000';
    var next = digits[n];
    var rest = digits.slice(n + 1).replace(/0+$/, '');
    if (next === '5' && !rest) return 'It ends in exactly 5: the digit before it (' + digits[n - 1] + ') is ' + (Number(digits[n - 1]) % 2 ? 'odd, so round up.' : 'even, so leave it.');
    if (Number(next) > 5 || (next === '5' && rest)) return 'The first dropped digit makes it more than half, so round up.';
    return 'The first dropped digit is less than 5, so do not round up.';
  }

  // Compare two equations' sides for dimensional homogeneity. Each term is a
  // dimension vector; returns the indices of terms that disagree with the
  // first.
  function homogeneity(terms) {
    var bad = [];
    for (var i = 1; i < terms.length; i++) if (!U.dimsEqual(terms[i], terms[0])) bad.push(i);
    return { ok: bad.length === 0, bad: bad };
  }

  SE.checker = { check: check, classifyRatio: classifyRatio, homogeneity: homogeneity, roundingHint: roundingHint };
})(globalThis.SE);
