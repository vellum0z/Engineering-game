/*
 * H2 · Push and Pull: the four basic quantities of mechanics (length, time,
 * mass, force), forces by contact and at a distance, and the three things
 * that completely describe a force: magnitude, direction and point of
 * application. Course section 1.2.
 *
 * Most of the level runs on the yard gate (gate scene, mode 'gate'). The
 * gate turns about its hinge when the player's push and the horde's push
 * don't balance; the scene does that with torques, but moments are not
 * taught until Chapter 4, so the level only ever states the gate's rule in
 * words: "your push times its distance from the hinge, counted square to
 * the gate, against the horde's push times its distance".
 */
(function (SE) {
  'use strict';

  var DEG = Math.PI / 180;

  // The yard gate: 3 m of welded steel, 120 kg, hinged on the left post.
  // The horde has already shoved it 20 degrees ajar.
  var GATE = { mode: 'gate', L: 3, mass: 120, angle0: 20, friction: 40, openAngle: 80, slamSpeed: 2.5, zombies: 5 };
  function gate(extra) { return { type: 'gate', params: Object.assign({}, GATE, extra || {}) }; }

  // Teaching setup for the first predictions: the horde leans 400 N at 2.00 m,
  // which turns the gate with 400 x 2.00 = 800 N.m. Hask's crew always
  // pushes 300 N.
  var DEMO = { H: 400, dh: 2, F: 300, d: 2.9, theta: 90 };

  function outcomeText(o) {
    return {
      opened: '**the gate burst open**',
      closed: '**the gate swung shut**',
      slammed: '**the gate slammed shut hard enough to crack the latch**',
      held: '**the gate held where it was**'
    }[o] || o;
  }

  // Run several pushes one after another on a fresh gate and report each.
  function runSeries(ctx, base, cases) {
    var lines = [];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        var s = ctx.setScene('gate', Object.assign({}, GATE, base, c.set));
        ctx.hud(['Crew push: ' + c.label]);
        return s.run({ duration: 4 }).then(function (r) { lines.push('- ' + c.label + ': ' + outcomeText(r.outcome) + '.'); });
      });
    }, Promise.resolve()).then(function () { ctx.hud([]); return 'Measured, same 300 N push each time:\n\n' + lines.join('\n'); });
  }

  function cart(id, m, x, label) { return { id: id, m: m, x: x, v: 0, mu: 0, muS: 0, label: label, kind: 'cart' }; }
  var CARTS = {
    type: 'track',
    params: { surface: 'rail', length: 30, trail: true, showVectors: true, bodies: [cart('heavy', 160, 4, 'loaded 160 kg'), cart('light', 40, 10, 'empty 40 kg')] }
  };

  // ------------------------------------------------------------ the spec card
  /*
   * H2.spec numbers. The horde leans 0.42 kN on the gate 2.10 m out from the
   * hinge: 420 x 2.10 = 882 N.m. The jack can only be bolted to the latch
   * bracket, 0.40 m in from the free end of the 3.00 m gate, so
   *   d = 3.00 - 0.40 = 2.60 m from the hinge,
   * and it must push square to the gate face, theta = 90 deg, so all of it
   * counts. To match the horde:
   *   F x 2.60 = 882  ->  F = 882 / 2.60 = 339.23 N  ->  339 N (0.339 kN).
   * Check: 339 x 2.60 = 881.4 N.m, short of 882 by 0.6 N.m, far inside the
   * hinge's 40 N.m of stiffness, so the gate holds still.
   */
  var SPEC = { H: 420, dh: 2.1, Lgate: 3, inset: 0.4 };
  var SPEC_D = SPEC.Lgate - SPEC.inset;            // 2.60 m
  var SPEC_F = SPEC.H * SPEC.dh / SPEC_D;          // 339.23 N
  var SPEC_THETA = 90 * DEG;                       // square to the gate

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
    scene: gate(DEMO),
    proveIt: [
      {
        id: 'H2.prove-spec',
        text: 'A gate holds when your push, square to it, times its distance from the hinge matches the horde\'s push times *its* distance. The horde gives **770 N·m** that way. Your jack is bolted **2.40 m** from the hinge and pushes square on. How hard must it push?',
        inputs: [{
          key: 'F', label: 'Jack push', placeholder: 'e.g. 0.25 kN',
          // 770 / 2.40 = 320.83 N -> 321 N
          spec: { value: 770 / 2.4, unit: 'N', sf: 3, form: 'si' }, answer: '321 N',
          wrong: [{ input: '32.7 kg', kind: 'concept' }]
        }]
      },
      {
        id: 'H2.prove-dir',
        text: 'Same jack, same 500 N, but now it pushes straight **along** the gate toward the hinge pin. How much of that push turns the gate?',
        inputs: [{ key: 'F', label: 'Turning part of the push', placeholder: 'e.g. 120 N', spec: { value: 0, unit: 'N', sf: null }, answer: '0 N' }]
      }
    ],
    steps: [
      // ---------------------------------------------- point of application
      {
        type: 'predict', who: 'hask',
        scene: gate(DEMO),
        hud: ['Horde: 400 N, 2.00 m from the hinge', 'Crew: 300 N, square to the gate'],
        q: 'The horde leans **400 N** on the gate. Rook can push **300 N**, square to the gate, and not a newton more. The gate is 3 m long, hinge on the left.\n\nWhere should he push so the gate shuts?',
        choices: [
          { t: 'Right beside the hinge, where the gate is strongest.', why: 'Strong, yes, but a push next to the hinge barely turns anything. It mostly squeezes the hinge pin.' },
          { t: 'In the middle. It splits the difference.', why: 'Better, but the horde still wins. They\'re leaning at 2 m out; Rook in the middle is only 1.5 m out.' },
          { t: 'Out at the far edge, by the latch.', correct: true, why: 'Right. The farther from the hinge you push, the more a push turns the gate. Same 300 N, completely different result.' },
          { t: 'Doesn\'t matter. 300 N is 300 N.', why: 'That\'s the trap. Watch the runs: the same 300 N does three different things.' }
        ],
        run: function (ctx) {
          return runSeries(ctx, DEMO, [
            { label: 'at 0.30 m (by the hinge)', set: { d: 0.3 } },
            { label: 'at 1.50 m (middle)', set: { d: 1.5 } },
            { label: 'at 2.90 m (far edge)', set: { d: 2.9 } }
          ]);
        },
        reveal: 'Same size of push, same direction, different spot, different outcome. Where a force acts, its **point of application**, is part of what the force *is*.'
      },
      // ---------------------------------------------------------- direction
      {
        type: 'predict', who: 'hask',
        scene: gate(DEMO),
        hud: ['Horde: 400 N, 2.00 m from the hinge', 'Crew: 300 N at the far edge, 2.90 m'],
        q: 'Rook is at the far edge now, still pushing **300 N**. The yard is muddy and he wants to brace at an easier angle. Which way of pushing still shuts the gate?',
        choices: [
          { t: 'Square on, straight against the gate face.', correct: true, why: 'Yes. Every newton of a square-on push goes into turning the gate.' },
          { t: 'Along the gate, shoving toward the hinge post.', why: 'That push goes straight down the gate into the hinge pin. It turns nothing at all.' },
          { t: 'Slanted at 30° to the gate face.', why: 'Only part of a slanted push turns the gate. At 30° it\'s half, and half isn\'t enough here.' },
          { t: 'All of them, as long as it\'s 300 N.', why: 'Direction changes what a push does. Watch: same 300 N, same spot, three outcomes.' }
        ],
        run: function (ctx) {
          return runSeries(ctx, DEMO, [
            { label: 'square on (θ = 90°)', set: { theta: 90 } },
            { label: 'along the gate toward the hinge (θ = 180°)', set: { theta: 180 } },
            { label: 'slanted (θ = 30°)', set: { theta: 30 } }
          ]);
        },
        reveal: 'Size and spot weren\'t enough: the **direction** of a push decides how much of it does the job. A force needs a direction as well as a size.'
      },
      // ---------------------------------------------------------- magnitude
      {
        type: 'try', who: 'hask',
        scene: gate(DEMO),
        hud: ['Horde: 400 N, 2.00 m from the hinge', 'Crew: square on at 2.90 m'],
        text: 'Spot and direction are fixed now: far edge, square on. Set the **size** of Rook\'s push and press **Push ▸**. Shut the gate *without* slamming it: hit the jamb too fast and the latch cracks.',
        controls: ['F'],
        actions: [{
          label: 'Push ▸',
          run: function (ctx) {
            var s = ctx.scene, p = s.p;
            p.d = 2.9; p.theta = 90;
            return s.run({ duration: 6 }).then(function (r) {
              var tip = r.detail.tipSpeed != null ? ' Tip speed at the jamb: **' + Math.abs(r.detail.tipSpeed).toFixed(2) + ' m/s** (latch rated 2.5 m/s).' : '';
              return 'Push of **' + p.F + ' N**: ' + outcomeText(r.outcome) + '.' + (r.outcome === 'opened' || r.outcome === 'held' ? '' : tip);
            });
          }
        }],
        goalText: 'Shut the gate gently, without slamming it',
        goal: function (ctx) { var r = ctx.scene && ctx.scene.result; return !!r && r.outcome === 'closed'; },
        after: 'Too little and the gate stays ajar or the horde wins; too much and it slams. The window sits roughly between 290 N and 410 N here. The **magnitude** is the third part of the description.'
      },
      {
        type: 'reveal', kicker: 'Principle', title: 'What makes a force', hud: [],
        eq: '\\t{force} = \\t{magnitude} + \\t{direction} + \\t{point of application}',
        text: 'A **force** is a push or a pull that one body exerts on another. You\'ve just seen that changing any one of these three changes what the force does, and that knowing all three tells you everything about it:\n\n- **Magnitude**: how big (newtons).\n- **Direction**: which way it acts.\n- **Point of application**: where on the body it acts.\n\nLeave any one off a work order and the crew is guessing.',
        formula: 'ch01.force'
      },
      // ---------------------------------------- contact vs at a distance
      {
        type: 'say', who: 'hask',
        text: 'Rook\'s hands touch the gate. That\'s a force by **contact**. But some forces need no touching at all. The Earth pulls on every crate in this yard from thousands of kilometres away, and magnets and electric charges reach across gaps too. Those act **at a distance**.'
      },
      {
        type: 'classify', id: 'H2.contact',
        text: 'Contact, or at a distance?',
        bins: ['Contact', 'At a distance'],
        items: [
          { t: 'The tow rope dragging a sled across the yard', bin: 'Contact', why: 'The rope is tied to the sled and pulls on it directly.' },
          { t: 'The scrapyard electromagnet lifting a steel plate before it touches it', bin: 'At a distance', why: 'Magnetic force crosses the air gap.' },
          { t: 'The weight of a crate sitting on the dock', bin: 'At a distance', why: 'Weight is the Earth\'s gravity pulling on the crate. Nothing touches it to make that pull.', hint: 'Weight: what is doing the pulling, and is it touching the crate?' },
          { t: 'Wind flapping the tarp on the watchtower', bin: 'Contact', why: 'Moving air is matter pressing on the tarp\'s surface. Contact, even though you can\'t see it.', hint: 'Wind is air. Is air touching the tarp?' },
          { t: 'A lodestone swinging the needle of Juno\'s compass', bin: 'At a distance', why: 'Magnetism again: the stone never touches the needle.' },
          { t: 'Your hand bearing down on the winch lever', bin: 'Contact', why: 'Hand on steel.' }
        ]
      },
      // ------------------------------------------------------------- mass
      {
        type: 'predict', who: 'hask',
        scene: CARTS,
        q: 'Two carts on the spur, frictionless bearings: one **empty** at 40 kg, one **loaded** at 160 kg. Each gets exactly the same **80 N** push for 3 seconds, then coasts.\n\nWhich one is moving faster at the end?',
        choices: [
          { t: 'Same speed. Same push, same time.', why: 'The push was the same, but the carts weren\'t. Look at the speeds.' },
          { t: 'The empty cart.', correct: true, why: 'Right. The loaded cart has four times the mass and picks up a quarter of the speed. More matter fights a change in velocity harder.' },
          { t: 'The loaded cart. It has more momentum behind it.', why: 'It ends up with the same momentum as the empty cart, but at a much lower speed. Look at the measured speeds.' }
        ],
        run: function (ctx) {
          var s = ctx.scene;
          // 80 N for 3 s: empty a = 80/40 = 2 m/s^2 -> 6 m/s; loaded a = 80/160
          // = 0.5 m/s^2 -> 1.5 m/s. Timed pushes switch off at 3 s, so the
          // speeds read afterwards are the coasting speeds.
          var push = [{ id: 'light', F: 80, duration: 3 }, { id: 'heavy', F: 80, duration: 3 }];
          return s.run({ pushes: push, duration: 3, settle: false }).then(function () {
            var vl = s.body('light').v, vh = s.body('heavy').v;
            return 'Measured once the push stopped: empty cart **' + vl.toFixed(2) + ' m/s**, loaded cart **' + vh.toFixed(2) + ' m/s**.';
          });
        },
        reveal: '**Mass** is a measure of how much matter a body has. It shows up two ways: it **resists changes in velocity** (what you just saw), and it is what **gravity pulls on**, so two masses attract each other. Both come back in a few levels, in Newton\'s laws and in weight.'
      },
      // ------------------------------------------------------------- time
      {
        type: 'predict', who: 'hask',
        q: 'Maddy stacked the salvage shelf in ten minutes this morning. Pell would have taken all afternoon to stack the identical shelf with the identical crates in the identical places.\n\nOnce it\'s finished and standing, does the time it took change whether the shelf holds?',
        choices: [
          { t: 'Yes. Rushed work is weaker.', why: 'Rushed work can mean *mistakes*, but that\'s a different shelf. With every crate in the same place, the forces are the same.' },
          { t: 'No. Once it stands still, only the forces on it right now matter.', correct: true, why: 'Exactly. Nothing in the shelf\'s balance depends on the clock.' },
          { t: 'Only if it was stacked very fast.', why: 'Speed matters while things are moving. Once everything sits still, the history drops out.' }
        ],
        reveal: '**Time** is the order in which events happen. Statics problems don\'t depend on it, because nothing is changing. Time matters as soon as things move and speed up, which is **dynamics**.'
      },
      {
        type: 'reveal', kicker: 'Definitions', title: 'The four basic quantities',
        text: 'Everything in mechanics is built from four quantities.',
        table: {
          head: ['Quantity', 'What it describes', 'Where you met it here'],
          rows: [
            ['Length', 'where a point is, and how big a body is', 'how far from the hinge Rook pushed'],
            ['Time', 'the succession of events', 'the shelf: statics doesn\'t need it, dynamics does'],
            ['Mass', 'quantity of matter: resists changes in velocity, and is attracted by gravity', 'the empty and loaded carts'],
            ['Force', 'a push or pull of one body on another, by contact or at a distance', 'Rook versus the horde']
          ]
        }
      },
      {
        type: 'classify', id: 'H2.quantities',
        text: 'Which basic quantity is each of these about?',
        bins: ['Length', 'Time', 'Mass', 'Force'],
        items: [
          { t: 'The 2.60 m from the hinge to the latch bracket', bin: 'Length', why: 'A distance locating a point.' },
          { t: 'The order the bolts went into the gate frame', bin: 'Time', why: 'A succession of events.' },
          { t: 'How hard it is to get the loaded cart rolling', bin: 'Mass', why: 'Resistance to a change in velocity.' },
          { t: 'The horde\'s 420 N lean on the gate', bin: 'Force', why: 'A push, by contact.' },
          { t: 'The Earth\'s pull on a crate', bin: 'Force', why: 'Weight is a force (gravity, at a distance). The crate\'s *mass* is what the pull acts on.', hint: 'A pull is a force, even when it\'s gravity doing it.' },
          { t: 'The width of the gap the dead are squeezing through', bin: 'Length', why: 'Size of something.' }
        ]
      },
      // ---------------------------------------------------- scored job
      {
        type: 'task', id: 'H2.spec', who: 'juno',
        scene: gate({ H: SPEC.H, dh: SPEC.dh, angle0: 20, F: 0, d: SPEC_D, theta: 90 }),
        hud: ['Horde: 0.42 kN at 2.10 m from the hinge', 'Jack bracket: 0.40 m in from the free end of the 3.00 m gate'],
        title: 'Spec card for the gate jack',
        text: [
          'Juno, on the radio: "Night shift is bolting the hydraulic jack to the yard gate. They\'ll set it **exactly** to what you write on the card, nothing more, so fill in all of it."',
          '- The horde leans **0.42 kN** square on the gate, **2.10 m** out from the hinge.',
          '- The jack only fits the latch bracket, **0.40 m in from the free end** of the 3.00 m gate.',
          '- Gate rule: with a push square to the gate, the gate holds when **your push × its distance from the hinge** equals the **horde\'s push × its distance**. Pushing at a slant only counts part of the push.',
          'Spec the jack\'s push so it just holds the gate: its **magnitude**, its **direction** as the angle from the gate face, and its **point of application** as the distance from the hinge.'
        ].join('\n\n'),
        inputs: [
          {
            key: 'F', label: 'Magnitude', placeholder: 'e.g. 0.250 kN',
            // 420 x 2.10 / 2.60 = 339.23 N -> 339 N (see SPEC above)
            spec: { value: SPEC_F, unit: 'N', sf: 3, form: 'si', mistakes: [
              { ratio: SPEC.H / SPEC_F, kind: 'concept', msg: 'That\'s the horde\'s own push. The jack sits farther from the hinge than the horde does, so it needs less.' },
              { ratio: (SPEC.H * SPEC.dh / SPEC.inset) / SPEC_F, kind: 'concept', msg: 'You used 0.40 m, the distance from the free end. The rule needs the distance from the hinge.' }
            ] },
            answer: '339 N',
            wrong: [{ input: '339', kind: 'unit' }, { input: '34.6 kg', kind: 'concept' }, { input: '0.420 kN', kind: 'concept' }, { input: '2.21 kN', kind: 'concept' }]
          },
          {
            key: 'theta', label: 'Direction (angle from the gate face)', placeholder: 'e.g. 45°',
            spec: { value: SPEC_THETA, unit: 'deg', sf: null, tol: 0.01, mistakes: [
              { test: function (r) { return Math.abs(r) < 1e-6 || Math.abs(Math.abs(r) - 2) < 1e-6; }, kind: 'concept', msg: 'At 0° or 180° the jack pushes along the gate, straight into the hinge pin. None of that push turns the gate.' }
            ] },
            answer: '90°',
            wrong: [{ input: '90', kind: 'unit' }, { input: '0°', kind: 'concept' }, { input: '180°', kind: 'concept' }]
          },
          {
            key: 'd', label: 'Point of application (distance from the hinge)', placeholder: 'e.g. 1.75 m',
            // 3.00 - 0.40 = 2.60 m
            spec: { value: SPEC_D, unit: 'm', sf: null, mistakes: [
              { ratio: SPEC.inset / SPEC_D, kind: 'concept', msg: 'That\'s measured from the free end. The point of application here is measured from the hinge.' }
            ] },
            answer: '2.60 m',
            wrong: [{ input: '0.40 m', kind: 'concept' }]
          }
        ],
        hints: [
          'Three blanks, three parts of a force. Two of them come almost straight from the brief. Which two?',
          'Point: the bracket is 0.40 m in from the *free* end of a 3.00 m gate, so measure from the hinge. Direction: square on means 90° to the face. Magnitude: use the gate rule, horde push × horde distance = jack push × jack distance, with the push in newtons.',
          '$d = 3.00 - 0.40 = 2.60\\u{ m}$, $\\theta = 90°$, and $F \\times 2.60 = 420 \\times 2.10 = 882$, so $F = 882 / 2.60 = 339\\u{ N}$ (0.339 kN).'
        ],
        consequence: function (ctx, a) {
          // The crew sets the jack to exactly what was written. A blank or
          // unreadable entry means they have nothing to go on for that part.
          var notes = [];
          var F = a.F.si, th = a.theta.si, d = a.d.si;
          if (F == null || a.F.result.parts.units === false) { notes.push('No usable magnitude on the card, so the jack wasn\'t pressurised at all.'); F = 0; }
          if (th == null || a.theta.result.parts.units === false) { notes.push('No usable direction, so the crew mounted the jack along the gate, pointing at the hinge.'); th = Math.PI; }
          if (d == null || a.d.result.parts.units === false) { notes.push('No usable point of application, so the crew bolted the jack where it was easiest, right by the hinge.'); d = 0.1; }
          F = Math.max(0, Math.min(2000, F));
          if (d > SPEC.Lgate) { notes.push('That point is off the end of the gate, so the crew bolted it at the free end.'); d = SPEC.Lgate; }
          d = Math.max(0, d);
          var thDeg = th / DEG;
          var s = ctx.setScene('gate', Object.assign({}, GATE, { H: SPEC.H, dh: SPEC.dh, angle0: 20, F: F, d: d, theta: thDeg }));
          var turning = F * Math.sin(th) * d;
          return s.run({ duration: 5 }).then(function (r) {
            var head = 'Jack set to **' + Math.round(F) + ' N** at **' + Math.round(thDeg) + '°**, **' + d.toFixed(2) + ' m** from the hinge: it counts for **' + Math.round(turning) + ' N·m** against the horde\'s **' + Math.round(SPEC.H * SPEC.dh) + ' N·m**. ';
            var msg = {
              opened: 'The horde won. The gate swung wide and the dead poured into the yard.',
              held: 'The gate stopped dead and stayed put. The horde can lean all night.',
              closed: 'The gate swung shut. It holds, but you\'ve specced more jack than the job needs.',
              slammed: 'The gate slammed into the jamb and cracked the latch. Way too much push.'
            }[r.outcome];
            return (notes.length ? notes.join(' ') + '\n\n' : '') + head + msg;
          });
        },
        explain: 'All three parts were needed. Get the size wrong and the horde wins or the latch cracks. Put the jack in the wrong place, or point it the wrong way, and the same push does far less. That\'s why a force is only fully described by **magnitude, direction and point of application**.'
      },
      {
        type: 'sandbox', hud: [],
        scene: gate({ H: 400, dh: 2, F: 300, d: 2.9, theta: 90 }),
        text: 'The gate is yours. Drag on the gate to place a push (where you press is the point, the drag sets size and direction), or use the sliders, then press **Push ▸**.',
        controls: ['F', 'd', 'theta', 'H', 'dh'],
        prompts: [
          'Push along the gate toward the hinge at 2000 N. What happens?',
          'Halve the distance from the hinge. How much bigger must the push be to keep up?',
          'Find the slant angle where 300 N at the far edge stops winning against 400 N at 2 m.'
        ],
        actions: [{
          label: 'Push ▸',
          run: function (ctx) {
            var p = ctx.scene.p;
            return ctx.scene.run({ duration: 6 }).then(function (r) {
              return p.F + ' N at ' + p.theta + '°, ' + p.d.toFixed(2) + ' m from the hinge: ' + outcomeText(r.outcome) + '.';
            });
          }
        }]
      },
      // ------------------------------------------------------------ deeper
      {
        type: 'deeper', title: 'When the point of application stops mattering',
        teaser: 'Two cases where you can relax the "where" part of a force: particles, and sliding a force along its own line.',
        steps: [
          {
            type: 'say', who: 'hask',
            text: 'If a body is small compared with everything around it, you can treat it as a **particle**: all its mass at one point. Then every force on it acts at that same point, and "point of application" has nothing left to tell you. Only magnitude and direction remain. That\'s why the next levels can treat a crate on a long cable as a dot.'
          },
          {
            type: 'predict', who: 'hask',
            q: 'A rope pulls the gate tip in a fixed direction. Rook swaps it for a rope twice as long, tied to the same point and pulled along the **same line** with the same force. Does the gate behave differently?',
            choices: [
              { t: 'Yes, a longer rope gives more leverage.', why: 'Leverage depends on how far the *line* of the pull passes from the hinge. The line hasn\'t moved.' },
              { t: 'No. Same force along the same line, same effect on the gate.', correct: true, why: 'Right. For a rigid body, a force can slide anywhere along its line of action without changing the body\'s motion. This is the **principle of transmissibility**.' }
            ],
            reveal: 'Transmissibility only covers the *outside* effect: how the whole rigid body moves or balances. Inside the body it does matter: pulling the end of a bar puts it in tension; pushing the other end along the same line squashes it instead. Real bodies are not perfectly rigid, and that difference is the subject of strength of materials.'
          }
        ]
      },
      {
        type: 'summary',
        points: [
          'The four basic quantities: **length** (position and size), **time** (succession of events; statics doesn\'t depend on it), **mass** (quantity of matter; resists changes in velocity and is attracted by gravity), and **force**.',
          'A force is a push or pull of one body on another, by **contact** or **at a distance** (gravitational, electrical, magnetic).',
          'A force is completely described by its **magnitude**, **direction** and **point of application**. Change any one and the effect changes.'
        ]
      }
    ]
  });
})(globalThis.SE);
