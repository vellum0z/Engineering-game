/*
 * Gravity scene: Newton's law of gravitation, from crate weights to planets.
 *
 * Physics:
 *   F = G m1 m2 / r^2                      (law of gravitation)
 *   g = G M / r^2                          (field of a spherical body at r >= R)
 *   W = m g                                (weight is just F with m2 = M)
 * so a crate lifted to twice the Earth's radius from the centre weighs a
 * quarter of what it does on the ground.
 *
 * Why g is not one number on the real Earth:
 *   1. Rotation. A point at latitude phi rides a circle of radius R cos(phi)
 *      around the axis, so part of gravity's pull is used up supplying the
 *      centripetal acceleration w^2 R cos(phi). That part is largest at the
 *      equator and zero at the poles, so the effective g is lowest at the
 *      equator.
 *   2. Shape. Rotation has flattened the planet: the equatorial radius is
 *      about 21 km larger than the polar one. The equator sits farther from
 *      the centre, and by 1/r^2 the pull there is weaker still.
 *   Both effects push the same way. The international gravity formula
 *   (GRS80 / WGS84 closed form) fits the combined result:
 *     g(phi) = 9.780327 (1 + 0.0053024 sin^2 phi - 0.0000058 sin^2 2phi)
 *   Climbing a height h above sea level drops g by about 3.086e-6 per metre
 *   (the free-air correction, the first-order term of GM/(R+h)^2).
 *
 * Modes (params.mode):
 *   'altitude' : weather drone lifts a crate on a spring scale, 0..40 000 km.
 *   'twobody'  : two masses, draggable separation, mutual force arrows.
 *   'spheres'  : two wrecking balls on cables pulled together by gravity.
 *   'site'     : globe with latitude marker, gLatitude / gSite and the split
 *                between rotation and shape.
 *
 * Params (all optional):
 *   mode, body ('earth' | 'moon' | 'mars'), crateMass (kg), altitude (km),
 *   m1, m2 (kg), r (m), rMax (m), ballMass (kg), ballMass2 (kg, defaults to
 *   ballMass), density (kg/m^3), gap (m, surface to surface), Lc (m, cable),
 *   latitude (deg), siteAltitude (m), label, units.
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;
  SE.physics = SE.physics || {};

  // ---------------------------------------------------------------- physics

  var G = 66.73e-12;                 // m^3/(kg s^2), the course value
  var OMEGA = 7.292115e-5;           // Earth's sidereal rotation rate, rad/s
  var STANDARD_G = 9.80665;          // conventional standard gravity, m/s^2
  var FREE_AIR = 3.086e-6;           // (m/s^2) lost per metre of height
  var BODIES = {
    earth: { name: 'Earth', M: 5.9722e24, R: 6.371e6, color: '#3f6f8f' },
    moon: { name: 'Moon', M: 7.342e22, R: 1.7374e6, color: '#8f8a80' },
    mars: { name: 'Mars', M: 6.4171e23, R: 3.3895e6, color: '#a5532e' }
  };
  var ALT_MAX_KM = 40000;
  var DEG = Math.PI / 180;

  function force(m1, m2, r) { return G * m1 * m2 / (r * r); }
  function gAt(M, r) { return G * M / (r * r); }

  // International gravity formula, sea level, latitude in degrees.
  function gLatitude(phiDeg) {
    var s = Math.sin(phiDeg * DEG), s2 = Math.sin(2 * phiDeg * DEG);
    return 9.780327 * (1 + 0.0053024 * s * s - 0.0000058 * s2 * s2);
  }

  // Sea-level formula plus the free-air drop for a site altitudeM above it.
  function gSite(phiDeg, altitudeM) { return gLatitude(phiDeg) - FREE_AIR * (altitudeM || 0); }

  // Centripetal acceleration of a point riding the spin: w^2 R cos(phi),
  // directed at the axis, not at the centre.
  function centripetal(phiDeg) { return OMEGA * OMEGA * BODIES.earth.R * Math.cos(phiDeg * DEG); }

  // Component of that acceleration along the local vertical (what a scale
  // actually loses): w^2 R cos^2(phi).
  function centripetalVertical(phiDeg) { var c = Math.cos(phiDeg * DEG); return OMEGA * OMEGA * BODIES.earth.R * c * c; }

  /*
   * How much heavier things get going from the equator to latitude phi, and
   * how that splits: the rotation part is the lost centripetal share that
   * comes back (w^2 R (1 - cos^2 phi)); what is left over is the shape part
   * (the surface getting closer to the centre, plus the mass redistribution
   * of the bulge).
   */
  function latitudeSplit(phiDeg) {
    var total = gLatitude(phiDeg) - gLatitude(0);
    var rotation = centripetalVertical(0) - centripetalVertical(phiDeg);
    return { total: total, rotation: rotation, shape: total - rotation };
  }

  function bodyOf(name) { return BODIES[name] || BODIES.earth; }

  // Field strength at a height above the surface of a body (metres).
  function gAltitude(bodyName, hM) { var b = bodyOf(bodyName); return gAt(b.M, b.R + hM); }

  // The altitude dial is logarithmic: 0..1000 maps to 0..40 000 km so that
  // the first kilometre gets as much travel as the last ten thousand.
  function altFromDial(s) {
    var k = Math.max(0, Math.min(1000, s)) / 1000;
    return Math.pow(10, k * Math.log10(ALT_MAX_KM + 1)) - 1;
  }
  function dialFromAlt(km) { return 1000 * Math.log10(1 + Math.max(0, km)) / Math.log10(ALT_MAX_KM + 1); }

  function sphereRadius(m, rho) { return Math.cbrt(3 * m / (4 * Math.PI * rho)); }

  /*
   * Two balls side by side on cables. Spheres attract as if their mass were
   * at their centres, so the centre distance d = R1 + R2 + gap. Each cable
   * swings in until tan(theta) = F / W; F is so small against W that
   * theta = F / W to many digits.
   */
  function spherePull(o) {
    var rho = o.density || 7850, g = o.g || STANDARD_G, L = o.Lc || 6;
    var m1 = o.m1, m2 = o.m2 == null ? o.m1 : o.m2;
    var R1 = sphereRadius(m1, rho), R2 = sphereRadius(m2, rho);
    var d = R1 + R2 + Math.max(0, o.gap || 0);
    var F = force(m1, m2, d);
    var W1 = m1 * g, W2 = m2 * g;
    var t1 = F / W1, t2 = F / W2;
    return {
      R1: R1, R2: R2, d: d, F: F, W1: W1, W2: W2, theta1: t1, theta2: t2,
      deflection1: L * Math.sin(t1), deflection2: L * Math.sin(t2), ratio1: F / W1, ratio2: F / W2
    };
  }

  SE.physics.gravity = {
    G: G, OMEGA: OMEGA, STANDARD_G: STANDARD_G, FREE_AIR: FREE_AIR, BODIES: BODIES,
    EARTH_MASS: BODIES.earth.M, EARTH_RADIUS: BODIES.earth.R,
    MOON_MASS: BODIES.moon.M, MOON_RADIUS: BODIES.moon.R,
    MARS_MASS: BODIES.mars.M, MARS_RADIUS: BODIES.mars.R,
    ALT_MAX_KM: ALT_MAX_KM,
    force: force, gAt: gAt, gLatitude: gLatitude, gSite: gSite, centripetal: centripetal,
    centripetalVertical: centripetalVertical, latitudeSplit: latitudeSplit, gAltitude: gAltitude,
    altFromDial: altFromDial, dialFromAlt: dialFromAlt, sphereRadius: sphereRadius, spherePull: spherePull
  };

  // ------------------------------------------------------------ formatting

  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sci(x, n, unit) {
    n = n || 3;
    var u = unit ? ' ' + unit : '';
    if (x === 0 || !isFinite(x)) return String(x) + u;
    var ax = Math.abs(x);
    if (ax >= 0.01 && ax < 1e5) return SE.sigfig.roundSig(x, n).text + u;
    var s = x.toExponential(n - 1).split('e');
    var ex = String(parseInt(s[1], 10)).split('').map(function (ch) { return SUP[ch]; }).join('');
    return s[0] + '×10' + ex + u;
  }
  function fmtF(N, units) {
    if (Math.abs(N) < 0.01 && N !== 0) return sci(N, 3, 'N');
    return SE.sceneUtil && SE.sceneUtil.fmtForce ? SE.sceneUtil.fmtForce(N, units) : sci(N, 4, 'N');
  }
  function fmtLen(m) {
    var a = Math.abs(m);
    if (a >= 1e3) return SE.sigfig.roundSig(m / 1e3, 4).text + ' km';
    if (a >= 0.1 || a === 0) return SE.sigfig.roundSig(m, 3).text + ' m';
    if (a >= 1e-3) return SE.sigfig.roundSig(m * 1e3, 3).text + ' mm';
    if (a >= 1e-6) return SE.sigfig.roundSig(m * 1e6, 3).text + ' µm';
    return SE.sigfig.roundSig(m * 1e9, 3).text + ' nm';
  }
  function fmtKm(km) { return km < 10 ? km.toFixed(km < 1 ? 3 : 2) + ' km' : Math.round(km).toLocaleString('en-US') + ' km'; }
  function readout(ctx, x, y, lines) {
    if (SE.sceneUtil && SE.sceneUtil.readout) return SE.sceneUtil.readout(ctx, x, y, lines);
  }
  function ease(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }

  // ---------------------------------------------------------------- scene

  function Gravity() {}

  Gravity.prototype.init = function (stage, p) {
    this.stage = stage;
    this.p = Object.assign({
      mode: 'altitude', body: 'earth', crateMass: 50, altitude: 0, label: 'SUPPLIES', units: 'SI',
      m1: 8, m2: 12, r: 0.8, rMax: 4,
      ballMass: 2000, ballMass2: null, density: 7850, gap: 0, Lc: 6,
      latitude: 45, siteAltitude: 0
    }, p);
    this.reset();
  };

  Gravity.prototype.reset = function () {
    var p = this.p;
    this.state = 'idle';
    this.time = 0;
    this.anim = null;
    this.resolve = null;
    this.drag = null;
    // altitude mode
    this.alt = Math.max(0, Math.min(ALT_MAX_KM, p.altitude)) * 1e3;    // m
    this.stretch = this.scaleTarget();                                  // spring stretch (fraction of surface reading)
    this.stretchV = 0;
    // two-body mode
    this.r = this.clampR(p.r);
    this.r0 = this.r;                     // reference separation for the ratio readout
    this.prediction = null;
    // spheres mode: cable angles (rad), start hanging plumb
    this.th1 = 0; this.th2 = 0; this.w1 = 0; this.w2 = 0;
    this.lat = Math.max(-90, Math.min(90, p.latitude));
  };

  Gravity.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    var m = this.p.mode, scale, ox, oy;
    if (m === 'twobody') { scale = Math.min(w * 0.78 / this.p.rMax, (h - 200) / 1.2); ox = w * 0.11; oy = h * 0.44; }
    else if (m === 'spheres') {
      var sp = this.sphereState();
      var span = this.p.Lc + 2 * Math.max(sp.R1, sp.R2) + 1;
      scale = Math.min((h - 70) / span, w * 0.5 / (sp.d + sp.R1 + sp.R2 + 2.4));
      ox = w * 0.3 - scale * sp.d / 2;
      oy = 40 + this.p.Lc * scale;          // world y = 0 at the ball centres, beam at y = Lc
    } else { scale = 1; ox = w * 0.3; oy = h - 70; }
    this.cam = new SE.Camera({ scale: scale, ox: ox, oy: oy });
  };

  // ---------------------------------------------------------- derived state

  Gravity.prototype.bodyG = function (hM) { return gAltitude(this.p.body, hM); };
  Gravity.prototype.scaleTarget = function () { return this.bodyG(this.alt) / this.bodyG(0); };
  Gravity.prototype.sphereState = function () {
    var p = this.p;
    return spherePull({ m1: p.ballMass, m2: p.ballMass2 == null ? p.ballMass : p.ballMass2, density: p.density, gap: p.gap, Lc: p.Lc, g: STANDARD_G });
  };
  Gravity.prototype.massRadius = function (m) { return sphereRadius(m, 7200); };   // cast-iron counterweights
  Gravity.prototype.clampR = function (r) {
    var p = this.p, rmin = this.massRadius(p.m1) + this.massRadius(p.m2);
    return Math.max(rmin, Math.min(p.rMax, r));
  };

  // ------------------------------------------------------------ controls

  Gravity.prototype.controls = function () {
    var p = this.p;
    switch (p.mode) {
      case 'twobody': return [
        { key: 'm1', label: 'mass m₁', min: 0.5, max: 500, step: 0.5, value: p.m1, unit: 'kg' },
        { key: 'm2', label: 'mass m₂', min: 0.5, max: 500, step: 0.5, value: p.m2, unit: 'kg' },
        { key: 'r', label: 'separation r', min: 0.1, max: p.rMax, step: 0.01, value: this.r, unit: 'm' }
      ];
      case 'spheres': return [
        { key: 'ballMass', label: 'ball mass', min: 100, max: 20000, step: 100, value: p.ballMass, unit: 'kg' },
        { key: 'gap', label: 'gap', min: 0, max: 3, step: 0.01, value: p.gap, unit: 'm' },
        { key: 'Lc', label: 'cable length', min: 1, max: 30, step: 0.5, value: p.Lc, unit: 'm' }
      ];
      case 'site': return [
        { key: 'latitude', label: 'latitude φ', min: -90, max: 90, step: 0.5, value: this.lat, unit: '°' },
        { key: 'siteAltitude', label: 'site altitude', min: 0, max: 9000, step: 10, value: p.siteAltitude, unit: 'm' }
      ];
      default: return [
        { key: 'altDial', label: 'altitude (log dial)', min: 0, max: 1000, step: 1, value: Math.round(dialFromAlt(this.alt / 1e3)), unit: '' },
        { key: 'crateMass', label: 'crate mass', min: 1, max: 500, step: 1, value: p.crateMass, unit: 'kg' }
      ];
    }
  };

  Gravity.prototype.set = function (key, v) {
    var p = this.p;
    v = Number(v);
    if (key === 'altDial') { this.alt = altFromDial(v) * 1e3; return; }
    if (key === 'altitude') { this.alt = Math.max(0, Math.min(ALT_MAX_KM, v)) * 1e3; return; }
    if (key === 'r') { this.r = this.clampR(v); return; }
    if (key === 'latitude') { this.lat = Math.max(-90, Math.min(90, v)); p.latitude = this.lat; return; }
    if (key === 'mode') { p.mode = String(v); this.reset(); if (this.w) this.resize(this.w, this.h); return; }
    p[key] = v;
    if (key === 'm1' || key === 'm2') this.r = this.clampR(this.r);
    if (key === 'ballMass' || key === 'ballMass2' || key === 'gap' || key === 'Lc' || key === 'density') {
      this.th1 = this.th2 = this.w1 = this.w2 = 0;
      if (this.w) this.resize(this.w, this.h);
    }
  };

  Gravity.prototype.readouts = function () {
    var p = this.p, u = p.units;
    if (p.mode === 'twobody') {
      var F = force(p.m1, p.m2, this.r), F0 = force(p.m1, p.m2, this.r0);
      return ['r = ' + fmtLen(this.r), 'F = ' + fmtF(F, u), 'F/F₀ = ' + SE.sigfig.roundSig(F / F0, 3).text + '  (r₀/r)² = ' + SE.sigfig.roundSig(Math.pow(this.r0 / this.r, 2), 3).text];
    }
    if (p.mode === 'spheres') {
      var s = this.sphereState();
      return ['d = ' + fmtLen(s.d), 'F = ' + fmtF(s.F, u), 'W = ' + fmtF(s.W1, u), 'F/W = ' + sci(s.ratio1), 'θ = ' + sci(s.theta1, 3, 'rad'), 'δ = ' + fmtLen(s.deflection1)];
    }
    if (p.mode === 'site') {
      var sp = latitudeSplit(this.lat);
      return ['g(φ) = ' + gLatitude(this.lat).toFixed(5) + ' m/s²', 'g site = ' + gSite(this.lat, p.siteAltitude).toFixed(5) + ' m/s²', 'rotation part ' + (sp.rotation * 1000).toFixed(2) + ' mm/s²', 'shape part ' + (sp.shape * 1000).toFixed(2) + ' mm/s²'];
    }
    var b = bodyOf(p.body), g = this.bodyG(this.alt);
    return ['h = ' + fmtKm(this.alt / 1e3), 'r = ' + fmtKm((b.R + this.alt) / 1e3), 'g = ' + SE.sigfig.roundSig(g, 4).text + ' m/s²', 'W = ' + fmtF(p.crateMass * g, u)];
  };

  // ------------------------------------------------------------- running

  /*
   * altitude: run({ targetAltitude (km), duration (s, default 4) })
   *           -> 'arrived', detail { altitude, r, g, g0, weight, ratio }
   * twobody:  run({ r (new separation, m), predicted (N, optional),
   *                 tolerance (relative, default 0.02), duration })
   *           -> 'correct' | 'wrong' when a prediction is given, else 'shown';
   *              detail { r0, r, F0, F, ratio, predicted, error }
   * spheres:  run({ duration (s, default 12) }) releases the balls from plumb
   *           and lets the cables swing to rest -> 'settled',
   *           detail { F, W1, W2, theta1, theta2, deflection1, deflection2, d }
   * site:     run() -> 'measured', detail { latitude, gLat, gSite, rotation, shape }
   */
  Gravity.prototype.run = function (opts) {
    opts = opts || {};
    var self = this, p = this.p;
    this.time = 0;
    this.state = 'running';
    var promise = new Promise(function (resolve) { self.resolve = resolve; });
    if (p.mode === 'twobody') {
      this.r0 = this.r;
      var to = opts.r != null ? this.clampR(opts.r) : this.clampR(this.r * 2);
      this.prediction = opts.predicted == null ? null : { value: opts.predicted, tol: opts.tolerance == null ? 0.02 : opts.tolerance };
      this.anim = { from: this.r, to: to, dur: opts.duration || 1.8 };
    } else if (p.mode === 'spheres') {
      this.th1 = this.th2 = this.w1 = this.w2 = 0;
      this.anim = { dur: opts.duration || 12 };
      SE.audio && SE.audio.play('creak');
    } else if (p.mode === 'site') {
      this.anim = { dur: 0.6 };
    } else {
      var target = opts.targetAltitude == null ? ALT_MAX_KM : Math.max(0, Math.min(ALT_MAX_KM, opts.targetAltitude));
      this.anim = { from: this.alt / 1e3, to: target, dur: opts.duration || 4 };
      SE.audio && SE.audio.play('whoosh');
    }
    return promise;
  };

  Gravity.prototype.finish = function (outcome, detail) {
    if (this.resolve) { var r = this.resolve; this.resolve = null; setTimeout(function () { r({ outcome: outcome, detail: detail }); }, 700); }
  };

  Gravity.prototype.step = function (dt) {
    var p = this.p;
    this.time += dt;
    if (p.mode === 'altitude') this.stepAltitude(dt);
    else if (p.mode === 'twobody') this.stepTwoBody(dt);
    else if (p.mode === 'spheres') this.stepSpheres(dt);
    else if (p.mode === 'site' && this.state === 'running' && this.time >= this.anim.dur) {
      this.state = 'done';
      var sp = latitudeSplit(this.lat);
      SE.audio && SE.audio.play('beep');
      this.finish('measured', { latitude: this.lat, gLat: gLatitude(this.lat), gSite: gSite(this.lat, p.siteAltitude), rotation: sp.rotation, shape: sp.shape });
    }
  };

  Gravity.prototype.stepAltitude = function (dt) {
    var p = this.p;
    if (this.state === 'running' && this.anim) {
      var a = this.anim, k = ease(this.time / a.dur);
      // interpolate in log space so the climb looks steady on the log dial
      var lf = Math.log10(1 + a.from), lt = Math.log10(1 + a.to);
      this.alt = (Math.pow(10, lf + (lt - lf) * k) - 1) * 1e3;
      if (this.time >= a.dur) {
        this.alt = a.to * 1e3;
        this.state = 'arrived';
        var b = bodyOf(p.body), g = this.bodyG(this.alt), g0 = this.bodyG(0);
        SE.audio && SE.audio.play('beep');
        this.finish('arrived', { altitude: a.to, r: b.R + this.alt, g: g, g0: g0, weight: p.crateMass * g, ratio: g / g0 });
      }
    }
    // the spring scale needle: a lightly damped spring chasing the true
    // reading, so the crate bobs as the load changes
    var target = this.scaleTarget();
    var acc = -60 * (this.stretch - target) - 7 * this.stretchV;
    this.stretchV += acc * dt;
    this.stretch += this.stretchV * dt;
  };

  Gravity.prototype.stepTwoBody = function () {
    if (this.state !== 'running' || !this.anim) return;
    var a = this.anim, p = this.p;
    this.r = a.from + (a.to - a.from) * ease(this.time / a.dur);
    if (this.time >= a.dur) {
      this.r = a.to;
      this.state = 'done';
      var F0 = force(p.m1, p.m2, this.r0), F = force(p.m1, p.m2, this.r);
      var det = { r0: this.r0, r: this.r, F0: F0, F: F, ratio: F / F0 };
      var outcome = 'shown';
      if (this.prediction) {
        det.predicted = this.prediction.value;
        det.error = (this.prediction.value - F) / F;
        outcome = Math.abs(det.error) <= this.prediction.tol ? 'correct' : 'wrong';
        this.prediction.result = outcome;
      }
      SE.audio && SE.audio.play(outcome === 'wrong' ? 'fail' : outcome === 'correct' ? 'success' : 'click');
      this.finish(outcome, det);
    }
  };

  /*
   * Each ball is a pendulum on a cable of length L, with the horizontal pull
   * F toward the other ball:
   *   m L th'' = -m g sin(th) + F cos(th) - c th'
   * Equilibrium is tan(th) = F / (m g). The damping is light and only there
   * so the run settles.
   */
  Gravity.prototype.stepSpheres = function (dt) {
    if (this.state !== 'running') return;
    var p = this.p, s = this.sphereState(), L = p.Lc, g = STANDARD_G;
    var m1 = p.ballMass, m2 = p.ballMass2 == null ? p.ballMass : p.ballMass2;
    var zeta = 0.9 * Math.sqrt(g / L);
    var a1 = -(g / L) * Math.sin(this.th1) + (s.F / (m1 * L)) * Math.cos(this.th1) - zeta * this.w1;
    var a2 = -(g / L) * Math.sin(this.th2) + (s.F / (m2 * L)) * Math.cos(this.th2) - zeta * this.w2;
    this.w1 += a1 * dt; this.th1 += this.w1 * dt;
    this.w2 += a2 * dt; this.th2 += this.w2 * dt;
    if (this.time >= this.anim.dur) {
      this.state = 'settled';
      SE.audio && SE.audio.play('stamp');
      this.finish('settled', {
        F: s.F, W1: s.W1, W2: s.W2, theta1: s.theta1, theta2: s.theta2, simTheta1: this.th1, simTheta2: this.th2,
        deflection1: s.deflection1, deflection2: s.deflection2, d: s.d, ratio: s.ratio1
      });
    }
  };

  // ------------------------------------------------------------- pointer

  Gravity.prototype.pointer = function (evt) {
    var p = this.p;
    if (!this.cam) return;
    if (evt.type === 'pointerup' || evt.type === 'pointerleave') { this.drag = null; return; }
    if (this.state === 'running') return;
    if (p.mode === 'twobody') {
      var mx = this.cam.x(this.r), my = this.cam.y(0);
      if (evt.type === 'pointerdown' && Math.hypot(evt.x - mx, evt.y - my) < 50) { this.drag = 'm2'; SE.audio && SE.audio.play('click'); }
      if (this.drag === 'm2' && (evt.type === 'pointermove' || evt.type === 'pointerdown')) this.r = this.clampR(this.cam.wx(evt.x));
    } else if (p.mode === 'altitude') {
      var L = this.altLayout();
      if (evt.type === 'pointerdown' && evt.x < L.sceneW) this.drag = 'alt';
      if (this.drag === 'alt') {
        var k = (L.ground - evt.y) / (L.ground - L.top);
        this.alt = altFromDial(1000 * Math.max(0, Math.min(1, k))) * 1e3;
      }
    } else if (p.mode === 'site') {
      var S = this.siteLayout();
      if (evt.type === 'pointerdown' && Math.hypot(evt.x - S.cx, evt.y - S.cy) < S.R * 1.3) this.drag = 'lat';
      if (this.drag === 'lat') {
        var dx = Math.abs(evt.x - S.cx), dy = S.cy - evt.y;
        this.set('latitude', Math.round(Math.atan2(dy, Math.max(dx, 1e-6)) / DEG * 2) / 2);
      }
    }
  };

  // ---------------------------------------------------------------- draw

  Gravity.prototype.draw = function (ctx, w, h, t) {
    var m = this.p.mode;
    if (m === 'twobody') this.drawTwoBody(ctx, w, h, t);
    else if (m === 'spheres') this.drawSpheres(ctx, w, h, t);
    else if (m === 'site') this.drawSite(ctx, w, h, t);
    else this.drawAltitude(ctx, w, h, t);
  };

  function stars(ctx, w, h, alpha) {
    var r = D.rng(99);
    ctx.save();
    for (var i = 0; i < 140; i++) {
      ctx.fillStyle = 'rgba(255,245,225,' + (alpha * (0.3 + r() * 0.7)).toFixed(3) + ')';
      var s = r() < 0.1 ? 2 : 1;
      ctx.fillRect(r() * w, r() * h, s, s);
    }
    ctx.restore();
  }

  Gravity.prototype.altLayout = function () {
    var w = this.w || 800, h = this.h || 500;
    var sceneW = Math.max(260, w * 0.56);
    return { sceneW: sceneW, ground: h - 70, top: 40, cx: sceneW * 0.55, gx: sceneW + 20, gy: 40, gw: w - sceneW - 36, gh: Math.min(h * 0.55, 300) };
  };
  Gravity.prototype.altY = function (km, L) {
    return L.ground - (L.ground - L.top) * Math.log10(1 + km) / Math.log10(1 + ALT_MAX_KM);
  };

  Gravity.prototype.drawAltitude = function (ctx, w, h, t) {
    var p = this.p, L = this.altLayout(), self = this, b = bodyOf(p.body);
    var km = this.alt / 1e3;
    // sky fading to space overhead
    D.backdrop(ctx, w, h, t, { still: true });
    var sg = ctx.createLinearGradient(0, 0, 0, h);
    sg.addColorStop(0, 'rgba(6,8,16,0.97)'); sg.addColorStop(0.55, 'rgba(12,12,22,0.75)'); sg.addColorStop(1, 'rgba(20,14,12,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    stars(ctx, w, h * 0.6, 0.9);

    // the planet as a big arc
    var bigR = w * 1.6;
    ctx.save();
    var pg = ctx.createRadialGradient(L.cx, L.ground + bigR, bigR * 0.9, L.cx, L.ground + bigR, bigR * 1.04);
    pg.addColorStop(0, b.color); pg.addColorStop(0.95, '#2a3a40'); pg.addColorStop(1, 'rgba(160,200,230,0.0)');
    ctx.fillStyle = 'rgba(140,190,230,0.12)';
    ctx.beginPath(); ctx.arc(L.cx, L.ground + bigR, bigR + 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = D.rustPattern(ctx, '#3a2f27', 11);
    ctx.beginPath(); ctx.arc(L.cx, L.ground + bigR, bigR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,180,120,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    D.fence(ctx, L.cx - 170, L.ground + 3, 110, 26);
    D.survivor(ctx, L.cx - 40, L.ground + 4, 34, t);

    // altitude ruler, log scale
    ctx.save();
    ctx.strokeStyle = C.blueInk; ctx.fillStyle = C.blueInk; ctx.lineWidth = 1;
    var rx = 46;
    D.sketchLine(ctx, rx, L.ground, rx, L.top, { wobble: 0.5, passes: 1 });
    [0, 1, 10, 100, 1000, 10000, 40000].forEach(function (k) {
      var y = self.altY(k, L);
      ctx.beginPath(); ctx.moveTo(rx - 5, y); ctx.lineTo(rx + 5, y); ctx.stroke();
      D.text(ctx, k >= 1000 ? (k / 1000) + 'k' : String(k), rx - 8, y + 4, { align: 'right', color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });
    });
    D.text(ctx, 'km', rx, L.top - 10, { align: 'center', color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });
    ctx.restore();
    // reference: one Earth radius above the surface (r = 2R, g/4)
    var y2R = this.altY(b.R / 1e3, L);
    ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(143,184,232,0.45)';
    ctx.beginPath(); ctx.moveTo(rx, y2R); ctx.lineTo(L.sceneW - 10, y2R); ctx.stroke(); ctx.restore();
    D.text(ctx, 'r = 2R  → g ÷ 4', L.sceneW - 14, y2R - 5, { align: 'right', color: C.blueInk, font: '600 11px "IBM Plex Mono", monospace' });

    // drone with spring scale and crate
    // the rig uses the same log mapping as the ruler, offset so the crate
    // just touches the ground at h = 0; a pointer on the ruler marks h
    var frac = Math.log10(1 + km) / Math.log10(1 + ALT_MAX_KM);
    var y0 = L.ground - 120, y1 = L.top + 30;
    var bob = km > 0.001 ? Math.sin(t * 2.2) * 2 : 0;
    var x = L.cx, y = y0 + (y1 - y0) * frac + bob;
    var crateTopY = y + 46 + 40 * this.stretch;
    var ay = this.altY(km, L);
    ctx.save(); ctx.fillStyle = C.force;
    ctx.beginPath(); ctx.moveTo(rx + 6, ay); ctx.lineTo(rx + 16, ay - 5); ctx.lineTo(rx + 16, ay + 5); ctx.closePath(); ctx.fill();
    ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,179,71,0.5)';
    ctx.beginPath(); ctx.moveTo(rx + 16, ay); ctx.lineTo(x - 60, y); ctx.stroke(); ctx.restore();
    ctx.save();
    // body
    ctx.fillStyle = D.rustPattern(ctx, C.steel, 4);
    D.roundRect(ctx, x - 34, y - 8, 68, 16, 5); ctx.fill();
    ctx.strokeStyle = C.iron; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.hazard; ctx.fillRect(x - 30, y - 3, 60, 3);
    // arms and rotors
    [-1, 1].forEach(function (sx) {
      ctx.strokeStyle = C.iron; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + sx * 30, y - 4); ctx.lineTo(x + sx * 52, y - 12); ctx.stroke();
      ctx.fillStyle = C.iron; ctx.fillRect(x + sx * 52 - 3, y - 18, 6, 8);
      var spin = Math.abs(Math.cos(t * 40 + sx));
      ctx.fillStyle = 'rgba(200,200,190,0.35)';
      ctx.beginPath(); ctx.ellipse(x + sx * 52, y - 19, 22 * spin + 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = (Math.floor(t * 2) % 2) ? C.bad : '#5a1d16';
    ctx.beginPath(); ctx.arc(x, y + 6, 2.5, 0, Math.PI * 2); ctx.fill();
    // spring scale: housing, spring, hook
    ctx.fillStyle = C.paperDim; ctx.fillRect(x - 6, y + 8, 12, 14);
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 2;
    var sTop = y + 22, sBot = crateTopY - 8, coils = 9;
    ctx.beginPath(); ctx.moveTo(x, sTop);
    for (var i = 1; i <= coils * 2; i++) ctx.lineTo(x + (i % 2 ? 7 : -7), sTop + (sBot - sTop) * i / (coils * 2));
    ctx.lineTo(x, sBot); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, crateTopY - 4, 4, -Math.PI * 0.2, Math.PI * 1.1); ctx.stroke();
    ctx.restore();
    D.crate(ctx, x - 22, crateTopY + 34, 44, 34, { label: '' });
    var g = this.bodyG(this.alt), W = p.crateMass * g;
    D.arrow(ctx, x + 40, crateTopY + 17, x + 40, crateTopY + 17 + 70 * Math.max(0.02, this.stretch), C.weight, 'W = ' + fmtF(W, p.units), { lx: 48, ly: 0 });

    // graph: g against r
    var G0 = this.bodyG(0), gx = L.gx, gy = L.gy, gw = L.gw, gh = L.gh;
    var rMaxR = (b.R + ALT_MAX_KM * 1e3) / b.R;
    ctx.save();
    ctx.fillStyle = 'rgba(15,30,50,0.85)'; D.roundRect(ctx, gx - 10, gy - 22, gw + 20, gh + 60, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.stroke();
    ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
    D.blueprintGrid(ctx, gx + gw + 2, gy + gh + 2, 20);
    ctx.restore();
    var X = function (rr) { return gx + gw * (rr - 1) / (rMaxR - 1); };
    var Y = function (gg) { return gy + gh - gh * gg / (G0 * 1.08); };
    ctx.save();
    ctx.strokeStyle = C.blueInk; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.stroke();
    ctx.strokeStyle = C.hazard; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j <= 120; j++) { var rr = 1 + (rMaxR - 1) * j / 120; var px = X(rr), py = Y(G0 / (rr * rr)); if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(143,184,232,0.6)'; ctx.lineWidth = 1;
    [2, 3].forEach(function (n) { ctx.beginPath(); ctx.moveTo(X(n), gy + gh); ctx.lineTo(X(n), Y(G0 / (n * n))); ctx.lineTo(gx, Y(G0 / (n * n))); ctx.stroke(); });
    ctx.setLineDash([]);
    var cr = (b.R + this.alt) / b.R, cpx = X(cr), cpy = Y(g);
    ctx.fillStyle = C.force; ctx.beginPath(); ctx.arc(cpx, cpy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    var f10 = '600 10px "IBM Plex Mono", monospace';
    D.text(ctx, 'g vs r   (g = GM/r²)', gx, gy - 7, { color: C.paper, font: '600 12px "IBM Plex Mono", monospace' });
    D.text(ctx, 'R', X(1), gy + gh + 14, { align: 'center', color: C.blueInk, font: f10 });
    D.text(ctx, '2R', X(2), gy + gh + 14, { align: 'center', color: C.blueInk, font: f10 });
    D.text(ctx, '3R', X(3), gy + gh + 14, { align: 'center', color: C.blueInk, font: f10 });
    D.text(ctx, SE.sigfig.roundSig(rMaxR, 3).text + 'R', X(rMaxR), gy + gh + 14, { align: 'right', color: C.blueInk, font: f10 });
    D.text(ctx, 'g₀/4', gx + 4, Y(G0 / 4) - 4, { color: C.blueInk, font: f10 });
    D.text(ctx, 'g₀/9', gx + 4, Y(G0 / 9) - 4, { color: C.blueInk, font: f10 });
    D.text(ctx, 'g/g₀ = ' + SE.sigfig.roundSig(g / G0, 3).text, gx + gw, gy + gh + 30, { align: 'right', color: C.force, font: '600 12px "IBM Plex Mono", monospace' });

    readout(ctx, gx - 10, gy + gh + 48, [
      'body   ' + b.name,
      'h      ' + fmtKm(km),
      'r      ' + fmtKm((b.R + this.alt) / 1e3),
      'g      ' + SE.sigfig.roundSig(g, 4).text + ' m/s²',
      'crate  ' + p.crateMass + ' kg  →  ' + fmtF(W, p.units)
    ]);
  };

  Gravity.prototype.drawTwoBody = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, self = this;
    D.backdrop(ctx, w, h, t, { still: true });
    ctx.save(); ctx.fillStyle = 'rgba(10,20,34,0.72)'; ctx.fillRect(0, 0, w, h); ctx.restore();
    D.blueprintGrid(ctx, w, h, 24);
    var F = force(p.m1, p.m2, this.r), F0 = force(p.m1, p.m2, this.r0);
    var yb = cam.y(0);
    var R1 = Math.max(12, cam.len(this.massRadius(p.m1))), R2 = Math.max(12, cam.len(this.massRadius(p.m2)));
    var x1 = cam.x(0), x2 = cam.x(this.r);
    // the masses: cast counterweights
    [[x1, R1, 'm₁ = ' + p.m1 + ' kg'], [x2, R2, 'm₂ = ' + p.m2 + ' kg']].forEach(function (b, i) {
      ctx.save();
      var gr = ctx.createRadialGradient(b[0] - b[1] * 0.35, yb - b[1] * 0.35, b[1] * 0.1, b[0], yb, b[1]);
      gr.addColorStop(0, C.steelHi); gr.addColorStop(1, C.iron);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(b[0], yb, b[1], 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = i ? C.hazard : C.rustDark; ctx.lineWidth = i && self.drag ? 3 : 1.5; ctx.stroke();
      ctx.restore();
      D.text(ctx, b[2], b[0], yb + b[1] + 20, { align: 'center' });
    });
    D.text(ctx, '⇆ drag', x2, yb - R2 - 12, { align: 'center', color: C.hazard, font: '600 11px "IBM Plex Mono", monospace' });
    // arrows: equal and opposite, length proportional to F against the
    // reference separation, so doubling r visibly quarters them
    var Lref = Math.min(150, (x2 - x1) * 0.45 + 60), len = Math.min(Lref * 2.5, Lref * F / F0);
    var lbl = 'F = ' + fmtF(F, p.units);
    D.arrow(ctx, x1 + R1, yb, x1 + R1 + len, yb, C.force, lbl, { ly: -14 });
    D.arrow(ctx, x2 - R2, yb, x2 - R2 - len, yb, C.force, null);
    D.dimLine(ctx, x1, yb + R1 + 48, x2, yb + R1 + 48, 'r = ' + fmtLen(this.r));

    // inverse-square strip: F/F0 against r/r0, marks at 2r0 and 3r0
    var sx = 40, sw = w - 80, sy = h - 130, sh = 90;
    ctx.save();
    ctx.fillStyle = 'rgba(15,30,50,0.85)'; D.roundRect(ctx, sx - 12, sy - 26, sw + 24, sh + 46, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.stroke();
    var kMax = Math.max(4, this.r / this.r0 * 1.1);
    var X = function (k) { return sx + sw * (k - 0.5) / (kMax - 0.5); };
    var Y = function (f) { return sy + sh - sh * Math.min(1.25, f) / 1.25; };
    ctx.strokeStyle = C.hazard; ctx.lineWidth = 2; ctx.beginPath();
    for (var i = 0; i <= 150; i++) { var k = 0.5 + (kMax - 0.5) * i / 150, yy = Y(1 / (k * k)); if (i) ctx.lineTo(X(k), yy); else ctx.moveTo(X(k), yy); }
    ctx.stroke();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(143,184,232,0.65)'; ctx.lineWidth = 1;
    [1, 2, 3].forEach(function (n) {
      ctx.beginPath(); ctx.moveTo(X(n), sy + sh); ctx.lineTo(X(n), Y(1 / (n * n))); ctx.stroke();
      D.text(ctx, (n === 1 ? 'r₀' : n + 'r₀') + ' → ' + (n === 1 ? 'F₀' : 'F₀/' + n * n), X(n) + 4, Y(1 / (n * n)) - 6, { color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });
    });
    ctx.setLineDash([]);
    var kk = this.r / this.r0;
    ctx.fillStyle = C.force; ctx.beginPath(); ctx.arc(X(kk), Y(F / F0), 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    D.text(ctx, 'F/F₀ = (r₀/r)²   double r → quarter F', sx, sy - 8, { color: C.paper, font: '600 12px "IBM Plex Mono", monospace' });

    var lines = [
      'G   = 66.73×10⁻¹² m³/(kg·s²)',
      'r₀  = ' + fmtLen(this.r0) + '   F₀ = ' + fmtF(F0, p.units),
      'r   = ' + fmtLen(this.r) + '   F  = ' + fmtF(F, p.units),
      'F/F₀ = ' + SE.sigfig.roundSig(F / F0, 3).text + '   r/r₀ = ' + SE.sigfig.roundSig(this.r / this.r0, 3).text
    ];
    if (this.prediction) {
      lines.push('predicted ' + fmtF(this.prediction.value, p.units) + (this.prediction.result ? '  ' + (this.prediction.result === 'correct' ? '✓ CHECKS' : '✗ OFF') : ''));
    }
    readout(ctx, 12, 12, lines);
  };

  Gravity.prototype.drawSpheres = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, s = this.sphereState(), L = p.Lc;
    D.backdrop(ctx, w, h, t);
    var gy = cam.y(-s.R1 * 2 - 0.4);
    D.ground(ctx, w, Math.min(h - 20, gy), 80);
    // beam
    var cxm = s.d / 2;
    var bx1 = cam.x(-s.R1 - 1.2), bx2 = cam.x(s.d + s.R2 + 1.2), by = cam.y(L);
    ctx.save();
    ctx.fillStyle = D.rustPattern(ctx, C.rust, 5);
    ctx.fillRect(bx1, by - 14, bx2 - bx1, 14);
    ctx.restore();
    D.hazardStripes(ctx, bx1, by - 18, bx2 - bx1, 4);
    // balls at true scale, cables at the current angle (invisible at this scale)
    var balls = [{ x0: 0, R: s.R1, th: this.state === 'idle' ? 0 : this.th1, dir: 1 }, { x0: s.d, R: s.R2, th: this.state === 'idle' ? 0 : this.th2, dir: -1 }];
    balls.forEach(function (b) {
      var bxw = b.x0 + b.dir * L * Math.sin(b.th);
      var px = cam.x(b.x0), py = by, ex = cam.x(bxw), ey = cam.y(L - L * Math.cos(b.th));
      ctx.save();
      ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey - cam.len(b.R)); ctx.stroke();
      var rr = cam.len(b.R);
      var gr = ctx.createRadialGradient(ex - rr * 0.35, ey - rr * 0.35, rr * 0.1, ex, ey, rr);
      gr.addColorStop(0, C.steelHi); gr.addColorStop(1, '#1c1916');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ex, ey, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.rustDark; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    });
    D.dimLine(ctx, cam.x(0), cam.y(-s.R1) - 14, cam.x(s.d), cam.y(-s.R1) - 14, 'd = ' + fmtLen(s.d));
    D.dimLine(ctx, bx1 - 12, by, bx1 - 12, cam.y(0), 'Lc = ' + fmtLen(L));
    D.text(ctx, 'true scale', cam.x(cxm), by - 26, { align: 'center', color: C.paperDim, font: '600 11px "IBM Plex Mono", monospace' });

    // magnifier inset with exaggerated angle
    var ix = w * 0.74, iy = h * 0.42, ir = Math.min(w * 0.22, h * 0.36);
    var thDisp = this.state === 'idle' ? s.theta1 : this.th1;
    var target = 0.16;                                      // displayed angle at equilibrium, rad
    var factor = target / s.theta1;
    ctx.save();
    ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,30,50,0.93)'; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = C.steel; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = C.hazard; ctx.stroke();
    ctx.clip();
    D.blueprintGrid(ctx, w, h, 16);
    var iscale = ir * 1.3 / (L + 2 * s.R1), ipx1 = ix - iscale * s.d / 2, ipx2 = ix + iscale * s.d / 2, ipy = iy - ir * 0.7;
    [[ipx1, 1, thDisp, s.R1], [ipx2, -1, this.state === 'idle' ? s.theta2 : this.th2, s.R2]].forEach(function (b) {
      var a = b[2] * factor, Lp = iscale * L;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(143,184,232,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b[0], ipy); ctx.lineTo(b[0], ipy + Lp + iscale * b[3]); ctx.stroke();
      ctx.setLineDash([]);
      var ex = b[0] + b[1] * Lp * Math.sin(a), ey = ipy + Lp * Math.cos(a);
      ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(b[0], ipy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(ex + b[1] * iscale * b[3] * Math.sin(a), ey + iscale * b[3] * Math.cos(a), Math.max(6, iscale * b[3]), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.force; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b[0], ipy, Lp * 0.3, Math.PI / 2, Math.PI / 2 - b[1] * a, b[1] > 0); ctx.stroke();
    });
    ctx.restore();
    D.text(ctx, 'MAGNIFIER  angle × ' + sci(factor, 2), ix, iy - ir - 10, { align: 'center', color: C.hazard, font: '600 12px "IBM Plex Mono", monospace' });
    D.text(ctx, 'θ = ' + sci(s.theta1, 3, 'rad') + '   δ = ' + fmtLen(s.deflection1), ix, iy + ir + 20, { align: 'center', color: C.paper, font: '600 12px "IBM Plex Mono", monospace' });

    readout(ctx, 12, 12, [
      'ball m  ' + p.ballMass + (p.ballMass2 != null && p.ballMass2 !== p.ballMass ? ' / ' + p.ballMass2 : '') + ' kg   R ' + fmtLen(s.R1),
      'gap     ' + fmtLen(p.gap) + '   d = ' + fmtLen(s.d),
      'F       ' + fmtF(s.F, p.units),
      'W       ' + fmtF(s.W1, p.units),
      'F/W     ' + sci(s.ratio1, 3),
      'θ ≈ F/W ' + sci(s.theta1, 3, 'rad'),
      'δ = Lθ  ' + fmtLen(s.deflection1)
    ]);
  };

  Gravity.prototype.siteLayout = function () {
    var w = this.w || 800, h = this.h || 500, R = Math.min(w * 0.24, h * 0.36);
    return { cx: w * 0.32, cy: h * 0.52, R: R };
  };

  Gravity.prototype.drawSite = function (ctx, w, h, t) {
    var p = this.p, S = this.siteLayout(), phi = this.lat * DEG;
    D.backdrop(ctx, w, h, t, { still: true });
    ctx.save(); ctx.fillStyle = 'rgba(6,8,16,0.85)'; ctx.fillRect(0, 0, w, h); ctx.restore();
    stars(ctx, w, h, 0.7);
    // globe cross-section, flattening drawn x20 so it shows (true f = 1/298)
    var f = 20 / 298.257, Rx = S.R, Ry = S.R * (1 - f);
    ctx.save();
    var gr = ctx.createRadialGradient(S.cx - Rx * 0.3, S.cy - Ry * 0.3, Rx * 0.1, S.cx, S.cy, Rx);
    gr.addColorStop(0, '#4f7f9e'); gr.addColorStop(1, '#16283a');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(S.cx, S.cy, Rx, Ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.blueInk; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(143,184,232,0.3)'; ctx.lineWidth = 1;
    for (var la = -60; la <= 60; la += 30) { var yy = S.cy - Ry * Math.sin(la * DEG); var xx = Rx * Math.cos(la * DEG); ctx.beginPath(); ctx.moveTo(S.cx - xx, yy); ctx.lineTo(S.cx + xx, yy); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(S.cx, S.cy, Rx * 0.45, Ry, 0, 0, Math.PI * 2); ctx.stroke();
    // spin axis
    ctx.setLineDash([6, 5]); ctx.strokeStyle = C.paperDim;
    ctx.beginPath(); ctx.moveTo(S.cx, S.cy - Ry - 30); ctx.lineTo(S.cx, S.cy + Ry + 30); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    var spinA = t * 1.2;
    ctx.save(); ctx.strokeStyle = C.paperDim; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(S.cx, S.cy - Ry - 22, 16, 5, 0, spinA % (Math.PI * 2), spinA % (Math.PI * 2) + 4.5); ctx.stroke(); ctx.restore();
    D.text(ctx, 'ω', S.cx + 20, S.cy - Ry - 26, { color: C.paperDim });
    // marker on the right limb
    var mx = S.cx + Rx * Math.cos(phi), my = S.cy - Ry * Math.sin(phi);
    ctx.save(); ctx.strokeStyle = C.hazard; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(S.cx, S.cy); ctx.lineTo(mx, my); ctx.stroke();
    ctx.beginPath(); ctx.arc(S.cx, S.cy, 34, 0, -phi, phi > 0); ctx.stroke();
    ctx.restore();
    D.text(ctx, 'φ = ' + this.lat.toFixed(1) + '°', S.cx + 40, S.cy - 6 - 10 * Math.sign(this.lat), { color: C.hazard, font: '600 11px "IBM Plex Mono", monospace' });
    D.survivor(ctx, mx + 2, my, 18, t);
    // gravity toward the centre, centripetal toward the axis
    var gL = 80, cpL = 80 * centripetal(this.lat) / centripetal(0) * 0.6;
    D.arrow(ctx, mx, my, mx - gL * Math.cos(phi), my + gL * Math.sin(phi), C.weight, 'g');
    if (cpL > 2) D.arrow(ctx, mx, my, mx - cpL, my, C.accel, 'ω²R cos φ', { ly: -16 });
    D.text(ctx, 'flattening drawn ×20', S.cx, S.cy + Ry + 50, { align: 'center', color: C.blueInk, font: '600 10px "IBM Plex Mono", monospace' });

    // bars: equator value plus the rotation and shape contributions
    var sp = latitudeSplit(this.lat), g0 = gLatitude(0);
    var bx = w * 0.64, bw = Math.min(70, w * 0.08), base = h * 0.82, top = h * 0.18, full = latitudeSplit(90).total;
    var kpx = (base - top) / (full * 1.15);
    ctx.save();
    ctx.fillStyle = 'rgba(15,30,50,0.85)'; D.roundRect(ctx, bx - 20, top - 30, w * 0.34, base - top + 64, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.stroke();
    ctx.fillStyle = C.accel; ctx.fillRect(bx, base - sp.rotation * kpx, bw, sp.rotation * kpx);
    ctx.fillStyle = C.rot; ctx.fillRect(bx, base - sp.total * kpx, bw, sp.shape * kpx);
    ctx.strokeStyle = C.paper; ctx.strokeRect(bx, base - full * kpx, bw, full * kpx);
    ctx.restore();
    var f11 = '600 11px "IBM Plex Mono", monospace';
    D.text(ctx, 'g − g(equator)', bx - 8, top - 12, { color: C.paper, font: '600 12px "IBM Plex Mono", monospace' });
    D.text(ctx, 'rotation ' + (sp.rotation * 1000).toFixed(2) + ' mm/s²', bx + bw + 10, base - sp.rotation * kpx / 2, { color: C.accel, font: f11 });
    D.text(ctx, 'shape    ' + (sp.shape * 1000).toFixed(2) + ' mm/s²', bx + bw + 10, base - sp.rotation * kpx - sp.shape * kpx / 2 - 12, { color: C.rot, font: f11 });
    D.text(ctx, 'pole ' + (full * 1000).toFixed(1), bx + bw + 10, base - full * kpx + 4, { color: C.paperDim, font: f11 });
    D.text(ctx, 'equator ' + g0.toFixed(6) + ' m/s²', bx - 8, base + 20, { color: C.paperDim, font: f11 });

    readout(ctx, 12, 12, [
      'latitude      ' + this.lat.toFixed(1) + '°',
      'g sea level   ' + gLatitude(this.lat).toFixed(5) + ' m/s²',
      'site alt      ' + Math.round(p.siteAltitude) + ' m',
      'g site        ' + gSite(this.lat, p.siteAltitude).toFixed(5) + ' m/s²',
      'standard g    ' + STANDARD_G + ' m/s²',
      'ω²R cos φ     ' + (centripetal(this.lat) * 1000).toFixed(2) + ' mm/s²'
    ]);
  };

  SE.scenes.gravity = Gravity;
})(globalThis.SE);
