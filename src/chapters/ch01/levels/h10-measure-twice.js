/*
 * H10 · Measure Twice: significant figures, engineering notation, the
 * rounding rules (including the exact-5 case) and why intermediate results
 * keep full precision. Course section 1.5 (numerical calculations).
 *
 * Played in the build yard. Two jobs, both judged by the simulation:
 *   - the east palisade: six boards cut from a list and laid end to end
 *     between posts set at the true lengths. Rounding drift opens a gap at
 *     the end post, or leaves the last board with nowhere to lie.
 *   - the lookout mast boom: a stay hole drilled where the player says,
 *     then the boom is lowered onto its pins. Rounding every line of the
 *     sheet puts the hole 30 mm off and the boom sits up on the stay pin.
 *
 * Both mechanisms are parts of this level (h10-fence, h10-boom), defined at
 * the bottom of this file, because each needs its pieces laid out from the
 * typed numbers: a board pile that butts each board against the last, and a
 * boom on a vertical slide with its holes cut as slots in its underside.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals;
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  var cm = function (m) { return (m * 100).toFixed(1); };

  /*
   * The palisade. Each board was read off the tape to the millimetre (four
   * figures); the saw only stops on whole centimetres (three figures).
   *   reading   course rule   always up   chop      clerk (2 s.f.)
   *   1245 mm   1.24 m        1.25        1.24      1200 mm
   *   1375 mm   1.38 m        1.38        1.37      1400 mm
   *   1432 mm   1.43 m        1.43        1.43      1400 mm
   *   1165 mm   1.16 m        1.17        1.16      1200 mm
   *   1288 mm   1.29 m        1.29        1.28      1300 mm
   *   1335 mm   1.34 m        1.34        1.33      1300 mm
   *   total     7.84 m        7.86 m      7.81 m    7.80 m     (posts: 7.840 m)
   * Four of the six readings end in an exact 5. The course rule sends two up
   * and two down, so the run closes exactly; always-up overruns by 2 cm and
   * chopping leaves a 3 cm gap. A single 5 rounded the wrong way is 1 cm out.
   */
  var READINGS = [1.245, 1.375, 1.432, 1.165, 1.288, 1.335];
  var BOOK = ['1.24 m', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.34 m'];
  var UP = ['1.25 m', '1.38 m', '1.43 m', '1.17 m', '1.29 m', '1.34 m'];
  var CHOP = ['1.24 m', '1.37 m', '1.43 m', '1.16 m', '1.28 m', '1.33 m'];
  var CLERK = ['1200 mm', '1400 mm', '1400 mm', '1200 mm', '1300 mm', '1300 mm'];
  var GAP_OK = 0.005;                              // m: tighter than this and nothing gets through

  function cuts(list) { var d = {}; list.forEach(function (t, i) { d['b' + (i + 1)] = t; }); return d; }

  var FENCE_SITE = { g: 9.81, floor: 'concrete' };
  function fenceDesign(list) {
    return { parts: [{ id: 'fence', type: 'h10-fence', x: 0, y: 0, dials: cuts(list), locked: true, open: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], label: 'east palisade' }] };
  }
  var FENCE = {
    site: FENCE_SITE,
    camera: { fit: { lo: { x: -0.8, y: -0.6 }, hi: { x: 8.6, y: 1.6 } } },
    poke: false,
    readouts: ['fence.gap', 'fence.flat'],
    design: fenceDesign(CLERK)
  };

  // The fence settles in about three seconds. Pass when every board lies
  // flat and the end gap is shut; fail as soon as it has settled otherwise.
  function fenceGoal(s) {
    var f = s.part('fence');
    if (!f) return { fail: 'The palisade is missing.' };
    if (s.t < 1.5) return null;
    var st = f.status(), settled = s.held('fence:settled', st.still, 1);
    if (!settled) return s.t > 12 ? { fail: 'The boards never settled.' } : null;
    if (st.notFlat.length) return { fail: (st.notFlat.length > 1 ? 'Boards ' : 'Board ') + st.notFlat.map(function (i) { return i + 1; }).join(', ') + ' won\'t lie flat: the run is **' + cm(-st.gap) + ' cm** too long for the posts, so the last board rides up on the end post.' };
    if (st.gap > GAP_OK) return { fail: 'A **' + cm(st.gap) + ' cm** gap at the end post. Wide enough for a hand, and whatever is attached to it.' };
    return 'pass';
  }

  /*
   * The lookout mast's raking boom: tip 3.53 m up and 6.78 m out from the
   * heel pin, laced in 6 bays, stay at node 5. Full precision:
   *   h² = 12.4609   r² = 45.9684   L² = 58.4293   L = 7.643906 m
   *   bay = L/6 = 1.273984 m        s = 5 bays = 6.369922 m  ->  6.37 m (3 s.f.)
   * Rounding every line to 3 s.f.:
   *   12.5, 46.0, 58.5, 7.65, 1.28, 6.40 m   (30.1 mm long)
   * The stay plate is slotted with 12 mm of play (±6 mm), so a correctly
   * rounded final answer (0.08 mm out) seats and the step-rounded one doesn't.
   */
  var MAST = { rise: '3.53 m', reach: '6.78 m', bays: '6', node: '5' };
  var MAST_S = 5 / 6 * Math.sqrt(3.53 * 3.53 + 6.78 * 6.78);   // 6.369922 m
  // The sheet line by line, at full precision or rounded to n figures each line.
  function sheet(n) {
    var r = function (x) { return n ? SE.sigfig.roundSig(x, n, 'book').value : x; };
    var h2 = r(3.53 * 3.53), r2 = r(6.78 * 6.78), L2 = r(h2 + r2), L = r(Math.sqrt(L2)), bay = r(L / 6), s = r(5 * bay);
    return { h2: h2, r2: r2, L2: L2, L: L, bay: bay, s: s };
  }
  var BOOM_SITE = { g: 9.81, floor: 'concrete' };
  function boomDesign(hole) {
    return { parts: [{ id: 'boom', type: 'h10-boom', x: 0.5, y: 0.6, dials: Object.assign({ hole: hole, play: '12 mm' }, MAST), locked: true, open: ['hole'], label: 'mast boom' }] };
  }
  var BOOM = {
    site: BOOM_SITE,
    camera: { fit: { lo: { x: -0.4, y: -0.4 }, hi: { x: 8.8, y: 2.4 } } },
    poke: false,
    readouts: ['boom.offset', 'boom.lift'],
    design: boomDesign('6.40 m')
  };
  function boomGoal(s) {
    var b = s.part('boom');
    if (!b) return { fail: 'The boom is missing.' };
    if (s.t < 0.5) return null;
    var st = b.status();
    if (!s.held('boom:still', st.still, 0.75)) return s.t > 8 ? { fail: 'The boom never came to rest.' } : null;
    if (st.lift > 0.005) return { fail: 'The boom is sitting **' + f3(st.lift * 1000) + ' mm** up on the stay pin. The hole is **' + f3(Math.abs(st.offset) * 1000) + ' mm** ' + (st.offset > 0 ? 'too far out' : 'too far in') + ', and the slot only gives ±' + f3(b.play * 500) + ' mm.' };
    return 'pass';
  }

  SE.content.registerLevel('ch01', {
    id: 'H10', order: 10, title: 'Measure Twice',
    subtitle: 'Significant figures, rounding and honest numbers',
    sections: ['1.5'],
    minutes: 25,
    intro: [
      'The measuring bench is a door laid over two oil drums, a steel tape, a caliper in a velvet box nobody remembers stealing, and Hask.',
      '"A number on a cut list is a promise about how well we know something. Write too few figures and the wall has gaps. Write too many and you\'re lying. Round the wrong way, a little at a time, and the dead walk through the hole you made with arithmetic."'
    ].join('\n\n'),
    goals: [
      'Count significant figures, including leading and trailing zeros',
      'Write any result unambiguously in engineering notation (powers of 10³)',
      'Round to 3 s.f. with the course rules, including the exact-5 case',
      'Keep full precision through a calculation and round only the final answer'
    ],
    unlocks: { tools: ['sigfig'], formulas: ['ch01.sigfigs', 'ch01.rounding'] },
    yard: FENCE,
    // Reference builds for the scored jobs (checked by tests/yard.test.js).
    solutions: {
      'H10.fence': [
        { set: { fence: cuts(BOOK) } },
        { pass: false, set: { fence: cuts(UP) } },
        { pass: false, set: { fence: cuts(CHOP) } },
        { pass: false, set: { fence: cuts(['1.25 m', '1.38 m', '1.43 m', '1.16 m', '1.29 m', '1.34 m']) } },
        { pass: false, set: { fence: cuts(['1.245 m', '1.375 m', '1.432 m', '1.165 m', '1.288 m', '1.335 m']) } }
      ],
      'H10.boom': [
        { set: { boom: { hole: '6.37 m' } } },
        { set: { boom: { hole: '6370 mm' } } },
        { pass: false, set: { boom: { hole: '6.40 m' } } },
        { pass: false, set: { boom: { hole: '6.36 m' } } },
        { pass: false, set: { boom: { hole: '6.4 m' } } }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Juno wants the east palisade rebuilt by dark: six salvaged boards, end to end between two posts we already set. The posts went in at the **true** board lengths, read off the tape to the millimetre. The boards get cut from a list.\n\nThe saw\'s stops are every **centimetre**, so it can only cut to three figures: 1.24 m, 1.25 m, never 1.245 m. Before anything gets cut, you and I are going to agree on what a number on that list actually *says*.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { design: FENCE.design, goal: G.after(4) },
        text: 'Here is the list the clerk wrote out. Select the palisade to see it: the tape said **1245 mm** for board 1, and he tidied it to **1200 mm**. "The zeros are just filler," he says.\n\nThe saw doesn\'t know that. Press **▶ Run** and watch the end post (the inset on the right).',
        goalText: 'Build the palisade from the clerk\'s list',
        until: function (ctx, type) { return type === 'result' && !!ctx.result; },
        after: function (ctx) { var st = ctx.result.state.part('fence').status(); return 'The saw cut **1200 mm** as exactly 1.200 m, and the boards closed up with a **' + cm(st.gap) + ' cm** gap at the end post. Read cold, "1200 mm" could mean two, three or four figures, and the saw took it as four.'; }
      },
      {
        type: 'reveal', kicker: 'Rule', title: 'Significant figures and engineering notation',
        eq: '48\\u{ }600 \\quad \\to \\quad 48.6(10^{3}) \\quad \\t{or} \\quad 48.60(10^{3}) \\quad \\t{or} \\quad 48.600(10^{3})',
        text: [
          'The number of **significant figures** in a number is how accurately it is known.',
          '- Every nonzero digit counts: **7302** has four significant figures.',
          '- Trailing zeros on a **whole number** are ambiguous: **48 600** could have three, four or five. So could the clerk\'s 1200.',
          '- **Engineering notation** settles it. Round to the figures you mean, then write the number with a power of ten that is a **multiple of 3**: (10³), (10⁶), (10⁻³), (10⁻⁹). So 48 600 known to three figures is **48.6(10³)**; known to five it is **48.600(10³)**. A prefix does the same job: 48.6 kN, or **1.24 m** instead of 1240 mm.',
          '- Zeros at the **start** of a number less than one only place the decimal point, so they are not significant: **0.004 17** has three figures and is **4.17(10⁻³)**.'
        ].join('\n'),
        formula: 'ch01.sigfigs'
      },
      {
        type: 'build', who: 'hask',
        yard: { design: fenceDesign(CLERK), goal: G.after(4) },
        text: 'Give the saw three honest figures where it\'s easy. Board 3 read **1432 mm** and board 5 read **1288 mm**: the dropped digit is clearly below or above 5.\n\nSet board 3 to **1.43 m** and board 5 to **1.29 m**. Leave the rest for a moment.',
        goalText: 'Boards 3 and 5 cut to three figures',
        until: function (ctx) {
          var b3 = ctx.si('fence', 'b3'), b5 = ctx.si('fence', 'b5');
          if (Math.abs(b3 - 1.43) < 1e-9 && Math.abs(b5 - 1.29) < 1e-9) return true;
          if (Math.abs(b3 - 1.44) < 1e-9 || Math.abs(b5 - 1.28) < 1e-9) return 'Look at the digit you\'re dropping: 143**2** rounds down, 128**8** rounds up.';
          return false;
        },
        hint: 'Select the palisade, then type **1.43 m** into Board 3 and **1.29 m** into Board 5.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(4) },
        text: 'The other four all read **exactly on a 5**: 1245, 1375, 1165 and 1335 mm. Dead centre between two saw stops.\n\nMost people were taught to push a 5 up. Do that: set boards 1, 2, 4 and 6 to **1.25, 1.38, 1.17 and 1.34 m**, then Run.',
        goalText: 'Round all four 5s up, and run',
        until: function (ctx, type) {
          var want = { b1: 1.25, b2: 1.38, b4: 1.17, b6: 1.34 };
          var ok = Object.keys(want).every(function (k) { return Math.abs(ctx.si('fence', k) - want[k]) < 1e-9; });
          if (!ok) return false;
          return type === 'result' && !!ctx.result;
        },
        after: function (ctx) { var st = ctx.result.state.part('fence').status(); return 'Every exact 5 added half a centimetre and none took any away. The run is **' + cm(-st.gap) + ' cm** longer than the posts allow, so the last board has nowhere to lie and rides up on the end post.'; }
      },
      {
        type: 'reveal', kicker: 'Rule', title: 'Rounding off',
        text: [
          'Look at the first digit you are dropping:',
          '- **More than 5** (or a 5 with anything nonzero after it): round up. 6.417**8** → 6.42.',
          '- **Less than 5**: leave the last kept digit alone. 0.851**3** → 0.851.',
          '- **Exactly 5**: look at the digit before it. If it is **even**, leave it: 3.24**5** → 3.24. If it is **odd**, round up: 0.71**5** → 0.72 (to two figures), 13.7**5** → 13.8.',
          '',
          'Half the exact 5s go up and half go down, so a long run of them doesn\'t lean one way. The aim is a result no more and no less accurate than the data that went into it.'
        ].join('\n'),
        formula: 'ch01.rounding'
      },
      {
        type: 'job', id: 'H10.fence', who: 'juno',
        yard: { design: fenceDesign(UP), goal: fenceGoal },
        text: 'Juno wants the palisade **shut**: every board flat, no gap at the end post you could get a hand through.\n\nCut all six boards to **three figures** with the rounding rule. The tape readings are painted on each board: **1245, 1375, 1432, 1165, 1288 and 1335 mm**.',
        goalText: 'Six boards flat, end gap under 5 mm',
        goal: fenceGoal,
        timeout: 15,
        grade: { part: 'fence', key: 'b1', spec: { value: READINGS[0], unit: 'm', sf: 3, form: 'any', exactRounding: true } },
        hints: [
          'Only the four exact 5s are in question. For each, look at the digit **before** the 5.',
          '1245: the 4 is even, so it stays (1.24 m). 1375: the 7 is odd, so it goes up (1.38 m). Do the same for 1165 and 1335.',
          '**1.24, 1.38, 1.43, 1.16, 1.29, 1.34 m.** Two of the 5s went down and two went up, so they cancel.'
        ],
        onFail: function (ctx) {
          var f = ctx.result && ctx.result.state.part('fence');
          if (!f) return '';
          var sum = 0; for (var i = 1; i <= 6; i++) sum += ctx.si('fence', 'b' + i);
          return 'Your list adds up to **' + f3(sum) + ' m**. The posts are **7.84 m** apart.';
        },
        success: 'Shut tight. Two of the 5s went down and two went up, so the halves cancelled instead of piling up at the end post.'
      },
      {
        type: 'free', who: 'hask',
        yard: { design: fenceDesign(BOOK), goal: null },
        text: 'The palisade is yours. Cut it any way you like and run it again.',
        prompts: [
          'Chop every board instead (1.24, 1.37, 1.43, 1.16, 1.28, 1.33 m). Why is chopping always short?',
          'Type a tape reading straight in, **1.245 m**. Why won\'t the saw take it?',
          'Type **1.24(10^3) mm** for board 1. Is it the same cut as 1.24 m?'
        ]
      },
      {
        type: 'say', who: 'hask',
        text: 'One more trap, and it catches clever people. The lookout mast\'s raking boom needs a stay. Its tip sits **3.53 m** up and **6.78 m** out from the heel pin; the boom is laced in **6** equal bays and the stay bolts on at **node 5**.\n\nThe clerk\'s sheet works it out in six lines: square the rise and the reach, add them, take the root for the boom length, split it into bays, count along five. He rounds every line to three figures as he goes, "because three figures is what we report".'
      },
      {
        type: 'watch', who: 'hask',
        yard: { design: boomDesign('6.40 m'), camera: BOOM.camera, readouts: BOOM.readouts, goal: G.after(3) },
        text: 'His sheet says **6.40 m**, and that is where the stay hole is drilled. The stay plate is slotted, ±6 mm of play, which is generous.\n\nPress **▶ Run** to lower the boom onto its pins. The caliper inset shows the stay pin up close.',
        goalText: 'Lower the boom drilled at 6.40 m',
        until: function (ctx, type) { return type === 'result' && !!ctx.result; },
        after: function (ctx) { var st = ctx.result.state.part('boom').status(); return 'The caliper puts the hole **' + f3(st.offset * 1000) + ' mm** past the pin, against ±6 mm of play. The boom sits up on the stay pin, **' + f3(st.lift * 1000) + ' mm** off its rest.'; }
      },
      {
        type: 'rule', title: 'Round once, at the end',
        law: '\\t{full precision through the sheet, then } 3 \\t{ s.f.}',
        eq: function () {
          var a = sheet(0), b = sheet(3);
          return [
            '\\t{every line to 3 s.f.: } ' + f3(b.h2) + ' + ' + f3(b.r2) + ' = ' + f3(b.L2) + ',\\; \\sqrt{\\;} = ' + f3(b.L) + ',\\; \\div 6 = ' + f3(b.bay) + ',\\; \\times 5 = ' + f3(b.s) + '\\u{ m}',
            '\\t{full precision: } ' + a.h2.toFixed(4) + ' + ' + a.r2.toFixed(4) + ' = ' + a.L2.toFixed(4) + ',\\; \\sqrt{\\;} = ' + a.L.toFixed(6) + ',\\; s = ' + a.s.toFixed(6) + '\\u{ m}'
          ];
        },
        text: 'Each rounding is small. But every line of the sheet builds on the one before, so the nudges **compound**: six of them put the hole 30 mm out on a 6.4 m boom. The cure is not more careful rounding, it\'s **less**: keep full precision on every line (leave it in the calculator\'s memory) and round **only the final answer**.\n\nThree figures is still right for the answer. Most of the data, the geometry and the loads, can only be measured to about that, so more figures would claim accuracy you don\'t have.',
        formula: 'ch01.rounding'
      },
      {
        type: 'job', id: 'H10.boom', who: 'hask',
        yard: { design: boomDesign('6.40 m'), camera: BOOM.camera, readouts: BOOM.readouts, goal: boomGoal },
        text: 'Work it out again, full precision on every line: $s = \\frac{5}{6}\\sqrt{h^{2} + r^{2}}$ with h = 3.53 m and r = 6.78 m. Round only the final answer, to **3 s.f.**\n\nSelect the boom, type your answer into **Stay hole**, and lower it.',
        goalText: 'The boom seats on both pins',
        goal: boomGoal,
        timeout: 10,
        grade: { part: 'boom', key: 'hole', spec: { value: MAST_S, unit: 'm', sf: 3, form: 'any', exactRounding: true } },
        hints: [
          'Do the whole thing in one go on the calculator, or store each line in memory. Don\'t write down a rounded value and type it back in.',
          'h² + r² = 12.4609 + 45.9684 = 58.4293 m². Take the root for the boom length, divide by 6 for one bay, multiply by 5.',
          'L = 7.643 906 m, one bay = 1.273 984 m, s = 6.369 922 m, which is **6.37 m** to 3 s.f.'
        ],
        onFail: function (ctx) { var s = ctx.si('boom', 'hole'); return isFinite(s) ? 'Drilled at **' + f3(s * 1000) + ' mm** from the heel pin.' : ''; },
        success: 'Home on both pins. Same inputs and the same formula as the clerk; the only change was **when** the rounding happened.'
      },
      {
        type: 'free', who: 'hask',
        yard: { design: { parts: [Object.assign({}, boomDesign('6.37 m').parts[0], { open: ['hole', 'play', 'rise', 'reach', 'bays', 'node'] })] }, camera: BOOM.camera, readouts: BOOM.readouts, goal: null },
        text: 'The boom is yours now: change the rise, the reach, the bays, the node and the play in the slot, and drill where you like.',
        prompts: [
          'Close the slot down to **1 mm** of play. Does 6.37 m still seat? How many figures does the hole need now?',
          'Find a boom where rounding every line happens to land within the slot. Does that make it a safe habit?',
          'Drill the hole at **6370 mm**, then at **6.37(10^3) mm**. Same hole?'
        ]
      },
      {
        type: 'deeper', title: 'Banker\'s rounding, and why your computer does it too',
        teaser: 'The even-neighbour rule for exact 5s has a name outside the workshop, and it\'s the default in nearly every computer chip.',
        steps: [
          { type: 'say', who: 'hask', text: 'Round-half-to-even is often called **banker\'s rounding**, because banks summing millions of rounded amounts couldn\'t afford a rule that always nudges up. The floating-point standard that nearly every processor follows, **IEEE 754**, uses it as its default rounding mode for the same reason.' },
          { type: 'say', who: 'hask', text: 'Measure each rounding error in units of the last kept place. Always-up adds **+½** on every exact 5, so N of them drift by N/2 places. Half-to-even adds +½ after an odd digit and −½ after an even one; the digit before the 5 is odd about as often as it is even, so on average they cancel and what is left grows only like √N.\n\nChopping is worse again: it loses about half a place on **every** reading, 5 or not, so it drifts even when no reading ends in 5. You saw both on the palisade.' }
        ]
      },
      {
        type: 'summary',
        points: [
          'Significant figures say how accurately a number is known. Leading zeros never count; trailing zeros of a whole number are **ambiguous** (the clerk\'s 1200 mm).',
          'Use **engineering notation**, powers of ten in multiples of 3, or one prefix: 48.6(10³) vs 48.60(10³), 4.17(10⁻³), 1.24 m.',
          'Rounding: dropped digit **> 5** round up, **< 5** leave it. **Exactly 5**: even digit before it stays, odd goes up. That split kept six boards honest.',
          'Keep **full precision** through a calculation and round only the final answer, normally to **3 s.f.**: rounding every line of the boom sheet put the hole 30 mm out.'
        ]
      }
    ]
  });

  /* ================================================================ parts */

  var TIMBER = '#b98b55', TIMBER_DARK = '#7a5a34';

  // Inset magnifier: a box in a corner of the canvas showing the world
  // around `focus` at `mag` times the yard's zoom.
  function inset(ctx, cam, corner, focus, mag, title, paint) {
    var W = cam.width(), H = cam.height(), w = Math.min(260, W * 0.36), h = Math.min(170, H * 0.42), pad = 12;
    var x0 = corner === 'left' ? pad : W - w - pad, y0 = pad;
    var z = cam.zoom * mag;
    var map = function (p) { return { x: x0 + w / 2 + (p.x - focus.x) * z, y: y0 + h / 2 - (p.y - focus.y) * z }; };
    ctx.save();
    ctx.fillStyle = 'rgba(20,22,24,.92)'; ctx.fillRect(x0, y0, w, h);
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    paint(map, z);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(230,180,34,.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(230,180,34,.95)'; ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(title + '  ×' + mag, x0 + 6, y0 + 14);
    ctx.restore();
    return { x0: x0, y0: y0, w: w, h: h };
  }
  function polyAt(ctx, map, body, shape) {
    var vs = shape.vertices; if (!vs) return;
    ctx.beginPath();
    vs.forEach(function (v, i) { var p = map(body.worldPoint(v)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath();
  }
  function paintBodies(ctx, map, bodies, fill, stroke) {
    bodies.forEach(function (b) {
      b.fixtures.forEach(function (fx) { polyAt(ctx, map, b, fx.shape); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); });
    });
  }

  /*
   * h10-fence: a palisade run between two posts. The posts' inner faces are
   * `span` apart (the true board lengths added up), starting at the part's
   * x. Boards are cut to the typed lengths and laid end to end from the left
   * post, each dropped in from just above the post tops. If the run is too
   * long, the last board lands on the end post and can't lie flat; if it is
   * too short, a gap opens at the end post.
   *
   * The saw only stops on whole centimetres, so a cut between two stops
   * (1.245 m) is refused like any unreadable dial.
   */
  var POST_W = 0.14, POST_H = 0.5, BOARD_T = 0.1, SILL_T = 0.12;
  Y.definePart({
    type: 'h10-fence', name: 'Palisade run', category: 'Site', library: false,
    blurb: 'Six boards laid end to end between two posts. The saw stops every centimetre, so each cut is a whole number of cm.',
    size: { w: 8, h: 0.6 },
    dials: [1, 2, 3, 4, 5, 6].map(function (i) {
      return { key: 'b' + i, label: 'Board ' + i + ' cut', q: 'length', def: BOOK[i - 1], min: 0.1, max: 3 };
    }),
    build: function (b) {
      var P = b.P, x0 = b.inst.x, y0 = b.inst.y;
      var span = READINGS.reduce(function (a, v) { return a + v; }, 0);
      var L = [], i;
      for (i = 1; i <= 6; i++) {
        var v = b.si('b' + i), cm = v * 100;
        if (Math.abs(cm - Math.round(cm)) > 1e-6) {
          var lo = Math.floor(cm + 1e-9) / 100, hi = lo + 0.01;
          throw new Error('Board ' + i + ': ' + b.text('b' + i) + ' falls between two saw stops (' + f3(lo) + ' m and ' + f3(hi) + ' m). The saw only cuts on whole centimetres.');
        }
        L.push(Math.round(cm) / 100);
      }
      var sill = b.body({ type: 'static', position: { x: x0 + span / 2, y: y0 - SILL_T / 2 }, label: '',
        shapes: [{ shape: P.box(span / 2 + POST_W + 0.4, SILL_T / 2), material: 'timber' }] });
      var postL = b.body({ type: 'static', position: { x: x0 - POST_W / 2, y: y0 + POST_H / 2 }, label: 'post',
        shapes: [{ shape: P.box(POST_W / 2, POST_H / 2), material: 'timber' }] });
      var postR = b.body({ type: 'static', position: { x: x0 + span + POST_W / 2, y: y0 + POST_H / 2 }, label: 'end post',
        shapes: [{ shape: P.box(POST_W / 2, POST_H / 2), material: 'timber' }] });
      // Lay each board on the sill against the last one. A board that would
      // run past the end post can't go down between the posts, so it is
      // offered up from above and lands wherever the post lets it.
      var boards = [], x = x0, face = x0 + span;
      L.forEach(function (len, k) {
        var fits = x + len <= face + 0.0005;
        var y = fits ? y0 + BOARD_T / 2 + 0.001 : y0 + POST_H + 0.02 + BOARD_T / 2;
        boards.push(b.body({ position: { x: x + len / 2, y: y }, label: (READINGS[k] * 1000).toFixed(0) + ' mm',
          shapes: [{ shape: P.box(len / 2, BOARD_T / 2), material: 'timber' }], mass: 9 * len }));
        x += len;
      });
      function rightEnd(bd, len) { var c = Math.cos(bd.angle), s = Math.sin(bd.angle); return bd.c.x + Math.abs(c) * len / 2 + Math.abs(s) * BOARD_T / 2; }
      function status() {
        var notFlat = [], still = true, end = -Infinity;
        boards.forEach(function (bd, k) {
          var flat = Math.abs(bd.angle) < 0.004 && Math.abs(bd.c.y - (y0 + BOARD_T / 2)) < 0.004;
          if (!flat) notFlat.push(k);
          if (Math.hypot(bd.v.x, bd.v.y) > 0.01 || Math.abs(bd.w) > 0.01) still = false;
          end = Math.max(end, rightEnd(bd, L[k]));
        });
        // a board that won't lie flat has no end to measure from: report the planned overrun
        var gap = notFlat.length ? face - (x0 + L.reduce(function (a, v) { return a + v; }, 0)) : face - end;
        return { gap: gap, notFlat: notFlat, still: still, flat: boards.length - notFlat.length };
      }
      return { body: sill, bodies: [sill, postL, postR].concat(boards), boards: boards, lengths: L, posts: [postL, postR], sill: sill, face: face, x0: x0, y0: y0, status: status };
    },
    readouts: function (built) {
      return [
        { key: 'gap', label: 'end gap (− = too long)', q: 'length', read: function () { return built.status().gap; } },
        { key: 'flat', label: 'boards lying flat', q: 'number', read: function () { return built.status().flat; } }
      ];
    },
    draw: function (ctx, cam, built) {
      // the end post close up (each board's label is its tape reading)
      var st = built.status();
      var box = inset(ctx, cam, 'right', { x: built.face - 0.05, y: built.y0 + 0.1 }, 8, 'end post', function (map) {
        paintBodies(ctx, map, [built.sill], 'rgba(122,90,52,.8)', TIMBER_DARK);
        paintBodies(ctx, map, built.posts, 'rgba(122,90,52,.95)', TIMBER_DARK);
        paintBodies(ctx, map, built.boards, TIMBER, TIMBER_DARK);
        if (st.gap > 0.001 && !st.notFlat.length) {
          var a = map({ x: built.face - st.gap, y: built.y0 + BOARD_T }), c = map({ x: built.face, y: built.y0 });
          ctx.fillStyle = 'rgba(220,60,40,.35)'; ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
        }
      });
      ctx.save();
      ctx.fillStyle = st.notFlat.length || st.gap > GAP_OK ? '#ff8a6a' : '#9fe08a';
      ctx.font = 'bold 12px "IBM Plex Mono", monospace';
      ctx.fillText(st.notFlat.length ? 'last board won\'t lie flat' : 'gap ' + cm(st.gap) + ' cm', box.x0 + 6, box.y0 + 32);
      ctx.restore();
    }
  });

  /*
   * h10-boom: the raking boom laid on its rest to be offered up to the stay
   * plate. Its length comes from the rise and reach (L = √(h² + r²)), and
   * the stay pin stands at node/bays of L from the heel pin. The boom has a
   * slot cut in its underside for each pin: the heel slot is drilled right,
   * the stay slot goes where `hole` says. Each slot is the pin width plus
   * `play`. The boom runs on a vertical slide and is lowered by gravity: if
   * both slots are over their pins it seats on the rest, otherwise it sits
   * up on the stay pin.
   */
  var PIN_W = 0.024, PIN_H = 0.03, SLOT_D = 0.045, BOOM_T = 0.16, HEEL_OVER = 0.15;
  Y.definePart({
    type: 'h10-boom', name: 'Mast boom', category: 'Site', library: false,
    blurb: 'The lookout mast\'s raking boom on its rest. Drill the stay hole and lower it onto the heel and stay pins.',
    size: { w: 8, h: 0.4 },
    dials: [
      { key: 'hole', label: 'Stay hole, from heel pin', q: 'length', def: '6.37 m', min: 0.3 },
      { key: 'play', label: 'Slot play', q: 'length', def: '12 mm', min: 0.0005, max: 0.1 },
      { key: 'rise', label: 'Tip rise h', q: 'length', def: '3.53 m', min: 0.5, max: 8 },
      { key: 'reach', label: 'Tip reach r', q: 'length', def: '6.78 m', min: 0.5, max: 8 },
      { key: 'bays', label: 'Bays', q: 'number', def: '6', min: 1, max: 20 },
      { key: 'node', label: 'Stay at node', q: 'number', def: '5', min: 1, max: 20 }
    ],
    build: function (b) {
      var P = b.P, x0 = b.inst.x, y0 = b.inst.y;
      var L = Math.hypot(b.si('rise'), b.si('reach'));
      var bays = Math.round(b.si('bays')), node = Math.round(b.si('node'));
      if (node >= bays) throw new Error('The stay node has to be inside the boom: node ' + node + ' of ' + bays + ' bays is at the tip or past it.');
      var pinX = node / bays * L, hole = b.si('hole'), play = b.si('play');
      var slotW = PIN_W + play, total = L + 2 * HEEL_OVER;
      if (hole + slotW / 2 > L + HEEL_OVER - 0.05 || hole - slotW / 2 < slotW / 2 + 0.05) throw new Error('A stay hole at ' + b.text('hole') + ' would run into the heel slot or off the end of a ' + f3(L) + ' m boom.');
      // boom frame: origin at the heel pin, y = 0 on the underside
      var cuts = [[-slotW / 2, slotW / 2], [hole - slotW / 2, hole + slotW / 2]];
      var shapes = [], left = -HEEL_OVER;
      cuts.forEach(function (c) {
        if (c[0] > left) shapes.push({ shape: P.box((c[0] - left) / 2, BOOM_T / 2, { x: (left + c[0]) / 2, y: BOOM_T / 2 }), material: 'timber' });
        shapes.push({ shape: P.box((c[1] - c[0]) / 2, (BOOM_T - SLOT_D) / 2, { x: (c[0] + c[1]) / 2, y: SLOT_D + (BOOM_T - SLOT_D) / 2 }), material: 'timber' });
        left = c[1];
      });
      shapes.push({ shape: P.box((L + HEEL_OVER - left) / 2, BOOM_T / 2, { x: (left + L + HEEL_OVER) / 2, y: BOOM_T / 2 }), material: 'timber' });
      // the rest beam on two trestles standing on the yard floor
      var legH = Math.max(0.05, y0 - 0.12), legs = [-total / 2 + 0.3, total / 2 - 0.3].map(function (lx) {
        return { shape: P.box(0.05, legH / 2, { x: lx, y: -0.12 - legH / 2 }), material: 'steel' };
      });
      var rest = b.body({ type: 'static', position: { x: x0 + L / 2, y: y0 }, label: 'rest',
        shapes: [{ shape: P.box(total / 2 + 0.2, 0.06, { x: 0, y: -0.06 }), material: 'steel' }].concat(legs) });
      var pins = [0, pinX].map(function (px, k) {
        return b.body({ type: 'static', position: { x: x0 + px, y: y0 + PIN_H / 2 }, label: k ? 'stay pin' : 'heel pin', shapes: [{ shape: P.box(PIN_W / 2, PIN_H / 2), material: 'steel' }] });
      });
      var boom = b.body({ position: { x: x0, y: y0 + PIN_H + 0.05 }, label: b.inst.label || 'boom', fixedRotation: true, shapes: shapes, mass: 14 * L });
      b.joint(new P.PrismaticJoint({ bodyA: b.ground, bodyB: boom, worldAnchor: { x: x0, y: y0 + PIN_H + 0.05 }, worldAxis: { x: 0, y: 1 } }));
      function status() {
        var under = boom.worldPoint({ x: 0, y: 0 });
        return { lift: under.y - y0, offset: hole - pinX, still: Math.hypot(boom.v.x, boom.v.y) < 0.005 };
      }
      return { body: boom, bodies: [boom, rest].concat(pins), boom: boom, rest: rest, pins: pins, L: L, pinX: pinX, hole: hole, play: play, slotW: slotW, x0: x0, y0: y0, status: status };
    },
    readouts: function (built) {
      return [
        { key: 'offset', label: 'caliper: hole past pin', q: 'length', read: function () { return built.status().offset; } },
        { key: 'lift', label: 'height off the rest', q: 'length', read: function () { return Math.max(0, built.status().lift); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var st = built.status(), y0 = built.y0;
      // tick marks for the bays along the top of the boom
      ctx.save(); ctx.strokeStyle = 'rgba(240,225,190,.6)'; ctx.lineWidth = 1;
      var top = built.boom.worldPoint({ x: 0, y: BOOM_T });
      var bays = Math.round(Y.dial.parse(built.inst.dials.bays, 'number').si);
      for (var i = 0; i <= bays; i++) {
        var p = cam.worldToScreen({ x: top.x + i / bays * built.L, y: top.y });
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 6); ctx.stroke();
      }
      ctx.restore();
      var box = inset(ctx, cam, 'right', { x: built.x0 + built.pinX, y: y0 + 0.02 }, 14, 'caliper at the stay pin', function (map) {
        paintBodies(ctx, map, [built.rest], 'rgba(120,128,136,.9)', '#4a5056');
        paintBodies(ctx, map, [built.boom], TIMBER, TIMBER_DARK);
        paintBodies(ctx, map, [built.pins[1]], '#c9ced4', '#59606a');
        // pin and hole centre lines
        var pc = map({ x: built.x0 + built.pinX, y: y0 }), hc = built.boom.worldPoint({ x: built.hole, y: 0 }), hs = map(hc);
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeStyle = '#9fd0ff'; ctx.beginPath(); ctx.moveTo(pc.x, pc.y + 30); ctx.lineTo(pc.x, pc.y - 90); ctx.stroke();
        ctx.strokeStyle = '#ffd36a'; ctx.beginPath(); ctx.moveTo(hs.x, hs.y + 30); ctx.lineTo(hs.x, hs.y - 90); ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.save();
      ctx.font = 'bold 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = Math.abs(st.offset) <= built.play / 2 ? '#9fe08a' : '#ff8a6a';
      ctx.fillText('hole ' + (st.offset >= 0 ? '+' : '−') + Math.abs(st.offset * 1000).toFixed(2) + ' mm from pin (play ±' + (built.play * 500).toFixed(1) + ')', box.x0 + 6, box.y0 + box.h - 8);
      ctx.restore();
    }
  });
})(globalThis.SE);
