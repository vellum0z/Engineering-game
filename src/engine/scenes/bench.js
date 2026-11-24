/*
 * Bench scene: the measuring bench. Numbers, precision and rounding, where a
 * sloppy digit turns into a gap in the wall or a pin that will not go home.
 *
 * Three modes (params.mode):
 *
 *  'fence'   Rounding bias. N salvaged boards are measured to 4 significant
 *            figures and the cut list is rounded to 3. The boards go up end
 *            to end between posts that were set at the TRUE positions, so any
 *            bias in the rounding rule piles up at the end post:
 *                drift = sum(round(L_i)) - sum(L_i)
 *            'truncate' always loses the dropped digit (gap grows), 'up'
 *            gains on every exact 5 (overrun grows), 'book' (round half to
 *            even) sends half the exact 5s each way and stays near zero.
 *
 *  'chain'   Intermediate rounding. A crane boom calculation done twice:
 *            rounding every intermediate result to 3 s.f., and carrying full
 *            precision to the end. The bolt hole is drilled where the sheet
 *            says; the stay pin arrives at the true position.
 *
 *  'caliper' Measurement uncertainty. A vernier caliper with least count
 *            `res` reads two sides of a plate; the area's uncertainty comes
 *            from the propagation rules:
 *                sum / difference   u = sqrt(sum u_i^2)       (worst: sum u_i)
 *                product / quotient u/|q| = sqrt(sum (u_i/x_i)^2)
 *                                   (worst: sum |u_i/x_i|)
 *                power x^p          u/|q| = |p| u_x/|x|
 *            and the result is written to the figures that uncertainty
 *            justifies.
 *
 * Params (all modes): mode, label.
 *   fence:   boards (N), seed, fiveFrac (share of readings that land on an
 *            exact 5 at the dropped digit), rule, sf (cut-list figures, 3),
 *            gapLimit (m, zombie squeeze width), overrunLimit (m),
 *            showGhosts (draw the other two rules' drift too).
 *   chain:   h, r (m, boom tip rise and reach), bays, k (bolt at node k),
 *            sf, rule, keep ('round' | 'full'), clearance (m, hole minus pin
 *            diameter), pinDia (m), markRes (m, tape resolution for marking).
 *   caliper: a, b (mm, true sides), res (mm, least count), worst (bool,
 *            judge with worst-case instead of RSS), sf (player's claim).
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;
  SE.physics = SE.physics || {};

  var RULES = ['book', 'up', 'truncate'];
  var RULE_NAME = { book: 'book (5 → even)', up: 'always 5 up', truncate: 'truncate' };

  // ---------------------------------------------------------------- physics

  // Small deterministic generator (mulberry32) so a seed always rebuilds the
  // same pile of boards, in the browser and in tests alike.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /*
   * Board lengths (m) read to the millimetre, i.e. 4 s.f. for boards between
   * 1 m and 10 m. With a tape graduated every 0.5 cm, a lot of readings sit
   * right on a half-centimetre mark and so end in an exact 5 mm: that share
   * is fiveFrac. For those, the centimetre digit alternates even/odd, as it
   * does on average in real data, so the book rule has nothing to be biased
   * by. Other last digits are spread over 0-4 and 6-9.
   */
  function makeBoards(seed, n, fiveFrac, minMm, maxMm) {
    var r = rng(seed == null ? 1 : seed);
    fiveFrac = fiveFrac == null ? 0.6 : fiveFrac;
    minMm = minMm || 1800; maxMm = maxMm || 2600;
    var others = [0, 1, 2, 3, 4, 6, 7, 8, 9];
    var fives = 0, out = [];
    for (var i = 0; i < n; i++) {
      var tens = Math.floor(minMm / 10 + r() * (maxMm - minMm) / 10);   // length in cm
      var mm;
      if (r() < fiveFrac) {
        var wantOdd = fives % 2 === 1; fives++;
        if ((tens % 2 === 1) !== wantOdd) tens += 1;
        mm = tens * 10 + 5;
      } else {
        mm = tens * 10 + others[Math.floor(r() * others.length)];
      }
      out.push(mm / 1000);
    }
    return out;
  }

  // Sum in integer micrometres so float noise never shows up as "drift".
  function toMicro(x) { return Math.round(x * 1e6); }

  /*
   * Assemble boards cut to n s.f. under `rule`, against the true lengths.
   * Returns { total, trueTotal, drift, cuts, running } where running[i] is
   * the accumulated drift after board i (positive = wall overruns its post).
   */
  function fenceDrift(lengths, n, rule) {
    var t = 0, tt = 0, cuts = [], running = [];
    for (var i = 0; i < lengths.length; i++) {
      var cut = SE.sigfig.roundSig(lengths[i], n, rule).value;
      cuts.push(cut);
      t += toMicro(cut); tt += toMicro(lengths[i]);
      running.push((t - tt) / 1e6);
    }
    return { total: t / 1e6, trueTotal: tt / 1e6, drift: (t - tt) / 1e6, cuts: cuts, running: running };
  }

  var OPS = {
    add: function (a, b) { return a + b; },
    sub: function (a, b) { return a - b; },
    mul: function (a, b) { return a * b; },
    div: function (a, b) { return a / b; },
    pow: function (a, b) { return Math.pow(a, b); },
    sqrt: function (a) { return Math.sqrt(a); },
    sin: function (a) { return Math.sin(a); },
    cos: function (a) { return Math.cos(a); },
    tan: function (a) { return Math.tan(a); },
    atan2: function (a, b) { return Math.atan2(a, b); },
    neg: function (a) { return -a; }
  };

  /*
   * Evaluate a chain of steps two ways. Each step is either
   *   function (results, inputs) -> number
   * or { op, args, label } with op a key of OPS and each arg a number, an
   * input name, or '#k' for the result of step k.
   * The rounded path stores every step result rounded to n s.f. (so later
   * steps only ever see the rounded number); the exact path keeps doubles.
   */
  function chainError(steps, opts) {
    opts = opts || {};
    var n = opts.n || 3, rule = opts.rule || 'book', inputs = opts.inputs || {};
    function evaluate(round) {
      var res = [];
      steps.forEach(function (s) {
        var v;
        if (typeof s === 'function') v = s(res, inputs);
        else {
          var args = (s.args || []).map(function (a) {
            if (typeof a === 'number') return a;
            if (typeof a === 'string' && a[0] === '#') return res[Number(a.slice(1))];
            if (a in inputs) return inputs[a];
            throw new Error('chainError: unknown argument ' + a);
          });
          if (!OPS[s.op]) throw new Error('chainError: unknown op ' + s.op);
          v = OPS[s.op].apply(null, args);
        }
        res.push(round ? SE.sigfig.roundSig(v, n, rule).value : v);
      });
      return res;
    }
    var ex = evaluate(false), ro = evaluate(true);
    var exact = ex[ex.length - 1], rounded = ro[ro.length - 1];
    return {
      exact: exact, rounded: rounded, error: rounded - exact,
      rel: exact !== 0 ? (rounded - exact) / exact : 0,
      exactSteps: ex, roundedSteps: ro,
      labels: steps.map(function (s, i) { return (s && s.label) || ('step ' + (i + 1)); })
    };
  }

  /*
   * The crane sheet. The boom runs from its heel pin to a tip that is h up
   * and r out, so its length is L = sqrt(h^2 + r^2). The lattice has `bays`
   * equal bays and the stay bolts on at node k: s = k L / bays.
   */
  function craneSteps() {
    return [
      { op: 'pow', args: ['h', 2], label: 'h²' },
      { op: 'pow', args: ['r', 2], label: 'r²' },
      { op: 'add', args: ['#0', '#1'], label: 'L² = h² + r²' },
      { op: 'sqrt', args: ['#2'], label: 'L = √L²' },
      { op: 'div', args: ['#3', 'bays'], label: 'bay = L / n' },
      { op: 'mul', args: ['#4', 'k'], label: 'bolt s = k · bay' }
    ];
  }

  /*
   * Propagate independent uncertainties through one operation.
   *   op: 'sum' | 'difference' | 'product' | 'quotient' | 'power'
   *   sum/product take any number of values; difference/quotient use the
   *   first value minus/over the rest; power takes values [x, p] with p exact.
   * Returns { value, abs, rel, worstAbs, worstRel }: abs/rel are the
   * root-sum-square estimates, worst* the straight sums (all errors lining
   * up the same way).
   */
  function propagate(op, values, u) {
    u = u || [];
    var value, abs, rel, wAbs, wRel, i, s2 = 0, s1 = 0;
    if (op === 'sum' || op === 'difference') {
      value = values[0];
      for (i = 1; i < values.length; i++) value += op === 'sum' ? values[i] : -values[i];
      for (i = 0; i < values.length; i++) { var ui = Math.abs(u[i] || 0); s2 += ui * ui; s1 += ui; }
      abs = Math.sqrt(s2); wAbs = s1;
      rel = value !== 0 ? abs / Math.abs(value) : Infinity;
      wRel = value !== 0 ? wAbs / Math.abs(value) : Infinity;
    } else if (op === 'product' || op === 'quotient') {
      value = values[0];
      for (i = 1; i < values.length; i++) value = op === 'product' ? value * values[i] : value / values[i];
      for (i = 0; i < values.length; i++) { var ri = Math.abs((u[i] || 0) / values[i]); s2 += ri * ri; s1 += ri; }
      rel = Math.sqrt(s2); wRel = s1;
      abs = rel * Math.abs(value); wAbs = wRel * Math.abs(value);
    } else if (op === 'power') {
      var x = values[0], p = values[1];
      value = Math.pow(x, p);
      rel = Math.abs(p) * Math.abs((u[0] || 0) / x); wRel = rel;
      abs = rel * Math.abs(value); wAbs = abs;
    } else throw new Error('propagate: unknown op ' + op);
    return { value: value, abs: abs, rel: rel, worstAbs: wAbs, worstRel: wRel };
  }

  /*
   * How many significant figures a value can honestly carry: round the
   * uncertainty to one figure, and keep digits down to that decimal place.
   * 1022.33 ± 1.06 -> uncertainty 1 -> units place -> "1022" -> 4 s.f.
   */
  function sigFigsJustified(value, abs) {
    if (!(abs > 0) || !isFinite(abs)) return 15;
    if (value === 0) return 1;
    var ur = SE.sigfig.roundSig(abs, 1).value;
    var pu = Math.floor(Math.log10(ur) + 1e-12);
    var pv = Math.floor(Math.log10(Math.abs(value)) + 1e-12);
    return Math.max(1, pv - pu + 1);
  }

  /*
   * A vernier with Nv divisions spanning (Nv - 1) main-scale millimetres has
   * a least count of 1/Nv mm. The jaws close on the true size; the reading is
   * main-scale millimetres below the vernier zero plus k/Nv, where line k is
   * the vernier line that best lines up with a main-scale line.
   */
  function vernierRead(trueMm, res) {
    var nv = Math.max(2, Math.round(1 / res));
    var units = Math.round(trueMm * nv);
    var main = Math.floor(units / nv), k = units - main * nv;
    return { reading: units / nv, main: main, k: k, nv: nv, res: 1 / nv };
  }

  SE.physics.bench = {
    rng: rng, makeBoards: makeBoards, fenceDrift: fenceDrift, chainError: chainError, craneSteps: craneSteps,
    propagate: propagate, sigFigsJustified: sigFigsJustified, vernierRead: vernierRead, OPS: OPS, RULES: RULES
  };

  // ------------------------------------------------------------------ scene

  function Bench() {}

  var DEFAULTS = {
    mode: 'fence', label: '',
    // fence
    boards: 30, seed: 7, fiveFrac: 0.6, rule: 'book', sf: 3, gapLimit: 0.04, overrunLimit: 0.04, showGhosts: false,
    // chain
    h: 4.37, r: 6.85, bays: 7, k: 5, keep: 'round', clearance: 0.001, pinDia: 0.025, markRes: 0.001,
    // caliper
    a: 48.367, b: 21.142, res: 0.02, worst: false, claim: null
  };

  Bench.prototype.init = function (stage, p) {
    this.stage = stage;
    this.p = Object.assign({}, DEFAULTS, p);
    this.reset();
  };

  Bench.prototype.reset = function () {
    var p = this.p;
    this.state = 'idle';
    this.time = 0;
    this.events = [];
    this.result = null;
    if (p.mode === 'fence') {
      this.lengths = p.lengths ? p.lengths.slice() : makeBoards(p.seed, p.boards, p.fiveFrac);
      this.fence = fenceDrift(this.lengths, p.sf, p.rule);
      this.ghosts = {};
      var self = this;
      RULES.forEach(function (r) { self.ghosts[r] = fenceDrift(self.lengths, p.sf, r); });
      this.placed = 0; this.timer = 0; this.dropT = 1;
      this.breachX = 0; this.phase = 'build';
    } else if (p.mode === 'chain') {
      this.calc = chainError(craneSteps(), { n: p.sf, rule: p.rule, inputs: { h: p.h, r: p.r, bays: p.bays, k: p.k } });
      this.revealed = 0; this.timer = 0; this.pinT = 0; this.phase = 'sheet';
    } else {
      this.ra = vernierRead(p.a, p.res);
      this.rb = vernierRead(p.b, p.res);
      this.u = this.ra.res;     // one least count, the usual stated vernier uncertainty
      this.prop = propagate('product', [this.ra.reading, this.rb.reading], [this.u, this.u]);
      this.just = sigFigsJustified(this.prop.value, this.p.worst ? this.prop.worstAbs : this.prop.abs);
      this.jaw = p.a + 18; this.which = 0; this.phase = 'a'; this.hold = 0;
    }
  };

  Bench.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    var p = this.p;
    if (p.mode === 'fence') {
      var tt = this.fence ? this.fence.trueTotal : 60;
      this.cam = new SE.Camera({ scale: (w - 190) / tt, ox: 50, oy: h * 0.5 });
    } else if (p.mode === 'chain') {
      var scale = Math.min((w * 0.5) / (p.r + 2), (h - 110) / (p.h + 1.8));
      this.cam = new SE.Camera({ scale: scale, ox: w * 0.47 - scale * p.r * 0.35, oy: h - 46 });
    } else {
      // caliper world units are millimetres
      this.cam = new SE.Camera({ scale: Math.min(9, (w - 110) / (Math.max(p.a, p.b) + 95)), ox: 60, oy: 70 });
    }
  };

  Bench.prototype.finish = function (outcome, detail) {
    this.result = { outcome: outcome, detail: detail };
    if (this.resolve) { var r = this.resolve; this.resolve = null; setTimeout(function () { r({ outcome: outcome, detail: detail }); }, 700); }
  };

  /*
   * fence:   run({ rule })   -> 'sealed' | 'breached' (gap > gapLimit) | 'jammed' (overrun > overrunLimit)
   * chain:   run({ keep })   -> 'fits' | 'misfit'
   * caliper: run({ sf })     -> 'justified' | 'overclaimed' | 'underclaimed' ('measured' when no sf given)
   */
  Bench.prototype.run = function (opts) {
    opts = opts || {};
    var self = this, p = this.p;
    if (opts.rule) p.rule = opts.rule;
    if (opts.keep) p.keep = opts.keep;
    if (opts.sf != null) p.claim = opts.sf;
    this.reset();
    if (this.w) this.resize(this.w, this.h);
    this.state = 'running';
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  Bench.prototype.step = function (dt) {
    this.time += dt;
    if (this.state !== 'running') return;
    if (this.p.mode === 'fence') this.stepFence(dt);
    else if (this.p.mode === 'chain') this.stepChain(dt);
    else this.stepCaliper(dt);
  };

  Bench.prototype.stepFence = function (dt) {
    var p = this.p, f = this.fence, N = this.lengths.length;
    var interval = Math.max(0.08, Math.min(0.3, 7 / N));
    this.dropT = Math.min(1, this.dropT + dt / (interval * 0.8));
    if (this.phase === 'build') {
      this.timer += dt;
      if (this.timer >= interval && this.placed < N) {
        this.timer -= interval; this.placed++; this.dropT = 0;
        SE.audio && SE.audio.play(this.placed % 4 === 0 ? 'thud' : 'click');
      }
      if (this.placed >= N && this.timer > 0.6) {
        var d = f.drift;
        if (-d > p.gapLimit) { this.phase = 'breach'; this.timer = 0; this.events.push('gap'); SE.audio && SE.audio.play('groan'); }
        else if (d > p.overrunLimit) {
          this.phase = 'done'; this.state = 'jammed'; this.events.push('jam');
          this.stage.shake(10);
          if (this.cam) this.stage.burst(this.cam.x(f.trueTotal), this.cam.y(0.9), { n: 26, color: C.wood, kind: 'debris', speed: 220 });
          SE.audio && SE.audio.play('creak');
          this.finish('jammed', this.fenceDetail());
        } else {
          this.phase = 'done'; this.state = 'sealed';
          SE.audio && SE.audio.play('success');
          this.finish('sealed', this.fenceDetail());
        }
      }
    } else if (this.phase === 'breach') {
      this.timer += dt;
      this.breachX = Math.min(1, this.timer / 2.4);
      if (this.timer >= 2.6) {
        this.phase = 'done'; this.state = 'breached';
        this.stage.shake(8); this.stage.flash('rgba(160,30,20,ALPHA)', 0.3, 0.3);
        SE.audio && SE.audio.play('fail');
        this.finish('breached', this.fenceDetail());
      }
    }
  };

  Bench.prototype.fenceDetail = function () {
    var f = this.fence;
    return { rule: this.p.rule, drift: f.drift, total: f.total, trueTotal: f.trueTotal, gap: Math.max(0, -f.drift), overrun: Math.max(0, f.drift), boards: this.lengths.length };
  };

  // What the fabricator drills: the sheet value marked off to the tape's resolution.
  Bench.prototype.chainMark = function () {
    var p = this.p, v = p.keep === 'full' ? this.calc.exact : this.calc.rounded;
    return Math.round(v / p.markRes) * p.markRes;
  };

  Bench.prototype.stepChain = function (dt) {
    var p = this.p, n = this.calc.labels.length;
    this.timer += dt;
    if (this.phase === 'sheet') {
      if (this.timer >= 0.45) { this.timer = 0; this.revealed++; SE.audio && SE.audio.play('click'); }
      if (this.revealed >= n) { this.phase = 'pin'; this.timer = 0; SE.audio && SE.audio.play('ratchet'); }
    } else if (this.phase === 'pin') {
      this.pinT = Math.min(1, this.timer / 1.3);
      if (this.pinT >= 1) {
        var err = this.chainMark() - this.calc.exact;
        var fits = Math.abs(err) <= p.clearance / 2;
        this.phase = 'done'; this.state = fits ? 'fits' : 'misfit';
        var detail = { keep: p.keep, exact: this.calc.exact, rounded: this.calc.rounded, mark: this.chainMark(), error: err, clearance: p.clearance };
        if (fits) { SE.audio && SE.audio.play('clang'); SE.audio && SE.audio.play('success'); }
        else {
          SE.audio && SE.audio.play('clang'); SE.audio && SE.audio.play('fail');
          this.stage.shake(6);
          if (this.cam) { var pt = this.boomPoint(this.calc.exact); this.stage.burst(this.cam.x(pt.x), this.cam.y(pt.y), { n: 22, color: '#ffd27a', speed: 240 }); }
        }
        this.finish(fits ? 'fits' : 'misfit', detail);
      }
    }
  };

  Bench.prototype.stepCaliper = function (dt) {
    var p = this.p;
    var target = this.phase === 'a' ? p.a : p.b;
    if (this.phase === 'a' || this.phase === 'b') {
      if (this.jaw > target) {
        this.jaw = Math.max(target, this.jaw - dt * 30);
        if (this.jaw === target) { SE.audio && SE.audio.play('click'); this.hold = 0; }
      } else {
        this.hold += dt;
        if (this.hold > 0.9) {
          if (this.phase === 'a') { this.phase = 'b'; this.jaw = p.b + 18; SE.audio && SE.audio.play('whoosh'); }
          else { this.phase = 'calc'; this.hold = 0; SE.audio && SE.audio.play('stamp'); }
        }
      }
    } else if (this.phase === 'calc') {
      this.hold += dt;
      if (this.hold > 0.8) {
        this.phase = 'done';
        var claim = p.claim, outcome = 'measured';
        if (claim != null) outcome = claim === this.just ? 'justified' : (claim > this.just ? 'overclaimed' : 'underclaimed');
        this.state = outcome;
        if (outcome === 'justified') SE.audio && SE.audio.play('success');
        else if (outcome !== 'measured') SE.audio && SE.audio.play('fail');
        this.finish(outcome, this.caliperDetail());
      }
    }
  };

  Bench.prototype.caliperDetail = function () {
    var pr = this.prop;
    return { a: this.ra.reading, b: this.rb.reading, u: this.u, area: pr.value, abs: pr.abs, rel: pr.rel, worstAbs: pr.worstAbs, worstRel: pr.worstRel, sf: this.just, claim: this.p.claim };
  };

  // ----------------------------------------------------------------- drawing

  var MONO = '600 12px "IBM Plex Mono", monospace';
  function sig(x, n) { return SE.sigfig.roundSig(x, n).text; }
  function cm(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + ' cm'; }
  function mmS(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 1000).toFixed(1) + ' mm'; }

  function panel(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(12,24,40,0.9)';
    D.roundRect(ctx, x, y, w, h, 8); ctx.fill();
    ctx.beginPath(); D.roundRect(ctx, x, y, w, h, 8); ctx.clip();
    ctx.translate(x, y); D.blueprintGrid(ctx, w, h, 16);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.lineWidth = 1.2; D.roundRect(ctx, x, y, w, h, 8); ctx.stroke(); ctx.restore();
  }

  // Circular magnifier: draws frame, clips, calls fn(cx, cy, r), labels it.
  function magnifier(ctx, cx, cy, r, label, fn) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,24,40,0.95)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.translate(cx - r, cy - r); D.blueprintGrid(ctx, 2 * r, 2 * r, 12); ctx.translate(-(cx - r), -(cy - r));
    fn(cx, cy, r);
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = C.iron; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.hazard; ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.stroke();
    if (label) { ctx.font = '600 11px "IBM Plex Mono", monospace'; D.labelBox(ctx, label, cx, cy + r + 12, C.hazard); }
    ctx.restore();
  }

  Bench.prototype.draw = function (ctx, w, h, t) {
    if (!this.cam || this.w !== w || this.h !== h) this.resize(w, h);
    if (this.p.mode === 'fence') this.drawFence(ctx, w, h, t);
    else if (this.p.mode === 'chain') this.drawChain(ctx, w, h, t);
    else this.drawCaliper(ctx, w, h, t);
  };

  Bench.prototype.drawFence = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, f = this.fence, N = this.lengths.length;
    var gy = cam.y(0);
    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, gy, h - gy);
    var placed = this.state === 'idle' ? 0 : this.placed;

    // posts at the true joints (set from the true lengths)
    var acc = 0;
    ctx.save();
    for (var i = 0; i <= N; i++) {
      var x = cam.x(acc), end = i === N, start = i === 0;
      ctx.fillStyle = end || start ? D.rustPattern(ctx, C.rust, 5) : C.woodDark;
      var pw = end || start ? 9 : 4, ph = end || start ? 74 : 56;
      ctx.fillRect(x - pw / 2, gy - ph, pw, ph);
      if (end) D.hazardStripes(ctx, x - pw / 2, gy - ph, pw, 10);
      if (i < N) acc += this.lengths[i];
    }
    ctx.restore();

    // boards placed end to end from the start post, using the cut lengths
    var cursor = 0;
    for (var j = 0; j < placed; j++) {
      var Lc = f.cuts[j];
      var x0 = cam.x(cursor), x1 = cam.x(cursor + Lc);
      var drop = j === placed - 1 && this.phase === 'build' ? (1 - this.dropT) * 40 : 0;
      var r = D.rng(j * 31 + 5);
      ctx.fillStyle = r() < 0.5 ? C.wood : '#7a4f2d';
      ctx.fillRect(x0 + 0.5, gy - 46 - drop, x1 - x0 - 1, 14);
      ctx.fillRect(x0 + 0.5, gy - 24 - drop, x1 - x0 - 1, 14);
      ctx.strokeStyle = C.woodDark; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, gy - 46 - drop, x1 - x0 - 1, 14);
      ctx.strokeRect(x0 + 0.5, gy - 24 - drop, x1 - x0 - 1, 14);
      ctx.fillStyle = '#c9c2b2';
      ctx.fillRect(x0 + 2, gy - 40 - drop, 2, 2); ctx.fillRect(x0 + 2, gy - 18 - drop, 2, 2);
      // palisade stakes behind the rails
      ctx.fillStyle = 'rgba(94,58,30,0.85)';
      for (var s = x0 + 3; s < x1 - 2; s += 7) { ctx.beginPath(); ctx.moveTo(s, gy); ctx.lineTo(s, gy - 58 - drop); ctx.lineTo(s + 2.5, gy - 64 - drop); ctx.lineTo(s + 5, gy - 58 - drop); ctx.lineTo(s + 5, gy); ctx.fill(); }
      cursor += Lc;
    }

    // the carpenter works at the current end of the wall
    if (this.state !== 'idle' && this.phase === 'build') D.survivor(ctx, cam.x(cursor) + 12, gy, 46, t);

    // zombies waiting outside the end post
    var xEnd = cam.x(f.trueTotal);
    for (var z = 0; z < 3; z++) {
      var zx = xEnd + 30 + z * 26 + Math.sin(t * 0.7 + z) * 4;
      if (z === 0 && this.phase !== 'build' && this.breachX > 0) zx = xEnd + 30 - this.breachX * 60;
      D.zombie(ctx, zx, gy, 52, t, z + 4);
    }

    // magnified end post
    var drift = placed === N ? f.drift : (placed ? f.running[placed - 1] : 0);
    var lim = Math.max(p.gapLimit, p.overrunLimit);
    var span = Math.max(Math.abs(drift), lim) * 1.6;
    var mcx = w - 96, mcy = 92, mr = 64;
    ctx.save(); ctx.strokeStyle = 'rgba(230,180,34,0.55)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xEnd, gy - 76); ctx.lineTo(mcx - mr * 0.5, mcy + mr * 0.85); ctx.stroke(); ctx.restore();
    var pxPerM = mr * 0.8 / span;
    magnifier(ctx, mcx, mcy, mr, 'end post ×' + Math.round(pxPerM / cam.scale), function (cx, cy, rr) {
      var postX = cx + 6;
      ctx.fillStyle = D.rustPattern(ctx, C.rust, 5); ctx.fillRect(postX, cy - rr, 22, 2 * rr);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(postX, cy - rr, 3, 2 * rr);
      if (placed) {
        var ex = postX + drift * pxPerM;
        ctx.fillStyle = C.wood; ctx.fillRect(cx - rr, cy - 18, ex - (cx - rr), 14); ctx.fillRect(cx - rr, cy + 6, ex - (cx - rr), 14);
        ctx.strokeStyle = C.woodDark; ctx.strokeRect(cx - rr, cy - 18, ex - (cx - rr), 14); ctx.strokeRect(cx - rr, cy + 6, ex - (cx - rr), 14);
        if (drift < 0) {
          ctx.fillStyle = Math.abs(drift) > p.gapLimit ? 'rgba(226,85,63,0.45)' : 'rgba(143,207,106,0.3)';
          ctx.fillRect(ex, cy - rr, postX - ex, 2 * rr);
        } else if (drift > 0) {
          ctx.fillStyle = drift > p.overrunLimit ? 'rgba(226,85,63,0.55)' : 'rgba(230,180,34,0.4)';
          ctx.fillRect(postX, cy - 18, ex - postX, 38);
        }
        // squeeze width a zombie needs
        ctx.strokeStyle = 'rgba(226,85,63,0.8)'; ctx.setLineDash([3, 3]);
        var gx = postX - p.gapLimit * pxPerM;
        ctx.beginPath(); ctx.moveTo(gx, cy - rr); ctx.lineTo(gx, cy + rr); ctx.stroke(); ctx.setLineDash([]);
        D.text(ctx, Math.abs(drift) < 0.0005 ? 'flush' : (drift < 0 ? 'gap ' : 'over ') + Math.abs(drift * 100).toFixed(1) + ' cm', cx - 8, cy + rr * 0.6, { align: 'center', font: '600 11px "IBM Plex Mono", monospace', color: Math.abs(drift) > lim ? C.bad : C.paper });
      }
      if (this.breachX > 0) D.zombie(ctx, postX + 30 - this.breachX * 50, cy + rr * 0.9, rr * 1.4, t, 4);
    }.bind(this));

    // drift chart
    var px = 12, py = gy + 18, pw2 = w - 24, ph2 = h - py - 12;
    if (ph2 > 60) {
      panel(ctx, px, py, pw2, ph2);
      var all = [lim, Math.abs(f.drift)];
      if (p.showGhosts) RULES.forEach(function (r) { all.push(Math.abs(this.ghosts[r].drift)); }, this);
      var ymax = Math.max.apply(null, all) * 1.25;
      var x0c = px + 54, x1c = px + pw2 - 16, yc = py + ph2 / 2, yscale = (ph2 / 2 - 16) / ymax;
      ctx.save();
      ctx.fillStyle = 'rgba(226,85,63,0.12)';
      ctx.fillRect(x0c, py + 6, x1c - x0c, yc - p.overrunLimit * yscale - py - 6);
      ctx.fillRect(x0c, yc + p.gapLimit * yscale, x1c - x0c, py + ph2 - 6 - yc - p.gapLimit * yscale);
      ctx.strokeStyle = 'rgba(143,184,232,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0c, yc); ctx.lineTo(x1c, yc); ctx.stroke();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(226,85,63,0.7)';
      [yc - p.overrunLimit * yscale, yc + p.gapLimit * yscale].forEach(function (yy) { ctx.beginPath(); ctx.moveTo(x0c, yy); ctx.lineTo(x1c, yy); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.blueInk; ctx.textAlign = 'right';
      ctx.fillText('+' + (p.overrunLimit * 100).toFixed(0) + ' cm', x0c - 4, yc - p.overrunLimit * yscale + 3);
      ctx.fillText('0', x0c - 4, yc + 3);
      ctx.fillText('−' + (p.gapLimit * 100).toFixed(0) + ' cm', x0c - 4, yc + p.gapLimit * yscale + 3);
      ctx.textAlign = 'left';
      ctx.fillText('overrun', x0c + 4, py + 16); ctx.fillText('gap (zombies)', x0c + 4, py + ph2 - 8);
      ctx.textAlign = 'right'; ctx.fillText('board ' + N, x1c, py + ph2 - 8);
      var xs = function (i) { return x0c + (x1c - x0c) * i / N; };
      var plot = function (run, count, color, width) {
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(xs(0), yc);
        for (var q = 0; q < count; q++) ctx.lineTo(xs(q + 1), yc - run[q] * yscale);
        ctx.stroke();
      };
      if (p.showGhosts) {
        var gc = { book: C.good, up: C.force, truncate: C.bad };
        RULES.forEach(function (r) {
          if (r === p.rule) return;
          ctx.globalAlpha = 0.35; plot(this.ghosts[r].running, N, gc[r], 1.5); ctx.globalAlpha = 1;
          ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.fillStyle = gc[r]; ctx.textAlign = 'left';
          ctx.fillText(r, x1c + 2 - 40, yc - this.ghosts[r].drift * yscale - 4);
        }, this);
      }
      plot(f.running, placed, C.hazard, 2.5);
      if (placed) { ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(xs(placed), yc - f.running[placed - 1] * yscale, 3.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    var lines = [
      'rule   ' + RULE_NAME[p.rule],
      'boards ' + placed + ' / ' + N + '   cut to ' + p.sf + ' s.f.'
    ];
    if (placed) {
      var k = placed - 1;
      lines.push('last   ' + this.lengths[k].toFixed(3) + ' m → ' + sig(f.cuts[k], p.sf) + ' m');
      lines.push('drift  ' + cm(f.running[k]));
    }
    if (placed === N) lines.push('Σcut ' + f.total.toFixed(3) + ' m  Σtrue ' + f.trueTotal.toFixed(3) + ' m');
    SE.sceneUtil.readout(ctx, 12, 12, lines);
  };

  // Point s metres along the boom from the heel pin.
  Bench.prototype.boomPoint = function (s) {
    var p = this.p, L = Math.sqrt(p.h * p.h + p.r * p.r);
    return { x: p.r * s / L, y: p.h * s / L };
  };

  Bench.prototype.drawChain = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, calc = this.calc;
    var gy = cam.y(0);
    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, gy, h - gy);
    D.fence(ctx, 0, gy, w * 0.18, 30);
    D.zombie(ctx, 30 + Math.sin(t * 0.5) * 6, gy, 46, t, 9);

    var L = Math.sqrt(p.h * p.h + p.r * p.r), ang = Math.atan2(p.h, p.r);
    var ux = p.r / L, uy = p.h / L, nx = -uy, ny = ux;
    var depth = 0.32;
    // heel block
    ctx.fillStyle = D.rustPattern(ctx, C.steel, 2);
    ctx.fillRect(cam.x(-0.5), gy - cam.len(0.5), cam.len(1.0), cam.len(0.5));
    // boom lattice: two chords and diagonal lacing
    ctx.save();
    ctx.strokeStyle = C.rust; ctx.lineWidth = Math.max(3, cam.len(0.07));
    var P = function (s, o) { return [cam.x(ux * s + nx * o), cam.y(uy * s + ny * o)]; };
    var a0 = P(0, 0), a1 = P(L, 0), b0 = P(0, depth), b1 = P(L, depth);
    D.sketchLine(ctx, a0[0], a0[1], a1[0], a1[1], { passes: 1, wobble: 0.5 });
    D.sketchLine(ctx, b0[0], b0[1], b1[0], b1[1], { passes: 1, wobble: 0.5 });
    ctx.lineWidth = 1.6; ctx.strokeStyle = C.rustHi;
    for (var i = 0; i < p.bays; i++) {
      var s0 = L * i / p.bays, s1 = L * (i + 1) / p.bays, sm = (s0 + s1) / 2;
      var q0 = P(s0, 0), q1 = P(sm, depth), q2 = P(s1, 0);
      D.sketchLine(ctx, q0[0], q0[1], q1[0], q1[1], { passes: 1, wobble: 0.4 });
      D.sketchLine(ctx, q1[0], q1[1], q2[0], q2[1], { passes: 1, wobble: 0.4 });
      var nd = P(s1, 0), nu = P(s1, depth);
      ctx.beginPath(); ctx.moveTo(nd[0], nd[1]); ctx.lineTo(nu[0], nu[1]); ctx.stroke();
    }
    ctx.restore();
    // hook line at the tip
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a1[0], gy - cam.len(1.6)); ctx.stroke();
    D.crate(ctx, a1[0] - cam.len(0.5), gy - cam.len(0.6), cam.len(1), cam.len(1), { label: p.label });
    // heel pin
    ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(a0[0], a0[1], 5, 0, Math.PI * 2); ctx.fill();

    // stay from an A-frame behind the heel to the bolt node
    var mastX = -1.6, mastY = p.h * 0.75;
    ctx.fillStyle = D.rustPattern(ctx, C.rustDark, 4);
    ctx.fillRect(cam.x(mastX) - 4, cam.y(mastY), 8, gy - cam.y(mastY));
    var bp = this.boomPoint(calc.exact);
    var pin = this.pinT;
    var sx = cam.x(mastX), sy = cam.y(mastY), ex = cam.x(bp.x), ey = cam.y(bp.y);
    var tipX = sx + (ex - sx) * (0.55 + 0.45 * pin), tipY = sy + (ey - sy) * (0.55 + 0.45 * pin);
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(tipX, tipY, 4, 0, Math.PI * 2); ctx.fill();
    // bolt plate at the drilled position
    var hole = this.boomPoint(this.chainMark());
    ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(cam.x(hole.x), cam.y(hole.y), 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.night; ctx.beginPath(); ctx.arc(cam.x(hole.x), cam.y(hole.y), 3, 0, Math.PI * 2); ctx.fill();
    D.dimLine(ctx, P(0, -0.35)[0], P(0, -0.35)[1], P(calc.exact, -0.35)[0], P(calc.exact, -0.35)[1], 's');

    // calc sheet
    var shown = this.state === 'idle' ? calc.labels.length : this.revealed;
    var sw = Math.min(330, w * 0.46), rows = calc.labels.length;
    var sh = 44 + rows * 18 + 22;
    panel(ctx, 12, 12, sw, sh);
    ctx.save();
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = C.paper; ctx.fillText('BOOM SHEET  h=' + p.h + ' m  r=' + p.r + ' m', 22, 30);
    var colF = 22 + sw * 0.46, colR = 22 + sw * 0.74;
    ctx.fillStyle = p.keep === 'full' ? C.hazard : C.blueInk; ctx.fillText('full', colF, 48);
    ctx.fillStyle = p.keep === 'round' ? C.hazard : C.blueInk; ctx.fillText('each→' + p.sf + ' s.f.', colR, 48);
    for (var j = 0; j < rows; j++) {
      var yy = 66 + j * 18;
      ctx.fillStyle = j < shown ? C.paper : 'rgba(236,226,198,0.25)';
      ctx.fillText(calc.labels[j], 22, yy);
      if (j < shown) {
        ctx.fillStyle = C.paperDim; ctx.fillText(sig(calc.exactSteps[j], 7), colF, yy);
        ctx.fillStyle = C.paperDim; ctx.fillText(SE.sigfig.roundSig(calc.roundedSteps[j], p.sf, p.rule).text, colR, yy);
      }
    }
    if (shown >= rows) {
      ctx.fillStyle = C.hazard;
      ctx.fillText('drill at ' + (this.chainMark() * 1000).toFixed(0) + ' mm   (' + mmS(this.chainMark() - calc.exact) + ')', 22, 66 + rows * 18 + 4);
    }
    ctx.restore();

    // magnified hole vs pin; along-boom axis drawn horizontal
    var err = this.chainMark() - calc.exact;
    var holeR = (p.pinDia + p.clearance) / 2, pinR = p.pinDia / 2;
    var mr = Math.min(78, h * 0.18), mcx = w - mr - 20, mcy = mr + 24;
    var pxPerM = mr * 0.85 / (holeR + Math.abs(err) + pinR * 0.3);
    var fits = Math.abs(err) <= p.clearance / 2;
    ctx.save(); ctx.strokeStyle = 'rgba(230,180,34,0.55)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cam.x(hole.x), cam.y(hole.y)); ctx.lineTo(mcx - mr * 0.7, mcy + mr * 0.7); ctx.stroke(); ctx.restore();
    magnifier(ctx, mcx, mcy, mr, 'bolt hole ×' + Math.round(pxPerM / cam.scale), function (cx, cy, rr) {
      ctx.fillStyle = D.rustPattern(ctx, C.steel, 8); ctx.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
      var hx = cx - err * pxPerM / 2, pxx = cx + err * pxPerM / 2;
      ctx.fillStyle = C.night; ctx.beginPath(); ctx.arc(hx, cy, holeR * pxPerM, 0, Math.PI * 2); ctx.fill();
      var k = 0.25 + 0.75 * pin;
      ctx.globalAlpha = k;
      ctx.fillStyle = this.state === 'misfit' ? C.bad : (this.state === 'fits' ? C.good : C.steelHi);
      ctx.beginPath(); ctx.arc(pxx, cy, pinR * pxPerM, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.hazard; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pxx, cy - rr); ctx.lineTo(pxx, cy + rr); ctx.stroke(); ctx.setLineDash([]);
      D.text(ctx, 'pin off ' + mmS(-err), cx, cy + rr * 0.62, { align: 'center', font: '600 11px "IBM Plex Mono", monospace', color: fits ? C.good : C.bad });
    }.bind(this));

    var lines = [
      'L      ' + sig(Math.sqrt(p.h * p.h + p.r * p.r), 6) + ' m',
      'bolt   node ' + p.k + ' of ' + p.bays,
      'exact  ' + (calc.exact * 1000).toFixed(2) + ' mm',
      'chain  ' + (calc.rounded * 1000).toFixed(2) + ' mm',
      'slack  ±' + (p.clearance * 500).toFixed(2) + ' mm'
    ];
    SE.sceneUtil.readout(ctx, 12, sh + 22, lines);
    if (this.state === 'fits' || this.state === 'misfit') {
      D.text(ctx, this.state === 'fits' ? 'PIN HOME' : 'PIN WILL NOT GO', w / 2, h - 16, { align: 'center', font: '700 16px "IBM Plex Mono", monospace', color: this.state === 'fits' ? C.good : C.bad });
    }
  };

  Bench.prototype.drawCaliper = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam;
    ctx.fillStyle = C.soot; ctx.fillRect(0, 0, w, h);
    D.blueprintGrid(ctx, w, h, 24);
    // bench top
    ctx.fillStyle = D.rustPattern(ctx, '#3a2f27', 11);
    ctx.fillRect(0, h * 0.58, w, h * 0.42);

    var dim = this.phase === 'b' || this.phase === 'calc' || this.phase === 'done' ? p.b : p.a;
    var jaw = this.state === 'idle' ? p.a : Math.max(dim, this.jaw);
    var reading = vernierRead(jaw, p.res);
    var by = cam.y(0), bh = 26;
    var x0 = cam.x(0);
    // beam with main scale (mm)
    var beamEnd = cam.wx(w + 20);
    ctx.save();
    ctx.fillStyle = '#c9c6bd'; ctx.fillRect(cam.x(-12), by - bh, cam.len(beamEnd + 12), bh);
    ctx.strokeStyle = C.steel; ctx.strokeRect(cam.x(-12), by - bh, cam.len(beamEnd + 12), bh);
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 1;
    ctx.font = '600 9px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    for (var m = 0; m <= beamEnd; m++) {
      var mx = cam.x(m), len = m % 10 === 0 ? 11 : (m % 5 === 0 ? 8 : 5);
      ctx.beginPath(); ctx.moveTo(mx, by - bh); ctx.lineTo(mx, by - bh + len); ctx.stroke();
      if (m % 10 === 0) ctx.fillText(String(m / 10), mx, by - 4);
    }
    ctx.restore();
    // fixed jaw
    ctx.fillStyle = '#b9b5ab';
    ctx.beginPath(); ctx.moveTo(cam.x(-12), by - bh); ctx.lineTo(x0, by - bh); ctx.lineTo(x0, by + 70); ctx.lineTo(x0 - 10, by + 80); ctx.lineTo(cam.x(-12), by + 30); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.steel; ctx.stroke();
    // the part: a salvaged steel plate between the jaws
    ctx.fillStyle = D.rustPattern(ctx, C.steel, 6);
    var partH = Math.min(60, cam.len((this.phase === 'a' || this.state === 'idle' ? p.b : p.a)));
    ctx.fillRect(x0, by + 12, cam.len(dim), partH);
    ctx.strokeStyle = C.iron; ctx.strokeRect(x0, by + 12, cam.len(dim), partH);
    D.text(ctx, this.phase === 'a' || this.state === 'idle' ? 'side a' : 'side b', x0 + cam.len(dim) / 2, by + 12 + partH / 2 + 4, { align: 'center', font: '600 11px "IBM Plex Mono", monospace' });
    // sliding jaw with vernier plate
    var jx = cam.x(jaw);
    ctx.fillStyle = '#d6d2c8';
    ctx.beginPath(); ctx.moveTo(jx, by - bh - 8); ctx.lineTo(jx + cam.len(56), by - bh - 8); ctx.lineTo(jx + cam.len(56), by + 6); ctx.lineTo(jx, by + 6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(jx, by); ctx.lineTo(jx, by + 70); ctx.lineTo(jx + 10, by + 80); ctx.lineTo(jx + 22, by + 20); ctx.lineTo(jx + 22, by); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.steel; ctx.stroke();
    ctx.strokeStyle = C.ink;
    var nv = reading.nv, span = (nv - 1) / nv;
    var stepV = Math.max(1, Math.ceil(nv / 25));
    for (var v = 0; v <= nv; v += stepV) {
      var vx = cam.x(jaw + v * span);
      ctx.beginPath(); ctx.moveTo(vx, by + 4); ctx.lineTo(vx, by - 4 - (v % (5 * stepV) === 0 ? 4 : 0)); ctx.stroke();
    }

    // magnified scale strip: main scale above, vernier below, aligned line lit
    var sy = by + 120, sh = 64, sx0 = 40, sx1 = w - 40;
    if (h - sy > sh + 40) {
      panel(ctx, sx0 - 10, sy - 10, sx1 - sx0 + 20, sh + 20);
      var pm = (sx1 - sx0) / (nv * span + 4);
      var left = reading.reading - 2;
      var X = function (mm) { return sx0 + (mm - left) * pm; };
      ctx.save();
      ctx.beginPath(); ctx.rect(sx0, sy - 6, sx1 - sx0, sh + 12); ctx.clip();
      ctx.strokeStyle = C.paper; ctx.fillStyle = C.paper; ctx.lineWidth = 1.2; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      for (var mm2 = Math.floor(left); mm2 <= left + (sx1 - sx0) / pm + 1; mm2++) {
        var tx = X(mm2), L2 = mm2 % 10 === 0 ? 22 : (mm2 % 5 === 0 ? 16 : 11);
        var lit = mm2 === reading.main + reading.k;
        ctx.strokeStyle = lit ? C.hazard : C.paper; ctx.lineWidth = lit ? 2.2 : 1.2;
        ctx.beginPath(); ctx.moveTo(tx, sy); ctx.lineTo(tx, sy + L2); ctx.stroke();
        if (mm2 % 10 === 0) ctx.fillText(String(mm2), tx, sy + 32);
      }
      for (var v2 = 0; v2 <= nv; v2++) {
        var tx2 = X(reading.reading + v2 * span), L3 = v2 % 5 === 0 ? 16 : 10;
        var lit2 = v2 === reading.k;
        ctx.strokeStyle = lit2 ? C.hazard : C.blueInk; ctx.lineWidth = lit2 ? 2.2 : 1.1;
        ctx.beginPath(); ctx.moveTo(tx2, sy + sh); ctx.lineTo(tx2, sy + sh - L3); ctx.stroke();
      }
      ctx.restore();
      D.text(ctx, 'main ' + reading.main + ' mm  +  line ' + reading.k + ' × ' + sig(reading.res, 2) + ' mm  =  ' + reading.reading.toFixed(Math.max(0, -Math.floor(Math.log10(reading.res) + 1e-9))) + ' mm', w / 2, sy + sh + 26, { align: 'center', font: '600 12px "IBM Plex Mono", monospace', color: C.hazard });
    }

    // results card
    var dec = Math.max(0, -Math.floor(Math.log10(this.u) + 1e-9));
    var pr = this.prop, showCalc = this.phase === 'calc' || this.phase === 'done' || this.state === 'idle';
    var lines = [
      'least count ' + sig(this.u, 2) + ' mm',
      'a = ' + (this.phase === 'a' && this.state !== 'idle' ? '…' : this.ra.reading.toFixed(dec) + ' ± ' + this.u.toFixed(dec) + ' mm'),
      'b = ' + (showCalc ? this.rb.reading.toFixed(dec) + ' ± ' + this.u.toFixed(dec) + ' mm' : '…')
    ];
    if (showCalc) {
      lines.push('A = a·b = ' + sig(pr.value, 7) + ' mm²');
      lines.push('rel RSS  √((ua/a)²+(ub/b)²) = ' + (pr.rel * 100).toFixed(3) + ' %');
      lines.push('rel worst  ua/a + ub/b     = ' + (pr.worstRel * 100).toFixed(3) + ' %');
      lines.push('±' + sig(pr.abs, 2) + ' mm² (RSS)   ±' + sig(pr.worstAbs, 2) + ' mm² (worst)');
      lines.push('justifies ' + this.just + ' s.f. → A = ' + sig(pr.value, this.just) + ' mm²');
      lines.push('            = ' + SE.sigfig.formatEng(pr.value * 1e-6, this.just) + ' m²');
      if (p.claim != null) lines.push('you wrote ' + p.claim + ' s.f.' + (this.result ? (p.claim === this.just ? '  ✓' : '  ✗') : ''));
    }
    SE.sceneUtil.readout(ctx, 12, Math.max(sy + sh + 44, h - 12 - lines.length * 17 - 12), lines);
  };

  Bench.prototype.controls = function () {
    var p = this.p;
    if (p.mode === 'fence') return [
      { key: 'rule', label: 'rounding rule (book / up / truncate)', min: 0, max: 2, step: 1, value: RULES.indexOf(p.rule), unit: '' },
      { key: 'boards', label: 'boards', min: 5, max: 80, step: 1, value: p.boards, unit: '' },
      { key: 'fiveFrac', label: 'readings ending in 5', min: 0, max: 1, step: 0.05, value: p.fiveFrac, unit: '' },
      { key: 'seed', label: 'board pile', min: 1, max: 50, step: 1, value: p.seed, unit: '' },
      { key: 'gapLimit', label: 'zombie squeeze gap', min: 0.01, max: 0.1, step: 0.005, value: p.gapLimit, unit: 'm' }
    ];
    if (p.mode === 'chain') return [
      { key: 'keep', label: 'precision (0 round each step, 1 keep full)', min: 0, max: 1, step: 1, value: p.keep === 'full' ? 1 : 0, unit: '' },
      { key: 'h', label: 'tip rise h', min: 2, max: 9, step: 0.01, value: p.h, unit: 'm' },
      { key: 'r', label: 'tip reach r', min: 3, max: 12, step: 0.01, value: p.r, unit: 'm' },
      { key: 'bays', label: 'lattice bays', min: 3, max: 12, step: 1, value: p.bays, unit: '' },
      { key: 'k', label: 'stay at node', min: 1, max: p.bays, step: 1, value: p.k, unit: '' },
      { key: 'sf', label: 'figures kept per step', min: 2, max: 6, step: 1, value: p.sf, unit: 's.f.' },
      { key: 'clearance', label: 'hole clearance', min: 0.0002, max: 0.01, step: 0.0002, value: p.clearance, unit: 'm' }
    ];
    return [
      { key: 'res', label: 'least count', min: 0.01, max: 0.1, step: 0.01, value: p.res, unit: 'mm' },
      { key: 'a', label: 'side a', min: 5, max: 120, step: 0.001, value: p.a, unit: 'mm' },
      { key: 'b', label: 'side b', min: 5, max: 120, step: 0.001, value: p.b, unit: 'mm' },
      { key: 'worst', label: 'judge by worst case', min: 0, max: 1, step: 1, value: p.worst ? 1 : 0, unit: '' }
    ];
  };

  Bench.prototype.set = function (key, value) {
    var p = this.p;
    if (key === 'rule') p.rule = typeof value === 'string' ? value : RULES[Math.round(value)] || 'book';
    else if (key === 'keep') p.keep = typeof value === 'string' ? value : (value >= 0.5 ? 'full' : 'round');
    else if (key === 'worst') p.worst = !!(typeof value === 'number' ? Math.round(value) : value);
    else if (key === 'boards' || key === 'seed' || key === 'bays' || key === 'k' || key === 'sf') p[key] = Math.round(value);
    else p[key] = value;
    if (p.k > p.bays) p.k = p.bays;
    if (key === 'boards' || key === 'seed' || key === 'fiveFrac') p.lengths = null;
    this.reset();
    if (this.w) this.resize(this.w, this.h);
  };

  Bench.prototype.readouts = function () {
    var p = this.p;
    if (p.mode === 'fence') {
      var f = this.fence;
      return ['rule: ' + RULE_NAME[p.rule], 'true total ' + f.trueTotal.toFixed(3) + ' m', 'cut total ' + f.total.toFixed(3) + ' m', 'drift ' + cm(f.drift)];
    }
    if (p.mode === 'chain') {
      var c = this.calc;
      return ['exact bolt ' + (c.exact * 1000).toFixed(2) + ' mm', 'rounded chain ' + (c.rounded * 1000).toFixed(2) + ' mm', 'chain error ' + mmS(c.error), 'hole slack ±' + (p.clearance * 500).toFixed(2) + ' mm'];
    }
    var pr = this.prop;
    return ['A = ' + sig(pr.value, this.just) + ' mm² (' + this.just + ' s.f.)', 'RSS ±' + sig(pr.abs, 2) + ' mm²', 'worst ±' + sig(pr.worstAbs, 2) + ' mm²'];
  };

  SE.scenes.bench = Bench;
})(globalThis.SE);
