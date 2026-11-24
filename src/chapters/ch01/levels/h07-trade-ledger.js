/*
 * H7 · Trade Ledger: converting between U.S. Customary (FPS) and SI units.
 * Conversion factors (lb ↔ N, slug ↔ kg, ft ↔ m and the FPS ladder of in,
 * mi, kip and ton), the "multiply by one" method with unit cancellation,
 * and powers of the length factor for areas and pressures. Course section 1.3.
 *
 * Played in the build yard. The caravan's slings carry plates in lb, kip and
 * ton, and its hydraulic tank reads psi, but the loads are specified in SI.
 * The player rigs the caravan's gear to SI loads, and a conversion slip
 * shows up as a snapped sling or a ram that never lifts.
 *
 * Numbers (4-figure factors 4.448 N/lb, 14.59 kg/slug, 0.3048 m/ft):
 *   Test frame: 250 lb sling = 1112 N. 100 kg crate, W = 981 N: holds (88 %).
 *     150 kg, W = 1472 N: snaps, although 150 looks well under 250.
 *   Bollard: solid concrete, Ø 400 mm, 1.20 m long, 2.40 Mg/m³.
 *     V = π(0.200)²(1.20) = 0.1508 m³, m = 361.9 kg, W = 3550 N = 798 lb.
 *     Slings: 600 lb (2669 N, snaps), 1 kip (4448 N, 80 %, the right pick),
 *     2.5 kip (11.1 kN, oversized), 4 ton (35.6 kN, far oversized).
 *   Tank: 32.0 psi = 32.0 × 4.448 / 0.0254² = 220.6 kPa. Bore 100 mm,
 *     A = 7.854(10⁻³) m², F = 1733 N. Bore 50 mm: F = 433 N (a quarter).
 *   Hatch: 150 kg (W = 1472 N) under two 120 lb (534 N each) check straps. The ram
 *     lifts it when pA > 1472 N and snaps the straps when pA - W > 2 × 534 = 1068 N:
 *     187 kPa < p < 323 kPa, i.e. 27.2 psi < p < 46.9 psi.
 *     A kPa figure typed as psi (221 psi) pushes 12.0 kN and snaps the straps;
 *     the psi figure typed as kPa (32 kPa) pushes 251 N and nothing moves.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial;

  var LB = 4.448, IN = 0.0254, G0 = 9.81;
  var f3 = function (x) { return D.fmtNum(x, 3); };
  var kN = function (N) { return D.format(N, D.autoUnit(N, 'force'), 3, 'force'); };

  // The caravan's slings, stamped in FPS. The plate is the breaking load.
  var PLATES = ['120 lb', '250 lb', '600 lb', '1 kip', '2.5 kip', '4 ton'];
  function plateN(text) { var r = D.parse(text, 'force'); return r.ok ? r.si : NaN; }

  // The bollard: our own, so it is specified in SI.
  var BOL = { d: 0.400, L: 1.20, rho: 2400 };
  var BOL_M = BOL.rho * Math.PI * BOL.d * BOL.d / 4 * BOL.L;     // 361.9 kg
  var BOL_W = BOL_M * G0;                                         // 3550 N

  // The hatch rig.
  var HATCH_M = 150, BORE = 0.100, STRAP = '120 lb';
  var AREA = Math.PI * BORE * BORE / 4;                           // 7.854e-3 m^2

  /* ----------------------------------------------------------- the yards */

  // Hask's test frame: a hook on a gantry and a crate the brake lets go of at Run.
  var FRAME = {
    site: { g: G0, floor: 'concrete' },
    camera: { fit: { lo: { x: -4, y: -0.5 }, hi: { x: 4, y: 5.5 } } },
    poke: false,
    design: { parts: [
      { id: 'gantry', type: 'hook', x: 0, y: 4.6, locked: true, label: 'test gantry' },
      { id: 'crate', type: 'crate', x: 0, y: 2.6, dials: { mass: '100 kg' }, locked: true, open: ['mass'], label: 'test crate' }
    ] }
  };

  // The bollard on the caravan trailer under the jib. Juno drives the trailer out at 1 s.
  var DOCK = {
    site: { g: G0, floor: 'concrete' },
    camera: { fit: { lo: { x: -4, y: -0.5 }, hi: { x: 9, y: 5 } } },
    poke: false,
    readouts: ['sling.tension'],
    design: { parts: [
      { id: 'jib', type: 'hook', x: 0, y: 3.4, locked: true, label: 'jib hook' },
      { id: 'trailer', type: 'cart', x: 0, y: 0.25, dials: { mass: '200 kg' }, locked: true, label: 'caravan trailer' },
      { id: 'bollard', type: 'h07-bollard', x: 0, y: 0.5 + BOL.L / 2, locked: true, label: 'bollard' },
      { id: 'tow', type: 'push', a: { part: 'trailer' }, dials: { force: '800 N', angle: '0 deg', time: '1.5 s', start: '1 s' }, locked: true, label: 'Juno drives off' }
    ] }
  };

  // The caravan tank and ram under a crate (the bench) or the deck hatch (the job).
  // The tank stands on the yard with its port on top; the closed ram is 0.3 m.
  var LOAD_Y = 1.0 + 0.3 + 0.5;
  function rig(load, straps) {
    var parts = [
      { id: 'tank', type: 'tank', x: 0, y: 0.5, dials: { pressure: '32.0 psi', bore: '100 mm' }, locked: true, open: ['pressure', 'bore'], label: 'caravan tank' },
      { id: 'load', type: 'crate', x: 0, y: LOAD_Y, dials: { mass: load.mass }, locked: true, label: load.label }
    ];
    if (straps) {
      // two check straps tied down either side: they go taut once the hatch has risen 0.1 m
      parts.push({ id: 'tieL', type: 'hook', x: -0.5, y: 0.15, locked: true, label: 'tie-down' });
      parts.push({ id: 'tieR', type: 'hook', x: 0.5, y: 0.15, locked: true, label: 'tie-down' });
      // the hatch frame: guide rails either side keep a pin-ended ram from tipping it
      parts.push({ id: 'railL', type: 'block', x: -0.605, y: LOAD_Y + 0.4, dials: { width: '0.2 m', height: '1.8 m' }, locked: true, label: 'hatch frame' });
      parts.push({ id: 'railR', type: 'block', x: 0.605, y: LOAD_Y + 0.4, dials: { width: '0.2 m', height: '1.8 m' }, locked: true, label: 'hatch frame' });
    }
    parts.push({ id: 'ram', type: 'ram', a: { part: 'tank', anchor: 'port' }, b: { part: 'load', anchor: 'bottom' }, dials: { stroke: '0.6 m' }, locked: true, label: 'ram' });
    if (straps) {
      var len = (LOAD_Y - 0.15 + 0.1).toFixed(2) + ' m';
      parts.push({ id: 'strapL', type: 'h07-sling', a: { part: 'tieL', anchor: 'eye' }, b: { part: 'load', anchor: 'left' }, dials: { plate: STRAP, length: len }, locked: true, label: 'check strap' });
      parts.push({ id: 'strapR', type: 'h07-sling', a: { part: 'tieR', anchor: 'eye' }, b: { part: 'load', anchor: 'right' }, dials: { plate: STRAP, length: len }, locked: true, label: 'check strap' });
    }
    return {
      site: { g: G0, floor: 'concrete' },
      camera: { fit: { lo: { x: -3.5, y: -0.5 }, hi: { x: 3.5, y: 3.2 } } },
      poke: false,
      readouts: straps ? ['tank.force', 'ram.extension', 'strapL.tension', 'strapR.tension'] : ['tank.force', 'ram.extension'],
      design: { parts: parts }
    };
  }
  var BENCH = rig({ mass: '50 kg', label: 'test crate' }, false);
  var HATCH = rig({ mass: HATCH_M + ' kg', label: 'deck hatch' }, true);
  HATCH.design.parts[0].dials.pressure = '10 psi';

  /* ------------------------------------------------------------- helpers */

  function slingOn(ctx, from, to) {
    return ctx.all('h07-sling').filter(function (p) {
      var ends = [p.a && p.a.part, p.b && p.b.part];
      return ends.indexOf(from) >= 0 && ends.indexOf(to) >= 0;
    })[0] || null;
  }
  function broke(r, id) { return !!(r && r.state && r.state.breaks.some(function (b) { return !id || b.part === id; })); }
  function slingOf(s) {
    var ids = Object.keys(s.built.parts).filter(function (k) { return s.built.parts[k].def.type === 'h07-sling'; });
    return ids.length ? s.built.parts[ids[0]] : null;
  }
  function aloft(s) { var p = s.pos('bollard'); return p && p.y > 0.5 + BOL.L / 2 - 0.03; }
  function trailerGone(s) { var p = s.pos('trailer'); return p && p.x > BOL.d / 2 + 0.8 + 0.1; }
  function lift(s) { var p = s.pos('load'); return p ? p.y - LOAD_Y : 0; }

  /* --------------------------------------------------------------- goals */

  var BOLLARD_GOAL = G.all(
    G.noBreaks(null),
    G.never(function (s) { var p = s.pos('bollard'); return p && p.y < 0.5 + BOL.L / 2 - 0.15 ? 'The bollard dropped off the trailer onto the yard.' : null; }),
    G.holdFor('bollard-hung', function (s) { return trailerGone(s) && aloft(s) && s.speed('bollard') < 0.3; }, 3)
  );
  var HATCH_GOAL = G.all(
    G.noBreaks(null),
    G.holdFor('hatch-up', function (s) { return lift(s) > 0.05 && s.speed('load') < 0.05; }, 2)
  );

  SE.content.registerLevel('ch01', {
    id: 'H7', order: 7, title: 'Trade Ledger',
    subtitle: 'Converting between FPS and SI',
    sections: ['1.3'],
    minutes: 25,
    intro: [
      'A trade caravan has rolled in from the southern freight yards. Their gear is all American-made: slings stamped in pounds and kips, a hydraulic tank that reads psi, manifests in slugs. Kettle Hollow runs on SI.',
      'Hask has the caravan\'s ledger open on a crate. "Every number on this page is right, and every one of them will hurt someone if we read it in the wrong units. Let\'s make the two systems talk to each other, on the test frame first."'
    ].join('\n\n'),
    goals: [
      'Use the FPS–SI factors: **1 lb = 4.448 N**, **1 slug = 14.59 kg**, **1 ft = 0.3048 m**',
      'Convert by multiplying by factors equal to one, arranged so the units cancel',
      'Square or cube the length factor for areas, volumes, densities and pressures',
      'Report converted results to three significant figures'
    ],
    unlocks: { tools: ['converter'], formulas: ['ch01.table-conv'] },
    yard: FRAME,
    // Reference builds for the scored jobs (checked by tests/yard.test.js).
    solutions: {
      'H7.bollard': [
        { add: [{ type: 'h07-sling', id: 'sling', a: { part: 'jib', anchor: 'eye' }, b: { part: 'bollard', anchor: 'top' }, dials: { plate: '1 kip' } }] },
        { add: [{ type: 'h07-sling', id: 'sling', a: { part: 'jib', anchor: 'eye' }, b: { part: 'bollard', anchor: 'top' }, dials: { plate: '2.5 kip' } }] },
        // 362 kg read as 362 lb: the 600 lb sling looks ample and snaps
        { pass: false, add: [{ type: 'h07-sling', id: 'sling', a: { part: 'jib', anchor: 'eye' }, b: { part: 'bollard', anchor: 'top' }, dials: { plate: '600 lb' } }] },
        { pass: false, add: [{ type: 'h07-sling', id: 'sling', a: { part: 'jib', anchor: 'eye' }, b: { part: 'bollard', anchor: 'top' }, dials: { plate: '250 lb' } }] }
      ],
      'H7.hatch': [
        { set: { tank: { pressure: '32.0 psi' } } },
        { set: { tank: { pressure: '40 psi' } } },
        { set: { tank: { pressure: '276 kPa' } } },
        { set: { tank: { pressure: '44 psi' } } },
        { pass: false, set: { tank: { pressure: '50 psi' } } },
        // the kPa figure typed as psi: 12 kN on the ram, the straps snap
        { pass: false, set: { tank: { pressure: '221 psi' } } },
        // 220.6 kPa turned into "psi" with 0.0254 not squared: 1260 psi, the straps snap
        { pass: false, set: { tank: { pressure: '1260 psi' } } },
        // the psi figure typed as kPa: 251 N on the ram, the hatch stays shut
        { pass: false, set: { tank: { pressure: '32 kPa' } } },
        { pass: false, set: { tank: { pressure: '25 psi' } } }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Three factors carry almost everything between the two systems:\n\n- **1 lb = 4.448 N** (force)\n- **1 slug = 14.59 kg** (mass)\n- **1 ft = 0.3048 m** (length)\n\nThe caravan\'s slings are stamped in pounds. Our loads are written in kilograms and newtons. Before anything of ours hangs on anything of theirs, we prove it on the test frame.'
      },
      {
        type: 'build', who: 'hask',
        yard: { bin: [{ type: 'h07-sling', count: 1 }], ghosts: [{ type: 'h07-sling', x: 0, y: 3.6, text: 'gantry to crate' }] },
        text: 'Take the **caravan sling** from the bin and rig it from the **gantry hook** to the **top of the crate**: click one, then the other.\n\nSelect the sling to read its plate. Leave it on **250 lb** for now.',
        goalText: 'A sling from the gantry to the crate',
        until: function (ctx) {
          var s = slingOn(ctx, 'gantry', 'crate');
          if (!s) return ctx.find('h07-sling') ? 'Both ends go on the **gantry hook** and the **crate**.' : false;
          return s.dials.plate === '250 lb' ? true : 'Set the plate back to **250 lb** for this test.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.all(G.noBreaks(null), G.after(3)) },
        text: 'The crate is **100 kg**, and the plate says **250 lb**. Press **▶ Run**: the brake lets go and the sling takes the crate. Watch the **tension** gauge. Type **lb** into its unit box to read it the caravan\'s way.',
        goalText: 'Run it and let it hang',
        until: function (ctx, type) { return type === 'result' && !!ctx.result && !broke(ctx.result) && !!slingOn(ctx, 'gantry', 'crate'); },
        after: function (ctx) {
          var W = ctx.si('crate', 'mass') * G0;
          return 'It holds. The sling carries **' + f3(W) + ' N**, which is **' + f3(W / LB) + ' lb**: about three quarters of its plate.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.all(G.noBreaks(null), G.after(3)) },
        text: 'Juno wants to know if the same sling takes a **150 kg** crate. "It\'s rated 250, the crate is 150. A hundred to spare."\n\nSet the crate to **150 kg** and run it.',
        goalText: 'Crate at 150 kg, and run',
        until: function (ctx, type) {
          var m = ctx.si('crate', 'mass');
          if (!(Math.abs(m - 150) < 0.5)) return Math.abs(m - 100) < 0.5 ? false : 'Set the mass to **150 kg**.';
          if (!slingOn(ctx, 'gantry', 'crate')) return 'Put the sling back between the gantry and the crate.';
          if (slingOn(ctx, 'gantry', 'crate').dials.plate !== '250 lb') return 'Keep the **250 lb** plate.';
          return type === 'result' && !!ctx.result;
        },
        after: function (ctx) { return broke(ctx.result) ? '**Snap.** 150 kg weighs **1470 N**, and 250 lb is only **1110 N**. "A hundred to spare" compared a mass in kilograms with a force in pounds: two different units, so the numbers said nothing.' : 'Run it once more with the 300 lb plate.'; }
      },
      {
        type: 'rule', title: 'Multiply by one',
        law: '\\frac{4.448\\u{ N}}{1\\u{ lb}} = 1',
        eq: function () {
          return '250\\u{ \\strike{lb}} \\times \\frac{4.448\\u{ N}}{1\\u{ \\strike{lb}}} = 1112\\u{ N} \\quad < \\quad (150\\u{ kg})(9.81\\u{ m/s^2}) = 1472\\u{ N}';
        },
        text: 'Numbers in different units can\'t be compared. Change one of them first. A **conversion factor** is a fraction whose top and bottom are the same amount, so it equals one, and multiplying by it changes the units without changing the quantity. Turn it so the unit you don\'t want **cancels**: lb on the bottom to get rid of lb.\n\nChain as many factors as you need. A walker\'s 3 km/h on a belt controller that reads ft/s:\n\n$3\\u{ \\strike{km}/\\strike{h}} \\times \\frac{1000\\u{ \\strike{m}}}{1\\u{ \\strike{km}}} \\times \\frac{1\\u{ ft}}{0.3048\\u{ \\strike{m}}} \\times \\frac{1\\u{ \\strike{h}}}{3600\\u{ s}} = 2.73\\u{ ft/s}$'
      },
      {
        type: 'reveal', kicker: 'Table', title: 'Conversion factors',
        eq: '1\\u{ lb} = 4.448\\u{ N} \\qquad 1\\u{ slug} = 14.59\\u{ kg} \\qquad 1\\u{ ft} = 0.3048\\u{ m}',
        text: 'Inside FPS there is a ladder of its own: **12 in = 1 ft**, **5280 ft = 1 mi**, **1 kip = 1000 lb** (kip is short for kilo-pound) and **1 ton = 2000 lb**. The caravan stamps its heavier slings in kips and tons.\n\nThe slug is the FPS unit of mass: the mass that 1 lb accelerates at 1 ft/s². A pound is a **force**, never a mass, in this course.',
        formula: 'ch01.table-conv'
      },
      {
        type: 'job', id: 'H7.bollard', who: 'juno',
        yard: Object.assign({}, DOCK, { bin: [{ type: 'h07-sling', count: 1 }], ghosts: [{ type: 'h07-sling', x: 0, y: 2.5, text: 'jib to bollard' }] }),
        text: 'Juno has a concrete **bollard** on the caravan trailer: solid, **400 mm** across, **1.20 m** long, concrete at **2.40 Mg/m³**. It has to hang from the jib when Juno drives the trailer out at **1 s**.\n\nRig **one caravan sling** from the jib hook to the bollard and pick its plate: they run from **120 lb** up to **4 ton**. Too light snaps. Too heavy ties up gear the ration dock needs.',
        goalText: 'Bollard hanging from the jib for 3 s after the trailer leaves, sling intact',
        goal: BOLLARD_GOAL,
        timeout: 12,
        timeoutText: 'The bollard never hung clear of the trailer. Is a sling rigged from the jib to it?',
        onFail: function (ctx) {
          var r = ctx.result, s = r && r.state, b = s && s.breaks[0];
          if (b) return 'The sling let go at **' + kN(b.force) + '**. Work out the bollard\'s weight in newtons, then turn the plate into newtons too.';
          return '';
        },
        hints: [
          'Find the weight in SI first: volume of a cylinder $V = \\pi r^2 L$, then $m = \\rho V$, then $W = mg$.',
          '$V = \\pi(0.200\\u{ m})^2(1.20\\u{ m}) = 0.1508\\u{ m^3}$, $m = 362\\u{ kg}$, $W = 3550\\u{ N}$. Now put each plate into newtons: 1 kip = 1000 lb.',
          '$3550\\u{ N} \\times \\frac{1\\u{ lb}}{4.448\\u{ N}} = 798\\u{ lb}$. The 600 lb sling is too light. The **1 kip** (1000 lb, 4.45 kN) is the smallest that holds.'
        ],
        margin: function (s) {
          var sl = slingOf(s); if (!sl) return 0;
          var ratio = plateN(sl.inst.dials.plate) / BOL_W;
          return ratio > 2.5 ? (ratio > 6 ? 30 : 15) : 0;
        },
        success: function (ctx) {
          var sl = ctx.find('h07-sling'), p = sl ? plateN(sl.dials.plate) : NaN;
          var base = 'It hangs. The bollard weighs **3550 N = 798 lb**, and your **' + (sl ? sl.dials.plate : '') + '** sling breaks at **' + kN(p) + '**.';
          return p > 2.5 * BOL_W ? base + ' It holds, but Juno had to take it off the ration dock. The **1 kip** sling was enough.' : base + ' The lightest plate that holds, at ' + Math.round(BOL_W / p * 100) + ' % of its rating.';
        }
      },
      {
        type: 'say', who: 'hask',
        text: 'Now the caravan\'s **hydraulic tank**. Its gauge reads **psi**: pounds per square inch. That is a force over an **area**, and an area has the length unit in it **twice**.'
      },
      {
        type: 'watch', who: 'hask',
        yard: Object.assign({}, BENCH, { bin: [], goal: G.after(3) }),
        text: 'The tank drives a ram that pushes on a 50 kg test crate. Its gauge is at **32.0 psi**, the pressure the caravan keeps its tires at, and the ram\'s bore is **100 mm**. Run it and read the **piston force** gauge.',
        goalText: 'Run the ram at 32.0 psi, 100 mm bore',
        until: function (ctx, type) { return type === 'result' && !!ctx.result && Math.abs(ctx.si('tank', 'bore') - 0.1) < 1e-6; },
        after: function (ctx) { var F = ctx.si('tank', 'pressure') * AREA; return 'The piston pushes **' + f3(F) + ' N**. Force = pressure × area, with the area of the piston face $\\pi d^2/4$.'; }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(3) },
        text: 'Halve the bore: set it to **50 mm**. Same pressure. Run it again and watch the piston force.',
        goalText: 'Bore at 50 mm, and run',
        until: function (ctx, type) {
          var d = ctx.si('tank', 'bore');
          if (!(Math.abs(d - 0.05) < 1e-6)) return Math.abs(d - 0.1) < 1e-6 ? false : 'Set the bore to **50 mm**.';
          return type === 'result' && !!ctx.result;
        },
        after: function (ctx) { var F = ctx.si('tank', 'pressure') * Math.PI * 0.05 * 0.05 / 4; return 'Half the bore, **a quarter** of the force: **' + f3(F) + ' N**. The area goes with the length **squared**, and so does the length factor when you convert an area.'; }
      },
      {
        type: 'rule', title: 'Powers of the length factor',
        law: '1\\u{ in} = 0.0254\\u{ m} \\quad \\Rightarrow \\quad 1\\u{ in^2} = 6.452(10⁻⁴)\\u{ m^2}',
        eq: function (ctx) {
          var p = ctx.si('tank', 'pressure');
          return f3(p / (LB / (IN * IN))) + '\\u{ \\strike{lb}/\\strike{in^2}} \\times \\frac{4.448\\u{ N}}{1\\u{ \\strike{lb}}} \\times \\left(\\frac{1\\u{ \\strike{in}}}{0.0254\\u{ m}}\\right)^2 = ' + f3(p / 1000) + '\\u{ kPa}';
        },
        text: 'To convert **lb/in²** you need the force factor once and the length factor **twice**, because the inch appears squared. Volumes and densities take it **cubed**: $1\\u{ ft^3} = (0.3048\\u{ m})^3 = 0.028\\,32\\u{ m^3}$.\n\nForgetting the square is the classic slip. It leaves the answer off by a factor of about 39, and no gauge will warn you.'
      },
      {
        type: 'job', id: 'H7.hatch', who: 'juno',
        yard: Object.assign({}, HATCH, { bin: [] }),
        text: 'The caravan\'s ram lifts the **deck hatch** of the water cistern: **150 kg**. Two **check straps**, each stamped **120 lb**, stop it at the top. The bore is fixed at **100 mm**.\n\nSet the **tank pressure** so the ram lifts the hatch against the straps and holds it there. Too little and the hatch stays shut. Too much and the ram tears the straps.',
        goalText: 'Hatch lifted and held against the straps for 2 s, straps intact',
        goal: HATCH_GOAL,
        timeout: 10,
        timeoutText: 'The hatch never lifted: the ram pushes less than the hatch weighs.',
        onFail: function (ctx) {
          var F = ctx.si('tank', 'pressure') * AREA;
          var r = ctx.result, b = r && r.state && r.state.breaks[0];
          if (b) return 'The ram pushed **' + kN(F) + '**. The hatch takes **1.47 kN** of that, and the straps the rest, which is more than their **2 × 120 lb = 1.07 kN**.';
          return 'The ram pushed **' + kN(F) + '**, less than the hatch\'s **1.47 kN**.';
        },
        hints: [
          'The ram has to push more than the hatch weighs, but not by more than the two straps can hold between them. Work in newtons: $W = mg$, and 2 × 120 lb into N.',
          'The force window is $1472\\u{ N} < F < 1472 + 1068 = 2540\\u{ N}$. The piston area is $\\pi(0.100\\u{ m})^2/4 = 7.854(10^{-3})\\u{ m^2}$, so $p = F/A$.',
          'That gives **187 kPa to 323 kPa**. In psi, divide by $4.448 / 0.0254^2 = 6895$ Pa per psi: **27.2 psi to 46.9 psi**. You can type the dial in either unit.'
        ],
        margin: function (s) {
          // a strap working near its rating wears; the middle of the window is best
          // read once the hatch has settled against it, so the snatch as it goes tight doesn't count
          return Math.max(s.read('strapL.tension'), s.read('strapR.tension')) > 0.85 * plateN(STRAP) ? 10 : 0;
        },
        success: function (ctx) {
          var p = ctx.si('tank', 'pressure'), F = p * AREA;
          return 'Up and held. **' + f3(p / 1000) + ' kPa** on **7.854(10⁻³) m²** is **' + f3(F) + ' N**: the hatch takes 1472 N and the two straps share the other **' + f3(F - HATCH_M * G0) + ' N**, inside their 1068 N.';
        }
      },
      {
        type: 'deeper', title: 'When the fourth digit matters',
        teaser: '4.448 is a rounded number, and in 1999 a spacecraft was lost to a pound-second.',
        steps: [
          { type: 'say', who: 'hask', text: 'The pound-force is defined exactly: the weight of 0.453 592 37 kg under standard gravity 9.806 65 m/s². That makes **1 lb = 4.448 221 615 260 5 N**, exactly. The table\'s 4.448 drops about 0.005 %.\n\nFor a 3-figure answer that never matters. On a 1 000 000 lb rocket thrust it is 1 000 000 × 0.000 222 = **222 N**: small next to 4.45 MN, but big enough to show up in a precision trajectory.' },
          { type: 'say', who: 'hask', text: 'The **Mars Climate Orbiter** (1999) was lost the other way round: not a rounded digit but a missing factor. One team\'s software reported thruster impulses in **lb·s**, and the navigation software read them as **N·s**. Every small trajectory correction was under-counted by a factor of 4.45. Over months the errors added up, the probe arrived far too low and burned up in the Martian atmosphere.\n\nIt is the same slip that snapped the test sling. Units are part of the number.' }
        ]
      },
      {
        type: 'free', who: 'hask',
        yard: { design: FRAME.design, bin: [{ type: 'h07-sling', count: 2 }, { type: 'crate', count: 2 }, { type: 'hook', count: 2 }], goal: null, poke: true },
        text: 'The test frame is yours. Every dial takes FPS or SI, so try both. While it runs you can **drag the crate** to shock-load the sling.',
        prompts: [
          'Set the crate\'s mass in **slug**. What is the heaviest whole number of slugs the 1 kip sling will hold?',
          'Find the heaviest crate the **250 lb** sling holds, in kg. Check it against 250 × 4.448 / 9.81.',
          'Hang a crate and give it a yank. Why does a sling that holds a still load snap when it is jerked?'
        ]
      },
      {
        type: 'summary', unlock: 'converter',
        points: [
          '**1 lb = 4.448 N**, **1 slug = 14.59 kg**, **1 ft = 0.3048 m**. Inside FPS: 12 in = 1 ft, 5280 ft = 1 mi, 1000 lb = 1 kip, 2000 lb = 1 ton.',
          'Never compare numbers in different units. A conversion factor is a fraction equal to one: turn it so the unwanted unit cancels, and chain as many as you need.',
          'Powers carry over: area units square the length factor, volume units cube it. Pressure, density and specific weight all have one of these underneath.',
          'Keep full precision through the chain and round to **3 s.f.** once, at the end.',
          'You now have the **unit converter** in your workshop. It shows its cancellation chain, so you can still check its working.'
        ]
      }
    ]
  });

  /* ------------------------------------------------- parts for this level */

  // A sling from the caravan: a rope whose plate is stamped in FPS. The plate
  // is the breaking load, so the player picks a plate, not a number.
  Y.definePart({
    type: 'h07-sling', name: 'Caravan sling', category: 'Rigging',
    blurb: 'A wire-rope sling from the caravan. The plate is its breaking load, stamped in FPS units.',
    size: { w: 0.1, h: 2 },
    connector: true,
    dials: [
      { key: 'plate', label: 'Plate', choice: PLATES, def: '250 lb' },
      { key: 'length', label: 'Length', q: 'length', def: '', optional: true }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      // as rigged, a sling hangs a few millimetres slack until the load comes onto it
      var L = b.si('length') != null ? b.si('length') : Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y) + 0.003;
      // a wire rope flexes for a few milliseconds when it snatches tight, so a
      // one-step solver spike on the catch is not a sustained overload
      if (!(b.world.cfg.breakHysteresis > 1)) b.world.cfg.breakHysteresis = 3;
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        rope: true, length: L, breakForce: plateN(b.text('plate')), label: b.inst.label || 'sling' }));
      return { joint: j };
    },
    readouts: function (built) {
      return [{ key: 'tension', label: 'tension', q: 'force', read: function () { return built.joint.broken ? 0 : Math.max(0, built.joint.tension ? built.joint.tension() : built.joint.force()); } }];
    },
    plate: function (inst) { return ['Breaking load ' + inst.dials.plate, 'Made in the southern freight yards']; },
    draw: function (ctx, cam, built) {
      var j = built.joint; if (!j || j.broken) return;
      var a = cam.worldToScreen(j.anchorA()), c = cam.worldToScreen(j.anchorB());
      ctx.save(); ctx.fillStyle = '#e8c36a'; ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(built.inst.dials.plate, a.x + (c.x - a.x) * 0.7 + 6, a.y + (c.y - a.y) * 0.7); ctx.restore();
    }
  });

  // The bollard: a solid concrete cylinder stood on end. Mass from its size.
  Y.definePart({
    type: 'h07-bollard', name: 'Concrete bollard', category: 'Loads', library: false,
    blurb: 'A solid concrete cylinder for the settlement gate. Its mass is not written on it: work it out from its size.',
    size: { w: BOL.d, h: BOL.L },
    dials: [
      { key: 'diameter', label: 'Diameter', q: 'length', def: '400 mm', min: 0.05 },
      { key: 'length', label: 'Length', q: 'length', def: '1.20 m', min: 0.1 },
      { key: 'density', label: 'Density', q: 'density', def: '2.40 Mg/m^3', min: 1 }
    ],
    anchors: { top: { x: 0, y: BOL.L / 2 }, bottom: { x: 0, y: -BOL.L / 2 } },
    build: function (b) {
      var d = b.si('diameter'), L = b.si('length'), m = b.si('density') * Math.PI * d * d / 4 * L;
      var body = b.body({ position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'bollard',
        shapes: [{ shape: b.P.box(d / 2, L / 2), material: 'concrete' }], mass: m });
      return { body: body, anchors: { top: { body: body, local: { x: 0, y: L / 2 } }, bottom: { body: body, local: { x: 0, y: -L / 2 } } } };
    }
  });

})(globalThis.SE);
