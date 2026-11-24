/*
 * H11 · The Engineer's Loop: the general procedure for analysis, played as a
 * five-phase "job board" on one real lift, then a scored review of the whole
 * chapter. Course section 1.6 and the chapter's important points.
 *
 * The job: lift a part-filled cylindrical water tank onto the tower and pick
 * the cable for it from a yard list written in mixed units.
 */
(function (SE) {
  'use strict';

  var LB = SE.units.LBF;              // 4.448 N
  var KIP = 1000 * LB;

  /* ------------------------------------------------------------- the givens */
  var RHO = 1000;                     // water, kg/m^3
  var D_MM = 2600, H_MM = 3200;       // inside diameter and water depth, mm
  var TANK_H_MM = 3800;               // full height of the tank (distractor)
  var M_DRUM = 1100;                  // empty steel tank, kg
  var G = 9.81;

  var D = D_MM / 1000, H = H_MM / 1000;
  // V = (pi/4) d^2 h = 0.785398 * 2.60^2 * 3.20 = 0.785398 * 6.76 * 3.20
  //   = 16.990 m^3                    -> "17.0 m^3"
  var V = Math.PI / 4 * D * D * H;
  // water: 1000 * 16.990 = 16 990 kg; with the drum 16 990 + 1100 = 18 090 kg
  //                                    -> "18.1 Mg"
  var M_WATER = RHO * V;
  var M = M_WATER + M_DRUM;
  // W = 18 090 * 9.81 = 177 460 N      -> "177 kN"
  var W = M * G;

  // The winch pulls a little over the weight to get the tank moving.
  var PULL = 1.02;
  // required strength 1.02 * 177.46 kN = 181.0 kN
  var NEED = PULL * W;

  // Yard list. Ratings in SI for the physics; labels as written on the tags.
  var CABLES = [
    { id: 'A', tag: '150 kN', rating: 150e3, name: 'wire rope A' },
    { id: 'B', tag: '36 000 lb', rating: 36000 * LB, name: 'wire rope B' },   // 160.1 kN
    { id: 'C', tag: '45 kip', rating: 45 * KIP, name: 'wire rope C' },        // 200.2 kN
    { id: 'D', tag: '250 kN', rating: 250e3, name: 'wire rope D' },
    { id: 'E', tag: '90 kip', rating: 90 * KIP, name: 'chain E' }             // 400.3 kN
  ];
  var BEST = CABLES[2];               // the lightest one rated above 181 kN

  function kN(N) { return SE.sigfig.roundSig(N / 1000, 3).text + ' kN'; }
  function t3(x) { return SE.sigfig.roundSig(x, 3).text; }

  var TANK = 'water tank';
  function hoistScene(extra) {
    return { type: 'hoist', params: Object.assign({ mass: M, label: TANK, mode: 'lift', hookHeight: 3, height: 9 }, extra || {}) };
  }

  // Governor test: the winch is set to pull 2 % over the weight the player
  // wrote down, the same rule the crew uses on the real lift. The true weight
  // decides whether the tank lifts, stays on the pad or slams the gantry head.
  function governorTest(ctx, claimedW, dur) {
    var s = ctx.setScene('hoist', { mass: M, label: TANK, mode: 'lift', height: 9, hookHeight: 3 });
    return s.run(PULL * claimedW, { duration: dur || 4 });
  }

  // Lift test with a given cable: the winch pulls 2 % over the true weight.
  function liftTest(ctx, cable) {
    var s = ctx.setScene('hoist', { mass: M, label: TANK, mode: 'lift', rating: cable.rating, height: 9, hookHeight: 3 });
    return s.run(PULL * W, { duration: 4 });
  }

  SE.content.registerLevel('ch01', {
    id: 'H11', order: 11, title: 'The Engineer\'s Loop',
    subtitle: 'Read, tabulate, apply, solve, judge',
    sections: ['1.6'],
    minutes: 25,
    intro: [
      'Juno has pinned a work order to the depot\'s job board: the settlement\'s water tank has to go up onto the old signal tower, today, before the pump line is reconnected.',
      'Hask taps the board. "Every job from here on runs the same loop: **read** it, **tabulate** it, **apply** the principles, **solve**, then **judge** whether the answer makes sense. Five phases. Skip one and something ends up on the ground."'
    ].join('\n\n'),
    goals: [
      'Work a real job through the five steps of the general procedure for analysis',
      'Pull the data that matters out of a messy brief and convert it to base units',
      'Choose equations by checking dimensional homogeneity',
      'Report to 3 s.f. and judge the answer against a reference you know',
      'Prove you know every important point of Chapter 1'
    ],
    scene: hoistScene(),
    proveIt: [
      {
        id: 'H11.prove-tank', text: 'A rain barrel is 1200 mm across inside, filled with water (1000 kg/m³) to a depth of 1500 mm. The empty barrel has a mass of 80 kg. What is the total weight, to 3 s.f.?',
        inputs: [{
          key: 'W', label: 'Weight of the full barrel', placeholder: 'e.g. 1.23 kN',
          // V = (pi/4)(1.2^2)(1.5) = 1.6965 m^3; m = 1696.5 + 80 = 1776.5 kg;
          // W = 1776.5 * 9.81 = 17 427 N -> 17.4 kN
          spec: { value: (Math.PI / 4 * 1.2 * 1.2 * 1.5 * 1000 + 80) * 9.81, unit: 'N', sf: 3, form: 'si' },
          answer: '17.4 kN',
          wrong: [{ input: '1.78 Mg', kind: 'concept' }, { input: '69.0 kN', kind: 'algebra' }]
        }]
      },
      {
        id: 'H11.prove-kip', text: 'An old chain hoist is tagged **5 kip**. What is that in kN, to 3 s.f.?',
        inputs: [{
          key: 'F', label: 'Rating in kN', placeholder: 'e.g. 1.23 kN',
          // 5 * 1000 lb * 4.448 N/lb = 22 240 N -> 22.2 kN
          spec: { value: 5 * KIP, unit: 'N', sf: 3, form: 'si', expressIn: 'kN' },
          answer: '22.2 kN',
          wrong: [{ input: '5.00 kN', kind: 'conversion' }, { input: '22.2 N', kind: 'prefix' }]
        }]
      }
    ],
    steps: [
      /* ---------------------------------------------------- the work order */
      {
        type: 'say', who: 'juno',
        hud: ['JOB BOARD · Lift the water tank', '1 Read · 2 Tabulate · 3 Apply · 4 Solve · 5 Judge'],
        text: '**Work order: tank to tower.**\n\n' +
          'The steel water tank stands by the pump shed. It is a vertical cylinder **' + D_MM + ' mm** across inside and **' + TANK_H_MM + ' mm** tall, stamped *20 000 L* on the side. Somebody already filled it to a depth of **' + H_MM + ' mm** and nobody wants to drain it. Water is **1000 kg/m³**. The empty tank (shell, lid and fittings, 6 mm plate) has a mass of **' + M_DRUM + ' kg**.\n\n' +
          'It goes on the platform of the signal tower, **9.0 m** up, using the gantry winch and **30 m** of cable from the yard. Four of you on the crew. It\'s 14 °C and dry.\n\n' +
          'Pick the **lightest cable from the yard list** that will do the lift. The winch pulls about 2 % over the load\'s weight to get it moving. — J.'
      },

      /* ------------------------------------------------------ phase 1: read */
      {
        type: 'predict', who: 'hask',
        hud: ['JOB BOARD · phase 1 of 5: READ', 'connect the situation to the theory'],
        q: '**Phase 1: read.** First, what kind of problem is this? Once the tank is off the ground and rising slowly at a steady speed, how big must the cable tension be?',
        choices: [
          { t: 'Equal to the weight of tank and water, $T = W$.', correct: true, why: 'Steady speed means a = 0, so this is statics: the cable just balances the weight. Getting it moving takes a little more, which is why Juno mentions the 2 %.' },
          { t: 'Bigger than the weight the whole way, or it couldn\'t be going up.', why: 'Moving isn\'t the same as accelerating. At steady speed the forces balance (that was H1). Only the start, when it speeds up, needs extra.' },
          { t: 'Equal to the mass, about 18 000.', why: 'Mass is in kg, tension is a force in newtons. You need W = mg to get from one to the other.' },
          { t: 'It depends how high the tower is.', why: 'The height tells you how far to lift, not how hard. The tension that balances the weight is the same at 1 m or 9 m.' }
        ],
        run: function (ctx) {
          return governorTest(ctx, W, 4).then(function (r) {
            var a = r.detail.a || 0;
            return 'Measured: with the winch pulling 2 % over the true weight (' + kN(NEED) + ' vs ' + kN(W) + '), the tank speeds up at only **' + a.toFixed(3) + ' m/s²**. That small extra is all that accelerates it. With the pull equal to W, a = (T − W)/m = 0 and it would rise at a steady speed.';
          });
        },
        reveal: 'Reading carefully means matching the situation to theory you know: **a tank on a cable at a = 0 is a particle in equilibrium**, so the cable has to carry its weight. Everything else in the brief is only useful if it helps find that weight.'
      },
      {
        type: 'classify', id: 'H11.read',
        text: 'Go through Juno\'s brief. Which numbers do you actually need to find the weight and size the cable?',
        bins: ['Use it', 'Not needed'],
        items: [
          { t: 'Inside diameter **' + D_MM + ' mm**', bin: 'Use it', why: 'The volume of water depends on the area of the base, so on d².' },
          { t: 'Water depth **' + H_MM + ' mm**', bin: 'Use it', why: 'Only the water that is actually in there has weight.' },
          { t: 'Tank height **' + TANK_H_MM + ' mm**', bin: 'Not needed', why: 'The tank is part full. Its full height would count water that isn\'t there.' },
          { t: 'Stamped capacity **20 000 L**', bin: 'Not needed', why: 'That is the volume brim-full. It\'s a good cross-check on the diameter, but it isn\'t what you\'re lifting.' },
          { t: 'Water density **1000 kg/m³**', bin: 'Use it', why: 'It turns the volume of water into a mass.' },
          { t: 'Empty tank mass **' + M_DRUM + ' kg**', bin: 'Use it', why: 'The steel goes up with the water.' },
          { t: 'Plate thickness **6 mm**', bin: 'Not needed', why: 'The steel is already in the 1100 kg. Using it again would count it twice.' },
          { t: 'Tower height **9.0 m**', bin: 'Not needed', why: 'At a = 0 the tension doesn\'t depend on how high you lift.' },
          { t: 'Air temperature **14 °C**', bin: 'Not needed', why: 'Water density changes by about 0.1 % between 4 °C and 14 °C, far below 3 s.f.' },
          { t: 'The **2 %** extra pull to start the lift', bin: 'Use it', why: 'The cable has to survive the start, not just the steady part.' }
        ]
      },

      /* -------------------------------------------------- phase 2: tabulate */
      {
        type: 'say', who: 'hask',
        hud: ['JOB BOARD · phase 2 of 5: TABULATE', 'list the data, draw it big'],
        text: '**Phase 2: tabulate.** Write the data you kept in one table, in base units, and sketch the tank big enough to label: a rectangle (the side view of the cylinder), the diameter across the top, a waterline partway up with the depth marked, and the cable straight up from the lid.\n\nA big sketch is where you catch "that\'s the tank height, not the water".'
      },
      {
        type: 'task', id: 'H11.table', who: 'hask', title: 'Fill the data table',
        text: 'Convert the dimensions to **base units** before you use them. (No s.f. check here; you\'re just copying data.)',
        inputs: [
          {
            key: 'd', label: 'd, inside diameter (in m)', placeholder: 'e.g. 1.00 m',
            // 2600 mm / 1000 = 2.60 m
            spec: { value: D, unit: 'm', sf: null, expressIn: 'm' },
            answer: '2.60 m',
            wrong: [{ input: '2600 mm', kind: 'form' }, { input: '2600 m', kind: 'prefix' }, { input: '1.30 m', kind: 'algebra' }]
          },
          {
            key: 'h', label: 'h, water depth (in m)', placeholder: 'e.g. 1.00 m',
            // 3200 mm / 1000 = 3.20 m
            spec: { value: H, unit: 'm', sf: null, expressIn: 'm', mistakes: [{ ratio: TANK_H_MM / H_MM, kind: 'concept', msg: 'That is the height of the tank. You want the depth of the water.' }] },
            answer: '3.20 m',
            wrong: [{ input: '3.80 m', kind: 'concept' }, { input: '3.2 mm', kind: 'prefix' }]
          },
          {
            key: 'mt', label: '$m_{\\t{tank}}$, empty tank mass (in kg)', placeholder: 'e.g. 100 kg',
            spec: { value: M_DRUM, unit: 'kg', sf: null, expressIn: 'kg' },
            answer: '1100 kg',
            wrong: [{ input: '1.1 Mg', kind: 'form' }, { input: '10.8 kN', kind: 'concept' }]
          }
        ],
        hints: [
          'The prefix *milli* means 10⁻³.',
          'Divide millimetres by 1000 to get metres. The tank mass is already in kg.',
          '2600 mm = 2.60 m, 3200 mm = 3.20 m, and $m_{\\t{tank}}$ = 1100 kg.'
        ],
        consequence: function (ctx, a) {
          // Sketch at 1:20 on the job board: the drawn width and waterline come
          // straight from the player's numbers.
          var d = a.d.si, h = a.h.si;
          if (d == null || h == null) return Promise.resolve('Hask\'s pencil hovers over the board, waiting for numbers.');
          var wcm = d / 20 * 100, hcm = h / 20 * 100, full = TANK_H_MM / 1000 / 20 * 100;
          var msg = 'At 1:20 your sketch is **' + t3(wcm) + ' cm** wide with the waterline **' + t3(hcm) + ' cm** up a ' + t3(full) + ' cm tank.';
          if (wcm > 200) msg += ' That won\'t fit on the board. Somewhere a millimetre became a metre.';
          else if (Math.abs(h - TANK_H_MM / 1000) < 1e-6) msg += ' The waterline is drawn at the very top, but the brief says the tank is only part full.';
          else if (hcm > full + 1e-9) msg += ' The water is drawn higher than the tank. Something\'s off.';
          return Promise.resolve(msg);
        },
        explain: 'Your data table, pinned to the board:\n\n- inside diameter, *d* = 2.60 m\n- water depth, *h* = 3.20 m\n- water density, *ρ* = 1000 kg/m³\n- empty tank, $m_{\\t{tank}}$ = 1100 kg\n- gravity, *g* = 9.81 m/s²\n- start-up pull = 1.02 × *W*'
      },

      /* ----------------------------------------------------- phase 3: apply */
      {
        type: 'predict', who: 'hask',
        hud: ['JOB BOARD · phase 3 of 5: APPLY', 'equations, checked for homogeneity'],
        q: '**Phase 3: apply.** A crew member scribbles four candidates for the volume of water. Before you check any geometry, which ones can you throw out just by looking at the **units**? Pick the one that survives the units check **and** is the right formula.',
        choices: [
          { t: '$V = \\pi d h$', why: 'That has units m·m = m², an area (it\'s the curved side of the cylinder). A volume needs m³.' },
          { t: '$V = \\frac{\\pi}{4}d^2 + h$', why: 'You can\'t add m² to m. Any equation that adds different units is wrong, whatever the numbers say.' },
          { t: '$V = \\pi d^2 h$', why: 'The units are fine (m³), so homogeneity doesn\'t catch it. But the base area is πr² with r = d/2, which is (π/4)d². This one is 4 times too big. Homogeneity is a necessary check, not a sufficient one.' },
          { t: '$V = \\frac{\\pi}{4}d^2 h$', correct: true, why: 'm²·m = m³, and the base area is π(d/2)² = (π/4)d². Both checks pass.' }
        ],
        reveal: 'A dimensionally inconsistent equation is always wrong. A consistent one can still be wrong (a lost factor of 4 has no units). So check units first because it\'s fast, then check the physics.'
      },
      {
        type: 'derive', title: 'From tank to cable load',
        intro: 'Chain the principles together, checking units at every line.',
        lines: [
          { eq: 'V = \\frac{\\pi}{4}d^{2}h \\qquad [\\u{m^2}\\cdot\\u{m}] = [\\u{m^3}]', why: 'Volume of water: base area times depth.' },
          {
            eq: 'm_{w} = \\rho V \\qquad [\\u{kg/m^3}]\\cdot[\\u{m^3}] = [\\u{kg}]', why: 'Density times volume gives the mass of water.',
            ask: { q: 'How do you get from a volume of water to its mass, keeping the units consistent?', choices: [
              { t: '$m_w = \\rho V$', correct: true, why: 'kg/m³ × m³ = kg. The m³ cancel.' },
              { t: '$m_w = V / \\rho$', why: 'm³ ÷ (kg/m³) = m⁶/kg. That isn\'t a mass.' },
              { t: '$m_w = \\rho g V$', why: 'That gives kg·m/s² = N: the weight of the water, not its mass. Useful, but one step early.' }
            ] }
          },
          {
            eq: 'm = m_{w} + m_{\\t{tank}} \\qquad [\\u{kg}] = [\\u{kg}] + [\\u{kg}]', why: 'The steel shell goes up too.',
            ask: { q: 'Can you add the tank\'s 1100 kg straight to the water mass?', choices: [
              { t: 'Yes, both are masses in kg.', correct: true, why: 'Same units on every term, so the sum is homogeneous.' },
              { t: 'No, convert the 1100 kg to newtons first.', why: 'Then you\'d be adding N to kg, which isn\'t allowed. Add masses, then take the weight once.' }
            ] }
          },
          {
            eq: 'W = mg \\qquad [\\u{N}] = [\\u{kg}]\\cdot[\\u{m/s^2}]', why: 'Weight from mass (Eq. 1–4). A newton is a kg·m/s².',
            ask: { q: 'Which g?', choices: [
              { t: '9.81 m/s²', correct: true, why: 'Everything is in SI, so g = 9.81 m/s².' },
              { t: '32.2 ft/s²', why: 'That is g in FPS. Mixing it with kg and m breaks homogeneity.' }
            ] }
          },
          { eq: 'T_{\\t{start}} = 1.02\\,W', why: 'The cable must survive the start of the lift, a little over the weight.' }
        ],
        outro: 'Each line has the same units on both sides. If one hadn\'t, you would know there was an algebra slip before touching a calculator.'
      },

      /* ----------------------------------------------------- phase 4: solve */
      {
        type: 'task', id: 'H11.tank', who: 'hask', title: 'Solve: volume, mass, weight',
        hud: ['JOB BOARD · phase 4 of 5: SOLVE', 'keep full precision, report 3 s.f.'],
        text: '**Phase 4: solve.** Use your table and equations. Keep every digit on the calculator until the end, then report each answer to **3 s.f.** in proper SI form. When you submit, the winch governor is set to 2 % over your weight and tries the lift.',
        inputs: [
          {
            key: 'V', label: 'V, volume of water', placeholder: 'e.g. 1.23 m^3',
            spec: {
              value: V, unit: 'm^3', sf: 3, form: 'si-units',
              mistakes: [
                { ratio: TANK_H_MM / H_MM, kind: 'concept', msg: 'You used the tank height. The water is only 3.20 m deep.' },
                { ratio: 4, kind: 'algebra', msg: 'Four times too big: the base area is (π/4)d², or πr² with r = d/2.' }
              ]
            },
            answer: '17.0 m^3',
            wrong: [{ input: '68.0 m^3', kind: 'algebra' }, { input: '20.2 m^3', kind: 'concept' }, { input: '1.70(10^10) m^3', kind: 'prefix' }]
          },
          {
            key: 'm', label: 'm, total mass lifted', placeholder: 'e.g. 1.23 Mg',
            spec: {
              value: M, unit: 'kg', sf: 3, form: 'si',
              mistakes: [{ ratio: M_WATER / M, kind: 'concept', msg: 'That is the water on its own. The 1100 kg tank goes up too.' }]
            },
            answer: '18.1 Mg',
            wrong: [{ input: '17.0 Mg', kind: 'concept' }, { input: '177 kN', kind: 'concept' }, { input: '18100 kg', kind: 'sigfig' }]
          },
          {
            key: 'W', label: 'W, weight on the cable', placeholder: 'e.g. 1.23 kN',
            spec: {
              value: W, unit: 'N', sf: 3, form: 'si',
              mistakes: [{ ratio: M_WATER / M, kind: 'concept', msg: 'That is the weight of the water alone. Add the tank\'s mass before multiplying by g.' }]
            },
            answer: '177 kN',
            wrong: [{ input: '18.1 Mg', kind: 'concept' }, { input: '17.7 kN', kind: 'prefix' }, { input: '167 kN', kind: 'concept' }, { input: '177000 N', kind: 'sigfig' }]
          }
        ],
        hints: [
          'Work in base units: d = 2.60 m, h = 3.20 m. Volume first, then mass, then weight.',
          '$V = \\frac{\\pi}{4}d^2h$, then $m = \\rho V + m_{\\t{tank}}$, then $W = mg$. Use a prefix so the number sits between 0.1 and 1000.',
          '$V = 0.7854 \\times 2.60^2 \\times 3.20 = 16.99\\u{ m^3}$ → 17.0 m³. $m = 16\\,990 + 1100 = 18\\,090\\u{ kg}$ → 18.1 Mg. $W = 18\\,090 \\times 9.81 = 177\\,460\\u{ N}$ → 177 kN.'
        ],
        consequence: function (ctx, a) {
          var claimed = a.W.si;
          if (claimed == null || !(claimed > 0)) return Promise.resolve('The winch governor needs a force in newtons. Nothing moves.');
          return governorTest(ctx, claimed, 4).then(function (r) {
            var head = 'Governor set to 1.02 × your W = **' + kN(PULL * claimed) + '**; the true weight is ' + kN(W) + '. ';
            if (r.outcome === 'stalled') return head + 'The winch strained and **stalled**: the tank never left the pad. Your weight is too small.';
            if (r.outcome === 'slammed') return head + 'The tank shot up and **slammed** into the gantry head at ' + Math.abs(r.detail.impact).toFixed(1) + ' m/s.';
            return head + 'The tank lifted off gently, accelerating at ' + (r.detail.a || 0).toFixed(3) + ' m/s², and was ' + r.detail.y.toFixed(2) + ' m up after 4 s.';
          });
        },
        explain: 'Full precision through the chain, rounding once at the end: **V = 17.0 m³**, **m = 18.1 Mg**, **W = 177 kN**. Round V to 17.0 first and carry it, and the weight comes out a hair different. That is why you only round the final answer.'
      },

      /* ----------------------------------------------------- phase 5: judge */
      {
        type: 'predict', who: 'hask',
        hud: ['JOB BOARD · phase 5 of 5: JUDGE', 'does the answer make sense?'],
        q: '**Phase 5: judge.** 18.1 tonnes. Is that believable for a tank you could park a car beside? A car is about **1.5 t**. Make the quickest sanity check you can.',
        choices: [
          { t: 'Too heavy. A tank that size can\'t weigh as much as 12 cars.', why: 'Feels wrong, but check it: one cubic metre of water is a tonne. The box around this tank is 2.6 × 2.6 × 3.2 ≈ 21.6 m³ of space, so up to about 22 t of water if it were a box.' },
          { t: 'About right. A box 2.6 × 2.6 × 3.2 m holds 21.6 t of water; a cylinder fills π/4 ≈ 79 % of it, about 17 t, plus a tonne of steel.', correct: true, why: 'That\'s the check: a quick bound from the box around the tank, and a tonne per cubic metre. It lands within a few percent of 18.1 t, about a dozen cars.' },
          { t: 'Can\'t tell without redoing the whole calculation.', why: 'You almost never need to. A rough bound from something you already know (a tonne per cubic metre of water, a car\'s mass) catches errors of 2×, 4× or 1000×, which are the ones that drop tanks.' }
        ],
        reveal: 'Technical judgment means comparing the answer with something you trust: a bounding box, a known mass, last week\'s job. Errors from dropped prefixes or a missing ½ are never small, so a rough check catches them.'
      },
      {
        type: 'classify', id: 'H11.judge',
        text: 'Four crew members worked the same job and pinned their results to the board. Without redoing the maths, which are believable and which should be sent back?',
        bins: ['Reasonable', 'Send it back'],
        items: [
          { t: 'Kit: total mass **18.1 Mg**', bin: 'Reasonable', why: 'A dozen cars, and inside the 22 t bounding box. Fits.' },
          { t: 'Marlow: total mass **69.1 Mg**', bin: 'Send it back', why: 'That\'s more water than fits in the box around the tank (21.6 m³). Looks like d was used as the radius, which makes the area 4 times too big.' },
          { t: 'Sanne: total mass **1.70(10¹⁰) kg**', bin: 'Send it back', why: 'Seventeen million tonnes, bigger than a supertanker. The millimetres went in as metres: 1000³ = 10⁹ too much.' },
          { t: 'Dov: total mass **1.84 Mg**', bin: 'Send it back', why: 'Less than two cars, but the tank holds about 17 m³ of water at a tonne per cubic metre. It looks like the mass was divided by g.' },
          { t: 'Kit: cable load **177 kN**', bin: 'Reasonable', why: 'Roughly 10 N per kg on 18.1 t is about 180 kN. Fits.' },
          { t: 'Dov: cable load **17.7 kN**', bin: 'Send it back', why: 'Ten times too small for an 18 t load. A prefix slipped.' }
        ]
      },
      {
        type: 'task', id: 'H11.cable', who: 'juno', title: 'Pick the cable',
        hud: ['YARD LIST · wire rope and chain', 'A 150 kN · B 36 000 lb · C 45 kip · D 250 kN · E 90 kip'],
        text: 'The yard tags are a mess of units:\n\n' +
          CABLES.map(function (c) { return '- ' + c.name + ': **' + c.tag + '**'; }).join('\n') + '\n\n' +
          'Choose the **lightest** one that survives the start of the lift (1.02 × W). Enter its rating **in kN** so everything on the board is in one unit. The crew rigs whichever cable matches your figure and lifts the real tank.',
        inputs: [{
          key: 'R', label: 'Rating of the cable you choose (in kN)', placeholder: 'e.g. 123 kN',
          // need 1.02 * 177.46 = 181.0 kN.
          // A 150 kN, B 36 000 * 4.448 = 160.1 kN, C 45 000 * 4.448 = 200.2 kN,
          // D 250 kN, E 90 000 * 4.448 = 400.3 kN. Lightest above 181 kN: C, 200 kN.
          spec: {
            value: BEST.rating, unit: 'N', sf: null, expressIn: 'kN', tol: 0.005,
            mistakes: [
              { ratio: CABLES[1].rating / BEST.rating, kind: 'concept', msg: 'Rope B is 36 000 lb × 4.448 = 160 kN, below the 181 kN start-up load. Big number, small rope.' },
              { ratio: CABLES[0].rating / BEST.rating, kind: 'concept', msg: 'Rope A, 150 kN, is under even the steady 177 kN weight.' },
              { ratio: CABLES[3].rating / BEST.rating, kind: 'concept', msg: 'Rope D holds, but rope C (45 kip = 200 kN) is lighter and still enough.' },
              { ratio: CABLES[4].rating / BEST.rating, kind: 'concept', msg: 'The chain holds, but it\'s twice what you need. Rope C (45 kip = 200 kN) does the job.' },
              { ratio: 45e3 / BEST.rating, kind: 'conversion', msg: '45 kip is 45 000 lb, and each lb is 4.448 N. That\'s 200 kN, not 45 kN.' }
            ]
          },
          answer: '200 kN',
          wrong: [{ input: '160 kN', kind: 'concept' }, { input: '45 kip', kind: 'form' }, { input: '250 kN', kind: 'concept' }, { input: '45 kN', kind: 'conversion' }]
        }],
        hints: [
          'Put every tag in kN first. 1 kip = 1000 lb and 1 lb = 4.448 N.',
          'The start-up load is 1.02 × 177.46 kN = 181 kN. Convert B and C, then take the smallest rating above 181 kN.',
          'B: 36 000 × 4.448 = 160 kN (too weak). C: 45 000 × 4.448 = 200 kN. D is 250 kN, E is 400 kN. Rope C, **200 kN**.'
        ],
        consequence: function (ctx, a) {
          var R = a.R.si;
          if (R == null || !(R > 0)) return Promise.resolve('The crew waits by the rack for a rating.');
          // Match the figure to a tag (within 1 %); otherwise the crew takes the
          // smallest cable rated at least that much, the yard's usual rule.
          var cable = CABLES.filter(function (c) { return Math.abs(c.rating - R) <= 0.01 * c.rating; })[0] ||
            SE.physics.haul.pick(CABLES, R);
          return liftTest(ctx, cable).then(function (r) {
            var head = 'Crew rigged **' + cable.name + '** (' + cable.tag + ' = ' + kN(cable.rating) + ') and pulled ' + kN(NEED) + '. ';
            if (r.outcome === 'snapped') return head + '**It parted** as the winch took up the load, and the tank crashed back onto the pad. The seams split. You\'ll be pumping that water again.';
            var margin = cable.rating / NEED;
            if (cable !== BEST && cable.rating > BEST.rating) return head + 'It lifted, with ' + margin.toFixed(2) + ' × the load. But it\'s heavier than rope C, and it took three people to drag it to the tower.';
            return head + 'The tank rose smoothly with the cable at ' + Math.round(100 / margin) + ' % of its rating.';
          });
        },
        explain: 'In one unit the yard list reads 150, 160, 200, 250 and 400 kN. Against 181 kN, rope C is the lightest that will do. The trap was B: "36 000" looks huge until you remember a pound is only 4.448 N.'
      },

      /* ---------------------------------------------------- name the loop */
      {
        type: 'reveal', kicker: 'Procedure', title: 'General procedure for analysis', hud: [],
        text: 'You just ran it:\n\n' +
          '- **1 · Read** the problem carefully and connect the physical situation to the theory (a hanging tank at a = 0).\n' +
          '- **2 · Tabulate** the data and draw any diagrams to a large scale (the table and the sketch).\n' +
          '- **3 · Apply** the relevant principles in mathematical form, keeping every equation dimensionally homogeneous (V, ρV, mg).\n' +
          '- **4 · Solve** the equations and report the answer to no more than **3 s.f.** (177 kN).\n' +
          '- **5 · Judge** the answer with technical judgment and common sense (a dozen cars, inside the box).\n\n' +
          'Work neatly. A tidy page makes for tidy thinking, and the other way round.',
        formula: 'ch01.procedure'
      },

      /* ------------------------------------------------- chapter review */
      {
        type: 'say', who: 'hask',
        text: 'Before you leave the depot, one last pass over everything in this act. Some of these are the right idea and some are the mistake I see most often. Sort them.'
      },
      {
        type: 'classify', id: 'H11.review',
        text: '**Chapter 1 review.** True or false?',
        bins: ['True', 'False'],
        items: [
          { t: 'A cart rolling at a steady 3 m/s with balanced forces on it is a statics problem.', bin: 'True', why: 'Statics covers bodies at rest **or** moving at constant velocity.' },
          { t: 'Statics only deals with bodies that are completely at rest.', bin: 'False', why: 'Constant velocity counts too. The test is a = 0, not v = 0.' },
          { t: 'Treating the tank as a particle keeps its mass but ignores its size.', bin: 'True', why: 'That\'s the particle idealization.' },
          { t: 'A rigid body bends a little under load, just not much.', bin: 'False', why: 'A rigid body doesn\'t deform at all. Real bodies do, and that\'s for deformable-body mechanics.' },
          { t: 'A force is a push or a pull of one body on another.', bin: 'True', why: 'By contact, or at a distance like gravity.' },
          { t: 'A concentrated force is spread evenly over the whole surface it touches.', bin: 'False', why: 'A concentrated force is taken to act at a **point**, which is fair when the contact area is small compared with the body.' },
          { t: 'Action and reaction act on the same body, so they cancel out.', bin: 'False', why: 'Newton\'s third law: they are equal, opposite and collinear, but they act on **different** bodies.' },
          { t: 'With no unbalanced force, a moving particle keeps going in a straight line at constant speed.', bin: 'True', why: 'Newton\'s first law.' },
          { t: 'Hauled up a mountain, the tank would have less mass.', bin: 'False', why: 'Mass doesn\'t change with location. Its **weight** would drop a little, because g falls with height.' },
          { t: 'The tank\'s weight depends on how far it is from the Earth\'s centre.', bin: 'True', why: 'W = mg and g = GMₑ/r², so weight depends on elevation.' },
          { t: 'The newton is one of the SI base units.', bin: 'False', why: 'The newton is **derived**: N = kg·m/s². The base units are m, s and kg.' },
          { t: '1 μm = 10⁻⁶ m, and 1 Gm = 10⁹ m.', bin: 'True', why: 'Micro is 10⁻⁶, giga is 10⁹.' },
          { t: 'A load per length is best written in N/mm.', bin: 'False', why: 'Avoid prefixes in a denominator (the kg is the exception). Write kN/m.' },
          { t: 'Round each step to 3 s.f. as you go so the numbers stay tidy.', bin: 'False', why: 'Keep full precision through the calculation and round only the final answer.' },
          { t: 'If one term in your equation comes out in m² and another in m, there\'s an algebra slip somewhere.', bin: 'True', why: 'Every term of a correct equation has the same units.' },
          { t: '4.375 rounded to 3 s.f. is 4.37.', bin: 'False', why: 'The dropped digit is exactly 5 and the digit before it (7) is odd, so round up: 4.38.' },
          { t: '2.865 rounded to 3 s.f. is 2.86.', bin: 'True', why: 'Exactly 5 after an even digit (6): leave it.' }
        ]
      },

      /* ------------------------------------------------------- go deeper */
      {
        type: 'deeper', title: 'Why riggers never use the breaking strength',
        teaser: 'A real crane crew would never hang an 18 t tank on a rope that breaks at 20 t. Here\'s what they do instead.',
        steps: [
          { type: 'say', who: 'hask', text: 'Real rope and chain carry a **working load limit** (WLL): the breaking strength divided by a design factor. For steel wire rope on lifting gear the factor is usually **5**. So a rope that breaks at 200 kN is only rated to lift 40 kN.\n\nThe factor covers what the tidy calculation leaves out: worn and kinked strands, the rope bending round a sheave, jerks at the start of a lift, a swinging load.' },
          {
            type: 'predict', who: 'hask',
            q: 'With a design factor of 5, what minimum breaking strength would our 177 kN tank need?',
            choices: [
              { t: 'About 181 kN, the start-up load.', why: 'That\'s with no margin at all, like the yard list. With a factor of 5 you multiply.' },
              { t: 'About 890 kN.', correct: true, why: '5 × 177.46 kN ≈ 887 kN. None of the yard cables would pass. A real crew would use several falls of rope or a much heavier one.' },
              { t: 'About 35 kN.', why: 'That divides by 5. The WLL is the breaking strength divided by the factor, so the breaking strength has to be 5 times the load.' }
            ]
          }
        ]
      },

      /* --------------------------------------------------------- sandbox */
      {
        type: 'sandbox', scene: hoistScene(),
        text: 'The tank is on the ground at the foot of the gantry. Try each cable from the yard list on the real lift, and see what the governor does with a few wrong weights.',
        prompts: ['Which is the weakest cable that survives the start of the lift?', 'Set the governor from the water-only weight, then from a prefix slip. What happens?', 'What happens with the tank filled to the brim?'],
        actions: CABLES.map(function (c) {
          return { label: 'Lift on ' + c.id + ' (' + c.tag + ')', run: function (ctx) {
            return liftTest(ctx, c).then(function (r) { return c.name + ' (' + kN(c.rating) + '): ' + (r.outcome === 'snapped' ? '**snapped**.' : 'held, at ' + Math.round(100 * NEED / c.rating) + ' % of its rating.'); });
          } };
        }).concat([
          { label: 'Governor at water-only weight', run: function (ctx) {
            var Ww = M_WATER * G;
            return governorTest(ctx, Ww, 4).then(function (r) { return 'Governor at 1.02 × ' + kN(Ww) + ' (no tank steel): **' + r.outcome + '**.'; });
          } },
          { label: 'Governor at 10 × the weight', run: function (ctx) {
            return governorTest(ctx, 10 * W, 4).then(function (r) { return 'Governor at ' + kN(PULL * 10 * W) + ': **' + r.outcome + '**' + (r.detail.impact ? ' at ' + Math.abs(r.detail.impact).toFixed(1) + ' m/s' : '') + '.'; });
          } },
          { label: 'Filled to the brim', run: function (ctx) {
            var Mf = RHO * Math.PI / 4 * D * D * TANK_H_MM / 1000 + M_DRUM;
            var s = ctx.setScene('hoist', { mass: Mf, label: 'brim-full tank', mode: 'lift', rating: BEST.rating, height: 9, hookHeight: 3 });
            return s.run(PULL * Mf * G, { duration: 4 }).then(function (r) { return 'Brim-full: ' + t3(Mf / 1000) + ' Mg, start-up load ' + kN(PULL * Mf * G) + ' on rope C (' + kN(BEST.rating) + '): ' + (r.outcome === 'snapped' ? '**snapped**. Read the brief again tomorrow.' : 'held.'); });
          } }
        ])
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
})(globalThis.SE);
