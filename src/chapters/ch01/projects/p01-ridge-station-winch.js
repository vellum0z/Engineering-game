/*
 * P1 · Ridge Station Winch (manual project).
 *
 * Weight and mass at a real site: W = m g with the local g instead of the
 * standard value, statics as the a = 0 case (a hovering load), Newton's
 * second law for the drift when the cable tension is off, and the SI / FPS
 * conversions for force and mass. Course sections 1.2–1.4.
 *
 * The beyond-the-book factor is the site gravity: the relay station sits at
 * 2400 m on a ridge at 12° latitude, where g is about 0.36 % below 9.81.
 * That is small, but the winch governor can only absorb 0.2 % of error, so
 * a governor set with 9.81 lets the generator creep up into the head block.
 */
(function (SE) {
  'use strict';
  var GR = SE.physics.gravity;

  var LAT = 12, ALT = 2400;           // relay station site
  var M = 1850;                       // generator, kg (nameplate)
  var LBF = 4.448, SLUG = 14.59, FT = 0.3048;
  var G_STD = 9.81;                   // standard g used on spec sheets

  // Site gravity. Hand-check:
  //   sin²12° = 0.043227,  sin²24° = 0.165435
  //   9.780327 (1 + 0.0053024·0.043227 − 0.0000058·0.165435)
  //     = 9.780327 × 1.000228 = 9.782559 m/s²  (sea level at 12°)
  //   free air: 3.086e-6 × 2400 = 0.007406
  //   g = 9.782559 − 0.007406 = 9.775153 m/s²  →  9.775 m/s² (4 s.f.)
  var G_SITE = GR.gSite(LAT, ALT);

  // True weight at the site. 1850 × 9.775153 = 18 084.0 N → 18.08 kN (4 s.f.)
  var W = M * G_SITE;

  // Same setting for the US-made winch. 18 084.0 / 4.448 = 4065.65 lb → 4066 lb
  var W_LB = W / LBF;

  // Mass in slugs. 1850 / 14.59 = 126.80 slug → 127 slug. Location never enters.
  var M_SLUG = M / SLUG;

  // Spare parts for the station's spec sheet, which lists weights at
  // standard gravity (9.81 m/s²) so a tag reads the same wherever it ships.
  //   timing crystal  0.0742 kg × 9.81 = 0.727 902 N → 728 mN   (site g: 725 mN)
  //   rotor bearing   63.8 kg  × 9.81 = 625.878 N   → 626 N    (site g: 624 N)
  //   transformer     8450 kg  × 9.81 = 82 894.5 N  → 82.9 kN  (site g: 82.6 kN)
  // The masses were picked so that the site-g figure differs from the
  // standard one in the third digit, which the checker can tell apart.
  var PARTS = {
    crystal: { m: 0.0742, label: 'CRYSTAL', name: 'timing crystal' },
    bearing: { m: 63.8, label: 'BEARING', name: 'rotor bearing' },
    transformer: { m: 8450, label: 'XFMR', name: 'spare transformer' }
  };

  // ------------------------------------------------------------------ hover physics

  // The precision governor holds the dialled tension, and a small servo trim
  // corrects the last little bit of error from a load cell. The trim has
  // authority for ±0.2 % of the load; past that it saturates and whatever
  // error is left over accelerates the load (Eq. 1-1: a = ΣF / m).
  var TRIM = 0.002;
  var BOLT_TIME = 45;                 // s the generator must hold while the pad crew bolts it
  var HEADROOM = 4.2;                 // m of travel above the hover point before the head block
  var FLOOR = 3.0;                    // m below the hover point to the pad

  function governed(T, Wtrue) {
    var err = T - Wtrue, lim = TRIM * Wtrue;
    if (Math.abs(err) <= lim) return { Teff: Wtrue, trimUsed: lim ? Math.abs(err) / lim : 0, residual: 0, err: err };
    var s = err > 0 ? 1 : -1;
    return { Teff: T - s * lim, trimUsed: 1, residual: err - s * lim, err: err };
  }

  // Predicted drift over the bolt-up window from the leftover force.
  function boltDrift(residual, m) {
    var a = residual / m;
    return { a: a, d: 0.5 * a * BOLT_TIME * BOLT_TIME };
  }

  // The hoist scene ramps cable tension up from zero over its first 0.3 s, as
  // for a lift off the ground. In a hover the governor is already holding
  // the load when the test starts, so start the clock past the ramp;
  // otherwise the load sags for 0.3 s and falls whatever the setting.
  function hold(s, T, dur) {
    var pr = s.run(T, { duration: dur });
    s.time = 0.3;
    return pr;
  }

  function fmtN(N) { return SE.sceneUtil.fmtForce(N, 'SI'); }
  function fmtLb(N) { return SE.sceneUtil.fmtForce(N, 'FPS'); }
  function pct(x) { return SE.sigfig.roundSig(x * 100, 2).text + ' %'; }
  function sig(x, n) { return SE.sigfig.roundSig(x, n).text; }

  // Run the hover on the ridge hoist with tension T (N) and describe it.
  function hoverTest(ctx, T, units, label) {
    var g = governed(T, W);
    var s = ctx.setScene('hoist', { mass: M, g: G_SITE, label: label || 'GENERATOR', mode: 'hover', hookHeight: 3, height: 9, rating: 30000, units: units || 'SI', hideKey: true });
    var show = units === 'FPS' ? fmtLb : fmtN;
    return hold(s, g.Teff, 8).then(function (r) {
      if (r.outcome === 'snapped') return 'The cable is rated 30 kN. At ' + show(T) + ' it parted before the governor even settled, and the generator went into the pad.';
      if (r.outcome === 'held') {
        if (g.trimUsed < 0.25) return 'Held dead still for the full bolt-up. The trim loop used **' + pct(g.trimUsed) + '** of its authority, which is just the last digit of the dial. The pad crew torqued every bolt without touching the load.';
        return 'It held, but only because the trim loop is soaking up ' + show(Math.abs(g.err)) + ', **' + pct(g.trimUsed) + '** of everything it has. One gust on the cable and it saturates. The dial figure itself is off, so it fails the sign-off.';
      }
      var dr = boltDrift(g.residual, M);
      var dir = dr.a > 0 ? 'up' : 'down';
      var lim = dr.a > 0 ? HEADROOM : FLOOR;
      var watched = r.detail && r.detail.y != null ? Math.abs(r.detail.y - 3) : null;
      var msg = 'The governor set ' + show(T) + ' against a true weight of ' + show(W) + '. The trim loop saturated and the leftover ' + show(Math.abs(g.residual)) + ' gave the load **a = ' + sig(Math.abs(dr.a), 2) + ' m/s² ' + dir + '**.';
      if (r.outcome === 'slammed') return msg + ' It climbed into the head block in seconds.';
      if (r.outcome === 'dropped') return msg + ' It came down on the pad before the crew had a bolt in.';
      msg += watched != null ? ' In ' + 8 + ' s on the rig it crept ' + sig(watched * 100, 2) + ' cm.' : '';
      msg += ' Over the ' + BOLT_TIME + ' s bolt-up that is ½·a·t² = **' + sig(Math.abs(dr.d), 2) + ' m**';
      msg += Math.abs(dr.d) > lim ? (dr.a > 0 ? ', and there is only ' + HEADROOM + ' m to the head block.' : ', and the pad is only ' + FLOOR + ' m below.') : ', far too much to line up bolt holes.';
      return msg;
    });
  }

  // Weigh a part on the depot's standard-gravity reference scale.
  function tagTest(ctx, part, a) {
    var Wstd = part.m * G_STD;
    var s = ctx.setScene('scales', { mode: 'compare', location: 'earth', mass: part.m, k: 1.6 * Wstd, capacity: 2 * Wstd, label: part.label });
    return s.run({ mass: part.m, location: 'earth' }).then(function (r) {
      var read = r.detail.reading;
      if (a.si == null) return 'The reference scale (standard g) reads **' + fmtN(read) + '**. Nothing usable on the tag to compare.';
      var off = a.si / read - 1;
      if (Math.abs(off) < 0.0015) return 'The depot reference scale, calibrated at standard g, reads **' + fmtN(read) + '**. Your tag agrees. Any depot on the line will see the same number.';
      var site = part.m * G_SITE;
      var msg = 'The reference scale (standard g) reads **' + fmtN(read) + '**; your tag says ' + fmtN(a.si) + ', ' + pct(Math.abs(off)) + (off < 0 ? ' light.' : ' heavy.');
      if (Math.abs(a.si / site - 1) < 0.002) msg += ' That is what it weighs *up on the ridge*. The spec sheet is for the whole line, so it uses standard g.';
      return msg;
    });
  }

  // Ratio window helper for checker mistakes.
  function between(lo, hi) { return function (r) { return r > lo && r < hi; }; }

  SE.content.registerProject('ch01', {
    id: 'P1', order: 1, title: 'Ridge Station Winch', subtitle: 'Weight is a local number',
    brief: [
      'The relay station on Cinder Ridge keeps our radio link to the coast caravans. Its generator died last winter. We have a rebuilt one, **1850 kg** on the nameplate, and a gantry winch up there to set it on the new pad.',
      'The pad crew needs the generator to **hover**, perfectly still, a metre or so above the bolts while they line up the base plate and torque it down. That takes about 45 seconds. The winch has a precision governor that holds whatever cable tension you dial in. Dial the wrong number and the generator walks up or down on its own.',
      'I also need the backup figures for the old US-made winch, the generator\'s mass for that winch\'s controller, and three spare-part weights for the station\'s spec sheet. Work it by hand. The converter is down the mountain with Hask.'
    ].join('\n\n'),
    conditions: [
      'Site: **Cinder Ridge relay station**, latitude **12° N**, elevation **2400 m** above sea level.',
      'The governor dial takes **4 significant figures**. Its servo trim can only absorb **±0.2 %** of the load; beyond that the load accelerates.',
      'Use the international gravity formula for latitude, with the free-air drop of **3.086(10⁻⁶) m/s² per metre** of elevation.',
      'The backup winch is US-made and reads in **pounds**. Its controller wants the load\'s mass in **slugs**.',
      'Station spec sheets list part weights at **standard gravity (9.81 m/s²)**, so a tag reads the same at every depot on the line.',
      'Conversion factors: 1 lb = 4.448 N, 1 slug = 14.59 kg, 1 ft = 0.3048 m. Report 3 s.f. unless the hardware asks for more.'
    ],
    scene: { type: 'hoist', params: { mass: 500, g: G_STD, label: 'TEST 500 kg', mode: 'hover', hookHeight: 3, height: 9, rating: 30000 } },
    controls: [],
    rigText: 'The depot calibration hoist: a **500 kg** test mass on the same model of governor, here at Rustline where the governors are set with standard g. Try the presets to see how much error the trim loop tolerates.',
    rigActions: [
      {
        label: 'Hover the test mass at m·g = 500 × 9.81',
        run: function (ctx) {
          var s = ctx.setScene('hoist', { mass: 500, g: G_STD, label: 'TEST 500 kg', mode: 'hover', hookHeight: 3, height: 9, rating: 30000 });
          return hold(s, 500 * G_STD, 6).then(function (r) { return 'Outcome: **' + r.outcome + '**. Tension equals weight, so ΣF = 0 and a = 0. It just hangs there.'; });
        }
      },
      {
        label: 'Same, but set 0.15 % high',
        run: function (ctx) {
          var Wt = 500 * G_STD, gv = governed(Wt * 1.0015, Wt);
          var s = ctx.setScene('hoist', { mass: 500, g: G_STD, label: 'TEST 500 kg', mode: 'hover', hookHeight: 3, height: 9, rating: 30000 });
          return hold(s, gv.Teff, 6).then(function (r) { return 'Outcome: **' + r.outcome + '**. The trim loop took up the extra ' + fmtN(Wt * 0.0015) + ' (' + pct(gv.trimUsed) + ' of its range).'; });
        }
      },
      {
        label: 'Same, but set 0.4 % low',
        run: function (ctx) {
          var Wt = 500 * G_STD, gv = governed(Wt * 0.996, Wt);
          var s = ctx.setScene('hoist', { mass: 500, g: G_STD, label: 'TEST 500 kg', mode: 'hover', hookHeight: 3, height: 9, rating: 30000 });
          return hold(s, gv.Teff, 6).then(function (r) {
            var dr = boltDrift(gv.residual, 500);
            return 'Outcome: **' + r.outcome + '**. The trim saturated; the leftover ' + fmtN(Math.abs(gv.residual)) + ' pulls it down at ' + sig(Math.abs(dr.a), 2) + ' m/s². Over 45 s that is ' + sig(Math.abs(dr.d), 2) + ' m.';
          });
        }
      },
      {
        label: 'Look at the globe from the standard location (45°, sea level)',
        run: function (ctx) {
          ctx.setScene('gravity', { mode: 'site', latitude: 45, siteAltitude: 0 });
          return 'The standard location is sea level at 45° latitude. Note which way the spin and the bulge push g as you head toward the equator.';
        }
      }
    ],
    lockedTools: ['converter'],
    deliverables: [
      {
        id: 'P1.g',
        label: '**Local g** at the relay station, to 4 s.f.',
        placeholder: 'e.g. 9.812 m/s^2',
        spec: {
          value: G_SITE, unit: 'm/s^2', sf: 4, form: 'any', tol: 0.0002,
          mistakes: [
            { test: between(1.0028, 1.0040), kind: 'concept', msg: 'That is standard gravity, the value at sea level and 45°. The ridge is neither.' },
            { test: between(1.0005, 1.0011), kind: 'concept', msg: 'Right latitude, but at sea level. The station is 2400 m up: subtract the free-air drop.' },
            { test: between(1.0012, 1.0019), kind: 'sign', msg: 'The elevation correction went the wrong way. Higher up you are farther from the centre, so g is smaller.' }
          ]
        },
        answer: '9.775 m/s^2',   // 9.775153 → 9.775
        wrong: [
          { input: '9.810 m/s^2', kind: 'concept' },
          { input: '9.783 m/s^2', kind: 'concept' },
          { input: '9.790 m/s^2', kind: 'sign' },
          { input: '9.78 m/s^2', kind: 'rounding' }
        ],
        hints: [
          'Gravity at a site depends on two things the standard value assumes away: how far you are from the equator, and how high you are. The conditions give you both.',
          'Sea-level g at latitude φ: $g = 9.780327(1 + 0.0053024\\sin^2\\phi - 0.0000058\\sin^2 2\\phi)$. Then take off $3.086(10^{-6})\\u{ m/s^2}$ for every metre of elevation. Make sure your calculator is in degrees.',
          '$\\sin^2 12° = 0.04323$ and $\\sin^2 24° = 0.1654$, so sea-level g is $9.780327 \\times 1.000228 = 9.78256\\u{ m/s^2}$. The free-air drop is $3.086(10^{-6}) \\times 2400 = 0.00741$. Subtract.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('gravity', { mode: 'site', latitude: LAT, siteAltitude: ALT });
          return s.run().then(function (r) {
            var gs = r.detail.gSite;
            if (a.si == null) return 'The station gravimeter reads **' + gs.toFixed(5) + ' m/s²**.';
            var gv = governed(M * a.si, W), dr = boltDrift(gv.residual, M);
            var msg = 'The station gravimeter reads **' + gs.toFixed(5) + ' m/s²**; you said ' + sig(a.si, 4) + ' (' + pct(Math.abs(a.si / gs - 1)) + ' off). ';
            msg += gv.residual === 0 ? 'A governor set from your g stays inside the trim window.' : 'A governor set from your g would leave ' + fmtN(Math.abs(gv.residual)) + ' unbalanced, a drift of ' + sig(Math.abs(dr.d), 2) + ' m over the bolt-up.';
            return msg;
          });
        }
      },
      {
        id: 'P1.hover',
        label: '**Governor setting** to hover the 1850 kg generator at the station (4 s.f., SI)',
        placeholder: 'e.g. 12.34 kN',
        spec: {
          value: W, unit: 'N', sf: 4, form: 'si', tol: 0.0004,
          mistakes: [
            { test: between(1.0028, 1.0040), kind: 'concept', msg: 'That is the generator\'s weight at standard gravity. Up on the ridge it weighs less, by more than the trim can absorb.' },
            { test: between(1.0005, 1.0011), kind: 'concept', msg: 'That is the weight at sea level. The elevation correction is missing.' }
          ]
        },
        answer: '18.08 kN',      // 1850 × 9.775153 = 18 084.0 N → 18.08 kN
        wrong: [
          { input: '18.15 kN', kind: 'concept' },
          { input: '18.10 kN', kind: 'concept' },
          { input: '1.850 Mg', kind: 'concept' },
          { input: '18084 N', kind: 'sigfig' },
          { input: '18080 N', kind: 'sigfig' }
        ],
        hints: [
          'Hovering means the generator\'s acceleration is zero. What does Newton\'s second law say about the forces on it then?',
          'With $a = 0$, $\\Sigma F = T - W = 0$, so the tension equals the weight at *this* site: $T = mg_{\\t{site}}$. Carry full precision for g.',
          '$T = 1850 \\times 9.77515 = 18\\,084\\u{ N}$. Four significant figures, with a prefix so the number sits between 0.1 and 1000.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null || a.spec.unit !== 'N' || !a.result.parts.units) return Promise.resolve('The governor takes a force. A mass on the dial means nothing to it; the winch would not even engage.');
          return hoverTest(ctx, a.si, 'SI');
        }
      },
      {
        id: 'P1.lb',
        label: 'The same hover setting for the **US-made backup winch**, in lb (4 s.f.)',
        placeholder: 'e.g. 1234 lb',
        spec: {
          value: W_LB * LBF, unit: 'N', sf: 4, form: 'any', expressIn: 'lb', tol: 0.0004,
          mistakes: [
            { test: between(1.0035, 1.0050), kind: 'concept', msg: 'That is mass in slugs times 32.2 ft/s²: the weight at standard gravity, not on the ridge.' },
            { test: between(1.0028, 1.0035), kind: 'concept', msg: 'That is the standard-gravity weight converted to pounds. Convert the ridge weight instead.' }
          ]
        },
        answer: '4066 lb',       // 18 084.0 / 4.448 = 4065.65 → 4066 lb
        wrong: [
          { input: '4083 lb', kind: 'concept' },
          { input: '80440 lb', kind: 'conversion' },
          { input: '4065 lb', kind: 'rounding' },
          { input: '4.066 kip', kind: 'form' }
        ],
        hints: [
          'The generator weighs exactly what it weighed a moment ago. Only the units change.',
          'Convert the site weight with the force factor $1\\u{ lb} = 4.448\\u{ N}$. Start from the unrounded weight, not your 4-figure dial reading.',
          '$18\\,084.0\\u{ N} \\times \\frac{1\\u{ lb}}{4.448\\u{ N}} = 4065.7\\u{ lb}$. Round to 4 s.f.'
        ],
        consequence: function (ctx, a) {
          if (a.si == null || !a.result.parts.units) return Promise.resolve('The backup governor reads force in pounds. That figure is not a force.');
          return hoverTest(ctx, a.si, 'FPS', 'GENERATOR (US winch)');
        }
      },
      {
        id: 'P1.slug',
        label: 'The generator\'s **mass in slugs** for the backup winch controller',
        placeholder: 'e.g. 123 slug',
        spec: {
          value: M_SLUG * SLUG, unit: 'kg', sf: 3, form: 'any', expressIn: 'slug', tol: 0.002,
          mistakes: [
            { test: between(0.990, 0.9975), kind: 'concept', msg: 'You divided the ridge weight by 32.2 ft/s². That mixes the site weight with standard g. Mass doesn\'t depend on location, so convert it directly.' }
          ]
        },
        answer: '127 slug',      // 1850 / 14.59 = 126.80 → 127 slug
        wrong: [
          { input: '126 slug', kind: 'concept' },
          { input: '27000 slug', kind: 'conversion' },
          { input: '4066 lb', kind: 'concept' }
        ],
        hints: [
          'Does the generator have less *stuff* in it on the ridge than at the depot?',
          'Mass is the same everywhere, so you never need g here. Convert the nameplate mass with $1\\u{ slug} = 14.59\\u{ kg}$.',
          '$1850\\u{ kg} \\times \\frac{1\\u{ slug}}{14.59\\u{ kg}} = 126.80\\u{ slug}$. Three significant figures.'
        ],
        consequence: function (ctx, a) {
          var Wr = M * G_SITE;
          var s = ctx.setScene('scales', { mode: 'compare', location: 'ridge', mass: M, standardMass: a.si && a.result.parts.units ? a.si : M, k: 1.6 * Wr, capacity: 2 * Wr, label: 'GENERATOR' });
          return s.run({ mass: M, location: 'ridge' }).then(function (r) {
            if (a.si == null || !a.result.parts.units) return 'The controller needs a mass. The spring scale on the ridge reads ' + fmtN(r.detail.reading) + ', which is a weight; the beam balance is the instrument that measures mass.';
            var off = a.si / M - 1;
            var msg = 'On the ridge\'s beam balance, the generator against ' + sig(a.si, 4) + ' kg of standard masses (your ' + sig(a.si / SLUG, 3) + ' slug): ';
            msg += Math.abs(off) < 0.002 ? '**level**. The same pans would balance at the depot, on the Moon, anywhere: g acts on both sides and cancels.' : 'it tips, ' + pct(Math.abs(off)) + (off < 0 ? ' short' : ' over') + '. Mass doesn\'t change with location, so no g belongs in this figure.';
            return msg;
          });
        }
      },
      {
        id: 'P1.parts.crystal',
        label: 'Spec-sheet weight of the **timing crystal** (74.2 g)',
        placeholder: 'e.g. 123 mN',
        spec: {
          value: PARTS.crystal.m * G_STD, unit: 'N', sf: 3, form: 'si', tol: 0.0015,
          mistakes: [{ test: between(0.993, 0.9985), kind: 'concept', msg: 'That is its weight on the ridge. Spec sheets use standard gravity.' }]
        },
        answer: '728 mN',        // 0.0742 × 9.81 = 0.727 902 N → 728 mN
        wrong: [
          { input: '725 mN', kind: 'concept' },
          { input: '728 N', kind: 'prefix' },
          { input: '74.2 g', kind: 'concept' }
        ],
        hints: [
          'Read the site conditions again: which g does the spec sheet use?',
          'Spec-sheet weight: $W = mg$ with $g = 9.81\\u{ m/s^2}$, mass in kilograms. Then choose a prefix that puts the number between 0.1 and 1000.',
          '$74.2\\u{ g} = 0.0742\\u{ kg}$, so $W = 0.0742 \\times 9.81 = 0.7279\\u{ N}$.'
        ],
        consequence: function (ctx, a) { return tagTest(ctx, PARTS.crystal, a); }
      },
      {
        id: 'P1.parts.bearing',
        label: 'Spec-sheet weight of the **rotor bearing** (63.8 kg)',
        placeholder: 'e.g. 123 N',
        spec: {
          value: PARTS.bearing.m * G_STD, unit: 'N', sf: 3, form: 'si', tol: 0.0015,
          mistakes: [{ test: between(0.993, 0.9985), kind: 'concept', msg: 'That is its weight on the ridge. Spec sheets use standard gravity.' }]
        },
        answer: '626 N',         // 63.8 × 9.81 = 625.878 N → 626 N
        wrong: [
          { input: '624 N', kind: 'concept' },
          { input: '63.8 kg', kind: 'concept' },
          { input: '0.626 MN', kind: 'prefix' }
        ],
        hints: [
          'Same spec sheet, same rule.',
          '$W = mg$ with standard g. This one already sits in range without a prefix.',
          '$W = 63.8 \\times 9.81 = 625.9\\u{ N}$.'
        ],
        consequence: function (ctx, a) { return tagTest(ctx, PARTS.bearing, a); }
      },
      {
        id: 'P1.parts.transformer',
        label: 'Spec-sheet weight of the **spare transformer** (8.45 Mg)',
        placeholder: 'e.g. 12.3 kN',
        spec: {
          value: PARTS.transformer.m * G_STD, unit: 'N', sf: 3, form: 'si', tol: 0.0015,
          mistakes: [{ test: between(0.993, 0.9985), kind: 'concept', msg: 'That is its weight on the ridge. Spec sheets use standard gravity.' }]
        },
        answer: '82.9 kN',       // 8450 × 9.81 = 82 894.5 N → 82.9 kN
        wrong: [
          { input: '82.6 kN', kind: 'concept' },
          { input: '82.9 N', kind: 'prefix' },
          { input: '82900 N', kind: 'sigfig' }
        ],
        hints: [
          'Mg is a megagram, not milligrams. How many kilograms is that?',
          '$1\\u{ Mg} = 10^{3}\\u{ kg}$. Work in base units, multiply by standard g, then pick one prefix for the answer.',
          '$8.45\\u{ Mg} = 8450\\u{ kg}$, so $W = 8450 \\times 9.81 = 82\\,894.5\\u{ N}$.'
        ],
        consequence: function (ctx, a) { return tagTest(ctx, PARTS.transformer, a); }
      }
    ],
    deeper: [
      '**Latitude.** g at sea level runs from about 9.780 m/s² at the equator to 9.832 m/s² at the poles. Part of that is rotation: a point on the equator rides a 40 000 km circle once a day, and some of gravity\'s pull goes into keeping it on that circle. The rest is shape: the spin has flattened the Earth, so the equator sits about 21 km farther from the centre.',
      '**Elevation.** Climbing h metres moves you farther from the centre, and by $g = GM_e/r^2$ the pull falls off. Near the surface that works out to about $3.086(10^{-6})\\u{ m/s^2}$ per metre, the *free-air* correction. It ignores the rock under your feet, which pulls back slightly.',
      '**Why it mattered here.** At 12° and 2400 m the two corrections add to about 0.36 %. That is invisible on a bathroom scale, but bigger than the 0.2 % the governor could trim away, so a setting based on 9.81 would have driven the generator into the head block.'
    ],
    debrief: [
      'Generator\'s on the pad and bolted. The link to the coast is back.',
      'What made this work: **statics is just Newton\'s second law with a = 0**, so the hover tension had to equal the generator\'s weight *where it hung*. Weight is $W = mg$, and g is a property of the place. Mass isn\'t, which is why the slug figure never needed g, and why the spec sheet can fix one standard g and mean the same thing everywhere.',
      'Hask says the ridge is worth remembering: whenever a tolerance is tighter than a few tenths of a percent, standard g stops being good enough.'
    ].join('\n\n')
  });
})(globalThis.SE);
