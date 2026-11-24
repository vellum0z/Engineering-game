/*
 * Expression parser shared by the workshop calculator and the dimension
 * checker. Produces a small AST that can be evaluated either numerically or
 * over dimensions.
 *
 * Supports: numbers (incl. 1.2e-3), identifiers with subscripts (m_1, M_e),
 * + - * / ^, implicit multiplication ("2a", "a b", "2(x+1)"), parentheses,
 * functions sqrt sin cos tan asin acos atan ln log abs, constants pi.
 * An equation "lhs = rhs" is parsed into both sides.
 */
(function (SE) {
  'use strict';
  var U = SE.units;

  function tokenize(src) {
    var toks = [], i = 0;
    src = String(src).replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'sqrt').replace(/π/g, 'pi');
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      var m;
      if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i)))) { toks.push({ t: 'num', v: Number(m[0]), s: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω]*(_\{?[A-Za-z0-9]+\}?)?/.exec(src.slice(i)))) { toks.push({ t: 'id', v: m[0].replace(/[{}]/g, '') }); i += m[0].length; continue; }
      if ('+-*/^()=,'.indexOf(c) >= 0) { toks.push({ t: c }); i++; continue; }
      throw new Error('Unexpected "' + c + '"');
    }
    return toks;
  }

  var FUNCS = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp };

  function parse(src) {
    var toks = tokenize(src), p = 0;
    function peek() { return toks[p]; }
    function eat(t) { if (!toks[p] || toks[p].t !== t) throw new Error('Expected "' + t + '"'); return toks[p++]; }

    function equation() {
      var l = sum();
      if (peek() && peek().t === '=') { p++; var r = sum(); return { type: 'eq', l: l, r: r }; }
      return l;
    }
    function sum() {
      var terms = [{ sign: 1, node: product() }];
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var s = toks[p++].t === '-' ? -1 : 1;
        terms.push({ sign: s, node: product() });
      }
      return terms.length === 1 && terms[0].sign === 1 ? terms[0].node : { type: 'sum', terms: terms };
    }
    function product() {
      var n = unary();
      for (;;) {
        var t = peek();
        if (!t) break;
        if (t.t === '*' || t.t === '/') { p++; var r = unary(); n = { type: t.t === '*' ? 'mul' : 'div', l: n, r: r }; continue; }
        if (t.t === 'num' || t.t === 'id' || t.t === '(') { var r2 = power(); n = { type: 'mul', l: n, r: r2 }; continue; }
        break;
      }
      return n;
    }
    function unary() {
      if (peek() && peek().t === '-') { p++; return { type: 'neg', a: unary() }; }
      if (peek() && peek().t === '+') { p++; return unary(); }
      return power();
    }
    function power() {
      var b = atom();
      if (peek() && peek().t === '^') { p++; var e = unary(); return { type: 'pow', b: b, e: e }; }
      return b;
    }
    function atom() {
      var t = peek();
      if (!t) throw new Error('Unexpected end');
      if (t.t === 'num') { p++; return { type: 'num', v: t.v }; }
      if (t.t === 'id') {
        p++;
        if (FUNCS[t.v] && peek() && peek().t === '(') { p++; var a = sum(); eat(')'); return { type: 'fn', f: t.v, a: a }; }
        if (t.v === 'pi') return { type: 'num', v: Math.PI };
        return { type: 'var', name: t.v };
      }
      if (t.t === '(') { p++; var n = sum(); eat(')'); return n; }
      throw new Error('Unexpected "' + t.t + '"');
    }
    var ast = equation();
    if (p < toks.length) throw new Error('Unexpected "' + (toks[p].v || toks[p].t) + '"');
    return ast;
  }

  function evalNum(n, vars) {
    vars = vars || {};
    switch (n.type) {
      case 'num': return n.v;
      case 'var':
        if (vars[n.name] == null) throw new Error('Unknown value "' + n.name + '"');
        return vars[n.name];
      case 'neg': return -evalNum(n.a, vars);
      case 'sum': return n.terms.reduce(function (s, t) { return s + t.sign * evalNum(t.node, vars); }, 0);
      case 'mul': return evalNum(n.l, vars) * evalNum(n.r, vars);
      case 'div': return evalNum(n.l, vars) / evalNum(n.r, vars);
      case 'pow': return Math.pow(evalNum(n.b, vars), evalNum(n.e, vars));
      case 'fn': return FUNCS[n.f](evalNum(n.a, vars));
      case 'eq': throw new Error('That is an equation, not an expression.');
    }
    throw new Error('bad node');
  }

  /*
   * Dimension evaluation. varDims maps names to dimension vectors. Sums
   * record every term's dimensions so mismatches can be reported per term.
   * Exponents must be dimensionless numbers.
   */
  function evalDims(n, varDims, report) {
    report = report || { problems: [] };
    switch (n.type) {
      case 'num': return U.dim();
      case 'var':
        if (!varDims[n.name]) { report.problems.push({ kind: 'unknown', msg: 'No units given for "' + n.name + '".' }); return null; }
        return varDims[n.name];
      case 'neg': return evalDims(n.a, varDims, report);
      case 'sum':
        var dims = n.terms.map(function (t) { return evalDims(t.node, varDims, report); });
        var first = dims[0];
        var bad = [];
        dims.forEach(function (d, i) { if (d && first && !U.dimsEqual(d, first)) bad.push(i); });
        if (bad.length) report.problems.push({ kind: 'sum', terms: n.terms.map(function (t, i) { return { text: toText(t.node), dims: dims[i] }; }), bad: bad, msg: 'Terms being added have different dimensions.' });
        return first;
      case 'mul': var a = evalDims(n.l, varDims, report), b = evalDims(n.r, varDims, report); return a && b ? U.dimsMul(a, b) : null;
      case 'div': var c = evalDims(n.l, varDims, report), d2 = evalDims(n.r, varDims, report); return c && d2 ? U.dimsDiv(c, d2) : null;
      case 'pow':
        var base = evalDims(n.b, varDims, report);
        var ed = evalDims(n.e, varDims, report);
        if (ed && !U.isDimensionless(ed)) report.problems.push({ kind: 'exponent', msg: 'An exponent must be a pure number.' });
        var ev;
        try { ev = evalNum(n.e, {}); } catch (e) { report.problems.push({ kind: 'exponent', msg: 'Exponent must be a number for a dimension check.' }); return null; }
        return base ? U.dimsPow(base, ev) : null;
      case 'fn':
        var ad = evalDims(n.a, varDims, report);
        if (n.f === 'sqrt') return ad ? U.dimsPow(ad, 0.5) : null;
        if (n.f === 'abs') return ad;
        if (ad && !U.isDimensionless(ad) && !(['sin', 'cos', 'tan'].indexOf(n.f) >= 0 && U.dimsEqual(ad, U.dim(0, 0, 0, 1)))) report.problems.push({ kind: 'function', msg: n.f + '( ) needs a dimensionless argument.' });
        return U.dim();
      case 'eq':
        var l = evalDims(n.l, varDims, report), r = evalDims(n.r, varDims, report);
        if (l && r && !U.dimsEqual(l, r)) report.problems.push({ kind: 'sides', msg: 'The two sides have different dimensions.', l: l, r: r });
        report.lhs = l; report.rhs = r;
        return l;
    }
    return null;
  }

  // Top-level terms of an expression or each side of an equation, for
  // display: [{ side, text, dims }]
  function terms(n, varDims) {
    var out = [];
    function side(node, name) {
      var list = node.type === 'sum' ? node.terms.map(function (t) { return { node: t.node, sign: t.sign }; }) : [{ node: node, sign: 1 }];
      list.forEach(function (t) {
        var rep = { problems: [] };
        out.push({ side: name, sign: t.sign, text: toText(t.node), dims: evalDims(t.node, varDims, rep) });
      });
    }
    if (n.type === 'eq') { side(n.l, 'left'); side(n.r, 'right'); } else side(n, 'expr');
    return out;
  }

  function analyze(src, varUnits) {
    var varDims = {};
    Object.keys(varUnits || {}).forEach(function (k) {
      var info = U.unitInfo(varUnits[k]);
      if (info) varDims[k] = info.dims;
      else if (Array.isArray(varUnits[k])) varDims[k] = varUnits[k];
    });
    var ast = parse(src);
    var report = { problems: [] };
    var d = evalDims(ast, varDims, report);
    var t = terms(ast, varDims);
    var homogeneous = report.problems.filter(function (p) { return p.kind === 'sum' || p.kind === 'sides' || p.kind === 'exponent' || p.kind === 'function'; }).length === 0;
    var ref = t[0] && t[0].dims;
    t.forEach(function (x) { x.ok = !!(x.dims && ref && U.dimsEqual(x.dims, ref)); });
    return { ast: ast, dims: d, terms: t, problems: report.problems, homogeneous: homogeneous && report.problems.every(function (p) { return p.kind !== 'unknown'; }) };
  }

  function toText(n) {
    switch (n.type) {
      case 'num': return String(+n.v.toPrecision(6));
      case 'var': return n.name;
      case 'neg': return '−' + wrap(n.a);
      case 'sum': return n.terms.map(function (t, i) { return (i ? (t.sign < 0 ? ' − ' : ' + ') : (t.sign < 0 ? '−' : '')) + toText(t.node); }).join('');
      case 'mul': return wrap(n.l) + '·' + wrap(n.r);
      case 'div': return wrap(n.l) + '/' + wrap(n.r);
      case 'pow': return wrap(n.b) + '^' + wrap(n.e);
      case 'fn': return n.f + '(' + toText(n.a) + ')';
      case 'eq': return toText(n.l) + ' = ' + toText(n.r);
    }
    return '?';
  }
  function wrap(n) { return (n.type === 'sum' || n.type === 'neg') ? '(' + toText(n) + ')' : toText(n); }

  SE.expr = { parse: parse, evalNum: evalNum, evalDims: evalDims, analyze: analyze, toText: toText, terms: terms };
})(globalThis.SE);
