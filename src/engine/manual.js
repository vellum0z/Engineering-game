/*
 * Manual-mode runner: a project brief, the sandbox, the tools and a work
 * order. Nothing else is shown unless the player asks.
 *
 * Project definition (see CONTRIBUTING.md):
 *   id, title, order, brief (markup), conditions: [markup],
 *   scene: { type, params }, controls: [scene control keys for the test rig],
 *   lockedTools: ['converter', ...], deeper: [markup notes on beyond-the-book
 *   factors the brief contains — shown only in the debrief],
 *   deliverables: [{ id, label, spec, answer, hints: [nudge, method, worked],
 *                    consequence(ctx, answer) -> Promise<string>, check?: markup }],
 *   debrief: markup shown after all deliverables pass.
 */
(function (SE) {
  'use strict';
  var el, md, inline, btn;

  function Manual(project) {
    el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline; btn = SE.ui.button;
    this.p = project;
    this.save = SE.game.save;
    this.chState = SE.save.chapterState(this.save, project.chapter);
    this.st = this.chState.projects[project.id] = this.chState.projects[project.id] || { done: false, deliverables: {} };
    this.started = Date.now();
  }

  Manual.prototype.mount = function (root) {
    var self = this, p = this.p;
    SE.ui.clear(root);
    this.canvas = el('canvas', { class: 'stage-canvas' });
    var stageWrap = el('div', { class: 'stage-wrap' }, [this.canvas]);
    this.tabs = el('div', { class: 'tabs', role: 'tablist' });
    this.body = el('div', { class: 'panel-body' });
    var panel = el('aside', { class: 'panel clipboard manual' }, [
      el('div', { class: 'clip' }),
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'panel-kicker', text: 'Manual · project brief · ' + p.id }),
        el('h1', { class: 'panel-title', text: p.title })
      ]),
      this.tabs, this.body
    ]);
    root.appendChild(el('div', { class: 'play-layout' }, [stageWrap, panel]));
    this.stage = new SE.Stage(this.canvas);
    this.stage.reducedMotion = !!this.save.settings.reducedMotion;
    this.ctx = {
      stage: this.stage, save: this.save, project: p, values: {},
      setScene: function (type, params) {
        self.ctx.scene = self.stage.load(new SE.scenes[type](), Object.assign({}, params || {}));
        self.ctx.sceneType = type;
        return self.ctx.scene;
      },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    };
    if (p.scene) this.ctx.setScene(p.scene.type, p.scene.params);
    setTimeout(function () { self.stage.resize(); }, 0);
    this.tabDefs = [
      { id: 'brief', label: 'Brief' },
      { id: 'work', label: 'Work order' },
      { id: 'rig', label: 'Test rig' },
      { id: 'debrief', label: 'Debrief' }
    ];
    this.tabDefs.forEach(function (t) {
      var b = el('button', { class: 'tab', role: 'tab', text: t.label, onclick: function () { self.show(t.id); } });
      t.btn = b; self.tabs.appendChild(b);
    });
    this.show('brief');
  };

  Manual.prototype.unmount = function () { if (this.stage) this.stage.stop(); };

  Manual.prototype.show = function (id) {
    this.tabDefs.forEach(function (t) { t.btn.classList.toggle('on', t.id === id); t.btn.setAttribute('aria-selected', t.id === id ? 'true' : 'false'); });
    SE.ui.clear(this.body);
    this['tab_' + id]();
  };

  Manual.prototype.tab_brief = function () {
    var p = this.p, self = this;
    this.body.appendChild(el('div', { class: 'brief' }, [
      el('div', { class: 'who who-juno' }, [el('span', { class: 'who-badge', text: 'J' }), el('span', { class: 'who-name', text: 'Juno' }), el('span', { class: 'who-role', text: 'settlement chief' })]),
      el('div', { class: 'step-body', html: md(p.brief) }),
      p.conditions ? el('div', { class: 'conditions' }, [el('h3', { text: 'Site conditions' }), el('ul', {}, p.conditions.map(function (c) { return el('li', { html: inline(c) }); }))]) : null,
      p.lockedTools && p.lockedTools.length ? el('div', { class: 'muted small', text: 'Unavailable for this brief: ' + p.lockedTools.map(SE.tools.nameOf).join(', ') + '. This job tests that skill by hand.' }) : null,
      el('div', { class: 'muted small', html: inline('Your formula sheet, calculator and notebook are in the top bar. Hints exist on the work order, but only if you ask, and they cost score. No time limit.') }),
      el('div', { class: 'btn-row' }, [btn('Open the work order ▸', function () { self.show('work'); }, 'primary')])
    ]));
  };

  Manual.prototype.tab_rig = function () {
    var self = this, p = this.p;
    var box = el('div', {}, [el('div', { class: 'step-body', html: md(p.rigText || 'The test rig runs the real physics. Use it to check your thinking before you commit numbers to the work order.') })]);
    var scene = this.ctx.scene;
    if (scene && scene.controls) {
      var R = SE.Runner.prototype.controlsUI.call({ ctx: this.ctx }, p.controls);
      if (R) box.appendChild(R);
    }
    (p.rigActions || []).forEach(function (a) {
      box.appendChild(btn(a.label, function () { Promise.resolve(a.run(self.ctx)).then(function (m) { if (m) SE.ui.toast(m, 'info', 5000); }); }, 'secondary'));
    });
    box.appendChild(btn('Reset the rig', function () { if (p.scene) self.ctx.setScene(p.scene.type, p.scene.params); self.show('rig'); }, 'ghost'));
    this.body.appendChild(box);
  };

  Manual.prototype.tab_work = function () {
    var self = this, p = this.p;
    var list = el('div', { class: 'work-order' });
    p.deliverables.forEach(function (d, i) { list.appendChild(self.deliverableCard(d, i)); });
    this.body.appendChild(list);
    var doneCount = p.deliverables.filter(function (d) { return self.st.deliverables[d.id] && self.st.deliverables[d.id].solved; }).length;
    this.body.appendChild(el('div', { class: 'btn-row' }, [
      el('span', { class: 'muted', text: doneCount + ' / ' + p.deliverables.length + ' signed off' }),
      btn('File the report', function () { self.show('debrief'); }, doneCount === p.deliverables.length ? 'primary' : 'ghost')
    ]));
  };

  Manual.prototype.deliverableCard = function (d, i) {
    var self = this;
    var ds = this.st.deliverables[d.id] = this.st.deliverables[d.id] || { solved: false, hintTier: 0, wrong: 0 };
    var c = el('div', { class: 'deliverable' + (ds.solved ? ' solved' : '') });
    c.appendChild(el('div', { class: 'deliverable-head' }, [
      el('span', { class: 'deliverable-num', text: String(i + 1) }),
      el('div', { class: 'deliverable-label', html: md(d.label) }),
      ds.solved ? el('span', { class: 'grade grade-' + SE.scoring.grade(ds.score) , text: SE.scoring.grade(ds.score) }) : null
    ]));
    var f = SE.ui.answerField({ label: 'Your figure', placeholder: d.placeholder || 'number with units', onEnter: function () { submit(); } });
    if (ds.last) f.set(ds.last);
    c.appendChild(f.el);
    var hints = el('div', { class: 'hints' });
    for (var h = 0; h < ds.hintTier; h++) hints.appendChild(hintEl(d, h));
    c.appendChild(hints);
    var fb = el('div', { class: 'task-feedback' });
    var row = el('div', { class: 'btn-row' });
    var sub = btn(ds.solved ? 'Re-test' : 'Sign off & test ▸', function () { submit(); }, 'primary');
    row.appendChild(sub);
    var hb = null;
    function hintLabel() { var names = ['Ask for a nudge', 'Ask for the method', 'Ask for a worked step']; return names[ds.hintTier] + ' (−' + (SE.scoring.HINT_COST[ds.hintTier + 1] - SE.scoring.HINT_COST[ds.hintTier]) + ')'; }
    if (d.hints && ds.hintTier < d.hints.length) {
      hb = btn(hintLabel(), function () {
        ds.hintTier++; self.save.stats.hintsUsed++;
        hints.appendChild(hintEl(d, ds.hintTier - 1));
        if (ds.hintTier >= d.hints.length) hb.remove(); else hb.innerHTML = inline(hintLabel());
        SE.game.persist();
      }, 'ghost');
      row.appendChild(hb);
    }
    c.appendChild(row); c.appendChild(fb);

    var busy = false;
    function submit() {
      if (busy) return;
      var spec = typeof d.spec === 'function' ? d.spec(self.ctx) : d.spec;
      var r = SE.checker.check(f.value(), spec);
      ds.last = f.value();
      busy = true; sub.disabled = true;
      SE.ui.clear(fb); fb.appendChild(el('div', { class: 'muted', text: 'Running it on the rig…' }));
      var ans = { result: r, si: r.parsed && r.parsed.ok ? r.parsed.value : null, spec: spec };
      self.ctx.values[d.id] = ans;
      Promise.resolve(d.consequence ? d.consequence(self.ctx, ans, r.correct) : null).then(function (msg) {
        busy = false; sub.disabled = false;
        SE.ui.clear(fb);
        msg = msg && (msg.msg || msg);
        if (r.correct) {
          var base = SE.scoring.partsScore(r, spec);
          var score = SE.scoring.taskScore({ base: base, hintTier: ds.hintTier, wrongAttempts: ds.wrong });
          var first = !ds.solved;
          ds.solved = true; ds.score = Math.max(ds.score || 0, score);
          var rec = SE.save.recordBest(self.save, d.id, score);
          if (first) self.save.stats.tasksSolved++;
          fb.appendChild(el('div', { class: 'feedback good' }, [
            el('div', { class: 'feedback-head', html: '✔ Signed off. <span class="grade grade-' + SE.scoring.grade(score) + '">' + SE.scoring.grade(score) + '</span> <span class="score">' + score + '</span>' + (rec.isBest && rec.prev != null ? ' <span class="pb">new personal best</span>' : '') }),
            typeof msg === 'string' ? el('div', { class: 'sim-msg', html: md(msg) }) : null
          ]));
          c.classList.add('solved');
          SE.audio && SE.audio.play('success');
        } else {
          ds.wrong++;
          var box = el('div', { class: 'feedback bad' }, [el('div', { class: 'feedback-head', text: 'Failed inspection.' })]);
          if (typeof msg === 'string') box.appendChild(el('div', { class: 'sim-msg', html: md(msg) }));
          r.errors.forEach(function (e) { box.appendChild(el('div', { class: 'err' }, [el('span', { class: 'err-kind k-' + e.kind, text: SE.scoring.KIND_LABEL[e.kind] || e.kind }), el('span', { html: inline(e.msg) })])); });
          r.notes.forEach(function (n) { box.appendChild(el('div', { class: 'note', text: n })); });
          fb.appendChild(box);
          SE.audio && SE.audio.play('fail');
        }
        SE.game.persist();
      }).catch(function (e) { console.error(e); busy = false; sub.disabled = false; });
    }
    return c;
  };

  function hintEl(d, h) {
    var names = ['Nudge', 'Method', 'Worked step'];
    return el('div', { class: 'hint tier' + (h + 1) }, [el('span', { class: 'hint-tier', text: names[h] }), el('div', { html: md(d.hints[h]) })]);
  }

  Manual.prototype.tab_debrief = function () {
    var self = this, p = this.p;
    var solved = p.deliverables.filter(function (d) { return self.st.deliverables[d.id] && self.st.deliverables[d.id].solved; });
    var ids = p.deliverables.map(function (d) { return d.id; });
    var m = SE.scoring.mastery(ids, this.save.bests);
    if (solved.length === p.deliverables.length && !this.st.done) {
      this.st.done = true; this.st.mastery = m;
      this.save.stats.playSeconds += Math.round((Date.now() - this.started) / 1000);
      SE.game.persist();
      SE.audio && SE.audio.play('unlock');
    }
    this.body.appendChild(el('div', {}, [
      el('div', { class: 'big-grade grade-' + SE.scoring.grade(m), text: solved.length === p.deliverables.length ? SE.scoring.grade(m) : '…' }),
      el('div', { class: 'muted', text: 'Project score ' + m + '% · ' + solved.length + '/' + p.deliverables.length + ' deliverables signed off' }),
      solved.length === p.deliverables.length ? el('div', { class: 'step-body', html: md(p.debrief || '') }) : el('div', { class: 'step-body', html: md('Not every deliverable has passed yet. The report stays open, so come back any time.') }),
      solved.length === p.deliverables.length && p.deeper ? el('div', { class: 'deeper-card step' }, [el('div', { class: 'step-kicker deeper-kicker', text: 'Beyond the book: what this brief made you handle' }), el('ul', {}, p.deeper.map(function (x) { return el('li', { html: inline(x) }); }))]) : null,
      el('div', { class: 'btn-row' }, [btn('Back to the depot', function () { SE.game.show('act', { chapter: p.chapter }); }, 'secondary')])
    ]));
  };

  SE.Manual = Manual;
})(globalThis.SE);
