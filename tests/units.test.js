'use strict';
// Units parser, quantity parser, SI-form rules and prefix choice.
const { suite, test, eq, near, ok } = require('./harness');
const U = globalThis.SE.units;

// One parsed factor, as {prefix, sym, exp}, for compact assertions.
function one(str) {
  const r = U.parseUnit(str);
  ok(r.ok, 'parse failed for ' + str + ': ' + r.error);
  eq(r.factors.length, 1, str + ' factor count');
  return r.factors[0];
}
function factor(str) { return U.unitInfo(str).factor; }
function dims(str) { return U.unitInfo(str).dims.join(','); }
function qty(str) {
  const q = U.parseQuantity(str);
  ok(q.ok, 'quantity failed for ' + str + ': ' + q.error);
  return q;
}

suite('units: prefixes', () => {
  test('G M k m n prefixes on m', () => {
    eq(factor('Gm'), 1e9);
    eq(factor('Mm'), 1e6);
    eq(factor('km'), 1000);
    eq(factor('mm'), 0.001);
    eq(factor('nm'), 1e-9);
  });
  test('micro typed as μ (Greek mu), µ (micro sign) or u', () => {
    ['μm', 'µm', 'um'].forEach(s => {
      const f = one(s);
      eq(f.prefix, 'μ', s + ' canonical prefix');
      eq(f.sym, 'm');
      eq(factor(s), 1e-6, s);
    });
  });
  test('prefixed newtons and pascals', () => {
    eq(factor('kN'), 1000);
    eq(factor('MN'), 1e6);
    eq(factor('GPa'), 1e9);
    eq(factor('kPa'), 1000);
    eq(dims('Pa'), '-1,1,-2,0');
  });
  test('gram family: kg is the base unit, Mg is 1000 kg exactly', () => {
    // g carries p10 = -3, so k + g = 10^(3-3) = 1 exactly.
    eq(factor('kg'), 1);
    eq(factor('g'), 0.001);
    eq(factor('Mg'), 1000);
    eq(factor('mg'), 1e-6);
  });
  test('ms is the millisecond, mN the millinewton', () => {
    const f = one('ms');
    eq(f.prefix, 'm'); eq(f.sym, 's');
    eq(factor('ms'), 0.001);
    eq(factor('mN'), 0.001);
  });
  test('da is read before d (deca-metre, not deci + "am")', () => {
    const f = one('dam');
    eq(f.prefix, 'da'); eq(f.sym, 'm');
    eq(factor('dam'), 10);
  });
});

suite('units: exact unit name wins over a prefix reading', () => {
  test('min is the minute, not milli-inch', () => {
    const f = one('min');
    eq(f.prefix, ''); eq(f.sym, 'min');
    eq(factor('min'), 60);
  });
  test('mi is the mile, not milli-something', () => {
    const f = one('mi');
    eq(f.prefix, ''); eq(f.sym, 'mi');
    near(factor('mi'), 5280 * 0.3048); // 1609.344 m
  });
  test('ft, in, kip, slug, Pa, h are whole symbols', () => {
    ['ft', 'in', 'kip', 'slug', 'Pa', 'h'].forEach(s => {
      const f = one(s);
      eq(f.prefix, '', s + ' prefix');
      eq(f.sym, s, s + ' sym');
    });
    eq(factor('h'), 3600);
  });
  test('units that refuse prefixes are not prefixed', () => {
    // "kft" would be k + ft, but ft takes no SI prefix
    ok(!U.parseUnit('kft').ok);
    ok(!U.parseUnit('kmin').ok);
  });
  test('unknown symbols are reported by name', () => {
    const r = U.parseUnit('kQ');
    ok(!r.ok);
    ok(/unknown unit "kQ"/.test(r.error), r.error);
  });
  test('empty unit string parses to no factors', () => {
    const r = U.parseUnit('');
    ok(r.ok); eq(r.factors.length, 0);
    eq(U.unitInfo('').factor, 1);
  });
});

suite('units: stacked prefixes', () => {
  test('μkm is recognised as two stacked prefixes', () => {
    const f = one('μkm');
    eq(f.stacked, true);
    eq(f.prefix, 'μ'); eq(f.prefix2, 'k'); eq(f.sym, 'm');
    // 10^-6 · 10^3 = 10^-3 m
    eq(factor('μkm'), 0.001);
  });
  test('ukm (typed u) is the same', () => {
    const f = one('ukm');
    eq(f.stacked, true); eq(f.prefix, 'μ'); eq(f.prefix2, 'k');
  });
  test('a single prefix is always preferred over a stacked reading', () => {
    // "mm" could only be m+m; "kg" is k+g, never anything stacked
    ok(!one('mm').stacked);
    ok(!one('kg').stacked);
  });
});

suite('units: exponents', () => {
  test('caret, superscript, bare digit and ** all give m²', () => {
    ['m^2', 'm²', 'm2', 'm**2'].forEach(s => {
      eq(one(s).exp, 2, s);
      eq(dims(s), '2,0,0,0', s);
    });
  });
  test('negative exponents: s^-2, s⁻², s-2', () => {
    ['s^-2', 's⁻²', 's-2'].forEach(s => eq(one(s).exp, -2, s));
  });
  test('fractional exponent in parentheses', () => {
    near(one('m^(1/2)').exp, 0.5);
  });
  test('the exponent applies to the prefix too: km² = 10^6 m²', () => {
    eq(factor('km^2'), 1e6);
    eq(factor('mm³'), 1e-9);
    eq(factor('cm^2'), 1e-4);
  });
  test('kg·m·s-2 is a newton (bare -2 is an exponent, not a separator)', () => {
    eq(dims('kg·m·s-2'), dims('N'));
  });
  test('bad exponent is an error', () => {
    ok(!U.parseUnit('m^').ok);
  });
});

suite('units: separators, parentheses and division', () => {
  test('m·s, m*s, m.s, m s and m-s are products; ms is a millisecond', () => {
    ['m·s', 'm*s', 'm.s', 'm s', 'm-s', 'm⋅s', 'm•s'].forEach(s => {
      const r = U.parseUnit(s);
      ok(r.ok, s);
      eq(r.factors.length, 2, s);
      eq(dims(s), '1,0,1,0', s);
    });
    eq(dims('ms'), '0,0,1,0');
  });
  test('N-m is a newton-metre (moment), not N^-m', () => {
    eq(dims('N-m'), '2,1,-2,0');
  });
  test('division reads left to right: kg·m/s² = (kg·m)/s²', () => {
    eq(dims('kg·m/s²'), '1,1,-2,0');
  });
  test('m/s/s = m/s², and N/m·s = (N/m)·s', () => {
    eq(dims('m/s/s'), '1,0,-2,0');
    // N/m = M T^-2; times s = M T^-1
    eq(dims('N/m·s'), '0,1,-1,0');
  });
  test('parentheses group the denominator: N/(kg·s)', () => {
    // N/(kg s) = L M T^-2 / (M T) = L T^-3
    eq(dims('N/(kg·s)'), '1,0,-3,0');
    const r = U.parseUnit('N/(kg·s)');
    eq(r.factors.filter(f => f.den).length, 2, 'both inside the parentheses are in the denominator');
  });
  test('powered parentheses: (m/s)^2', () => {
    eq(dims('(m/s)^2'), '2,0,-2,0');
  });
  test('spaces around operators', () => {
    eq(dims('kg m / s^2'), '1,1,-2,0');
    eq(dims(' N · m '), '2,1,-2,0');
  });
  test('missing ) is an error', () => {
    ok(!U.parseUnit('N/(kg·s').ok);
  });
  test('stray characters are an error', () => {
    ok(!U.parseUnit('N # m').ok);
  });
  test('degrees with the ° sign', () => {
    near(factor('°'), Math.PI / 180);
    eq(dims('deg'), '0,0,0,1');
  });
});

suite('units: numbers', () => {
  test('plain, signed and leading-dot numbers', () => {
    eq(U.parseNumberPrefix('12 m').value, 12);
    eq(U.parseNumberPrefix('-3.5 m').value, -3.5);
    eq(U.parseNumberPrefix('+2 m').value, 2);
    eq(U.parseNumberPrefix('.5 m').value, 0.5);
  });
  test('space digit-grouping in the whole part: "52 800"', () => {
    const n = U.parseNumberPrefix('52 800 N');
    eq(n.mantissa, '52800');
    eq(n.value, 52800);
    eq(n.rest.trim(), 'N');
  });
  test('space digit-grouping in the decimals: "9.806 65"', () => {
    const n = U.parseNumberPrefix('9.806 65 m/s^2');
    eq(n.mantissa, '9.80665');
    eq(n.value, 9.80665);
    eq(n.rest.trim(), 'm/s^2');
  });
  test('thin and no-break spaces also group digits', () => {
    eq(U.parseNumberPrefix('1 000 000 N').value, 1e6);
    eq(U.parseNumberPrefix('1 000 N').value, 1000);
  });
  test('a number followed by a unit is not mistaken for grouping', () => {
    // "12 in": 'in' is not three digits, so 12 stands alone
    const n = U.parseNumberPrefix('12 in');
    eq(n.value, 12);
    eq(n.rest.trim(), 'in');
  });
  test('engineering notation 23.4(10^3)', () => {
    const n = U.parseNumberPrefix('23.4(10^3) N');
    eq(n.mantissa, '23.4'); eq(n.exp10, 3); eq(n.expStyle, 'paren');
    near(n.value, 23400);
    eq(n.mantissaValue, 23.4);
  });
  test('engineering notation 23.4(10³) and 23.4(10⁻³)', () => {
    near(U.parseNumberPrefix('23.4(10³) N').value, 23400);
    const n = U.parseNumberPrefix('23.4(10⁻³) N');
    eq(n.exp10, -3);
    near(n.value, 0.0234);
  });
  test('the printed form 23.4(10-3) means 10^-3', () => {
    const n = U.parseNumberPrefix('23.4(10-3) N');
    eq(n.exp10, -3);
    near(n.value, 0.0234);
  });
  test('e-notation 2.3e3 and 2.3E-3', () => {
    const a = U.parseNumberPrefix('2.3e3 N');
    eq(a.exp10, 3); eq(a.expStyle, 'e'); near(a.value, 2300);
    near(U.parseNumberPrefix('2.3E-3 N').value, 0.0023);
  });
  test('times forms: 2.3 × 10^3, 2.3x10^3, 2.3*10^3, 2.3·10³', () => {
    ['2.3 × 10^3 N', '2.3x10^3 N', '2.3*10^3 N', '2.3·10³ N'].forEach(s => {
      const n = U.parseNumberPrefix(s);
      eq(n.expStyle, 'times', s);
      near(n.value, 2300, 1e-12, s);
      eq(n.rest.trim(), 'N', s);
    });
  });
  test('no number at all returns null', () => {
    eq(U.parseNumberPrefix('kN'), null);
    eq(U.parseNumberPrefix(''), null);
  });
});

suite('units: quantities in SI base units', () => {
  test('4.62 kN = 4620 N', () => {
    const q = qty('4.62 kN');
    near(q.value, 4620);
    eq(q.given, 4.62);
    eq(q.dims.join(','), '1,1,-2,0');
  });
  test('engineering-notation quantities', () => {
    near(qty('23.4(10^3) N').value, 23400);
    near(qty('23.4(10³) N').value, 23400);
    near(qty('23.4(10-3) N').value, 0.0234);
    near(qty('2.3e3 N').value, 2300);
    near(qty('2.3 × 10^3 N').value, 2300);
  });
  test('grouped numbers as quantities', () => {
    eq(qty('52 800 ft').given, 52800);
    near(qty('52 800 ft').value, 52800 * 0.3048); // 16 093.44 m (10 miles)
    near(qty('9.806 65 m/s^2').value, 9.80665);
  });
  test('no number is a friendly parse error', () => {
    const q = U.parseQuantity('kN');
    ok(!q.ok); ok(/Start with a number/.test(q.error));
  });
  test('bad unit after a good number is a parse error', () => {
    ok(!U.parseQuantity('4.62 kQ').ok);
  });
  test('a pure number is dimensionless', () => {
    const q = qty('0.5');
    ok(U.isDimensionless(q.dims));
  });
});

suite('units: FPS conversion factors (Table 1-2 values)', () => {
  test('1 lb = 4.448 N', () => { near(qty('1 lb').value, 4.448); near(qty('1 lbf').value, 4.448); });
  test('1 slug = 14.59 kg', () => near(qty('1 slug').value, 14.59));
  test('1 ft = 0.3048 m', () => near(qty('1 ft').value, 0.3048));
  test('12 in = 1 ft', () => near(qty('12 in').value, 0.3048));
  test('1 mi = 5280 ft', () => near(qty('1 mi').value, qty('5280 ft').value));
  test('1 kip = 1000 lb = 4448 N', () => near(qty('1 kip').value, 4448));
  test('1 ton = 2000 lb = 8896 N', () => near(qty('1 ton').value, 8896));
  test('1 yd = 3 ft', () => near(qty('1 yd').value, 0.9144));
  test('1 psi = 4.448 N / (0.0254 m)²', () => {
    // 4.448 / 0.00064516 = 6894.4 Pa
    near(qty('1 psi').value, 4.448 / (0.0254 * 0.0254));
    near(qty('1 psi').value, 6894.4, 1e-4);
  });
  test('slug·ft/s² is a pound-ish force', () => {
    // 14.59 · 0.3048 = 4.447 N, which is why 1 lb ≈ 1 slug·ft/s²
    near(qty('1 slug·ft/s^2').value, 14.59 * 0.3048);
    eq(qty('1 slug·ft/s^2').dims.join(','), qty('1 lb').dims.join(','));
  });
  test('convert() between systems and its dimension check', () => {
    near(U.convert(1, 'lb', 'N'), 4.448);
    near(U.convert(4448, 'N', 'kip'), 1);
    near(U.convert(1, 'ft^2', 'in^2'), 144);
    near(U.convert(60, 'mi/h', 'ft/s'), 88); // 60·5280/3600
    let threw = false;
    try { U.convert(1, 'kg', 'N'); } catch (e) { threw = /dimension mismatch/.test(e.message); }
    ok(threw, 'mass to force must throw');
  });
});

suite('units: dimension helpers', () => {
  test('names and SI strings', () => {
    eq(U.dimsName(U.dim(1, 1, -2)), 'force');
    eq(U.dimsName(U.dim(0, 1, 0)), 'mass');
    eq(U.dimsName(U.dim(5, 0, 0)), null);
    eq(U.dimsToSI(U.dim(1, 1, -2)), 'kg·m/s²');
    eq(U.dimsToSI(U.dim(0, 1, -1, -1)), 'kg/(s·rad)');
    eq(U.dimsToString(U.dim(1, 1, -2)), 'L·M·T⁻²');
    eq(U.dimsToString(U.dim()), '1 (dimensionless)');
  });
  test('mul, div, pow', () => {
    eq(U.dimsMul(U.dim(1, 1, -2), U.dim(1)).join(','), '2,1,-2,0');
    eq(U.dimsDiv(U.dim(1, 1, -2), U.dim(0, 1)).join(','), '1,0,-2,0');
    eq(U.dimsPow(U.dim(1, 0, -1), 2).join(','), '2,0,-2,0');
  });
  test('formatFactors and simplifyFactors', () => {
    eq(U.formatFactors(U.parseUnit('kg·m/s^2').factors), 'kg·m/s²');
    eq(U.formatFactors(U.parseUnit('N/(kg·s)').factors), 'N/(kg·s)');
    const s = U.simplifyFactors(U.parseUnit('m·m·s/s').factors);
    eq(s.length, 1); eq(s[0].sym, 'm'); eq(s[0].exp, 2);
    // km and m are kept apart
    eq(U.simplifyFactors(U.parseUnit('km·m').factors).length, 2);
  });
});

suite('units: checkSIForm', () => {
  const codes = s => U.checkSIForm(qty(s)).map(i => i.code).sort().join(',');
  test('clean SI answers pass', () => {
    eq(codes('4.62 kN'), '');
    eq(codes('23.4(10^3) N'), '');
    eq(codes('9.81 m/s^2'), '');
    eq(codes('0.1 m'), '', '0.1 is inside the range');
    eq(codes('999 MPa'), '');
  });
  test('prefix in the denominator is flagged (kN/ms)', () => {
    ok(codes('5.00 N/ms').includes('prefix-denominator'));
    ok(codes('5.00 kN/ms').includes('prefix-denominator'));
  });
  test('kg is allowed in the denominator', () => {
    eq(codes('9.81 N/kg'), '');
    eq(codes('7.85 Mg/m^3'), '');
  });
  test('multiple prefixes are flagged, kg excepted', () => {
    ok(codes('5.00 kN/ms').includes('multiple-prefix'));
    ok(codes('5.00 kN·mm').includes('multiple-prefix'));
    // kN·kg has only one counted prefix
    ok(!codes('5.00 kN·kg').includes('multiple-prefix'));
  });
  test('stacked prefixes are flagged with the combined name', () => {
    const issues = U.checkSIForm(qty('5.00 μkm'));
    const st = issues.find(i => i.code === 'stacked-prefix');
    ok(st, 'stacked flagged');
    ok(/\(mm\)/.test(st.msg), st.msg); // μ·k = 10^-3 → mm
  });
  test('the number must sit in 0.1–1000', () => {
    ok(codes('4620 N').includes('range'));
    ok(codes('1000 N').includes('range'), '1000 itself is out');
    ok(codes('0.0462 m').includes('range'));
    ok(codes('0.099 m').includes('range'));
    eq(U.checkSIForm(qty('4620 N'), { skipRange: true }).length, 0);
  });
  test('engineering notation uses the mantissa and multiples of 3', () => {
    eq(codes('4.62(10^3) N'), '');
    ok(codes('46.2(10^2) N').includes('eng-exponent'));
    ok(codes('4620(10^-3) kN').includes('range'));
    eq(codes('46.2(10^-3) N'), '');
  });
  test('centi, deci, deca, hecto are avoided', () => {
    ok(codes('4.62 cm').includes('non-eng-prefix'));
    ok(codes('4.62 dam').includes('non-eng-prefix'));
    ok(codes('4.62 dm').includes('non-eng-prefix'));
  });
  test('non-SI units are flagged', () => {
    ok(codes('4.62 lb').includes('not-si'));
    ok(codes('4.62 ft').includes('not-si'));
    ok(codes('4.62 min').includes('not-si'));
    eq(U.checkSIForm(qty('4.62 min'), { allowOther: true }).length, 0);
  });
});

suite('units: ambiguous prefix readings', () => {
  test('ms and mN get a note, kN does not', () => {
    eq(U.ambiguousPrefixReadings(qty('5 ms')).length, 1);
    eq(U.ambiguousPrefixReadings(qty('5 ms'))[0].asProduct, 'm·s');
    eq(U.ambiguousPrefixReadings(qty('5 mN')).length, 1);
    eq(U.ambiguousPrefixReadings(qty('5 kN')).length, 0);
    eq(U.ambiguousPrefixReadings(qty('5 m·s')).length, 0);
  });
});

suite('units: bestPrefix', () => {
  test('puts the number in [1, 1000)', () => {
    const a = U.bestPrefix(4620, 'N');
    eq(a.prefix, 'k'); near(a.num, 4.62);
    const b = U.bestPrefix(0.0462, 'm');
    eq(b.prefix, 'm'); near(b.num, 46.2);
    const c = U.bestPrefix(250, 'N');
    eq(c.prefix, ''); near(c.num, 250);
    eq(U.bestPrefix(3.2e9, 'Pa').prefix, 'G');
    eq(U.bestPrefix(5e-6, 's').prefix, 'μ');
  });
  test('1000 moves up a prefix; 999 does not', () => {
    eq(U.bestPrefix(1000, 'N').prefix, 'k');
    eq(U.bestPrefix(999, 'N').prefix, '');
  });
  test('mass is prefixed on the gram: 5 kg → 5 kg, 5000 kg → 5 Mg', () => {
    const a = U.bestPrefix(5, 'g');
    eq(a.prefix, 'k'); near(a.num, 5);
    const b = U.bestPrefix(5000, 'g');
    eq(b.prefix, 'M'); near(b.num, 5);
  });
  test('powers: 2.5·10^6 N² → 2.5 kN²', () => {
    const a = U.bestPrefix(2.5e6, 'N', 2);
    eq(a.prefix, 'k'); near(a.num, 2.5);
  });
  test('units without prefixes stay as they are', () => {
    const a = U.bestPrefix(3048, 'ft'); // 3048 m = 10 000 ft
    eq(a.prefix, ''); near(a.num, 10000);
  });
  test('negative and zero values', () => {
    const a = U.bestPrefix(-4620, 'N');
    eq(a.prefix, 'k'); near(a.num, -4.62);
    eq(U.bestPrefix(0, 'N').num, 0);
  });
});
