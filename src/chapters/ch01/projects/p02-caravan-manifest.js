/*
 * P2 · Caravan Manifest (manual project).
 *
 * A trade caravan from an old U.S. Army depot rolls up with a manifest in
 * U.S. Customary units. Every rating in Kettle Hollow is SI, and the caravan's
 * own trailers are rated in pounds. The player converts each figure by hand
 * (the unit converter is locked) and the crew picks equipment from that
 * number, then the TRUE load arrives.
 *
 * Course material: FPS <-> SI conversion with the Table 1-2 factors
 * (4.448 N/lb, 14.59 kg/slug, 0.3048 m/ft) plus 12 in/ft, 5280 ft/mi,
 * 1000 lb/kip, 2000 lb/ton; areas and volumes take the square and cube of
 * the length factor; W = mg; answers to three significant figures.
 *
 * Beyond the book: measurement precision. The depot tape reads to the
 * nearest 1/8 in, so a thickness taped as 3/8 in can really be anywhere up
 * to 7/16 in. The plate-stack deliverable asks for the heaviest load the
 * reading allows, and the real stack is heavier than the nominal figure.
 *
 * All numbers below are computed from the givens; the hand-checks sit next
 * to each one.
 */
(function (SE) {
  'use strict';

  var LB = 4.448;          // N per lb  (Table 1-2)
  var SLUG = 14.59;        // kg per slug
  var FT = 0.3048;         // m per ft
  var IN = FT / 12;        // 0.0254 m
  var G_SI = 9.81, G_FPS = 32.2;

  /* ------------------------------------------------------------ the givens */

  // 1. Convoy on the bridge.
  var TRACTOR_TON = 8.75, TRAILER_KIP = 14.2, CARGO_LB = 11640;
  var CONVOY_LB = TRACTOR_TON * 2000 + TRAILER_KIP * 1000 + CARGO_LB;
  // 17 500 + 14 200 + 11 640 = 43 340 lb
  var CONVOY_N = CONVOY_LB * LB;
  // 43 340 x 4.448 = 192 776 N -> 193 kN
  var CONVOY_TON_SLIP = (TRACTOR_TON * 1000 + TRAILER_KIP * 1000 + CARGO_LB) / CONVOY_LB;
  // ton read as 1000 lb: 34 590 / 43 340 = 0.798

  // 2. Crane load moment for the generator skid.
  var MOMENT_LBFT = 18400;
  var MOMENT_NM = MOMENT_LBFT * LB * FT;
  // 4.448 x 0.3048 = 1.355 750 4 N·m per lb·ft; x 18 400 = 24 945.8 N·m -> 24.9 kN·m

  // 3. Drilling mud in the tanker.
  var MUD_SLUG_FT3 = 3.42;
  var MUD_KG_M3 = MUD_SLUG_FT3 * SLUG / Math.pow(FT, 3);
  // 3.42 x 14.59 = 49.897 8 kg; 0.3048^3 = 0.028 316 8 m^3
  // 49.897 8 / 0.028 316 8 = 1762.1 kg/m^3 -> 1.76 Mg/m^3

  // 4. Air-spring pressure on the caravan flatbed.
  var AIR_PSI = 118;
  var AIR_PA = AIR_PSI * LB / (IN * IN);
  // 1 psi = 4.448 / 0.0254^2 = 4.448 / 0.000 645 16 = 6894.4 Pa
  // 118 x 6894.4 = 813 541 Pa -> 814 kPa

  // 5. Coupling speed on the rail spur.
  var COUPLE_MPH = 4;
  var COUPLE_MS = COUPLE_MPH * 5280 * FT / 3600;
  // 4 x 5280 = 21 120 ft/h; x 0.3048 = 6437.4 m/h; / 3600 = 1.788 16 m/s -> 1.79 m/s
  var COUPLER_BREAK = 1.15 * COUPLE_MS;   // knuckles shatter about 15 % over the rating
  var COUPLER_LATCH = 0.5 * COUPLE_MS;    // and won't latch below about half of it

  // 6. Concrete counterweight block the caravan is buying (SI dimensions).
  var BLOCK_D = 0.450, BLOCK_L = 1.15, BLOCK_RHO = 2400;   // m, m, kg/m^3
  var BLOCK_V = Math.PI / 4 * BLOCK_D * BLOCK_D * BLOCK_L;
  // pi/4 x 0.450^2 x 1.15 = 0.785 40 x 0.2025 x 1.15 = 0.182 90 m^3
  var BLOCK_M = BLOCK_V * BLOCK_RHO;   // 0.182 90 x 2400 = 438.96 kg
  var BLOCK_N = BLOCK_M * G_SI;        // 438.96 x 9.81 = 4306.2 N
  // 4306.2 / 4.448 = 968.1 lb -> 968 lb

  // 7. Steel plate stack, thickness taped to the nearest 1/8 in.
  var PLATES = 12, PLATE_AREA_FT2 = 4 * 8, PLATE_TAPE_IN = 3 / 8, TAPE_RES_IN = 1 / 8;
  var PLATE_TRUE_IN = 0.430;                   // what the calipers found later
  var STEEL_SLUG_FT3 = 15.2;
  var STEEL_LB_FT3 = STEEL_SLUG_FT3 * G_FPS;   // 15.2 x 32.2 = 489.44 lb/ft^3
  function plateStackN(tIn) { return PLATES * PLATE_AREA_FT2 * (tIn / 12) * STEEL_LB_FT3 * LB; }
  var PLATE_MAX_IN = PLATE_TAPE_IN + TAPE_RES_IN / 2;   // 3/8 + 1/16 = 7/16 in
  var PLATES_MAX_N = plateStackN(PLATE_MAX_IN);
  // V = 12 x 32 ft^2 x (0.4375 / 12) ft = 14.000 ft^3
  // W = 14.000 x 489.44 = 6852.2 lb; x 4.448 = 30 478 N -> 30.5 kN
  var PLATES_NOM_N = plateStackN(PLATE_TAPE_IN);
  // 12.000 ft^3 x 489.44 = 5873.3 lb -> 26 124 N (26.1 kN)
  var PLATES_TRUE_N = plateStackN(PLATE_TRUE_IN);
  // 13.760 ft^3 x 489.44 = 6734.7 lb -> 29 956 N (30.0 kN)

  /* ------------------------------------------------------------- the yards */

  var BRIDGES = [
    { id: 'foot', name: 'plank footbridge', rating: 20e3, kind: 'footbridge' },
    { id: 'mill', name: 'Mill Creek truss', rating: 180e3, kind: 'truss' },
    { id: 'route9', name: 'Route 9 girder', rating: 260e3, kind: 'truss' },
    { id: 'rail', name: 'rail trestle', rating: 600e3, kind: 'heavy', cost: 'took the rail trestle: two days dragging wrecks off the line' },
    { id: 'dam', name: 'dam road', rating: 3e6, kind: 'detour', cost: 'sent the convoy 40 km round by the dam: two days of fuel' }
  ];
  var CRANES = [   // load-moment ratings, N·m
    { id: 'fork', name: 'yard forklift', rating: 12e3, kind: 'forklift' },
    { id: 'tc-in', name: 'crane, pads in', rating: 20e3, kind: 'crane' },
    { id: 'tc-out', name: 'crane, pads out', rating: 45e3, kind: 'crane' },
    { id: 'railcrane', name: 'rail crane', rating: 150e3, kind: 'crane', cost: 'brought the rail crane down the spur: a full day and the last of the grease' }
  ];
  var TANKERS = [  // max liquid density for a full 1.5 m^3 tank, kg/m^3
    { id: 'water', name: 'farm water bowser', rating: 1100, kind: 'cart' },
    { id: 'diesel', name: 'diesel bowser', rating: 1400, kind: 'trailer' },
    { id: 'slurry', name: 'slurry tanker', rating: 2100, kind: 'trailer' },
    { id: 'cement', name: 'bulk cement tanker', rating: 3500, kind: 'flatbed', cost: 'hitched the cement tanker: the big tractor and a day of diesel' }
  ];
  var AIRBAGS = [  // air-spring pressure ratings, Pa
    { id: 'seat', name: 'truck-seat air bag', rating: 350e3, kind: 'barrow' },
    { id: 'cab', name: 'cab air spring', rating: 600e3, kind: 'cart' },
    { id: 'trailer', name: 'trailer air spring', rating: 1.0e6, kind: 'trailer' },
    { id: 'ram', name: 'hydraulic ram (blocked solid)', rating: 21e6, kind: 'flatbed', cost: 'blocked the suspension solid on hydraulic rams: the cargo shakes all the way home' }
  ];
  var CARAVAN_TRAILERS = [  // the caravan's own kit, rated in lb (stored in N)
    { id: 'hand', name: 'hand cart (450 lb)', rating: 450 * LB, kind: 'barrow' },
    { id: 'util', name: 'utility trailer (1200 lb)', rating: 1200 * LB, kind: 'cart' },
    { id: 'tandem', name: 'tandem trailer (3500 lb)', rating: 3500 * LB, kind: 'trailer' },
    { id: 'lowboy', name: 'lowboy (20 000 lb)', rating: 20000 * LB, kind: 'flatbed', cost: 'hitched the lowboy for one block: the caravan grumbles about the fuel' }
  ];
  var LIFTERS = [
    { id: 'jack', name: 'pallet jack', rating: 10e3, kind: 'palletjack' },
    { id: 'fork', name: 'depot forklift', rating: 28e3, kind: 'forklift' },
    { id: 'crane', name: 'truck crane', rating: 60e3, kind: 'crane' },
    { id: 'railcrane', name: 'rail crane', rating: 250e3, kind: 'crane', cost: 'brought the rail crane down the spur for a stack of plate' }
  ];

  /* ------------------------------------------------------------ helpers */

  // The player's figure in SI, or NaN when it has the wrong dimensions or
  // didn't parse. NaN makes the crew grab the nearest (smallest) kit.
  function figure(a) { return a && a.result && a.result.parts.units && typeof a.si === 'number' ? a.si : NaN; }

  function fmt(v, unit) { return SE.sigfig.roundSig(v, 3).text + ' ' + unit; }

  // Run the haul pick with the player's figure and the true load, then say
  // what physically happened.
  function haul(ctx, params, claimed, what) {
    var s = ctx.setScene('haul', params);
    return s.run({ claimed: claimed, trueValue: params.trueValue }).then(function (r) {
      var d = r.detail, name = d.chosen ? d.chosen.name : 'nothing';
      var pct = Math.round(d.utilization * 100);
      if (d.fallback) return 'No usable figure, so the crew grabbed the ' + name + '. ' + what.fail.replace('{kit}', name) + ' It was carrying ' + pct + '% of its rating.';
      if (r.outcome === 'overloaded') return 'The crew read your figure and took the ' + name + '. ' + what.fail.replace('{kit}', name) + ' The true load was ' + pct + '% of its rating.';
      if (r.outcome === 'oversized') return 'It held, but it was overkill: the crew ' + d.cost + '. The ' + (d.ideal ? d.ideal.name : 'smaller kit') + ' would have done.';
      return 'The crew took the ' + name + ' and ' + what.ok + ' (' + pct + '% of its rating).';
    });
  }

  /* -------------------------------------------------------------- project */

  SE.content.registerProject('ch01', {
    id: 'P2', order: 2, title: 'Caravan Manifest', subtitle: 'An FPS manifest in an SI town',
    brief: [
      'A trade caravan has come down from the old Army depot at Fort Calder: a wrecker, a lowboy trailer and a string of rail cars on the spur. They want concrete and diesel. We want their generator, their drilling mud and their steel plate.',
      'Their manifest is in **pounds, feet, tons and miles**. Every rating in Kettle Hollow, from the bridges to the cranes, is stamped in **SI**. Their own trailers are rated in pounds.',
      'Convert every figure on the work order. The crew picks equipment straight from your number, then the real load shows up. Get it low and something breaks. Get it high and we burn fuel we don\'t have.',
      'The unit converter is in the shop. Do it by hand, three significant figures unless the data can\'t support them.'
    ].join('\n\n'),
    conditions: [
      'Table 1–2 factors: 1 lb = 4.448 N, 1 slug = 14.59 kg, 1 ft = 0.3048 m. Also 12 in = 1 ft, 5280 ft = 1 mi, 1 kip = 1000 lb, 1 **ton = 2000 lb** (the U.S. short ton, not the metric tonne).',
      'g = 9.81 m/s² (32.2 ft/s²). All ratings are the load at which the kit fails: no hidden margin.',
      'The depot platform scale reads to the nearest **5 lb**. The depot tape reads to the nearest **1/8 in**. A reading can be off by up to half a division either way.',
      'The steel plate is mill-standard 4 ft × 8 ft sheet; only its thickness was measured, with the depot tape.',
      'The rail-car couplers are old knuckle couplers: they shatter at about 15% over their rated speed and won\'t latch below about half of it.'
    ],
    scene: { type: 'haul', params: { mode: 'bridge', quantity: 'force', options: BRIDGES, trueValue: 120e3, claimed: 120e3, label: 'practice rig' } },
    controls: ['claimed', 'trueValue', 'safety'],
    rigText: 'The test rig is the bridge crossing with **practice loads**, not the manifest. Set the figure you hand the crew and the true load, then run the crossing to see how the pick works.',
    rigActions: [
      { label: 'Run the crossing', run: function (ctx) {
        var s = ctx.scene; if (!s || !s.run) return null;
        return s.run({}).then(function (r) { return 'Crew took the ' + (r.detail.chosen ? r.detail.chosen.name : 'nothing') + ': ' + (r.outcome === 'ok' ? 'it held.' : r.outcome === 'oversized' ? 'it held, but it was overkill.' : 'it failed.'); });
      } }
    ],
    lockedTools: ['converter'],
    deliverables: [
      {
        id: 'P2.convoy',
        label: '**Bridge crossing.** The wrecker weighs **8.75 ton** (manifest), the empty lowboy **14.2 kip** (manifest), and the cargo weighed **11 640 lb** on the depot scale. Total convoy weight in **kN**, for the crossing sheet.',
        placeholder: 'e.g. 123 kN',
        spec: { value: CONVOY_N, unit: 'N', sf: 3, form: 'si', expressIn: 'kN',
          mistakes: [{ ratio: CONVOY_TON_SLIP, kind: 'conversion', msg: 'That treats a ton as 1000 lb. The U.S. ton is 2000 lb; the kip is the one that is 1000 lb.' }] },
        answer: '193 kN',
        wrong: [
          { input: '154 kN', kind: 'conversion' },     // ton as 1000 lb
          { input: '43.3 kip', kind: 'form' },         // right weight, wrong system
          { input: '192.8 kN', kind: 'sigfig' },
          { input: '19.7 kN', kind: 'concept' }        // divided by 9.81 as if it were a mass
        ],
        hints: [
          'Three different units, one total. Put everything in pounds first, then convert once.',
          'A ton is 2000 lb and a kip is 1000 lb. Add the three weights in lb, then multiply by (4.448 N / 1 lb) and re-express with the kilo prefix.',
          '8.75 ton = 17 500 lb, 14.2 kip = 14 200 lb, plus 11 640 lb gives 43 340 lb. Now 43 340 lb × 4.448 N/lb = ?'
        ],
        consequence: function (ctx, a) {
          return haul(ctx, { mode: 'bridge', quantity: 'force', options: BRIDGES, trueValue: CONVOY_N, label: 'convoy' }, figure(a), {
            fail: 'The {kit} sagged, cracked and dropped the wrecker into the creek. Hask is not going to let you forget that.',
            ok: 'the convoy rolled across with the deck barely moving'
          });
        }
      },
      {
        id: 'P2.moment',
        label: '**Generator lift.** Their crane chart lists the load moment to swing the generator skid off the lowboy as **18 400 lb·ft**. Our cranes are rated by load moment in SI. Give it in **SI units with a suitable prefix**.',
        placeholder: 'e.g. 12.3 kN·m',
        spec: { value: MOMENT_NM, unit: 'N·m', sf: 3, form: 'si',
          mistakes: [{ ratio: 1 / Math.pow(LB * FT, 2), kind: 'conversion', msg: 'That divides by both factors. Pounds to newtons multiplies by 4.448, and feet to metres multiplies by 0.3048.' }] },
        answer: '24.9 kN·m',
        wrong: [
          { input: '81.8 kN·m', kind: 'conversion' },   // feet never converted
          { input: '13.6 kN·m', kind: 'conversion' },   // divided by both factors
          { input: '24.95 kN·m', kind: 'sigfig' }
        ],
        hints: [
          'A lb·ft has two units in it, so it needs two conversion factors.',
          'Multiply by (4.448 N / 1 lb) and by (0.3048 m / 1 ft) so lb and ft both cancel, leaving N·m. Then pick a prefix so the number lands between 0.1 and 1000.',
          '18 400 × 4.448 × 0.3048 = 18 400 × 1.3558 = 24 946 N·m. Re-express that with the kilo prefix.'
        ],
        consequence: function (ctx, a) {
          return haul(ctx, { mode: 'lift', quantity: 'moment', unitLabel: 'N·m', options: CRANES, trueValue: MOMENT_NM, object: 'crate', label: 'generator skid' }, figure(a), {
            fail: 'The {kit} lifted, leaned, and went over on its front pads. The generator landed on its side.',
            ok: 'swung the generator onto the depot floor without a wobble'
          });
        }
      },
      {
        id: 'P2.mud',
        label: '**Drilling mud.** The manifest gives the mud\'s density as **3.42 slug/ft³**. Our tankers are rated by the densest liquid they can carry full. Density in **SI units with a suitable prefix**.',
        placeholder: 'e.g. 1.23 Mg/m^3',
        spec: { value: MUD_KG_M3, unit: 'kg/m^3', sf: 3, form: 'si' },
        answer: '1.76 Mg/m^3',
        wrong: [
          { input: '164 kg/m^3', kind: 'conversion' },  // ft not cubed
          { input: '49.9 kg/m^3', kind: 'conversion' }, // ft^3 never converted
          { input: '1.762 Mg/m^3', kind: 'sigfig' }
        ],
        hints: [
          'Two units to convert: slugs on top, cubic feet underneath.',
          'Multiply by (14.59 kg / 1 slug) and by (1 ft / 0.3048 m)³. The length factor is cubed because the unit is a volume.',
          '3.42 × 14.59 = 49.898 kg per ft³, and 1 ft³ = 0.3048³ = 0.028 317 m³. Divide, then choose a prefix: 1000 kg is 1 Mg.'
        ],
        consequence: function (ctx, a) {
          return haul(ctx, { mode: 'axle', quantity: 'density', unitLabel: 'kg/m³', options: TANKERS, trueValue: MUD_KG_M3, object: 'drum', label: 'drilling mud' }, figure(a), {
            fail: 'They filled the {kit} to the brim and the axle folded under it. Mud everywhere.',
            ok: 'filled it to the brim with the springs sitting where they should'
          });
        }
      },
      {
        id: 'P2.air',
        label: '**Air ride.** The caravan\'s flatbed runs its air springs at **118 psi** (lb/in²) under load. We have to swap in one of our spares, rated in SI. Pressure in **SI units with a suitable prefix**.',
        placeholder: 'e.g. 123 kPa',
        spec: { value: AIR_PA, unit: 'Pa', sf: 3, form: 'si' },
        answer: '814 kPa',
        wrong: [
          { input: '5.65 kPa', kind: 'conversion' },    // in² treated as ft²
          { input: '813.5 kPa', kind: 'sigfig' }
        ],
        hints: [
          'psi is pounds per square **inch**. Both the pound and the square inch need converting.',
          'Multiply by (4.448 N / 1 lb) and by (1 in / 0.0254 m)². 1 in = 0.3048/12 = 0.0254 m exactly. Then N/m² is Pa.',
          '1 in² = 0.0254² = 0.000 645 16 m², so 1 psi = 4.448 / 0.000 645 16 = 6894 Pa. Multiply by 118 and choose a prefix.'
        ],
        consequence: function (ctx, a) {
          return haul(ctx, { mode: 'axle', quantity: 'pressure', options: AIRBAGS, trueValue: AIR_PA, label: 'flatbed air spring' }, figure(a), {
            fail: 'The {kit} ballooned and burst with a bang that brought every walker in the valley to the fence.',
            ok: 'pumped it up and the flatbed sat level'
          });
        }
      },
      {
        id: 'P2.couple',
        label: '**Coupling the rail cars.** Their couplers are rated for **4 mi/h**. Our shunting winch is set in SI. The coupling speed in **m/s**.',
        placeholder: 'e.g. 1.23 m/s',
        spec: { value: COUPLE_MS, unit: 'm/s', sf: 3, form: 'si' },
        answer: '1.79 m/s',
        wrong: [
          { input: '5.87 m/s', kind: 'conversion' },    // that's ft/s
          { input: '107 m/s', kind: 'conversion' },     // divided by 60, not 3600
          { input: '1.788 m/s', kind: 'sigfig' }
        ],
        hints: [
          'Two conversions: miles to metres on top, hours to seconds underneath.',
          'Multiply by (5280 ft / 1 mi), (0.3048 m / 1 ft) and (1 h / 3600 s), arranged so mi, ft and h cancel.',
          '4 × 5280 = 21 120 ft/h, × 0.3048 = 6437 m/h. Divide by 3600 s/h.'
        ],
        consequence: function (ctx, a) {
          var v = figure(a);
          var vSet = isFinite(v) ? Math.max(0, Math.min(v, 40)) : 0.3;
          var s = ctx.setScene('track', {
            surface: 'rail', length: 30, showVectors: true, trail: true, units: 'SI',
            bodies: [{ id: 'car', m: 14000, x: 27, v: vSet, mu: 0.002, kind: 'cart', label: 'caravan car' }],
            bumperRating: COUPLER_BREAK
          });
          return s.run({ duration: 14 }).then(function (r) {
            var imp = r.detail.impactSpeed;
            if (r.detail.bumperBroken) return 'The winch shoved the car in at ' + fmt(imp, 'm/s') + '. The knuckle shattered on contact: those couplers give way at about ' + fmt(COUPLER_BREAK, 'm/s') + '.';
            if (imp < COUPLER_LATCH) return 'The car kissed the coupler at ' + fmt(imp, 'm/s') + ' and bounced off. The knuckle never latched; you need at least half the rated speed.';
            return 'The car rolled in at ' + fmt(imp, 'm/s') + ' and the knuckle closed with a clean clunk. Coupled.';
          });
        }
      },
      {
        id: 'P2.block',
        label: '**Counterweight sale.** The caravan is buying a concrete counterweight: a cylinder **450 mm** across and **1.15 m** long, concrete at **2.40 Mg/m³**. Their trailers are rated in pounds. Its weight in **lb**.',
        placeholder: 'e.g. 123 lb',
        spec: { value: BLOCK_N, unit: 'N', sf: 3, form: 'any', expressIn: 'FPS',
          mistakes: [
            { ratio: 4, kind: 'algebra', msg: 'Four times too heavy: the 450 mm is the diameter, so the radius is 225 mm.' },
            // 438.96 "lb" / 968.1 lb = 0.4534: the mass in kg relabelled as pounds
            { ratio: BLOCK_M * LB / BLOCK_N, kind: 'concept', msg: 'That is the block\'s mass in kilograms with a pound label on it. A pound is a force: find W = mg in newtons first.' }
          ] },
        answer: '968 lb',
        wrong: [
          { input: '439 lb', kind: 'concept' },        // the mass in kg, relabelled
          { input: '4.31 kN', kind: 'form' },          // right weight, wrong system
          { input: '3.87 kip', kind: 'algebra' }       // diameter used as radius
        ],
        hints: [
          'Volume, then mass, then weight, then pounds. Stay in SI until the last step.',
          'V = (π/4) d² L in m³. m = ρV with 2.40 Mg/m³ = 2400 kg/m³. W = mg in newtons, then multiply by (1 lb / 4.448 N).',
          'V = 0.7854 × 0.450² × 1.15 = 0.1829 m³, so m = 439.0 kg and W = 439.0 × 9.81 = 4306 N. Now divide by 4.448.'
        ],
        consequence: function (ctx, a) {
          return haul(ctx, { mode: 'axle', quantity: 'force', options: CARAVAN_TRAILERS, trueValue: BLOCK_N, object: 'bollard', label: 'counterweight' }, figure(a), {
            fail: 'The hoist lowered the block onto the {kit} and the axle snapped clean through.',
            ok: 'set the block down and chained it, springs nicely loaded'
          });
        }
      },
      {
        id: 'P2.plates',
        label: '**Plate stack.** Twelve sheets of 4 ft × 8 ft steel plate, steel at **15.2 slug/ft³**. The thickness taped at **3/8 in** with the depot tape. Rig for the **heaviest the stack could be** given the tape\'s precision. That weight in **kN**.',
        placeholder: 'e.g. 12.3 kN',
        spec: { value: PLATES_MAX_N, unit: 'N', sf: 3, form: 'si', expressIn: 'kN',
          mistakes: [
            { ratio: PLATES_NOM_N / PLATES_MAX_N, kind: 'concept', msg: 'That\'s the nominal 3/8 in. A tape that reads to the nearest 1/8 in can be off by up to 1/16 in, and the crew needs the heaviest case.' },
            { ratio: plateStackN(PLATE_TAPE_IN + TAPE_RES_IN) / PLATES_MAX_N, kind: 'concept', msg: 'That adds a whole 1/8 in. A reading is off by at most half a division: 1/16 in.' }
          ] },
        answer: '30.5 kN',
        wrong: [
          { input: '26.1 kN', kind: 'concept' },       // nominal thickness
          { input: '34.8 kN', kind: 'concept' },       // a full division added
          { input: '30.48 kN', kind: 'sigfig' }
        ],
        hints: [
          'A tape reading of 3/8 in only tells you the true thickness is within half a division of 3/8. How thick could it really be?',
          'Worst case t = 3/8 + 1/16 = 7/16 in. Volume in ft³ = 12 × (4 × 8) × (t / 12). Weight density = ρg = 15.2 × 32.2 lb/ft³. Then lb to N.',
          'V = 12 × 32 × 0.036 46 = 14.00 ft³. Weight = 14.00 × 489.4 = 6852 lb. Multiply by 4.448 and use the kilo prefix.'
        ],
        consequence: function (ctx, a) {
          // The real stack (calipers, afterwards) is 0.430 in thick: heavier than nominal.
          return haul(ctx, { mode: 'lift', quantity: 'force', options: LIFTERS, trueValue: PLATES_TRUE_N, object: 'crate', label: 'plate stack' }, figure(a), {
            fail: 'The {kit} took the stack, then tipped forward and dumped it. The calipers say the plate is really 0.430 in: the stack weighs ' + fmt(PLATES_TRUE_N / 1000, 'kN') + ', more than the nominal reading suggests.',
            ok: 'lifted it clean. Calipers later put the plate at 0.430 in, a true ' + fmt(PLATES_TRUE_N / 1000, 'kN') + ', inside your bound'
          });
        }
      }
    ],
    deeper: [
      '**Measurement precision.** A tape that reads to 1/8 in puts a 3/8 in thickness anywhere from 5/16 to 7/16 in, an uncertainty of ±17%. The nominal stack weight (26.1 kN) claims three figures the tape can\'t support; the honest statement is about 22 to 30 kN. When the stakes are a dropped load, you rig for the top of the range.',
      '**Scale resolution.** The 5 lb resolution on the cargo weigh-in shifts the convoy total by at most ±2.5 lb in 43 340 lb, under 0.01%, so three significant figures are fully justified there. Precision only bites when the reading is small compared with the division.',
      '**The fourth digit of 4.448.** The exact factor is 4.448 222 N/lb. Using 4.448 changes every pound conversion here by 0.005%, far below what three figures can show. It only matters when you report five or more significant figures, as a precision governor might.'
    ],
    debrief: 'The convoy crossed, the generator\'s on the floor, the mud is in the right tanker and the plate stack didn\'t end up in the dirt. Juno signs the trade sheet.\n\nEvery item was the same move: multiply by factors equal to one, set so the old units cancel. The plate stack added something no table gives you: an instrument only knows as much as its smallest division, and an engineer rigs for what the load **could** be, not what it was written down as.'
  });
})(globalThis.SE);
