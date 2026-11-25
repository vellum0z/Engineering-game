/*
 * Manual projects in the build yard.
 *
 * A project with a `yard` block opens the yard with the full parts library
 * and a job card instead of the old work order of answer boxes:
 *
 *   SE.content.registerProject('ch01', {
 *     id: 'P1', title, order, brief, conditions: [...], deeper: [...], debrief,
 *     yard: { site, design, camera, bin: 'library' (default) | [...] },
 *     jobs: [{ id: 'P1.lift', label: 'markup', objective: 'short line pinned on the yard', goal, timeout, hints: [nudge, method, worked],
 *              margin(s) -> points off, grade: { part, key, spec }, design (fresh start),
 *              success: md, onFail: fn(ctx) -> md }],
 *     solutions: { 'P1.lift': { add: [...], set: {...} } }      // reference builds (tests)
 *   });
 *
 * The project can set `pitch` (one or two sentences for the start card); the
 * full brief and site conditions sit behind the Job card tab and the Guide.
 * Jobs are signed off one at a time. Pick a job, build, press Run: the
 * simulation judges it. Each job keeps the player's build when they move
 * on unless it gives its own `design`.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard;
  if (!SE.Manual) return;
  var M = SE.Manual.prototype;
  var el, md, inline, btn;
  var baseMount = M.mount, baseUnmount = M.unmount, baseShow = M.show;

  M.mount = function (root) {
    if (!this.p.yard) return baseMount.call(this, root);
    el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline; btn = SE.ui.button;
    var self = this, p = this.p;
    SE.ui.clear(root);
    this.yardEl = el('div', { class: 'stage-wrap yard-wrap' });
    this.tabs = el('div', { class: 'tabs', role: 'tablist' });
    this.inspector = el('div', { class: 'yard-inspector' });
    this.body = el('div', { class: 'panel-body' });
    root.appendChild(el('div', { class: 'play-layout yard-layout' }, [this.yardEl, el('aside', { class: 'panel clipboard manual' }, [
      el('div', { class: 'clip' }),
      el('div', { class: 'panel-head' }, [el('div', { class: 'panel-kicker', text: 'Manual · ' + p.id }),
        el('div', { class: 'panel-head-row' }, [el('h1', { class: 'panel-title', text: p.title }), btn('📖 Guide', function () { self.openGuide(); }, 'ghost small guide-btn', { title: 'The full job card, site conditions and controls' })])]),
      this.tabs, this.inspector, this.body
    ])]));
    this.ctx = { save: this.save, project: p, values: {} };
    this.jobIndex = 0;
    this.makeYard(Object.assign({ bin: 'library' }, p.yard));
    this.tabDefs = [{ id: 'brief', label: 'Start' }, { id: 'jobs', label: 'Jobs' }, { id: 'debrief', label: 'Debrief' }];
    this.tabDefs.forEach(function (t) {
      var b = el('button', { class: 'tab', role: 'tab', text: t.label, onclick: function () { self.show(t.id); } });
      t.btn = b; self.tabs.appendChild(b);
    });
    this.show('brief');
  };

  M.makeYard = function (opts) {
    if (this.yard) { opts.units = this.yard.units; this.yard.unmount(); }
    var self = this;
    this.yard = new Y.Yard(Object.assign({ unlocked: this.save.unlocks }, opts));
    this.yard.mount(this.yardEl, this.inspector);
    this.yard.on('result', function (r) { self.onResult(r); });
    return this.yard;
  };

  M.unmount = function () { if (this.yard) { this.yard.unmount(); return; } return baseUnmount.call(this); };

  M.show = function (id) {
    if (!this.p.yard) return baseShow.call(this, id);
    this.tabDefs.forEach(function (t) { t.btn.classList.toggle('on', t.id === id); t.btn.setAttribute('aria-selected', t.id === id ? 'true' : 'false'); });
    SE.ui.clear(this.body);
    this.inspector.style.display = id === 'jobs' ? '' : 'none';
    if (id === 'brief') return this.yardBrief();
    if (id === 'jobs') return this.yardJobs();
    return this.tab_debrief();
  };

  M.yardBrief = function () {
    var p = this.p, self = this;
    var pitch = p.pitch || (Y.shorten ? Y.shorten(p.brief).short : p.brief);
    this.yard.setObjective({ text: p.objective || (p.jobs.length + ' jobs to sign off. Any build that works counts.'), kind: 'level' });
    this.body.appendChild(el('div', { class: 'brief' }, [
      el('div', { class: 'who who-juno' }, [el('span', { class: 'who-badge', text: 'J' }), el('span', { class: 'who-name', text: 'Juno' }), el('span', { class: 'who-role', text: 'settlement chief' })]),
      el('div', { class: 'step-body step-brief', html: md(pitch) }),
      el('ol', { class: 'job-list' }, p.jobs.map(function (j) { return el('li', { html: inline(jobObjective(j)) }); })),
      el('div', { class: 'muted small', html: inline('The whole parts library is in the bin. Build it any way you like and press ▶ Run: the simulation decides. Site numbers are in the 📖 Guide.') }),
      el('div', { class: 'btn-row' }, [btn('Start on the jobs ▸', function () { self.show('jobs'); }, 'primary')])
    ]));
  };

  function stripMd(t) { return String(t || '').replace(/\$[^$]*\$/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim(); }
  function jobObjective(j) {
    if (j.objective) return j.objective;
    var t = stripMd(j.label), m = t.match(/^(.{8,140}?[.!?])(\s|$)/);
    return m ? m[1] : t.slice(0, 140);
  }

  M.openGuide = function () {
    var p = this.p, j = this.p.jobs[this.jobIndex], body = el('div', { class: 'guide-body' });
    if (j) body.appendChild(el('div', {}, [el('h3', { text: 'This job' }), el('div', { class: 'guide-step step-body', html: md(j.label) })]));
    if (p.conditions) body.appendChild(el('div', {}, [el('h3', { text: 'Site conditions' }), el('ul', {}, p.conditions.map(function (c) { return el('li', { html: inline(c) }); }))]));
    body.appendChild(el('div', {}, [el('h3', { text: 'Job card' }), el('div', { class: 'step-body', html: md(p.brief) })]));
    var y = this.yard;
    body.appendChild(el('div', {}, [el('h3', { text: 'Controls' }), el('div', { class: 'step-body', html: md('Pick a part in the bin, then click the yard to place it. Connectors (cables, winches, pushes) take a click on each end. Click a part to set its numbers, with units. Drag to move, **R** rotates, **Delete** removes. Scroll to zoom, right-drag to pan.') }),
      btn('Show the controls tour', function () { m.close(); y.showCoach(); }, 'ghost small')]));
    var m = SE.ui.modal({ title: 'Guide · ' + p.id + ' ' + p.title, body: body, class: 'guide-modal' });
  };

  M.jobState = function (j) {
    return this.st.deliverables[j.id] = this.st.deliverables[j.id] || { solved: false, hintTier: 0, wrong: 0 };
  };

  M.yardJobs = function () {
    var self = this, p = this.p;
    var list = el('div', { class: 'work-order' });
    p.jobs.forEach(function (j, i) {
      var js = self.jobState(j), active = i === self.jobIndex;
      var c = el('div', { class: 'deliverable' + (js.solved ? ' solved' : '') + (active ? ' active' : '') });
      c.appendChild(el('div', { class: 'deliverable-head' }, [
        el('span', { class: 'deliverable-num', text: String(i + 1) }),
        el('div', { class: 'deliverable-label', html: active ? md(j.label) : inline(jobObjective(j)) }),
        js.solved ? el('span', { class: 'grade grade-' + SE.scoring.grade(js.score), text: SE.scoring.grade(js.score) }) : null
      ]));
      if (!active) { c.appendChild(el('div', { class: 'btn-row' }, [btn(js.solved ? 'Redo this job' : 'Work on this job', function () { self.selectJob(i); }, 'ghost small')])); list.appendChild(c); return; }
      c.appendChild(el('div', { class: 'muted small', html: inline('Any build that does the job counts. Numbers you need are in the job text and the 📖 Guide.') }));
      var hints = el('div', { class: 'hints' });
      for (var h = 0; h < js.hintTier; h++) hints.appendChild(hintEl(j, h));
      c.appendChild(hints);
      c.appendChild(self.jobFeedback = el('div', { class: 'task-feedback' }));
      var row = el('div', { class: 'btn-row' }, [btn('▶ Run the test', function () { self.yard.run(); }, 'primary')]);
      var names = ['Ask for a nudge', 'Ask for the method', 'Ask for a worked step'];
      if (j.hints && js.hintTier < j.hints.length) {
        var hb = btn(names[js.hintTier] + ' (−' + (SE.scoring.HINT_COST[js.hintTier + 1] - SE.scoring.HINT_COST[js.hintTier]) + ')', function () {
          js.hintTier++; self.save.stats.hintsUsed++; SE.game.persist(); self.show('jobs');
        }, 'ghost');
        row.appendChild(hb);
      }
      c.appendChild(row);
      list.appendChild(c);
    });
    this.body.appendChild(list);
    var done = p.jobs.filter(function (j) { return self.jobState(j).solved; }).length;
    this.body.appendChild(el('div', { class: 'btn-row' }, [
      el('span', { class: 'muted', text: done + ' / ' + p.jobs.length + ' signed off' }),
      btn('File the report', function () { self.show('debrief'); }, done === p.jobs.length ? 'primary' : 'ghost')
    ]));
    this.armJob();
  };

  M.selectJob = function (i) {
    this.jobIndex = i;
    var j = this.p.jobs[i];
    if (j.design) this.makeYard(Object.assign({ bin: 'library' }, this.p.yard, j.yard || {}, { design: j.design }));
    this.show('jobs');
  };

  M.armJob = function () {
    var j = this.p.jobs[this.jobIndex];
    this.yard.setObjective({ text: jobObjective(j), kind: 'job' });
    if (this.jobState(j).solved) this.yard.setObjectiveStatus('pass');
    this.yard.goal = j.goal;
    this.yard.timeout = j.timeout || 30;
    this.yard.failedRuns = this.jobState(j).wrong;
  };

  M.onResult = function (r) {
    var j = this.p.jobs[this.jobIndex], js = this.jobState(j), fb = this.jobFeedback;
    if (!fb) return;
    SE.ui.clear(fb);
    if (!r.pass) {
      js.wrong++;
      var ctx = { result: r, yard: this.yard };
      fb.appendChild(el('div', { class: 'feedback bad' }, [el('div', { class: 'feedback-head', text: 'Failed the test.' }), el('div', { html: md(r.reason) }),
        (function () { var t = j.onFail && j.onFail(ctx); return t ? el('div', { class: 'sim-msg', html: md(t) }) : null; })()]));
      SE.game.persist();
      return;
    }
    var score = Y.jobScore(j, { pass: true, state: r.state, hintTier: js.hintTier, failedRuns: js.wrong });
    if (j.grade) {
      var inst = this.yard.gradePart(j.grade.part);
      var res = SE.checker.check(inst ? inst.dials[j.grade.key] : '', j.grade.spec);
      score = Math.round((score + SE.scoring.taskScore({ result: res, spec: j.grade.spec, hintTier: js.hintTier, wrongAttempts: js.wrong })) / 2);
    }
    var first = !js.solved;
    js.solved = true; js.score = Math.max(js.score || 0, score);
    var rec = SE.save.recordBest(this.save, j.id, score);
    if (first) this.save.stats.tasksSolved++;
    fb.appendChild(el('div', { class: 'feedback good' }, [
      el('div', { class: 'feedback-head', html: '✔ Signed off. <span class="grade grade-' + SE.scoring.grade(score) + '">' + SE.scoring.grade(score) + '</span> <span class="score">' + score + '</span>' + (rec.isBest && rec.prev != null ? ' <span class="pb">new personal best</span>' : '') }),
      j.success ? el('div', { class: 'sim-msg', html: md(typeof j.success === 'function' ? j.success({ result: r, yard: this.yard }) : j.success) }) : null
    ]));
    SE.game.persist();
    var self = this, next = this.p.jobs.findIndex(function (x) { return !self.jobState(x).solved; });
    if (next >= 0 && next !== this.jobIndex) fb.appendChild(el('div', { class: 'btn-row' }, [btn('Next job ▸', function () { self.selectJob(next); }, 'primary')]));
  };

  function hintEl(j, h) {
    var names = ['Nudge', 'Method', 'Worked step'];
    return el('div', { class: 'hint tier' + (h + 1) }, [el('span', { class: 'hint-tier', text: names[h] }), el('div', { html: md(j.hints[h]) })]);
  }

})(globalThis.SE);
