/*
 * The yard's screen furniture, laid out the way well-known editors do it:
 *
 *   toolbar      ▶ Run / Step / Reset, speed, "Show" overlays (top, like a media bar)
 *   parts bin    a labelled palette down the left of the yard, grouped by
 *                category, with a search box for the full library
 *                (Algodoo, Scratch, Unity's project panel)
 *   canvas       the yard; hovering a part shows its name and what you can
 *                change; the objective is pinned top-left (a quest tracker)
 *   status bar   one line under the yard that says what a click does right
 *                now (Blender, Figma)
 *   readouts     "Live readouts": labelled meters measured by the simulation,
 *                read-only; click one to select its part (PhET meters)
 *   properties   the inspector: the selected part's dials as labelled fields,
 *                its live readings, and Rotate / Remove. With nothing
 *                selected it lists every part in the yard, so a part is one
 *                click away (Unity's Inspector + Hierarchy)
 *
 * Nothing touches the DOM until mount(), so this file loads in Node.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial, Yard = Y.Yard;
  if (!Yard) return;

  var ICONS = {
    surface: '▬', crate: '📦', cart: '🛒', hook: '⚓', push: '➜', cable: '〰', speedo: '⏲', block: '🧱', zone: '🎯',
    chain: '⛓', winch: '⚙', sheave: '◎', spring: '🌀', springscale: '⚖', balance: '⚖', loadcell: '⊕', weight: '🏋',
    counterweight: '⏚', pendulum: '🕰', post: '┃', board: '▭', jib: '🏗', gate: '🚪', latch: '⊸', ram: '⇔', tank: '🛢',
    site: '🌍', stopwatch: '⏱', tape: '📏', caliper: '📐', sled: '🛷', static: '▣'
  };
  var CAT_ICONS = { Loads: '📦', Forces: '➜', Rigging: '〰', Measure: '📏', Site: '🌍', Mechanisms: '⚙', Build: '🔩' };
  function iconOf(type) { var d = Y.partDef(type); return ICONS[type] || (d && CAT_ICONS[d.category]) || '▪'; }
  Y.iconOf = iconOf;

  function nameOf(inst) { var d = Y.partDef(inst.type); return inst.label || (d ? d.name : inst.type); }
  function article(s) { return /^[aeiou]/i.test(s) ? 'an ' + s : 'a ' + s; }

  /* -------------------------------------------------------------- mount */
  Yard.prototype.mount = function (stageEl, inspectorEl) {
    var el = SE.ui.el, self = this;
    this.root = stageEl; this.inspectorEl = inspectorEl || null;
    SE.ui.clear(stageEl);
    stageEl.classList.add('yard');
    this.touchUI = Yard.isTouch();
    if (this.touchUI) stageEl.classList.add('touch');
    this.canvas = el('canvas', { class: 'yard-canvas', 'aria-label': 'Build yard. Place parts, then press Run.', tabindex: '0' });
    this.toastEl = el('div', { class: 'yard-flash' });
    this.barEl = el('div', { class: 'yard-bar', role: 'toolbar', 'aria-label': 'Simulation controls' });
    this.binEl = el('div', { class: 'yard-bin', role: 'toolbar', 'aria-label': 'Parts bin' });
    this.stripEl = el('div', { class: 'yard-strip', 'aria-live': 'off' });
    this.statusEl = el('div', { class: 'yard-status', 'aria-live': 'polite' });
    this.objEl = el('div', { class: 'yard-objective', 'aria-live': 'polite' });
    this.coachEl = el('div', { class: 'yard-coach' });
    this.tipEl = el('div', { class: 'yard-tip', role: 'tooltip' });
    stageEl.appendChild(this.barEl);
    stageEl.appendChild(el('div', { class: 'yard-body' }, [
      this.binEl,
      el('div', { class: 'yard-view' }, [this.canvas, this.objEl, this.toastEl, this.tipEl, this.coachEl])
    ]));
    stageEl.appendChild(this.statusEl);
    stageEl.appendChild(this.stripEl);
    this.ctx = this.canvas.getContext('2d');
    this.cam = new SE.phys.Camera({ center: { x: 0, y: 3 }, zoom: 40, canvas: this.canvas });
    this.bindPointer();
    this.bindHover();
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
    this.renderObjective();
    if (!Yard.coachSeen() && !Yard.coachShown) { Yard.coachShown = true; this.showCoach(); }
  };

  Yard.prototype.refreshPanels = function () { if (!this.root) return; this.refreshBar(); this.refreshBin(); this.refreshInspector(); this.refreshStrip(); };

  /* ------------------------------------------------------ controls tour */
  Yard.coachSeen = function () { try { return localStorage.getItem('se.yard.coach') === '1'; } catch (e) { return true; } };
  Yard.prototype.showCoach = function () {
    if (!this.coachEl) return;
    var el = SE.ui.el, box = SE.ui.clear(this.coachEl);
    var tips = this.touchUI ? [
      ['🧰', 'Parts bin (under the yard).', 'Tap a part, then tap in the yard to place it.'],
      ['🔧', 'Properties (scroll down).', 'Tap any part in the yard to edit its mass, force and other dials. Type units: 240 kg, 2.5 kN.'],
      ['▶', 'Run (top).', 'The physics decides. Any build that meets the 🎯 objective counts.'],
      ['📟', 'Live readouts (bottom).', 'Meters the simulation measures while it runs. You read them; you don\'t type in them.'],
      ['✋', 'Move around.', 'Drag a part to move it. Drag empty yard to pan, pinch to zoom. Rotate and Remove are in Properties.']
    ] : [
      ['🧰', 'Parts bin (left).', 'Click a part, then click in the yard to place it.'],
      ['🔧', 'Properties (right).', 'Click any part in the yard to edit its mass, force and other dials there. Type units: 240 kg, 2.5 kN.'],
      ['▶', 'Run (top).', 'The physics decides. Any build that meets the 🎯 objective counts.'],
      ['📟', 'Live readouts (bottom).', 'Meters the simulation measures while it runs. You read them; you don\'t type in them.'],
      ['🖱', 'Move around.', 'Drag a part to move it. R rotates, Delete removes. Scroll to zoom, right-drag to pan.']
    ];
    box.appendChild(el('div', { class: 'coach-card' }, [
      el('div', { class: 'coach-title', text: 'How the yard works' }),
      el('ol', { class: 'coach-list' }, tips.map(function (t) { return el('li', {}, [el('span', { class: 'coach-ico', text: t[0] }), el('span', { html: '<b>' + t[1] + '</b> ' + t[2] })]); })),
      SE.ui.button('Got it', function () { try { localStorage.setItem('se.yard.coach', '1'); } catch (e) {} box.classList.remove('show'); }, 'primary small')
    ]));
    box.classList.add('show');
  };

  /* ------------------------------------------------------------ toolbar */
  Yard.prototype.refreshBar = function () {
    if (!this.barEl) return;
    var el = SE.ui.el, btn = SE.ui.button, self = this, bar = SE.ui.clear(this.barEl);
    var running = this.mode === 'run' && this.stepper && !this.stepper.paused;
    bar.appendChild(el('div', { class: 'tb-group' }, [
      btn(running ? '❚❚ Pause' : (this.mode === 'run' ? '▶ Resume' : '▶ Run'), function () { running ? self.pause() : self.run(); }, 'primary small yard-run', { title: 'Run the simulation (Enter)' }),
      btn('Step', function () { self.stepOnce(); }, 'secondary small', { title: 'Advance one 1/60 s step' }),
      btn('↺ Reset', function () { self.reset(); }, 'secondary small', { title: 'Back to t = 0 so you can change the build', disabled: this.mode === 'edit' ? 'disabled' : null })
    ]));
    var speed = el('select', { class: 'yard-speed', 'aria-label': 'Simulation speed', onchange: function () { self.timeScale = Number(speed.value); if (self.stepper) self.stepper.timeScale = self.timeScale; } },
      [['0.25', '¼×'], ['0.5', '½×'], ['1', '1×'], ['2', '2×'], ['4', '4×']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    speed.value = String(this.timeScale || 1);
    bar.appendChild(el('label', { class: 'tb-group tb-labelled' }, [el('span', { class: 'tb-label', text: 'Speed' }), speed]));
    var ov = function (key, label, tip) {
      var cb = el('input', { type: 'checkbox', onchange: function () { self.overlays[key] = cb.checked; } });
      cb.checked = !!self.overlays[key];
      return el('label', { class: 'yard-toggle', title: tip }, [cb, el('span', { text: label })]);
    };
    bar.appendChild(el('div', { class: 'tb-group tb-labelled' }, [el('span', { class: 'tb-label', text: 'Show' }),
      ov('forces', 'Force arrows', 'Draw the forces acting on each part'), ov('weights', 'Weights', 'Draw each part\'s weight (mg)')]));
    bar.appendChild(this.clockEl = el('span', { class: 'yard-clock mono', title: 'Simulated time' }));
    bar.appendChild(btn('⤢ Fit', function () { self.fitView(); }, 'ghost small yard-fit', { title: 'Fit the whole yard in view', 'aria-label': 'Fit the yard in view' }));
    bar.appendChild(btn('? Help', function () { self.showCoach(); }, 'ghost small yard-help', { title: 'How the yard works' }));
    if (!this.ready() && this.mode === 'edit') {
      var e0 = this.built.errors[0], bad = e0.part && this.inst(e0.part);
      bar.appendChild(el('button', { class: 'yard-err', title: bad ? 'Select it to fix the setting' : null, onclick: bad ? function () { self.select(e0.part, true); } : null,
        text: '⚠ ' + (bad ? nameOf(bad) + ': ' : '') + e0.error + (bad ? '  (click to fix)' : '') }));
    }
    else {
      if (this.mode === 'edit') this.diagnose(true);
      var dg = this.diag || [];
      if (dg.length) bar.appendChild(el('span', { class: 'yard-diag ' + dg[0].severity, title: dg.map(function (d) { return '• ' + d.message; }).join('\n'),
        text: (dg[0].severity === 'error' ? '⚠ ' : '△ ') + dg[0].message + (dg.length > 1 ? '  (+' + (dg.length - 1) + ' more)' : '') }));
    }
    this.refreshStatus();
  };

  /* --------------------------------------------------------- status bar */
  // One line that says what a click does right now.
  Yard.prototype.statusText = function () {
    var pl = this.placing, inst = this.selected && this.inst(this.selected);
    if (this.touchUI) return this.touchStatusText(pl, inst);
    if (this.mode === 'run') return (this.stepper && this.stepper.paused ? 'Paused.' : 'Running.') + (this.opts.poke !== false ? ' Drag a load to give it a shove.' : '') + ' Press ↺ Reset to change the build.';
    if (this.mode === 'done') return 'Run finished. Press ↺ Reset to change the build, or ▶ Run to try again.';
    if (pl) {
      var nm = pl.def.name.toLowerCase();
      if (!pl.def.connector) return 'Placing ' + article(nm) + ': click in the yard where it goes. Esc cancels.';
      if (pl.def.attach) return 'Placing ' + article(nm) + ': click the part to clip it onto. Esc cancels.';
      return pl.stage === 1 ? 'Now click the other end of the ' + nm + '. Esc cancels.' : 'Placing ' + article(nm) + ': click the first end (an anchor ring or a part). Esc cancels.';
    }
    if (inst) {
      var d = Y.partDef(inst.type), editable = (d.dials || []).some(function (dl) { return !isFixed(inst, dl); });
      return nameOf(inst) + ' selected. ' + (editable ? 'Change its dials in Properties on the right. ' : '') + (inst.locked ? 'It is fixed in place.' : 'Drag to move, R rotates, Delete removes.') + ' Esc deselects.';
    }
    return 'Click a part to see and change its properties. Pick a part from the bin to add one. Scroll to zoom, right-drag to pan.';
  };
  Yard.prototype.touchStatusText = function (pl, inst) {
    if (this.mode === 'run') return (this.stepper && this.stepper.paused ? 'Paused.' : 'Running.') + (this.opts.poke !== false ? ' Drag a load to shove it.' : '') + ' ↺ Reset to change the build.';
    if (this.mode === 'done') return 'Run finished. ↺ Reset to change the build.';
    if (pl) {
      var nm = pl.def.name.toLowerCase();
      if (!pl.def.connector) return 'Tap where the ' + nm + ' goes. Tap it in the bin again to cancel.';
      if (pl.def.attach) return 'Tap the part to clip the ' + nm + ' onto. Tap it in the bin again to cancel.';
      return pl.stage === 1 ? 'Now tap the other end of the ' + nm + '.' : 'Tap the first end of the ' + nm + ' (a ring or a part).';
    }
    if (inst) return nameOf(inst) + ' selected. Settings are in Properties below.';
    return 'Tap a part to edit it. Drag to pan, pinch to zoom.';
  };
  Yard.prototype.refreshStatus = function () {
    if (!this.statusEl) return;
    var el = SE.ui.el, box = SE.ui.clear(this.statusEl);
    box.appendChild(el('span', { class: 'status-mode mode-' + (this.placing ? 'place' : this.mode), text: this.placing ? 'PLACE' : { edit: 'BUILD', run: 'RUN', done: 'DONE' }[this.mode] }));
    box.appendChild(el('span', { class: 'status-text', text: this.statusText() }));
  };

  /* ---------------------------------------------------------- parts bin */
  Yard.prototype.refreshBin = function () {
    if (!this.binEl) return;
    var el = SE.ui.el, self = this, bin = SE.ui.clear(this.binEl);
    var entries = this.binEntries();
    this.refreshStatus();
    if (!entries.length) { this.binEl.style.display = 'none'; return; }
    this.binEl.style.display = '';
    var library = this.binSpec === 'library';
    bin.appendChild(el('div', { class: 'bin-head' }, [
      el('div', { class: 'bin-title', text: 'Parts bin' }),
      el('div', { class: 'bin-sub', text: library ? 'Full library' : 'Your kit for this step' })
    ]));
    if (this.mode !== 'edit') bin.appendChild(el('div', { class: 'bin-locked', text: '↺ Reset to add parts' }));
    var q = (this.binQuery || '').trim().toLowerCase();
    if (entries.length > 10) {
      var search = el('input', { class: 'bin-search', type: 'search', placeholder: 'Search parts…', value: this.binQuery || '', 'aria-label': 'Search parts', spellcheck: 'false' });
      search.addEventListener('input', function () { self.binQuery = search.value; self.refreshBin(); var s = self.binEl.querySelector('.bin-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
      search.addEventListener('keydown', function (e) { e.stopPropagation(); });
      bin.appendChild(search);
    }
    var list = el('div', { class: 'bin-list' }), groups = {}, shown = 0;
    bin.appendChild(list);
    entries.forEach(function (e, i) {
      var d = Y.partDef(e.type);
      var name = e.label || d.name;
      if (q && (name + ' ' + d.category + ' ' + (d.blurb || '')).toLowerCase().indexOf(q) < 0) return;
      var left = self.remaining(e, library ? null : i);
      var cat = d.category;
      if (!groups[cat]) { groups[cat] = el('div', { class: 'bin-group' }, [el('div', { class: 'bin-cat', text: cat })]); list.appendChild(groups[cat]); }
      var active = self.placing && self.placing.entry === e;
      groups[cat].appendChild(el('button', {
        class: 'bin-part' + (active ? ' active' : '') + (left <= 0 ? ' empty' : ''),
        title: name + ': ' + (d.blurb || '') + (left <= 0 ? ' (none left)' : ''),
        disabled: left <= 0 || self.mode !== 'edit' ? 'disabled' : null,
        onclick: function () { self.startPlacing(e, library ? null : i); }
      }, [
        el('span', { class: 'bin-ico', text: iconOf(e.type), 'aria-hidden': 'true' }),
        el('span', { class: 'bin-name', text: name }),
        isFinite(left) ? el('span', { class: 'bin-count', text: '×' + left }) : null
      ]));
      shown++;
    });
    if (!shown) list.appendChild(el('div', { class: 'bin-empty', text: 'No part matches.' }));
  };

  /* --------------------------------------------------------- properties */
  function isFixed(inst, dl) {
    return (inst.locked && !(inst.open || []).includes(dl.key)) || (inst.fixed || []).indexOf(dl.key) >= 0 || !!dl.locked;
  }
  function dialSummary(inst) {
    var d = Y.partDef(inst.type), dv = inst.dials || {};
    var dl = (d.dials || []).filter(function (x) { return !(inst.hide && inst.hide.indexOf(x.key) >= 0) && dv[x.key]; })[0];
    if (!dl) return '';
    var v = dv[dl.key], m = dl.choice && SE.phys.MATERIALS[v];
    return dl.label + ' ' + ((m && m.label) || v);
  }

  Yard.prototype.refreshInspector = function () {
    var box = this.inspectorEl; if (!box) return;
    var el = SE.ui.el, btn = SE.ui.button, self = this;
    SE.ui.clear(box);
    this.inspGauges = [];
    this.refreshStatus();
    var inst = this.selected && this.inst(this.selected);
    var head = el('div', { class: 'insp-section-title' }, [el('span', { text: '🔧 Properties' })]);
    box.appendChild(head);
    if (!inst) {
      box.classList.remove('has-sel');
      box.appendChild(el('div', { class: 'insp-empty', html: this.mode === 'edit' ? '<b>Nothing selected.</b> Click a part in the yard, or pick one here, to see and change its settings.' : '<b>Nothing selected.</b> Click a part to see its live readings. Press ↺ Reset to change settings.' }));
      var canEdit = function (p) { var d = Y.partDef(p.type); return (d.dials || []).some(function (dl) { return !isFixed(p, dl) && !(p.hide && p.hide.indexOf(dl.key) >= 0); }); };
      var parts = (this.design.parts || []).filter(function (p) { var d = Y.partDef(p.type); return d && !p.hidden; });
      parts = parts.filter(canEdit).concat(parts.filter(function (p) { return !canEdit(p); }));
      if (parts.length) {
        box.appendChild(el('div', { class: 'insp-sub', text: 'In the yard' }));
        box.appendChild(el('div', { class: 'insp-tree', role: 'list' }, parts.map(function (p) {
          var d = Y.partDef(p.type), editable = (d.dials || []).some(function (dl) { return !isFixed(p, dl) && !(p.hide && p.hide.indexOf(dl.key) >= 0); });
          return el('button', { class: 'tree-row' + (editable ? ' editable' : ''), role: 'listitem', title: editable ? 'Select to change its settings' : 'Fixed part: select to read it', onclick: function () { self.select(p.id, true); } }, [
            el('span', { class: 'tree-ico', text: iconOf(p.type), 'aria-hidden': 'true' }),
            el('span', { class: 'tree-name', text: nameOf(p) }),
            el('span', { class: 'tree-val mono', text: dialSummary(p) }),
            el('span', { class: 'tree-tag', text: editable ? '✎' : '🔒', title: editable ? 'Has settings you can change' : 'Fixed for this job' })
          ]);
        })));
      }
      return;
    }
    box.classList.add('has-sel');
    if (!inst.dials) inst.dials = {};
    var d = Y.partDef(inst.type), errs = this.built.errors.filter(function (e) { return e.part === inst.id; });
    head.appendChild(btn('✕', function () { self.select(null); }, 'ghost small insp-close', { title: 'Deselect (Esc)', 'aria-label': 'Deselect' }));
    box.appendChild(el('div', { class: 'insp-head' }, [
      el('span', { class: 'insp-ico', text: iconOf(inst.type), 'aria-hidden': 'true' }),
      el('div', { class: 'insp-names' }, [el('b', { class: 'insp-name', text: nameOf(inst) }), el('span', { class: 'insp-type', text: d.name + ' · ' + d.category + (inst.locked ? ' · fixed in place' : '') })])
    ]));
    if (d.blurb) box.appendChild(el('div', { class: 'insp-blurb small', text: d.blurb }));
    var plate = d.plate ? d.plate(inst, this.built.parts[inst.id]) : null;
    if (inst.plate) plate = (plate || []).concat(inst.plate);
    if (plate && plate.length) box.appendChild(el('div', { class: 'insp-plate mono' }, plate.map(function (l) { return el('div', { text: l }); })));
    var dials = (d.dials || []).filter(function (dl) { return !(inst.hide && inst.hide.indexOf(dl.key) >= 0); });
    if (dials.length) {
      var editMode = this.mode === 'edit';
      box.appendChild(el('div', { class: 'insp-sub', text: 'Settings' + (editMode ? ' · type a value with its unit, then Enter' : ' · ↺ Reset to change') }));
      var firstInput = null;
      dials.forEach(function (dl) {
        var fixed = isFixed(inst, dl);
        var err = errs.filter(function (e) { return e.key === dl.key; })[0];
        var Q = D.QUANTITIES[dl.q || 'number'];
        var input;
        if (dl.choice) {
          input = el('select', { class: 'dial-input', disabled: fixed ? 'disabled' : null, 'aria-label': dl.label, onchange: function () { self.setDial(inst.id, dl.key, input.value); } },
            dl.choice.map(function (c) { var m = SE.phys.MATERIALS[c]; return el('option', { value: c, text: (m && m.label) || c }); }));
          input.value = inst.dials[dl.key];
        } else {
          input = el('input', { type: 'text', class: 'dial-input mono', value: inst.dials[dl.key] == null ? '' : inst.dials[dl.key],
            placeholder: dl.optional ? 'as rigged' : Q.examples, disabled: fixed ? 'disabled' : null, spellcheck: 'false', 'aria-label': dl.label });
          var commit = function () { if (input.value !== inst.dials[dl.key]) self.setDial(inst.id, dl.key, input.value); };
          input.addEventListener('change', commit);
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { commit(); e.preventDefault(); } e.stopPropagation(); });
        }
        if (!fixed && !firstInput) firstInput = input;
        var hint = fixed ? '🔒 fixed for this job' : (dl.choice ? '' : Q.name === 'number' ? 'a plain number' : Q.name + ': ' + Q.examples);
        box.appendChild(el('label', { class: 'dial' + (err ? ' bad' : '') + (fixed ? ' fixed' : '') }, [
          el('span', { class: 'dial-label', text: dl.label }), input,
          hint ? el('span', { class: 'dial-hint', text: hint }) : null,
          err ? el('span', { class: 'dial-err small', text: err.error }) : null
        ]));
      });
      this.firstDialInput = firstInput;
    }
    errs.filter(function (e) { return !e.key; }).forEach(function (e) { box.appendChild(el('div', { class: 'dial-err small', text: e.error })); });
    var reads = this.built.readouts.filter(function (r) { return r.part === inst.id; });
    if (reads.length) {
      box.appendChild(el('div', { class: 'insp-sub', text: 'Live readings · measured by the sim' }));
      reads.forEach(function (r) {
        var v = el('span', { class: 'live-val mono' });
        box.appendChild(el('div', { class: 'live-row' }, [el('span', { class: 'live-label', text: r.label }), v]));
        self.inspGauges.push({ r: r, val: v });
      });
    }
    if (!inst.locked && this.mode === 'edit') {
      box.appendChild(el('div', { class: 'btn-row insp-actions' }, [
        d.connector ? null : btn('⟲ Rotate', function () { self.movePart(inst.id, inst.x, inst.y, (inst.angle || 0) + Math.PI / 12); }, 'ghost small', { title: 'Rotate 15° (R)' }),
        btn('🗑 Remove', function () { self.removePart(inst.id); }, 'ghost small danger', { title: 'Remove (Delete)' })
      ]));
    }
  };

  // Selecting a part brings its properties into view. `focus` also puts the cursor in its first field.
  var baseSelect = Yard.prototype.select;
  Yard.prototype.select = function (id, focus) {
    baseSelect.call(this, id);
    var box = this.inspectorEl;
    if (id && box && box.scrollIntoView) {
      box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (focus && this.firstDialInput && this.mode === 'edit') this.firstDialInput.focus();
    }
  };

  /* ----------------------------------------------------------- readouts */
  function unitChoices(q) {
    var Q = D.QUANTITIES[q];
    if (!Q || !Q.si || q === 'number' || q === 'text') return null;
    return Q.examples.split(',').map(function (s) { return s.trim(); }).filter(function (u) { return SE.units.unitInfo(u.replace('²', '^2')); });
  }
  Yard.prototype.refreshStrip = function () {
    if (!this.stripEl) return;
    var el = SE.ui.el, self = this, strip = SE.ui.clear(this.stripEl);
    this.gaugeEls = [];
    var list = this.readoutList();
    if (!list.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    strip.appendChild(el('div', { class: 'strip-head', title: 'These meters show what the simulation measures. They are read-only. To change a setting, click the part and use Properties.' }, [
      el('span', { class: 'strip-title', text: '📟 Live readouts' }),
      el('span', { class: 'strip-sub', text: 'measured by the sim · read-only' })
    ]));
    var meters = el('div', { class: 'strip-meters' });
    strip.appendChild(meters);
    list.forEach(function (r) {
      var val = el('span', { class: 'gauge-val mono' });
      var choices = unitChoices(r.q), unit = null;
      if (choices && choices.length > 1) {
        unit = el('select', { class: 'gauge-unit', 'aria-label': 'Display unit for ' + r.partLabel + ' ' + r.label, title: 'Show this reading in another unit',
          onchange: function () { self.units[r.id] = unit.value; } },
          [el('option', { value: '', text: 'auto' })].concat(choices.map(function (u) { return el('option', { value: u, text: u.replace('^2', '²').replace('^3', '³') }); })));
        unit.value = self.units[r.id] && choices.indexOf(self.units[r.id]) >= 0 ? self.units[r.id] : '';
        unit.addEventListener('click', function (e) { e.stopPropagation(); });
        unit.addEventListener('keydown', function (e) { e.stopPropagation(); });
      }
      var g = el('div', { class: 'gauge', role: 'button', tabindex: '0', title: 'Live ' + r.label + ' of ' + r.partLabel + ' (read-only). Click to select ' + r.partLabel + '.',
        onclick: function () { if (self.inst(r.part)) self.select(r.part, true); } }, [
        el('span', { class: 'gauge-label' }, [el('span', { class: 'gauge-part', text: r.partLabel }), el('span', { class: 'gauge-q', text: r.label })]),
        el('span', { class: 'gauge-row' }, [val, unit])
      ]);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.click(); } e.stopPropagation(); });
      meters.appendChild(g);
      self.gaugeEls.push({ r: r, val: val });
    });
  };

  /* -------------------------------------------------- hover tooltips */
  Yard.prototype.bindHover = function () {
    var self = this, c = this.canvas;
    var hide = function () { self.hoverId = null; if (self.tipEl) self.tipEl.classList.remove('show'); c.style.cursor = ''; };
    c.addEventListener('pointerleave', hide);
    c.addEventListener('pointerdown', function () { if (self.tipEl) self.tipEl.classList.remove('show'); });
    c.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      if (e.buttons || self.placing || self.mode === 'run') { if (self.tipEl.classList.contains('show')) hide(); return; }
      var id = self.partAt(self.pointerWorld(e)), inst = id && self.inst(id);
      if (!inst) { if (self.hoverId) hide(); return; }
      var r = c.getBoundingClientRect(), tip = self.tipEl;
      if (id !== self.hoverId) {
        self.hoverId = id;
        var d = Y.partDef(inst.type), editable = (d.dials || []).some(function (dl) { return !isFixed(inst, dl) && !(inst.hide && inst.hide.indexOf(dl.key) >= 0); });
        var sum = dialSummary(inst);
        tip.innerHTML = '';
        tip.appendChild(SE.ui.el('b', { text: iconOf(inst.type) + ' ' + nameOf(inst) }));
        if (sum) tip.appendChild(SE.ui.el('div', { class: 'mono', text: sum }));
        tip.appendChild(SE.ui.el('div', { class: 'tip-act', text: self.mode !== 'edit' ? 'Click to see its readings' : editable ? 'Click to edit its settings' : (inst.locked ? 'Fixed part · click to inspect' : 'Click to select') }));
      }
      c.style.cursor = 'pointer';
      var x = e.clientX - r.left + 16, y = e.clientY - r.top + 14;
      if (x + 230 > r.width) x = e.clientX - r.left - 230;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.add('show');
    });
  };
})(globalThis.SE);
