'use strict';
// Equation typesetter: markup to HTML.
const { suite, test, eq, ok } = require('./harness');
const E = globalThis.SE.eq;
const r = E.render;

suite('eq: variables, numbers and operators', () => {
  test('single letters are italic variables, longer words are upright', () => {
    eq(r('x'), '<i>x</i>');
    eq(r('ma'), '<span class="eq-word">ma</span>');
  });
  test('numbers are upright text', () => eq(r('12.5'), '12.5'));
  test('= gets operator spacing, minus becomes a real minus sign', () => {
    eq(r('a=b'), '<i>a</i><span class="eq-op">=</span><i>b</i>');
    eq(r('a - b'), '<i>a</i> <span class="eq-op">−</span> <i>b</i>');
    eq(r('a+b'), '<i>a</i><span class="eq-op">+</span><i>b</i>');
  });
  test('bare braces only group', () => eq(r('{x}'), '<i>x</i>'));
});

suite('eq: superscripts and subscripts', () => {
  test('braced and single-character forms', () => {
    eq(r('x^{2}'), '<i>x</i><sup>2</sup>');
    eq(r('x^2'), '<i>x</i><sup>2</sup>');
    eq(r('x_e'), '<i>x</i><sub><i>e</i></sub>');
    eq(r('F_{AB}'), '<i>F</i><sub><span class="eq-word">AB</span></sub>');
  });
  test('a run of digits is one group: x^10', () => eq(r('x^10'), '<i>x</i><sup>10</sup>'));
  test('negative exponent: x^-1', () => {
    eq(r('x^-1'), '<i>x</i><sup><span class="eq-op">−</span>1</sup>');
  });
  test('nested: e^{x_1}', () => eq(r('e^{x_1}'), '<i>e</i><sup><i>x</i><sub>1</sub></sup>'));
});

suite('eq: commands', () => {
  test('fraction', () => {
    eq(r('\\frac{a}{b}'), '<span class="eq-frac"><span class="eq-num"><i>a</i></span><span class="eq-den"><i>b</i></span></span>');
  });
  test('nested fraction inside a square root', () => {
    const h = r('\\sqrt{\\frac{F}{m}}');
    ok(h.indexOf('<span class="eq-sqrt"><span class="eq-radic">√</span><span class="eq-rad"><span class="eq-frac">') === 0, h);
  });
  test('square root', () => {
    eq(r('\\sqrt{x}'), '<span class="eq-sqrt"><span class="eq-radic">√</span><span class="eq-rad"><i>x</i></span></span>');
  });
  test('units are upright but keep superscripts', () => {
    eq(r('\\u{kg·m/s^2}'), '<span class="eq-unit">kg·m/s<sup>2</sup></span>');
  });
  test('plain upright text', () => eq(r('\\t{if}'), '<span class="eq-text">if</span>'));
  test('highlight and strike', () => {
    eq(r('\\hl{m}'), '<span class="eq-hl"><i>m</i></span>');
    eq(r('\\strike{kg}'), '<span class="eq-strike"><span class="eq-word">kg</span></span>');
  });
  test('strike inside a unit (unit-cancellation chains)', () => {
    eq(r('\\u{\\strike{ft}·m/\\strike{ft}}'),
      '<span class="eq-unit"><span class="eq-strike">ft</span>·m/<span class="eq-strike">ft</span></span>');
  });
  test('symbols', () => {
    eq(r('\\Sigma F_x = 0'), '<span class="eq-sym">Σ</span> <i>F</i><sub><i>x</i></sub> <span class="eq-op">=</span> 0');
    eq(r('\\theta'), '<span class="eq-sym">θ</span>');
    eq(r('\\approx'), '<span class="eq-sym">≈</span>');
    eq(r('\\u{\\mu m}'), '<span class="eq-unit">μ m</span>');
  });
  test('unknown commands print their name; escaped characters print literally', () => {
    eq(r('\\foo'), 'foo');
    eq(r('\\{'), '{');
  });
});

suite('eq: escaping and the html wrapper', () => {
  test('HTML special characters are escaped', () => {
    eq(r('a<b&c'), '<i>a</i>&lt;<i>b</i>&amp;<i>c</i>');
    eq(r('\\t{a<b}'), '<span class="eq-text">a&lt;b</span>');
    eq(E.esc('<script>'), '&lt;script&gt;');
  });
  test('html() wraps and adds an optional equation tag', () => {
    eq(E.html('x'), '<span class="eq"><i>x</i></span>');
    eq(E.html('F=ma', '1-1'), '<span class="eq"><i>F</i><span class="eq-op">=</span><span class="eq-word">ma</span><span class="eq-tag">(1-1)</span></span>');
    eq(E.html('x', '<b>'), '<span class="eq"><i>x</i><span class="eq-tag">(&lt;b&gt;)</span></span>');
  });
  test('non-string input is coerced', () => eq(r(42), '42'));
});
