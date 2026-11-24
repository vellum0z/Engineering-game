/*
 * H4 · Newton's Yard: Newton's three laws of motion, measured from a
 * non-accelerating frame. First law, second law F = ma (Eq. 1–1) and its
 * momentum form, third law (equal, opposite, collinear, on different bodies).
 * Course section 1.2.
 */
(function (SE) {
  'use strict';

  var P = SE.physics.track;

  // Frictionless ice yard unless a body says otherwise.
  function yard(bodies, extra) {
    return { type: 'track', params: Object.assign({ surface: 'ice', length: 30, trail: true, showVectors: true, bodies: bodies }, extra || {}) };
  }
  function sled(id, m, x, label, more) { return Object.assign({ id: id, m: m, x: x, v: 0, mu: 0, label: label, kind: 'sled' }, more || {}); }
  function cart(id, m, x, label, more) { return Object.assign({ id: id, m: m, x: x, v: 0, mu: 0, label: label, kind: 'cart' }, more || {}); }
  function f3(x) { return SE.sigfig.roundSig(x, 3).text; }

  // The scene keeps integrating for a moment after a run finishes (while the
  // result is handed back), so read velocities from the log at the finish
  // time rather than from the live body.
  function velAt(scene, id, t) {
    var log = scene.getLog(id), v = 0;
    for (var i = 0; i < log.length && log[i].t <= t + 1e-9; i++) v = log[i].v;
    return v;
  }
  // Average acceleration of a body from rest over a run of length t.
  function measuredAccel(scene, id, t) { return t > 0 ? velAt(scene, id, t) / t : 0; }

  // ---- 2nd-law experiments: winch on a sled from rest, frictionless ice
  var RUNS = [
    { key: 'r1', m: 50, F: 100, label: 'Run 1: 50 kg sled, 100 N' },
    { key: 'r2', m: 50, F: 200, label: 'Run 2: 50 kg sled, 200 N' },
    { key: 'r3', m: 100, F: 200, label: 'Run 3: 100 kg sled, 200 N' }
  ];
  // Closed-form values for the data table: 100/50 = 2.00, 200/50 = 4.00, 200/100 = 2.00 m/s^2
  RUNS.forEach(function (r) { r.a = P.accel(r.F, r.m, 0); });

  function runExperiment(ctx, r) {
    var s = ctx.setScene('track', yard([sled('s', r.m, 3, r.m + ' kg sled')]).params);
    ctx.hud(['Winch: **' + r.F + ' N** on a **' + r.m + ' kg** sled, frictionless ice']);
    return s.run({ forces: { s: r.F }, duration: 3, settle: false }).then(function (res) {
      var a = measuredAccel(s, 's', res.detail.time);
      ctx.runner._h4runs = ctx.runner._h4runs || {};
      ctx.runner._h4runs[r.key] = a;
      return '**' + r.label + '**: speed went from 0 to ' + res.detail.v.toFixed(2) + ' m/s in ' + res.detail.time.toFixed(2) + ' s, so **a = ' + a.toFixed(2) + ' m/s²**.';
    });
  }

  // ---- H4.winch: get the supply sled through the shed door ahead of the pack
  // The sled starts with its tail 6.10 m ahead of the pack and has to roll
  // 25.1 m before its nose meets the shed buffer. The pack speed and the
  // buffer rating are set so that only accelerations within about ±0.4 % of
  // 1.60 m/s^2 work:
  //   pack catches the sled if  v_z^2 > 2 a g0   (closest approach g0 - v_z^2/(2a))
  //   buffer fails if           sqrt(2 a d) > rating
  var W = { m: 125, x0: 4, w: 1.8, zombieStart: -3, length: 30, goalX: 14, aNeed: 1.60 };
  W.gap0 = W.x0 - W.w / 2 - W.zombieStart;           // 4 - 0.9 + 3 = 6.10 m
  W.run = W.length - W.w / 2 - W.x0;                 // 30 - 0.9 - 4 = 25.1 m
  W.vz = Math.sqrt(2 * 1.594 * W.gap0);              // 4.41 m/s: pack just catches below a = 1.594
  W.rating = Math.sqrt(2 * 1.606 * W.run);           // 8.98 m/s: buffer gives above a = 1.606
  // F = m a = 125 kg × 1.60 m/s² = 200 N
  W.F = W.m * W.aNeed;

  function winchScene() {
    return yard([sled('sled', W.m, W.x0, 'supplies 125 kg', { w: W.w })], {
      length: W.length, goalX: W.goalX, bumperRating: W.rating, zombieStart: W.zombieStart, zombies: 7
    });
  }

  // ---- H4.reaction: two carts spring apart
  var R = { mA: 60.0, mB: 240, aA: 3.20, t: 0.5 };
  R.F = R.mA * R.aA;          // 60.0 × 3.20 = 192 N, the same on both carts
  R.aB = R.F / R.mB;          // 192 / 240 = 0.800 m/s²

  function pairScene(mA, mB, labA, labB) {
    return yard([cart('A', mA, 9, labA), cart('B', mB, 10.75, labB, { w: 1.8 })], { surface: 'rail', length: 30, zombieStart: -6 });
  }

  // ---- proveIt givens
  var PV = { m: 80.0, F: 52.0, mA: 30.0, aA: 2.40 };
  PV.a = PV.F / PV.m;          // 52.0 / 80.0 = 0.650 m/s²
  PV.FB = PV.mA * PV.aA;       // 30.0 × 2.40 = 72.0 N

  // ---- leaking sand sled
  var LEAK = { m0: 120, leak: 4, mDry: 60, F: 60, t: 8 };
  // constant-mass guess: v = F t / m0 = 60 × 8 / 120 = 4.00 m/s
  // leaking: v = (F / leak) ln(m0 / (m0 − leak t)) = 15 ln(120/88) = 4.65 m/s
  LEAK.vNaive = LEAK.F * LEAK.t / LEAK.m0;
  LEAK.vTrue = P.leakSpeed(LEAK.F, LEAK.m0, LEAK.leak, LEAK.t);
  function leakScene(v0) {
    return yard([sled('sand', LEAK.m0, 3, 'sand sled', { v: v0 || 0, leak: LEAK.leak, mDry: LEAK.mDry })], { length: 40 });
  }

  // Stage overlays set by ctx.hud() persist until replaced, so every step
  // that loads a fresh scene starts with an empty overlay unless it sets one.
  function freshHud(steps) {
    steps.forEach(function (s) {
      if (s.scene && s.hud === undefined) s.hud = [];
      if (s.steps) freshHud(s.steps);
    });
    return steps;
  }

  SE.content.registerLevel('ch01', {
    id: 'H4', order: 4, title: 'Newton\'s Yard',
    subtitle: 'The three laws of motion',
    sections: ['1.2'],
    minutes: 25,
    intro: [
      'The east yard froze solid overnight. Hask has dragged three sleds, two ore carts and a winch out onto the ice, and is chalking a grid on the frozen slab.',
      '"Everything in this game runs on three rules Newton wrote down in 1687. They came from experiment, not from anyone\'s say-so, so that\'s how you\'ll learn them: by watching sleds. Ice is handy. It takes friction out of the picture, so the only forces left are the ones we put there."'
    ].join('\n\n'),
    goals: [
      'State Newton\'s **first**, **second** and **third** laws and the frame they hold in',
      'Use **F = ma** to find a force from an acceleration, and an acceleration from a force',
      'Explain why action and reaction are equal yet give different accelerations',
      'Connect F = ma to the rate of change of momentum'
    ],
    scene: yard([sled('s', 50, 4, '50 kg sled')]),
    proveIt: [
      {
        id: 'H4.prove-2nd', text: 'An 80.0 kg cart on frictionless rails has an unbalanced force of 52.0 N on it. Its acceleration?',
        inputs: [{
          key: 'a', label: 'Acceleration', placeholder: 'e.g. 1.25 m/s^2',
          spec: { value: PV.a, unit: 'm/s^2', sf: 3, form: 'si-units' },
          answer: '0.650 m/s^2',                 // 52.0 / 80.0 = 0.650
          wrong: [{ input: '0.65 m/s^2', kind: 'sigfig' }, { input: '1.54 m/s^2', kind: 'algebra' }]
        }]
      },
      {
        id: 'H4.prove-3rd', text: 'Crate A (30.0 kg) and crate B shove apart on ice. A accelerates at 2.40 m/s². How hard did A push on B?',
        inputs: [{
          key: 'F', label: 'Force of A on B', placeholder: 'e.g. 50.0 N',
          spec: { value: PV.FB, unit: 'N', sf: 3, form: 'si' },
          answer: '72.0 N',                      // 30.0 × 2.40 = 72.0
          wrong: [{ input: '72 N', kind: 'sigfig' }, { input: '12.5 N', kind: 'algebra' }]
        }]
      }
    ],
    unlocks: { tools: [], formulas: ['ch01.newton1', 'ch01.newton2', 'ch01.newton3'], materials: [] },
    steps: freshHud([
      {
        type: 'say', who: 'hask',
        text: 'One rule before any of the laws. Newton\'s laws describe a **particle** as seen from a **non-accelerating reference frame**: the ground under your boots, the chalk grid, anything that isn\'t itself speeding up, slowing down or turning.\n\nIf you measure from inside a braking truck, the laws stop working as written. We\'ll come back to that. For now, the frozen yard is our frame.'
      },

      // ------------------------------------------------------- first law
      {
        type: 'predict', who: 'hask',
        scene: yard([sled('s', 50, 3, '50 kg sled')]),
        q: 'I\'m going to kick this 50 kg sled once, hard enough to get it to **2 m/s**, and then nobody touches it. The ice is effectively frictionless.\n\nAfter the kick, the sled…',
        choices: [
          { t: '…keeps sliding at 2 m/s, in a straight line.', correct: true, why: 'Right. Nothing unbalanced acts on it after the kick, so nothing changes its velocity. The trail marks stay evenly spaced.' },
          { t: '…slowly loses speed, because the kick wears off.', why: 'A kick isn\'t a supply that runs down. Look at the trail marks: evenly spaced the whole way. Things slow down on ordinary ground because friction pushes on them, and there is none here.' },
          { t: '…stops as soon as the boot leaves it.', why: 'That\'s what pushing a crate on concrete feels like, because friction is doing the stopping. On the ice it just keeps going.' }
        ],
        run: function (ctx) {
          // 400 N for 0.25 s on 50 kg: Δv = F t / m = 400 × 0.25 / 50 = 2.00 m/s
          var s = ctx.scene;
          return s.run({ pushes: [{ id: 's', F: 400, duration: 0.25 }], duration: 6, settle: false }).then(function (r) {
            var log = s.getLog('s'), mid = log.filter(function (p) { return p.t >= 1 && p.t <= 1.05; })[0];
            return 'Measured: **' + (mid ? mid.v.toFixed(2) : '?') + ' m/s** one second after the kick and **' + r.detail.v.toFixed(2) + ' m/s** after ' + r.detail.time.toFixed(1) + ' s. Acceleration after the kick: **0.000 m/s²**.';
          });
        },
        reveal: 'No unbalanced force, no change in velocity. A body at rest stays at rest, and a moving body keeps moving in a straight line at constant speed.'
      },
      {
        type: 'reveal', kicker: 'Newton\'s first law', title: 'Rest and steady motion are the same state',
        eq: '\\Sigma F = 0 \\quad \\implies \\quad v = \\t{constant}',
        text: 'A particle originally at rest, or moving in a straight line with constant velocity, tends to **stay that way** as long as it is not subjected to an **unbalanced force**.\n\nForces can still act. What matters is whether they cancel. A sled with two equal ropes pulling opposite ways is in exactly the same state as a sled with no ropes at all: equilibrium, the a = 0 case you met in Still or Moving.',
        formula: 'ch01.newton1'
      },

      // ------------------------------------------------------ second law
      {
        type: 'try', who: 'hask',
        scene: yard([sled('s', 50, 3, '50 kg sled')]),
        onEnter: function (ctx) { ctx.runner._h4runs = {}; },
        text: 'Now the winch. It holds a steady pull, so the sled has one unbalanced force on it. Run all three experiments and note the acceleration each time. Watch the spacing of the trail marks too: it grows when the sled speeds up.',
        actions: RUNS.map(function (r) { return { label: '▶ ' + r.label, run: function (ctx) { return runExperiment(ctx, r); } }; }),
        goalText: 'Run all three experiments',
        goal: function (ctx) {
          var d = ctx.runner._h4runs || {};
          return RUNS.every(function (r) { return d[r.key] != null; });
        },
        after: 'Lay the three results side by side and look for the pattern before the next card does it for you.'
      },
      {
        type: 'reveal', kicker: 'Your data', title: 'Three winch runs',
        table: {
          head: ['Run', 'Mass m', 'Winch force F', 'Measured a'],
          rows: RUNS.map(function (r, i) { return [String(i + 1), r.m + ' kg', r.F + ' N', r.a.toFixed(2) + ' m/s²']; })
        },
        text: 'Runs 1 and 2 keep the mass and change the force. Runs 2 and 3 keep the force and change the mass.'
      },
      {
        type: 'derive', who: 'hask', title: 'From three sled runs to F = ma',
        intro: 'Read the table one comparison at a time.',
        lines: [
          {
            eq: 'a \\propto F \\quad (m \\t{ fixed})',
            why: 'Same 50 kg sled: 100 N gave 2.00 m/s², 200 N gave 4.00 m/s².',
            ask: { q: 'Runs 1 → 2: the force doubled on the same sled. What did the acceleration do?', choices: [
              { t: 'It doubled', correct: true, why: 'Twice the force, twice the acceleration. The acceleration is **proportional** to the force, and it points the same way the winch pulls.' },
              { t: 'It stayed the same', why: 'Check the table again: 2.00 then 4.00 m/s².' },
              { t: 'It went up by 100', why: 'The force went up by 100 N, but the acceleration went from 2.00 to 4.00 m/s². Compare ratios, not differences.' }
            ] }
          },
          {
            eq: 'a \\propto \\frac{1}{m} \\quad (F \\t{ fixed})',
            why: 'Same 200 N pull: the 50 kg sled made 4.00 m/s², the 100 kg sled 2.00 m/s².',
            ask: { q: 'Runs 2 → 3: same 200 N, twice the mass. What happened to the acceleration?', choices: [
              { t: 'It halved', correct: true, why: 'Twice the mass, half the acceleration. Mass measures how hard a body is to speed up.' },
              { t: 'It doubled', why: 'A heavier sled is harder to get moving, not easier. 4.00 dropped to 2.00 m/s².' },
              { t: 'Nothing, because the force was the same', why: 'The force was the same, but the result wasn\'t: 4.00 then 2.00 m/s².' }
            ] }
          },
          {
            eq: 'a \\propto \\frac{F}{m} \\quad \\implies \\quad F = k\\,m\\,a',
            why: 'Both proportionalities at once. The constant *k* depends only on which units we pick.'
          },
          {
            eq: '1\\u{ N} = 1\\u{ kg} \\times 1\\u{ m/s^2} \\quad \\implies \\quad k = 1',
            why: 'Define the unit of force so that the constant disappears.',
            ask: { q: 'We get to choose the size of our force unit. Which choice makes the law cleanest?', choices: [
              { t: 'Call one unit of force whatever gives 1 kg an acceleration of 1 m/s²', correct: true, why: 'That is exactly the **newton**. With it, k = 1, and the newton turns out to be a derived unit: 1 N = 1 kg·m/s².' },
              { t: 'Use the weight of 1 kg as the unit of force', why: 'People have done that (the kilogram-force), but then k = 1/9.81 and it follows you through every calculation.' },
              { t: 'Keep k and measure it for each sled', why: 'k is the same for every sled. It only depends on the units, so set it once and forget it.' }
            ] }
          },
          { eq: 'F = ma', tag: '1–1', why: 'Newton\'s second law, with F the unbalanced force on the particle.' }
        ],
        outro: 'The acceleration has the **same direction** as the unbalanced force, and a size **proportional** to it. Mass is the constant of proportionality.'
      },
      {
        type: 'reveal', kicker: 'Newton\'s second law', title: 'Unbalanced force makes acceleration',
        eq: 'F = ma', tag: '1–1',
        text: 'A particle acted on by an unbalanced force **F** gets an acceleration **a** in the **same direction** as the force, with a magnitude directly **proportional** to it. For a particle of mass *m*, F = ma.\n\nThe first law is the special case F = 0, so a = 0.',
        formula: 'ch01.newton2'
      },
      {
        type: 'task', id: 'H4.winch', who: 'juno',
        title: 'Supply run',
        scene: winchScene(),
        text: 'Juno, over the radio: "The pack is coming up the spur. That sled is 125 kg of fuel and medicine and it has to get through the shed door before they reach it."\n\nHask has already worked the timing: on the frictionless ice the sled needs an acceleration of exactly **1.60 m/s²**. Any less and the lead runner gets a hand on it. Any more and it hits the shed buffer faster than the buffer is rated for. The winch holds whatever pull you set.\n\nWhat winch force should you set? (3 s.f.)',
        inputs: [{
          key: 'F', label: 'Winch force', placeholder: 'e.g. 150 N',
          // F = m a = 125 × 1.60 = 200 N; 199 N and 201 N both fail in the sim, so the tolerance is tighter than 0.5 %
          spec: { value: W.F, unit: 'N', sf: 3, form: 'si', tol: 0.003, mistakes: [
            { ratio: 1 / (W.aNeed * W.aNeed), kind: 'algebra', msg: 'That looks like m ÷ a. Newton\'s second law multiplies: F = m a.' },
            { ratio: 9.81 / W.aNeed, kind: 'concept', msg: 'That\'s the sled\'s weight, m g. On level ice the winch only has to supply m a.' }
          ] },
          answer: '0.200 kN',
          wrong: [{ input: '78.1 N', kind: 'algebra' }, { input: '1.23 kN', kind: 'concept' }, { input: '199 N', kind: 'rounding' }, { input: '200', kind: 'unit' }]
        }],
        hints: [
          'The ice is frictionless, so the winch is the only horizontal force. That makes it the unbalanced force.',
          'Newton\'s second law: unbalanced force = mass × acceleration.',
          'F = m a = 125 kg × 1.60 m/s² = 200 kg·m/s² = 200 N. Written plainly, "200" hides how many figures are significant, so give it as **0.200 kN**.'
        ],
        consequence: function (ctx, a) {
          var F = a.F.si == null ? 0 : a.F.si;
          var s = ctx.setScene('track', winchScene().params);
          var acc = F / W.m;
          ctx.hud(['Winch **' + f3(F) + ' N** on **125 kg**: a = ' + f3(acc) + ' m/s²', 'Buffer rated **' + W.rating.toFixed(2) + ' m/s**']);
          return s.run({ forces: { sled: F }, zombieSpeed: W.vz, duration: 14 }).then(function (r) {
            var d = r.detail;
            if (r.outcome === 'caught') return 'At a = ' + f3(acc) + ' m/s² the sled was too slow off the mark. The pack caught its tail at x = ' + d.x.toFixed(1) + ' m, ' + d.time.toFixed(1) + ' s in.';
            if (r.outcome === 'bumperBroken') return 'The sled made it in ahead of the pack, then hit the shed buffer at **' + d.impactSpeed.toFixed(2) + ' m/s**, over its ' + W.rating.toFixed(2) + ' m/s rating. The buffer tore loose and the sled went through the back wall.';
            if (d.reached) {
              var closest = acc > 0 ? W.gap0 - W.vz * W.vz / (2 * acc) : 0;
              return 'Through the door at ' + d.arrivalTime.toFixed(2) + ' s. The lead runner came within **' + Math.max(0, closest * 100).toFixed(0) + ' cm** of the tail. The sled met the buffer at **' + d.impactSpeed.toFixed(2) + ' m/s** (rated ' + W.rating.toFixed(2) + ' m/s) and settled. Door shut.';
            }
            return 'The sled never reached the door (outcome: ' + r.outcome + ').';
          });
        },
        explain: 'Only one horizontal force acts, so it is the unbalanced force, and F = ma gives it directly. Notice how small the margin was: a 0.5 % error in either direction would have cost you the sled.'
      },
      {
        type: 'sandbox',
        scene: yard([sled('s', 125, 3, 'test sled')]),
        text: 'The yard is yours. Change the mass and the winch force, add a little friction, and give the sled a starting speed. Keep an eye on the cyan acceleration arrow: it always points along the **unbalanced** force.',
        controls: ['mass', 'force', 'mu', 'v0'],
        prompts: ['Pull backwards on a sled that is sliding forwards. Which way does the acceleration point?', 'Add friction and find the winch force that keeps a moving sled at constant speed. What is the unbalanced force then?', 'Halve the mass at a fixed force. Does the acceleration exactly double?']
      },

      // ------------------------------------------------------- third law
      {
        type: 'predict', who: 'hask',
        scene: pairScene(40, 200, 'survivor 40 kg', 'ore cart 200 kg'),
        q: 'A survivor on a light 40 kg cart braces a pole against a 200 kg ore cart and shoves. There\'s a force gauge on each cart.\n\nWhile they push apart, which cart feels the **bigger force**?',
        choices: [
          { t: 'The 40 kg cart. It\'s the one that goes flying.', why: 'It does go flying, but that\'s because it has less mass, not because it felt more force. Look at the gauges.' },
          { t: 'The 200 kg ore cart. It has more to resist with.', why: 'More mass means a smaller acceleration from the same force. The gauges read the same.' },
          { t: 'Neither. The two forces are equal.', correct: true, why: 'The gauges match exactly. Each cart pushes on the other just as hard as the other pushes back.' }
        ],
        run: function (ctx) {
          // 200 N for 0.4 s: Δv_A = 200 × 0.4 / 40 = 2.00 m/s, Δv_B = 200 × 0.4 / 200 = 0.400 m/s
          var s = ctx.scene;
          var peak = { A: 0, B: 0 };
          var timer = setInterval(function () { peak.A = Math.max(peak.A, s.body('A').gauge); peak.B = Math.max(peak.B, s.body('B').gauge); }, 30);
          return s.run({ springs: [{ a: 'A', b: 'B', F: 200, duration: 0.4 }], duration: 3, settle: false }).then(function (r) {
            clearInterval(timer);
            var vA = velAt(s, 'A', r.detail.time), vB = velAt(s, 'B', r.detail.time);
            return 'Gauges: **' + f3(peak.A || 200) + ' N** on the survivor cart, **' + f3(peak.B || 200) + ' N** on the ore cart. Speeds afterwards: **' + Math.abs(vA).toFixed(2) + ' m/s** (left) and **' + Math.abs(vB).toFixed(2) + ' m/s** (right). Accelerations during the shove: ' + (Math.abs(vA) / 0.4).toFixed(2) + ' and ' + (Math.abs(vB) / 0.4).toFixed(2) + ' m/s².';
          });
        },
        reveal: 'Same force, different masses, so different accelerations. The second law explains the difference; the third law says the forces themselves are a matched pair.'
      },
      {
        type: 'reveal', kicker: 'Newton\'s third law', title: 'Forces come in pairs',
        eq: 'F_{A \\t{ on } B} = -F_{B \\t{ on } A}',
        text: 'The mutual forces of action and reaction between two particles are **equal** in magnitude, **opposite** in direction and **collinear** (they act along the same line).\n\nThey act on **different bodies**. That is why they never cancel each other out: one is on the survivor\'s cart and the other is on the ore cart. To find what a single body does, count only the forces acting **on that body**.',
        formula: 'ch01.newton3'
      },
      {
        type: 'task', id: 'H4.reaction', who: 'hask',
        title: 'Read the other cart',
        scene: pairScene(R.mA, R.mB, 'A 60.0 kg', 'B 240 kg'),
        text: 'Cart A (60.0 kg) and cart B (240 kg) spring apart on the rails. A tape on cart A shows it accelerated at **3.20 m/s²** during the shove. Friction is negligible.\n\nWhat was cart B\'s acceleration? (3 s.f.)',
        inputs: [{
          key: 'aB', label: 'Acceleration of B', placeholder: 'e.g. 1.25 m/s^2',
          // F = 60.0 × 3.20 = 192 N on each cart; a_B = 192 / 240 = 0.800 m/s²
          spec: { value: R.aB, unit: 'm/s^2', sf: 3, form: 'si-units', mistakes: [
            { ratio: R.aA / R.aB, kind: 'concept', msg: 'Equal forces, not equal accelerations. B has four times the mass.' },
            { ratio: (R.aA * R.mB / R.mA) / R.aB, kind: 'algebra', msg: 'The mass ratio went the wrong way. The heavier cart gets the smaller acceleration.' }
          ] },
          answer: '0.800 m/s^2',
          wrong: [{ input: '3.20 m/s^2', kind: 'concept' }, { input: '12.8 m/s^2', kind: 'algebra' }, { input: '0.8 m/s^2', kind: 'sigfig' }, { input: '192 N', kind: 'unit' }]
        }],
        hints: [
          'Start from what you know about cart A. Its mass and acceleration tell you the force on it.',
          'By the third law, B feels a force of the same size. Then use the second law on B alone.',
          'F = 60.0 × 3.20 = 192 N on each cart, so a_B = 192 N ÷ 240 kg = **0.800 m/s²**.'
        ],
        consequence: function (ctx, a) {
          var aB = a.aB.si == null ? 0 : a.aB.si;
          var s = ctx.setScene('track', pairScene(R.mA, R.mB, 'A 60.0 kg', 'B 240 kg').params);
          ctx.hud(['Shove: **' + f3(R.F) + ' N** on each cart for ' + R.t + ' s', 'Your prediction for B: ' + f3(Math.abs(aB) * R.t) + ' m/s afterwards']);
          return s.run({ springs: [{ a: 'A', b: 'B', F: R.F, duration: R.t }], duration: 3, settle: false }).then(function (r) {
            var vA = Math.abs(velAt(s, 'A', r.detail.time)), vB = Math.abs(velAt(s, 'B', r.detail.time));
            var meas = vB / R.t;
            var msg = 'Gauges read **' + f3(R.F) + ' N** on both carts. A left at ' + vA.toFixed(2) + ' m/s (a = ' + (vA / R.t).toFixed(2) + ' m/s²), B at **' + vB.toFixed(3) + ' m/s** (a = **' + meas.toFixed(3) + ' m/s²**).';
            if (Math.abs(Math.abs(aB) - meas) > 0.01 * meas) msg += ' You predicted ' + f3(Math.abs(aB)) + ' m/s², which would have B rolling at ' + f3(Math.abs(aB) * R.t) + ' m/s.';
            return msg;
          });
        },
        explain: 'Third law first (same 192 N on both), then the second law on each cart separately. Four times the mass, a quarter of the acceleration.'
      },
      {
        type: 'sandbox',
        scene: pairScene(40, 200, 'cart A', 'cart B'),
        text: 'Two carts and a spring. The sliders change **cart A**. Fire the spring at different strengths and compare the two gauges, then the two speeds.',
        controls: ['mass'],
        actions: [100, 200, 400].map(function (F) {
          return { label: '▶ Spring apart, ' + F + ' N', run: function (ctx) {
            var s = ctx.scene;
            return s.run({ springs: [{ a: 'A', b: 'B', F: F, duration: 0.4 }], duration: 1, settle: false }).then(function (r) {
              var A = s.body('A'), B = s.body('B'), vA = Math.abs(velAt(s, 'A', 0.4)), vB = Math.abs(velAt(s, 'B', 0.4));
              return F + ' N on each cart for 0.4 s. A (' + f3(A.m) + ' kg): ' + vA.toFixed(2) + ' m/s. B (' + f3(B.m) + ' kg): ' + vB.toFixed(2) + ' m/s. Momenta: ' + f3(A.m * vA) + ' and ' + f3(B.m * vB) + ' kg·m/s, in opposite directions.';
            });
          } };
        }),
        prompts: ['Make cart A as heavy as cart B. What happens to the two speeds?', 'Compare the two momenta after each shove. Why do they always match?']
      },

      // ------------------------------------------------- momentum form
      {
        type: 'derive', who: 'hask', title: 'The second law as momentum',
        intro: 'Newton actually stated the second law in terms of **linear momentum**, mass times velocity. For a body whose mass doesn\'t change, it\'s the same law.',
        lines: [
          { eq: 'p = mv', why: 'Linear momentum: how much motion a body carries.' },
          {
            eq: 'F = \\frac{dp}{dt} = \\frac{d(mv)}{dt}',
            why: 'The unbalanced force equals the rate at which momentum changes.',
            ask: { q: 'If the sled\'s mass is fixed, what is d(mv)/dt?', choices: [
              { t: 'm dv/dt', correct: true, why: 'A constant comes straight out of the derivative.' },
              { t: 'v dm/dt', why: 'That term is zero when m doesn\'t change.' },
              { t: 'mv / t', why: 'That\'s an average over a whole interval, and only if it started from rest. The law is about the rate at each instant.' }
            ] }
          },
          {
            eq: 'F = m\\frac{dv}{dt} = ma',
            why: 'dv/dt is the acceleration, so we are back at Eq. 1–1.',
            tag: '1–1'
          }
        ],
        outro: 'So the second law also reads: the unbalanced force on a particle is proportional to the **time rate of change of its linear momentum**. For a constant mass that is exactly F = ma.'
      },
      {
        type: 'deeper', title: 'The leaking sand sled',
        teaser: 'A sled loses sand through a hole in its floor. Does F = d(mv)/dt mean it speeds up just by leaking?',
        steps: [
          {
            type: 'predict', who: 'hask',
            scene: leakScene(2),
            q: 'This sled carries 60 kg of sand that leaks out of a hole in the floor at 4 kg/s. It\'s sliding at 2 m/s on ice and **nothing pulls it**.\n\nThe momentum mv is falling as the sand drains. What does the sled\'s speed do?',
            choices: [
              { t: 'It speeds up, because mv must stay constant with no force.', why: 'The momentum of the **sled** isn\'t conserved on its own: the sand carries momentum away with it. Watch the readout.' },
              { t: 'It stays at 2 m/s.', correct: true, why: 'Right. Each grain leaves straight down relative to the sled, so it leaves at the sled\'s own speed and takes its own share of momentum along. Nothing pushes the sled forward or back.' },
              { t: 'It slows down, because it\'s losing momentum.', why: 'It loses momentum only because it loses mass. Its velocity has no reason to change.' }
            ],
            run: function (ctx) {
              var s = ctx.scene;
              return s.run({ duration: 6, settle: false }).then(function (r) {
                return 'After ' + r.detail.time.toFixed(1) + ' s: mass **' + f3(P.massAt(LEAK.m0, LEAK.leak, LEAK.mDry, r.detail.time)) + ' kg** (from 120 kg), speed **' + r.detail.v.toFixed(2) + ' m/s**. A trail of sand piles behind it.';
              });
            },
            reveal: 'Applying F = d(mv)/dt to the sled alone would be wrong here: the lost sand is part of the system, and it leaves with the sled\'s velocity. The careful form for a body that sheds mass is F = m dv/dt + (v − u) dm/dt, with u the velocity of the escaping mass. Here u = v, so the second term vanishes.'
          },
          {
            type: 'predict', who: 'hask',
            scene: leakScene(0),
            q: 'Same sled, from rest, now with the winch holding a steady **60 N** for 8 s. Without the leak it would reach 60 × 8 ÷ 120 = **4.00 m/s**. With the leak?',
            choices: [
              { t: 'Faster than 4.00 m/s', correct: true, why: 'The same force on a shrinking mass gives a growing acceleration: a = F / m(t), with m(t) the current mass.' },
              { t: 'Exactly 4.00 m/s', why: 'That would only be true if the mass stayed 120 kg the whole time.' },
              { t: 'Slower than 4.00 m/s', why: 'Losing mass makes the sled easier to accelerate, not harder.' }
            ],
            run: function (ctx) {
              var s = ctx.scene;
              return s.run({ forces: { sand: LEAK.F }, duration: LEAK.t, settle: false }).then(function (r) {
                return 'Measured **' + r.detail.v.toFixed(2) + ' m/s** after ' + r.detail.time.toFixed(1) + ' s. Integrating a = F / m(t) gives v = (F / leak) ln(m₀ / m) = ' + LEAK.vTrue.toFixed(2) + ' m/s, against ' + LEAK.vNaive.toFixed(2) + ' m/s for a sled that kept all its sand.';
              });
            }
          }
        ]
      },

      // ------------------------------------------------ reference frames
      {
        type: 'deeper', title: 'When the laws seem to fail: riding in the braking truck',
        teaser: 'From a braking truck, a loose drum slides forward with nothing pushing it. Is the first law broken?',
        steps: [
          {
            type: 'predict', who: 'hask',
            scene: yard([cart('truck', 900, 5, 'truck (braking)', { v: 5, mu: 0.5, muS: 0.6 }), { id: 'drum', m: 30, x: 7.4, v: 5, mu: 0, label: 'drum', kind: 'crate' }], { surface: 'concrete', target: 'truck' }),
            q: 'The truck is doing 5 m/s with a fuel drum loose on its icy bed (drawn here on the ground line, just ahead of the cab). The driver brakes. From the driver\'s seat the drum **slides forward** and away.\n\nWhat pushed the drum forward?',
            choices: [
              { t: 'Nothing. The drum kept its 5 m/s; the truck slowed down under it.', correct: true, why: 'Seen from the ground (a non-accelerating frame) the drum does exactly what the first law says: it keeps its velocity. The truck is what changed.' },
              { t: 'An inertia force pushing it forward', why: 'Nobody and nothing applies that force. It only "appears" because the driver is measuring from a frame that is itself decelerating.' },
              { t: 'Friction from the truck bed', why: 'The bed is icy, and friction from a slowing truck would drag the drum back, not forward.' }
            ],
            run: function (ctx) {
              var s = ctx.scene;
              return s.run({ duration: 2.5, settle: false }).then(function (r) {
                var vT = velAt(s, 'truck', 0.6), vD = velAt(s, 'drum', r.detail.time);
                return 'Ground frame, 0.6 s after braking: truck **' + vT.toFixed(2) + ' m/s** (braking at ' + (0.5 * 9.81).toFixed(2) + ' m/s²), drum still **' + vD.toFixed(2) + ' m/s**, a = 0. From the cab the drum appears to accelerate forward at ' + (0.5 * 9.81).toFixed(2) + ' m/s² with no force on it.';
              });
            },
            reveal: 'That is why the laws are stated for a **non-accelerating reference frame**. In an accelerating frame you either switch back to the ground frame or add fictitious "inertial" forces to make the books balance. Dynamics courses cover how.'
          }
        ]
      },

      // ------------------------------------------------------ recall
      {
        type: 'classify', id: 'H4.which-law',
        text: 'Newton\'s three laws are worth knowing by heart. Which law is each yard observation about?',
        bins: ['First law', 'Second law', 'Third law'],
        items: [
          { t: 'A drum coasts across the frozen yard at a steady 1.2 m/s with nothing touching it', bin: 'First law', why: 'No unbalanced force, constant velocity.' },
          { t: 'Doubling the winch pull doubles the sled\'s acceleration', bin: 'Second law', why: 'a is proportional to F.' },
          { t: 'The rope pulls the winch toward the sled exactly as hard as it pulls the sled toward the winch', bin: 'Third law', why: 'Equal, opposite, collinear, on different bodies.' },
          { t: 'A parked cart stays put until someone pushes harder than friction can hold', bin: 'First law', why: 'Balanced forces, so it remains at rest.' },
          { t: 'A 250 kg sled needs five times the pull of a 50 kg one to reach the same acceleration', bin: 'Second law', why: 'F = ma with a fixed.' },
          { t: 'A survivor shoves an ore cart and rolls backwards off their own cart', bin: 'Third law', why: 'The cart pushes back on her with an equal and opposite force.' }
        ]
      },
      {
        type: 'summary',
        points: [
          'Newton\'s laws hold for a particle measured from a **non-accelerating reference frame**. Learn all three by heart.',
          '**First law**: with no unbalanced force, a particle at rest stays at rest, and a moving particle keeps a constant velocity.',
          '**Second law**: **F = ma** (Eq. 1–1). The acceleration points along the unbalanced force and is proportional to it. Defining the newton as 1 kg·m/s² makes the constant equal to 1.',
          'Stated with momentum: the unbalanced force is the time rate of change of linear momentum. For a constant mass this is F = ma.',
          '**Third law**: action and reaction are **equal, opposite and collinear**, and they act on **different bodies**, so they never cancel on one body.'
        ]
      }
    ])
  });
})(globalThis.SE);
