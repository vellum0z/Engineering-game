/*
 * Units and dimensions.
 *
 * A quantity is stored as a value in SI base units plus a dimension vector
 * [L, M, T, A] (length, mass, time, plane angle). Angle is not an SI base
 * dimension, but tracking it separately catches degree/radian slips in the
 * later vector and rotation chapters.
 *
 * Conversion factors follow the textbook's Table 1-2 values (4.448 N/lb,
 * 14.59 kg/slug, 0.3048 m/ft) so that answers computed here agree with a
 * student working by hand from the same table.
 */
(function (SE) {
  'use strict';

  var NDIM = 4;
  var DIM_NAMES = ['L', 'M', 'T', 'A'];

  function dim(L, M, T, A) { return [L || 0, M || 0, T || 0, A || 0]; }

  var LBF = 4.448;        // N per lb (Table 1-2)
  var SLUG = 14.59;       // kg per slug (Table 1-2)
  var FT = 0.3048;        // m per ft (Table 1-2)
  var IN = FT / 12;

  // sys: 'SI' | 'FPS' | 'other'. pre: may take an SI prefix.
  var UNITS = {
    m:    { f: 1,     d: dim(1, 0, 0),   pre: true,  sys: 'SI',  name: 'meter' },
    g:    { f: 1, p10: -3, d: dim(0, 1, 0),   pre: true,  sys: 'SI',  name: 'gram' },
    s:    { f: 1,     d: dim(0, 0, 1),   pre: true,  sys: 'SI',  name: 'second' },
    N:    { f: 1,     d: dim(1, 1, -2),  pre: true,  sys: 'SI',  name: 'newton', derived: 'kg·m/s²' },
    Pa:   { f: 1,     d: dim(-1, 1, -2), pre: true,  sys: 'SI',  name: 'pascal', derived: 'N/m²' },
    J:    { f: 1,     d: dim(2, 1, -2),  pre: true,  sys: 'SI',  name: 'joule', derived: 'N·m' },
    W:    { f: 1,     d: dim(2, 1, -3),  pre: true,  sys: 'SI',  name: 'watt', derived: 'J/s' },
    rad:  { f: 1,     d: dim(0, 0, 0, 1), pre: false, sys: 'SI', name: 'radian' },
    deg:  { f: Math.PI / 180, d: dim(0, 0, 0, 1), pre: false, sys: 'other', name: 'degree' },
    '°':  { f: Math.PI / 180, d: dim(0, 0, 0, 1), pre: false, sys: 'other', name: 'degree' },
    min:  { f: 60,    d: dim(0, 0, 1),   pre: false, sys: 'other', name: 'minute' },
    h:    { f: 3600,  d: dim(0, 0, 1),   pre: false, sys: 'other', name: 'hour' },
    ft:   { f: FT,    d: dim(1, 0, 0),   pre: false, sys: 'FPS', name: 'foot' },
    'in': { f: IN,    d: dim(1, 0, 0),   pre: false, sys: 'FPS', name: 'inch' },
    yd:   { f: 3 * FT, d: dim(1, 0, 0),  pre: false, sys: 'FPS', name: 'yard' },
    mi:   { f: 5280 * FT, d: dim(1, 0, 0), pre: false, sys: 'FPS', name: 'mile' },
    lb:   { f: LBF,   d: dim(1, 1, -2),  pre: false, sys: 'FPS', name: 'pound' },
    lbf:  { f: LBF,   d: dim(1, 1, -2),  pre: false, sys: 'FPS', name: 'pound' },
    kip:  { f: 1000 * LBF, d: dim(1, 1, -2), pre: false, sys: 'FPS', name: 'kip' },
    ton:  { f: 2000 * LBF, d: dim(1, 1, -2), pre: false, sys: 'FPS', name: 'ton' },
    slug: { f: SLUG,  d: dim(0, 1, 0),   pre: false, sys: 'FPS', name: 'slug' },
    psi:  { f: LBF / (IN * IN), d: dim(-1, 1, -2), pre: false, sys: 'FPS', name: 'pound per square inch' },
    ksi:  { f: 1000 * LBF / (IN * IN), d: dim(-1, 1, -2), pre: false, sys: 'FPS', name: 'kip per square inch' }
  };

  // eng: true for the prefixes engineering practice uses (Table 1-3 and the
  // other powers of 1000). c, d, da, h are valid SI but avoided in engineering.
  var PREFIXES = {
    T:  { p: 12,  eng: true,  name: 'tera' },
    G:  { p: 9,   eng: true,  name: 'giga' },
    M:  { p: 6,   eng: true,  name: 'mega' },
    k:  { p: 3,   eng: true,  name: 'kilo' },
    h:  { p: 2,   eng: false, name: 'hecto' },
    da: { p: 1,   eng: false, name: 'deca' },
    d:  { p: -1,  eng: false, name: 'deci' },
    c:  { p: -2,  eng: false, name: 'centi' },
    m:  { p: -3,  eng: true,  name: 'milli' },
    'μ': { p: -6, eng: true,  name: 'micro' },
    n:  { p: -9,  eng: true,  name: 'nano' },
    p:  { p: -12, eng: true,  name: 'pico' }
  };
  // Typing aids: the micro sign (U+00B5) and plain 'u' both mean μ.
  var PREFIX_ALIAS = { 'µ': 'μ', 'u': 'μ' };

  var SUPERS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

  function pow10(p) {
    // Exact powers of ten for the common range avoid 1e-3 * 1e3 != 1 drift.
    return Number('1e' + p);
  }

  /* ---------------------------------------------------------------- tokens */

  // Resolve one alphabetic symbol (e.g. "kN", "ms", "slug") into a prefix and
  // a unit. An exact unit name wins over a prefix reading, so "min" is the
  // minute, not milli-inch, and "ft" is never femto-tonne.
  function resolveSymbol(sym) {
    if (UNITS[sym]) return { prefix: '', sym: sym };
    var candidates = [];
    Object.keys(PREFIX_ALIAS).concat(Object.keys(PREFIXES)).forEach(function (pk) {
      if (sym.length > pk.length && sym.indexOf(pk) === 0) {
        var rest = sym.slice(pk.length);
        var canonical = PREFIX_ALIAS[pk] || pk;
        if (UNITS[rest] && UNITS[rest].pre) candidates.push({ prefix: canonical, sym: rest });
        else {
          // Two stacked prefixes ("μkm") are not legal SI; recognise them so
          // the game can explain the rule instead of just saying "unknown".
          Object.keys(PREFIX_ALIAS).concat(Object.keys(PREFIXES)).forEach(function (pk2) {
            if (rest.length > pk2.length && rest.indexOf(pk2) === 0) {
              var rest2 = rest.slice(pk2.length);
              if (UNITS[rest2] && UNITS[rest2].pre) {
                candidates.push({ prefix: canonical, prefix2: PREFIX_ALIAS[pk2] || pk2, sym: rest2, stacked: true });
              }
            }
          });
        }
      }
    });
    if (!candidates.length) return null;
    // Prefer the longest prefix match that is not stacked ("da" before "d").
    candidates.sort(function (a, b) {
      if (!!a.stacked !== !!b.stacked) return a.stacked ? 1 : -1;
      return b.prefix.length - a.prefix.length;
    });
    return candidates[0];
  }

  function isLetter(ch) { return /[A-Za-zμµ°]/.test(ch); }

  /* ----------------------------------------------------------- unit parser */

  // Grammar (left to right, like ordinary algebra):
  //   expr   := term (op term)*        op: · * . - space (multiply) or / (divide)
  //   term   := atom power?
  //   atom   := symbol | '(' expr ')'
  //   power  := '^' signed-number | '^(' a/b ')' | superscript digits
  // "kg·m/s²" therefore reads as (kg·m)/s², and "N/(kg·s)" keeps the
  // parentheses. The game always echoes back how it read a unit.
  function parseUnit(str) {
    var src = String(str == null ? '' : str).trim();
    var i = 0;
    var errors = [];
    if (!src) return { ok: true, factors: [], text: '' };

    function peek() { return src[i]; }
    function skipSpaces() { var n = 0; while (src[i] === ' ' || src[i] === ' ' || src[i] === ' ') { i++; n++; } return n; }

    function parsePower() {
      // returns a number exponent or 1
      var save = i;
      skipSpaces();
      if (src[i] === '^' || (src[i] === '*' && src[i + 1] === '*')) {
        i += src[i] === '^' ? 1 : 2;
        skipSpaces();
        if (src[i] === '(') {
          i++;
          var m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*\)/.exec(src.slice(i));
          if (!m) { errors.push('bad exponent'); return 1; }
          i += m[0].length;
          return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
        }
        var m2 = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
        if (!m2) { errors.push('bad exponent'); return 1; }
        i += m2[0].length;
        return Number(m2[0]);
      }
      if (SUPERS[src[i]] !== undefined) {
        var s = '';
        while (SUPERS[src[i]] !== undefined) { s += SUPERS[src[i]]; i++; }
        return Number(s);
      }
      // A bare digit straight after a unit ("m2", "s-2") is a common typing
      // shortcut for an exponent.
      var m3 = /^-?\d+/.exec(src.slice(i));
      if (m3 && i === save) { i += m3[0].length; return Number(m3[0]); }
      i = save;
      return 1;
    }

    function parseAtom() {
      skipSpaces();
      if (src[i] === '(') {
        i++;
        var inner = parseExpr();
        skipSpaces();
        if (src[i] !== ')') { errors.push('missing )'); } else i++;
        var p = parsePower();
        return inner.map(function (f) { return Object.assign({}, f, { exp: f.exp * p }); });
      }
      var start = i;
      while (i < src.length && isLetter(src[i])) i++;
      var sym = src.slice(start, i);
      if (!sym) { errors.push('expected a unit at "' + src.slice(start) + '"'); i = src.length; return []; }
      var r = resolveSymbol(sym);
      if (!r) { errors.push('unknown unit "' + sym + '"'); return []; }
      var pw = parsePower();
      var f = { prefix: r.prefix, sym: r.sym, exp: pw, written: sym };
      if (r.stacked) { f.prefix2 = r.prefix2; f.stacked = true; }
      return [f];
    }

    function parseExpr() {
      var out = parseAtom();
      for (;;) {
        var spaces = skipSpaces();
        var ch = src[i];
        if (ch === undefined || ch === ')') break;
        var div = false;
        if (ch === '/') { div = true; i++; }
        else if (ch === '·' || ch === '•' || ch === '⋅' || ch === '*' || ch === '.' || ch === '-' || ch === '×') { i++; }
        else if (!(spaces > 0 && (isLetter(ch) || ch === '('))) {
          if (spaces === 0 && (isLetter(ch) || ch === '(')) { /* adjacency like "m(s)" */ }
          else { errors.push('unexpected "' + ch + '"'); i = src.length; break; }
        }
        var next = parseAtom();
        if (div) next = next.map(function (f) { return Object.assign({}, f, { exp: -f.exp, den: true }); });
        out = out.concat(next);
      }
      return out;
    }

    var factors = parseExpr();
    skipSpaces();
    if (i < src.length) errors.push('could not read "' + src.slice(i) + '"');
    if (errors.length) return { ok: false, error: errors[0], factors: factors, text: src };
    return { ok: true, factors: factors, text: src };
  }

  function unitFactorAndDims(factors) {
    var f = 1, d = dim(), p10 = 0;
    factors.forEach(function (x) {
      var u = UNITS[x.sym];
      var pf = x.prefix ? PREFIXES[x.prefix].p : 0;
      if (x.prefix2) pf += PREFIXES[x.prefix2].p;
      // Powers of ten are accumulated separately and applied once, so that
      // e.g. Mg -> kg is exactly 1000 and decimal rounding stays exact.
      p10 += (pf + (u.p10 || 0)) * x.exp;
      if (u.f !== 1) f *= Math.pow(u.f, x.exp);
      for (var k = 0; k < NDIM; k++) d[k] += u.d[k] * x.exp;
    });
    for (var k = 0; k < NDIM; k++) d[k] = Math.round(d[k] * 1e9) / 1e9;
    var p10r = Math.round(p10 * 1e9) / 1e9;
    if (p10r === Math.round(p10r)) f = f === 1 ? pow10(p10r) : f * pow10(p10r);
    else f *= Math.pow(10, p10);
    return { factor: f, dims: d, p10: p10r };
  }

  /* --------------------------------------------------------- number parser */

  // Accepts: 12, -3.5, .5, 9.806 65, 52 800, 1.2e3, 1.2E-3, 23.4(10^3),
  // 23.4(10³), 23.4(10-3) (as printed in some texts), 23.4 × 10^3,
  // 23.4x10^3, 23.4*10^3, 23.4·10^3.
  var NUM_RE = /^([+-]?)((?:\d{1,3}(?:[   ]\d{3})+|\d+)(?:\.(?:\d+(?:[   ]\d{1,3}(?![\d.]))*)?)?|\.\d+)/;

  function parseNumberPrefix(str) {
    var s = String(str).replace(/^\s+/, '');
    var m = NUM_RE.exec(s);
    if (!m) return null;
    var consumed = m[0].length;
    var sign = m[1] === '-' ? -1 : 1;
    var mantissa = m[2].replace(/[   ]/g, '');
    var rest = s.slice(consumed);
    var exp10 = 0, hasExp = false, expStyle = null;
    var em;
    if ((em = /^[eE]([+-]?\d+)/.exec(rest))) {
      exp10 = Number(em[1]); hasExp = true; expStyle = 'e';
    } else if ((em = /^\s*\(\s*10\s*(?:\^\s*\(?\s*([+-−]?\d+)\s*\)?|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)|([-−]\d+|\d+))\s*\)/.exec(rest))) {
      exp10 = parseExpDigits(em[1] || em[2] || em[3]); hasExp = true; expStyle = 'paren';
    } else if ((em = /^\s*[x×*·]\s*10\s*(?:\^\s*\(?\s*([+-−]?\d+)\s*\)?|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))/.exec(rest))) {
      exp10 = parseExpDigits(em[1] || em[2]); hasExp = true; expStyle = 'times';
    }
    if (hasExp) { consumed += em[0].length; rest = rest.slice(em[0].length); }
    var leading = String(str).length - String(str).replace(/^\s+/, '').length;
    return {
      sign: sign,
      mantissa: mantissa,
      exp10: exp10,
      hasExp: hasExp,
      expStyle: expStyle,
      value: sign * Number(mantissa) * pow10(exp10),
      // value of the written mantissa only (before ×10^n), used for range rules
      mantissaValue: sign * Number(mantissa),
      rest: rest,
      consumed: consumed + leading
    };
  }

  function parseExpDigits(t) {
    var s = '';
    for (var i = 0; i < t.length; i++) s += SUPERS[t[i]] !== undefined ? SUPERS[t[i]] : (t[i] === '−' ? '-' : t[i]);
    return Number(s);
  }

  /* ------------------------------------------------------- quantity parser */

  function parseQuantity(str) {
    var raw = String(str == null ? '' : str);
    var num = parseNumberPrefix(raw);
    if (!num) return { ok: false, error: 'Start with a number, e.g. "4.62 kN".', raw: raw };
    var unitText = num.rest.trim();
    var u = parseUnit(unitText);
    if (!u.ok) return { ok: false, error: u.error, raw: raw, number: num };
    var fd = unitFactorAndDims(u.factors);
    return {
      ok: true,
      raw: raw,
      number: num,
      unit: u,
      unitText: unitText,
      factor: fd.factor,
      dims: fd.dims,
      value: num.value * fd.factor,        // in SI base units
      given: num.value                     // in the units as written
    };
  }

  /* --------------------------------------------------------------- helpers */

  function dimsEqual(a, b) {
    for (var k = 0; k < NDIM; k++) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-9) return false;
    return true;
  }
  function dimsMul(a, b) { var r = dim(); for (var k = 0; k < NDIM; k++) r[k] = (a[k] || 0) + (b[k] || 0); return r; }
  function dimsDiv(a, b) { var r = dim(); for (var k = 0; k < NDIM; k++) r[k] = (a[k] || 0) - (b[k] || 0); return r; }
  function dimsPow(a, p) { var r = dim(); for (var k = 0; k < NDIM; k++) r[k] = (a[k] || 0) * p; return r; }
  function isDimensionless(a) { return dimsEqual(a, dim()); }

  var SUP_OUT = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '.': '·', '/': 'ᐟ' };
  function sup(n) {
    if (n === 1) return '';
    var s = (Math.abs(n - Math.round(n)) < 1e-9) ? String(Math.round(n)) : (n === 0.5 ? '1/2' : String(n));
    return s.split('').map(function (c) { return SUP_OUT[c] || c; }).join('');
  }

  // "L·M·T⁻²" style dimension string.
  function dimsToString(d) {
    var parts = [];
    for (var k = 0; k < NDIM; k++) if (d[k]) parts.push(DIM_NAMES[k] + sup(d[k]));
    return parts.length ? parts.join('·') : '1 (dimensionless)';
  }

  // SI base-unit expression for a dimension vector, e.g. kg·m/s².
  function dimsToSI(d) {
    var syms = ['m', 'kg', 's', 'rad'];
    var num = [], den = [];
    [1, 0, 2, 3].forEach(function (k) {
      if (d[k] > 0) num.push(syms[k] + sup(d[k]));
      if (d[k] < 0) den.push(syms[k] + sup(-d[k]));
    });
    var n = num.length ? num.join('·') : '1';
    if (!den.length) return num.length ? n : '';
    return n + '/' + (den.length > 1 ? '(' + den.join('·') + ')' : den[0]);
  }

  var NAMED_DIMS = [
    [dim(1, 0, 0), 'length'], [dim(0, 1, 0), 'mass'], [dim(0, 0, 1), 'time'],
    [dim(1, 1, -2), 'force'], [dim(1, 0, -1), 'speed'], [dim(1, 0, -2), 'acceleration'],
    [dim(-3, 1, 0), 'density'], [dim(-1, 1, -2), 'pressure'], [dim(2, 1, -2), 'energy / moment'],
    [dim(1, 1, -1), 'impulse / momentum'], [dim(2, 0, 0), 'area'], [dim(3, 0, 0), 'volume'],
    [dim(0, 0, 0, 1), 'angle'], [dim(-2, 1, -2), 'weight density'], [dim(2, 1, -3), 'power']
  ];
  function dimsName(d) {
    for (var i = 0; i < NAMED_DIMS.length; i++) if (dimsEqual(NAMED_DIMS[i][0], d)) return NAMED_DIMS[i][1];
    return null;
  }

  function formatFactors(factors) {
    var num = [], den = [];
    factors.forEach(function (f) {
      var p = f.prefix + (f.prefix2 || '');
      if (f.exp < 0) den.push(p + f.sym + sup(-f.exp));
      else num.push(p + f.sym + sup(f.exp));
    });
    var n = num.length ? num.join('·') : '1';
    if (!den.length) return n;
    return n + '/' + (den.length > 1 ? '(' + den.join('·') + ')' : den[0]);
  }

  // Combine repeated units ("m·m" -> "m²"); keeps prefixes distinct.
  function simplifyFactors(factors) {
    var map = {}, order = [];
    factors.forEach(function (f) {
      var key = f.prefix + (f.prefix2 || '') + '|' + f.sym;
      if (!map[key]) { map[key] = Object.assign({}, f, { exp: 0 }); order.push(key); }
      map[key].exp += f.exp;
    });
    return order.map(function (k) { return map[k]; }).filter(function (f) { return Math.abs(f.exp) > 1e-12; });
  }

  /*
   * Check a written quantity against the SI-usage rules of a "correct SI
   * form" answer. Returns a list of {code, msg}. An empty list means the
   * form is acceptable.
   */
  function checkSIForm(q, opts) {
    opts = opts || {};
    var issues = [];
    var factors = q.unit.factors;
    var prefixed = 0;
    factors.forEach(function (f) {
      var u = UNITS[f.sym];
      if (u.sys === 'FPS') issues.push({ code: 'not-si', msg: f.written + ' is a U.S. Customary unit, not SI.' });
      if (u.sys === 'other' && !opts.allowOther) issues.push({ code: 'not-si', msg: f.written + ' is not an SI unit; convert it to seconds/meters.' });
      if (f.stacked) issues.push({ code: 'stacked-prefix', msg: '"' + f.written + '" stacks two prefixes. Combine them into one (' + combinedPrefixName(f) + ').' });
      if (f.prefix && !PREFIXES[f.prefix].eng) issues.push({ code: 'non-eng-prefix', msg: PREFIXES[f.prefix].name + ' (' + f.prefix + ') is avoided in engineering; use powers of 1000.' });
      var isKg = f.sym === 'g' && f.prefix === 'k';
      if (f.prefix && !isKg) {
        prefixed++;
        if (f.exp < 0) issues.push({ code: 'prefix-denominator', msg: 'Prefix in the denominator (' + f.written + '). Move it to the numerator.' });
      }
    });
    if (prefixed > 1) issues.push({ code: 'multiple-prefix', msg: 'Use a single prefix for the whole unit.' });
    if (!opts.skipRange) {
      var mv = Math.abs(q.number.hasExp ? q.number.mantissaValue : q.given);
      if (q.number.hasExp && q.number.exp10 % 3 !== 0) issues.push({ code: 'eng-exponent', msg: 'Engineering notation uses powers of 10 that are multiples of 3.' });
      if (mv !== 0 && (mv < 0.1 || mv >= 1000)) issues.push({ code: 'range', msg: 'Keep the number between 0.1 and 1000 by choosing a prefix.' });
    }
    return issues;
  }

  function combinedPrefixName(f) {
    var p = PREFIXES[f.prefix].p + PREFIXES[f.prefix2].p;
    var name = null;
    Object.keys(PREFIXES).forEach(function (k) { if (PREFIXES[k].p === p) name = k; });
    return name ? name + f.sym : '10^' + p + ' ' + f.sym;
  }

  // Factors written with an SI prefix that, read as two separate units, also
  // make sense ("ms" = millisecond, but maybe the author meant m·s).
  function ambiguousPrefixReadings(q) {
    var out = [];
    q.unit.factors.forEach(function (f) {
      if (!f.prefix) return;
      var asUnit = UNITS[f.prefix === 'μ' ? '' : f.prefix];
      if (asUnit && f.written === f.prefix + f.sym) {
        out.push({ written: f.written, asPrefix: PREFIXES[f.prefix].name + UNITS[f.sym].name, asProduct: f.prefix + '·' + f.sym });
      }
    });
    return out;
  }

  // Express an SI value of a single unit symbol raised to `exp` (e.g. N, 2)
  // with the engineering prefix that puts the number in [1, 1000), falling
  // back to [0.1, 1000) when powers like N² skip ranges.
  var ENG_ORDER = ['T', 'G', 'M', 'k', '', 'm', 'μ', 'n', 'p'];
  function bestPrefix(valueSI, sym, exp) {
    exp = exp || 1;
    var u = UNITS[sym];
    var v = valueSI / Math.pow(u.f * pow10(u.p10 || 0), exp);
    var choices = ENG_ORDER.filter(function (p) { return p === '' || u.pre; }).map(function (p) {
      var pp = p ? PREFIXES[p].p : 0;
      return { prefix: p, num: v / Math.pow(pow10(pp), exp) };
    });
    var a = Math.abs(v);
    if (a === 0) return { prefix: '', num: 0 };
    var good = choices.filter(function (c) { var x = Math.abs(c.num); return x >= 1 && x < 1000; });
    if (good.length) return good[0];
    good = choices.filter(function (c) { var x = Math.abs(c.num); return x >= 0.1 && x < 1000; });
    if (good.length) return good[0];
    return choices.reduce(function (best, c) {
      var d = Math.abs(Math.log10(Math.abs(c.num)) - 1.5);
      return (!best || d < best.d) ? { prefix: c.prefix, num: c.num, d: d } : best;
    }, null);
  }

  // Convert a value between two unit strings. Throws on mismatched dimensions.
  function convert(value, from, to) {
    var a = parseUnit(from), b = parseUnit(to);
    if (!a.ok) throw new Error('bad unit ' + from);
    if (!b.ok) throw new Error('bad unit ' + to);
    var fa = unitFactorAndDims(a.factors), fb = unitFactorAndDims(b.factors);
    if (!dimsEqual(fa.dims, fb.dims)) throw new Error('dimension mismatch: ' + dimsToString(fa.dims) + ' vs ' + dimsToString(fb.dims));
    return value * fa.factor / fb.factor;
  }

  function unitInfo(str) {
    var u = parseUnit(str);
    if (!u.ok) return null;
    var fd = unitFactorAndDims(u.factors);
    return { factors: u.factors, factor: fd.factor, dims: fd.dims, pretty: formatFactors(u.factors) };
  }

  SE.units = {
    UNITS: UNITS,
    PREFIXES: PREFIXES,
    LBF: LBF, SLUG: SLUG, FT: FT, IN: IN,
    dim: dim,
    parseUnit: parseUnit,
    parseNumberPrefix: parseNumberPrefix,
    parseQuantity: parseQuantity,
    unitFactorAndDims: unitFactorAndDims,
    unitInfo: unitInfo,
    dimsEqual: dimsEqual,
    dimsMul: dimsMul,
    dimsDiv: dimsDiv,
    dimsPow: dimsPow,
    isDimensionless: isDimensionless,
    dimsToString: dimsToString,
    dimsToSI: dimsToSI,
    dimsName: dimsName,
    formatFactors: formatFactors,
    simplifyFactors: simplifyFactors,
    checkSIForm: checkSIForm,
    ambiguousPrefixReadings: ambiguousPrefixReadings,
    bestPrefix: bestPrefix,
    convert: convert,
    sup: sup,
    pow10: pow10
  };
})(globalThis.SE);
