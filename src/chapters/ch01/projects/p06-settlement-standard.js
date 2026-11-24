/*
 * P6 · Settlement Standard (manual capstone for Act I), played in the yard.
 *
 * Kettle Hollow writes its first engineering standard and proves it on a
 * real job: the new water tank goes up on the tower. Four jobs, each judged
 * by the simulation:
 *
 *   P6.kilo   level the lab comparator with a rider, then sign the depot
 *             kilo's certificate (5 s.f.). The 2019 SI goes on the sheet.
 *   P6.ship   write the tank's weight on the trailer ticket in FPS units.
 *             The crew hitches the smallest trailer that covers it, and the
 *             old ledger's 272 lb snaps a wheelbarrow axle.
 *   P6.hover  set the winch governor so the tank lifts clear and hangs on
 *             the chalk mark (4 s.f., local g from the pendulum).
 *   P6.lift   lift-off at the standard's 0.40 m/s² on a line from the rack
 *             (mixed-unit tags), with the tank's plate stamped to 3 s.f.
 *
 * Beyond the book, and both change the physics or the grade:
 *   - the depot kilo has lost 0.30 g to corrosion, so every mass weighed
 *     against it reads 0.030 % high (this flips the tank's 3 s.f. plate);
 *   - g comes from a pendulum, g = 4 pi^2 L / T^2, and the site is far
 *     enough from standard that 9.81 fails the 4 s.f. governor setting.
 *
 * Scenery parts that only this project uses are defined at the bottom
 * (p06-comparator, p06-trailer, p06-plate).
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, Gl = Y.goals, D = Y.dial;

  /* ------------------------------------------------------------- givens */

  var LB = 4.448;                     // N per lb (course factor)
  var RIDER = 0.300e-3;               // kg rider needed on the depot-kilo pan
  var LAB_STD = 1.00000;              // kg, the lab's 2019-SI certified standard
  var PEND_L = 1.2500;                // m, pendulum length (knife edge to bob centre)
  var SWINGS = 20, PEND_TIME = 44.88; // s, stopwatch time for 20 full swings
  var IRON = 1235.0;                  // "depot kg" of iron weights balancing the tank
  var LIFT_A = 0.40;                  // m/s^2, the standard's lift-off acceleration
  var LIFT_TOL = 0.03;                // m/s^2, what the crane log lets through
  var SITE = { lat: 40, alt: 600 };   // tower site, for the debrief cross-check

  // Kilo. The depot kilo balances the lab standard only with the rider on its
  // own pan, so  m_k + 0.300 g = 1.000 00 kg  ->  m_k = 0.999 70 kg.
  var MK = LAB_STD - RIDER;

  // g. Period T = 44.88 / 20 = 2.244 s.
  //   g = 4 pi^2 L / T^2 = 39.478 4 (1.2500) / 5.035 54 = 9.799 95 m/s^2 -> 9.800
  var PERIOD = PEND_TIME / SWINGS;
  var G = 4 * Math.PI * Math.PI * PEND_L / (PERIOD * PERIOD);

  // Tank. Each "1 kg" iron weight was adjusted against the depot kilo, so it
  // is really 0.999 70 kg:  m_t = 1235.0 (0.999 70) = 1234.63 kg -> 1.23 Mg.
  // Uncorrected, 1235 is an exact 5 after an odd 3, which rounds UP to 1.24 Mg.
  var MT = IRON * MK;

  // Ship. W = m_t g = 1234.63 (9.799 95) = 12 099.3 N;  / 4.448 = 2720.2 lb -> 2.72 kip
  var W = MT * G;

  // Hover is the statics case, a = 0:  T = W = 12 099.3 N -> 12.10 kN (4 s.f.).
  // 12.10 kN beats W by 0.7 N: the tank rises about 1 cm in the six-second count.
  // 9.81 gives 12.11 kN, 10.7 N too much: 16 cm of creep.

  // Lift-off at a = 0.40 m/s^2 upward:  T - W = m a
  //   T = m (g + a) = 1234.63 (10.199 95) = 12 593.2 N = 2831.2 lb -> 2.83 kip
  var T_LIFT = MT * (G + LIFT_A);

  // The cable rack, as stamped. Ratings converted with the course factors:
  //   2.50 kip = 11 120 N, 11.5 kN, 1.40 ton = 2800 lb = 12 454 N,
  //   3000 lb = 13 344 N, 15.0 kN.
  // The hover tension alone (12 099 N) points at the 1.40 ton chain sling,
  // which parts at lift-off (12 593 N > 12 454 N).
  var RACK = [
    { tag: '2.50 kip', name: '3/8 in wire rope', rating: 2500 * LB },
    { tag: '11.5 kN', name: 'synthetic round sling', rating: 11.5e3 },
    { tag: '1.40 ton', name: 'chain sling', rating: 1.40 * 2000 * LB },
    { tag: '3000 lb', name: '7/16 in wire rope', rating: 3000 * LB },
    { tag: '15.0 kN', name: 'polyester sling', rating: 15.0e3 }
  ];
  function rackLine(si) { return RACK.filter(function (c) { return Math.abs(si - c.rating) <= c.rating * 0.002; })[0] || null; }

  // The trailer yard sheet (FPS). The crew takes the smallest that covers the ticket.
  var TRAILERS = [
    { name: 'wheelbarrow', tag: '300 lb', cap: 300 * LB },
    { name: 'garden cart', tag: '1200 lb', cap: 1200 * LB },
    { name: 'utility trailer', tag: '3500 lb', cap: 3500 * LB },
    { name: 'flatbed', tag: '10 000 lb', cap: 10000 * LB }
  ];
  function trailerFor(ticket) { return TRAILERS.filter(function (t) { return ticket <= t.cap * (1 + 1e-9); })[0] || null; }

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function lb(N) { return sig(N / LB, 4) + ' lb'; }
  function fmt(si, q, sf) { return D.format(si, D.autoUnit(si, q), sf || 3, q); }

  var SITE_YARD = { g: G, floor: 'concrete' };

  /* ------------------------------------------------------------ the scenes */

  // The lab bench: the comparator with the depot kilo and the lab standard.
  var BENCH = { parts: [
    { id: 'comparator', type: 'p06-comparator', x: 0, y: 1.1, dials: { rider: '0 g', pan: 'kilo pan', cert: '1.00000 kg' }, locked: true, open: ['rider', 'pan', 'cert'], label: 'comparator' }
  ] };

  // The trailer yard: the tank already craned onto the trailer, tower base 12 m east.
  var YARD = { parts: [
    { id: 'trailer', type: 'p06-trailer', x: 2, y: 0.34, dials: { ticket: '', haul: '12 m' }, locked: true, open: ['ticket'], label: 'trailer' },
    { id: 'tank', type: 'crate', x: 2, y: 0.94, dials: { mass: MT + ' kg' }, locked: true, hide: ['mass'], label: 'water tank' },
    { id: 'base', type: 'zone', x: 14, y: 1.2, dials: { width: '4 m', height: '2.4 m' }, locked: true, label: 'tower base' }
  ] };

  // The proof gantry: a beam 6 m up, the tank on the slab with a chalk mark.
  var GANTRY = { parts: [
    { id: 'gantry', type: 'block', x: 0, y: 6.15, dials: { width: '3 m', height: '0.3 m' }, locked: true, label: 'proof gantry' },
    { id: 'drum', type: 'hook', x: 0, y: 5.85, locked: true, label: 'gantry hook' },
    { id: 'tank', type: 'crate', x: 0, y: 0.5, dials: { mass: MT + ' kg' }, locked: true, hide: ['mass'], label: 'water tank' },
    { id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: { pull: '5 kN', speed: '0.3 m/s', rating: '20 kN', brake: 'on', stop: '' },
      locked: true, open: ['pull', 'speed', 'rating', 'brake', 'stop'], label: 'gantry winch' }
  ] };

  // The tower: deck 5 m up beside the crane beam; the tank's blank plate is riveted on.
  var DECK = 5;
  var TOWER = { parts: [
    { id: 'beam', type: 'block', x: 0, y: 9.15, dials: { width: '3 m', height: '0.3 m' }, locked: true, label: 'crane beam' },
    { id: 'drum', type: 'hook', x: 0, y: 8.85, locked: true, label: 'crane hook' },
    { id: 'tower', type: 'block', x: 3, y: DECK / 2, dials: { width: '2.4 m', height: DECK + ' m' }, locked: true, label: 'tower' },
    { id: 'tank', type: 'crate', x: 0, y: 0.5, dials: { mass: MT + ' kg' }, locked: true, hide: ['mass'], label: 'water tank' },
    { id: 'plate', type: 'p06-plate', a: { part: 'tank' }, dials: { mass: '' }, locked: true, open: ['mass'], label: 'tank plate' }
  ] };

  // The winch the player rigged, whatever id it got.
  function winchOf(s) {
    var parts = s.built.parts, ids = Object.keys(parts).filter(function (id) { return parts[id].def.type === 'winch'; });
    return ids.length ? parts[ids[0]] : null;
  }
  function tankRise(s, y0) { var p = s.pos('tank'); return p ? p.y - y0 : 0; }

  /* --------------------------------------------------------------- goals */

  // Kilo: the beam must settle level, and the certificate must say what the
  // level beam says the depot kilo is.
  var LEVEL = 0.02 * Math.PI / 180;       // rad: within 0.02° (about 4 mg of rider)
  var kiloGoal = function (s) {
    var c = s.part('comparator');
    if (!c) return { fail: 'The comparator is missing.' };
    var tilt = c.tilt();
    s.peak('tilt', tilt);
    if (s.t < 3) return null;                                   // let the beam settle
    if (!s.held('level', Math.abs(tilt) < LEVEL, 1.5)) {
      if (s.t >= 9.9) return { fail: 'The beam settles **' + (Math.abs(tilt) * 180 / Math.PI).toFixed(3) + '°** down on the ' + (tilt > 0 ? 'depot kilo' : 'lab standard') + '\'s side. It is not level.' };
      return null;
    }
    var v = c.values, implied = LAB_STD - (v.pan === 'kilo pan' ? v.rider : -v.rider);
    if (Math.abs(v.cert - implied) > 2e-6) return { fail: 'The beam is level, but the certificate says the depot kilo is **' + c.inst.dials.cert + '**. That is not what the two pans say.' };
    return 'pass';
  };

  // Ship: the tank arrives at the tower base on its trailer, nothing snaps.
  var shipGoal = Gl.all(
    Gl.noBreaks(null, 'The trailer\'s axle snapped. The tank is sitting in the yard mud.'),
    Gl.restIn('tank', { x0: 12, x1: 16, y0: 0.7 }, { maxSpeed: 0.05, hold: 1 })
  );

  // Hover: lifts clear (more than 1 mm) and creeps less than 3 cm in 6 s.
  var hoverGoal = Gl.all(
    Gl.noBreaks(),
    Gl.never(function (s) { var r = tankRise(s, 0.5); return r > 0.03 ? 'The tank lifts clear but **keeps creeping up**: it is ' + (r * 100).toFixed(0) + ' cm past the chalk mark at t = ' + s.t.toFixed(1) + ' s. The winch pulls more than the tank weighs.' : null; }),
    Gl.after(6, function (s) {
      var r = tankRise(s, 0.5);
      if (r < 0.001) return { fail: 'The tank **never leaves the slab**. The winch stalls: its pull is less than the tank weighs here, so the slab still holds part of it.' };
      return 'pass';
    })
  );

  // Lift: lift-off at 0.40 m/s² (±0.03) on a rack line, nothing snaps, the
  // tank's underside clears the tower deck.
  var liftGoal = Gl.all(
    Gl.never(function (s) {
      var w = winchOf(s);
      if (!w) return null;
      if (!rackLine(w.values.rating)) return 'The crew only has the lines on the rack. Set the winch line\'s breaking load to one of the tags: ' + RACK.map(function (c) { return c.tag; }).join(', ') + '.';
      return null;
    }),
    Gl.noBreaks(null),
    function (s) {
      var m = s.memo, p = s.pos('tank'), v = s.vel('tank');
      if (!p) return { fail: 'The tank is missing.' };
      if (m.t0 == null && p.y - 0.5 > 0.001) { m.t0 = s.t; m.v0 = v.y; }
      if (m.t0 != null && m.a == null && s.t >= m.t0 + 0.2 - 1e-9) {
        m.a = (v.y - m.v0) / (s.t - m.t0);
        if (Math.abs(m.a - LIFT_A) > LIFT_TOL) return { fail: 'Lift-off at **' + m.a.toFixed(2) + ' m/s²**. The standard says 0.40 m/s², and the crane log flags anything more than 0.03 off.' };
      }
      if (m.a != null && p.y - 0.5 >= DECK + 0.1) return 'pass';
      return null;
    }
  );


  /* ----------------------------------------------------------- the project */

  SE.content.registerProject('ch01', {
    id: 'P6', order: 6,
    title: 'Settlement Standard',
    subtitle: 'Kettle Hollow Standard No. 1',

    brief: [
      'Every crew in the Hollow weighs things its own way, and last month that cost us a winch drum. So we are writing it down: **Kettle Hollow Standard No. 1**, the numbers everyone builds to.',
      'The standard needs a trusted kilogram and a trusted *g*. The depot\'s brass kilo has been green with corrosion for years, and the scouts brought back a certified mass from the university metrology lab. Then I want the standard proved on a real job: the new water tank goes up on the tower this week. Ship it, proof-hover it, and lift it on a line from the rack.',
      'Write every figure the way the standard says. The parts do exactly what you type, and Hask will sign nothing the simulation hasn\'t passed.'
    ].join('\n\n'),

    conditions: [
      '**Lab standard:** a stainless mass certified at **1.000 00 kg**, traceable to the 2019 SI (the Planck constant, by way of a Kibble balance). It sits on the comparator\'s right pan; the depot kilo sits on the left.',
      '**Pendulum:** knife edge to bob centre **1.2500 m**. Hask timed **20** full swings at **44.88 s**. Workshop rule for small swings: $g = 4\\pi^2 L / T^2$, with *T* the time of **one** full swing. You can hang your own pendulum from the library to check.',
      '**Tank:** the empty steel tank levels the big platform balance against **1235.0 kg** of the depot\'s iron weights. Every one of those weights was adjusted against the depot kilo.',
      '**Old ledger:** the previous engineer listed the empty tank at **272 lb**.',
      '**Trailer yard sheet (FPS):** wheelbarrow 300 lb, garden cart 1200 lb, utility trailer 3500 lb, flatbed 10 000 lb. The crew hitches the smallest one that covers the load ticket.',
      '**Cable rack, as stamped:** 3/8 in wire rope *2.50 kip* · synthetic sling *11.5 kN* · chain sling *1.40 ton* · 7/16 in wire rope *3000 lb* · polyester sling *15.0 kN*. Reeve the lightest one that holds.',
      '**The standard\'s rules:** reference mass to **5** s.f.; local *g* and the winch governor to **4** s.f.; everything else to **3** s.f. Lift-off is **0.40 m/s²** upward. The tower stands at 40° N, 600 m above sea level.'
    ],

    yard: { site: SITE_YARD, design: BENCH, camera: { fit: { lo: { x: -1.2, y: -0.2 }, hi: { x: 1.2, y: 1.6 } } } },

    solutions: {
      'P6.kilo': [
        { set: { comparator: { rider: '0.300 g', pan: 'kilo pan', cert: '0.99970 kg' } } },
        // the rider on the wrong pan: the beam tips further
        { pass: false, set: { comparator: { rider: '0.300 g', pan: 'standard pan', cert: '1.00030 kg' } } },
        // level beam, but the certificate still says what the kilo is stamped
        { pass: false, set: { comparator: { rider: '0.300 g', pan: 'kilo pan', cert: '1.00000 kg' } } }
      ],
      'P6.ship': [
        { set: { trailer: { ticket: '2.72 kip' } } },
        // the ledger's figure, off by ten: the wheelbarrow axle snaps
        { pass: false, set: { trailer: { ticket: '272 lb' } } },
        // kip and kN confused: 2.72 kN is only 612 lb, so the garden cart goes
        { pass: false, set: { trailer: { ticket: '2.72 kN' } } }
      ],
      'P6.hover': [
        { set: { winch: { pull: '12.10 kN' } } },
        // standard gravity: 12.11 kN creeps up off the mark
        { pass: false, set: { winch: { pull: '12.11 kN' } } },
        // uncorrected mass and three figures, rounded down: never leaves the slab
        { pass: false, set: { winch: { pull: '12.09 kN' } } }
      ],
      'P6.lift': [
        { add: [{ id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: { pull: '12.6 kN', rating: '3000 lb', speed: '0.5 m/s' } }],
          set: { plate: { mass: '1.23 Mg' } } },
        // sized for the hover: the chain sling parts at lift-off
        { pass: false, add: [{ id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: { pull: '12.6 kN', rating: '1.40 ton', speed: '0.5 m/s' } }] },
        // a line that isn't on the rack
        { pass: false, add: [{ id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: { pull: '12.6 kN', rating: '20 kN', speed: '0.5 m/s' } }] },
        // hover tension only: it creeps off the slab far below 0.40 m/s²
        { pass: false, add: [{ id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'tank', anchor: 'top' }, dials: { pull: '12.2 kN', rating: '1.40 ton', speed: '0.5 m/s' } }] }
      ]
    },

    jobs: [
      {
        id: 'P6.kilo',
        label: '**Re-certify the depot kilo.** Level the comparator with a rider, then sign the kilo\'s certificate with its true mass, to 5 s.f. This becomes the Hollow\'s reference.',
        design: BENCH,
        yard: { camera: { fit: { lo: { x: -1.2, y: -0.2 }, hi: { x: 1.2, y: 1.6 } } } },
        goal: kiloGoal,
        timeout: 10,
        grade: { part: 'comparator', key: 'cert', spec: {
          value: MK, unit: 'kg', sf: 5, form: 'si', tol: 0.00005,
          mistakes: [
            { ratio: (LAB_STD + RIDER) / MK, tol: 0.0001, kind: 'sign', msg: 'The rider sat on the depot kilo\'s own pan, so it was making up a shortfall. The depot kilo is lighter than the standard, not heavier.' },
            { ratio: LAB_STD / MK, tol: 0.0001, kind: 'concept', msg: 'That is what the depot kilo is stamped, not what it is. The balance needed a rider to level it.' }
          ] },
          answer: '0.99970 kg',      // 1.000 00 - 0.000 300 = 0.999 70 kg
          wrong: [{ input: '1.0003 kg', kind: 'sign' }, { input: '1.0000 kg', kind: 'concept' }, { input: '0.9997 kg', kind: 'sigfig' }]
        },
        hints: [
          'A beam balance compares **masses**: when it levels, the two pans hold the same mass, whatever *g* is. Run it empty first and see which way it tips.',
          'Put the rider on the light side and adjust it until the beam settles level. Then: depot kilo + rider = lab standard. Convert grams to kilograms before you subtract.',
          'The beam levels with **0.300 g** on the kilo pan. $m_k = 1.000\\,00 - 0.000\\,300 = 0.999\\,70\\u{ kg}$. Keep the trailing zero: the standard asks for five figures, and 999.70 g is just as good.'
        ],
        onFail: function (ctx) {
          var c = ctx.result && ctx.result.state && ctx.result.state.part('comparator');
          return c && c.values && c.values.rider === 0 ? 'Nothing on the pans but the two kilos, and the beam goes down on the lab standard\'s side. The depot kilo is the light one.' : '';
        },
        success: function () {
          var save = SE.game && SE.game.save;
          if (save && SE.save.addFormula(save, 'ch01.si-2019') && SE.ui) SE.ui.toast('Formula sheet: **The 2019 SI** added', 'info');
          return 'The beam settles dead level and the certificate matches it. The depot kilo is stamped **0.999 70 kg** and goes back in its case. Every mass the depot ever weighed with it read 0.030 % high.';
        }
      },
      {
        id: 'P6.ship',
        label: '**Sanity check, then ship.** The old ledger says the empty tank weighs 272 lb. Judge that, then write the tank\'s weight on the trailer\'s load ticket in **FPS units**, 3 s.f. The crew does the rest.',
        design: YARD,
        yard: { camera: { fit: { lo: { x: -1, y: -0.5 }, hi: { x: 17, y: 4 } } } },
        goal: shipGoal,
        timeout: 30,
        grade: { part: 'trailer', key: 'ticket', spec: { value: W, unit: 'N', sf: 3, form: 'any', expressIn: 'FPS' },
          answer: '2.72 kip',        // 1234.63 (9.799 95) = 12 099.3 N; / 4.448 = 2720.2 lb -> 2.72 kip
          wrong: [{ input: '12.1 kN', kind: 'form' }, { input: '2720 lb', kind: 'sigfig' }] },
        margin: function (s) { var t = s.part('trailer'); return t && t.cls && t.cls.name === 'flatbed' ? 15 : 0; },
        hints: [
          'Judge first: a 1 kg mass weighs about 2.2 lb on Earth. Roughly what should a 1.2 tonne tank weigh?',
          'Weight is $W = m g$, with the tank\'s mass corrected for the depot kilo and the *g* you measured. Then divide by 4.448 N/lb. A kip is 1000 lb, which avoids an ambiguous trailing zero.',
          '$W = 1234.63(9.79995) = 12\\,099\\u{ N}$, and $12\\,099 / 4.448 = 2720\\u{ lb}$: write **2.72 kip** on the ticket. The ledger\'s 272 lb is off by exactly ten, a slipped decimal point.'
        ],
        onFail: function (ctx) {
          var t = ctx.result && ctx.result.state && ctx.result.state.part('trailer');
          if (!t || !t.cls) return '';
          return 'Your ticket sent the crew for the **' + t.cls.name + '** (' + t.cls.tag + '). The real tank weighs **' + lb(W) + '**.';
        },
        success: function (ctx) {
          var t = ctx.result.state.part('trailer');
          if (t.cls.name === 'flatbed') return 'The tank rides out on the **flatbed**, which the crew needed for the generator run. A smaller trailer would have done.';
          return 'The **' + t.cls.name + '** takes the tank at ' + Math.round(W / t.cls.cap * 100) + ' % of its rating and rolls to the tower base without drama.';
        }
      },
      {
        id: 'P6.hover',
        label: '**Proof hover.** The gantry winch is rigged to the tank. Set its pull so the tank **lifts clear of the slab and hangs on the chalk mark**: less than 3 cm of creep in a six-second count. Governor to 4 s.f.',
        design: GANTRY,
        yard: { camera: { fit: { lo: { x: -4, y: -0.5 }, hi: { x: 4, y: 7 } } } },
        goal: hoverGoal,
        timeout: 7,
        grade: { part: 'winch', key: 'pull', spec: {
          value: W, unit: 'N', sf: 4, form: 'si', tol: 0.0003,
          mistakes: [
            { test: function (r) { return r > 1.0006 && r < 1.0025; }, kind: 'concept', msg: 'That is the tank on standard gravity. At four figures the governor knows the difference: use Kettle Hollow\'s *g*.' }
          ] },
          answer: '12.10 kN',        // a = 0, so T = W = 12 099.3 N -> 12.10 kN
          wrong: [{ input: '12.11 kN', kind: 'concept' }, { input: '12.1 kN', kind: 'sigfig' }] },
        hints: [
          'Hanging still means no acceleration. What does that make the line tension, compared with the tank\'s weight? And which *g* is the yard running on?',
          'Hovering is the statics case: $T - W = m(0)$, so $T = W = m g$ with the corrected mass and the pendulum *g*, kept at full precision, then rounded to 4 s.f.',
          '$g = 4\\pi^2(1.2500)/(2.244)^2 = 9.79995\\u{ m/s^2}$ and $T = 1234.63(9.79995) = 12\\,099.3\\u{ N}$: set the pull to **12.10 kN**. With 9.81 you would get 12.11 kN, and the tank would creep away from the mark.'
        ],
        success: 'The tank lifts clear and **hangs on the chalk mark**. Hask counts six, watches the mark, and initials the gantry log.'
      },
      {
        id: 'P6.lift',
        label: '**Lift it onto the tower.** Stamp the tank\'s plate with its mass (3 s.f.), then rig the crane winch: lift-off at the standard\'s **0.40 m/s²**, on the lightest line from the rack that holds. The tank\'s underside has to clear the deck.',
        design: TOWER,
        yard: { camera: { fit: { lo: { x: -4, y: -0.5 }, hi: { x: 6, y: 10 } } } },
        goal: liftGoal,
        timeout: 40,
        grade: { part: 'plate', key: 'mass', spec: { value: MT, unit: 'kg', sf: 3, form: 'si' },
          answer: '1.23 Mg',         // 1235.0 (0.999 70) = 1234.63 kg -> 1.23 Mg
          wrong: [{ input: '1.24 Mg', kind: 'rounding' }, { input: '1235 kg', kind: 'sigfig' }] },
        margin: function (s) {
          var w = winchOf(s), line = w && rackLine(w.values.rating);
          return line && line.tag === '15.0 kN' ? 10 : 0;
        },
        hints: [
          'At lift-off the tank is accelerating, so this is no longer statics. Which way is the unbalanced force, and how big? Then look hard at the rack: the tags are in four different units.',
          'Up is positive: $T - W = m a$, so $T = m(g + a)$. That is the winch pull and also the peak line tension. Bring every tag on the rack to newtons by hand and take the lightest one above it. For the plate: the iron weights were adjusted against the depot kilo.',
          '$T = 1234.63(9.79995 + 0.40) = 12\\,593\\u{ N}$: set the pull to **12.6 kN**. The 1.40 ton chain sling is only 2800 lb = 12.45 kN and parts; the **3000 lb** wire rope (13.34 kN) holds. Plate: $1235.0(0.999\\,70) = 1234.63\\u{ kg}$ = **1.23 Mg**. Uncorrected, 1235 kg would round up to 1.24 Mg.'
        ],
        onFail: function (ctx) {
          var s = ctx.result && ctx.result.state, w = s && winchOf(s);
          if (!w) return 'Rig a **winch** from the crane hook to the tank\'s top.';
          var line = rackLine(w.values.rating);
          if (line && s.breaks.length) return 'The **' + line.name + '** is tagged ' + line.tag + ', which is ' + fmt(line.rating, 'force', 4) + '. At lift-off it carried ' + fmt(w.values.pull, 'force', 4) + '.';
          return '';
        },
        success: function (ctx) {
          var s = ctx.result.state, w = winchOf(s), line = rackLine(w.values.rating);
          var note = line.tag === '15.0 kN' ? ' It holds, but the 3000 lb wire rope would have done the job with less to haul up the tower.' : '';
          return 'Lift-off at **' + s.memo.a.toFixed(2) + ' m/s²**, and the **' + line.name + '** (' + line.tag + ') takes it at ' + Math.round(w.values.pull / line.rating * 100) + ' % of its rating. The tank rises clean past the deck.' + note;
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
      'The tank is on the tower. On the way you used all of Chapter 1: a **beam balance compares masses** whatever *g* is; $W = mg$ with the *g* you are standing in; $F = ma$ the moment the tank moved; the tank treated as a **particle** on a **concentrated** line force; every tag on the rack brought to **one unit system** by hand; SI form and prefixes; **significant figures** and the **exact-5 rounding rule**; and the procedure itself, including the sanity check: the ledger\'s 272 lb was off by a factor of ten, and a wheelbarrow axle proved it.',
      'The pendulum *g* of ' + sig(G, 4) + ' m/s² agrees with the latitude and altitude formula for the tower site (' + sig(SE.physics.gravity.gSite(SITE.lat, SITE.alt), 4) + ' m/s²). The reference behind it all is on your formula sheet as **The 2019 SI**: the kilogram is pinned to the Planck constant, so the next time a brass kilo turns green, the Hollow knows how to check it.'
    ].join('\n\n')
  });

  /* ------------------------------------------- scenery parts for this project */

  // The lab's equal-arm comparator. The depot kilo (left) and the lab standard
  // (right) hang from the beam ends; a rider can go on either pan. The pin has
  // a weak restoring spring (a low centre of mass), so the beam settles at an
  // angle proportional to the mass difference: about 5° per gram.
  var GHOST = { category: 0x4000, mask: 0 };   // touches nothing
  var ARM = 0.25, BEAM_M = 0.5, SENS = 5 * Math.PI / 180 / 1e-3;   // rad per kg
  Y.definePart({
    type: 'p06-comparator', name: 'Mass comparator', category: 'Measure', library: false,
    blurb: 'An equal-arm balance. It compares masses: it levels when both pans hold the same mass, whatever g is.',
    size: { w: 0.8, h: 1.1 },
    dials: [
      { key: 'rider', label: 'Rider', q: 'mass', def: '0 g', min: 0, max: 0.05 },
      { key: 'pan', label: 'Rider on', choice: ['kilo pan', 'standard pan'], def: 'kilo pan' },
      { key: 'cert', label: 'Certificate: depot kilo', q: 'mass', def: '1.00000 kg', min: 0 }
    ],
    build: function (b) {
      var P = b.P, g = b.site.g, piv = b.at({ x: 0, y: 0 });
      var post = b.body({ type: 'static', position: b.at({ x: 0, y: -0.5 }), label: '', shapes: [{ shape: P.box(0.03, 0.5), filter: GHOST }] });
      var beam = b.body({ position: piv, label: 'comparator beam', mass: BEAM_M, allowSleep: false, shapes: [{ shape: P.box(ARM + 0.04, 0.012), filter: GHOST }] });
      var I = beam.I;
      var k = g * ARM / SENS, c = 2 * Math.sqrt(k * I);
      var pin = b.joint(new P.RevoluteJoint({ bodyA: b.ground, bodyB: beam, worldAnchor: piv, stiffness: k, damping: c, label: 'comparator pin' }));
      var rider = b.si('rider'), onKilo = b.si('pan') === 'kilo pan';
      var mL = MK + (onKilo ? rider : 0), mR = LAB_STD + (onKilo ? 0 : rider);
      function apply() {
        beam.applyForce({ x: 0, y: -mL * g }, beam.worldPoint({ x: -ARM, y: 0 }));
        beam.applyForce({ x: 0, y: -mR * g }, beam.worldPoint({ x: ARM, y: 0 }));
      }
      apply();
      b.on('step', apply);
      return { body: beam, bodies: [post, beam], joints: [pin], post: post, beam: beam, pin: pin, tilt: function () { return beam.angle; } };
    },
    readouts: function (built) { return [{ key: 'tilt', label: 'tilt', q: 'angle', read: function () { return built.beam.angle; } }]; },
    plate: function (inst) { return ['Left pan: depot kilo (stamped 1 kg)', 'Right pan: lab standard 1.000 00 kg', 'Certificate: ' + (inst.dials.cert || '?')]; },
    draw: function (ctx, cam, built) {
      var beam = built.beam, th = beam.angle, rider = built.values.rider, onKilo = built.values.pan === 'kilo pan';
      ctx.save();
      ctx.strokeStyle = 'rgba(230,220,190,.9)'; ctx.fillStyle = 'rgba(230,220,190,.9)'; ctx.lineWidth = 2;
      ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      [-1, 1].forEach(function (side) {
        var end = cam.worldToScreen(beam.worldPoint({ x: side * ARM, y: 0 }));
        var drop = 0.32 * cam.zoom, pan = 0.1 * cam.zoom;
        ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(end.x, end.y + drop); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(end.x - pan, end.y + drop); ctx.lineTo(end.x + pan, end.y + drop); ctx.stroke();
        var s = 0.045 * cam.zoom;
        ctx.fillStyle = side < 0 ? 'rgba(150,170,90,.95)' : 'rgba(200,205,215,.95)';
        ctx.fillRect(end.x - s, end.y + drop - 2 * s, 2 * s, 2 * s);
        ctx.fillStyle = 'rgba(230,220,190,.9)';
        ctx.fillText(side < 0 ? 'DEPOT KILO' : 'LAB STD', end.x, end.y + drop + 14);
        if (rider > 0 && (side < 0) === onKilo) { ctx.fillStyle = '#ffb347'; ctx.fillRect(end.x + s + 3, end.y + drop - 6, 6, 5); ctx.fillText('+' + built.inst.dials.rider, end.x, end.y + drop + 28); ctx.fillStyle = 'rgba(230,220,190,.9)'; }
      });
      // pointer, magnified 20x against a scale under the pivot
      var pv = cam.worldToScreen(beam.c), L = 0.42 * cam.zoom, a = Math.max(-0.6, Math.min(0.6, -th * 20));
      ctx.strokeStyle = 'rgba(230,220,190,.5)'; ctx.lineWidth = 1;
      for (var i = -5; i <= 5; i++) { var ai = i * 0.1; ctx.beginPath(); ctx.moveTo(pv.x + Math.sin(ai) * L * 0.9, pv.y + Math.cos(ai) * L * 0.9); ctx.lineTo(pv.x + Math.sin(ai) * L, pv.y + Math.cos(ai) * L); ctx.stroke(); }
      ctx.strokeStyle = Math.abs(th) < LEVEL ? '#8fd16a' : '#ffb347'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pv.x, pv.y); ctx.lineTo(pv.x + Math.sin(a) * L, pv.y + Math.cos(a) * L); ctx.stroke();
      ctx.fillStyle = 'rgba(230,220,190,.7)'; ctx.fillText('pointer ×20', pv.x, pv.y + L + 14);
      ctx.restore();
    }
  });

  // A yard trailer. The crew reads the load ticket and hitches the smallest
  // trailer on the yard sheet that covers it; its axle is rated for that
  // payload and really snaps above it. Then a tractor tows it `haul` metres.
  var DECK_M = 120;
  Y.definePart({
    type: 'p06-trailer', name: 'Yard trailer', category: 'Loads', library: false,
    blurb: 'Write the load on the ticket. The crew hitches the smallest trailer on the yard sheet that covers it, and tows it to the tower base.',
    size: { w: 2.4, h: 0.68 },
    dials: [
      { key: 'ticket', label: 'Load ticket', q: 'force', def: '', optional: true, min: 0 },
      { key: 'haul', label: 'Tow distance', q: 'length', def: '12 m', min: 0, max: 40 }
    ],
    anchors: { deck: { x: 0, y: 0.1 } },
    build: function (b) {
      var P = b.P, g = b.site.g, ticket = b.si('ticket');
      if (ticket == null) throw new Error('Write the load on the ticket: the crew picks the trailer from it.');
      var cls = trailerFor(ticket);
      if (!cls) throw new Error('Nothing on the yard sheet is rated for ' + b.text('ticket') + '.');
      var noHit = { group: -61 };
      var deck = b.body({ position: b.at({ x: 0, y: 0 }), label: '', mass: DECK_M, shapes: [{ shape: P.box(1.2, 0.1), material: 'steel', filter: noHit }] });
      var gear = b.body({ position: b.at({ x: 0, y: -0.22 }), label: '', mass: 40, shapes: [{ shape: P.box(0.9, 0.12), material: 'frictionless', filter: noHit }] });
      var axle = b.joint(new P.WeldJoint({ bodyA: gear, bodyB: deck, worldAnchor: b.at({ x: 0, y: -0.1 }), label: cls.name + ' axle' }));
      var x0 = gear.c.x, dist = b.si('haul'), world = b.world;
      function tow() {
        // the crane sets the tank down over the first half second; then the axle carries it all
        if (world.time >= 0.5 && axle.breakForce === Infinity) axle.breakForce = cls.cap + DECK_M * g;
        if (world.time < 1) return;                 // let the load settle first
        var rem = x0 + dist - gear.c.x, vt = Math.max(-1.2, Math.min(1.2, 0.6 * rem));
        var F = Math.max(-2500, Math.min(2500, 3000 * (vt - gear.v.x)));
        gear.applyForce({ x: F, y: 0 }, gear.c);
      }
      b.on('step', tow);
      return { body: deck, bodies: [deck, gear], joints: [axle], deck: deck, gear: gear, axle: axle, cls: cls, g: g,
        anchors: { deck: { body: deck, local: { x: 0, y: 0.1 } } } };
    },
    readouts: function (built) { return [{ key: 'axle', label: 'axle load', q: 'force', read: function (w) { return built.axle.broken ? 0 : Math.max(0, built.axle.force() - DECK_M * built.g); } }]; },
    plate: function (inst) {
      var r = D.parse(inst.dials.ticket, 'force'), cls = r.ok ? trailerFor(r.si) : null;
      return ['Ticket: ' + (inst.dials.ticket || 'blank'), cls ? 'Crew hitches: ' + cls.name + ' (' + cls.tag + ')' : 'Crew hitches: nothing yet'];
    },
    draw: function (ctx, cam, built) {
      var g = built.gear, d = built.deck;
      ctx.save();
      ctx.fillStyle = 'rgba(40,40,40,.95)'; ctx.strokeStyle = 'rgba(200,200,200,.8)'; ctx.lineWidth = 2;
      [-0.65, 0.65].forEach(function (dx) {
        var c = cam.worldToScreen(g.worldPoint({ x: dx, y: -0.02 }));
        ctx.beginPath(); ctx.arc(c.x, c.y, 0.1 * cam.zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
      var t = cam.worldToScreen(d.worldPoint({ x: -1.15, y: -0.02 }));
      ctx.fillStyle = 'rgba(255,220,150,.95)'; ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(built.cls.name.toUpperCase() + ' · ' + built.cls.tag + (built.axle.broken ? ' · AXLE SNAPPED' : ''), t.x, t.y + 4);
      ctx.restore();
    }
  });

  // The tank's rating plate: whatever is stamped on it is what the tower
  // crew believes from now on. Clips onto a part.
  Y.definePart({
    type: 'p06-plate', name: 'Rating plate', category: 'Measure', library: false,
    blurb: 'A brass plate riveted to the tank. Stamp the mass the way the standard says.',
    size: { w: 0.4, h: 0.2 },
    connector: true, attach: true,
    dials: [{ key: 'mass', label: 'Stamped mass', q: 'mass', def: '', optional: true, min: 0 }],
    build: function (b) { return { target: b.end('a').body, bodies: [] }; },
    plate: function (inst) { return ['Stamped: ' + (inst.dials.mass || 'blank')]; },
    draw: function (ctx, cam, built) {
      var c = cam.worldToScreen(built.target.c), w = 0.7 * cam.zoom, h = 0.22 * cam.zoom;
      ctx.save();
      ctx.fillStyle = 'rgba(190,150,70,.95)'; ctx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
      ctx.fillStyle = '#1a1408'; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText(built.inst.dials.mass || '— kg', c.x, c.y + 4);
      ctx.restore();
    }
  });
})(globalThis.SE);
