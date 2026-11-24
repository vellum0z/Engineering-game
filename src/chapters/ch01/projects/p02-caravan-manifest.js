/*
 * P2 · Caravan Manifest (manual project, played in the build yard).
 *
 * A trade caravan from an old U.S. Army depot rolls up with a manifest in
 * U.S. Customary units. Every rating in Kettle Hollow is SI, and the
 * caravan's own wagon is rated in pounds. There are no answer boxes: each
 * figure on the manifest becomes a setting on a part (how many crates ride
 * the lowboy, how hard to shove a rail car, how deep to fill a tank, what
 * pressure to pump a bag to, how many blocks go on a wagon) and the
 * simulation runs the TRUE load.
 *
 * Course material: FPS <-> SI conversion with the Table 1-2 factors
 * (4.448 N/lb, 14.59 kg/slug, 0.3048 m/ft) plus 12 in/ft, 5280 ft/mi,
 * 1000 lb/kip, 2000 lb/ton; areas and volumes take the square and cube of
 * the length factor; W = mg.
 *
 * Beyond the book: precision. The axle and bag ratings are the load at
 * which the kit fails, so a figure rounded the wrong way (a density rounded
 * down, then used to size a fill) can tip a load over. The debrief notes
 * when the scale's 5 lb division and the 4-figure factor 4.448 matter.
 *
 * Parts used: core push (for the rail car) plus scenery defined at the
 * bottom of this file (type names start with p02-). All numbers are worked
 * out from the givens; the hand-checks sit next to each one.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard;
  if (!Y || !Y.definePart) return;
  var G = Y.goals;

  var LB = 4.448;          // N per lb  (Table 1-2)
  var SLUG = 14.59;        // kg per slug
  var FT = 0.3048;         // m per ft
  var IN = FT / 12;        // 0.0254 m
  var GRAV = 9.81;         // m/s^2, the yard's g

  /* ------------------------------------------------------------ the givens */

  // 1. Convoy over the Mill Creek truss (rated 180 kN live load).
  var WRECKER_TON = 8.75, LOWBOY_KIP = 14.2, CRATE_LB = 3880, CRATES = 3;
  var VEHICLES_N = (WRECKER_TON * 2000 + LOWBOY_KIP * 1000) * LB;
  // 8.75 ton = 17 500 lb, 14.2 kip = 14 200 lb, together 31 700 lb
  // 31 700 x 4.448 = 141 002 N
  var CRATE_N = CRATE_LB * LB;            // 3880 x 4.448 = 17 258 N
  var BRIDGE_RATING = 180e3;
  // all three crates: 141 002 + 3 x 17 258 = 192 776 N = 193 kN  > 180 kN: the span fails
  // two crates:       141 002 + 2 x 17 258 = 175 518 N = 176 kN  < 180 kN: it holds
  // the "ton = 1000 lb" slip: (8750 + 14 200 + 11 640) x 4.448 = 153.9 kN, so it looks like all three fit

  // 2. Coupling a caravan rail car. Weight plate 30 800 lb, couplers rated 4 mi/h.
  var CAR_LB = 30800, COUPLE_MPH = 4;
  var CAR_KG = CAR_LB * LB / GRAV;        // 30 800 x 4.448 = 136 998 N; / 9.81 = 13 965 kg
  var COUPLE_MS = COUPLE_MPH * 5280 * FT / 3600;
  // 4 x 5280 = 21 120 ft/h; x 0.3048 = 6437.4 m/h; / 3600 = 1.7882 m/s
  var COUPLER_BREAK = 1.15 * COUPLE_MS;   // 2.056 m/s: the knuckle shatters above this
  var COUPLER_LATCH = 0.5 * COUPLE_MS;    // 0.894 m/s: it won't latch below this
  // reference shove: v = F t / m, so F t = 13 965 x 1.788 = 24 972 N·s -> 12.5 kN for 2 s gives 1.790 m/s
  // weight used as mass (30 800 kg): F t = 55 070 N·s -> 27.5 kN for 2 s gives 3.94 m/s: shatters
  // mi/h taken as m/s: F t = 13 965 x 4 = 55 860 N·s: shatters

  // 3. Drilling mud into the settlement tanker. Mud 3.42 slug/ft^3; axle rated 3.00 t of cargo.
  var MUD_SLUG_FT3 = 3.42;
  var MUD_KG_M3 = MUD_SLUG_FT3 * SLUG / Math.pow(FT, 3);
  // 3.42 x 14.59 = 49.898 kg per ft^3; 0.3048^3 = 0.028 317 m^3; 49.898 / 0.028 317 = 1762.1 kg/m^3
  var TANK_AREA = 1.00, TANK_DEPTH = 2.40;   // m^2 floor (1.25 m x 0.80 m), m deep: holds 2.40 m^3
  var AXLE_KG = 3000;
  var FILL_MAX = AXLE_KG / (MUD_KG_M3 * TANK_AREA);
  // 3000 / 1762.1 = 1.7025 m of mud. 1.70 m puts 2995.6 kg on the axle and holds.
  // 3000 / 1760 (density rounded down to 1.76 Mg/m^3 first) = 1.7045 m -> 3003.6 kg: the axle goes
  // ft not cubed (164 kg/m^3) says 18 m, so the crew fills to the brim: 2.40 x 1762.1 = 4229 kg

  // 4. Air ride. Their sheet: 118 psi in their 8 in bag with the generator skid aboard.
  //    Our spare bag: 250 mm bore, bursts at 700 kPa (SI plate).
  var SHEET_PSI = 118, THEIR_BORE_IN = 8, OUR_BORE = 0.250, BAG_BURST = 700e3;
  var BAG_LOAD_N = SHEET_PSI * LB / (IN * IN) * Math.PI / 4 * Math.pow(THEIR_BORE_IN * IN, 2);
  // 118 psi x (pi/4)(8 in)^2 = 118 x 50.265 in^2 = 5931 lb on the bag; x 4.448 = 26 383 N
  var OUR_AREA = Math.PI / 4 * OUR_BORE * OUR_BORE;   // 0.785 40 x 0.0625 = 0.049 087 m^2
  var BAG_P = BAG_LOAD_N / OUR_AREA;
  // 26 383 / 0.049 087 = 537 480 Pa = 537 kPa (= 77.95 psi)
  // copying the sheet: 118 psi = 813.5 kPa > 700 kPa: the bag bursts
  var RIDE = 0.300, RIDE_TOL = 0.020;      // m: the bag's design height, and the band the deck must ride in
  // the bag is a gas spring F = pA (h0/h)^1.3, so at rest h = h0 (pA/W)^(1/1.3);
  // h inside 0.28..0.32 m means pA/W inside 0.914..1.088: 491..585 kPa

  // 5. Counterweight blocks onto the caravan wagon (axle plate 3 500 lb).
  var BLOCK_D = 0.450, BLOCK_L = 1.15, BLOCK_RHO = 2400, WAGON_LB = 3500;
  var BLOCK_N = Math.PI / 4 * BLOCK_D * BLOCK_D * BLOCK_L * BLOCK_RHO * GRAV;
  // V = 0.785 40 x 0.2025 x 1.15 = 0.182 90 m^3; m = 438.96 kg; W = 4306.2 N; / 4.448 = 968.1 lb
  var WAGON_N = WAGON_LB * LB;            // 15 568 N
  // 3 blocks = 2904 lb (83 %): holds. 4 blocks = 3872 lb: the axle snaps.
  // the block's mass in kg read as pounds (439 "lb") says 7 fit

  /* ------------------------------------------------------------ helpers */

  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  function kN(n) { return f3(n / 1000) + ' kN'; }
  function between(a, lo, hi) { return a >= lo && a <= hi; }

  // A vehicle that drives itself to a stop line at a crawl. The drive is a
  // force on the body, capped like a real engine; the load does the rest.
  function driver(b, body, o) {
    var stopped = false;
    function push() {
      if (body.type !== 'dynamic') return;
      if (body.c.x >= o.stopX) stopped = true;
      var F = Math.max(-o.maxForce, Math.min(o.maxForce, o.gain * ((stopped ? 0 : o.speed) - body.v.x)));
      body.applyForce({ x: F, y: 0 }, body.c);
    }
    push();
    b.on('step', push);
    return { stopped: function () { return stopped; } };
  }

  // One count dial (a whole number of crates or blocks).
  function countOf(b, key, max) {
    var n = b.si(key);
    if (Math.round(n) !== n || n < 0) throw new Error('Type a whole number of ' + key + ', 0 to ' + max + '.');
    return n;
  }

  /* ------------------------------------------------------------ the jobs' yards */

  var SITE = { g: GRAV, floor: 'concrete' };

  // Job 1. Near bank x < 0, the 14 m Mill Creek span, far bank x > 14. Bank tops at y = 3.
  var CROSSING = { parts: [
    { id: 'nearbank', type: 'block', x: -11, y: 1.5, dials: { width: '22 m', height: '3 m' }, locked: true, label: 'near bank' },
    { id: 'farbank', type: 'block', x: 27, y: 1.5, dials: { width: '26 m', height: '3 m' }, locked: true, label: 'far bank' },
    { id: 'bridge', type: 'p02-bridge', x: 7, y: 2.8, locked: true, label: 'Mill Creek truss' },
    { id: 'convoy', type: 'p02-convoy', x: -6, y: 3, dials: { crates: '3' }, locked: true, open: ['crates'], label: 'caravan convoy' },
    { id: 'yard', type: 'zone', x: 27, y: 4.5, dials: { width: '20 m', height: '3 m' }, locked: true, label: 'trading yard' }
  ] };
  var CROSSING_CAM = { fit: { lo: { x: -17, y: -1 }, hi: { x: 34, y: 6 } } };

  // Job 2. A rail spur on the yard floor. The caravan car at x = 2, the standing cars' coupler at x = 24.
  var SPUR = { parts: [
    { id: 'car', type: 'p02-railcar', x: 2, y: 0.7, locked: true, label: 'caravan car' },
    { id: 'standing', type: 'p02-standing', x: 27, y: 0.9, locked: true, label: 'standing cars' }
  ] };
  var SPUR_CAM = { fit: { lo: { x: -3, y: -1 }, hi: { x: 33, y: 5 } } };

  var PAD = { parts: [
    { id: 'tanker', type: 'p02-tanker', x: 4, y: 0, dials: { fill: '2.4 m' }, locked: true, open: ['fill'], label: 'settlement tanker' }
  ] };
  var PAD_CAM = { fit: { lo: { x: -2, y: -1 }, hi: { x: 10, y: 5 } } };

  var BAY = { parts: [
    { id: 'flatbed', type: 'p02-flatbed', x: 4, y: 0, dials: { pressure: '118 psi' }, locked: true, open: ['pressure'], label: 'caravan flatbed' }
  ] };
  var BAY_CAM = { fit: { lo: { x: -1, y: -1 }, hi: { x: 9, y: 4 } } };

  var DOCK = { parts: [
    { id: 'wagon', type: 'p02-wagon', x: 4, y: 0, dials: { blocks: '6' }, locked: true, open: ['blocks'], label: 'caravan wagon' }
  ] };
  var DOCK_CAM = { fit: { lo: { x: -1, y: -1 }, hi: { x: 9, y: 5 } } };

  /* ------------------------------------------------------------ goals */

  function broke(s, part) { return s.breaks.filter(function (x) { return x.part === part; })[0]; }

  var convoyGoal = G.all(
    G.never(function (s) {
      if (!broke(s, 'bridge')) return null;
      var p = s.part('convoy'), on = p ? VEHICLES_N + p.crates.length * CRATE_N : 0;
      return 'The Mill Creek truss gave way under ' + kN(on) + ' of convoy. Its plate says 180 kN.';
    }),
    G.never(function (s) {
      var p = s.part('convoy'), lost = p && p.crates.filter(function (c) { return c.c.y < 2.5; }).length;
      return lost ? 'A crate came off and went into the creek.' : null;
    }),
    function (s) {
      var p = s.part('convoy'); if (!p) return { fail: 'The convoy is missing.' };
      var b = s.body('convoy'), here = SE.yard.inBox(b.c, { x0: 17, x1: 38, y0: 3 });
      if (!s.held('parked', here && s.speed('convoy') < 0.05, 1)) return null;
      return p.crates.length ? 'pass' : { fail: 'The convoy crossed empty. The caravan came to trade, so take at least one crate.' };
    }
  );

  var coupleGoal = function (s) {
    var hit = s.impacts.filter(function (i) { return (i.a === 'car' && i.b === 'standing') || (i.a === 'standing' && i.b === 'car'); })[0];
    if (!hit) {
      var p = s.pos('car');
      if (p && p.x < -1) return { fail: 'The car rolled the wrong way, off the end of the spur.' };
      return null;
    }
    s.memo.couple = hit.speed;
    if (hit.speed > COUPLER_BREAK) return { fail: 'The car hit the standing cars at ' + f3(hit.speed) + ' m/s and the knuckle shattered.' };
    if (hit.speed < COUPLER_LATCH) return { fail: 'The car touched at ' + f3(hit.speed) + ' m/s and bounced off. The knuckle never latched.' };
    return 'pass';
  };

  var tankGoal = G.all(
    G.never(function (s) { var b = broke(s, 'tanker'); return b ? 'The axle snapped under ' + f3(s.part('tanker').cargo) + ' kg of mud. Its plate says 3.00 t.' : null; }),
    function (s) {
      var p = s.part('tanker'); if (!p) return { fail: 'The tanker is missing.' };
      if (p.cargo < 0.5 * AXLE_KG) return s.t > 1 ? { fail: 'Only ' + f3(p.cargo) + ' kg of mud aboard, under half a load. That trip isn\'t worth the diesel.' } : null;
      return s.t >= 3 ? 'pass' : null;
    }
  );

  var bagGoal = G.all(
    G.never(function (s) { return broke(s, 'flatbed') ? 'The bag burst. Its plate says 700 kPa.' : null; }),
    function (s) {
      var p = s.part('flatbed'); if (!p) return { fail: 'The flatbed is missing.' };
      var h = p.height(), level = Math.abs(h - RIDE) <= RIDE_TOL && Math.abs(p.deck.v.y) < 0.01;
      if (s.held('level', level, 1)) return 'pass';
      if (s.t > 6) {
        var mm = f3(h * 1000) + ' mm';
        return { fail: (h < 0.19 ? 'The deck sank onto the bump stops at ' + mm + '.' : h > 0.41 ? 'The deck rode up to ' + mm + ', hard against the check straps.' : h < RIDE ? 'The deck sags at ' + mm + '.' : 'The deck rides high at ' + mm + '.') + ' It needs 300 mm, give or take 20.' };
      }
      return null;
    }
  );

  var wagonGoal = G.all(
    G.never(function (s) { return broke(s, 'wagon') ? 'The wagon axle snapped. Its plate says 3 500 lb.' : null; }),
    function (s) {
      var p = s.part('wagon'); if (!p) return { fail: 'The wagon is missing.' };
      if (!p.blocks.length) return { fail: 'Nothing loaded. The caravan paid for counterweights.' };
      return s.t >= 3 ? 'pass' : null;
    }
  );

  /* -------------------------------------------------------------- project */

  SE.content.registerProject('ch01', {
    id: 'P2', order: 2, title: 'Caravan Manifest', subtitle: 'An FPS manifest in an SI town',
    brief: [
      'A trade caravan has come down from the old Army depot at Fort Calder: a wrecker towing a lowboy, a string of rail cars on the spur, a flatbed and a wagon. They want concrete and diesel. We want their generator, their drilling mud and their steel.',
      'Their manifest is in **pounds, feet, tons and miles**. Everything in Kettle Hollow, from the bridges to the tanker axles, is rated in **SI**. Their own wagon is rated in pounds.',
      'Five jobs. In each one a figure off the manifest becomes a setting: how many crates ride over the bridge, how hard to shove a rail car, how deep to fill a tank, what to pump a bag to, how many blocks go on a wagon. Then the real load shows up and the simulation decides. Get it wrong one way and something breaks. Get it wrong the other way and we burn fuel on extra trips.',
      'The unit converter is in the shop. Do the conversions by hand.'
    ].join('\n\n'),
    conditions: [
      'Table 1–2 factors: 1 lb = 4.448 N, 1 slug = 14.59 kg, 1 ft = 0.3048 m. Also 12 in = 1 ft, 5280 ft = 1 mi, 1 kip = 1000 lb, 1 **ton = 2000 lb** (the U.S. short ton, not the metric tonne).',
      'g = 9.81 m/s² (32.2 ft/s²). Every rating plate is the load at which the kit fails: there is no hidden margin.',
      'The depot platform scale reads to the nearest **5 lb**.',
      'The rail-car couplers are old knuckle couplers: they shatter at about 15% over their rated speed and won\'t latch below about half of it.'
    ],
    lockedTools: ['converter'],
    yard: { site: SITE, camera: CROSSING_CAM, design: CROSSING },
    solutions: {
      'P2.convoy': [
        { set: { convoy: { crates: '2' } } },
        { pass: false, set: { convoy: { crates: '3' } } }     // 193 kN on a 180 kN span
      ],
      'P2.couple': [
        { add: [{ type: 'push', a: { part: 'car' }, dials: { force: '12.5 kN', angle: '0 deg', time: '2 s' } }] },
        { pass: false, add: [{ type: 'push', a: { part: 'car' }, dials: { force: '27.5 kN', angle: '0 deg', time: '2 s' } }] },   // 30 800 lb used as kg
        { pass: false, add: [{ type: 'push', a: { part: 'car' }, dials: { force: '5 kN', angle: '0 deg', time: '2 s' } }] }        // too gentle to latch
      ],
      'P2.mud': [
        { set: { tanker: { fill: '1.70 m' } } },
        { pass: false, set: { tanker: { fill: '1.705 m' } } },  // density rounded to 1.76 Mg/m^3 before dividing
        { pass: false, set: { tanker: { fill: '0.8 m' } } }     // 1410 kg: under half a load
      ],
      'P2.air': [
        { set: { flatbed: { pressure: '537 kPa' } } },
        { set: { flatbed: { pressure: '78 psi' } } },
        { pass: false, set: { flatbed: { pressure: '118 psi' } } },   // copied off their sheet: 814 kPa, bursts
        { pass: false, set: { flatbed: { pressure: '400 kPa' } } }    // bag too soft: on the bump stops
      ],
      'P2.blocks': [
        { set: { wagon: { blocks: '3' } } },
        { pass: false, set: { wagon: { blocks: '4' } } }
      ]
    },
    jobs: [
      {
        id: 'P2.convoy', design: CROSSING, yard: { camera: CROSSING_CAM },
        label: '**Bridge crossing.** The wrecker weighs **8.75 ton** and the empty lowboy **14.2 kip** (manifest). Each cargo crate weighed **3 880 lb** on the depot scale. The Mill Creek truss is rated **180 kN**. Set how many of the three crates ride across on this trip; the rest wait on the bank for a second run.',
        goal: convoyGoal, timeout: 45,
        hints: [
          'Three different units for one total. Put everything in pounds first, then convert once.',
          'A ton is 2000 lb and a kip is 1000 lb. Add the wrecker and the lowboy, then add crates one at a time and convert each total with 4.448 N/lb.',
          'Wrecker and lowboy: 17 500 + 14 200 = 31 700 lb = 141.0 kN. Each crate adds 3 880 × 4.448 = 17.26 kN. How many fit under 180 kN?'
        ],
        margin: function (s) { var p = s.part('convoy'); return p ? (2 - Math.min(2, p.crates.length)) * 15 : 0; },
        onFail: function (ctx) {
          var p = ctx.result.state.part('convoy');
          return p && p.crates.length === 3 ? 'If you read **ton** as 1000 lb, the whole convoy comes to 154 kN and looks like it fits. The U.S. ton is 2000 lb; the kip is the one that is 1000 lb.' : 'Total the wrecker, the lowboy and the crates in newtons and compare with the plate.';
        },
        success: function (ctx) {
          var p = ctx.result.state.part('convoy');
          return p.crates.length === 2 ? 'Across with two crates and the deck barely moving: about 176 kN on a 180 kN span. One more run for the last crate.' : 'Across, but with only one crate the wrecker has to go back twice. Two would have fitted.';
        }
      },
      {
        id: 'P2.couple', design: SPUR, yard: { camera: SPUR_CAM },
        label: '**Coupling the rail car.** The caravan car\'s weight plate says **30 800 lb**. Its couplers are rated for **4 mi/h**. It rolls on greased bearings. Give it one shove (a **Push** from the library) so it rolls into the standing cars at the rated speed.',
        goal: coupleGoal, timeout: 40,
        hints: [
          'Two conversions: the plate is a weight, and the speed is in miles per hour. You need the car\'s mass and a speed in m/s (or do the whole job in slugs and ft/s).',
          'm = W / g. The speed is 4 mi/h × (5280 ft/mi) × (0.3048 m/ft) ÷ (3600 s/h). A push of F for t gives v = F t / m.',
          '30 800 lb × 4.448 = 137.0 kN, so m = 137 000 / 9.81 = 13 965 kg. 4 mi/h = 1.788 m/s. F t = 13 965 × 1.788 ≈ 25 000 N·s.'
        ],
        margin: function (s) { var v = s.memo.couple; return v ? Math.round(Math.min(30, Math.abs(v - COUPLE_MS) / COUPLE_MS * 60)) : 0; },
        onFail: function (ctx) {
          var v = ctx.result.state.memo.couple;
          if (v > COUPLER_BREAK) return 'Way too hard. If you used **30 800 kg** as the mass, remember the plate is a weight in pounds: divide by g after converting to newtons.';
          if (v && v < COUPLER_LATCH) return 'Too gentle. The knuckle needs at least half the rated speed to latch.';
          return 'The car has to roll into the standing cars. One push, pointing right (0°), sized from v = F t / m.';
        },
        success: function (ctx) { return 'Clunk. The knuckle closed at **' + f3(ctx.result.state.memo.couple) + ' m/s**; the rating is 1.79 m/s.'; }
      },
      {
        id: 'P2.mud', design: PAD, yard: { camera: PAD_CAM },
        label: '**Drilling mud.** The manifest gives the mud\'s density as **3.42 slug/ft³**. Our tanker has a **1.00 m²** floor and its axle is rated **3.00 t** of cargo. Set the fill depth so it carries as much as it safely can.',
        goal: tankGoal, timeout: 6,
        hints: [
          'Get the density into kg/m³. Then the depth that puts 3000 kg in a 1.00 m² tank follows.',
          'Multiply by (14.59 kg / 1 slug) and by (1 ft / 0.3048 m)³. The length factor is cubed because the unit is a volume. Depth = mass ÷ (density × floor area).',
          '3.42 × 14.59 = 49.90 kg per ft³, and 1 ft³ = 0.028 32 m³, so the mud is 1762 kg/m³. 3000 ÷ 1762 = 1.70 m. Stay just under it.'
        ],
        margin: function (s) { var p = s.part('tanker'); return p ? Math.round(Math.max(0, (0.97 - p.cargo / AXLE_KG) * 100)) : 0; },
        onFail: function (ctx) {
          var p = ctx.result.state.part('tanker');
          if (p && p.cargo > AXLE_KG && p.cargo < 1.01 * AXLE_KG) return 'Over by a hair. A plate rating is where it fails, so a figure rounded the wrong way (a density rounded **down** before you divide) is enough to tip it.';
          if (p && p.cargo > AXLE_KG) return 'Way over. Check that the length factor is **cubed**: a cubic foot is 0.0283 m³, not 0.3048.';
          return 'The axle load gauge shows what each centimetre of mud weighs, if you want to check your density.';
        },
        success: function (ctx) { return 'Filled and holding: **' + f3(ctx.result.state.part('tanker').cargo) + ' kg** of mud on a 3000 kg axle.'; }
      },
      {
        id: 'P2.air', design: BAY, yard: { camera: BAY_CAM },
        label: '**Air ride.** The caravan\'s sheet says their flatbed rides level with the generator skid aboard at **118 psi** in their **8 in** air bag. Their bag is ruined; ours has a **250 mm** bore and bursts at **700 kPa**. Set the pressure so the deck rides at 300 mm.',
        goal: bagGoal, timeout: 10,
        hints: [
          'The bag carries the same load either way. Work out that load from their pressure and their bag\'s area, then share it over ours.',
          'Load = p × (π/4) d². Get the 8 in bore into metres (1 in = 0.0254 m) and the psi into Pa (4.448 N over 0.0254² m²), or work the ratio of the two areas.',
          'Their bag: 118 psi × 50.27 in² = 5 931 lb = 26.4 kN. Our bag\'s area is (π/4)(0.250)² = 0.0491 m². 26 400 ÷ 0.0491 ≈ 537 kPa.'
        ],
        margin: function (s) { var p = s.part('flatbed'); return p ? Math.round(Math.min(20, Math.abs(p.height() - RIDE) * 1000)) : 0; },
        onFail: function (ctx) {
          var p = ctx.result.state.part('flatbed');
          return p && p.set > BAG_BURST ? 'Copying **118 psi** is 814 kPa, and our bag is bigger as well as weaker: it needs less pressure, not the same.' : 'Same load, different area. Work out the force their bag carries, then the pressure that gives that force on 250 mm.';
        },
        success: function (ctx) { return 'Level. The deck sits at **' + f3(ctx.result.state.part('flatbed').height() * 1000) + ' mm** on ' + f3(ctx.result.state.part('flatbed').pressure() / 1000) + ' kPa.'; }
      },
      {
        id: 'P2.blocks', design: DOCK, yard: { camera: DOCK_CAM },
        label: '**Counterweight sale.** The caravan is buying our concrete counterweights: cylinders **450 mm** across and **1.15 m** long, concrete at **2.40 Mg/m³**. Their wagon\'s axle plate says **3 500 lb**. They\'d like six. Set how many go on.',
        goal: wagonGoal, timeout: 5,
        hints: [
          'Volume, then mass, then weight, then pounds. Stay in SI until the last step.',
          'V = (π/4) d² L in m³. m = ρV with 2.40 Mg/m³ = 2400 kg/m³. W = mg in newtons, then multiply by (1 lb / 4.448 N).',
          'V = 0.7854 × 0.450² × 1.15 = 0.1829 m³, so m = 439.0 kg and W = 4306 N = 968 lb each. How many fit under 3 500 lb?'
        ],
        margin: function (s) { var p = s.part('wagon'); return p ? (3 - Math.min(3, p.blocks.length)) * 12 : 0; },
        onFail: function (ctx) {
          var p = ctx.result.state.part('wagon');
          return p && p.blocks.length >= 4 ? 'If you got **439 lb** a block, that is the mass in kilograms with a pound label on it. A pound is a force: find W = mg first.' : 'Work out one block\'s weight in pounds, then how many fit under the plate.';
        },
        success: 'Three blocks, 2 904 lb on a 3 500 lb axle. The caravan grumbles, then pays for three.'
      }
    ],
    deeper: [
      '**The scale\'s 5 lb division.** Each crate is 3 880 lb give or take 2.5 lb, so the convoy total is known to about ±8 lb in 43 340 lb. That is under 0.02%, nowhere near enough to move it across the 180 kN line: three significant figures are fully justified there.',
      '**Rounding the wrong way.** The tanker axle fails at exactly 3.00 t. 1762 kg/m³ gives a fill of 1.7025 m; round the density to 1.76 Mg/m³ first and you get 1.7045 m, 3.6 kg over. When a number sizes something against a limit, round it toward the safe side, or keep a margin.',
      '**The fourth digit of 4.448.** The exact factor is 4.448 222 N/lb. Using 4.448 shifts every pound conversion here by 0.005%, far below what three figures can show, and far inside every window in these jobs.'
    ],
    debrief: 'The convoy crossed, the rail car is coupled, the mud is aboard, the flatbed rides level and the caravan has its counterweights. Juno signs the trade sheet.\n\nEvery job was the same move: multiply by factors equal to one, set so the old units cancel. The difference here is that each number went straight into a machine. Nobody checked your arithmetic; the bridge, the coupler, the axle and the bag did.'
  });

  /* ------------------------------------------------------------ scenery parts (job-only, not in the library) */

  // The Mill Creek span: a concrete deck held on one rated bearing at its centre.
  // The bearing carries the deck's own weight plus whatever is on it, and fails
  // above the rated live load.
  Y.definePart({
    type: 'p02-bridge', name: 'Bridge span', category: 'Site', library: false,
    blurb: 'A 14 m deck on its bearing. The plate is the live load it fails at.',
    size: { w: 14, h: 0.4 },
    dials: [{ key: 'rating', label: 'Rated live load', q: 'force', def: '180 kN', min: 1 }],
    build: function (b) {
      var L = 13.96, mDeck = 3000, dead = mDeck * b.site.g, c = b.at({ x: 0, y: 0 });
      var deck = b.body({ position: c, label: b.inst.label || 'bridge', mass: mDeck,
        shapes: [{ shape: b.P.box(L / 2, 0.2), material: 'concrete' }] });
      var bearing = b.joint(new b.P.WeldJoint({ bodyA: b.ground, bodyB: deck, worldAnchor: c, breakForce: b.si('rating') + dead, label: 'bearing' }));
      var built = { body: deck, bearing: bearing, dead: dead, live: function () { return bearing.broken ? 0 : Math.max(0, bearing.force() - dead); } };
      return built;
    },
    plate: function (inst) { return ['Mill Creek truss', 'Rated live load ' + (inst.dials.rating || '180 kN')]; },
    readouts: function (built) { return [{ key: 'load', label: 'live load', q: 'force', read: function () { return built.live(); } }]; },
    draw: function (ctx, cam, built) {
      // a Warren truss under the deck, for looks
      var d = built.body; if (!d) return;
      ctx.save(); ctx.strokeStyle = built.bearing.broken ? 'rgba(200,90,70,.8)' : 'rgba(170,170,160,.85)'; ctx.lineWidth = 2;
      var n = 7, L = 13.96;
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var top = d.worldPoint({ x: -L / 2 + i * L / n, y: -0.2 }), bot = d.worldPoint({ x: -L / 2 + (i + 0.5) * L / n, y: -1.4 });
        var a = cam.worldToScreen(top), z = cam.worldToScreen(bot);
        ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y);
        if (i < n) { var nx = cam.worldToScreen(d.worldPoint({ x: -L / 2 + (i + 1) * L / n, y: -0.2 })); ctx.lineTo(nx.x, nx.y); }
      }
      ctx.stroke(); ctx.restore();
    }
  });

  // The caravan convoy: wrecker and lowboy as one rig, with 0-3 crates on the
  // lowboy. Crates that stay behind wait on the near bank.
  Y.definePart({
    type: 'p02-convoy', name: 'Convoy', category: 'Loads', library: false,
    blurb: 'The wrecker towing the lowboy. It drives itself to the trading yard at a crawl.',
    size: { w: 9, h: 2.2 },
    dials: [{ key: 'crates', label: 'Crates on this trip', q: 'number', def: '3', min: 0, max: CRATES }],
    build: function (b) {
      var n = countOf(b, 'crates', CRATES);
      var body = b.body({ position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'convoy', mass: VEHICLES_N / b.site.g, shapes: [
        { shape: b.P.box(4.5, 0.3, { x: 0, y: 0.3 }, 0, 0.15), material: 'frictionless' },   // chassis on its wheels
        { shape: b.P.box(2.75, 0.1, { x: -1.75, y: 0.7 }), material: 'timber' },             // lowboy bed, top at 0.8 m
        { shape: b.P.box(1.75, 0.8, { x: 2.75, y: 1.4 }, 0, 0.1), material: 'steel' }        // wrecker cab
      ] });
      var crates = [], left = [];
      for (var i = 0; i < CRATES; i++) {
        var aboard = i < n;
        var at = aboard ? b.at({ x: -3.8 + 1.5 * i, y: 1.41 }) : { x: b.inst.x - 7 - 1.5 * (i - n), y: b.inst.y + 0.61 };
        var c = b.body({ position: at, label: '', mass: CRATE_N / b.site.g, type: aboard ? 'dynamic' : 'static',
          shapes: [{ shape: b.P.box(0.6, 0.6), material: 'cargo' }] });
        (aboard ? crates : left).push(c);
      }
      driver(b, body, { speed: 1.2, stopX: 22, maxForce: 25e3, gain: 40e3 });
      return { body: body, bodies: [body].concat(crates, left), crates: crates };
    },
    plate: function () { return ['Wrecker ' + WRECKER_TON + ' ton', 'Lowboy (empty) ' + LOWBOY_KIP + ' kip', 'Crates ' + SE.yard.dial.fmtNum(CRATE_LB, 4) + ' lb each (depot scale)']; },
    readouts: function (built) { return [{ key: 'speed', label: 'speed', q: 'speed', read: function () { return built.body.v.x; } }]; }
  });

  // A caravan rail car on greased bearings. Its plate gives its weight in lb.
  Y.definePart({
    type: 'p02-railcar', name: 'Rail car', category: 'Loads', library: false,
    blurb: 'A caravan rail car on greased bearings. Its weight is stamped on the side in pounds.',
    size: { w: 4, h: 1.4 },
    build: function (b) {
      var body = b.body({ position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'rail car', mass: CAR_LB * LB / b.site.g,
        shapes: [{ shape: b.P.box(2, 0.7, null, 0, 0.1), material: 'frictionless', restitution: 0.3 }] });
      return { body: body };
    },
    plate: function () { return ['Weight ' + SE.yard.dial.fmtNum(CAR_LB, 3) + ' lb', 'Couplers: ' + COUPLE_MPH + ' mi/h max']; },
    readouts: function (built) { return [{ key: 'speed', label: 'speed', q: 'speed', read: function () { return built.body.v.x; } }]; }
  });

  // The standing cars, braked, with their knuckle coupler facing the spur.
  // A good hit latches the two together; a hard one shows a broken knuckle.
  Y.definePart({
    type: 'p02-standing', name: 'Standing cars', category: 'Site', library: false,
    blurb: 'Cars with their brakes on. The knuckle coupler faces the spur.',
    size: { w: 6, h: 1.8 },
    build: function (b) {
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'standing cars',
        shapes: [{ shape: b.P.box(3, 0.9, null, 0, 0.1), material: 'steel', restitution: 0.3 }] });
      var built = { body: body, state: 'open' };
      b.on('impact', function (e) {
        if (built.state !== 'open') return;
        var other = e.a === body ? e.b : e.b === body ? e.a : null;
        if (!other || !other.userData || other.userData.part !== 'car') return;
        if (e.speed > COUPLER_BREAK) built.state = 'shattered';
        else if (e.speed >= COUPLER_LATCH) {
          built.state = 'latched';
          b.world.addJoint(new b.P.WeldJoint({ bodyA: body, bodyB: other, worldAnchor: { x: body.c.x - 3, y: body.c.y } }));
        } else built.state = 'bounced';
      });
      return built;
    },
    plate: function () { return ['Knuckle coupler', 'Latches from 0.9 m/s', 'Shatters over 2.06 m/s']; },
    draw: function (ctx, cam, built) {
      var p = cam.worldToScreen({ x: built.body.c.x - 3.1, y: built.body.c.y + 1.3 });
      var txt = { open: 'knuckle open', latched: 'coupled', shattered: 'knuckle shattered', bounced: 'did not latch' }[built.state];
      ctx.save(); ctx.font = '12px "IBM Plex Mono", monospace'; ctx.textAlign = 'right';
      ctx.fillStyle = built.state === 'latched' ? '#9bd77a' : built.state === 'open' ? '#c9c4b8' : '#ff8a6a';
      ctx.fillText(txt, p.x, p.y); ctx.restore();
    }
  });

  // The settlement tanker: a tank on a rated axle stand. Fill depth in any length unit.
  Y.definePart({
    type: 'p02-tanker', name: 'Tanker', category: 'Loads', library: false,
    blurb: 'A 1.00 m² tank on one axle. Set how deep the crew fills it.',
    size: { w: 1.6, h: 3 },
    dials: [{ key: 'fill', label: 'Fill depth', q: 'length', def: '2.4 m', min: 0, max: TANK_DEPTH }],
    build: function (b) {
      var h = b.si('fill'), cargo = MUD_KG_M3 * TANK_AREA * h, tare = 900, g = b.site.g;
      var c = b.at({ x: 0, y: 1.9 });
      var tank = b.body({ position: c, label: b.inst.label || 'tanker', mass: tare + cargo,
        shapes: [{ shape: b.P.box(0.7, 1.25, null, 0, 0.05), material: 'steel' }] });
      var axle = b.joint(new b.P.WeldJoint({ bodyA: b.ground, bodyB: tank, worldAnchor: { x: c.x, y: c.y - 1.25 }, breakForce: (tare + AXLE_KG) * g, label: 'axle' }));
      b.body({ type: 'static', position: b.at({ x: 0, y: 0.3 }), label: 'axle', shapes: [{ shape: b.P.box(0.15, 0.3), material: 'steel', sensor: true }] });
      return { body: tank, axle: axle, cargo: cargo, fill: h, tare: tare,
        load: function () { return axle.broken ? 0 : Math.max(0, axle.force() - tare * g); } };
    },
    plate: function () { return ['Tank floor 1.00 m² · 2.40 m deep', 'Axle rated 3.00 t of cargo']; },
    readouts: function (built) { return [{ key: 'load', label: 'axle load', q: 'force', read: function () { return built.load(); } }]; },
    draw: function (ctx, cam, built) {
      var t = built.body, fill = built.fill / TANK_DEPTH;
      var a = cam.worldToScreen(t.worldPoint({ x: -0.62, y: -1.17 + 2.34 * fill })), z = cam.worldToScreen(t.worldPoint({ x: 0.62, y: -1.17 }));
      ctx.save(); ctx.fillStyle = 'rgba(120,86,52,.85)'; ctx.fillRect(a.x, a.y, z.x - a.x, z.y - a.y); ctx.restore();
    }
  });

  // The caravan flatbed on one of our air bags. The bag is a gas spring:
  // F = p A (h0 / h)^1.3, with a shock absorber, bump stops and check straps.
  Y.definePart({
    type: 'p02-flatbed', name: 'Flatbed on an air bag', category: 'Loads', library: false,
    blurb: 'The flatbed with the generator skid aboard, sitting on our spare air bag. Set the bag pressure.',
    size: { w: 4, h: 1.2 },
    dials: [{ key: 'pressure', label: 'Bag pressure', q: 'pressure', def: '118 psi', min: 0, max: 5e6 }],
    build: function (b) {
      var g = b.site.g, m = BAG_LOAD_N / g, pSet = b.si('pressure'), A = OUR_AREA;
      var base = b.at({ x: 0, y: 0.25 });   // top of the chassis rail the bag sits on
      b.body({ type: 'static', position: { x: base.x, y: base.y - 0.125 }, label: 'chassis',
        shapes: [{ shape: b.P.box(2.2, 0.125), material: 'steel' }, { shape: b.P.box(0.15, 0.09, { x: -1.6, y: 0.215 }), material: 'rubber' }, { shape: b.P.box(0.15, 0.09, { x: 1.6, y: 0.215 }), material: 'rubber' }] });
      // deck bottom at base + h; starts at the design height
      var deck = b.body({ position: { x: base.x, y: base.y + RIDE + 0.3 }, label: b.inst.label || 'flatbed', mass: m, fixedRotation: true,
        shapes: [{ shape: b.P.box(2, 0.1, { x: 0, y: -0.2 }), material: 'steel' }, { shape: b.P.box(1, 0.2, { x: 0, y: 0.1 }), material: 'steel' }] });
      var strap = b.joint(new b.P.DistanceJoint({ bodyA: b.ground, bodyB: deck, localAnchorA: b.ground.localPoint({ x: base.x, y: base.y }), localAnchorB: { x: 0, y: -0.3 }, rope: true, length: 0.42, label: 'check strap' }));
      var built = { body: deck, deck: deck, strap: strap, set: pSet, burst: false };
      built.height = function () { return deck.c.y - 0.3 - base.y; };
      built.pressure = function () { return built.burst ? 0 : pSet * Math.pow(RIDE / Math.max(0.05, built.height()), 1.3); };
      // a fake joint so the burst shows up in s.breaks like any other failure
      var bag = { broken: false, userData: { part: b.inst.id }, label: 'air bag',
        anchorA: function () { return { x: base.x, y: base.y + built.height() / 2 }; }, anchorB: function () { return bag.anchorA(); } };
      built.bag = bag;
      var c = 2 * 0.5 * Math.sqrt(1.3 * BAG_LOAD_N / RIDE * m);   // shock absorber at about half critical
      function act(e) {
        if (built.burst) return;
        var p = built.pressure();
        if (e && p > BAG_BURST) {
          built.burst = true; bag.broken = true;
          b.world.emit('break', { joint: bag, force: p * A, reason: 'burst' });
          return;
        }
        deck.applyForce({ x: 0, y: p * A - c * deck.v.y }, deck.c);
      }
      act(); b.on('step', act);
      return built;
    },
    plate: function () { return ['Our spare bag: 250 mm bore', 'Bursts at 700 kPa', 'Ride height 300 mm']; },
    readouts: function (built) {
      return [
        { key: 'pressure', label: 'bag pressure', q: 'pressure', read: function () { return built.pressure(); } },
        { key: 'height', label: 'ride height', q: 'length', read: function () { return built.height(); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var d = built.deck, top = cam.worldToScreen({ x: d.c.x, y: d.c.y - 0.3 }), bot = cam.worldToScreen({ x: d.c.x, y: d.c.y - 0.3 - built.height() });
      var w = 0.25 * cam.zoom;
      ctx.save(); ctx.fillStyle = built.burst ? 'rgba(60,60,60,.9)' : 'rgba(40,40,46,.95)'; ctx.strokeStyle = '#6b6b75';
      ctx.fillRect(top.x - w / 2, top.y, w, bot.y - top.y); ctx.strokeRect(top.x - w / 2, top.y, w, bot.y - top.y);
      ctx.restore();
    }
  });

  // The caravan wagon on its pound-rated axle stand, with 0-6 counterweight blocks.
  Y.definePart({
    type: 'p02-wagon', name: 'Wagon', category: 'Loads', library: false,
    blurb: 'The caravan wagon on its axle. Set how many counterweight blocks go on.',
    size: { w: 4.2, h: 1 },
    dials: [{ key: 'blocks', label: 'Blocks loaded', q: 'number', def: '6', min: 0, max: 6 }],
    build: function (b) {
      var n = countOf(b, 'blocks', 6), g = b.site.g, tare = 400, c = b.at({ x: 0, y: 0.75 });
      var bed = b.body({ position: c, label: b.inst.label || 'wagon', mass: tare, shapes: [{ shape: b.P.box(2.1, 0.1), material: 'timber' }] });
      var axle = b.joint(new b.P.WeldJoint({ bodyA: b.ground, bodyB: bed, worldAnchor: { x: c.x, y: c.y - 0.1 }, breakForce: tare * g + WAGON_N, label: 'axle' }));
      b.body({ type: 'static', position: b.at({ x: 0, y: 0.32 }), label: 'axle', shapes: [{ shape: b.P.circle(0.3), material: 'steel', sensor: true }] });
      var blocks = [], mB = BLOCK_N / g;
      for (var i = 0; i < n; i++) {
        var row = Math.floor(i / 3), col = i % 3;
        blocks.push(b.body({ position: { x: c.x - 1.25 + 1.25 * col, y: c.y + 0.1 + 0.226 + 0.452 * row }, label: '', mass: mB,
          shapes: [{ shape: b.P.box(0.575, 0.225), material: 'concrete' }] }));
      }
      return { body: bed, bodies: [bed].concat(blocks), axle: axle, blocks: blocks, tare: tare,
        load: function () { return axle.broken ? 0 : Math.max(0, axle.force() - tare * g); } };
    },
    plate: function () { return ['Axle rated 3 500 lb', 'Blocks: 450 mm dia × 1.15 m, concrete 2.40 Mg/m³']; },
    readouts: function (built) { return [{ key: 'load', label: 'axle load', q: 'force', read: function () { return built.load(); } }]; }
  });
})(globalThis.SE);
