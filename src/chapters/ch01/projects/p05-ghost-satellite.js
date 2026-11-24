/*
 * P5 · Ghost Satellite & Moon Rig (manual project).
 *
 * The salvage crew has opened an old space-agency training annex out past
 * the rail spur. Juno wants three things settled before anyone trusts it:
 * the lunar-gravity rig set up properly, a rumour about falling satellite
 * debris put to rest, and the annex's gravity demonstrations checked.
 *
 * Covers: the law of gravitation (Eq. 1-2) between particles and between
 * touching spheres, dimensional homogeneity of Eq. 1-2 (the units of G),
 * weight and mass on another body, and weight falling off with altitude.
 *
 * Beyond the book: the Moon's g worked out from its mass and radius, the
 * weight of debris at 400 km (g there is not 9.81), and why a beam balance
 * still reads true on the Moon.
 */
(function (SE) {
  'use strict';

  var GR = SE.physics.gravity, SC = SE.physics.scales;
  var G = GR.G;                                   // 66.73(10^-12) m^3/(kg s^2)
  var LBF = SC.LBF, SLUG = SC.SLUG;               // 4.448 N/lb, 14.59 kg/slug
  var G_EARTH = 9.81, G_FPS = 32.2, G_MOON_FPS = 5.30, G_MOON = 1.62;

  // ------------------------------------------------------------- givens

  // 1. The Moon's surface g from its mass and mean radius.
  var M_MOON = GR.MOON_MASS, R_MOON = GR.MOON_RADIUS;          // 7.342e22 kg, 1737.4 km
  var gMoonCalc = G * M_MOON / (R_MOON * R_MOON);
  // 66.73e-12 * 7.342e22 = 4.8993e12;  R^2 = (1.7374e6)^2 = 3.01856e12
  // g = 4.8993e12 / 3.01856e12 = 1.6231 m/s^2  ->  1.62 m/s^2

  // 2. Lunar rig: an 80 kg trainee against a counterweight over an ideal
  // pulley. Atwood: a = (m - mc) g / (m + mc), so mc = m (g - a) / (g + a).
  var TRAINEE = 80;
  var mcIdeal = SC.counterweightFor(TRAINEE, G_MOON, G_EARTH);
  // mc = 80 (9.81 - 1.62) / (9.81 + 1.62) = 80 (8.19) / 11.43 = 655.2 / 11.43
  //    = 57.32 kg  ->  57.3 kg
  var mcStatic = SC.counterweightFor(TRAINEE, G_MOON, G_EARTH, 'static');
  // static offload (ignores the counterweight's inertia): 80 (1 - 1.62/9.81) = 66.79 kg

  // 3. Debris at 400 km. g at r = R + h, not 9.81.
  var DEBRIS = 500, H_DEBRIS = 400e3;
  var M_EARTH = GR.EARTH_MASS, R_EARTH = GR.EARTH_RADIUS;      // 5.9722e24 kg, 6371 km
  var gDebris = GR.gAltitude('earth', H_DEBRIS);
  var W_DEBRIS = DEBRIS * gDebris;
  // r = 6371 + 400 = 6771 km;  r^2 = 4.58464e13 m^2
  // GM = 66.73e-12 * 5.9722e24 = 3.98525e14;  g = 3.98525e14 / 4.58464e13 = 8.6926 m/s^2
  // W = 500 * 8.6926 = 4346 N  ->  4.35 kN   (at the surface: 500 * 9.81 = 4.905 kN)

  // 4. Two test masses on the annex's gravity bench, treated as particles.
  var M_A = 40, M_B = 65, R_AB = 1.20;
  var F_AB = G * M_A * M_B / (R_AB * R_AB);
  // F = 66.73e-12 * 40 * 65 / 1.20^2 = 66.73e-12 * 2600 / 1.44 = 66.73e-12 * 1805.6
  //   = 1.2049e-7 N  ->  0.120 uN

  // 5. Two cast-steel ballast spheres touching. Centre distance = 2R.
  var BALL = 450, R_BALL = 0.240;
  var D_BALL = 2 * R_BALL;
  var F_BALL = G * BALL * BALL / (D_BALL * D_BALL);
  var RHO_BALL = BALL / (4 / 3 * Math.PI * Math.pow(R_BALL, 3));   // ~7770 kg/m^3, cast steel
  // F = 66.73e-12 * 450^2 / 0.480^2 = 66.73e-12 * 202500 / 0.2304 = 66.73e-12 * 878906
  //   = 5.8650e-5 N  ->  58.6 uN   (58.649, so the 4 after the 6 drops)

  // 7-8. A 190 lb survivor (Earth weight) on the Moon.
  var W_LB = 190;
  var mSlug = W_LB / G_FPS;                       // 190 / 32.2 = 5.9006 slug
  var W_MOON_LB = mSlug * G_MOON_FPS;             // 5.9006 * 5.30 = 31.273 lb  ->  31.3 lb
  var M_KG = mSlug * SLUG;                        // 5.9006 * 14.59 = 86.090 kg  ->  86.1 kg

  // ------------------------------------------------------------ helpers

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function pct(a, b) { return sig(Math.abs(a - b) / b * 100, 2) + ' %'; }
  function num(ans) { return ans && ans.si != null && isFinite(ans.si) ? ans.si : null; }

  var RIG = { type: 'scales', params: { mode: 'rig', survivorMass: TRAINEE, counterweightKg: 40, v0: 2.0, targetG: G_MOON, tol: 0.15, ceiling: 2.3 } };

  SE.content.registerProject('ch01', {
    id: 'P5', order: 5, title: 'Ghost Satellite & Moon Rig',
    subtitle: 'Gravity, here and elsewhere',
    brief: [
      'The scavengers broke into the old **space-agency training annex** past the rail spur. There\'s a lunar-gravity rig in the main hall, a gravity bench with steel balls on cables, and a wall of laminated placards nobody has checked in thirty years.',
      'There\'s also a rumour going round the depot: a dead satellite is coming down, and a piece of it "as heavy as a car" could flatten the water tower. People are losing sleep.',
      'I need the rig set right before anyone trains on it, the rumour answered with a real number, and the annex\'s gravity figures checked so we know which placards to trust. The rig and the bench run the real physics, so test your numbers on them first.',
      '— Juno'
    ].join('\n\n'),
    conditions: [
      'Course constants: $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$, $g = 9.81\\u{ m/s^2} = 32.2\\u{ ft/s^2}$ at the annex, 1 lb = 4.448 N, 1 slug = 14.59 kg.',
      'Moon: mass $7.342(10^{22})$ kg, mean radius 1737.4 km. The rig placard says the Moon\'s surface gravity is **1.62 m/s² (5.30 ft/s²)**.',
      'Earth: mass $5.9722(10^{24})$ kg, mean radius 6371 km.',
      'The rig\'s pulley is good: treat it as frictionless and massless, with an inextensible rope. The counterweight has inertia too.',
      'The debris piece: **500 kg**, tracked at **400 km** above the ground. Up there g is **not** 9.81.',
      'Gravity bench: test masses of 40 kg and 65 kg, centres 1.20 m apart. Ballast spheres: two cast-steel balls of 450 kg each, radius 240 mm, touching.',
      'Report every figure to 3 significant figures, in correct SI form unless the line asks for pounds.'
    ],
    scene: RIG,
    controls: ['counterweightKg', 'survivorMass', 'v0'],
    rigText: 'The lunar rig: a trainee in a harness on one side of a pulley, a counterweight on the other. Set the counterweight and run a jump. The readout shows the effective g the trainee feels. The other buttons take the bench and the drone out for a spin.',
    rigActions: [
      {
        label: 'Run a jump on the rig',
        run: function (ctx) {
          var s = ctx.scene && ctx.sceneType === 'scales' ? ctx.scene : ctx.setScene(RIG.type, RIG.params);
          return s.run({}).then(function (r) {
            var d = r.detail || {};
            if (d.aEff == null) return null;
            return 'Effective g ' + sig(d.aEff) + ' m/s² (Moon ' + G_MOON + '). ' + (r.outcome === 'moonlike' ? 'That feels like the Moon.' : r.outcome === 'tooHeavy' ? 'Too floaty: the counterweight is doing too much.' : 'Too heavy: the trainee drops like a stone.');
          });
        }
      },
      {
        label: 'Fly the weather drone to 400 km',
        run: function (ctx) {
          var s = ctx.setScene('gravity', { mode: 'altitude', crateMass: DEBRIS, label: 'DEBRIS 500 kg' });
          return s.run({ targetAltitude: H_DEBRIS / 1e3, duration: 3 }).then(function (r) {
            return 'At ' + sig(r.detail.altitude) + ' km the spring scale reads ' + sig(r.detail.ratio * 100) + ' % of the ground reading.';
          });
        }
      },
      {
        label: 'Release the ballast spheres',
        run: function (ctx) {
          var s = ctx.setScene('gravity', { mode: 'spheres', ballMass: BALL, density: RHO_BALL, gap: 0.05, Lc: 6 });
          return s.run({ duration: 6 }).then(function (r) {
            return 'Each cable swung in by ' + sig(r.detail.deflection1 * 1e9) + ' nm. Gravity between ordinary objects is tiny.';
          });
        }
      }
    ],
    lockedTools: ['converter', 'dimcheck'],

    deliverables: [
      {
        id: 'P5.moon-g',
        label: 'Before trusting the placard: the Moon\'s surface **g**, worked out from its mass and radius.',
        placeholder: 'e.g. 3.71 m/s^2',
        spec: { value: gMoonCalc, unit: 'm/s^2', sf: 3, form: 'si' },
        answer: '1.62 m/s^2',
        wrong: [
          { input: '1.62(10^6) m/s^2', kind: 'prefix' },
          { input: '1.623 m/s^2', kind: 'sigfig' }
        ],
        hints: [
          'A body on the Moon\'s surface is pulled by the whole Moon. Weight is just the law of gravitation with one of the masses being the Moon.',
          'Set $m g = G m M / r^2$ and cancel *m*: $g = G M / R^2$. Put *R* in metres.',
          '$g = 66.73(10^{-12}) \\times 7.342(10^{22}) / (1.7374(10^{6}))^2 = 4.899(10^{12}) / 3.019(10^{12})$.'
        ],
        consequence: function (ctx, ans, ok) {
          var v = num(ans);
          if (ok) return 'The placard holds up: $G M / R^2$ = ' + sig(gMoonCalc, 4) + ' m/s², which rounds to the 1.62 it claims. You can set the rig against it.';
          if (v == null) return 'No figure to compare with the placard.';
          return 'Your figure is ' + sig(v) + ' m/s². The placard says 1.62, and a whole Moon would not be ' + (v > gMoonCalc ? 'that strong' : 'that weak') + '. Check the units of *R* and that it is squared.';
        }
      },
      {
        id: 'P5.counterweight',
        label: 'The rig counterweight for the **80 kg** trainee so the effective g matches the Moon\'s **1.62 m/s²**.',
        placeholder: 'e.g. 40.0 kg',
        spec: {
          value: mcIdeal, unit: 'kg', sf: 3, form: 'si',
          mistakes: [{ ratio: mcStatic / mcIdeal, kind: 'concept', msg: 'That is the "static offload" figure, $m(1 - a/g)$. It forgets that the counterweight has to be accelerated too. Write $F = ma$ for each side of the rope.' }]
        },
        answer: '57.3 kg',
        wrong: [
          { input: '66.8 kg', kind: 'concept' },
          { input: '57.32 kg', kind: 'sigfig' }
        ],
        hints: [
          'Both bodies hang from the same rope, so they share the tension *T* and the size of the acceleration. Each needs its own Newton\'s second law.',
          'Trainee (down positive): $m g - T = m a$. Counterweight (up positive): $T - m_c g = m_c a$. Add them to remove *T*, then solve for $m_c$.',
          '$a = \\frac{(m - m_c) g}{m + m_c}$ gives $m_c = m\\frac{g - a}{g + a} = 80\\frac{9.81 - 1.62}{9.81 + 1.62}$.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          var s = ctx.setScene(RIG.type, Object.assign({}, RIG.params, { counterweightKg: v == null ? 0 : Math.max(0, Math.min(TRAINEE * 1.5, v)) }));
          return s.run({}).then(function (r) {
            var d = r.detail;
            var head = 'With ' + sig(d.counterweightKg) + ' kg on the far side the trainee feels **' + sig(d.aEff) + ' m/s²** and a 2 m/s push-off rises ' + (isFinite(d.height) ? sig(Math.min(d.height, 99)) + ' m' : 'and never comes back down') + (d.hitStop ? ', straight into the end stop' : '') + '. ';
            if (r.outcome === 'moonlike') return head + 'That is a lunar hop. Ideal setting ' + sig(d.idealCounterweight, 4) + ' kg.';
            if (r.outcome === 'tooHeavy') return head + 'Far too floaty: the counterweight is cancelling more than lunar gravity allows.';
            return head + 'Too much Earth left in it: the trainee drops back far faster than on the Moon.';
          });
        }
      },
      {
        id: 'P5.debris',
        label: 'The rumour: the weight of the **500 kg** debris piece at **400 km** altitude.',
        placeholder: 'e.g. 2.10 kN',
        spec: {
          value: W_DEBRIS, unit: 'N', sf: 3, form: 'si',
          mistakes: [{ ratio: G_EARTH / gDebris, kind: 'concept', msg: 'That is its weight on the ground, using 9.81 m/s². At 400 km it is farther from Earth\'s centre, so g is smaller. Use $g = GM/r^2$ with $r = R + h$.' }]
        },
        answer: '4.35 kN',
        wrong: [
          { input: '4.91 kN', kind: 'concept' },
          { input: '4.35 N', kind: 'prefix' }
        ],
        hints: [
          'In orbit the piece is not weightless; it is falling around the Earth. Its weight is still $W = m g$, but which g?',
          'Measure *r* from Earth\'s centre: $r = 6371 + 400 = 6771$ km. Then $g = G M_e / r^2$ and $W = m g$.',
          '$g = 66.73(10^{-12}) \\times 5.9722(10^{24}) / (6.771(10^{6}))^2 = 3.985(10^{14}) / 4.585(10^{13})$, then times 500 kg.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          var s = ctx.setScene('gravity', { mode: 'altitude', crateMass: DEBRIS, label: 'DEBRIS 500 kg' });
          return s.run({ targetAltitude: H_DEBRIS / 1e3, duration: 3 }).then(function (r) {
            var W = r.detail.weight;
            var head = 'The drone hauls a 500 kg dummy to ' + sig(r.detail.altitude) + ' km. Its spring scale settles on **' + sig(W) + ' N**, ' + sig(r.detail.ratio * 100) + ' % of the ground reading. ';
            if (v == null) return head;
            if (Math.abs(v - W) / W <= 0.005) return head + 'Your figure matches. So the debris is still heavy (it is the falling that matters), but most pieces burn up long before they reach a water tower.';
            return head + 'Your figure is off by ' + pct(v, W) + '.';
          });
        }
      },
      {
        id: 'P5.bench',
        label: 'Gravity bench: the attraction between the **40 kg** and **65 kg** test masses, centres **1.20 m** apart.',
        placeholder: 'e.g. 0.350 μN',
        spec: {
          value: F_AB, unit: 'N', sf: 3, form: 'si',
          mistakes: [{ ratio: R_AB, kind: 'algebra', msg: 'The distance was used once, not squared. Gravitation falls off with $r^2$.' }]
        },
        answer: '0.120 μN',
        wrong: [
          { input: '0.145 μN', kind: 'algebra' },
          { input: '0.120 mN', kind: 'prefix' }
        ],
        hints: [
          'Treat both masses as particles at their centres. Eq. 1–2 gives the force each exerts on the other.',
          '$F = G m_1 m_2 / r^2$, with *r* in metres. The answer will be tiny: pick the prefix that keeps the number between 0.1 and 1000.',
          '$F = 66.73(10^{-12}) \\times 40 \\times 65 / 1.20^2 = 66.73(10^{-12}) \\times 1806$. Write the result with μN or nN, three digits showing.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          var s = ctx.setScene('gravity', { mode: 'twobody', m1: M_A, m2: M_B, r: 2.4, rMax: 3 });
          return s.run({ r: R_AB, predicted: v == null ? 0 : v, tolerance: 0.005, duration: 1.6 }).then(function (r) {
            var head = 'The bench slides the masses in from 2.40 m to 1.20 m. The torsion gauge reads **' + sig(r.detail.F * 1e9) + ' nN**, four times the reading at 2.40 m. ';
            if (r.outcome === 'correct') return head + 'Your prediction lights green.';
            return head + 'Your prediction (' + (v == null ? 'none' : sig(v * 1e9) + ' nN') + ') lights red.';
          });
        }
      },
      {
        id: 'P5.spheres',
        label: 'Ballast spheres: the gravitational force between the two touching **450 kg** steel balls (radius **240 mm**).',
        placeholder: 'e.g. 12.5 μN',
        spec: {
          value: F_BALL, unit: 'N', sf: 3, form: 'si',
          mistakes: [{ ratio: 4, kind: 'concept', msg: 'That used the radius as *r*. Spheres attract as if their mass sat at their centres, so *r* is centre to centre: two radii when they touch.' }]
        },
        answer: '58.6 μN',
        wrong: [
          { input: '235 μN', kind: 'concept' },
          { input: '58.6 mN', kind: 'prefix' },
          { input: '58.65 μN', kind: 'sigfig' }
        ],
        hints: [
          'A uniform sphere pulls as if all its mass were at its centre. Where are the two centres when the balls touch?',
          'Touching means $r = 2 \\times 240$ mm $= 0.480$ m. Then $F = G m^2 / r^2$.',
          '$F = 66.73(10^{-12}) \\times 450^2 / 0.480^2 = 66.73(10^{-12}) \\times 878\\,906$. Keep all the digits, then round once.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          var s = ctx.setScene('gravity', { mode: 'spheres', ballMass: BALL, density: RHO_BALL, gap: 0, Lc: 6 });
          return s.run({ duration: 6 }).then(function (r) {
            var d = r.detail;
            var head = 'The clamps open. On 6 m cables each ball leans in by **' + sig(d.deflection1 * 1e9) + ' nm**: a pull of ' + sig(d.F * 1e6) + ' μN against a weight of ' + sig(d.W1 / 1000) + ' kN. ';
            if (v == null) return head;
            var dRef = v / d.W1 * 6;
            if (Math.abs(v - d.F) / d.F <= 0.005) return head + 'Your force predicts the same lean. The annex placard can stay.';
            return head + 'Your force would lean them ' + sig(dRef * 1e9) + ' nm, which the laser gauge does not see.';
          });
        }
      },
      {
        id: 'P5.G-units',
        label: 'Placard check: Eq. 1–2 has to give **F in newtons**. Write **G** with the units that make that true, in SI base units (m, kg, s).',
        placeholder: 'e.g. 1.23(10^-4) m^2/s',
        spec: { value: G, unit: 'm^3/(kg·s^2)', sf: 3, form: 'any', expressIn: 'SI' },
        answer: '66.7(10^-12) m^3/(kg·s^2)',
        wrong: [
          { input: '66.7(10^-12) N·m^2', kind: 'unit' },
          { input: '66.7(10^-12) m^3/(kg·s)', kind: 'unit' }
        ],
        hints: [
          'Every term of a valid equation carries the same units. Solve Eq. 1–2 for *G* and look at what units are left.',
          '$G = F r^2 / (m_1 m_2)$, so its units are $\\u{N·m^2/kg^2}$. Now break the newton into base units.',
          '$\\u{N} = \\u{kg·m/s^2}$, so $\\u{N·m^2/kg^2} = \\u{(kg·m/s^2)·m^2/kg^2}$. Cancel one kg.'
        ],
        consequence: function (ctx, ans, ok) {
          var p = ans.result && ans.result.parsed;
          if (!p || !p.ok) return null;
          // What unit would F come out in with the player's G? [F] = [G] kg^2 / m^2.
          var d = p.dims.slice();                       // [L, M, T, ...]
          d[0] -= 2; d[1] += 2;
          var outUnit = SE.units.dimsToSI(d);
          if (ok) return 'With those units, $G m_1 m_2 / r^2$ comes out in **' + outUnit + '**, which is the newton. The equation is homogeneous.';
          return 'With those units, $G m_1 m_2 / r^2$ comes out in **' + outUnit + '**, which is not a force. The bench load cell refuses the figure.';
        }
      },
      {
        id: 'P5.moon-weight',
        label: 'A survivor who weighs **190 lb** at the depot signs up for lunar training. Their **weight on the Moon**, in pounds.',
        placeholder: 'e.g. 25.0 lb',
        spec: {
          value: W_MOON_LB * LBF, unit: 'N', sf: 3, form: 'any', expressIn: 'lb',
          mistakes: [{ ratio: G_FPS / G_MOON_FPS, kind: 'concept', msg: 'That is the Earth weight. Weight is $m g$, and g on the Moon is 5.30 ft/s², not 32.2.' }]
        },
        answer: '31.3 lb',
        wrong: [
          { input: '190 lb', kind: 'concept' },
          { input: '139 N', kind: 'form' }
        ],
        hints: [
          'The survivor\'s mass doesn\'t change on the trip. Find it first, from the Earth weight.',
          '$m = W/g = 190/32.2$ slug. On the Moon, $W_m = m g_m$ with $g_m = 5.30$ ft/s².',
          '$m = 5.901$ slug, so $W_m = 5.901 \\times 5.30$ lb.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          var s = ctx.setScene('scales', { mode: 'compare', location: 'moon', units: 'FPS', mass: M_KG, standardMass: M_KG, capacity: 1500, k: 4000, label: 'SURVIVOR' });
          return s.run({ location: 'moon', mass: M_KG }).then(function (r) {
            // The dial converts the SI weight (m x 1.62 m/s^2) at 4.448 N/lb, so it
            // reads a hair above m x 5.30 ft/s^2: the course factors are rounded.
            var dial_lb = M_KG * G_MOON / LBF;
            var head = 'On the lunar platform the spring scale settles at **' + sig(dial_lb, 4) + ' lb**, while the beam balance sits level against the same ' + sig(M_KG) + ' kg of standard masses it matched on Earth. ';
            if (v == null) return head;
            if (Math.abs(v / LBF - W_MOON_LB) / W_MOON_LB <= 0.01) return head + 'Your figure matches the spring. (The dial works from 1.62 m/s² and 4.448 N/lb; the FPS route, ' + sig(mSlug, 4) + ' slug × 5.30 ft/s² = ' + sig(W_MOON_LB, 4) + ' lb, differs only because the constants themselves are rounded.)';
            return head + 'You said ' + sig(v / LBF) + ' lb, which the spring does not agree with.';
          });
        }
      },
      {
        id: 'P5.moon-mass',
        label: 'The same survivor\'s **mass on the Moon**, in kilograms, for the rig\'s harness log.',
        placeholder: 'e.g. 70.0 kg',
        spec: {
          value: M_KG, unit: 'kg', sf: 3, form: 'si', expressIn: 'kg',
          mistakes: [{ ratio: G_MOON_FPS / G_FPS, kind: 'concept', msg: 'That divided the Moon weight by Earth\'s g. Mass does not depend on where you are: work it out once, from either weight with its own g.' }]
        },
        answer: '86.1 kg',
        wrong: [
          { input: '14.2 kg', kind: 'concept' },
          { input: '5.90 slug', kind: 'form' }
        ],
        hints: [
          'Mass is the amount of matter. Taking it to the Moon doesn\'t change it.',
          'Mass in slugs is $190/32.2$. Convert slugs to kilograms with 14.59 kg/slug.',
          '$5.901 \\u{ slug} \\times 14.59\\u{ kg/slug}$.'
        ],
        consequence: function (ctx, ans) {
          var v = num(ans);
          // A figure that agrees to 3 s.f. stands for the same stack of standard
          // masses; anything else goes on the pan as written.
          var close = v != null && Math.abs(v - M_KG) / M_KG <= 0.005;
          var s = ctx.setScene('scales', { mode: 'compare', location: 'moon', units: 'SI', mass: M_KG, standardMass: close ? M_KG : Math.max(0, v || 0), capacity: 1500, k: 4000, label: 'SURVIVOR' });
          return s.run({ location: 'moon', mass: M_KG }).then(function () {
            var dm = (v == null ? 0 : v) - M_KG;
            if (close) return 'You stack ' + sig(v) + ' kg of standard masses on the balance pan opposite the survivor. On the Moon the beam sits **level**, exactly as it did on Earth: both pans feel the same g, so it cancels.';
            return 'You stack ' + (v == null ? 'nothing' : sig(v) + ' kg') + ' on the pan opposite the survivor. The beam tips toward the ' + (dm < 0 ? 'survivor' : 'masses') + '. The balance compares masses, and mass came along unchanged.';
          });
        }
      }
    ],

    deeper: [
      'The Moon\'s g from $G M / R^2$ (1.623 m/s²) rather than taken on trust from a placard.',
      'Weight at 400 km: g has dropped to about 8.69 m/s², so using 9.81 overstates the debris weight by 13 %. Orbiting objects are not weightless; they are in free fall.',
      'A beam balance reads the same on the Moon because g multiplies both sides of its moment balance and cancels. A spring scale measures force, so its reading drops to about a sixth.'
    ],

    debrief: [
      'Juno pins your sheet to the annex door.',
      '"So the Moon placard is right, the rig is safe to train on, the satellite rumour was half true and the scary half is wrong, and the steel balls really do pull on each other, by about the weight of a few grains of sand. Good. I\'ll tell the water-tower crew to get some sleep."',
      'Everything on this sheet was one law: $F = G m_1 m_2 / r^2$. Weight is that law with the planet as one of the masses, which is why it changes with altitude and with which planet you stand on, and mass never does.'
    ].join('\n\n')
  });
})(globalThis.SE);
