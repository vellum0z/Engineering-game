/*
 * Workshop tools. Each tool is unlocked once (usually by a Chapter 1 level)
 * and then stays in the workshop for the rest of the game.
 *
 *   formula   formula sheet + reference tables (grows as levels are played)
 *   calc      calculator that keeps full precision (always available)
 *   converter unit converter with the cancellation chain shown
 *   dimcheck  dimension checker for equations
 *   sigfig    significant-figure gauge and rounding machine
 *   notebook  field notebook (always available)
 *
 * A manual project may lock tools that would do the very skill it tests.
 */
(function (SE) {
  'use strict';
  var el, md, inline;

  var TOOLS = [
    { id: 'formula', name: 'Formula sheet', key: 'f', icon: '∑', always: false },
    { id: 'calc', name: 'Calculator', key: 'c', icon: '⌗', always: true },
    { id: 'converter', name: 'Unit converter', key: 'u', icon: '⇄' },
    { id: 'dimcheck', name: 'Dimension checker', key: 'd', icon: '[L]' },
    { id: 'sigfig', name: 'Sig-fig gauge', key: 'g', icon: '±' },
    { id: 'notebook', name: 'Field notebook', key: 'n', icon: '✎', always: true }
  ];

  function available(save, id) {
    var t = TOOLS.filter(function (x) { return x.id === id; })[0];
    if (!t) return false;
    if (t.always) return true;
    if (id === 'formula') return save.formulaSheet.length > 0 || save.unlocks.tools.indexOf('formula') >= 0;
    return save.unlocks.tools.indexOf(id) >= 0;
  }

  function open(id, ctx) {
    el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline;
    ctx = ctx || {};
    var save = SE.game.save;
    if (ctx.locked && ctx.locked.indexOf(id) >= 0) {
      SE.ui.toast('The **' + nameOf(id) + '** is in the shop for repairs: this brief tests that skill by hand.', 'warn', 4200);
      return;
    }
    if (!available(save, id)) { SE.ui.toast('Not unlocked yet. Keep playing Act I.', 'warn'); return; }
    var body = ({ formula: formulaSheet, calc: calculator, converter: converter, dimcheck: dimChecker, sigfig: sigGauge, notebook: notebook })[id](save, ctx);
    SE.ui.modal({ title: nameOf(id), body: body, class: 'tool tool-' + id });
  }

  function nameOf(id) { var t = TOOLS.filter(function (x) { return x.id === id; })[0]; return t ? t.name : id; }

  /* ------------------------------------------------------- formula sheet */
  function formulaSheet(save) {
    var wrap = el('div', { class: 'formula-sheet' });
    var groups = {};
    save.formulaSheet.forEach(function (fid) {
      var f = SE.content.formula(fid);
      if (!f) return;
      var g = f.group || 'General';
      (groups[g] = groups[g] || []).push(f);
    });
    var keys = Object.keys(groups);
    if (!keys.length) wrap.appendChild(el('p', { class: 'muted', text: 'Empty so far. Every principle you learn in handheld mode is written here, and it stays with you in manual mode.' }));
    keys.forEach(function (g) {
      wrap.appendChild(el('h3', { text: g }));
      groups[g].forEach(function (f) {
        var item = el('div', { class: 'formula' }, [
          el('div', { class: 'formula-title', text: f.title }),
          f.eq ? el('div', { class: 'formula-eq', html: SE.eq.html(f.eq, f.tag) }) : null,
          f.table ? table(f.table) : null,
          f.note ? el('div', { class: 'formula-note', html: inline(f.note) }) : null
        ]);
        wrap.appendChild(item);
      });
    });
    return wrap;
  }

  function table(t) {
    return el('table', { class: 'ref-table' }, [
      el('thead', {}, [el('tr', {}, t.head.map(function (h) { return el('th', { html: inline(h) }); }))]),
      el('tbody', {}, t.rows.map(function (r) { return el('tr', {}, r.map(function (c) { return el('td', { html: inline(String(c)) }); })); }))
    ]);
  }

  /* ---------------------------------------------------------- calculator */
  var calcHistory = [];
  function calculator() {
    var out = el('div', { class: 'calc-history' });
    var input = el('input', { type: 'text', class: 'answer-input mono', placeholder: 'e.g. 6.673e-11 * 15 * 25 / 0.6^2   (ans = last result)', spellcheck: 'false', autocomplete: 'off' });
    function render() {
      SE.ui.clear(out);
      calcHistory.slice(-12).forEach(function (h) {
        out.appendChild(el('div', { class: 'calc-line' }, [
          el('span', { class: 'calc-expr', text: h.expr }),
          el('span', { class: 'calc-res', text: h.err ? '⚠ ' + h.err : '= ' + full(h.value) })
        ]));
      });
      out.scrollTop = out.scrollHeight;
    }
    function full(v) { return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(10).replace(/\.?0+e/, 'e') : String(+v.toPrecision(12)); }
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var s = input.value.trim(); if (!s) return;
      var last = calcHistory.filter(function (h) { return !h.err; }).slice(-1)[0];
      try {
        var v = SE.expr.evalNum(SE.expr.parse(s), { ans: last ? last.value : 0, e: Math.E });
        calcHistory.push({ expr: s, value: v });
      } catch (err) { calcHistory.push({ expr: s, err: err.message }); }
      input.value = ''; render();
    });
    render();
    return el('div', {}, [
      el('p', { class: 'muted', html: inline('Keeps 12 significant figures so intermediate results never lose precision. Round only the final answer. Functions: `sqrt sin cos tan ln log abs`, constant `pi`, previous result `ans`. Numbers only: units are your job.') }),
      out, input
    ]);
  }

  /* ------------------------------------------------------- unit converter */
  function converter() {
    var from = SE.ui.answerField({ label: 'Quantity', placeholder: 'e.g. 450 lb·s' });
    var to = el('input', { type: 'text', class: 'answer-input', placeholder: 'target unit, e.g. kN·s', spellcheck: 'false' });
    var result = el('div', { class: 'converter-result' });
    function go() {
      SE.ui.clear(result);
      var q = SE.units.parseQuantity(from.value());
      if (!q.ok) { result.textContent = '⚠ ' + q.error; return; }
      var t = SE.units.unitInfo(to.value.trim());
      if (!t) { result.textContent = '⚠ Unknown target unit.'; return; }
      if (!SE.units.dimsEqual(q.dims, t.dims)) {
        result.innerHTML = inline('⚠ Cannot convert **' + SE.units.dimsName(q.dims) + '** into **' + (SE.units.dimsName(t.dims) || SE.units.dimsToString(t.dims)) + '**: the dimensions differ (' + SE.units.dimsToString(q.dims) + ' vs ' + SE.units.dimsToString(t.dims) + ').');
        return;
      }
      var v = q.value / t.factor;
      result.appendChild(el('div', { class: 'chain', html: chainHtml(q, t) }));
      result.appendChild(el('div', { class: 'converter-out', text: '= ' + String(+v.toPrecision(10)) + ' ' + t.pretty }));
      result.appendChild(el('div', { class: 'muted', text: 'Unrounded. Report to the precision your data justifies.' }));
    }
    to.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    from.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    return el('div', {}, [
      el('p', { class: 'muted', html: inline('Multiply by factors equal to one, arranged so the unwanted units cancel. Factors from the reference table: 1 lb = 4.448 N, 1 slug = 14.59 kg, 1 ft = 0.3048 m.') }),
      from.el, el('label', { class: 'answer-field' }, [el('span', { class: 'answer-label', text: 'Convert to' }), to]),
      SE.ui.button('Convert', go, 'primary'), result
    ]);
  }

  // Show each source unit's factor as a "= 1" fraction.
  function chainHtml(q, t) {
    var U = SE.units;
    var parts = [SE.eq.esc(q.number.mantissa + (q.number.hasExp ? '×10^' + q.number.exp10 : '') + ' ' + U.formatFactors(q.unit.factors))];
    q.unit.factors.forEach(function (f) {
      var u = U.UNITS[f.sym];
      var pf = (f.prefix ? U.PREFIXES[f.prefix].p : 0) + (u.p10 || 0);
      var siUnit = U.dimsToSI(u.d) || '1';
      var fac = u.f * U.pow10(pf);
      if (fac === 1 && !f.prefix && !u.p10) return;
      var frac = '\\frac{' + String(+fac.toPrecision(6)) + '\\u{' + siUnit + '}}{1\\u{' + f.prefix + f.sym + '}}';
      parts.push(SE.eq.html('\\left(' + frac + '\\right)' + (Math.abs(f.exp) !== 1 ? '^{' + Math.abs(f.exp) + '}' : '')).replace(/\\left|\\right/g, ''));
    });
    if (t.factor !== 1) parts.push(SE.eq.html('\\frac{1\\u{' + t.pretty + '}}{' + String(+t.factor.toPrecision(6)) + '\\u{' + (SE.units.dimsToSI(t.dims) || '1') + '}}'));
    return parts.join(' <span class="eq-op">×</span> ');
  }

  /* ---------------------------------------------------- dimension checker */
  function dimChecker(save, ctx) {
    var eqIn = el('input', { type: 'text', class: 'answer-input mono', value: (ctx && ctx.dimExpr) || 's = v*t + 1/2*a*t^2', spellcheck: 'false' });
    var varsIn = el('textarea', { class: 'answer-input mono', rows: 4, spellcheck: 'false' });
    varsIn.value = (ctx && ctx.dimVars) || 's: m\nv: m/s\nt: s\na: m/s^2';
    var out = el('div', { class: 'dim-out' });
    function go() {
      SE.ui.clear(out);
      var vars = {};
      varsIn.value.split('\n').forEach(function (line) {
        var m = /^\s*([^:=]+?)\s*[:=]\s*(.+)$/.exec(line);
        if (m) vars[m[1].trim()] = m[2].trim();
      });
      var r;
      try { r = SE.expr.analyze(eqIn.value, vars); } catch (e) { out.textContent = '⚠ ' + e.message; return; }
      var tbl = el('table', { class: 'ref-table' }, [el('thead', {}, [el('tr', {}, ['side', 'term', 'dimensions', 'SI units'].map(function (h) { return el('th', { text: h }); }))])]);
      var tb = el('tbody');
      r.terms.forEach(function (t) {
        tb.appendChild(el('tr', { class: t.ok ? 'ok' : 'bad' }, [
          el('td', { text: t.side }), el('td', { class: 'mono', text: (t.sign < 0 ? '−' : '') + t.text }),
          el('td', { text: t.dims ? SE.units.dimsToString(t.dims) : '?' }), el('td', { text: t.dims ? (SE.units.dimsToSI(t.dims) || '1') : '?' })
        ]));
      });
      tbl.appendChild(tb); out.appendChild(tbl);
      out.appendChild(el('div', { class: 'dim-verdict ' + (r.homogeneous ? 'ok' : 'bad'), text: r.homogeneous ? '✔ Dimensionally homogeneous: every term has the same dimensions.' : '✘ Not homogeneous. ' + r.problems.map(function (p) { return p.msg; }).join(' ') }));
      if (r.homogeneous) out.appendChild(el('p', { class: 'muted', text: 'Homogeneity is a necessary check, not proof: a wrong number like ½ vs 2 passes it.' }));
    }
    eqIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(go, 0);
    return el('div', {}, [
      el('label', { class: 'answer-field' }, [el('span', { class: 'answer-label', text: 'Equation or expression (use * between symbols)' }), eqIn]),
      el('label', { class: 'answer-field' }, [el('span', { class: 'answer-label', text: 'Units of each symbol (one per line, symbol: unit)' }), varsIn]),
      SE.ui.button('Check', go, 'primary'), out
    ]);
  }

  /* --------------------------------------------------------- sig-fig gauge */
  function sigGauge() {
    var input = el('input', { type: 'text', class: 'answer-input mono', placeholder: 'a number, e.g. 0.002 750 or 23 400', spellcheck: 'false' });
    var nIn = el('input', { type: 'number', class: 'answer-input mono small', value: 3, min: 1, max: 10 });
    var out = el('div', { class: 'sig-out' });
    function go() {
      SE.ui.clear(out);
      var s = input.value.replace(/[\s  ]/g, '');
      var num = SE.units.parseNumberPrefix(s);
      if (!num) { out.textContent = '⚠ Enter a number.'; return; }
      var c = SE.sigfig.countSigFigs(num.mantissa);
      var n = Math.max(1, Math.min(10, Number(nIn.value) || 3));
      var r = SE.sigfig.roundSig(num.value, n);
      out.appendChild(el('div', { html: inline('**Significant figures:** ' + (c.ambiguous ? c.min + ' to ' + c.max + ' (trailing zeros of a whole number are ambiguous)' : c.min)) }));
      out.appendChild(el('div', { html: inline('**Rounded to ' + n + ' s.f.:** `' + r.text + '`') }));
      out.appendChild(el('div', { html: inline('**Engineering notation:** `' + SE.sigfig.formatEng(num.value, n) + '`') }));
      out.appendChild(el('div', { class: 'muted', text: SE.checker.roundingHint(num.value, n) }));
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    return el('div', {}, [
      el('p', { class: 'muted', html: inline('Counts significant figures and applies the rounding rule: below 5 stays, above 5 goes up, an exact 5 goes to the even digit.') }),
      el('div', { class: 'row' }, [input, el('span', { text: ' to ' }), nIn, el('span', { text: ' s.f.' })]),
      SE.ui.button('Gauge it', go, 'primary'), out
    ]);
  }

  /* ------------------------------------------------------------- notebook */
  function notebook(save) {
    var ta = el('textarea', { class: 'notebook', rows: 14, spellcheck: 'true', placeholder: 'Your own notes. Tabulate data here, sketch a plan, record what surprised you.' });
    ta.value = save.notebook.join('\n');
    ta.addEventListener('input', function () { save.notebook = ta.value.split('\n'); SE.game.persist(); });
    return el('div', {}, [ta]);
  }

  SE.tools = { TOOLS: TOOLS, open: open, available: available, nameOf: nameOf, table: function (t) { el = SE.ui.el; inline = SE.ui.inline; return table(t); } };
})(globalThis.SE);
