/*
 * H2 · Push and Pull: the four basic quantities of mechanics (length, time,
 * mass, force), forces by contact and at a distance, and the three things
 * that pin a force down: how big, which way, and where it acts. Course section 1.2. Played in the build yard.
 *
 * Most of the level is the yard gate seen from the watchtower (plan view, so
 * the site has no gravity and no floor). The gate swings on a pin at its left
 * end. The horde leans on it from outside with a fixed push; the player bolts
 * a hydraulic ram between the footing slab and any ring on the gate, so they
 * choose where the ram acts, which way it points and how hard it pushes.
 * Moments are not taught until Chapter 4, so the level never names them: the
 * gate is the judge, and the words stay "how far from the hinge" and "how
 * square to the gate".
 *
 * Gate numbers: 3 m, 120 kg, 40 N·m of hinge friction, starts 20° ajar
 * (opened inward). The jamb stops it at closed. Hitting the jamb faster than
 * 2.5 m/s at the tip cracks the latch.
 *   Demo horde: 350 N at ring a4, 2.0 m from the hinge (350 x 2.0 = 700 N·m).
 *   With a 300 N ram square on, it needs more than 700 / 300 = 2.33 m, plus the
 *   hinge friction, so only the end ring (3.0 m) clearly wins.
 *   Job horde: 0.42 kN at 2.0 m (840 N·m). The ram tops out at 0.6 kN, so
 *   it has to sit well out from the hinge even square on; near the hinge it
 *   can't win. At the latch bracket (ring a5, 2.5 m) square on it needs a bit more
 *   than 840 / 2.5 = 336 N, and above roughly 480 N the gate slams.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals;
  var DEG = Math.PI / 180;
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };

  var AJAR = 20;            // deg, how far open the gate starts
  var SLAM = 2.5;           // m/s at the tip: the latch rating
  var RAM_MAX = 600;        // N, the job ram's pump limit

  // ----------------------------------------------------------- the gate yard
  function gateParts(hordeForce) {
    return [
      { id: 'footing', type: 'zone', x: 2.25, y: -2.4, dials: { width: '6.5 m', height: '2.6 m' }, locked: true, label: 'ram footing (bolt the ram base here)' },
      { id: 'gate', type: 'gate', x: 0, y: 0, angle: -AJAR * DEG, dials: { width: '3 m', mass: '120 kg', friction: '40 N*m' }, locked: true, label: 'yard gate' },
      { id: 'jamb', type: 'block', x: 3.05, y: 0.22, dials: { width: '0.3 m', height: '0.3 m' }, locked: true, label: 'jamb' },
      { id: 'horde', type: 'push', a: { part: 'gate', anchor: 'a4' }, dials: { force: hordeForce, angle: '-90 deg', time: '600 s', start: '0 s' }, locked: true, label: 'the horde' }
    ];
  }
  var GATE = {
    site: { g: 0, floor: null },
    camera: { fit: { lo: { x: -1.5, y: -4 }, hi: { x: 6, y: 2 } } },
    poke: false,
    design: { parts: gateParts('350 N') }
  };
  var JOB_DESIGN = { parts: gateParts('0.42 kN') };
  function gateYard(extra) { return Object.assign({ design: GATE.design, site: GATE.site, camera: GATE.camera }, extra || {}); }

  // The side-on yard for gravity and the two carts.
  var SPUR = {
    site: { g: 9.81, floor: 'concrete' },
    camera: { fit: { lo: { x: -1, y: -1 }, hi: { x: 26, y: 6 } } },
    design: { parts: [
      { id: 'heavy', type: 'cart', x: 2, y: 0.25, dials: { mass: '160 kg' }, locked: true, label: 'loaded cart' },
      { id: 'light', type: 'cart', x: 8, y: 0.25, dials: { mass: '40 kg' }, locked: true, label: 'empty cart' }
    ] }
  };

  // ------------------------------------------------------------ geometry
  // Where a ram meets the gate and how square it is to the gate face, from a
  // fresh build of the design (so it is the as-placed geometry, not the end
  // of the last run).
  //   -> { d: m from the hinge, theta: deg from the gate face (90 = square), F: N }
  function ramOnGate(design, ram) {
    if (!ram || !ram.a || !ram.b) return null;
    var onA = ram.a.part === 'gate', onB = ram.b.part === 'gate';
    if (onA === onB) return null;
    var gate = design.parts.filter(function (p) { return p.id === 'gate'; })[0];
    if (!gate) return null;
    var built = Y.build({ parts: design.parts.filter(function (p) { return !Y.partDef(p.type).connector; }) }, GATE.site), P, Q;
    try { P = Y.resolveEnd(built, onA ? ram.a : ram.b).world; Q = Y.resolveEnd(built, onA ? ram.b : ram.a).world; }
    catch (e) { return null; }
    var ga = gate.angle || 0, ux = Math.cos(ga), uy = Math.sin(ga);
    var rx = P.x - Q.x, ry = P.y - Q.y, L = Math.hypot(rx, ry);
    if (L < 1e-6) return null;
    var c = Math.abs((rx * ux + ry * uy) / L);
    var F = Y.dial.parse(ram.dials.force, 'force');
    return { d: Math.hypot(P.x - gate.x, P.y - gate.y), theta: Math.acos(Math.min(1, c)) / DEG, F: F.ok ? F.si : NaN };
  }
  function theRam(ctx) { return ctx.all('ram').filter(function (r) { return ramOnGate(ctx.design, r); })[0] || null; }

  // What the gate did in a finished run.
  function outcome(state) {
    var a = state.read('gate.angle') / DEG;
    var hit = state.impacts.filter(function (i) { return (i.a === 'gate' && i.b === 'jamb') || (i.a === 'jamb' && i.b === 'gate'); })
      .reduce(function (m, i) { return Math.max(m, i.speed); }, 0);
    if (hit > SLAM) return { kind: 'slammed', hit: hit, a: a };
    if (a >= AJAR - 1) return { kind: 'closed', hit: hit, a: a };
    if (a < -8) return { kind: 'opened', hit: hit, a: a };
    return { kind: 'held', hit: hit, a: a };
  }
  var SAY = {
    opened: 'the horde won and **the gate swung open**',
    closed: 'the gate **swung shut** and stayed shut',
    slammed: 'the gate **slammed** into the jamb and cracked the latch',
    held: 'the gate **barely moved**: still ajar, still a gap'
  };
  function runLine(r) {
    return '- **' + f3(r.F) + ' N** at **' + r.d.toFixed(1) + ' m** from the hinge, **' + Math.round(r.theta) + '°** to the gate: ' + SAY[r.kind] +
      (r.kind === 'slammed' ? ' (' + r.hit.toFixed(1) + ' m/s at the tip)' : '') + '.';
  }
  // Log each finished run with the ram that made it, under ctx.values[key].
  function logRun(ctx, key) {
    var ram = theRam(ctx), g = ram && ramOnGate(ctx.design, ram);
    var list = ctx.values[key] = ctx.values[key] || [];
    if (!g || !ctx.result || !ctx.result.state) return list;
    var o = outcome(ctx.result.state);
    list.push({ d: g.d, theta: g.theta, F: g.F, kind: o.kind, hit: o.hit, a: o.a });
    return list;
  }

  // ------------------------------------------------------------- the job
  var jobGoal = G.all(
    G.never(function (s) {
      var over = Object.keys(s.built.parts).filter(function (id) { var p = s.built.parts[id]; return p.def.type === 'ram' && p.values.force > RAM_MAX + 1e-6; });
      return over.length ? 'That ram\'s pump tops out at 0.6 kN. The crew can\'t set it any higher.' : null;
    }),
    G.never(function (s) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'gate' && i.b === 'jamb') || (i.a === 'jamb' && i.b === 'gate'); })[0];
      return hit && hit.speed > SLAM ? 'The gate slammed into the jamb at ' + hit.speed.toFixed(1) + ' m/s and cracked the latch (rated 2.5 m/s).' : null;
    }),
    G.never(function (s) { return s.read('gate.angle') < -8 * DEG ? 'The horde won. The gate swung wide open.' : null; }),
    function (s) {
      var a = s.read('gate.angle'), w = s.body('gate').w;
      s.peak('tip', w * 3);
      return s.held('shut', a >= (AJAR - 1) * DEG && Math.abs(w) < 0.02, 2) ? true : undefined;
    }
  );

  function ramAt(anchor, base, force) {
    return { type: 'ram', a: { part: 'footing', local: { x: base.x - 2.25, y: base.y + 2.4 } }, b: { part: 'gate', anchor: anchor }, dials: { force: force, stroke: '1.5 m', retract: '1 m' } };
  }

  SE.content.registerLevel('ch01', {
    id: 'H2', order: 2, title: 'Push and Pull',
    subtitle: 'What a force is, and what it takes to describe one',
    sections: ['1.2'],
    minutes: 20,
    intro: [
      'The yard gate is groaning. Five of the dead are leaning on the outside of it, and it has already swung a hand\'s width open.',
      'Hask doesn\'t look worried. "Good. A live lesson. Before you can design anything, you need the four quantities every problem in mechanics is built from, and you need to know exactly what it takes to describe a push. Most people get one of the three parts wrong. Let\'s see which one you miss."'
    ].join('\n\n'),
    goals: [
      'Name the four basic quantities of mechanics and what each one describes',
      'Tell forces by **contact** from forces **at a distance**',
      'Describe a force completely: **magnitude**, **direction** and **point of application**'
    ],
    yard: GATE,
    // Reference builds for the scored job (checked by tests/yard.test.js).
    solutions: {
      'H2.gate': [
        // latch bracket, square on, 0.45 kN: closes gently and stays shut
        { add: [ramAt('a5', { x: 2.5, y: -2 }, '0.45 kN')] },
        // the end ring, square on, 0.35 kN: also fine
        { add: [ramAt('a6', { x: 3, y: -2 }, '0.35 kN')] },
        // right by the hinge: the most the pump makes isn't nearly enough
        { pass: false, add: [ramAt('a1', { x: 0.5, y: -2 }, '0.6 kN')] },
        // far ring but leaning along the gate: most of the push goes into the pin
        { pass: false, add: [ramAt('a6', { x: 0.5, y: -1.7 }, '0.45 kN')] },
        // far ring, square on, flat out: slams
        { pass: false, add: [ramAt('a6', { x: 3, y: -2 }, '0.6 kN')] },
        // right spot and direction, but the pump can't be set past its limit
        { pass: false, add: [ramAt('a1', { x: 0.5, y: -2 }, '2 kN')] },
        // a slip of a prefix: 450 mN instead of 450 N does nothing
        { pass: false, add: [ramAt('a5', { x: 2.5, y: -2 }, '450 mN')] }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'This is the gate from the watchtower, looking straight down. The hinge pin is on the left, the jamb on the right. The orange arrow is the horde: **350 N**, leaning on the gate **2 m** out from the hinge.\n\nFirst, see what that does with nobody pushing back.'
      },
      {
        type: 'watch', who: 'hask',
        yard: gateYard({ bin: [], goal: G.after(5) }),
        text: 'Press **▶ Run** and watch the gate.',
        goalText: 'Run it once',
        until: function (ctx, type) { return type === 'result' && !!ctx.result; },
        after: function (ctx) { return 'In five seconds the gate swung to **' + Math.round(AJAR - ctx.result.state.read('gate.angle') / DEG) + '°** open. A push, from one body on another, changed how the gate moves. That is what a **force** is.'; }
      },
      // ---------------------------------------------- point of application
      {
        type: 'build', who: 'hask', kicker: 'Where it pushes',
        yard: gateYard({ bin: [{ type: 'ram', count: 1, dials: { force: '300 N', stroke: '1.5 m', retract: '1 m' }, fixed: ['force', 'stroke', 'retract'], label: 'crew ram, 300 N' }], goal: G.after(6) }),
        text: 'Here\'s a hydraulic ram that pushes **300 N** and not a newton more. Click a spot on the **footing** for its base, then a **ring on the gate** for its rod. Keep it roughly square to the gate.\n\nRun it with the rod on a ring **near the hinge**, then move it (Remove, place it again) to the **end ring** and run again. The horde is pushing 350 N, more than the ram, so the size alone can\'t decide this.',
        goalText: 'One run near the hinge (1 m or less), one at the end (2.5 m or more)',
        until: function (ctx, type) {
          var list = type === 'result' ? logRun(ctx, 'point') : (ctx.values.point || []);
          var near = list.some(function (r) { return r.d <= 1.01; }), far = list.some(function (r) { return r.d >= 2.49; });
          if (near && far) return true;
          if (type === 'result' && !theRam(ctx)) return 'The ram needs one end on the footing and the other on a ring of the gate.';
          return list.length ? (near ? 'Now try a ring **at the far end** of the gate.' : 'Now try a ring **close to the hinge**.') : false;
        },
        hint: 'The small rings on the gate are every 0.5 m from the hinge. A base straight below the ring keeps the ram square on.',
        after: function (ctx) { return 'Your runs:\n\n' + ctx.values.point.map(runLine).join('\n') + '\n\nSame push, same direction, different spot, different result. Where a force acts, its **point of application**, is part of what the force *is*.'; }
      },
      // ---------------------------------------------------------- direction
      {
        type: 'build', who: 'hask', kicker: 'Which way it pushes',
        yard: gateYard({ bin: [{ type: 'ram', count: 1, dials: { force: '300 N', stroke: '1.5 m', retract: '1 m' }, fixed: ['force', 'stroke', 'retract'], label: 'crew ram, 300 N' }], goal: G.after(6) }),
        text: 'Keep the rod on the **end ring**. This time move the **base** around the footing, so the ram leans along the gate instead of pushing square on. Run one ram **nearly square** (more than 60° to the gate) and one **leaning hard** (less than 30°).',
        goalText: 'End ring: one run nearly square, one leaning hard',
        until: function (ctx, type) {
          var list = type === 'result' ? logRun(ctx, 'dir') : (ctx.values.dir || []);
          var end = list.filter(function (r) { return r.d >= 2.49; });
          var sq = end.some(function (r) { return r.theta > 60; }), lean = end.some(function (r) { return r.theta < 30; });
          if (sq && lean) return true;
          if (list.length && !end.length) return 'Put the rod on the **end ring** for this one.';
          return end.length ? (sq ? 'Now slide the base sideways so the ram **leans along** the gate, under 30°.' : 'Now put the base straight below the ring, **nearly square on**.') : false;
        },
        hint: 'To lean the ram, put its base far over to the left on the footing, close to the gate line, and the rod on the end ring.',
        after: function (ctx) { return 'Your runs:\n\n' + ctx.values.dir.map(runLine).join('\n') + '\n\nSame size, same spot, different **direction**, different result. A push that leans along the gate mostly shoves the hinge pin, and only the part of it square to the gate swings the gate.'; }
      },
      // ---------------------------------------------------------- magnitude
      {
        type: 'build', who: 'hask', kicker: 'How hard it pushes',
        yard: gateYard({ bin: [{ type: 'ram', count: 1, dials: { force: '300 N', stroke: '1.5 m', retract: '1 m' }, fixed: ['stroke', 'retract'], label: 'crew ram' }], goal: G.after(6) }),
        text: 'Now the force dial is yours. Bolt the ram square on at the **end ring** or the latch bracket next to it. Set its **force** and shut the gate *gently*: if the tip hits the jamb faster than **2.5 m/s**, the latch cracks.\n\nTry one that\'s too much as well, so you see it.',
        goalText: 'A gentle close, and one run that slams',
        until: function (ctx, type) {
          var list = type === 'result' ? logRun(ctx, 'mag') : (ctx.values.mag || []);
          var good = list.some(function (r) { return r.kind === 'closed'; }), slam = list.some(function (r) { return r.kind === 'slammed'; });
          if (good && slam) return true;
          if (good) return 'That\'s a clean close. Now push **much harder** and watch what happens.';
          if (slam) return 'Too hard. Back the force off until it closes without slamming.';
          return list.length ? 'Not shut yet. Push a little harder.' : false;
        },
        hint: 'Square on at the end ring, around **300 N** closes it gently. **1 kN** will certainly slam it.',
        after: function (ctx) { return 'Your runs:\n\n' + ctx.values.mag.map(runLine).join('\n') + '\n\nToo little and the horde wins, too much and the latch cracks. The **magnitude** is the third thing you have to get right.'; }
      },
      {
        type: 'reveal', kicker: 'Principle', title: 'What makes a force',
        eq: '\\t{force} = \\t{magnitude} + \\t{direction} + \\t{point of application}',
        text: 'A **force** is a push or a pull that one body exerts on another. You changed one of these three at a time, and every change changed what the gate did. Knowing all three tells you everything about a force:\n\n- **Magnitude**: how big (newtons).\n- **Direction**: which way it acts.\n- **Point of application**: where on the body it acts.\n\nLeave any one off a work order and the crew is guessing.',
        formula: 'ch01.force'
      },
      // ------------------------------------------------------------- time
      {
        type: 'watch', who: 'hask', kicker: 'Does the clock matter?',
        yard: {
          keep: true,
          goal: function (s) {
            if (s.t >= 5 && s.memo.p5 == null) { s.memo.p5 = s.read('gate.pinForce'); s.memo.a5 = s.read('gate.angle'); }
            if (s.t >= 25) { s.memo.p25 = s.read('gate.pinForce'); s.memo.a25 = s.read('gate.angle'); return true; }
          }
        },
        text: 'Leave your gentle ram where it is (set it back to a gentle force if the last run slammed). Run it again, and this time let it go for **25 s**. Watch the **pin force** gauge once the gate is shut.',
        goalText: 'A 25 s run with the gate shut',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result || !ctx.result.state.memo.p25) return false;
          var m = ctx.result.state.memo;
          return m.a5 >= (AJAR - 1) * DEG ? true : 'The gate wasn\'t shut by 5 s. Set the ram to a gentle closing force and run it again.';
        },
        after: function (ctx) {
          var m = ctx.result.state.memo;
          return 'Pin force at **5 s**: **' + f3(m.p5) + ' N**. At **25 s**: **' + f3(m.p25) + ' N**. Twenty seconds went by and nothing changed, because nothing was moving.\n\n**Time** is the order in which events happen. A problem where everything sits still doesn\'t depend on it, which is why statics never needs a clock. Time matters as soon as things move and speed up, as the gate did while it swung.';
        }
      },
      // ---------------------------------------- contact vs at a distance
      {
        type: 'build', who: 'hask', kicker: 'Touching, or not',
        yard: { design: SPUR.design, site: SPUR.site, camera: SPUR.camera, bin: [{ type: 'crate', count: 1, dials: { mass: '20 kg' } }], goal: G.after(2) },
        text: 'Back to ground level, side on. The ram touched the gate to push it. That is a force by **contact**.\n\nPlace the **crate** up in the air, well above the floor, and run it. Nothing in the yard touches it.',
        goalText: 'A crate dropped from 2 m or higher',
        until: function (ctx, type) {
          var c = ctx.find('crate');
          if (!c) return false;
          if (c.y < 2) return 'Put it higher: drag it up so it starts at least 2 m above the floor.';
          if (type !== 'result' || !ctx.result) return false;
          var p = ctx.result.state.pos(c.id);
          return p && p.y < c.y - 1 ? true : false;
        },
        after: 'It fell, with nothing touching it. The Earth pulled on it from a distance. Gravity acts **at a distance**, and so do electric and magnetic forces: a scrapyard electromagnet grabs a steel plate across an air gap, and a lodestone swings a compass needle without touching it. Everything else you\'ll build with (ropes, rams, hands, wind on a tarp, water on a dam) acts by **contact**.'
      },
      // ------------------------------------------------------------- mass
      {
        type: 'build', who: 'hask', kicker: 'What mass does',
        yard: { design: SPUR.design, site: SPUR.site, camera: SPUR.camera,
          bin: [{ type: 'push', count: 2, dials: { force: '80 N', angle: '0 deg', time: '3 s', start: '0 s' }, fixed: ['force', 'angle', 'time', 'start'], label: '80 N for 3 s' }],
          goal: G.after(4) },
        text: 'Two carts on greased rollers: one **empty** at 40 kg, one **loaded** at 160 kg. Clip one of the identical pushes (**80 N for 3 s**) to each cart, and run it.',
        goalText: 'Both carts pushed, and run',
        until: function (ctx, type) {
          var on = function (id) { return ctx.all('push').some(function (p) { return p.a && p.a.part === id; }); };
          if (!(on('heavy') && on('light'))) return ctx.all('push').length ? 'Each cart needs its own push.' : false;
          return type === 'result' && !!ctx.result;
        },
        after: function (ctx) {
          var s = ctx.result.state;
          return 'Coasting speeds after the push: empty cart **' + f3(s.vel('light').x) + ' m/s**, loaded cart **' + f3(s.vel('heavy').x) + ' m/s**. Four times the mass, a quarter of the speed.';
        }
      },
      {
        type: 'rule', title: 'Mass resists a change in velocity',
        law: 'v = \\frac{F\\,t}{m}',
        eq: function (ctx) {
          var s = ctx.result.state;
          return [
            '\\t{empty: } \\frac{(80\\u{ N})(3\\u{ s})}{40\\u{ kg}} = 6\\u{ m/s} \\quad (\\t{measured } ' + f3(s.vel('light').x) + '\\u{ m/s})',
            '\\t{loaded: } \\frac{(80\\u{ N})(3\\u{ s})}{160\\u{ kg}} = 1.5\\u{ m/s} \\quad (\\t{measured } ' + f3(s.vel('heavy').x) + '\\u{ m/s})'
          ];
        },
        text: '**Mass** is the quantity of matter in a body. You just saw one of the two ways it shows up: it **resists changes in velocity**, so the same push changes a heavy body\'s speed less. The other way is that mass is what gravity pulls on, so any two masses attract each other. That is the crate you dropped. Both come back soon, in Newton\'s laws and in weight.'
      },
      {
        type: 'reveal', kicker: 'Definitions', title: 'The four basic quantities',
        text: 'Everything in mechanics is built from four quantities.',
        table: {
          head: ['Quantity', 'What it describes', 'Where you met it here'],
          rows: [
            ['Length', 'where a point is, and how big a body is', 'how far from the hinge you bolted the ram'],
            ['Time', 'the succession of events', 'the shut gate: 5 s or 25 s, same pin force'],
            ['Mass', 'quantity of matter: resists changes in velocity, and is attracted by gravity', 'the empty and loaded carts'],
            ['Force', 'one body pushing or pulling on another, by contact or at a distance', 'your ram against the horde, and the falling crate']
          ]
        }
      },
      {
        type: 'deeper', title: 'When the point of application stops mattering',
        teaser: 'Two cases where you can relax the "where" part of a force: particles, and sliding a force along its own line.',
        steps: [
          { type: 'say', who: 'hask', text: 'If a body is small compared with everything around it, you can treat it as a **particle**: all its mass at one point. Then every force on it acts at that same point, and "point of application" has nothing left to tell you. Only magnitude and direction remain. That\'s why the next levels can treat a crate on a long cable as a dot.' },
          { type: 'say', who: 'hask', text: 'For a rigid body there\'s a second shortcut. A force can slide anywhere along its own **line of action** without changing how the whole body moves or balances. That\'s the **principle of transmissibility**. Try it in free play: move the ram\'s base farther back along the same line, so the ram is longer but pushes the same ring the same way. The gate can\'t tell the difference.\n\nIt only covers the outside effect. Inside the body it matters: pull one end of a bar and it stretches, push the other end along the same line and it squashes. Real bodies aren\'t perfectly rigid, and that difference is the subject of strength of materials.' }
        ]
      },
      // ---------------------------------------------------- scored job
      {
        type: 'job', id: 'H2.gate', who: 'juno',
        yard: gateYard({ design: JOB_DESIGN, bin: [{ type: 'ram', count: 1, dials: { force: '0.2 kN', stroke: '1.5 m', retract: '1 m' }, fixed: ['stroke', 'retract'], label: 'night-shift ram, 0.6 kN max' }] }),
        text: [
          'Juno, on the radio: "More of them now. They\'re leaning **0.42 kN** on the gate, still 2 m out from the hinge. Night shift has one ram left, and its pump tops out at **0.6 kN**."',
          'Bolt the ram where you like and set its force. Shut the gate **without cracking the latch** (tip under 2.5 m/s at the jamb) and keep it shut.'
        ].join('\n\n'),
        goalText: 'Gate shut and still for 2 s, latch intact',
        goal: jobGoal,
        timeout: 20,
        onFail: function (ctx) {
          var ram = theRam(ctx), g = ram && ramOnGate(ctx.design, ram);
          return g ? 'Your ram: **' + f3(g.F) + ' N**, **' + g.d.toFixed(1) + ' m** from the hinge, **' + Math.round(g.theta) + '°** to the gate.' : 'The ram needs one end on the footing and the other on a ring of the gate.';
        },
        hints: [
          'Think about all three parts of the ram\'s force. Near the hinge even 0.6 kN won\'t win, and a ram leaning along the gate wastes most of its push.',
          'Square on at the latch bracket (2.5 m from the hinge), the horde\'s 0.42 kN at 2 m needs a bit more than 0.42 × 2 / 2.5 = **0.336 kN** to win. Much more than that and the gate picks up too much speed.',
          'Base straight below the ring 2.5 m out, rod on that ring, force **0.45 kN**.'
        ],
        margin: function (s) { return Math.round(Math.min(10, Math.max(0, s.peakOf('tip') - 1) * 5)); },
        success: 'Shut, latched and quiet. You had to choose all three: **where** the ram pushes, **which way**, and **how hard**. Get any one wrong and the same ram either loses to the horde or cracks the latch.'
      },
      {
        type: 'free', who: 'hask',
        yard: gateYard({ bin: [{ type: 'ram', count: 3, dials: { force: '300 N', stroke: '1.5 m', retract: '1 m' } }, { type: 'push', count: 3 }], goal: null }),
        text: 'The gate is yours. Rams bolt from the footing to a ring; pushes clip straight onto a ring of the gate (0° pushes right, 90° pushes up the screen).',
        prompts: [
          'Push straight along the gate toward the hinge with 2 kN. What happens?',
          'Halve the distance from the hinge. How much bigger must the ram\'s push be to keep up?',
          'Move a ram\'s base back along the same line so the ram is longer. Does the gate notice?',
          'Find the lean where 300 N at the end ring stops beating the horde.'
        ]
      },
      {
        type: 'summary',
        points: [
          'The four basic quantities: **length** (position and size), **time** (succession of events; statics doesn\'t depend on it), **mass** (quantity of matter; resists changes in velocity and is attracted by gravity), and **force**.',
          'A force is one body pushing or pulling on another, by **contact** or **at a distance** (gravitational, electrical, magnetic).',
          'Three things pin a force down: how big (**magnitude**), which way (**direction**) and where it lands (**point of application**). Change any one and the gate does something else.'
        ]
      }
    ]
  });
})(globalThis.SE);
