/*
 * H8 · Stamp the Plate: SI prefixes and the rules for using them.
 * Course section 1.4 (prefixes, rules for use, prefixed products).
 *
 * Played in the build yard. The depot's salvaged crane controller drives a
 * governed hoist: it reads the plates stamped on the hoist letter for letter
 * and pulls exactly the line tension the hold plate says. A prefix slip is a
 * factor of 1000 in the pull, and the physics shows it: the line snaps or the
 * load drops. In strict mode the firmware also refuses any plate that breaks
 * the SI rules, so the motor never engages and the worn brake lets the load
 * slide down.
 *
 * Level part (bottom of this file): `h08-governor`, the governed hoist.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, U = SE.units;

  var g = 9.81;
  var GEN_W = 2450;                    // N, the generator's plate weight
  var PALLET_W = 6359;                 // N, Juno's pallet (kept to every digit)
  var RATING = '12 kN';                // the hoist line
  var WORN_BRAKE = 1500;               // N, the drum brake that holds when the motor is off
  var HANG_Y = 4;                      // m, centre of a hanging load
  var CREW = 2.5;                      // s, the crew's bolting time before lowering may start

  // Mass typed to every digit so the plate weight is exact at g = 9.81.
  function massFor(W) { return String(W / g) + ' kg'; }
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  var f4 = function (x) { return Y.dial.fmtNum(x, 4); };
  function kN(N) { var a = Math.abs(N); return a >= 1e6 ? f3(N / 1e6) + ' MN' : a >= 1e3 ? f3(N / 1e3) + ' kN' : a >= 1 ? f3(N) + ' N' : f3(N * 1e3) + ' mN'; }

  /* ------------------------------------------------------------ the rig */

  var JIB = { id: 'jib', type: 'jib', x: 0, y: 0, dials: { height: '6 m', reach: '4 m' }, locked: true, label: 'port crane' };
  function load(id, W, label, extra) {
    return Object.assign({ id: id, type: 'crate', x: 4, y: HANG_Y, dials: { mass: massFor(W) }, locked: true, hide: ['mass'], label: label, plate: ['Weight ' + kN(W)] }, extra || {});
  }
  function governor(dials, open, extra) {
    return Object.assign({ id: 'gov', type: 'h08-governor', a: { part: 'jib', anchor: 'tip' }, b: { part: 'gen', anchor: 'top' },
      dials: Object.assign({ hold: '2.45 kN', rating: RATING, firmware: 'service' }, dials || {}),
      locked: true, open: open || ['hold'], label: 'governed hoist' }, extra || {});
  }

  var CAMERA = { fit: { lo: { x: -1.5, y: -0.5 }, hi: { x: 7.5, y: 7 } } };
  var SITE = { g: g, floor: 'concrete' };
  var READOUTS = ['gov.tension', 'gov.height'];

  var BARE = { parts: [JIB, load('gen', GEN_W, 'generator')] };
  var RIGGED = { parts: [JIB, load('gen', GEN_W, 'generator'), governor()] };
  var STRICT = { parts: [JIB, load('gen', GEN_W, 'generator'), governor({ hold: '2450 N', firmware: 'strict' })] };
  var PALLET = { parts: [JIB, load('gen', PALLET_W, 'pallet'), governor({ hold: '6.359 MN' })] };
  var TRAILER = { id: 'trailer', type: 'block', x: 4, y: 0.6, dials: { width: '2.4 m', height: '1.2 m' }, locked: true, label: 'trailer bed' };
  var LOWER = { parts: [JIB, load('gen', GEN_W, 'generator'), TRAILER,
    governor({ hold: '2450 N', dwell: '3000 ms', lower: '0.25 mm/ms', firmware: 'strict' }, ['hold', 'dwell', 'lower'])] };

  /* ------------------------------------------------------------ goals */

  // The built governed hoist in a run (a player-rigged one has its own id).
  function govOf(s) {
    var ps = s.built.parts;
    for (var k in ps) if (ps[k].def.type === 'h08-governor') return ps[k];
    return null;
  }

  // Height of the load's centre against where it started.
  function dy(s) { var p = s.pos('gen'); return p ? p.y - HANG_Y : 0; }

  var halted = G.never(function (s) { var gv = govOf(s); return gv && gv.halt ? 'Firmware halt on the ' + gv.halt.label.toLowerCase() + ' plate (' + gv.halt.text + '): ' + gv.halt.msg + ' The motor never engaged, and the worn brake let the load slide.' : null; });
  var snapped = G.never(function (s) { var b = s.breaks[0]; return b ? 'The line snapped: the motor pulled ' + kN(b.force) + ' on a line rated ' + RATING + '.' : null; });
  var band = G.never(function (s) {
    var d = dy(s);
    if (d < -0.3) return 'The load sank ' + f3(-d) + ' m. The line pulled less than its weight.';
    if (d > 0.3) return 'The load shot up ' + f3(d) + ' m. The line pulled more than its weight.';
    return null;
  });
  // Hanging still at the start height for `secs`.
  function hangStill(secs) {
    return G.all(halted, snapped, band,
      G.holdFor('still', function (s) { return Math.abs(dy(s)) < 0.05 && s.speed('gen') < 0.02; }, secs));
  }
  var HOLD = hangStill(3);
  var HOLD_JOB = hangStill(4);

  // Strict job: still while the crew bolts, then lowered gently onto the trailer.
  var LOWER_JOB = G.all(halted, snapped,
    G.never(function (s) { return s.t < CREW && Math.abs(dy(s)) > 0.05 ? 'The generator moved at t = ' + f3(s.t) + ' s, before the crew had the frame bolted (they need ' + CREW + ' s).' : null; }),
    G.never(function (s) { return dy(s) > 0.3 ? 'The generator shot up into the jib. The line pulled more than its weight.' : null; }),
    G.never(function (s) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'gen' || i.b === 'gen') && i.speed > 0.5; })[0];
      return hit ? 'The generator hit the ' + (hit.a === 'trailer' || hit.b === 'trailer' ? 'trailer' : 'ground') + ' at ' + f3(hit.speed) + ' m/s. The crew wants it set down below 0.5 m/s.' : null;
    }),
    G.restIn('gen', { x0: 3, x1: 5, y0: 1.6, y1: 1.9 }, { maxSpeed: 0.02, hold: 1 }));

  /* ------------------------------------------------------- level helpers */

  function gov(ctx) { return ctx.find('h08-governor'); }
  function rigged(ctx) {
    var gv = ctx.find('h08-governor');
    if (!gv) return false;
    var a = gv.a || {}, b = gv.b || {};
    if (a.part === 'jib' && b.part === 'gen') return true;
    if (a.part === 'gen' && b.part === 'jib') return 'Run it **from the jib tip to the generator**, in that order: the drum end goes on the jib.';
    return 'One end on the **jib tip**, the other on the **top of the generator**.';
  }
  function ran(ctx, type) { return type === 'result' && !!ctx.result; }
  function tensionAt(ctx) { var r = ctx.result; return r && r.state ? r.state.peakOf('T') : NaN; }
  function forms(ctx) { return (ctx.values.h8forms = ctx.values.h8forms || []); }
  function readAs(text) { var q = U.parseQuantity(text || ''); return q.ok ? q.value : NaN; }
  // Track the peak line tension on every run, for the after-texts.
  var TRACK = function (s) { var gv = govOf(s); if (gv) s.peak('T', gv.tension()); };
  function withTrack(goal) { var f = function (s) { TRACK(s); return goal(s); }; return f; }

  SE.content.registerLevel('ch01', {
    id: 'H8', order: 8, title: 'Stamp the Plate',
    subtitle: 'Prefixes and the rules for using them',
    sections: ['1.4'],
    minutes: 25,
    objective: 'Stamp crane plates so every load does what you meant',
    pitch: 'A salvaged crane controller pulls exactly what its plates say. One wrong prefix letter is a factor of 1000.',
    intro: [
      'The crew dragged a crane controller out of a drowned container port. It still works, and it is very literal: it reads the plates stamped on the hoist, letter for letter, converts them to base units and drives the line with that number.',
      'Hask taps the hold plate. "This box doesn\'t guess what you meant. It pulls what you **wrote**. So we\'re going to learn to write it properly."'
    ].join('\n\n'),
    goals: [
      'Know the sizes of G, M, k, m, μ and n, and move a decimal point three places per prefix',
      'Apply the SI rules: dots between units, exponents on prefixed units, no prefix in a denominator (kg excepted)',
      'Work in base units and powers of 10, then re-express a value with one prefix and a number between 0.1 and 1000'
    ],
    yard: { site: SITE, camera: CAMERA, readouts: READOUTS, poke: false, design: RIGGED },
    // Reference builds for the scored jobs (checked by tests/yard.test.js).
    solutions: {
      'H8.pallet': [
        { set: { gov: { hold: '6.359 kN' } } },
        { set: { gov: { hold: '6359 N' } } },                   // right force, ugly form: passes, graded down
        // other rigs: a braked winch carries it, or a cable shares the load with the hoist
        { set: { gov: { hold: '0 kN' } }, add: [{ type: 'winch', a: { part: 'jib', anchor: 'tip' }, b: { part: 'gen', anchor: 'top' }, dials: { pull: '10 kN', speed: '0 m/s', brake: 'on', rating: '20 kN' } }] },
        { set: { gov: { hold: '1.000 kN' } }, add: [{ type: 'cable', a: { part: 'jib', anchor: 'tip' }, b: { part: 'gen', anchor: 'top' }, dials: { rating: '12 kN' } }] },
        { pass: false },                                         // as stamped: 6.359 MN snaps the line
        { pass: false, set: { gov: { hold: '6.359 N' } } },
        { pass: false, set: { gov: { hold: '6.359 kN', firmware: 'strict', dwell: '3000 ms' } } }
      ],
      'H8.lower': [
        { set: { gov: { hold: '2.45 kN', dwell: '3 s', lower: '0.25 m/s' } } },
        { set: { gov: { hold: '2.45 kN', dwell: '4.00 s', lower: '120 mm/s' } } },   // longer dwell, slower lowering
        { pass: false, set: { gov: { hold: '2.45 kN', dwell: '3 s' } } },            // 0.25 mm/ms: halt
        { pass: false, set: { gov: { hold: '2.45 kN', dwell: '3 ms', lower: '0.25 m/s' } } },
        { pass: false, set: { gov: { hold: '2.45 kN', dwell: '3 s', lower: '0.25 km/s' } } },
        { pass: false, set: { gov: { hold: '2.45 kN', dwell: '3 s', lower: '0.25 mm/s' } } },
        { pass: false, set: { gov: { hold: '2.45 MN', dwell: '3 s', lower: '0.25 m/s' } } }
      ]
    },
    steps: [
      /* ------------------------------------------------ prefixes */
      {
        type: 'build', who: 'hask',
        yard: { design: BARE, readouts: null, bin: [{ type: 'h08-governor', count: 1, dials: { hold: '2.45 kN', rating: RATING } }] },
        text: 'The generator is hanging off the old crane on its worn drum brake. Take the **governed hoist** from the bin and rig it: click the **jib tip** first (that is the drum end), then the **top of the generator**.\n\nSelect the hoist to see its plates. The **hold** plate is the line tension the controller will pull. It reads **2.45 kN**, the same as the weight stamped on the generator.',
        goalText: 'Hoist rigged from the jib tip to the generator',        objective: 'Rig the hoist from the jib tip to the generator',
        brief: 'Pick the **governed hoist** from the bin, click the **jib tip**, then the **top of the generator**.',

        until: rigged
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, readouts: null, goal: withTrack(G.after(4)) },
        text: 'Press **▶ Run** and watch the **tension** gauge.',
        goalText: 'Run it',        objective: 'Run it: the generator should hang still',
        brief: 'Press **▶ Run**. The hold plate says 2.45 kN, the generator weighs 2.45 kN. Watch the tension gauge.',

        until: ran,
        after: function (ctx) { return 'The line pulled **' + kN(tensionAt(ctx)) + '** against a weight of 2.45 kN. The forces balance, so the generator **hangs still**.'; }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, readouts: null, goal: withTrack(G.after(3)) },
        text: 'Somebody tired once stamped this plate **2.45 MN**. One letter. Restamp the **hold** plate as **2.45 MN**, Reset, and run it.',
        goalText: 'Run it with the hold plate at 2.45 MN',        objective: 'Stamp the hold plate 2.45 MN and run it',
        brief: 'One letter off: select the hoist, type **2.45 MN** on the hold plate, Reset and run.',

        until: function (ctx, type) {
          var gv = ctx.find('h08-governor');
          if (!gv || !ran(ctx, type)) return false;
          return Math.abs(readAs(gv.dials.hold) - 2.45e6) < 1 ? true : 'Stamp **2.45 MN** on the hold plate.';
        },
        after: 'The controller read the M as **mega**, 10⁶: 2 450 000 N of pull on a 2450 N generator, a thousand times its weight. The 12 kN line snapped the instant the drum bit, and the generator fell.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, readouts: null, goal: withTrack(G.after(3)) },
        text: 'Now the other way. Stamp it **2.45 N**, a thousand times too small, and run it.',
        goalText: 'Run it with the hold plate at 2.45 N',        objective: 'Stamp the hold plate 2.45 N and run it',
        brief: 'Now a thousand times too small: stamp **2.45 N** and run.',

        until: function (ctx, type) {
          var gv = ctx.find('h08-governor');
          if (!gv || !ran(ctx, type)) return false;
          return Math.abs(readAs(gv.dials.hold) - 2.45) < 1e-6 ? true : 'Stamp **2.45 N** on the hold plate.';
        },
        after: 'A line pulling 2.45 N can\'t carry a 2450 N load. The motor let the drum run out and the generator dropped to the slab.'
      },
      {
        type: 'reveal', kicker: 'Table 1–3', title: 'SI prefixes',
        eq: '4\\ 000\\ 000\\ \\u{N} = 4000\\ \\u{kN} = 4\\ \\u{MN}',
        table: { head: ['Multiple', 'Exponential', 'Prefix', 'Symbol'], rows: [['1 000 000 000', '10⁹', 'giga', 'G'], ['1 000 000', '10⁶', 'mega', 'M'], ['1 000', '10³', 'kilo', 'k'], ['0.001', '10⁻³', 'milli', 'm'], ['0.000 001', '10⁻⁶', 'micro', 'μ'], ['0.000 000 001', '10⁻⁹', 'nano', 'n']] },
        brief: 'Each prefix is a factor of 1000. k is 10³, M is 10⁶, m is 10⁻³. Changing the prefix moves the decimal point three places.',
        text: 'When a number gets very large or very small, a **prefix** on the unit carries the size instead. Each step in the table is a factor of 1000, so each one moves the decimal point **three places**: 7 000 000 N = 7000 kN = 7 MN, and 0.003 m = 3 mm.\n\nThe controller applies the prefix faithfully. Swap **k** for **M** and the pull goes up a thousandfold; swap it for nothing and it drops a thousandfold. You just watched both.\n\nThe metric system also has **deca** (10) and **centi** (0.01), but SI practice in engineering avoids them, apart from a few area and volume units.',
        formula: 'ch01.table-prefix'
      },
      {
        type: 'build', who: 'hask',
        yard: { keep: true, readouts: null, goal: withTrack(HOLD) },
        text: 'The prefix is part of the number. The same force can be stamped many ways: move the decimal point three places and change the prefix to match.\n\nStamp the hold plate **three different ways** that all mean the generator\'s weight, and run each one. At least one should use a prefix other than k. (Mega and milli both work, with enough zeros.)',
        goalText: 'Three different plates that each hold the generator still',        objective: 'Hold the generator still with three different plates',
        brief: 'Write the same 2.45 kN three ways (try M or m with the right zeros). Each one must hold the generator still.',

        onEnter: function (ctx) { ctx.values.h8forms = []; },
        until: function (ctx, type) {
          var gv = ctx.find('h08-governor'), list = forms(ctx);
          if (!gv || !ran(ctx, type)) return false;
          var t = String(gv.dials.hold).replace(/\s+/g, ' ').trim();
          if (!ctx.result.pass) return Math.abs(readAs(t) - GEN_W) > 1e-6 * GEN_W ? '`' + t + '` reads as **' + kN(readAs(t)) + '**, not 2.45 kN. Count the places again.' : false;
          if (list.indexOf(t) < 0) list.push(t);
          var other = list.some(function (x) { return !/(^|[\d\s])kN$/.test(x); });
          if (list.length >= 3 && other) return true;
          return 'Held with `' + list.join('`, `') + '`. ' + (list.length < 3 ? 'Try another.' : 'Now one without the k.');
        },
        after: function (ctx) { return 'All of these are one force: `' + forms(ctx).join('`, `') + '`. The controller converted each to **2450 N** and pulled exactly that. Some of those plates are still ugly, though, and the strict firmware has opinions about that.'; }
      },
      {
        type: 'job', id: 'H8.pallet', who: 'juno',
        yard: { design: PALLET, bin: [{ type: 'winch', count: 1 }, { type: 'cable', count: 1 }], goal: null },
        text: 'Juno\'s crew has a pallet of pump parts on the hook. Its weight was measured as **6359 N**, to four figures, and somebody stamped the hold plate **6.359 MN**.\n\nRestamp the hold plate in **kilonewtons**, keeping **every digit** that was measured, then run it. The pallet has to hang still for 4 s while the crew checks the slings.\n\nThe kit also has a winch and a cable. Any rig that holds the pallet still counts, but the grade still reads the hold plate.',
        goalText: 'Pallet hanging still for 4 s, hold plate in kN to four figures',        objective: 'Pallet hangs still 4 s; hold plate in kN, all four digits',
        brief: 'The pallet weighs **6359 N** and the plate says **6.359 MN**. Restamp it in kN, keeping every digit.',

        goal: withTrack(HOLD_JOB),
        timeout: 8,
        grade: { part: 'gov', key: 'hold', spec: { value: PALLET_W, unit: 'N', sf: 4, form: 'si', expressIn: 'kN' } },
        hints: [
          'Going from newtons to kilonewtons, the number gets 1000 times smaller: move the decimal point three places left.',
          'Changing the prefix moves the decimal point and nothing else. Keep all four measured digits.',
          '6359 N = **6.359 kN**.'
        ],
        onFail: function (ctx) { var gv = gov(ctx); return gv ? 'The controller read your plate `' + gv.dials.hold + '` as **' + kN(readAs(gv.dials.hold)) + '**. The pallet weighs 6.359 kN.' : ''; },
        success: function (ctx) { var t = gov(ctx).dials.hold; return 'Held. The controller read `' + t + '` as ' + f4(readAs(t)) + ' N. ' + (/^6\.359\s*kN$/.test(t.trim()) ? 'Every measured digit survived the restamp.' : 'It works, but look at the grade: the crew wanted it **in kN, to all four digits**.'); }
      },

      /* ------------------------------------------------ rules for use */
      {
        type: 'reveal', kicker: 'Rules for use', title: 'Writing SI properly',
        eq: '(80\\ \\u{kN})(45\\ \\u{nm}) = 3.60\\ \\u{mN·m}',
        brief: 'Dot between multiplied units (m·s, not ms). No prefix below the line except kg. One prefix, number between 0.1 and 1000.',
        text: '- **Dots** separate units that multiply: **m·s** is a metre-second, **ms** is a millisecond. The controller sees an m stuck to an s and reads milli.\n- An **exponent** applies to the prefix and the unit together: mN² = (mN)² = 10⁻⁶ N², and mm² = (mm)².\n- **No prefix in a denominator**, the kilogram excepted. Write kN/m, not N/mm. Write Mm/kg, not m/mg.\n- **Calculate in base units** with powers of 10, then re-express the result with **one** prefix, keeping the number **between 0.1 and 1000**.\n\nThe port ran its controllers in **strict** mode, where the firmware refuses any plate that breaks these rules.',
        formula: 'ch01.si-rules'
      },
      {
        type: 'build', who: 'hask',
        yard: { design: STRICT, bin: [], goal: withTrack(HOLD) },
        text: 'Hask flips the controller into **strict** mode. The hold plate reads **2450 N**, which is the right force. Run it.\n\nThen fix the plate so the firmware accepts it, and run it again.',
        goalText: 'See the firmware halt, then hold the generator in strict mode',        objective: 'In strict mode, get the generator hanging still',
        brief: 'Strict firmware refuses plates that break SI rules. Run **2450 N** to see it halt, then restamp it so it holds.',

        onEnter: function (ctx) { ctx.values.h8halt = false; },
        until: function (ctx, type) {
          if (!ran(ctx, type)) return false;
          var gv = ctx.result.state && govOf(ctx.result.state);
          if (gv && gv.halt) { ctx.values.h8halt = true; return 'Firmware halt: **' + gv.halt.msg + '** Select the hoist: its plate says what the firmware read. Restamp it and run again.'; }
          if (!ctx.values.h8halt) return 'Run it once as stamped first, to see what strict mode does.';
          return ctx.result.pass ? true : false;
        },
        after: function (ctx) { return '`' + gov(ctx).dials.hold + '` passes the firmware and holds the generator. A **value** error makes the controller do the wrong thing. A **form** error makes the strict firmware do nothing at all, and with a worn brake, nothing at all also drops the load.'; }
      },
      {
        type: 'rule', kicker: 'Worked method', title: 'Prefixed products and quotients',
        eq: ['(40\\ \\u{mN})(5\\ \\u{GN}) = 200(10^{6})\\ \\u{N^2}',
          '200(10^{6})\\ \\u{N^2} = 200\\ \\u{kN^2}',
          '\\frac{36\\ \\u{MN^3}}{600\\ \\u{Gg}} = \\frac{36(10^{18})\\ \\u{N^3}}{600(10^{6})\\ \\u{kg}}',
          '= 60.0(10^{9})\\ \\u{N^3/kg} = 60.0\\ \\u{kN^3/kg}'],
        brief: 'Turn prefixes into powers of ten, compute, then put one prefix back. A prefix on N² is squared too.',
        text: 'Every calculation goes the same way: turn each prefix into its power of ten, compute, then put **one** prefix back on the answer.\n\nWatch the exponents. 10⁶ N² is (10³ N)², so the prefix is **k**, not M. In the quotient, 36 MN³ means 36 (10⁶ N)³ = 36(10¹⁸) N³: only the unit is cubed, not the 36. And 600 Gg is 600(10⁹) **grams**, which is 600(10⁶) kg. The kilogram stays below the line, the one prefixed unit allowed there.'
      },
      {
        type: 'job', id: 'H8.lower', who: 'juno',
        yard: { design: LOWER, bin: [], goal: null },
        text: 'The generator goes on the trailer. The controller is in **strict** mode, and someone stamped the plates straight off an old port work order:\n\n- **Hold**: 2450 N (the line tension while it hangs)\n- **Dwell**: 3000 ms (how long it hangs before lowering; the crew needs at least ' + CREW + ' s to bolt the frame)\n- **Lower**: 0.25 mm/ms (the lowering speed)\n\nEvery value is right. Every plate breaks a rule. Restamp all three in correct SI form **without changing a value**, and set it down gently.',
        goalText: 'Generator still for the crew, then set down on the trailer below 0.5 m/s',        objective: 'Set the generator on the trailer; plates in legal SI',
        brief: 'Strict mode. All three plates have the right value in an illegal form. Restamp them, keep the values, and lower it gently.',

        goal: withTrack(LOWER_JOB),
        timeout: 30,
        grade: { part: 'gov', key: 'lower', spec: { value: 0.25, unit: 'm/s', sf: null, form: 'si' } },
        hints: [
          'Find each plate\'s value in base units first. Then pick the one prefix (or none) that leaves a number between 0.1 and 1000, with no prefix below the line.',
          '2450 N is 2.45(10³) N. 3000 ms is 3 s. 0.25 mm/ms is 0.25(10⁻³) m / (10⁻³ s) = 0.25 m/s.',
          'Hold **2.45 kN**, dwell **3 s**, lower **0.25 m/s** (or 250 mm/s).'
        ],
        onFail: function (ctx) {
          var gv = gov(ctx); if (!gv) return '';
          return 'The controller read: hold **' + kN(readAs(gv.dials.hold)) + '**, dwell **' + f3(readAs(gv.dials.dwell)) + ' s**, lower **' + f3(readAs(gv.dials.lower)) + ' m/s**.';
        },
        success: 'On the trailer. Same three values as the work order, written so the firmware could read them, and the crane did exactly what the plates said.'
      },
      {
        type: 'free', who: 'hask',
        yard: { design: { parts: [JIB, load('gen', GEN_W, 'generator', { hide: [], open: ['mass'], locked: false }), TRAILER, governor({ dwell: '3 s', lower: '0.25 m/s' }, ['hold', 'dwell', 'lower', 'firmware', 'rating'])] },
          bin: [{ type: 'h08-governor', count: 1 }, { type: 'crate', count: 2 }], goal: null },
        objective: 'Free play: break it, fix it, try every plate',
        brief: 'Every plate on the hoist is open, plus the firmware switch and the generator mass.',
        text: 'The crane is yours. Every plate on the hoist is open, including the firmware switch and the line rating. The generator\'s mass is unlocked too.',
        prompts: [
          'Find a hold plate with the right force that the strict firmware still refuses. Which rule does it break?',
          'Stamp **2.45 kN·m** on the hold plate. Why won\'t the dial take it?',
          'Stamp a lowering speed of **0.25 km/s**, then **0.25 mm/s**. Which one is the crew happier about?',
          'How big can the hold plate get before the 12 kN line parts? Write it three ways.'
        ]
      },
      {
        type: 'deeper', title: 'Powers of a thousand, and a kilogram with a prefix',
        teaser: 'Why steps of 1000, how far the table really goes, and why the kilogram is the odd one out.',
        steps: [
          { type: 'say', who: 'hask', text: 'Steps of 1000 line up with how numbers are written in groups of three digits, 7 000 000, so a prefix change is always "move the gap". It also means engineering notation needs only exponents that are multiples of 3, and the number in front always lands between 1 and 1000. Hecto, deca, deci and centi break that pattern, which is why engineers leave them alone.' },
          { type: 'say', who: 'hask', text: 'The full SI list runs much further than Table 1–3: tera (10¹²), peta (10¹⁵), exa (10¹⁸), zetta (10²¹), yotta (10²⁴) up top, and pico, femto, atto, zepto, yocto below. In 2022 the General Conference on Weights and Measures added **ronna** (R, 10²⁷) and **quetta** (Q, 10³⁰), with **ronto** (r) and **quecto** (q) for the small end.' },
          { type: 'say', who: 'hask', text: 'The **kilogram** is the odd base unit out: its name already carries a prefix. The metric system of the 1790s started from the gram, but a gram is too small to make a good physical standard, so the platinum reference that got built was a kilogram. When the base units were chosen, the kilogram was the one with a real artefact behind it, and it kept its prefix. That is why 1000 kg is written 1 Mg, not 1 kkg.' }
        ]
      },
      {
        type: 'summary',
        points: [
          'Prefixes G, M, k, m, μ, n are 10⁹, 10⁶, 10³, 10⁻³, 10⁻⁶, 10⁻⁹. Each step moves the decimal point three places: 4 000 000 N = 4000 kN = 4 MN.',
          'A prefix is part of the value. One wrong letter is a factor of 1000, and a literal machine applies it.',
          'No deca or centi in engineering. The **kilogram** already has kilo in it, so 1000 kg is written 1 Mg.',
          'A **dot** separates multiplied units (m·s vs ms). An **exponent** applies to the prefix too (mm² = (mm)²).',
          '**No prefix in a denominator**, except kg: kN/m, not N/mm.',
          'Calculate in base units and powers of ten, then re-express with **one** prefix and a number between **0.1 and 1000**.'
        ]
      }
    ]
  });

  /* ------------------------------------------------------------ parts */

  // The governed hoist the controller drives. Connector: a = drum (jib tip),
  // b = load. The motor pulls the line with exactly the tension on the hold
  // plate (it reels in hard and slips at that pull), so the load's motion
  // follows from hold − weight. After `dwell` it pays out at `lower`. In
  // strict mode a plate that breaks the SI rules halts the firmware: the
  // motor never engages and only the worn drum brake holds the line.
  var PLATES = [['hold', 'Hold'], ['dwell', 'Dwell'], ['lower', 'Lower']];
  function firmwareHalt(inst) {
    if (inst.dials.firmware !== 'strict') return null;
    for (var i = 0; i < PLATES.length; i++) {
      var k = PLATES[i][0], text = inst.dials[k];
      if (text == null || String(text).trim() === '') continue;
      var q = U.parseQuantity(String(text));
      if (!q.ok) continue;                            // the dial itself refuses it
      var issues = U.checkSIForm(q);
      if (issues.length) return { key: k, label: PLATES[i][1], text: String(text).trim(), msg: issues[0].msg };
    }
    return null;
  }

  Y.definePart({
    type: 'h08-governor', name: 'Governed hoist', category: 'Rigging', library: false,
    blurb: 'A winch run by the port controller. It pulls the line with exactly the tension on its hold plate, then after the dwell time lowers at the set speed. Strict firmware refuses plates that break the SI rules.',
    size: { w: 0.1, h: 2 },
    connector: true,
    dials: [
      { key: 'hold', label: 'Hold plate (line pull)', q: 'force', def: '2.45 kN', min: 0 },
      { key: 'dwell', label: 'Dwell plate (then lower)', q: 'time', def: '', optional: true, min: 0 },
      { key: 'lower', label: 'Lower plate (speed)', q: 'speed', def: '', optional: true, min: 0 },
      { key: 'rating', label: 'Line breaking load', q: 'force', def: RATING, min: 1 },
      { key: 'firmware', label: 'Firmware', choice: ['service', 'strict'], def: 'service' }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      var L = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var halt = firmwareHalt(b.inst);
      var hold = b.si('hold'), dwell = b.si('dwell'), lower = b.si('lower') || 0, rating = b.si('rating');
      // While holding, the line itself is slack-following (it pays out freely
      // and carries nothing); the motor's pull is applied along it below.
      // Halted, only the worn brake holds. Lowering, the drum pays out at the
      // lower plate's speed and the line carries the load.
      var j = b.joint(new b.P.WinchJoint({ bodyA: A.body, localAnchorA: A.local, bodyB: B.body, localAnchorB: B.local,
        length: L, reelSpeed: 0, maxPull: 0, brake: !!halt, brakeForce: WORN_BRAKE,
        minLength: 0.6, breakForce: rating, label: b.inst.label || 'hoist' }));
      var world = b.world, st = { mode: halt ? 'halt' : 'hold', pull: 0 };
      function drumAt() { return A.body.worldPoint(A.local); }
      function hookAt() { return B.body.worldPoint(B.local); }
      function grip(len) { j.length = len; j.reelSpeed = 0; j.speed = 0; j.brake = true; j.brakeForce = Infinity; j.maxPull = rating; }
      function apply() {
        if (j.broken || st.mode === 'gone') { st.pull = 0; return; }
        if (st.mode === 'hold' && dwell != null && world.time >= dwell - 1e-9) {
          st.mode = 'lower'; st.pull = 0;
          j.length = j.path.update(); j.speed = 0; j.reelSpeed = -lower; j.maxPull = rating; j.brake = false;
          if (lower === 0) grip(j.length);
        }
        if (st.mode !== 'hold') { st.pull = 0; return; }
        var d = drumAt(), h = hookAt(), dx = d.x - h.x, dy = d.y - h.y, r = Math.hypot(dx, dy);
        // the motor pulls the hold tension; a line can't carry more than its rating
        if (hold > rating) {
          // a motor pull, not a one-step spike, so no break hysteresis: the
          // line parts as the drum bites (on the first step, so the judge sees it)
          if (world.time === 0) return;
          st.mode = 'gone'; st.pull = 0; j.broken = true; world.removeJoint(j);
          world.emit('break', { joint: j, force: hold, torque: 0, reason: 'force', part: null });
          return;
        }
        if (r <= 0.6) { st.mode = 'stop'; st.pull = 0; grip(r); return; }   // hook block at the drum stop
        st.pull = hold;
        pullAlong();
      }
      function pullAlong() {
        var d = drumAt(), h = hookAt(), dx = d.x - h.x, dy = d.y - h.y, r = Math.hypot(dx, dy);
        if (B.body.type === 'dynamic' && st.pull > 0 && r > 0) { if (B.body.wake) B.body.wake(); B.body.applyForce({ x: st.pull * dx / r, y: st.pull * dy / r }, h); }
      }
      if (!halt) { apply(); b.on('step', apply); }
      return { joint: j, halt: halt, state: st, hook: B, tension: function () { return j.broken ? 0 : st.mode === 'hold' ? st.pull : Math.max(0, j.lineTension()); } };
    },
    plate: function (inst) {
      var lines = ['Firmware: ' + (inst.dials.firmware || 'service')];
      PLATES.forEach(function (p) {
        var t = inst.dials[p[0]];
        if (t == null || String(t).trim() === '') return;
        var q = U.parseQuantity(String(t));
        if (q.ok) lines.push(p[1] + ' "' + String(t).trim() + '" reads ' + Y.dial.fmtNum(q.value, 4) + ' ' + (p[0] === 'hold' ? 'N' : p[0] === 'dwell' ? 's' : 'm/s'));
      });
      var h = firmwareHalt(inst);
      if (h) lines.push('HALT on ' + h.label.toLowerCase() + ': ' + h.msg);
      return lines;
    },
    readouts: function (built) {
      var j = built.joint, B = built.hook;
      return [
        { key: 'tension', label: 'line tension', q: 'force', read: function () { return built.tension(); } },
        { key: 'height', label: 'hook height', q: 'length', read: function () { return B.body.worldPoint(B.local).y; } }
      ];
    },
    draw: function (ctx, cam, built) {
      if (!built.halt) return;
      var a = cam.worldToScreen(built.joint.bodyA.worldPoint(built.joint.localAnchorA));
      ctx.save(); ctx.fillStyle = '#ff6b5a'; ctx.font = 'bold 13px "IBM Plex Mono", monospace';
      ctx.fillText('FIRMWARE HALT', a.x + 10, a.y - 8); ctx.restore();
    }
  });

})(globalThis.SE);
