/*
 * Game shell: screens, navigation, top bar, keyboard shortcuts, settings
 * and save management. One save covers the whole game.
 *
 * Screens: title · map (acts) · act (a chapter's hub) · level (handheld) ·
 * project (manual) · sandbox · settings
 */
(function (SE) {
  'use strict';
  var el, md, inline, btn;

  var game = {
    save: null,
    persisted: false,
    screen: null,
    active: null,

    boot: function (root) {
      el = SE.ui.el; md = SE.ui.md; inline = SE.ui.inline; btn = SE.ui.button;
      var L = SE.save.load();
      this.save = L.save;
      this.persisted = L.persisted;
      if (L.error) setTimeout(function () { SE.ui.toast('Your saved game could not be read, so a backup copy was kept and a new game started. (' + L.error + ')', 'warn', 8000); }, 500);
      this.root = root;
      this.applySettings();
      this.topbar = el('header', { class: 'topbar' });
      this.main = el('main', { class: 'main' });
      root.appendChild(this.topbar);
      root.appendChild(this.main);
      this.bindKeys();
      var unlock = function () { SE.audio.unlock && SE.audio.unlock(); if (game.save.settings.sound) SE.audio.ambient && SE.audio.ambient(true); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      var self = this;
      setInterval(function () { self.persist(); }, 30000);
      window.addEventListener('beforeunload', function () { self.persist(); });
      var start = this.routeFromHash();
      this.show(start.screen, start.args);
    },

    routeFromHash: function () {
      var h = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (h[0] === 'level' && h[1] && h[2]) return { screen: 'level', args: { chapter: h[1], id: h[2] } };
      if (h[0] === 'project' && h[1] && h[2]) return { screen: 'project', args: { chapter: h[1], id: h[2] } };
      if (h[0] === 'act' && h[1]) return { screen: 'act', args: { chapter: h[1] } };
      if (h[0] === 'map') return { screen: 'map', args: {} };
      return { screen: 'title', args: {} };
    },

    persist: function () { if (this.save) SE.save.store(this.save); },

    applySettings: function () {
      var s = this.save.settings;
      SE.audio.setEnabled(!!s.sound);
      SE.audio.setVolume(s.volume == null ? 0.6 : s.volume);
      document.documentElement.style.setProperty('--text-scale', String(s.textSize || 1));
      document.documentElement.classList.toggle('reduced-motion', !!s.reducedMotion);
    },

    show: function (screen, args) {
      args = args || {};
      if (this.active && this.active.unmount) this.active.unmount();
      this.active = null;
      this.screen = screen;
      SE.ui.clear(this.main);
      this.main.className = 'main scr-' + screen;
      var hash = { title: '', map: 'map', act: 'act/' + args.chapter, level: 'level/' + args.chapter + '/' + args.id, project: 'project/' + args.chapter + '/' + args.id, sandbox: 'sandbox', settings: 'settings' }[screen];
      try { history.replaceState(null, '', hash ? '#/' + hash : location.pathname); } catch (e) { /* file:// may refuse */ }
      this.args = args;
      this['screen_' + screen](args);
      this.refreshTopbar();
      window.scrollTo(0, 0);
    },

    refreshTopbar: function () {
      var self = this;
      SE.ui.clear(this.topbar);
      var ch = this.args && this.args.chapter ? SE.content.chapter(this.args.chapter) : null;
      var locked = this.active && this.active.p && this.active.p.lockedTools;
      this.topbar.appendChild(el('button', { class: 'brand', title: 'Title screen', onclick: function () { self.show('title'); } }, [el('span', { class: 'brand-mark', text: 'SE' }), el('span', { class: 'brand-name', text: 'Salvage Engineer' })]));
      var crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Location' });
      if (this.screen !== 'title') crumbs.appendChild(el('a', { href: '#/map', onclick: function (e) { e.preventDefault(); self.show('map'); }, text: 'World' }));
      if (ch && this.screen !== 'map') crumbs.appendChild(el('a', { href: '#/act/' + ch.id, onclick: function (e) { e.preventDefault(); self.show('act', { chapter: ch.id }); }, text: 'Act ' + ch.act + ': ' + ch.region }));
      this.topbar.appendChild(crumbs);
      var tools = el('div', { class: 'toolbar' });
      SE.tools.TOOLS.forEach(function (t) {
        var avail = SE.tools.available(self.save, t.id);
        var isLocked = locked && locked.indexOf(t.id) >= 0;
        tools.appendChild(el('button', {
          class: 'tool-btn' + (avail ? '' : ' unavailable') + (isLocked ? ' locked' : ''),
          title: t.name + (avail ? ' (' + t.key.toUpperCase() + ')' : ' (not unlocked yet)') + (isLocked ? ': locked for this brief' : ''),
          'aria-label': t.name, onclick: function () { SE.tools.open(t.id, { locked: locked }); }
        }, [el('span', { class: 'tool-icon', text: t.icon }), el('span', { class: 'tool-name', text: t.name })]));
      });
      this.topbar.appendChild(tools);
      this.topbar.appendChild(el('button', { class: 'icon-btn', title: 'Sound on/off (M)', 'aria-label': 'Toggle sound', text: this.save.settings.sound ? '🔊' : '🔇', onclick: function () { self.toggleSound(); } }));
      this.topbar.appendChild(el('button', { class: 'icon-btn', title: 'Settings & saves', 'aria-label': 'Settings', text: '⚙', onclick: function () { self.settingsModal(); } }));
    },

    toggleSound: function () {
      this.save.settings.sound = !this.save.settings.sound;
      this.applySettings();
      if (this.save.settings.sound) { SE.audio.unlock && SE.audio.unlock(); SE.audio.ambient && SE.audio.ambient(true); }
      this.persist(); this.refreshTopbar();
    },

    bindKeys: function () {
      var self = this;
      document.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector('.modal-back')) return;
        var k = e.key.toLowerCase();
        if (k === 'm') { self.toggleSound(); return; }
        var t = SE.tools.TOOLS.filter(function (x) { return x.key === k; })[0];
        if (t) { e.preventDefault(); SE.tools.open(t.id, { locked: self.active && self.active.p && self.active.p.lockedTools }); }
      });
    },

    /* ------------------------------------------------------------ title */
    screen_title: function () {
      var self = this;
      var canvas = el('canvas', { class: 'title-canvas', 'aria-hidden': 'true' });
      var started = Object.keys(this.save.chapters).length > 0 || Object.keys(this.save.bests).length > 0;
      var box = el('div', { class: 'title-box' }, [
        el('div', { class: 'title-kicker', text: 'A survival-engineering game' }),
        el('h1', { class: 'title-logo' }, [el('span', { text: 'SALVAGE' }), el('span', { text: 'ENGINEER' })]),
        el('p', { class: 'title-tag', text: 'The world ended. Physics didn\'t. Rebuild the settlement with real engineering mechanics: get the maths wrong and the cable snaps.' }),
        el('div', { class: 'btn-col' }, [
          btn(started ? 'Continue ▸' : 'Start ▸', function () { self.show('map'); }, 'primary big'),
          btn('Import a save file', function () { self.importSave(); }, 'ghost'),
          btn('Settings', function () { self.settingsModal(); }, 'ghost')
        ]),
        el('p', { class: 'title-foot', html: inline('Follows the topic order of Hibbeler\'s *Engineering Mechanics* (14th ed.) as a companion. Not affiliated with the author or publisher.') }),
        !this.persisted ? el('p', { class: 'warn small', text: 'Your browser is blocking storage, so export your save before closing the page.' }) : null
      ]);
      this.main.appendChild(el('div', { class: 'title-screen' }, [canvas, box]));
      var stage = new SE.Stage(canvas);
      stage.load({
        init: function () { this.t = 0; },
        step: function (dt) { this.t += dt; },
        draw: function (ctx, w, h, t) {
          SE.draw.backdrop(ctx, w, h, t);
          SE.draw.ground(ctx, w, h - 70, 70);
          SE.draw.fence(ctx, w * 0.05, h - 70, w * 0.9, 46);
          for (var i = 0; i < 7; i++) {
            var x = ((i * 137 + t * 9) % (w + 200)) - 100;
            SE.draw.zombie(ctx, x, h - 70, 46 + (i % 3) * 6, t, i + 1);
          }
          // crane silhouette
          ctx.fillStyle = 'rgba(15,11,9,0.92)';
          var cx = w * 0.82, gy = h - 70;
          ctx.fillRect(cx - 6, gy - 260, 12, 260);
          ctx.fillRect(cx - 160, gy - 262, 220, 10);
          ctx.strokeStyle = 'rgba(15,11,9,0.92)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx - 140, gy - 252); ctx.lineTo(cx - 140, gy - 150 + Math.sin(t) * 6); ctx.stroke();
          SE.draw.crate(ctx, cx - 160, gy - 120 + Math.sin(t) * 6, 40, 32, {});
        }
      });
      this.active = { unmount: function () { stage.stop(); } };
    },

    /* -------------------------------------------------------------- map */
    screen_map: function () {
      var self = this;
      var wrap = el('div', { class: 'map-screen' }, [
        el('h1', { class: 'screen-title', text: 'The Wasteland' }),
        el('p', { class: 'muted', text: 'Each act is a region of the world and one chapter of mechanics. Regions open in course order; everything you learn and unlock carries forward.' })
      ]);
      var grid = el('div', { class: 'act-grid' });
      var list = SE.content.allChapters();
      var planned = SE.ACTS_PLANNED || [];
      planned.forEach(function (a) {
        var ch = SE.content.chapter(a.id);
        var built = ch && ch.levels.length > 0;
        var st = self.save.chapters[a.id];
        var m = built ? SE.scoring.mastery(SE.content.scoredTasks(a.id), self.save.bests) : 0;
        var card = el('button', { class: 'act-card' + (built ? '' : ' locked'), disabled: !built, onclick: function () { self.show('act', { chapter: a.id }); } }, [
          el('div', { class: 'act-num', text: 'Act ' + a.act }),
          el('div', { class: 'act-region', text: a.region }),
          el('div', { class: 'act-topic', text: 'Ch. ' + a.number + ' · ' + a.title }),
          built ? el('div', { class: 'meter' }, [el('span', { style: { width: m + '%' } })]) : el('div', { class: 'act-soon', text: 'Under construction' }),
          built ? el('div', { class: 'act-mastery', text: 'Mastery ' + m + '%' }) : null
        ]);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
      this.main.appendChild(wrap);
    },

    /* -------------------------------------------------------------- act */
    screen_act: function (args) {
      var self = this;
      var ch = SE.content.chapter(args.chapter);
      if (!ch) return this.show('map');
      var st = SE.save.chapterState(this.save, ch.id);
      var all = SE.content.scoredTasks(ch.id);
      var hh = SE.content.scoredTasks(ch.id, { mode: 'handheld' });
      var mm = SE.content.scoredTasks(ch.id, { mode: 'manual' });
      var mastery = SE.scoring.mastery(all, this.save.bests);
      var head = el('div', { class: 'act-head' }, [
        el('div', { class: 'act-num', text: 'Act ' + ch.act + ' · Chapter ' + ch.number }),
        el('h1', { class: 'screen-title', text: ch.region }),
        el('div', { class: 'act-topic', text: ch.title }),
        el('div', { class: 'act-stats' }, [
          stat('Chapter mastery', mastery + '%', SE.scoring.grade(mastery)),
          stat('Handheld', SE.scoring.mastery(hh, this.save.bests) + '%'),
          stat('Manual', SE.scoring.mastery(mm, this.save.bests) + '%')
        ])
      ]);
      function stat(label, val, g) { return el('div', { class: 'stat' }, [el('div', { class: 'stat-val', html: val + (g ? ' <span class="grade grade-' + g + '">' + g + '</span>' : '') }), el('div', { class: 'stat-label', text: label })]); }
      var wrap = el('div', { class: 'act-screen' }, [head]);
      if (!st.seenIntro && ch.intro) {
        wrap.appendChild(el('div', { class: 'step act-intro' }, [el('div', { class: 'step-body', html: md(ch.intro) }), btn('Understood', function (e) { st.seenIntro = true; self.persist(); e.target.closest('.act-intro').remove(); }, 'primary')]));
      }
      var cols = el('div', { class: 'act-cols' });
      var hcol = el('section', { class: 'act-col' }, [
        el('h2', { text: 'Handheld' }),
        el('p', { class: 'muted', text: 'Guided. Questions first, then you try it, then the idea gets written down. Finishing the core path covers everything in the chapter.' })
      ]);
      ch.levels.forEach(function (lv, i) {
        var ls = st.levels[lv.id] || {};
        var ids = []; SE.content.walkSteps(lv.steps, function (s) { if ((s.type === 'task' || s.type === 'classify') && s.required !== false && !s.deeper) ids.push(s.id); });
        var m = SE.scoring.mastery(ids, self.save.bests);
        hcol.appendChild(el('button', { class: 'level-row' + (ls.done ? ' done' : ''), onclick: function () { self.show('level', { chapter: ch.id, id: lv.id }); } }, [
          el('span', { class: 'level-id', text: lv.id }),
          el('span', { class: 'level-text' }, [el('span', { class: 'level-title', text: lv.title }), el('span', { class: 'level-sub', text: (lv.sections ? '§ ' + lv.sections.join(', ') + ' · ' : '') + (lv.subtitle || '') })]),
          ls.done ? el('span', { class: 'grade grade-' + SE.scoring.grade(m), text: ids.length ? SE.scoring.grade(m) : '✔' }) : el('span', { class: 'level-go', text: '▸' })
        ]));
      });
      var mcol = el('section', { class: 'act-col' }, [
        el('h2', { text: 'Manual' }),
        el('p', { class: 'muted', text: 'No hand-holding. A brief, the tools and the real physics. Hints only if you ask. Briefs include real-world factors beyond the course text.' })
      ]);
      ch.projects.forEach(function (p) {
        var ps = st.projects[p.id] || {};
        var m = SE.scoring.mastery(p.deliverables.map(function (d) { return d.id; }), self.save.bests);
        mcol.appendChild(el('button', { class: 'level-row project' + (ps.done ? ' done' : ''), onclick: function () { self.show('project', { chapter: ch.id, id: p.id }); } }, [
          el('span', { class: 'level-id', text: p.id }),
          el('span', { class: 'level-text' }, [el('span', { class: 'level-title', text: p.title }), el('span', { class: 'level-sub', text: p.subtitle || '' })]),
          ps.done ? el('span', { class: 'grade grade-' + SE.scoring.grade(m), text: SE.scoring.grade(m) }) : el('span', { class: 'level-go', text: '▸' })
        ]));
      });
      cols.appendChild(hcol); cols.appendChild(mcol);
      wrap.appendChild(cols);
      if (ch.sandboxes && ch.sandboxes.length) {
        wrap.appendChild(el('section', { class: 'act-col sandbox-list' }, [
          el('h2', { text: 'Free sandbox' }),
          el('div', { class: 'btn-row wrap' }, ch.sandboxes.map(function (sb) { return btn(sb.title, function () { self.show('sandbox', { chapter: ch.id, id: sb.id }); }, 'secondary'); }))
        ]));
      }
      this.main.appendChild(wrap);
    },

    screen_level: function (args) {
      var ch = SE.content.chapter(args.chapter);
      var lv = ch && ch.levelMap[args.id];
      if (!lv) return this.show('act', { chapter: args.chapter });
      var r = new SE.Runner(lv);
      this.active = r;
      r.mount(this.main);
    },

    screen_project: function (args) {
      var ch = SE.content.chapter(args.chapter);
      var p = ch && ch.projectMap[args.id];
      if (!p) return this.show('act', { chapter: args.chapter });
      var m = new SE.Manual(p);
      this.active = m;
      m.mount(this.main);
    },

    screen_sandbox: function (args) {
      var ch = SE.content.chapter(args.chapter);
      var sb = ch && (ch.sandboxes || []).filter(function (s) { return s.id === args.id; })[0];
      if (!sb) return this.show('act', { chapter: args.chapter });
      var lv = { id: sb.id, chapter: ch.id, title: sb.title, sections: sb.sections || [], intro: sb.text, scene: sb.scene, steps: [{ type: 'sandbox', text: sb.text, prompts: sb.prompts, controls: sb.controls, actions: sb.actions }] };
      var r = new SE.Runner(lv);
      this.active = r;
      r.mount(this.main);
      r.run(0);
    },

    /* --------------------------------------------------------- settings */
    settingsModal: function () {
      var self = this, s = this.save.settings;
      function row(label, input) { return el('label', { class: 'set-row' }, [el('span', { text: label }), input]); }
      var snd = el('input', { type: 'checkbox', checked: !!s.sound, onchange: function () { s.sound = snd.checked; self.applySettings(); if (s.sound) { SE.audio.unlock && SE.audio.unlock(); SE.audio.ambient && SE.audio.ambient(true); } self.persist(); self.refreshTopbar(); } });
      var vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume, oninput: function () { s.volume = Number(vol.value); self.applySettings(); self.persist(); } });
      var rm = el('input', { type: 'checkbox', checked: !!s.reducedMotion, onchange: function () { s.reducedMotion = rm.checked; self.applySettings(); self.persist(); } });
      var ts = el('input', { type: 'range', min: 0.9, max: 1.3, step: 0.05, value: s.textSize || 1, oninput: function () { s.textSize = Number(ts.value); self.applySettings(); self.persist(); } });
      var body = el('div', { class: 'settings' }, [
        row('Sound', snd), row('Volume', vol), row('Reduce motion (no shake/flash)', rm), row('Text size', ts),
        el('h3', { text: 'Your save' }),
        el('p', { class: 'muted', text: this.persisted ? 'Progress saves automatically in this browser. Export a file to back it up or move it to another computer. Save files keep working across game updates.' : 'This browser blocks storage. Export your save to keep progress.' }),
        el('div', { class: 'btn-row wrap' }, [
          btn('Export save file', function () { self.exportSave(); }, 'secondary'),
          btn('Import save file', function () { self.importSave(); }, 'secondary'),
          btn('Start over…', function () { self.resetSave(); }, 'ghost danger')
        ]),
        el('p', { class: 'muted small', text: 'Save format v' + this.save.version + ' · game v' + SE.version })
      ]);
      SE.ui.modal({ title: 'Settings', body: body });
    },

    exportSave: function () {
      this.persist();
      var blob = new Blob([SE.save.exportText(this.save)], { type: 'application/json' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'salvage-engineer-save-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      SE.ui.toast('Save exported.', 'good');
    },

    importSave: function () {
      var self = this;
      var inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
      inp.addEventListener('change', function () {
        var f = inp.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var s = SE.save.importText(String(rd.result));
            self.save = s; self.persist(); self.applySettings();
            SE.ui.toast('Save loaded.', 'good');
            document.querySelectorAll('.modal-back').forEach(function (m) { m.remove(); });
            self.show('map');
          } catch (e) { SE.ui.toast('Could not import: ' + e.message, 'bad', 6000); }
        };
        rd.readAsText(f);
      });
      document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 60000);
    },

    resetSave: function () {
      var self = this;
      var body = el('div', {}, [
        el('p', { text: 'This erases all progress in this browser. Export a backup first if you might want it back.' }),
        el('div', { class: 'btn-row' }, [
          btn('Export backup', function () { self.exportSave(); }, 'secondary'),
          btn('Erase and start over', function () { self.save = SE.save.fresh(); self.persist(); document.querySelectorAll('.modal-back').forEach(function (m) { m.remove(); }); self.show('title'); }, 'danger')
        ])
      ]);
      SE.ui.modal({ title: 'Start over?', body: body });
    }
  };

  SE.game = game;
})(globalThis.SE);
