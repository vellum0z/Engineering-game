/*
 * H5 · The Long Fall: Newton's law of gravitation (Eq. 1–2), weight as the
 * one gravitational force that matters near the Earth, W = mg with
 * g = G Me / r^2 (Eq. 1–3), and the standard location.
 * Course section 1.2 (gravitation and weight).
 *
 * Played in the build yard: a 20 m drop tower with a latch and a stopwatch,
 * a weighing hook, and a site marker the player moves up a mountain, out
 * to two Earth radii and onto the Moon. The jobs are hover governors: an
 * upward thrust that has to equal the load's weight exactly.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, Gl = Y.goals;

  // ------------------------------------------------------------ constants
  var G = 66.73e-12;                 // m^3/(kg s^2), the course value
  var G_STD = 9.81;                  // standard-location g used for hand work
  var ME = 5.97e24;                  // Earth's mass as given to the player, kg
  var RE = 6371e3;                   // mean Earth radius as given to the player, m
  var GRAV = SE.physics && SE.physics.gravity;

  // ------------------------------------------------------------ answer keys
  // H5.weights: three loads off the depot manifest.
  //   generator 12.0 × 9.81 = 117.72 N   -> 118 N
  //   bolt      0.065 × 9.81 = 0.637 65 N -> 0.638 N
  //   locomotive 540e3 × 9.81 = 5 297 400 N -> 5.30 MN
  // H5.balls: 66.73e-12 × 15.0 × 25.0 / 0.600² = 6.951e-8 N -> 69.5 nN,
  //   against weights of 147 N and 245 N.
  // g at the surface: 66.73e-12 × 5.97e24 / 6.371e6² = 9.8148 -> 9.81 m/s²
  // H5.drone: 40.0 kg at 1600 km: r = 7.971e6 m,
  //   W = 66.73e-12 × 40.0 × 5.97e24 / 7.971e6² = 250.80 N -> 251 N (392 N on the ground)
  var M_A = 15.0, M_B = 25.0, D_AB = 0.600;
  var F_AB = G * M_A * M_B / (D_AB * D_AB);
  var G_SURF = G * ME / (RE * RE);
  var M_PACK = 40.0, H_DRONE = 1600e3;

  var TOWER_H = 20;                  // m: the drop crate's underside starts this high
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  var f4 = function (x) { return Y.dial.fmtNum(x, 4); };
  function fmtN(N) { return Y.dial.format(N, Y.dial.autoUnit(N, 'force'), 3, 'force'); }
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sci(x, n) {
    var p = x.toExponential(n - 1).split('e');
    return p[0] + ' × 10' + String(Number(p[1])).replace(/./g, function (ch) { return SUP[ch] || ch; });
  }

  // ------------------------------------------------------------ the tower
  var TOWER = {
    site: { g: G_STD, floor: 'concrete' },
    camera: { fit: { lo: { x: -5, y: -1 }, hi: { x: 10, y: 23 } } },
    poke: false,
    readouts: ['watch.t', 'scale.tension'],
    design: { parts: [
      { id: 'site', type: 'site', x: -3.4, y: 1.2, dials: { body: 'Earth', altitude: '0 m' }, locked: true, open: ['body', 'altitude'], label: 'job site' },
      { id: 'mast', type: 'block', x: -1.0, y: (TOWER_H + 1) / 2, dials: { width: '0.3 m', height: (TOWER_H + 1) + ' m' }, locked: true, label: 'drop tower' },
      { id: 'drop', type: 'crate', x: 0, y: TOWER_H + 0.5, dials: { mass: '50 kg' }, locked: true, open: ['mass'], label: 'drop crate' },
      { id: 'latch', type: 'latch', a: { part: 'drop' }, dials: { release: '1 s' }, locked: true, label: 'latch' },
      { id: 'watch', type: 'stopwatch', x: 3, y: 1.2, dials: { start: 'run', stop: 'impact' }, locked: true, open: ['start', 'stop'], label: 'stopwatch' },
      { id: 'hook', type: 'hook', x: 7, y: 5.5, locked: true, label: 'weighing hook' },
      { id: 'pack', type: 'crate', x: 7, y: 3.5, dials: { mass: '50 kg' }, locked: true, label: 'survey pack' },
      { id: 'scale', type: 'cable', a: { part: 'hook', anchor: 'eye' }, b: { part: 'pack', anchor: 'top' }, dials: { rating: '20 kN' }, locked: true, label: 'scale line' }
    ] }
  };
  var DROP_RUN = Gl.after(7);

  // What the last run measured: fall time, g from it, the hook tension.
  function measured(ctx) {
    var r = ctx.result, s = r && r.state;
    if (!s) return null;
    var t = s.read('watch.t'), sw = s.part('watch');
    return { t: t, stopped: !!(sw && sw.stopped()), g: 2 * TOWER_H / (t * t), T: s.read('scale.tension'), m: ctx.si('pack', 'mass') };
  }
  function siteG(ctx) { var r = ctx.result; return r && r.state ? r.state.read('site.g') : NaN; }
  function ran(ctx, type) { return type === 'result' && !!ctx.result; }

  // ------------------------------------------------------------ hover jobs
  // Every load starts in mid-air with an upward thrust ("governor") on it.
  // Thrust = weight floats it with a = 0; anything else drifts away.
  function hoverGoal(ids, band, hold) {
    return Gl.all(
      Gl.never(function (s) {
        var y0 = s.memo.y0 || (s.memo.y0 = {}), worst = s.memo.worst || (s.memo.worst = {});
        for (var i = 0; i < ids.length; i++) {
          var p = s.pos(ids[i]); if (!p) continue;
          if (y0[ids[i]] == null) y0[ids[i]] = p.y;
          var dy = p.y - y0[ids[i]];
          worst[ids[i]] = Math.max(worst[ids[i]] || 0, Math.abs(dy));
          var name = s.part(ids[i]).inst.label;
          if (dy < -band) return 'The ' + name + ' sank ' + f3(-dy) + ' m: its governor is set **below** its weight.';
          if (dy > band) return 'The ' + name + ' climbed ' + f3(dy) + ' m: its governor is set **above** its weight.';
        }
        return null;
      }),
      Gl.after(hold)
    );
  }
  function hoverMargin(s) {
    var w = s.memo.worst || {}, m = 0;
    Object.keys(w).forEach(function (k) { m = Math.max(m, w[k]); });
    // a few cm of drift is just 3 s.f. rounding; only real misses cost points
    return Math.round(Math.min(10, Math.max(0, m - 0.25) * 40));
  }
  function governor(id, onto, label) {
    return { id: id, type: 'push', a: { part: onto }, dials: { force: '0 N', angle: '90 deg', time: '60 s', start: '0 s' }, locked: true, open: ['force'], label: label };
  }

  var MANIFEST = {
    site: { g: G_STD, floor: 'concrete' },
    camera: { fit: { lo: { x: -7, y: -1 }, hi: { x: 7, y: 6 } } },
    poke: false,
    readouts: [],
    design: { parts: [
      { id: 'gen', type: 'crate', x: -4.5, y: 3, dials: { mass: '12.0 kg' }, locked: true, label: 'generator' },
      { id: 'bolt', type: 'crate', x: 0, y: 3, dials: { mass: '0.065 kg' }, locked: true, label: 'bolt' },
      { id: 'loco', type: 'crate', x: 4.5, y: 3, dials: { mass: '540 Mg' }, locked: true, label: 'locomotive' },
      governor('gGen', 'gen', 'generator governor'),
      governor('gBolt', 'bolt', 'bolt governor'),
      governor('gLoco', 'loco', 'locomotive governor')
    ] }
  };

  var DRONE = {
    site: { g: G_STD, floor: null },
    camera: { fit: { lo: { x: -5, y: -1 }, hi: { x: 5, y: 6 } } },
    poke: false,
    readouts: [],
    design: { parts: [
      { id: 'site', type: 'site', x: -3, y: 4.5, dials: { body: 'Earth', altitude: '1600 km' }, locked: true, label: 'drone at 1600 km' },
      { id: 'pack', type: 'crate', x: 0.5, y: 3, dials: { mass: '40.0 kg' }, locked: true, label: 'survey pack' },
      governor('thrust', 'pack', 'drone thrust')
    ] }
  };

  SE.content.registerLevel('ch01', {
    id: 'H5', order: 5, title: 'The Long Fall',
    subtitle: 'Gravitation and weight',
    sections: ['1.2'],
    minutes: 25,
    intro: [
      'Juno has traded for an old weather drone. It still flies, and the plan is to send survey packs up past the cloud deck to look for other settlements.',
      'Hask leans on the old drop tower by the depot. "Before you load that drone, you should know what weight actually is. Everybody thinks it\'s a property of the crate. It isn\'t. It\'s a conversation between the crate and the whole planet, and the planet\'s side of it depends on how far away you are. We\'ll find out with a stopwatch."'
    ].join('\n\n'),
    goals: [
      'Use Newton\'s law of gravitation, $F = G\\frac{m_1 m_2}{r^2}$, with *r* measured centre to centre',
      'Derive $W = mg$ with $g = \\frac{GM_e}{r^2}$ and see *g* as the acceleration of a falling body',
      'Explain why weight changes with location while mass does not, and what the standard location is'
    ],
    yard: TOWER,
    solutions: {
      'H5.weights': [
        { set: { gGen: { force: '118 N' }, gBolt: { force: '0.638 N' }, gLoco: { force: '5.30 MN' } } },
        { pass: false, set: { gGen: { force: '118 N' }, gBolt: { force: '0.638 N' }, gLoco: { force: '5.30 kN' } } },
        { pass: false, set: { gGen: { force: '12.0 N' }, gBolt: { force: '0.638 N' }, gLoco: { force: '5.30 MN' } } }
      ],
      'H5.drone': [
        { set: { thrust: { force: '251 N' } } },
        { pass: false, set: { thrust: { force: '392 N' } } },
        { pass: false, set: { thrust: { force: '6.22 kN' } } }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'The tower is 20 m tall. The **latch** at the top holds a 50 kg crate and lets go at **t = 1 s**. Next to it, the **weighing hook** holds a 50 kg survey pack on a line, and the gauge reads the line\'s tension: what the pack pulls down with.\n\nThe **job site** marker on the left says where in the universe this yard is. Right now: Earth, sea level.'
      },
      {
        type: 'build', who: 'hask',
        text: 'Select the **stopwatch**. It is set to start when you press Run, but the crate sits in the latch for a full second first. Set it to start on **release** and stop on **impact**, so it times only the fall.',
        goalText: 'Stopwatch starts on release, stops on impact',
        until: function (ctx) {
          var a = ctx.text('watch', 'start'), b = ctx.text('watch', 'stop');
          if (a === 'release' && b === 'impact') return true;
          return a !== 'run' || b !== 'impact' ? 'Start: **release**. Stop: **impact**.' : false;
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DROP_RUN },
        text: 'Press **▶ Run**. Watch the crate fall and read the stopwatch. Keep an eye on the hook tension too.',
        goalText: 'Drop the crate',
        until: function (ctx, type) {
          if (!ran(ctx, type)) return false;
          var m = measured(ctx);
          if (!m.stopped) return 'The stopwatch never stopped. Check it starts on **release** and stops on **impact**.';
          ctx.values.earth = m;
          return true;
        },
        after: function (ctx) {
          var m = ctx.values.earth;
          return 'The crate fell **20.0 m** in **' + f3(m.t) + ' s**. A dropped body starts from rest and speeds up steadily, so $h = \\frac{1}{2} a t^2$ and **a = 2h / t² = ' + f3(m.g) + ' m/s²**. The pack on the hook pulls **' + fmtN(m.T) + '** on its line.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DROP_RUN },
        text: 'Does a heavier crate fall faster? Select the **drop crate**, set its mass to **200 kg** (four times as much), and drop it again.',
        goalText: 'A 200 kg crate dropped',
        until: function (ctx, type) {
          var m = ctx.si('drop', 'mass');
          if (!(Math.abs(m - 200) < 0.5)) return Math.abs(m - 50) < 0.5 ? false : 'Set the drop crate to **200 kg**.';
          if (!ran(ctx, type)) return false;
          ctx.values.heavy = measured(ctx);
          return true;
        },
        after: function (ctx) {
          return 'Four times the mass, and the fall took **' + f3(ctx.values.heavy.t) + ' s**, the same as before. Every body here falls with the same acceleration. Four times the mass means four times the pull of the Earth, and also four times as much to get moving.';
        }
      },
      {
        type: 'rule', title: 'Weight, and the acceleration it gives',
        law: 'W = mg, \\quad a = g',
        eq: function (ctx) {
          var m = ctx.values.earth;
          return ['g = \\frac{2h}{t^2} = \\frac{2(20.0\\u{ m})}{(' + f3(m.t) + '\\u{ s})^2} = ' + f3(m.g) + '\\u{ m/s^2}',
            'W = mg = (' + f3(m.m) + '\\u{ kg})(' + f3(m.g) + '\\u{ m/s^2}) = ' + f3(m.m * m.g) + '\\u{ N} \\quad \\t{(hook: ' + f3(m.T) + ' N)}'];
        },
        text: 'The Earth pulls on every body here in proportion to its mass. That pull is the body\'s **weight**, $W = mg$. Let go and the weight is the only force left, so by $F = ma$ the body accelerates at exactly *g*, whatever its mass. Hang it on a line instead and the line has to pull up with *W* to hold it. Same *g* on both sides of the yard.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DROP_RUN, readouts: ['watch.t', 'scale.tension', 'site.g'] },
        text: 'Now take the whole yard up a mountain. Select the **job site** and set its altitude to **2400 m**, the height of the ridge station. Drop the crate again. The site gauge now shows the local *g*.',
        goalText: 'Yard at 2400 m, and a drop',
        until: function (ctx, type) {
          var h = ctx.si('site', 'altitude');
          if (!(Math.abs(h - 2400) < 1)) return h > 0 ? 'Set the altitude to **2400 m**.' : false;
          if (!ran(ctx, type)) return false;
          ctx.values.ridge = measured(ctx);
          ctx.values.ridge.site = siteG(ctx);
          return true;
        },
        after: function (ctx) {
          var a = ctx.values.earth, b = ctx.values.ridge;
          return 'The hook reads **' + f4(b.T) + ' N** against **' + f4(a.T) + ' N** at sea level, and the fall took a touch longer. Change the gauge to 4 figures if you want to see it. The pack hasn\'t lost a gram, but it **weighs less** up here.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DROP_RUN, readouts: ['watch.t', 'scale.tension', 'site.g'] },
        text: 'A mountain is a small step. How far out do you need the yard before the pack weighs **a quarter** of its sea-level weight? Type an altitude (km are fine) and drop. Watch the hook.',
        goalText: 'Hook tension a quarter of the sea-level reading (within 2%)',
        until: function (ctx, type) {
          if (ctx.text('site', 'body') !== 'Earth') return 'Keep the site on **Earth** for this one.';
          if (!ran(ctx, type)) return false;
          var m = measured(ctx), q = m.T / ctx.values.earth.T;
          if (Math.abs(q - 0.25) <= 0.005) { ctx.values.quarter = m; ctx.values.quarter.h = ctx.si('site', 'altitude'); return true; }
          return 'The hook reads **' + f3(q * 100) + '%** of the sea-level value. ' + (q > 0.25 ? 'Go higher.' : 'Too far: come back down.');
        },
        after: function (ctx) {
          var h = ctx.values.quarter.h;
          return 'At **' + f3(h / 1e3) + ' km** up, the yard is about **' + f3((RE + h) / RE) + ' Earth radii** from the centre of the planet. Twice the distance, a quarter of the weight. Distance enters **squared**, and it is measured from the **centre** of the Earth, not from the ground.';
        }
      },
      {
        type: 'rule', title: 'Newton\'s law of gravitation',
        law: 'F = G\\frac{m_1 m_2}{r^2}',
        eq: function (ctx) {
          var h = ctx.values.quarter ? ctx.values.quarter.h : RE, r = RE + h;
          return ['g = \\frac{GM_e}{r^2} = \\frac{66.73(10^{-12})(5.97(10^{24}))}{(6.371(10^{6})\\u{ m})^2} = ' + f3(G_SURF) + '\\u{ m/s^2} \\quad \\t{(sea level)}',
            'g = \\frac{GM_e}{(' + f4(r / 1e6) + '(10^{6})\\u{ m})^2} = ' + f3(G * ME / (r * r)) + '\\u{ m/s^2} \\quad \\t{(your site)}'];
        },
        text: 'Any two particles attract each other along the line between them, with *G* the universal constant of gravitation, $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$, *m₁* and *m₂* their masses, and *r* the **distance between the particles**. For round bodies such as balls and planets, *r* is measured centre to centre.\n\nFor a crate on a planet, *m₁* is the crate and *m₂* the planet. Treat the Earth as a non-rotating sphere of constant density, so it pulls as if all its mass sat at its centre, and lump everything except the crate\'s mass into $g = GM_e/r^2$. That gives $W = mg$ (Eq. 1–3). The site marker in the yard uses exactly this.',
        formula: ['ch01.gravitation', 'ch01.weight']
      },
      {
        type: 'say', who: 'hask',
        text: 'So why don\'t the two crates in this yard pull on each other? They do. Take two small steel wrecking balls, **15.0 kg** and **25.0 kg**, hanging with their centres **600 mm** apart:\n\n$$F = \\frac{66.73(10^{-12})(15.0)(25.0)}{0.600^2} = ' + f3(F_AB * 1e9) + '\\u{ nN}$$\n\nTheir weights are **147 N** and **245 N**. The pull between them is ' + sci(F_AB / (M_A * G_STD), 2) + ' of the small ball\'s weight, so the yard\'s physics leaves it out, and so will you. Near the ground the only gravitational pull worth counting is the Earth\'s, because the Earth has $6(10^{24})\\u{ kg}$ to work with. That one force is **weight**.'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DROP_RUN, readouts: ['watch.t', 'scale.tension', 'site.g'] },
        text: 'Last trip. Set the site to the **Moon**, altitude **0 m**, and drop the crate.',
        goalText: 'A drop on the Moon',
        until: function (ctx, type) {
          if (ctx.text('site', 'body') !== 'Moon') return false;
          if (ctx.si('site', 'altitude') > 1) return 'Put the yard on the Moon\'s surface: altitude **0 m**.';
          if (!ran(ctx, type)) return false;
          ctx.values.moon = measured(ctx);
          return true;
        },
        after: function (ctx) {
          var m = ctx.values.moon, e = ctx.values.earth;
          return 'The fall took **' + f3(m.t) + ' s**, so the Moon\'s *g* is **' + f3(m.g) + ' m/s²**. The pack pulls **' + fmtN(m.T) + '** on the hook instead of ' + fmtN(e.T) + ', about a sixth. Select it: its mass is still **' + f3(m.m) + ' kg**.';
        }
      },
      {
        type: 'reveal', kicker: 'Convention', title: 'The standard location',
        eq: 'g = 9.81\\u{ m/s^2} \\quad \\t{(sea level, 45° latitude)}',
        text: 'Because *g* depends on *r*, an engineer at the ridge station and one at the coast would get slightly different weights for the same crate. To keep calculations comparable, engineering work uses *g* at **sea level and 45° latitude**, the **standard location**: $g = 9.81\\u{ m/s^2}$.\n\n**Important point.** **Mass** counts how much stuff a body holds, and it is the same wherever you take it. **Weight** is the planet\'s pull on that mass, and it depends on where the mass is.'
      },
      {
        type: 'job', id: 'H5.weights', who: 'juno',
        yard: MANIFEST,
        text: 'Three loads have to go up on the gantry, and each hangs on a **governor**: an upward thrust that has to equal the load\'s weight so it floats with no acceleration. Work at the standard location and give each to **3 significant figures** with a sensible SI prefix.\n\n- the spare **generator**, 12.0 kg\n- one **bolt** for the gantry head, 0.065 kg\n- the dead **locomotive** on the spur, 540 Mg\n\nSelect each governor and type its force. The loads start in mid-air; they have to hold station for **4 s**.',
        goalText: 'All three loads hold within 0.4 m for 4 s',
        goal: hoverGoal(['gen', 'bolt', 'loco'], 0.4, 4),
        timeout: 6,
        margin: hoverMargin,
        hints: [
          'Each governor needs $W = mg$ with $g = 9.81\\u{ m/s^2}$. Work in kilograms.',
          '540 Mg is $540(10^{3})\\u{ kg}$. Then pick a prefix so the number sits between 0.1 and 1000.',
          'Generator $12.0 \\times 9.81 = 117.72 \\to 118\\u{ N}$. Bolt $0.065 \\times 9.81 = 0.637\\,65 \\to 0.638\\u{ N}$. Locomotive $540(10^{3}) \\times 9.81 = 5.2974(10^{6})\\u{ N} \\to 5.30\\u{ MN}$.'
        ],
        success: 'All three float. Same formula across eight orders of magnitude, and the prefix keeps every number readable: 0.638 N, 118 N, 5.30 MN. They drift a few centimetres because 3 s.f. is not exact; the operator trims that out by hand.'
      },
      {
        type: 'job', id: 'H5.drone', who: 'juno',
        yard: DRONE,
        text: 'The drone has to hold a **40.0 kg** survey pack steady at the top of its climb, **1600 km** above the surface. Its thrust has to match what the pack weighs **up there**.\n\nThe site gauge is switched off for this one: work it out with $M_e = 5.97(10^{24})\\u{ kg}$ and an Earth radius of **6371 km**, then set the thrust.',
        goalText: 'The pack holds within 0.4 m for 4 s at 1600 km',
        goal: hoverGoal(['pack'], 0.4, 4),
        timeout: 6,
        margin: hoverMargin,
        hints: [
          'The weight at height *h* is $W = G m M_e / r^2$, and *r* is measured from the Earth\'s centre, not from the ground.',
          '$r = 6371\\u{ km} + 1600\\u{ km} = 7.971(10^{6})\\u{ m}$. Square it, then divide it into $G m M_e$.',
          '$W = 66.73(10^{-12}) \\times 40.0 \\times 5.97(10^{24}) / (7.971(10^{6}))^2 = 251\\u{ N}$, about 64% of its 392 N ground weight.'
        ],
        onFail: function (ctx) {
          var F = ctx.si('thrust', 'force');
          if (Math.abs(F - M_PACK * G_STD) < 2) return 'That is its weight **on the ground**. At 1600 km the pack is farther from the Earth\'s centre.';
          return '';
        },
        success: '1600 km is a quarter of the Earth\'s radius, so *r* went up by 25% and the weight fell to $1/1.25^2 = 64\\%$ of its ground value. The pack\'s mass, 40.0 kg, never changed.'
      },
      {
        type: 'deeper', title: 'Why g isn\'t even the same along the ground',
        teaser: 'The real Earth spins, and it bulges at the equator. Both make *g* depend on latitude, which is why the standard location names one.',
        steps: [
          {
            type: 'say', who: 'hask',
            text: 'Our site marker treats the Earth as a still, perfect ball. The real one turns once a day, so part of gravity is used up carrying you round in a circle, and it bulges about 21 km at the equator, which puts you farther from the centre. Both effects are biggest at the equator.' +
              (GRAV ? '\n\nSea-level *g*: equator **' + GRAV.gLatitude(0).toFixed(3) + '**, 45° **' + GRAV.gLatitude(45).toFixed(3) + '**, poles **' + GRAV.gLatitude(90).toFixed(3) + ' m/s²**. About half a percent end to end.' : '')
          },
          {
            type: 'reveal', kicker: 'Model', title: 'g with latitude and height',
            eq: 'g \\approx 9.780327(1 + 0.0053024\\sin^2\\phi - 0.0000058\\sin^2 2\\phi) - 3.086(10^{-6})h',
            text: 'Climbing costs about 3.1 mm/s² per kilometre, and heading toward a pole gives some of it back. Engineers fix the reference at sea level and 45° so everybody starts from the same number.',
            formula: 'ch01.g-latitude'
          }
        ]
      },
      {
        type: 'free', who: 'hask',
        yard: { design: TOWER.design, bin: [{ type: 'crate', count: 3 }, { type: 'hook', count: 2 }, { type: 'cable', count: 2 }, { type: 'push', count: 2 }, { type: 'latch', count: 2 }], goal: null, poke: true, readouts: null },
        text: 'The tower is yours. Move the site anywhere from the Moon to 40 000 km above the Earth, change the masses, and add your own loads.',
        prompts: [
          'At what altitude has the pack\'s weight **halved**? (r = √2 R.)',
          'At three Earth radii from the centre, what fraction of the sea-level weight is left?',
          'Double the pack mass at a fixed site. What happens to *g*, and what happens to *W*?',
          'Hover a crate on Mars with a push. What thrust does it need?'
        ]
      },
      {
        type: 'summary',
        points: [
          'Newton\'s law of gravitation: $F = G m_1 m_2 / r^2$ with $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$ and *r* the distance between the particles (centre to centre for spheres). Double *r* and *F* drops to a quarter.',
          'Between everyday objects the pull is tiny (nanonewtons). Near the Earth the only gravitational force worth counting is the Earth\'s pull: **weight**.',
          'For a non-rotating, uniform spherical Earth, $W = GmM_e/r^2$. Calling $g = GM_e/r^2$ gives $W = mg$ (Eq. 1–3). Let go of a body and it accelerates at *g*, whatever its mass.',
          'Weight depends on *r*, so it is not absolute. Engineering uses the **standard location**, sea level at 45° latitude, where $g = 9.81\\u{ m/s^2}$.',
          'Mass does not change with location. Weight does.'
        ]
      }
    ]
  });

  /*
   * Stand-ins for the site, latch and stopwatch parts, used only until the
   * shared parts land (they are skipped once a part of that type exists).
   * They follow the parts contract: same type names, dials and readouts.
   */
  if (!Y.partDef('site')) {
    var BODY = {
      Earth: { M: ME, R: RE },
      Moon: { M: 7.342e22, R: 1.7374e6 },
      Mars: { M: 6.4171e23, R: 3.3895e6 }
    };
    Y.definePart({
      type: 'site', name: 'Job site', category: 'Site', onePerDesign: true,
      blurb: 'Where the yard is. Sets g = G M / r², with r the body\'s radius plus the altitude (a still, uniform sphere).',
      size: { w: 1.4, h: 1.0 },
      dials: [
        { key: 'body', label: 'Body', choice: ['Earth', 'Moon', 'Mars'], def: 'Earth' },
        { key: 'altitude', label: 'Altitude', q: 'length', def: '0 m', min: 0, max: 4e7 }
      ],
      build: function (b) {
        var B = BODY[b.si('body')] || BODY.Earth, r = B.R + (b.si('altitude') || 0), g = G * B.M / (r * r);
        b.world.gravity = { x: 0, y: -g };
        var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: '', shapes: [{ shape: b.P.box(0.7, 0.5), sensor: true }] });
        return { body: body, g: g };
      },
      readouts: function (built) { return [{ key: 'g', label: 'g', q: 'accel', read: function () { return built.g; } }]; },
      draw: function (ctx, cam, built) {
        var i = built.inst, c = cam.worldToScreen({ x: i.x, y: i.y });
        ctx.save(); ctx.fillStyle = 'rgba(40,46,52,.85)'; ctx.fillRect(c.x - 0.7 * cam.zoom, c.y - 0.5 * cam.zoom, 1.4 * cam.zoom, cam.zoom);
        ctx.fillStyle = '#e6b422'; ctx.font = '12px "IBM Plex Mono", monospace';
        ctx.fillText(i.dials.body + ' ' + i.dials.altitude, c.x - 0.65 * cam.zoom, c.y - 0.05 * cam.zoom);
        ctx.restore();
      }
    });
  }

  if (!Y.partDef('latch')) {
    Y.definePart({
      type: 'latch', name: 'Latch', category: 'Rigging',
      blurb: 'Holds a part fixed in place, then lets go at the time you set.',
      size: { w: 0.4, h: 0.4 },
      connector: true, attach: true,
      dials: [{ key: 'release', label: 'Release at', q: 'time', def: '1 s', min: 0, max: 600 }],
      build: function (b) {
        var end = b.end('a'), body = end.body, world = b.world, T = b.si('release');
        var out = { body: null, bodies: [], target: body, releasedAt: null, joint: null };
        if (T <= 0) { out.releasedAt = 0; return out; }
        out.joint = b.joint(new b.P.WeldJoint({ bodyA: b.ground, bodyB: body, worldAnchor: { x: body.c.x, y: body.c.y } }));
        b.on('step', function () {
          if (out.releasedAt != null || world.time < T - 1e-9) return;
          world.removeJoint(out.joint); out.releasedAt = world.time;
          if (body.wake) body.wake();
        });
        return out;
      },
      readouts: function (built) { return [{ key: 'released', label: 'released', q: 'number', read: function () { return built.releasedAt != null ? 1 : 0; } }]; },
      draw: function (ctx, cam, built) {
        if (built.releasedAt != null || !built.target) return;
        var s = cam.worldToScreen(built.target.c);
        ctx.save(); ctx.strokeStyle = '#e6b422'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    });
  }

  if (!Y.partDef('stopwatch')) {
    Y.definePart({
      type: 'stopwatch', name: 'Stopwatch', category: 'Measure', onePerDesign: true,
      blurb: 'Times a run. Start on Run or on a latch letting go; stop when the released part hits something.',
      size: { w: 1.4, h: 0.7 },
      dials: [
        { key: 'start', label: 'Start', choice: ['run', 'release'], def: 'release' },
        { key: 'stop', label: 'Stop', choice: ['impact'], def: 'impact' }
      ],
      build: function (b) {
        var world = b.world, parts = b.out.parts, mode = b.si('start');
        var out = { t0: mode === 'run' ? 0 : null, tStop: null, target: null };
        function latch() {
          var ids = Object.keys(parts);
          for (var i = 0; i < ids.length; i++) if (parts[ids[i]].def.type === 'latch') return parts[ids[i]];
          return null;
        }
        b.on('step', function () {
          if (out.t0 != null && out.target) return;
          var L = latch();
          if (L && !out.target) out.target = L.target;
          if (out.t0 == null && L && L.releasedAt != null) out.t0 = L.releasedAt;
        });
        b.on('impact', function (e) {
          if (out.t0 == null || out.tStop != null) return;
          if (out.target && e.a !== out.target && e.b !== out.target) return;
          out.tStop = world.time;
        });
        out.stopped = function () { return out.tStop != null; };
        out.time = function () { return out.t0 == null ? 0 : (out.tStop != null ? out.tStop : world.time) - out.t0; };
        out.body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: '', shapes: [{ shape: b.P.box(0.7, 0.35), sensor: true }] });
        return out;
      },
      readouts: function (built) { return [{ key: 't', label: 'time', q: 'time', read: function () { return built.time(); } }]; },
      draw: function (ctx, cam, built) {
        var i = built.inst, c = cam.worldToScreen({ x: i.x, y: i.y });
        ctx.save(); ctx.fillStyle = 'rgba(20,24,28,.9)'; ctx.fillRect(c.x - 0.7 * cam.zoom, c.y - 0.35 * cam.zoom, 1.4 * cam.zoom, 0.7 * cam.zoom);
        ctx.fillStyle = built.stopped() ? '#7fd07f' : '#e6b422'; ctx.font = 'bold ' + Math.max(12, Math.round(0.4 * cam.zoom)) + 'px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(built.time().toFixed(2) + ' s', c.x, c.y);
        ctx.restore();
      }
    });
  }
})(globalThis.SE);
