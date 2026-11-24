/*
 * DOM helpers shared by every screen: element builder, the small markup
 * language used in level text, modals, toasts and the answer input with
 * live unit read-back.
 *
 * Level text markup:
 *   **bold**  *italic*  `code`  $equation$ (SE.eq syntax)  [[term]] glossary
 *   blank line = new paragraph, lines starting "- " = bullet list
 */
(function (SE) {
  'use strict';

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function inline(s) {
    var out = '';
    var parts = String(s).split(/(\$[^$]+\$)/g);
    parts.forEach(function (p) {
      if (p[0] === '$' && p[p.length - 1] === '$' && p.length > 2) { out += SE.eq.html(p.slice(1, -1)); return; }
      var t = SE.eq.esc(p);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[\[([^\]]+)\]\]/g, '<span class="term">$1</span>');
      out += t;
    });
    return out;
  }

  function md(text) {
    var blocks = String(text || '').trim().split(/\n\s*\n/);
    return blocks.map(function (b) {
      var lines = b.split('\n');
      if (lines.every(function (l) { return /^\s*- /.test(l); })) {
        return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*- /, '')) + '</li>'; }).join('') + '</ul>';
      }
      if (/^\$\$[\s\S]*\$\$$/.test(b.trim())) {
        var src = b.trim().slice(2, -2);
        var tag = null; var m = /\\tag\{([^}]+)\}/.exec(src);
        if (m) { tag = m[1]; src = src.replace(m[0], ''); }
        return '<div class="eq-block">' + SE.eq.html(src.trim(), tag) + '</div>';
      }
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }

  var toastHost = null;
  function toast(msg, kind, ms) {
    if (!toastHost) { toastHost = el('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
    var t = el('div', { class: 'toast ' + (kind || ''), html: inline(msg) });
    toastHost.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, ms || 3200);
  }

  var modalStack = [];
  function modal(opts) {
    var close = function () {
      back.classList.add('out');
      setTimeout(function () { back.remove(); }, 180);
      modalStack.splice(modalStack.indexOf(close), 1);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    };
    var onKey = function (e) { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close(); };
    var box = el('div', { class: 'modal ' + (opts.class || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { text: opts.title || '' }),
        el('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: close, text: '✕' })
      ]),
      opts.body
    ]);
    var back = el('div', { class: 'modal-back', onclick: function (e) { if (e.target === back) close(); } }, [box]);
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    modalStack.push(close);
    var f = box.querySelector('input, textarea, select, button:not(.icon-btn)');
    if (f) setTimeout(function () { f.focus(); }, 30);
    return { close: close, box: box };
  }

  /*
   * Answer field: a text input that echoes back how the game reads the
   * quantity ("read as 4.62 kN = 4620 N, force") while typing, so unit
   * mistakes are visible before submitting.
   */
  function answerField(opts) {
    var input = el('input', { type: 'text', class: 'answer-input', placeholder: opts.placeholder || 'e.g. 4.62 kN', autocomplete: 'off', spellcheck: 'false', 'aria-label': opts.label || 'Answer' });
    var echo = el('div', { class: 'answer-echo' });
    var wrap = el('label', { class: 'answer-field' }, [
      el('span', { class: 'answer-label', html: inline(opts.label || 'Answer') }),
      input, echo
    ]);
    function update() {
      var v = input.value.trim();
      if (!v) { echo.textContent = ''; echo.className = 'answer-echo'; return; }
      var q = SE.units.parseQuantity(v);
      if (!q.ok) { echo.textContent = '⚠ ' + q.error; echo.className = 'answer-echo warn'; return; }
      var name = SE.units.dimsName(q.dims);
      var siVal = SE.sigfig.roundSig(q.value, 6).text;
      var si = SE.units.dimsToSI(q.dims);
      var sf = SE.sigfig.countSigFigs(q.number.mantissa);
      var sfText = sf ? (sf.ambiguous ? sf.min + '–' + sf.max + ' s.f. (ambiguous)' : sf.min + ' s.f.') : '';
      echo.innerHTML = 'reads as <b>' + SE.eq.esc(q.number.mantissa + (q.number.hasExp ? '(10' + SE.sigfig.supNum(q.number.exp10) + ')' : '') + ' ' + SE.units.formatFactors(q.unit.factors)) + '</b>' +
        (si ? ' = ' + SE.eq.esc(siVal + ' ' + si) : '') + (name ? ' · ' + name : '') + (sfText ? ' · ' + sfText : '');
      echo.className = 'answer-echo ok';
    }
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && opts.onEnter) { e.preventDefault(); opts.onEnter(); }
    });
    return { el: wrap, input: input, value: function () { return input.value; }, set: function (v) { input.value = v; update(); }, focus: function () { input.focus(); } };
  }

  function button(label, onclick, cls, attrs) {
    return el('button', Object.assign({ class: 'btn ' + (cls || ''), onclick: function (e) { SE.audio && SE.audio.play('click'); onclick(e); }, html: inline(label) }, attrs || {}));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // Type text in progressively (skippable by click). Respects reduced motion.
  function typeIn(node, html, fast) {
    node.innerHTML = html;
    if (fast) return Promise.resolve();
    node.classList.add('typing');
    return new Promise(function (res) { setTimeout(function () { node.classList.remove('typing'); res(); }, 260); });
  }

  SE.ui = { el: el, md: md, inline: inline, toast: toast, modal: modal, answerField: answerField, button: button, clear: clear, typeIn: typeIn };
})(globalThis.SE);
