/*
 * H1 · Still or Moving: what mechanics studies, its branches, statics vs
 * dynamics (statics as the a = 0 case), and how the subject developed.
 * Course section 1.1. Played in the build yard: a cart on greased rollers,
 * pushes the player sets up, and a dock to park in.
 *
 * This file is also the reference for writing a yard level (docs/YARD.md).
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals;

  // The rail spur: a 120 kg cart, a buffer stop and the dock.
  var SPUR = {
    site: { g: 9.81, floor: 'concrete' },
    camera: { fit: { lo: { x: -1, y: -1 }, hi: { x: 28, y: 4 } } },
    poke: false,
    design: { parts: [
      { id: 'cart', type: 'cart', x: 2, y: 0.25, dials: { mass: '120 kg' }, locked: true, open: ['mass'], label: 'scrap cart' },
      { id: 'dock', type: 'zone', x: 19.5, y: 0.75, dials: { width: '3 m', height: '1.5 m' }, locked: true, label: 'dock' },
      { id: 'buffer', type: 'block', x: 26.3, y: 0.6, locked: true, label: 'buffer stop' }
    ] }
  };

  function pushOn(ctx, id) { return ctx.all('push').filter(function (p) { return p.a && p.a.part === id; }); }
  function vx(r) { var v = r && r.state && r.state.vel('cart'); return v ? v.x : NaN; }
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };

  SE.content.registerLevel('ch01', {
    id: 'H1', order: 1, title: 'Still or Moving',
    subtitle: 'What mechanics is for',
    sections: ['1.1'],
    minutes: 15,
    objective: 'Park the scrap cart at rest in the dock',
    pitch: 'Everything you build here either has to **stay put** or **move the way you meant it to**. Today: one cart, a shove, and what happens when you stop pushing.',
    intro: [
      'Hask meets you at the rail spur with a mug of something that used to be coffee.',
      '"Everything you build here either has to **stay put** or **move the way you meant it to**. Mechanics is the science of exactly that: bodies at rest or in motion, and the forces acting on them. Today you find out which kind of problem you are facing, with a cart, a shove and a stopwatch."'
    ].join('\n\n'),
    goals: [
      'Name the three branches of mechanics and say which one this game is about',
      'Tell statics from dynamics, including the case of constant velocity',
      'Explain why statics is the special case of dynamics with **a = 0**'
    ],
    yard: SPUR,
    // Reference builds for the scored jobs (checked by tests/yard.test.js).
    solutions: {
      'H1.park': [
        { add: [
          { type: 'push', a: { part: 'cart' }, dials: { force: '120 N', angle: '0 deg', time: '2 s', start: '0 s' } },
          { type: 'push', a: { part: 'cart' }, dials: { force: '120 N', angle: '180 deg', time: '2 s', start: '8.75 s' } }
        ] },
        // a different plan: a long gentle start and a short hard stop
        { add: [
          { type: 'push', a: { part: 'cart' }, dials: { force: '60 N', angle: '0 deg', time: '4 s', start: '0 s' } },
          { type: 'push', a: { part: 'cart' }, dials: { force: '240 N', angle: '180 deg', time: '1 s', start: '10.25 s' } }
        ] },
        { pass: false, add: [{ type: 'push', a: { part: 'cart' }, dials: { force: '120 N', time: '2 s' } }] },
        { pass: false, add: [
          { type: 'push', a: { part: 'cart' }, dials: { force: '120 N', time: '2 s' } },
          { type: 'push', a: { part: 'cart' }, dials: { force: '120 N', angle: '180 deg', time: '2 s', start: '3 s' } }
        ] }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        brief: 'Mechanics has three branches: rigid bodies, bodies that deform, and fluids. We start with **rigid bodies**, like this cart: it won\'t bend, so only the forces on it matter.',
        text: 'Mechanics comes in three branches. **Rigid-body mechanics** treats bodies as if they never change shape. **Deformable-body mechanics** studies how they stretch, bend and squash. **Fluid mechanics** is for water, air and anything else that flows.\n\nWe start with rigid bodies, because the other two are built on them, and because most of what keeps this settlement alive (frames, beams, cranes, carts) can be handled that way. This cart is one: it won\'t bend, so all that matters is how the forces on it add up.'
      },
      {
        type: 'build', who: 'hask',
        yard: { bin: [{ type: 'push', count: 1 }] },
        objective: 'Clip a push onto the cart',
        brief: 'Take the **Push** from the bin and click the cart to clip it on. Leave its dials as they are.',
        text: 'The cart rolls on greased rollers, so friction is next to nothing. Take the **Push** from the bin and click the cart to clip it on.\n\nSelect the push to see its dials: **100 N** to the right (0°), for **2 s**, starting at **0 s**. Leave them for now.',
        goalText: 'A push clipped to the cart',
        until: function (ctx) { return pushOn(ctx, 'cart').length > 0 || (ctx.find('push') ? 'Clip it onto the **cart**, not somewhere else.' : false); }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(6) },
        objective: 'Press ▶ Run and watch the speed gauge',
        brief: 'Press **▶ Run**. The push acts for 2 s, then lets go. Watch the **speed** gauge after it lets go.',
        text: 'Press **▶ Run**. The push acts for 2 s, then lets go. Keep your eye on the **speed** gauge under the yard, especially after the push ends.',
        goalText: 'Run it for 6 s',
        until: function (ctx, type) { return type === 'result' && ctx.result && pushOn(ctx, 'cart').length > 0; },
        after: function (ctx) { return 'Speed when the push let go, and still at **t = 6 s**: **' + f3(vx(ctx.result)) + ' m/s**. Nothing pushed the cart for four seconds, and it neither sped up nor slowed down.'; }
      },
      {
        type: 'rule', title: 'Force changes velocity. No force, no change.',
        law: '\\Sigma F = 0 \\quad \\Rightarrow \\quad a = 0 \\quad \\Rightarrow \\quad v = \\t{constant}',
        eq: function (ctx) {
          var p = pushOn(ctx, 'cart')[0], F = ctx.si(p, 'force'), t = ctx.si(p, 'time'), m = ctx.si('cart', 'mass');
          return 'v = \\frac{F\\,t}{m} = \\frac{(' + f3(F) + '\\u{ N})(' + f3(t) + '\\u{ s})}{' + f3(m) + '\\u{ kg}} = ' + f3(F * t / m) + '\\u{ m/s}';
        },
        brief: 'While the push acted, the cart sped up. Once it let go, nothing sideways was left, so the speed stayed constant.',
        text: function (ctx) { return 'While the push acted there was an unbalanced force, so the cart **accelerated**. Once it let go the forces balanced again (weight down, rollers up, nothing sideways) and the acceleration was **zero**. The speed you measured, **' + f3(vx(ctx.result)) + ' m/s**, matches the prediction above.'; }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(6) },
        objective: 'Double the cart\'s mass to 240 kg, then run',
        brief: 'Click the cart, set its **mass to 240 kg**, and run the same push again.',
        text: 'Now load the cart: select it and set its **mass to 240 kg**, double what it was. Keep the same push. Run it again.',
        goalText: 'Mass doubled, and run again',
        until: function (ctx, type) {
          var m = ctx.si('cart', 'mass');
          if (!(Math.abs(m - 240) < 0.5)) return Math.abs(m - 120) < 0.5 ? false : 'Set the mass to **240 kg**.';
          return type === 'result' && !!ctx.result;
        },
        hint: 'Click the cart, then type **240 kg** into its Mass dial and press Enter.',
        after: function (ctx) { return 'Same push, twice the mass: it coasts at **' + f3(vx(ctx.result)) + ' m/s**, half the speed. But again, once the push stops, the speed **stays put**.'; }
      },
      {
        type: 'reveal', kicker: 'Definition', title: 'Statics and dynamics',
        eq: 'a = 0 \\quad \\Rightarrow \\quad \\t{statics}',
        brief: '**Statics**: at rest or at constant velocity (a = 0). **Dynamics**: accelerating. Your cart was dynamics while pushed and statics while coasting.',
        text: '**Rigid-body mechanics** splits in two:\n\n- **Statics**: bodies in **equilibrium**, at rest or moving with constant velocity.\n- **Dynamics**: bodies in **accelerated** motion.\n\nYour cart was a dynamics problem while the push acted and a statics problem after it let go, even though it was still moving. Statics is the special case of dynamics where the acceleration is zero. It gets its own treatment because so much of engineering (walls, towers, bridges, frames) is designed precisely to stay in equilibrium.',
        formula: ['ch01.branches', 'ch01.statics']
      },
      {
        type: 'job', id: 'H1.park', who: 'juno',
        yard: { design: SPUR.design, bin: [{ type: 'push', count: 2 }] },
        objective: 'Park the cart at rest in the dock, clear of the buffer',
        brief: 'Get the cart to stop **inside the green dock**. You have two pushes: one to start it, one pointing back (**180°**) to stop it.',
        text: 'Juno needs the scrap cart parked **at rest in the dock**, and the buffer stop is not a brake.\n\nYou get **two pushes**. One can start it, the other can stop it: point it backwards (**180°**) and set when it **starts**. The cart is at rest at the start of the run.',
        goalText: 'Cart at rest inside the dock, without touching the buffer',
        goal: G.all(
          G.never(function (s) { return s.impacts.some(function (i) { return (i.a === 'cart' && i.b === 'buffer') || (i.a === 'buffer' && i.b === 'cart'); }) ? 'The cart hit the buffer stop.' : null; }),
          G.never(function (s) { var p = s.pos('cart'); return p && p.x < 0 ? 'The cart rolled back off the spur.' : null; }),
          G.restIn('cart', { x0: 18, x1: 21 }, { maxSpeed: 0.02, hold: 1 })
        ),
        timeout: 30,
        onFail: function (ctx) { var p = ctx.result && ctx.result.state.pos('cart'); return p ? 'The cart ended up at **x = ' + f3(p.x) + ' m**. The dock runs from 18 m to 21 m.' : ''; },
        hints: [
          'After the first push lets go, the cart coasts at a constant speed. Work out that speed first: **v = F t / m**.',
          'A backward push with the **same force and time** takes away exactly the speed the first one gave. So the cart stops over the same distance it took to get up to speed.',
          'With 120 N for 2 s: the cart reaches 2 m/s after moving 2 m, and takes another 2 m to stop. It starts at x = 2 m and the dock centre is 19.5 m, so it needs to coast about 13.5 m, which takes 6.75 s at 2 m/s. Start the brake push at about **8.75 s**.'
        ],
        margin: function (s) { var p = s.pos('cart'); return p ? Math.round(Math.min(10, Math.abs(p.x - 19.5) * 6)) : 0; },
        success: 'Parked. Notice what you just used: you could plan the coast exactly, because with no force the velocity simply **doesn\'t change**.'
      },
      {
        type: 'deeper', title: 'Why statics came first by two thousand years',
        teaser: 'Statics was worked out in the ancient world. Dynamics had to wait until the 1600s. The reason is a clock.',
        steps: [
          { type: 'say', who: 'hask', text: 'Statics needs only geometry and force, and you can measure both with a stick, a string and a stone. **Archimedes** (287–212 B.C.) worked out the law of the lever that way. Ancient builders also wrote about pulleys, ramps and wrenches, because their engineering was mostly about building things that stand still.' },
          { type: 'say', who: 'hask', text: 'Dynamics is about how motion **changes with time**, and for most of history nobody could measure short times well. Try timing a crate falling 2 m with your pulse: from $s = \\frac{1}{2}gt^2$ it takes about 0.64 s, less than one heartbeat. **Galileo Galilei** (1564–1642) got around it with pendulums and by slowing falls down on ramps. Then **Isaac Newton** (1642–1727) wrote down three laws of motion, plus a law of gravitation, that this whole yard runs on.' }
        ]
      },
      {
        type: 'free', who: 'hask',
        yard: { design: SPUR.design, bin: [{ type: 'push', count: 4 }, { type: 'crate' }, { type: 'speedo' }], goal: null, poke: true },
        objective: 'Free play: try to make the cart cruise with no push',
        text: 'The spur is yours. While it runs you can also **drag the cart** with the mouse to give it a shove by hand.',
        prompts: [
          'Make the cart **move at constant speed** with no push acting. Is it in equilibrium?',
          'Set two pushes so the cart sits still while both act. Is it in equilibrium then?',
          'Drop a crate on the concrete and shove it. Why does it stop when the cart doesn\'t?'
        ]
      },
      {
        type: 'summary',
        points: [
          'Mechanics studies bodies at rest or in motion under forces. Its branches are **rigid-body**, **deformable-body** and **fluid** mechanics.',
          '**Statics**: equilibrium, meaning at rest **or** at constant velocity (a = 0). **Dynamics**: accelerated motion.',
          'Statics is the special case of dynamics with zero acceleration, and it matters because most structures are designed to stay put.',
          'Statics is ancient (Archimedes and the lever). Dynamics needed good timekeeping (Galileo, then Newton).'
        ]
      }
    ]
  });
})(globalThis.SE);
