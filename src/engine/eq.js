/*
 * Tiny equation typesetter (no dependencies, works offline).
 *
 * Markup, a small TeX-like subset:
 *   \frac{a}{b}   stacked fraction       x^{2}, x^2   superscript
 *   x_{e}, x_e    subscript              \sqrt{x}     square root
 *   \u{kg·m/s^2}  upright unit text      \t{text}     upright plain text
 *   \cdot \times \approx \ne \le \ge \to \pm \Sigma \Delta \mu \rho \theta \pi \alpha \omega
 *   \hl{...}      highlighted part (used when a derivation step changes something)
 *   \strike{...}  cancelled unit (unit-cancellation chains)
 * Single letters are set in italics as variables; numbers and units upright.
 */
(function (SE) {
  'use strict';

  var SYMBOLS = {
    cdot: '·', times: '×', approx: '≈', ne: '≠', le: '≤', ge: '≥', to: '→', pm: '±',
    Sigma: 'Σ', Delta: 'Δ', mu: 'μ', rho: 'ρ', theta: 'θ', pi: 'π', alpha: 'α', omega: 'ω',
    infty: '∞', deg: '°', minus: '−', quad: ' ', implies: '⇒', propto: '∝', dot: '·',
    Rightarrow: '⇒', rightarrow: '→', leftarrow: '←', Leftrightarrow: '⇔', equiv: '≡', sim: '∼',
    ll: '≪', gg: '≫', lambda: 'λ', sigma: 'σ', tau: 'τ', phi: 'φ', epsilon: 'ε', beta: 'β',
    gamma: 'γ', Omega: 'Ω', circ: '°', prime: '′', qquad: '  '
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function readGroup(src, i) {
    // returns [content, nextIndex]; src[i] is '{' or a single char
    if (src[i] === '{') {
      var depth = 1, j = i + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      return [src.slice(i + 1, j - 1), j];
    }
    if (src[i] === '\\') {
      var m = /^\\[A-Za-z]+/.exec(src.slice(i));
      if (m) return [m[0], i + m[0].length];
    }
    // a run of digits counts as one group for ^/_ ("x^10")
    var dm = /^-?\d+/.exec(src.slice(i));
    if (dm) return [dm[0], i + dm[0].length];
    return [src[i] || '', i + 1];
  }

  function render(src) {
    var out = '', i = 0;
    src = String(src);
    while (i < src.length) {
      var c = src[i];
      if (c === '\\') {
        var m = /^\\([A-Za-z]+)/.exec(src.slice(i));
        if (!m) {
          var nx = src[i + 1] || '';
          out += nx === ',' ? '\u2009' : (nx === ';' || nx === ':') ? '\u2005' : nx === '!' ? '' : esc(nx);
          i += 2; continue;
        }
        var name = m[1];
        i += m[0].length;
        if (name === 'frac') {
          var a = readGroup(src, i); var b = readGroup(src, a[1]); i = b[1];
          out += '<span class="eq-frac"><span class="eq-num">' + render(a[0]) + '</span><span class="eq-den">' + render(b[0]) + '</span></span>';
        } else if (name === 'sqrt') {
          var g = readGroup(src, i); i = g[1];
          out += '<span class="eq-sqrt"><span class="eq-radic">√</span><span class="eq-rad">' + render(g[0]) + '</span></span>';
        } else if (name === 'u' || name === 't') {
          var g2 = readGroup(src, i); i = g2[1];
          out += '<span class="eq-' + (name === 'u' ? 'unit' : 'text') + '">' + renderUpright(g2[0]) + '</span>';
        } else if (name === 'bar') {
          var gb = readGroup(src, i); i = gb[1];
          out += '<span class="eq-bar">' + render(gb[0]) + '</span>';
        } else if (name === 'hl' || name === 'strike') {
          var g3 = readGroup(src, i); i = g3[1];
          out += '<span class="eq-' + name + '">' + render(g3[0]) + '</span>';
        } else if (name === 'left' || name === 'right') {
          // sizing hints only: the bracket that follows is rendered as is
        } else if (SYMBOLS[name]) {
          out += '<span class="eq-sym">' + SYMBOLS[name] + '</span>';
        } else {
          out += esc(name);
        }
      } else if (c === '^' || c === '_') {
        var gg = readGroup(src, i + 1); i = gg[1];
        out += '<' + (c === '^' ? 'sup' : 'sub') + '>' + render(gg[0]) + '</' + (c === '^' ? 'sup' : 'sub') + '>';
      } else if (/[A-Za-z]/.test(c)) {
        var wm = /^[A-Za-z]+/.exec(src.slice(i));
        var w = wm[0];
        i += w.length;
        out += w.length === 1 ? '<i>' + esc(w) + '</i>' : '<span class="eq-word">' + esc(w) + '</span>';
      } else if (c === '=') {
        out += '<span class="eq-op">=</span>'; i++;
      } else if (c === '+' || c === '-') {
        out += '<span class="eq-op">' + (c === '-' ? '−' : '+') + '</span>'; i++;
      } else if (c === '{' || c === '}') {
        i++;
      } else {
        out += esc(c); i++;
      }
    }
    return out;
  }

  // Units: upright, but still honour ^ and \strike etc.
  function renderUpright(src) {
    var out = '', i = 0;
    while (i < src.length) {
      var c = src[i];
      if (c === '^' || c === '_') {
        var g = readGroup(src, i + 1); i = g[1];
        out += '<' + (c === '^' ? 'sup' : 'sub') + '>' + esc(g[0]) + '</' + (c === '^' ? 'sup' : 'sub') + '>';
      } else if (c === '\\') {
        var m = /^\\([A-Za-z]+)/.exec(src.slice(i));
        i += m ? m[0].length : 1;
        if (m && (m[1] === 'strike' || m[1] === 'hl')) { var g2 = readGroup(src, i); i = g2[1]; out += '<span class="eq-' + m[1] + '">' + renderUpright(g2[0]) + '</span>'; }
        else if (m && SYMBOLS[m[1]]) out += SYMBOLS[m[1]];
      } else { out += esc(c); i++; }
    }
    return out;
  }

  function html(src, tag) {
    return '<span class="eq">' + render(src) + (tag ? '<span class="eq-tag">(' + esc(tag) + ')</span>' : '') + '</span>';
  }

  SE.eq = { render: render, html: html, esc: esc };
})(globalThis.SE);
