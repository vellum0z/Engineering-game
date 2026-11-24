/*
 * Yard steps: handheld levels played in the build yard.
 *
 * A level with a `yard` block opens the yard on the left instead of the old
 * scene stage, with the inspector at the top of the clipboard. Its steps can
 * use every ordinary step type (say, reveal, deeper, summary) plus:
 *
 *   build   set up or change something; waits until `until(ctx)` is true
 *           { type: 'build', who, text, yard, until, goalText, after, hint }
 *           `until` is checked after every edit, run and result. Return
 *           true when done, or a string to show as a nudge.
 *   watch   same as build, for "run it and look" moments; `until` usually
 *           checks ctx.result (the last finished run).
 *   rule    the law, written with the numbers the player just produced:
 *           { type: 'rule', title, eq: fn(ctx) | tex, text: fn(ctx) | md, formula }
 *   job     the scored goal: { type: 'job', id, who, text, yard, goal, timeout,
 *           goalText, hints: [...], margin(s) -> points off, grade: { part, key, spec },
 *           success: fn(ctx) | md }
 *           The run is judged by `goal` (judge.js). The score is the job score
 *           (hints, failed runs, margins); with `grade` the typed dial is also
 *           checked for units and figures by SE.checker.
 *   free    free play with the kit: { type: 'free', text, yard }
 *
 * `yard` on a step changes the yard: { design, bin, ghosts, goal, readouts,
 * camera, site, keep: true (keep the player's build), add: [parts] }. Missing
 * fields fall back to the level's own `yard` block.
 *
 * ctx (what until / eq / text functions get):
 *   ctx.yard, ctx.design, ctx.built, ctx.result (last finished run or null),
 *   ctx.runs, ctx.inst(id), ctx.find(type) -> first instance of a type,
 *   ctx.all(type), ctx.si(id, key) -> dial value in SI (NaN if unreadable),
 *   ctx.text(id, key), ctx.read(readoutId) -> live gauge value,
 *   ctx.fmt(si, unit, sf), ctx.values (scratch shared by the level), ctx.event
 */
(function (SE) {
  'use strict';
  var Y = SE.yard;
  if (!SE.Runner) return;          // Node: no UI
  var R = SE.Runner.prototype;
  var el, md, inline, btn;
  function bind() { el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline; btn = SE.ui.button; }

  var baseMount = R.mount, baseRender = R.renderStep, baseUnmount = R.unmount, baseComplete = R.complete;

  R.mount = function (root) {
    if (!this.level.yard) return baseMount.call(this, root);
    bind();
    var self = this;
    this.root = root;
    SE.ui.clear(root);
    this.yardEl = el('div', { class: 'stage-wrap yard-wrap' });
    this.log = el('div', { class: 'panel-log' });
    this.card = el('div', { class: 'panel-card' });
    this.inspector = el('div', { class: 'yard-inspector' });
    this.panel = el('aside', { class: 'panel clipboard', 'aria-live': 'polite' }, [
      el('div', { class: 'clip' }),
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'panel-kicker', text: 'Handheld · ' + this.level.id + ((this.level.sections || []).length ? ' · Sections ' + this.level.sections.join(', ') : '') }),
        el('h1', { class: 'panel-title', text: this.level.title }),
        this.progress = el('div', { class: 'step-progress' })
      ]),
      this.inspector, this.log, this.card
    ]);
    root.appendChild(el('div', { class: 'play-layout yard-layout' }, [this.yardEl, this.panel]));
    this.ctx = this.makeCtx();
    this.setYard({});
    this.begin();
  };

  R.unmount = function () {
    if (this.yard) this.yard.unmount();
    if (this.level.yard) { this.dead = true; return; }
    return baseUnmount.call(this);
  };

  // (Re)configure the yard for a step.
  R.setYard = function (cfg) {
    var base = this.level.yard || {};
    cfg = cfg || {};
    var keep = cfg.keep && this.yard;
    var design = keep ? this.yard.design : (cfg.design || base.design || { parts: [] });
    if (cfg.add) { design = Y.cloneDesign(design); cfg.add.forEach(function (p) { design.parts.push(Y.makeInstance(p.type, p)); }); }
    var opts = Object.assign({}, base, cfg, { design: design });
    delete opts.keep; delete opts.add;
    if (!('goal' in cfg)) opts.goal = null;
    if (this.yard) { opts.units = this.yard.units; opts.overlays = Object.assign({}, this.yard.overlays, cfg.overlays || {}); this.yard.unmount(); }
    var y = new Y.Yard(opts);
    if (keep) { y.used = this.yard.used; }
    this.yard = y;
    y.mount(this.yardEl, this.inspector);
    var self = this;
    ['change', 'run', 'result', 'reset', 'break', 'poke'].forEach(function (t) { y.on(t, function (e) { self.yardEvent(t, e); }); });
    return y;
  };
  R.yardEvent = function (type, e) {
    this.ctx.event = { type: type, data: e };
    (this.yardWatchers || []).slice().forEach(function (fn) { fn(type, e); });
  };
  R.watchYard = function (fn) { (this.yardWatchers = this.yardWatchers || []).push(fn); };
  R.clearYardWatchers = function () { this.yardWatchers = []; };

  R.yardCtx = function () {
    var y = this.yard, ctx = this.ctx;
    ctx.yard = y; ctx.design = y.design; ctx.built = y.built; ctx.result = y.lastResult; ctx.runs = y.runs;
    ctx.inst = function (id) { return y.inst(id); };
    ctx.find = function (type) { return y.design.parts.filter(function (p) { return p.type === type; })[0] || null; };
    ctx.all = function (type) { return y.design.parts.filter(function (p) { return p.type === type; }); };
    ctx.text = function (id, key) { var i = y.inst(id); return i ? i.dials[key] : null; };
    ctx.si = function (id, key) {
      var i = typeof id === 'string' ? y.inst(id) : id; if (!i) return NaN;
      var dl = Y.partDef(i.type).dials.filter(function (d) { return d.key === key; })[0];
      if (!dl) return NaN;
      if (dl.choice) return i.dials[key];
      var r = Y.dial.parse(i.dials[key], dl.q); return r.ok ? r.si : NaN;
    };
    ctx.read = function (rid) { var r = y.built.readouts.filter(function (x) { return x.id === rid; })[0]; return r ? r.read(y.built.world) : NaN; };
    ctx.fmt = function (si, unit, sf) { return Y.dial.format(si, unit, sf || 3); };
    return ctx;
  };

  function val(x, ctx) { return typeof x === 'function' ? x(ctx) : x; }

  R.renderStep = function (s, done) {
    if (!this.level.yard) return baseRender.call(this, s, done);
    this.clearYardWatchers();
    if (s.yard) this.setYard(s.yard);
    else if (this.yard && this.yard.goal && s.type !== 'job') { this.yard.goal = null; }
    var fn = { build: this.yardBuildStep, watch: this.yardBuildStep, rule: this.yardRuleStep, job: this.yardJobStep, free: this.yardFreeStep }[s.type];
    if (!fn) return baseRender.call(this, s, done);
    if (s.onEnter) { try { s.onEnter(this.yardCtx()); } catch (e) { console.error(e); } }
    fn.call(this, s, done);
    var c = this.card;
    setTimeout(function () { c.scrollIntoView && c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
  };

  function whoHeader(who) {
    var W = { hask: ['Hask', 'old bridge inspector', 'who-hask'], juno: ['Juno', 'settlement chief', 'who-juno'], radio: ['Radio', '', 'who-radio'] };
    var w = W[who || 'hask']; if (!w) return el('span');
    return el('div', { class: 'who ' + w[2] }, [el('span', { class: 'who-badge', text: w[0][0] }), el('span', { class: 'who-name', text: w[0] }), w[1] ? el('span', { class: 'who-role', text: w[1] }) : null]);
  }

  /* -------------------------------------------------------- build/watch */
  R.yardBuildStep = function (s, done) {
    var self = this;
    var c = el('div', { class: 'step step-' + s.type });
    c.appendChild(whoHeader(s.who));
    c.appendChild(el('div', { class: 'step-kicker', text: s.kicker || (s.type === 'watch' ? 'Run it and watch' : 'Set it up') }));
    c.appendChild(el('div', { class: 'step-body', html: md(val(s.text, this.yardCtx())) }));
    var status = el('div', { class: 'goal-status', html: s.goalText ? '◻ ' + inline(s.goalText) : '' });
    var nudge = el('div', { class: 'sim-msg' });
    var cont = btn(s.next || 'Continue ▸', function () { self.clearYardWatchers(); done(); }, 'primary', { disabled: s.until ? 'disabled' : null });
    c.appendChild(status); c.appendChild(nudge);
    var row = el('div', { class: 'btn-row' }, [cont]);
    if (s.hint) row.insertBefore(btn('Hint', function () { nudge.innerHTML = md(val(s.hint, self.yardCtx())); }, 'ghost'), cont);
    c.appendChild(row);
    this.card.appendChild(c);
    if (!s.until) return;
    var met = false;
    var check = function (type) {
      if (met || self.dead) return;
      var r;
      try { r = s.until(self.yardCtx(), type); } catch (e) { console.error(e); r = false; }
      if (r === true) {
        met = true; cont.disabled = false;
        status.innerHTML = '✔ ' + inline(s.goalText || 'Done'); status.classList.add('met');
        nudge.innerHTML = '';
        SE.audio && SE.audio.play('success', { volume: 0.5 });
        if (s.after) c.insertBefore(el('div', { class: 'feedback good', html: md(val(s.after, self.yardCtx())) }), row);
        if (s.auto) setTimeout(function () { if (!self.dead) cont.click(); }, 600);
      } else if (typeof r === 'string') nudge.innerHTML = md(r);
    };
    this.watchYard(check);
    check('enter');
  };

  /* --------------------------------------------------------------- rule */
  R.yardRuleStep = function (s, done) {
    var ctx = this.yardCtx();
    var c = el('div', { class: 'step step-rule law-card' });
    c.appendChild(el('div', { class: 'step-kicker', text: s.kicker || 'What you just saw' }));
    if (s.title) c.appendChild(el('h2', { class: 'law-title', text: s.title }));
    if (s.law) c.appendChild(el('div', { class: 'eq-block big', html: SE.eq.html(s.law) }));
    var eq = val(s.eq, ctx);
    if (eq) [].concat(eq).forEach(function (e) { c.appendChild(el('div', { class: 'eq-block', html: SE.eq.html(e) })); });
    c.appendChild(el('div', { class: 'step-body', html: md(val(s.text, ctx) || '') }));
    if (s.formula) c.appendChild(el('div', { class: 'muted small', text: '→ added to your formula sheet' }));
    c.appendChild(el('div', { class: 'btn-row' }, [btn('Got it ▸', done, 'primary')]));
    this.card.appendChild(c);
    SE.audio && SE.audio.play('stamp', { volume: 0.4 });
  };

  /* ---------------------------------------------------------------- job */
  R.yardJobStep = function (s, done) {
    var self = this, y = this.yard;
    y.goal = (s.yard && s.yard.goal) || s.goal;
    y.timeout = s.timeout || y.timeout;
    if (s.timeoutText) y.opts.timeoutText = s.timeoutText;
    y.failedRuns = 0;
    var c = el('div', { class: 'step step-job task-card' });
    c.appendChild(whoHeader(s.who));
    c.appendChild(el('div', { class: 'step-kicker', text: s.required === false ? 'Optional job' : 'The job' }));
    c.appendChild(el('div', { class: 'step-body', html: md(val(s.text, this.yardCtx())) }));
    var status = el('div', { class: 'goal-status', html: '◻ ' + inline(s.goalText || 'Make it work, then press Run.') });
    var hintBox = el('div', { class: 'hints' });
    var fb = el('div', { class: 'feedback-slot' });
    var hintTier = 0, solved = false;
    var row = el('div', { class: 'btn-row' });
    var hintBtn = null;
    if (s.hints && s.hints.length) {
      hintBtn = btn('Hint (−' + SE.scoring.HINT_COST[1] + ')', function () {
        if (hintTier >= s.hints.length) return;
        hintTier++; self.save.stats.hintsUsed++;
        hintBox.appendChild(el('div', { class: 'hint tier-' + hintTier, html: md(val(s.hints[hintTier - 1], self.yardCtx())) }));
        if (hintTier < s.hints.length) hintBtn.innerHTML = inline('Another hint (−' + (SE.scoring.HINT_COST[Math.min(hintTier + 1, 3)] - SE.scoring.HINT_COST[hintTier]) + ')');
        else hintBtn.disabled = true;
      }, 'ghost');
      row.appendChild(hintBtn);
    }
    var cont = btn('Continue ▸', function () { self.clearYardWatchers(); done(); }, 'primary', { disabled: 'disabled' });
    if (s.required === false) cont.disabled = false;
    row.appendChild(cont);
    [status, hintBox, fb, row].forEach(function (n) { c.appendChild(n); });
    this.card.appendChild(c);

    this.watchYard(function (type, e) {
      if (type === 'run') { SE.ui.clear(fb); }
      if (type !== 'result') return;
      var ctx = self.yardCtx();
      if (!e.pass) {
        SE.ui.clear(fb);
        fb.appendChild(el('div', { class: 'feedback bad' }, [el('div', { class: 'feedback-head', text: 'Not yet.' }), el('div', { html: md(e.reason || '') }),
          s.onFail ? el('div', { class: 'sim-msg', html: md(val(s.onFail, ctx) || '') }) : null]));
        return;
      }
      var score = Y.jobScore(s, { pass: true, state: e.state, hintTier: hintTier, failedRuns: y.failedRuns });
      var graded = null;
      if (s.grade) {
        var txt = ctx.text(s.grade.part, s.grade.key);
        graded = SE.checker.check(txt, s.grade.spec);
        var gscore = SE.scoring.taskScore({ result: graded, spec: s.grade.spec, hintTier: hintTier, wrongAttempts: y.failedRuns });
        score = Math.round((score + gscore) / 2);
      }
      if (s.id) self.recordTask(s.id, score);
      solved = true;
      status.innerHTML = '✔ ' + inline(s.goalText || 'Job done'); status.classList.add('met');
      SE.ui.clear(fb);
      fb.appendChild(el('div', { class: 'feedback good' }, [
        el('div', { class: 'feedback-head', html: 'Job done. Score ' + score + ' <span class="grade grade-' + SE.scoring.grade(score) + '">' + SE.scoring.grade(score) + '</span>' }),
        s.success ? el('div', { class: 'step-body', html: md(val(s.success, ctx) || '') }) : null,
        graded && graded.feedback ? el('div', { class: 'muted small', text: graded.feedback }) : null,
        el('div', { class: 'muted small', text: 'Change the build and run it again to improve the score, or carry on.' })
      ]));
      cont.disabled = false;
      self.game.persist();
    });
  };

  /* --------------------------------------------------------------- free */
  R.yardFreeStep = function (s, done) {
    var self = this;
    var c = el('div', { class: 'step step-free' });
    c.appendChild(whoHeader(s.who));
    c.appendChild(el('div', { class: 'step-kicker', text: 'Free play' }));
    c.appendChild(el('div', { class: 'step-body', html: md(val(s.text, this.yardCtx()) || 'The yard is yours. Try anything.') }));
    if (s.prompts) c.appendChild(el('ul', { class: 'prompts' }, s.prompts.map(function (p) { return el('li', { html: inline(p) }); })));
    c.appendChild(el('div', { class: 'btn-row' }, [btn(s.next || 'Done playing ▸', function () { self.clearYardWatchers(); done(); }, 'primary')]));
    this.card.appendChild(c);
  };

  R.complete = function () {
    if (this.level.yard && !this.stage) this.stage = { w: 0, h: 0, burst: function () {} };
    return baseComplete.call(this);
  };
})(globalThis.SE);
