/*
 * H10 · Measure Twice: significant figures, engineering notation, the
 * rounding rules (including the exact-5 case) and why intermediate results
 * keep full precision. Course section 1.5 (numerical calculations).
 *
 * Everything happens on the measuring bench (src/engine/scenes/bench.js):
 * fence mode for rounding bias, chain mode for intermediate precision and
 * caliper mode for the optional uncertainty branch.
 */
(function (SE) {
  'use strict';

  var B = SE.physics.bench;
  var RULES = ['up', 'truncate', 'book'];          // order of the fence prediction choices
  var RULE_WORDS = { book: 'the course rule (exact 5 goes to the even neighbour)', up: 'always round a 5 up', truncate: 'just chop the extra digits' };

  function cmS(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + ' cm'; }
  function mmS(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 1000).toFixed(1) + ' mm'; }
  function same(a, b) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); }

  // Scene actions shared by the try and sandbox steps. The bench only moves
  // when run() is called, so every hands-on step needs a button for it.
  var BUILD = {
    label: 'Build the wall ▸',
    run: function (ctx) {
      return ctx.scene.run().then(function (r) {
        ctx.runner._h10built = ctx.runner._h10built || {};
        ctx.runner._h10built[r.detail.rule] = true;
        return RULE_WORDS[r.detail.rule] + ': drift ' + cmS(r.detail.drift) + ' over ' + r.detail.boards + ' boards → **' + r.outcome + '**.';
      });
    }
  };
  var DRILL = {
    label: 'Drill and fit ▸',
    run: function (ctx) {
      return ctx.scene.run().then(function (r) {
        return 'Drilled at ' + (r.detail.mark * 1000).toFixed(0) + ' mm, ' + mmS(r.detail.error) + ' from the pin: **' + r.outcome + '**.';
      });
    }
  };
  var MEASURE = {
    label: 'Measure the plate ▸',
    run: function (ctx) {
      return ctx.scene.run().then(function (r) {
        return 'A = ' + SE.sigfig.roundSig(r.detail.area, r.detail.sf).text + ' mm² ± ' + SE.sigfig.roundSig(r.detail.abs, 1).text + ' mm²: worth **' + r.detail.sf + '** figures.';
      });
    }
  };


  // The palisade: 30 salvaged boards, 60 % of the readings land on a
  // half-centimetre mark. The scene defaults; the bench tests pin the drifts
  // (book −0.1 cm, always-up +9.9 cm, truncate −16.1 cm).
  var FENCE = { type: 'bench', params: { mode: 'fence', boards: 30, seed: 7, fiveFrac: 0.6, rule: 'book', showGhosts: true, label: 'east palisade' } };

  // The gantry boom sheet from the scene defaults: h 4.37 m, r 6.85 m, 7 bays,
  // stay at node 5. Exact bolt 5.8037 m; rounding each step to 3 s.f. gives
  // 5.80 m, 3.7 mm short. The hole has 1 mm of clearance (±0.5 mm), so only
  // the full-precision sheet (drilled at 5804 mm, +0.26 mm) takes the pin.
  var CRANE = { type: 'bench', params: { mode: 'chain', h: 4.37, r: 6.85, bays: 7, k: 5, keep: 'round', label: 'gantry boom' } };

  /*
   * H10.chain: the lookout mast's raking boom. Same six-step sheet with new
   * numbers. Hand check, full precision:
   *   h² = 3.53² = 12.4609        r² = 6.78² = 45.9684
   *   L² = 58.4293                L  = 7.643906 m
   *   bay = L / 6 = 1.273984 m    s  = 5 × bay = 6.369922 m  ->  6.37 m
   * Rounding every step to 3 s.f.:
   *   12.5, 46.0, 58.5, 7.65, 1.28, 6.40 m   (30 mm long)
   * The stay plate has a slotted hole, ±6 mm of play, so a correctly rounded
   * 3 s.f. answer (0.08 mm out) fits and the step-rounded one does not.
   */
  var MAST = { h: 3.53, r: 6.78, bays: 6, k: 5 };
  var MAST_CALC = B.chainError(B.craneSteps(), { n: 3, inputs: MAST });
  var MAST_S = MAST_CALC.exact;                    // 6.369922 m
  var MAST_SLOT = 0.012;                           // m, slot length minus pin, i.e. ±6 mm
  var MAST_SCENE = { type: 'bench', params: Object.assign({ mode: 'chain', keep: 'full', clearance: MAST_SLOT, label: 'mast stay' }, MAST) };

  /*
   * H10.round: five raw readings from the depot log, each to 3 s.f.
   *   47 261 m   -> 47.3 km   (dropped 6 > 5, round up)
   *   59.648 s   -> 59.6 s    (dropped 4 < 5, leave)
   *   3846 N     -> 3.85 kN   (dropped 6 > 5, round up)
   *   6445 kg    -> 6.44 Mg   (exact 5 after an even 4: leave)
   *   0.3335 s   -> 0.334 s   (exact 5 after an odd 3: round up)
   */
  var LOG = { d: 47261, t: 59.648, F: 3846, m: 6445, fuse: 0.3335 };

  // What habit do the player's numbers show? Compare each against what the
  // other two rules would have produced from the same raw reading.
  function habitOf(a) {
    var habit = 'book';
    Object.keys(LOG).forEach(function (k) {
      var got = a[k] && a[k].si;
      if (got == null) return;
      var book = SE.sigfig.roundSig(LOG[k], 3, 'book').value;
      if (same(got, book)) return;
      if (same(got, SE.sigfig.roundSig(LOG[k], 3, 'up').value)) habit = 'up';
      else if (same(got, SE.sigfig.roundSig(LOG[k], 3, 'truncate').value) && habit !== 'up') habit = 'truncate';
    });
    return habit;
  }

  SE.content.registerLevel('ch01', {
    id: 'H10', order: 10, title: 'Measure Twice',
    subtitle: 'Significant figures, rounding and honest numbers',
    sections: ['1.5'],
    minutes: 25,
    intro: [
      'The measuring bench is a door laid over two oil drums, a steel tape, a caliper in a velvet box nobody remembers stealing, and Hask.',
      '"A number on a cut list is a promise about how well we know something. Write too few figures and the wall has gaps. Write too many and you\'re lying. Round the wrong way, a little at a time, and thirty boards later the dead walk through the hole you made with arithmetic."'
    ].join('\n\n'),
    goals: [
      'Count significant figures, including leading and trailing zeros',
      'Write any result unambiguously in engineering notation (powers of 10³)',
      'Round to 3 s.f. with the course rules, including the exact-5 case',
      'Keep full precision through a calculation and round only the final answer'
    ],
    scene: FENCE,
    unlocks: { tools: ['sigfig'], formulas: ['ch01.sigfigs', 'ch01.rounding'] },
    proveIt: [
      {
        id: 'H10.prove-round', text: 'Round each tag to **3 significant figures**, keeping the units: a rope **8.335 m** long, and a pendulum swing of **1.265 s**.',
        inputs: [
          // 8.335: exact 5 after an odd 3 -> 8.34. 1.265: exact 5 after an even 6 -> 1.26.
          { key: 'L', label: 'Rope, 3 s.f.', placeholder: 'e.g. 4.51 m', spec: { value: 8.335, unit: 'm', sf: 3, form: 'si', exactRounding: true }, answer: '8.34 m', wrong: [{ input: '8.33 m', kind: 'rounding' }] },
          { key: 'T', label: 'Swing, 3 s.f.', placeholder: 'e.g. 2.07 s', spec: { value: 1.265, unit: 's', sf: 3, form: 'si', exactRounding: true }, answer: '1.26 s', wrong: [{ input: '1.27 s', kind: 'rounding' }] }
        ]
      },
      {
        id: 'H10.prove-notation', text: 'A tow chain was proof-tested to **72 500 N**, and the test rig is good to exactly **three** figures. Write it so nobody can misread how many figures you mean.',
        inputs: [
          // 72 500 N at 3 s.f. -> 72.5(10³) N = 72.5 kN. "72500 N" is ambiguous (3, 4 or 5 s.f.).
          { key: 'P', label: 'Proof load', placeholder: 'e.g. 12.3 kN', spec: { value: 72500, unit: 'N', sf: 3, form: 'any' }, answer: '72.5 kN', wrong: [{ input: '72500 N', kind: 'sigfig' }] }
        ]
      }
    ],
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Juno wants the east palisade rebuilt by dark: thirty salvaged boards, end to end between posts we already set. The posts went in at the **true** board lengths. The boards get cut from a list.\n\nBefore anything gets cut, you and I are going to agree on what a number on that list actually *says*.'
      },
      {
        type: 'predict', who: 'hask',
        q: 'I measure a board at **2 435 mm**. The cutter, tidying up, writes **2400 mm** on the list.\n\nReading only the list, how many figures of that length does anyone actually know?',
        choices: [
          { t: 'Two: the 2 and the 4. The zeros are just filler.', why: 'Could be, and in this case it is. But the list doesn\'t say so. If I\'d measured 2 400 mm exactly, I\'d write the same thing.' },
          { t: 'Four. Every digit counts.', why: 'Only if those zeros were measured. Nothing on the page says they were.' },
          { t: 'You can\'t tell from what\'s written. It could be two, three or four.', correct: true, why: 'Right. Zeros at the end of a whole number might be measured digits or might just hold the decimal point in place. The number on its own can\'t tell you which.' }
        ],
        reveal: 'The number of **significant figures** in a number is how accurately it is known. Trailing zeros on a whole number are **ambiguous**, so we need a way to write numbers that removes the doubt.'
      },
      {
        type: 'reveal', kicker: 'Rule', title: 'Significant figures and engineering notation',
        eq: '48\\u{ }600 \\quad \\to \\quad 48.6(10^{3}) \\quad \\t{or} \\quad 48.60(10^{3}) \\quad \\t{or} \\quad 48.600(10^{3})',
        text: [
          '- Every nonzero digit counts: **7302** has four significant figures.',
          '- Zeros at the **end of a whole number** are ambiguous: **48 600** could have three, four or five.',
          '- **Engineering notation** settles it. Round to the figures you mean, then write the number with a power of ten that is a **multiple of 3**: (10³), (10⁶), (10⁻³), (10⁻⁹). So 48 600 known to three figures is **48.6(10³)**; known to five it is **48.600(10³)**. A prefix does the same job: 48.6 kN.',
          '- Zeros at the **start** of a number less than one only place the decimal point, so they are not significant: **0.004 17** has three figures and is **4.17(10⁻³)**. Likewise **0.000 913** can be written **0.913(10⁻³)** or **913(10⁻⁶)**.'
        ].join('\n'),
        formula: 'ch01.sigfigs'
      },
      {
        type: 'classify', id: 'H10.sigfigs',
        text: 'Sort the tags from the parts bin by how many significant figures each one carries.',
        bins: ['2', '3', '4', 'Can\'t tell'],
        items: [
          { t: '7302 N', bin: '4', why: 'All four digits are nonzero, so all four count.' },
          { t: '0.0061 m', bin: '2', why: 'The leading zeros only place the decimal point. That leaves 6 and 1.' },
          { t: '0.000 913 kg', bin: '3', why: 'Leading zeros don\'t count: 9, 1, 3.' },
          { t: '48 600 N', bin: 'Can\'t tell', why: 'Trailing zeros on a whole number: three, four or five figures, and the tag doesn\'t say which.' },
          { t: '48.60(10³) N', bin: '4', why: 'Engineering notation with a decimal point: the trailing zero is written on purpose, so it counts.' },
          { t: '5.10 m', bin: '3', why: 'A trailing zero *after* the decimal point was measured, or nobody would bother writing it.' },
          { t: '9.0(10⁻⁶) s', bin: '2', why: 'The 9 and the deliberate 0. The power of ten adds no figures.' }
        ]
      },
      {
        type: 'task', id: 'H10.notation', who: 'hask',
        title: 'Stamp the hoist plate',
        text: 'The gantry hoist passed its proof test at **48 600 N**, and the load cell is good to **four** figures. The plate also gets the hook-pin clearance, **0.000 913 m**, good to three.\n\nStamp both so that nobody, years from now, can misread how well we knew them. Engineering notation or one SI prefix, whichever you like.',
        inputs: [
          // 48 600 N to 4 s.f. -> 48.60(10³) N = 48.60 kN. "48600 N" is ambiguous; "48.6 kN" claims only 3.
          { key: 'P', label: 'Proof load (4 s.f.)', placeholder: 'e.g. 12.30(10^3) N', spec: { value: 48600, unit: 'N', sf: 4, form: 'any' }, answer: '48.60(10^3) N', wrong: [{ input: '48600 N', kind: 'sigfig' }, { input: '48.6 kN', kind: 'sigfig' }] },
          // 0.000 913 m to 3 s.f. -> 0.913(10⁻³) m = 0.913 mm = 913 μm.
          { key: 'c', label: 'Pin clearance (3 s.f.)', placeholder: 'e.g. 0.456 mm', spec: { value: 0.000913, unit: 'm', sf: 3, form: 'any' }, answer: '0.913 mm', wrong: [{ input: '0.00091 m', kind: 'sigfig' }] }
        ],
        hints: [
          'How many figures does the load cell promise? Your stamp must show exactly that many, with no zero that could be mistaken for filler.',
          'Write the load with a power of ten that is a multiple of 3, so the decimal point lets you show the zero on purpose. For the clearance, drop the leading zeros by moving to (10⁻³) or a milli prefix.',
          '48 600 N = **48.60(10³) N** (or 48.60 kN): the written 0 after the point is the fourth figure. 0.000 913 m = **0.913(10⁻³) m** = 0.913 mm.'
        ],
        consequence: function (ctx, a) {
          // What a stranger reading the plate can rely on: take each stamp at
          // the fewest figures it could mean and give the band of true values
          // that reading allows (± half a unit in the last place it promises).
          function band(ans, label, unitText, scale) {
            var r = ans && ans.result;
            if (!r || !r.parsed || !r.parsed.ok || !r.sigfigCount) return label + ': unreadable stamp.';
            var n = r.sigfigCount.min;
            var v = Math.abs(ans.si);
            var place = Math.floor(Math.log10(v) + 1e-12) - n + 1;
            var half = 0.5 * Math.pow(10, place);
            return label + ': a reader can only rely on **' + n + '** figure' + (n === 1 ? '' : 's') + ', so the true value is anywhere in **±' + SE.sigfig.roundSig(half * scale, 2).text + ' ' + unitText + '**' + (r.sigfigCount.ambiguous ? ' (the trailing zeros might be filler)' : '') + '.';
          }
          return Promise.resolve(band(a.P, 'Proof load', 'N', 1) + '\n\n' + band(a.c, 'Clearance', 'mm', 1000));
        },
        explain: 'With the decimal point in place, every figure on the plate is one somebody measured. The load is known to ±5 N, not ±50 or ±500.'
      },
      {
        type: 'say', who: 'hask',
        text: 'Now the cut list. Every board was read to the millimetre: four figures. The saw is set in centimetres, so each length gets cut to **three**.\n\nMost of the time it\'s obvious. **2.437 m** is nearer 2.44 than 2.43, so it rounds up. **2.432 m** rounds down to 2.43. But the tape is marked every half centimetre, so a lot of boards read exactly on a 5: **2.435 m**. Dead centre. Which way does that go?'
      },
      {
        type: 'predict', who: 'hask', scene: FENCE,
        q: 'Sixty percent of the thirty boards end in an exact 5 mm. Pick a rule for those, and we\'ll build the wall with it.\n\nWhich rule leaves the last board **closest to the end post**?',
        choices: [
          { t: 'Always round a 5 up. That\'s how I was taught.', why: 'Every exact 5 adds half a centimetre and none ever takes one away. Over eighteen boards that adds up to an overrun the end post can\'t take.' },
          { t: 'Just chop the extra digit. Simple and consistent.', why: 'Consistent, yes, and consistently short. Every board loses its last digit, so the gap grows with each one.' },
          { t: 'For an exact 5, round to whichever neighbour is even, so half go up and half go down.', correct: true, why: 'Right. The exact-5 boards split about evenly between rounding up and down, so the errors cancel instead of piling up.' }
        ],
        run: function (ctx, idx) {
          var s = ctx.scene;
          return s.run({ rule: RULES[idx] }).then(function (r) {
            var g = s.ghosts;
            var verdict = r.outcome === 'sealed' ? 'The last board sits snug against the post.' : r.outcome === 'jammed' ? 'The last board overruns the post and the run buckles.' : 'A gap opens at the end post, wide enough for a shoulder.';
            return 'You built it with **' + RULE_WORDS[r.detail.rule] + '**: drift **' + cmS(r.detail.drift) + '**. ' + verdict + '\n\nSame boards, other rules: even-neighbour ' + cmS(g.book.drift) + ', always up ' + cmS(g.up.drift) + ', chop ' + cmS(g.truncate.drift) + '.';
          });
        },
        reveal: 'Rounding is meant to leave the accuracy of the answer matching the data, **without pushing it in one direction**. A rule that always sends the exact half the same way has a built-in lean.'
      },
      {
        type: 'try', who: 'hask', scene: FENCE,
        text: 'Build the wall with each rule. Then change the board pile or the share of readings that end in 5 and see whether the winner changes.',
        controls: ['rule', 'fiveFrac', 'seed'],
        goalText: 'Build the palisade with all three rules',
        actions: [BUILD],
        goal: function (ctx) { var b = ctx.runner._h10built || {}; return !!(b.book && b.up && b.truncate); },
        after: 'Whatever the pile, chopping always loses and rounding 5s up always gains. The even-neighbour rule wanders a little either side of zero and never runs away.'
      },
      {
        type: 'reveal', kicker: 'Rule', title: 'Rounding off',
        text: [
          'Look at the first digit you are dropping:',
          '- **More than 5** (or a 5 with anything nonzero after it): round up. 6.417**8** → 6.42.',
          '- **Less than 5**: leave the last kept digit alone. 0.851**3** → 0.851.',
          '- **Exactly 5**: look at the digit before it. If it is **even**, leave it: 3.24**5** → 3.24. If it is **odd**, round up: 0.71**5** → 0.72 (to two figures), 13.7**5** → 13.8.',
          '',
          'The aim is a result no more and no less accurate than the data that went into it.'
        ].join('\n'),
        formula: 'ch01.rounding'
      },
      {
        type: 'task', id: 'H10.round', who: 'juno',
        title: 'Clean up the depot log',
        text: 'Juno wants the raw readings in the depot log tidied to **3 significant figures** before they go on the board. Use a prefix so each one sits between 0.1 and 1000.\n\n- Distance to the relay mast: **47 261 m**\n- Ten swings of the bell-tower pendulum, timed: **59.648 s**\n- Winch pull on the test sled: **3846 N**\n- Loaded ore car: **6445 kg**\n- Flare fuse delay: **0.3335 s**',
        inputs: [
          // 47 261 m: keep 4,7,2; dropped 6 > 5 -> 47.3(10³) m = 47.3 km
          { key: 'd', label: 'Relay mast distance', placeholder: 'e.g. 12.3 km', spec: { value: LOG.d, unit: 'm', sf: 3, form: 'si', exactRounding: true }, answer: '47.3 km', wrong: [{ input: '47.2 km', kind: 'rounding' }, { input: '47261 m', kind: 'sigfig' }] },
          // 59.648 s: keep 5,9,6; dropped 4 < 5 -> 59.6 s
          { key: 't', label: 'Swing time', placeholder: 'e.g. 12.3 s', spec: { value: LOG.t, unit: 's', sf: 3, form: 'si', exactRounding: true }, answer: '59.6 s', wrong: [{ input: '59.7 s', kind: 'rounding' }] },
          // 3846 N: keep 3,8,4; dropped 6 > 5 -> 3.85(10³) N = 3.85 kN
          { key: 'F', label: 'Winch pull', placeholder: 'e.g. 1.23 kN', spec: { value: LOG.F, unit: 'N', sf: 3, form: 'si', exactRounding: true }, answer: '3.85 kN', wrong: [{ input: '3.84 kN', kind: 'rounding' }] },
          // 6445 kg: keep 6,4,4; dropped exactly 5 after an even 4 -> stays: 6.44(10³) kg = 6.44 Mg
          { key: 'm', label: 'Ore car mass', placeholder: 'e.g. 1.23 Mg', spec: { value: LOG.m, unit: 'kg', sf: 3, form: 'si', exactRounding: true }, answer: '6.44 Mg', wrong: [{ input: '6.45 Mg', kind: 'rounding' }] },
          // 0.3335 s: keep 3,3,3; dropped exactly 5 after an odd 3 -> up: 0.334 s = 334 ms
          { key: 'fuse', label: 'Fuse delay', placeholder: 'e.g. 0.123 s', spec: { value: LOG.fuse, unit: 's', sf: 3, form: 'si', exactRounding: true }, answer: '0.334 s', wrong: [{ input: '0.333 s', kind: 'rounding' }] }
        ],
        hints: [
          'For each one, find the third significant figure and look only at the digit right after it. Two of these end in exactly 5. Those are the ones to be careful with.',
          '6445 kg: the dropped digit is exactly 5 and the digit before it, 4, is even. 0.3335 s: exactly 5 again, but the digit before it is odd. Then pick a prefix: k for 47 261 m and 3846 N, M (megagram) for 6445 kg.',
          '47.3 km · 59.6 s · 3.85 kN · **6.44 Mg** (4 is even, so it stays) · **0.334 s** (3 is odd, so it goes up).'
        ],
        consequence: function (ctx, a) {
          // The habit the player's numbers reveal is what goes on the real cut
          // list, so build the palisade with it.
          var habit = habitOf(a);
          var s = ctx.setScene(FENCE.type, Object.assign({}, FENCE.params, { rule: habit }));
          return s.run({ rule: habit }).then(function (r) {
            var lead = habit === 'book' ? 'Your log rounds the exact 5s the course way. Hask uses the same habit on the palisade cut list.' :
              habit === 'up' ? 'Your log pushes an exact 5 up even after an even digit. Hask cuts the palisade boards with that habit.' :
              'Your log drops digits that should have rounded up. Hask cuts the palisade boards with that habit.';
            return lead + ' Drift at the end post: **' + cmS(r.detail.drift) + '**, and the wall is **' + r.outcome + '**.';
          });
        },
        explain: 'Two of those were exact 5s, and they went opposite ways. That split is what keeps thirty boards honest.'
      },
      {
        type: 'sandbox', scene: FENCE,
        text: 'The palisade yard. Change the pile, the share of readings that land on a 5 and the width a zombie can squeeze through.',
        controls: ['rule', 'boards', 'fiveFrac', 'seed', 'gapLimit'],
        actions: [BUILD],
        prompts: [
          'Set the share of readings ending in 5 to zero. Do the three rules still differ? Why is chopping still worst?',
          'With 80 boards, how big does the always-up overrun get?',
          'Find a pile where the even-neighbour rule drifts the wrong way. Is it ever as bad as the others?'
        ]
      },
      {
        type: 'say', who: 'hask',
        text: 'One more trap, and it\'s the one that catches clever people. The gantry boom needs a new stay, and the bolt hole has to go where the stay pin lands. The sheet works it out in six steps: square the rise and the reach, add them, take the root for the boom length, split it into bays, count along to the stay node.\n\nThe clerk is tidy. He rounds every line of the sheet to three figures as he goes, because "three figures is what we report".'
      },
      {
        type: 'predict', who: 'hask', scene: CRANE,
        q: 'Every input on the sheet is good to three figures, and every line is rounded to three. The hole has **1 mm** of clearance around the pin.\n\nWill the pin go home?',
        choices: [
          { t: 'Yes. Three figures in, three figures out. It should be dead on.', why: 'Each rounding nudges the number a little, and each later line inherits the nudge and builds on it.' },
          { t: 'No. Small rounding errors on each line pile up, and a millimetre isn\'t much.', correct: true, why: 'Right. Six roundings of a few parts in a thousand each are plenty to miss a 1 mm hole on a 5.8 m boom.' },
          { t: 'It depends on whether the clerk rounds the 5s the right way.', why: 'He does, and it still misses. The trouble isn\'t the rule, it\'s rounding too early.' }
        ],
        run: function (ctx) {
          var s = ctx.scene;
          return s.run({ keep: 'round' }).then(function (r) {
            return 'The sheet says **' + (r.detail.rounded * 1000).toFixed(0) + ' mm**. The pin arrives at ' + (r.detail.exact * 1000).toFixed(1) + ' mm. Off by **' + mmS(r.detail.error) + '** against ±' + (r.detail.clearance * 500).toFixed(1) + ' mm of play: the pin ' + (r.outcome === 'fits' ? 'goes home.' : 'jams against the plate.');
          });
        },
        reveal: 'Each rounding is small. The sheet keeps building on rounded numbers, so the errors **compound** from line to line.'
      },
      {
        type: 'try', who: 'hask', scene: CRANE,
        text: 'Run the same sheet keeping **full precision** on every line, and round only when the number goes to the drill. Then try keeping fewer or more figures per line and see where the pin starts to miss.',
        controls: ['keep', 'sf'],
        goalText: 'Get the stay pin home',
        actions: [DRILL],
        goal: function (ctx) { var s = ctx.scene; return !!(s && s.result && s.result.outcome === 'fits'); },
        after: 'Same inputs, same formula. The only change was *when* the rounding happened.'
      },
      {
        type: 'reveal', kicker: 'Practice', title: 'Calculations',
        text: [
          '- Keep intermediate results **at full precision**: leave them in the calculator\'s memory and don\'t retype rounded values. Round **only the final answer**.',
          '- Report final answers to **three significant figures**. Most engineering data, the geometry and the loads, can only be measured reliably to about that, so more figures would claim accuracy you don\'t have.',
          '- Calculate with several figures and report three, using the rounding rules above.'
        ].join('\n'),
        formula: 'ch01.rounding'
      },
      {
        type: 'task', id: 'H10.chain', who: 'hask', scene: MAST_SCENE,
        title: 'The lookout mast stay',
        text: 'The lookout mast has a raking boom whose tip sits **3.53 m** up and **6.78 m** out from the heel pin. The boom is laced in **6** equal bays and the stay bolts on at **node 5**, counting from the heel.\n\nWork out how far along the boom the bolt goes, $s = \\frac{5}{6}\\sqrt{h^{2} + r^{2}}$, and give it to **3 s.f.** The stay plate is slotted, ±6 mm, so a correctly rounded final answer will fit.',
        inputs: [
          // Full precision: L = sqrt(12.4609 + 45.9684) = 7.643906 m; s = 5/6 L = 6.369922 m -> 6.37 m.
          // Rounding every line gives 6.40 m (30 mm long), which the checker flags as rounding.
          { key: 's', label: 'Bolt distance from the heel pin, s', placeholder: 'e.g. 4.56 m', spec: { value: MAST_S, unit: 'm', sf: 3, form: 'si', exactRounding: true }, answer: '6.37 m', wrong: [{ input: '6.40 m', kind: 'rounding' }, { input: '6.36 m', kind: 'rounding' }, { input: '6.4 m', kind: 'sigfig' }] }
        ],
        hints: [
          'Do the whole thing in one go on the calculator, or store each line in memory. Don\'t write down a rounded value and type it back in.',
          'h² + r² = 12.4609 + 45.9684 = 58.4293 m². Take the root for the boom length L, divide by 6 for one bay, multiply by 5.',
          'L = 7.643 906 m, one bay = 1.273 984 m, s = 6.369 922 m, which is **6.37 m** to 3 s.f. Rounding each line instead gives 12.5 + 46.0 = 58.5, √ = 7.65, /6 = 1.28, ×5 = 6.40 m: 30 mm long.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene(MAST_SCENE.type, MAST_SCENE.params);
          var player = a.s && a.s.si;
          if (player == null || !isFinite(player)) return Promise.resolve('Nothing readable to drill to.');
          // The fabricator drills where the player's answer says, to the
          // tape's millimetre; the pin arrives at the true position.
          s.chainMark = function () { return Math.round(player / this.p.markRes) * this.p.markRes; };
          return s.run({ keep: 'full' }).then(function (r) {
            return 'Drilled at **' + (r.detail.mark * 1000).toFixed(0) + ' mm**; the pin lands at ' + (r.detail.exact * 1000).toFixed(1) + ' mm (' + mmS(r.detail.error) + ', slot ±6 mm). ' + (r.outcome === 'fits' ? 'The stay bolts home.' : 'The pin hits the end of the slot and the stay won\'t go on.');
          });
        },
        explain: 'Your three figures came from a calculation that kept all of them. That is the whole trick.'
      },
      {
        type: 'sandbox', scene: CRANE,
        text: 'The boom sheet. Change the geometry, the figures the clerk keeps per line, and the clearance of the hole.',
        controls: ['keep', 'h', 'r', 'bays', 'k', 'sf', 'clearance'],
        actions: [DRILL],
        prompts: [
          'With rounding on every line, how many figures per line does it take before the 1 mm hole fits?',
          'Find a geometry where rounding every line happens to land dead on. Does that make it a safe habit?',
          'Shrink the clearance to 0.2 mm. Does full precision still fit when the drill is marked to the nearest millimetre?'
        ]
      },
      {
        type: 'deeper', title: 'Banker\'s rounding, and why your computer does it too',
        teaser: 'The even-neighbour rule for exact 5s has a name outside the workshop, and it\'s the default in nearly every computer chip.',
        scene: FENCE, restoreScene: FENCE,
        steps: [
          { type: 'say', who: 'hask', text: 'Round-half-to-even is often called **banker\'s rounding**, because banks summing millions of rounded amounts couldn\'t afford a rule that always nudges up. The floating-point standard that nearly every processor follows, **IEEE 754**, uses it as its default rounding mode for the same reason.' },
          {
            type: 'derive', title: 'Why it has no lean',
            intro: 'Measure the rounding error in units of the last kept place. Look only at the readings that end in an exact 5, which are the ones the rules disagree on.',
            lines: [
              { eq: '\\t{always up: } e = +\\frac{1}{2} \\t{ every time}', why: 'Every exact half is pushed up by half a place.' },
              {
                eq: '\\t{mean } e_{\\t{up}} = +\\frac{1}{2}',
                why: 'The average error per exact-5 reading never goes away.',
                ask: { q: 'With N such readings, how does the always-up drift grow?', choices: [{ t: 'Like N/2: it grows steadily with every board', correct: true, why: 'Each one adds +½, so N of them add N/2 places.' }, { t: 'It stays bounded, because the errors are small', why: 'Small, but always the same sign, so they add.' }] }
              },
              { eq: '\\t{half to even: } e = +\\frac{1}{2} \\t{ (odd before)}, \\quad -\\frac{1}{2} \\t{ (even before)}', why: 'The digit before the 5 is odd about as often as it is even.' },
              {
                eq: '\\t{mean } e_{\\t{even}} = \\frac{1}{2}(+\\frac{1}{2}) + \\frac{1}{2}(-\\frac{1}{2}) = 0',
                why: 'So on average the exact-5 errors cancel. What drift is left is a random walk that grows only like √N, not like N.',
                ask: { q: 'What would make banker\'s rounding biased after all?', choices: [{ t: 'Data where the digit before the 5 is nearly always even (or nearly always odd)', correct: true, why: 'Then the halves stop cancelling. Real measurements rarely do that, which is why the rule works.' }, { t: 'Using it on very large numbers', why: 'Size doesn\'t matter, only the pattern of digits before the 5.' }] }
              }
            ],
            outro: 'Chopping is worse again: it loses about half a place on **every** reading, 5 or not, so its drift grows like N even with no exact 5s at all.'
          },
          {
            type: 'sandbox', scene: FENCE,
            text: 'Push the board count to 80 and the share of exact 5s to 1. Build with always-up, then with the even rule.',
            controls: ['rule', 'boards', 'fiveFrac'],
            prompts: ['How far does always-up overrun with 80 boards that all end in 5?', 'Set the share of 5s to 0. Which rule still drifts, and why?'],
            actions: [BUILD]
          }
        ]
      },
      {
        type: 'deeper', title: 'How many figures can a measurement honestly carry?',
        teaser: 'Three figures is the habit. The caliper tells you the actual limit, and the area of a plate inherits the uncertainty of both sides.',
        scene: { type: 'bench', params: { mode: 'caliper', label: 'wear plate' } }, restoreScene: FENCE,
        steps: [
          { type: 'say', who: 'hask', text: 'This vernier reads to **0.02 mm**, its least count. Any reading could be out by about that much. When you multiply two readings for an area, the **relative** uncertainties combine.' },
          {
            type: 'reveal', kicker: 'Beyond the course text', title: 'Propagating uncertainty',
            eq: '\\frac{\\Delta(ab)}{ab} \\approx \\sqrt{(\\frac{\\Delta a}{a})^{2} + (\\frac{\\Delta b}{b})^{2}}',
            text: 'For **products and quotients**, relative uncertainties combine like this (worst case: they simply add). For **sums and differences**, the absolute uncertainties combine the same way. Round the final uncertainty to one figure and keep digits of the result down to that place.',
            formula: 'ch01.error-prop'
          },
          {
            type: 'task', id: 'H10.caliper', who: 'hask', required: false,
            title: 'Stamp the plate area',
            text: 'The caliper reads the wear plate at **48.36 mm** by **21.14 mm**, each ±0.02 mm. How many significant figures can the plate\'s area honestly carry? (Just the count.)',
            inputs: [
              // A = 48.36 × 21.14 = 1022.33 mm². Relative: sqrt((0.02/48.36)² + (0.02/21.14)²) = 1.03(10⁻³),
              // so ΔA ≈ 1.06 mm² -> 1 mm². Digits down to the units place: 1022 mm², 4 s.f.
              { key: 'n', label: 'Justified significant figures', placeholder: 'e.g. 5', spec: { value: B.sigFigsJustified(48.36 * 21.14, B.propagate('product', [48.36, 21.14], [0.02, 0.02]).abs), unit: '', sf: null, tol: 0.01 }, answer: '4' }
            ],
            hints: [
              'Work out the area and the relative uncertainty of each side first.',
              'Relative uncertainties: 0.02/48.36 and 0.02/21.14. Combine them as a root sum of squares and multiply by the area.',
              'A = 1022.33 mm², ΔA ≈ 1.06 mm², which rounds to 1 mm². So the area is good to the units place: **1022 mm², four figures**.'
            ],
            consequence: function (ctx, a) {
              var claim = a.n && a.n.si;
              var s = ctx.setScene('bench', { mode: 'caliper', label: 'wear plate' });
              if (claim == null) return Promise.resolve('No count given.');
              return s.run({ sf: Math.round(claim) }).then(function (r) {
                return 'Area ' + SE.sigfig.roundSig(r.detail.area, r.detail.sf).text + ' mm² ± ' + SE.sigfig.roundSig(r.detail.abs, 1).text + ' mm². You claimed ' + Math.round(claim) + ' figures: **' + r.outcome + '**.';
              });
            }
          },
          {
            type: 'sandbox', scene: { type: 'bench', params: { mode: 'caliper', label: 'wear plate' } },
            text: 'Swap the caliper\'s least count and the plate size and watch how many figures the area can carry.',
            controls: ['res', 'a', 'b', 'worst'],
            actions: [MEASURE],
            prompts: ['With a 0.1 mm least count, how many figures is the area worth?', 'Make one side tiny. Which side now limits the answer?']
          }
        ]
      },
      {
        type: 'summary',
        points: [
          'Significant figures say how accurately a number is known. Leading zeros never count; trailing zeros of a whole number are **ambiguous**.',
          'Use **engineering notation**, powers of ten in multiples of 3, or one prefix: 48.6(10³) vs 48.60(10³), 4.17(10⁻³).',
          'Rounding: dropped digit **> 5** round up, **< 5** leave it. **Exactly 5**: even digit before it stays, odd goes up. That split keeps long sums unbiased.',
          'Keep **full precision** through a calculation and round only the final answer, normally to **3 s.f.**, because the data are only good to about that.'
        ]
      }
    ]
  });
})(globalThis.SE);
