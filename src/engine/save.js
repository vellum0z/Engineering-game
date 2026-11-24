/*
 * Save system.
 *
 * One save for the whole game. It lives in localStorage (when the browser
 * allows it) and can be exported to / imported from a JSON file. Every save
 * carries a format version; MIGRATIONS upgrades older saves step by step so
 * an update never wipes progress. Add a new migration whenever the shape of
 * the save changes, and never edit an old one.
 */
(function (SE) {
  'use strict';

  var KEY = 'salvage-engineer.save';
  var CURRENT = 1;

  function fresh() {
    var now = new Date().toISOString();
    return {
      format: 'salvage-engineer-save',
      version: CURRENT,
      createdAt: now,
      updatedAt: now,
      settings: { sound: true, volume: 0.6, reducedMotion: false, textSize: 1 },
      chapters: {},          // chapterId -> { levels: {id: {...}}, projects: {id: {...}}, sandbox: {...} }
      bests: {},             // taskId -> { score, grade, at }
      unlocks: { tools: [], materials: [] },
      formulaSheet: [],      // formula ids in the order learned
      notebook: [],          // player's own notes on the formula sheet
      stats: { tasksSolved: 0, hintsUsed: 0, playSeconds: 0 }
    };
  }

  /*
   * Migrations: MIGRATIONS[n] turns a version-n save into version n+1 and
   * must set s.version = n + 1. Version 1 is the first released format, so
   * the table is empty for now. When the save shape changes:
   *   1. bump CURRENT,
   *   2. add MIGRATIONS[CURRENT - 1],
   *   3. add a test that loads a saved old-format fixture.
   */
  var MIGRATIONS = {};

  function migrate(data, target) {
    var goal = target || CURRENT;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not a save file.');
    var s = JSON.parse(JSON.stringify(data));
    var v = typeof s.version === 'number' ? s.version : 1;
    if (v > goal) throw new Error('This save is from a newer version of the game (v' + v + '). Update the game to load it.');
    while (v < goal) {
      if (!MIGRATIONS[v]) throw new Error('No migration from save version ' + v + '.');
      s = MIGRATIONS[v](s);
      // A migration that forgets to bump the version would loop forever.
      if (!s || s.version !== v + 1) throw new Error('Save migration from version ' + v + ' did not produce version ' + (v + 1) + '.');
      v = s.version;
    }
    // Fill any fields a future migration forgot, without overwriting data.
    var base = fresh();
    Object.keys(base).forEach(function (k) { if (s[k] === undefined) s[k] = base[k]; });
    if (!s.settings || typeof s.settings !== 'object') s.settings = base.settings;
    Object.keys(base.settings).forEach(function (k) { if (s.settings[k] === undefined) s.settings[k] = base.settings[k]; });
    s.format = 'salvage-engineer-save';
    return s;
  }

  function storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
  }

  function load() {
    var st = storage();
    if (!st) return { save: fresh(), persisted: false };
    try {
      var raw = st.getItem(KEY);
      if (!raw) return { save: fresh(), persisted: true };
      return { save: migrate(JSON.parse(raw)), persisted: true };
    } catch (e) {
      // Keep a copy of an unreadable save rather than silently replacing it.
      try { st.setItem(KEY + '.corrupt.' + Date.now(), st.getItem(KEY)); } catch (e2) { /* ignore */ }
      return { save: fresh(), persisted: true, error: e.message };
    }
  }

  function store(save) {
    save.updatedAt = new Date().toISOString();
    var st = storage();
    if (!st) return false;
    try { st.setItem(KEY, JSON.stringify(save)); return true; } catch (e) { return false; }
  }

  function exportText(save) { return JSON.stringify(save, null, 2); }

  function importText(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (data && data.format && data.format !== 'salvage-engineer-save') throw new Error('That file is not a Salvage Engineer save.');
    return migrate(data);
  }

  function chapterState(save, chId) {
    if (!save.chapters[chId]) save.chapters[chId] = { levels: {}, projects: {}, sandbox: {}, seenIntro: false };
    return save.chapters[chId];
  }

  function recordBest(save, taskId, score) {
    var prev = save.bests[taskId];
    var g = SE.scoring.grade(score);
    var isBest = !prev || score > prev.score;
    if (isBest) save.bests[taskId] = { score: score, grade: g, at: new Date().toISOString() };
    return { isBest: isBest, prev: prev ? prev.score : null };
  }

  function unlockTool(save, id) {
    if (save.unlocks.tools.indexOf(id) < 0) { save.unlocks.tools.push(id); return true; }
    return false;
  }
  function addFormula(save, id) {
    if (save.formulaSheet.indexOf(id) < 0) { save.formulaSheet.push(id); return true; }
    return false;
  }

  SE.save = {
    KEY: KEY, CURRENT: CURRENT, fresh: fresh, migrate: migrate, load: load, store: store,
    exportText: exportText, importText: importText, chapterState: chapterState,
    recordBest: recordBest, unlockTool: unlockTool, addFormula: addFormula, MIGRATIONS: MIGRATIONS
  };
})(globalThis.SE);
