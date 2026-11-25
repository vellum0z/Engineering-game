/*
 * H6 · Three Rulers: why only three of the four mechanical units can be
 * chosen freely, base versus derived units, the SI (m, s, kg; newton
 * derived) and U.S. Customary FPS (ft, s, lb; slug derived) systems, weight
 * in newtons (W = mg, g = 9.81 m/s^2) and mass in slugs (m = W/g,
 * g = 32.2 ft/s^2). Course section 1.3, Eq. 1-4, 1-5 and Table 1-1.
 *
 * Played in the build yard. The player pushes a sack cart with the
 * quartermaster's "heave" and finds the stray constant, then derives a
 * force unit by experiment, finds the slug the same way, calibrates a spring
 * scale against SI and FPS weights, and rigs a test sandbag for a survivor
 * whose weight is known only in pounds.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial;

  var G_SI = 9.81, G_FPS = 32.2, LBF = 4.448, SLUG = 14.59, FT = 0.3048;

  // The quartermaster's ledger units.
  var PACE = 0.8;      // m
  var BREATH = 3;      // s
  var SACK = 40;       // kg
  var HEAVE = 250;     // N, one pull by Ros
  // One heave on one sack: a = 250 / 40 = 6.25 m/s^2
  //   = 6.25 x (3 s)^2 / 0.8 m = 70.3 pace/breath^2.
  var A_LEDGER = (HEAVE / SACK) * BREATH * BREATH / PACE;     // 70.31
  // The derived heave gives 1 sack 1 pace/breath^2:
  //   40 kg x 0.8 m / (3 s)^2 = 3.556 N. Pushed for one breath (3 s) it
  //   leaves the sack moving at 1 pace/breath = 0.8 / 3 = 0.267 m/s.
  var HEAVE_DERIVED = SACK * PACE / (BREATH * BREATH);         // 3.556 N
  var V_PACE = PACE / BREATH;                                  // 0.2667 m/s

  // The new arrival: 172 lb on the trading post's platform scale.
  //   m = 172 / 32.2 = 5.3416 slug = 77.93 kg; W = 172 x 4.448 = 765.06 N.
  var TEO_LB = 172;
  var TEO_N = TEO_LB * LBF;                    // 765.06 N
  var TEO_KG = TEO_LB / G_FPS * SLUG;          // 77.934 kg

  var f3 = function (x) { return D.fmtNum(x, 3); };
  function sig(x, n) { return SE.sigfig ? SE.sigfig.roundSig(x, n || 3).text : f3(x); }
  function vx(ctx) { var v = ctx.result && ctx.result.state && ctx.result.state.vel('cart'); return v ? v.x : NaN; }
  function near(a, b, tol) { return isFinite(a) && Math.abs(a - b) <= tol * Math.abs(b); }
  function pushOn(ctx, id) { return ctx.all('push').filter(function (p) { return p.a && p.a.part === id; }); }

  /* --------------------------------------------------------- the rail */
  // A 40 kg sack on a greased cart: the ledger's "1 sack".
  var RAIL_CAM = { fit: { lo: { x: -32, y: -0.5 }, hi: { x: -18, y: 3 } } };
  var RAIL_NEAR = { fit: { lo: { x: -33, y: -0.5 }, hi: { x: -26, y: 2.5 } } };
  function rail(extra) {
    return { parts: [
      { id: 'cart', type: 'cart', x: -30, y: 0.25, dials: { mass: SACK + ' kg' }, locked: true, label: '1 sack (40 kg)' },
      { id: 'speed', type: 'speedo', a: { part: 'cart' }, locked: true, label: 'sack' }
    ].concat(extra || []) };
  }
  var RAIL = rail();
  var RAIL_HEAVE = rail([{ id: 'ros', type: 'push', a: { part: 'cart' }, dials: { force: '250 N', time: BREATH + ' s' }, locked: true, open: ['force'], label: 'new heave' }]);
  var RAIL_SLUG = {
    parts: [
      { id: 'cart', type: 'cart', x: -30, y: 0.25, dials: { mass: '40 kg' }, locked: true, open: ['mass'], label: 'cart' },
      { id: 'speed', type: 'speedo', a: { part: 'cart' }, locked: true, label: 'cart' },
      { id: 'lb', type: 'push', a: { part: 'cart' }, dials: { force: '1 lb', time: '1 s' }, locked: true, label: '1 lb push' }
    ]
  };

  /* -------------------------------------------------- the scale bench */
  // A gantry hook with room for a scale and a calibration weight below it.
  var BENCH_CAM = { fit: { lo: { x: -1.8, y: 1.2 }, hi: { x: 1.8, y: 5 } } };
  var BENCH = { parts: [
    { id: 'gantry', type: 'block', x: 0, y: 4.6, dials: { width: '3 m', height: '0.3 m' }, locked: true, label: 'gantry' },
    { id: 'hook', type: 'hook', x: 0, y: 4.3, locked: true, label: 'hook' }
  ] };

  // Teo's test rig: the harness scale reads in newtons, the sandbag's mass is yours.
  var TEO_RIG = { parts: [
    { id: 'gantry', type: 'block', x: 0, y: 6.6, dials: { width: '3 m', height: '0.3 m' }, locked: true, label: 'wall gantry' },
    { id: 'hook', type: 'hook', x: 0, y: 6.3, locked: true, label: 'hook' },
    { id: 'bag', type: 'crate', x: 0, y: 4.2, dials: { mass: '10 kg' }, locked: true, open: ['mass'], label: 'test sandbag' },
    { id: 'scale', type: 'springscale', a: { part: 'hook', anchor: 'eye' }, b: { part: 'bag', anchor: 'top' }, dials: { k: '5 kN/m', face: 'N' }, locked: true, label: 'harness scale' }
  ] };

  // Extra loads the player may hang under the sandbag, any way they like.
  var TEO_BIN = [
    { type: 'crate', count: 2, dials: { mass: '20 kg' }, label: 'crate' },
    { type: 'weight', count: 4, dials: { nominal: '20 kg' } },
    { type: 'cable', count: 4, dials: { rating: '5 kN' } }
  ];

  function scaleOf(ctx) {
    return ctx.all('springscale').filter(function (p) { return p.a && p.a.part === 'hook' && p.b && p.b.part; })[0] || null;
  }
  function hungWeight(ctx) {
    var sc = scaleOf(ctx); if (!sc) return null;
    var w = ctx.inst(sc.b.part); return w && w.type === 'weight' ? w : null;
  }
  // Steady scale reading at the end of a run, in N.
  function finalReading(ctx) {
    var sc = scaleOf(ctx);
    return sc && ctx.result && ctx.result.state ? ctx.result.state.read(sc.id + '.force') : NaN;
  }
  function log(ctx) { return (ctx.values.h6 = ctx.values.h6 || { si: {}, fps: {} }); }
  // After a run on the bench, note what the hung weight read, by its nominal.
  function record(ctx, type) {
    if (type !== 'result' || !ctx.result) return;
    var w = hungWeight(ctx), sc = scaleOf(ctx); if (!w || !sc) return;
    var r = finalReading(ctx); if (!isFinite(r)) return;
    var nominal = w.dials.nominal, L = log(ctx);
    var table = /kg$/.test(nominal) ? L.si : L.fps;
    table[nominal] = { N: r, face: sc.dials.face };
  }
  function nominalKg(nominal) {
    var m = /^([\d.]+)\s*(kg|lb|slug)$/.exec(nominal || ''); if (!m) return NaN;
    var n = Number(m[1]);
    return m[2] === 'kg' ? n : m[2] === 'slug' ? n * SLUG : n * LBF / G_SI;
  }

  var BENCH_BIN = [
    { type: 'weight', count: 1, dials: { nominal: '1 kg' } },
    { type: 'springscale', count: 1, dials: { face: 'N' } }
  ];

  SE.content.registerLevel('ch01', {
    id: 'H6', order: 6, title: 'Three Rulers',
    subtitle: 'Base units, derived units, SI and FPS',
    sections: ['1.3'],
    minutes: 25,
    objective: 'Find out why only three units can be free',
    pitch: 'The quartermaster\'s homemade units break $F = ma$. Push a sack cart to see why, derive a unit by experiment, then calibrate a spring scale with SI and FPS weights.',
    intro: [
      'The quartermaster\'s ledger is a mess. Somebody measured rope in **paces**, cook times in **breaths**, grain in **sacks** and pulling power in **heaves**: one heave being whatever Big Ros can pull on a rope.',
      'Hask taps the page. "Four quantities, four rulers, all made up. Sounds fair. It isn\'t. Newton\'s second law ties those four together, and it won\'t let you pick all of them. We\'ll find out why on the rail, then fix the settlement\'s spring scale before somebody hangs a person off it."'
    ].join('\n\n'),
    goals: [
      'Explain why only **three** of length, time, mass and force can have freely chosen units',
      'Name the base and derived units of the **SI** and **FPS** systems (Table 1–1)',
      'Find weight in newtons with $W = mg$ and mass in slugs with $m = W/g$'
    ],
    yard: { site: { g: G_SI, floor: 'concrete' }, camera: RAIL_CAM, poke: false, design: RAIL },

    // Reference builds for the scored job (checked by tests/yard.test.js).
    solutions: {
      'H6.teo': [
        { set: { bag: { mass: '77.9 kg' } } },
        { set: { bag: { mass: '5.34 slug' } } },
        // a different approach: keep a light sandbag and hang a crate under it
        { set: { bag: { mass: '40 kg' } }, add: [
          { id: 'c2', type: 'crate', x: 0, y: 2.4, dials: { mass: '37.9 kg' } },
          { type: 'cable', a: { part: 'bag', anchor: 'bottom' }, b: { part: 'c2', anchor: 'top' }, dials: { rating: '5 kN' } }
        ] },
        // or two 20 kg calibration weights in a chain under a 38 kg sandbag
        { set: { bag: { mass: '38 kg' } }, add: [
          { id: 'w1', type: 'weight', x: 0, y: 3.0, dials: { nominal: '20 kg' } },
          { id: 'w2', type: 'weight', x: 0, y: 2.0, dials: { nominal: '20 kg' } },
          { type: 'cable', a: { part: 'bag', anchor: 'bottom' }, b: { part: 'w1', anchor: 'top' }, dials: { rating: '5 kN' } },
          { type: 'cable', a: { part: 'w1' }, b: { part: 'w2', anchor: 'top' }, dials: { rating: '5 kN' } }
        ] },
        { pass: false, set: { bag: { mass: '40 kg' } }, add: [
          { id: 'c2', type: 'crate', x: 0, y: 2.4, dials: { mass: '172 kg' } },
          { type: 'cable', a: { part: 'bag', anchor: 'bottom' }, b: { part: 'c2', anchor: 'top' }, dials: { rating: '5 kN' } }
        ] },
        { pass: false, set: { bag: { mass: '172 kg' } } },
        { pass: false, set: { bag: { mass: '5.34 kg' } } },
        { pass: false, set: { bag: { mass: '17.5 kg' } } }
      ]
    },

    steps: [
      {
        type: 'say', who: 'hask',
        brief: 'The ledger picks all four units by hand: 1 **pace** = 0.8 m, 1 **breath** = 3 s, 1 **sack** = 40 kg, 1 **heave** = 250 N. Does 1 heave on 1 sack give 1 pace/breath²?',
        text: 'Here\'s the ledger\'s system:\n\n- **1 pace** = 0.8 m of rope\n- **1 breath** = 3 s\n- **1 sack** = 40 kg of grain\n- **1 heave** = Ros\'s pull, about 250 N\n\nEach one was picked on its own, by whoever was holding the pencil. Out on the rail there\'s one sack on a greased cart, with a speed gauge clipped to it. A tidy ledger would hope that **1 heave on 1 sack** gives **1 pace per breath²**, because one times one is one. Let\'s see.'
      },
      {
        type: 'build', who: 'hask',
        yard: { bin: [{ type: 'push', count: 1, dials: { force: HEAVE + ' N', time: '1 s' }, label: 'Ros (1 heave)' }] },
        objective: 'Clip Ros onto the sack cart',
        brief: 'Take **Ros** from the bin and click the cart. She pulls one heave (250 N) for 1 s.',
        text: 'Take **Ros** from the bin and clip her onto the cart. She pulls **one heave (250 N)** for **1 s**, then lets go.',
        goalText: 'Ros clipped to the sack cart',
        until: function (ctx) { return pushOn(ctx, 'cart').length > 0 || (ctx.find('push') ? 'Clip her onto the **cart**.' : false); }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(2) },
        objective: 'Run the heave test and read the speed',
        brief: 'Press **▶ Run**. The speed when Ros lets go tells you the acceleration.',
        text: 'Press **▶ Run** and watch the speed gauge. After Ros lets go the cart coasts, so its speed then is what one second of heaving gave it.',
        goalText: 'Run the heave test',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          var p = pushOn(ctx, 'cart')[0];
          if (!p || !near(ctx.si(p, 'force'), HEAVE, 0.001) || !near(ctx.si(p, 'time'), 1, 0.001)) return 'Keep Ros at **250 N for 1 s** for this test.';
          ctx.values.aHeave = vx(ctx) / 1;
          return true;
        },
        after: function (ctx) {
          var a = ctx.values.aHeave;
          return 'After 1 s of heaving the sack is doing **' + f3(a) + ' m/s**, so **a = ' + f3(a) + ' m/s²**. In ledger units that is ' + f3(a) + ' × (3 s)² / 0.8 m = **' + sig(a * BREATH * BREATH / PACE, 3) + ' paces per breath²**. Not 1. Not even close.';
        }
      },
      {
        type: 'rule', title: 'Four free units leave a stray constant',
        law: 'F \\propto m a \\quad \\Rightarrow \\quad F = k\\,m\\,a',
        eq: function (ctx) {
          var aL = (ctx.values.aHeave || HEAVE / SACK) * BREATH * BREATH / PACE;
          return ['1\\u{ heave} = k\\,(1\\u{ sack})(' + sig(aL, 3) + '\\u{ pace/breath^2})',
            'k = \\frac{1}{' + sig(aL, 3) + '} = ' + sig(1 / aL, 3) + '\\u{ heave·breath^2/(sack·pace)}'];
        },
        brief: 'One heave gives a sack about 70 pace/breath², so the ledger has to carry a stray constant k in every force sum.',
        text: 'Experiments only tell us that force is **proportional** to mass times acceleration. The size of the constant depends on the units. Pick all four units on your own and every force sum in the ledger has to carry this ugly **k**. The cure is to stop choosing one of them.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { design: RAIL_HEAVE, camera: RAIL_NEAR, goal: G.after(BREATH + 1) },
        objective: 'Sack leaves the 3 s push at 0.267 m/s',
        brief: 'Define a new heave: the push that gives 1 sack 1 pace/breath². Set the push **force** so the sack ends its one-breath push at 1 pace per breath (0.267 m/s).',
        text: 'Let\'s **derive** the heave instead. Keep the pace, the breath and the sack exactly as they are, and define the new heave as the push that gives **1 sack** an acceleration of **1 pace per breath²**.\n\nThe new-heave push on the cart acts for **one breath (3 s)**. If it is exactly one new heave, the sack ends that breath moving at **1 pace per breath**, which is 0.8 m every 3 s, **0.267 m/s**. Select the push, set its **force**, and run it until the gauge agrees.',
        goalText: 'The sack leaves the push at 1 pace per breath (0.267 m/s)',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          var v = vx(ctx);
          if (near(v, V_PACE, 0.02)) { ctx.values.newHeave = ctx.si('ros', 'force'); return true; }
          return 'The sack came out at **' + f3(v) + ' m/s** (' + sig(v / V_PACE, 3) + ' pace per breath). ' + (v > V_PACE ? 'Push gentler.' : 'Push harder.') + ' The push you want is $F = m a$ with a = 1 pace/breath² = 0.8 m / (3 s)².';
        },
        hint: 'One pace per breath² is 0.8 m / (3 s)² = 0.0889 m/s². The sack is 40 kg. Multiply.',
        after: function (ctx) { return 'Done: **1 new heave = ' + D.format(ctx.values.newHeave || HEAVE_DERIVED, 'N', 3, 'force') + '**, a gentle fingertip push. With it, $F = ma$ in ledger units needs no k at all.'; }
      },
      {
        type: 'rule', kicker: 'Definition', title: 'Base units and a derived unit',
        law: '1\\u{ heave} \\equiv (1\\u{ sack})(1\\u{ pace/breath^2})',
        eq: function (ctx) { return '\\frac{(40\\u{ kg})(0.8\\u{ m})}{(3\\u{ s})^{2}} = ' + sig(HEAVE_DERIVED, 3) + '\\u{ N}'; },
        brief: 'Only three units can be chosen freely (base units); $F = ma$ derives the fourth. SI keeps m, s and kg, and derives the newton.',
        text: 'Length, time, mass and force are tied together by $F = ma$, so only **three** of their units can be chosen freely. Those three are **base units**. The fourth is **derived** from the equation, the way you just derived the heave.\n\nThe **International System (SI)** makes the same choice you did. It keeps the **meter** (m), the **second** (s) and the **kilogram** (kg) as base units, and derives force: one **newton** (N) is the push that gives 1 kg an acceleration of 1 m/s².\n\n$$1\\u{ N} = (1\\u{ kg})(1\\u{ m/s^2}) \\quad\\Rightarrow\\quad \\u{N} = \\u{kg·m/s^2}$$',
        formula: 'ch01.base-units'
      },
      {
        type: 'watch', who: 'hask',
        yard: { design: RAIL_SLUG, camera: RAIL_NEAR, goal: G.after(2) },
        objective: 'Cart leaves the 1 lb push at 1 ft/s',
        brief: 'FPS keeps the pound as a force, so mass is derived. Set the cart **mass** so a 1 lb push for 1 s leaves it at 1 ft/s.',
        text: 'The old trading posts did it the other way round. Their **U.S. Customary (FPS)** system keeps the **foot**, the **second** and the **pound**, and the pound is a **force**. So mass has to be the derived one.\n\nThe push on this cart is fixed at **1 lb for 1 s**. Find the cart **mass** that leaves it moving at exactly **1 ft/s** (an acceleration of 1 ft/s²). Tip: you can type **ft/s** into the speed gauge\'s unit box.',
        goalText: 'The cart leaves the push at 1 ft/s',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          var v = vx(ctx);
          if (near(v, FT, 0.02)) { ctx.values.slugKg = ctx.si('cart', 'mass'); ctx.values.slugText = ctx.text('cart', 'mass'); return true; }
          return 'It came out at **' + sig(v / FT, 3) + ' ft/s**. ' + (v > FT ? 'Make the cart heavier.' : 'Make the cart lighter.');
        },
        hint: 'm = F / a. The force is 1 lb (4.448 N) and the acceleration is 1 ft/s² (0.3048 m/s²). Or just type the FPS unit of mass.',
        after: function (ctx) {
          var kg = ctx.values.slugKg || SLUG;
          return 'You set **' + (ctx.values.slugText || '1 slug') + '** (' + D.format(kg, 'kg', 4, 'mass') + '). That mass is the FPS **slug**: whatever a 1 lb force accelerates at 1 ft/s². 4.448 N / 0.3048 m/s² = 14.59 kg.';
        }
      },
      {
        type: 'reveal', kicker: 'Definition', title: 'U.S. Customary (FPS) units',
        eq: '1\\u{ slug} = \\frac{1\\u{ lb}}{1\\u{ ft/s^2}} \\quad \\Rightarrow \\quad \\u{slug} = \\u{lb·s^2/ft}',
        brief: 'That mass is the **slug** (14.59 kg): what 1 lb accelerates at 1 ft/s². In FPS, force is base and mass is derived.',
        text: 'In **FPS** the **foot** (ft), the **second** (s) and the **pound** (lb) are the base units. **Force** is base and **mass** is derived. It\'s the ledger puzzle again, solved from the other end.\n\nIf you typed **lb** into the mass dial, it refused: in FPS the pound is a force, and a mass dial won\'t take a force.',
        table: { head: ['System', 'Length', 'Time', 'Mass', 'Force'], rows: [['SI', 'meter (m)', 'second (s)', 'kilogram (kg)', 'newton (N)* = kg·m/s²'], ['U.S. Customary (FPS)', 'foot (ft)', 'second (s)', 'slug* = lb·s²/ft', 'pound (lb)']] },
        formula: 'ch01.table-units'
      },
      {
        type: 'build', who: 'hask',
        yard: { design: BENCH, camera: BENCH_CAM, bin: BENCH_BIN, ghosts: [{ type: 'weight', x: 0, y: 2.2, text: 'weight' }] },
        objective: 'Hang the 1 kg weight from the spring scale',
        brief: 'Check the salvaged scale against honest weights. Put the **1 kg weight** in the outline, then run the **spring scale** from the hook to the top of the weight.',
        text: 'The settlement\'s best spring scale came out of a wrecked van with its dial scraped blank, so we check it against calibration weights.\n\nPut the **1 kg weight** in the outline under the hook. Then take the **spring scale** and click the **hook**, then the **top of the weight**, so the weight hangs from the scale.',
        goalText: 'A weight hanging from the hook by the spring scale',
        until: function (ctx) {
          if (hungWeight(ctx)) return true;
          if (ctx.find('springscale')) return 'The scale should run from the **hook** down to the **weight**.';
          return false;
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(3), bin: BENCH_BIN, camera: BENCH_CAM },
        objective: 'Weigh two different kilogram weights',
        brief: 'Run it and read the scale. Then **Reset**, change the weight\'s stamp to another kg value and run again.',
        text: 'Run it and read the scale. Then **Reset**, select the weight, change its stamp to **5 kg** (or 2, 10 or 20 kg) and run it again. A spring stretches in proportion to the **force** on it, so let\'s see what force a kilogram makes.',
        goalText: 'Two different kilogram weights read on the scale',
        until: function (ctx, type) {
          record(ctx, type);
          var n = Object.keys(log(ctx).si).length;
          if (n >= 2) return true;
          if (type === 'result' && n === 1) return 'Good. Now **Reset**, change the weight to another kilogram stamp and run again.';
          if (type === 'result' && !hungWeight(ctx)) return 'Hang the weight from the scale first.';
          return false;
        },
        after: function (ctx) {
          var si = log(ctx).si;
          return Object.keys(si).map(function (k) { return '**' + k + '** → ' + D.format(si[k].N, 'N', 3, 'force'); }).join(', ') + '. Every kilogram pulls on the spring with about **9.81 N**.';
        }
      },
      {
        type: 'rule', title: 'Weight in newtons', tag: '1–4',
        law: 'W = m g \\qquad (g = 9.81\\u{ m/s^2})',
        eq: function (ctx) {
          var si = log(ctx).si;
          return Object.keys(si).map(function (k) { var m = nominalKg(k); return 'W = (' + f3(m) + '\\u{ kg})(9.81\\u{ m/s^2}) = ' + f3(m * G_SI) + '\\u{ N} \\quad \\t{(scale: ' + f3(si[k].N) + ' N)}'; });
        },
        brief: 'Every kilogram pulls on the scale with 9.81 N. Weight is a force: $W = mg$.',
        text: 'Weight is the force of gravity on a body, so in SI it is in **newtons**, and $F = ma$ with the acceleration due to gravity gives it. The measured value at the standard location (sea level, 45° latitude) is g = 9.806 65 m/s²; 9.81 is plenty for three significant figures. Roughly, a kilogram weighs ten newtons. An apple weighs about one.',
        formula: 'ch01.weight-si'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(3), bin: BENCH_BIN, camera: BENCH_CAM },
        objective: 'Weigh 10 lb and 1 slug on a pound face',
        brief: 'Switch the scale\'s **face** to **lb**, then hang the **10 lb** weight and the **1 slug** block in turn.',
        text: 'Now the trading-post weights. **Reset**, select the scale and switch its **face** to **lb**. Hang the **10 lb** weight and run it. Then try the **1 slug** block.',
        goalText: 'The 10 lb and the 1 slug weights read on a pound face',
        until: function (ctx, type) {
          record(ctx, type);
          var f = log(ctx).fps;
          if (f['10 lb'] && f['1 slug']) return true;
          if (type === 'result') {
            var sc = scaleOf(ctx);
            if (sc && sc.dials.face !== 'lb') return 'Switch the scale\'s **face** to **lb** so it reads in pounds.';
            return f['10 lb'] ? 'Now the **1 slug** block.' : f['1 slug'] ? 'Now the **10 lb** weight.' : false;
          }
          return false;
        },
        after: function (ctx) {
          var f = log(ctx).fps;
          return 'The 10 lb weight reads **' + D.format(f['10 lb'].N, 'lb', 3, 'force') + '**, as stamped. The 1 slug block reads **' + D.format(f['1 slug'].N, 'lb', 3, 'force') + '**. A slug is a hefty lump.';
        }
      },
      {
        type: 'rule', title: 'Mass in slugs', tag: '1–5',
        law: 'm = \\frac{W}{g} \\qquad (g = 32.2\\u{ ft/s^2})',
        eq: function (ctx) {
          var f = log(ctx).fps, W = f['1 slug'] ? f['1 slug'].N / LBF : G_FPS;
          return 'm = \\frac{' + f3(W) + '\\u{ lb}}{32.2\\u{ ft/s^2}} = ' + f3(W / G_FPS) + '\\u{ slug}';
        },
        brief: 'A slug weighs 32.2 lb. From a weight in pounds, $m = W/g$ with g = 32.2 ft/s² gives slugs.',
        text: 'In FPS you usually know a body\'s **weight** in pounds, because that is what a scale reads. Its mass follows from the same law, solved the other way. Whatever weighs 32.2 lb at the standard location has a mass of exactly one slug.\n\nThe scale never measured mass at all. A spring scale reads **force**, so its face should be marked in newtons or pounds.',
        formula: 'ch01.weight-fps'
      },
      {
        type: 'job', id: 'H6.teo', who: 'juno',
        yard: { design: TEO_RIG, camera: { fit: { lo: { x: -3, y: -0.2 }, hi: { x: 3, y: 7.6 } } }, bin: TEO_BIN },
        objective: 'Load the harness scale with Teo\'s 172 lb',
        brief: 'Teo weighs **172 lb**. Make the harness scale (face in N) feel exactly his weight: set the sandbag\'s mass, or hang extra loads under it. Then **▶ Run**.',
        text: 'Juno, over the radio: "A survivor called Teo just walked in from the east road. The trading post\'s platform scale says he weighs **172 lb**. We winch him over the wall in a harness, and the crew tests every harness first with a **sandbag of the same mass**. The harness log is in SI."\n\nMake the harness scale feel exactly what Teo will put on it. The scale\'s face reads newtons. Any load that does it counts: change the sandbag\'s **mass**, or hang crates and calibration weights under it with cables.',
        goalText: 'The harness scale holds steady at Teo\'s weight (within 1 %)',
        goal: G.all(
          G.noBreaks(),
          G.holdFor('teo', function (s) { return s.t > 1.5 && near(s.read('scale.force'), TEO_N, 0.01); }, 1)
        ),
        timeout: 6,
        timeoutText: 'The scale never settled at Teo\'s weight.',
        onFail: function (ctx) {
          var r = ctx.result && ctx.result.state ? ctx.result.state.read('scale.force') : NaN;
          if (!isFinite(r)) return '';
          var msg = 'The scale settled at **' + D.format(r, 'N', 3, 'force') + '** (' + D.format(r, 'lb', 3, 'force') + '). Teo\'s 172 lb would read ' + D.format(TEO_N, 'N', 3, 'force') + '.';
          if (near(r, TEO_LB * G_SI, 0.02)) msg += ' That load is **172 kg**: the pounds went straight onto a mass dial.';
          else if (near(r, TEO_LB / G_FPS * G_SI, 0.02)) msg += ' That load is **5.34 kg**: slugs were typed as kilograms.';
          return msg;
        },
        hints: [
          'The platform scale read a **force**. The sandbag needs a **mass**. Eq. 1–5 turns FPS weight into FPS mass.',
          '$m = W/g = 172 / 32.2$ slug. Then 1 slug = 14.59 kg, or type the slugs straight in.',
          '172 / 32.2 = 5.34 slug, and 5.34 × 14.59 = **77.9 kg**.'
        ],
        margin: function (s) { return Math.round(Math.min(10, Math.abs(s.read('scale.force') - TEO_N) / TEO_N * 1000)); },
        success: function (ctx) { return 'The harness scale holds at **' + D.format(TEO_N, 'N', 3, 'force') + '**, Teo\'s weight. His mass is 172 / 32.2 = **5.34 slug** = **77.9 kg**, and 77.9 × 9.81 = 765 N checks it. The crew clips the real harness on.'; }
      },
      {
        type: 'deeper', title: 'Pound-force, pound-mass, and the k that came back',
        teaser: 'Some old-world manuals use a "pound-mass" alongside the pound-force. That quietly brings back the fudge factor from the ledger.',
        steps: [
          { type: 'say', who: 'hask', text: 'FPS is a **gravitational** system: its base unit of force was originally the weight of a standard lump of metal. That\'s why force, not mass, is base. It suits people who mostly weigh things.' },
          { type: 'say', who: 'hask', text: 'Some trades went further and kept a **pound-mass** (lbm), defined so that 1 lbm *weighs* 1 lbf at standard gravity. Now force **and** mass both have independent units, plus the foot and the second. Four free choices again, exactly the ledger\'s mistake, and the stray constant comes back: $F = m a / g_c$ with $g_c ≈ 32.2$ lbm·ft/(lbf·s²).' },
          { type: 'say', who: 'hask', text: 'The slug exists to avoid all that: 1 slug = 32.2 lbm, and with slugs $F = ma$ needs no constant. When you see "lbm" in a salvaged manual, convert to slugs before you do any mechanics.' }
        ]
      },
      {
        type: 'free', who: 'hask',
        objective: 'Free play: weigh anything, in any unit',
        brief: 'The calibration bench is yours. Chain scales, swap faces between N, kN, lb and kgf, or shove a weight mid-swing.',
        yard: { design: BENCH, camera: { fit: { lo: { x: -6, y: -0.5 }, hi: { x: 6, y: 5 } } }, poke: true, goal: null,
          bin: [{ type: 'weight', count: 4 }, { type: 'springscale', count: 3 }, { type: 'hook', count: 3 }, { type: 'crate', count: 2 }, { type: 'cart', count: 1 }, { type: 'push', count: 2 }, { type: 'speedo', count: 1 }] },
        text: 'The calibration bench is yours. Hang weights in a chain of scales, flip faces between **N**, **kN**, **lb** and **kgf**, or shove a weight mid-swing.',
        prompts: [
          'Hang the **1 kg** weight on a **kgf** face. What does a kilogram-force have to be in newtons?',
          'Find the weight that reads closest to **1 slug** on an N face. How many newtons is a slug\'s weight?',
          'Put two scales in a chain with one weight below. Does the top scale read more, less or the same?'
        ]
      },
      {
        type: 'summary',
        points: [
          'Length, time, mass and force are tied by $F = ma$, so only **three** units can be chosen freely (**base units**). The fourth is **derived**. Choose all four and a stray constant appears.',
          '**SI**: m, s, kg are base; the **newton** is derived, N = kg·m/s², the force that gives 1 kg an acceleration of 1 m/s².',
          'Weight in SI: $W = mg$ with g = 9.81 m/s² (measured 9.806 65). 1 kg weighs 9.81 N.',
          '**FPS**: ft, s, lb are base; the **slug** is derived, slug = lb·s²/ft. Mass from weight: $m = W/g$ with g = 32.2 ft/s²; 32.2 lb is 1 slug (14.59 kg).',
          'A spring scale reads **force**. Teo\'s 172 lb is 5.34 slug, 77.9 kg, 765 N.'
        ]
      }
    ]
  });

})(globalThis.SE);
