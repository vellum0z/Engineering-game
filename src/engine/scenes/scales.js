/*
 * Scales scene: mass versus weight.
 *
 * Three modes share one scene:
 *
 *   'compare'   A spring scale and an equal-arm beam balance hold the same
 *               salvaged object. Move the rig between locations with
 *               different g and the spring reading changes (it measures the
 *               force W = m g) while the balance stays level (it compares
 *               the object's mass with standard masses: both pans feel the
 *               same g, so g cancels out of the moment balance).
 *
 *   'calibrate' A salvaged spring with an unknown stiffness. The player hangs
 *               reference masses and pencils marks on the blank rack. A
 *               least-squares fit of W = k x through those marks becomes the
 *               scale's calibration, and later readings use it.
 *
 *   'rig'       A lunar-gravity training rig. A survivor in a harness is tied
 *               over a pulley to a counterweight. For an ideal pulley (no
 *               friction, massless, inextensible rope) the two bodies form an
 *               Atwood machine and the survivor's downward acceleration is
 *                   a = (m - mc) g / (m + mc)
 *               Derivation: survivor m (down +), counterweight mc (up +),
 *               same rope tension T on both:
 *                   m g - T = m a,   T - mc g = mc a   =>   a = (m - mc) g / (m + mc)
 *               The simpler "static offload" figure g' = g (m - mc) / m
 *               ignores the counterweight's inertia; it is available as
 *               params.model = 'static' for comparison, but the default and
 *               the graded result use the Atwood relation. With a fixed
 *               push-off speed v0 the jump height is h = v0^2 / (2 a).
 *
 * The spring is a damped mass-spring (x measured downward from the unloaded
 * position):
 *     m x'' = m g - k x - c x',   c = 2 zeta sqrt(k m)
 * so the needle overshoots and rings down to x = m g / k.
 *
 * Unit factors are the course's: 1 lb = 4.448 N, 1 slug = 14.59 kg,
 * 1 ft = 0.3048 m, standard g = 9.81 m/s^2 = 32.2 ft/s^2. FPS force readings
 * are the SI weight converted with 4.448 N/lb; the FPS product m(slug)
 * g(ft/s^2) is also reported, and differs only in the 3rd-4th digit because
 * the factors themselves are rounded.
 *
 * Params (all modes): mode, units ('SI' | 'FPS'), g (m/s^2, overrides the
 * location), location ('earth' | 'ridge' | 'moon' | 'mars').
 *   compare:   mass (kg), standardMass (kg, defaults to mass), k (N/m),
 *              zeta, capacity (N, full-scale), label
 *   calibrate: k (N/m, hidden true stiffness), refMass (kg), capacity, tol
 *              (relative error allowed), marks
 *   rig:       survivorMass (kg), counterweightKg, v0 (m/s), targetG (m/s^2),
 *              tol (m/s^2), model ('atwood' | 'static'), ceiling (m)
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;

  // ---------------------------------------------------------------------
  // Pure physics
  // ---------------------------------------------------------------------

  var LBF = 4.448, SLUG = 14.59, FT = 0.3048;
  var G0 = 9.81, G0_FPS = 32.2;

  // gFPS uses the course's rounded values where it gives them (32.2, 5.30),
  // otherwise g / 0.3048.
  var LOCATIONS = [
    { key: 'earth', label: 'Earth (std)', g: 9.81, gFPS: 32.2 },
    { key: 'ridge', label: 'Mountain ridge', g: 9.775, gFPS: 9.775 / FT },
    { key: 'moon', label: 'Moon', g: 1.62, gFPS: 5.30 },
    { key: 'mars', label: 'Mars', g: 3.71, gFPS: 3.71 / FT }
  ];

  function location(key) {
    if (typeof key === 'number') return LOCATIONS[Math.max(0, Math.min(LOCATIONS.length - 1, Math.round(key)))];
    for (var i = 0; i < LOCATIONS.length; i++) if (LOCATIONS[i].key === key) return LOCATIONS[i];
    return LOCATIONS[0];
  }
  function locationIndex(key) { return LOCATIONS.indexOf(location(key)); }

  function weight(m, g) { return m * g; }
  function nToLb(N) { return N / LBF; }
  function lbToN(lb) { return lb * LBF; }
  function kgToSlug(kg) { return kg / SLUG; }
  function slugToKg(sl) { return sl * SLUG; }
  function msToFts(a) { return a / FT; }

  // Hooke's law for the scale spring: W = k x.
  function springExtension(W, k) { return W / k; }
  function springK(W, x) { return W / x; }
  function naturalFreq(m, k) { return Math.sqrt(k / m); }
  function dampingCoeff(m, k, zeta) { return 2 * zeta * Math.sqrt(k * m); }
  // Fractional overshoot of an underdamped step response (released from
  // rest at the unloaded position): exp(-zeta pi / sqrt(1 - zeta^2)).
  function overshootRatio(zeta) { return zeta >= 1 ? 0 : Math.exp(-zeta * Math.PI / Math.sqrt(1 - zeta * zeta)); }

  // One semi-implicit Euler step of m x'' = m g - k x - c v.
  function springStep(s, m, k, c, g, dt) {
    var a = g - (k * s.x + c * s.v) / m;
    var v = s.v + a * dt;
    return { x: s.x + v * dt, v: v, a: a };
  }

  // Ring-down energy relative to the static stretch; below `eps` counts as settled.
  function springSettled(s, m, k, g) {
    var xe = m * g / k;
    var E = 0.5 * m * s.v * s.v + 0.5 * k * (s.x - xe) * (s.x - xe);
    var ref = 0.5 * k * Math.max(xe * xe, 1e-8);
    return E / ref;
  }

  // Simulate the needle from (x0, v0) until it settles. Returns the settled
  // stretch, the peak stretch and the time taken.
  function simulateSpring(o) {
    var m = o.m, k = o.k, g = o.g, zeta = o.zeta == null ? 0.12 : o.zeta;
    var dt = o.dt || (1 / 240), tMax = o.tMax || 30, eps = o.eps || 1e-6;
    var c = dampingCoeff(m, k, zeta);
    var s = { x: o.x0 || 0, v: o.v0 || 0 }, t = 0, peak = s.x;
    while (t < tMax) {
      s = springStep(s, m, k, c, g, dt); t += dt;
      if (s.x > peak) peak = s.x;
      if (springSettled(s, m, k, g) < eps) break;
    }
    return { x: s.x, xEq: m * g / k, peak: peak, t: t, reading: k * s.x };
  }

  /*
   * Equal-arm beam balance. Pans hang at arm length L either side of the
   * knife edge; the beam's own centre of mass sits a distance d below it
   * (beam moment Mb d). Moments about the knife edge at tilt theta:
   *     (m1 - m2) g L cos(theta) = Mb g d sin(theta)
   * so tan(theta) = (m1 - m2) L / (Mb d). g cancels: a balance compares
   * masses and reads the same anywhere. Positive theta = left pan down.
   */
  function balanceTilt(m1, m2, opts) {
    opts = opts || {};
    var L = opts.L || 0.3, Mbd = opts.beamMoment || 0.05;
    return Math.atan((m1 - m2) * L / Mbd);
  }

  /*
   * Calibration from dial marks. Each mark pairs a needle position x (m)
   * with the weight the player wrote there. Least squares through the
   * origin for W = k x:   k = sum(W x) / sum(x^2).
   */
  function fitK(marks) {
    var sxx = 0, swx = 0;
    (marks || []).forEach(function (mk) { if (mk.x > 0) { sxx += mk.x * mk.x; swx += mk.W * mk.x; } });
    return sxx > 0 ? swx / sxx : null;
  }

  // Ideal Atwood machine: downward acceleration of the heavier side m.
  function atwoodAccel(m, mc, g) { return (m - mc) * g / (m + mc); }
  function atwoodTension(m, mc, g) { return 2 * m * mc * g / (m + mc); }
  // Offload estimate that ignores the counterweight's inertia.
  function staticOffloadAccel(m, mc, g) { return g * (m - mc) / m; }
  function effectiveAccel(m, mc, g, model) { return model === 'static' ? staticOffloadAccel(m, mc, g) : atwoodAccel(m, mc, g); }
  // Counterweight that gives a target effective acceleration.
  //   Atwood: a (m + mc) = (m - mc) g  =>  mc = m (g - a) / (g + a)
  //   static: mc = m (1 - a / g)
  function counterweightFor(m, aTarget, g, model) {
    return model === 'static' ? m * (1 - aTarget / g) : m * (g - aTarget) / (g + aTarget);
  }
  function jumpHeight(v0, a) { return a > 0 ? v0 * v0 / (2 * a) : Infinity; }
  function rigOutcome(a, target, tol) {
    if (Math.abs(a - target) <= tol) return 'moonlike';
    return a < target ? 'tooHeavy' : 'tooLight';
  }

  SE.physics = SE.physics || {};
  SE.physics.scales = {
    LBF: LBF, SLUG: SLUG, FT: FT, G0: G0, G0_FPS: G0_FPS, LOCATIONS: LOCATIONS,
    location: location, weight: weight, nToLb: nToLb, lbToN: lbToN, kgToSlug: kgToSlug, slugToKg: slugToKg, msToFts: msToFts,
    springExtension: springExtension, springK: springK, naturalFreq: naturalFreq, dampingCoeff: dampingCoeff,
    overshootRatio: overshootRatio, springStep: springStep, simulateSpring: simulateSpring,
    balanceTilt: balanceTilt, fitK: fitK,
    atwoodAccel: atwoodAccel, atwoodTension: atwoodTension, staticOffloadAccel: staticOffloadAccel,
    effectiveAccel: effectiveAccel, counterweightFor: counterweightFor, jumpHeight: jumpHeight, rigOutcome: rigOutcome
  };

  // ---------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------

  function sig(x, n) { return SE.sigfig.roundSig(x, n).text; }
  function fmtF(N, units) { return units === 'FPS' ? sig(nToLb(N), 4) + ' lb' : sig(N, 4) + ' N'; }
  function fmtM(kg, units) { return units === 'FPS' ? sig(kgToSlug(kg), 4) + ' slug' : sig(kg, 4) + ' kg'; }
  function fmtG(g, loc, units) {
    if (units === 'FPS') return sig(loc && Math.abs(loc.g - g) < 1e-12 ? loc.gFPS : msToFts(g), 4) + ' ft/s²';
    return sig(g, 4) + ' m/s²';
  }
  function readoutBox(ctx, x, y, lines) {
    if (SE.sceneUtil && SE.sceneUtil.readout) return SE.sceneUtil.readout(ctx, x, y, lines);
  }

  // ---------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------

  function Scales() {}

  Scales.prototype.init = function (stage, p) {
    this.stage = stage;
    this.p = Object.assign({
      mode: 'compare', units: 'SI', location: 'earth', g: null,
      mass: 12, standardMass: null, k: 600, zeta: 0.12, capacity: 300, label: 'BATTERY',
      refMass: 5, tol: 0.02, marks: [],
      survivorMass: 80, counterweightKg: 40, v0: 2.0, targetG: 1.62, rigTol: 0.15, model: 'atwood', ceiling: 2.3, rigG: 9.81
    }, p);
    if (this.p.mode === 'rig' && p && p.tol != null) this.p.rigTol = p.tol;
    this.marks = (this.p.marks || []).map(this.normMark, this);
    this.reset();
  };

  Scales.prototype.normMark = function (mk) {
    var p = this.p;
    var W = mk.W != null ? mk.W : mk.mass * (mk.g != null ? mk.g : this.g());
    var x = mk.x != null ? mk.x : mk.mass * (mk.g != null ? mk.g : this.g()) / p.k;
    return { x: x, W: W, mass: mk.mass };
  };

  Scales.prototype.g = function () {
    return this.p.g != null ? this.p.g : location(this.p.location).g;
  };
  Scales.prototype.hungMass = function () {
    return this.p.mode === 'calibrate' ? this.p.refMass : this.p.mass;
  };

  Scales.prototype.reset = function () {
    this.time = 0;
    this.state = 'idle';
    // spring: starts unloaded and is released at once, so the scene opens with
    // the needle ringing down to the first reading
    this.spring = { x: 0, v: 0, a: 0 };
    this.springLive = this.p.mode !== 'rig';
    this.calmTime = 0;
    this.peak = 0;
    this.pegged = false;
    this.tilt = 0; this.tiltV = 0;
    // rig
    this.ys = 0; this.vs = 0; this.maxY = 0; this.hitStop = false; this.jumpPhase = 'stand';
    this.trail = [];
    this.result = null;
  };

  Scales.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    var scale = this.p.mode === 'rig' ? Math.min(w / 9, (h - 70) / 5.8) : Math.min(w / 13.5, (h - 70) / 7);
    this.cam = new SE.Camera({ scale: scale, ox: w * 0.5, oy: h - 46 });
  };

  // --- public helpers for the calibrate mode ---------------------------
  Scales.prototype.setMarks = function (marks) { this.marks = (marks || []).map(this.normMark, this); };
  Scales.prototype.getMarks = function () { return this.marks.map(function (m) { return { x: m.x, W: m.W, mass: m.mass }; }); };
  // Pencil a mark at the needle's current position for the hung reference mass.
  Scales.prototype.markCurrent = function (W) {
    var mk = { x: this.spring.x, W: W != null ? W : this.p.refMass * this.g(), mass: this.p.refMass };
    this.marks.push(mk);
    SE.audio && SE.audio.play('click');
    return mk;
  };
  Scales.prototype.calK = function () {
    return this.p.mode === 'calibrate' ? fitK(this.marks) : this.p.k;
  };
  Scales.prototype.dialReading = function (x) {
    var k = this.calK();
    return k == null ? null : k * x;
  };
  Scales.prototype.fullX = function () { return this.p.capacity / this.p.k; };

  /*
   * run(opts):
   *   compare:   { location, mass, g, units, standardMass }  -> outcome 'settled' | 'overload'
   *   calibrate: { mass, g }  -> 'accurate' | 'miscalibrated' | 'uncalibrated' | 'overload'
   *   rig:       { counterweightKg, v0, survivorMass }  -> 'moonlike' | 'tooHeavy' | 'tooLight'
   */
  Scales.prototype.run = function (opts) {
    opts = opts || {};
    var self = this, p = this.p;
    if (typeof opts === 'number') opts = p.mode === 'rig' ? { counterweightKg: opts } : { mass: opts };
    if (this.resolve) { var old = this.resolve; this.resolve = null; old({ outcome: 'cancelled', detail: {} }); }
    if (p.mode === 'rig') {
      ['counterweightKg', 'v0', 'survivorMass'].forEach(function (k) { if (opts[k] != null) p[k] = opts[k]; });
      this.reset();
      this.state = 'running';
      this.jumpPhase = 'crouch';
      SE.audio && SE.audio.play('ratchet');
    } else {
      if (opts.location != null) { p.location = typeof opts.location === 'number' ? location(opts.location).key : opts.location; p.g = null; }
      if (opts.g != null) p.g = opts.g;
      if (opts.units) p.units = opts.units;
      if (opts.standardMass != null) p.standardMass = opts.standardMass;
      if (opts.mass != null) { if (p.mode === 'calibrate') p.refMass = opts.mass; else p.mass = opts.mass; }
      this.state = 'running';
      this.release();
    }
    this.time = 0;
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  // Let the spring move toward a new load from wherever it is now.
  Scales.prototype.release = function () {
    this.springLive = true; this.calmTime = 0; this.pegged = false;
    this.peak = this.spring.x;
    SE.audio && SE.audio.play('creak');
  };

  Scales.prototype.finish = function (outcome, detail) {
    this.result = { outcome: outcome, detail: detail };
    if (this.resolve) { var r = this.resolve; this.resolve = null; setTimeout(function () { r({ outcome: outcome, detail: detail }); }, 700); }
  };

  Scales.prototype.step = function (dt) {
    this.time += dt;
    if (this.p.mode === 'rig') return this.stepRig(dt);
    this.stepSpring(dt);
    this.stepBalance(dt);
  };

  Scales.prototype.stepSpring = function (dt) {
    if (!this.springLive) return;
    var p = this.p, m = this.hungMass(), g = this.g();
    var c = dampingCoeff(m, p.k, p.zeta);
    this.spring = springStep(this.spring, m, p.k, c, g, dt);
    var xf = this.fullX();
    if (this.spring.x >= xf) {
      // hard stop at the end of the rack
      if (!this.pegged && this.spring.v > 0.05) { SE.audio && SE.audio.play('clang'); this.stage.shake(4); }
      this.spring.x = xf; this.spring.v = Math.min(0, this.spring.v); this.pegged = true;
    }
    if (this.spring.x < 0) { this.spring.x = 0; this.spring.v = Math.max(0, this.spring.v); }
    this.peak = Math.max(this.peak, this.spring.x);
    var settled = this.pegged ? Math.abs(this.spring.v) < 1e-4 : springSettled(this.spring, m, p.k, g) < 1e-6;
    this.calmTime = settled ? this.calmTime + dt : 0;
    if (this.calmTime > 0.25 || this.time > 40) {
      this.springLive = false;
      if (!this.pegged) this.spring.x = m * g / p.k;   // snap the last sub-micron
      this.spring.v = 0;
      if (this.state === 'running') this.settleOutcome();
    }
  };

  Scales.prototype.settleOutcome = function () {
    var p = this.p, m = this.hungMass(), g = this.g(), W = m * g, x = this.spring.x;
    this.state = 'settled';
    var loc = location(p.location);
    var detail = {
      mass: m, g: g, W: W, x: x, peak: this.peak, overshoot: this.peak / (W / p.k) - 1,
      W_lb: nToLb(W), mass_slug: kgToSlug(m),
      W_lb_fps: kgToSlug(m) * (p.g == null ? loc.gFPS : msToFts(g)),
      units: p.units, location: p.g == null ? loc.key : null
    };
    if (p.mode === 'compare') {
      var std = p.standardMass != null ? p.standardMass : p.mass;
      detail.reading = this.pegged ? p.capacity : W;
      detail.readingUnits = p.units === 'FPS' ? nToLb(detail.reading) : detail.reading;
      detail.standardMass = std;
      detail.balanceTilt = balanceTilt(p.mass, std);
      detail.balanced = Math.abs(p.mass - std) < 1e-9;
      SE.audio && SE.audio.play(this.pegged ? 'fail' : 'beep');
      this.finish(this.pegged ? 'overload' : 'settled', detail);
    } else {
      var kc = fitK(this.marks);
      detail.k = p.k; detail.kCal = kc; detail.marks = this.getMarks();
      if (this.pegged) { SE.audio && SE.audio.play('fail'); return this.finish('overload', detail); }
      if (kc == null) { detail.reading = null; SE.audio && SE.audio.play('fail'); return this.finish('uncalibrated', detail); }
      detail.reading = kc * x;
      detail.readingUnits = p.units === 'FPS' ? nToLb(detail.reading) : detail.reading;
      detail.error = (detail.reading - W) / W;
      var good = Math.abs(detail.error) <= p.tol;
      SE.audio && SE.audio.play(good ? 'success' : 'fail');
      if (good) this.stage.flash('rgba(143,207,106,ALPHA)', 0.18, 0.3);
      this.finish(good ? 'accurate' : 'miscalibrated', detail);
    }
  };

  // Beam tilt eases toward its moment-balance angle (a lightly damped swing).
  Scales.prototype.stepBalance = function (dt) {
    if (this.p.mode !== 'compare') return;
    var p = this.p, std = p.standardMass != null ? p.standardMass : p.mass;
    var target = Math.max(-0.3, Math.min(0.3, balanceTilt(p.mass, std)));
    var w = 6, z = 0.25;
    var acc = -w * w * (this.tilt - target) - 2 * z * w * this.tiltV;
    this.tiltV += acc * dt; this.tilt += this.tiltV * dt;
  };

  Scales.prototype.rigAccel = function () {
    var p = this.p;
    return effectiveAccel(p.survivorMass, p.counterweightKg, p.rigG, p.model);
  };

  Scales.prototype.stepRig = function (dt) {
    if (this.state !== 'running') return;
    var p = this.p, a = this.rigAccel();
    if (this.jumpPhase === 'crouch') {
      if (this.time > 0.45) { this.jumpPhase = 'air'; this.vs = p.v0; SE.audio && SE.audio.play('whoosh'); this.stage.burst(this.cam.x(-0.45), this.cam.y(0), { n: 14, color: '#a08870', kind: 'dust', speed: 90, gravity: -20 }); }
      return;
    }
    // airborne with the rope taut: y'' = -a_eff (up positive)
    this.vs += -a * dt;
    this.ys += this.vs * dt;
    this.maxY = Math.max(this.maxY, this.ys);
    if (Math.floor(this.time * 30) !== Math.floor((this.time - dt) * 30)) { this.trail.push(this.ys); if (this.trail.length > 120) this.trail.shift(); }
    var done = false;
    if (this.ys >= p.ceiling) {
      this.ys = p.ceiling; this.maxY = p.ceiling; this.vs = 0; this.hitStop = true; done = true;
      this.stage.shake(8); SE.audio && SE.audio.play('clang');
      this.stage.burst(this.cam.x(-0.3), this.cam.y(p.ceiling + 1.8), { n: 18, color: '#ffd27a', speed: 220 });
    } else if (this.ys <= 0 && this.vs < 0) {
      var hit = this.vs; this.ys = 0; this.vs = 0; done = true;
      this.stage.shake(Math.min(10, 1 + Math.abs(hit) * 2));
      this.stage.burst(this.cam.x(-0.3), this.cam.y(0), { n: 18, color: '#a08870', kind: 'dust', speed: 110, gravity: -20 });
      SE.audio && SE.audio.play('thud');
    }
    if (done) {
      this.state = 'landed'; this.jumpPhase = 'stand';
      var outcome = rigOutcome(a, p.targetG, p.rigTol);
      SE.audio && SE.audio.play(outcome === 'moonlike' ? 'success' : 'fail');
      this.finish(outcome, {
        aEff: a, height: jumpHeight(p.v0, a), reached: this.maxY, hitStop: this.hitStop,
        target: p.targetG, tol: p.rigTol, model: p.model, survivorMass: p.survivorMass, counterweightKg: p.counterweightKg,
        tension: p.model === 'static' ? p.counterweightKg * p.rigG : atwoodTension(p.survivorMass, p.counterweightKg, p.rigG),
        idealCounterweight: counterweightFor(p.survivorMass, p.targetG, p.rigG, p.model),
        targetHeight: jumpHeight(p.v0, p.targetG)
      });
    }
  };

  // --- sandbox controls --------------------------------------------------
  Scales.prototype.controls = function () {
    var p = this.p;
    if (p.mode === 'rig') return [
      { key: 'counterweightKg', label: 'Counterweight', min: 0, max: 120, step: 0.5, value: p.counterweightKg, unit: 'kg' },
      { key: 'survivorMass', label: 'Survivor mass', min: 40, max: 120, step: 1, value: p.survivorMass, unit: 'kg' },
      { key: 'v0', label: 'Push-off speed', min: 0.5, max: 3.5, step: 0.1, value: p.v0, unit: 'm/s' }
    ];
    var c = [
      { key: 'location', label: 'Location (Earth/Ridge/Moon/Mars)', min: 0, max: 3, step: 1, value: locationIndex(p.location), unit: '' },
      { key: 'units', label: 'Units (0 SI, 1 FPS)', min: 0, max: 1, step: 1, value: p.units === 'FPS' ? 1 : 0, unit: '' }
    ];
    if (p.mode === 'compare') {
      c.unshift({ key: 'mass', label: 'Object mass', min: 1, max: 40, step: 0.5, value: p.mass, unit: 'kg' });
      c.push({ key: 'standardMass', label: 'Standard masses', min: 0, max: 40, step: 0.5, value: p.standardMass != null ? p.standardMass : p.mass, unit: 'kg' });
    } else {
      c.unshift({ key: 'refMass', label: 'Reference mass', min: 0.5, max: 25, step: 0.5, value: p.refMass, unit: 'kg' });
    }
    return c;
  };

  Scales.prototype.set = function (key, value) {
    var p = this.p;
    if (key === 'location') { p.location = location(+value).key; p.g = null; }
    else if (key === 'units') p.units = (value === 'FPS' || +value === 1) ? 'FPS' : 'SI';
    else p[key] = +value;
    if (p.mode !== 'rig' && (key === 'location' || key === 'mass' || key === 'refMass' || key === 'g')) this.release();
    if (p.mode === 'rig' && this.state !== 'running') { this.state = 'idle'; this.ys = 0; this.trail = []; }
  };

  // Clickable location tabs and units toggle along the top right.
  Scales.prototype.tabs = function () {
    var out = [], w = this.w || 800, x = w - 12, y = 12;
    if (this.p.mode === 'rig') return out;
    var u = { key: 'units', label: this.p.units === 'FPS' ? 'FPS' : 'SI', w: 46 };
    x -= u.w; u.x = x; u.y = y; out.push(u); x -= 10;
    for (var i = LOCATIONS.length - 1; i >= 0; i--) {
      var t = { key: 'location', index: i, label: LOCATIONS[i].label, w: 18 + LOCATIONS[i].label.length * 7.4 };
      x -= t.w; t.x = x; t.y = y; out.unshift(t); x -= 4;
    }
    return out;
  };

  Scales.prototype.pointer = function (evt) {
    if (evt.type !== 'pointerdown') return;
    var tabs = this.tabs();
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (evt.x >= t.x && evt.x <= t.x + t.w && evt.y >= t.y && evt.y <= t.y + 24) {
        if (t.key === 'units') this.set('units', this.p.units === 'FPS' ? 0 : 1);
        else this.set('location', t.index);
        SE.audio && SE.audio.play('click');
        return;
      }
    }
  };

  Scales.prototype.readouts = function () {
    var p = this.p, u = p.units, loc = location(p.location), g = this.g();
    if (p.mode === 'rig') {
      var a = this.rigAccel();
      return [
        'survivor m   ' + sig(p.survivorMass, 3) + ' kg',
        'counterwt mc ' + sig(p.counterweightKg, 3) + ' kg',
        'a_eff        ' + sig(a, 3) + ' m/s²  (target ' + sig(p.targetG, 3) + ')',
        'jump height  ' + (isFinite(jumpHeight(p.v0, a)) ? sig(jumpHeight(p.v0, a), 3) + ' m' : 'no landing')
      ];
    }
    var m = this.hungMass();
    var r = this.dialReading(this.spring.x);
    return [
      'location ' + (p.g == null ? loc.label : 'custom'),
      'g        ' + fmtG(g, p.g == null ? loc : null, u),
      'mass     ' + fmtM(m, u),
      'W = mg   ' + fmtF(m * g, u),
      'dial     ' + (r == null ? 'no marks yet' : fmtF(r, u))
    ];
  };

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  Scales.prototype.draw = function (ctx, w, h, t) {
    var p = this.p;
    if (!this.cam) this.resize(w, h);
    if (p.mode === 'rig') return this.drawRig(ctx, w, h, t);
    this.drawSky(ctx, w, h, t);
    var cam = this.cam;
    this.drawSpringScale(ctx, t, p.mode === 'calibrate' ? 0 : -3.1);
    if (p.mode === 'compare') this.drawBalance(ctx, 3.0);
    else this.drawCalibrationTable(ctx, w, h);
    this.drawTabs(ctx);
    readoutBox(ctx, 12, 12, this.readouts());
    if (p.mode === 'compare') {
      D.text(ctx, 'SPRING SCALE — reads force', cam.x(-3.1), cam.y(0) + 28, { align: 'center', color: C.paperDim, font: '600 12px "IBM Plex Mono", monospace' });
      D.text(ctx, 'BEAM BALANCE — compares mass', cam.x(3.0), cam.y(0) + 28, { align: 'center', color: C.paperDim, font: '600 12px "IBM Plex Mono", monospace' });
    }
  };

  Scales.prototype.drawSky = function (ctx, w, h, t) {
    var key = this.p.g == null ? location(this.p.location).key : 'earth';
    var gy = this.cam.y(0);
    if (key === 'earth' || key === 'ridge') {
      D.backdrop(ctx, w, h, t, key === 'ridge' ? { sky1: '#2c2a36', sky2: '#9a6a52' } : undefined);
      if (key === 'ridge') {
        ctx.save();
        ctx.fillStyle = 'rgba(30,26,30,0.92)';
        ctx.beginPath(); ctx.moveTo(0, gy);
        var r = D.rng(9);
        for (var x = 0; x <= w + 40; x += 40) ctx.lineTo(x, gy - h * 0.25 - r() * h * 0.2);
        ctx.lineTo(w, gy); ctx.closePath(); ctx.fill();
        D.text(ctx, 'ELEV. 3600 m — g a little lower', w - 14, gy - 10, { align: 'right', color: 'rgba(236,226,198,0.6)', font: '600 11px "IBM Plex Mono", monospace' });
        ctx.restore();
      }
      D.ground(ctx, w, gy, 60);
      D.fence(ctx, 0, gy, w * 0.18, 30);
      return;
    }
    var moon = key === 'moon';
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, moon ? '#05060a' : '#2a1610'); g.addColorStop(0.7, moon ? '#161822' : '#a4552e'); g.addColorStop(1, moon ? '#22242c' : '#5a2c18');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var rs = D.rng(moon ? 5 : 6);
    ctx.fillStyle = moon ? 'rgba(255,255,255,0.8)' : 'rgba(255,220,200,0.35)';
    for (var i = 0; i < (moon ? 90 : 30); i++) { var sx = rs() * w, sy = rs() * gy * 0.8, ss = rs() * 1.6 + 0.4; ctx.fillRect(sx, sy, ss, ss); }
    if (moon) {
      // Earth hanging in the black sky
      ctx.fillStyle = '#3d6fa8'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.2, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(143,207,106,0.6)'; ctx.beginPath(); ctx.arc(w * 0.8 - 6, h * 0.2 - 4, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(5,6,10,0.55)'; ctx.beginPath(); ctx.arc(w * 0.8 + 9, h * 0.2, 22, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,210,170,0.3)'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.3, 14, 0, Math.PI * 2); ctx.fill();
    }
    // horizon hills and ground
    ctx.fillStyle = moon ? '#3a3b42' : '#7a3a20';
    ctx.beginPath(); ctx.moveTo(0, gy);
    for (var x2 = 0; x2 <= w + 30; x2 += 30) ctx.lineTo(x2, gy - 18 - 14 * Math.sin(x2 * 0.013) - 8 * Math.sin(x2 * 0.041));
    ctx.lineTo(w, gy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = moon ? '#55565e' : '#8c4426'; ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, gy, w, 3);
    var rc = D.rng(17);
    for (var c = 0; c < 9; c++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(rc() * w, gy + 10 + rc() * 30, 10 + rc() * 24, 3 + rc() * 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
  };

  Scales.prototype.drawTabs = function (ctx) {
    var self = this, curr = locationIndex(this.p.location);
    this.tabs().forEach(function (tb) {
      var on = tb.key === 'units' || (self.p.g == null && tb.index === curr);
      ctx.save();
      ctx.fillStyle = on ? 'rgba(230,180,34,0.9)' : 'rgba(15,12,10,0.7)';
      D.roundRect(ctx, tb.x, tb.y, tb.w, 24, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(230,180,34,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = on ? C.night : C.paper;
      ctx.fillText(tb.label, tb.x + tb.w / 2, tb.y + 13);
      ctx.restore();
    });
  };

  // Spring scale hanging from a scrap gantry at world x = cx.
  Scales.prototype.drawSpringScale = function (ctx, t, cx) {
    var p = this.p, cam = this.cam, u = p.units;
    var top = 6.3, rackTop = 5.75, rackLen = 3.0, restLen = 0.35;
    var xf = this.fullX();
    // gantry
    ctx.save();
    ctx.fillStyle = D.rustPattern(ctx, C.rust, 5); ctx.strokeStyle = C.rustDark; ctx.lineWidth = 2;
    [-1.3, 1.3].forEach(function (dx) { ctx.fillRect(cam.x(cx + dx) - cam.len(0.09), cam.y(top + 0.25), cam.len(0.18), cam.len(top + 0.25)); });
    ctx.fillRect(cam.x(cx - 1.5), cam.y(top + 0.35), cam.len(3.0), cam.len(0.25));
    ctx.restore();
    D.hazardStripes(ctx, cam.x(cx - 1.5), cam.y(top + 0.1), cam.len(3.0), 5);
    // top shackle
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cam.x(cx), cam.y(top - 0.02), cam.len(0.08), 0, Math.PI * 2); ctx.stroke();
    // rack (graduated plate)
    var rx = cam.x(cx + 0.28), ry0 = cam.y(rackTop), rw = cam.len(0.5), rh = cam.len(rackLen);
    ctx.fillStyle = 'rgba(236,226,198,0.92)'; ctx.fillRect(rx, ry0, rw, rh);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.strokeRect(rx, ry0, rw, rh);
    var yForX = function (x) { return cam.y(rackTop - restLen - Math.min(1, x / xf) * rackLen * 0.92); };
    ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (p.mode === 'compare') {
      // factory graduations in the selected unit
      var capU = u === 'FPS' ? nToLb(p.capacity) : p.capacity;
      var stepU = niceStep(capU / 8);
      for (var f = 0; f <= capU + 1e-9; f += stepU / 2) {
        var N = u === 'FPS' ? lbToN(f) : f, yy = yForX(N / p.k), major = Math.abs(f / stepU - Math.round(f / stepU)) < 1e-6;
        ctx.strokeStyle = C.ink; ctx.lineWidth = major ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(rx, yy); ctx.lineTo(rx + (major ? 12 : 7), yy); ctx.stroke();
        if (major) { ctx.fillStyle = C.ink; ctx.fillText(sig(f, 3), rx + 14, yy); }
      }
      ctx.fillStyle = C.blood; ctx.fillText(u === 'FPS' ? 'lb' : 'N', rx + rw - 14, ry0 + 10);
    } else {
      // the player's pencil marks, then the fitted scale as faint ink
      var kc = fitK(this.marks);
      if (kc) {
        var maxW = kc * xf, stepW = niceStep((u === 'FPS' ? nToLb(maxW) : maxW) / 8);
        ctx.strokeStyle = 'rgba(23,58,94,0.5)'; ctx.setLineDash([3, 3]);
        for (var fw = stepW; fw <= (u === 'FPS' ? nToLb(maxW) : maxW); fw += stepW) {
          var Nw = u === 'FPS' ? lbToN(fw) : fw, y2 = yForX(Nw / kc);
          ctx.beginPath(); ctx.moveTo(rx + rw, y2); ctx.lineTo(rx + rw - 10, y2); ctx.stroke();
          ctx.fillStyle = 'rgba(23,58,94,0.7)'; ctx.textAlign = 'right'; ctx.fillText(sig(fw, 3), rx + rw - 12, y2);
        }
        ctx.setLineDash([]);
      }
      ctx.textAlign = 'left';
      this.marks.forEach(function (mk, i) {
        var y3 = yForX(mk.x);
        ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.6;
        D.sketchLine(ctx, rx, y3, rx + 16, y3, { passes: 2, wobble: 0.8, seed: i + 1 });
        ctx.fillStyle = '#3a3a3a'; ctx.fillText(fmtF(mk.W, u), rx + 18, y3);
      });
      if (!this.marks.length) { ctx.fillStyle = 'rgba(42,42,51,0.5)'; ctx.save(); ctx.translate(rx + rw / 2, ry0 + rh / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('BLANK — MARK ME', 0, 0); ctx.restore(); }
    }
    // spring coil
    var sy0 = cam.y(top - 0.1), sy1 = yForX(this.spring.x);
    var coils = 14, amp = cam.len(0.13), sx = cam.x(cx);
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(sx, sy0);
    var cTop = sy0 + 6, cBot = sy1 - 6;
    ctx.lineTo(sx, cTop);
    for (var i = 0; i <= coils * 2; i++) { var yy2 = cTop + (cBot - cTop) * i / (coils * 2); ctx.lineTo(sx + (i % 2 ? amp : -amp), yy2); }
    ctx.lineTo(sx, cBot); ctx.lineTo(sx, sy1); ctx.stroke();
    // pointer arm to the rack
    ctx.strokeStyle = C.bad; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(sx, sy1); ctx.lineTo(rx + 2, sy1); ctx.stroke();
    ctx.fillStyle = C.bad; ctx.beginPath(); ctx.moveTo(rx + 4, sy1); ctx.lineTo(rx - 4, sy1 - 5); ctx.lineTo(rx - 4, sy1 + 5); ctx.fill();
    // live dial value tag
    var r = this.dialReading(this.spring.x);
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    D.labelBox(ctx, r == null ? '?' : (this.pegged ? 'MAX ' : '') + fmtF(r, u), rx + rw + 50, sy1, this.pegged ? C.bad : C.hazard);
    // hook and load
    var hookY = sy1 + cam.len(0.25);
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy1); ctx.lineTo(sx, hookY - cam.len(0.1)); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, hookY, cam.len(0.1), -Math.PI * 0.5, Math.PI * 1.05); ctx.stroke();
    var m = this.hungMass();
    var side = cam.len(0.55 + 0.35 * Math.min(1, Math.sqrt(m / 25)));
    if (p.mode === 'calibrate') drawMassStack(ctx, sx, hookY + cam.len(0.12) + side * 0.8, side, m, u, true);
    else D.crate(ctx, sx - side / 2, hookY + cam.len(0.1) + side, side, side, { label: p.label });
    // vector: weight on the load
    if (m > 0) {
      var ly = hookY + cam.len(0.1) + side * 0.5;
      var Lpx = 30 + 60 * Math.min(1, m * this.g() / p.capacity);
      D.arrow(ctx, sx - side / 2 - 22, ly, sx - side / 2 - 22, ly + Lpx, C.weight, 'W', { lx: -10 });
    }
  };

  Scales.prototype.drawBalance = function (ctx, cx) {
    var p = this.p, cam = this.cam, u = p.units;
    var pivotY = 3.3, L = 1.7, th = this.tilt;
    var px = cam.x(cx), py = cam.y(pivotY);
    // stand
    ctx.fillStyle = C.iron;
    ctx.beginPath(); ctx.moveTo(px - cam.len(0.8), cam.y(0)); ctx.lineTo(px + cam.len(0.8), cam.y(0)); ctx.lineTo(px + cam.len(0.3), cam.y(0.25)); ctx.lineTo(px - cam.len(0.3), cam.y(0.25)); ctx.fill();
    ctx.fillStyle = D.rustPattern(ctx, C.steel, 8); ctx.fillRect(px - cam.len(0.08), py, cam.len(0.16), cam.y(0.25) - py);
    // pointer and scale arc
    ctx.strokeStyle = C.paperDim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, cam.len(0.9), Math.PI / 2 - 0.3, Math.PI / 2 + 0.3); ctx.stroke();
    for (var k = -3; k <= 3; k++) { var a = Math.PI / 2 + k * 0.1; ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * cam.len(0.85), py + Math.sin(a) * cam.len(0.85)); ctx.lineTo(px + Math.cos(a) * cam.len(k ? 0.95 : 1.0), py + Math.sin(a) * cam.len(k ? 0.95 : 1.0)); ctx.stroke(); }
    var balanced = Math.abs(th) < 0.004;
    ctx.strokeStyle = balanced ? C.good : C.bad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.sin(th) * cam.len(0.95), py + Math.cos(th) * cam.len(0.95)); ctx.stroke();
    // beam (left end down for positive tilt)
    var c = Math.cos(th), s = Math.sin(th);
    var lx = px - c * cam.len(L), ly = py + s * cam.len(L), rx = px + c * cam.len(L), ry = py - s * cam.len(L);
    ctx.strokeStyle = C.rustDark; ctx.lineWidth = cam.len(0.14);
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.strokeStyle = C.rustHi; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx, ly - 2); ctx.lineTo(rx, ry - 2); ctx.stroke();
    ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.moveTo(px, py - 3); ctx.lineTo(px - 7, py + 9); ctx.lineTo(px + 7, py + 9); ctx.fill();
    var std = p.standardMass != null ? p.standardMass : p.mass;
    [[lx, ly, 'obj'], [rx, ry, 'std']].forEach(function (e) {
      var hx = e[0], hy = e[1], panY = hy + cam.len(1.2), pw = cam.len(1.15);
      ctx.strokeStyle = 'rgba(216,210,196,0.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - pw / 2, panY); ctx.moveTo(hx, hy); ctx.lineTo(hx + pw / 2, panY); ctx.stroke();
      ctx.fillStyle = C.steel; ctx.beginPath(); ctx.ellipse(hx, panY, pw / 2, cam.len(0.08), 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.steelHi; ctx.stroke();
      if (e[2] === 'obj') {
        var side = cam.len(0.5 + 0.3 * Math.min(1, Math.sqrt(p.mass / 25)));
        D.crate(ctx, hx - side / 2, panY - 2, side, side, { label: '' });
        D.labelBox(ctx, fmtM(p.mass, u), hx, panY + 20, C.paper);
      } else {
        drawMassStack(ctx, hx, panY - 2, cam.len(0.55), std, u, false);
        D.labelBox(ctx, fmtM(std, u), hx, panY + 20, C.paper);
      }
    });
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    D.labelBox(ctx, balanced ? 'BALANCED' : (th > 0 ? 'OBJECT HEAVIER' : 'STANDARDS HEAVIER'), px, cam.y(pivotY + 0.7), balanced ? C.good : C.bad);
  };

  // Stack of standard masses (cylindrical weights) standing on (x, y), bottom.
  function drawMassStack(ctx, x, y, size, kg, units, hanging) {
    var parts = [], left = kg, denoms = [20, 10, 5, 2, 1, 0.5];
    for (var i = 0; i < denoms.length && parts.length < 7; i++) while (left >= denoms[i] - 1e-9 && parts.length < 7) { parts.push(denoms[i]); left -= denoms[i]; }
    if (left > 1e-6 && parts.length < 8) parts.push(left);
    var yy = y;
    ctx.save();
    if (hanging) {
      // one cast reference mass with a hook eye
      var hgt = size * 0.75, wd = size * 0.9;
      ctx.fillStyle = C.iron; D.roundRect(ctx, x - wd / 2, y - hgt, wd, hgt, 6); ctx.fill();
      ctx.strokeStyle = C.steelHi; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - hgt - 4, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.hazard; ctx.fillText(fmtM(kg, units), x, y - hgt / 2);
      ctx.restore();
      return;
    }
    parts.forEach(function (d) {
      var f = Math.sqrt(d / 20);
      var hgt = Math.max(4, size * 0.4 * f + 3), wd = size * (0.35 + 0.55 * f);
      ctx.fillStyle = d >= 5 ? '#585148' : '#8a8378';
      ctx.fillRect(x - wd / 2, yy - hgt, wd, hgt);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x - wd / 2, yy - hgt, wd, hgt);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x - wd / 2 + 2, yy - hgt + 1, wd - 4, 1.5);
      yy -= hgt;
    });
    ctx.restore();
  }

  function niceStep(raw) {
    var p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p10;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p10;
  }

  // Blueprint panel listing marks and the fit (calibrate mode).
  Scales.prototype.drawCalibrationTable = function (ctx, w, h) {
    var u = this.p.units, kc = fitK(this.marks);
    var x = w - 250, y = 50, bw = 236, rows = Math.min(8, this.marks.length);
    var bh = 84 + rows * 17;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.clip();
    D.blueprintGrid(ctx, w, h, 16);
    ctx.restore();
    ctx.strokeStyle = C.blueInk; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, bw, bh);
    var f = { color: C.blueInk, font: '600 12px "IBM Plex Mono", monospace' };
    D.text(ctx, 'CALIBRATION   W = k x', x + 10, y + 20, f);
    D.text(ctx, 'x (mm)     W (' + (u === 'FPS' ? 'lb' : 'N') + ')', x + 10, y + 40, { color: C.paperDim, font: f.font });
    this.marks.slice(-8).forEach(function (mk, i) {
      D.text(ctx, pad(sig(mk.x * 1000, 4), 10) + ' ' + sig(u === 'FPS' ? nToLb(mk.W) : mk.W, 4), x + 10, y + 58 + i * 17, f);
    });
    var kTxt = kc == null ? 'k = ?  (hang a mass, mark it)' : 'k = ' + (u === 'FPS' ? sig(nToLb(kc) * FT, 4) + ' lb/ft' : sig(kc, 4) + ' N/m');
    D.text(ctx, kTxt, x + 10, y + bh - 12, { color: C.hazard, font: f.font });
  };
  function pad(s, n) { while (s.length < n) s += ' '; return s; }

  Scales.prototype.drawRig = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam;
    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, cam.y(0), 60);
    D.fence(ctx, w * 0.75, cam.y(0), w * 0.25, 30);
    var topY = 4.9, half = 2.2;
    // frame
    ctx.save();
    ctx.fillStyle = D.rustPattern(ctx, C.rust, 5);
    [-half, half].forEach(function (sx) { ctx.fillRect(cam.x(sx) - cam.len(0.1), cam.y(topY + 0.3), cam.len(0.2), cam.len(topY + 0.3)); });
    ctx.fillRect(cam.x(-half - 0.2), cam.y(topY + 0.45), cam.len(2 * half + 0.4), cam.len(0.25));
    ctx.strokeStyle = 'rgba(122,52,24,0.9)'; ctx.lineWidth = 2;
    for (var k = 0; k < 3; k++) [-half, half].forEach(function (sx) { D.sketchLine(ctx, cam.x(sx), cam.y(topY * k / 3), cam.x(sx + (sx < 0 ? 0.5 : -0.5)), cam.y(topY * (k + 1) / 3), { passes: 1, wobble: 0.6 }); });
    ctx.restore();
    D.hazardStripes(ctx, cam.x(-half - 0.2), cam.y(topY + 0.2), cam.len(2 * half + 0.4), 5);
    // ceiling stop bar
    var stopY = p.ceiling + 1.85;
    ctx.fillStyle = C.iron; ctx.fillRect(cam.x(-1.1), cam.y(stopY) - 4, cam.len(0.9), 6);
    D.text(ctx, 'STOP', cam.x(-1.15), cam.y(stopY) + 2, { align: 'right', color: C.paperDim, font: '600 10px "IBM Plex Mono", monospace' });
    // pulley
    var pr = 0.32, pxL = -pr, pxR = pr, pY = topY - 0.2;
    var ang = -this.ys / pr;
    ctx.save(); ctx.translate(cam.x(0), cam.y(pY)); ctx.rotate(ang);
    ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(0, 0, cam.len(pr), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.iron; ctx.lineWidth = 3;
    for (var s = 0; s < 3; s++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(s * 2.094) * cam.len(pr), Math.sin(s * 2.094) * cam.len(pr)); ctx.stroke(); }
    ctx.restore();
    // survivor in harness (x = pxL), counterweight (x = pxR) moves opposite
    var crouch = this.jumpPhase === 'crouch' ? Math.sin(Math.min(1, this.time / 0.45) * Math.PI) * 0.15 : 0;
    var ys = this.ys, harnessY = ys + 1.15 - crouch;
    var cwBottom0 = 2.2, cwH = 0.25 + 0.9 * Math.min(1, p.counterweightKg / 100);
    var cwBottom = Math.max(0.02, cwBottom0 - ys);
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(cam.x(pxL), cam.y(pY)); ctx.lineTo(cam.x(pxL), cam.y(harnessY)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cam.x(pxR), cam.y(pY)); ctx.lineTo(cam.x(pxR), cam.y(cwBottom + cwH)); ctx.stroke();
    // trail
    ctx.fillStyle = 'rgba(106,208,255,0.35)';
    this.trail.forEach(function (y, i) { ctx.fillRect(cam.x(pxL - 0.9) + i * 0.6 - 1, cam.y(y) - 1, 3, 3); });
    var sh = cam.len(1.75);
    ctx.save();
    if (crouch) { ctx.translate(cam.x(pxL), cam.y(ys)); ctx.scale(1, 1 - crouch * 0.5); ctx.translate(-cam.x(pxL), -cam.y(ys)); }
    D.survivor(ctx, cam.x(pxL), cam.y(ys), sh, t);
    ctx.restore();
    // harness straps
    ctx.strokeStyle = C.hazard; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cam.x(pxL) - sh * 0.11, cam.y(ys) - sh * 0.4); ctx.lineTo(cam.x(pxL), cam.y(harnessY)); ctx.lineTo(cam.x(pxL) + sh * 0.11, cam.y(ys) - sh * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cam.x(pxL) - sh * 0.11, cam.y(ys) - sh * 0.38); ctx.lineTo(cam.x(pxL) + sh * 0.11, cam.y(ys) - sh * 0.38); ctx.stroke();
    // counterweight plates
    var plates = Math.max(1, Math.round(cwH / 0.12));
    for (var i = 0; i < plates; i++) {
      var y0 = cwBottom + i * cwH / plates;
      ctx.fillStyle = i % 2 ? '#4d4640' : '#5e564e';
      ctx.fillRect(cam.x(pxR - 0.3), cam.y(y0 + cwH / plates) , cam.len(0.6), cam.len(cwH / plates) - 1);
    }
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 1; ctx.strokeRect(cam.x(pxR - 0.3), cam.y(cwBottom + cwH), cam.len(0.6), cam.len(cwH));
    D.labelBox(ctx, sig(p.counterweightKg, 3) + ' kg', cam.x(pxR + 0.75), cam.y(cwBottom + cwH / 2), C.paper);
    // target height marker for a Moon jump
    var hT = jumpHeight(p.v0, p.targetG);
    if (hT < p.ceiling + 0.5) {
      ctx.strokeStyle = 'rgba(143,207,106,0.8)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cam.x(-half), cam.y(hT)); ctx.lineTo(cam.x(-0.6), cam.y(hT)); ctx.stroke(); ctx.setLineDash([]);
      D.text(ctx, 'Moon jump ' + sig(hT, 3) + ' m', cam.x(-half) + 6, cam.y(hT) - 6, { color: C.good, font: '600 11px "IBM Plex Mono", monospace' });
    }
    if (this.maxY > 0.01) D.dimLine(ctx, cam.x(pxL - 1.1), cam.y(0), cam.x(pxL - 1.1), cam.y(this.maxY), sig(this.maxY, 3) + ' m');
    // forces on the survivor: weight down, rope tension up
    var W = p.survivorMass * p.rigG, T = p.model === 'static' ? p.counterweightKg * p.rigG : atwoodTension(p.survivorMass, p.counterweightKg, p.rigG);
    var ax = cam.x(pxL) - sh * 0.45, ay = cam.y(ys + 0.9), sc = 70 / W;
    D.arrow(ctx, ax, ay, ax, ay + W * sc, C.weight, 'W', { lx: -14 });
    D.arrow(ctx, ax - 30, ay, ax - 30, ay - T * sc, C.force, 'T', { lx: -14 });
    readoutBox(ctx, 12, 12, this.readouts().concat(['a = (m − mc) g / (m + mc)']));
    if (this.result) {
      var o = this.result.outcome;
      ctx.font = '700 14px "IBM Plex Mono", monospace';
      D.labelBox(ctx, o === 'moonlike' ? 'MOON-LIKE' : o === 'tooHeavy' ? 'COUNTERWEIGHT TOO HEAVY' : 'COUNTERWEIGHT TOO LIGHT', w / 2, 30, o === 'moonlike' ? C.good : C.bad);
    }
  };

  SE.scenes.scales = Scales;
})(globalThis.SE);
