/*
 * H1 · Still or Moving: what mechanics studies, its branches, statics vs
 * dynamics (statics as the a = 0 case), and how the subject developed.
 * Course section 1.1.
 */
(function (SE) {
  'use strict';

  // Rail carts default to frictionless bearings so constant velocity really is constant.
  function cart(id, m, x, v, label, kind) { return { id: id, m: m, x: x, v: v || 0, mu: 0, label: label, kind: kind || 'cart' }; }
  var RAIL = function (bodies, extra) { return { type: 'track', params: Object.assign({ surface: 'rail', length: 30, trail: true, showVectors: true, bodies: bodies }, extra || {}) }; };

  // Play one rail-yard situation for the classify previews and predictions.
  function play(ctx, setup, runOpts) {
    var s = ctx.setScene(setup.type, setup.params);
    return s.run(Object.assign({ duration: 5 }, runOpts || {}));
  }

  SE.content.registerLevel('ch01', {
    id: 'H1', order: 1, title: 'Still or Moving',
    subtitle: 'What mechanics is for',
    sections: ['1.1'],
    minutes: 15,
    intro: [
      'Hask meets you at the rail spur with a mug of something that used to be coffee.',
      '"Everything you build here either has to **stay put** or **move the way you meant it to**. Mechanics is the science of exactly that: bodies at rest or in motion, and the forces acting on them. Before you touch a wrench, let\'s sort out which kind of problem you\'re facing."'
    ].join('\n\n'),
    goals: [
      'Name the three branches of mechanics and say which one this game is about',
      'Tell statics from dynamics, including the case of constant velocity',
      'Explain why statics is the special case of dynamics with **a = 0**'
    ],
    scene: RAIL([cart('scrap', 120, 6, 0, 'scrap 120 kg')]),
    proveIt: [
      {
        id: 'H1.prove', text: 'A crate rides a frictionless cart at a steady 2 m/s, nobody pushing. Its acceleration, as a number with units?',
        inputs: [{ key: 'a', label: 'Acceleration of the crate', placeholder: 'e.g. 1.5 m/s^2', spec: { value: 0, unit: 'm/s^2', sf: null }, answer: '0 m/s^2' }]
      }
    ],
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'Mechanics comes in three branches. **Rigid-body mechanics** treats bodies as if they never change shape. **Deformable-body mechanics** studies how they stretch, bend and squash. **Fluid mechanics** is for water, air and anything else that flows.\n\nWe start with rigid bodies, because the other two are built on them, and because most of what keeps this settlement alive (frames, beams, cranes, carts) can be handled that way.'
      },
      {
        type: 'classify', id: 'H1.branches',
        text: 'Which branch of mechanics would you reach for first in each job?',
        bins: ['Rigid-body', 'Deformable-body', 'Fluid'],
        items: [
          { t: 'Whether the steel gantry tips over when the crate swings out', bin: 'Rigid-body', why: 'The frame barely changes shape. What matters is how the forces balance.' },
          { t: 'How far the bungee cord on the zip-line stretches under a survivor', bin: 'Deformable-body', why: 'The stretch itself is the question.' },
          { t: 'How fast the rain tank drains through the outlet pipe', bin: 'Fluid', why: 'Water flows, so fluid mechanics.' },
          { t: 'Whether the loaded rail cart rolls away on the slope', bin: 'Rigid-body', why: 'The cart moves as one solid body.' },
          { t: 'Whether the rubber gate seal squashes enough to keep the dead out', bin: 'Deformable-body', why: 'The seal works by deforming.' }
        ]
      },
      {
        type: 'predict', who: 'hask',
        scene: RAIL([cart('coast', 120, 3, 1.5, 'coasting 120 kg')], { surface: 'rail' }),
        q: 'This cart of scrap is rolling along the spur at a steady **1.5 m/s**. Nobody is pushing it, and the bearings are so good that friction is negligible.\n\nIs the cart **in equilibrium**, meaning are the forces on it balanced?',
        choices: [
          { t: 'No, it\'s moving, so it can\'t be in equilibrium.', why: 'Moving isn\'t the test. Watch the velocity arrow and the trail marks: equal spacing every half second, and the velocity never changes.' },
          { t: 'Yes. Its velocity isn\'t changing, so the forces are balanced.', correct: true, why: 'Right. Nothing speeds it up or slows it down, so the forces on it balance and its acceleration is zero.' },
          { t: 'Only once it stops.', why: 'A stopped cart is in equilibrium too, but so is this one. Look at the acceleration readout: zero the whole way.' }
        ],
        run: function (ctx) {
          return ctx.scene.run({ duration: 5, settle: false }).then(function (r) {
            return 'Measured: acceleration **' + (Math.abs(r.detail.v - 1.5) < 1e-6 ? '0.000' : '≠ 0') + ' m/s²**, speed still **' + r.detail.v.toFixed(2) + ' m/s** after ' + r.detail.time.toFixed(1) + ' s. The trail marks are evenly spaced.';
          });
        },
        reveal: 'A body is in **equilibrium** when it is at rest **or** moving with **constant velocity**. Either way, its acceleration is zero.'
      },
      {
        type: 'try', who: 'hask',
        scene: RAIL([cart('scrap', 120, 4, 0, 'scrap 120 kg')], { surface: 'rail' }),
        text: 'Now give it a shove. Set an applied force and watch the acceleration arrow (cyan). Then bring the force back to **zero** while it\'s still rolling and watch what the velocity does.',
        controls: ['force'],
        goalText: 'Get the cart moving, then drop the force to zero while it rolls',
        goal: function (ctx) {
          var s = ctx.scene, b = s && s.body && s.body('scrap');
          if (!b) return false;
          ctx.runner._h1seenPush = ctx.runner._h1seenPush || Math.abs(b.a) > 0.05;
          return ctx.runner._h1seenPush && Math.abs(b.v) > 0.2 && Math.abs(s.forceSet.scrap || 0) < 1e-9;
        },
        after: 'With the force gone, the acceleration fell to zero, but the cart **kept rolling** at whatever speed it had. Acceleration comes from unbalanced force. Velocity doesn\'t need one.'
      },
      {
        type: 'reveal', kicker: 'Definition', title: 'Statics and dynamics',
        eq: 'a = 0 \\quad \\Rightarrow \\quad \\t{statics}',
        text: '**Rigid-body mechanics** splits in two:\n\n- **Statics**: bodies in **equilibrium**, at rest or moving with constant velocity.\n- **Dynamics**: bodies in **accelerated** motion.\n\nSo statics is just the special case of dynamics where the acceleration is zero. It still gets its own treatment, because so much of engineering (walls, towers, bridges, frames) is designed precisely to stay in equilibrium.',
        formula: ['ch01.branches', 'ch01.statics']
      },
      {
        type: 'classify', id: 'H1.statics-dynamics',
        text: 'Statics or dynamics? Use **▶ watch** to run any of them on the rail before you decide.',
        bins: ['Statics', 'Dynamics'],
        items: [
          { t: 'A crate sitting on the loading dock', bin: 'Statics', why: 'At rest, so a = 0.', preview: function (ctx) { return play(ctx, RAIL([cart('c', 80, 6, 0, 'crate', 'crate')], { surface: 'concrete' })); } },
          { t: 'A cart coasting at a steady 2 m/s on frictionless rails', bin: 'Statics', why: 'Constant velocity, so a = 0: it is in equilibrium.', preview: function (ctx) { return play(ctx, RAIL([cart('c', 80, 2, 2, 'coasting')]), { settle: false }); } },
          { t: 'The winch hauling a sled from rest across the ice', bin: 'Dynamics', why: 'Its speed is growing, so a ≠ 0.', preview: function (ctx) { return play(ctx, RAIL([cart('c', 60, 2, 0, 'sled', 'sled')], { surface: 'ice' }), { forces: { c: 90 }, settle: false }); } },
          { t: 'A cart braking to a stop on gritty concrete', bin: 'Dynamics', why: 'Its speed is falling, so a ≠ 0. Slowing down is acceleration too.', preview: function (ctx) { return play(ctx, RAIL([{ id: 'c', m: 80, x: 2, v: 4, mu: 0.4, muS: 0.5, label: 'braking', kind: 'cart' }], { surface: 'concrete' })); } },
          { t: 'The gantry crane frame holding a hovering load', bin: 'Statics', why: 'Nothing accelerates, so the frame is in equilibrium.' }
        ]
      },
      {
        type: 'deeper', title: 'Why statics came first by two thousand years',
        teaser: 'Statics was worked out in the ancient world. Dynamics had to wait until the 1600s. The reason is a clock.',
        steps: [
          { type: 'say', who: 'hask', text: 'Statics needs only geometry and force, and you can measure both with a stick, a string and a stone. **Archimedes** (287–212 B.C.) worked out the law of the lever that way. Ancient builders also wrote about pulleys, ramps and wrenches, because their engineering was mostly about building things that stand still.' },
          { type: 'say', who: 'hask', text: 'Dynamics is about how motion **changes with time**, and for most of history nobody could measure short times well. **Galileo Galilei** (1564–1642) got around it with pendulums and by slowing falling bodies down on ramps. Then **Isaac Newton** (1642–1727) wrote down the three laws of motion and the law of gravitation that this whole game runs on.' },
          { type: 'predict', who: 'hask', q: 'You want to time a crate falling 2 m. All you have is your own pulse (about 1 beat per second). How precise is that?', choices: [
            { t: 'Good enough. The fall takes several beats.' },
            { t: 'Useless. The fall is over in well under one beat.', correct: true, why: 'From $s = \\frac{1}{2}gt^2$ the fall takes about 0.64 s, less than one heartbeat. That is Galileo\'s problem, and why he slowed falls down on inclined ramps.' }
          ] }
        ]
      },
      {
        type: 'sandbox', scene: RAIL([cart('a', 60, 4, 0, 'cart A')], { surface: 'rail' }),
        text: 'Free rail. Push, coast, add friction and change the mass. Try to make a cart that is **moving but in equilibrium**, and one that is **at rest but not in equilibrium** (hint: think about the instant a push starts).',
        controls: ['mass', 'force', 'mu', 'v0'],
        prompts: ['Set a starting speed with zero force and zero friction. Is it in equilibrium?', 'Add friction with no force. Is it in equilibrium while it slows?', 'Find a force that keeps a cart moving at constant speed *with* friction.']
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
