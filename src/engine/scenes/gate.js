/*
 * Gate scene: what characterizes a force, and when the idealizations hold.
 *
 * Two modes share this file.
 *
 * Mode 'gate' (top-down): the settlement's barricade gate, hinged at one end.
 * The gate is a rigid bar of length L and mass m turning about the hinge:
 *   moment of inertia about the hinge   I = m L^2 / 3
 *   torque of a push F at distance d, at angle theta to the gate
 *                                       tau = F d sin(theta)
 *   angular acceleration                alpha = tau_net / I
 * Only the component of F perpendicular to the gate turns it; a push along
 * the gate (theta = 0) goes straight into the hinge pin. The horde pushes
 * the gate open with force H (perpendicular) at distance dh. Coulomb hinge
 * friction tau_f resists motion and holds the gate still while
 * |tau_net| <= tau_f.
 *
 * Angle convention: phi is the opening angle (0 = shut against the jamb,
 * positive = swung inward toward the settlement). Torques are signed in
 * the phi sense: the horde's torque is +H dh, the player's is
 * -F d sin(theta), with theta measured from the hinge-to-tip direction
 * toward the outside, so theta = +90 deg pushes the gate shut.
 *
 * Mode 'beam' (side view): a cantilever bolted to a wall with a tip load P.
 *   second moment of area (rectangle b x h)   I = b h^3 / 12
 *   tip deflection                            delta = P L^3 / (3 E I)
 *   deflected shape                           y(x) = P x^2 (3L - x) / (6 E I)
 *   bending stress at the root                sigma = M c / I, M = P L, c = h/2
 * A steel beam barely moves, so treating it as rigid is fair; rubber does
 * not. A load spread over a contact patch of length c_len is integrated by
 * superposition of point loads, so the error of the "concentrated force"
 * model can be read off against the ratio c_len / L.
 *
 * Params (gate): L, mass, angle0 (deg), F, d, theta (deg), H, dh,
 *   friction (N m), openAngle (deg), slamSpeed (m/s at the tip), Fmax,
 *   pusher ('hand' | 'ram'), zombies, units.
 * Params (beam): material, L, b, h (m), P (N), yieldStrength (Pa, null =
 *   material value), patch ('none' | 'pallet' | 'sandbag' | 'wheel'),
 *   contact (m, null = preset length), concentratedTol, rigidTol, sagLimit,
 *   rampTime (s), units.
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;
  var DEG = Math.PI / 180;

  // ------------------------------------------------------------ physics

  var MATERIALS = {
    steel:     { name: 'steel',     E: 200e9, yield: 250e6, color: '#8d8a84', edge: '#4c4945' },
    aluminium: { name: 'aluminium', E: 70e9,  yield: 270e6, color: '#c4c8cc', edge: '#7c8186' },
    timber:    { name: 'timber',    E: 11e9,  yield: 40e6,  color: '#8a5a33', edge: '#5e3a1e' },
    rubber:    { name: 'rubber',    E: 0.01e9, yield: 15e6, color: '#2e2b2a', edge: '#121010' }
  };
  var MATERIAL_ORDER = ['steel', 'aluminium', 'timber', 'rubber'];

  // Typical contact lengths (m) of loads resting on a beam.
  var PATCHES = {
    none:    { name: 'point load', len: 0 },
    pallet:  { name: 'pallet', len: 1.2 },
    sandbag: { name: 'sandbag', len: 0.6 },
    wheel:   { name: 'wheel on rail', len: 0.015 }
  };

  function gateInertia(m, L) { return m * L * L / 3; }
  function torque(F, d, theta) { return F * d * Math.sin(theta); }
  function perpComponent(F, theta) { return F * Math.sin(theta); }
  function alongComponent(F, theta) { return F * Math.cos(theta); }

  // Signed torques in the opening (phi) sense, before friction.
  function gateTorques(q) {
    var tauP = -torque(q.F, q.d, q.theta);
    var tauH = q.H * q.dh;
    return { player: tauP, horde: tauH, net: tauP + tauH };
  }

  /*
   * One semi-implicit Euler step of the gate. s = { phi, omega },
   * q = { I, net, friction }. Mutates s, returns s.alpha.
   * Coulomb friction: static while |net| <= friction, otherwise a constant
   * torque opposing the motion. The velocity is not allowed to reverse
   * through zero inside one step (the gate sticks instead).
   */
  function gateStep(s, q, dt) {
    var net = q.net, f = q.friction || 0, a;
    if (Math.abs(s.omega) < 1e-9) {
      if (Math.abs(net) <= f) { s.omega = 0; s.alpha = 0; return 0; }
      a = (net - Math.sign(net) * f) / q.I;
    } else {
      a = (net - Math.sign(s.omega) * f) / q.I;
    }
    var w0 = s.omega, w1 = w0 + a * dt;
    if (w0 !== 0 && Math.sign(w1) !== Math.sign(w0) && Math.abs(net) <= f) w1 = 0;
    s.omega = w1;
    s.phi += w1 * dt;
    s.alpha = a;
    return a;
  }

  function gateQ(p) {
    var t = gateTorques({ F: p.F, d: p.d, theta: p.theta * DEG, H: p.H, dh: p.dh });
    return { I: gateInertia(p.mass, p.L), net: t.net, player: t.player, horde: t.horde, friction: p.friction };
  }

  /*
   * Checks the gate state against the jamb and the open limit.
   * Returns null while the gate is still swinging free.
   */
  function gateEvent(s, p) {
    if (s.phi <= 0 && s.omega < 0) {
      var tip = -s.omega * p.L;
      return { outcome: tip > p.slamSpeed ? 'slammed' : 'closed', tipSpeed: tip };
    }
    if (s.phi <= 0 && s.omega === 0) return { outcome: 'closed', tipSpeed: 0 };
    if (s.phi >= p.openAngle * DEG) return { outcome: 'opened', tipSpeed: s.omega * p.L };
    return null;
  }

  // Headless simulation with the scene's own stepper and fixed step.
  function simulateGate(params, duration, dt) {
    var p = Object.assign({}, GATE_DEFAULTS, params);
    dt = dt || SE.PHYS_DT || 1 / 240;
    duration = duration || 6;
    var q = gateQ(p);
    var s = { phi: p.angle0 * DEG, omega: 0, alpha: 0 };
    var n = Math.round(duration / dt);
    for (var i = 0; i < n; i++) {
      gateStep(s, q, dt);
      var ev = gateEvent(s, p);
      if (ev) {
        var om = s.omega;
        if (ev.outcome !== 'opened') s.phi = 0;
        return { outcome: ev.outcome, detail: { omega: om, angle: s.phi / DEG, tipSpeed: ev.tipSpeed, time: (i + 1) * dt, torque: q.net, alpha: s.alpha } };
      }
    }
    return { outcome: 'held', detail: { omega: s.omega, angle: s.phi / DEG, time: duration, torque: q.net, alpha: s.alpha } };
  }

  function secondMoment(b, h) { return b * h * h * h / 12; }
  function tipDeflection(P, L, E, I) { return P * L * L * L / (3 * E * I); }
  function deflection(x, P, L, E, I) { return P * x * x * (3 * L - x) / (6 * E * I); }
  function slope(x, P, L, E, I) { return P * x * (2 * L - x) / (2 * E * I); }
  function rootStress(P, L, h, I) { return P * L * (h / 2) / I; }
  function contactRatio(contact, length) { return length > 0 ? contact / length : Infinity; }

  // Deflection and slope at x from a point load P at position a (0..L).
  function pointLoadAt(x, a, P, E, I) {
    if (x <= a) return { y: P * x * x * (3 * a - x) / (6 * E * I), s: P * x * (2 * a - x) / (2 * E * I) };
    return { y: P * a * a * (3 * x - a) / (6 * E * I), s: P * a * a / (2 * E * I) };
  }

  /*
   * Beam state for total load P spread uniformly over the last c metres
   * (c = 0 gives the tip point load). Superposition of point loads,
   * integrated with the midpoint rule; the tip deflection uses the closed
   * form w/(6EI) [L a^3 - a^4/4] evaluated from L-c to L.
   */
  function spreadLoad(P, L, E, I, c) {
    c = Math.max(0, Math.min(L, c || 0));
    var a1 = L - c;
    var tip = c < 1e-9 ? tipDeflection(P, L, E, I)
      : (P / c) / (6 * E * I) * ((0.75 * L * L * L * L) - (L * a1 * a1 * a1 - a1 * a1 * a1 * a1 / 4));
    var moment = P * (L - c / 2);
    return {
      tip: tip, moment: moment, a1: a1,
      at: function (x) {
        if (c < 1e-9) return { y: deflection(x, P, L, E, I), s: slope(x, P, L, E, I) };
        var N = 48, y = 0, s = 0, dp = P / N;
        for (var k = 0; k < N; k++) {
          var r = pointLoadAt(x, a1 + (k + 0.5) * c / N, dp, E, I);
          y += r.y; s += r.s;
        }
        return { y: y, s: s };
      }
    };
  }

  function materialOf(m) {
    if (typeof m === 'number') m = MATERIAL_ORDER[Math.max(0, Math.min(MATERIAL_ORDER.length - 1, Math.round(m)))];
    return MATERIALS[m] || MATERIALS.steel;
  }

  // Everything the beam mode reports, from its params alone.
  function beamAnalysis(params, Pnow) {
    var p = Object.assign({}, BEAM_DEFAULTS, params);
    var mat = materialOf(p.material);
    var P = Pnow == null ? p.P : Pnow;
    var I = secondMoment(p.b, p.h);
    var cLen = contactLengthOf(p);
    var load = spreadLoad(P, p.L, mat.E, I, cLen);
    var deltaPoint = tipDeflection(P, p.L, mat.E, I);
    // the concentrated-force model: the whole load as one force at the
    // centroid of the contact patch, a = L - c/2
    var aC = p.L - cLen / 2;
    var deltaConc = pointLoadAt(p.L, aC, P, mat.E, I).y;
    var sigma = load.moment * (p.h / 2) / I;
    var fy = p.yieldStrength != null ? p.yieldStrength : mat.yield;
    var ratio = contactRatio(cLen, p.L);
    return {
      material: mat.name, E: mat.E, I: I, P: P,
      delta: load.tip, deltaPoint: deltaPoint,
      deltaConcentrated: deltaConc, resultantAt: aC,
      modelError: load.tip > 0 ? (deltaConc - load.tip) / load.tip : 0,
      stress: sigma, stressPoint: rootStress(P, p.L, p.h, I), yieldStrength: fy,
      utilisation: sigma / fy,
      contact: cLen, contactRatio: ratio,
      concentratedFair: ratio <= p.concentratedTol,
      deflectionRatio: load.tip / p.L,
      rigidFair: load.tip / p.L <= p.rigidTol,
      linearValid: load.tip / p.L <= 0.1
    };
  }

  function contactLengthOf(p) {
    if (p.contact != null) return Math.max(0, Math.min(p.L, p.contact));
    return Math.min(p.L, (PATCHES[p.patch] || PATCHES.none).len);
  }

  // Exaggeration factor for the magnified view: a 1-2-5 step that makes
  // the drawn tip deflection roughly 15 % of the beam length.
  function exaggeration(delta, L) {
    if (!(delta > 0)) return 1;
    var want = 0.15 * L / delta;
    if (want <= 1) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(want)));
    var steps = [1, 2, 5, 10], best = e;
    for (var i = 0; i < steps.length; i++) if (steps[i] * e <= want) best = steps[i] * e;
    return best;
  }

  var GATE_DEFAULTS = {
    mode: 'gate', L: 3, mass: 120, angle0: 25, F: 600, d: 2.8, theta: 90, H: 400, dh: 2,
    friction: 40, openAngle: 80, slamSpeed: 2.5, Fmax: 2000, pusher: 'hand', zombies: 5, units: 'SI'
  };
  var BEAM_DEFAULTS = {
    mode: 'beam', material: 'steel', L: 3, b: 0.1, h: 0.15, P: 1000, yieldStrength: null,
    patch: 'none', contact: null, concentratedTol: 0.1, rigidTol: 0.01, sagLimit: 0.05, rampTime: 1.5, units: 'SI'
  };

  SE.physics = SE.physics || {};
  SE.physics.gate = {
    MATERIALS: MATERIALS, MATERIAL_ORDER: MATERIAL_ORDER, PATCHES: PATCHES,
    GATE_DEFAULTS: GATE_DEFAULTS, BEAM_DEFAULTS: BEAM_DEFAULTS,
    gateInertia: gateInertia, torque: torque, perpComponent: perpComponent, alongComponent: alongComponent,
    gateTorques: gateTorques, gateStep: gateStep, gateEvent: gateEvent, simulateGate: simulateGate,
    secondMoment: secondMoment, tipDeflection: tipDeflection, deflection: deflection, slope: slope,
    rootStress: rootStress, contactRatio: contactRatio, spreadLoad: spreadLoad, beamAnalysis: beamAnalysis,
    materialOf: materialOf, exaggeration: exaggeration
  };

  // ------------------------------------------------------------ helpers

  function fmtForce(N, units) { return SE.sceneUtil ? SE.sceneUtil.fmtForce(N, units) : N.toFixed(1) + ' N'; }
  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function fmtLen(m) {
    var a = Math.abs(m);
    if (a === 0) return '0 m';
    if (a < 1e-3) return sig(m * 1e6, 3) + ' µm';
    if (a < 1) return sig(m * 1e3, 3) + ' mm';
    return sig(m, 3) + ' m';
  }
  function fmtStress(Pa) { return Math.abs(Pa) >= 1e9 ? sig(Pa / 1e9, 3) + ' GPa' : sig(Pa / 1e6, 3) + ' MPa'; }
  function fmtTorque(Nm) { return Math.abs(Nm) >= 1e4 ? sig(Nm / 1e3, 3) + ' kN·m' : sig(Nm, 3) + ' N·m'; }
  function readout(ctx, x, y, lines) { if (SE.sceneUtil) SE.sceneUtil.readout(ctx, x, y, lines); }

  // Force arrow with its label parked just beyond the tail, so labels sit
  // out in open ground instead of piling up at the point of application.
  function tailArrow(ctx, x1, y1, x2, y2, color, label, width, shift) {
    D.arrow(ctx, x1, y1, x2, y2, color, '', { width: width || 3 });
    if (!label) return;
    var len = Math.hypot(x2 - x1, y2 - y1) || 1, dx = (x1 - x2) / len, dy = (y1 - y2) / len;
    ctx.save();
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    var half = ctx.measureText(label).width / 2 + 8;
    shift = shift || [0, 0];
    D.labelBox(ctx, label, x1 + dx * (half * Math.abs(dx) + 14) + shift[0], y1 + dy * 18 + shift[1], color);
    ctx.restore();
  }

  // ------------------------------------------------------------ scene

  function Gate() {}

  Gate.prototype.init = function (stage, p) {
    this.stage = stage;
    var mode = (p && p.mode) || 'gate';
    this.p = Object.assign({}, mode === 'beam' ? BEAM_DEFAULTS : GATE_DEFAULTS, p);
    this.reset();
  };

  Gate.prototype.reset = function () {
    var p = this.p;
    this.state = 'idle';
    this.time = 0;
    this.events = [];
    this.resolve = null;
    if (p.mode === 'beam') {
      this.Pnow = 0;
      this.broken = false;
      this.piece = null;
      this.peakStress = 0;
    } else {
      this.phi = p.angle0 * DEG;
      this.omega = 0; this.alpha = 0;
      this.drag = null;
      this.creakT = 0;
      this.hordeT = [];
      var r = D.rng(17);
      for (var i = 0; i < p.zombies; i++) this.hordeT.push({ s: 0.25 + (i + 0.5) / p.zombies * (p.L - 0.4), off: 0.3 + r() * 0.7, seed: i * 7 + 3 });
    }
  };

  Gate.prototype.resize = function (w, h) {
    var p = this.p, scale;
    this.w = w; this.h = h;
    if (p.mode === 'beam') {
      this.beamY = 0.55 * p.L + 0.5;
      scale = Math.min((w - 40) / (p.L + 2.0), (h - 70) / (this.beamY + 1.6));
      this.cam = new SE.Camera({ scale: scale, ox: 20 + 1.1 * scale, oy: h - 40 });
    } else {
      // world: x from -1.6 to L+1.8, y from -(L+0.6) (swung in) to +1.8 (horde)
      scale = Math.min((w - 20) / (p.L + 3.4), (h - 20) / (p.L + 2.4));
      var ox = w * 0.5 - (p.L * 0.5 + 0.1) * scale;
      this.cam = new SE.Camera({ scale: scale, ox: ox, oy: 10 + 1.8 * scale });
    }
  };

  /*
   * Gate mode: run({ duration, F, d, theta }) swings the gate under the
   * current push and horde, resolving with 'held' | 'opened' | 'closed' |
   * 'slammed' and detail { omega (rad/s), angle (deg), tipSpeed, time }.
   * Beam mode: run({ duration, P }) ramps the load on over rampTime,
   * resolving with 'held' | 'sagged' | 'failed'.
   */
  Gate.prototype.run = function (opts) {
    opts = opts || {};
    var self = this, p = this.p;
    ['F', 'd', 'theta', 'P'].forEach(function (k) { if (opts[k] != null) p[k] = opts[k]; });
    this.reset();
    this.state = 'running';
    this.duration = opts.duration || (p.mode === 'beam' ? p.rampTime + 1.2 : 6);
    if (p.mode !== 'beam') {
      var q = gateQ(p);
      if (Math.abs(q.net) > q.friction) SE.audio && SE.audio.play('creak');
      if (p.H > 0) SE.audio && SE.audio.play('groan');
    } else SE.audio && SE.audio.play('ratchet');
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  Gate.prototype.finish = function (outcome, detail) {
    this.result = { outcome: outcome, detail: detail };
    if (this.resolve) {
      var r = this.resolve; this.resolve = null;
      setTimeout(function () { r({ outcome: outcome, detail: detail }); }, 700);
    }
  };

  Gate.prototype.step = function (dt) {
    this.time += dt;
    if (this.p.mode === 'beam') this.stepBeam(dt); else this.stepGate(dt);
  };

  Gate.prototype.stepGate = function (dt) {
    var p = this.p;
    if (this.state !== 'running') return;
    var q = gateQ(p);
    var s = { phi: this.phi, omega: this.omega, alpha: 0 };
    gateStep(s, q, dt);
    this.phi = s.phi; this.omega = s.omega; this.alpha = s.alpha;
    if (Math.abs(this.omega) > 0.05) {
      this.creakT -= dt;
      if (this.creakT <= 0) { this.creakT = 0.9; SE.audio && SE.audio.play('creak'); }
    }
    var ev = gateEvent(s, p);
    var cam = this.cam;
    if (ev) {
      var om = this.omega;
      if (ev.outcome === 'opened') {
        this.state = 'opened';
        this.stage.shake(10);
        this.stage.flash('rgba(200,40,30,ALPHA)', 0.35, 0.4);
        SE.audio && SE.audio.play('crash'); SE.audio && SE.audio.play('fail');
      } else {
        this.phi = 0; this.omega = 0;
        this.state = ev.outcome;
        var tx = cam ? cam.x(p.L) : 0, ty = cam ? cam.y(0) : 0;
        if (ev.outcome === 'slammed') {
          this.stage.shake(Math.min(22, 6 + ev.tipSpeed * 3));
          this.stage.burst(tx, ty, { n: 34, color: '#a08870', kind: 'debris', speed: 260 });
          this.stage.burst(tx, ty, { n: 24, color: '#ffd27a', speed: 320 });
          SE.audio && SE.audio.play('crash');
        } else {
          this.stage.shake(4);
          this.stage.burst(tx, ty, { n: 14, color: '#a08870', kind: 'dust', speed: 90, gravity: -10 });
          SE.audio && SE.audio.play('clang'); SE.audio && SE.audio.play('success');
        }
      }
      this.events.push(ev.outcome);
      this.finish(ev.outcome, { omega: om, angle: this.phi / DEG, tipSpeed: ev.tipSpeed, time: this.time, torque: q.net });
      return;
    }
    if (this.time >= this.duration) {
      this.state = 'held';
      SE.audio && SE.audio.play('thud');
      this.finish('held', { omega: this.omega, angle: this.phi / DEG, time: this.time, torque: q.net });
    }
  };

  Gate.prototype.stepBeam = function (dt) {
    var p = this.p;
    if (this.state === 'broken') { this.stepPiece(dt); return; }
    if (this.state !== 'running') return;
    var ramp = Math.min(1, this.time / Math.max(1e-6, p.rampTime));
    this.Pnow = p.P * ramp;
    var A = beamAnalysis(p, this.Pnow);
    this.peakStress = Math.max(this.peakStress, A.stress);
    if (A.stress > A.yieldStrength) {
      this.state = 'broken'; this.broken = true;
      this.events.push('fail');
      // the cracked beam keeps its last shape and falls, turning about the
      // wall as it goes
      this.piece = { x: 0, y: 0, ang: 0, vx: 0.4, vy: 0, w: -1.2, t: 0, landed: false };
      var cam = this.cam;
      if (cam) {
        this.stage.burst(cam.x(0), cam.y(this.beamY), { n: 40, color: '#ffd27a', speed: 340 });
        this.stage.burst(cam.x(0), cam.y(this.beamY), { n: 26, color: '#8a5a33', kind: 'debris', speed: 240 });
      }
      this.stage.shake(14);
      this.stage.flash('rgba(255,230,180,ALPHA)', 0.4, 0.2);
      SE.audio && SE.audio.play('snap');
      this.failDetail = { P: this.Pnow, stress: A.stress, yieldStrength: A.yieldStrength, delta: A.delta, material: A.material };
      return;
    }
    if (this.time >= this.duration) {
      this.state = 'done';
      var out = A.deflectionRatio > p.sagLimit ? 'sagged' : 'held';
      SE.audio && SE.audio.play(out === 'held' ? 'success' : 'groan');
      this.finish(out, {
        delta: A.delta, deltaPoint: A.deltaPoint, deltaConcentrated: A.deltaConcentrated, stress: A.stress, yieldStrength: A.yieldStrength,
        deflectionRatio: A.deflectionRatio, rigidFair: A.rigidFair, contactRatio: A.contactRatio,
        concentratedFair: A.concentratedFair, modelError: A.modelError, E: A.E, I: A.I, material: A.material
      });
    }
  };

  Gate.prototype.stepPiece = function (dt) {
    var pc = this.piece;
    if (!pc || pc.landed) return;
    pc.t += dt;
    pc.vy -= 9.81 * dt;
    pc.x += pc.vx * dt; pc.y += pc.vy * dt; pc.ang += pc.w * dt;
    // lowest point of the falling beam (rigid, about its root)
    var L = this.p.L, low = this.beamY + pc.y + Math.min(0, Math.sin(pc.ang) * L) - this.p.h;
    if (low <= 0 || pc.t > 2.5) {
      pc.landed = true;
      var cam = this.cam;
      if (cam) this.stage.burst(cam.x(L * 0.5), cam.y(0), { n: 30, color: '#a08870', kind: 'dust', speed: 150, gravity: -30 });
      this.stage.shake(12);
      SE.audio && SE.audio.play('crash');
      this.finish('failed', this.failDetail);
    }
  };

  // ------------------------------------------------------------ controls

  Gate.prototype.controls = function () {
    var p = this.p;
    if (p.mode === 'beam') {
      return [
        { key: 'material', label: 'material (0 steel, 1 alu, 2 timber, 3 rubber)', min: 0, max: 3, step: 1, value: MATERIAL_ORDER.indexOf(materialOf(p.material).name), unit: '' },
        { key: 'P', label: 'tip load P', min: 0, max: 20000, step: 50, value: p.P, unit: 'N' },
        { key: 'L', label: 'length L', min: 0.5, max: 6, step: 0.1, value: p.L, unit: 'm' },
        { key: 'b', label: 'width b', min: 0.01, max: 0.3, step: 0.005, value: p.b, unit: 'm' },
        { key: 'h', label: 'depth h', min: 0.01, max: 0.4, step: 0.005, value: p.h, unit: 'm' },
        { key: 'contact', label: 'contact length', min: 0, max: p.L, step: 0.005, value: contactLengthOf(p), unit: 'm' }
      ];
    }
    return [
      { key: 'F', label: 'push F', min: 0, max: p.Fmax, step: 10, value: p.F, unit: 'N' },
      { key: 'd', label: 'push point d', min: 0, max: p.L, step: 0.05, value: p.d, unit: 'm' },
      { key: 'theta', label: 'push angle θ', min: -180, max: 180, step: 1, value: p.theta, unit: '°' },
      { key: 'H', label: 'horde force H', min: 0, max: 3000, step: 10, value: p.H, unit: 'N' },
      { key: 'dh', label: 'horde at dh', min: 0, max: p.L, step: 0.05, value: p.dh, unit: 'm' },
      { key: 'friction', label: 'hinge friction', min: 0, max: 500, step: 5, value: p.friction, unit: 'N·m' },
      { key: 'angle0', label: 'start angle', min: 0, max: p.openAngle - 1, step: 1, value: p.angle0, unit: '°' }
    ];
  };

  Gate.prototype.set = function (key, value) {
    var p = this.p;
    if (key === 'material' && typeof value === 'number') value = MATERIAL_ORDER[Math.round(value)] || 'steel';
    if (key === 'patch') p.contact = null;
    p[key] = value;
    if (key === 'L') {
      if (p.mode !== 'beam') { p.d = Math.min(p.d, value); p.dh = Math.min(p.dh, value); }
      if (this.w) this.resize(this.w, this.h);
    }
    if (this.state !== 'running' && this.state !== 'broken') this.reset();
  };

  /*
   * Gate mode pointer: press on or near the gate to pick the point of
   * application (projected onto the gate), then drag. The force points from
   * the pointer toward the push point, like the player leaning in from
   * where the pointer is; drag length sets the magnitude.
   */
  Gate.prototype.pointer = function (evt) {
    var p = this.p, cam = this.cam;
    if (p.mode === 'beam' || !cam || this.state === 'running') return;
    var wx = cam.wx(evt.x), wy = cam.wy(evt.y);
    var ux = Math.cos(this.phi), uy = -Math.sin(this.phi);
    if (evt.type === 'pointerdown') {
      var s = wx * ux + wy * uy, n = -wx * uy + wy * ux;
      if (s < -0.5 || s > p.L + 0.5 || Math.abs(n) > 1.6) return;
      p.d = Math.round(Math.max(0, Math.min(p.L, s)) * 20) / 20;
      this.drag = { on: true };
      if (this.state !== 'idle') { var keep = this.phi; this.reset(); this.phi = keep; }
      SE.audio && SE.audio.play('click');
    } else if (evt.type === 'pointermove' && this.drag && this.drag.on) {
      var ax = p.d * ux, ay = p.d * uy;
      var fx = ax - wx, fy = ay - wy, len = Math.hypot(fx, fy);
      if (len < 0.05) return;
      var perMetre = p.Fmax / 2.5;
      p.F = Math.round(Math.min(p.Fmax, len * perMetre) / 10) * 10;
      var cross = ux * fy - uy * fx, dot = ux * fx + uy * fy;
      p.theta = Math.round(Math.atan2(cross, dot) / DEG);
    } else if (evt.type === 'pointerup' || evt.type === 'pointerleave') {
      if (this.drag) this.drag.on = false;
    }
  };

  Gate.prototype.readouts = function () {
    var p = this.p;
    if (p.mode === 'beam') {
      var A = beamAnalysis(p, this.state === 'idle' ? p.P : this.Pnow);
      var out = [
        'material  ' + A.material + '  E = ' + sig(A.E / 1e9, 3) + ' GPa',
        'I = bh³/12 = ' + sig(A.I, 3) + ' m⁴',
        'δ tip     ' + fmtLen(A.delta) + '  (δ/L = ' + sig(A.deflectionRatio, 2) + ')',
        'σ root    ' + fmtStress(A.stress) + ' of ' + fmtStress(A.yieldStrength),
        A.rigidFair ? 'rigid body: fair' : 'rigid body: NOT fair'
      ];
      if (A.contact > 0) out.push('contact/L = ' + sig(A.contactRatio, 2) + (A.concentratedFair ? '  point load fair' : '  point load poor'));
      if (!A.linearValid) out.push('δ/L > 0.1: small-deflection theory breaks down');
      return out;
    }
    var q = gateQ(p);
    return [
      'F⊥ = F sin θ = ' + fmtForce(perpComponent(p.F, p.theta * DEG), p.units),
      'τ push  = ' + fmtTorque(-q.player),
      'τ horde = ' + fmtTorque(q.horde),
      'α = ' + sig(this.alpha || 0, 3) + ' rad/s²',
      'φ = ' + sig(this.phi / DEG, 3) + '°'
    ];
  };

  // ------------------------------------------------------------ drawing

  Gate.prototype.draw = function (ctx, w, h, t) {
    if (!this.cam) this.resize(w, h);
    if (this.p.mode === 'beam') this.drawBeam(ctx, w, h, t); else this.drawGate(ctx, w, h, t);
  };

  // Top-down zombie: shoulders, head and arms reaching toward the gate.
  function zombieTop(ctx, x, y, s, ang, t, seed) {
    var r = D.rng(seed);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang + Math.sin(t * 2 + seed) * 0.08);
    ctx.fillStyle = r() < 0.5 ? C.rotDark : '#3b3a2e';
    var reach = Math.sin(t * 3 + seed) * 0.06;
    ctx.fillRect(s * 0.1, -s * 0.32, s * (0.55 + reach), s * 0.1);
    ctx.fillRect(s * 0.1, s * 0.22, s * (0.5 - reach), s * 0.1);
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.22, s * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.rot;
    ctx.beginPath(); ctx.arc(s * 0.08, 0, s * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(230,200,90,0.8)';
    ctx.fillRect(s * 0.18, -s * 0.07, s * 0.04, s * 0.04); ctx.fillRect(s * 0.18, s * 0.04, s * 0.04, s * 0.04);
    ctx.restore();
  }

  // Top-down survivor seen from above: hard hat, shoulders, arms forward.
  function survivorTop(ctx, x, y, s, ang) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = '#2f3a44';
    ctx.fillRect(-s * 0.05, -s * 0.3, s * 0.55, s * 0.1);
    ctx.fillRect(-s * 0.05, s * 0.2, s * 0.55, s * 0.1);
    ctx.beginPath(); ctx.ellipse(-s * 0.1, 0, s * 0.22, s * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.rust; ctx.fillRect(-s * 0.2, -s * 0.36, s * 0.06, s * 0.72);
    ctx.fillStyle = C.hazard;
    ctx.beginPath(); ctx.arc(-s * 0.05, 0, s * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-s * 0.2, 0); ctx.lineTo(s * 0.1, 0); ctx.stroke();
    ctx.restore();
  }

  Gate.prototype.drawGate = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, L = p.L;
    var phi = this.phi, ux = Math.cos(phi), uy = -Math.sin(phi);
    var nx = Math.sin(phi), ny = Math.cos(phi);       // outward normal (world)
    function X(wx) { return cam.x(wx); }
    function Y(wy) { return cam.y(wy); }

    // dirt yard, outside darker than inside
    ctx.fillStyle = D.rustPattern(ctx, '#3a2f27', 11); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(60,20,15,0.35)'; ctx.fillRect(0, 0, w, Y(0));
    ctx.fillStyle = 'rgba(255,200,140,0.05)'; ctx.fillRect(0, Y(0), w, h - Y(0));
    D.text(ctx, 'OUTSIDE', 12, 22, { color: 'rgba(226,85,63,0.8)', font: '700 12px "IBM Plex Mono", monospace' });
    D.text(ctx, 'SETTLEMENT', 12, h - 12, { color: 'rgba(143,207,106,0.8)', font: '700 12px "IBM Plex Mono", monospace' });

    // palisade walls either side of the opening (top-down log ends)
    var wallT = cam.len(0.3);
    ctx.fillStyle = C.woodDark;
    ctx.fillRect(0, Y(0) - wallT / 2 - cam.len(0.08), X(-0.12), wallT);
    ctx.fillRect(X(L + 0.12), Y(0) - wallT / 2 - cam.len(0.08), w - X(L + 0.12), wallT);
    ctx.fillStyle = C.wood;
    for (var lx = X(-0.12) - wallT / 2; lx > -wallT; lx -= wallT * 0.95) { ctx.beginPath(); ctx.arc(lx, Y(0) - cam.len(0.08), wallT * 0.45, 0, Math.PI * 2); ctx.fill(); }
    for (var rx = X(L + 0.12) + wallT / 2; rx < w + wallT; rx += wallT * 0.95) { ctx.beginPath(); ctx.arc(rx, Y(0) - cam.len(0.08), wallT * 0.45, 0, Math.PI * 2); ctx.fill(); }
    // jamb stop on the outside face at the latch end
    ctx.fillStyle = C.steel; ctx.fillRect(X(L) - cam.len(0.12), Y(0) - cam.len(0.3), cam.len(0.3), cam.len(0.14));

    // swing path and the breach limit
    ctx.save();
    ctx.strokeStyle = 'rgba(143,184,232,0.35)'; ctx.setLineDash([5, 6]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(X(0), Y(0), cam.len(L), 0, p.openAngle * DEG); ctx.stroke();
    ctx.setLineDash([]);
    var oa = p.openAngle * DEG;
    ctx.strokeStyle = 'rgba(226,85,63,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(Math.cos(oa) * (L + 0.3)), Y(-Math.sin(oa) * (L + 0.3))); ctx.stroke();
    ctx.restore();
    D.labelBox(ctx, 'breach ' + p.openAngle + '°', X(Math.cos(oa) * (L + 0.55)), Y(-Math.sin(oa) * (L + 0.55)), C.bad);

    // the horde, packed against the outside face of the gate
    var self = this;
    var Hs = cam.len(0.62);
    this.hordeT.forEach(function (z) {
      var s = Math.min(L, z.s), push = self.state === 'opened' ? 0.2 : 0;
      var zx = s * ux + nx * (z.off + 0.15 - push), zy = s * uy + ny * (z.off + 0.15 - push);
      var faceAng = Math.atan2(-(-ny), -nx);   // screen angle of the inward normal
      zombieTop(ctx, X(zx), Y(zy), Hs, faceAng, t, z.seed);
    });

    // gate leaf: planks with a diagonal brace, rotated about the hinge
    var thick = cam.len(0.16);
    ctx.save();
    ctx.translate(X(0), Y(0)); ctx.rotate(phi);
    ctx.fillStyle = D.rustPattern(ctx, C.wood, 3);
    ctx.fillRect(0, -thick / 2, cam.len(L), thick);
    ctx.strokeStyle = C.woodDark; ctx.lineWidth = 1.5;
    for (var k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(cam.len(L) * k / 6, -thick / 2); ctx.lineTo(cam.len(L) * k / 6, thick / 2); ctx.stroke(); }
    ctx.strokeRect(0, -thick / 2, cam.len(L), thick);
    ctx.fillStyle = C.steel;
    ctx.fillRect(cam.len(L) - cam.len(0.25), -thick / 2 - 2, cam.len(0.2), thick + 4);
    D.hazardStripes(ctx, cam.len(L * 0.35), thick / 2 - 4, cam.len(L * 0.3), 4);
    ctx.restore();
    // hinge post and pin
    ctx.fillStyle = C.iron; ctx.beginPath(); ctx.arc(X(0), Y(0), cam.len(0.2), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(X(0), Y(0), cam.len(0.08), 0, Math.PI * 2); ctx.fill();
    D.text(ctx, 'hinge', X(0) - cam.len(0.25), Y(0) + cam.len(0.45), { align: 'right', color: C.steelHi, font: '600 11px "IBM Plex Mono", monospace' });

    // horde force: inward, perpendicular to the leaf at dh
    if (p.H > 0) {
      var hx = p.dh * ux, hy = p.dh * uy, hl = 0.6 + 1.0 * Math.min(1, p.H / p.Fmax);
      tailArrow(ctx, X(hx + nx * (hl + 0.1)), Y(hy + ny * (hl + 0.1)), X(hx + nx * 0.1), Y(hy + ny * 0.1), C.weight, 'H = ' + fmtForce(p.H, p.units), 3);
    }

    // the player's push: arrow head on the point of application
    var th = p.theta * DEG;
    var fdx = Math.cos(th) * ux - Math.sin(th) * uy, fdy = Math.sin(th) * ux + Math.cos(th) * uy;
    var ax = p.d * ux, ay = p.d * uy;
    var fl = 0.4 + 1.6 * Math.min(1, p.F / p.Fmax);
    var tx0 = ax - fdx * fl, ty0 = ay - fdy * fl;
    // the pusher stands behind the arrow tail
    var bodyAng = Math.atan2(-fdy, fdx);
    if (p.F > 0) {
      if (p.pusher === 'ram') {
        ctx.save();
        ctx.strokeStyle = C.woodDark; ctx.lineWidth = cam.len(0.2); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(X(ax - fdx * 0.12), Y(ay - fdy * 0.12)); ctx.lineTo(X(ax - fdx * (fl + 0.9)), Y(ay - fdy * (fl + 0.9))); ctx.stroke();
        ctx.strokeStyle = C.steel; ctx.lineWidth = cam.len(0.24); ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(X(ax - fdx * 0.05), Y(ay - fdy * 0.05)); ctx.lineTo(X(ax - fdx * 0.25), Y(ay - fdy * 0.25)); ctx.stroke();
        ctx.restore();
        survivorTop(ctx, X(ax - fdx * (fl + 0.7)), Y(ay - fdy * (fl + 0.7)), cam.len(0.6), bodyAng);
      } else {
        survivorTop(ctx, X(ax - fdx * 0.45), Y(ay - fdy * 0.45), cam.len(0.6), bodyAng);
      }
      // push point marker (hand print ring)
      ctx.save();
      ctx.strokeStyle = C.hazard; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(ax), Y(ay), 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // components: perpendicular (turns the gate) and along the gate (goes into the pin)
      var Fperp = Math.sin(th), Fpar = Math.cos(th);
      ctx.save(); ctx.globalAlpha = 0.85;
      var inward = [-nx * 26, ny * 26];   // screen offset toward the settlement
      if (Math.abs(Fpar) > 0.02 && Math.abs(Fperp) > 0.05) tailArrow(ctx, X(ax - ux * Fpar * fl), Y(ay - uy * Fpar * fl), X(ax), Y(ay), C.steelHi, Math.abs(Fpar) > 0.15 ? 'F∥ = ' + fmtForce(p.F * Math.abs(Fpar), p.units) : '', 2, inward);
      if (Math.abs(Fperp) > 0.02) tailArrow(ctx, X(ax + nx * -Fperp * fl), Y(ay + ny * -Fperp * fl), X(ax), Y(ay), C.accel, Math.abs(Fperp) < 0.995 ? 'F⊥ = ' + fmtForce(p.F * Math.abs(Fperp), p.units) : '', 2);
      ctx.restore();
      tailArrow(ctx, X(tx0), Y(ty0), X(ax), Y(ay), C.force, 'F = ' + fmtForce(p.F, p.units) + '  θ = ' + p.theta + '°', 4, Math.abs(Fperp) < 0.3 ? inward : null);
    }
    // lever arm dimension along the leaf, offset to the inside
    var off = 1.3;
    D.dimLine(ctx, X(-nx * off), Y(-ny * off), X(ax - nx * off), Y(ay - ny * off), 'd = ' + sig(p.d, 3) + ' m');

    // torque balance bar: closing vs opening
    var q = gateQ(p);
    var bw = Math.min(220, w * 0.32), bx = w - bw - 14, by = h - 56;
    ctx.save();
    ctx.fillStyle = 'rgba(15,12,10,0.78)'; D.roundRect(ctx, bx - 8, by - 22, bw + 16, 52, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(230,180,34,0.5)'; ctx.stroke();
    var ref = Math.max(1, Math.abs(q.player), Math.abs(q.horde));
    var cl = Math.max(0, -q.player) / ref * bw / 2, op = Math.max(0, q.horde) / ref * bw / 2;
    ctx.fillStyle = C.good; ctx.fillRect(bx + bw / 2 - cl, by, cl, 10);
    ctx.fillStyle = C.bad; ctx.fillRect(bx + bw / 2, by, op, 10);
    var fr = Math.min(bw / 2, p.friction / ref * bw / 2);
    ctx.fillStyle = 'rgba(236,226,198,0.25)'; ctx.fillRect(bx + bw / 2 - fr, by + 12, 2 * fr, 4);
    ctx.fillStyle = C.paper; ctx.fillRect(bx + bw / 2 - 1, by - 4, 2, 22);
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillStyle = C.good; ctx.fillText('closing', bx, by - 7);
    ctx.textAlign = 'right'; ctx.fillStyle = C.bad; ctx.fillText('opening', bx + bw, by - 7);
    ctx.textAlign = 'center'; ctx.fillStyle = C.paperDim; ctx.fillText('net ' + fmtTorque(q.net) + '  friction ±' + fmtTorque(p.friction), bx + bw / 2, by + 27);
    ctx.restore();

    var lines = [
      'I = mL²/3 = ' + sig(q.I, 3) + ' kg·m²',
      'τ = F d sin θ = ' + fmtTorque(-q.player),
      'τ horde = H dh = ' + fmtTorque(q.horde),
      'α = ' + sig(this.alpha || 0, 3) + ' rad/s²',
      'ω = ' + sig(this.omega, 3) + ' rad/s',
      'φ = ' + sig(phi / DEG, 3) + '° open'
    ];
    if (Math.abs(Math.sin(th)) < 1e-6 && p.F > 0) lines.push('push along gate: no turning');
    readout(ctx, 12, 30, lines);
    if (this.state === 'opened') D.labelBox(ctx, 'BREACH', w / 2, 24, C.bad);
    else if (this.state === 'closed') D.labelBox(ctx, 'GATE SHUT', w / 2, 24, C.good);
    else if (this.state === 'slammed') D.labelBox(ctx, 'SLAMMED SHUT', w / 2, 24, C.hazard);
    else if (this.state === 'held') D.labelBox(ctx, 'HELD AT ' + sig(phi / DEG, 3) + '°', w / 2, 24, C.paper);
  };

  // Points along the beam centreline, drawn with arc length preserved:
  // the angle at s comes from the linear slope y'(s), so a stiff beam
  // matches y(x) exactly and a floppy one droops instead of stretching.
  // A floppy beam that reaches the floor (y = floor) lies along it.
  function beamCurve(load, L, mult, N, floor) {
    var pts = [{ x: 0, y: 0, a: 0 }], x = 0, y = 0, ds = L / N, down = false;
    for (var i = 0; i < N; i++) {
      var sm = (i + 0.5) * ds;
      var a = down ? 0 : Math.atan(load.at(sm).s * mult);
      x += Math.cos(a) * ds; y -= Math.sin(a) * ds;
      if (floor != null && y <= floor) { y = floor; down = true; }
      pts.push({ x: x, y: y, a: a });
    }
    return pts;
  }

  function strokeBeam(ctx, cam, pts, ox, oy, depth, fill, edge) {
    var top = [], bot = [];
    var hd = depth / 2;
    pts.forEach(function (q) {
      var nxs = Math.sin(q.a), nys = Math.cos(q.a);    // world normal (up-ish)
      top.push([cam.x(ox + q.x - nxs * hd), cam.y(oy + q.y + nys * hd)]);
      bot.push([cam.x(ox + q.x + nxs * hd), cam.y(oy + q.y - nys * hd)]);
    });
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (var i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
    for (var j = bot.length - 1; j >= 0; j--) ctx.lineTo(bot[j][0], bot[j][1]);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
  }

  Gate.prototype.drawBeam = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam, L = p.L, by = this.beamY;
    var mat = materialOf(p.material);
    var P = this.state === 'idle' ? 0 : this.Pnow;
    var A = beamAnalysis(p, P);
    var Afull = beamAnalysis(p, p.P);
    var load = spreadLoad(P, L, mat.E, A.I, A.contact);
    var depth = Math.max(p.h, 4 / cam.scale);

    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, cam.y(0), 60);
    // wall
    ctx.save();
    ctx.fillStyle = D.rustPattern(ctx, '#4a423b', 9);
    ctx.fillRect(cam.x(-1.0), cam.y(by + 1.2), cam.len(1.0), cam.len(by + 1.2));
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (var r = 0; r < (by + 1.2) / 0.3; r++) {
      var yy = cam.y(r * 0.3);
      ctx.beginPath(); ctx.moveTo(cam.x(-1.0), yy); ctx.lineTo(cam.x(0), yy); ctx.stroke();
      var sx = cam.x(-1.0 + (r % 2 ? 0.25 : 0.5));
      ctx.beginPath(); ctx.moveTo(sx, yy); ctx.lineTo(sx, yy - cam.len(0.3)); ctx.stroke();
    }
    ctx.fillStyle = C.steel;
    ctx.fillRect(cam.x(-0.06), cam.y(by + p.h / 2 + 0.12), cam.len(0.1), cam.len(p.h + 0.24));
    ctx.fillStyle = C.steelHi;
    [0.06, -0.06].forEach(function (o) { ctx.beginPath(); ctx.arc(cam.x(-0.01), cam.y(by + o), Math.max(2, cam.len(0.025)), 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    D.text(ctx, 'side view, true scale', cam.x(0.15), cam.y(by + p.h / 2) - 8, { align: 'left', color: C.paperDim, font: '600 11px "IBM Plex Mono", monospace' });

    // undeformed outline
    ctx.save();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(143,184,232,0.55)'; ctx.lineWidth = 1;
    ctx.strokeRect(cam.x(0), cam.y(by + p.h / 2), cam.len(L), cam.len(p.h));
    ctx.restore();

    var pts;
    if (this.piece) {
      // broken: the beam falls clear of the wall as one piece
      var pc = this.piece;
      pts = beamCurve(load, L, 1, 40);
      ctx.save();
      ctx.translate(cam.x(pc.x), cam.y(by + pc.y));
      ctx.rotate(-pc.ang);
      ctx.translate(-cam.x(0), -cam.y(by));
      strokeBeam(ctx, cam, pts, 0, by, depth, D.rustPattern(ctx, mat.color, 4), mat.edge);
      var tp = pts[pts.length - 1];
      D.crate(ctx, cam.x(tp.x) - cam.len(0.3), cam.y(by + tp.y + p.h / 2), cam.len(0.5), cam.len(0.45), { label: '' });
      ctx.restore();
      // jagged stub left in the wall
      ctx.save(); ctx.fillStyle = mat.color; ctx.strokeStyle = mat.edge;
      ctx.beginPath();
      ctx.moveTo(cam.x(0), cam.y(by + p.h / 2)); ctx.lineTo(cam.x(0.1), cam.y(by + p.h / 4));
      ctx.lineTo(cam.x(0.04), cam.y(by)); ctx.lineTo(cam.x(0.12), cam.y(by - p.h / 3)); ctx.lineTo(cam.x(0), cam.y(by - p.h / 2));
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      D.labelBox(ctx, 'YIELD: σ ' + fmtStress(this.failDetail.stress) + ' > ' + fmtStress(this.failDetail.yieldStrength), w / 2, 24, C.bad);
    } else {
      pts = beamCurve(load, L, 1, 40, -(by - p.h / 2));
      strokeBeam(ctx, cam, pts, 0, by, depth, D.rustPattern(ctx, mat.color, 4), mat.edge);
      // stress glow at the root as it nears yield
      var u = Math.min(1, A.utilisation);
      if (u > 0.5) {
        ctx.save(); ctx.globalAlpha = (u - 0.5) * 1.6 * (0.7 + 0.3 * Math.sin(t * 10));
        ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(cam.x(0.05), cam.y(by), cam.len(p.h) + 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      this.drawLoad(ctx, cam, pts, by, A, p, t);
      // tip deflection callout
      var tipPt = pts[pts.length - 1];
      if (A.delta > 0 && cam.len(-tipPt.y) > 10) D.dimLine(ctx, cam.x(L + 0.3), cam.y(by), cam.x(L + 0.3), cam.y(by + tipPt.y), (A.linearValid ? 'δ = ' : 'linear theory δ = ') + fmtLen(A.delta), A.linearValid ? C.blueInk : C.bad);
    }

    // magnified view when the true-scale deflection is too small to see
    var deltaShown = this.state === 'idle' ? Afull.delta : A.delta;
    if (!this.piece && deltaShown > 0 && cam.len(deltaShown) < 8) this.drawMagnified(ctx, w, h, mat, A, Afull);

    var lines = [
      mat.name + '  E = ' + sig(mat.E / 1e9, 3) + ' GPa',
      'b×h = ' + fmtLen(p.b) + ' × ' + fmtLen(p.h) + ',  L = ' + sig(L, 3) + ' m',
      'I = bh³/12 = ' + sig(A.I, 3) + ' m⁴',
      'P = ' + fmtForce(P, p.units) + ' of ' + fmtForce(p.P, p.units),
      'δ = PL³/3EI = ' + fmtLen(A.deltaPoint),
      'σ = Mc/I = ' + fmtStress(A.stress) + '  (yield ' + fmtStress(A.yieldStrength) + ')',
      'δ/L = ' + sig(A.deflectionRatio, 2) + (A.rigidFair ? '  rigid: fair' : '  rigid: NOT fair')
    ];
    if (A.contact > 0) {
      lines[4] = 'δ spread load = ' + fmtLen(A.delta);
      lines.push('P at centroid: δ = ' + fmtLen(A.deltaConcentrated) + ' (' + (A.modelError >= 0 ? '+' : '') + sig(A.modelError * 100, 2) + '%)');
    }
    if (!A.linearValid) lines.push('δ/L > 0.1: linear theory out of range');
    readout(ctx, 12, 12, lines);
  };

  Gate.prototype.drawLoad = function (ctx, cam, pts, by, A, p, t) {
    var L = p.L, N = pts.length - 1;
    function at(x) {
      var i = Math.max(0, Math.min(N, Math.round(x / L * N)));
      return { x: pts[i].x, y: by + pts[i].y, a: pts[i].a };
    }
    var c = A.contact, kind = p.patch, top = p.h / 2;
    var tip = at(L);
    var refP = Math.max(1, p.P);
    var ah = 0.5 + 0.5 * Math.min(1, A.P / refP);
    if (c > 1e-9) {
      // the load spread over the contact patch, drawn on the bent beam
      var s0 = at(L - c), s1 = tip;
      var len = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      var ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
      ctx.save();
      ctx.translate(cam.x(s0.x), cam.y(s0.y + top));
      ctx.rotate(-ang);
      var pw = cam.len(len), ph;
      if (kind === 'wheel') {
        var rad = cam.len(0.25);
        ctx.fillStyle = C.iron; ctx.beginPath(); ctx.arc(pw / 2, -rad, rad, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(pw / 2, -rad, rad * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(pw / 2, -rad, rad * 0.15, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'sandbag') {
        ph = cam.len(0.28);
        ctx.fillStyle = '#9b8a62';
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-ph * 0.3, -ph * 0.9, pw * 0.2, -ph); ctx.quadraticCurveTo(pw * 0.5, -ph * 1.15, pw * 0.8, -ph);
        ctx.quadraticCurveTo(pw + ph * 0.3, -ph * 0.9, pw, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#5d5038'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        ph = cam.len(0.5);
        D.crate(ctx, 0, -cam.len(0.12), pw, ph, { label: 'PALLET' });
        ctx.fillStyle = C.woodDark;
        for (var k = 0; k < 4; k++) ctx.fillRect(k * (pw - 6) / 3, -cam.len(0.12), 6, cam.len(0.12));
      }
      ctx.restore();
      // distributed load arrows above the patch
      var n = Math.max(2, Math.min(9, Math.round(cam.len(c) / 18) + 1));
      for (var j = 0; j < n; j++) {
        var q = at(L - c + c * (n === 1 ? 0.5 : j / (n - 1)));
        D.arrow(ctx, cam.x(q.x), cam.y(q.y + top + 0.6 + ah * 0.5), cam.x(q.x), cam.y(q.y + top + 0.55), C.force, '', { width: 2, headScale: 0.7 });
      }
      // contact patch bracket and ratio
      var cr = A.contactRatio, fair = A.concentratedFair;
      D.dimLine(ctx, cam.x(s0.x), cam.y(s0.y - top - 0.25), cam.x(s1.x), cam.y(s1.y - top - 0.25), 'contact ' + fmtLen(c), fair ? C.good : C.hazard);
      D.labelBox(ctx, 'c/L = ' + sig(cr, 2) + (fair ? ' → point load fair' : ' → spread it out'), cam.x(Math.max(L * 0.5, s0.x)), cam.y(by - top - 0.85), fair ? C.good : C.hazard);
    } else {
      D.crate(ctx, cam.x(tip.x) - cam.len(0.25), cam.y(tip.y + top), cam.len(0.5), cam.len(0.45), { label: '' });
    }
    // the idealized concentrated force: the resultant, at the patch centroid
    var rp = at(L - c / 2);
    var planned = this.state === 'idle';
    if (planned) ah = 1;
    D.arrow(ctx, cam.x(rp.x), cam.y(rp.y + top + 0.6 + ah * 0.9), cam.x(rp.x), cam.y(rp.y + top + 0.5), planned ? 'rgba(255,107,107,0.55)' : C.weight,
      (c > 1e-9 ? 'resultant P = ' : 'P = ') + fmtForce(planned ? p.P : A.P, p.units) + (planned ? ' (not yet applied)' : ''), { lx: 0, ly: -6 });
  };

  Gate.prototype.drawMagnified = function (ctx, w, h, mat, A, Afull) {
    var p = this.p, L = p.L;
    var useFull = this.state === 'idle';
    var An = useFull ? Afull : A;
    var k = exaggeration(Afull.delta, L);
    var pw = Math.min(320, w * 0.42), ph = 120;
    var px = w - pw - 12, py = h - ph - 52;
    ctx.save();
    ctx.fillStyle = 'rgba(10,22,38,0.9)'; D.roundRect(ctx, px, py, pw, ph, 8); ctx.fill();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.save(); ctx.translate(px, py); D.blueprintGrid(ctx, pw, ph, 16); ctx.restore();
    var x0 = px + 18, x1 = px + pw - 22, y0 = py + 34, s = (x1 - x0) / L;
    ctx.strokeStyle = 'rgba(143,184,232,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.blueInk; ctx.fillRect(x0 - 8, y0 - 18, 8, 36);
    var I = An.I, loadM = spreadLoad(An.P, L, mat.E, I, An.contact);
    ctx.strokeStyle = C.hazard; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (var i = 0; i <= 40; i++) { var x = L * i / 40; var yv = loadM.at(x).y * k; if (i) ctx.lineTo(x0 + x * s, y0 + yv * s); else ctx.moveTo(x0, y0); }
    ctx.stroke();
    var yt = y0 + loadM.tip * k * s;
    ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(x1, yt, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    D.text(ctx, 'MAGNIFIED  deflection ×' + (k >= 1e4 ? k.toExponential(0) : String(k)), px + 10, py + 16, { color: C.hazard, font: '700 11px "IBM Plex Mono", monospace' });
    D.text(ctx, 'δ = ' + fmtLen(loadM.tip) + (useFull ? ' at full load' : ''), px + 10, py + ph - 10, { color: C.blueInk, font: '600 11px "IBM Plex Mono", monospace' });
  };

  SE.scenes.gate = Gate;
})(globalThis.SE);
