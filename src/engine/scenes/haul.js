/*
 * Haul scene: the crew picks equipment from YOUR number, then the real load
 * shows up.
 *
 * The player works out a load (a weight, a mass, a pressure...) and hands the
 * figure to the crew. The crew does what crews do: they read down the yard
 * sheet and take the smallest piece of kit whose rating is at least that
 * figure. The test then runs with the TRUE load, so
 *   - an underestimate puts the true load on kit that is too small: it fails;
 *   - an overestimate works, but ties up something far bigger than needed
 *     (the "oversized" soft fail: fuel, time, a detour).
 *
 * Modes
 *   'bridge'  A rig (truck + trailer) crosses a ravine on a truss bridge,
 *             modelled as a simply supported span with a moving point load P
 *             at distance a from the near support (span L, xi = a / L):
 *               bending moment under the load   M = P a (L - a) / L
 *               moment capacity (rated P_r at midspan, times safety s)
 *                                               M_cap = s P_r L / 4
 *               the span fails at the first xi where M >= M_cap, i.e.
 *                 4 xi (1 - xi) P >= s P_r
 *               midspan deflection (linear elastic, Euler-Bernoulli)
 *                 d_mid = P a (3 L^2 - 4 a^2) / (48 E I)     for a <= L/2
 *               scaled so that d_mid = d_rated (= L / deflRatio) when P = P_r
 *               sits at midspan. The drawn sag is proportional to load/rating.
 *   'lift'    Hand truck, pallet jack, forklift or crane picks up an object.
 *             The load is transferred over a short ramp. Past capacity:
 *               counterbalanced kit (forklift, crane) tips about its front
 *               fulcrum. With load moment W a and the rated load W_r just
 *               balancing the counterweight, W_r a = W_c b, so
 *                 theta'' = g (u - 1) / (u a + b),   u = W / (s W_r)
 *               (rigid body pivoting on the fulcrum, both masses lumped at
 *               their lever arms). Other kit buckles: once past the critical
 *               load a column's lateral sway grows instead of decaying,
 *                 e'' = k (u - 1) e.
 *   'axle'    A single-axle trailer is loaded from a hoist. The axle carries
 *             the load in bending; it snaps the moment the transferred load
 *             passes s times its rating. Suspension sag grows linearly with
 *             load (spring sized for 80 mm at the rated load).
 *
 * Params: mode, quantity ('force'|'mass'|'pressure'|...), options, claimed,
 *   trueValue (both in SI units of the quantity), safety (1 = fails right at
 *   the rating), oversize (3), g, span, depth, deflRatio, label, object
 *   ('crate'|'drum'|'bollard'), unitLabel (for quantities without a known
 *   SI/FPS pair), zombies.
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;
  SE.physics = SE.physics || {};

  /* ------------------------------------------------------------ pure physics */

  function sorted(options) {
    return (options || []).filter(function (o) { return o && isFinite(o.rating); })
      .slice().sort(function (a, b) { return a.rating - b.rating; });
  }

  // The crew's rule: smallest rating that is at least the claimed figure.
  // A figure bigger than everything in the yard gets the biggest thing there.
  // A missing or non-numeric figure gets nothing (null): the caller decides.
  function pick(options, claimed) {
    var s = sorted(options);
    if (!s.length || typeof claimed !== 'number' || isNaN(claimed)) return null;
    for (var i = 0; i < s.length; i++) if (s[i].rating >= claimed) return s[i];
    return s[s.length - 1];
  }

  /*
   * Decide the outcome for a claimed figure against the true load.
   * opts.safety: load at failure / rating (default 1)
   * opts.oversize: rating / true load beyond which the pick counts as
   *   wasteful (default 3), unless it was the smallest thing that would do.
   */
  function evaluate(options, claimed, trueValue, opts) {
    opts = opts || {};
    var safety = opts.safety == null ? 1 : opts.safety;
    var oversize = opts.oversize == null ? 3 : opts.oversize;
    var s = sorted(options);
    var chosen = pick(s, claimed), fallback = false;
    if (!chosen) { chosen = s[0] || null; fallback = true; }
    if (!chosen) return { outcome: 'overloaded', chosen: null, utilization: Infinity, fallback: true };
    var ideal = pick(s, trueValue);
    var capacity = chosen.rating * safety;
    var utilization = trueValue / chosen.rating;
    var ratio = chosen.rating / trueValue;
    var outcome;
    if (trueValue > capacity) outcome = 'overloaded';
    else if (ratio > oversize && chosen !== ideal) outcome = 'oversized';
    else outcome = 'ok';
    var cost = null;
    if (outcome === 'oversized') {
      cost = chosen.cost || ('tied up the ' + chosen.name + ' for a job the ' + (ideal ? ideal.name : 'smallest kit') + ' could do');
    }
    return {
      outcome: outcome, chosen: chosen, ideal: ideal, utilization: utilization,
      capacity: capacity, ratio: ratio, fallback: fallback,
      exceedsYard: !!(s.length && claimed > s[s.length - 1].rating),
      idealAvailable: !!(ideal && ideal.rating >= trueValue),
      cost: cost
    };
  }

  // Midspan deflection of a simply supported span for a point load at
  // xi = a/L, as a fraction of the deflection with the same load at midspan.
  function midspanInfluence(xi) {
    if (xi <= 0 || xi >= 1) return 0;
    var e = xi <= 0.5 ? xi : 1 - xi;
    return e * (3 - 4 * e * e);
  }

  // Bending moment under a moving point load, as a fraction of the moment
  // capacity s P_r L / 4.  u = P / (s P_r).
  function momentDemand(u, xi) {
    if (xi <= 0 || xi >= 1) return 0;
    return u * 4 * xi * (1 - xi);
  }

  // First position xi where the span fails, or null if it never does.
  function collapsePosition(u) {
    if (!(u > 1)) return null;
    return (1 - Math.sqrt(1 - 1 / u)) / 2;
  }

  // Angular acceleration of counterbalanced kit tipping on its fulcrum.
  function tipAccel(u, a, b, g) {
    if (!(u > 1)) return 0;
    return g * (u - 1) / (u * a + b);
  }

  // Suspension / span sag relative to the sag at the rated load.
  function relSag(load, rating) { return rating > 0 ? load / rating : 0; }

  SE.physics.haul = {
    pick: pick, evaluate: evaluate, sorted: sorted,
    midspanInfluence: midspanInfluence, momentDemand: momentDemand,
    collapsePosition: collapsePosition, tipAccel: tipAccel, relSag: relSag
  };

  /* ---------------------------------------------------------- formatting */

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function fmtSI(v, q, unitLabel) {
    var a = Math.abs(v);
    if (q === 'force') return a >= 1e6 ? sig(v / 1e6) + ' MN' : a >= 1e3 ? sig(v / 1e3) + ' kN' : sig(v) + ' N';
    if (q === 'mass') return a >= 1e3 ? sig(v / 1e3) + ' Mg' : sig(v) + ' kg';
    if (q === 'pressure') return a >= 1e6 ? sig(v / 1e6) + ' MPa' : a >= 1e3 ? sig(v / 1e3) + ' kPa' : sig(v) + ' Pa';
    return sig(v) + (unitLabel ? ' ' + unitLabel : '');
  }
  function fmtFPS(v, q) {
    var U = SE.units;
    if (q === 'force') { var lb = v / U.LBF; return Math.abs(lb) >= 1e4 ? sig(lb / 1000) + ' kip' : sig(lb) + ' lb'; }
    if (q === 'mass') return sig(v / U.SLUG) + ' slug';
    if (q === 'pressure') return sig(v / U.UNITS.psi.f) + ' psi';
    return null;
  }
  function fmtDual(v, q, unitLabel) {
    if (!isFinite(v)) return '—';
    var f = fmtFPS(v, q);
    return fmtSI(v, q, unitLabel) + (f ? '  (' + f + ')' : '');
  }

  /* --------------------------------------------------------- default yards */

  var LB = 4.448;
  var DEFAULTS = {
    bridge: [
      { id: 'foot', name: 'plank footbridge', rating: 20e3, kind: 'footbridge' },
      { id: 'county', name: 'old county truss', rating: 150e3, kind: 'truss' },
      { id: 'rail', name: 'rail trestle', rating: 600e3, kind: 'heavy', cost: 'took the rail line: 2 days clearing wrecks off the track' },
      { id: 'dam', name: 'dam road', rating: 3e6, kind: 'detour', cost: 'detoured 40 km over the dam: burned 2 days of fuel' }
    ],
    lift: [
      { id: 'hand', name: 'hand truck', rating: 600 * LB, kind: 'handtruck' },
      { id: 'jack', name: 'pallet jack', rating: 5000 * LB, kind: 'palletjack' },
      { id: 'fork', name: 'forklift', rating: 8000 * LB, kind: 'forklift', cost: 'ran the forklift: half a day of propane gone' },
      { id: 'crane', name: 'truck crane', rating: 50000 * LB, kind: 'crane', cost: 'set up the crane: burned 2 days of fuel' }
    ],
    axle: [
      { id: 'barrow', name: 'wheelbarrow axle', rating: 300 * LB, kind: 'barrow' },
      { id: 'cart', name: 'garden cart', rating: 1200 * LB, kind: 'cart' },
      { id: 'util', name: 'utility trailer', rating: 3500 * LB, kind: 'trailer' },
      { id: 'flat', name: 'flatbed trailer', rating: 10000 * LB, kind: 'flatbed', cost: 'hitched the flatbed: needed the big truck, a day of diesel' }
    ]
  };
  var DEFAULT_TRUE = { bridge: 90e3, lift: 3000 * LB, axle: 2000 * LB };
  var SLIDER_SCALE = { force: { f: 1e3, u: 'kN' }, mass: { f: 1, u: 'kg' }, pressure: { f: 1e3, u: 'kPa' } };
  var LIFT_GEOM = {             // load arm a, counterweight arm b (m), lift height
    handtruck: { lift: 0.12, tips: false }, palletjack: { lift: 0.12, tips: false },
    forklift: { a: 1.2, b: 1.0, lift: 1.5, tips: true }, crane: { a: 6, b: 2.2, lift: 3.2, tips: true }
  };

  /* ------------------------------------------------------------- the scene */

  function Haul() {}

  Haul.prototype.init = function (stage, p) {
    this.stage = stage;
    var mode = (p && p.mode) || 'bridge';
    this.p = Object.assign({
      mode: mode, quantity: 'force', options: null, claimed: null, trueValue: null,
      safety: 1, oversize: 3, g: 9.81, span: 18, depth: 7, deflRatio: 800,
      label: '', object: mode === 'lift' ? 'bollard' : 'crate', unitLabel: '', zombies: 4
    }, p);
    if (!this.p.options) this.p.options = DEFAULTS[mode] || DEFAULTS.bridge;
    if (this.p.trueValue == null) this.p.trueValue = DEFAULT_TRUE[mode] || DEFAULT_TRUE.bridge;
    if (this.p.claimed == null) this.p.claimed = this.p.trueValue;
    this.reset();
  };

  Haul.prototype.reset = function () {
    var p = this.p;
    this.state = 'idle';             // idle | pick | test | failing | tally | done
    this.time = 0; this.phaseT = 0;
    this.events = [];
    this.result = null;
    this.list = sorted(p.options);
    this.claimed = p.claimed; this.trueValue = p.trueValue;
    this.ev = evaluate(this.list, this.claimed, this.trueValue, { safety: p.safety, oversize: p.oversize });
    this.chosen = this.ev.chosen;
    this.chosenIdx = Math.max(0, this.list.indexOf(this.chosen));
    this.cursor = -1;                // clipboard row being read
    this.load = 0;                   // fraction of the true load currently carried (0..1)
    this.broken = false;
    // bridge
    this.rigX = -p.span / 2 - 8; this.rigY = 0; this.rigVy = 0; this.rigAng = 0; this.rigVx = 4.5;
    this.sag = 0; this.sagV = 0; this.breakX = null; this.th1 = 0; this.w1 = 0; this.th2 = 0; this.w2 = 0;
    this.maxDemand = 0;
    // lift
    this.lift = 0; this.tip = 0; this.tipW = 0; this.sway = 0; this.swayV = 0; this.dropY = 0; this.dropV = 0; this.dropped = false;
    // axle
    this.hookY = 2.6; this.bedDrop = 0; this.bedV = 0; this.splay = 0;
    this.creaked = false; this.groaned = false;
    this.zx = [];
    for (var i = 0; i < p.zombies; i++) this.zx.push({ x: -6 + i * 3.1 + (i % 2) * 0.7, dir: i % 2 ? 1 : -1, seed: i + 5 });
  };

  Haul.prototype.resize = function (w, h) {
    var p = this.p;
    this.w = w; this.h = h;
    if (p.mode === 'bridge') {
      var scale = Math.min(w / (p.span + 16), (h - 30) / (p.depth + 9));
      this.cam = new SE.Camera({ scale: scale, ox: w * 0.5, oy: h - 22 - p.depth * scale });
    } else if (p.mode === 'lift') {
      var s2 = Math.min(w / 17, (h - 60) / 8.5);
      this.cam = new SE.Camera({ scale: s2, ox: w * 0.55, oy: h - 46 });
    } else {
      var s3 = Math.min(w / 13, (h - 60) / 5.5);
      this.cam = new SE.Camera({ scale: s3, ox: w * 0.45, oy: h - 46 });
    }
  };

  /*
   * run(cfg) or run(claimed): cfg = { claimed, trueValue, options, quantity,
   * safety, oversize }. Anything left out keeps the current params.
   * Resolves { outcome: 'ok'|'overloaded'|'oversized',
   *            detail: { chosen, utilization, claimed, trueValue, ideal,
   *                      capacity, ratio, cost, fallback, failedAt } }.
   */
  Haul.prototype.run = function (cfg) {
    var self = this, p = this.p;
    if (typeof cfg === 'number') cfg = { claimed: cfg };
    cfg = cfg || {};
    ['claimed', 'trueValue', 'options', 'quantity', 'safety', 'oversize'].forEach(function (k) { if (cfg[k] != null) p[k] = cfg[k]; });
    this.reset();
    this.state = 'pick';
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  Haul.prototype.finish = function (outcome, extra) {
    var ev = this.ev;
    var detail = Object.assign({
      chosen: ev.chosen, utilization: ev.utilization, claimed: this.claimed, trueValue: this.trueValue,
      ideal: ev.ideal, capacity: ev.capacity, ratio: ev.ratio, cost: ev.cost, fallback: ev.fallback
    }, extra || {});
    this.result = { outcome: outcome, detail: detail };
    if (this.resolve) { var r = this.resolve; this.resolve = null; var res = this.result; setTimeout(function () { r(res); }, 700); }
  };

  // Load as a fraction of the chosen kit's failure capacity.
  Haul.prototype.uCap = function () { return this.chosen ? this.trueValue / (this.chosen.rating * this.p.safety) : Infinity; };

  Haul.prototype.pickDuration = function () { return 0.6 + 0.45 * (this.chosenIdx + 1) + 0.9; };

  Haul.prototype.step = function (dt) {
    var p = this.p;
    this.time += dt; this.phaseT += dt;
    for (var i = 0; i < this.zx.length; i++) {
      var z = this.zx[i]; z.x += z.dir * dt * 0.25;
      if (z.x > 7) z.dir = -1; if (z.x < -7) z.dir = 1;
    }
    if (this.state === 'idle' || this.state === 'done') return;
    if (this.state === 'pick') {
      var row = Math.floor((this.phaseT - 0.6) / 0.45);
      if (row > this.cursor && row <= this.chosenIdx) { this.cursor = row; SE.audio && SE.audio.play(row === this.chosenIdx ? 'stamp' : 'click'); }
      if (this.phaseT >= this.pickDuration()) { this.state = 'test'; this.phaseT = 0; }
      return;
    }
    if (!this.chosen) { this.state = 'done'; this.finish('overloaded', {}); return; }
    if (p.mode === 'bridge') this.stepBridge(dt);
    else if (p.mode === 'lift') this.stepLift(dt);
    else this.stepAxle(dt);
    if (this.state === 'tally' && this.phaseT > 1.4) {
      this.state = 'done';
      if (this.ev.outcome === 'oversized') SE.audio && SE.audio.play('stamp');
      else SE.audio && SE.audio.play('success');
      this.finish(this.ev.outcome, {});
    }
  };

  Haul.prototype.strain = function (u) {
    if (u > 0.7 && !this.creaked) { this.creaked = true; SE.audio && SE.audio.play('creak'); }
    if (u > 0.92 && !this.groaned) { this.groaned = true; SE.audio && SE.audio.play('groan'); }
  };

  Haul.prototype.stepBridge = function (dt) {
    var p = this.p, L = p.span, g = p.g;
    if (this.state === 'test') {
      this.rigX += this.rigVx * dt;
      var xi = (this.rigX + L / 2) / L;
      var u = this.uCap();
      var dem = momentDemand(u, xi);
      this.maxDemand = Math.max(this.maxDemand, dem);
      this.load = (xi > 0 && xi < 1) ? 1 : 0;
      this.strain(dem);
      // quasi-static sag target, followed by a lightly damped 1.6 Hz mode
      var target = relSag(this.trueValue, this.chosen.rating) * midspanInfluence(xi);
      var w0 = 2 * Math.PI * 1.6, zeta = 0.08;
      this.sagV += (w0 * w0 * (target - this.sag) - 2 * zeta * w0 * this.sagV) * dt;
      this.sag += this.sagV * dt;
      if (dem >= 1) {
        this.state = 'failing'; this.phaseT = 0; this.broken = true;
        this.breakX = this.rigX; this.failedAt = xi;
        this.events.push('collapse');
        this.stage.shake(18); this.stage.flash('rgba(255,220,170,ALPHA)', 0.45, 0.25);
        this.stage.burst(this.cam.x(this.rigX), this.cam.y(0), { n: 50, color: '#ffd27a', speed: 380 });
        this.stage.burst(this.cam.x(this.rigX), this.cam.y(0), { n: 30, color: C.rustDark, kind: 'debris', speed: 260 });
        SE.audio && SE.audio.play('snap');
        return;
      }
      if (this.rigX > L / 2 + 7) { this.state = 'tally'; this.phaseT = 0; this.load = 0; }
    } else if (this.state === 'tally') {
      this.rigX += this.rigVx * dt;
      var wt = 2 * Math.PI * 1.6;
      this.sagV += (-wt * wt * this.sag - 2 * 0.08 * wt * this.sagV) * dt;
      this.sag += this.sagV * dt;
    } else if (this.state === 'failing') {
      // each half is a rod pinned at its abutment: theta'' = 3 g cos(theta) / (2 l)
      var l1 = Math.max(1, this.breakX + L / 2), l2 = Math.max(1, L / 2 - this.breakX);
      if (this.th1 < 1.35) { this.w1 += 1.5 * g * Math.cos(this.th1) / l1 * dt; this.th1 += this.w1 * dt; }
      if (this.th2 < 1.35) { this.w2 += 1.5 * g * Math.cos(this.th2) / l2 * dt; this.th2 += this.w2 * dt; }
      // the rig drops free
      this.rigVy -= g * dt; this.rigY += this.rigVy * dt;
      this.rigVx *= Math.exp(-dt * 0.6); this.rigX += this.rigVx * dt;
      this.rigAng = Math.min(0.9, this.rigAng + dt * 0.7);
      if (this.rigY <= -p.depth + 0.4) {
        this.rigY = -p.depth + 0.4; this.state = 'done';
        this.stage.shake(24); this.stage.flash('rgba(255,120,80,ALPHA)', 0.35, 0.35);
        this.stage.burst(this.cam.x(this.rigX), this.cam.y(-p.depth), { n: 60, color: '#8a5a33', kind: 'debris', speed: 360 });
        this.stage.burst(this.cam.x(this.rigX), this.cam.y(-p.depth), { n: 30, color: '#a08870', kind: 'dust', speed: 150, gravity: -30 });
        SE.audio && SE.audio.play('crash'); SE.audio && SE.audio.play('fail');
        this.finish('overloaded', { failedAt: this.failedAt, maxDemand: this.maxDemand });
      }
    }
  };

  Haul.prototype.stepLift = function (dt) {
    var p = this.p, g = p.g, t = this.phaseT;
    var geo = LIFT_GEOM[this.chosen.kind] || LIFT_GEOM.forklift;
    var u = this.uCap();
    if (this.state === 'test') {
      this.load = Math.max(0, Math.min(1, (t - 0.5) / 0.9));
      var ue = u * this.load;
      this.strain(ue);
      if (ue > 1) {
        this.state = 'failing'; this.phaseT = 0; this.broken = true; this.events.push(geo.tips ? 'tip' : 'buckle');
        this.sway = 0.004; this.swayV = 0;
        SE.audio && SE.audio.play(geo.tips ? 'groan' : 'snap');
        this.stage.shake(geo.tips ? 6 : 10);
        return;
      }
      if (t > 1.4) this.lift = Math.min(geo.lift, this.lift + dt * geo.lift / 1.4);
      if (t > 3.6) { this.state = 'tally'; this.phaseT = 0; }
    } else if (this.state === 'failing') {
      this.load = Math.min(1, this.load + dt / 0.9);
      var ue2 = u * this.load;
      if (geo.tips) {
        if (!this.dropped) {
          this.tipW += tipAccel(ue2, geo.a, geo.b, g) * dt; this.tip += this.tipW * dt;
          if (this.tip > 0.42) {
            this.dropped = true; this.events.push('crash');
            this.stage.shake(22); this.stage.flash('rgba(255,120,80,ALPHA)', 0.3, 0.3);
            this.stage.burst(this.cam.x(2.6), this.cam.y(0), { n: 40, color: '#a08870', kind: 'dust', speed: 170, gravity: -30 });
            this.stage.burst(this.cam.x(2.6), this.cam.y(0), { n: 40, color: '#8a5a33', kind: 'debris', speed: 300 });
            SE.audio && SE.audio.play('crash'); SE.audio && SE.audio.play('fail');
            this.state = 'done';
            this.finish('overloaded', { mechanism: 'tipped' });
          }
        }
      } else {
        // post-buckling: lateral sway grows exponentially past the critical load
        this.swayV += 60 * Math.max(0.05, ue2 - 1) * this.sway * dt; this.sway += this.swayV * dt;
        if (this.sway > 0.28 && !this.dropped) {
          this.dropped = true; this.events.push('buckle');
          this.stage.burst(this.cam.x(0.8), this.cam.y(0.5), { n: 30, color: '#ffd27a', speed: 300 });
          SE.audio && SE.audio.play('clang');
        }
        this.sway = Math.min(this.sway, 0.45);
        if (this.dropped) {
          this.dropV -= g * dt; this.dropY += this.dropV * dt;
          if (this.lift + this.dropY <= 0) {
            this.dropY = -this.lift; this.state = 'done';
            this.stage.shake(16);
            this.stage.burst(this.cam.x(2), this.cam.y(0), { n: 30, color: '#a08870', kind: 'dust', speed: 150, gravity: -30 });
            SE.audio && SE.audio.play('thud'); SE.audio && SE.audio.play('fail');
            this.finish('overloaded', { mechanism: 'buckled' });
          }
        }
      }
    }
  };

  Haul.prototype.stepAxle = function (dt) {
    var p = this.p, g = p.g, t = this.phaseT;
    var u = this.uCap();
    if (this.state === 'test') {
      this.hookY = Math.max(0, 2.6 - t * 2.6 / 1.1);
      this.load = Math.max(0, Math.min(1, (t - 1.1) / 1.3));
      this.strain(u * this.load);
      if (u * this.load > 1) {
        this.state = 'failing'; this.phaseT = 0; this.broken = true; this.events.push('snap');
        this.failedAt = this.load;
        this.stage.shake(16); this.stage.flash('rgba(255,230,180,ALPHA)', 0.4, 0.2);
        this.stage.burst(this.cam.x(0), this.cam.y(0.4), { n: 45, color: '#ffd27a', speed: 360 });
        SE.audio && SE.audio.play('snap');
        return;
      }
      if (t > 3.4) { this.state = 'tally'; this.phaseT = 0; }
    } else if (this.state === 'failing') {
      this.splay = Math.min(0.5, this.splay + dt * 1.6);
      this.bedV -= g * dt; this.bedDrop += this.bedV * dt;
      if (this.bedDrop <= -0.45) {
        this.bedDrop = -0.45; this.state = 'done';
        this.stage.shake(14);
        this.stage.burst(this.cam.x(0), this.cam.y(0), { n: 34, color: '#a08870', kind: 'dust', speed: 160, gravity: -30 });
        SE.audio && SE.audio.play('crash'); SE.audio && SE.audio.play('fail');
        this.finish('overloaded', { failedAt: this.failedAt });
      }
    }
  };

  /* ---------------------------------------------------------------- drawing */

  Haul.prototype.draw = function (ctx, w, h, t) {
    var p = this.p;
    if (!this.cam) this.resize(w, h);
    D.backdrop(ctx, w, h, t);
    if (p.mode === 'bridge') this.drawBridge(ctx, w, h, t);
    else if (p.mode === 'lift') this.drawLift(ctx, w, h, t);
    else this.drawAxle(ctx, w, h, t);
    this.drawReadout(ctx, w, h);
    var util = this.chosen ? this.trueValue * this.load / this.chosen.rating : 0;
    if (this.state !== 'idle' && this.state !== 'pick') this.drawGauge(ctx, 70, h - 78, 44, util);
    var big = this.state === 'pick';
    this.drawClipboard(ctx, w, h, big);
    this.drawStamp(ctx, w, h);
  };

  Haul.prototype.drawZombies = function (ctx, y, t, size) {
    var cam = this.cam;
    this.zx.forEach(function (z) {
      ctx.save();
      var sx = cam.x(z.x);
      if (z.dir < 0) { ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.translate(-sx, 0); }
      D.zombie(ctx, sx, y, cam.len(size), t, z.seed);
      ctx.restore();
    });
  };

  // heft of the drawn structure grows with the chosen rating
  Haul.prototype.heft = function () {
    var s = this.list, r = this.chosen ? this.chosen.rating : 1;
    if (s.length < 2) return 0.5;
    var lo = Math.log(s[0].rating), hi = Math.log(s[s.length - 1].rating);
    return hi > lo ? (Math.log(r) - lo) / (hi - lo) : 0.5;
  };

  Haul.prototype.drawBridge = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, L = p.span, self = this;
    var gy = cam.y(0), by = cam.y(-p.depth);
    // ravine: dark pit, rubble floor, zombies milling below
    var grd = ctx.createLinearGradient(0, gy, 0, by);
    grd.addColorStop(0, '#2a201a'); grd.addColorStop(1, '#100c0a');
    ctx.fillStyle = grd; ctx.fillRect(cam.x(-L / 2), gy, cam.len(L), by - gy);
    ctx.fillStyle = '#1e1813'; ctx.fillRect(cam.x(-L / 2), by - 4, cam.len(L), h - by + 4);
    ctx.save();
    ctx.beginPath(); ctx.rect(cam.x(-L / 2), gy, cam.len(L), h - gy); ctx.clip();
    this.drawZombies(ctx, by, t, 1.7);
    ctx.restore();
    // canyon walls
    ctx.fillStyle = D.rustPattern(ctx, '#3a2f27', 11);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cam.x(-L / 2), gy); ctx.lineTo(cam.x(-L / 2 + 0.8), cam.y(-p.depth * 0.5));
    ctx.lineTo(cam.x(-L / 2 + 0.3), by); ctx.lineTo(0, by); ctx.lineTo(0, h); ctx.lineTo(0, gy); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w, gy); ctx.lineTo(cam.x(L / 2), gy); ctx.lineTo(cam.x(L / 2 - 0.7), cam.y(-p.depth * 0.45));
    ctx.lineTo(cam.x(L / 2 - 0.2), by); ctx.lineTo(w, by); ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = '#1e1813'; ctx.fillRect(0, by, w, h - by);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, gy, cam.x(-L / 2), 3); ctx.fillRect(cam.x(L / 2), gy, w, 3);

    // the span
    var kind = this.chosen ? this.chosen.kind : 'truss';
    var heft = this.heft();
    var hT = kind === 'footbridge' ? 0.9 : 1.6 + heft * 1.4;
    var n = 6;
    var sagDraw = 0.55;                       // drawn sag (m) at the rated load
    var bx = this.breakX;
    var breakNode = bx == null ? -1 : Math.max(1, Math.min(n - 1, Math.round((bx + L / 2) / L * n)));
    function node(i, yOff) {
      var x = -L / 2 + L * i / n;
      var y = yOff - self.sag * sagDraw * Math.sin(Math.PI * i / n);
      if (bx != null) {
        if (i < breakNode) {
          var dx = x + L / 2, c = Math.cos(self.th1), s = Math.sin(self.th1);
          return [cam.x(-L / 2 + dx * c + y * s), cam.y(-dx * s + y * c)];
        }
        var dx2 = x - L / 2, c2 = Math.cos(self.th2), s2 = Math.sin(self.th2);
        return [cam.x(L / 2 + dx2 * c2 - y * s2), cam.y(dx2 * s2 + y * c2)];
      }
      return [cam.x(x), cam.y(y)];
    }
    // left half ends at breakNode-1 (and a dangling stub), right half starts at breakNode
    function seg(i, j, yi, yj) {
      if (bx != null && ((i < breakNode) !== (j < breakNode))) return;
      var a = node(i, yi), b = node(j, yj);
      D.sketchLine(ctx, a[0], a[1], b[0], b[1], { passes: 1, wobble: 0.8 });
    }
    var util = this.chosen ? this.trueValue * this.load / this.chosen.rating * midspanInfluence((this.rigX + L / 2) / L) : 0;
    var stressCol = util > 0.92 ? C.bad : util > 0.7 ? C.hazard : C.rustHi;
    ctx.save();
    ctx.lineCap = 'round';
    // deck
    ctx.strokeStyle = kind === 'footbridge' ? C.wood : C.iron; ctx.lineWidth = Math.max(4, cam.len(0.28));
    for (var i = 0; i < n; i++) seg(i, i + 1, 0, 0);
    if (kind !== 'footbridge') {
      ctx.strokeStyle = C.rust; ctx.lineWidth = Math.max(2.5, cam.len(0.1 + heft * 0.14));
      for (var k = 0; k < n; k++) {
        seg(k, k + 1, hT, hT);                                   // top chord
        seg(k, k, 0, hT);                                        // verticals
        if (k < n / 2) seg(k, k + 1, hT, 0); else seg(k, k + 1, 0, hT);   // Pratt diagonals
      }
      seg(n, n, 0, hT);
      ctx.strokeStyle = stressCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
      for (var m = 0; m < n; m++) seg(m, m + 1, hT, hT);
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = C.woodDark; ctx.lineWidth = 2;
      for (var r = 0; r < n; r++) seg(r, r + 1, hT, hT);
      for (var q = 0; q <= n; q++) seg(q, q, 0, hT);
    }
    ctx.restore();
    // abutment blocks
    ctx.fillStyle = C.steel;
    ctx.fillRect(cam.x(-L / 2) - cam.len(1.2), gy, cam.len(1.2), cam.len(0.7));
    ctx.fillRect(cam.x(L / 2), gy, cam.len(1.2), cam.len(0.7));
    D.hazardStripes(ctx, cam.x(-L / 2) - cam.len(1.2), gy - 6, cam.len(1.2), 6);
    D.hazardStripes(ctx, cam.x(L / 2), gy - 6, cam.len(1.2), 6);
    // rating sign on the near side
    if (this.chosen) {
      var sx = cam.x(-L / 2 - 4.5), sy = cam.y(2.2);
      ctx.fillStyle = C.steel; ctx.fillRect(sx - 2, sy, 4, gy - sy);
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      D.labelBox(ctx, 'LOAD LIMIT ' + fmtSI(this.chosen.rating, p.quantity, p.unitLabel), sx, sy - 4, C.night, C.paper);
    }
    // the rig: deck height under it follows the sag
    var ry = this.rigY;
    if (this.state !== 'failing' && this.state !== 'done' || !this.broken) {
      var xi = (this.rigX + L / 2) / L;
      if (xi > 0 && xi < 1) ry = -this.sag * sagDraw * Math.sin(Math.PI * xi);
    }
    this.drawRig(ctx, this.rigX, ry, this.rigAng, t);
    // load arrow on the rig
    if (this.state === 'test' && this.load > 0) {
      var ax = cam.x(this.rigX), ay = cam.y(ry + 3.4);
      D.arrow(ctx, ax, ay - 30, ax, ay + 8, C.weight, 'P = ' + fmtSI(this.trueValue, p.quantity, p.unitLabel));
    }
    // sag dimension at midspan (true deflection, not the exaggerated drawing)
    if (this.state === 'test' && this.chosen) {
      var mm = this.sag * L / p.deflRatio * 1000;
      D.text(ctx, 'midspan sag ' + sig(Math.max(0, mm), 2) + ' mm (drawn exaggerated)', cam.x(0), cam.y(-1.3), { align: 'center', color: C.blueInk, font: '600 11px "IBM Plex Mono", monospace' });
    }
  };

  Haul.prototype.drawRig = function (ctx, x, y, ang, t) {
    var cam = this.cam, s = cam.scale;
    ctx.save();
    ctx.translate(cam.x(x), cam.y(y)); ctx.rotate(ang);
    function R(x0, y0, w0, h0, col) { ctx.fillStyle = col; ctx.fillRect(x0 * s, -(y0 + h0) * s, w0 * s, h0 * s); }
    // trailer
    R(-6.2, 0.75, 6.6, 0.35, C.iron);
    R(0.2, 0.75, 1.2, 0.18, C.steel);                     // hitch
    D.crate(ctx, -5.6 * s, -1.1 * s, 5.2 * s, 1.7 * s, { label: this.p.label || fmtSI(this.trueValue, this.p.quantity, this.p.unitLabel) });
    // tractor
    R(1.1, 0.6, 3.6, 0.45, C.iron);
    R(2.7, 1.05, 1.9, 1.6, C.rust);
    R(3.9, 1.05, 1.0, 0.9, C.rustDark);                   // hood
    R(2.9, 1.95, 1.0, 0.55, 'rgba(143,184,232,0.45)');    // windscreen
    ctx.fillStyle = C.hazard; ctx.fillRect(4.75 * s, -1.4 * s, 0.15 * s, 0.2 * s);
    ctx.strokeStyle = C.rustDark; ctx.lineWidth = 2; ctx.strokeRect(2.7 * s, -2.65 * s, 1.9 * s, 1.6 * s);
    // scrap armour on the grille
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 2;
    for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.moveTo(4.9 * s, -(0.6 + b * 0.25) * s); ctx.lineTo(5.3 * s, -(0.5 + b * 0.25) * s); ctx.stroke(); }
    // wheels
    var spin = this.rigX * 2.2;
    [-5.0, -3.9, 1.6, 4.0].forEach(function (wx) {
      ctx.save(); ctx.translate(wx * s, -0.45 * s); ctx.rotate(spin);
      ctx.fillStyle = '#151210'; ctx.beginPath(); ctx.arc(0, 0, 0.45 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(0, 0, 0.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.iron; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-0.2 * s, 0); ctx.lineTo(0.2 * s, 0); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  };

  Haul.prototype.drawObject = function (ctx, x0, y0, wpx, hpx) {
    var p = this.p;
    var label = p.label || fmtSI(this.trueValue, p.quantity, p.unitLabel);
    if (p.object === 'drum') {
      ctx.fillStyle = D.rustPattern(ctx, '#2f5a6e', 7); ctx.fillRect(x0, y0 - hpx, wpx, hpx);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
      [0.2, 0.5, 0.8].forEach(function (f) { ctx.beginPath(); ctx.moveTo(x0, y0 - hpx * f); ctx.lineTo(x0 + wpx, y0 - hpx * f); ctx.stroke(); });
      ctx.fillStyle = C.hazard; ctx.fillRect(x0 + wpx * 0.3, y0 - hpx * 0.62, wpx * 0.4, hpx * 0.24);
      ctx.font = '700 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = C.night;
      ctx.fillText(label, x0 + wpx / 2, y0 - hpx * 0.46);
    } else if (p.object === 'bollard') {
      ctx.fillStyle = D.rustPattern(ctx, '#8d8778', 9);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + wpx, y0); ctx.lineTo(x0 + wpx * 0.85, y0 - hpx); ctx.lineTo(x0 + wpx * 0.15, y0 - hpx); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      D.hazardStripes(ctx, x0 + wpx * 0.14, y0 - hpx * 0.8, wpx * 0.72, hpx * 0.1);
      ctx.font = '700 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = C.night;
      ctx.fillText(label, x0 + wpx / 2, y0 - hpx * 0.4);
    } else D.crate(ctx, x0, y0, wpx, hpx, { label: label });
  };

  Haul.prototype.drawLift = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, s = cam.scale;
    D.ground(ctx, w, cam.y(0), h - cam.y(0));
    // zombies pace outside the yard fence, behind it
    this.drawZombies(ctx, cam.y(0) - 6, t, 1.2);
    D.fence(ctx, 0, cam.y(0), w, 30);
    var kind = this.chosen ? this.chosen.kind : 'forklift';
    var geo = LIFT_GEOM[kind] || LIFT_GEOM.forklift;
    var objX = 1.6, ow = 1.2, oh = p.object === 'drum' ? 1.3 : 1.1;
    var lift = this.lift + this.dropY;
    var pivotX = kind === 'crane' ? -0.6 : objX - 0.35;
    ctx.save();
    // tipping rotates everything about the front fulcrum
    ctx.translate(cam.x(pivotX), cam.y(0)); ctx.rotate(this.tip); ctx.translate(-cam.x(pivotX), -cam.y(0));
    var sway = this.sway * s;
    if (kind === 'handtruck') {
      var hx = cam.x(objX - 0.12), hy = cam.y(0);
      ctx.save(); ctx.translate(hx, hy - 0.28 * s); ctx.rotate(-0.12 * lift / geo.lift);
      ctx.strokeStyle = C.steelHi; ctx.lineWidth = Math.max(3, 0.07 * s);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-sway * 1.5, -0.8 * s, -0.25 * s - sway, -1.55 * s); ctx.lineTo(-0.55 * s - sway, -1.6 * s); ctx.stroke();
      ctx.fillStyle = C.steel; ctx.fillRect(0, -0.05 * s, 0.7 * s, 0.07 * s);
      ctx.fillStyle = '#151210'; ctx.beginPath(); ctx.arc(-0.12 * s, 0.05 * s, 0.24 * s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (kind === 'palletjack') {
      ctx.fillStyle = C.hazard; ctx.fillRect(cam.x(objX - 0.6), cam.y(0.12 + lift), cam.len(2), cam.len(0.1));
      ctx.strokeStyle = C.iron; ctx.lineWidth = Math.max(3, 0.08 * s);
      ctx.beginPath(); ctx.moveTo(cam.x(objX - 0.5), cam.y(0.2 + lift)); ctx.quadraticCurveTo(cam.x(objX - 0.9) + sway, cam.y(0.8), cam.x(objX - 1.3) + sway * 2, cam.y(1.4)); ctx.stroke();
      ctx.fillStyle = '#151210'; ctx.beginPath(); ctx.arc(cam.x(objX - 0.5), cam.y(0.1), 0.1 * s, 0, Math.PI * 2); ctx.arc(cam.x(objX + 1.3), cam.y(0.06), 0.06 * s, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'forklift') {
      var fx = objX - 0.4;
      ctx.fillStyle = C.hazard; ctx.fillRect(cam.x(fx - 2.6), cam.y(1.4), cam.len(2.4), cam.len(0.95));
      ctx.fillStyle = C.iron; ctx.fillRect(cam.x(fx - 3.0), cam.y(1.3), cam.len(0.6), cam.len(1.0));    // counterweight
      ctx.strokeStyle = C.iron; ctx.lineWidth = 3;
      ctx.strokeRect(cam.x(fx - 2.2), cam.y(2.6), cam.len(1.4), cam.len(1.2));                         // overhead guard
      ctx.fillStyle = '#151210';
      [fx - 2.2, fx - 0.6].forEach(function (wx) { ctx.beginPath(); ctx.arc(cam.x(wx), cam.y(0.35), 0.35 * s, 0, Math.PI * 2); ctx.fill(); });
      // mast (bends with sway if it ever buckles)
      ctx.strokeStyle = C.steel; ctx.lineWidth = Math.max(4, 0.12 * s);
      ctx.beginPath(); ctx.moveTo(cam.x(fx - 0.15), cam.y(0.1)); ctx.lineTo(cam.x(fx - 0.15), cam.y(2.4 + lift * 0.6)); ctx.stroke();
      ctx.fillStyle = C.steelHi; ctx.fillRect(cam.x(fx - 0.1), cam.y(0.12 + lift), cam.len(1.5), cam.len(0.08));
    } else if (kind === 'crane') {
      var cx = -4.6;
      ctx.fillStyle = C.hazard; ctx.fillRect(cam.x(cx - 1.6), cam.y(1.6), cam.len(3.6), cam.len(1.0));
      ctx.fillStyle = C.iron; ctx.fillRect(cam.x(cx - 2.2), cam.y(1.5), cam.len(0.8), cam.len(0.9));
      ctx.fillStyle = '#151210';
      [cx - 1.2, cx + 1.4].forEach(function (wx) { ctx.beginPath(); ctx.arc(cam.x(wx), cam.y(0.4), 0.4 * s, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = C.steel; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cam.x(cx + 2), cam.y(0.6)); ctx.lineTo(cam.x(pivotX), cam.y(0)); ctx.stroke();   // outrigger
      var tipX = objX + ow / 2, tipY = 6.2;
      ctx.strokeStyle = C.hazard; ctx.lineWidth = Math.max(5, 0.22 * s);
      ctx.beginPath(); ctx.moveTo(cam.x(cx + 0.5), cam.y(2.0)); ctx.lineTo(cam.x(tipX), cam.y(tipY)); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
      for (var lb = 0.1; lb < 1; lb += 0.12) {
        var lx = cx + 0.5 + (tipX - cx - 0.5) * lb, ly = 2 + (tipY - 2) * lb;
        ctx.beginPath(); ctx.moveTo(cam.x(lx) - 4, cam.y(ly) - 4); ctx.lineTo(cam.x(lx) + 4, cam.y(ly) + 4); ctx.stroke();
      }
      ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cam.x(tipX), cam.y(tipY)); ctx.lineTo(cam.x(tipX), cam.y(oh + lift + 0.1)); ctx.stroke();
    }
    // the object rides the kit
    this.drawObject(ctx, cam.x(objX), cam.y(lift + (kind === 'palletjack' ? 0.22 : 0)), cam.len(ow), cam.len(oh));
    ctx.restore();
    D.survivor(ctx, cam.x(-1.8), cam.y(0), cam.len(1.75), t);
    if (this.load > 0 && !this.dropped) {
      var ax = cam.x(objX + ow + 0.5), ay = cam.y(lift + oh / 2);
      D.arrow(ctx, ax, ay - 20, ax, ay + 40, C.weight, 'W = ' + fmtSI(this.trueValue, p.quantity, p.unitLabel), { ly: 50 });
    }
  };

  Haul.prototype.drawAxle = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, s = cam.scale;
    D.ground(ctx, w, cam.y(0), h - cam.y(0));
    // zombies pace outside the yard fence, behind it
    this.drawZombies(ctx, cam.y(0) - 6, t, 1.2);
    D.fence(ctx, 0, cam.y(0), w, 30);
    var kind = this.chosen ? this.chosen.kind : 'trailer';
    var heft = this.heft();
    var bedLen = 2.0 + heft * 3.2, wr = 0.3 + heft * 0.2;
    var susp = 0.08 * relSag(this.trueValue * this.load, this.chosen ? this.chosen.rating : 1) * 3;  // drawn 3x
    var bedY = wr * 2 + 0.15 - Math.min(susp, 0.3) + this.bedDrop;
    // gantry with hoist
    ctx.fillStyle = D.rustPattern(ctx, C.rust, 5);
    ctx.fillRect(cam.x(-bedLen / 2 - 0.9), cam.y(4.6), cam.len(0.22), cam.len(4.6));
    ctx.fillRect(cam.x(bedLen / 2 + 0.7), cam.y(4.6), cam.len(0.22), cam.len(4.6));
    ctx.fillRect(cam.x(-bedLen / 2 - 0.9), cam.y(4.7), cam.len(bedLen + 1.8), cam.len(0.25));
    var cw = Math.min(bedLen * 0.75, 1.8), ch = 1.1;
    var crateBottom = bedY + 0.12 + this.hookY;
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cam.x(0), cam.y(4.45)); ctx.lineTo(cam.x(0), cam.y(crateBottom + ch)); ctx.stroke();
    // drawbar and jack stand
    ctx.strokeStyle = C.iron; ctx.lineWidth = Math.max(3, 0.1 * s);
    ctx.beginPath(); ctx.moveTo(cam.x(-bedLen / 2), cam.y(bedY + 0.05)); ctx.lineTo(cam.x(-bedLen / 2 - 1.4), cam.y(0.65)); ctx.lineTo(cam.x(-bedLen / 2 - 1.4), cam.y(0)); ctx.stroke();
    // wheel (side view): it foreshortens as the snapped axle lets it splay
    var wx = cam.x(0), wy = cam.y(wr);
    ctx.save(); ctx.translate(wx, wy);
    ctx.fillStyle = '#151210'; ctx.beginPath(); ctx.ellipse(0, 0, wr * s * Math.cos(this.splay * 2.4), wr * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.steel; ctx.beginPath(); ctx.ellipse(0, 0, wr * 0.45 * s * Math.cos(this.splay * 2.4), wr * 0.45 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // bed
    ctx.save();
    ctx.translate(cam.x(0), cam.y(bedY)); ctx.rotate(this.splay * 0.25);
    ctx.fillStyle = kind === 'barrow' || kind === 'cart' ? D.rustPattern(ctx, C.wood, 4) : D.rustPattern(ctx, C.rust, 6);
    ctx.fillRect(-bedLen / 2 * s, -0.12 * s, bedLen * s, 0.24 * s);
    ctx.strokeStyle = C.rustDark; ctx.lineWidth = 2; ctx.strokeRect(-bedLen / 2 * s, -0.12 * s, bedLen * s, 0.24 * s);
    ctx.fillStyle = C.iron; ctx.fillRect(-bedLen / 2 * s, -0.42 * s, 0.08 * s, 0.3 * s); ctx.fillRect((bedLen / 2 - 0.08) * s, -0.42 * s, 0.08 * s, 0.3 * s);
    ctx.restore();
    if (!this.broken) {
      ctx.strokeStyle = C.steel; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx, cam.y(bedY - 0.12)); ctx.stroke();
    }
    var cy = this.state === 'failing' || this.state === 'done' ? bedY + 0.12 : crateBottom;
    D.crate(ctx, cam.x(-cw / 2), cam.y(cy), cam.len(cw), cam.len(ch), { label: p.label || fmtSI(this.trueValue, p.quantity, p.unitLabel) });
    this.drawAxleInset(ctx, w, h);
  };

  // Front-view inset: the axle beam between its wheels, bending under load.
  Haul.prototype.drawAxleInset = function (ctx, w, h) {
    var x = w - 216, y = h - 132, iw = 200, ih = 112;
    ctx.save();
    ctx.fillStyle = 'rgba(15,30,50,0.85)'; D.roundRect(ctx, x, y, iw, ih, 6); ctx.fill();
    ctx.save(); ctx.beginPath(); D.roundRect(ctx, x, y, iw, ih, 6); ctx.clip(); ctx.translate(x, y); D.blueprintGrid(ctx, iw, ih, 16); ctx.restore();
    ctx.strokeStyle = C.blueInk; ctx.lineWidth = 1; D.roundRect(ctx, x, y, iw, ih, 6); ctx.stroke();
    D.text(ctx, 'AXLE — FRONT VIEW', x + 10, y + 16, { color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });
    var u = this.chosen ? this.trueValue * this.load / this.chosen.rating : 0;
    var x1 = x + 34, x2 = x + iw - 34, ay = y + 62;
    var bend = Math.min(1.2, u) * 9;
    ctx.strokeStyle = u > 0.92 ? C.bad : C.paper; ctx.lineWidth = 4; ctx.lineCap = 'round';
    if (!this.broken) {
      ctx.beginPath(); ctx.moveTo(x1, ay); ctx.quadraticCurveTo((x1 + x2) / 2, ay + bend * 2, x2, ay); ctx.stroke();
    } else {
      var mx = (x1 + x2) / 2;
      ctx.beginPath(); ctx.moveTo(x1, ay); ctx.lineTo(mx - 4, ay + 16); ctx.moveTo(mx + 4, ay + 18); ctx.lineTo(x2, ay); ctx.stroke();
    }
    ctx.fillStyle = '#0c0a09';
    var sp = this.splay;
    [[x1, -1], [x2, 1]].forEach(function (wv) {
      ctx.save(); ctx.translate(wv[0], ay); ctx.rotate(wv[1] * sp * 0.8);
      ctx.fillRect(-6, -18, 12, 36); ctx.restore();
    });
    if (this.load > 0) D.arrow(ctx, (x1 + x2) / 2, ay - 40, (x1 + x2) / 2, ay - 6, C.weight, null, { width: 2 });
    D.text(ctx, 'M = P·L/4   ' + Math.round(u * 100) + '% of rating', x + 10, y + ih - 10, { color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });
    ctx.restore();
  };

  Haul.prototype.drawGauge = function (ctx, cx, cy, r, util) {
    var max = 2, safety = this.p.safety;
    function ang(v) { return Math.PI + Math.min(max, Math.max(0, v)) / max * Math.PI; }
    ctx.save();
    ctx.fillStyle = 'rgba(15,12,10,0.82)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 10, Math.PI, 0); ctx.lineTo(cx + r + 10, cy + 18); ctx.lineTo(cx - r - 10, cy + 18); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 7;
    [[0, 0.7, C.good], [0.7, 1, C.hazard], [1, max, C.bad]].forEach(function (b) {
      ctx.strokeStyle = b[2]; ctx.beginPath(); ctx.arc(cx, cy, r, ang(b[0]), ang(b[1])); ctx.stroke();
    });
    ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
    for (var v = 0; v <= max + 1e-9; v += 0.25) {
      var a = ang(v), r1 = v % 0.5 === 0 ? r - 12 : r - 8;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); ctx.stroke();
    }
    if (safety !== 1) {
      var as = ang(safety);
      ctx.strokeStyle = C.blood; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(as) * (r - 14), cy + Math.sin(as) * (r - 14)); ctx.lineTo(cx + Math.cos(as) * (r + 5), cy + Math.sin(as) * (r + 5)); ctx.stroke();
    }
    var an = ang(util) + (util > max ? Math.sin(this.time * 40) * 0.03 : 0);
    ctx.strokeStyle = C.force; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * (r - 6), cy + Math.sin(an) * (r - 6)); ctx.stroke();
    ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    D.text(ctx, Math.round(util * 100) + '% of rating', cx, cy + 14, { align: 'center', font: '600 11px "IBM Plex Mono", monospace', color: util > 1 ? C.bad : C.paper });
    ctx.restore();
  };

  Haul.prototype.drawClipboard = function (ctx, w, h, big) {
    var p = this.p, list = this.list;
    if (!list.length) return;
    var rowH = big ? 26 : 15, cw = big ? Math.min(w - 40, 470) : 236;
    var ch = 74 * (big ? 1 : 0.62) + list.length * rowH + (big ? 22 : 10);
    var x = big ? (w - cw) / 2 : w - cw - 12, y = big ? Math.max(20, (h - ch) / 2) : 12;
    var f = big ? 1 : 0.62;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 5, y + 6, cw, ch);
    ctx.fillStyle = C.paper; ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = C.woodDark; ctx.fillRect(x + cw / 2 - 30 * f, y - 6 * f, 60 * f, 14 * f);           // clip
    ctx.fillStyle = C.steel; ctx.fillRect(x + cw / 2 - 20 * f, y - 9 * f, 40 * f, 8 * f);
    var font = function (sz, wt) { return (wt || 600) + ' ' + Math.round(sz * (big ? 1 : 0.78)) + 'px "IBM Plex Mono", monospace'; };
    ctx.fillStyle = C.ink; ctx.font = font(15, 700); ctx.textBaseline = 'alphabetic';
    ctx.fillText('YARD SHEET — ' + (p.mode === 'bridge' ? 'CROSSINGS' : p.mode === 'lift' ? 'LIFTING GEAR' : 'TRAILERS'), x + 14 * f, y + 26 * f);
    ctx.font = font(13);
    ctx.fillStyle = C.blue;
    var cl = typeof this.claimed === 'number' && !isNaN(this.claimed) ? fmtDual(this.claimed, p.quantity, p.unitLabel) : 'no figure given';
    ctx.fillText('your figure: ' + cl, x + 14 * f, y + 50 * f);
    ctx.strokeStyle = 'rgba(42,42,51,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 10, y + 60 * f); ctx.lineTo(x + cw - 10, y + 60 * f); ctx.stroke();
    var cursor = this.state === 'pick' ? this.cursor : this.chosenIdx;
    var top = y + 74 * f;
    for (var i = 0; i < list.length; i++) {
      var o = list[i], ry = top + i * rowH + rowH * 0.6;
      var read = i <= cursor;
      ctx.fillStyle = read ? C.ink : 'rgba(42,42,51,0.55)';
      ctx.font = font(12);
      ctx.fillText(o.name, x + 30 * f, ry);
      ctx.textAlign = 'right';
      ctx.fillText(fmtDual(o.rating, p.quantity, p.unitLabel), x + cw - 14 * f, ry);
      ctx.textAlign = 'left';
      if (read && i < this.chosenIdx) {                 // too small for the figure: struck out
        ctx.strokeStyle = C.blood; ctx.lineWidth = big ? 2 : 1.4;
        D.sketchLine(ctx, x + 24 * f, ry - 4 * f, x + cw - 10 * f, ry - 4 * f, { passes: 1, wobble: 1.5, seed: i + 3 });
      }
      if (read && i === this.chosenIdx) {               // the pick: circled in pencil
        ctx.strokeStyle = C.blood; ctx.lineWidth = big ? 2.2 : 1.5;
        ctx.beginPath(); ctx.ellipse(x + cw / 2, ry - 4 * f, cw / 2 - 8, rowH * 0.46, -0.01, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = C.blood; ctx.font = font(14, 700); ctx.fillText('✓', x + 12 * f, ry);
      }
    }
    if (this.ev.fallback && this.state !== 'pick') {
      ctx.fillStyle = C.blood; ctx.font = font(11);
      ctx.fillText('no usable figure: crew grabbed the nearest', x + 14 * f, y + ch - 6);
    }
    ctx.restore();
  };

  Haul.prototype.drawStamp = function (ctx, w, h) {
    if (!this.result && this.state !== 'tally') return;
    var oc = this.result ? this.result.outcome : this.ev.outcome;
    if (this.state === 'tally' && this.phaseT < 0.6) return;
    var txt = oc === 'ok' ? 'HOLDS' : oc === 'oversized' ? 'OVERSIZED' : 'FAILED';
    var col = oc === 'ok' ? C.good : oc === 'oversized' ? C.hazard : C.bad;
    // sits below the small clipboard and readout so neither hides it
    var sy = Math.min(h * 0.5, Math.max(h * 0.3, 180));
    ctx.save();
    ctx.translate(w / 2, sy); ctx.rotate(-0.08);
    ctx.font = '800 34px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var tw = ctx.measureText(txt).width + 30;
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.strokeRect(-tw / 2, -26, tw, 52);
    ctx.fillStyle = col; ctx.fillText(txt, 0, 2);
    ctx.restore();
    var note = null;
    if (oc === 'oversized') note = this.ev.cost;
    else if (oc === 'overloaded' && this.chosen) note = this.chosen.name + ' carried ' + Math.round(this.ev.utilization * 100) + '% of its rating';
    else if (oc === 'ok' && this.chosen) note = this.chosen.name + ' at ' + Math.round(this.ev.utilization * 100) + '% of its rating';
    if (note) {
      ctx.save(); ctx.font = '600 13px "IBM Plex Mono", monospace';
      D.labelBox(ctx, note, w / 2, sy + 46, col);
      ctx.restore();
    }
  };

  Haul.prototype.drawReadout = function (ctx) {
    var lines = this.readouts();
    if (SE.sceneUtil && SE.sceneUtil.readout) SE.sceneUtil.readout(ctx, 12, 12, lines);
  };

  Haul.prototype.readouts = function () {
    var p = this.p, q = p.quantity;
    var lines = [
      'claimed ' + (typeof this.claimed === 'number' && !isNaN(this.claimed) ? fmtDual(this.claimed, q, p.unitLabel) : '—'),
      'true    ' + fmtDual(this.trueValue, q, p.unitLabel)
    ];
    if (this.chosen) {
      lines.push('picked  ' + this.chosen.name);
      lines.push('rating  ' + fmtDual(this.chosen.rating, q, p.unitLabel));
      lines.push('load    ' + Math.round(this.trueValue * this.load / this.chosen.rating * 100) + '% of rating');
    }
    if (p.safety !== 1) lines.push('fails at ' + p.safety + '× rating');
    return lines;
  };

  /* ---------------------------------------------------------- sandbox */

  Haul.prototype.controls = function () {
    var p = this.p, sc = SLIDER_SCALE[p.quantity] || { f: 1, u: p.unitLabel || '' };
    var top = this.list.length ? this.list[this.list.length - 1].rating : p.trueValue * 4;
    var max = Math.max(top * 1.2, p.trueValue * 2) / sc.f;
    var stepv = SE.sigfig.roundSig(max / 200, 1).value || 1;
    return [
      { key: 'claimed', label: 'your figure', min: 0, max: max, step: stepv, value: (p.claimed || 0) / sc.f, unit: sc.u },
      { key: 'trueValue', label: 'true load', min: stepv, max: max, step: stepv, value: p.trueValue / sc.f, unit: sc.u },
      { key: 'safety', label: 'fails at × rating', min: 1, max: 2, step: 0.05, value: p.safety, unit: '' }
    ];
  };

  Haul.prototype.set = function (key, value) {
    var p = this.p, sc = SLIDER_SCALE[p.quantity] || { f: 1 };
    if (key === 'claimed' || key === 'trueValue') p[key] = value * sc.f;
    else if (key === 'safety') p.safety = value;
    else p[key] = value;
    this.reset();
  };

  SE.physics.haul.fmtDual = fmtDual;
  SE.scenes.haul = Haul;
})(globalThis.SE);
