/*
 * Act I: Rustline Depot (Chapter 1, General Principles).
 *
 * This file registers the chapter, its formula-sheet entries and reference
 * tables, and the free sandboxes. Each handheld level lives in levels/ and
 * each manual project in projects/.
 */
(function (SE) {
  'use strict';
  var C = SE.content;

  C.registerChapter({
    id: 'ch01', number: 1, act: 'I', region: 'Rustline Depot', title: 'General Principles',
    intro: [
      'The settlement of **Kettle Hollow** has moved into an old freight depot: steel sheds, a dead rail spur and a gantry crane that still turns over. The walls are thin and the dead walk the fence line at night.',
      'You are the salvage engineer. Before you can rig a single cable you need the basics every later job rests on: what mechanics studies, the quantities it measures, Newton\'s laws, gravity and weight, units, and how to calculate without fooling yourself.',
      '**Handheld** levels walk you through it. **Manual** projects hand you a brief and get out of the way. Anything you unlock here (formula sheet, converter, checkers) stays with you for the rest of the game.'
    ].join('\n\n'),
    sandboxes: [
      { id: 'sb-track', title: 'Rail yard (Newton\'s laws)', scene: { type: 'track', params: { surface: 'ice', bodies: [{ id: 'a', m: 50, x: 4, v: 0, label: '50 kg', kind: 'sled' }], length: 30, trail: true, showVectors: true } }, text: 'Push sleds and carts. Watch velocity and acceleration.', prompts: ['Set the force to zero while moving: what does the velocity do?', 'Double the mass at the same force: what happens to *a*?'] },
      { id: 'sb-hoist', title: 'Gantry hoist (weight)', scene: { type: 'hoist', params: { mass: 250, label: '250 kg', mode: 'hover', hookHeight: 3, governor: 2452.5 } }, text: 'Set the winch tension and see what the load does.', prompts: ['Find the tension that makes the load hover.'] },
      { id: 'sb-gravity', title: 'Gravity lab', scene: { type: 'gravity', params: { mode: 'altitude' } }, text: 'Fly the weather drone up and watch the crate\'s weight fall off with distance.', prompts: ['At what altitude has the weight halved?'], actions: [{ label: 'Fly the drone ▸', run: function (ctx) { return ctx.scene.run({}).then(function (r) { return 'Result: **' + r.outcome + '**'; }); } }] },
      { id: 'sb-scales', title: 'Scales: mass vs weight', scene: { type: 'scales', params: { mode: 'compare' } }, text: 'Take the same object to different places. Which instrument changes its reading?', prompts: ['Switch to the Moon. Which scale changes?'], actions: [{ label: 'Weigh it ▸', run: function (ctx) { return ctx.scene.run({}).then(function (r) { return 'Result: **' + r.outcome + '**'; }); } }] },
      { id: 'sb-gate', title: 'Gate and beams', scene: { type: 'gate', params: { mode: 'gate' } }, text: 'Push the gate anywhere, at any angle.', prompts: ['Push along the gate toward the hinge. What happens?'], actions: [{ label: 'Push the gate ▸', run: function (ctx) { return ctx.scene.run({}).then(function (r) { return 'Result: **' + r.outcome + '**'; }); } }] },
      { id: 'sb-bench', title: 'Measuring bench', scene: { type: 'bench', params: { mode: 'fence' } }, text: 'Round a whole cut list three different ways and build the wall.', prompts: ['Which rounding rule leaves the smallest gap?'], actions: [{ label: 'Build the wall ▸', run: function (ctx) { return ctx.scene.run({}).then(function (r) { return 'Result: **' + r.outcome + '**'; }); } }] }
    ]
  });

  var F = function (def) { C.registerFormula(Object.assign({ chapter: 'ch01' }, def)); };
  var G1 = 'Ch 1 · Mechanics & Newton', G2 = 'Ch 1 · Gravity & weight', G3 = 'Ch 1 · Units', G4 = 'Ch 1 · Numbers', G5 = 'Ch 1 · Procedure', G6 = 'Ch 1 · Beyond the book';

  F({ id: 'ch01.statics', group: G1, title: 'Statics is the a = 0 case', eq: 'a = 0 \\quad \\t{(at rest, or constant velocity)}', note: 'Statics: bodies in equilibrium. Dynamics: accelerated motion. Statics is the special case of dynamics with zero acceleration.' });
  F({ id: 'ch01.branches', group: G1, title: 'Branches of mechanics', note: '**Rigid-body** (this game), **deformable-body** and **fluid** mechanics. Rigid-body mechanics splits into **statics** and **dynamics**.' });
  F({ id: 'ch01.force', group: G1, title: 'A force is fully described by', note: '**magnitude**, **direction** and **point of application**. Forces act by contact or at a distance (gravity, magnetism).' });
  F({ id: 'ch01.idealizations', group: G1, title: 'Idealizations', note: '**Particle**: mass, negligible size. **Rigid body**: particles stay a fixed distance apart, so no deformation. **Concentrated force**: load acting at a point, when the loaded area is small compared with the body.' });
  F({ id: 'ch01.newton1', group: G1, title: 'Newton\'s first law', note: 'With no unbalanced force, a particle at rest stays at rest and a moving particle keeps a constant velocity (straight line, constant speed). Valid in a non-accelerating reference frame.' });
  F({ id: 'ch01.newton2', group: G1, title: 'Newton\'s second law', eq: 'F = ma', tag: '1–1', note: 'Unbalanced force → acceleration in the same direction, proportional to the force. Equivalently, force = rate of change of linear momentum, $F = \\frac{d(mv)}{dt}$.' });
  F({ id: 'ch01.newton3', group: G1, title: 'Newton\'s third law', note: 'When two particles push or pull on each other, the two forces have the **same size**, point **opposite ways** along the **same line**, and each acts on a *different* body.' });

  F({ id: 'ch01.gravitation', group: G2, title: 'Law of gravitation', eq: 'F = G\\frac{m_1 m_2}{r^2}', tag: '1–2', note: '$G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$, *r* = distance between the particles (centre to centre).' });
  F({ id: 'ch01.weight', group: G2, title: 'Weight', eq: 'W = mg, \\quad g = \\frac{GM_e}{r^2}', tag: '1–3', note: 'Weight depends on *r*, so it is not absolute. Engineering uses the **standard location**: sea level, 45° latitude.' });
  F({ id: 'ch01.weight-si', group: G2, title: 'Weight in SI', eq: 'W = mg \\quad (g = 9.81\\u{ m/s^2})', tag: '1–4', note: 'Measured standard value 9.806 65 m/s². A 1 kg mass weighs 9.81 N.' });
  F({ id: 'ch01.weight-fps', group: G2, title: 'Mass in FPS', eq: 'm = \\frac{W}{g} \\quad (g = 32.2\\u{ ft/s^2})', tag: '1–5', note: 'A 32.2 lb weight has a mass of 1 slug.' });

  F({ id: 'ch01.base-units', group: G3, title: 'Base and derived units', note: 'F = ma ties length, time, mass and force together, so only **three** units can be chosen freely (base units); the fourth is derived. SI: m, s, kg base; **N = kg·m/s²** derived. FPS: ft, s, lb base; **slug = lb·s²/ft** derived.' });
  F({ id: 'ch01.table-units', group: G3, title: 'Systems of units (Table 1–1)', table: { head: ['System', 'Length', 'Time', 'Mass', 'Force'], rows: [['SI', 'meter (m)', 'second (s)', 'kilogram (kg)', 'newton (N)* = kg·m/s²'], ['U.S. Customary (FPS)', 'foot (ft)', 'second (s)', 'slug* = lb·s²/ft', 'pound (lb)']] }, note: '\\* derived unit' });
  F({ id: 'ch01.table-conv', group: G3, title: 'Conversion factors (Table 1–2)', table: { head: ['Quantity', 'FPS', 'equals', 'SI'], rows: [['Force', '1 lb', '=', '4.448 N'], ['Mass', '1 slug', '=', '14.59 kg'], ['Length', '1 ft', '=', '0.3048 m']] }, note: 'Also: 1 ft = 12 in, 1 mi = 5280 ft, 1 kip = 1000 lb, 1 ton = 2000 lb, 1 h = 3600 s.' });
  F({ id: 'ch01.table-prefix', group: G3, title: 'SI prefixes (Table 1–3)', table: { head: ['Multiple', 'Exponential', 'Prefix', 'Symbol'], rows: [['1 000 000 000', '10⁹', 'giga', 'G'], ['1 000 000', '10⁶', 'mega', 'M'], ['1 000', '10³', 'kilo', 'k'], ['0.001', '10⁻³', 'milli', 'm'], ['0.000 001', '10⁻⁶', 'micro', 'μ'], ['0.000 000 001', '10⁻⁹', 'nano', 'n']] }, note: 'Each step moves the decimal point three places. No deca or centi in engineering. Odd one out: the kilogram already carries a prefix (kilo), so 1000 kg is written 1 Mg, never 1 kkg.' });
  F({ id: 'ch01.si-rules', group: G3, title: 'SI rules of use', note: '- Separate multiplied units with a dot: **m·s** (meter-second) vs **ms** (millisecond).\n- An exponent applies to the prefix too: mm² = (mm)².\n- No prefix in a denominator (kg excepted): write kN/m, not N/mm.\n- Calculate in base units and powers of 10, then re-express with **one** prefix, keeping the number between 0.1 and 1000.' });

  F({ id: 'ch01.homogeneity', group: G4, title: 'Dimensional homogeneity', eq: 's = vt + \\frac{1}{2}at^2 \\quad [\\u{m}] = [\\u{(m/s)·s}] = [\\u{(m/s^2)·s^2}]', note: 'Every term of a physical equation has the same units. Use it as a check on algebra.' });
  F({ id: 'ch01.sigfigs', group: G4, title: 'Significant figures & engineering notation', note: 'Leading zeros are not significant (0.004 37 → 3 s.f.). Trailing zeros in a whole number are ambiguous (61 200), so use engineering notation: 61.2(10³) for 3 s.f. Exponents are multiples of 3.' });
  F({ id: 'ch01.rounding', group: G4, title: 'Rounding', note: 'First dropped digit > 5: round up. < 5: leave. **Exactly 5**: if the preceding digit is even, leave it; if odd, round up (48.65 → 48.6, 0.3735 → 0.374). Keep full precision through a calculation; report the final answer to **3 s.f.**' });
  F({ id: 'ch01.procedure', group: G5, title: 'General procedure for analysis', note: '1. **Read**: connect the situation to the theory.\n2. **Tabulate** the data; **draw** diagrams to scale.\n3. **Apply** principles as equations, checking homogeneity.\n4. **Solve**; report to 3 s.f.\n5. **Judge** the answer: is it reasonable?' });

  F({ id: 'ch01.g-latitude', group: G6, title: 'g at latitude φ and altitude h', eq: 'g \\approx 9.780327(1 + 0.0053024\\sin^2\\phi - 0.0000058\\sin^2 2\\phi) - 3.086(10^{-6})h', note: 'Rotation and Earth\'s equatorial bulge lower g at the equator (≈ 9.780) vs the poles (≈ 9.832). *h* in m. Standard gravity 9.806 65 m/s² is a defined value close to g at 45° and sea level.' });
  F({ id: 'ch01.error-prop', group: G6, title: 'Propagating measurement uncertainty', eq: '\\frac{\\Delta(ab)}{ab} \\approx \\sqrt{\\left(\\frac{\\Delta a}{a}\\right)^2 + \\left(\\frac{\\Delta b}{b}\\right)^2}', note: 'Products and quotients: relative uncertainties combine (worst case: they add). Sums and differences: absolute uncertainties combine.' });
  F({ id: 'ch01.si-2019', group: G6, title: 'The 2019 SI', note: 'Since 20 May 2019 every SI unit is defined by fixing an exact value of a constant of nature. The kilogram is fixed by the Planck constant *h* = 6.626 070 15 × 10⁻³⁴ J·s, not by a metal cylinder in a vault.' });
})(globalThis.SE);
