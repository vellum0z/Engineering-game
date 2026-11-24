/*
 * H9 · Balance the Books: dimensional homogeneity. Every term of a physical
 * equation must carry the same units, which makes the units a quick (but
 * partial) check on algebra. Course section 1.5.
 */
(function (SE) {
  'use strict';

  var G = 66.73e-12;          // m^3/(kg·s^2), course value
  var g = 9.81;

  // ---------------------------------------------------------------- the plow
  // The depot plow comes down the spur at v0 and has to stop with its blade
  // at the stop line. A pallet of sandbags rides on the blade, held only by
  // friction, so braking too hard throws it off.
  var V0 = 10.0, S_STOP = 25.0, T_STOP = 5.00;
  // a = 2s/t^2 - 2v/t = 2(25.0)/5.00^2 - 2(10.0)/5.00 = 2.00 - 4.00 = -2.00 m/s^2
  // check: s = vt + at^2/2 = 10.0(5.00) + (-2.00)(25.0)/2 = 50.0 - 25.0 = 25.0 m
  var A_BRAKE = 2 * S_STOP / (T_STOP * T_STOP) - 2 * V0 / T_STOP;
  // the slip: 2s/t - 2v/t^2 = 10.0 - 0.800 = 9.20, a factor of -4.60 off
  var A_SLIP = 2 * S_STOP / T_STOP - 2 * V0 / (T_STOP * T_STOP);

  var M_PLOW = 4000, M_BAGS = 600;
  var MU_S_BED = 0.30, MU_K_BED = 0.25;      // sandbag sacking on a steel blade
  var A_SLIDE = MU_S_BED * g;                 // 2.94 m/s^2: the most the blade can hold
  var W_PLOW = 4.0, W_BAGS = 1.0, GAP = 0.05;
  var YARD = 32;                              // barricade face
  var BAGS_FRONT0 = YARD - S_STOP - 0.5;      // the stop line sits 0.5 m short of the barricade
  var STOP_LINE = BAGS_FRONT0 + S_STOP;

  function plowBodies() {
    var bagsX = BAGS_FRONT0 - W_BAGS / 2;
    var plowX = bagsX - W_BAGS / 2 - GAP - W_PLOW / 2;
    return [
      { id: 'bags', m: M_BAGS, x: bagsX, v: V0, mu: 0, label: 'sandbags', kind: 'crate', w: W_BAGS },
      { id: 'plow', m: M_PLOW, x: plowX, v: V0, mu: 0, label: 'plow 4 t', kind: 'cart', w: W_PLOW }
    ];
  }
  function PLOW(extra) {
    return { type: 'track', params: Object.assign({ surface: 'concrete', length: YARD, trail: true, showVectors: true, bumperRating: 0.3, zombies: 6, target: 'bags', bodies: plowBodies() }, extra || {}) };
  }

  /*
   * Run the plow with a constant acceleration a (negative = braking).
   * Braking is modelled as kinetic friction on the plow (mu = |a|/g), so it
   * stops and stays stopped. The sandbags move with the blade while the
   * deceleration is within what static friction can hold (|a| <= mu_s g);
   * beyond that they slide on kinetic friction alone and shoot ahead.
   * A positive a means the driver is on the throttle: both get pushed.
   */
  function runPlow(ctx, a) {
    var s = ctx.setScene('track', PLOW().params);
    var plow = s.body('plow'), bags = s.body('bags');
    var forces = {};
    if (a < 0) {
      var mu = -a / g;
      plow.mu = mu; plow.muS = mu * 1.2;
      if (-a <= A_SLIDE) { bags.mu = mu; bags.muS = mu * 1.2; }
      else { bags.mu = MU_K_BED; bags.muS = MU_S_BED; }
    } else {
      forces.plow = M_PLOW * a; forces.bags = M_BAGS * a;
    }
    // run() resets the bodies, so copy the friction into the definitions too
    s.p.bodies.forEach(function (d) { var b = s.body(d.id); d.mu = b.mu; d.muS = b.muS; });
    return s.run({ duration: 16, forces: forces, settle: true }).then(function (r) {
      return { r: r, plow: s.body('plow'), bags: s.body('bags'), slid: a < 0 && -a > A_SLIDE };
    });
  }

  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  // ----------------------------------------------------------- the spheres
  // Two 300 kg steel wrecking balls, each 210 mm in radius, hung touching.
  var M_BALL = 300, R_BALL = 0.210;
  var RHO_BALL = M_BALL / (4 / 3 * Math.PI * Math.pow(R_BALL, 3));   // 7.73 Mg/m^3, so R comes out at 0.210 m
  var D_BALL = 2 * R_BALL;                                            // 0.420 m centre to centre
  // F = G m1 m2 / r^2 = 66.73e-12 (300)(300) / 0.420^2 = 6.0057e-6 / 0.1764 = 3.4046e-5 N = 34.0 μN
  var F_BALLS = G * M_BALL * M_BALL / (D_BALL * D_BALL);
  // two 1 kg masses 1 m apart: F = G (1)(1)/1^2 = 66.73e-12 kg·m/s^2
  var F_UNIT = G * 1 * 1 / (1 * 1);
  var BALL_CABLE = 4;
  var SPHERES = { type: 'gravity', params: { mode: 'spheres', ballMass: M_BALL, density: RHO_BALL, gap: 0, Lc: BALL_CABLE, label: 'wrecking balls' } };

  // ------------------------------------------------------------- the hoist
  // Lift from rest at a steady a: the stop block is 4.00 m up.
  var M_LOAD = 200, A_LIFT = 0.500, S_LIFT = 4.00;
  var T_LIFT = M_LOAD * (g + A_LIFT);                 // 200(10.31) = 2062 N
  var TOP_CLEAR = 1.1, CRATE = 1.2;                   // hoist geometry: top of travel = height - 1.1 - crate
  // s = at^2/2 -> t = sqrt(2s/a) = sqrt(16.0) = 4.00 s;  s = 2at^2 -> t = sqrt(s/2a) = 2.00 s
  var T_HALF = Math.sqrt(2 * S_LIFT / A_LIFT), T_TWO = Math.sqrt(S_LIFT / (2 * A_LIFT));

  function openDim(expr, vars) {
    SE.tools.open('dimcheck', { dimExpr: expr, dimVars: vars });
  }
  var KIN_VARS = 's: m\nv: m/s\nt: s\na: m/s^2';
  var GRAV_VARS = 'F: N\nG: m^3/(kg*s^2)\nm_1: kg\nm_2: kg\nr: m';

  // Units of a candidate formula, as the dimension checker would print them.
  function unitsOf(rhs) {
    var r = SE.expr.analyze('s = ' + rhs, { s: 'm', v: 'm/s', a: 'm/s^2' });
    var t = r.terms.filter(function (x) { return x.side !== r.terms[0].side; })[0] || r.terms[r.terms.length - 1];
    return { ok: r.homogeneous, units: t && t.dims ? (SE.units.dimsToSI(t.dims) || '1') : '?' };
  }

  SE.content.registerLevel('ch01', {
    id: 'H9', order: 9, title: 'Balance the Books',
    subtitle: 'Dimensional homogeneity',
    sections: ['1.5'],
    minutes: 20,
    intro: [
      'The depot plow has no working speedometer and a brake pedal that the last driver described as "moody". Hask has the logbook open on the hood.',
      '"Quartermaster won\'t let you add bolts to litres in her ledger, and physics won\'t let you add metres to seconds. Every term of a real equation is in the same currency. Learn to check that, and you\'ll catch half your algebra mistakes before they catch you."'
    ].join('\n\n'),
    goals: [
      'Check that every term of an equation has the same units',
      'Use homogeneity to test a rearrangement, such as solving $s = v t + \\frac{1}{2}a t^2$ for *a*',
      'Show that Eq. 1–2 gives a force in newtons, then use it',
      'Explain why a homogeneous equation can still be wrong'
    ],
    scene: PLOW(),
    unlocks: { tools: ['dimcheck'], formulas: ['ch01.homogeneity'], materials: [] },
    proveIt: [
      {
        id: 'H9.prove-a',
        text: 'A handcart rolls onto the ramp at **6.00 m/s** and must cover **40.0 m** in **8.00 s** with constant acceleration. Find *a* (positive in the direction of travel).',
        inputs: [{
          key: 'a', label: 'Acceleration $a$', placeholder: 'e.g. -1.50 m/s^2',
          // a = 2s/t^2 - 2v/t = 80.0/64.0 - 12.0/8.00 = 1.25 - 1.50 = -0.250 m/s^2
          spec: { value: 2 * 40 / 64 - 2 * 6 / 8, unit: 'm/s^2', sf: 3, form: 'si' },
          answer: '-0.250 m/s^2',
          wrong: [{ input: '0.250 m/s^2', kind: 'sign' }, { input: '-0.250 m/s', kind: 'unit' }]
        }]
      },
      {
        id: 'H9.prove-g',
        text: 'Write the units of $G\\frac{m_1 m_2}{r^2}$ by doing the force between two **1.00 kg** masses **1.00 m** apart, carrying the units of *G* through. Answer in base units.',
        inputs: [{
          key: 'F', label: 'Force, in base units', placeholder: 'e.g. 12.3(10^-12) kg·m/s^2',
          spec: { value: F_UNIT, unit: 'N', sf: 3, form: 'any' },
          answer: '66.7(10^-12) kg·m/s^2',
          wrong: [{ input: '66.7(10^-12) m^3/(kg·s^2)', kind: 'unit' }]
        }]
      }
    ],
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Say the plow is doing **10 m/s** and the brakes give you a steady **2 m/s²** of deceleration. Somebody scrawled three stopping-distance formulas in the cab. Only one can even *possibly* be right, and you can find it without doing any physics at all. Look at the units.'
      },
      {
        type: 'predict', who: 'hask',
        q: 'Which stopping-distance formula could be right? *v* is in m/s, *a* in m/s², and the answer has to be a **distance**.',
        choices: [
          { t: '$s = \\frac{v^2}{2a}$', correct: true, why: '$\\frac{\\u{(m/s)^2}}{\\u{m/s^2}} = \\frac{\\u{m^2/s^2}}{\\u{m/s^2}} = \\u{m}$. A length, so it *could* be right, and the run shows that it is: 10²/(2·2) = 25 m.' },
          { t: '$s = \\frac{v}{2a}$', why: '$\\frac{\\u{m/s}}{\\u{m/s^2}} = \\u{s}$. That\'s a time, not a distance. No choice of number in front can fix it.' },
          { t: '$s = 2a v^2$', why: '$\\u{(m/s^2)(m^2/s^2)} = \\u{m^3/s^4}$. Nothing in the world is measured in that, least of all a stopping distance.' }
        ],
        run: function (ctx) {
          return runPlow(ctx, -2).then(function (o) {
            var c = [['v^2/(2a)', 'v²/(2a)'], ['v/(2a)', 'v/(2a)'], ['2*a*v^2', '2av²']].map(function (p) { var u = unitsOf(p[0]); return p[1] + ' → **' + u.units + '**'; });
            var dist = o.bags.x + W_BAGS / 2 - BAGS_FRONT0;
            return 'Units: ' + c.join(', ') + '. Measured: braking at 2.00 m/s² from 10.0 m/s, the plow stopped in **' + f2(dist) + ' m**.';
          });
        },
        reveal: 'You threw out two formulas with no physics, only bookkeeping. That bookkeeping has a name.'
      },
      {
        type: 'reveal', kicker: 'Principle', title: 'Dimensional homogeneity',
        eq: 's = v t + \\frac{1}{2}a t^{2}',
        text: 'An equation that models something real has to be **dimensionally homogeneous**: every term carries the **same units**. Only then can the terms be added once numbers go in.\n\nHere *s* is in m, *v* in m/s, *t* in s and *a* in m/s², and each of the three terms comes out in metres.\n\nThe workshop now has a **dimension checker** (key **d**). It reads an equation and the units of each symbol, and lays the terms out side by side.',
        formula: 'ch01.homogeneity',
        unlock: 'dimcheck'
      },
      {
        type: 'derive', who: 'hask', title: 'Check it, then solve it for a',
        intro: 'The plow has a fixed stopping line, a speed and a time. We need *a*. Rearrange, and audit the units at every step.',
        lines: [
          { eq: 's = v t + \\frac{1}{2}a t^{2}', why: 'Position after time *t*, starting at speed *v* with constant acceleration *a*.' },
          {
            eq: '\\u{m} \\quad = \\quad \\u{(m/s)·s} \\quad + \\quad \\u{(m/s^2)·s^2}',
            why: 'Put each symbol\'s units in place of the symbol.',
            ask: { q: 'What units does the middle term, *vt*, come out in?', choices: [
              { t: 'm', correct: true, why: 'The seconds cancel: (m/s)·s = m.' },
              { t: 'm/s', why: 'Multiply by *t*: (m/s)·s. The seconds cancel.' },
              { t: 'm·s', why: 'Dividing by s and multiplying by s cancels them. It\'s (m/s)·s = m.' }
            ] }
          },
          {
            eq: '\\u{(m/s^2)·s^2} = \\u{m}',
            why: 'The ½ is a pure number. It changes the value of the term, never its units.',
            ask: { q: 'What do the units of the **½** add to the last term?', choices: [
              { t: 'Nothing. It\'s dimensionless.', correct: true, why: 'Right. Numbers like ½, 2 and π carry no units.' },
              { t: 'A factor of 1/s', why: 'A plain number has no units at all. Only symbols that stand for measured quantities do.' }
            ] }
          },
          { eq: '\\u{m} = \\u{m} + \\u{m} \\quad \\t{(homogeneous)}', why: 'All three terms in metres, so they can be added.' },
          {
            eq: '\\frac{1}{2}a t^{2} = s - v t',
            why: 'Get the *a* term alone.',
            ask: { q: 'First move to isolate the *a* term?', choices: [
              { t: 'Subtract *vt* from both sides', correct: true, why: 'Both are lengths, so the subtraction is legal.' },
              { t: 'Divide both sides by *v*', why: 'That would leave *t* on its own in the middle term but bury *a* under a 1/*v*. Clear the other term first.' }
            ] }
          },
          {
            eq: 'a = \\frac{2s}{t^{2}} - \\frac{2v}{t}',
            why: 'Multiply both sides by 2/t².',
            ask: { q: 'Multiply both sides by $\\frac{2}{t^2}$. What do you get?', choices: [
              { t: '$a = \\frac{2s}{t^2} - \\frac{2v}{t}$', correct: true, why: 'Each term on the right gets the 2/t². In the *vt* term one *t* cancels.' },
              { t: '$a = \\frac{2s}{t} - \\frac{2v}{t^2}$', why: 'Check the units: 2s/t is m/s, and 2v/t² is m/s³. Neither is an acceleration, and they can\'t even be subtracted from each other. The powers of *t* got swapped.' },
              { t: '$a = \\frac{2s}{t^2} - 2v t$', why: '2vt is in metres, and 2s/t² is in m/s². You can\'t subtract a length from an acceleration. The *t* belongs in the denominator.' }
            ] }
          },
          { eq: '\\u{m/s^2} = \\frac{\\u{m}}{\\u{s^2}} - \\frac{\\u{m/s}}{\\u{s}} = \\u{m/s^2} - \\u{m/s^2}', why: 'Every term is in m/s². The rearrangement passes the check.' },
          {
            eq: '\\frac{2s}{t} - \\frac{2v}{t^{2}} \\quad \\to \\quad \\u{m/s} - \\u{m/s^3}',
            why: 'The tempting slip, with the powers of *t* swapped.',
            ask: { q: 'Does the slipped version pass the homogeneity check?', choices: [
              { t: 'No. Its terms have different units, and neither is m/s².', correct: true, why: 'Caught, without plugging in a single number.' },
              { t: 'Yes. It still has *s*, *v* and *t* in it.', why: 'Having the right symbols isn\'t enough. Their units must combine to the same thing in every term.' }
            ] }
          }
        ],
        outro: '**Important point.** After every algebra step, check the equation is still dimensionally homogeneous. It cannot catch every slip, but it catches a lot of them.'
      },
      {
        type: 'task', id: 'H9.brake', who: 'hask', title: 'Stop on the line',
        scene: PLOW(),
        hud: ['Stop line **' + S_STOP.toFixed(1) + ' m** ahead · barricade 0.5 m past it', 'Sandbags on the blade: static friction holds them up to about ' + A_SLIDE.toFixed(2) + ' m/s²'],
        text: 'The plow comes down the spur at **10.0 m/s** carrying a pallet of sandbags on its blade. The blade has to stop on the line **25.0 m** ahead, and the brake governor takes the stop over exactly **5.00 s** with uniform braking.\n\nSet the governor: what is the plow\'s acceleration *a*? Take positive as the direction of travel. Brake too gently and the blade goes through the barricade. Brake too hard and the sandbags fly off.',
        inputs: [{
          key: 'a', label: 'Acceleration $a$', placeholder: 'e.g. -1.50 m/s^2',
          // a = 2(25.0)/5.00^2 - 2(10.0)/5.00 = 2.00 - 4.00 = -2.00 m/s^2
          spec: { value: A_BRAKE, unit: 'm/s^2', sf: 3, form: 'si', mistakes: [{ ratio: Math.abs(A_SLIP / A_BRAKE), kind: 'algebra', msg: 'That\'s 2s/t − 2v/t², with the powers of *t* swapped. Run it through the dimension check: its terms are m/s and m/s³.' }] },
          answer: '-2.00 m/s^2',
          wrong: [
            { input: '2.00 m/s^2', kind: 'sign' },
            { input: '9.20 m/s^2', kind: 'algebra' },
            { input: '-2.00 m/s', kind: 'unit' },
            { input: '-2 m/s^2', kind: 'sigfig' }
          ]
        }],
        hints: [
          'You have *s*, *v* and *t*, and you need *a*. Which equation links all four?',
          'Use $s = v t + \\frac{1}{2}a t^2$ rearranged for *a*: $a = \\frac{2s}{t^2} - \\frac{2v}{t}$. Check that both terms are m/s² before you plug in.',
          '$a = \\frac{2(25.0)}{5.00^2} - \\frac{2(10.0)}{5.00} = 2.00 - 4.00$. The minus sign means the plow is slowing down.'
        ],
        consequence: function (ctx, ans) {
          var a = ans.a.si != null && isFinite(ans.a.si) ? ans.a.si : 0;
          return runPlow(ctx, a).then(function (o) {
            var d = o.r.detail;
            var bagsFront = o.bags.x + W_BAGS / 2, plowFront = o.plow.x + W_PLOW / 2;
            if (d.bumperBroken) {
              return 'The blade hit the barricade at **' + f2(d.impactSpeed) + ' m/s** and tore it off its posts. The dead at the fence line are already shuffling toward the gap.' + (a >= 0 ? ' With *a* ≥ 0 the governor never braked at all.' : ' Braking at ' + f2(-a) + ' m/s² from 10.0 m/s needs ' + f2(V0 * V0 / (-2 * a)) + ' m, and there were only 25.5 m.');
            }
            if (o.slid) {
              return 'The plow stopped hard, its blade **' + f2(plowFront + GAP + W_BAGS - BAGS_FRONT0) + ' m** down the line, but ' + f2(-a) + ' m/s² is more than friction can hold the sandbags to (' + A_SLIDE.toFixed(2) + ' m/s²). They slid off the blade and skidded on another **' + f2(bagsFront - (plowFront + GAP + W_BAGS)) + ' m**. Somebody gets to restack 600 kg of sand.';
            }
            var off = bagsFront - STOP_LINE;
            return 'The plow eased to a stop **' + f2(Math.abs(off)) + ' m** ' + (off >= 0 ? 'past' : 'short of') + ' the line after ' + d.time.toFixed(2) + ' s, sandbags still on the blade.';
          });
        },
        explain: 'Both terms of $a = \\frac{2s}{t^2} - \\frac{2v}{t}$ are m/s², so the subtraction is honest: $2.00 - 4.00 = -2.00\\u{ m/s^2}$. The negative sign is the direction: the plow slows. Check: $10.0(5.00) + \\frac{1}{2}(-2.00)(5.00)^2 = 25.0\\u{ m}$.'
      },
      {
        type: 'try', who: 'hask',
        scene: SPHERES, hud: [],
        text: 'Now Newton\'s law of gravitation, $F = G\\frac{m_1 m_2}{r^2}$ (Eq. 1–2). *G* has odd-looking units, $\\u{m^3/(kg·s^2)}$, and they are exactly what\'s needed. Open the checker with Eq. 1–2 loaded and see what units the right side comes out in.',
        actions: [{ label: 'Open the dimension checker on Eq. 1–2', run: function (ctx) { ctx.runner._h9grav = true; openDim('F = G*m_1*m_2/r^2', GRAV_VARS); } }],
        goalText: 'Open the dimension checker on Eq. 1–2',
        goal: function (ctx) { return !!ctx.runner._h9grav; },
        after: '$\\frac{\\u{m^3}}{\\u{kg·s^2}} \\cdot \\frac{\\u{kg·kg}}{\\u{m^2}} = \\u{kg·m/s^2}$, which is exactly a newton. The two kilograms in the numerator cancel one in *G*\'s denominator, and the m² cancels two of *G*\'s three metres.'
      },
      {
        type: 'task', id: 'H9.gravity-units', who: 'hask', title: 'Two wrecking balls',
        scene: SPHERES,
        text: 'Two steel wrecking balls hang side by side on **4 m** cables, just touching. Each has a mass of **300 kg** and a radius of **210 mm**.\n\nFirst, prove the units: write the force between two **1.00 kg** masses **1.00 m** apart, carrying *G*\'s units through, in **base units**. Then find the gravitational pull between the two wrecking balls.',
        inputs: [
          {
            key: 'Fu', label: 'Force between 1 kg and 1 kg at 1 m (base units)', placeholder: 'e.g. 12.3(10^-12) kg·m/s^2',
            // F = 66.73e-12 m^3/(kg·s^2) · (1 kg)(1 kg)/(1 m)^2 = 66.73e-12 kg·m/s^2
            spec: { value: F_UNIT, unit: 'N', sf: 3, form: 'any' },
            answer: '66.7(10^-12) kg·m/s^2',
            wrong: [{ input: '66.7(10^-12) m^3/(kg·s^2)', kind: 'unit' }, { input: '66.7(10^-12) kg^2/m^2', kind: 'unit' }]
          },
          {
            key: 'F', label: 'Pull between the wrecking balls $F$', placeholder: 'e.g. 12.3 μN',
            // r = 2(0.210) = 0.420 m; F = 66.73e-12(300)(300)/0.420^2 = 3.4046e-5 N = 34.0 μN
            spec: { value: F_BALLS, unit: 'N', sf: 3, form: 'si', mistakes: [{ ratio: 4, kind: 'concept', msg: 'That uses the radius, 0.210 m, for *r*. In Eq. 1–2 *r* is the distance between the centres: two radii.' }] },
            answer: '34.0 μN',
            wrong: [{ input: '136 μN', kind: 'concept' }, { input: '34.0 mN', kind: 'prefix' }, { input: '3.40(10^-5) N', kind: 'form' }]
          }
        ],
        hints: [
          'Part one: put the units of each symbol into Eq. 1–2 and simplify. Part two: what is *r* when two spheres touch?',
          'The pull acts as if each ball\'s mass sat at its centre, so $r = 2(0.210) = 0.420\\u{ m}$. Then $F = G\\frac{m_1 m_2}{r^2}$.',
          '$F = 66.73(10^{-12})\\frac{(300)(300)}{0.420^2} = 3.4046(10^{-5})\\u{ N}$. Report it with one prefix, keeping the number between 0.1 and 1000.'
        ],
        consequence: function (ctx, ans) {
          var s = ctx.setScene(SPHERES.type, SPHERES.params);
          var guess = ans.F.si != null && isFinite(ans.F.si) ? ans.F.si : null;
          return s.run({ duration: 6 }).then(function (r) {
            var d = r.detail;
            var real = d.deflection1 * 1e9;
            var msg = 'The balls settled with each cable leaning in by **' + real.toFixed(2) + ' nm** (F/W = ' + SE.sigfig.roundSig(d.ratio, 3).text + ').';
            if (guess != null && guess > 0 && Math.abs(guess / d.F - 1) > 0.005) {
              var yours = BALL_CABLE * guess / d.W1 * 1e9;
              msg += ' Your F would have them lean **' + SE.sigfig.roundSig(yours, 3).text + ' nm**, ' + SE.sigfig.roundSig(yours / real, 3).text + '× what the plumb line shows.';
            }
            return msg;
          });
        },
        explain: 'The units: $\\frac{\\u{m^3}}{\\u{kg·s^2}} \\cdot \\frac{\\u{kg^2}}{\\u{m^2}} = \\u{kg·m/s^2} = \\u{N}$. The pull: $F = 66.73(10^{-12})(300)^2/0.420^2 = 34.0\\u{ μN}$, about a hundred-millionth of either ball\'s weight.'
      },
      {
        type: 'predict', who: 'hask', hud: [],
        scene: { type: 'hoist', params: { mass: M_LOAD, label: '200 kg', mode: 'lift', height: S_LIFT + TOP_CLEAR + CRATE, governor: T_LIFT } },
        q: 'The winch lifts this 200 kg crate from rest at a steady **0.500 m/s²**. The stop block is **4.00 m** up. Two apprentices write the formula for the lift time:\n\n$s = \\frac{1}{2}a t^2 \\implies t = \\sqrt{2s/a}$, or $s = 2a t^2 \\implies t = \\sqrt{s/(2a)}$\n\nBoth pass the dimension check. Which is right?',
        choices: [
          { t: '$t = \\sqrt{2s/a} = ' + T_HALF.toFixed(2) + '\\u{ s}$', correct: true, why: 'The ½ is right. A homogeneous equation *can* be right; the check just can\'t tell you that it is.' },
          { t: '$t = \\sqrt{s/(2a)} = ' + T_TWO.toFixed(2) + '\\u{ s}$', why: 'Its units are fine, s = √(m/(m/s²)), but the number in front is wrong, and units can\'t see numbers.' },
          { t: 'Can\'t tell: they\'re both homogeneous, so they\'re both right.', why: 'Homogeneity is necessary, not sufficient. One of them is off by a factor of 2 in time.' }
        ],
        run: function (ctx) {
          var s = ctx.scene, tHit = null;
          // the scene keeps its clock running while the result settles, so
          // note the time at the moment the crate reaches the stop block
          var watch = setInterval(function () { if (tHit == null && s.state === 'slammed') tHit = s.time; }, 10);
          return s.run(T_LIFT, { duration: 8 }).then(function (r) {
            clearInterval(watch);
            var t = tHit != null ? tHit : s.time;
            return 'Measured: the crate reached the stop block after **' + t.toFixed(2) + ' s** (the winch takes 0.3 s to build up tension, which adds a little) and hit it at ' + Math.abs(r.detail && r.detail.impact || 0).toFixed(2) + ' m/s.';
          });
        },
        reveal: 'Homogeneity is a **partial** check. It catches mistakes in units and powers. It cannot catch a wrong pure number (½ vs 2), a wrong sign, or a term that is the wrong one but happens to have the right units.'
      },
      {
        type: 'classify', id: 'H9.catch',
        text: 'Would a dimension check catch each slip?',
        bins: ['Caught', 'Slips through'],
        items: [
          { t: 'Writing $s = v/(2a)$ for the stopping distance', bin: 'Caught', why: 'v/(2a) is in seconds, not metres.' },
          { t: 'Writing $s = v t + 2a t^2$ instead of ½at²', bin: 'Slips through', why: '2 and ½ are both dimensionless. Every term is still in metres.' },
          { t: 'Solving to $a = \\frac{2s}{t} - \\frac{2v}{t^2}$', bin: 'Caught', why: 'The terms come out in m/s and m/s³.' },
          { t: 'Dropping the minus sign: $a = \\frac{2s}{t^2} + \\frac{2v}{t}$', bin: 'Slips through', why: 'A sign has no units, so the check passes. The plow would crash.' },
          { t: 'Using a ball\'s radius for *r* in Eq. 1–2 instead of the centre distance', bin: 'Slips through', why: 'Both are lengths, so the units still come out in newtons. The value is 4 times too big.' },
          { t: 'Forgetting to square *t*: $s = v t + \\frac{1}{2}a t$', bin: 'Caught', why: '(m/s²)·s = m/s, which can\'t be added to metres.' }
        ]
      },
      {
        type: 'sandbox', scene: PLOW(), hud: [],
        text: 'The checker is yours now. Load any equation, give each symbol its units, and see which terms agree. Check the formulas you meet in later jobs before you trust them.',
        controls: ['force', 'v0', 'mu'],
        prompts: [
          'Check $v^2 = v_0^2 + 2as$ (type `v_0` for the starting speed).',
          'Try $F = m a + m g$. Then try $F = m a + g$ and see which term the checker flags.',
          'Write a stopping-time formula from *v* and *a* and test it on the plow.'
        ],
        actions: [
          { label: 'Checker: the plow equation', run: function () { openDim('a = 2*s/t^2 - 2*v/t', KIN_VARS); } },
          { label: 'Checker: v² = v₀² + 2as', run: function () { openDim('v^2 = v_0^2 + 2*a*s', 'v: m/s\nv_0: m/s\na: m/s^2\ns: m'); } },
          { label: 'Checker: F = ma + g', run: function () { openDim('F = m*a + g', 'F: N\nm: kg\na: m/s^2\ng: m/s^2'); } },
          { label: 'Brake at 2.00 m/s²', run: function (ctx) { return runPlow(ctx, A_BRAKE).then(function (o) { return 'Stopped after ' + o.r.detail.time.toFixed(2) + ' s.'; }); } }
        ]
      },
      {
        type: 'deeper', title: 'Equations from units alone',
        teaser: 'If every term must share units, then sometimes the units are enough to *find* the equation, up to a pure number. Try it on a pendulum.',
        steps: [
          { type: 'say', who: 'hask', text: 'Here\'s a game the textbook doesn\'t play. A pendulum\'s period *T* (s) could depend on the bob\'s mass *m* (kg), the string length *L* (m) and *g* (m/s²). Suppose $T = C m^{x} L^{y} g^{z}$, where *C* is a pure number. The units on the right must come out in seconds.' },
          {
            type: 'derive', title: 'Matching powers',
            lines: [
              { eq: '\\u{s} = \\u{kg}^{x} \\u{m}^{y} (\\u{m/s^2})^{z} = \\u{kg}^{x} \\u{m}^{y+z} \\u{s}^{-2z}' },
              { eq: 'x = 0', ask: { q: 'Nothing else has kilograms in it. What must *x* be?', choices: [{ t: '0', correct: true, why: 'So the period doesn\'t depend on the mass at all.' }, { t: '1', why: 'Then a kilogram would be left over with nothing to cancel it.' }] } },
              { eq: '-2z = 1 \\quad \\implies \\quad z = -\\frac{1}{2}', ask: { q: 'Seconds: the left side has s¹. What is *z*?', choices: [{ t: '−½', correct: true, why: 'g appears as 1/√g.' }, { t: '½', why: 'g has s⁻², so g^½ gives s⁻¹. We need s⁺¹.' }] } },
              { eq: 'y + z = 0 \\quad \\implies \\quad y = \\frac{1}{2}', why: 'Metres must cancel.' },
              { eq: 'T = C\\sqrt{\\frac{L}{g}}', why: 'Units alone fixed the form. A full analysis gives C = 2π, which units could never tell you.' }
            ],
            outro: 'This is the idea behind the **Buckingham π theorem**, which engineers use to plan experiments and scale models before any theory exists.'
          },
          { type: 'predict', who: 'hask', q: 'You make the pendulum string **4 times longer**. What happens to the period?', choices: [
            { t: 'It doubles.', correct: true, why: '$T \\propto \\sqrt{L}$, and √4 = 2. You found that without knowing C.' },
            { t: 'It goes up 4 times.', why: 'T goes as √L, not L.' },
            { t: 'Depends on the bob\'s mass.', why: 'The units showed *x* = 0: no mass dependence at all.' }
          ] }
        ]
      },
      {
        type: 'summary',
        points: [
          'Every term of a physical equation must have the **same units** (dimensional homogeneity). Only then can the terms be combined numerically.',
          '$s = v t + \\frac{1}{2}a t^2$ is in metres term by term. Solved for *a*, $a = \\frac{2s}{t^2} - \\frac{2v}{t}$ is in m/s² term by term.',
          'Eq. 1–2 with $G$ in $\\u{m^3/(kg·s^2)}$ gives kg·m/s², a newton.',
          'Use homogeneity to check algebra after each step. It\'s a **partial** check: pure numbers (½ vs 2), signs and wrong-but-same-unit terms slip through.'
        ]
      }
    ]
  });
})(globalThis.SE);
