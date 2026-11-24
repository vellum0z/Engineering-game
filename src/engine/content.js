/*
 * Content registry. Chapters, handheld levels, manual projects and formula
 * sheet entries register themselves here; the screens read from it.
 *
 * Every chapter module lives in src/chapters/chNN/ and calls these functions
 * at load time. See CONTRIBUTING.md for the full level format.
 */
(function (SE) {
  'use strict';

  var chapters = {};
  var order = [];
  var formulas = {};

  function registerChapter(def) {
    if (!def.id) throw new Error('chapter needs an id');
    var existing = chapters[def.id] || { levels: [], projects: [], levelMap: {}, projectMap: {} };
    var ch = Object.assign(existing, def);
    ch.levels = existing.levels; ch.projects = existing.projects;
    chapters[def.id] = ch;
    if (order.indexOf(def.id) < 0) order.push(def.id);
    order.sort(function (a, b) { return (chapters[a].number || 0) - (chapters[b].number || 0); });
    return ch;
  }

  function ensure(chId) {
    if (!chapters[chId]) registerChapter({ id: chId });
    return chapters[chId];
  }

  function registerLevel(chId, def) {
    var ch = ensure(chId);
    def.chapter = chId; def.kind = 'level';
    if (ch.levelMap[def.id]) ch.levels.splice(ch.levels.indexOf(ch.levelMap[def.id]), 1);
    ch.levelMap[def.id] = def;
    ch.levels.push(def);
    ch.levels.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    return def;
  }

  function registerProject(chId, def) {
    var ch = ensure(chId);
    def.chapter = chId; def.kind = 'project';
    if (ch.projectMap[def.id]) ch.projects.splice(ch.projects.indexOf(ch.projectMap[def.id]), 1);
    ch.projectMap[def.id] = def;
    ch.projects.push(def);
    ch.projects.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    return def;
  }

  /*
   * Formula sheet entry: { id, title, eq (SE.eq markup), tag (book eq. no.),
   * note, group }. Tables: { id, title, table: { head: [...], rows: [[...]] } }.
   */
  function registerFormula(def) { formulas[def.id] = def; return def; }
  function formula(id) { return formulas[id]; }

  function chapter(id) { return chapters[id]; }
  function allChapters() { return order.map(function (id) { return chapters[id]; }); }

  // Walk every step (including nested "deeper" branches) of a level.
  function walkSteps(steps, fn, path) {
    (steps || []).forEach(function (s, i) {
      fn(s, (path || []).concat(i));
      if (s.steps) walkSteps(s.steps, fn, (path || []).concat(i));
    });
  }

  // All scored task ids of a chapter: handheld tasks marked required (the
  // default) plus every manual deliverable.
  function scoredTasks(chId, opts) {
    opts = opts || {};
    var ch = chapters[chId];
    if (!ch) return [];
    var ids = [];
    if (opts.mode !== 'manual') ch.levels.forEach(function (lv) {
      walkSteps(lv.steps, function (s) {
        if ((s.type === 'task' || s.type === 'classify' || s.type === 'job') && s.id && s.required !== false && !s.deeper) ids.push(s.id);
      });
    });
    if (opts.mode !== 'handheld') ch.projects.forEach(function (p) {
      (p.deliverables || []).forEach(function (d) { ids.push(d.id); });
    });
    return ids;
  }

  // Every answer spec in a chapter, for the answer-key tests.
  function allAnswerSpecs(chId) {
    var ch = chapters[chId];
    var out = [];
    if (!ch) return out;
    ch.levels.forEach(function (lv) {
      walkSteps(lv.steps, function (s) {
        if (s.type === 'task') (s.inputs || []).forEach(function (inp) { out.push({ where: lv.id + '/' + s.id + '/' + inp.key, input: inp }); });
      });
      (lv.proveIt || []).forEach(function (s) { (s.inputs || []).forEach(function (inp) { out.push({ where: lv.id + '/prove/' + s.id + '/' + inp.key, input: inp }); }); });
    });
    ch.projects.forEach(function (p) {
      (p.deliverables || []).forEach(function (d) { out.push({ where: p.id + '/' + d.id, input: d }); });
    });
    return out;
  }

  SE.content = {
    registerChapter: registerChapter, registerLevel: registerLevel, registerProject: registerProject,
    registerFormula: registerFormula, formula: formula, formulas: formulas,
    chapter: chapter, allChapters: allChapters, walkSteps: walkSteps,
    scoredTasks: scoredTasks, allAnswerSpecs: allAnswerSpecs
  };
})(globalThis.SE);
