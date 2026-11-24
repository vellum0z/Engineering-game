/*
 * P4 · Calibration Bench (manual project).
 *
 * Before the workshop fabricates the splice plate for the north bridge, every
 * instrument and setting on the bench is checked. The deliverables test
 * evaluating expressions with SI prefixes to 3 s.f., the rounding rule, and
 * carrying full precision through a calculation. The beyond-the-book factors
 * are the caliper's ±0.02 mm least count (how many figures a measured area
 * can honestly carry) and the millimetre a bolt hole has to be marked to,
 * which is finer than the usual 3 s.f.
 *
 * Every spec value is computed from the givens below; the hand check sits
 * next to each one.
 */
(function (SE) {
  'use strict';
  var B = SE.physics.bench;
  var rs = function (x, n, rule) { return SE.sigfig.roundSig(x, n, rule); };
  var MM = 1e-3;

  // ---------------------------------------------------------------- givens

  // 1. Punch-table feed. The table's lead screw is timed over a short jog.
  var JOG = 835e-6, JOG_T = 46.0e-3;          // 835 μm in 46.0 ms
  var FEED = JOG / JOG_T;
  // 835(10^-6) m / 46.0(10^-3) s = 18.152(10^-3) m/s  ->  18.2 mm/s
  var FAR_HOLE = 465 * MM;                     // last hole of the row, from the datum edge
  var HOLE_SLACK = 2.0 * MM;                   // 24 mm holes, 22 mm bolts: 2 mm of play

  // 2. Press ram area. Salvaged hydraulic cylinder, bore 127 mm.
  var BORE = 127 * MM;
  var RAM_A = Math.PI / 4 * BORE * BORE;
  // (127 mm)^2 = (0.127 m)^2 = 0.016 129 m^2 (mm^2 is (mm)^2 = 10^-6 m^2)
  // A = (π/4)(0.016 129) = 0.012 668 m^2  ->  12.7(10^-3) m^2
  var PUNCH_F = 483e3;                         // N to shear a 24 mm hole through the 16 mm plate
  var PUNCH_MARGIN = 1.15;                     // the controller aims 15 % over the punch force
  var FRAME_RATING = 750e3;                    // N, press frame

  // 3. Press frame stiffness, from a proof load on the frame.
  var PROOF_F = 0.472e6, PROOF_D = 1.86 * MM;  // 0.472 MN opened the jaws 1.86 mm
  var FRAME_K = PROOF_F / PROOF_D;
  // 0.472(10^6) N / 1.86(10^-3) m = 0.253 76(10^9) N/m = 253.76(10^6) N/m  ->  254 MN/m
  var OVERTRAVEL = 2.0 * MM;                   // set punch overtravel past the plate's underside
  var SLUG_MIN = 0.8 * MM, DIE_RELIEF = 4.0 * MM;

  // 4-5. Rounding. The yard crew cuts the scaffold boards to 3 s.f. with
  // whatever rule your answers show. Board pile = bench seed 23 (30 boards).
  var PILE = { mode: 'fence', seed: 23, boards: 30, fiveFrac: 0.6, label: 'scaffold walk' };
  var BOARD_EVEN = 2.065;                      // board 3 of the pile
  // 2.065 -> keep 2.06, dropped digit exactly 5, preceding 6 is even -> 2.06 m
  var BOARD_ODD = 2.375;                       // board 11 of the pile
  // 2.375 -> keep 2.37, dropped digit exactly 5, preceding 7 is odd -> 2.38 m

  // 6. Crane stay bolt. The crane that lifts the splice plate has a new stay.
  var CRANE = { h: 3.92, r: 7.26, bays: 9, k: 7 };
  var chain = B.chainError(B.craneSteps(), { n: 3, rule: 'book', inputs: CRANE });
  var STAY = chain.exact, STAY_CHAIN = chain.rounded;
  // h^2 = 15.3664, r^2 = 52.7076, L^2 = 68.0740, L = 8.250 697 m
  // bay = L/9 = 0.916 744 m, s = 7 bays = 6.417 209 m  ->  6.417 m (to the mm)
  // Rounding every step to 3 s.f.: 15.4, 52.7, 68.1, 8.25, 0.917, 6.42 m:
  // 2.8 mm long, and the hole only has ±0.5 mm of play.
  var CHAIN_RIG = { mode: 'chain', h: CRANE.h, r: CRANE.r, bays: CRANE.bays, k: CRANE.k, sf: 3, keep: 'round', clearance: 1 * MM, pinDia: 25 * MM, markRes: 1 * MM, label: 'splice', hideKey: true };

  // 7. Splice plate area from the caliper (least count 0.02 mm).
  var PLATE = { mode: 'caliper', a: 112.463, b: 63.177, res: 0.02, label: 'splice plate', hideKey: true };
  var RA = B.vernierRead(PLATE.a, PLATE.res), RB = B.vernierRead(PLATE.b, PLATE.res);
  var AREA = B.propagate('product', [RA.reading, RB.reading], [RA.res, RB.res]);
  var AREA_SF = B.sigFigsJustified(AREA.value, AREA.abs);
  // a = 112.46 mm, b = 63.18 mm, A = 7105.2228 mm^2
  // u/A = √((0.02/112.46)^2 + (0.02/63.18)^2) = √(3.163e-8 + 1.002e-7) = 3.63e-4
  // u = 2.58 mm^2 -> 3 mm^2: the units place is the last honest digit
  // -> A = 7105 mm^2, 4 s.f. (worst case ±3.5 mm^2 gives the same place)

  // ------------------------------------------------------------- helpers

  function mm(x, d) { return (x * 1000).toFixed(d == null ? 2 : d) + ' mm'; }
  function signedMm(x, d) { return (x >= 0 ? '+' : '−') + mm(Math.abs(x), d); }
  function fmt(x, n) { return rs(x, n || 3).text; }
  function bang(ctx, hard) {
    if (!ctx.stage) return;
    ctx.stage.shake(hard ? 12 : 6);
    if (hard) ctx.stage.flash('rgba(160,30,20,ALPHA)', 0.3, 0.3);
    SE.audio && SE.audio.play(hard ? 'crash' : 'clang');
  }
  function unread() { return 'Nothing to load into the bench: the figure could not be read as a number with units.'; }

  // Which rounding rule produces the digits the player wrote?
  function ruleFor(reading, si) {
    if (si == null) return null;
    var hit = null;
    B.RULES.forEach(function (rule) {
      if (!hit && Math.abs(rs(reading, 3, rule).value - si) < 1e-9) hit = rule;
    });
    return hit;
  }

  var RULE_TALK = {
    book: 'the course rule (exact 5: an even digit stays, an odd one goes up)',
    up: '"always round a 5 up"',
    truncate: '"just drop the extra digit"'
  };

  function buildScaffold(ctx, reading, si) {
    var rule = ruleFor(reading, si);
    if (!rule) return Promise.resolve(si == null ? unread() : 'Your figure is not any rounding of ' + reading.toFixed(3) + ' m to 3 s.f., so the crew can\'t tell which rule to cut the pile with. They wait.');
    var s = ctx.setScene('bench', PILE);
    return s.run({ rule: rule }).then(function (r) {
      var d = r.detail, head = 'The crew cut all ' + d.boards + ' boards using ' + RULE_TALK[rule] + ' and laid the walk end to end: cut total ' + d.total.toFixed(3) + ' m against ' + d.trueTotal.toFixed(3) + ' m of post spacing (' + signedMm(d.drift, 0) + ').';
      if (r.outcome === 'sealed') return head + ' The last board lands on the end post. Walkway sealed.';
      if (r.outcome === 'jammed') return head + ' Every exact 5 rounded up, so the boards ran long and the last one had to be hammered in. The end post split.';
      return head + ' Every dropped digit was lost, so the boards came up short and left a ' + mm(d.gap, 0) + ' gap at the end post. Wide enough for a hand. Then an arm.';
    });
  }

  // ------------------------------------------------------------- project

  SE.content.registerProject('ch01', {
    id: 'P4', order: 4,
    title: 'Calibration Bench',
    subtitle: 'Every digit before the steel',

    brief: [
      'The north bridge needs a **splice plate**: a slab of salvaged steel bolted across the cracked girder, through holes that already exist in the old flange. If the new holes are off, the bolts won\'t go through, and we don\'t get a second plate.',
      'So before anyone touches the steel, the workshop recalibrates everything on the bench: the punch table, the hydraulic press, the crane that lifts the plate, the caliper, and the rounding habits of whoever writes the numbers down. The bench controller takes your figures exactly as written. Get a prefix wrong and it punches a hole in the wrong county.',
      'Report each figure to three significant figures with a single SI prefix (in the numerator), unless the work order says otherwise. — *Juno*'
    ].join('\n\n'),

    conditions: [
      'Punch-table jog test: the lead screw moved the table **835 μm** in **46.0 ms**. Holes are 24 mm for 22 mm bolts; the last hole in the row is 465 mm from the datum edge.',
      'Press: salvaged cylinder with a **127 mm** bore. A 24 mm hole through this 16 mm plate takes **483 kN**; the controller aims 15 % over that. Frame rated 750 kN.',
      'Frame proof test: **0.472 MN** on the jaws opened them **1.86 mm**. The punch is set to break 2.0 mm past the plate; under 0.8 mm the slug hangs, past 4.0 mm it hits the die block.',
      'Scaffold boards are read to the millimetre and cut to **3 s.f.**: board 3 reads **2.065 m**, board 11 reads **2.375 m**.',
      'Crane stay: boom tip **3.92 m** up and **7.26 m** out from the heel pin, 9 equal bays, stay bolted at node 7. Hole clearance 1.0 mm; the fitter marks to the **nearest millimetre**.',
      'Caliper least count **0.02 mm**, so every reading is ±0.02 mm. The splice plate reads **112.46 mm × 63.18 mm**.'
    ],

    scene: { type: 'bench', params: PILE },
    controls: ['rule', 'fiveFrac'],
    rigText: 'The yard rig cuts a pile of 30 boards with one rounding rule and builds them end to end between posts set at the true lengths. Below it, two practice rigs use a different plate and crane from the job, so you can see how the caliper and the stay sheet behave.',
    rigActions: [
      {
        label: 'Build the walk with the selected rule',
        run: function (ctx) {
          if (ctx.sceneType !== 'bench' || ctx.scene.p.mode !== 'fence') ctx.setScene('bench', PILE);
          return ctx.scene.run({}).then(function (r) { return 'Rule ' + r.detail.rule + ': ' + r.outcome + ', drift ' + signedMm(r.detail.drift, 0) + '.'; });
        }
      },
      {
        label: 'Practice: caliper on a gauge plate',
        run: function (ctx) {
          return ctx.setScene('bench', { mode: 'caliper', a: 48.367, b: 21.142, res: 0.02, label: 'gauge plate' }).run({}).then(function (r) {
            return 'Gauge plate: ' + r.detail.a.toFixed(2) + ' × ' + r.detail.b.toFixed(2) + ' mm, ±' + fmt(r.detail.abs, 2) + ' mm² → ' + r.detail.sf + ' s.f. justified.';
          });
        }
      },
      {
        label: 'Practice: stay sheet on the old crane',
        run: function (ctx) {
          var s = ctx.setScene('bench', { mode: 'chain', h: 4.37, r: 6.85, bays: 7, k: 5, keep: 'round', label: 'crate' });
          return s.run({ keep: 'round' }).then(function (r) { return 'Rounded at every step: ' + r.outcome + ' (' + signedMm(r.detail.error, 1) + '). Try it again with full precision on the sliders.'; });
        }
      }
    ],

    lockedTools: ['sigfig', 'converter'],

    deliverables: [
      {
        id: 'P4.feed',
        label: '**Punch-table feed rate**: the table\'s speed from the jog test, $\\frac{835\\u{ μm}}{46.0\\u{ ms}}$.',
        placeholder: 'e.g. 4.21 mm/s',
        spec: { value: FEED, unit: 'm/s', sf: 3, form: 'si' },
        answer: '18.2 mm/s',
        wrong: [
          { input: '18.2 m/s', kind: 'prefix' },
          { input: '18.2 μm/ms', kind: 'form' },
          { input: '18.15 mm/s', kind: 'sigfig' }
        ],
        hints: [
          'Turn each prefix into a power of ten before you divide. Micro is 10⁻⁶, milli is 10⁻³.',
          'Work in base units: 835(10⁻⁶) m over 46.0(10⁻³) s. Divide the numbers and subtract the exponents, then pick one prefix for the result. It has to sit in the numerator: mm/s, not μm/ms.',
          '835 ÷ 46.0 = 18.15…, and 10⁻⁶ / 10⁻³ = 10⁻³. So the speed is 18.15…(10⁻³) m/s. Now name that with a prefix and round.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null) return unread();
          // The controller runs the table for t = D / v_entered; the table
          // really moves at the true speed, so it stops at v_true * t.
          var stop = FEED * FAR_HOLE / a.si, off = stop - FAR_HOLE;
          var fits = Math.abs(off) <= HOLE_SLACK;
          var msg = 'For the last hole the controller ran the table for ' + fmt(FAR_HOLE / a.si) + ' s. At its real speed of ' + fmt(FEED * 1000, 4) + ' mm/s it travelled ' + (Math.abs(stop) < 100 ? mm(stop, 1) : fmt(stop) + ' m') + ' instead of 465.0 mm (' + (Math.abs(off) < 1 ? signedMm(off, 2) : fmt(off) + ' m') + ').';
          if (fits) {
            SE.audio && SE.audio.play('stamp');
            return msg + ' The 22 mm bolt drops through both holes with ' + mm(HOLE_SLACK - Math.abs(off), 1) + ' to spare.' + (Math.abs(off) > 0.5 * MM ? ' Notice how much of the 2 mm of play a three-figure feed already used up over 465 mm. A controller deserves more digits than a report does.' : '');
          }
          bang(ctx, Math.abs(off) > 0.05);
          return msg + (Math.abs(off) > 1 ? ' The table hit its end stop and the punch came down on the bench rail.' : ' The new hole and the flange hole overlap by less than the bolt. The bolt won\'t go.');
        }
      },
      {
        id: 'P4.ram',
        label: '**Press ram area**: $A = \\frac{\\pi}{4}(127\\u{ mm})^{2}$, in square metres.',
        placeholder: 'e.g. 5.21(10^-3) m^2',
        spec: { value: RAM_A, unit: 'm^2', sf: 3, form: 'si' },
        answer: '12.7(10^-3) m^2',
        wrong: [
          { input: '12.7 m^2', kind: 'prefix' },
          { input: '0.0127 m^2', kind: 'form' },
          { input: '16.1(10^-3) m^2', kind: 'algebra' }
        ],
        hints: [
          'The exponent squares the prefix as well as the number: mm² means (mm)².',
          'Write the bore in metres first, 0.127 m, then square it and multiply by π/4. A square metre takes no prefix, so keep the number between 0.1 and 1000 with engineering notation: a power of ten that is a multiple of 3.',
          '(0.127 m)² = 0.016 129 m². Times π/4 that is 0.012 67 m², which needs writing as something(10⁻³) m².'
        ],
        consequence: function (ctx, a) {
          if (a.si == null || !(a.si > 0)) return unread();
          // The controller sets the relief pressure from your area; the ram
          // then pushes with that pressure on its true area.
          var p = PUNCH_MARGIN * PUNCH_F / a.si, F = p * RAM_A;
          var msg = 'The controller set the relief valve to ' + fmt(p / 1e6) + ' MPa, and on the real ram that pushes ' + fmt(F / 1000) + ' kN.';
          if (F < PUNCH_F) { bang(ctx, false); SE.audio && SE.audio.play('stall'); return msg + ' That is short of the 483 kN the plate needs: the punch stalls halfway into the steel and has to be jacked back out.'; }
          if (F > FRAME_RATING) { bang(ctx, true); return msg + ' The frame is rated 750 kN. It cracks at the throat before the punch even reaches the plate.'; }
          SE.audio && SE.audio.play('thud');
          return msg + ' Enough to shear the hole (483 kN) and well inside the frame\'s 750 kN. The slug drops out clean.';
        }
      },
      {
        id: 'P4.frame',
        label: '**Press frame stiffness**: $k = \\frac{0.472\\u{ MN}}{1.86\\u{ mm}}$.',
        placeholder: 'e.g. 3.12 MN/m',
        spec: { value: FRAME_K, unit: 'N/m', sf: 3, form: 'si' },
        answer: '254 MN/m',
        wrong: [
          { input: '254 kN/mm', kind: 'form' },
          { input: '0.254 MN/m', kind: 'prefix' },
          { input: '253.8 MN/m', kind: 'sigfig' }
        ],
        hints: [
          'Mega over milli. Turn both prefixes into powers of ten and the result will need a prefix of its own.',
          '0.472(10⁶) N over 1.86(10⁻³) m: divide 0.472 by 1.86 and combine 10⁶ / 10⁻³ = 10⁹. Then choose the prefix that puts the number between 0.1 and 1000, in the numerator.',
          '0.472 / 1.86 = 0.2538, so k = 0.2538(10⁹) N/m = 253.8(10⁶) N/m.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null || !(a.si > 0)) return unread();
          // The frame springs open by F/k under the punch load; the ram is
          // driven F/k_entered further to make up for it.
          var stretch = PUNCH_F / FRAME_K, comp = PUNCH_F / a.si, over = OVERTRAVEL + comp - stretch;
          var msg = 'At 483 kN the frame really opens ' + mm(stretch) + '. Your stiffness made the controller add ' + (comp < 1 ? mm(comp) : fmt(comp) + ' m') + ' of extra stroke, so the punch tip finished ' + (Math.abs(over) < 1 ? mm(over) : fmt(over) + ' m') + ' past the underside of the plate.';
          if (over < SLUG_MIN) { bang(ctx, false); return msg + ' Not far enough: the slug is left hanging by a ring of torn steel, and the hole is out of round.'; }
          if (over > DIE_RELIEF) { bang(ctx, true); return msg + ' The die relief is only 4.0 mm. The punch bottomed on the die block and shattered.'; }
          SE.audio && SE.audio.play('thud');
          return msg + ' Between 0.8 and 4.0 mm: a clean break-through.';
        }
      },
      {
        id: 'P4.round-even',
        label: '**Cut list, board 3**: round the reading **2.065 m** to three significant figures.',
        placeholder: 'e.g. 1.23 m',
        spec: { value: BOARD_EVEN, unit: 'm', sf: 3, form: 'any', exactRounding: true },
        answer: '2.06 m',
        wrong: [
          { input: '2.07 m', kind: 'rounding' },
          { input: '2.065 m', kind: 'sigfig' }
        ],
        hints: [
          'The digit you are dropping is exactly 5, with nothing after it. That is the one case where the plain "5 goes up" habit is not the course rule.',
          'For an exact 5, look at the digit before it. Even: leave it alone. Odd: round it up. Over a big cut list this sends half the exact 5s up and half down, so the errors cancel.',
          'Keep 2.06, drop 5. The 6 is even.'
        ],
        consequence: function (ctx, a) { return buildScaffold(ctx, BOARD_EVEN, a.si); }
      },
      {
        id: 'P4.round-odd',
        label: '**Cut list, board 11**: round the reading **2.375 m** to three significant figures.',
        placeholder: 'e.g. 1.23 m',
        spec: { value: BOARD_ODD, unit: 'm', sf: 3, form: 'any', exactRounding: true },
        answer: '2.38 m',
        wrong: [
          { input: '2.37 m', kind: 'rounding' },
          { input: '2.375 m', kind: 'sigfig' }
        ],
        hints: [
          'Again the dropped digit is exactly 5. Check the digit in front of it.',
          'Even digit before an exact 5: it stays. Odd digit: it goes up by one.',
          'Keep 2.37, drop 5. The 7 is odd.'
        ],
        consequence: function (ctx, a) { return buildScaffold(ctx, BOARD_ODD, a.si); }
      },
      {
        id: 'P4.stay',
        label: '**Crane stay bolt**: distance from the heel pin along the boom to node 7, $s = \\frac{7}{9}\\sqrt{h^{2} + r^{2}}$, **to the nearest millimetre**.',
        placeholder: 'e.g. 5.804 m',
        spec: {
          value: STAY, unit: 'm', sf: 4, form: 'any', tol: 0.5 * MM / STAY,
          mistakes: [{
            test: function (r) { return Math.abs(r * STAY - STAY_CHAIN) < 0.6 * MM; },
            kind: 'rounding',
            msg: 'That is the position you get by rounding every intermediate step to 3 s.f. Each rounding is small, but they pile up: carry full precision through and round once, at the end.'
          }]
        },
        answer: '6.417 m',
        wrong: [
          { input: '6.420 m', kind: 'rounding' },
          { input: '6.42 m', kind: 'rounding' },
          { input: '6.417 mm', kind: 'prefix' }
        ],
        hints: [
          'A millimetre on a length of a few metres is the fourth significant figure, so the usual three won\'t do here. And the only rounding allowed is the last one.',
          'Boom length first: L = √(h² + r²). One bay is L/9, and node 7 is seven bays out. Keep every digit your calculator gives you until the very end.',
          'h² + r² = 15.3664 + 52.7076 = 68.0740, so L = 8.250 70 m. Now 7 × L / 9.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null) return unread();
          var s = ctx.setScene('bench', CHAIN_RIG);
          // The fitter drills where your figure says, marked to the nearest mm.
          var mark = Math.round(a.si / CHAIN_RIG.markRes) * CHAIN_RIG.markRes;
          s.chainMark = function () { return mark; };
          return s.run({ keep: 'round' }).then(function (r) {
            var d = r.detail;
            var where = 'Drilled at ' + mm(mark, 0) + '; the pin lands ' + signedMm(-d.error, 1) + ' from the hole centre (play ±0.5 mm).';
            if (r.outcome === 'fits') return where + ' The pin slides home and the stay takes up the boom.';
            return where + (Math.abs(mark - STAY_CHAIN) < 0.6 * MM ? ' That is exactly where the round-every-step sheet put it. Six small roundings, ' + mm(STAY_CHAIN - STAY, 1) + ' of error, and the pin won\'t go.' : ' The pin jams against the edge of the hole.');
          });
        }
      },
      {
        id: 'P4.area',
        label: '**Splice plate area** from the caliper readings, written to **only the figures the ±0.02 mm caliper justifies**.',
        placeholder: 'e.g. 1234 mm^2',
        spec: { value: AREA.value * MM * MM, unit: 'm^2', sf: AREA_SF, form: 'any' },
        answer: '7105 mm^2',
        wrong: [
          { input: '7105.2 mm^2', kind: 'sigfig' },
          { input: '7.11(10^3) mm^2', kind: 'sigfig' },
          { input: '7106 mm^2', kind: 'rounding' }
        ],
        hints: [
          'Each side is only known to ±0.02 mm, so the area is only known to some ± too. Work that out first, then decide how many digits of the area mean anything.',
          'For a product, relative uncertainties combine: u_A/A = √((0.02/112.46)² + (0.02/63.18)²). Multiply by A to get u_A, round u_A to one figure, and keep the area\'s digits down to that decimal place. (Even the worst case, where the two relative errors simply add, lands in the same place.)',
          'A = 112.46 × 63.18 = 7105.2228 mm². u_A/A ≈ 3.6(10⁻⁴), so u_A ≈ 2.6 mm², about ±3 mm². Which place does that make the last honest digit?'
        ],
        consequence: function (ctx, a) {
          var n = a.result && a.result.sigfigCount && !a.result.sigfigCount.ambiguous ? a.result.sigfigCount.min : null;
          var s = ctx.setScene('bench', PLATE);
          return s.run(n == null ? {} : { sf: n }).then(function (r) {
            var d = r.detail;
            var base = 'Measured ' + d.a.toFixed(2) + ' × ' + d.b.toFixed(2) + ' mm = ' + fmt(d.area, 8) + ' mm², ±' + fmt(d.abs, 2) + ' mm² (worst case ±' + fmt(d.worstAbs, 2) + ').';
            if (r.outcome === 'justified') return base + ' ' + n + ' figures is exactly what the caliper supports. The inspector stamps the plate.';
            if (r.outcome === 'overclaimed') return base + ' You wrote ' + n + ' figures, but the last of them is inside the caliper\'s own noise. Measure the same plate again and it changes. The inspector won\'t stamp a number the instrument can\'t back.';
            if (r.outcome === 'underclaimed') return base + ' You wrote only ' + n + ' figures, throwing away a digit the caliper really did measure. Here that is a units-place digit the bolt-group check needs.';
            return base;
          });
        }
      }
    ],

    deeper: [
      '**Uncertainty propagation.** A ±0.02 mm least count on both sides of the plate gives the area an uncertainty of about ±3 mm², so it carries 4 significant figures: not the book\'s default 3, and not the 8 the calculator shows.',
      '**Marking resolution.** A bolt hole has to be placed to the millimetre. On a 6 m boom that is a fourth significant figure, so the 3 s.f. convention for reported answers is not enough for a fabrication drawing.',
      '**Rounding early.** Rounding each step of the stay sheet to 3 s.f. moved the bolt 2.8 mm, more than five times the hole\'s play. The same 3 s.f. feed rate used up over half of the punch table\'s 2 mm of play across 465 mm.',
      '**Rounding bias.** Over a 30-board pile, "always round 5 up" overran the posts by 83 mm and truncating left a 147 mm gap. The course rule, which sends exact 5s to the even digit, came out 13 mm long.'
    ],

    debrief: [
      'The bench is calibrated. The punch table, the press and the crane all run on figures you gave them, and the splice plate went up with every bolt home.',
      'Two habits did the work. Convert prefixes to powers of ten, calculate, then name the answer with **one** prefix in the numerator. And keep every digit until the last line: the rounding goes on the report, never in the middle of the sum.',
      'The other lesson is the caliper\'s. A number is only as good as the instrument behind it, and the honest number of figures comes from the uncertainty, not from habit.'
    ].join('\n\n')
  });
})(globalThis.SE);
