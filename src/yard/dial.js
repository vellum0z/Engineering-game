/*
 * Dials: the typed settings on a part ("2.5 kN", "300 lb", "0.45 m").
 *
 * The build yard never asks for a bare answer. A number becomes a setting
 * on a part, and the part does exactly what was typed. A unit that is the
 * wrong kind of quantity (kg on a force dial) is refused, because a real
 * dial can't take it. A prefix slip (mN for kN) is accepted, because it
 * is a valid force, and the simulation shows what it does.
 *
 *   SE.yard.dial.parse('2.5 kN', 'force')
 *     -> { ok: true, si: 2500, text: '2.5 kN', q: 'force', parsed }
 *     -> { ok: false, error: 'A force dial takes N, kN, lb …' }
 *   SE.yard.dial.format(2500, 'kN', 3)  -> '2.50 kN'
 *   SE.yard.dial.convert(2500, 'force', 'lb') -> 562.05…
 *   SE.yard.dial.QUANTITIES[q] = { dims, si: 'N', examples: 'N, kN, lb' }
 *
 * A dial with q 'number' takes a plain number (a count, a ratio, μ).
 * A dial with q 'text' takes any non-empty text (a formula, a part id);
 * b.si(key) then returns the text itself.
 */
(function (SE) {
  'use strict';
  SE.yard = SE.yard || {};
  var U = SE.units;
  var d = U.dim;

  var QUANTITIES = {
    number:    { dims: d(0, 0, 0),    si: '',      name: 'number',        examples: 'a plain number' },
    length:    { dims: d(1, 0, 0),    si: 'm',     name: 'length',        examples: 'm, mm, ft, in' },
    mass:      { dims: d(0, 1, 0),    si: 'kg',    name: 'mass',          examples: 'kg, g, Mg, slug' },
    time:      { dims: d(0, 0, 1),    si: 's',     name: 'time',          examples: 's, ms, min' },
    force:     { dims: d(1, 1, -2),   si: 'N',     name: 'force',         examples: 'N, kN, lb, kip' },
    speed:     { dims: d(1, 0, -1),   si: 'm/s',   name: 'speed',         examples: 'm/s, km/h, ft/s' },
    accel:     { dims: d(1, 0, -2),   si: 'm/s^2', name: 'acceleration',  examples: 'm/s^2, ft/s^2' },
    angle:     { dims: d(0, 0, 0, 1), si: 'deg',   name: 'angle',         examples: 'deg, rad' },
    stiffness: { dims: d(0, 1, -2),   si: 'N/m',   name: 'stiffness',     examples: 'N/m, kN/m, lb/in' },
    pressure:  { dims: d(-1, 1, -2),  si: 'Pa',    name: 'pressure',      examples: 'Pa, kPa, MPa, psi' },
    moment:    { dims: d(2, 1, -2),   si: 'N·m',   name: 'moment',        examples: 'N·m, kN·m, lb·ft' },
    energy:    { dims: d(2, 1, -2),   si: 'J',     name: 'energy',        examples: 'J, kJ' },
    density:   { dims: d(-3, 1, 0),   si: 'kg/m^3', name: 'density',      examples: 'kg/m^3' },
    text:      { dims: null,          si: '',      name: 'text',          examples: 'text' }
  };

  function parse(text, q) {
    var Q = QUANTITIES[q || 'number'];
    if (!Q) throw new Error('unknown dial quantity ' + q);
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, error: 'Type a value' + (Q.si ? ' with its unit, e.g. ' + Q.examples.split(',')[0] : '') + '.' };
    if (q === 'text') return { ok: true, si: raw, text: raw, q: 'text' };
    if (q === 'number' || !q) {
      var n = U.parseNumberPrefix(raw);
      if (!n || n.rest.trim()) return { ok: false, error: 'Type a plain number, e.g. 0.4.' };
      return { ok: true, si: n.value, text: raw, q: 'number', parsed: n };
    }
    var p = U.parseQuantity(raw);
    if (!p.ok) {
      if (p.number && !p.unitText) return { ok: false, error: 'Add a unit: this dial takes ' + Q.examples + '.' };
      return { ok: false, error: p.error };
    }
    if (!p.unitText) return { ok: false, error: 'Add a unit: this dial takes ' + Q.examples + '.' };
    if (!U.dimsEqual(p.dims, Q.dims)) {
      var nm = U.dimsName(p.dims);
      return { ok: false, error: (nm ? 'That is ' + (/^[aeiou]/.test(nm) ? 'an ' : 'a ') + nm : 'That unit is a different kind of quantity') + ', but this is ' + (/^[aeiou]/.test(Q.name) ? 'an ' : 'a ') + Q.name + ' dial (' + Q.examples + ').' };
    }
    // angles are kept in radians internally
    return { ok: true, si: p.value, text: raw, q: q, parsed: p };
  }

  // SI value -> value in `unit` (which must match q's dimensions).
  function convert(si, q, unit) {
    if (!unit) return si;
    var info = U.unitInfo(unit);
    if (!info) throw new Error('unknown unit ' + unit);
    if (q && QUANTITIES[q] && !U.dimsEqual(info.dims, QUANTITIES[q].dims)) throw new Error(unit + ' is not a ' + q + ' unit');
    return si / info.factor;
  }

  function fmtNum(v, sf) {
    if (!isFinite(v)) return String(v);
    if (v === 0) return '0';
    sf = sf || 3;
    var a = Math.abs(v);
    if (a >= 1e6 || a < 1e-3) return v.toExponential(sf - 1).replace('e+', 'e');
    var digits = Math.max(0, sf - 1 - Math.floor(Math.log10(a)));
    var s = v.toFixed(Math.min(digits, 6));
    // thin-space thousands for readability (1 850 kg)
    var parts = s.split('.');
    if (Math.abs(Number(parts[0])) >= 10000) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return parts.join('.');
  }

  function format(si, unit, sf, q) {
    var v = unit ? convert(si, q, unit) : si;
    return fmtNum(v, sf) + (unit ? ' ' + unit.replace('^2', '²').replace('^3', '³').replace('*', '·') : '');
  }

  // Default display unit for a quantity, as an engineer would pick it.
  function autoUnit(si, q) {
    var a = Math.abs(si);
    if (q === 'force') return a >= 1e6 ? 'MN' : a >= 1e3 ? 'kN' : 'N';
    if (q === 'mass') return a >= 1e4 ? 'Mg' : a >= 0.5 ? 'kg' : 'g';
    if (q === 'length') return a > 0 && a < 0.1 ? 'mm' : 'm';
    if (q === 'pressure') return a >= 1e6 ? 'MPa' : a >= 1e3 ? 'kPa' : 'Pa';
    if (q === 'angle') return 'deg';
    if (q === 'moment') return a >= 1e3 ? 'kN*m' : 'N*m';
    if (q === 'stiffness') return a >= 1e3 ? 'kN/m' : 'N/m';
    return (QUANTITIES[q] && QUANTITIES[q].si) || '';
  }

  SE.yard.dial = { QUANTITIES: QUANTITIES, parse: parse, convert: convert, format: format, fmtNum: fmtNum, autoUnit: autoUnit };
})(globalThis.SE);
