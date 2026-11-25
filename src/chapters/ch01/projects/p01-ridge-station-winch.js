/*
 * P1 · Ridge Station Winch (manual project, played in the build yard).
 *
 * Weight and mass at a real site: W = m g with the local g instead of the
 * standard value, statics as the a = 0 case (a hovering load), Newton's
 * second law for the drift when the line tension is off, and the SI / FPS
 * conversions for force and mass. Course sections 1.2–1.4.
 *
 * The relay station sits at 2400 m on a ridge at 12° latitude, where g is
 * about 0.36 % below 9.81. The winch governor can only trim away 0.2 % of
 * error, so a setting worked out with 9.81 sends the generator up into the
 * head block. The yard itself is on the ridge: world gravity is the site g,
 * so any test rig the player builds feels it too.
 *
 * Parts that only this job uses are defined at the bottom of this file
 * (library: false): the gantry, the generator, the station governor, the
 * US-made backup winch, the depot checkweigher and the spare-part crates.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial;
  var GR = SE.physics.gravity;

  var LAT = 12, ALT = 2400;           // relay station site
  var M = 1850;                       // generator, kg (nameplate)
  var LBF = 4.448, SLUG = 14.59;
  var G_STD = 9.81;                   // standard g used on spec sheets

  // Site gravity. Hand-check:
  //   sin²12° = 0.043227,  sin²24° = 0.165435
  //   9.780327 (1 + 0.0053024·0.043227 − 0.0000058·0.165435)
  //     = 9.780327 × 1.000228 = 9.782559 m/s²  (sea level at 12°)
  //   free air: 3.086e-6 × 2400 = 0.007406
  //   g = 9.782559 − 0.007406 = 9.775153 m/s²  →  9.775 m/s² (4 s.f.)
  var G_SITE = GR.gSite(LAT, ALT);

  // True weight at the site. 1850 × 9.775153 = 18 084.0 N → 18.08 kN (4 s.f.)
  // Same in lb: 18 084.0 / 4.448 = 4065.65 lb → 4066 lb
  // Mass in slugs: 1850 / 14.59 = 126.80 slug. Location never enters.
  //
  // Spare parts for the station spec sheet, at standard gravity:
  //   timing crystal  0.0742 kg × 9.81 = 0.727 902 N → 728 mN   (site g: 725 mN)
  //   rotor bearing   63.8 kg  × 9.81 = 625.878 N   → 626 N    (site g: 624 N)
  //   transformer     8450 kg  × 9.81 = 82 894.5 N  → 82.9 kN  (site g: 82.6 kN)

  // Governor model. The governor holds the dialled line tension; a servo trim
  // driven by a position sensor corrects the last bit of error, but only up
  // to ±0.2 % of the dialled tension. Past that, whatever is left over
  // accelerates the load (ΣF = m a).
  var TRIM = 0.002;
  var BOLT_TIME = 45;                 // s the generator must hold while the pad crew bolts it
  var TOL = 0.025;                    // m: the base plate holes line up within ±25 mm
  var RATING = 30000;                 // N: the gantry line's breaking load

  var HOVER_Y = 1.9;                  // generator centre at the hover point
  var GEN = { w: 1.6, h: 1.2 };
  var PAD_TOP = 0.3;
  var HEAD_Y = HOVER_Y + GEN.h / 2 + 4.2;   // underside of the head block: 4.2 m of headroom

  var f3 = function (x) { return D.fmtNum(x, 3); };
  var f2 = function (x) { return D.fmtNum(x, 2); };

  /* ------------------------------------------------------------ the rigs */

  // The gantry and generator on the pad, plus a test hook and a calibration
  // crate off to the side for anyone who wants to weigh something first.
  function ridge(winch) {
    return { parts: [
      { id: 'pad', type: 'block', x: 0, y: PAD_TOP / 2, dials: { width: '3 m', height: PAD_TOP + ' m' }, locked: true, label: 'pad' },
      { id: 'gantry', type: 'p01-gantry', x: 0, y: HEAD_Y, locked: true, label: 'gantry' },
      { id: 'gen', type: 'p01-generator', x: 0, y: HOVER_Y, locked: true, label: 'generator' },
      winch,
      { id: 'testhook', type: 'hook', x: -8, y: 5, locked: true, label: 'test hook' },
      { id: 'calib', type: 'crate', x: -8, y: 0.5, dials: { mass: '100.0 kg' }, fixed: ['mass'], label: 'calibration mass' }
    ] };
  }
  var LINE = { a: { part: 'gantry', anchor: 'head' }, b: { part: 'gen', anchor: 'top' } };
  var STATION = ridge(Object.assign({ id: 'gov', type: 'p01-governor', locked: true, open: ['tension'], dials: { tension: '' }, label: 'station governor' }, LINE));
  var BACKUP_LB = ridge(Object.assign({ id: 'gov', type: 'p01-backup', locked: true, open: ['tension'], dials: { mode: 'tension' }, label: 'backup winch' }, LINE));
  var BACKUP_SLUG = ridge(Object.assign({ id: 'gov', type: 'p01-backup', locked: true, open: ['mass'], dials: { mode: 'mass' }, label: 'backup winch' }, LINE));

  var SPARES = [
    { id: 'crystal', name: 'timing crystal', mass: '74.2 g', x: -6, w: 0.4, h: 0.3 },
    { id: 'bearing', name: 'rotor bearing', mass: '63.8 kg', x: -1, w: 0.8, h: 0.8 },
    { id: 'xfmr', name: 'spare transformer', mass: '8.45 Mg', x: 5, w: 2.0, h: 1.6 }
  ];
  var DEPOT = { parts: [] };
  SPARES.forEach(function (sp) {
    DEPOT.parts.push({ id: 'cw-' + sp.id, type: 'p01-checkweigher', x: sp.x, y: 0.2, locked: true, label: sp.name + ' scale' });
    DEPOT.parts.push({ id: sp.id, type: 'p01-spare', x: sp.x, y: 0.4 + sp.h / 2, dials: { mass: sp.mass, tag: '', w: sp.w + ' m', h: sp.h + ' m' }, locked: true, open: ['tag'], label: sp.name });
  });

  /* ------------------------------------------------------------ the goal */

  // Hold the generator inside the bolt-up window for the whole bolt-up,
  // hanging on nothing but the winch line.
  function touching(s, id) {
    var body = s.body(id), hit = null;
    s.world.contacts.forEach(function (ct) {
      if (hit || !ct.points || !ct.points.length) return;
      var other = ct.fa.body === body ? ct.fb.body : ct.fb.body === body ? ct.fa.body : null;
      if (other) hit = (other.userData && other.userData.part) || 'something';
    });
    return hit;
  }
  var hoverGoal = G.all(
    G.never(function (s) {
      var b = s.breaks[0];
      if (!b) return null;
      if (b.part === 'gov') return 'The winch line parted: it was dialled to ' + D.format(b.force, D.autoUnit(b.force, 'force'), 3, 'force') + ' and it breaks at 30 kN. The generator went into the pad.';
      return 'Something snapped at ' + D.format(b.force, D.autoUnit(b.force, 'force'), 3, 'force') + '.';
    }),
    siteGuard(G_SITE, 'The generator is on Cinder Ridge. A site marker can\'t change the gravity it hangs in.'),
    G.never(function (s) {
      // floating, not slung: nothing fixed may carry the load through a rope or pin
      var body = s.body('gen'), W = body.m * G_SITE, sling = null;
      s.world.joints.forEach(function (j) {
        if (sling || j.broken || (j.bodyA !== body && j.bodyB !== body)) return;
        var other = j.bodyA === body ? j.bodyB : j.bodyA;
        if (!other || other.type !== 'static') return;
        var r = j.reaction ? j.reaction() : null, F = r ? Math.hypot(r.force.x, r.force.y) : 0;
        if (F > 0.02 * W) sling = (j.userData && j.userData.part) || 'a line';
      });
      return sling ? 'The generator is slung from a fixed point (the ' + labelOf(s, sling) + '). Slung, it can\'t float onto the bolts: hold it with a balanced pull, like the governor, a push or a counterweight.' : null;
    }),
    G.never(function (s) {
      var hit = touching(s, 'gen');
      if (!hit) return null;
      if (hit === 'gantry') return 'The generator climbed into the head block.';
      if (hit === 'pad' || hit === 'ground') return 'The generator came down on the pad before the crew had a bolt in.';
      return 'Something is touching the generator.';
    }),
    G.never(function (s) {
      var p = s.pos('gen'); if (!p) return null;
      var dy = p.y - HOVER_Y;
      s.peak('drift', dy);
      if (Math.abs(dy) <= TOL) return null;
      return 'The generator drifted ' + Math.round(Math.abs(dy) * 1000) + ' mm ' + (dy > 0 ? 'up' : 'down') + ' after ' + f2(s.t) + ' s. The bolt holes only line up within ±' + TOL * 1000 + ' mm.';
    }),
    G.after(BOLT_TIME)
  );
  function labelOf(s, id) { var p = s.part(id); return p ? (p.inst.label || p.def.name.toLowerCase()) : String(id); }
  // The job's place sets its gravity; a site marker moving the yard elsewhere doesn't count.
  function siteGuard(g, text) {
    return G.never(function (s) { return Math.abs(-s.world.gravity.y - g) > 1e-6 * g ? text : null; });
  }
  var hoverMargin = function (s) { return Math.round(Math.min(20, s.peakOf('drift') * 1000)); };

  // The drift a failed hover shows, read back through Newton's second law.
  function driftNote(ctx) {
    var r = ctx.result, st = r && r.state;
    if (!st || !st.pos('gen') || !(st.t > 0.2)) return '';
    var dy = st.pos('gen').y - HOVER_Y, v = st.vel('gen').y, t = st.t;
    var a = 2 * dy / (t * t);
    if (Math.abs(a) < 1e-5) return '';
    var gov = st.part('gov'), trim = gov && gov.trimLimit;
    var msg = 'The generator started at rest and moved ' + Math.round(Math.abs(dy) * 1000) + ' mm in ' + f2(t) + ' s: **a ≈ 2y/t² = ' + f2(Math.abs(a)) + ' m/s² ' + (a > 0 ? 'up' : 'down') + '**.';
    msg += ' By ΣF = m a, about **' + f2(M * Math.abs(a)) + ' N** was left unbalanced';
    if (trim) msg += ' after the trim gave all ' + f2(trim) + ' N it has';
    msg += '. The dial is off by the sum of those two. Over the ' + BOLT_TIME + ' s bolt-up that would be ½·a·t² = ' + f2(0.5 * Math.abs(a) * BOLT_TIME * BOLT_TIME) + ' m.';
    return msg;
  }
  function trimNote(ctx) {
    var gov = ctx.result && ctx.result.state.part('gov');
    if (!gov || !gov.trimLimit) return '';
    var used = Math.abs(gov.trimUsed || 0) / gov.trimLimit;
    return 'The trim loop was using **' + Math.round(used * 100) + ' %** of its authority at the end. ' + (used < 0.3 ? 'That is just the last digit of the dial: a clean setting.' : 'It held, but with that much trim in use a gust on the cable will saturate it. Check where your g came from.');
  }

  function offText(off) {
    if (Math.abs(off) < 0.5) return f2(Math.abs(off) * 100) + ' % ' + (off < 0 ? 'light' : 'heavy');
    var r = off + 1;
    return r > 1 ? 'about ' + D.fmtNum(r, 2) + ' times too heavy' : 'about ' + D.fmtNum(1 / r, 2) + ' times too light';
  }

  // Every crate stays on its scale through the check, and nothing is rejected.
  var CHECK_T = 2;
  var depotGoal = G.all(
    siteGuard(G_STD, 'These crates are checked at the depot, at standard gravity. A site marker can\'t move the depot.'),
    G.never(function (s) {
      for (var i = 0; i < SPARES.length; i++) {
        var w = s.part('cw-' + SPARES[i].id);
        if (w && w.verdict && w.verdict.empty) return 'Nothing was standing on the ' + SPARES[i].name + ' scale at the check.';
        if (w && w.verdict && w.verdict.untagged) return 'The depot checkweigher **rejected the ' + SPARES[i].name + '**: it has no weight tag.';
        if (w && w.verdict && !w.verdict.ok) return 'The depot checkweigher **rejected the ' + SPARES[i].name + '**: its tag is ' + offText(w.verdict.off) + ' against the scale. The line allows 0.15 %.';
      }
      return null;
    }),
    G.after(CHECK_T + 1)
  );

  /* ------------------------------------------------------------ project */

  SE.content.registerProject('ch01', {
    id: 'P1', order: 1, title: 'Ridge Station Winch', subtitle: 'Weight is a local number',
    objective: 'Float the 1850 kg generator still over the pad for 45 s',
    pitch: 'The generator has to float dead still over the pad while the crew bolts it down. Up on the ridge, gravity is a little weaker than the number you know.',
    brief: [
      'The relay station on Cinder Ridge keeps our radio link to the coast caravans. Its generator died last winter. We have a rebuilt one, **1850 kg** on the nameplate, hanging on the gantry winch over the new pad.',
      'The pad crew needs the generator to **hover**, dead still, a metre above the bolts while they line up the base plate and torque it down. That takes **45 seconds**. The winch has a precision governor that holds whatever line tension you dial in. Dial the wrong number and the generator walks up or down on its own.',
      'After that: the same hover on the old US-made backup winch, which thinks in pounds and slugs, and the weight tags for three spare parts going down to the depot. The converter is down the mountain with Hask, so work it by hand.',
      'This yard is up on the ridge with the generator, so anything you hang here feels the ridge\'s gravity. There is a test hook and a 100 kg calibration mass by the shed if you want to check a number before you trust it.'
    ].join('\n\n'),
    conditions: [
      'Site: **Cinder Ridge relay station**, latitude **12° N**, elevation **2400 m** above sea level.',
      'Gravity at sea level, latitude φ: **g = 9.780327(1 + 0.0053024 sin²φ − 0.0000058 sin²2φ) m/s²**. Take off **3.086(10⁻⁶) m/s² per metre** of elevation.',
      'The governor dial shows **4 significant figures**. Its trim can absorb **±0.2 %** of the dialled tension; beyond that the load accelerates.',
      'The bolt holes line up within **±25 mm**. The gantry line breaks at **30 kN**.',
      'The generator has to **float**: any balanced pull works (the governor, a push, a counterweight over a sheave, or a mix). A sling tied off to something fixed can\'t float onto the bolts, so it doesn\'t count.',
      'The backup winch is US-made: its tension dial reads **lb**, and in mass mode its controller wants the load in **slug** and multiplies by the g its own gravimeter measures.',
      'Spec-sheet weights use **standard gravity (9.81 m/s²)** so a tag reads the same at every depot. The depot checkweighers reject a tag more than **0.15 %** off.',
      'Conversion factors: 1 lb = 4.448 N, 1 slug = 14.59 kg.'
    ],
    yard: {
      site: { g: G_SITE, floor: 'concrete' },
      camera: { fit: { lo: { x: -10, y: -0.5 }, hi: { x: 5, y: 9.8 } } },
      design: STATION
    },
    jobs: [
      {
        id: 'P1.hover', label: 'Float the generator within ±25 mm for 45 s. The station governor holds the line tension you dial.',
        objective: 'Float the generator ±25 mm for 45 s, not slung',
        design: STATION,
        goal: hoverGoal, timeout: BOLT_TIME + 1, margin: hoverMargin,
        hints: [
          'Hovering means the generator\'s acceleration is zero. What does Newton\'s second law say about the forces on it then? And which g is acting on it up here?',
          'With a = 0, ΣF = T − W = 0, so the line tension equals the weight **at this site**: T = m g_site. Get g_site from the latitude formula, then take off the free-air drop for 2400 m. You can check it by hanging the calibration mass on the test hook with a cable.',
          'sin²12° = 0.04323 and sin²24° = 0.1654, so sea-level g is 9.780327 × 1.000228 = 9.78256 m/s². The drop is 3.086(10⁻⁶) × 2400 = 0.00741, so g_site = 9.77515 m/s². T = 1850 × 9.77515 = 18 084 N: dial **18.08 kN**.'
        ],
        onFail: driftNote,
        success: function (ctx) { return 'Bolted down without anyone touching the load. ' + trimNote(ctx) + '\n\nThat is statics: Newton\'s second law with **a = 0**, so T = W, and W = m g with *this* site\'s g.'; }
      },
      {
        id: 'P1.lb', label: 'The same float on the US-made backup winch. Its dial is printed in **lb**.',
        objective: 'Float it again on the backup winch (dial in lb)',
        design: BACKUP_LB,
        goal: hoverGoal, timeout: BOLT_TIME + 1, margin: hoverMargin,
        hints: [
          'The generator weighs exactly what it weighed a moment ago. Only the unit on the dial changes.',
          'Convert the site weight with 1 lb = 4.448 N. Start from the unrounded weight, not your 4-figure dial setting, and give the dial 4 figures again.',
          '18 084.0 N × (1 lb / 4.448 N) = 4065.7 lb: dial **4066 lb**.'
        ],
        onFail: driftNote,
        success: function (ctx) { return 'Held on the backup winch too. ' + trimNote(ctx) + ' A force is a force: 18.08 kN and 4066 lb are the same pull on the same line.'; }
      },
      {
        id: 'P1.slug', label: 'The backup winch in **mass mode**: it takes the load in **slug** and multiplies by the g it measures.',
        objective: 'Float it with the backup winch in mass mode (slug)',
        design: BACKUP_SLUG,
        goal: hoverGoal, timeout: BOLT_TIME + 1, margin: hoverMargin,
        hints: [
          'Does the generator have less *stuff* in it on the ridge than at the depot? The controller measures g itself.',
          'Mass is the same everywhere, so you never need g for this figure. Convert the nameplate mass with 1 slug = 14.59 kg. Don\'t divide a weight by 32.2 ft/s²: that sneaks standard g back in.',
          '1850 kg × (1 slug / 14.59 kg) = 126.80 slug: dial **126.8 slug**.'
        ],
        onFail: driftNote,
        success: function (ctx) { return 'Held. The controller multiplied your mass by the ridge\'s own g and got the right pull. ' + trimNote(ctx) + ' Mass never changes with place, which is why the nameplate is in kg and not in newtons.'; }
      },
      {
        id: 'P1.tags', label: 'Write a weight tag on each spare-part crate. The depot scale kicks off any crate whose tag is wrong.',
        objective: 'Tag all three crates so the depot scale accepts them',
        design: DEPOT,
        yard: { site: { g: G_STD, floor: 'concrete' }, camera: { fit: { lo: { x: -7.5, y: -0.3 }, hi: { x: 6.5, y: 4.2 } } } },
        goal: depotGoal, timeout: CHECK_T + 1.5,
        hints: [
          'Read the site conditions again: which g does the spec sheet use? These crates are being checked at the depot, not on the ridge.',
          'Spec-sheet weight: W = m g with g = 9.81 m/s², mass in kilograms. Watch the prefixes: g is grams and Mg is a megagram (1000 kg). Give each tag 3 figures and a prefix that keeps the number between 0.1 and 1000.',
          '0.0742 × 9.81 = 0.7279 N → **728 mN**. 63.8 × 9.81 = 625.9 N → **626 N**. 8450 × 9.81 = 82 894.5 N → **82.9 kN**.'
        ],
        success: 'All three passed the depot scale. Note that the scale down there doesn\'t care about the ridge: a spec-sheet weight uses one standard g, so the tag means the same at every depot on the line.'
      }
    ],
    solutions: {
      'P1.hover': [
        { set: { gov: { tension: '18.08 kN' } } },
        // governor short of the weight, an upward push makes up the rest: 17 000 + 1084 = 18 084 N
        { set: { gov: { tension: '17.00 kN' } }, add: [{ type: 'push', a: { part: 'gen' }, dials: { force: '1084 N', angle: '90 deg', time: '60 s' } }] },
        // a counterweight on a cable over a sheave takes 315.5 kg × 9.775 = 3084 N; the governor the other 15 kN
        { set: { gov: { tension: '15.00 kN' } }, add: [
          { id: 'sh', type: 'sheave', x: 1.2, y: 5.3, dials: { size: '2.4 m' } },
          { id: 'cw', type: 'counterweight', x: 2.4, y: 3.5, dials: { mass: '315.5 kg' } },
          { type: 'cable', a: { part: 'gen', anchor: 'top' }, b: { part: 'cw', anchor: 'top' }, dials: { rating: '20 kN', route: 'over sheave' } }] },
        { pass: false, set: { gov: { tension: '18.15 kN' } } },     // 1850 × 9.81: climbs into the head block
        { pass: false, set: { gov: { tension: '18.08 MN' } } },     // prefix slip: the line parts
        { pass: false, set: { gov: { tension: '0 kN' } }, add: [{ type: 'cable', a: { part: 'testhook', anchor: 'eye' }, b: { part: 'gen', anchor: 'top' }, dials: { rating: '50 kN' } }] }
      ],
      'P1.lb': [
        { set: { gov: { tension: '4066 lb' } } },
        { set: { gov: { tension: '3800 lb' } }, add: [{ type: 'push', a: { part: 'gen' }, dials: { force: '1182 N', angle: '90 deg', time: '60 s' } }] },   // 16 902 + 1182 N
        { pass: false, set: { gov: { tension: '4080 lb' } } },      // standard-g weight in lb
        { pass: false, set: { gov: { tension: '18084 lb' } } },     // forgot to convert: snaps
        { pass: false, set: { gov: { tension: '18.08 kN' } } }      // the dial only reads lb
      ],
      'P1.slug': [
        { set: { gov: { mass: '126.8 slug' } } },
        { set: { gov: { mass: '120.0 slug' } }, add: [{ type: 'push', a: { part: 'gen' }, dials: { force: '970 N', angle: '90 deg', time: '60 s' } }] },   // 17 114 + 970 N
        { pass: false, set: { gov: { mass: '126.3 slug' } } },      // site weight / 32.2 ft/s²
        { pass: false, set: { gov: { mass: '1850 slug' } } },       // forgot to convert: snaps
        { pass: false, set: { gov: { mass: '1850 kg' } } }          // the controller only reads slug
      ],
      'P1.tags': [
        { set: { crystal: { tag: '728 mN' }, bearing: { tag: '626 N' }, xfmr: { tag: '82.9 kN' } } },
        { set: { crystal: { tag: '0.1637 lb' }, bearing: { tag: '0.626 kN' }, xfmr: { tag: '18.64 kip' } } },     // other units, same weights
        { pass: false, set: { crystal: { tag: '725 mN' }, bearing: { tag: '624 N' }, xfmr: { tag: '82.6 kN' } } },   // ridge g
        { pass: false, set: { crystal: { tag: '728 N' }, bearing: { tag: '626 N' }, xfmr: { tag: '82.9 kN' } } },    // prefix slip
        { pass: false, set: { crystal: { tag: '728 mN' }, bearing: { tag: '626 N' }, xfmr: { tag: '82.9 N' } } }     // Mg read as a small mass
      ]
    },
    deeper: [
      '**Latitude.** g at sea level runs from about 9.780 m/s² at the equator to 9.832 m/s² at the poles. Part of that is rotation: a point on the equator rides a 40 000 km circle once a day, and some of gravity\'s pull goes into keeping it on that circle. The rest is shape: the spin has flattened the Earth, so the equator sits about 21 km farther from the centre.',
      '**Elevation.** Climbing h metres moves you farther from the centre, and by $g = GM_e/r^2$ the pull falls off. Near the surface that works out to about $3.086(10^{-6})\\u{ m/s^2}$ per metre, the *free-air* correction. It ignores the rock under your feet, which pulls back slightly.',
      '**Why it mattered here.** At 12° and 2400 m the two corrections add to about 0.36 %. That is invisible on a bathroom scale, but bigger than the 0.2 % the governor could trim away, so a setting based on 9.81 drove the generator into the head block.'
    ],
    debrief: [
      'Generator\'s on the pad and bolted. The link to the coast is back.',
      'What made this work: **statics is just Newton\'s second law with a = 0**, so the hover tension had to equal the generator\'s weight *where it hung*. Weight is $W = mg$, and g is a property of the place. Mass isn\'t, which is why the slug figure never needed g, and why the spec sheet can fix one standard g and mean the same thing everywhere.',
      'Hask says the ridge is worth remembering: whenever a tolerance is tighter than a few tenths of a percent, standard g stops being good enough.'
    ].join('\n\n')
  });

  /* ------------------------------------------------------------ job parts */

  var C = { steel: '#8d96a0', dark: '#4b5258', paint: '#c98a2b', line: '#d8d2c4', text: 'rgba(240,235,225,.95)' };
  function label(ctx, s, text, color) {
    ctx.save(); ctx.fillStyle = color || C.text; ctx.font = '12px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(text, s.x, s.y); ctx.restore();
  }

  // The gantry: two legs, a beam and the head block. Static scenery.
  Y.definePart({
    type: 'p01-gantry', name: 'Gantry', category: 'Site', library: false,
    blurb: 'The station gantry over the pad. The winch line runs down from the head block.',
    size: { w: 5.4, h: 0.8 },
    anchors: { head: { x: 0, y: 0 } },
    build: function (b) {
      var P = b.P, x = b.inst.x, y = b.inst.y;
      var body = b.body({ type: 'static', position: { x: x, y: y }, label: '', shapes: [
        { shape: P.box(0.3, 0.2, { x: 0, y: 0.2 }), material: 'steel' },           // head block
        { shape: P.box(2.8, 0.15, { x: 0, y: 0.55 }), material: 'steel' },          // beam
        { shape: P.box(0.12, (y + 0.7) / 2, { x: -2.7, y: -(y + 0.7) / 2 + 0.7 }), material: 'steel', sensor: true },
        { shape: P.box(0.12, (y + 0.7) / 2, { x: 2.7, y: -(y + 0.7) / 2 + 0.7 }), material: 'steel', sensor: true }
      ] });
      return { body: body, anchors: { head: { body: body, local: body.localPoint({ x: x, y: y }) } } };
    }
  });

  // The generator: a heavy box with a lifting eye. Mass from the nameplate.
  Y.definePart({
    type: 'p01-generator', name: 'Generator', category: 'Loads', library: false,
    blurb: 'The rebuilt station generator. Nameplate mass 1850 kg.',
    size: { w: GEN.w, h: GEN.h },
    dials: [{ key: 'mass', label: 'Mass', q: 'mass', def: M + ' kg', locked: true }],
    anchors: { top: { x: 0, y: GEN.h / 2 } },
    build: function (b) {
      var body = b.body({ position: b.at({ x: 0, y: 0 }), label: '', mass: b.si('mass'), fixedRotation: true,
        shapes: [{ shape: b.P.box(GEN.w / 2, GEN.h / 2), material: 'steel' }] });
      return { body: body, y0: b.inst.y };
    },
    plate: function (inst) { return ['Mass ' + inst.dials.mass]; },
    readouts: function (built) {
      return [
        { key: 'drift', label: 'drift', q: 'length', read: function () { return built.body.c.y - built.y0; } },
        { key: 'vy', label: 'vertical speed', q: 'speed', read: function () { return built.body.v.y; } }
      ];
    },
    draw: function (ctx, cam, built) {
      var c = built.body.c, s = cam.worldToScreen({ x: c.x, y: c.y + 0.05 });
      label(ctx, s, 'GENERATOR 1850 kg');
      // the bolt-up window on the pad
      var top = cam.worldToScreen({ x: c.x - 1.4, y: built.y0 + TOL }), bot = cam.worldToScreen({ x: c.x - 1.4, y: built.y0 - TOL });
      ctx.save(); ctx.strokeStyle = 'rgba(120,190,80,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(top.x - 6, top.y); ctx.lineTo(top.x + 6, top.y); ctx.moveTo(bot.x - 6, bot.y); ctx.lineTo(bot.x + 6, bot.y);
      ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
      var mid = cam.worldToScreen({ x: c.x, y: c.y });
      ctx.beginPath(); ctx.moveTo(top.x, mid.y); ctx.lineTo(top.x + 10, mid.y); ctx.strokeStyle = '#e6b422'; ctx.stroke();
      ctx.restore();
    }
  });

  // A governed winch line: holds the set tension T on the load, plus a trim
  // force of at most ±0.2 % of T from a position loop. The load does the rest.
  function governedLine(b, T) {
    var A = b.end('a'), B = b.end('b'), body = B.body, world = b.world;
    var lim = TRIM * T;
    var y0 = B.world.y;
    // trim loop: full authority at 20 mm off, critically damped for the load the tension implies
    var k = lim / 0.02, m = T / 9.81, c = 2 * Math.sqrt(k * Math.max(m, 1e-6));
    var out = { joint: null, bodies: [], setting: T, tension: T, trimLimit: lim, trimUsed: 0, broken: false, head: A, load: B };
    if (T > RATING) {
      // the line parts as soon as the drum takes up the load
      var fake = { userData: { part: b.inst.id }, label: b.inst.label };
      out.broken = true;
      b.on('step', function once() {
        if (out.reported) return;
        out.reported = true;
        world.emit('break', { joint: fake, force: T, reason: 'rating' });
      });
      return out;
    }
    function apply() {
      if (body.type !== 'dynamic') return;
      var p = body.worldPoint(B.local), head = A.body.worldPoint(A.local);
      var dx = head.x - p.x, dy = head.y - p.y, L = Math.hypot(dx, dy) || 1;
      var trim = -k * (p.y - y0) - c * body.v.y;
      trim = Math.max(-lim, Math.min(lim, trim));
      out.trimUsed = trim;
      var F = Math.max(0, T + trim);
      out.tension = F;
      body.applyForce({ x: F * dx / L, y: F * dy / L }, p);
    }
    apply();
    b.on('step', apply);
    return out;
  }
  function drawLine(ctx, cam, built, dialText) {
    if (!built.head || !built.load) return;
    var h = cam.worldToScreen(built.head.body.worldPoint(built.head.local));
    if (built.broken) { label(ctx, { x: h.x, y: h.y + 24 }, 'LINE PARTED', '#e0583a'); return; }
    var l = cam.worldToScreen(built.load.body.worldPoint(built.load.local));
    ctx.save(); ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(l.x, l.y); ctx.stroke();
    ctx.fillStyle = C.paint; ctx.fillRect(h.x - 30, h.y - 52, 60, 20);
    ctx.restore();
    label(ctx, { x: h.x, y: h.y - 38 }, dialText, '#1b1b1b');
    var used = built.trimLimit ? built.trimUsed / built.trimLimit : 0;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(h.x + 36, h.y - 52, 8, 20);
    ctx.fillStyle = Math.abs(used) > 0.99 ? '#e0583a' : '#78be50';
    var hh = 10 * Math.max(-1, Math.min(1, used));
    ctx.fillRect(h.x + 36, h.y - 42 - Math.max(0, hh), 8, Math.abs(hh));
    ctx.restore();
  }
  function sig4(x) { return SE.sigfig.roundSig(x, 4).value; }
  function lineReadouts(built) {
    return [
      { key: 'tension', label: 'line tension', q: 'force', read: function () { return built.broken ? 0 : built.tension; } },
      { key: 'trim', label: 'trim', q: 'force', read: function () { return built.broken ? 0 : built.trimUsed; } }
    ];
  }
  function unitOf(text) {
    var p = SE.units.parseQuantity(String(text || ''));
    return p && p.ok ? String(p.unitText).trim() : '';
  }

  // The station governor: SI dial, 4 figures.
  Y.definePart({
    type: 'p01-governor', name: 'Station governor', category: 'Rigging', library: false, connector: true,
    blurb: 'A precision winch governor. It holds the line tension you dial, to 4 figures, and trims the last ±0.2 % from a position sensor.',
    size: { w: 0.1, h: 2 },
    dials: [{ key: 'tension', label: 'Line tension', q: 'force', def: '', min: 0 }],
    build: function (b) {
      var u = unitOf(b.text('tension'));
      if (!/^(|[a-zA-Zµμ]*N)$/.test(u)) throw new Error('This governor is SI: its dial reads N, kN or MN.');
      return governedLine(b, sig4(b.si('tension')));
    },
    plate: function () { return ['Dial: 4 figures, SI', 'Trim ±0.2 % of setting', 'Line breaks at 30 kN']; },
    readouts: lineReadouts,
    draw: function (ctx, cam, built) { drawLine(ctx, cam, built, D.fmtNum(built.setting, 4).replace(/\s/g, '') + ' N'); }
  });

  // The US-made backup winch: tension in lb, or mass in slug times its own
  // gravimeter's g.
  Y.definePart({
    type: 'p01-backup', name: 'Backup winch (US)', category: 'Rigging', library: false, connector: true,
    blurb: 'The old US-made winch. Tension mode holds a pull dialled in pounds. Mass mode takes the load in slugs and multiplies by the g its own gravimeter measures.',
    size: { w: 0.1, h: 2 },
    dials: [
      { key: 'mode', label: 'Mode', choice: ['tension', 'mass'], def: 'tension', locked: true },
      { key: 'tension', label: 'Line pull', q: 'force', def: '', optional: true, min: 0 },
      { key: 'mass', label: 'Load mass', q: 'mass', def: '', optional: true, min: 0 }
    ],
    build: function (b) {
      var T;
      if (b.text('mode') === 'mass') {
        if (b.si('mass') == null) throw new Error('Mass mode: dial the load mass in slug.');
        if (unitOf(b.text('mass')) !== 'slug') throw new Error('This controller is US-made: it reads mass in slug only.');
        T = sig4(b.si('mass') / SLUG) * SLUG * b.site.g;
      } else {
        if (b.si('tension') == null) throw new Error('Tension mode: dial the line pull in lb.');
        if (unitOf(b.text('tension')) !== 'lb') throw new Error('This dial is US-made: it is printed in lb only.');
        T = sig4(b.si('tension') / LBF) * LBF;
      }
      var out = governedLine(b, T);
      out.mode = b.text('mode');
      out.gMeter = b.site.g;
      return out;
    },
    plate: function () { return ['Dial: 4 figures, lb / slug', 'Gravimeter: local g', 'Line breaks at 6 750 lb']; },
    readouts: function (built) {
      var list = lineReadouts(built);
      if (built.mode === 'mass') list.push({ key: 'g', label: 'gravimeter', q: 'accel', read: function () { return built.gMeter; } });
      return list;
    },
    draw: function (ctx, cam, built) {
      var txt = built.mode === 'mass' ? D.fmtNum(built.setting / built.gMeter / SLUG, 4) + ' slug' : D.fmtNum(built.setting / LBF, 4).replace(/\s/g, '') + ' lb';
      drawLine(ctx, cam, built, built.broken ? '' : txt);
    }
  });

  // A spare part in a crate, with the weight tag the player writes.
  Y.definePart({
    type: 'p01-spare', name: 'Spare part', category: 'Loads', library: false,
    blurb: 'A spare part crated for the depot. The tag on the side is its spec-sheet weight.',
    size: { w: 1, h: 1 },
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '1 kg', locked: true },
      { key: 'tag', label: 'Weight tag', q: 'force', def: '', optional: true },
      { key: 'w', label: 'Width', q: 'length', def: '1 m', locked: true },
      { key: 'h', label: 'Height', q: 'length', def: '1 m', locked: true }
    ],
    build: function (b) {
      var w = b.si('w'), h = b.si('h');
      var body = b.body({ position: b.at({ x: 0, y: 0 }), label: '', mass: b.si('mass'), shapes: [{ shape: b.P.box(w / 2, h / 2), material: 'cargo' }] });
      return { body: body, tag: b.si('tag'), w: w, h: h };
    },
    plate: function (inst) { return ['Mass ' + inst.dials.mass]; },
    draw: function (ctx, cam, built) {
      var c = built.body.c, s = cam.worldToScreen({ x: c.x, y: c.y + built.h / 2 + 0.35 });
      label(ctx, s, (built.inst.label || '') + ' · ' + built.inst.dials.mass);
      label(ctx, cam.worldToScreen({ x: c.x, y: c.y + built.h / 2 + 0.12 }), built.inst.dials.tag ? 'tag ' + built.inst.dials.tag : 'no tag yet', '#e6b422');
    }
  });

  // The depot checkweigher: a scale pad calibrated at standard g. At t = 2 s
  // it compares the force it measures with the crate's tag and kicks the
  // crate off the line if they disagree by more than 0.15 %.
  Y.definePart({
    type: 'p01-checkweigher', name: 'Depot checkweigher', category: 'Measure', library: false,
    blurb: 'A depot scale pad. It weighs the crate on it and kicks it off the line if the tag disagrees by more than 0.15 %.',
    size: { w: 2.4, h: 0.4 },
    build: function (b) {
      var P = b.P, world = b.world;
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: '', shapes: [{ shape: P.box(1.2, 0.2), material: 'steel' }] });
      var out = { body: body, verdict: null, reading: 0, kick: null };
      function load() {
        var F = 0, top = null, invH = world.substeps / (world.dt || 1 / 60);
        world.contacts.forEach(function (ct) {
          var sign = ct.fa.body === body ? 1 : ct.fb.body === body ? -1 : 0;
          if (!sign || !ct.normal) return;
          top = ct.fa.body === body ? ct.fb.body : ct.fa.body;
          ct.points.forEach(function (cp) { F += cp.normalImpulse * invH * Math.abs(ct.normal.y); });
        });
        return { F: F, top: top };
      }
      b.on('step', function () {
        if (out.kick) {
          if (world.time < out.kick.until) out.kick.body.applyForce({ x: 20 * out.kick.body.m, y: 0 }, out.kick.body.c);
          return;
        }
        if (out.verdict !== null || world.time < CHECK_T - 1e-9) { if (out.verdict === null) out.reading = load().F; return; }
        var r = load(); out.reading = r.F;
        var crate = r.top && r.top.userData && r.top.userData.part, bp = crate && b.out.parts[crate];
        if (!bp) { out.verdict = { ok: false, empty: true }; return; }
        if (bp.tag == null) { out.verdict = { ok: false, untagged: true }; out.kick = { body: r.top, until: world.time + 0.3 }; return; }
        var off = bp.tag / r.F - 1;
        out.verdict = { ok: Math.abs(off) <= 0.0015, off: off };
        if (!out.verdict.ok) out.kick = { body: r.top, until: world.time + 0.3 };
      });
      return out;
    },
    draw: function (ctx, cam, built) {
      var c = built.body.c, s = cam.worldToScreen({ x: c.x, y: c.y - 0.55 });
      var v = built.verdict;
      label(ctx, s, v && v.ok ? 'ACCEPTED' : v ? 'REJECTED' : 'checking at ' + CHECK_T + ' s', v && v.ok ? '#78be50' : v ? '#e0583a' : C.text);
    }
  });
})(globalThis.SE);
