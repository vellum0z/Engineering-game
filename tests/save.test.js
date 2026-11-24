'use strict';
// Save format: fresh saves, migrations, import/export and best scores.
const { suite, test, eq, ok } = require('./harness');
const Sv = globalThis.SE.save;

function throwsWith(fn, re) {
  try { fn(); } catch (e) { ok(re.test(e.message), 'unexpected message: ' + e.message); return; }
  throw new Error('expected a throw matching ' + re);
}

suite('save: fresh', () => {
  test('shape and defaults', () => {
    const s = Sv.fresh();
    eq(s.format, 'salvage-engineer-save');
    eq(s.version, Sv.CURRENT);
    eq(Sv.CURRENT, 1);
    ok(!isNaN(Date.parse(s.createdAt)));
    eq(s.createdAt, s.updatedAt);
    eq(s.settings.sound, true);
    eq(s.settings.volume, 0.6);
    eq(s.settings.reducedMotion, false);
    eq(s.settings.textSize, 1);
    eq(JSON.stringify(s.chapters), '{}');
    eq(JSON.stringify(s.bests), '{}');
    eq(JSON.stringify(s.unlocks), '{"tools":[],"materials":[]}');
    eq(s.formulaSheet.length, 0);
    eq(s.notebook.length, 0);
    eq(JSON.stringify(s.stats), '{"tasksSolved":0,"hintsUsed":0,"playSeconds":0}');
  });
  test('each call is a new object', () => {
    const a = Sv.fresh(), b = Sv.fresh();
    a.unlocks.tools.push('x');
    eq(b.unlocks.tools.length, 0);
  });
});

suite('save: migrate', () => {
  test('a current save comes back equal, as a copy', () => {
    const s = Sv.fresh();
    s.bests.t1 = { score: 90, grade: 'A', at: s.createdAt };
    const m = Sv.migrate(s);
    eq(JSON.stringify(m), JSON.stringify(s));
    ok(m !== s);
    m.bests.t1.score = 0;
    eq(s.bests.t1.score, 90, 'the input is not mutated');
  });
  test('missing fields are filled without overwriting data', () => {
    const m = Sv.migrate({ version: 1, bests: { t: { score: 50 } }, settings: { volume: 0.2 } });
    eq(m.bests.t.score, 50);
    eq(m.settings.volume, 0.2);
    eq(m.settings.sound, true);
    eq(m.format, 'salvage-engineer-save');
    eq(m.formulaSheet.length, 0);
  });
  test('a save without a version is treated as version 1', () => {
    eq(Sv.migrate({}).version, 1);
  });
  test('a broken settings field is replaced', () => {
    const m = Sv.migrate({ version: 1, settings: null });
    eq(m.settings.sound, true);
  });
  test('non-objects are rejected', () => {
    throwsWith(() => Sv.migrate(null), /Not a save file/);
    throwsWith(() => Sv.migrate(42), /Not a save file/);
    throwsWith(() => Sv.migrate('save'), /Not a save file/);
    throwsWith(() => Sv.migrate([]), /Not a save file/);
  });
  test('a newer save is refused', () => {
    throwsWith(() => Sv.migrate({ version: 2 }), /newer version/);
  });
  test('a missing migration step is reported', () => {
    throwsWith(() => Sv.migrate({ version: 1 }, 2), /No migration from save version 1/);
  });
  test('a registered migration runs step by step', () => {
    // A pretend v1 → v2 change: settings.volume moves into an audio block.
    Sv.MIGRATIONS[1] = function (s) {
      s.audio = { volume: s.settings.volume };
      delete s.settings.volume;
      s.version = 2;
      return s;
    };
    try {
      const old = Sv.fresh();
      old.settings.volume = 0.3;
      old.bests.t = { score: 88, grade: 'A', at: old.createdAt };
      const m = Sv.migrate(old, 2);
      eq(m.version, 2);
      eq(m.audio.volume, 0.3);
      eq(m.bests.t.score, 88, 'progress survives');
      eq(old.version, 1, 'the input is untouched');
      eq(old.settings.volume, 0.3);
      // The fill-in step restores the default for the field the migration
      // dropped, so a forgetful migration never leaves a hole.
      eq(m.settings.volume, 0.6);
      // A v2 save is current at target 2 and newer than the shipped v1.
      eq(Sv.migrate(m, 2).version, 2);
      throwsWith(() => Sv.migrate(m), /newer version/);
    } finally {
      delete Sv.MIGRATIONS[1];
    }
    eq(Sv.MIGRATIONS[1], undefined);
  });
  test('a migration that forgets to bump the version is an error, not a hang', () => {
    Sv.MIGRATIONS[1] = function (s) { return s; };
    try {
      throwsWith(() => Sv.migrate({ version: 1 }, 2), /did not produce version 2/);
    } finally {
      delete Sv.MIGRATIONS[1];
    }
  });
});

suite('save: import and export', () => {
  test('round trip keeps everything', () => {
    const s = Sv.fresh();
    Sv.recordBest(s, 'ch01.l1', 92);
    Sv.unlockTool(s, 'spring-scale');
    Sv.addFormula(s, 'newton-2');
    Sv.chapterState(s, 'ch01').seenIntro = true;
    s.notebook.push('W = mg, g = 9.81 m/s²');
    s.settings.sound = false;
    const text = Sv.exportText(s);
    ok(text.indexOf('\n  ') > 0, 'pretty-printed');
    const back = Sv.importText(text);
    eq(JSON.stringify(back), JSON.stringify(s));
  });
  test('junk is rejected', () => {
    throwsWith(() => Sv.importText('not json'), /not valid JSON/);
    throwsWith(() => Sv.importText(''), /not valid JSON/);
    throwsWith(() => Sv.importText('null'), /Not a save file/);
    throwsWith(() => Sv.importText('17'), /Not a save file/);
    throwsWith(() => Sv.importText('"hello"'), /Not a save file/);
    throwsWith(() => Sv.importText('[1,2]'), /Not a save file/);
    throwsWith(() => Sv.importText('{"format":"some-other-game"}'), /not a Salvage Engineer save/);
  });
  test('a save from a newer game version is rejected', () => {
    const s = Sv.fresh();
    s.version = 99;
    throwsWith(() => Sv.importText(Sv.exportText(s)), /newer version of the game \(v99\)/);
  });
});

suite('save: recordBest and helpers', () => {
  test('first score is a best', () => {
    const s = Sv.fresh();
    const r = Sv.recordBest(s, 't', 72);
    eq(r.isBest, true); eq(r.prev, null);
    eq(s.bests.t.score, 72);
    eq(s.bests.t.grade, 'B');
    ok(!isNaN(Date.parse(s.bests.t.at)));
  });
  test('a higher score replaces it, a lower or equal one does not', () => {
    const s = Sv.fresh();
    Sv.recordBest(s, 't', 72);
    const up = Sv.recordBest(s, 't', 96);
    eq(up.isBest, true); eq(up.prev, 72);
    eq(s.bests.t.grade, 'S');
    const down = Sv.recordBest(s, 't', 50);
    eq(down.isBest, false); eq(down.prev, 96);
    eq(s.bests.t.score, 96);
    const same = Sv.recordBest(s, 't', 96);
    eq(same.isBest, false);
  });
  test('a zero score is still recorded first time', () => {
    const s = Sv.fresh();
    eq(Sv.recordBest(s, 't', 0).isBest, true);
    eq(s.bests.t.grade, 'C');
  });
  test('unlockTool and addFormula are idempotent', () => {
    const s = Sv.fresh();
    eq(Sv.unlockTool(s, 'a'), true);
    eq(Sv.unlockTool(s, 'a'), false);
    eq(s.unlocks.tools.length, 1);
    eq(Sv.addFormula(s, 'f'), true);
    eq(Sv.addFormula(s, 'f'), false);
    eq(s.formulaSheet.join(), 'f');
  });
  test('chapterState creates once and then returns the same object', () => {
    const s = Sv.fresh();
    const c = Sv.chapterState(s, 'ch01');
    eq(c.seenIntro, false);
    c.levels.l1 = { done: true };
    ok(Sv.chapterState(s, 'ch01') === c);
  });
  test('load and store without localStorage', () => {
    // Node has no localStorage: the game still runs, it just does not persist.
    if (typeof localStorage !== 'undefined') return;
    const l = Sv.load();
    eq(l.persisted, false);
    eq(l.save.version, 1);
    eq(Sv.store(l.save), false);
  });
});
