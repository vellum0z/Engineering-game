/*
 * H3 · Good Enough Models: the three idealizations of mechanics (particle,
 * rigid body, concentrated force) and how to tell when each one is fair.
 * Course section 1.2. Played in the build yard.
 *
 *   1. Particle: the same 60 kg load as a dot, a 1 m crate and a 4.5 m
 *      ladder sled gets the same shove. The centres travel the same
 *      distance. A tall crate on bare runners tips over, which a dot can't.
 *   2. Rigid body: the crate hangs from a cantilever shelf made of steel,
 *      aluminium, timber or rubber. The wall moment matches the rigid
 *      model W·L while the shelf hardly bends, and stops matching when it
 *      folds.
 *   3. Concentrated force: sandbags spread along the shelf, then the same
 *      weight as one point. At the patch's middle a single point gives the
 *      same wall reactions; at the tip it doesn't.
 *   Job: Juno's trolley rail from a salvaged bar (L 2.4 m, 3.2 kN at the
 *   tip) must hang the load clear of the truck bed below.
 *
 * Four level parts are defined at the bottom of this file: h03-crate (a
 * load whose shape you can swap), h03-shelf (a cantilever), h03-hang (a
 * crate slung from a shelf) and h03-bags (sandbags laid on a shelf).
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals;

  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };
  var f2 = function (x) { return Y.dial.fmtNum(x, 2); };
  var mm = function (x) { return f3(x * 1e3) + ' mm'; };
  var kNm = function (x) { return f3(x / 1e3) + ' kN·m'; };

  /* ------------------------------------------------------------ scenes */

  // The test pad: a 60 kg load on greased runners (μ = 0.10 on concrete).
  var PAD = {
    site: { g: 9.81, floor: 'concrete' },
    camera: { fit: { lo: { x: -1, y: -0.5 }, hi: { x: 20, y: 3.5 } } },
    poke: false,
    design: { parts: [
      { id: 'load', type: 'h03-crate', x: 3, y: 0.5, dials: { mass: '60 kg', shape: 'crate 1 m', runners: 'greased' }, locked: true, open: ['shape', 'runners'], label: 'test load' },
      { id: 'shove', type: 'push', a: { part: 'load' }, dials: { force: '120 N', angle: '0 deg', time: '3 s', start: '0 s' }, locked: true, open: ['force'], label: 'shove' }
    ] },
    readouts: ['load.travel', 'load.speed', 'load.tilt']
  };

  // The loading bay: a cantilever shelf bolted to the depot wall.
  var WALL = { id: 'wall', type: 'block', x: -0.3, y: 2.25, dials: { width: '0.6 m', height: '4.5 m' }, locked: true, label: 'depot wall' };
  function bay(parts, open, material) {
    return { parts: [WALL,
      { id: 'shelf', type: 'h03-shelf', x: 0, y: 3, dials: { material: material || 'steel', length: '2.4 m', depth: '120 mm', width: '80 mm' }, locked: true, open: open || ['material'], label: 'shelf' }
    ].concat(parts || []) };
  }
  function hung(mass) {
    return [{ id: 'crate', type: 'h03-hang', a: { part: 'shelf' }, dials: { mass: mass, at: '2.4 m' }, locked: true, label: 'crate' }];
  }
  var BAY = {
    site: { g: 9.81, floor: 'concrete' },
    camera: { fit: { lo: { x: -1.2, y: -0.3 }, hi: { x: 4.2, y: 4.6 } } },
    poke: false,
    design: bay(hung('100 kg')),
    readouts: ['shelf.sag', 'shelf.moment', 'shelf.shear']
  };

  // The job: Juno's trolley rail. Old answer key kept: 80 x 120 mm steel,
  // L = 2.4 m, P = 3.2 kN gives PL^3/(3EI) = 6.40 mm from the load, plus
  // 1.34 mm from the bar's own weight (75.4 kg/m), about 7.7 mm in all.
  var TRUCK_TOP = 1.3 - 0.024;           // crate bottom starts at 1.3 m: 24 mm clearance = 1 % of 2.4 m
  var RAIL = bay(hung('326 kg').concat([
    { id: 'truck', type: 'block', x: 2.6, y: TRUCK_TOP / 2, dials: { width: '2.2 m', height: TRUCK_TOP + ' m' }, locked: true, label: 'truck bed' }
  ]), ['material', 'depth', 'width'], 'timber');

  /* ----------------------------------------------------------- helpers */

  function travel(r) { var p = r && r.state && r.state.part('load'); return p ? p.travel() : NaN; }
  function tilt(r) { var p = r && r.state && r.state.part('load'); return p ? Math.abs(p.tilt()) : NaN; }
  function shelfOf(r) { return r && r.state && r.state.part('shelf'); }
  // The rigid model's wall moment: every weight at its as-drawn distance.
  function rigidMoment(ctx) {
    var sh = ctx.built.parts.shelf; if (!sh) return NaN;
    var L = sh.beam.length, w = sh.beam.bodies.reduce(function (a, b) { return a + b.m; }, 0) * 9.81;
    var M = w * L / 2;
    ctx.all('h03-hang').forEach(function (c) { M += ctx.si(c, 'mass') * 9.81 * Math.min(L, ctx.si(c, 'at')); });
    ctx.all('h03-bags').forEach(function (b) { M += ctx.si(b, 'mass') * 9.81 * Math.min(L, ctx.si(b, 'centre')); });
    return M;
  }
  function seen(ctx, key, v) { var s = ctx.values[key] = ctx.values[key] || {}; if (v != null) s[v.k] = v.v; return s; }

  SE.content.registerLevel('ch01', {
    id: 'H3', order: 3, title: 'Good Enough Models',
    subtitle: 'Particles, rigid bodies and point loads',
    sections: ['1.2'],
    minutes: 25,
    intro: [
      'Hask has chalked three sketches on the side of a boxcar: a dot, a stiff bar, and a single arrow.',
      '"Real things are messy. A beam sags, a wheel squashes a little where it meets the rail, and a sled has a length. If we tracked all of that for every job we would never finish a calculation. So we **model**: we throw away the details that don\'t change the answer. Today the yard tells you which details those are. You run the real thing and the model side by side and see whether they agree."'
    ].join('\n\n'),
    goals: [
      'Say what a **particle** is and when a body can be treated as one',
      'Say what a **rigid body** is and check whether a real beam qualifies',
      'Say when a load can be treated as a **concentrated force**',
      'Spot situations where none of the three models is fair'
    ],
    yard: PAD,
    solutions: {
      'H3.rail': [
        { set: { shelf: { material: 'steel', depth: '120 mm', width: '80 mm' } } },
        { set: { shelf: { material: 'aluminium', depth: '120 mm', width: '80 mm' } } },
        { set: { shelf: { material: 'timber', depth: '250 mm', width: '80 mm' } } },
        { pass: false, set: { shelf: { material: 'timber', depth: '120 mm', width: '80 mm' } } },
        { pass: false, set: { shelf: { material: 'rubber' } } },
        { pass: false, set: { shelf: { material: 'steel', depth: '12 mm', width: '80 mm' } } }
      ]
    },
    steps: [
      /* ------------------------------------------------------ particle */
      {
        type: 'watch', who: 'hask',
        yard: { goal: G.after(7) },
        text: 'A **60 kg** load on greased runners (μ = 0.10 on this concrete). The shove is **120 N** for **3 s**, then it slides to a stop.\n\nPress **▶ Run** and read the **travel** gauge: how far the load\'s **centre** moved.',
        goalText: 'Run the 1 m crate',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          if (ctx.text('load', 'shape') !== 'crate 1 m') return 'Set the shape back to **crate 1 m** for this run.';
          seen(ctx, 'h3shapes', { k: 'crate 1 m', v: travel(ctx.result) });
          return true;
        },
        after: function (ctx) { return 'The crate\'s centre moved **' + f3(travel(ctx.result)) + ' m**.'; }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(7) },
        text: 'Now change the load\'s **shape** without touching its mass: try the **ladder sled 4.5 m**, then the **point** (all 60 kg squeezed into a dot). Run each one and watch the travel gauge.',
        goalText: 'Run the ladder sled and the point',
        until: function (ctx, type) {
          if (type === 'result' && ctx.result) seen(ctx, 'h3shapes', { k: ctx.text('load', 'shape'), v: travel(ctx.result) });
          var s = seen(ctx, 'h3shapes');
          if (s['ladder sled 4.5 m'] != null && s.point != null) return true;
          return type === 'result' ? 'Now run the ' + (s.point == null ? '**point**' : '**ladder sled 4.5 m**') + '.' : false;
        },
        after: function (ctx) {
          var s = seen(ctx, 'h3shapes');
          return 'Crate **' + f3(s['crate 1 m']) + ' m**, ladder sled **' + f3(s['ladder sled 4.5 m']) + ' m**, point **' + f3(s.point) + ' m**. Three very different shapes, one answer.';
        }
      },
      {
        type: 'rule', title: 'Size never entered it',
        law: 'a = \\frac{F - \\mu m g}{m}',
        eq: function () { return ['a_{push} = \\frac{120\\u{ N} - (0.10)(60\\u{ kg})(9.81\\u{ m/s^2})}{60\\u{ kg}} = 1.02\\u{ m/s^2}', 'a_{slide} = -\\mu g = -0.981\\u{ m/s^2}']; },
        text: function (ctx) {
          var s = seen(ctx, 'h3shapes');
          return 'For sliding in a straight line, the centre moves according to the forces and the mass alone, and even the friction μmg has no length in it. The shape **never appears**, so every shape travelled the same **' + f3(s.point) + ' m**. That is what lets us shrink a body to a dot.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(6) },
        text: 'Now make it turn. Set the shape to **tall crate 2 m**, the runners to **bare** (μ about 0.55), and the shove to **400 N**. Run it, then run the same thing as a **point**.',
        goalText: 'Run the tall crate and the point, both on bare runners at 400 N',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          if (ctx.text('load', 'runners') !== 'bare' || !(Math.abs(ctx.si('shove', 'force') - 400) < 1)) return 'Bare runners and a **400 N** shove for both runs.';
          var shp = ctx.text('load', 'shape');
          if (shp === 'tall crate 2 m' || shp === 'point') seen(ctx, 'h3tip', { k: shp, v: { d: travel(ctx.result), tilt: tilt(ctx.result) } });
          var s = seen(ctx, 'h3tip');
          if (s['tall crate 2 m'] && s.point) return true;
          return 'Now run the ' + (s.point ? '**tall crate 2 m**' : '**point**') + '.';
        },
        after: function (ctx) {
          var s = seen(ctx, 'h3tip'), t = s['tall crate 2 m'];
          return 'The tall crate went over (it tilted **' + f2(t.tilt * 180 / Math.PI) + '°**) and its centre moved **' + f3(t.d) + ' m**. The point just slid, **' + f3(s.point.d) + ' m**. A dot can\'t tip, so here the particle model gives the wrong answer.';
        }
      },
      {
        type: 'say', who: 'hask',
        text: 'Two places the dot pays off:\n\n- The **supply drone** has a frame 1.2 m across and flies a 5 km run over the valley. The frame is about 0.02 % of the trip. For where it goes and how long it takes, it is a dot with mass.\n- Three haul ropes tied to a small **steel ring** all pull along lines through the ring\'s centre, so its diameter never shows up when you balance the forces.\n\nThe catch is the one you just saw: the moment a body can **turn**, where the forces act on it matters, and so does its size. Then you need the next model.'
      },
      {
        type: 'reveal', kicker: 'Idealization', title: 'Particle',
        text: 'A **particle** has mass, but its size can be neglected. Its geometry drops out of the analysis, which makes the analysis much simpler. It is fair when the body\'s size doesn\'t change how it moves, like a load sliding without turning or a drone on a long trip.'
      },

      /* ---------------------------------------------------- rigid body */
      {
        type: 'watch', who: 'hask',
        yard: Object.assign({}, BAY, { goal: G.after(5) }),
        text: 'The loading bay. A **2.4 m** shelf, 80 mm wide and 120 mm deep, is bolted to the depot wall, with a **100 kg** crate slung from its tip.\n\nThe **rigid-body** model says the wall has to hold up the crate and the shelf, and resist a moment of **weight × distance**, as if the shelf never bent. Run it in **steel** and read the **wall moment** and **tip sag** gauges.',
        goalText: 'Run the steel shelf',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          if (ctx.text('shelf', 'material') !== 'steel') return 'Run it in **steel** first.';
          var sh = shelfOf(ctx.result);
          seen(ctx, 'h3mat', { k: 'steel', v: { sag: sh.sag(), M: sh.moment(), rigid: rigidMoment(ctx) } });
          return true;
        },
        after: function (ctx) {
          var s = seen(ctx, 'h3mat').steel;
          return 'Wall moment **' + kNm(s.M) + '**; the rigid model says **' + kNm(s.rigid) + '**. The tip sagged **' + mm(s.sag) + '** on 2.4 m.';
        }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(6), camera: BAY.camera, readouts: BAY.readouts },
        text: 'Same shelf, same crate. Change the **material**: run **aluminium**, **timber** and **rubber**. Keep an eye on where the crate ends up.',
        goalText: 'Run aluminium, timber and rubber',
        until: function (ctx, type) {
          if (type === 'result' && ctx.result) {
            var sh = shelfOf(ctx.result);
            if (sh) seen(ctx, 'h3mat', { k: ctx.text('shelf', 'material'), v: { sag: sh.sag(), M: sh.moment(), rigid: rigidMoment(ctx) } });
          }
          var s = seen(ctx, 'h3mat'), left = ['aluminium', 'timber', 'rubber'].filter(function (m) { return !s[m]; });
          if (!left.length) return true;
          return type === 'result' ? 'Still to run: **' + left.join('**, **') + '**.' : false;
        },
        after: function (ctx) {
          var s = seen(ctx, 'h3mat');
          return ['steel', 'aluminium', 'timber', 'rubber'].map(function (m) {
            var r = s[m];
            return '- **' + m + '**: sag ' + (r.sag > 0.3 ? f3(r.sag) + ' m' : mm(r.sag)) + ', wall moment ' + kNm(r.M) + ' (' + (r.M / r.rigid * 100).toFixed(1) + ' % of the rigid model)';
          }).join('\n');
        }
      },
      {
        type: 'rule', title: 'Stiff enough means rigid enough',
        law: 'M_{wall} = W\\,L \\quad \\t{(rigid model)}',
        text: function (ctx) {
          var s = seen(ctx, 'h3mat');
          return 'Steel, aluminium and timber all sag a little, but a few millimetres on 2.4 m doesn\'t move the crate closer to the wall, so the wall feels what the rigid model says it should, **whatever the shelf is made of**. Rubber is different: it folds under little more than its own weight, the crate ends up sitting on the floor, and the wall moment drops to **' + (s.rubber.M / s.rubber.rigid * 100).toFixed(0) + ' %** of the rigid answer. The model only holds while the deformation is small compared with the body.';
        }
      },
      {
        type: 'reveal', kicker: 'Idealization', title: 'Rigid body',
        text: 'A **rigid body** is a huge number of particles that all stay at fixed distances from one another, before and after a load goes on. Its shape doesn\'t change, so the material it is made of doesn\'t enter the analysis of the forces.\n\nReal steel structures deform so little that the rigid-body model is the right one to start with. Check it when the body is soft, long and thin, or when the deformation itself is what you need to know (how far a rubber seal squashes, how much a rail sags).'
      },

      /* -------------------------------------------- concentrated force */
      {
        type: 'build', who: 'hask',
        yard: { design: bay(), bin: [{ type: 'h03-bags', count: 1, dials: { mass: '300 kg', spread: '1.2 m', centre: '1.8 m' } }], readouts: ['shelf.sag', 'shelf.moment', 'shelf.shear'], camera: BAY.camera },
        text: 'Back to the steel shelf. Juno wants to stack **300 kg of sandbags** on it. Take the **Sandbags** and click the shelf to lay them on. They start spread over the last **1.2 m** of the shelf (centre **1.8 m** from the wall).',
        goalText: 'Sandbags on the shelf',
        until: function (ctx) { var b = ctx.find('h03-bags'); return !!(b && b.a && b.a.part === 'shelf'); }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(5), camera: BAY.camera, readouts: BAY.readouts },
        text: 'Run it three ways and compare the gauges:\n\n1. as laid, **spread 1.2 m**\n2. the same weight as one **point** at the same centre: set **spread** to **0 m**\n3. that point moved to the **tip**: **centre 2.4 m**',
        goalText: 'Run all three',
        until: function (ctx, type) {
          var b = ctx.find('h03-bags');
          if (type === 'result' && ctx.result && b) {
            var sp = ctx.si(b, 'spread'), c = ctx.si(b, 'centre'), sh = shelfOf(ctx.result);
            var k = Math.abs(sp - 1.2) < 1e-6 && Math.abs(c - 1.8) < 1e-6 ? 'spread' : sp < 1e-6 && Math.abs(c - 1.8) < 1e-6 ? 'point' : sp < 1e-6 && Math.abs(c - 2.4) < 1e-6 ? 'tip' : null;
            if (k && sh) seen(ctx, 'h3bags', { k: k, v: { sag: sh.sag(), M: sh.moment(), V: sh.shear() } });
          }
          var s = seen(ctx, 'h3bags'), left = ['spread', 'point', 'tip'].filter(function (k) { return !s[k]; });
          if (!left.length) return true;
          return type === 'result' ? 'Still to run: ' + left.map(function (k) { return { spread: 'spread 1.2 m at 1.8 m', point: 'spread 0 m at 1.8 m', tip: 'spread 0 m at 2.4 m' }[k]; }).join(', ') + '.' : false;
        },
        after: function (ctx) {
          var s = seen(ctx, 'h3bags');
          return [['spread over 1.2 m', s.spread], ['one point at 1.8 m', s.point], ['one point at the tip', s.tip]].map(function (r) {
            return '- **' + r[0] + '**: wall force ' + f3(r[1].V / 1e3) + ' kN, wall moment ' + kNm(r[1].M) + ', tip sag ' + mm(r[1].sag);
          }).join('\n');
        }
      },
      {
        type: 'rule', title: 'One arrow, in the right place',
        law: 'M_{wall} = W\\,\\bar{x}',
        text: function (ctx) {
          var s = seen(ctx, 'h3bags');
          return 'The wall can\'t tell the spread bags from a single point load at their middle: same force, same moment, and a tip sag within **' + f2(Math.abs(s.point.sag / s.spread.sag - 1) * 100) + ' %**. Put the arrow at the tip instead and the moment is **' + f2((s.tip.M / s.spread.M - 1) * 100) + ' %** too big.\n\nA wheel on a rail touches a patch about 15 mm long. Anywhere you put the arrow inside a patch that small, the answer is the same, so you don\'t even have to think about where it goes. With a wide pallet you do.';
        }
      },
      {
        type: 'reveal', kicker: 'Idealization', title: 'Concentrated force',
        eq: '\\frac{c}{L} \\ll 1 \\quad \\Rightarrow \\quad \\t{treat the load as acting at a point}',
        text: 'A **concentrated force** stands for a load that is assumed to act at a **single point** on a body. It is a fair model when the area the load acts over is very small compared with the body, like a wheel on a rail (c/L tiny).\n\nSo the three idealizations are:\n\n- **Particle**: mass, negligible size.\n- **Rigid body**: no deformation under load.\n- **Concentrated force**: a load acting at a point.',
        formula: 'ch01.idealizations'
      },

      /* ----------------------------------------------------------- job */
      {
        type: 'job', id: 'H3.rail', who: 'juno',
        yard: { design: RAIL, bin: [], readouts: ['shelf.sag', 'shelf.moment', 'crate.gap'], camera: BAY.camera },
        text: 'Juno wants a hoist trolley running out over the loading bay on a salvaged bar bolted to the wall: **2.4 m** long, carrying **3.2 kN** (the loaded trolley, 326 kg) at its tip.\n\nThe truck backs in underneath with its bed **24 mm** below the hanging load, so the rail may sag at most 1 % of its length. The crew has put up an 80 × 120 mm **timber** plank as a trial. Run it, then pick the rail\'s **material**, **depth** and **width** so the load hangs clear of the truck and nothing breaks. There is a steel bar of the same size in the scrap pile.',
        goalText: 'Load hanging still, clear of the truck bed, nothing broken',
        goal: G.all(
          G.never(function (s) { return s.breaks.length ? 'The rail broke at the wall: the bending was more than the section could take.' : null; }),
          G.never(function (s) { var c = s.part('crate'); return c && c.landed ? 'The load came down on the truck bed.' : null; }),
          G.after(3, function (s) { var b = s.part('shelf').beam.bodies; return s.held('still', Math.abs(b[b.length - 1].v.y) < 0.002, 1) ? 'pass' : null; })
        ),
        timeout: 12,
        onFail: function (ctx) {
          var sh = shelfOf(ctx.result);
          return sh ? 'The rail\'s tip sagged **' + mm(sh.sag()) + '**. The truck bed is 24 mm down.' : '';
        },
        hints: [
          'Run the timber plank as it is and read the **tip sag** gauge. Then try the other materials. Stiffer materials and deeper sections sag less.',
          'Depth helps far more than width: the sag goes as **1/depth³** but only as **1/width**. Doubling the depth cuts the sag to one eighth.',
          'The steel bar from the scrap pile works as it is: **steel, 120 mm deep, 80 mm wide** sags about 7.7 mm. Timber needs about 250 mm of depth for the same job.'
        ],
        success: function (ctx) {
          var sh = ctx.result && shelfOf(ctx.result);
          var d = sh ? sh.sag() : NaN;
          return 'Clear by **' + mm(0.024 - d) + '**. The tip sags **' + mm(d) + '**, δ/L = ' + f2(d / 2.4 * 100) + ' %. That is far too little to change any force or lever arm, so the rigid-body model is fair for the statics. It is still enough to matter when you fit a truck underneath it. Both things are true at once: small enough to ignore in the force analysis, big enough to plan for.';
        }
      },

      /* ---------------------------------------------------------- free */
      {
        type: 'free', who: 'hask',
        yard: { design: bay(hung('100 kg'), ['material', 'length', 'depth', 'width']), bin: [{ type: 'h03-bags', count: 2 }, { type: 'h03-hang', count: 2 }], readouts: ['shelf.sag', 'shelf.moment', 'shelf.shear'], camera: { fit: { lo: { x: -1.5, y: -0.3 }, hi: { x: 8, y: 5 } } }, goal: null, poke: true },
        text: 'The bay is yours: the shelf\'s material, length and section are all open, and you have sandbags and slung crates. While it runs you can drag things with the mouse.',
        prompts: [
          'Find the shallowest steel shelf that still sags less than 1 % of its length with the 100 kg crate.',
          'Double the shelf\'s depth. By what factor does the sag drop?',
          'Make a shelf that is clearly **not** rigid but doesn\'t break. How far off is the rigid model\'s wall moment?',
          'Lay sandbags along most of the shelf. Is one point at their middle still a fair stand-in for the wall reactions?'
        ]
      },

      /* -------------------------------------------------------- deeper */
      {
        type: 'deeper', title: 'When good models go bad',
        teaser: 'Each idealization has a way to fail without warning. Three of them, briefly.',
        steps: [
          { type: 'say', who: 'hask', text: '**Slender struts buckle.** A rigid body can never buckle, because buckling *is* a change of shape. A long thin steel rod in compression can stay straight, then suddenly bow sideways at a load far below what would crush the steel. For short, stocky members the rigid model is fine. For long, slender ones in compression, the deformation is the whole story. Euler worked out the critical load in 1744.' },
          { type: 'say', who: 'hask', text: '**Tides need the Earth\'s size.** The Earth is a fine particle for its orbit. But the Moon, 384 400 km away, pulls on the near side of the Earth (6371 km closer) harder than on the far side. Work out $1/(d-R)^2$ against $1/(d+R)^2$ and the difference is about **7 %** of the average pull: small, but it moves whole oceans. For tides the Earth\'s size is exactly what matters, so the particle model fails.' },
          { type: 'say', who: 'hask', text: '**Why the arrow at the middle worked so well.** Far from where a load is applied, a body cannot tell how the load was spread out: only the total force and where it acts matter. That is **Saint-Venant\'s principle**. It is why one point load in the right spot predicted the wall reactions exactly and the tip sag closely. It is also why it tells you nothing about the steel right under the bags, where the local crushing and bearing pressure live.' }
        ]
      },

      /* ------------------------------------------------------- summary */
      {
        type: 'summary',
        points: [
          'Models (idealizations) simplify the theory by dropping details that don\'t change the answer. Run the real thing and the model side by side to check.',
          'A **particle** keeps its mass but is treated as having no size. Fair for a load sliding without turning; not fair once it can tip.',
          'A **rigid body** does not deform under load, so its material doesn\'t matter to the forces. Steel shelves qualify; a rubber one folds and changes the lever arm.',
          '**Concentrated forces** are assumed to act at a point on a body. Fair when the loaded area is small (a wheel on a rail); for a wide load, put the point at the load\'s middle.',
          'A deformation can be too small to matter for the forces and still big enough to matter for the fit-up.'
        ]
      }
    ]
  });

  /* ------------------------------------------------------------- parts */

  var D = Y.dial;
  // Runners mixed with concrete (μs 0.70, μk 0.60) by geometric mean give μ = 0.10 greased.
  var RUNNERS = {
    greased: { name: 'greased', label: 'Greased runners', density: 400, friction: 0.01 / 0.6, muS: 0.01 / 0.7, muK: 0.01 / 0.6, restitution: 0.05 },
    bare: { name: 'bare', label: 'Bare timber runners', density: 400, friction: 0.5, muS: 0.5, muK: 0.5, restitution: 0.05 }
  };
  var SHAPES = {
    'point': { w: 0.1, h: 0.1, point: true },
    'crate 1 m': { w: 1, h: 1 },
    'ladder sled 4.5 m': { w: 4.5, h: 0.4 },
    'tall crate 2 m': { w: 0.5, h: 2 }
  };

  // A test load whose shape you can swap while its mass stays put. Its base
  // stays where a 1 m crate's base would be (inst.y - 0.5).
  Y.definePart({
    type: 'h03-crate', name: 'Test load', category: 'Loads', library: false,
    blurb: 'The same mass in different shapes: a point, a 1 m crate, a 4.5 m ladder sled or a tall crate.',
    size: { w: 1, h: 1 },
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '60 kg', min: 0.1, max: 1e5 },
      { key: 'shape', label: 'Shape', choice: Object.keys(SHAPES), def: 'crate 1 m' },
      { key: 'runners', label: 'Runners', choice: ['greased', 'bare'], def: 'greased' }
    ],
    anchors: { top: { x: 0, y: 0.5 }, bottom: { x: 0, y: -0.5 } },
    build: function (b) {
      var sh = SHAPES[b.text('shape')], base = b.at({ x: 0, y: -0.5 });
      var c = { x: base.x, y: base.y + sh.h / 2 };
      var body = b.body({ position: c, label: b.inst.label || 'load', fixedRotation: !!sh.point,
        shapes: [{ shape: b.P.box(sh.w / 2, sh.h / 2), material: RUNNERS[b.text('runners')] }], mass: b.si('mass') });
      var x0 = c.x;
      return {
        body: body, shapeDef: sh,
        anchors: { top: { body: body, local: body.localPoint({ x: c.x, y: c.y + sh.h / 2 }) }, bottom: { body: body, local: body.localPoint({ x: c.x, y: c.y - sh.h / 2 }) } },
        travel: function () { return body.c.x - x0; },
        tilt: function () { return body.angle; }
      };
    },
    readouts: function (built) {
      var body = built.body;
      return [
        { key: 'travel', label: 'travel', q: 'length', read: function () { return built.travel(); } },
        { key: 'speed', label: 'speed', q: 'speed', read: function () { return body.v.x; } },
        { key: 'tilt', label: 'tilt', q: 'angle', read: function () { return built.tilt(); } }
      ];
    },
    plate: function (inst) { return [inst.dials.mass + ' · ' + inst.dials.shape]; }
  });

  var SHELF_MATS = ['steel', 'aluminium', 'timber', 'rubber'];
  // A cantilever shelf bolted to a wall at (x, y), running right. Built as a
  // Hencky bar chain (P.structures.beam) with its own weight, so it really
  // sags and yields.
  Y.definePart({
    type: 'h03-shelf', name: 'Cantilever shelf', category: 'Structures', library: false,
    blurb: 'A bar bolted to the wall at its left end. Choose what it is made of and its cross-section.',
    size: { w: 2.4, h: 0.12 },
    dials: [
      { key: 'material', label: 'Material', choice: SHELF_MATS, def: 'steel' },
      { key: 'length', label: 'Length', q: 'length', def: '2.4 m', min: 0.5, max: 12 },
      { key: 'depth', label: 'Depth', q: 'length', def: '120 mm', min: 0.005, max: 1 },
      { key: 'width', label: 'Width', q: 'length', def: '80 mm', min: 0.005, max: 1 }
    ],
    build: function (b) {
      var L = b.si('length'), h = b.si('depth'), w = b.si('width');
      var root = b.at({ x: 0, y: 0 }), end = b.at({ x: L, y: 0 });
      var bm = b.P.structures.beam(b.world, {
        start: root, end: end, section: { b: w, h: h }, material: b.text('material'), segments: 20, damping: 0.6,
        supports: [{ at: 'start', type: 'fixed' }], ground: b.ground, label: b.inst.label || 'shelf'
      });
      bm.bodies.forEach(function (body, i) {
        body.userData = Object.assign({}, body.userData, { part: b.inst.id });
        body.label = i === Math.floor(bm.bodies.length / 2) ? (b.inst.label || 'shelf') : '';
      });
      bm.links.forEach(function (l) { if (l) l.userData = Object.assign({}, l.userData, { part: b.inst.id }); });
      var last = bm.bodies[bm.bodies.length - 1], first = bm.bodies[0];
      return {
        body: first, bodies: bm.bodies, beam: bm,
        anchors: {
          root: { body: first, local: first.localPoint(root) },
          mid: { body: bm.pointAt(L / 2).body, local: bm.pointAt(L / 2).body.localPoint(b.at({ x: L / 2, y: 0 })) },
          tip: { body: last, local: last.localPoint(end) }
        },
        sag: function () { return -bm.deflection(L); },
        moment: function () { return Math.abs(bm.bendingMoment(0)); },
        shear: function () { return Math.abs(bm.shearForce(0)); }
      };
    },
    readouts: function (built) {
      return [
        { key: 'sag', label: 'tip sag', q: 'length', read: function () { return built.sag(); } },
        { key: 'moment', label: 'wall moment', q: 'moment', read: function () { return built.moment(); } },
        { key: 'shear', label: 'wall force', q: 'force', read: function () { return built.shear(); } }
      ];
    },
    plate: function (inst) { return [inst.dials.material + ' ' + inst.dials.width + ' × ' + inst.dials.depth, 'E ' + D.format(SE.phys.material(inst.dials.material).E, 'GPa', 3, 'pressure')]; }
  });

  // Sandbags laid on a shelf: their weight spread evenly over `spread`,
  // centred `centre` from the wall. Spread 0 puts it all at one point.
  Y.definePart({
    type: 'h03-bags', name: 'Sandbags', category: 'Loads', library: false,
    blurb: 'A row of sandbags on a shelf. Their weight is spread evenly over the length they cover.',
    size: { w: 1.2, h: 0.3 },
    connector: true, attach: true,
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '300 kg', min: 0, max: 1e5 },
      { key: 'spread', label: 'Spread over', q: 'length', def: '1.2 m', min: 0, max: 20 },
      { key: 'centre', label: 'Centre from wall', q: 'length', def: '1.8 m', min: 0, max: 20 }
    ],
    build: function (b) {
      var sh = b.out.parts[b.inst.a && b.inst.a.part];
      if (!sh || !sh.beam) throw new Error('Sandbags go on a shelf.');
      var bm = sh.beam, L = bm.length, W = b.si('mass') * b.site.g, c = b.si('spread'), xc = b.si('centre');
      var x0 = Math.max(0, xc - c / 2), x1 = Math.min(L, xc + c / 2);
      if (xc > L + 1e-9) throw new Error('The sandbags\' centre is past the end of the shelf.');
      var n = c < 1e-9 ? 1 : Math.max(2, Math.round((x1 - x0) / 0.04));
      var xs = [];
      for (var i = 0; i < n; i++) xs.push(n === 1 ? Math.min(L, xc) : x0 + (i + 0.5) * (x1 - x0) / n);
      xs.forEach(function (x) { bm.load(x, { x: 0, y: -W / n }); });
      return { beam: bm, xs: xs, x0: n === 1 ? xs[0] : x0, x1: n === 1 ? xs[0] : x1 };
    },
    draw: function (ctx, cam, built) {
      var bm = built.beam, half = bm.section.depth / 2;
      var pts = [], n = Math.max(1, Math.round((built.x1 - built.x0) / 0.3));
      for (var i = 0; i < n; i++) pts.push(n === 1 && built.x1 === built.x0 ? built.x0 : built.x0 + (i + 0.5) * (built.x1 - built.x0) / n);
      ctx.save();
      pts.forEach(function (x) {
        var p = bm.pointAt(x).point, s = cam.worldToScreen({ x: p.x, y: p.y + half });
        var wpx = (built.x1 > built.x0 ? (built.x1 - built.x0) / n : 0.08) * cam.zoom;
        ctx.fillStyle = '#b89c6a'; ctx.strokeStyle = '#6d5a3a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(s.x - wpx / 2 + 1, s.y - 0.22 * cam.zoom, Math.max(3, wpx - 2), 0.22 * cam.zoom); ctx.fill(); ctx.stroke();
      });
      if (built.x1 === built.x0) {
        var p = bm.pointAt(built.x0).point, s = cam.worldToScreen({ x: p.x, y: p.y + half });
        ctx.strokeStyle = '#ffb347'; ctx.fillStyle = '#ffb347'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 0.22 * cam.zoom - 40); ctx.lineTo(s.x, s.y - 0.22 * cam.zoom - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 0.22 * cam.zoom); ctx.lineTo(s.x - 6, s.y - 0.22 * cam.zoom - 12); ctx.lineTo(s.x + 6, s.y - 0.22 * cam.zoom - 12); ctx.fill();
      }
      ctx.restore();
    },
    plate: function (inst) { return [inst.dials.mass + ' over ' + inst.dials.spread]; }
  });
  // A crate slung 0.7 m below a point on a shelf. Its weight is a load on
  // the shelf at that point, which follows the shelf as it bends. If the
  // crate comes down on something below it (the floor, a truck bed), that
  // carries the weight instead and the crate is marked as landed.
  var SLING = 0.7, BOX = 1;
  Y.definePart({
    type: 'h03-hang', name: 'Slung crate', category: 'Loads', library: false,
    blurb: 'A crate on a short sling under a shelf. Set its mass and how far from the wall it hangs.',
    size: { w: 1, h: 1.7 },
    connector: true, attach: true,
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '100 kg', min: 0, max: 1e5 },
      { key: 'at', label: 'Distance from wall', q: 'length', def: '2.4 m', min: 0, max: 20 }
    ],
    build: function (b) {
      var sh = b.out.parts[b.inst.a && b.inst.a.part];
      if (!sh || !sh.beam) throw new Error('A slung crate hangs from a shelf.');
      var bm = sh.beam, x = b.si('at'), W = b.si('mass') * b.site.g;
      if (x > bm.length + 1e-9) throw new Error('That is past the end of the shelf.');
      var out = b.out, built = { beam: bm, x: x, landed: false };
      // the hoist takes the weight up smoothly over the first second
      var RAMP = 1, world = b.world;
      var ld = bm.load(x, { x: 0, y: 0 });
      // the highest static top under the crate (floor, truck bed)
      function below(px) {
        var top = out.site.floor ? 0 : -Infinity;
        Object.keys(out.parts).forEach(function (id) {
          var p = out.parts[id];
          if (p.def.type !== 'block' || !p.body) return;
          var hw = p.values.width / 2, hh = p.values.height / 2, c = p.body.position;
          if (px + BOX / 2 > c.x - hw && px - BOX / 2 < c.x + hw && c.y + hh < bm.start.y) top = Math.max(top, c.y + hh);
        });
        return top;
      }
      built.hookPoint = function () { return bm.pointAt(x).point; };
      built.below = below;
      built.gap = function () { var h = built.hookPoint(); return h.y - SLING - BOX - below(h.x); };
      b.on('step', function () {
        if (!built.landed && built.gap() <= 0) built.landed = true;
        ld.F.y = built.landed ? 0 : -W * Math.min(1, world.time / RAMP);
      });
      return built;
    },
    draw: function (ctx, cam, built) {
      var h = built.hookPoint(), top = Math.max(h.y - SLING, built.below(h.x) + BOX);
      var a = cam.worldToScreen(h), c = cam.worldToScreen({ x: h.x, y: top });
      ctx.save();
      ctx.strokeStyle = '#c9b27c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      var tl = cam.worldToScreen({ x: h.x - BOX / 2, y: top });
      ctx.fillStyle = '#7d6a4f'; ctx.strokeStyle = '#4a3d2c'; ctx.lineWidth = 2;
      ctx.fillRect(tl.x, tl.y, BOX * cam.zoom, BOX * cam.zoom); ctx.strokeRect(tl.x, tl.y, BOX * cam.zoom, BOX * cam.zoom);
      ctx.fillStyle = '#efe6d2'; ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillText(built.inst.dials.mass, tl.x + 6, tl.y + 18);
      ctx.restore();
    },
    readouts: function (built) { return [{ key: 'gap', label: 'gap below crate', q: 'length', read: function () { return built.gap(); } }]; },
    plate: function (inst) { return [inst.dials.mass + ' at ' + inst.dials.at]; }
  });
})(globalThis.SE);
