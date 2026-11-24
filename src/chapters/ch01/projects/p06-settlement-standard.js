/*
 * P6 · Settlement Standard (manual capstone for Act I).
 *
 * Kettle Hollow writes its first engineering standard. The player
 * measures local g with a pendulum, re-certifies the depot's reference
 * kilogram against a 2019-SI lab standard, then uses both to weigh the new water
 * tank, ship it, hover it and pick the cable that lifts it onto the tower.
 *
 * Everything in Chapter 1 is in play: mass vs weight, W = mg with local g,
 * F = ma for the lift-off, mixed SI/FPS ratings with the converter locked,
 * SI form, significant figures and the exact-5 rounding rule, and a
 * sanity-check deliverable (the old ledger's tank weight is off by ten).
 *
 * Beyond the book, and both change graded answers:
 *   - the depot kilo has lost 0.30 g to corrosion, so every mass weighed
 *     against it reads 0.030 % high (this flips the tank's 3 s.f. figure);
 *   - g comes from a pendulum, g = 4 pi^2 L / T^2, and the site is far
 *     enough from standard that 9.81 fails the 4 s.f. governor setting.
 */
(function (SE) {
  'use strict';

  /* ------------------------------------------------------------- givens */

  var LB = 4.448;                     // N per lb (course factor)
  var RIDER = 0.300e-3;               // kg rider needed on the depot-kilo pan
  var LAB_STD = 1.00000;              // kg, the lab's 2019-SI certified standard
  var PEND_L = 1.2500;                // m, pendulum length (knife edge to bob centre)
  var SWINGS = 20, PEND_TIME = 44.88; // s, stopwatch time for 20 full swings
  var IRON = 1235.0;                  // "depot kg" of iron weights balancing the tank
  var LIFT_A = 0.40;                  // m/s^2, the standard's lift-off acceleration
  var SITE = { lat: 40, alt: 600 };   // tower site, for the debrief cross-check

  // D2. The depot kilo balances the lab standard only with the rider on its
  // own pan, so  m_k + 0.300 g = 1.000 00 kg  ->  m_k = 0.999 70 kg.
  var MK = LAB_STD - RIDER;           // 0.9997 kg

  // D1. Period T = 44.88 / 20 = 2.244 s.
  //   g = 4 pi^2 L / T^2 = 39.478 4 (1.2500) / 5.035 54 = 9.799 95 m/s^2 -> 9.800
  var PERIOD = PEND_TIME / SWINGS;
  var G = 4 * Math.PI * Math.PI * PEND_L / (PERIOD * PERIOD);

  // D3. Each "1 kg" iron weight was adjusted against the depot kilo, so it is
  // really 0.999 70 kg:  m_t = 1235.0 (0.999 70) = 1234.63 kg -> 1.23 Mg.
  // Uncorrected, 1235 is an exact 5 after an odd 3, which rounds UP to 1.24 Mg.
  var MT = IRON * MK;

  // D4. W = m_t g = 1234.63 (9.799 95) = 12 099.3 N;  / 4.448 = 2720.2 lb -> 2.72 kip
  var W = MT * G;

  // D5. Hover is the statics case, a = 0:  T = W = 12 099.3 N -> 12.10 kN (4 s.f.)
  var T_HOVER = W;

  // D6. Lift-off at a = 0.40 m/s^2 upward:  T - W = m a
  //   T = m (g + a) = 1234.63 (10.199 95) = 12 593.2 N = 2831.2 lb -> 2.83 kip
  var T_LIFT = MT * (G + LIFT_A);

  // The cable rack, as stamped. Ratings converted with the course factors:
  //   2.50 kip = 11 120 N, 11.5 kN, 1.40 ton = 2800 lb = 12 454 N,
  //   3000 lb = 13 344 N, 15.0 kN.
  // The hover tension alone (12 099 N) points at the 1.40 ton sling, which
  // parts at lift-off (12 593 N > 12 454 N).
  var RACK = [
    { id: 'a', name: '3/8 in wire rope tagged 2.50 kip', rating: 2500 * LB },
    { id: 'b', name: 'synthetic round sling tagged 11.5 kN', rating: 11.5e3 },
    { id: 'c', name: 'chain sling tagged 1.40 ton', rating: 1.40 * 2000 * LB },
    { id: 'd', name: '7/16 in wire rope tagged 3000 lb', rating: 3000 * LB, inLb: true },
    { id: 'e', name: 'polyester sling tagged 15.0 kN', rating: 15.0e3 }
  ];

  var GSTD = 9.81;

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function kN(N, n) { return sig(N / 1e3, n || 3) + ' kN'; }
  function lb(N) { return sig(N / LB, 4) + ' lb'; }
  function tag(c) { return c.inLb ? '' : ' (' + lb(c.rating) + ')'; }
  function none() { return 'The rig needs a number with units before it can test anything.'; }

  /* ----------------------------------------------------------- the project */

  SE.content.registerProject('ch01', {
    id: 'P6', order: 6,
    title: 'Settlement Standard',
    subtitle: 'Kettle Hollow Standard No. 1',

    brief: [
      'Every crew in the Hollow weighs things its own way, and last month that cost us a winch drum. So we are writing it down: **Kettle Hollow Standard No. 1**, the numbers everyone builds to.',
      'First, the standard needs a trusted kilogram and a trusted *g*. The depot\'s brass kilo has been green with corrosion for years, and the scouts brought back a certified mass from the university metrology lab. Then I want the standard proved on a real job: the new water tank goes up on the tower this week. Weigh it, ship it, hover it, and choose the cable that lifts it.',
      'Record each figure the way the standard says. Hask will sign nothing that isn\'t in proper SI or that carries figures you can\'t vouch for.'
    ].join('\n\n'),

    conditions: [
      '**Lab standard:** a stainless mass certified at **1.000 00 kg**, traceable to the 2019 SI (the Planck constant, by way of a Kibble balance).',
      '**Re-certification:** on the equal-arm beam balance, the depot kilo only levels against the lab standard with a **0.300 g** rider added to the depot kilo\'s pan.',
      '**Pendulum:** knife edge to bob centre **1.2500 m**. Hask timed **20** full swings at **44.88 s**. Workshop rule for small swings: $g = 4\\pi^2 L / T^2$, with *T* the time of **one** full swing.',
      '**Tank:** the empty steel tank levels the big platform balance against **1235.0 kg** of the depot\'s iron weights. Every one of those weights was adjusted against the depot kilo.',
      '**Old ledger:** the previous engineer listed the empty tank at **272 lb**.',
      '**Trailer yard sheet (FPS):** wheelbarrow 300 lb, garden cart 1200 lb, utility trailer 3500 lb, flatbed 10 000 lb. The crew takes the smallest one that covers your figure.',
      '**Cable rack, as stamped:** 3/8 in wire rope *2.50 kip* · synthetic sling *11.5 kN* · chain sling *1.40 ton* · 7/16 in wire rope *3000 lb* · polyester sling *15.0 kN*. The crew takes the lightest tag that covers your figure.',
      '**The standard\'s rules:** reference mass to **5** s.f.; local *g* and the winch governor setting to **4** s.f.; everything else to **3** s.f. Lift-off acceleration is limited to **0.40 m/s²** upward. The tower stands at 40° N, 600 m above sea level.'
    ],

    // The rig opens on the trailer yard with last week's job on the sheet, so
    // nothing on screen gives away this week's figures.
    scene: { type: 'haul', params: { mode: 'axle', quantity: 'force', claimed: 1800 * LB, trueValue: 1800 * LB, label: 'generator (last week)', object: 'crate' } },
    controls: ['claimed', 'trueValue'],
    rigText: 'The yard rig runs the crew\'s trailer rule on the real physics: set a figure, set the true load, and watch which trailer they hitch and whether its axle holds. Hask\'s pendulum is set up in the workshop. The gantry and the cable rack are tested when you sign off each figure.',
    rigActions: [
      {
        label: 'Time the pendulum again',
        run: function () {
          return 'Hask clicks the stopwatch: **' + PEND_TIME.toFixed(2) + ' s** for ' + SWINGS + ' full swings, same as before. Length still **' + PEND_L.toFixed(4) + ' m**.';
        }
      }
    ],
    lockedTools: ['converter', 'sigfig'],

    deliverables: [
      {
        id: 'P6.g',
        label: '**Local g** from the pendulum, to 4 s.f.',
        placeholder: 'e.g. 9.812 m/s^2',
        spec: {
          value: G, unit: 'm/s^2', sf: 4, form: 'si', tol: 0.0003,
          mistakes: [
            { test: function (r) { return r > 1.0006 && r < 1.0016; }, kind: 'concept', msg: 'That is standard gravity, not the gravity at this site. The pendulum measured something else.' },
            { ratio: 1 / (SWINGS * SWINGS), tol: 0.004, kind: 'algebra', msg: 'You used the time for all 20 swings as the period. *T* is the time of one full swing.' },
            { ratio: 1 / PERIOD, tol: 0.004, kind: 'algebra', msg: 'The period has to be squared: $g = 4\\pi^2 L / T^2$. Check the units: m/s is not an acceleration.' }
          ]
        },
        answer: '9.800 m/s^2',     // 4 pi^2 (1.2500) / 2.244^2 = 49.348 0 / 5.035 54 = 9.799 95
        wrong: [
          { input: '9.810 m/s^2', kind: 'concept' },
          { input: '9.81 m/s^2', kind: 'concept' },
          { input: '0.02450 m/s^2', kind: 'algebra' },
          { input: '9.8 m/s^2', kind: 'sigfig' }
        ],
        hints: [
          'The stopwatch covered twenty swings. The rule wants one.',
          '$T = 44.88 / 20 = 2.244\\u{ s}$. Then $g = 4\\pi^2 L / T^2$ with *L* in metres. Check the units: m / s² is an acceleration, so the rule is at least homogeneous.',
          '$g = 4\\pi^2(1.2500) / (2.244)^2 = 49.348 / 5.0355 = 9.79995\\u{ m/s^2}$. To 4 s.f. the dropped digits are 95, more than half, so round up: **9.800 m/s²**.'
        ],
        consequence: function (ctx, a, ok) {
          if (a.si == null) return Promise.resolve(none());
          var gp = a.si;
          // Hang the lab standard (not the depot kilo, which is not certified yet).
          var s = ctx.setScene('scales', { mode: 'compare', mass: LAB_STD, label: 'LAB STD', g: G, capacity: 30 });
          return s.run({}).then(function (r) {
            // What 20 swings would take if the player's g were the site's g.
            var predicted = gp > 0 ? SWINGS * 2 * Math.PI * Math.sqrt(PEND_L / gp) : Infinity;
            var gap = predicted - PEND_TIME;
            var reading = r.detail.W, theirs = LAB_STD * gp;
            var line = 'The spring scale under the lab standard reads **' + sig(reading, 5) + ' N**; your *g* predicts ' + sig(theirs, 5) + ' N.';
            if (ok) return line + ' Swing check: your *g* gives ' + (isFinite(predicted) ? predicted.toFixed(2) : '∞') + ' s for 20 swings, matching Hask\'s stopwatch. Kettle Hollow\'s *g* goes into the standard.';
            return line + ' Swing check: with your *g*, 20 swings should take **' + (isFinite(predicted) ? predicted.toFixed(2) + ' s' : 'forever') + '**, ' + (isFinite(gap) ? Math.abs(gap).toFixed(2) + ' s ' + (gap > 0 ? 'longer' : 'shorter') + ' than' : 'not') + ' the ' + PEND_TIME.toFixed(2) + ' s Hask timed.';
          });
        }
      },
      {
        id: 'P6.kilo',
        label: '**Re-certify the depot kilo.** Its true mass, to 5 s.f. This becomes the Hollow\'s reference.',
        placeholder: 'e.g. 0.99950 kg',
        spec: {
          value: MK, unit: 'kg', sf: 5, form: 'si', tol: 0.00005,
          mistakes: [
            { ratio: (LAB_STD + RIDER) / MK, tol: 0.0001, kind: 'sign', msg: 'The rider sat on the depot kilo\'s own pan, so it was making up a shortfall. The depot kilo is lighter than the standard, not heavier.' },
            { ratio: LAB_STD / MK, tol: 0.0001, kind: 'concept', msg: 'That is what the depot kilo is stamped, not what it is. The balance needed a rider to level it.' }
          ]
        },
        answer: '0.99970 kg',      // 1.000 00 - 0.000 300 = 0.999 70 kg
        wrong: [
          { input: '1.0003 kg', kind: 'sign' },
          { input: '1.0000 kg', kind: 'concept' },
          { input: '0.9997 kg', kind: 'sigfig' },
          { input: '999.7 g', kind: 'sigfig' }
        ],
        hints: [
          'A beam balance compares masses. When it levels, the two pans hold equal mass. What is on each pan?',
          'Depot kilo + rider on one pan, lab standard on the other: $m_k + 0.300\\u{ g} = 1.000\\,00\\u{ kg}$. Convert the rider to kg before subtracting.',
          '$m_k = 1.000\\,00 - 0.000\\,300 = 0.999\\,70\\u{ kg}$. Keep the trailing zero: the standard asks for five figures, and 999.70 g is just as good.'
        ],
        consequence: function (ctx, a, ok) {
          if (a.si == null) return Promise.resolve(none());
          // Pan load the player's figure implies: depot kilo plus the rider
          // their number says it needs, against the lab standard.
          var rider = LAB_STD - a.si;
          var s = ctx.setScene('scales', { mode: 'compare', mass: MK + rider, standardMass: LAB_STD, label: 'KILO + ' + sig(rider * 1e3, 3) + ' g', g: G, capacity: 30 });
          return s.run({}).then(function (r) {
            var deg = (r.detail.balanceTilt || 0) * 180 / Math.PI;
            if (ok) {
              if (SE.save.addFormula(ctx.save, 'ch01.si-2019')) SE.ui.toast('Formula sheet: **The 2019 SI** added', 'info');
              return 'With a ' + sig(rider * 1e3, 3) + ' g rider the beam settles dead level (' + Math.abs(deg).toFixed(4) + '°). The depot kilo is stamped **0.999 70 kg** and goes back in its case. Every mass the depot ever weighed with it read 0.030 % high.';
            }
            var move = rider >= 0 ? 'hangs the ' + sig(rider * 1e3, 3) + ' g rider your number implies on the depot kilo\'s pan' : 'moves ' + sig(-rider * 1e3, 3) + ' g to the lab standard\'s pan, as your number implies,';
            return 'Hask ' + move + ' and the beam ' + (Math.abs(deg) < 1e-6 ? 'levels, but the figure is not recorded the way the standard asks.' : 'tips **' + Math.abs(deg).toFixed(3) + '°** toward the ' + (deg > 0 ? 'depot kilo' : 'lab standard') + '. That is not the mass that balanced.');
          });
        }
      },
      {
        id: 'P6.mass',
        label: '**Tank mass**, for the plate riveted on its side.',
        placeholder: 'e.g. 1.18 Mg',
        spec: { value: MT, unit: 'kg', sf: 3, form: 'si' },
        answer: '1.23 Mg',         // 1235.0 (0.999 70) = 1234.63 kg -> 1.23 Mg
        wrong: [
          { input: '1.24 Mg', kind: 'rounding' },
          { input: '1235 kg', kind: 'sigfig' },
          { input: '1230 kg', kind: 'sigfig' },
          { input: '12.1 kN', kind: 'concept' }
        ],
        hints: [
          'The iron weights are only as honest as the kilo they were adjusted against. What did you just learn about that kilo?',
          'Each "1 kg" weight is really 0.999 70 kg, so the tank is $1235.0 \\times 0.999\\,70$ kg. Then round to 3 s.f. and pick a prefix that keeps the number between 0.1 and 1000.',
          '$m_t = 1235.0(0.999\\,70) = 1234.63\\u{ kg}$, which is **1.23 Mg**. Without the correction you would have an exact 5 after an odd 3, and the rule rounds that up to 1.24 Mg: the corrosion changes the plate.'
        ],
        consequence: function (ctx, a, ok) {
          if (a.si == null) return Promise.resolve(none());
          // The platform balance with the iron weights that actually levelled it.
          var s = ctx.setScene('scales', { mode: 'compare', mass: MT, standardMass: MT, label: 'TANK', g: G, capacity: 20e3, k: 600 * MT });
          return s.run({}).then(function () {
            var err = (a.si - MT) / MT * 100;
            var stamped = SE.sigfig.roundSig(a.si / 1e3, 3).text;
            if (ok) return 'The tank levels against the iron, as it did yesterday. The plate is stamped **' + stamped + ' Mg**, and that figure is what the tank really is.';
            return 'The plate would say ' + sig(a.si / 1e3, 4) + ' Mg, ' + (err >= 0 ? '+' : '') + err.toFixed(2) + ' % from the **' + sig(MT, 6) + ' kg** the corrected weights say. Hask will not rivet a plate that is wrong in its last figure.';
          });
        }
      },
      {
        id: 'P6.ship',
        label: '**Sanity check, then ship.** The old ledger says the empty tank weighs 272 lb. Judge that, then give the yard crew the tank\'s weight in FPS units for the trailer sheet.',
        placeholder: 'e.g. 2.45 kip',
        spec: { value: W, unit: 'N', sf: 3, form: 'any', expressIn: 'FPS' },
        answer: '2.72 kip',        // 1234.63 (9.799 95) = 12 099.3 N; / 4.448 = 2720.2 lb -> 2.72 kip
        wrong: [
          { input: '272 lb', kind: 'prefix' },
          { input: '1.23 Mg', kind: 'concept' },
          { input: '12.1 kN', kind: 'form' },
          { input: '2.72 kN', kind: 'conversion' },
          { input: '2720 lb', kind: 'sigfig' }
        ],
        hints: [
          'Judge first: a 1 kg mass weighs about 2.2 lb on Earth. Roughly what should a 1.23 Mg tank weigh?',
          'Weight is $W = m g$ with the site\'s *g*, in newtons. Then divide by 4.448 N/lb. A kip is 1000 lb, which avoids an ambiguous trailing zero.',
          '$W = 1234.63(9.79995) = 12\\,099\\u{ N}$, and $12\\,099 / 4.448 = 2720\\u{ lb}$, so **2.72 kip** (or 2.72(10³) lb). The ledger\'s 272 lb is off by exactly ten, a slipped decimal point.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('haul', { mode: 'axle', quantity: 'force', trueValue: W, claimed: a.si == null ? 0 : a.si, label: 'water tank', object: 'crate', g: G });
          return s.run({ claimed: a.si == null ? 0 : a.si, trueValue: W }).then(function (r) {
            var d = r.detail, kit = d.chosen ? d.chosen.name : 'nothing';
            if (r.outcome === 'overloaded') return 'The crew hitches the **' + kit + '** for your figure. The real ' + lb(W) + ' lands on it and the axle snaps at ' + Math.round(d.utilization * 100) + ' % of its rating. The tank is sitting in the yard mud.';
            if (r.outcome === 'oversized') return 'The tank rides out on the **' + kit + '**, but the crew ' + (d.cost || 'tied up far more trailer than the job needed') + '.';
            return 'The **' + kit + '** takes the tank at ' + Math.round(d.utilization * 100) + ' % of its rating, and it rolls to the tower base without drama.';
          });
        }
      },
      {
        id: 'P6.hover',
        label: '**Proof hover.** The winch governor tension that holds the tank perfectly still on the gantry, to 4 s.f.',
        placeholder: 'e.g. 11.95 kN',
        spec: {
          value: T_HOVER, unit: 'N', sf: 4, form: 'si', tol: 0.0003,
          mistakes: [
            { test: function (r) { return r > 1.0006 && r < 1.0025; }, kind: 'concept', msg: 'That is the tank on standard gravity. At four figures the governor knows the difference: use Kettle Hollow\'s *g*.' }
          ]
        },
        answer: '12.10 kN',        // a = 0, so T = W = 12 099.3 N -> 12.10 kN
        wrong: [
          { input: '12.11 kN', kind: 'concept' },
          { input: '12.12 kN', kind: 'concept' },
          { input: '12.1 kN', kind: 'sigfig' },
          { input: '1.235 Mg', kind: 'concept' }
        ],
        hints: [
          'Perfectly still means no acceleration. What does that make the cable tension, compared with the tank\'s weight?',
          'Hovering is the statics case: $T - W = m(0)$, so $T = W = m g$ with the corrected mass and the pendulum *g*, kept at full precision, then rounded to 4 s.f.',
          '$T = 1234.63(9.79995) = 12\\,099.3\\u{ N}$, written **12.10 kN**. With 9.81 you would get 12.11 kN, and the tank would creep upward.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null) return Promise.resolve(none());
          // Proof hover: the governor takes the tank just off the slab and
          // Hask watches a chalk mark for a six-second count. It passes if the
          // tank stays within 2 cm, which needs |T - W| below about 1.4 N.
          var s = ctx.setScene('hoist', { mass: MT, g: G, label: 'TANK 1.23 Mg', mode: 'lift', hookHeight: 3, height: 9, governor: a.si, zombies: 2 });
          return s.run(a.si, { duration: 6 }).then(function (r) {
            var acc = (a.si - W) / MT;
            var rise = r.detail && r.detail.y != null ? r.detail.y : 0;
            if (r.outcome === 'snapped') return 'The cable parts. That tension is far beyond anything the tank needs.';
            if (r.outcome === 'slammed') return 'The tank shoots up and **slams the gantry head**. Your tension beat its weight by ' + kN(a.si - W) + '.';
            if (r.outcome === 'stalled') return 'The drum takes up the slack and stops. The tank **never leaves the slab**: your tension is ' + sig(W - a.si, 3) + ' N short of its weight, so the floor is still holding part of it.';
            if (rise < 0.02) return 'The tank lifts clear and **hangs on the chalk mark**: ' + (rise * 1000).toFixed(0) + ' mm of creep over the six-second count (net acceleration ' + acc.toExponential(1) + ' m/s²). Hask initials the gantry log.';
            return 'The tank lifts clear but **keeps creeping up** at ' + acc.toFixed(4) + ' m/s²: ' + (rise * 100).toFixed(0) + ' cm past the chalk mark in six seconds. Your tension is ' + sig(a.si - W, 3) + ' N more than the tank weighs here.';
          });
        }
      },
      {
        id: 'P6.cable',
        label: '**Lift-off.** The peak cable tension as the tank leaves the ground at the standard\'s 0.40 m/s². The crew reads the cable rack against your figure.',
        placeholder: 'e.g. 2.60 kip',
        spec: {
          value: T_LIFT, unit: 'N', sf: 3, form: 'any',
          mistakes: [
            { ratio: G / (G + LIFT_A), tol: 0.004, kind: 'concept', msg: 'That is the hover tension. Starting the tank upward takes more: an unbalanced force *ma* on top of its weight.' },
            { ratio: LIFT_A / (G + LIFT_A), tol: 0.01, kind: 'concept', msg: 'That is only the *ma* part. The cable still has to hold the tank\'s weight as well.' }
          ]
        },
        answer: '2.83 kip',        // 1234.63 (9.79995 + 0.40) = 12 593.2 N = 2831.2 lb -> 2.83 kip
        wrong: [
          { input: '2.72 kip', kind: 'concept' },
          { input: '12.1 kN', kind: 'concept' },
          { input: '494 N', kind: 'concept' },
          { input: '12.6 N', kind: 'prefix' }
        ],
        hints: [
          'At lift-off the tank is accelerating, so this is no longer statics. Which way is the unbalanced force?',
          'Up is positive: $T - W = m a$, so $T = m(g + a)$. Then compare it with every tag on the rack, converted to one unit by hand.',
          '$T = 1234.63(9.79995 + 0.40) = 12\\,593\\u{ N} = 2831\\u{ lb}$, so **2.83 kip** (12.6 kN). The 1.40 ton chain sling is only 2800 lb: the lightest tag that covers it is the 3000 lb wire rope.'
        ],
        consequence: function (ctx, a) {
          var pick = SE.physics.haul.pick(RACK, a.si == null ? 0 : a.si) || RACK[0];
          var s = ctx.setScene('hoist', { mass: MT, g: G, label: 'TANK 1.23 Mg', mode: 'lift', hookHeight: 4, height: 12, rating: pick.rating, zombies: 3 });
          return s.run(T_LIFT, { duration: 4 }).then(function (r) {
            var use = Math.round(T_LIFT / pick.rating * 100);
            if (r.outcome === 'snapped') return 'The crew rigs the **' + pick.name + '**' + tag(pick) + '. At lift-off the cable sees ' + lb(T_LIFT) + ', ' + use + ' % of its rating, and **it parts**. The tank comes down on the tower footing.';
            var lighter = SE.physics.haul.sorted(RACK).filter(function (c) { return c.rating >= T_LIFT && c.rating < pick.rating; });
            var note = lighter.length ? ' It works, but the ' + lighter[0].name + ' would have done the job with less to haul up the tower.' : '';
            return 'The crew rigs the **' + pick.name + '**' + tag(pick) + '. It takes ' + lb(T_LIFT) + ' at lift-off, ' + use + ' % of its rating, and the tank rises clean onto the tower.' + note;
          });
        }
      }
    ],

    deeper: [
      'The **2019 SI**: the kilogram is no longer a metal artefact. It is fixed by the Planck constant, and a Kibble balance can realise it anywhere. Artefacts like the depot kilo drift; the definition does not.',
      'A **corroded reference** biases everything weighed against it by the same fraction (here 0.030 %). The bias flipped the tank\'s 3 s.f. plate from 1.24 Mg to 1.23 Mg.',
      '**Pendulum gravimetry**: for small swings $T = 2\\pi\\sqrt{L/g}$, so $g = 4\\pi^2 L/T^2$. Timing many swings cuts the stopwatch error per swing.',
      'Local *g* at 40° N, 600 m differs from 9.81 by about 0.1 %, enough to make a 4 s.f. governor setting wrong.'
    ],

    debrief: [
      'Hask reads the standard through twice, then signs it. "Three figures where three are honest, five where the balance earns them. That is how a standard should read."',
      'The tank is on the tower. On the way you used all of Chapter 1: a **beam balance compares masses** while a spring scale measures **weight**; $W = mg$ with the *g* you are standing in; $F = ma$ the moment the tank moved; the tank treated as a **particle** on a **concentrated** cable force; every rating brought to **one unit system** by hand; SI form and prefixes; **significant figures** and the **exact-5 rounding rule**; and the procedure itself, including step five: the ledger\'s 272 lb failed the sanity check by a factor of ten.',
      'Your pendulum *g* of ' + sig(G, 4) + ' m/s² agrees with the latitude and altitude formula for the tower site (' + sig(SE.physics.gravity.gSite(SITE.lat, SITE.alt), 4) + ' m/s²). The reference behind it all is now on your formula sheet as **The 2019 SI**: the kilogram is pinned to the Planck constant, so the next time a brass kilo turns green, the Hollow knows how to check it.'
    ].join('\n\n')
  });
})(globalThis.SE);
