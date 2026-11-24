/*
 * H5 · The Long Fall: Newton's law of gravitation (Eq. 1–2), weight as the
 * one gravitational force that matters near the Earth, W = mg with
 * g = G Me / r^2 (Eq. 1–3), and the standard location.
 * Course section 1.2 (gravitation and weight).
 */
(function (SE) {
  'use strict';

  var P = SE.physics.gravity;
  var G = P.G;                       // 66.73e-12 m^3/(kg s^2), the course value
  var G_STD = 9.81;                  // standard-location g used for hand work
  var ME = 5.97e24;                  // Earth's mass as given to the player, kg
  var RE = 6371e3;                   // mean Earth radius as given to the player, m

  // ------------------------------------------------------------ answer keys

  // H5.weights: three loads off the depot manifest.
  var LOADS = [
    { key: 'gen', m: 12.0, label: 'generator 12.0 kg' },
    { key: 'bolt', m: 0.065, label: 'bolt 0.065 kg' },
    { key: 'loco', m: 540e3, label: 'locomotive 540 Mg' }
  ];
  var W_GEN = 12.0 * G_STD;          // 117.72 N   -> 118 N
  var W_BOLT = 0.065 * G_STD;        // 0.637 65 N -> 0.638 N (dropped digit 6, round up)
  var W_LOCO = 540e3 * G_STD;        // 5 297 400 N -> 5.30 MN

  // H5.balls: two small wrecking balls, 600 mm centre to centre.
  var M_A = 15.0, M_B = 25.0, D_AB = 0.600;
  var F_AB = G * M_A * M_B / (D_AB * D_AB);
  // 66.73e-12 × 15.0 × 25.0 / 0.360 = 66.73e-12 × 1041.67 = 6.951e-8 N -> 69.5 nN
  var W_A = M_A * G_STD;             // 147.15 N -> 147 N (first dropped digit 1, leave)
  var W_B = M_B * G_STD;             // 245.25 N -> 245 N (first dropped digit 2, leave)

  // H5.g-surface: g at the surface from the law of gravitation.
  var G_SURF = G * ME / (RE * RE);
  // 66.73e-12 × 5.97e24 = 3.9838e14; 6.371e6² = 4.0590e13; ratio 9.8148 -> 9.81 m/s²

  // H5.drone: a 40.0 kg survey pack carried to 1600 km above the surface.
  var M_PACK = 40.0, H_DRONE = 1600e3;
  var R_DRONE = RE + H_DRONE;        // 7.971e6 m
  var W_DRONE = G * M_PACK * ME / (R_DRONE * R_DRONE);
  // 3.9838e14 × 40.0 / 6.3537e13 = 250.80 N -> 251 N (ground weight 392 N)

  // Prove-it keys.
  var W_PROVE = 30.0 * G_STD;                     // 294.3 N -> 294 N
  var F_PROVE = G * 200 * 300 / (2.00 * 2.00);    // 66.73e-12 × 60 000 / 4.00 = 1.0010e-6 N -> 1.00 μN

  // Steel wrecking balls sit with a gap that makes the centres exactly D_AB apart.
  var STEEL = 7850;
  var GAP_AB = D_AB - P.sphereRadius(M_A, STEEL) - P.sphereRadius(M_B, STEEL);

  function fmtN(N) {
    var a = Math.abs(N), r = SE.sigfig.roundSig;
    if (a >= 1e6) return r(N / 1e6, 3).text + ' MN';
    if (a >= 1e3) return r(N / 1e3, 3).text + ' kN';
    if (a >= 0.1 || a === 0) return r(N, 3).text + ' N';
    if (a >= 1e-4) return r(N * 1e3, 3).text + ' mN';
    if (a >= 1e-7) return r(N * 1e6, 3).text + ' μN';
    return r(N * 1e9, 3).text + ' nN';
  }
  function fmtLen(m) {
    var a = Math.abs(m), r = SE.sigfig.roundSig;
    if (a >= 1e-3) return r(m * 1e3, 3).text + ' mm';
    if (a >= 1e-6) return r(m * 1e6, 3).text + ' μm';
    return r(m * 1e9, 3).text + ' nm';
  }
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  // 4.7e-10 -> "4.7 × 10⁻¹⁰"
  function sci(x, n) {
    var parts = x.toExponential(n - 1).split('e');
    return parts[0] + ' × 10' + String(Number(parts[1])).replace(/./g, function (ch) { return SUP[ch] || ch; });
  }
  function pct(x) { return SE.sigfig.roundSig(Math.abs(x) * 100, 2).text + '%'; }

  /*
   * Lift one load off the slab with the governor holding the player's weight
   * as cable tension. T = W exactly floats the load free with a = 0; too
   * little and it never leaves the slab, too much and it accelerates up into
   * the gantry head. The cable is rated at three times the true weight, so a
   * prefix slip upward parts it.
   */
  function hoistTest(ctx, load, Tplayer) {
    var W = load.m * G_STD, T = Tplayer || 0;
    var s = ctx.setScene('hoist', { mass: load.m, label: load.label, mode: 'lift', hookHeight: 3, governor: T, rating: 3 * W, g: G_STD });
    return s.run(T, { duration: 4 }).then(function (r) {
      var d = r.detail, name = '**' + load.label + '**';
      if (r.outcome === 'snapped') return name + ': governor at ' + fmtN(T) + ' against a cable rated ' + fmtN(3 * W) + '. The cable parted and the load came down at ' + Math.abs(d.impact).toFixed(1) + ' m/s.';
      if (r.outcome === 'stalled') return name + ': governor at ' + fmtN(T) + ' is less than its ' + fmtN(W) + ' weight. The winch strains and the load never leaves the slab.';
      if (r.outcome === 'slammed') return name + ': governor at ' + fmtN(T) + ' is far more than ' + fmtN(W) + '. The load shot up into the gantry head at ' + Math.abs(d.impact).toFixed(1) + ' m/s.';
      var e = (T - W) / W;
      if (d.y < 0.001) return name + ': lifts free of the slab and hangs dead still. Tension equals weight, so a = 0.';
      if (Math.abs(e) < 0.006) return name + ': floats free of the slab and hangs there. It rose ' + Math.round(d.y * 1000) + ' mm in 4 s, which is just your 3 s.f. rounding; the operator trims that out by hand.';
      return name + ': ' + pct(e) + ' over its weight. It climbed ' + d.y.toFixed(2) + ' m in 4 s and is still speeding up.';
    });
  }

  var HOIST_IDLE = { type: 'hoist', params: { mass: 12, label: 'generator', mode: 'lift', showVectors: false } };
  var BIG_BALLS = { type: 'gravity', params: { mode: 'spheres', ballMass: 5000, gap: 1.0, Lc: 8 } };

  SE.content.registerLevel('ch01', {
    id: 'H5', order: 5, title: 'The Long Fall',
    subtitle: 'Gravitation and weight',
    sections: ['1.2'],
    minutes: 25,
    intro: [
      'Juno has traded for an old weather drone. It still flies, and the plan is to send survey packs up past the cloud deck to look for other settlements.',
      'Hask taps the spring scale bolted under the drone. "Before you load it, you should know what this needle is going to do on the way up. Everybody thinks weight is a property of the crate. It isn\'t. It\'s a conversation between the crate and the whole planet, and the planet\'s side of it depends on how far away you are."'
    ].join('\n\n'),
    goals: [
      'Use Newton\'s law of gravitation, $F = G\\frac{m_1 m_2}{r^2}$, with *r* measured centre to centre',
      'Derive $W = mg$ with $g = \\frac{GM_e}{r^2}$ and say what each assumption buys you',
      'Explain why weight changes with location while mass does not, and what the standard location is'
    ],
    scene: { type: 'gravity', params: { mode: 'altitude', crateMass: 50, label: 'SURVEY PACK' } },
    proveIt: [
      {
        id: 'H5.prove-weight', text: 'At the standard location, what does a **30.0 kg** crate weigh?',
        inputs: [{ key: 'W', label: 'Weight', placeholder: 'e.g. 1.23 kN', spec: { value: W_PROVE, unit: 'N', sf: 3, form: 'si' }, answer: '294 N' }]
      },
      {
        id: 'H5.prove-pull', text: 'Two counterweights, **200 kg** and **300 kg**, sit with their centres **2.00 m** apart. How hard do they pull on each other?',
        inputs: [{ key: 'F', label: 'Gravitational force', placeholder: 'e.g. 4.56 nN', spec: { value: F_PROVE, unit: 'N', sf: 3, form: 'si' }, answer: '1.00 μN' }]
      }
    ],
    steps: [
      {
        type: 'predict', id: 'H5.predict-orbit', who: 'hask',
        q: 'The scale holds a 50 kg survey pack. On the ground the needle reads its full weight. Now the drone climbs to **400 km**, about where the old space station used to fly, and hovers.\n\nWhat does the needle read up there?',
        choices: [
          { t: 'The same as on the ground. The pack hasn\'t changed.', why: 'The pack hasn\'t changed, but its weight has. The needle dropped by about a ninth.' },
          { t: 'Somewhat less, but most of the weight is still there.', correct: true, why: 'Right. 400 km sounds like a long way, but the Earth\'s centre is 6371 km below your feet, so you\'ve only moved about 6% farther from it.' },
          { t: 'Zero. Things are weightless in orbit.', why: 'Astronauts *float* because they and their station are falling together, not because gravity is switched off. A hovering drone isn\'t falling, and its scale shows gravity is still close to 90% strength.' }
        ],
        run: function (ctx) {
          return ctx.scene.run({ targetAltitude: 400, duration: 3.5 }).then(function (r) {
            var d = r.detail;
            return 'Measured at 400 km: g = **' + d.g.toFixed(2) + ' m/s²**, the needle reads **' + Math.round(d.weight) + ' N**, which is **' + Math.round(d.ratio * 100) + '%** of the ground reading.';
          });
        },
        reveal: 'Same pack, same mass, different weight. Something about **distance** is in the formula.'
      },
      {
        type: 'try', id: 'H5.try-quarter', who: 'hask',
        scene: { type: 'gravity', params: { mode: 'altitude', crateMass: 50, label: 'SURVEY PACK' } },
        text: 'Fly the drone yourself (the altitude dial is logarithmic, and you can drag the drone too). Find the height where the pack weighs **a quarter** of its ground weight. Watch the *r* readout as well as *h*.',
        controls: ['altDial'],
        goalText: 'Get the scale reading to ¼ of the ground value (within 2%)',
        goal: function (ctx) {
          var s = ctx.scene;
          return !!(s && s.scaleTarget) && Math.abs(s.scaleTarget() - 0.25) < 0.005;
        },
        after: 'You ended up near **6400 km** up, which puts you about **2R** from the centre. Twice the distance, a quarter of the pull. Distance enters **squared**, and it\'s measured from the **centre** of the Earth, not from the ground.'
      },
      {
        type: 'predict', id: 'H5.predict-inverse-square', who: 'hask',
        scene: { type: 'gravity', params: { mode: 'twobody', m1: 8, m2: 12, r: 0.8, rMax: 4 } },
        q: 'Same idea on a bench. Two cast-iron counterweights, 8 kg and 12 kg, sit 0.80 m apart, centre to centre. They pull on each other with a tiny force *F₀*.\n\nI slide them to **1.60 m** apart. What does the force become?',
        choices: [
          { t: 'F₀ / 2', why: 'Doubling the distance did more than halve it. Look at F/F₀.' },
          { t: 'F₀ / 4', correct: true, why: 'Right: the inverse square again. Double the distance, a quarter of the force.' },
          { t: 'Still F₀. They\'re the same weights.', why: 'Their masses didn\'t change, but the pull between them depends on how far apart they are.' },
          { t: 'Zero. They\'re out of range.', why: 'Gravity has no cut-off range. It just keeps getting weaker as 1/r².' }
        ],
        run: function (ctx) {
          return ctx.scene.run({ r: 1.6 }).then(function (r) {
            return 'Measured: F/F₀ = **' + SE.sigfig.roundSig(r.detail.ratio, 3).text + '**.';
          });
        }
      },
      {
        type: 'reveal', id: 'H5.law', kicker: 'Law', title: 'Newton\'s law of gravitation',
        eq: 'F = G\\frac{m_1 m_2}{r^2}', tag: '1–2',
        text: 'Any two particles attract each other along the line between them, with\n\n- *F*: the gravitational force between the two particles\n- *G*: the universal constant of gravitation, measured as $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$\n- *m₁*, *m₂*: the mass of each particle\n- *r*: the **distance between the particles**\n\nFor round bodies such as balls and planets, *r* is measured **centre to centre**. The pull grows with either mass and falls off with the square of the distance.',
        formula: 'ch01.gravitation'
      },
      {
        type: 'task', id: 'H5.balls', who: 'hask',
        scene: BIG_BALLS,
        title: 'Two wrecking balls',
        text: 'The demolition crew has two small steel wrecking balls hanging side by side from the gantry: **15.0 kg** and **25.0 kg**, with their centres **600 mm** apart. (The big 5-tonne pair on screen is just for scale.)\n\nHow hard do the two small balls pull on each other? Then, for comparison, what does each one weigh? Use $g = 9.81\\u{ m/s^2}$.',
        inputs: [
          { key: 'F', label: 'Pull between the balls, *F*', placeholder: 'e.g. 12.3 nN', spec: { value: F_AB, unit: 'N', sf: 3, form: 'si' }, answer: '69.5 nN', wrong: [{ input: '6.95e-8 N', kind: 'form' }, { input: '41.7 nN', kind: 'algebra' }, { input: '695 nN', kind: 'prefix' }] },
          { key: 'WA', label: 'Weight of the 15.0 kg ball', placeholder: 'e.g. 123 N', spec: { value: W_A, unit: 'N', sf: 3, form: 'si' }, answer: '147 N', wrong: [{ input: '15.0 kg', kind: 'concept' }] },
          { key: 'WB', label: 'Weight of the 25.0 kg ball', placeholder: 'e.g. 123 N', spec: { value: W_B, unit: 'N', sf: 3, form: 'si' }, answer: '245 N' }
        ],
        hints: [
          'Both balls are round, so *r* is the centre-to-centre distance, in metres.',
          'Put $m_1 = 15.0\\u{ kg}$, $m_2 = 25.0\\u{ kg}$ and $r = 0.600\\u{ m}$ into $F = G m_1 m_2 / r^2$. Don\'t forget to square *r*. Then pick a prefix that keeps the number between 0.1 and 1000.',
          '$F = 66.73(10^{-12}) \\times 15.0 \\times 25.0 / 0.600^2 = 6.951(10^{-8})\\u{ N} = 69.5\\u{ nN}$. Weights: $15.0 \\times 9.81 = 147\\u{ N}$ and $25.0 \\times 9.81 = 245\\u{ N}$.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('gravity', { mode: 'spheres', ballMass: M_A, ballMass2: M_B, density: STEEL, gap: GAP_AB, Lc: 6 });
          return s.run({ duration: 6 }).then(function (r) {
            var d = r.detail, Fp = a.F.si;
            var msg = 'The cables swing in until each ball balances its share. Measured pull **' + fmtN(d.F) + '**; the 15 kg ball moves **' + fmtLen(d.deflection1) + '** sideways, the 25 kg ball **' + fmtLen(d.deflection2) + '**.';
            if (Fp && Math.abs(Fp - d.F) / d.F > 0.005) msg += ' Your figure of ' + fmtN(Fp) + ' would have moved the 15 kg ball ' + fmtLen(6 * Fp / d.W1) + ', which is not what the laser reads.';
            return msg + ' The pull is about **' + sci(d.F / d.W1, 2) + '** of the small ball\'s weight.';
          });
        },
        explain: 'Between two objects you can lift, gravity is billions of times weaker than their weights. That is why the only gravitational force we normally account for is the one between a body and the **Earth**.'
      },
      {
        type: 'say', id: 'H5.only-earth', who: 'hask',
        text: 'So every pair of objects in this yard is tugging on every other pair, and none of it matters. Near the ground the only gravitational pull big enough to notice is the Earth\'s, because the Earth has about $6(10^{24})\\u{ kg}$ to work with. That one force has a name: **weight**. It\'s the only gravitational force we\'ll carry through the rest of mechanics.'
      },
      {
        type: 'derive', id: 'H5.derive-weight', who: 'hask', title: 'Weight from the law of gravitation',
        intro: 'Let\'s get a formula for the weight of a crate out of Eq. 1–2.',
        lines: [
          { eq: 'F = G\\frac{m_1 m_2}{r^2}', why: 'Start from the law of gravitation.' },
          {
            eq: 'm_1 = m, \\quad m_2 = M_e', why: 'The two bodies are the crate (mass *m*) and the Earth (mass *Mₑ*).',
            ask: { q: 'For a crate sitting in the yard, which two bodies do we put into the law?', choices: [
              { t: 'The crate and the ground it sits on', why: 'The ground is part of the Earth. Treat the whole planet as one body.' },
              { t: 'The crate and the Earth', correct: true, why: 'Right. Everything else is negligible, as the wrecking balls showed.' },
              { t: 'The crate and the Sun', why: 'The Sun pulls on the crate and the Earth almost equally, so it hardly affects what the crate weighs here.' }
            ] }
          },
          {
            eq: 'W = G\\frac{mM_e}{r^2}', why: 'Treat the Earth as a **non-rotating sphere of constant density**. Then it pulls as if all its mass sat at its centre, and *r* is the distance from the Earth\'s centre to the crate.',
            ask: { q: 'What is *r* for a crate sitting on the ground?', choices: [
              { t: 'Zero: it\'s touching the Earth', why: 'That would make the weight infinite. The Earth\'s mass isn\'t at the surface; for a sphere it acts from the centre.' },
              { t: 'The crate\'s height above the ground', why: 'Measured that way a crate on the ground would have r = 0. *r* is the distance between the two bodies\' centres.' },
              { t: 'About the Earth\'s radius, 6371 km', correct: true, why: 'Right. It\'s the distance from the Earth\'s centre, which is the planet\'s radius plus however high the crate is.' }
            ] }
          },
          {
            eq: 'g = \\frac{GM_e}{r^2}', why: 'Everything except *m* belongs to the Earth and to where you stand. Call that group *g*.',
            ask: { q: 'In $W = G m M_e / r^2$, which part changes if you swap one crate for another in the same spot?', choices: [
              { t: 'Only *m*', correct: true, why: 'Right. *G*, *Mₑ* and *r* stay the same for every crate at that spot, so they can be lumped together.' },
              { t: '*m* and *r*', why: 'Two crates on the same patch of ground are at the same *r*.' },
              { t: 'Everything', why: '*G* is a universal constant and *Mₑ* is the planet. Neither cares which crate it is.' }
            ] }
          },
          { eq: 'W = mg', tag: '1–3', why: 'Substitute *g* back in.' },
          {
            eq: 'F = ma \\quad \\implies \\quad W = mg \\quad \\implies \\quad a = g', why: 'If weight is the only force on the crate, Newton\'s second law says its acceleration is *g*.',
            ask: { q: 'Compare $W = mg$ with $F = ma$. What is *g* physically?', choices: [
              { t: 'The acceleration of a body falling under its weight alone', correct: true, why: 'Right: *g* is the **acceleration due to gravity**.' },
              { t: 'The weight of 1 kg', why: 'Numerically 1 kg weighs *g* newtons, but *g* itself has units of m/s². It\'s an acceleration.' },
              { t: 'A conversion factor between kg and N with no physical meaning', why: 'It has a meaning: drop anything (with no air resistance) and it accelerates at *g*.' }
            ] }
          }
        ],
        outro: 'And here is the catch: *g* contains *r*. Move the crate farther from the Earth\'s centre and *g* gets smaller, so **weight is not an absolute quantity**. It depends on where it\'s measured. Mass is not like that: the crate has the same amount of matter wherever it goes.',
        formula: 'ch01.weight'
      },
      {
        type: 'task', id: 'H5.g-surface', who: 'hask',
        scene: { type: 'gravity', params: { mode: 'twobody', m1: 8, m2: 12, r: 0.8, rMax: 4 } },
        title: 'Check g yourself',
        text: 'Let\'s see whether the formula gives the number everybody uses. Take the Earth\'s mass as $M_e = 5.97(10^{24})\\u{ kg}$ and its radius as **6371 km**. What is *g* at the surface?',
        inputs: [{
          key: 'g', label: '*g* at the surface', placeholder: 'e.g. 1.23 m/s^2',
          spec: { value: G_SURF, unit: 'm/s^2', sf: 3, form: 'si', mistakes: [
            { ratio: RE, kind: 'algebra', msg: 'That is G Mₑ / r: the distance has to be squared.' },
            { ratio: 1e6, kind: 'conversion', msg: 'Off by exactly 10⁶: the radius went in as kilometres, and squaring made it a million. Use metres.' }
          ] },
          answer: '9.81 m/s^2',
          wrong: [{ input: '9.8148 m/s^2', kind: 'sigfig' }, { input: '9.81e6 m/s^2', kind: 'conversion' }, { input: '62.5e6 m/s^2', kind: 'algebra' }, { input: '9.81 N', kind: 'unit' }]
        }],
        hints: [
          'This is $g = GM_e/r^2$ with the crate on the ground. What is *r* there?',
          'Use $r = 6371\\u{ km} = 6.371(10^{6})\\u{ m}$. Square it before you divide.',
          '$g = 66.73(10^{-12}) \\times 5.97(10^{24}) / (6.371(10^{6}))^2 = 3.984(10^{14}) / 4.059(10^{13}) = 9.81\\u{ m/s^2}$.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('gravity', { mode: 'altitude', crateMass: 1, label: '1 kg TEST MASS' });
          return s.run({ targetAltitude: 0, duration: 1 }).then(function (r) {
            var gp = a.g.si;
            var msg = 'The drone\'s accelerometer, sitting on the pad, reads **' + r.detail.g.toFixed(3) + ' m/s²** (its own almanac uses a slightly more precise Earth mass).';
            if (gp != null && Math.abs(gp - G_SURF) / G_SURF > 0.005) msg += ' Your ' + SE.sigfig.roundSig(gp, 3).text + ' m/s² would have a dropped tool hitting the deck ' + (gp > G_SURF ? 'sooner' : 'later') + ' than it actually does.';
            return msg;
          });
        },
        explain: 'Treating the Earth as a uniform, non-rotating ball gets you to within a fraction of a percent of the measured value. The real number varies slightly from place to place, which is the next point.'
      },
      {
        type: 'reveal', id: 'H5.standard', kicker: 'Convention', title: 'The standard location',
        eq: 'g = 9.81\\u{ m/s^2} \\quad \\t{(sea level, 45° latitude)}',
        text: 'Because *g* depends on *r*, an engineer in the mountains and one at the coast would get slightly different weights for the same crate. To keep calculations comparable, most engineering work uses *g* measured at **sea level and 45° latitude**, the **standard location**.\n\n**Important point.** **Mass** is a measure of the amount of matter and does not change from one location to another. **Weight** is the Earth\'s gravitational pull on that mass, and its magnitude depends on the elevation where the mass is.'
      },
      {
        type: 'classify', id: 'H5.mass-weight', who: 'hask',
        text: 'The survey pack goes from the depot floor to the top of the drone\'s climb. Which of these change?',
        bins: ['Changes', 'Stays the same'],
        items: [
          { t: 'The mass of the pack', bin: 'Stays the same', why: 'Same amount of matter wherever it goes.' },
          { t: 'The weight of the pack', bin: 'Changes', why: 'Weight is $GmM_e/r^2$, and *r* grows as the drone climbs.' },
          { t: 'The spring-scale reading under the drone', bin: 'Changes', why: 'A spring scale measures the pull on the pack, so it reads weight.' },
          { t: 'The value of G', bin: 'Stays the same', why: '*G* is a universal constant.' },
          { t: 'The value of g', bin: 'Changes', why: '$g = GM_e/r^2$ falls off with distance from the centre.' }
        ]
      },
      {
        type: 'task', id: 'H5.weights', who: 'juno',
        scene: HOIST_IDLE,
        title: 'Set the hoist governor',
        text: 'Three loads have to go up on the gantry today, and the winch governor needs each one\'s weight to hold it steady. Work at the standard location ($g = 9.81\\u{ m/s^2}$) and give each answer to 3 significant figures with a sensible SI prefix.\n\n- the spare **generator**, mass 12.0 kg\n- a single **bolt** for the gantry head, mass 0.065 kg\n- the dead **locomotive** on the spur, mass 540 Mg',
        inputs: [
          { key: 'gen', label: 'Generator weight', placeholder: 'e.g. 123 N', spec: { value: W_GEN, unit: 'N', sf: 3, form: 'si' }, answer: '118 N', wrong: [{ input: '117.72 N', kind: 'sigfig' }, { input: '12.0 kg', kind: 'concept' }] },
          { key: 'bolt', label: 'Bolt weight', placeholder: 'e.g. 0.123 N', spec: { value: W_BOLT, unit: 'N', sf: 3, form: 'si' }, answer: '0.638 N', wrong: [{ input: '0.637 N', kind: 'rounding' }, { input: '6.38 N', kind: 'prefix' }] },
          { key: 'loco', label: 'Locomotive weight', placeholder: 'e.g. 1.23 MN', spec: { value: W_LOCO, unit: 'N', sf: 3, form: 'si' }, answer: '5.30 MN', wrong: [{ input: '5.30 kN', kind: 'prefix' }, { input: '5.297 MN', kind: 'sigfig' }] }
        ],
        hints: [
          'Weight at the standard location is $W = mg$ with $g = 9.81\\u{ m/s^2}$. Work in kilograms.',
          '540 Mg is $540(10^{3})\\u{ kg}$. After multiplying, choose a prefix so the number sits between 0.1 and 1000.',
          'Generator $12.0 \\times 9.81 = 117.72 \\to 118\\u{ N}$. Bolt $0.065 \\times 9.81 = 0.637\\,65 \\to 0.638\\u{ N}$. Locomotive $540(10^{3}) \\times 9.81 = 5.2974(10^{6})\\u{ N} \\to 5.30\\u{ MN}$.'
        ],
        consequence: function (ctx, a) {
          var out = [];
          return LOADS.reduce(function (p, load) {
            return p.then(function () { return hoistTest(ctx, load, a[load.key].si); }).then(function (m) { out.push('- ' + m); });
          }, Promise.resolve()).then(function () { return out.join('\n'); });
        },
        explain: 'Same formula across eight orders of magnitude. The prefix does the work of keeping the numbers readable: 0.638 N, 118 N, 5.30 MN.'
      },
      {
        type: 'task', id: 'H5.drone', who: 'juno',
        scene: { type: 'hoist', params: { mass: 40, label: 'survey pack 40.0 kg', mode: 'lift', showVectors: false } },
        title: 'Load the drone',
        text: 'The drone\'s motor controller needs to know how hard the survey pack will pull on it at the top of the climb, **1600 km** above the surface. The pack\'s mass is **40.0 kg**.\n\nUse $M_e = 5.97(10^{24})\\u{ kg}$ and an Earth radius of 6371 km. What does the pack weigh up there?',
        inputs: [{
          key: 'W', label: 'Weight at 1600 km', placeholder: 'e.g. 123 N',
          spec: { value: W_DRONE, unit: 'N', sf: 3, form: 'si', mistakes: [
            { ratio: M_PACK * G_STD / W_DRONE, kind: 'concept', msg: 'That is its weight on the ground. Up there, *g* is smaller.' },
            { ratio: Math.pow(R_DRONE / H_DRONE, 2), kind: 'concept', msg: 'You used the height above the ground as *r*. Measure *r* from the Earth\'s centre: radius plus height.' }
          ] },
          answer: '251 N',
          wrong: [{ input: '392 N', kind: 'concept' }, { input: '6.22 kN', kind: 'concept' }, { input: '250.8 N', kind: 'sigfig' }]
        }],
        hints: [
          'The weight at height *h* is $G m M_e / r^2$, and *r* is measured from the Earth\'s centre.',
          '$r = 6371\\u{ km} + 1600\\u{ km} = 7.971(10^{6})\\u{ m}$. Square it, then divide into $G m M_e$.',
          '$W = 66.73(10^{-12}) \\times 40.0 \\times 5.97(10^{24}) / (7.971(10^{6}))^2 = 1.594(10^{16}) / 6.354(10^{13}) = 251\\u{ N}$, about 64% of its 392 N ground weight.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('gravity', { mode: 'altitude', crateMass: M_PACK, label: 'SURVEY PACK' });
          return s.run({ targetAltitude: H_DRONE / 1e3, duration: 3.5 }).then(function (r) {
            var Wr = r.detail.weight, Wp = a.W.si;
            var msg = 'At 1600 km the spring scale reads **' + fmtN(Wr) + '**.';
            if (Wp == null) return msg;
            var e = (Wp - Wr) / Wr;
            if (Math.abs(e) <= 0.006) return msg + ' Your figure matches; the controller holds the drone level and the pack rides steady.';
            return msg + ' The controller was told ' + fmtN(Wp) + ', ' + pct(e) + ' ' + (e > 0 ? 'too much. It over-throttles, the drone bucks upward and burns battery it needed for the trip home.' : 'too little. The drone sags under the load and the climb stalls short of the cloud deck.');
          });
        },
        explain: '1600 km is a quarter of the Earth\'s radius, so *r* went up by 25% and the weight fell to $1/1.25^2 = 64\\%$ of its ground value. The pack\'s mass, 40.0 kg, never changed.'
      },
      {
        type: 'deeper', id: 'H5.deeper-site', title: 'Why g isn\'t even the same along the ground',
        teaser: 'The real Earth spins, and it bulges at the equator. Both make *g* depend on latitude, which is why the standard location names one.',
        steps: [
          {
            type: 'predict', who: 'hask',
            scene: { type: 'gravity', params: { mode: 'site', latitude: 45 } },
            q: 'Where on the sea-level surface of the Earth would a crate weigh the **least**?',
            choices: [
              { t: 'At the poles', why: 'The poles are the heaviest place at sea level: no spin to fight, and closest to the centre.' },
              { t: 'At the equator', correct: true, why: 'Right. Two effects stack up there: the spin uses up part of gravity to carry you round in a circle, and the bulge puts you about 21 km farther from the centre.' },
              { t: 'It\'s the same everywhere at sea level', why: 'It would be on a still, perfectly round planet. The real one is neither.' }
            ],
            run: function (ctx) {
              var eq = P.gLatitude(0), pole = P.gLatitude(90), mid = P.gLatitude(45);
              ctx.scene.set('latitude', 0);
              return ctx.scene.run().then(function () {
                return 'Sea-level *g*: equator **' + eq.toFixed(3) + '**, 45° **' + mid.toFixed(3) + '**, poles **' + pole.toFixed(3) + ' m/s²**. That is about half a percent from end to end.';
              });
            }
          },
          {
            type: 'try', who: 'hask',
            scene: { type: 'gravity', params: { mode: 'site', latitude: 45, siteAltitude: 0 } },
            text: 'Move the site marker in latitude and altitude. The readout splits the change from the equator into its **rotation** part and its **shape** part. Find a site that matches the 45° sea-level value but sits on a mountain. (Hint: go toward the pole to make up for the height.)',
            controls: ['latitude', 'siteAltitude'],
            goalText: 'Find a site above 1000 m whose g is within 0.0005 m/s² of the 45° sea-level value',
            goal: function (ctx) {
              var s = ctx.scene;
              return !!s && s.p.siteAltitude > 1000 && Math.abs(P.gSite(s.lat, s.p.siteAltitude) - P.gLatitude(45)) < 0.0005;
            },
            after: 'Climbing costs about 3.1 mm/s² per kilometre, and heading poleward gives it back. Engineers fix the reference at sea level and 45° so everybody starts from the same number.',
            formula: 'ch01.g-latitude'
          },
          {
            type: 'predict', who: 'hask',
            scene: { type: 'gravity', params: { mode: 'altitude', body: 'moon', crateMass: 50, label: 'SURVEY PACK' } },
            q: 'Take the same 50 kg pack to the surface of the **Moon**. What happens to its mass and weight?',
            choices: [
              { t: 'Both drop to about a sixth', why: 'Weight drops, but mass is the amount of matter. Nothing was removed from the pack.' },
              { t: 'Mass stays 50 kg; weight drops to about a sixth', correct: true, why: 'Right. The Moon is much less massive than the Earth, and that outweighs its smaller radius.' },
              { t: 'Nothing changes', why: 'Weight depends on which body is pulling and how far away its centre is.' }
            ],
            run: function (ctx) {
              var gm = P.gAltitude('moon', 0);
              return Promise.resolve('Moon surface: $g = ' + gm.toFixed(2) + '\\u{ m/s^2}$, so the pack weighs **' + Math.round(50 * gm) + ' N** instead of ' + Math.round(50 * G_STD) + ' N. Its mass is still **50 kg**.');
            }
          }
        ]
      },
      {
        type: 'sandbox', id: 'H5.sandbox',
        scene: { type: 'gravity', params: { mode: 'altitude', crateMass: 50, label: 'SURVEY PACK' } },
        text: 'The drone is yours. Change the pack mass and fly it anywhere up to 40 000 km.',
        controls: ['altDial', 'crateMass'],
        prompts: ['At what height has the weight halved? (Hint: r = √2 R.)', 'At three Earth radii from the centre, what fraction of the ground weight is left?', 'Double the pack mass at a fixed height. What happens to g, and what happens to W?']
      },
      {
        type: 'summary',
        points: [
          'Newton\'s law of gravitation: $F = G m_1 m_2 / r^2$ with $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$ and *r* the distance between the particles (centre to centre for spheres). Double *r* and *F* drops to a quarter.',
          'Between everyday objects the pull is tiny (nanonewtons). Near the Earth the only gravitational force worth counting is the Earth\'s pull: **weight**.',
          'For a non-rotating, uniform spherical Earth, $W = GmM_e/r^2$. Calling $g = GM_e/r^2$ gives $W = mg$ (Eq. 1–3), and comparing with $F = ma$ shows *g* is the acceleration due to gravity.',
          'Weight depends on *r*, so it is not absolute. Engineering uses the **standard location**, sea level at 45° latitude, where $g = 9.81\\u{ m/s^2}$.',
          'Mass does not change with location. Weight does.'
        ]
      }
    ]
  });
})(globalThis.SE);
