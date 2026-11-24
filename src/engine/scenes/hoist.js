/*
 * Hoist scene: a gantry with a winch lifting a load on a cable.
 *
 * Physics (load treated as a particle, cable massless):
 *   net upward force  F = T - m g_local
 *   acceleration      a = F / m                      (Eq. 1-1)
 *   the cable breaks when T exceeds its rated strength.
 * The winch "governor" holds a set cable tension T. With T equal to the true
 * weight the load hovers (a = 0, the statics case); any error makes it drift
 * or slam, and the size of the error decides how violently.
 *
 * Params:
 *   mass (kg), g (m/s^2), label, governor (N, the player's setting),
 *   rating (N, cable strength), height (m, top of gantry), mode:
 *   'lift' (start on ground, raise to hookHeight) | 'hover' (start in the
 *   air, hold position), hookHeight, scaleReadout (show spring scale),
 *   units ('SI' | 'FPS') for readouts, hideKey (manual mode: hide g and W so
 *   a test run does not hand over the answer).
 */
(function (SE) {
  'use strict';
  var D = SE.draw, C = D.C;

  function Hoist() {}

  Hoist.prototype.init = function (stage, p) {
    this.stage = stage;
    this.p = Object.assign({ mass: 100, g: 9.81, governor: null, rating: Infinity, height: 9, hookHeight: 4, mode: 'lift', label: '', units: 'SI', showVectors: true, zombies: 3, crateSize: 1.2 }, p);
    this.reset();
  };

  Hoist.prototype.reset = function () {
    var p = this.p;
    this.y = p.mode === 'hover' ? p.hookHeight : 0;   // load bottom height (m)
    this.v = 0; this.a = 0;
    this.T = 0;
    this.state = 'idle';          // idle | running | snapped | landed | stalled | slammed | holding
    this.events = [];
    this.time = 0;
    this.cableTension = p.mode === 'hover' ? p.mass * p.g : 0;
    this.drumAngle = 0;
    this.broken = false;
    this.zombieX = [];
    for (var i = 0; i < p.zombies; i++) this.zombieX.push(-2 - i * 1.7 - Math.random());
    this.maxSpeed = 0;
  };

  Hoist.prototype.resize = function (w, h) {
    var scale = Math.min(w / 16, (h - 70) / (this.p.height + 2.5));
    this.cam = new SE.Camera({ scale: scale, ox: w * 0.5, oy: h - 46 });
  };

  /*
   * Start a run with tension T (N). Returns a promise resolving with
   * { outcome, detail } once the motion settles or a failure happens.
   * opts.duration: simulated seconds to watch (default 6).
   */
  Hoist.prototype.run = function (T, opts) {
    opts = opts || {};
    var self = this;
    this.reset();
    this.T = T;
    this.state = 'running';
    this.duration = opts.duration || 6;
    if (T > this.p.rating) this.snapAt = 0.35; else this.snapAt = null;
    return new Promise(function (resolve) { self.resolve = resolve; });
  };

  Hoist.prototype.finish = function (outcome, detail) {
    if (this.resolve) { var r = this.resolve; this.resolve = null; setTimeout(function () { r({ outcome: outcome, detail: detail }); }, 700); }
  };

  Hoist.prototype.step = function (dt) {
    var p = this.p;
    this.time += dt;
    // zombies drift toward the gantry for atmosphere
    for (var i = 0; i < this.zombieX.length; i++) this.zombieX[i] += dt * 0.12;
    if (this.state !== 'running' && this.state !== 'falling') return;
    var W = p.mass * p.g;
    if (this.state === 'running') {
      // the motor ramps tension up over 0.3 s, like a real winch taking load.
      // In hover mode the brake was already holding the load, so there is no ramp.
      var ramp = p.mode === 'hover' ? 1 : Math.min(1, this.time / 0.3);
      var T = this.T * ramp;
      this.cableTension = T;
      if (this.snapAt != null && this.time >= this.snapAt) {
        this.state = 'falling'; this.broken = true; this.cableTension = 0;
        this.events.push('snap');
        this.stage.shake(14); this.stage.flash('rgba(255,230,180,ALPHA)', 0.5, 0.2);
        this.stage.burst(this.cam.x(0), this.cam.y(p.height - 0.6), { n: 40, color: '#ffd27a', speed: 380 });
        SE.audio && SE.audio.play('snap');
        return;
      }
      var onGround = this.y <= 0 && T < W;
      if (onGround) {
        this.a = 0; this.v = 0; this.y = 0;
        if (this.time > 1.2 && p.mode === 'lift') { this.state = 'stalled'; SE.audio && SE.audio.play('stall'); this.finish('stalled', { T: T, W: W }); }
        return;
      }
      this.a = (T - W) / p.mass;
      this.v += this.a * dt;
      this.y += this.v * dt;
      this.drumAngle += this.v * dt * 3;
      this.maxSpeed = Math.max(this.maxSpeed, Math.abs(this.v));
      var top = p.height - 1.1 - p.crateSize;
      if (this.y >= top) {
        this.y = top; var impact = this.v; this.v = 0;
        this.state = 'slammed'; this.events.push('slam');
        this.stage.shake(Math.min(20, 4 + impact * 3));
        this.stage.burst(this.cam.x(0), this.cam.y(top + p.crateSize), { n: 30, color: '#ffb04a', speed: 260 });
        SE.audio && SE.audio.play('clang');
        this.finish('slammed', { T: T, W: W, impact: impact });
        return;
      }
      if (this.y <= 0 && this.v < 0) {
        var hit = this.v; this.y = 0; this.v = 0;
        if (p.mode === 'hover') {
          this.state = 'landed'; this.stage.shake(Math.min(18, 3 + Math.abs(hit) * 3));
          this.stage.burst(this.cam.x(0), this.cam.y(0), { n: 26, color: '#a08870', kind: 'dust', speed: 160, gravity: -20 });
          SE.audio && SE.audio.play('thud');
          this.finish('dropped', { T: T, W: W, impact: hit });
          return;
        }
      }
      if (this.time >= this.duration) {
        this.state = 'holding';
        var drift = Math.abs(this.y - (p.mode === 'hover' ? p.hookHeight : 0));   // distance from where the load started
        this.finish(Math.abs(this.a) < 1e-9 || Math.abs(this.v) < 0.02 ? 'held' : 'drifting', { T: T, W: W, a: this.a, v: this.v, drift: drift, y: this.y });
      }
    } else if (this.state === 'falling') {
      this.a = -p.g; this.v += this.a * dt; this.y += this.v * dt;
      if (this.y <= 0) {
        var impact2 = this.v; this.y = 0; this.v = 0; this.state = 'crashed';
        this.stage.shake(22); this.stage.flash('rgba(255,120,80,ALPHA)', 0.35, 0.35);
        this.stage.burst(this.cam.x(0), this.cam.y(0), { n: 50, color: '#8a5a33', kind: 'debris', speed: 340 });
        this.stage.burst(this.cam.x(0), this.cam.y(0), { n: 30, color: '#a08870', kind: 'dust', speed: 140, gravity: -30 });
        SE.audio && SE.audio.play('crash');
        this.finish('snapped', { T: this.T, W: W, rating: p.rating, impact: impact2 });
      }
    }
  };

  // Sandbox controls: change the load, the local g and the winch tension,
  // then run the winch to see what that tension does.
  Hoist.prototype.controls = function () {
    var p = this.p;
    var W = p.mass * p.g;
    return [
      { key: 'mass', label: 'Load mass', min: 10, max: 2000, step: 10, value: p.mass, unit: 'kg' },
      { key: 'g', label: 'Local g', min: 1.6, max: 9.9, step: 0.01, value: p.g, unit: 'm/s²' },
      { key: 'tension', label: 'Winch tension', min: 0, max: Math.max(1000, Math.round(W * 2)), step: 1, value: this.T || p.governor || Math.round(W), unit: 'N' },
      { key: 'run', label: 'Run the winch ▸', type: 'button' }
    ];
  };

  Hoist.prototype.set = function (key, value) {
    var p = this.p;
    if (key === 'mass') { p.mass = value; p.label = value + ' kg'; this.reset(); }
    else if (key === 'g') { p.g = value; this.reset(); }
    else if (key === 'tension') { p.governor = value; }
    else if (key === 'run') { this.run(p.governor != null ? p.governor : p.mass * p.g); }
  };

  Hoist.prototype.readouts = function () {
    var p = this.p;
    return [(p.hideKey ? 'W = m g' : 'W = m g = ' + fmtForce(p.mass * p.g, p.units)), 'T = ' + fmtForce(this.cableTension, p.units), 'a = ' + this.a.toFixed(3) + ' m/s²'];
  };

  Hoist.prototype.draw = function (ctx, w, h, t) {
    var p = this.p, cam = this.cam;
    D.backdrop(ctx, w, h, t);
    D.ground(ctx, w, cam.y(0), 60);
    D.fence(ctx, 0, cam.y(0), w * 0.25, 34);
    // zombies outside the fence
    this.zombieX.forEach(function (zx, i) { var sx = cam.x(-7.5 + Math.min(zx, 1.5)); D.zombie(ctx, sx, cam.y(0), cam.len(1.75), t, i + 3); });

    // gantry
    var H = p.height, half = 2.4;
    ctx.save();
    ctx.strokeStyle = C.rustDark; ctx.lineWidth = Math.max(4, cam.len(0.18));
    ctx.fillStyle = D.rustPattern(ctx, C.rust, 5);
    [-half, half].forEach(function (sx) { ctx.fillRect(cam.x(sx) - cam.len(0.12), cam.y(H), cam.len(0.24), cam.len(H)); });
    ctx.fillRect(cam.x(-half - 0.3), cam.y(H), cam.len(2 * half + 0.6), cam.len(0.35));
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(122,52,24,0.9)';
    for (var k = 0; k < 4; k++) {
      var y0 = H * k / 4, y1 = H * (k + 1) / 4;
      [-half, half].forEach(function (sx) { D.sketchLine(ctx, cam.x(sx), cam.y(y0), cam.x(sx + (sx < 0 ? 0.6 : -0.6)), cam.y(y1), { passes: 1, wobble: 0.6 }); });
    }
    ctx.restore();
    D.hazardStripes(ctx, cam.x(-half - 0.3), cam.y(H) + cam.len(0.35), cam.len(2 * half + 0.6), 6);

    // winch drum on the right leg
    var dx = cam.x(half), dy = cam.y(1.4), dr = cam.len(0.45);
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(this.drumAngle);
    ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(0, 0, dr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.iron; ctx.lineWidth = 3;
    for (var s = 0; s < 4; s++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(s * Math.PI / 2) * dr, Math.sin(s * Math.PI / 2) * dr); ctx.stroke(); }
    ctx.restore();

    // pulley and cable
    var px = cam.x(0), py = cam.y(H - 0.35);
    var loadTop = this.y + p.crateSize;
    ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(px, py, cam.len(0.28), 0, Math.PI * 2); ctx.fill();
    var tension = this.cableTension;
    var stress = p.rating && isFinite(p.rating) ? Math.min(1, tension / p.rating) : 0;
    ctx.strokeStyle = this.broken ? 'rgba(200,200,200,0.4)' : (stress > 0.9 ? C.bad : '#d8d2c4');
    ctx.lineWidth = 2.5;
    if (!this.broken) {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cam.y(loadTop) - cam.len(0.25)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + cam.len(0.28), py); ctx.lineTo(dx, dy - dr); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + 10, py + 40, px - 6, py + 70); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, cam.y(loadTop)); ctx.quadraticCurveTo(px - 12, cam.y(loadTop) - 30, px + 8, cam.y(loadTop) - 60); ctx.stroke();
    }
    // hook
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(px, cam.y(loadTop) - cam.len(0.12), cam.len(0.12), -Math.PI * 0.2, Math.PI * 1.1); ctx.stroke();

    // the load
    var cw = cam.len(p.crateSize * 1.15), ch = cam.len(p.crateSize);
    D.crate(ctx, px - cw / 2, cam.y(this.y), cw, ch, { label: p.label });

    // vectors (free-body style): tension up, weight down
    if (p.showVectors) {
      var cx = px + cw / 2 + 26, cy = cam.y(this.y + p.crateSize / 2);
      var W = p.mass * p.g;
      var ref = Math.max(W, tension, 1);
      var Ls = 70;
      if (!this.broken && tension > 0) D.arrow(ctx, cx, cy, cx, cy - Ls * tension / ref, C.force, 'T = ' + fmtForce(tension, p.units));
      D.arrow(ctx, cx + 34, cy, cx + 34, cy + Ls * W / ref, C.weight, 'W = ' + (p.hideKey ? '?' : fmtForce(W, p.units)), { ly: 20 });
    }
    // readout panel
    var lines = [
      'load  ' + p.label,
      'g     ' + (p.hideKey ? 'local (work it out)' : p.g.toFixed(4) + ' m/s²'),
      'a     ' + (this.a >= 0 ? '+' : '') + this.a.toFixed(3) + ' m/s²',
      'v     ' + (this.v >= 0 ? '+' : '') + this.v.toFixed(2) + ' m/s'
    ];
    if (isFinite(p.rating)) lines.push('cable ' + fmtForce(p.rating, p.units) + ' rated');
    if (this.T) lines.push('set   ' + fmtForce(this.T, p.units));
    readout(ctx, 12, 12, lines);
  };

  function fmtForce(N, units) {
    if (units === 'FPS') return SE.sigfig.roundSig(N / SE.units.LBF, 4).text + ' lb';
    if (Math.abs(N) >= 1e6) return SE.sigfig.roundSig(N / 1e6, 4).text + ' MN';
    if (Math.abs(N) >= 1e3) return SE.sigfig.roundSig(N / 1e3, 4).text + ' kN';
    if (Math.abs(N) < 1 && N !== 0) return SE.sigfig.roundSig(N * 1e3, 3).text + ' mN';
    return SE.sigfig.roundSig(N, 4).text + ' N';
  }

  function readout(ctx, x, y, lines) {
    ctx.save();
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    var w = 12 + Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }));
    ctx.fillStyle = 'rgba(15,12,10,0.78)';
    D.roundRect(ctx, x, y, w + 8, lines.length * 17 + 12, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(230,180,34,0.5)'; ctx.stroke();
    ctx.fillStyle = C.paper;
    lines.forEach(function (l, i) { ctx.fillText(l, x + 10, y + 20 + i * 17); });
    ctx.restore();
  }

  SE.scenes.hoist = Hoist;
  SE.sceneUtil = { fmtForce: fmtForce, readout: readout };
})(globalThis.SE);
