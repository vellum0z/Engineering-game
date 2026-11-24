/*
 * H7 · Trade Ledger: converting between U.S. Customary (FPS) and SI units.
 * Conversion factors (lb ↔ N, slug ↔ kg, ft ↔ m and the FPS ladder of in,
 * mi, kip and ton), the "multiply by one" method with unit cancellation,
 * and powers of the length factor for areas and volumes. Course section 1.3.
 *
 * Every scored answer is checked against a value computed from the givens
 * below. The factors are the course's 4-figure ones, so the hand checks in
 * the comments use the same numbers the player has.
 */
(function (SE) {
  'use strict';

  var LB = 4.448;              // N per lb
  var SLUG = 14.59;            // kg per slug
  var FT = 0.3048;             // m per ft
  var IN = FT / 12;            // m per in (0.0254)
  var FT3 = FT * FT * FT;      // m^3 per ft^3 (0.028 317)
  var G = 9.81;

  /* ------------------------------------------------------------ the givens */

  // Worked example (derive): a walker feeds crates at 3 km/h.
  //   3 km/h = 3000 m / 3600 s = 0.8333 m/s;  0.8333 / 0.3048 = 2.734 ft/s -> 2.73 ft/s
  // Scored variant: the hand cart is pushed at 5 km/h.
  var CART_KMH = 5;
  var V_CART = CART_KMH * 1000 / 3600;            // 1.3889 m/s
  //   1.3889 / 0.3048 = 4.557 ft/s -> 4.56 ft/s

  // Worked example: 450 lb·s -> 450 x 4.448 = 2001.6 N·s -> 2.00 kN·s
  //                 1.78 slug/ft^3 -> 1.78 x 14.59 / 0.028 317 = 917.1 kg/m^3 -> 917 kg/m^3
  // Scored variant: a winch jerk of 820 lb·s and diesel at 1.62 slug/ft^3.
  var J_LBS = 820;
  var J = J_LBS * LB;                             // 3647.4 N·s -> 3.65 kN·s
  var RHO_DIESEL = 1.62 * SLUG / FT3;             // 23.636 / 0.028 317 = 834.7 -> 835 kg/m^3
  var CAR_M = 1200;                               // kg, the wreck on the spur

  // Three readings off the caravan's US gear.
  var TORQUE = 150 * LB * FT;                     // 150 x 4.448 x 0.3048 = 203.4 -> 203 N·m
  var GAMMA_IRON = 450 * LB / FT3;                // 2001.6 / 0.028 317 = 70 686 -> 70.7 kN/m^3
  var CREEP = 6 * FT / 3600;                      // 1.8288 m / 3600 s = 5.080(10^-4) m/s -> 0.508 mm/s
  var IRON_V = 0.200;                             // m^3 of cast-iron scrap on the trailer
  var IRON_W = GAMMA_IRON * IRON_V;               // 14 137 N (3178 lb) -> utility trailer at 91 %
  var MUD_GAP = 3.00;                             // m between the mud front and the gate

  // Densities.
  var RHO_CU = 17.3 * SLUG / FT3;                 // 252.41 / 0.028 317 = 8913.8 -> 8.91 Mg/m^3
  var RHO_SEA = 1.99 * SLUG / FT3;                // 29.034 / 0.028 317 = 1025.3 -> 1.03 Mg/m^3
  var CU_V = 0.0400;                              // m^3 of copper in the wire bundle
  var CU_M = RHO_CU * CU_V;                       // 356.6 kg
  var BALLAST_V = 2.00;                           // m^3 ballast tank on the raft

  // Pressures.
  var KPA_PSF = 1000 / LB * FT * FT;              // 1000 x 0.092 903 / 4.448 = 20.89 -> 20.9 lb/ft^2
  var TIRE = 32.0 * LB / (IN * IN);               // 142.34 / 6.4516(10^-4) = 220 620 Pa -> 221 kPa
  var ROOF_PSF = 25;                              // caravan wagon roof rating, lb/ft^2
  var CORNER_N = 3600;                            // N on one trailer tire

  // The bollard: a solid concrete cylinder, 400 mm across and 1.20 m long.
  var BOL_D = 0.400, BOL_L = 1.20, BOL_RHO = 2400;
  var BOL_V = Math.PI * Math.pow(BOL_D / 2, 2) * BOL_L;   // pi x 0.2^2 x 1.2 = 0.150 80 m^3
  var BOL_M = BOL_RHO * BOL_V;                            // 361.91 kg
  var BOL_W = BOL_M * G;                                  // 3550.4 N
  //   3550.4 / 4.448 = 798.2 lb -> 798 lb

  // The crew's lifting gear for the bollard (ratings in N, read off US plates).
  var BOLLARD_GEAR = [
    { id: 'hand', name: 'hand truck', rating: 600 * LB, kind: 'handtruck' },
    { id: 'dolly', name: 'appliance dolly', rating: 850 * LB, kind: 'handtruck' },
    { id: 'jack', name: 'pallet jack', rating: 2500 * LB, kind: 'palletjack', cost: 'took the pallet jack off the ration dock for the afternoon' },
    { id: 'fork', name: 'forklift', rating: 8000 * LB, kind: 'forklift', cost: 'ran the forklift: half a day of propane gone' }
  ];
  // Gear for the copper bundle, rated by mass.
  var COPPER_GEAR = [
    { id: 'hand', name: 'hand truck', rating: 250, kind: 'handtruck' },
    { id: 'dolly', name: 'appliance dolly', rating: 400, kind: 'handtruck' },
    { id: 'jack', name: 'pallet jack', rating: 1200, kind: 'palletjack', cost: 'took the pallet jack off the ration dock for a 360 kg bundle' },
    { id: 'fork', name: 'forklift', rating: 3600, kind: 'forklift', cost: 'ran the forklift: half a day of propane gone' }
  ];

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function num(a) { return a && typeof a.si === 'number' && isFinite(a.si) ? a.si : null; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  /* ---------------------------------------------------------- consequences */

  // Belt transfer: the next crate is carried at walking speed, the crate on the
  // belt moves at whatever the controller was set to. If the belt is slower,
  // the gap closes and the walker rams the crate already on it.
  function beltRun(ctx, vBelt, vWalk) {
    var gap = 0.4;
    var s = ctx.setScene('track', {
      surface: 'rail', length: 30, trail: true, showVectors: true,
      bodies: [
        { id: 'next', m: 25, x: 6.6, v: vWalk, mu: 0, label: 'next', kind: 'crate' },
        { id: 'belt', m: 25, x: 8, v: Math.max(0, vBelt), mu: 0, label: 'on belt', kind: 'crate' }
      ]
    });
    return s.run({ duration: 5, settle: false, target: 'belt' }).then(function (r) {
      var closing = vWalk - Math.max(0, vBelt);
      var vb = r.detail.v;
      return { closing: closing, hitAt: closing > 0 ? gap / closing : null, vMeasured: vb };
    });
  }

  function speedConsequence(ctx, a) {
    var v = num(a.v);
    var vSet = v == null ? 0 : v;
    return beltRun(ctx, vSet, V_CART).then(function (m) {
      var rel = vSet / V_CART;
      if (v == null) return 'No usable setting, so the belt never started. The next crate slammed into the one sitting at the head after ' + sig(m.hitAt) + ' s.';
      if (Math.abs(rel - 1) <= 0.01) return 'The belt ran at **' + sig(vSet / FT) + ' ft/s**, matching the cart. The crates rolled on with the gap holding at 0.4 m the whole way: the trail marks stay level with each other.';
      if (rel < 1) return 'The belt ran at only **' + sig(vSet / FT) + ' ft/s** (' + pct(rel) + ' of walking pace). The gap closed at ' + sig(m.closing) + ' m/s and the next crate rammed the belt crate after **' + sig(m.hitAt) + ' s**. Crates pile up at the head and someone loses fingers.';
      return 'The belt ran at **' + sig(vSet / FT) + ' ft/s**, ' + pct(rel - 1) + ' faster than the cart. Nothing collided, but the spacing grows every crate and the far end overshoots the catch table.';
    });
  }

  // Winch jerk on the wreck: impulse J = m dv, so the wreck leaves at J/m.
  // The crew builds the end stop for the speed your figure predicts (+15 %).
  function manifestConsequence(ctx, a) {
    var jP = num(a.J), rhoP = num(a.rho);
    var vTrue = J / CAR_M;                                         // 3.04 m/s
    var vPred = jP == null ? 0 : jP / CAR_M;
    var rating = Math.max(0.3, vPred * 1.15);
    var s = ctx.setScene('track', {
      surface: 'rail', length: 30, trail: true, showVectors: true, bumperRating: rating,
      bodies: [{ id: 'car', m: CAR_M, x: 18, v: 0, mu: 0, label: 'wreck 1200 kg', kind: 'cart' }]
    });
    var pulse = 0.5;
    return s.run({ duration: 10, target: 'car', pushes: [{ id: 'car', F: J / pulse, duration: pulse, at: 0.2 }] }).then(function (r) {
      var msg = [];
      if (r.outcome === 'bumperBroken') {
        msg.push('The jerk sent the wreck down the spur at **' + sig(vTrue) + ' m/s**. Your impulse predicted ' + sig(vPred) + ' m/s, so the crew built the end stop for ' + sig(rating) + ' m/s. It hit at ' + sig(r.detail.impactSpeed || vTrue) + ' m/s and the stop **gave way**.');
      } else {
        msg.push('The wreck left at **' + sig(vTrue) + ' m/s**, inside the ' + sig(rating) + ' m/s the crew built the end stop for' + (vPred > vTrue * 1.3 ? ', though they hauled far more sleepers than it needed.' : '. It thumped home and stayed put.'));
      }
      if (rhoP == null) msg.push('No density, so nobody knew which layer of the separator tank to draw from.');
      else if (rhoP < 1000) msg.push('Your diesel density (' + sig(rhoP) + ' kg/m³) is under water\'s 1000, so the crew drew from the **top** of the separator. Right call: the diesel floats at ' + sig(RHO_DIESEL) + ' kg/m³.');
      else msg.push('Your density (' + sig(rhoP) + ' kg/m³) says diesel sinks, so the crew drained the **bottom** of the separator and filled the generator with water. It floats: ' + sig(RHO_DIESEL) + ' kg/m³.');
      return msg.join('\n\n');
    });
  }

  // The iron goes on a trailer picked from your specific weight; torque and creep
  // are checked against what the job needs.
  function convert3Consequence(ctx, a) {
    var gP = num(a.gam), tP = num(a.T), cP = num(a.c);
    var s = ctx.setScene('haul', { mode: 'axle', quantity: 'force', trueValue: IRON_W, claimed: gP == null ? NaN : gP * IRON_V, label: 'cast iron 0.200 m³', object: 'crate' });
    return s.run({ claimed: gP == null ? NaN : gP * IRON_V }).then(function (r) {
      var d = r.detail, msg = [];
      var kit = d.chosen ? d.chosen.name : 'nothing';
      if (r.outcome === 'overloaded') msg.push('From your figure the iron weighs ' + (gP == null ? '?' : sig(gP * IRON_V / 1000) + ' kN') + ', so the crew hitched the **' + kit + '**. The real ' + sig(IRON_W / 1000) + ' kN put it at ' + pct(d.utilization) + ' of its rating and the axle **snapped**.');
      else if (r.outcome === 'oversized') msg.push('The iron rode out on the ' + kit + '. It held, but ' + (d.cost || 'it was far more trailer than the job needed') + '.');
      else msg.push('The ' + kit + ' took the ' + sig(IRON_W / 1000) + ' kN of iron at ' + pct(d.utilization) + ' of its rating. **Holds.**');
      if (tP != null) {
        var tr = tP / TORQUE;
        if (tr < 0.95) msg.push('The wheel nuts went on at ' + sig(tP) + ' N·m, ' + pct(1 - tr) + ' under spec. Two of them backed off on the first rut.');
        else if (tr > 1.1) msg.push('The wheel nuts went on at ' + sig(tP) + ' N·m, ' + pct(tr - 1) + ' over spec. One stud stretched and will need replacing.');
        else msg.push('Wheel nuts torqued to ' + sig(tP) + ' N·m: tight and true.');
      }
      if (cP != null && cP > 0) {
        var hP = MUD_GAP / cP / 3600, hT = MUD_GAP / CREEP / 3600;
        msg.push('Your creep rate gives the mud ' + sig(hP) + ' h to reach the gate. It really takes **' + sig(hT) + ' h**' + (hP > hT * 1.05 ? ', so the shovel crew turned up after the gate was already buried.' : '.'));
      }
      return msg.join('\n\n');
    });
  }

  function densityConsequence(ctx, a) {
    var cuP = num(a.cu), swP = num(a.sw);
    var claimed = cuP == null ? NaN : cuP * CU_V;
    var s = ctx.setScene('haul', { mode: 'lift', quantity: 'mass', options: COPPER_GEAR, trueValue: CU_M, claimed: claimed, label: 'copper bundle', object: 'drum' });
    return s.run({ claimed: claimed }).then(function (r) {
      var d = r.detail, msg = [];
      var kit = d.chosen ? d.chosen.name : 'nothing';
      if (r.outcome === 'overloaded') msg.push('Your density puts the bundle at ' + (cuP == null ? '?' : sig(claimed) + ' kg') + ', so the crew brought the **' + kit + '**. The real ' + sig(CU_M) + ' kg is ' + pct(d.utilization) + ' of its rating, and it **buckled**.');
      else if (r.outcome === 'oversized') msg.push('The ' + kit + ' moved the bundle easily, but the crew ' + (d.cost || 'used far more kit than needed') + '.');
      else msg.push('The ' + kit + ' took the ' + sig(CU_M) + ' kg bundle at ' + pct(d.utilization) + ' of its rating. **Holds.**');
      if (swP != null) {
        var logged = swP * BALLAST_V, real = RHO_SEA * BALLAST_V;
        var err = logged - real;
        if (Math.abs(err) / real <= 0.01) msg.push('Raft ballast logged as ' + sig(logged) + ' kg of seawater. The raft sits level.');
        else msg.push('Raft ballast logged as ' + sig(logged) + ' kg, but 2.00 m³ of seawater is really **' + sig(real) + ' kg**. The raft trims ' + (err < 0 ? 'heavy' : 'light') + ' by ' + sig(Math.abs(err)) + ' kg and lists.');
      }
      return msg.join('\n\n');
    });
  }

  function pressureConsequence(ctx, a) {
    var qP = num(a.q), pP = num(a.p);
    var msg = [];
    // a.q.si is the player's lb/ft² figure converted back to Pa. What the crew
    // actually reads is the number in lb/ft², so recover it.
    if (qP != null) {
      var psfSaid = qP / 1000 * KPA_PSF;                // the player's 1 kPa expressed in lb/ft²
      if (psfSaid > ROOF_PSF) msg.push('Your figure puts 1.00 kPa of wet snow at ' + sig(psfSaid) + ' lb/ft², over the wagon roof\'s 25 lb/ft², so the caravan refused to park under the sheds. They camped outside the fence. The true load is only ' + sig(KPA_PSF) + ' lb/ft².');
      else msg.push('1.00 kPa of snow is ' + sig(KPA_PSF) + ' lb/ft², under the wagon roof\'s 25 lb/ft². The caravan parked inside the sheds, safe from the fence line.');
    }
    if (pP != null && pP > 0) {
      var patchP = CORNER_N / pP, patchT = CORNER_N / TIRE;   // contact area = load / pressure
      var r = pP / TIRE;
      if (r < 0.95) msg.push('The crew pumped the tire to ' + sig(pP / 1000) + ' kPa on the depot gauge. The contact patch spread to ' + sig(patchP * 1e4) + ' cm² instead of ' + sig(patchT * 1e4) + ' cm², and the sidewall flexed hot on the gravel.');
      else if (r > 1.05) msg.push('The crew pumped the tire to ' + sig(pP / 1000) + ' kPa, ' + pct(r - 1) + ' over the 32.0 psi on the sidewall. Patch only ' + sig(patchP * 1e4) + ' cm²: the trailer skips on every bump.');
      else msg.push('Tire pumped to ' + sig(pP / 1000) + ' kPa on the depot gauge, a contact patch of ' + sig(patchP * 1e4) + ' cm². Rolls true.');
    }
    return Promise.resolve(msg.join('\n\n') || 'No usable figures, so nobody did anything.');
  }

  function bollardConsequence(ctx, a) {
    var wP = num(a.W);
    var claimed = wP == null ? NaN : wP;
    var s = ctx.setScene('haul', { mode: 'lift', quantity: 'force', options: BOLLARD_GEAR, trueValue: BOL_W, claimed: claimed, label: 'concrete bollard', object: 'bollard' });
    return s.run({ claimed: claimed }).then(function (r) {
      var d = r.detail, kit = d.chosen ? d.chosen.name : 'nothing';
      if (r.outcome === 'overloaded') return 'The crew read your ' + (wP == null ? 'missing figure' : sig(wP / LB) + ' lb') + ' and took the **' + kit + '**. The real bollard weighs ' + sig(BOL_W / LB) + ' lb, ' + pct(d.utilization) + ' of the rating: the frame folded and the bollard rolled into the ditch.';
      if (r.outcome === 'oversized') return 'The bollard went up on the ' + kit + '. Safe, but you ' + (d.cost || 'used far more kit than needed') + ' for ' + sig(BOL_W / LB) + ' lb of concrete.';
      return 'The ' + kit + ' took the ' + sig(BOL_W / LB) + ' lb bollard at ' + pct(d.utilization) + ' of its rating. It\'s standing at the east gate now.';
    });
  }

  /* --------------------------------------------------------------- level */

  SE.content.registerLevel('ch01', {
    id: 'H7', order: 7, title: 'Trade Ledger',
    subtitle: 'Converting between FPS and SI',
    sections: ['1.3'],
    minutes: 25,
    intro: [
      'A trade caravan has rolled in from the southern freight yards. Their gear is all American-made: gauges in psi, torque wrenches in lb·ft, manifests in slugs. Kettle Hollow runs on SI.',
      'Hask has the caravan\'s ledger open on a crate. "Every number on this page is right, and every one of them will hurt someone if we read it in the wrong units. Let\'s make the two systems talk to each other."'
    ].join('\n\n'),
    goals: [
      'Use the FPS–SI factors: **1 lb = 4.448 N**, **1 slug = 14.59 kg**, **1 ft = 0.3048 m**',
      'Convert by multiplying by factors equal to one, arranged so the units cancel',
      'Square or cube the length factor for areas, volumes, densities and pressures',
      'Report converted results to three significant figures'
    ],
    scene: { type: 'track', params: { surface: 'rail', length: 30, trail: true, showVectors: true, bodies: [{ id: 'belt', m: 25, x: 6, v: 0, mu: 0, label: 'crate on belt', kind: 'crate' }] } },
    proveIt: [
      {
        id: 'H7.prove-speed', text: 'The caravan\'s lead wagon is doing **20 mi/h**. What is that in m/s?',
        inputs: [{
          key: 'v', label: 'Speed', placeholder: 'e.g. 1.23 m/s',
          // 20 x 5280 x 0.3048 / 3600 = 8.9408 m/s -> 8.94 m/s
          spec: { value: 20 * 5280 * FT / 3600, unit: 'm/s', sf: 3, form: 'si' },
          answer: '8.94 m/s', wrong: [{ input: '29.3 m/s', kind: 'conversion' }]
        }]
      },
      {
        id: 'H7.prove-density', text: 'A drum of salvaged solder is listed at **3.10 slug/ft³**. Give its density in SI.',
        inputs: [{
          key: 'rho', label: 'Density', placeholder: 'e.g. 1.23 Mg/m^3',
          // 3.10 x 14.59 / 0.028 317 = 1597.2 kg/m^3 -> 1.60 Mg/m^3
          spec: { value: 3.10 * SLUG / FT3, unit: 'kg/m^3', sf: 3, form: 'si' },
          answer: '1.60 Mg/m^3', wrong: [{ input: '148 kg/m^3', kind: 'conversion' }]
        }]
      }
    ],
    unlocks: { tools: ['converter'], formulas: ['ch01.table-conv'] },
    steps: [
      {
        type: 'predict', who: 'hask',
        q: 'The ledger lists a timber beam as **20 ft** long. Hask writes it as\n\n$$ 20\\u{ ft} \\times \\frac{0.3048\\u{ m}}{1\\u{ ft}} $$\n\nDid multiplying by that fraction change how long the beam is?',
        choices: [
          { t: 'Yes, it got shorter: 0.3048 is less than one.', why: 'The number shrank, but look at the fraction as a whole: 0.3048 m and 1 ft are the same length, so the fraction is exactly 1.' },
          { t: 'No. The fraction equals one, so only the units changed.', correct: true, why: 'Right. 0.3048 m *is* 1 ft, so the fraction is one. Multiplying by one changes the units and the number, never the length.' },
          { t: 'Yes, it got longer: you multiplied.', why: 'Multiplying by 1 changes nothing physical. The numerator and denominator are the same length written two ways.' }
        ],
        reveal: 'A ratio like $\\frac{0.3048\\u{ m}}{1\\u{ ft}}$ is a **conversion factor**: a fraction equal to one. You can multiply by it, or by its upside-down version, as often as you like without changing the quantity.'
      },
      {
        type: 'reveal', kicker: 'Table 1–2', title: 'Conversion factors',
        table: { head: ['Quantity', 'FPS', '', 'SI'], rows: [['Force', '1 lb', '=', '4.448 N'], ['Mass', '1 slug', '=', '14.59 kg'], ['Length', '1 ft', '=', '0.3048 m']] },
        text: 'Inside the FPS system you also need the ladder: **1 ft = 12 in**, **1 mi = 5280 ft**, **1 kip = 1000 lb**, **1 ton = 2000 lb**. Time is the same in both systems.\n\n**The method:** write the quantity with its units, then multiply by factors equal to one, each one turned so the unit you want to get rid of sits on the opposite side of the fraction. Cancel, multiply out, round to 3 s.f. at the very end.',
        formula: 'ch01.table-conv'
      },
      {
        type: 'derive', title: 'Worked: the conveyor controller',
        intro: 'A survivor walks crates onto the conveyor at **3 km/h**. The belt controller is from the caravan and reads **ft/s**. What do we dial in?',
        lines: [
          {
            eq: '3\\frac{\\u{km}}{\\u{h}}',
            why: 'Start from what you know, with its units.'
          },
          {
            eq: '3\\frac{\\strike{\\u{km}}}{\\strike{\\u{h}}}(\\frac{1000\\u{ m}}{1\\u{ }\\strike{\\u{km}}})(\\frac{1\\u{ }\\strike{\\u{h}}}{3600\\u{ s}})',
            why: 'km is on top, so the km factor goes with km on the bottom. h is on the bottom, so the hour factor goes with h on top.',
            ask: {
              q: 'Which way up does the hour factor go?',
              choices: [
                { t: '1 h / 3600 s', correct: true, why: 'h has to sit on top to cancel the h in the denominator.' },
                { t: '3600 s / 1 h', why: 'Then you would have h² on the bottom and s on top: the units tell you it\'s upside down.' }
              ]
            }
          },
          {
            eq: '= 0.8333\\u{ m/s}',
            why: '3 × 1000 / 3600. Keep the extra digits; we are not done.'
          },
          {
            eq: '0.8333\\frac{\\strike{\\u{m}}}{\\u{s}}(\\frac{1\\u{ ft}}{0.3048\\u{ }\\strike{\\u{m}}})',
            why: 'Now trade metres for feet. m is on top, so m goes on the bottom of the factor.',
            ask: {
              q: 'Will the number in ft/s be bigger or smaller than 0.8333?',
              choices: [
                { t: 'Bigger: a foot is shorter than a metre, so it takes more of them.', correct: true, why: 'Right. Smaller unit, bigger number. That\'s a free sanity check.' },
                { t: 'Smaller: feet are an old unit.', why: 'Age has nothing to do with it. A foot is 0.3048 m, shorter than a metre, so more feet fit in the same distance.' }
              ]
            }
          },
          {
            eq: '= \\hl{2.73\\u{ ft/s}}',
            why: '0.8333 / 0.3048 = 2.734, rounded to 3 s.f. at the very end.'
          }
        ],
        outro: 'Each factor was chosen by looking at the units, not by remembering "multiply or divide". If the units cancel, the arithmetic is right way up.'
      },
      {
        type: 'task', id: 'H7.speed', title: 'Set the belt',
        scene: { type: 'track', params: { surface: 'rail', length: 30, trail: true, showVectors: true, bodies: [{ id: 'next', m: 25, x: 6.6, v: 0, mu: 0, label: 'next', kind: 'crate' }, { id: 'belt', m: 25, x: 8, v: 0, mu: 0, label: 'on belt', kind: 'crate' }] } },
        text: 'The heavy crates come on a hand cart pushed at **' + CART_KMH + ' km/h**. Set the belt so it matches the cart exactly. The controller only takes **ft/s**.',
        inputs: [{
          key: 'v', label: 'Belt speed', placeholder: 'e.g. 1.23 ft/s',
          // 5 x 1000 / 3600 = 1.3889 m/s;  1.3889 / 0.3048 = 4.557 ft/s -> 4.56 ft/s
          spec: { value: V_CART, unit: 'm/s', sf: 3, expressIn: 'ft/s' },
          answer: '4.56 ft/s',
          wrong: [
            { input: '1.39 ft/s', kind: 'conversion' },     // stopped at m/s and just wrote ft
            { input: '1.39 m/s', kind: 'form' },            // right speed, wrong units for the dial
            { input: '4.557 ft/s', kind: 'sigfig' }
          ]
        }],
        hints: [
          'Two conversions: km → m and h → s first, then m → ft.',
          'Multiply by (1000 m / 1 km), then (1 h / 3600 s), then (1 ft / 0.3048 m). Check every unit cancels except ft/s.',
          '5 km/h × 1000/3600 = 1.389 m/s, and 1.389 / 0.3048 = 4.557 ft/s, so **4.56 ft/s**.'
        ],
        consequence: speedConsequence,
        explain: '$5\\u{ km/h} \\times \\frac{1000\\u{ m}}{1\\u{ km}} \\times \\frac{1\\u{ h}}{3600\\u{ s}} \\times \\frac{1\\u{ ft}}{0.3048\\u{ m}} = 4.56\\u{ ft/s}$'
      },
      {
        type: 'derive', title: 'Worked: the caravan manifest',
        intro: 'Two lines from the manifest: a tow-strap jerk recorded as **450 lb·s**, and engine-oil sludge at **1.78 slug/ft³**. Into SI, one unit at a time.',
        lines: [
          {
            eq: '450\\u{ }\\strike{\\u{lb}}\\u{·s}(\\frac{4.448\\u{ N}}{1\\u{ }\\strike{\\u{lb}}}) = 2001.6\\u{ N·s}',
            why: 'Only the lb needs converting; seconds are seconds in both systems.'
          },
          {
            eq: '= \\hl{2.00\\u{ kN·s}}',
            why: 'Three significant figures, with a prefix to keep the number between 0.1 and 1000.'
          },
          {
            eq: '1.78\\frac{\\strike{\\u{slug}}}{\\strike{\\u{ft^3}}}(\\frac{14.59\\u{ kg}}{1\\u{ }\\strike{\\u{slug}}})(\\frac{1\\u{ }\\strike{\\u{ft}}}{0.3048\\u{ m}})^{3}',
            why: 'ft³ means ft × ft × ft, so the length factor has to be used three times to cancel it.',
            ask: {
              q: 'Why is the length factor cubed?',
              choices: [
                { t: 'Because ft³ is three feet multiplied together, and each one needs cancelling.', correct: true, why: 'Exactly. Any power on a unit becomes the same power on its factor. Areas square it, volumes cube it.' },
                { t: 'It isn\'t. One factor converts ft³ to m³.', why: 'One factor would leave ft² behind. Write ft³ as ft·ft·ft and count the cancellations.' }
              ]
            }
          },
          {
            eq: '= \\frac{25.97}{0.02832}\\u{ kg/m^3} = \\hl{917\\u{ kg/m^3}}',
            why: '0.3048³ = 0.028 317. Sludge at 917 kg/m³ is lighter than water (1000 kg/m³), so it floats.'
          }
        ],
        outro: 'Same method for every line: write the units, cancel them one at a time, round once at the end.'
      },
      {
        type: 'task', id: 'H7.manifest', title: 'Log the manifest',
        scene: { type: 'track', params: { surface: 'rail', length: 30, trail: true, showVectors: true, bodies: [{ id: 'car', m: CAR_M, x: 18, v: 0, mu: 0, label: 'wreck 1200 kg', kind: 'cart' }] } },
        text: 'Two new lines to put into Kettle Hollow\'s ledger:\n\n- The winch on the rail spur gave the 1200 kg wreck a jerk of **' + J_LBS + ' lb·s**. The crew will build the end stop for the speed your number predicts.\n- The caravan\'s diesel is listed at **1.62 slug/ft³**. The crew will draw it from the separator tank based on whether it floats on water.',
        inputs: [
          {
            key: 'J', label: 'Winch impulse', placeholder: 'e.g. 1.23 kN·s',
            // 820 x 4.448 = 3647.4 N·s -> 3.65 kN·s
            spec: { value: J, unit: 'N*s', sf: 3, form: 'si' },
            answer: '3.65 kN·s',
            wrong: [{ input: '0.820 kN·s', kind: 'conversion' }, { input: '184 N·s', kind: 'conversion' }]
          },
          {
            key: 'rho', label: 'Diesel density', placeholder: 'e.g. 123 kg/m^3',
            // 1.62 x 14.59 = 23.636;  / 0.028 317 = 834.7 kg/m^3 -> 835 kg/m^3
            spec: { value: RHO_DIESEL, unit: 'kg/m^3', sf: 3, form: 'si' },
            answer: '835 kg/m^3',
            wrong: [{ input: '77.5 kg/m^3', kind: 'conversion' }]   // 23.636 / 0.3048: length factor used once, not cubed
          }
        ],
        hints: [
          'Impulse: only the pound needs a factor. Density: both the slug and the cubic foot do.',
          'lb·s × (4.448 N / 1 lb). slug/ft³ × (14.59 kg / 1 slug) × (1 ft / 0.3048 m)³.',
          '820 × 4.448 = 3647 N·s = **3.65 kN·s**. 1.62 × 14.59 / 0.028 317 = 834.7, so **835 kg/m³**.'
        ],
        consequence: manifestConsequence,
        explain: '$820\\u{ lb·s} \\times 4.448\\u{ N/lb} = 3.65\\u{ kN·s}$ and $1.62 \\times \\frac{14.59}{0.3048^3}\\u{ kg/m^3} = 835\\u{ kg/m^3}$. The wreck leaves at J/m = 3.04 m/s, and diesel floats.'
      },
      {
        type: 'task', id: 'H7.convert3', title: 'Three US gauges',
        scene: { type: 'haul', params: { mode: 'axle', quantity: 'force', trueValue: IRON_W, label: 'cast iron 0.200 m³', object: 'crate' } },
        text: 'Three readings off the caravan\'s tools and spec sheets. Give each in SI, with a prefix that keeps the number between 0.1 and 1000.\n\n- The trailer\'s wheel nuts: **150 lb·ft** of torque.\n- The cast-iron scrap you\'re loading weighs **450 lb/ft³** (specific weight). 0.200 m³ of it goes on a trailer picked from your figure.\n- The mud slide by the gate creeps **6 ft/h**. The gate is 3.00 m away.',
        inputs: [
          {
            key: 'T', label: 'Torque', placeholder: 'e.g. 123 N·m',
            // 150 x 4.448 x 0.3048 = 203.36 N·m -> 203 N·m
            spec: { value: TORQUE, unit: 'N*m', sf: 3, form: 'si' },
            answer: '203 N·m',
            wrong: [{ input: '2.19 kN·m', kind: 'conversion' }]     // multiplied by 4.448 and divided by 0.3048
          },
          {
            key: 'gam', label: 'Specific weight', placeholder: 'e.g. 12.3 kN/m^3',
            // 450 x 4.448 = 2001.6 N/ft^3;  / 0.028 317 = 70 686 N/m^3 -> 70.7 kN/m^3
            spec: { value: GAMMA_IRON, unit: 'N/m^3', sf: 3, form: 'si' },
            answer: '70.7 kN/m^3',
            wrong: [{ input: '6.57 kN/m^3', kind: 'conversion' }, { input: '21.5 kN/m^3', kind: 'conversion' }]
          },
          {
            key: 'c', label: 'Creep speed', placeholder: 'e.g. 1.23 mm/s',
            // 6 x 0.3048 = 1.8288 m/h;  / 3600 = 0.000 508 m/s -> 0.508 mm/s
            spec: { value: CREEP, unit: 'm/s', sf: 3, form: 'si' },
            answer: '0.508 mm/s',
            wrong: [{ input: '30.5 mm/s', kind: 'conversion' }, { input: '0.000508 m/s', kind: 'form' }]
          }
        ],
        hints: [
          'lb·ft has a force and a length to convert. lb/ft³ has a force and a *cubed* length. ft/h has a length and a time.',
          '× (4.448 N / 1 lb) for every lb, × (0.3048 m / 1 ft) for every ft on top, × (1 ft / 0.3048 m) for every ft below, × (1 h / 3600 s).',
          '150 × 4.448 × 0.3048 = **203 N·m**. 450 × 4.448 / 0.3048³ = 70 686 N/m³ = **70.7 kN/m³**. 6 × 0.3048 / 3600 = 5.08(10⁻⁴) m/s = **0.508 mm/s**.'
        ],
        consequence: convert3Consequence,
        explain: 'The length factor appears once for lb·ft, cubed (in the denominator) for lb/ft³, and once for ft/h with 3600 s/h. The cast iron then weighs 70.7 kN/m³ × 0.200 m³ = 14.1 kN.'
      },
      {
        type: 'task', id: 'H7.density', title: 'Copper and seawater',
        scene: { type: 'haul', params: { mode: 'lift', quantity: 'mass', options: COPPER_GEAR, trueValue: CU_M, label: 'copper bundle', object: 'drum' } },
        text: 'The caravan wants to trade a bundle of copper wire (**0.0400 m³** of metal, listed at **17.3 slug/ft³**) for seawater ballast for their river raft (2.00 m³ tank; seawater listed at **1.99 slug/ft³**). Give both densities in **Mg/m³**. The crew brings lifting gear rated just above the mass your density gives.',
        inputs: [
          {
            key: 'cu', label: 'Copper density', placeholder: 'e.g. 1.23 Mg/m^3',
            // 17.3 x 14.59 = 252.41;  / 0.028 317 = 8913.8 kg/m^3 -> 8.91 Mg/m^3
            spec: { value: RHO_CU, unit: 'kg/m^3', sf: 3, form: 'si' },
            answer: '8.91 Mg/m^3',
            wrong: [{ input: '0.828 Mg/m^3', kind: 'conversion' }, { input: '8910 kg/m^3', kind: 'sigfig' }]
          },
          {
            key: 'sw', label: 'Seawater density', placeholder: 'e.g. 1.23 Mg/m^3',
            // 1.99 x 14.59 = 29.034;  / 0.028 317 = 1025.3 kg/m^3 -> 1.03 Mg/m^3
            spec: { value: RHO_SEA, unit: 'kg/m^3', sf: 3, form: 'si' },
            answer: '1.03 Mg/m^3',
            wrong: [{ input: '29.0 kg/m^3', kind: 'conversion' }]
          }
        ],
        hints: [
          'Same pattern as the sludge: a slug factor and a cubed length factor.',
          '× (14.59 kg / 1 slug) × (1 ft / 0.3048 m)³, then 1 Mg = 1000 kg.',
          '17.3 × 14.59 / 0.028 317 = 8914 kg/m³ = **8.91 Mg/m³**. 1.99 × 14.59 / 0.028 317 = 1025 kg/m³ = **1.03 Mg/m³**.'
        ],
        consequence: densityConsequence,
        explain: 'Both use 14.59 / 0.3048³ = 515.2 (kg/m³)/(slug/ft³). Copper: 8.91 Mg/m³, so the bundle is 356.6 kg. Seawater: 1.03 Mg/m³, a little denser than fresh water.'
      },
      {
        type: 'task', id: 'H7.pressure', title: 'Snow and tires',
        text: 'Pressure is force over area, so it needs the force factor **and** the length factor squared.\n\n- The wagons have roofs rated **25 lb/ft²**. Wet snow on the sheds is loading them at **1.00 kPa**. Write 1.00 kPa in lb/ft² so the caravan can decide whether to park under them.\n- Their trailer tires say **32.0 psi** (lb/in²). The depot\'s pump gauge reads kPa.',
        inputs: [
          {
            key: 'q', label: '1.00 kPa in FPS', placeholder: 'e.g. 12.3 lb/ft^2',
            // 1000 N/m^2 x (1 lb / 4.448 N) x (0.3048 m / 1 ft)^2 = 1000 x 0.092 903 / 4.448 = 20.89 lb/ft^2 -> 20.9 lb/ft^2
            spec: { value: 1000, unit: 'Pa', sf: 3, expressIn: 'lb/ft^2' },
            answer: '20.9 lb/ft^2',
            wrong: [{ input: '68.5 lb/ft^2', kind: 'conversion' }]    // length factor used once, upside down
          },
          {
            key: 'p', label: 'Tire pressure', placeholder: 'e.g. 123 kPa',
            // 32.0 x 4.448 = 142.34 N/in^2;  / 0.0254^2 (6.4516(10^-4)) = 220 620 Pa -> 221 kPa
            spec: { value: TIRE, unit: 'Pa', sf: 3, form: 'si' },
            answer: '221 kPa',
            wrong: [{ input: '5.60 kPa', kind: 'conversion' }]      // used 0.0254 once instead of squared
          }
        ],
        hints: [
          'Both are force per area. Convert the force with 4.448 and the area with the length factor **squared**.',
          'kPa → lb/ft²: × (1 lb / 4.448 N) × (0.3048 m / 1 ft)². psi → Pa: × (4.448 N / 1 lb) × (12 in / 0.3048 m)², since 1 in = 0.0254 m.',
          '1000 × 0.3048² / 4.448 = **20.9 lb/ft²**. 32.0 × 4.448 / 0.0254² = 220 620 Pa = **221 kPa**.'
        ],
        consequence: pressureConsequence,
        explain: '$1\\u{ kPa} = 20.9\\u{ lb/ft^2}$ and $32.0\\u{ psi} = 221\\u{ kPa}$. The length factor is squared because pressure has an area underneath.'
      },
      {
        type: 'say', who: 'hask',
        text: 'Last job before the caravan leaves. Juno wants a concrete bollard at the east gate to stop anything with wheels ramming it. The pour is done: a solid cylinder **400 mm** across and **1.20 m** long, concrete at **2.40 Mg/m³**. The crew\'s lifting gear is all rated in pounds.\n\nThis one starts in SI and ends in FPS, and it needs W = mg on the way.'
      },
      {
        type: 'task', id: 'H7.bollard', title: 'Move the bollard',
        scene: { type: 'haul', params: { mode: 'lift', quantity: 'force', options: BOLLARD_GEAR, trueValue: BOL_W, label: 'concrete bollard', object: 'bollard' } },
        text: 'Give the bollard\'s **weight in pounds**. The crew takes the lifting gear rated just above your figure, then lifts the real thing.',
        inputs: [{
          key: 'W', label: 'Bollard weight', placeholder: 'e.g. 123 lb',
          // V = pi (0.200)^2 (1.20) = 0.150 80 m^3;  m = 2400 x 0.150 80 = 361.91 kg
          // W = 361.91 x 9.81 = 3550.4 N;  / 4.448 = 798.2 lb -> 798 lb
          spec: { value: BOL_W, unit: 'N', sf: 3, expressIn: 'lb' },
          answer: '798 lb',
          wrong: [
            { input: '3.55 kip', kind: 'conversion' },     // the newton figure, relabelled as 3550 lb
            { input: '81.4 lb', kind: 'concept' },         // mass in kg divided by 4.448: forgot g
            { input: '3190 lb', kind: 'algebra' }          // used the diameter as the radius
          ]
        }],
        hints: [
          'Volume first (a cylinder: π r² L, with r = half the diameter), then mass, then weight, then pounds.',
          'V = π (0.200 m)² (1.20 m). m = ρV with ρ = 2400 kg/m³. W = mg. Then × (1 lb / 4.448 N).',
          'V = 0.1508 m³, m = 361.9 kg, W = 3550 N, and 3550 / 4.448 = **798 lb**.'
        ],
        consequence: bollardConsequence,
        explain: '$V = \\pi(0.200)^2(1.20) = 0.1508\\u{ m^3}$, $m = 361.9\\u{ kg}$, $W = 3550\\u{ N}$, and $3550\\u{ N} \\times \\frac{1\\u{ lb}}{4.448\\u{ N}} = 798\\u{ lb}$.'
      },
      {
        type: 'deeper', title: 'When the fourth digit matters',
        teaser: '4.448 is a rounded number, and in 1999 a spacecraft was lost to a pound-second.',
        steps: [
          { type: 'say', who: 'hask', text: 'The pound-force is defined exactly: the weight of 0.453 592 37 kg under standard gravity 9.806 65 m/s². That makes **1 lb = 4.448 221 615 260 5 N**, exactly. The table\'s 4.448 drops about 0.005 %.\n\nFor a 3-figure answer that never matters. It starts to matter when you chain many conversions, or when a small error is multiplied by something huge: an orbit, a long lever, a big tank.' },
          { type: 'predict', who: 'hask', q: 'Using 4.448 instead of 4.448 222, roughly how far off is a 1 000 000 lb rocket thrust in newtons?', choices: [
            { t: 'Less than a newton.', why: 'The relative error is about 5(10⁻⁵), and that times 4.45 MN is a couple of hundred newtons.' },
            { t: 'About 200 N.', correct: true, why: '1 000 000 × (4.448 222 − 4.448) = 222 N. Small next to 4.45 MN, but big enough to show up in a precision trajectory.' },
            { t: 'About 4 kN.', why: 'That would be a 0.1 % error. The table factor is better than that.' }
          ] },
          { type: 'say', who: 'hask', text: 'The **Mars Climate Orbiter** (1999) was lost the other way round: not a rounded digit but a missing factor. One team\'s software reported thruster impulses in **lb·s**, and the navigation software read them as **N·s**. Every small trajectory correction was under-counted by a factor of 4.45. Over months the errors added up, the probe arrived far too low and burned up in the Martian atmosphere.\n\nThat is exactly the mistake the winch task above would catch. Units are part of the number.' }
        ]
      },
      {
        type: 'sandbox',
        scene: { type: 'haul', params: { mode: 'lift', quantity: 'force', options: BOLLARD_GEAR, trueValue: BOL_W, label: 'concrete bollard', object: 'bollard' } },
        text: 'The bollard yard. Hand the crew any figure and set the true load. The clipboard shows every rating in both SI and FPS.',
        controls: ['claimed', 'trueValue', 'safety'],
        prompts: [
          'Give the crew the bollard\'s weight in newtons but call it pounds (3550). What do they bring?',
          'Forget g and hand them the mass, 362, as if it were the weight in pounds. What happens?',
          'Raise the safety factor to 1.3. Does the appliance dolly still hold if your figure was 10 % low?'
        ]
      },
      {
        type: 'summary', unlock: 'converter',
        points: [
          '**1 lb = 4.448 N**, **1 slug = 14.59 kg**, **1 ft = 0.3048 m**. Inside FPS: 12 in = 1 ft, 5280 ft = 1 mi, 1000 lb = 1 kip, 2000 lb = 1 ton.',
          'A conversion factor is a fraction equal to one. Turn it so the unwanted unit cancels, and chain as many as you need.',
          'Powers carry over: area units square the length factor, volume units cube it. Density, specific weight and pressure all have one of these underneath.',
          'Keep full precision through the chain and round to **3 s.f.** once, at the end.',
          'You now have the **unit converter** in your workshop. It shows its cancellation chain, so you can still check its working.'
        ]
      }
    ]
  });
})(globalThis.SE);
