/*
 * Handheld-mode runner: plays a level's steps in order with the stage on
 * the left and the clipboard panel on the right.
 *
 * Step types (see CONTRIBUTING.md for every field):
 *   say      narration / dialogue
 *   predict  "what do you think happens?" before the reveal (Socratic)
 *   try      hands-on with scene controls until a goal is met
 *   reveal   formal statement of a definition or law (+ formula sheet)
 *   derive   step-by-step derivation, lines revealed one at a time,
 *            optionally asking the player to choose the next move
 *   task     scored numeric task, checked by SE.checker, with a physical
 *            consequence computed by the scene
 *   classify scored sorting task (items into bins)
 *   sandbox  free experimentation with the concept
 *   deeper   optional "go deeper" branch with nested steps
 *   summary  key points recap
 *
 * "Prove it": a level may define proveIt tasks. Passing them all first time
 * without hints skips the explanation steps; scored tasks still have to be
 * done.
 */
(function (SE) {
  'use strict';
  var el, md, inline, btn;
  function bindUI() { el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline; btn = SE.ui.button; }
  if (SE.ui) bindUI();   // manual projects borrow controlsUI before any Runner exists

  var EXPLAIN = ['say', 'predict', 'try', 'reveal', 'derive', 'sandbox', 'deeper', 'summary'];
  var WHO = {
    hask: { name: 'Hask', role: 'old bridge inspector', cls: 'who-hask' },
    juno: { name: 'Juno', role: 'settlement chief', cls: 'who-juno' },
    radio: { name: 'Radio', role: '', cls: 'who-radio' },
    you: { name: 'You', role: '', cls: 'who-you' },
    narrator: { name: '', role: '', cls: 'who-narrator' }
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function Runner(level, opts) {
    bindUI();
    this.level = level;
    this.opts = opts || {};
    this.game = SE.game;
    this.save = SE.game.save;
    this.chState = SE.save.chapterState(this.save, level.chapter);
    this.lvState = this.chState.levels[level.id] = this.chState.levels[level.id] || { done: false, tasks: {}, provedIt: false, visits: 0 };
    this.lvState.visits++;
    this.skipExplain = false;
    this.values = {};
    this.sessionScores = {};
    this.started = Date.now();
  }

  Runner.prototype.mount = function (root) {
    var self = this;
    this.root = root;
    SE.ui.clear(root);
    this.canvas = el('canvas', { class: 'stage-canvas', 'aria-label': 'Simulation view' });
    this.stageWrap = el('div', { class: 'stage-wrap' }, [this.canvas, this.hud = el('div', { class: 'stage-hud' })]);
    this.log = el('div', { class: 'panel-log' });
    this.card = el('div', { class: 'panel-card' });
    this.panel = el('aside', { class: 'panel clipboard', 'aria-live': 'polite' }, [
      el('div', { class: 'clip' }),
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'panel-kicker', text: (this.level.sandbox ? 'Free sandbox' : 'Handheld · ' + this.level.id) + ((this.level.sections || []).length ? ' · Sections ' + this.level.sections.join(', ') : '') }),
        el('h1', { class: 'panel-title', text: this.level.title }),
        this.progress = el('div', { class: 'step-progress' })
      ]),
      this.log, this.card
    ]);
    root.appendChild(el('div', { class: 'play-layout' }, [this.stageWrap, this.panel]));
    this.stage = new SE.Stage(this.canvas);
    this.stage.reducedMotion = !!this.save.settings.reducedMotion;
    this.ctx = this.makeCtx();
    if (this.level.scene) this.ctx.setScene(this.level.scene.type, this.level.scene.params);
    setTimeout(function () { self.stage.resize(); }, 0);
    this.begin();
  };

  Runner.prototype.unmount = function () { if (this.stage) this.stage.stop(); this.dead = true; };

  Runner.prototype.makeCtx = function () {
    var self = this;
    var ctx = {
      runner: this, level: this.level, save: this.save, values: this.values,
      stage: null, scene: null,
      setScene: function (type, params) {
        var Ctor = SE.scenes[type];
        if (!Ctor) { console.warn('No scene', type); return null; }
        ctx.sceneType = type;
        ctx.scene = self.stage.load(new Ctor(), Object.assign({}, params || {}));
        ctx.stage = self.stage;
        self.renderHud();
        return ctx.scene;
      },
      sleep: sleep,
      toast: function (m, k) { SE.ui.toast(m, k); },
      hud: function (lines) { self.hudLines = lines; self.renderHud(); }
    };
    ctx.stage = this.stage;
    return ctx;
  };

  Runner.prototype.renderHud = function () {
    SE.ui.clear(this.hud);
    (this.hudLines || []).forEach(function (l) { this.hud.appendChild(el('div', { html: inline(l) })); }, this);
  };

  Runner.prototype.begin = function () {
    var self = this;
    var lv = this.level;
    SE.ui.clear(this.card);
    var intro = el('div', { class: 'step step-intro' }, [
      el('div', { class: 'step-body', html: md(lv.intro || '') }),
      lv.goals ? el('div', { class: 'goals' }, [el('h3', { text: 'You will be able to' }), el('ul', {}, lv.goals.map(function (g) { return el('li', { html: inline(g) }); }))]) : null,
      el('div', { class: 'btn-row' }, [
        btn('Start the lesson ▸', function () { self.run(0); }, 'primary'),
        lv.proveIt && lv.proveIt.length ? btn('Prove it: skip what I know', function () { self.proveIt(); }, 'ghost', { title: 'Pass a quick check to skip explanations. Scored tasks stay.' }) : null
      ]),
      lv.minutes ? el('div', { class: 'muted small', text: 'Learner pace: about ' + lv.minutes + ' min. Go as fast or slow as you like.' }) : null
    ]);
    this.card.appendChild(intro);
    this.updateProgress(-1);
  };

  Runner.prototype.updateProgress = function (i) {
    var steps = this.level.steps;
    SE.ui.clear(this.progress);
    steps.forEach(function (s, k) {
      this.progress.appendChild(el('span', { class: 'pip ' + s.type + (k < i ? ' done' : k === i ? ' now' : ''), title: s.type }));
    }, this);
  };

  /* ---------------------------------------------------------- prove it */
  Runner.prototype.proveIt = function () {
    var self = this;
    var tasks = this.level.proveIt;
    var idx = 0, clean = true;
    SE.ui.clear(this.card);
    this.card.appendChild(el('div', { class: 'step' }, [el('div', { class: 'step-body', html: md('**Prove it.** Answer these with no hints and no misses, and the explanations get skipped. You still do every scored task.') })]));
    (function next() {
      if (idx >= tasks.length) {
        if (clean) {
          self.skipExplain = true; self.lvState.provedIt = true;
          SE.ui.toast('Proven. Explanations skipped; scored tasks remain.', 'good');
        } else SE.ui.toast('Not quite. Playing the full lesson; you can skim.', 'warn');
        self.game.persist();
        return self.run(0);
      }
      var t = Object.assign({ prove: true }, tasks[idx++]);
      self.taskStep(t, function (outcome) { if (!outcome.firstTry) clean = false; next(); }, true);
    })();
  };

  /* --------------------------------------------------------------- run */
  Runner.prototype.run = function (i) {
    if (this.dead) return;
    var steps = this.level.steps;
    while (i < steps.length && this.skipExplain && EXPLAIN.indexOf(steps[i].type) >= 0) {
      this.applySideEffects(steps[i]);
      i++;
    }
    this.updateProgress(i);
    if (i >= steps.length) return this.complete();
    var s = steps[i];
    var self = this;
    this.archiveCard();
    if (s.scene) this.ctx.setScene(s.scene.type, s.scene.params);
    if (s.hud !== undefined) this.ctx.hud(s.hud);
    var done = function () { self.applySideEffects(s); self.run(i + 1); };
    this.renderStep(s, done);
  };

  Runner.prototype.renderStep = function (s, done) {
    var fn = {
      say: this.sayStep, predict: this.predictStep, 'try': this.tryStep, reveal: this.revealStep,
      derive: this.deriveStep, task: this.taskStep, classify: this.classifyStep, sandbox: this.sandboxStep,
      deeper: this.deeperStep, summary: this.summaryStep
    }[s.type];
    if (!fn) { console.warn('unknown step', s.type); return done(); }
    if (s.onEnter) { try { s.onEnter(this.ctx); } catch (e) { console.error(e); } }
    fn.call(this, s, done);
    var c = this.card;
    setTimeout(function () { c.scrollIntoView && c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
  };

  Runner.prototype.applySideEffects = function (s) {
    var save = this.save;
    if (s.formula) [].concat(s.formula).forEach(function (f) {
      if (SE.save.addFormula(save, f)) SE.ui.toast('Formula sheet: **' + (SE.content.formula(f) ? SE.content.formula(f).title : f) + '** added', 'info');
    });
    if (s.unlock) [].concat(s.unlock).forEach(function (t) {
      if (SE.save.unlockTool(save, t)) { SE.ui.toast('Tool unlocked: **' + SE.tools.nameOf(t) + '** (permanent workshop tool)', 'good', 4200); SE.audio && SE.audio.play('unlock'); }
    });
    if (s.material) [].concat(s.material).forEach(function (m) { if (save.unlocks.materials.indexOf(m) < 0) save.unlocks.materials.push(m); });
    this.game.persist();
    this.game.refreshTopbar && this.game.refreshTopbar();
  };

  Runner.prototype.archiveCard = function () {
    // Move the finished card into the log as a compact entry.
    var c = this.card.firstChild;
    if (c && !c.classList.contains('step-intro')) {
      c.classList.add('archived');
      c.querySelectorAll('button, input, select, textarea').forEach(function (b) { b.disabled = true; });
      this.log.appendChild(c);
      while (this.log.children.length > 6) this.log.removeChild(this.log.firstChild);
    }
    SE.ui.clear(this.card);
  };

  function whoHeader(who) {
    var w = WHO[who || 'hask'] || WHO.hask;
    if (!w.name) return null;
    return el('div', { class: 'who ' + w.cls }, [el('span', { class: 'who-badge', text: w.name[0] }), el('span', { class: 'who-name', text: w.name }), w.role ? el('span', { class: 'who-role', text: w.role }) : null]);
  }

  function cardFor(s, extraClass) {
    return el('div', { class: 'step step-' + s.type + ' ' + (extraClass || '') });
  }

  /* --------------------------------------------------------------- say */
  Runner.prototype.sayStep = function (s, done) {
    var c = cardFor(s);
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text) }));
    var go = btn(s.next || 'Continue ▸', function () { done(); }, 'primary');
    c.appendChild(el('div', { class: 'btn-row' }, [go]));
    this.card.appendChild(c);
    if (s.action) { var self = this; Promise.resolve(s.action(this.ctx)).catch(function (e) { console.error(e); }); }
    setTimeout(function () { go.focus(); }, 40);
  };

  /* ----------------------------------------------------------- predict */
  Runner.prototype.predictStep = function (s, done) {
    var self = this;
    var c = cardFor(s);
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-kicker', text: 'Predict first' }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.q) }));
    var list = el('div', { class: 'choices' });
    var answered = false;
    s.choices.forEach(function (ch, idx) {
      var b = el('button', { class: 'choice', html: '<span class="choice-key">' + String.fromCharCode(65 + idx) + '</span>' + inline(ch.t) });
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        SE.audio && SE.audio.play('click');
        b.classList.add('picked');
        list.querySelectorAll('.choice').forEach(function (x) { x.disabled = true; });
        Promise.resolve(s.run ? s.run(self.ctx, idx) : null).then(function (simMsg) {
          var correct = ch.correct === true || (s.correctIndex === idx);
          var anyCorrect = s.choices.some(function (x) { return x.correct; });
          s.choices.forEach(function (x, k) { if (x.correct) list.children[k].classList.add('right'); });
          if (anyCorrect && !correct) b.classList.add('wrong');
          var fb = el('div', { class: 'feedback ' + (!anyCorrect ? 'neutral' : correct ? 'good' : 'bad') }, [
            el('div', { class: 'feedback-head', text: !anyCorrect ? 'Noted.' : correct ? 'Your prediction held up.' : 'Not what happened. That\'s the point of trying it.' }),
            simMsg ? el('div', { class: 'sim-msg', html: md(simMsg) }) : null,
            ch.why ? el('div', { html: md(ch.why) }) : null,
            s.reveal ? el('div', { class: 'reveal-text', html: md(s.reveal) }) : null
          ]);
          c.appendChild(fb);
          c.appendChild(el('div', { class: 'btn-row' }, [btn('Continue ▸', done, 'primary')]));
          SE.audio && SE.audio.play(!anyCorrect || correct ? 'success' : 'fail', { volume: 0.5 });
        });
      });
      list.appendChild(b);
    });
    c.appendChild(list);
    this.card.appendChild(c);
  };

  /* ------------------------------------------------------- controls ui */
  Runner.prototype.controlsUI = function (keys) {
    var scene = this.ctx.scene;
    if (!scene || !scene.controls) return null;
    var defs = scene.controls().filter(function (d) { return !keys || keys.indexOf(d.key) >= 0; });
    if (!defs.length) return null;
    var box = el('div', { class: 'controls' });
    defs.forEach(function (d) {
      var val = el('span', { class: 'ctl-val' });
      var show = function (v) { val.textContent = (d.format ? d.format(v) : (+Number(v).toPrecision(4))) + (d.unit ? ' ' + d.unit : ''); };
      var inp;
      if (d.options) {
        inp = el('select', { class: 'ctl-select' }, d.options.map(function (o) { return el('option', { value: o.value, text: o.label, selected: String(o.value) === String(d.value) }); }));
        inp.addEventListener('change', function () { scene.set(d.key, isNaN(Number(inp.value)) ? inp.value : Number(inp.value)); });
        box.appendChild(el('label', { class: 'ctl' }, [el('span', { class: 'ctl-label', html: inline(d.label) }), inp]));
        return;
      }
      if (d.type === 'button') {
        box.appendChild(btn(d.label, function () { scene.set(d.key, true); }, 'small'));
        return;
      }
      if (d.type === 'toggle') {
        inp = el('input', { type: 'checkbox', checked: !!d.value });
        inp.addEventListener('change', function () { scene.set(d.key, inp.checked); });
        box.appendChild(el('label', { class: 'ctl ctl-toggle' }, [inp, el('span', { class: 'ctl-label', html: inline(d.label) })]));
        return;
      }
      inp = el('input', { type: 'range', min: d.min, max: d.max, step: d.step || ((d.max - d.min) / 100), value: d.value });
      show(d.value);
      inp.addEventListener('input', function () { show(inp.value); scene.set(d.key, Number(inp.value)); });
      box.appendChild(el('label', { class: 'ctl' }, [el('span', { class: 'ctl-label', html: inline(d.label) }), inp, val]));
    });
    return box;
  };

  /* --------------------------------------------------------------- try */
  Runner.prototype.tryStep = function (s, done) {
    var self = this;
    var c = cardFor(s);
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-kicker', text: 'Try it' }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text) }));
    var ctl = this.controlsUI(s.controls);
    if (ctl) c.appendChild(ctl);
    var status = el('div', { class: 'goal-status', html: s.goalText ? '◻ ' + inline(s.goalText) : '' });
    c.appendChild(status);
    var cont = btn('Continue ▸', function () { clearInterval(timer); done(); }, 'primary', { disabled: !!s.goal });
    var actions = el('div', { class: 'btn-row' });
    (s.actions || []).forEach(function (a) {
      actions.appendChild(btn(a.label, function () { Promise.resolve(a.run(self.ctx)).then(function (msg) { if (msg) self.flashMsg(c, msg); }); }, 'secondary'));
    });
    actions.appendChild(cont);
    c.appendChild(actions);
    var met = false;
    var timer = setInterval(function () {
      if (self.dead) return clearInterval(timer);
      if (!s.goal || met) return;
      var ok = false;
      try { ok = s.goal(self.ctx); } catch (e) { ok = false; }
      if (ok) {
        met = true; cont.disabled = false;
        status.innerHTML = '✔ ' + inline(s.goalText || 'Done');
        status.classList.add('met');
        SE.audio && SE.audio.play('success', { volume: 0.5 });
        if (s.after) c.insertBefore(el('div', { class: 'feedback good', html: md(s.after) }), actions);
      }
    }, 150);
    this.card.appendChild(c);
  };

  Runner.prototype.flashMsg = function (c, msg) {
    var old = c.querySelector('.sim-msg.flash'); if (old) old.remove();
    var m = el('div', { class: 'sim-msg flash', html: md(msg) });
    c.insertBefore(m, c.querySelector('.btn-row'));
  };

  /* ------------------------------------------------------------ reveal */
  Runner.prototype.revealStep = function (s, done) {
    var c = cardFor(s, 'law-card');
    c.appendChild(el('div', { class: 'step-kicker', text: s.kicker || 'Principle' }));
    if (s.title) c.appendChild(el('h2', { class: 'law-title', text: s.title }));
    if (s.eq) c.appendChild(el('div', { class: 'eq-block big', html: SE.eq.html(s.eq, s.tag) }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text || '') }));
    if (s.table) c.appendChild(SE.tools.table(s.table));
    if (s.formula) c.appendChild(el('div', { class: 'muted small', text: '→ added to your formula sheet' }));
    c.appendChild(el('div', { class: 'btn-row' }, [btn('Got it ▸', done, 'primary')]));
    this.card.appendChild(c);
    SE.audio && SE.audio.play('stamp', { volume: 0.4 });
  };

  /* ------------------------------------------------------------ derive */
  Runner.prototype.deriveStep = function (s, done) {
    var self = this;
    var c = cardFor(s, 'derive-card');
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-kicker', text: 'Derivation' }));
    if (s.title) c.appendChild(el('h2', { class: 'law-title', text: s.title }));
    if (s.intro) c.appendChild(el('div', { class: 'step-body', html: md(s.intro) }));
    var lines = el('ol', { class: 'derive-lines' });
    c.appendChild(lines);
    var row = el('div', { class: 'btn-row' });
    c.appendChild(row);
    this.card.appendChild(c);
    var i = 0;
    function showLine(L) {
      var li = el('li', { class: 'derive-line' }, [
        el('div', { class: 'derive-eq', html: SE.eq.html(L.eq, L.tag) }),
        L.why ? el('div', { class: 'derive-why', html: inline(L.why) }) : null
      ]);
      lines.appendChild(li);
      SE.audio && SE.audio.play('typewriter', { volume: 0.5 });
    }
    function next() {
      SE.ui.clear(row);
      if (i >= s.lines.length) {
        if (s.outro) c.insertBefore(el('div', { class: 'step-body', html: md(s.outro) }), row);
        row.appendChild(btn('Continue ▸', done, 'primary'));
        return;
      }
      var L = s.lines[i++];
      if (L.ask) {
        var q = el('div', { class: 'derive-ask' }, [el('div', { html: md(L.ask.q) })]);
        var ch = el('div', { class: 'choices compact' });
        L.ask.choices.forEach(function (o, k) {
          var b = el('button', { class: 'choice', html: '<span class="choice-key">' + String.fromCharCode(65 + k) + '</span>' + inline(o.t) });
          b.addEventListener('click', function () {
            if (o.correct) {
              b.classList.add('right');
              q.appendChild(el('div', { class: 'feedback good', html: md(o.why || 'Right.') }));
              ch.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
              setTimeout(function () { q.classList.add('answered'); showLine(L); next(); }, 500);
            } else {
              b.classList.add('wrong'); b.disabled = true;
              q.appendChild(el('div', { class: 'feedback bad', html: md(o.why || 'Not that one. Look again at what we need.') }));
              SE.audio && SE.audio.play('fail', { volume: 0.4 });
            }
          });
          ch.appendChild(b);
        });
        q.appendChild(ch);
        lines.appendChild(el('li', { class: 'derive-line asking' }, [q]));
        return;
      }
      showLine(L);
      row.appendChild(btn(i < s.lines.length ? 'Next step ▸' : 'Finish ▸', next, 'secondary'));
    }
    next();
  };

  /* -------------------------------------------------------------- task */
  /*
   * Task step fields:
   *   id, text, inputs: [{ key, label, spec, answer (canonical), placeholder }],
   *   hints: [nudge, method, worked]   (markup strings)
   *   consequence(ctx, answers) -> Promise<string|{msg}>  runs on every
   *     submission with the player's parsed values (SI) so the physics shows
   *     what their numbers would do.
   *   explain: shown after success.  required: default true.
   */
  Runner.prototype.taskStep = function (s, done, isProve) {
    var self = this;
    var c = cardFor(s, 'task-card');
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-kicker', text: isProve ? 'Prove it' : (s.required === false ? 'Optional task' : 'Job') }));
    if (s.title) c.appendChild(el('h2', { class: 'law-title', text: s.title }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text) }));
    var fields = (s.inputs || []).map(function (inp) {
      var f = SE.ui.answerField({ label: inp.label, placeholder: inp.placeholder, onEnter: function () { submit(); } });
      c.appendChild(f.el);
      return { def: inp, field: f };
    });
    var feedback = el('div', { class: 'task-feedback' });
    var hintBox = el('div', { class: 'hints' });
    var row = el('div', { class: 'btn-row' });
    var hintTier = 0, wrong = 0, solved = false, busy = false;
    var submitBtn = btn('Submit ▸', function () { submit(); }, 'primary');
    row.appendChild(submitBtn);
    var hintBtn = null;
    if (s.hints && s.hints.length && !isProve) {
      hintBtn = btn('Hint (−' + SE.scoring.HINT_COST[1] + ')', function () { showHint(); }, 'ghost');
      row.appendChild(hintBtn);
    }
    c.appendChild(hintBox); c.appendChild(row); c.appendChild(feedback);
    this.card.appendChild(c);
    if (fields[0]) setTimeout(function () { fields[0].field.focus(); }, 60);

    function showHint() {
      if (hintTier >= s.hints.length) return;
      hintTier++;
      self.save.stats.hintsUsed++;
      var names = ['Nudge', 'Method', 'Worked step'];
      hintBox.appendChild(el('div', { class: 'hint tier' + hintTier }, [el('span', { class: 'hint-tier', text: names[hintTier - 1] }), el('div', { html: md(s.hints[hintTier - 1]) })]));
      if (hintTier < s.hints.length) hintBtn.innerHTML = inline(names[hintTier] + ' (−' + (SE.scoring.HINT_COST[hintTier + 1] - SE.scoring.HINT_COST[hintTier]) + ' more)');
      else hintBtn.remove();
    }

    function submit() {
      if (busy || solved) return;
      var answers = {};
      var all = true, parts = [];
      fields.forEach(function (f) {
        var spec = typeof f.def.spec === 'function' ? f.def.spec(self.ctx) : f.def.spec;
        var r = SE.checker.check(f.field.value(), spec);
        answers[f.def.key] = { result: r, si: r.parsed && r.parsed.ok ? r.parsed.value : null, spec: spec };
        if (!r.correct) all = false;
        parts.push({ r: r, spec: spec });
      });
      busy = true; submitBtn.disabled = true;
      SE.ui.clear(feedback);
      feedback.appendChild(el('div', { class: 'muted', text: 'Testing it for real…' }));
      Promise.resolve(s.consequence ? s.consequence(self.ctx, answers, all) : null).then(function (cons) {
        busy = false; submitBtn.disabled = false;
        SE.ui.clear(feedback);
        var consMsg = cons && (cons.msg || cons);
        if (all) {
          solved = true;
          var base = Math.round(parts.reduce(function (a, p) { return a + SE.scoring.partsScore(p.r, p.spec); }, 0) / Math.max(1, parts.length));
          var score = SE.scoring.taskScore({ base: base, hintTier: hintTier, wrongAttempts: wrong });
          var rec = isProve ? null : self.recordTask(s.id, score);
          feedback.appendChild(el('div', { class: 'feedback good' }, [
            el('div', { class: 'feedback-head', html: '✔ It works. <span class="grade grade-' + SE.scoring.grade(score) + '">' + SE.scoring.grade(score) + '</span> <span class="score">' + score + '</span>' + (rec && rec.isBest && rec.prev != null ? ' <span class="pb">new personal best</span>' : '') }),
            typeof consMsg === 'string' ? el('div', { class: 'sim-msg', html: md(consMsg) }) : null,
            s.explain && !isProve ? el('div', { class: 'explain', html: md(s.explain) }) : null
          ]));
          fields.forEach(function (f) { f.field.input.disabled = true; });
          submitBtn.remove(); if (hintBtn) hintBtn.remove();
          row.appendChild(btn('Continue ▸', function () { done({ firstTry: wrong === 0 && hintTier === 0, score: score }); }, 'primary'));
          self.values[s.id] = answers;
          SE.audio && SE.audio.play('success');
          self.save.stats.tasksSolved++;
          self.game.persist();
          if (isProve) setTimeout(function () { done({ firstTry: wrong === 0, score: score }); }, 600);
        } else {
          wrong++;
          var box = el('div', { class: 'feedback bad' });
          var heads = {};
          parts.forEach(function (p, k) {
            var r = p.r;
            if (r.correct) return;
            var lbl = fields.length > 1 ? stripMarkup(fields[k].def.label) + ': ' : '';
            r.errors.forEach(function (e) {
              var key = lbl + e.kind + e.msg;
              if (heads[key]) return; heads[key] = 1;
              box.appendChild(el('div', { class: 'err' }, [el('span', { class: 'err-kind k-' + e.kind, text: SE.scoring.KIND_LABEL[e.kind] || e.kind }), el('span', { html: inline(lbl + e.msg) })]));
            });
            r.notes.forEach(function (n) { box.appendChild(el('div', { class: 'note', text: n })); });
            if (!r.parts.value && r.parts.units && !r.errors.length) box.appendChild(el('div', { text: lbl + 'Value not right yet.' }));
          });
          if (typeof consMsg === 'string') box.insertBefore(el('div', { class: 'sim-msg', html: md(consMsg) }), box.firstChild);
          box.insertBefore(el('div', { class: 'feedback-head', text: isProve ? 'Missed. The full lesson will cover this.' : 'Not yet. Here is what went wrong.' }), box.firstChild);
          feedback.appendChild(box);
          SE.audio && SE.audio.play('fail');
          if (isProve) { setTimeout(function () { done({ firstTry: false }); }, 1400); solved = true; }
        }
      }).catch(function (e) { console.error(e); busy = false; submitBtn.disabled = false; });
    }
  };

  function stripMarkup(s) { return String(s).replace(/\$[^$]*\$/g, function (m) { return m.slice(1, -1); }).replace(/[*`]/g, ''); }

  Runner.prototype.recordTask = function (id, score) {
    var rec = SE.save.recordBest(this.save, id, score);
    this.lvState.tasks[id] = Math.max(this.lvState.tasks[id] || 0, score);
    this.sessionScores[id] = score;
    return rec;
  };

  /* ---------------------------------------------------------- classify */
  /*
   * { id, text, bins: ['Statics', 'Dynamics'], items: [{ t, bin, why, preview(ctx) }] }
   * Score = share of items placed correctly on the first submission
   * (later corrections still count for completion).
   */
  Runner.prototype.classifyStep = function (s, done) {
    var self = this;
    var c = cardFor(s, 'task-card');
    c.appendChild(whoHeader(s.who) || el('span'));
    c.appendChild(el('div', { class: 'step-kicker', text: s.required === false ? 'Optional sort' : 'Sort it' }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text) }));
    var rows = s.items.map(function (it, i) {
      var sel = el('div', { class: 'bin-pick', role: 'radiogroup' });
      var chosen = null;
      s.bins.forEach(function (b, bi) {
        var bb = el('button', { class: 'bin-btn', text: b, role: 'radio', 'aria-checked': 'false' });
        bb.addEventListener('click', function () {
          chosen = bi;
          sel.querySelectorAll('.bin-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
          bb.classList.add('on'); bb.setAttribute('aria-checked', 'true');
          SE.audio && SE.audio.play('click');
        });
        sel.appendChild(bb);
      });
      var preview = it.preview ? btn('▶ watch', function () { it.preview(self.ctx); }, 'small ghost') : null;
      var r = el('div', { class: 'classify-row' + (s.bins.length > 3 ? ' many' : '') }, [el('div', { class: 'classify-item', html: inline(it.t) }), preview, sel]);
      return { el: r, get: function () { return chosen; }, it: it };
    });
    var list = el('div', { class: 'classify' }, rows.map(function (r) { return r.el; }));
    c.appendChild(list);
    var fb = el('div', { class: 'task-feedback' });
    var row = el('div', { class: 'btn-row' });
    var first = null, solved = false;
    var sub = btn('Submit ▸', function () {
      if (solved) return;
      var missing = rows.some(function (r) { return r.get() == null; });
      if (missing) { SE.ui.toast('Sort every item first.', 'warn'); return; }
      var right = 0;
      rows.forEach(function (r) {
        var ok = s.bins[r.get()] === r.it.bin || r.get() === r.it.bin;
        r.el.classList.toggle('right', ok); r.el.classList.toggle('wrong', !ok);
        if (ok) right++;
      });
      if (first == null) first = right / rows.length;
      SE.ui.clear(fb);
      if (right === rows.length) {
        solved = true;
        var score = Math.round(100 * first);
        var rec = self.recordTask(s.id, score);
        fb.appendChild(el('div', { class: 'feedback good' }, [
          el('div', { class: 'feedback-head', html: '✔ All sorted. <span class="grade grade-' + SE.scoring.grade(score) + '">' + SE.scoring.grade(score) + '</span> <span class="score">' + score + '</span>' }),
          el('ul', {}, s.items.map(function (it) { return el('li', { html: inline('**' + it.t + '**: ' + (it.why || it.bin)) }); }))
        ]));
        sub.remove();
        row.appendChild(btn('Continue ▸', done, 'primary'));
        SE.audio && SE.audio.play('success');
        self.game.persist();
      } else {
        fb.appendChild(el('div', { class: 'feedback bad' }, [el('div', { class: 'feedback-head', text: (rows.length - right) + ' misplaced. Fix the red ones.' })].concat(
          rows.filter(function (r) { return r.el.classList.contains('wrong') && r.it.hint; }).map(function (r) { return el('div', { html: inline(r.it.hint) }); })
        )));
        SE.audio && SE.audio.play('fail');
      }
    }, 'primary');
    row.appendChild(sub);
    c.appendChild(row); c.appendChild(fb);
    this.card.appendChild(c);
  };

  /* ----------------------------------------------------------- sandbox */
  Runner.prototype.sandboxStep = function (s, done) {
    var self = this;
    var c = cardFor(s, 'sandbox-card');
    c.appendChild(el('div', { class: 'step-kicker', text: 'Sandbox: experiment freely' }));
    c.appendChild(el('div', { class: 'step-body', html: md(s.text || 'Change anything. Nothing is scored here.') }));
    var ctl = this.controlsUI(s.controls);
    if (ctl) c.appendChild(ctl);
    if (s.prompts) c.appendChild(el('div', { class: 'prompts' }, [el('h3', { text: 'Things to try' }), el('ul', {}, s.prompts.map(function (p) { return el('li', { html: inline(p) }); }))]));
    var actions = el('div', { class: 'btn-row' });
    (s.actions || []).forEach(function (a) {
      actions.appendChild(btn(a.label, function () { Promise.resolve(a.run(self.ctx)).then(function (msg) { if (msg) self.flashMsg(c, msg); }); }, 'secondary'));
    });
    actions.appendChild(btn('Done exploring ▸', done, 'primary'));
    c.appendChild(actions);
    this.card.appendChild(c);
  };

  /* ------------------------------------------------------------ deeper */
  Runner.prototype.deeperStep = function (s, done) {
    var self = this;
    var c = cardFor(s, 'deeper-card');
    c.appendChild(el('div', { class: 'step-kicker deeper-kicker', text: 'Go deeper · optional · beyond the course text' }));
    c.appendChild(el('h2', { class: 'law-title', text: s.title }));
    if (s.teaser) c.appendChild(el('div', { class: 'step-body', html: md(s.teaser) }));
    var row = el('div', { class: 'btn-row' }, [
      btn('Go deeper ▸', function () {
        var sub = s.steps || [{ type: 'say', who: s.who || 'hask', text: s.text }];
        var j = 0;
        var prevCard = c;
        (function nextSub() {
          if (j >= sub.length) { if (s.scene && s.restoreScene) self.ctx.setScene(s.restoreScene.type, s.restoreScene.params); return done(); }
          var st = Object.assign({ deeper: true }, sub[j++]);
          self.archiveCard();
          if (st.scene) self.ctx.setScene(st.scene.type, st.scene.params);
          self.renderStep(st, function () { self.applySideEffects(st); nextSub(); });
        })();
      }, 'secondary'),
      btn('Skip for now', done, 'ghost')
    ]);
    if (s.scene) c.dataset.scene = s.scene.type;
    c.appendChild(row);
    this.card.appendChild(c);
  };

  /* ----------------------------------------------------------- summary */
  Runner.prototype.summaryStep = function (s, done) {
    var c = cardFor(s, 'summary-card');
    c.appendChild(el('div', { class: 'step-kicker', text: 'What you now know' }));
    c.appendChild(el('ul', { class: 'summary-points' }, (s.points || []).map(function (p) { return el('li', { html: inline(p) }); })));
    if (s.text) c.appendChild(el('div', { class: 'step-body', html: md(s.text) }));
    c.appendChild(el('div', { class: 'btn-row' }, [btn('Finish level ▸', done, 'primary')]));
    this.card.appendChild(c);
  };

  /* ---------------------------------------------------------- complete */
  Runner.prototype.complete = function () {
    var self = this;
    var lv = this.level;
    if (lv.sandbox) { this.game.show('act', { chapter: lv.chapter }); return; }
    this.archiveCard();
    this.applySideEffects({ unlock: lv.unlocks && lv.unlocks.tools, formula: lv.unlocks && lv.unlocks.formulas, material: lv.unlocks && lv.unlocks.materials });
    var ids = [];
    SE.content.walkSteps(lv.steps, function (s) { if ((s.type === 'task' || s.type === 'classify') && s.required !== false && !s.deeper) ids.push(s.id); });
    var m = SE.scoring.mastery(ids, this.save.bests);
    this.lvState.done = true;
    this.lvState.mastery = Math.max(this.lvState.mastery || 0, m);
    this.save.stats.playSeconds += Math.round((Date.now() - this.started) / 1000);
    this.game.persist();
    var c = el('div', { class: 'step level-complete' }, [
      el('div', { class: 'step-kicker', text: 'Level complete' }),
      el('h2', { class: 'law-title', text: lv.title }),
      el('div', { class: 'big-grade grade-' + SE.scoring.grade(m), text: ids.length ? SE.scoring.grade(m) : '✔' }),
      ids.length ? el('div', { class: 'muted', text: 'Level mastery ' + m + '% (best scores across its tasks)' }) : null,
      el('table', { class: 'ref-table' }, [el('tbody', {}, ids.map(function (id) {
        var b = self.save.bests[id];
        return el('tr', {}, [el('td', { text: id }), el('td', { text: b ? b.score + '' : '—' }), el('td', { html: b ? '<span class="grade grade-' + b.grade + '">' + b.grade + '</span>' : '' })]);
      }))]),
      el('div', { class: 'btn-row' }, [
        btn('Back to the depot', function () { self.game.show('act', { chapter: lv.chapter }); }, 'secondary'),
        this.nextLevel() ? btn('Next: ' + this.nextLevel().title + ' ▸', function () { self.game.show('level', { chapter: lv.chapter, id: self.nextLevel().id }); }, 'primary') : null
      ])
    ]);
    this.card.appendChild(c);
    SE.audio && SE.audio.play('unlock');
    this.stage.burst(this.stage.w / 2, this.stage.h / 3, { n: 60, color: '#e6b422', speed: 320 });
  };

  Runner.prototype.nextLevel = function () {
    var ch = SE.content.chapter(this.level.chapter);
    var i = ch.levels.indexOf(this.level);
    return ch.levels[i + 1] || null;
  };

  SE.Runner = Runner;
})(globalThis.SE);
