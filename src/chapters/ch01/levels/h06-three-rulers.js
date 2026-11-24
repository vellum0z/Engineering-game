/*
 * H6 · Three Rulers: why only three of the four mechanical units can be
 * chosen freely, base versus derived units, the SI (m, s, kg; newton
 * derived) and U.S. Customary FPS (ft, s, lb; slug derived) systems, weight
 * in newtons (W = mg, g = 9.81 m/s^2) and mass in slugs (m = W/g,
 * g = 32.2 ft/s^2). Course section 1.3, Eq. 1-4, 1-5 and Table 1-1.
 */
(function (SE) {
  'use strict';

  var G = 9.81, G_FPS = 32.2, LBF = 4.448, SLUG = 14.59;

  // ---------------------------------------------------------------------
  // The quartermaster's homemade units. A "heave" is defined as one strong
  // settler's pull on the rope, which is a force chosen independently of the
  // other three. That breaks F = ma unless a fudge factor k is carried.
  // ---------------------------------------------------------------------
  var PACE = 0.8;      // m
  var BREATH = 3;      // s
  var SACK = 40;       // kg
  var HEAVE = 250;     // N
  var PUSH_T = 1;      // s of pushing in the rail test
  // One heave on one sack: a = 250 / 40 = 6.25 m/s^2.
  // In ledger units: 6.25 m/s^2 x (3 s)^2 / 0.8 m = 70.3 pace/breath^2.
  var A_LEDGER = (HEAVE / SACK) * BREATH * BREATH / PACE;            // 70.31
  var K_LEDGER = 1 / A_LEDGER;                                       // 0.0142
  // Derived heave: the force giving 1 sack 1 pace/breath^2
  //   = 40 kg x 0.8 m / (3 s)^2 = 3.556 N.
  var HEAVE_DERIVED = SACK * PACE / (BREATH * BREATH);

  function sig(x, n) { return SE.sigfig.roundSig(x, n).text; }

  // ---------------------------------------------------------------------
  // Spring-scale calibration. The salvaged spring's stiffness is hidden from
  // the player; the reference kilograms are the only honest standard.
  // ---------------------------------------------------------------------
  var CAL_K = 950;                  // N/m, true stiffness of the salvaged spring
  var REF_A = 3, REF_B = 8;         // kg, the two reference masses
  var W_REF_A = REF_A * G;          // 3 x 9.81 = 29.43 N  -> 29.4 N
  var W_REF_B = REF_B * G;          // 8 x 9.81 = 78.48 N  -> 78.5 N
  var TEST_MASS = 6.5;              // kg, the ration crate weighed after calibration
  var CAL_SCENE = { type: 'scales', params: { mode: 'calibrate', k: CAL_K, refMass: REF_A, capacity: 400, tol: 0.02, units: 'SI', label: 'REF' } };

  // ---------------------------------------------------------------------
  // The new arrival. Teo's weight comes from the trading post's old platform
  // scale, which reads in pounds.
  //   (a) m = W/g = 172 / 32.2 = 5.3416 slug          -> 5.34 slug
  //   (b) m = 5.3416 slug x 14.59 kg/slug = 77.934 kg -> 77.9 kg
  //   (c) W = 172 lb x 4.448 N/lb = 765.06 N          -> 765 N
  //       (check: 77.934 kg x 9.81 = 764.5 N, same to 3 s.f.)
  // ---------------------------------------------------------------------
  var TEO_LB = 172;
  var TEO_SLUG = TEO_LB / G_FPS;            // 5.3416 slug
  var TEO_KG = TEO_SLUG * SLUG;             // 77.934 kg
  var TEO_N = TEO_LB * LBF;                 // 765.06 N
  var HARNESS_SF = 1.5, LIFT_FACTOR = 1.2;  // rope rating / logged weight, lift tension / true weight

  // Prove-it givens.
  //   2.50 kg x 9.81 = 24.525 N -> 24.5 N (first dropped digit is 2)
  //   48.3 lb / 32.2 = 1.50 slug -> stored in SI as 1.50 x 14.59 = 21.885 kg
  var PROVE_KG = 2.5, PROVE_LB = 48.3;

  var RAIL = { type: 'track', params: { surface: 'ice', length: 30, trail: true, showVectors: true, bodies: [{ id: 'sack', m: SACK, x: 3, v: 0, mu: 0, label: '1 sack (40 kg)', kind: 'sled' }] } };

  SE.content.registerLevel('ch01', {
    id: 'H6', order: 6, title: 'Three Rulers',
    subtitle: 'Base units, derived units, SI and FPS',
    sections: ['1.3'],
    minutes: 20,
    intro: [
      'The quartermaster\'s ledger is a mess. Somebody measured rope in **paces**, cook times in **breaths**, grain in **sacks** and pulling power in **heaves**: one heave being whatever Big Ros can pull on a rope.',
      'Hask taps the page. "Four quantities, four rulers, all made up. Sounds fair. It isn\'t. Newton\'s second law ties those four together, and it won\'t let you pick all of them. Let\'s find out why before we lean on a scale that\'s lying to us."'
    ].join('\n\n'),
    goals: [
      'Explain why only **three** of length, time, mass and force can have freely chosen units',
      'Name the base and derived units of the **SI** and **FPS** systems (Table 1–1)',
      'Find weight in newtons with $W = mg$ and mass in slugs with $m = W/g$'
    ],
    scene: RAIL,
    proveIt: [
      {
        id: 'H6.prove-si', text: 'A sack of rice has a mass of **2.50 kg**. What does it weigh at the standard location, in SI units?',
        // 2.50 x 9.81 = 24.525 N -> 24.5 N
        inputs: [{ key: 'W', label: 'Weight of the sack', placeholder: 'e.g. 12.3 N', spec: { value: PROVE_KG * G, unit: 'N', sf: 3, form: 'si', mistakes: [{ ratio: 1 / (G * G), kind: 'concept', msg: 'That divides the mass by g. Weight is mass **times** g.' }] }, answer: '24.5 N', wrong: [{ input: '2.50 N', kind: 'concept' }, { input: '0.255 N', kind: 'concept' }] }]
      },
      {
        id: 'H6.prove-fps', text: 'A drum of diesel weighs **48.3 lb** at the standard location. What is its mass in FPS units?',
        // 48.3 / 32.2 = 1.50 slug
        inputs: [{ key: 'm', label: 'Mass of the drum', placeholder: 'e.g. 2.00 slug', spec: { value: (PROVE_LB / G_FPS) * SLUG, unit: 'kg', sf: 3, expressIn: 'slug' }, answer: '1.50 slug', wrong: [{ input: '1560 slug', kind: 'conversion' }, { input: '48.3 slug', kind: 'concept' }] }]
      }
    ],
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Here\'s the ledger\'s system:\n\n- **1 pace** = 0.8 m of rope\n- **1 breath** = 3 s\n- **1 sack** = 40 kg of grain\n- **1 heave** = Ros\'s pull, about 250 N\n\nEach one was picked on its own, by whoever was holding the pencil. We\'ve got a sack on a sled out on the ice and Ros on the rope. Let\'s see if the ledger agrees with Newton.'
      },
      {
        type: 'predict', who: 'hask', scene: RAIL,
        q: 'Newton\'s second law says force equals mass times acceleration. So if Ros pulls **1 heave** on **1 sack**, a tidy ledger would hope for an acceleration of **1 pace per breath²**.\n\nWhat will the sled actually do?',
        choices: [
          { t: 'Exactly 1 pace/breath². One times one is one.', why: 'That only works if the heave was defined to make it work. Ros\'s pull was picked independently, so the numbers have no reason to line up.' },
          { t: 'Some other number, because the four units were chosen independently.', correct: true, why: 'Right. Nothing forced the heave to match the sack, pace and breath, so $F = ma$ comes out with a stray number in it.' },
          { t: 'It depends on how hard Ros feels like pulling.', why: 'Ros pulls exactly one heave, by definition. The trouble is in the definitions themselves.' }
        ],
        run: function (ctx) {
          return ctx.scene.run({ duration: PUSH_T, settle: false, forces: { sack: HEAVE } }).then(function (r) {
            var aSI = r.detail.v / r.detail.time;
            var aLedger = aSI * BREATH * BREATH / PACE;
            return 'Measured: after ' + r.detail.time.toFixed(1) + ' s the sled is doing ' + r.detail.v.toFixed(2) + ' m/s, so **a = ' + aSI.toFixed(2) + ' m/s²**. In ledger units that\'s **' + sig(aLedger, 3) + ' paces/breath²**, not 1.';
          });
        },
        reveal: 'One heave on one sack gives about **70 paces per breath²**. The ledger\'s units don\'t fit $F = ma$.'
      },
      {
        type: 'derive', title: 'Where the stray number comes from',
        intro: 'Experiment only tells us force is **proportional** to mass times acceleration. The size of the constant depends on the units.',
        lines: [
          { eq: 'F \\propto m a \\quad \\implies \\quad F = k m a', why: 'Double the push, double the acceleration; double the mass, halve it. Proportional, with some constant k.' },
          { eq: '1\\u{ heave} = k(1\\u{ sack})(70.3\\u{ pace/breath^2})', why: 'Put in what the ice just measured.' },
          {
            eq: 'k = \\frac{1}{70.3} = 0.0142\\u{ heave·breath^2/(sack·pace)}', why: 'So every force calculation in the ledger has to carry this ugly factor.',
            ask: { q: 'How do we get rid of k for good?', choices: [
              { t: 'Measure Ros more carefully', why: 'A better measurement just gives a more precise ugly number.' },
              { t: 'Redefine one of the four units so that k = 1', correct: true, why: 'Yes. Keep three units and let F = ma define the fourth.' },
              { t: 'Use a bigger sack', why: 'k doesn\'t depend on the load. It\'s a property of the units.' }
            ] }
          },
          { eq: '1\\u{ new heave} ≡ (1\\u{ sack})(1\\u{ pace/breath^2}) = \\frac{(40\\u{ kg})(0.8\\u{ m})}{(3\\u{ s})^{2}} = 3.56\\u{ N}', why: 'Define the new heave as the force that gives one sack one pace/breath². Then $F = ma$ holds with no k. The new heave is a gentle fingertip push.' }
        ],
        outro: 'That\'s the whole idea. Length, time, mass and force are tied together by $F = ma$, so only **three** of their units can be chosen. Those three are **base units**. The fourth is **derived** from the equation.'
      },
      {
        type: 'predict', who: 'hask',
        q: 'Now you pick. Keep three of the ledger\'s units exactly as they are, and let $F = ma$ derive the fourth. Which one do you derive?',
        choices: [
          { t: 'Derive **force** (keep pace, breath, sack)', why: 'Force = mass × acceleration, so the force unit is built from the other three. This is the choice SI makes.' },
          { t: 'Derive **mass** (keep pace, breath, heave)', why: 'Mass = force ÷ acceleration. The U.S. Customary system makes this choice.' },
          { t: 'Derive **length** (keep breath, sack, heave)', why: 'Perfectly consistent, just unusual. Nobody wants a ruler whose length depends on Ros.' },
          { t: 'Derive **time** (keep pace, sack, heave)', why: 'Consistent too, though a clock defined by a pull and a sack would be hard to build.' }
        ],
        run: function (ctx, i) {
          var heave = HEAVE, sack = SACK, pace = PACE, breath = BREATH;
          // Each derived unit is solved from F = m L / T^2 with the other three fixed.
          if (i === 0) return 'Derived: **1 heave = 1 sack·pace/breath²** = ' + sig(sack * pace / (breath * breath), 3) + ' N.';
          if (i === 1) return 'Derived: **1 sack = 1 heave·breath²/pace** = ' + sig(heave * breath * breath / pace, 3) + ' kg. A very large sack.';
          if (i === 2) return 'Derived: **1 pace = 1 heave·breath²/sack** = ' + sig(heave * breath * breath / sack, 3) + ' m. A very long pace.';
          return 'Derived: **1 breath = √(sack·pace/heave)** = ' + sig(Math.sqrt(sack * pace / heave), 3) + ' s. A very short breath.';
        },
        reveal: 'Any one of the four can be the derived unit; the arithmetic always works. What matters is that exactly one is. The two systems engineers use made **different** picks.'
      },
      {
        type: 'reveal', kicker: 'Definition', title: 'SI units',
        scene: { type: 'scales', params: { mode: 'compare', mass: 1, k: 400, capacity: 60, units: 'SI', label: '1 kg' } },
        eq: '1\\u{ N} = (1\\u{ kg})(1\\u{ m/s^2}) \\quad \\implies \\quad \\u{N} = \\u{kg·m/s^2}',
        text: 'The **International System** (SI) keeps the **meter** (m), the **second** (s) and the **kilogram** (kg) as base units. Force is derived: one **newton** (N) is the force that gives a 1 kg mass an acceleration of 1 m/s².\n\nImportant point: in SI the newton is a **derived** unit; m, s and kg are **base** units.',
        formula: 'ch01.base-units'
      },
      {
        type: 'derive', title: 'Weight in newtons',
        intro: 'Weight is the force of gravity on a body, so in SI it has to be in newtons. Newton\'s second law with the acceleration due to gravity gives it.',
        lines: [
          { eq: 'F = m a \\quad \\implies \\quad W = m g', why: 'A falling body accelerates at g under its own weight alone.' },
          { eq: 'g = 9.80665\\u{ m/s^2} \\quad \\t{(measured, standard location)}', why: 'Sea level, latitude 45°.' },
          { eq: 'W = m g \\quad (g = 9.81\\u{ m/s^2})', tag: '1–4', why: 'For calculations we use 9.81, which is plenty for three significant figures.' },
          {
            eq: '1\\u{ kg} \\\to\ W = (1)(9.81) = 9.81\\u{ N}', why: 'One kilogram weighs 9.81 N.',
            ask: { q: 'So what does a **2 kg** body weigh?', choices: [
              { t: '2 N', why: 'That treats kilograms as if they were newtons. Mass and weight are different quantities.' },
              { t: '19.62 N', correct: true, why: '(2)(9.81) = 19.62 N.' },
              { t: '0.204 N', why: 'That divides by g instead of multiplying.' }
            ] }
          }
        ],
        outro: 'Roughly, a kilogram weighs ten newtons. An apple weighs about one.',
        formula: 'ch01.weight-si'
      },
      {
        type: 'reveal', kicker: 'Definition', title: 'U.S. Customary (FPS) units',
        // One slug (14.59 kg) on the spring scale reads 14.59 x 9.81 / 4.448 = 32.2 lb.
        scene: { type: 'scales', params: { mode: 'compare', mass: SLUG, k: 1500, capacity: 400, units: 'FPS', label: '1 slug' } },
        eq: '1\\u{ slug} = \\frac{1\\u{ lb}}{1\\u{ ft/s^2}} \\quad \\implies \\quad \\u{slug} = \\u{lb·s^2/ft}',
        text: 'The old trading posts use **U.S. Customary** units, the **FPS** system: the **foot** (ft), the **second** (s) and the **pound** (lb) are base units. Here **force** is a base unit and **mass** is derived. One **slug** is the mass that a 1 lb force accelerates at 1 ft/s².\n\nIt\'s the ledger puzzle again, solved the other way round from SI.',
        table: { head: ['System', 'Length', 'Time', 'Mass', 'Force'], rows: [['SI', 'meter (m)', 'second (s)', 'kilogram (kg)', 'newton (N)* = kg·m/s²'], ['U.S. Customary (FPS)', 'foot (ft)', 'second (s)', 'slug* = lb·s²/ft', 'pound (lb)']] },
        formula: 'ch01.table-units'
      },
      {
        type: 'derive', title: 'Mass in slugs',
        intro: 'In FPS you usually know a body\'s **weight** in pounds, because that\'s what the platform scale reads. Mass follows from the same law.',
        lines: [
          { eq: 'W = m g \\quad \\implies \\quad m = \\frac{W}{g}', why: 'Solve for mass.' },
          { eq: 'm = \\frac{W}{g} \\quad (g = 32.2\\u{ ft/s^2})', tag: '1–5', why: 'Standard g in feet per second squared.' },
          {
            eq: 'W = 32.2\\u{ lb} \\\to\ m = \\frac{32.2}{32.2} = 1\\u{ slug}', why: 'A body weighing 32.2 lb has a mass of one slug.',
            ask: { q: 'A crate weighs **96.6 lb**. Its mass?', choices: [
              { t: '96.6 slug', why: 'Pounds measure force in FPS, not mass. You still have to divide by g.' },
              { t: '3.00 slug', correct: true, why: '96.6 / 32.2 = 3.00 slug.' },
              { t: '3110 slug', why: 'That multiplies by g. Mass is weight **divided** by g.' }
            ] }
          }
        ],
        outro: 'A slug is a hefty lump: about 14.6 kg.',
        formula: 'ch01.weight-fps'
      },
      {
        type: 'classify', id: 'H6.base-derived',
        text: 'Base unit or derived unit? Think about which system each unit belongs to.',
        bins: ['Base unit', 'Derived unit'],
        items: [
          { t: 'kilogram (kg)', bin: 'Base unit', why: 'Mass is a base quantity in SI.' },
          { t: 'newton (N)', bin: 'Derived unit', why: 'N = kg·m/s², built from F = ma.' },
          { t: 'pound (lb)', bin: 'Base unit', why: 'In FPS, force is a base quantity.' },
          { t: 'slug', bin: 'Derived unit', why: 'slug = lb·s²/ft, built from F = ma.' },
          { t: 'foot (ft)', bin: 'Base unit', why: 'Length is a base quantity in FPS.' },
          { t: 'second (s)', bin: 'Base unit', why: 'Both systems keep the second as a base unit.' }
        ]
      },
      {
        type: 'try', who: 'hask', scene: CAL_SCENE,
        text: 'The settlement\'s best spring scale came out of a wrecked delivery van with its dial scraped blank. A spring stretches in proportion to the **force** on it, so its dial should be marked in **newtons**.\n\nWe have two honest reference masses: **3 kg** and **8 kg**. Hang each one (set the reference mass) and let the needle settle.',
        controls: ['refMass'],
        goalText: 'Hang the 3 kg and the 8 kg reference masses and let the needle settle on each',
        goal: function (ctx) {
          var s = ctx.scene;
          if (!s || !s.p || s.p.mode !== 'calibrate') return false;
          var seen = ctx.runner._h6seen = ctx.runner._h6seen || {};
          if (!s.springLive) seen[s.p.refMass] = true;
          return !!(seen[REF_A] && seen[REF_B]);
        },
        after: 'The 8 kg mass stretches the spring 8/3 times as far as the 3 kg one. The spring responds to their **weights**. Now the rack needs numbers.'
      },
      {
        type: 'task', id: 'H6.calibrate', who: 'hask', scene: CAL_SCENE,
        title: 'Mark the dial',
        text: 'Write the number for each pencil mark on the rack. The dial reads **force**, in SI, at Kettle Hollow (take it as the standard location). Then we\'ll weigh tonight\'s ration crate on it.',
        inputs: [
          // 3 x 9.81 = 29.43 N -> 29.4 N
          { key: 'W3', label: 'Mark for the **3 kg** reference mass', placeholder: 'e.g. 10.0 N', spec: { value: W_REF_A, unit: 'N', sf: 3, form: 'si', mistakes: [{ ratio: 1 / (G * G), kind: 'concept', msg: 'That divides the mass by g. Weight is mass **times** g.' }] }, answer: '29.4 N', wrong: [{ input: '3 N', kind: 'concept' }, { input: '0.306 N', kind: 'concept' }, { input: '29.43 N', kind: 'sigfig' }] },
          // 8 x 9.81 = 78.48 N -> 78.5 N
          { key: 'W8', label: 'Mark for the **8 kg** reference mass', placeholder: 'e.g. 10.0 N', spec: { value: W_REF_B, unit: 'N', sf: 3, form: 'si' }, answer: '78.5 N', wrong: [{ input: '8 N', kind: 'concept' }, { input: '78.4 N', kind: 'rounding' }] }
        ],
        hints: [
          'The marks are the **weights** of the reference masses, and weight is a force.',
          'Use Eq. 1–4: $W = mg$ with g = 9.81 m/s². Round to three significant figures.',
          '$W = (3)(9.81) = 29.43 \\to 29.4\\u{ N}$ and $W = (8)(9.81) = 78.48 \\to 78.5\\u{ N}$.'
        ],
        consequence: function (ctx, a) {
          // Pencil the player's numbers at the two needle positions, fit the
          // dial (W = k x through the origin), then weigh the ration crate.
          var w3 = a.W3 && a.W3.si != null ? a.W3.si : 0, w8 = a.W8 && a.W8.si != null ? a.W8.si : 0;
          var p = Object.assign({}, CAL_SCENE.params, { refMass: TEST_MASS, marks: [{ mass: REF_A, W: w3 }, { mass: REF_B, W: w8 }] });
          var s = ctx.setScene('scales', p);
          return s.run({ mass: TEST_MASS }).then(function (r) {
            var trueW = TEST_MASS * G;
            if (r.outcome === 'accurate') return 'The ration crate (6.5 kg) reads **' + sig(r.detail.reading, 3) + ' N** on your dial. Its true weight is ' + sig(trueW, 3) + ' N. The quartermaster finally trusts a scale.';
            if (r.outcome === 'overload') return 'The needle pegged on the stop. Your marks put the scale\'s range in the wrong place.';
            var rd = r.detail.reading || 0;
            return 'The ration crate (6.5 kg, true weight ' + sig(trueW, 3) + ' N) reads **' + sig(rd, 3) + ' N** on your dial, off by ' + Math.abs(r.detail.error * 100).toFixed(0) + ' %. ' + (rd < trueW * 0.2 ? 'The dial is reading kilograms, not newtons, so every load hauled against it will be under-rated by a factor of 9.81.' : 'Every load weighed on this dial will be wrong by the same factor.');
          });
        },
        explain: 'A spring scale measures **force**. Its marks are weights, $W = mg$, so 3 kg gets 29.4 N and 8 kg gets 78.5 N. A dial marked in kilograms only reads correctly at the place it was calibrated.'
      },
      {
        type: 'task', id: 'H6.survivor', who: 'juno',
        scene: { type: 'scales', params: { mode: 'compare', mass: TEO_KG, standardMass: TEO_KG, k: 6000, capacity: 1500, units: 'FPS', label: 'TEO' } },
        title: 'The new arrival',
        text: 'Juno, over the radio: "A survivor called Teo just walked in from the east road. The trading post\'s platform scale says he weighs **172 lb**. I need his numbers in both systems: the rescue harness log is in SI, the old trading post\'s books are in FPS. We\'ll check him on the balance and then winch him over the wall in a harness picked for his logged weight."',
        inputs: [
          // 172 / 32.2 = 5.3416 slug -> 5.34 slug
          { key: 'slug', label: '(a) Teo\'s mass in **slugs**', placeholder: 'e.g. 1.00 slug', spec: { value: TEO_KG, unit: 'kg', sf: 3, expressIn: 'slug' }, answer: '5.34 slug', wrong: [{ input: '172 slug', kind: 'concept' }, { input: '5538 slug', kind: 'conversion' }] },
          // 5.3416 x 14.59 = 77.934 kg -> 77.9 kg
          { key: 'kg', label: '(b) Teo\'s mass in **kilograms**', placeholder: 'e.g. 10.0 kg', spec: { value: TEO_KG, unit: 'kg', sf: 3, form: 'si', mistakes: [{ ratio: TEO_LB / TEO_KG, kind: 'concept', msg: 'That copies the pound reading straight across. Pounds measure force; find the mass in slugs first, then convert.' }] }, answer: '77.9 kg', wrong: [{ input: '5.34 kg', kind: 'conversion' }, { input: '172 kg', kind: 'concept' }] },
          // 172 x 4.448 = 765.06 N -> 765 N
          { key: 'N', label: '(c) Teo\'s weight in **newtons**', placeholder: 'e.g. 100 N', spec: { value: TEO_N, unit: 'N', sf: 3, form: 'si' }, answer: '765 N', wrong: [{ input: '172 N', kind: 'conversion' }, { input: '77.9 N', kind: 'concept' }] }
        ],
        hints: [
          'The platform scale reads a **force**. In FPS, mass comes from weight with Eq. 1–5. For SI, convert with Table 1–2.',
          '(a) $m = W/g$ with g = 32.2 ft/s². (b) 1 slug = 14.59 kg. (c) 1 lb = 4.448 N, or use $W = mg$ on your answer to (b).',
          '(a) $172/32.2 = 5.3416 \\to 5.34\\u{ slug}$. (b) $(5.3416)(14.59) = 77.93 \\to 77.9\\u{ kg}$. (c) $(172)(4.448) = 765.06 \\to 765\\u{ N}$.'
        ],
        consequence: function (ctx, a) {
          // 1) The equal-arm balance: Teo against standard masses stacked to
          //    the player's figure in kg. 2) The wall hoist: the harness rope is
          //    rated from the player's weight in N.
          var mKg = a.kg && a.kg.si != null ? a.kg.si : 0;
          var mSlugKg = a.slug && a.slug.si != null ? a.slug.si : 0;
          var Wn = a.N && a.N.si != null ? a.N.si : 0;
          var s = ctx.setScene('scales', { mode: 'compare', mass: TEO_KG, standardMass: mKg, k: 6000, capacity: 1500, units: 'SI', label: 'TEO' });
          return s.run({}).then(function (r) {
            var msgs = [];
            var dm = mKg - TEO_KG;
            if (Math.abs(dm) / TEO_KG < 0.005) msgs.push('The balance settles **level** with ' + sig(mKg, 3) + ' kg of standards against Teo.');
            else msgs.push('The balance **tips** toward ' + (dm > 0 ? 'the standards' : 'Teo') + ': ' + sig(mKg, 3) + ' kg of standards against his ' + sig(TEO_KG, 3) + ' kg.');
            if (Math.abs(mSlugKg - TEO_KG) / TEO_KG >= 0.005) msgs.push('The trading post\'s book lists him at ' + (mSlugKg / SLUG).toPrecision(3) + ' slug; in kilograms that is ' + sig(mSlugKg, 3) + ' kg, which doesn\'t match the balance.');
            // The harness rope is chosen from the logged weight with a 1.5
            // safety factor. The winch then lifts Teo with a fixed 1.2 x his
            // true weight (a = 0.2 g upward), so a logged weight under
            // 1.2 / 1.5 = 80 % of the truth parts the rope.
            var rating = HARNESS_SF * Wn, T = LIFT_FACTOR * TEO_KG * G;
            var h = ctx.setScene('hoist', { mass: TEO_KG, label: 'Teo', mode: 'lift', height: 9, rating: rating, governor: T, crateSize: 1.0 });
            return h.run(T, { duration: 1.6 }).then(function (hr) {
              var o = hr.outcome;
              if (o === 'snapped') msgs.push('The harness rope was picked for 1.5 × the logged ' + sig(Wn, 3) + ' N, a ' + sig(rating, 3) + ' N rating. Lifting him takes ' + sig(T, 3) + ' N. The rope parts and Teo falls back onto the road.');
              else msgs.push('The harness rope, rated 1.5 × ' + sig(Wn, 3) + ' N = ' + sig(rating, 3) + ' N, takes the ' + sig(T, 3) + ' N lift and Teo rises ' + (hr.detail.y != null ? hr.detail.y.toFixed(1) + ' m' : '') + ' clear of the road, on his way over the wall.' + (Wn > 1.5 * TEO_N ? ' (It\'s a far heavier rope than he needed: the crew grumbles about hauling it up.)' : ''));
              return msgs.join(' ');
            });
          });
        },
        explain: 'Pounds are a force, so mass in FPS is $m = W/g = 172/32.2 = 5.34$ slug. Converting, $5.34 \\times 14.59 = 77.9$ kg, and $172 \\times 4.448 = 765$ N. As a cross-check, $77.9 \\times 9.81 = 765$ N too.'
      },
      {
        type: 'deeper', title: 'Pound-force, pound-mass, and the k that came back',
        teaser: 'Some old-world manuals use a "pound-mass" alongside the pound-force. That quietly brings back the fudge factor from the ledger.',
        steps: [
          { type: 'say', who: 'hask', text: 'FPS is a **gravitational** system: its base unit of force was originally the weight of a standard lump of metal. That\'s why force, not mass, is base. It suits people who mostly weigh things.' },
          { type: 'say', who: 'hask', text: 'Some engineering trades went further and kept a **pound-mass** (lbm), defined so that 1 lbm *weighs* 1 lbf at standard gravity. Now force **and** mass both have independent units, plus the foot and the second. That\'s four free choices again, exactly the ledger\'s mistake.' },
          { type: 'predict', who: 'hask', q: 'With lbf, lbm, ft and s all chosen independently, what must $F = ma$ look like?', choices: [
            { t: 'F = ma, same as always' , why: '1 lbf on 1 lbm gives 32.2 ft/s², not 1 ft/s², so plain F = ma fails.' },
            { t: 'F = ma / g_c, with g_c ≈ 32.2 lbm·ft/(lbf·s²)', correct: true, why: 'Yes. $g_c$ is the ledger\'s k wearing a respectable name. Forget it once and your answer is off by a factor of 32.2.' },
            { t: 'There is no way to make it work', why: 'It works, as long as you carry the constant every time.' }
          ] },
          { type: 'say', who: 'hask', text: 'The slug exists to avoid all that: 1 slug = 32.2 lbm, and with slugs $F = ma$ needs no constant. When you see "lbm" in a salvaged manual, convert to slugs before you do any mechanics.' }
        ]
      },
      {
        type: 'sandbox', scene: { type: 'scales', params: { mode: 'compare', mass: 12, units: 'SI', label: 'BATTERY' } },
        text: 'The scales bench. Change the object, carry the rig to other places and flip between SI and FPS. Watch which readings change.',
        controls: ['mass', 'location', 'units', 'standardMass'],
        prompts: [
          'Set the mass to **1 kg** in SI. Then switch to FPS: how many lb, and how many slug?',
          'Find the mass in kg that weighs **32.2 lb** at the standard location. (It should be close to one slug.)',
          'Take the rig to the Moon. Which number stays put, the mass or the weight? Does that change between SI and FPS?'
        ]
      },
      {
        type: 'summary',
        points: [
          'Length, time, mass and force are tied by $F = ma$, so only **three** units can be chosen freely (**base units**). The fourth is **derived**.',
          '**SI**: m, s, kg are base; the **newton** is derived, N = kg·m/s², the force that gives 1 kg an acceleration of 1 m/s².',
          'Weight in SI: $W = mg$ with g = 9.81 m/s² (measured 9.806 65). 1 kg weighs 9.81 N; 2 kg weighs 19.62 N.',
          '**FPS**: ft, s, lb are base; the **slug** is derived, slug = lb·s²/ft. Mass from weight: $m = W/g$ with g = 32.2 ft/s²; 32.2 lb is 1 slug.',
          'A spring scale reads force, so mark it in newtons (or pounds). A balance compares masses.'
        ]
      }
    ]
  });
})(globalThis.SE);
