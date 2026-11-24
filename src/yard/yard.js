/*
 * The build yard: the screen every Act I job is played on.
 *
 *   var yard = new SE.yard.Yard({
 *     design: { parts: [...] },        // pre-placed parts (locked ones can't move)
 *     site: { g: 9.81, floor: 'concrete' },
 *     bin: [{ type: 'crate', count: 1, dials: { mass: '50 kg' }, label }]   // kit (handheld)
 *          | 'library',                // every part in SE.yard.library(unlocked) (manual)
 *     goal: fn(s),  timeout: 20,       // see judge.js; null = free play
 *     readouts: ['cart.speed', ...],   // which gauges show by default (all if omitted)
 *     ghosts: [{ type, x, y, angle, text }],   // outlines that say where a part goes
 *     camera: { center: {x, y}, zoom } | { fit: { lo, hi } },
 *     poke: true,                      // drag bodies with the mouse while it runs
 *     overlays: { forces: false, weights: false, fbd: null }
 *   });
 *   yard.mount(stageEl, inspectorEl);  // stage gets canvas + bar + bin + strip
 *   yard.on('change' | 'place' | 'dial' | 'select' | 'run' | 'result' | 'break' | 'frame', fn)
 *   yard.run(); yard.pause(); yard.stepOnce(); yard.reset();
 *   yard.design (live), yard.built (current world), yard.lastResult
 *
 * Edit mode (before Run, or after Reset): pick a part in the bin, click the
 * canvas to place it; a connector (cable, push, gauge) takes a click on each
 * end. Click a part to select it and set its dials in the inspector; drag to
 * move, R / Shift+R to rotate, Delete to remove. Wheel zooms, right- or
 * middle-drag pans (or Space + drag).
 * Run mode: the world steps at 60 Hz; the goal is checked every step. Drag
 * a body to poke it if the job allows. Reset rebuilds the design at t = 0.
 *
 * Nothing touches the DOM until mount(), so this file loads in Node.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard = SE.yard || {};
  var D = Y.dial;

  function Yard(opts) {
    this.opts = opts = opts || {};
    this.design = Y.cloneDesign(opts.design || { parts: [] });
    this.site = opts.site || {};
    this.goal = opts.goal || null;
    this.timeout = opts.timeout || 30;
    this.listeners = {};
    this.selected = null;
    this.placing = null;        // { type, preset, stage: 0|1, a }
    this.mode = 'edit';         // edit | run | done
    this.units = Object.assign({}, opts.units || {});
    this.overlays = Object.assign({ forces: false, weights: false, contactForces: false, fbd: null }, opts.overlays || {});
    this.failedRuns = 0;
    this.runs = 0;
    this.lastResult = null;
    this.binSpec = opts.bin || [];
    this.used = {};
    this.rebuild();
  }

  Yard.prototype.on = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); return this; };
  Yard.prototype.off = function (t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(function (f) { return f !== fn; }); };
  Yard.prototype.emit = function (t, e) { (this.listeners[t] || []).slice().forEach(function (fn) { fn(e || {}); }); };

  /* -------------------------------------------------------------- model */
  Yard.prototype.rebuild = function () {
    this.built = Y.build(this.design, this.site);
    this.state = null;
    this.time = 0;
    if (this.stepper) this.stepper = null;
    return this.built;
  };
  Yard.prototype.inst = function (id) { return (this.design.parts || []).filter(function (p) { return p.id === id; })[0] || null; };
  Yard.prototype.ready = function () { return !this.built.errors.length; };

  // bin entries: [{ type, count, dials, label }]; count undefined = unlimited
  Yard.prototype.binEntries = function () {
    var spec = this.binSpec;
    if (spec === 'library') spec = (Y.library ? Y.library(this.opts.unlocked) : Y.partTypes()).map(function (t) { return { type: t }; });
    return spec.filter(function (e) { return Y.partDef(e.type); });
  };
  Yard.prototype.remaining = function (entry, i) {
    if (entry.count == null) return Infinity;
    return entry.count - (this.used[i] || 0);
  };

  Yard.prototype.addPart = function (type, props, binIndex) {
    var inst = Y.makeInstance(type, props);
    this.design.parts.push(inst);
    if (binIndex != null) { inst.bin = binIndex; this.used[binIndex] = (this.used[binIndex] || 0) + 1; }
    this.changed('place', { part: inst });
    this.select(inst.id);
    return inst;
  };
  Yard.prototype.removePart = function (id) {
    var inst = this.inst(id); if (!inst || inst.locked) return false;
    if (inst.bin != null) this.used[inst.bin] = Math.max(0, (this.used[inst.bin] || 0) - 1);
    // connectors that hang off it go too
    var gone = [id];
    this.design.parts = this.design.parts.filter(function (p) {
      var hit = p.id === id || (p.a && p.a.part === id) || (p.b && p.b.part === id);
      if (hit && p.id !== id) gone.push(p.id);
      return !hit;
    });
    if (gone.indexOf(this.selected) >= 0) this.selected = null;
    this.changed('remove', { ids: gone });
    return true;
  };
  Yard.prototype.setDial = function (id, key, text) {
    var inst = this.inst(id); if (!inst) return;
    inst.dials[key] = text;
    this.changed('dial', { part: inst, key: key, text: text });
  };
  Yard.prototype.movePart = function (id, x, y, angle) {
    var inst = this.inst(id); if (!inst || inst.locked) return;
    inst.x = x; inst.y = y; if (angle != null) inst.angle = angle;
    this.changed('move', { part: inst });
  };
  Yard.prototype.changed = function (type, e) {
    if (this.mode !== 'edit') this.reset(true);
    this.rebuild();
    this.emit(type, e);
    this.emit('change', { type: type });
    this.refreshPanels();
  };
  Yard.prototype.select = function (id) {
    this.selected = id;
    this.emit('select', { part: id ? this.inst(id) : null });
    this.refreshInspector();
  };

  /* ------------------------------------------------------------ running */
  Yard.prototype.run = function () {
    if (!this.ready()) { this.flash(this.built.errors[0].error); this.emit('blocked', { errors: this.built.errors }); return false; }
    if (this.mode === 'done') this.reset(true);
    if (this.mode === 'edit') {
      this.rebuild();
      this.state = new Y.State(this.built, 1 / 60);
      var self = this;
      this.built.world.on('break', function (e) { self.emit('break', e); SE.audio && SE.audio.play && SE.audio.play('snap'); });
      this.stepper = new SE.phys.Stepper(this.built.world, { dt: 1 / 60, maxSteps: 8 });
      this.stepper.timeScale = this.timeScale || 1;
      this.runs++;
      this.acc = 0;
      this.mode = 'run';
      this.placing = null;
      this.emit('run', { runs: this.runs });
    } else if (this.stepper) this.stepper.resume();
    this.refreshBar();
    return true;
  };
  Yard.prototype.pause = function () { if (this.stepper) this.stepper.pause(); this.refreshBar(); };
  Yard.prototype.stepOnce = function () {
    if (this.mode === 'edit' && !this.run()) return;
    if (this.stepper) { this.stepper.pause(); this.stepper.stepOnce(); this.afterStep(); }
    this.refreshBar();
  };
  Yard.prototype.reset = function (silent) {
    this.mode = 'edit';
    this.stepper = null;
    this.endPoke();
    this.rebuild();
    if (!silent) { this.emit('reset', {}); this.refreshPanels(); }
  };
  Yard.prototype.afterStep = function () {
    var s = this.state; if (!s) return;
    s.tick();
    this.emit('step', { state: s });
    if (!this.goal || this.mode !== 'run') return;
    var v = Y.verdict(this.goal(s));
    if (!v && s.t >= this.timeout) v = { pass: false, reason: this.opts.timeoutText || 'Time ran out before the job was done.' };
    if (v) this.finish(v);
  };
  Yard.prototype.finish = function (v) {
    this.mode = 'done';
    // a failed run keeps going a little so the player sees what happened
    this.lingerUntil = v.pass ? 0 : this.state.t + (this.opts.linger == null ? 2 : this.opts.linger);
    if (this.stepper && v.pass) this.stepper.pause();
    if (!v.pass) this.failedRuns++;
    this.lastResult = { pass: v.pass, reason: v.reason || '', time: this.state.t, state: this.state, failedRuns: this.failedRuns, runs: this.runs };
    SE.audio && SE.audio.play && SE.audio.play(v.pass ? 'good' : 'bad');
    this.emit('result', this.lastResult);
    this.refreshBar();
  };
  // Advance real time (called each animation frame).
  Yard.prototype.tick = function (seconds) {
    if (this.mode === 'done' && this.stepper && !this.stepper.paused) {
      this.stepper.advance(seconds);
      if (this.built.world.time >= this.lingerUntil) this.stepper.pause();
      return this;
    }
    if (this.mode !== 'run' || !this.stepper || this.stepper.paused) return;
    var self = this, dt = this.stepper.dt || 1 / 60;
    // step one at a time so the goal sees every step, even at 4x
    this.acc = (this.acc || 0) + seconds * (this.stepper.timeScale || 1);
    var n = 0, maxSteps = 8 * Math.max(1, this.stepper.timeScale || 1);
    while (this.acc >= dt - 1e-12 && this.mode === 'run' && n < maxSteps) {
      this.stepper.stepOnce(); this.acc -= dt; n++;
      this.afterStep();
    }
    if (n >= maxSteps) this.acc = 0;           // too slow to keep up: run slower instead of spiralling
    if (this.state && !this.goal && this.state.t >= 600) this.pause();
    return self;
  };

  /* ------------------------------------------------------------ the DOM */
  Yard.prototype.mount = function (stageEl, inspectorEl) {
    var el = SE.ui.el, btn = SE.ui.button, self = this;
    this.root = stageEl; this.inspectorEl = inspectorEl || null;
    SE.ui.clear(stageEl);
    stageEl.classList.add('yard');
    this.canvas = el('canvas', { class: 'yard-canvas', 'aria-label': 'Build yard. Place parts, then press Run.', tabindex: '0' });
    this.toastEl = el('div', { class: 'yard-flash' });
    this.barEl = el('div', { class: 'yard-bar' });
    this.binEl = el('div', { class: 'yard-bin', role: 'toolbar', 'aria-label': 'Parts bin' });
    this.stripEl = el('div', { class: 'yard-strip', 'aria-live': 'off' });
    stageEl.appendChild(this.barEl);
    stageEl.appendChild(el('div', { class: 'yard-view' }, [this.canvas, this.toastEl]));
    stageEl.appendChild(this.binEl);
    stageEl.appendChild(this.stripEl);
    this.ctx = this.canvas.getContext('2d');
    this.cam = new SE.phys.Camera({ center: { x: 0, y: 3 }, zoom: 40, canvas: this.canvas });
    this.bindPointer();
    this.refreshPanels();
    this.fitView();
    this.lastFrame = 0;
    var loop = function (ts) {
      if (self.dead) return;
      var dtReal = self.lastFrame ? Math.min(0.1, (ts - self.lastFrame) / 1000) : 0;
      self.lastFrame = ts;
      self.tick(dtReal);
      self.draw();
      self.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onResize = function () { self.cam.resize(); };
    window.addEventListener('resize', this.onResize);
    setTimeout(function () { self.cam.resize(); self.fitView(); }, 0);
  };
  Yard.prototype.unmount = function () {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
  };

  Yard.prototype.fitView = function () {
    if (!this.cam) return;
    var c = this.opts.camera;
    this.cam.resize();
    if (c && c.center) { this.cam.center = { x: c.center.x, y: c.center.y }; this.cam.zoom = c.zoom || 40; return; }
    var box = (c && c.fit) || this.designBounds();
    this.cam.fit(box, 40);
  };
  Yard.prototype.designBounds = function () {
    var lo = { x: -4, y: -0.5 }, hi = { x: 4, y: 4 };
    var pts = (this.design.parts || []).filter(function (p) { var d = Y.partDef(p.type); return d && !d.connector; });
    (this.opts.ghosts || []).forEach(function (g) { pts.push(g); });
    pts.forEach(function (p) {
      var d = Y.partDef(p.type), sz = d && p.id ? Y.sizeOf(p) : (d ? d.size : { w: 1, h: 1 }), w = (p.w || sz.w || 1) / 2, h = (p.h || sz.h || 1) / 2;
      lo.x = Math.min(lo.x, p.x - w); hi.x = Math.max(hi.x, p.x + w);
      lo.y = Math.min(lo.y, p.y - h); hi.y = Math.max(hi.y, p.y + h + 1);
    });
    return { lo: lo, hi: hi };
  };

  Yard.prototype.flash = function (msg, kind) {
    if (!this.toastEl) return;
    var t = this.toastEl;
    t.textContent = msg; t.className = 'yard-flash show ' + (kind || 'warn');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(function () { t.className = 'yard-flash'; }, 3200);
  };

  Yard.prototype.refreshPanels = function () { if (!this.root) return; this.refreshBar(); this.refreshBin(); this.refreshInspector(); this.refreshStrip(); };

  Yard.prototype.refreshBar = function () {
    if (!this.barEl) return;
    var el = SE.ui.el, btn = SE.ui.button, self = this, bar = SE.ui.clear(this.barEl);
    var running = this.mode === 'run' && this.stepper && !this.stepper.paused;
    bar.appendChild(btn(running ? '❚❚ Pause' : (this.mode === 'run' ? '▶ Resume' : '▶ Run'), function () { running ? self.pause() : self.run(); }, 'primary small yard-run'));
    bar.appendChild(btn('Step', function () { self.stepOnce(); }, 'secondary small', { title: 'Advance one 1/60 s step' }));
    bar.appendChild(btn('↺ Reset', function () { self.reset(); }, 'secondary small', { disabled: this.mode === 'edit' ? 'disabled' : null }));
    var speed = el('select', { class: 'yard-speed', title: 'Simulation speed', onchange: function () { self.timeScale = Number(speed.value); if (self.stepper) self.stepper.timeScale = self.timeScale; } },
      [['0.25', '¼×'], ['0.5', '½×'], ['1', '1×'], ['2', '2×'], ['4', '4×']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    speed.value = String(this.timeScale || 1);
    bar.appendChild(speed);
    var ov = function (key, label) {
      var cb = el('input', { type: 'checkbox', onchange: function () { self.overlays[key] = cb.checked; } });
      cb.checked = !!self.overlays[key];
      return el('label', { class: 'yard-toggle' }, [cb, el('span', { text: label })]);
    };
    bar.appendChild(ov('forces', 'forces'));
    bar.appendChild(ov('weights', 'weights'));
    bar.appendChild(this.clockEl = el('span', { class: 'yard-clock mono' }));
    if (!this.ready() && this.mode === 'edit') bar.appendChild(el('span', { class: 'yard-err', text: '⚠ ' + this.built.errors[0].error }));
  };

  Yard.prototype.refreshBin = function () {
    if (!this.binEl) return;
    var el = SE.ui.el, self = this, bin = SE.ui.clear(this.binEl);
    var entries = this.binEntries();
    if (!entries.length) { this.binEl.style.display = 'none'; return; }
    this.binEl.style.display = '';
    var groups = {};
    entries.forEach(function (e, i) {
      var d = Y.partDef(e.type);
      var left = self.remaining(e, self.binSpec === 'library' ? null : i);
      var cat = d.category;
      if (!groups[cat]) { groups[cat] = el('div', { class: 'bin-group' }, [el('span', { class: 'bin-cat', text: cat })]); bin.appendChild(groups[cat]); }
      var active = self.placing && self.placing.entry === e;
      var b = el('button', {
        class: 'bin-part' + (active ? ' active' : '') + (left <= 0 ? ' empty' : ''),
        title: d.blurb || d.name, disabled: left <= 0 || self.mode !== 'edit' ? 'disabled' : null,
        onclick: function () { self.startPlacing(e, self.binSpec === 'library' ? null : i); }
      }, [el('span', { class: 'bin-name', text: e.label || d.name }), isFinite(left) ? el('span', { class: 'bin-count', text: '×' + left }) : null]);
      groups[cat].appendChild(b);
    });
  };

  Yard.prototype.startPlacing = function (entry, binIndex) {
    if (this.placing && this.placing.entry === entry) { this.placing = null; this.refreshBin(); return; }
    var d = Y.partDef(entry.type);
    this.placing = { entry: entry, binIndex: binIndex, def: d, stage: 0 };
    this.flash(d.connector ? (d.attach ? 'Click the part to clip the ' + d.name.toLowerCase() + ' onto.' : 'Click the first end of the ' + d.name.toLowerCase() + ' (an anchor point).') : 'Click in the yard to place the ' + d.name.toLowerCase() + '.', 'info');
    this.refreshBin();
    if (this.canvas) this.canvas.focus();
  };

  Yard.prototype.refreshInspector = function () {
    var box = this.inspectorEl; if (!box) return;
    var el = SE.ui.el, btn = SE.ui.button, self = this;
    SE.ui.clear(box);
    var inst = this.selected && this.inst(this.selected);
    if (!inst) {
      box.appendChild(el('div', { class: 'insp-empty muted small', text: this.mode === 'edit' ? 'Click a part to set it up. Pick one from the bin to add it.' : 'Reset to change the build.' }));
      return;
    }
    var d = Y.partDef(inst.type), errs = this.built.errors.filter(function (e) { return e.part === inst.id; });
    box.appendChild(el('div', { class: 'insp-head' }, [el('b', { text: inst.label || d.name }), el('span', { class: 'insp-cat', text: d.category })]));
    if (d.blurb) box.appendChild(el('div', { class: 'insp-blurb small', text: d.blurb }));
    var plate = d.plate ? d.plate(inst, this.built.parts[inst.id]) : null;
    if (inst.plate) plate = (plate || []).concat(inst.plate);
    if (plate && plate.length) box.appendChild(el('div', { class: 'insp-plate mono' }, plate.map(function (l) { return el('div', { text: l }); })));
    d.dials.forEach(function (dl) {
      var fixed = inst.locked && !(inst.open || []).includes(dl.key) || (inst.fixed || []).indexOf(dl.key) >= 0 || dl.locked;
      if (inst.hide && inst.hide.indexOf(dl.key) >= 0) return;
      var err = errs.filter(function (e) { return e.key === dl.key; })[0];
      var input;
      if (dl.choice) {
        input = el('select', { disabled: fixed ? 'disabled' : null, onchange: function () { self.setDial(inst.id, dl.key, input.value); } },
          dl.choice.map(function (c) { var m = SE.phys.MATERIALS[c]; return el('option', { value: c, text: (m && m.label) || c }); }));
        input.value = inst.dials[dl.key];
      } else {
        input = el('input', { type: 'text', class: 'dial-input mono', value: inst.dials[dl.key] == null ? '' : inst.dials[dl.key],
          placeholder: dl.optional ? 'as rigged' : D.QUANTITIES[dl.q || 'number'].examples, disabled: fixed ? 'disabled' : null, spellcheck: 'false',
          'aria-label': dl.label });
        var commit = function () { if (input.value !== inst.dials[dl.key]) self.setDial(inst.id, dl.key, input.value); };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { commit(); e.preventDefault(); } e.stopPropagation(); });
      }
      box.appendChild(el('label', { class: 'dial' + (err ? ' bad' : '') + (fixed ? ' fixed' : '') }, [
        el('span', { class: 'dial-label', text: dl.label }), input,
        err ? el('span', { class: 'dial-err small', text: err.error }) : null
      ]));
    });
    errs.filter(function (e) { return !e.key; }).forEach(function (e) { box.appendChild(el('div', { class: 'dial-err small', text: e.error })); });
    if (!inst.locked && this.mode === 'edit') {
      box.appendChild(el('div', { class: 'btn-row' }, [
        d.connector ? null : btn('⟲ Rotate', function () { self.movePart(inst.id, inst.x, inst.y, (inst.angle || 0) + Math.PI / 12); }, 'ghost small'),
        btn('Remove', function () { self.removePart(inst.id); }, 'ghost small danger')
      ]));
    }
  };

  Yard.prototype.readoutList = function () {
    var want = this.opts.readouts;
    var all = this.built.readouts;
    if (!want) return all;
    return want.map(function (id) { return all.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
  };
  Yard.prototype.refreshStrip = function () {
    if (!this.stripEl) return;
    var el = SE.ui.el, self = this, strip = SE.ui.clear(this.stripEl);
    this.gaugeEls = [];
    this.readoutList().forEach(function (r) {
      var val = el('span', { class: 'gauge-val mono' });
      var unit = el('input', { class: 'gauge-unit mono', value: self.units[r.id] || '', placeholder: D.QUANTITIES[r.q] ? D.QUANTITIES[r.q].si : '', title: 'Show this gauge in any ' + r.q + ' unit', spellcheck: 'false',
        onchange: function () { var u = unit.value.trim(); if (!u || SE.units.unitInfo(u)) { self.units[r.id] = u; unit.classList.remove('bad'); } else unit.classList.add('bad'); } });
      unit.addEventListener('keydown', function (e) { e.stopPropagation(); });
      strip.appendChild(el('div', { class: 'gauge' }, [el('span', { class: 'gauge-label', text: r.partLabel + ' ' + r.label }), val, unit]));
      self.gaugeEls.push({ r: r, val: val });
    });
  };
  Yard.prototype.readText = function (r) {
    var v;
    // look the gauge up in the current build: Run and Reset make a fresh world
    var cur = this.built.readouts.filter(function (x) { return x.id === r.id; })[0];
    if (!cur) return '—';
    try { v = cur.read(this.built.world); } catch (e) { v = NaN; }
    var u = this.units[r.id];
    try { return D.format(v, u || D.autoUnit(v, r.q), 3, r.q); } catch (e) { return D.format(v, D.autoUnit(v, r.q), 3, r.q); }
  };

  /* --------------------------------------------------------- pointer */
  Yard.prototype.pointerWorld = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return this.cam.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  Yard.prototype.partAt = function (p) {
    var w = this.built.world;
    for (var i = w.bodies.length - 1; i >= 0; i--) {
      var b = w.bodies[i];
      if (b === this.built.ground || !b.userData || !b.userData.part) continue;
      if (b.containsPoint(p)) return b.userData.part;
    }
    // connectors: near their line
    var best = null, bd = 6 / this.cam.zoom;
    var self = this;
    Object.keys(this.built.parts).forEach(function (id) {
      var bp = self.built.parts[id];
      if (!bp.def.connector) return;
      var seg = self.connectorSegment(bp);
      if (!seg) return;
      var dd = segDist(p, seg[0], seg[1]);
      if (dd < bd) { bd = dd; best = id; }
    });
    if (best) return best;
    // parts with no body of their own (a site marker, a stopwatch): their size box
    (this.design.parts || []).forEach(function (inst) {
      var d = Y.partDef(inst.type), bp = self.built.parts[inst.id];
      if (best || !d || d.connector || inst.x == null || (bp && bp.body)) return;
      var sz = Y.sizeOf(inst);
      if (Math.abs(p.x - inst.x) <= sz.w / 2 && Math.abs(p.y - inst.y) <= sz.h / 2) best = inst.id;
    });
    return best;
  };
  Yard.prototype.connectorSegment = function (bp) {
    var j = bp.joint;
    if (j && j.anchorA) return [j.anchorA(), j.anchorB()];
    if (bp.target) return [bp.target.c, bp.target.c];
    return null;
  };
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  Yard.prototype.nearestAnchor = function (p, maxPx) {
    var best = null, bd = (maxPx || 14) / this.cam.zoom;
    Y.anchorsOf(this.design).forEach(function (a) {
      var dd = Math.hypot(a.x - p.x, a.y - p.y);
      if (dd < bd) { bd = dd; best = a; }
    });
    return best;
  };
  Yard.prototype.snap = function (v) { var g = this.opts.grid || 0.1; return Math.round(v / g) * g; };

  Yard.prototype.bindPointer = function () {
    var self = this, c = this.canvas, drag = null, space = false;
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = c.getBoundingClientRect();
      self.cam.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('pointerdown', function (e) {
      c.focus();
      var p = self.pointerWorld(e);
      if (e.button === 1 || e.button === 2 || space) { drag = { kind: 'pan', x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); return; }
      if (self.mode !== 'edit') {
        if (self.opts.poke !== false) self.startPoke(p);
        drag = { kind: 'poke' }; c.setPointerCapture(e.pointerId);
        return;
      }
      if (self.placing) { self.placeClick(p); return; }
      var id = self.partAt(p);
      self.select(id);
      var inst = id && self.inst(id);
      if (inst && !inst.locked && !Y.partDef(inst.type).connector) {
        drag = { kind: 'move', id: id, dx: inst.x - p.x, dy: inst.y - p.y, moved: false };
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', function (e) {
      var p = self.pointerWorld(e);
      self.hover = p;
      if (!drag) return;
      if (drag.kind === 'pan') { self.cam.pan(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; return; }
      if (drag.kind === 'poke') { if (self.pokeJoint) self.pokeJoint.setTarget(p); return; }
      if (drag.kind === 'move') {
        var inst = self.inst(drag.id); if (!inst) return;
        inst.x = self.snap(p.x + drag.dx); inst.y = self.snap(p.y + drag.dy);
        self.restOnFloor(inst);
        drag.moved = true;
        self.rebuild();
      }
    });
    var up = function () {
      if (drag && drag.kind === 'move' && drag.moved) { var inst = self.inst(drag.id); self.changed('move', { part: inst }); }
      if (drag && drag.kind === 'poke') self.endPoke();
      drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    this.onKey = function (e) {
      if (document.activeElement !== c) return;
      if (e.key === ' ') { space = e.type === 'keydown'; e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      var inst = self.selected && self.inst(self.selected);
      if (e.key === 'Escape') { self.placing = null; self.refreshBin(); self.select(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && inst && self.mode === 'edit') { self.removePart(inst.id); e.preventDefault(); }
      else if ((e.key === 'r' || e.key === 'R') && inst && !inst.locked && self.mode === 'edit') { self.movePart(inst.id, inst.x, inst.y, (inst.angle || 0) + (e.shiftKey ? -1 : 1) * Math.PI / 12); }
      else if (e.key === 'Enter') { self.mode === 'run' && self.stepper && !self.stepper.paused ? self.pause() : self.run(); e.preventDefault(); }
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  };

  // Loads dropped below the floor sit on it instead.
  Yard.prototype.restOnFloor = function (inst) {
    var d = Y.partDef(inst.type);
    if (!this.site || this.site.floor === null || d.category === 'Site') return;
    var h = ((inst.id ? Y.sizeOf(inst) : d.size).h || 1) / 2;
    if (inst.y < h) inst.y = h;
  };

  Yard.prototype.placeClick = function (p) {
    var pl = this.placing, d = pl.def;
    var props = { dials: Object.assign({}, pl.entry.dials || {}) };
    if (pl.entry.label) props.label = pl.entry.label;
    if (!d.connector) {
      var g = this.ghostFor(d.type, p);
      props.x = g ? g.x : this.snap(p.x); props.y = g ? g.y : this.snap(p.y); props.angle = g && g.angle || 0;
      var tmp = Object.assign({ type: d.type }, props);
      if (!g) this.restOnFloor(tmp);
      props.x = tmp.x; props.y = tmp.y;
      this.addPart(d.type, props, pl.binIndex);
      this.donePlacing();
      return;
    }
    var end = this.endAt(p, d);
    if (!end) { this.flash(d.attach ? 'Click on a part to clip it to.' : 'Click on an anchor point (the small rings) or a part.', 'warn'); return; }
    if (d.attach) {
      props.a = end;
      this.addPart(d.type, props, pl.binIndex); this.donePlacing(); return;
    }
    if (pl.stage === 0) { pl.a = end; pl.stage = 1; this.flash('Now click the other end.', 'info'); return; }
    if (end.part === pl.a.part && end.anchor === pl.a.anchor && !end.at) { this.flash('Pick a different point for the other end.', 'warn'); return; }
    props.a = pl.a; props.b = end;
    this.addPart(d.type, props, pl.binIndex);
    this.donePlacing();
  };
  Yard.prototype.donePlacing = function () {
    var pl = this.placing; this.placing = null;
    if (pl && pl.entry && this.remaining(pl.entry, pl.binIndex) > 0 && pl.def.repeat) this.startPlacing(pl.entry, pl.binIndex);
    this.refreshBin();
  };
  // Which end does a click mean? an anchor ring, a part, or (ropes) a point on the ground/site
  Yard.prototype.endAt = function (p, d) {
    var a = this.nearestAnchor(p);
    if (a && d.attach) {
      // a click nearer the part's centre of mass than the anchor means the centre
      var ap = this.built.parts[a.part], cb = ap && ap.body;
      if (cb && Math.hypot(cb.c.x - p.x, cb.c.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y)) return { part: a.part };
    }
    if (a) return { part: a.part, anchor: a.anchor };
    var id = this.partAt(p);
    if (id && Y.partDef(this.inst(id).type).connector) id = null;
    if (id) {
      if (d.attach && d.attachCentre) return { part: id };
      if (d.attach && bp0(this, id) && Math.hypot(bp0(this, id).c.x - p.x, bp0(this, id).c.y - p.y) < 8 / this.cam.zoom) return { part: id };
      var bp = this.built.parts[id];
      if (bp && bp.body) { var loc = bp.body.localPoint(p); return { part: id, local: { x: Math.round(loc.x * 100) / 100, y: Math.round(loc.y * 100) / 100 } }; }
    }
    return null;
  };
  function bp0(y, id) { var bp = y.built.parts[id]; return bp && bp.body; }
  Yard.prototype.ghostFor = function (type, p) {
    var gs = (this.opts.ghosts || []).filter(function (g) { return g.type === type && !g.filled; });
    var best = null, bd = 1.5;
    gs.forEach(function (g) { var dd = Math.hypot(g.x - p.x, g.y - p.y); if (dd < bd) { bd = dd; best = g; } });
    return best;
  };

  Yard.prototype.startPoke = function (p) {
    var w = this.built.world;
    var body = null;
    for (var i = w.bodies.length - 1; i >= 0; i--) if (w.bodies[i].type === 'dynamic' && w.bodies[i].containsPoint(p)) { body = w.bodies[i]; break; }
    if (!body) return;
    this.pokeJoint = new SE.phys.MouseJoint({ body: body, target: p, maxForce: (this.opts.pokeForce || 400) * body.m });
    w.addJoint(this.pokeJoint);
    if (this.state) this.state.poked = true;
    this.emit('poke', { body: body });
  };
  Yard.prototype.endPoke = function () {
    if (this.pokeJoint && this.built) this.built.world.removeJoint(this.pokeJoint);
    this.pokeJoint = null;
  };

  /* --------------------------------------------------------- drawing */
  Yard.prototype.draw = function () {
    var ctx = this.ctx, cam = this.cam, self = this, world = this.built.world;
    cam.resize();
    SE.phys.debugDraw(ctx, world, cam, {
      clear: true, grid: true, shapes: true, joints: true, stress: true, labels: true,
      forces: this.overlays.forces, weights: this.overlays.weights, contactForces: this.overlays.contactForces,
      highlight: this.selected && this.built.parts[this.selected] ? this.built.parts[this.selected].body : null,
      forceUnit: this.units.forces || 'N'
    });
    cam.apply(ctx);
    // part art and hooks
    Object.keys(this.built.parts).forEach(function (id) {
      var bp = self.built.parts[id];
      if (bp.def.draw) { try { bp.def.draw(ctx, cam, bp, self); } catch (e) { /* keep drawing the rest */ } }
    });
    if (this.overlays.fbd && this.built.parts[this.overlays.fbd]) {
      var body = this.built.parts[this.overlays.fbd].body;
      if (body) SE.phys.debugDrawFreeBody(ctx, SE.phys.sensors.freeBody(world, body).forces, cam, { maxLength: 90 });
    }
    // ghosts
    (this.opts.ghosts || []).forEach(function (g) {
      if (g.filled || self.mode !== 'edit') return;
      var d = Y.partDef(g.type), w = g.w || (d ? d.size.w : 1), h = g.h || (d ? d.size.h : 1);
      var a = cam.worldToScreen({ x: g.x - w / 2, y: g.y + h / 2 });
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(230,180,34,.85)'; ctx.lineWidth = 2;
      ctx.strokeRect(a.x, a.y, w * cam.zoom, h * cam.zoom);
      if (g.text) { ctx.setLineDash([]); ctx.fillStyle = 'rgba(230,180,34,.95)'; ctx.font = '12px "IBM Plex Mono", monospace'; ctx.fillText(g.text, a.x, a.y - 6); }
      ctx.restore();
    });
    // anchors while wiring a connector
    if (this.mode === 'edit' && this.placing && this.placing.def.connector && !this.placing.def.attach) {
      Y.anchorsOf(this.design).forEach(function (an) {
        var s = cam.worldToScreen(an);
        ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.strokeStyle = '#e6b422'; ctx.lineWidth = 2; ctx.stroke();
      });
      if (this.placing.stage === 1 && this.hover) {
        var A = Y.resolveEnd(this.built, this.placing.a), sa = cam.worldToScreen(A.world), sb = cam.worldToScreen(this.hover);
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#e6b422'; ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke(); ctx.restore();
      }
    }
    // placing preview
    if (this.mode === 'edit' && this.placing && !this.placing.def.connector && this.hover) {
      var d = this.placing.def, gp = this.ghostFor(d.type, this.hover) || { x: this.snap(this.hover.x), y: this.snap(this.hover.y) };
      var tl = cam.worldToScreen({ x: gp.x - d.size.w / 2, y: gp.y + d.size.h / 2 });
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#a7a29a'; ctx.fillRect(tl.x, tl.y, d.size.w * cam.zoom, d.size.h * cam.zoom); ctx.restore();
    }
    // errors on parts
    this.built.errors.forEach(function (e) {
      var inst = self.inst(e.part); if (!inst || inst.x == null) return;
      var s = cam.worldToScreen({ x: inst.x, y: inst.y });
      ctx.fillStyle = '#a8321f'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('⚠', s.x - 6, s.y + 6);
    });
    // clock and gauges
    if (this.clockEl) this.clockEl.textContent = 't = ' + world.time.toFixed(2) + ' s';
    (this.gaugeEls || []).forEach(function (g) { g.val.textContent = self.readText(g.r); });
    this.emit('frame', { ctx: ctx, cam: cam });
  };

  Y.Yard = Yard;
})(globalThis.SE);
