/*
 * Stage: owns the main canvas, the animation loop and a fixed-step physics
 * clock. A scene (see src/engine/scenes/) plugs into it:
 *
 *   scene.init(stage, params)   build state
 *   scene.step(dt)              advance physics by dt seconds (fixed 1/240 s)
 *   scene.draw(ctx, w, h, t)    render in CSS pixels
 *   scene.controls()            optional list of interactive controls
 *   scene.set(key, value)       optional parameter change from a control
 *   scene.pointer(evt)          optional mouse/touch interaction
 *
 * Physics always runs at the fixed step regardless of frame rate, so a
 * simulated outcome depends only on the inputs, never on the machine.
 */
(function (SE) {
  'use strict';

  var DT = 1 / 240;

  function Stage(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = null;
    this.t = 0;
    this.acc = 0;
    this.last = 0;
    this.timeScale = 1;
    this.shakeAmt = 0;
    this.particles = [];
    this.flashes = [];
    this.running = false;
    this.paused = false;
    this.reducedMotion = false;
    var self = this;
    this._frame = function (ts) { self.frame(ts); };
    this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', function () { self.resize(); });
      ['pointerdown', 'pointermove', 'pointerup', 'pointerleave'].forEach(function (type) {
        canvas.addEventListener(type, function (e) {
          if (!self.scene || !self.scene.pointer) return;
          var r = canvas.getBoundingClientRect();
          self.scene.pointer({ type: type, x: e.clientX - r.left, y: e.clientY - r.top, buttons: e.buttons });
        });
      });
    }
  }

  Stage.prototype.resize = function () {
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var r = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, r.width || 800);
    this.h = Math.max(240, r.height || 500);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    if (this.scene && this.scene.resize) this.scene.resize(this.w, this.h);
  };

  Stage.prototype.load = function (scene, params) {
    this.particles = []; this.flashes = []; this.shakeAmt = 0; this.timeScale = 1;
    this.scene = scene;
    if (scene) scene.init(this, params || {});
    if (scene && scene.resize) scene.resize(this.w, this.h);
    this.start();
    return scene;
  };

  Stage.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(this._frame);
  };
  Stage.prototype.stop = function () { this.running = false; };

  Stage.prototype.frame = function (ts) {
    if (!this.running) return;
    var dtReal = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    if (!this.paused) {
      this.acc += dtReal * this.timeScale;
      var steps = 0;
      while (this.acc >= DT && steps < 2000) {
        if (this.scene && this.scene.step) this.scene.step(DT);
        this.stepParticles(DT);
        this.acc -= DT; steps++;
      }
      this.t += dtReal;
    }
    this.render();
    requestAnimationFrame(this._frame);
  };

  // Advance a scene synchronously (used by tests and "skip animation").
  Stage.prototype.simulate = function (seconds) {
    var n = Math.round(seconds / DT);
    for (var i = 0; i < n; i++) if (this.scene && this.scene.step) this.scene.step(DT);
  };

  Stage.prototype.render = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.shakeAmt > 0.1 && !this.reducedMotion) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
      this.shakeAmt *= 0.9;
    } else this.shakeAmt = 0;
    if (this.scene) this.scene.draw(ctx, this.w, this.h, this.t);
    this.drawParticles(ctx);
    ctx.restore();
    for (var i = this.flashes.length - 1; i >= 0; i--) {
      var f = this.flashes[i];
      f.life -= 1 / 60;
      if (f.life <= 0) { this.flashes.splice(i, 1); continue; }
      ctx.fillStyle = f.color.replace('ALPHA', String(Math.max(0, f.life / f.max) * f.alpha));
      ctx.fillRect(0, 0, this.w, this.h);
    }
  };

  Stage.prototype.shake = function (amt) { this.shakeAmt = Math.max(this.shakeAmt, amt); };
  Stage.prototype.flash = function (color, alpha, dur) {
    if (this.reducedMotion) return;
    this.flashes.push({ color: color || 'rgba(255,255,255,ALPHA)', alpha: alpha || 0.4, life: dur || 0.25, max: dur || 0.25 });
  };

  // Particles: sparks, dust, debris. Positions in CSS pixels.
  Stage.prototype.burst = function (x, y, opts) {
    opts = opts || {};
    var n = opts.n || 20;
    for (var i = 0; i < n; i++) {
      var a = (opts.angle != null ? opts.angle : -Math.PI / 2) + (Math.random() - 0.5) * (opts.spread || Math.PI * 2);
      var sp = (opts.speed || 200) * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: (opts.life || 0.8) * (0.6 + Math.random() * 0.6), max: opts.life || 0.8,
        size: (opts.size || 3) * (0.5 + Math.random()), color: opts.color || '#ffcc66',
        g: opts.gravity == null ? 600 : opts.gravity, kind: opts.kind || 'spark', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10
      });
    }
  };

  Stage.prototype.stepParticles = function (dt) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.vx *= 0.995; p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  };

  Stage.prototype.drawParticles = function (ctx) {
    this.particles.forEach(function (p) {
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'debris') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); ctx.restore();
      } else if (p.kind === 'dust') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - a), 0, Math.PI * 2); ctx.fill();
      } else ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  };

  // Camera helper: maps world meters (x right, y up) to screen pixels.
  function Camera(opts) {
    this.scale = opts.scale || 60;    // px per meter
    this.ox = opts.ox || 0;           // screen x of world x = 0
    this.oy = opts.oy || 0;           // screen y of world y = 0 (ground)
  }
  Camera.prototype.x = function (wx) { return this.ox + wx * this.scale; };
  Camera.prototype.y = function (wy) { return this.oy - wy * this.scale; };
  Camera.prototype.len = function (m) { return m * this.scale; };
  Camera.prototype.wx = function (sx) { return (sx - this.ox) / this.scale; };
  Camera.prototype.wy = function (sy) { return (this.oy - sy) / this.scale; };

  // A promise that resolves when `cond()` turns true (checked every frame of
  // the physics clock) or after `timeout` simulated seconds.
  function waitFor(cond, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        if (cond()) return resolve(true);
        if (timeoutMs && Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, 30);
      })();
    });
  }

  SE.Stage = Stage;
  SE.Camera = Camera;
  SE.waitFor = waitFor;
  SE.PHYS_DT = DT;
})(globalThis.SE);
