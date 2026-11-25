/*
 * H11 · The Engineer's Loop: the general procedure for analysis, played as
 * one real lift in the build yard. Course section 1.6.
 *
 * The job: lift a part-filled water tank to the deck of the old signal tower
 * with the jib winch. The player reads the brief and the tank's plate, chalks
 * a sketch of the tank to scale, works out its weight, sets the winch's pull
 * from it (the crew's rule is 2 % over the weight), checks the answer against
 * what the winch actually felt, then picks the lightest rope off a rack whose
 * tags are written in mixed units. The simulation decides every outcome: a
 * pull below the weight stalls, a rope below the load parts, a pull far over
 * the load snatches the rope.
 *
 * Parts used: jib and winch (rigging), cable (core), plus four parts that
 * only this level needs, defined at the bottom: h11-tank, h11-hook,
 * h11-sketch and h11-sling.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals;

  var LB = SE.units.LBF;              // 4.448 N
  var KIP = 1000 * LB;

  /* ------------------------------------------------------------- the givens */
  var RHO = 1000;                     // water, kg/m^3
  var D_MM = 2600, H_MM = 3200;       // inside diameter and water depth, mm
  var TANK_H_MM = 3800;               // full height of the tank (not the water)
  var M_DRUM = 1100;                  // empty steel tank, kg
  var GRAV = 9.81;
  var D = D_MM / 1000, H = H_MM / 1000, TH = TANK_H_MM / 1000;
  // V = (pi/4) d^2 h = 0.785398 * 2.60^2 * 3.20 = 16.990 m^3       -> 17.0 m^3
  var V = Math.PI / 4 * D * D * H;
  // m = 1000 * 16.990 + 1100 = 18 090 kg                           -> 18.1 Mg
  var M_WATER = RHO * V, M = M_WATER + M_DRUM;
  // W = 18 090 * 9.81 = 177 460 N                                   -> 177 kN
  var W = M * GRAV;
  var PULL = 1.02;                    // the crew's rule: winch pull 2 % over W
  var NEED = PULL * W;                // 181.0 kN

  // The rope rack. Tags as written; ratings in N for the physics.
  var ROPES = [
    { key: 'A · 150 kN', id: 'A', tag: '150 kN', rating: 150e3, name: 'wire rope A' },
    { key: 'B · 36 000 lb', id: 'B', tag: '36 000 lb', rating: 36000 * LB, name: 'wire rope B' },   // 160.1 kN
    { key: 'C · 45 kip', id: 'C', tag: '45 kip', rating: 45 * KIP, name: 'wire rope C' },           // 200.2 kN
    { key: 'D · 250 kN', id: 'D', tag: '250 kN', rating: 250e3, name: 'wire rope D' },
    { key: 'E · 90 kip', id: 'E', tag: '90 kip', rating: 90 * KIP, name: 'chain E' }                 // 400.3 kN
  ];
  var BEST = ROPES[2];                // the lightest one rated above 181 kN
  function rope(key) { return ROPES.filter(function (r) { return r.key === key; })[0] || ROPES[0]; }

  /* ---------------------------------------------------------- the site */
  // Jib mast on the ground at x = -8, boom reaching 8 m to the hoist point
  // over the pad at x = 0, 17 m up. The tower deck is 9.0 m up.
  var TIP = { x: 0, y: 17 };
  var JIB = { x: -8, height: 17.35, reach: 8 };    // the jib's tip sheave hangs 0.35 m under the boom
  var DRUM = { x: JIB.x + 0.4, y: 0.5 };            // winch drum at the foot of the mast
  var SLING = 1.0;                    // m, hook block to tank lid
  var HOOK_H = 0.5;
  var HOOK_Y = TH + SLING + HOOK_H / 2;            // hook block centre at rest
  var LIFT = 9.2;                     // tank base ends 9.2 m up, just over the deck
  // line out when the winch stops: drum up to the tip sheave, then down to the hook
  var STOP = Math.hypot(TIP.x - DRUM.x, TIP.y - DRUM.y) + (TIP.y - (HOOK_Y + HOOK_H / 2)) - LIFT;
  var DECK = 9.0;

  function scenery() {
    return [
      { id: 'jib', type: 'jib', x: JIB.x, y: 0, dials: { height: JIB.height + ' m', reach: JIB.reach + ' m', facing: 'right' }, locked: true, label: 'gantry jib' },
      { id: 'tower', type: 'block', x: 3.6, y: DECK / 2, dials: { width: '3 m', height: DECK + ' m' }, locked: true, label: 'signal tower' },
      { id: 'deck', type: 'zone', x: 0, y: DECK + TH / 2 + 0.2, dials: { width: '3.2 m', height: (TH + 0.4) + ' m' }, locked: true, label: 'deck level' }
    ];
  }
  function winch(pull, extra) {
    return Object.assign({ id: 'winch', type: 'winch', a: { part: 'jib', anchor: 'base' }, b: { part: 'hook', anchor: 'top' }, via: { part: 'jib' },
      dials: { pull: pull || '5 kN', speed: '0.5 m/s', rating: '400 kN', brake: 'on', stop: STOP.toFixed(3) + ' m', route: 'over sheave', parts: '1' },
      locked: true, open: ['pull'], label: 'jib winch' }, extra || {});
  }
  function hook() { return { id: 'hook', type: 'h11-hook', x: 0, y: HOOK_Y, locked: true, label: 'hook block' }; }
  function tank(open) {
    return { id: 'tank', type: 'h11-tank', x: 0, y: TH / 2, locked: true, open: open || [], label: 'water tank',
      dials: { diameter: D_MM + ' mm', height: TANK_H_MM + ' mm', depth: H_MM + ' mm', shell: M_DRUM + ' kg' } };
  }

  // Phase 1: a 500 kg test crate on a proof chain.
  var CRATE_M = 500;
  function crateDesign(pull) {
    return { parts: scenery().concat([
      { id: 'crate', type: 'crate', x: 0, y: 0.5, dials: { mass: CRATE_M + ' kg' }, locked: true, open: ['mass'], label: 'test crate' },
      { id: 'hook', type: 'h11-hook', x: 0, y: 1 + SLING + HOOK_H / 2, dials: { mass: '10 kg' }, locked: true, label: 'test hook' },
      winch(pull, { b: { part: 'hook', anchor: 'top' } }),
      { id: 'proof', type: 'cable', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'crate', anchor: 'top' }, dials: { rating: '1 MN' }, locked: true, label: 'proof chain' }
    ]) };
  }
  var READ_DESIGN = crateDesign('12 kN');
  // The real tank, before anything is rigged to it.
  var TANK_DESIGN = { parts: scenery().concat([tank(), hook(), winch()]) };
  // Phase 2: the chalk sketch beside the tank.
  var SKETCH_DESIGN = { parts: TANK_DESIGN.parts.concat([
    { id: 'sketch', type: 'h11-sketch', x: -4.2, y: 0, locked: true, open: ['diameter', 'height', 'depth'], label: 'your sketch', dials: { diameter: '', height: '', depth: '' } }
  ]) };
  // Phase 4: the governor test on the proof chain.
  function proofDesign() {
    return { parts: TANK_DESIGN.parts.concat([
      { id: 'proof', type: 'cable', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rating: '1 MN' }, locked: true, label: 'proof chain' }
    ]) };
  }
  var PROOF_DESIGN = proofDesign();

  // the crate steps zoom in on the bottom of the lift, where the crate is
  var CRATE_CAMERA = { fit: { lo: { x: -6, y: -0.5 }, hi: { x: 6, y: 9.5 } } };
  var CAMERA = { fit: { lo: { x: -10, y: -1 }, hi: { x: 9, y: 20.5 } } };

  /* ---------------------------------------------------------- helpers */
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  function kN(N) { return isFinite(N) ? SE.sigfig.roundSig(N / 1000, 3).text + ' kN' : '?'; }
  function near(a, b, tol) { return isFinite(a) && Math.abs(a - b) <= (tol || 0.01) * Math.abs(b); }
  function base(s, id) { var p = s.pos(id), part = s.part(id); return p ? p.y - (part && part.halfH != null ? part.halfH : 0.5) : NaN; }
  function lifted(r, id) { return r && r.state ? base(r.state, id) : NaN; }
  // The tension in the chain under the hook while the load rises at a steady
  // speed (moving up, acceleration next to nothing).
  function steady(r) { return r && r.state && r.state.memo.steadyT; }
  function watchSteady(s, load) {
    var b = s.body(load), j = s.part('proof') && s.part('proof').joint, m = s.memo;
    if (!b || !j || j.broken) return;
    var v = b.v.y, a = m.lastV == null ? 0 : (v - m.lastV) / s.dt;
    m.lastV = v;
    // average over the steady window: the tank sways a little on the chain
    if (v > 0.1 && Math.abs(a) < 0.02 && s.t > 1) { m.sumT = (m.sumT || 0) + j.force(); m.nT = (m.nT || 0) + 1; m.steadyT = m.sumT / m.nT; }
  }
  // goal for "run it and look" steps: run for t seconds, noting the steady tension
  function runFor(t, load) { return function (s) { watchSteady(s, load); return s.t >= t - 1e-9 ? 'pass' : null; }; }

  var stalled = G.never(function (s) {
    return s.t > 5 && base(s, 'tank') < 0.03 && s.breaks.length === 0 ? 'The winch stalled: the tank never left the pad. The pull is below the weight it has to hold.' : null;
  });

  var LIFT_GOAL = G.all(
    G.noBreaks(),
    stalled,
    G.holdFor('deck', function (s) { return base(s, 'tank') >= DECK; }, 0.25)
  );

  SE.content.registerLevel('ch01', {
    id: 'H11', order: 11, title: 'The Engineer\'s Loop',
    subtitle: 'Read, sketch, compute, judge, lift',
    sections: ['1.6'],
    minutes: 25,
    objective: 'Lift the water tank onto the tower deck',
    pitch: 'Juno needs the settlement\'s water tank on the signal tower deck today. Work out what it weighs, set the winch, and pick a rope that won\'t part.',
    intro: [
      'Juno has pinned a work order to the depot\'s job board: the settlement\'s water tank has to go up onto the deck of the old signal tower, today, before the pump line is reconnected.',
      'Hask taps the board. "Every job from here on runs the same loop: **read** it, **tabulate** it, **apply** the principles, **solve**, then **judge** whether the answer makes sense. Five phases. Skip one and something ends up on the ground. Today the gantry winch will tell you which one you skipped."'
    ].join('\n\n'),
    goals: [
      'Work a real job through the five steps of the general procedure for analysis',
      'Pull the data that matters out of a messy brief and convert it to base units',
      'Chain the equations with the units checked at every line',
      'Judge an answer against a reference you trust before you bet a lift on it',
      'Put every rating in one unit before you compare them'
    ],
    yard: { site: { g: GRAV, floor: 'concrete' }, camera: CAMERA, poke: false, design: TANK_DESIGN },
    // Reference builds for the scored job (checked by tests/yard.test.js).
    solutions: {
      'H11.lift': [
        { add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: BEST.key } }], set: { winch: { pull: '181 kN' } } },
        { add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: ROPES[3].key } }], set: { winch: { pull: '240 kN' } } },
        // a different approach: two weak ropes side by side share the load
        { add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: ROPES[1].key } }, { type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: ROPES[1].key } }], set: { winch: { pull: '181 kN' } } },
        // 36 000 lb looks big: it is 160 kN, under the weight
        { pass: false, add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: ROPES[1].key } }], set: { winch: { pull: '181 kN' } } },
        // the pull set from the water alone: 1.02 x 166.7 kN = 170 kN
        { pass: false, add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: BEST.key } }], set: { winch: { pull: '170 kN' } } },
        // a pull ten times too big snatches rope C as the drum starts
        { pass: false, add: [{ type: 'h11-sling', a: { part: 'hook', anchor: 'bottom' }, b: { part: 'tank', anchor: 'top' }, dials: { rope: BEST.key } }], set: { winch: { pull: '1810 kN' } } }
      ]
    },
    steps: [
      /* ---------------------------------------------------- the work order */
      {
        type: 'say', who: 'juno',
        brief: '**Work order:** get the part-filled water tank 9 m up onto the tower deck. Set the winch 2 % over its weight and use the lightest rope that holds.',
        text: '**Work order: tank to tower.**\n\n' +
          'The steel water tank stands on the pad under the gantry jib. It is a vertical cylinder **' + D_MM + ' mm** across inside and **' + TANK_H_MM + ' mm** tall, stamped *20 000 L* on the side. Somebody already filled it to a depth of **' + H_MM + ' mm** and nobody wants to drain it. Water is **1000 kg/m³**. The empty tank (shell, lid and fittings, 6 mm plate) has a mass of **' + M_DRUM + ' kg**.\n\n' +
          'It goes up to the deck of the signal tower, **9.0 m** up, on the jib winch. Four of you on the crew. It\'s 14 °C and dry.\n\n' +
          'Set the winch to pull **2 % over the weight**, the crew\'s rule for getting a load moving, and use the **lightest rope on the rack** that will do the lift. — J.'
      },

      /* ------------------------------------------------------ phase 1: read */
      {
        type: 'watch', who: 'hask', kicker: 'Phase 1 of 5 · Read',
        objective: 'Lift the test crate and read the chain tension',
        brief: 'Press **▶ Run**. Watch the **proof chain tension** gauge once the 500 kg crate rises at a steady speed.',
        yard: { design: READ_DESIGN, goal: runFor(12, 'crate'), readouts: ['proof.tension', 'winch.lineOut'], camera: CRATE_CAMERA },
        text: '**Phase 1: read.** Reading a job means matching it to theory you already know. Before the tank, a **500 kg** test crate on a proof chain. The winch can pull up to **12 kN** and reels in at **0.5 m/s**.\n\nPress **▶ Run** and watch the **proof chain tension** gauge. It does one thing while the crate speeds up and another once it rises at a steady 0.5 m/s.',
        goalText: 'Run the test lift',
        until: function (ctx, type) { return type === 'result' && !!steady(ctx.result); },
        after: function (ctx) {
          return 'For a split second, getting it moving, the winch pulled its full 12 kN. Once the crate rose at a steady speed the tension settled at **' + kN(steady(ctx.result)) + '**. The crate weighs ' + f3(CRATE_M) + ' kg × 9.81 m/s² = ' + kN(CRATE_M * GRAV) + ', and the little test hook adds 10 kg.';
        }
      },
      {
        type: 'rule', title: 'Rising at a steady speed is equilibrium',
        brief: 'No acceleration, so the chain just carries the weight: **T = W**. That is the one number this job needs from the work order.',
        law: 'a = 0 \\quad \\Rightarrow \\quad T = W = mg',
        eq: function (ctx) { var T = steady(ctx.result); return T ? 'T = ' + f3(T / 1000) + '\\u{ kN} \\approx (' + CRATE_M + '\\u{ kg})(9.81\\u{ m/s^2}) = ' + f3(CRATE_M * GRAV / 1000) + '\\u{ kN}' : ''; },
        text: 'A load going up at constant speed is a **particle in equilibrium**, the H1 case: no acceleration, so the cable just balances the weight. The extra pull only matters while it speeds up. That is the theory this job connects to, and it tells you the one thing you need from Juno\'s brief: **the weight of the tank**. The height of the tower, the weather and the crew size don\'t change the tension.'
      },
      {
        type: 'watch', who: 'hask',
        objective: 'Double the crate to 1000 kg and lift it again',
        brief: 'Click the crate, set its mass to **1000 kg**, and run it again. Watch the steady tension.',
        yard: { keep: true, goal: runFor(12, 'crate'), readouts: ['proof.tension', 'winch.lineOut'], camera: CRATE_CAMERA },
        text: 'Check it yourself. Select the crate and set its mass to **1000 kg**, then run it again. The winch can pull 12 kN, which is still more than the weight.',
        goalText: 'Double the crate and run again',
        until: function (ctx, type) {
          var m = ctx.si('crate', 'mass');
          if (!near(m, 1000, 0.002)) return near(m, CRATE_M, 0.002) ? false : 'Set the crate\'s mass to **1000 kg**.';
          return type === 'result' && !!steady(ctx.result);
        },
        after: function (ctx) { return 'Twice the mass, twice the steady tension: **' + kN(steady(ctx.result)) + '**. Try **1300 kg** if you like: the winch can\'t pull more than its 12 kN, so it stalls and the crate stays on the pad.'; }
      },

      /* -------------------------------------------------- phase 2: tabulate */
      {
        type: 'build', who: 'hask', kicker: 'Phase 2 of 5 · Tabulate and sketch',
        objective: 'Chalk a to-scale sketch that matches the tank',
        brief: 'Click the tank to read its plate. Then select **your sketch** and type the inside diameter, the height and the water depth (**3200 mm**).',
        yard: { design: SKETCH_DESIGN, readouts: [] },
        text: '**Phase 2: tabulate.** Here is the real tank. Click it to read its plate. Then chalk a **sketch** of it on the pad beside it: select **your sketch** and type the inside diameter, the tank height and the **water depth** from the brief.\n\nThe sketch is drawn to scale next to the tank, so a slip shows the moment you type it. A big, true sketch is where you catch "that\'s the tank height, not the water".',
        goalText: 'Sketch matches the tank: diameter, height and waterline',
        until: function (ctx) {
          var d = ctx.si('sketch', 'diameter'), h = ctx.si('sketch', 'height'), w = ctx.si('sketch', 'depth');
          if (!isFinite(d) && !isFinite(h) && !isFinite(w)) return false;
          if (isFinite(d)) {
            if (d > 100) return 'Your sketch is **' + f3(d) + ' m** wide. It runs off the yard: somewhere a millimetre became a metre.';
            if (near(d, D / 2, 0.02)) return 'That diameter is half the tank. **' + D_MM + ' mm** is the full width inside.';
            if (!near(d, D, 0.02)) return 'The sketch is narrower or wider than the tank. Check the diameter against the brief.';
          }
          if (isFinite(w)) {
            if (near(w, TH, 0.01)) return 'Your waterline is at the brim. The tank is **' + TANK_H_MM + ' mm** tall, but the water is only **' + H_MM + ' mm** deep.';
            if (isFinite(h) && w > h + 1e-9) return 'The water is drawn higher than the tank. Something\'s off.';
            if (!near(w, H, 0.02)) return 'The waterline doesn\'t match the sight glass on the real tank. Look at the depth in the brief again.';
          }
          if (isFinite(h) && !near(h, TH, 0.02)) return 'The sketch is a different height from the tank.';
          return isFinite(d) && isFinite(h) && isFinite(w);
        },
        hint: 'Select the sketch and type **2600 mm** (or 2.6 m) for the diameter, **3800 mm** for the height and **3200 mm** for the water depth.',
        after: 'Your data table, chalked beside the sketch:\n\n- inside diameter, *d* = 2.60 m\n- water depth, *h* = 3.20 m\n- water density, *ρ* = 1000 kg/m³\n- empty tank, $m_{\\t{tank}}$ = 1100 kg\n- gravity, *g* = 9.81 m/s²\n- winch pull = 1.02 × *W*\n\nThe tank height went on the sketch but not in the table: only the water that is there has weight. The 20 000 L stamp is the brim-full volume, and the 6 mm plate is already inside the 1100 kg.'
      },

      /* ----------------------------------------------------- phase 3: apply */
      {
        type: 'rule', kicker: 'Phase 3 of 5 · Apply', title: 'From tank to winch pull',
        brief: 'Chain the formulas and check the units on every line. Units catch a wrong equation fast, but not a lost factor of 4.',
        law: 'V = \\frac{\\pi}{4}d^{2}h \\quad m = \\rho V + m_{\\t{tank}} \\quad W = mg',
        eq: [
          '[\\u{m^2}][\\u{m}] = [\\u{m^3}] \\qquad [\\u{kg/m^3}][\\u{m^3}] + [\\u{kg}] = [\\u{kg}] \\qquad [\\u{kg}][\\u{m/s^2}] = [\\u{N}]',
          'P_{\\t{winch}} = 1.02\\,W \\qquad [\\u{N}] = [\\u{N}]'
        ],
        text: 'Chain the principles, checking the units at every line. Each one has the same units on both sides, so the algebra can\'t have dropped a term. A formula like $\\frac{\\pi}{4}d^2 + h$ fails at once (m² plus m). But a consistent one can still be wrong: $\\pi d^2 h$ is m³ and **four times too big**, because the base area is π(d/2)². Check the units first because it\'s fast, then the physics.\n\nThe winch dial checks units too. Type a **mass** into its Max pull dial and it refuses: a winch pulls with a force.'
      },

      /* ----------------------------------------------------- phase 4: solve */
      {
        type: 'watch', who: 'hask', kicker: 'Phase 4 of 5 · Solve',
        objective: 'Set the winch to 1.02 × W and lift the tank off',
        brief: 'Work out the tank\'s weight **W**. Select the **jib winch**, set **Max pull** to 1.02 × W, and run the test on the proof chain.',
        yard: { design: PROOF_DESIGN, goal: runFor(14, 'tank'), readouts: ['proof.tension', 'tank.lift'] },
        text: '**Phase 4: solve.** Work out the weight of the tank and water. Keep every digit until the end, then round once.\n\nThe tank is on a **proof chain** that nothing here can break. Select the **jib winch** and set its **Max pull** to Juno\'s rule, **1.02 × your W**. Then run the governor test.',
        goalText: 'The tank lifts off on the proof chain',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          var pull = ctx.si('winch', 'pull'), r = ctx.result, rise = lifted(r, 'tank');
          if (r.state.breaks.length) return 'The **proof chain parted**. The winch was set to **' + kN(pull) + '** and snatched the tank off the pad. That is far more than any weight on this job: look for a prefix slip.';
          if (!(rise > 0.05)) return 'The winch strained at **' + kN(pull) + '** and **stalled**: the tank never left the pad. That pull is less than the tank weighs.' +
            (near(pull, PULL * M_WATER * GRAV, 0.02) ? ' It matches the water on its own. The steel shell goes up too.' : '') +
            (near(pull, W, 0.01) ? ' That is about the weight itself, with nothing over. The 2 % is what gets it moving.' : '');
          if (pull > 1.5 * NEED) return 'It lifted, but a pull of **' + kN(pull) + '** is far more than the tank needs, and the rope you pick has to survive it. Set it from your weight: **1.02 × W**.';
          ctx.values.pull = ctx.text('winch', 'pull');
          return true;
        },
        hint: '$V = \\frac{\\pi}{4}(2.60)^2(3.20) = 16.99\\u{ m^3}$, so $m = 16\\,990 + 1100 = 18\\,090\\u{ kg}$ and $W = 18\\,090 \\times 9.81 = 177\\,460\\u{ N}$, about **177 kN**. The pull is 1.02 × 177.46 kN = **181 kN**.',
        after: function (ctx) {
          var T = steady(ctx.result), Wp = ctx.si('winch', 'pull') / PULL, off = T ? Math.abs(T - Wp) / Wp : NaN;
          return 'Lifted. Your pull: **' + kN(ctx.si('winch', 'pull')) + '**, so your W was ' + kN(Wp) + '. Once the tank rose at a steady speed the proof chain carried **' + kN(T) + '**: the weight of the tank and its water, as measured by the yard. ' +
            (off < 0.015 ? 'That is within ' + Math.max(1, Math.ceil(off * 100)) + ' % of your W, so your sums hold up.' : 'That is ' + Math.round(off * 100) + ' % away from your W. Something in the chain is off: check it before you pick a rope.');
        }
      },

      /* ----------------------------------------------------- phase 5: judge */
      {
        type: 'rule', kicker: 'Phase 5 of 5 · Judge', title: 'Does 18 tonnes make sense?',
        brief: 'A 2.6 × 2.6 × 3.2 m box holds at most 21.6 t of water. A cylinder fills about 79 % of it, so 18 t is believable.',
        law: '\\frac{\\pi}{4} \\times 21.6\\u{ t} + 1.1\\u{ t} \\approx 18.1\\u{ t}',
        text: 'Technical judgment means comparing an answer with something you trust, before you bet a lift on it. One cubic metre of water is a tonne, so the box around this tank could hold at most 21.6 t of water. A cylinder fills π/4 ≈ 79 % of its box. Add a tonne of steel and you land on 18.1 t, about a dozen cars.\n\nThe winch already agreed with you. But the quick check is what you do **before** a run: errors from a dropped prefix or a radius used as a diameter are never small (10×, 4×, 1000×), so a rough bound catches them.'
      },
      {
        type: 'reveal', kicker: 'Procedure', title: 'General procedure for analysis',
        brief: 'You just ran it: **read**, **tabulate**, **apply**, **solve**, **judge**. Every later job is laid out this way.',
        text: 'You just ran it:\n\n' +
          '- **1 · Read** the problem carefully and connect the physical situation to the theory (a load rising steadily is in equilibrium, T = W).\n' +
          '- **2 · Tabulate** the data and draw any diagrams to a large scale (the table and the chalk sketch).\n' +
          '- **3 · Apply** the relevant principles in mathematical form, keeping every equation dimensionally homogeneous (V, ρV, mg).\n' +
          '- **4 · Solve** the equations and report the answer to no more than **3 s.f.** (177 kN).\n' +
          '- **5 · Judge** the answer: does it make physical sense, and would you bet a lift on it (a dozen cars, inside the box).\n\n' +
          'Work neatly. A tidy page makes for tidy thinking, and the other way round.',
        formula: 'ch01.procedure'
      },

      /* ------------------------------------------------------------ the job */
      {
        type: 'job', id: 'H11.lift', who: 'juno',
        objective: 'Lift the tank to deck level without parting a rope',
        brief: 'Rig rope from the rack between the hook block and the tank lid, choose which rope, and run. Tags are in kN, lb and kip. The lightest that holds scores best.',
        yard: {
          design: TANK_DESIGN,
          bin: [{ type: 'h11-sling', count: 2, label: 'Rope from the rack' }],
          ghosts: [{ type: 'h11-sling', x: 0, y: TH + SLING / 2, w: 0.3, h: SLING, text: 'rope: hook block to tank lid' }],
          readouts: ['winch.tension', 'sling.tension', 'tank.lift']
        },
        onEnter: function (ctx) {
          if (ctx.values.pull) ctx.yard.setDial('winch', 'pull', ctx.values.pull);
        },
        text: function (ctx) {
          return 'The proof chain belongs to the test bench. For the real lift, take a rope from the rack (or two, side by side) and rig it from the bottom of the hook block to the tank lid. Select it to choose which rope it is. The tags are a mess of units:\n\n' +
            ROPES.map(function (r) { return '- ' + r.name + ': **' + r.tag + '**'; }).join('\n') + '\n\n' +
            'Use the **lightest** rope that survives the lift. The winch is set to ' + (ctx.values.pull ? 'your **' + ctx.values.pull + '**' : 'pull **1.02 × W**') + ', and as the drum starts the rope feels the full pull, not just the weight. Run it: the tank has to rise to **deck level**, where the crew swings it across.';
        },
        goal: LIFT_GOAL,
        timeout: 45,
        goalText: 'Tank lifted to deck level, with nothing broken',
        onFail: function (ctx) {
          var sl = ctx.find('h11-sling');
          if (!sl) return 'Nothing was holding the tank: rig a rope from the hook block to the lid.';
          var r = rope(sl.dials.rope), pull = ctx.si('winch', 'pull');
          if (ctx.result && ctx.result.state && ctx.result.state.breaks.length) {
            if (r.rating >= W && pull > r.rating) return r.name + ' is rated **' + r.tag + ' = ' + kN(r.rating) + '**, enough for the weight, but the winch pulled **' + kN(pull) + '** to get the tank moving.';
            return r.name + ' is tagged **' + r.tag + '**. In kN that is **' + kN(r.rating) + '**, and the tank weighs about ' + kN(W) + '.';
          }
          return '';
        },
        hints: [
          'Put every tag in kN first. 1 kip = 1000 lb, and 1 lb = 4.448 N.',
          'The rope sees the winch pull while the tank speeds up: 1.02 × 177.46 kN = 181 kN. Convert B and C, then take the smallest rating above 181 kN.',
          'B: 36 000 × 4.448 N = 160 kN, too weak. C: 45 000 × 4.448 N = 200 kN. D is 250 kN and E is 400 kN. Use **rope C**, with the winch at **181 kN**.'
        ],
        // a heavier rope than needed still works, but it took three people to drag it to the jib
        margin: function (s) {
          var R = 0;
          Object.keys(s.built.parts).forEach(function (k) { var p = s.built.parts[k]; if (p.inst.type === 'h11-sling') R += rope(p.inst.dials.rope).rating; });
          if (!R) return 0;
          return R <= BEST.rating + 1 ? 0 : Math.round(Math.min(30, 10 * Math.log(R / BEST.rating) / Math.log(1.25)));
        },
        success: function (ctx) {
          var used = ctx.all('h11-sling').map(function (p) { return rope(p.dials.rope); });
          var msg = 'The tank is at deck level and the crew is swinging it across. ' + used.map(function (r) { return r.name + ' (' + r.tag + ' = ' + kN(r.rating) + ')'; }).join(' and ') + (used.length > 1 ? ' shared it.' : ' carried it.');
          if (used.length > 1) msg += ' Two ropes side by side each take about half the load, so a pair of weak ones can do what one can\'t.';
          else if (used[0] && used[0] !== BEST) msg += ' It held, but rope C (45 kip = 200 kN) is lighter and still enough.';
          return msg + '\n\nIn one unit the rack reads 150, 160, 200, 250 and 400 kN. The trap was B: "36 000" looks huge until you remember a pound is only 4.448 N.';
        }
      },

      /* ------------------------------------------------------- go deeper */
      {
        type: 'deeper', title: 'Why riggers never use the breaking strength',
        teaser: 'A real crane crew would never hang an 18 t tank on a rope that breaks at 20 t. Here\'s what they do instead.',
        steps: [
          { type: 'say', who: 'hask', text: 'Real rope and chain carry a **working load limit** (WLL): the breaking strength divided by a design factor. For steel wire rope on lifting gear the factor is usually **5**. So a rope that breaks at 200 kN is only rated to lift 40 kN.\n\nThe factor covers what the tidy calculation leaves out: worn and kinked strands, the rope bending round a sheave, jerks at the start of a lift, a swinging load.' },
          { type: 'say', who: 'hask', text: 'With a factor of 5, our 177 kN tank needs a rope that breaks at 5 × 177.46 kN ≈ **887 kN**. Nothing on our rack comes close. A real crew would reeve the line through a block several times, so each fall carries only part of the load, or use a much heavier rope. The yard here works at the breaking load so you can see things break. Out there, you don\'t want to.' }
        ]
      },

      /* --------------------------------------------------------- free play */
      {
        type: 'free', who: 'hask',
        objective: 'Free play: find what breaks, and why',
        brief: 'The pad is yours. Water depth, shell mass and the winch are open now. Try the prompts below.',
        yard: {
          design: { parts: scenery().concat([tank(['depth', 'shell']), hook(), winch('181 kN', { open: ['pull', 'speed'] })]) },
          bin: [{ type: 'h11-sling', count: 2, label: 'Rope from the rack' }, { type: 'cable', count: 1, dials: { rating: '1 MN' }, label: 'Proof chain' }],
          readouts: ['winch.tension', 'tank.lift'],
          goal: null
        },
        text: 'The pad is yours. The tank\'s water depth and shell mass are open now, and so is the winch.',
        prompts: [
          'Which is the weakest rope that survives a lift at **181 kN**? Try each one.',
          'Set the pull from the **water-only** weight, then from a prefix slip (**181 MN**). What happens?',
          'Fill the tank to the brim (**3800 mm**). Does rope C still hold?',
          'Marlow used the diameter as the radius and got **69.1 Mg**. Set the winch to 1.02 × that weight on rope D and watch.'
        ]
      },

      {
        type: 'summary',
        points: [
          'The **general procedure**: read and connect to theory, tabulate and draw big, apply principles as homogeneous equations, solve and report to 3 s.f., then judge the answer.',
          'Reading carefully means sorting the data: depth, not height; the shell mass once, not twice.',
          'Units checks catch impossible equations instantly, but a missing factor of 4 has no units, so check the physics too.',
          'Keep full precision and round once. Then compare with something you trust: a tonne per cubic metre of water, a car at 1.5 t.',
          'Put every rating in one unit before you compare: 36 000 lb is smaller than 45 kip.'
        ],
        text: 'This loop is how every job in every later act will be laid out.'
      }
    ]
  });

  /* =============================================================== parts */

  // The water tank: a steel cylinder (seen from the side) part-filled with
  // water. Its mass is the water that is in it plus the empty shell.
  Y.definePart({
    type: 'h11-tank', name: 'Water tank', category: 'Loads', library: false,
    blurb: 'A steel water tank. Its mass is the water in it plus the empty shell.',
    size: { w: D + 0.012, h: TH },
    dials: [
      { key: 'diameter', label: 'Inside diameter', q: 'length', def: D_MM + ' mm', min: 0.2, max: 10 },
      { key: 'height', label: 'Tank height', q: 'length', def: TANK_H_MM + ' mm', min: 0.2, max: 10 },
      { key: 'depth', label: 'Water depth', q: 'length', def: H_MM + ' mm', min: 0 },
      { key: 'shell', label: 'Empty tank', q: 'mass', def: M_DRUM + ' kg', min: 1 }
    ],
    anchors: { top: { x: 0, y: TH / 2 } },
    build: function (b) {
      var d = b.si('diameter'), h = b.si('height'), w = Math.min(b.si('depth'), h);
      var m = RHO * Math.PI / 4 * d * d * w + b.si('shell');
      var body = b.body({ position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'water tank', mass: m,
        shapes: [{ shape: b.P.box(d / 2 + 0.006, h / 2), material: 'steel' }] });
      return { body: body, halfH: h / 2, depth: w, height: h, width: d + 0.012,
        anchors: { top: { body: body, local: body.localPoint(b.at({ x: 0, y: h / 2 })) } } };
    },
    plate: function (inst) { return ['Capacity 20 000 L', 'ID ' + inst.dials.diameter + ' · ' + inst.dials.height + ' tall', 'Shell ' + inst.dials.shell]; },
    readouts: function (built) {
      return [{ key: 'lift', label: 'base height', q: 'length', read: function () { return built.body.c.y - built.halfH; } }];
    },
    draw: function (ctx, cam, built) {
      var c = built.body.c, w = built.width, h = built.height;
      var tl = cam.worldToScreen({ x: c.x - w / 2, y: c.y + h / 2 });
      var wl = cam.worldToScreen({ x: c.x - w / 2, y: c.y - h / 2 + built.depth });
      var bl = cam.worldToScreen({ x: c.x - w / 2, y: c.y - h / 2 });
      ctx.save();
      ctx.fillStyle = 'rgba(80,140,200,.45)';
      ctx.fillRect(tl.x + 3, wl.y, w * cam.zoom - 6, bl.y - wl.y - 3);
      ctx.strokeStyle = 'rgba(160,210,255,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tl.x + 3, wl.y); ctx.lineTo(tl.x + w * cam.zoom - 3, wl.y); ctx.stroke();
      ctx.fillStyle = 'rgba(236,226,198,.9)'; ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText('20 000 L', tl.x + 6, tl.y + 16);
      ctx.restore();
    }
  });

  // A crane hook block: a small steel weight the winch line hooks into.
  Y.definePart({
    type: 'h11-hook', name: 'Hook block', category: 'Rigging', library: false,
    blurb: 'The block on the end of the winch line. Rig a rope from its hook to the load.',
    size: { w: 0.5, h: HOOK_H },
    dials: [{ key: 'mass', label: 'Mass', q: 'mass', def: '200 kg', min: 1 }],
    anchors: { top: { x: 0, y: HOOK_H / 2 }, bottom: { x: 0, y: -HOOK_H / 2 } },
    build: function (b) {
      return { body: b.body({ position: b.at({ x: 0, y: 0 }), label: '', mass: b.si('mass'), fixedRotation: true,
        shapes: [{ shape: b.P.box(0.25, HOOK_H / 2), material: 'steel' }] }) };
    }
  });

  // The chalk sketch: an outline drawn to scale from what the player typed.
  // It is chalk, so nothing touches it.
  Y.definePart({
    type: 'h11-sketch', name: 'Chalk sketch', category: 'Measure', library: false,
    blurb: 'A to-scale sketch of the tank. Type its sizes and it is drawn beside the real one.',
    size: { w: 2.6, h: 3.8 },
    dials: [
      { key: 'diameter', label: 'Inside diameter', q: 'length', def: '', optional: true },
      { key: 'height', label: 'Tank height', q: 'length', def: '', optional: true },
      { key: 'depth', label: 'Water depth', q: 'length', def: '', optional: true }
    ],
    build: function (b) {
      var d = b.si('diameter'), h = b.si('height'), w = b.si('depth');
      var cw = clampSize(d, 2), ch = clampSize(h, 2);
      // a chalk board you can click: a sensor the size of the sketch (clipped to the yard)
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: ch / 2 }), label: '', shapes: [{ shape: b.P.box(cw / 2, ch / 2), sensor: true }] });
      return { body: body, d: d, h: h, w: w, x: b.inst.x, y: b.inst.y };
    },
    draw: function (ctx, cam, built) {
      var d = built.d, h = built.h, w = built.w, x = built.x, y = built.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(236,226,198,.85)'; ctx.fillStyle = 'rgba(236,226,198,.95)'; ctx.lineWidth = 2;
      ctx.font = '12px "IBM Plex Mono", monospace';
      if (d == null && h == null && w == null) {
        var s0 = cam.worldToScreen({ x: x - 1, y: y + 2 });
        ctx.fillText('your sketch:', s0.x, s0.y); ctx.fillText('select me', s0.x, s0.y + 16);
        ctx.restore(); return;
      }
      var dw = d != null ? Math.min(d, 60) : 2, dh = h != null ? Math.min(h, 60) : 2;
      var tl = cam.worldToScreen({ x: x - dw / 2, y: y + dh });
      ctx.setLineDash(d != null && h != null ? [] : [6, 6]);
      ctx.strokeRect(tl.x, tl.y, dw * cam.zoom, dh * cam.zoom);
      ctx.setLineDash([]);
      if (w != null) {
        var wy = cam.worldToScreen({ x: x, y: y + Math.min(w, 60) }).y;
        ctx.strokeStyle = 'rgba(160,210,255,.95)'; ctx.setLineDash([10, 5]);
        ctx.beginPath(); ctx.moveTo(tl.x + 2, wy); ctx.lineTo(tl.x + dw * cam.zoom - 2, wy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(160,210,255,.95)'; ctx.textAlign = 'right'; ctx.fillText('h = ' + fmtLen(w), tl.x - 6, wy + 4); ctx.textAlign = 'left';
      }
      ctx.fillStyle = 'rgba(236,226,198,.95)';
      if (d != null) ctx.fillText('d = ' + fmtLen(d) + (d > 60 ? ' (off the yard)' : ''), tl.x, tl.y - 8);
      if (h != null) { ctx.textAlign = 'right'; ctx.fillText(fmtLen(h) + ' tall', tl.x - 6, tl.y + 12); ctx.textAlign = 'left'; }
      ctx.restore();
    }
  });
  function clampSize(v, def) { return v == null || !isFinite(v) ? def : Math.max(0.3, Math.min(v, 30)); }
  function fmtLen(v) { return Y.dial.format(v, v >= 1000 ? 'km' : 'm', 3, 'length'); }

  // A rope off the rack: pick which one, and it is exactly what its tag says.
  Y.definePart({
    type: 'h11-sling', name: 'Rack rope', category: 'Rigging', library: false,
    blurb: 'A rope off the yard rack. It breaks at the load on its tag, whatever unit the tag is in.',
    size: { w: 0.1, h: 1 },
    connector: true,
    dials: [{ key: 'rope', label: 'Rope', choice: ROPES.map(function (r) { return r.key; }), def: ROPES[0].key }],
    build: function (b) {
      var A = b.end('a'), B = b.end('b'), r = rope(b.text('rope'));
      var L = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        // steel wire rope stretches a little (EA about 20 MN), so a snatch builds over a few
        // hundredths of a second instead of one instant
        rope: true, length: L, EA: 2e7, breakForce: r.rating, label: b.inst.label || r.name }));
      return { joint: j, rope: r };
    },
    plate: function (inst) { var r = rope(inst.dials.rope); return [r.name, 'Breaks at ' + r.tag]; },
    readouts: function (built) { return [{ key: 'tension', label: 'tension', q: 'force', read: function () { return built.joint.broken ? 0 : Math.max(0, built.joint.tension ? built.joint.tension() : built.joint.force()); } }]; }
  });

})(globalThis.SE);
