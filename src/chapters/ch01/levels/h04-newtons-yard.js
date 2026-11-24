/*
 * H4 · Newton's Yard: Newton's three laws of motion, measured from a
 * non-accelerating frame. First law, second law F = ma (Eq. 1–1) and its
 * momentum form, third law (equal, opposite, collinear, on different bodies).
 * Course section 1.2. Played in the build yard: winch carts along a greased
 * rail, then two carts kicked apart by a spring pack, with gauges on both.
 *
 * Parts: cart, hook and push (core), winch (rigging), and two level parts
 * defined at the bottom of this file: h04-pack (the pack coming up the rail)
 * and h04-kicker (a spring pack that shoves two carts apart and falls away).
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial;
  var f3 = function (x) { return D.fmtNum(x, 3); };

  /* ------------------------------------------------------- level parts */

  // A minimal winch for running this level before the rigging parts land.
  // It follows the parts contract (dials pull, speed, rating, brake, stop;
  // readouts tension, lineOut, speed) and is skipped once the real one exists.
  if (!Y.partDef('winch')) {
    Y.definePart({
      type: 'winch', name: 'Winch', category: 'Rigging',
      blurb: 'A motor drum that reels its line in at the set speed, pulling no harder than its maximum pull.',
      size: { w: 0.8, h: 0.6 },
      connector: true,
      dials: [
        { key: 'pull', label: 'Max pull', q: 'force', def: '5 kN', min: 0 },
        { key: 'speed', label: 'Line speed', q: 'speed', def: '0.3 m/s' },
        { key: 'rating', label: 'Line breaks at', q: 'force', def: '20 kN', min: 1 },
        { key: 'brake', label: 'Brake', choice: ['on', 'off'], def: 'on' },
        { key: 'stop', label: 'Stop at line out', q: 'length', def: '', optional: true }
      ],
      build: function (b) {
        var A = b.end('a'), B = b.end('b');
        var j = b.joint(new b.P.WinchJoint({ bodyA: A.body, localAnchorA: A.local, bodyB: B.body, localAnchorB: B.local,
          reelSpeed: b.si('speed'), maxPull: b.si('pull'), brake: b.text('brake') === 'on',
          minLength: b.si('stop') || 0, breakForce: b.si('rating'), label: b.inst.label || 'winch' }));
        return { joint: j };
      },
      plate: function (inst) { return ['Max pull ' + inst.dials.pull, 'Line breaks at ' + inst.dials.rating]; },
      readouts: function (built) {
        var j = built.joint;
        return [
          { key: 'tension', label: 'line tension', q: 'force', read: function () { return j.broken ? 0 : Math.max(0, j.lineTension()); } },
          { key: 'lineOut', label: 'line out', q: 'length', read: function () { return j.lineOut(); } },
          { key: 'speed', label: 'line speed', q: 'speed', read: function () { return j.speed; } }
        ];
      }
    });
  }

  // The pack: a crowd shambling up the rail at a steady speed. A sensor, so
  // it touches nothing; the job's goal checks whether it reaches the cart.
  Y.definePart({
    type: 'h04-pack', name: 'The pack', category: 'Site', library: false,
    blurb: 'Something walking up the spur at a steady pace. It does not get tired.',
    size: { w: 1.2, h: 1.7 },
    dials: [{ key: 'speed', label: 'Walking speed', q: 'speed', def: '4 m/s', min: 0 }],
    build: function (b) {
      var body = b.body({ type: 'kinematic', position: b.at({ x: 0, y: 0 }), velocity: { x: b.si('speed'), y: 0 }, label: b.inst.label || 'pack',
        shapes: [{ shape: b.P.box(0.6, 0.85), sensor: true }] });
      return { body: body, half: 0.6 };
    },
    readouts: function (built) { return [{ key: 'front', label: 'front at', q: 'length', read: function () { return built.body.c.x + built.half; } }]; },
    draw: function (ctx, cam, built) {
      var c = built.body.c;
      ctx.save();
      [-0.4, 0, 0.4].forEach(function (dx, i) {
        var bob = Math.sin((c.x + dx) * 3 + i) * 0.04;
        var head = cam.worldToScreen({ x: c.x + dx, y: c.y + 0.65 + bob }), feet = cam.worldToScreen({ x: c.x + dx - 0.1, y: c.y - 0.85 });
        var r = Math.max(3, 0.14 * cam.zoom);
        ctx.strokeStyle = 'rgba(150,190,120,.95)'; ctx.fillStyle = 'rgba(110,150,90,.95)'; ctx.lineWidth = Math.max(2, 0.08 * cam.zoom);
        ctx.beginPath(); ctx.moveTo(head.x, head.y + r); ctx.lineTo(feet.x, feet.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(head.x, head.y + r * 2); ctx.lineTo(head.x + r * 2.4, head.y + r * 2.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(head.x, head.y, r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
  });

  // A spring pack wedged between two parts. For `time` after `start` it
  // pushes them apart with `force` along the line between its two ends,
  // the same push on each end in opposite directions, then it drops away.
  Y.definePart({
    type: 'h04-kicker', name: 'Spring pack', category: 'Forces',
    blurb: 'A loaded spring pack wedged between two carts. When it fires it shoves both ends apart, then falls clear.',
    size: { w: 0.4, h: 0.3 },
    connector: true,
    dials: [
      { key: 'force', label: 'Push', q: 'force', def: '200 N', min: 0, max: 1e6 },
      { key: 'time', label: 'For', q: 'time', def: '0.4 s', min: 0, max: 60 },
      { key: 'start', label: 'Fires at', q: 'time', def: '0 s', min: 0, max: 600 }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b'), world = b.world, eps = 1e-9;
      var F = b.si('force'), T = b.si('time'), t0 = b.si('start') || 0;
      var built = { a: A, b: B, onA: 0, onB: 0, dir: { x: 1, y: 0 } };
      built.active = function () { var t = world.time; return t >= t0 - eps && t < t0 + T - eps; };
      built.spent = function () { return world.time >= t0 + T - eps; };
      function apply() {
        built.onA = built.onB = 0;
        if (!built.active()) return;
        var pa = A.body.worldPoint(A.local), pb = B.body.worldPoint(B.local);
        var dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy);
        var u = L > 1e-6 ? { x: dx / L, y: dy / L } : built.dir;
        built.dir = u;
        if (B.body.type === 'dynamic') { B.body.applyForce({ x: F * u.x, y: F * u.y }, pb); built.onB = F; }
        if (A.body.type === 'dynamic') { A.body.applyForce({ x: -F * u.x, y: -F * u.y }, pa); built.onA = F; }
      }
      apply();
      b.on('step', apply);
      return built;
    },
    readouts: function (built) {
      var lab = function (end) { var p = end.body.userData && end.body.userData.part; return p && p !== 'ground' ? ' on ' + p : ''; };
      return [
        { key: 'onA', label: 'push' + lab(built.a), q: 'force', read: function () { return built.onA; } },
        { key: 'onB', label: 'push' + lab(built.b), q: 'force', read: function () { return built.onB; } }
      ];
    },
    draw: function (ctx, cam, built) {
      if (built.spent()) return;          // fired and fallen clear
      var pa = cam.worldToScreen(built.a.body.worldPoint(built.a.local)), pb = cam.worldToScreen(built.b.body.worldPoint(built.b.local));
      ctx.save();
      ctx.strokeStyle = built.active() ? '#ffb347' : 'rgba(200,200,200,.6)'; ctx.lineWidth = 3;
      var n = 6, dx = (pb.x - pa.x) / n, amp = 6;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
      for (var i = 1; i < n; i++) ctx.lineTo(pa.x + dx * i, pa.y + (i % 2 ? -amp : amp));
      ctx.lineTo(pb.x, pb.y); ctx.stroke();
      if (built.active()) {
        ctx.fillStyle = '#ffb347';
        [[pa, -1], [pb, 1]].forEach(function (e) {
          var p = e[0], s = e[1];
          ctx.beginPath(); ctx.moveTo(p.x + s * 22, p.y - 18); ctx.lineTo(p.x + s * 10, p.y - 24); ctx.lineTo(p.x + s * 10, p.y - 12); ctx.fill();
          ctx.beginPath(); ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x + s * 12, p.y - 18); ctx.strokeStyle = '#ffb347'; ctx.stroke();
        });
      }
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------ layouts */

  var SITE = { g: 9.81, floor: 'concrete' };

  // The test rail: one cart, a bollard the winch drum bolts to.
  function rail(winch) {
    var parts = [
      { id: 'cart', type: 'cart', x: 2, y: 0.25, dials: { mass: '50 kg' }, locked: true, open: ['mass'], label: 'test cart' },
      { id: 'bollard', type: 'hook', x: 26, y: 0.25, locked: true, label: 'bollard' }
    ];
    if (winch) parts.push(Object.assign({ id: 'winch', type: 'winch', a: { part: 'bollard', anchor: 'eye' }, b: { part: 'cart', anchor: 'right' },
      locked: true, open: ['pull'], label: 'winch' }, winch));
    return { parts: parts };
  }
  var RAIL_CAM = { fit: { lo: { x: -1, y: -1 }, hi: { x: 28, y: 4 } } };

  // ---- H4.winch: get the supply cart into the shed ahead of the pack.
  // The cart (125 kg, 1.6 m long) starts with its tail 6.10 m ahead of the
  // pack's front and its nose 25.1 m short of the shed buffer. The winch is
  // the only force along the rail, so a = F / m. For a pull from rest:
  //   the pack (speed vz) gets closest at t = vz / a, gap = 6.10 - vz^2 / (2a)
  //   the cart hits the buffer at v = sqrt(2 a 25.1)
  // vz and the buffer rating are set so that only a = 1.60 m/s^2 works:
  // F = m a = 125 kg × 1.60 m/s^2 = 200 N. 199 N and 201 N both fail.
  var W = { m: 125, x0: 4, half: 0.8, gap0: 6.10, run: 25.1, aNeed: 1.60 };
  W.packFront0 = W.x0 - W.half - W.gap0;               // -2.90 m
  W.bufferFace = W.x0 + W.half + W.run;                 // 29.9 m
  W.vz = 4.416;                                         // m/s: the pack catches the cart below about 199.6 N
  W.rating = 8.968;                                     // m/s: the buffer gives above about 200.4 N
  W.F = W.m * W.aNeed;                                  // 200 N

  var SUPPLY = { parts: [
    { id: 'sled', type: 'cart', x: W.x0, y: 0.25, dials: { mass: '125 kg' }, locked: true, label: 'supply cart' },
    { id: 'pack', type: 'h04-pack', x: W.packFront0 - 0.6, y: 0.85, dials: { speed: W.vz + ' m/s' }, locked: true, label: 'the pack' },
    { id: 'buffer', type: 'block', x: W.bufferFace + 0.3, y: 0.6, locked: true, label: 'shed buffer' },
    { id: 'drum', type: 'hook', x: W.bufferFace + 1.2, y: 0.25, locked: true, label: 'shed drum' },
    { id: 'winch', type: 'winch', a: { part: 'drum', anchor: 'eye' }, b: { part: 'sled', anchor: 'right' },
      dials: { pull: '100 N', speed: '12 m/s' }, locked: true, open: ['pull'], label: 'shed winch' }
  ] };

  // Speed of the cart's nose as it meets the buffer face. The contact stops
  // the cart inside one step, so read the last two samples before the hit and
  // carry the motion on (or back) to the face: v^2 = v1^2 + 2 a (face - nose1), with a
  // the cart's own measured acceleration over that step.
  function track(s) {
    var m = s.memo, p = s.pos('sled'), v = s.vel('sled');
    if (!m.hit) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'sled' && i.b === 'buffer') || (i.a === 'buffer' && i.b === 'sled'); })[0];
      if (hit && m.prev && m.prev2) {
        var a = (m.prev.v - m.prev2.v) / (m.prev.t - m.prev2.t), gap = W.bufferFace - (m.prev.x + W.half);
        m.hit = { speed: Math.sqrt(Math.max(0, m.prev.v * m.prev.v + 2 * a * gap)), t: s.t };
      } else if (hit) m.hit = { speed: hit.speed, t: s.t };
      if (!m.prev || m.prev.t !== s.t) { m.prev2 = m.prev; m.prev = { t: s.t, x: p.x, v: v.x }; }
    }
    return m.hit;
  }
  var WINCH_GOAL = G.all(
    G.never(function (s) {
      var p = s.pos('pack'), c = s.pos('sled');
      return p && c && p.x + 0.6 >= c.x - W.half ? 'The pack caught the cart at x = ' + f3(c.x) + ' m, ' + f3(s.t) + ' s in.' : null;
    }),
    G.never(function (s) {
      var h = track(s);
      return h && h.speed > W.rating ? 'The cart reached the shed ahead of the pack, then hit the buffer at ' + D.fmtNum(h.speed, 4) + ' m/s. It is rated for ' + D.fmtNum(W.rating, 4) + ' m/s, so it tore loose.' : null;
    }),
    function (s) { return track(s) ? 'pass' : null; }
  );

  // ---- third law: two carts on the rail, a spring pack between them.
  function pair(mA, mB, labA, labB, kick) {
    return { parts: [
      { id: 'A', type: 'cart', x: 9, y: 0.25, dials: { mass: mA }, locked: true, open: ['mass'], label: labA },
      { id: 'B', type: 'cart', x: 10.8, y: 0.25, dials: { mass: mB }, locked: true, open: ['mass'], label: labB },
      Object.assign({ id: 'kick', type: 'h04-kicker', a: { part: 'A', anchor: 'right' }, b: { part: 'B', anchor: 'left' },
        dials: { force: '200 N', time: '0.4 s', start: '0 s' }, locked: true, label: 'spring pack' }, kick || {})
    ] };
  }
  var PAIR_CAM = { fit: { lo: { x: 0, y: -1 }, hi: { x: 20, y: 4 } } };

  // ---- H4.reaction: B has to meet the coupler at 0.400 m/s.
  // The spring pack is calibrated on a 60.0 kg cart: it gives it 3.20 m/s^2
  // for 0.500 s. Third law: it pushes B just as hard, F = 60.0 × 3.20 = 192 N.
  // B leaves at v = F t / m_B, so for 0.400 m/s, m_B = 192 × 0.500 / 0.400 = 240 kg.
  var R = { mA: 60.0, aA: 3.20, t: 0.5, vB: 0.400, couplerFace: 16 };
  R.F = R.mA * R.aA;                                    // 192 N
  R.mB = R.F * R.t / R.vB;                              // 240 kg
  R.lo = 0.39; R.hi = 0.41;                             // the coupling latches between these, m/s

  function couplerDesign() {
    var d = pair(R.mA.toFixed(1) + ' kg', '120 kg', 'cart A', 'ore cart B', { dials: { force: R.F + ' N', time: R.t + ' s', start: '0 s' }, hide: ['force'] });
    d.parts[0].open = [];
    d.parts.push({ id: 'coupler', type: 'block', x: R.couplerFace + 0.3, y: 0.6, dials: { height: '0.8 m' }, locked: true, label: 'coupler' });
    return d;
  }
  // Judged on the impact the engine reports when B meets the coupler (its
  // approach speed), so it doesn't matter how many steps a frame takes.
  var COUPLE_GOAL = G.all(
    G.never(function (s) { var a = s.pos('A'); return a && a.x < -30 ? 'Cart A ran off the end of the rail.' : null; }),
    function (s) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'B' && i.b === 'coupler') || (i.a === 'coupler' && i.b === 'B'); })[0];
      if (!hit) return null;
      var v = hit.speed;
      if (v > R.hi) return { fail: 'Cart B reached the coupler at ' + f3(v) + ' m/s and bounced off. The coupling only latches between ' + R.lo + ' and ' + R.hi + ' m/s.' };
      if (v < R.lo) return { fail: 'Cart B crept up at ' + f3(v) + ' m/s, too slow to trip the latch (it needs ' + R.lo + ' to ' + R.hi + ' m/s).' };
      return 'pass';
    }
  );

  /* -------------------------------------------------------------- data */

  // The three runs the second-law step asks for (others are recorded too).
  var WANT = [{ m: 50, F: 100 }, { m: 50, F: 200 }, { m: 100, F: 200 }];
  function runs(ctx) { return (ctx.values.h4runs = ctx.values.h4runs || []); }
  function findRun(ctx, m, F) { return runs(ctx).filter(function (r) { return Math.abs(r.m - m) < 0.01 && Math.abs(r.F - F) < 0.01; })[0]; }
  function winchOn(ctx, id) {
    return ctx.all('winch').filter(function (w) { return w.a && w.b && ((w.a.part === 'bollard' && w.b.part === id) || (w.b.part === 'bollard' && w.a.part === id)); })[0];
  }
  function endSpeed(r, id) { var v = r && r.state && r.state.vel(id); return v ? v.x : NaN; }

  SE.content.registerLevel('ch01', {
    id: 'H4', order: 4, title: 'Newton\'s Yard',
    subtitle: 'The three laws of motion',
    sections: ['1.2'],
    minutes: 25,
    intro: [
      'The east yard froze solid overnight, so Hask has moved everything onto the greased rail: two ore carts, a test cart and a winch bolted to a bollard.',
      '"Everything in this game runs on three rules Newton wrote down in 1687. They came from experiment, not from anyone\'s say-so, so that\'s how you\'ll learn them: by pulling carts. The rollers take friction out of the picture, so the only forces left along the rail are the ones we put there."'
    ].join('\n\n'),
    goals: [
      'State Newton\'s **first**, **second** and **third** laws and the frame they hold in',
      'Use **F = ma** to find a force from an acceleration, and an acceleration from a force',
      'Explain why action and reaction are equal yet give different accelerations',
      'Connect F = ma to the rate of change of momentum'
    ],
    yard: { site: SITE, camera: RAIL_CAM, poke: false, design: rail(null) },
    unlocks: { tools: [], formulas: ['ch01.newton1', 'ch01.newton2', 'ch01.newton3'], materials: [] },
    // Reference builds for the scored jobs (checked by tests/yard.test.js).
    solutions: {
      'H4.winch': [
        { set: { winch: { pull: '200 N' } } },
        { set: { winch: { pull: '0.200 kN' } } },
        { pass: false, set: { winch: { pull: '199 N' } } },       // a = 1.592: the pack gets a hand on it
        { pass: false, set: { winch: { pull: '201 N' } } },       // a = 1.608: too fast into the buffer
        { pass: false, set: { winch: { pull: '1.23 kN' } } },     // m g instead of m a
        { pass: false, set: { winch: { pull: '78.1 N' } } }       // m / a
      ],
      'H4.reaction': [
        { set: { B: { mass: '240 kg' } } },
        { pass: false, set: { B: { mass: '60 kg' } } },          // same acceleration as A: far too fast
        { pass: false, set: { B: { mass: '15 kg' } } },          // mass ratio upside down
        { pass: false, set: { B: { mass: '270 kg' } } }
      ]
    },
    steps: [
      {
        type: 'say', who: 'hask',
        text: 'One rule before any of the laws. Newton\'s laws describe a **particle** as seen from a **non-accelerating reference frame**: the ground under your boots, the rail, anything that isn\'t itself speeding up, slowing down or turning.\n\nMeasure from inside a braking truck and the laws stop working as written. We\'ll come back to that. For now, the yard is our frame.'
      },

      // ------------------------------------------------------- first law
      {
        type: 'build', who: 'hask',
        yard: { design: rail(null), camera: RAIL_CAM, bin: [{ type: 'winch', count: 1, dials: { pull: '100 N', speed: '1 m/s' } }] },
        text: 'Take the **Winch** from the bin. Click the **bollard** on the right for the drum end, then the **cart** for the hook.\n\nSelect the winch to see its dials: **100 N** max pull, line speed **1 m/s**. The drum reels in at 1 m/s and never pulls harder than 100 N.',
        goalText: 'Winch from the bollard to the cart',
        until: function (ctx) { return winchOn(ctx, 'cart') ? true : (ctx.find('winch') ? 'One end on the **bollard**, the other on the **cart**.' : false); }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: G.after(8), readouts: null },
        text: 'Press **▶ Run** and watch two gauges: the cart\'s **speed** and the winch\'s **line tension**.\n\nAt first the cart is slower than the line, so the winch pulls as hard as it can. Keep watching after the cart catches up with the line.',
        goalText: 'Run it for 8 s',
        until: function (ctx, type) { return type === 'result' && !!ctx.result && !!winchOn(ctx, 'cart'); },
        after: function (ctx) {
          var w = winchOn(ctx, 'cart'), T = ctx.result.state.read(w.id + '.tension');
          return 'At **t = 8 s**: the cart rolls at **' + f3(endSpeed(ctx.result, 'cart')) + ' m/s** and the line tension is **' + f3(Math.max(0, T)) + ' N**. Nothing pushes or pulls the cart along the rail any more, and it keeps going at the same speed.';
        }
      },
      {
        type: 'rule', title: 'Newton\'s first law',
        law: '\\Sigma F = 0 \\quad \\Rightarrow \\quad v = \\t{constant}',
        text: 'A particle at rest stays at rest, and one moving in a straight line at steady speed keeps doing exactly that, until an **unbalanced force** acts on it.\n\nWhile the line was tight, there was an unbalanced force and the speed climbed. Once the cart was moving with the line, the tension dropped to nothing and the speed simply **stayed**. Forces can still act on a body in this state (weight down, rollers up) as long as they cancel.',
        formula: 'ch01.newton1'
      },

      // ------------------------------------------------------ second law
      {
        type: 'watch', who: 'hask',
        kicker: 'Experiment',
        yard: { design: rail({ dials: { pull: '100 N', speed: '12 m/s' } }), camera: RAIL_CAM, goal: G.after(3), readouts: ['cart.speed', 'winch.tension'] },
        onEnter: function (ctx) { ctx.values.h4runs = []; },
        text: 'Hask has swapped in a fast drum (**12 m/s** line speed), so the cart never catches the line and the winch always pulls at its **max pull**. That is the one unbalanced force on the cart.\n\nEach run lasts **3 s** from rest. Do these three, changing the cart\'s **mass** and the winch\'s **max pull**:\n\n1. 50 kg, 100 N\n2. 50 kg, 200 N\n3. 100 kg, 200 N\n\nThe acceleration is the final speed divided by 3 s.',
        goalText: 'All three runs done',
        until: function (ctx, type) {
          if (type === 'result' && ctx.result) {
            var m = ctx.si('cart', 'mass'), F = ctx.si('winch', 'pull'), v = endSpeed(ctx.result, 'cart');
            if (isFinite(m) && isFinite(F) && !findRun(ctx, m, F)) runs(ctx).push({ m: m, F: F, v: v, t: ctx.result.time, a: v / ctx.result.time });
          }
          var left = WANT.filter(function (w) { return !findRun(ctx, w.m, w.F); });
          if (!left.length) return true;
          return runs(ctx).length ? 'Still to do: ' + left.map(function (w) { return '**' + w.m + ' kg, ' + w.F + ' N**'; }).join(' and ') + '.' : false;
        },
        after: 'Put the three results side by side before reading on. What happens when only the force changes? When only the mass changes?'
      },
      {
        type: 'rule', title: 'Your three runs',
        kicker: 'What the rail says',
        eq: function (ctx) {
          return WANT.map(function (w, i) {
            var r = findRun(ctx, w.m, w.F);
            return '\\t{Run ' + (i + 1) + ':}\\quad a = \\frac{' + f3(r.v) + '\\u{ m/s}}{' + f3(r.t) + '\\u{ s}} = ' + f3(r.a) + '\\u{ m/s^2} \\qquad (' + f3(w.m) + '\\u{ kg},\\ ' + f3(w.F) + '\\u{ N})';
          });
        },
        text: function (ctx) {
          var r1 = findRun(ctx, 50, 100), r2 = findRun(ctx, 50, 200), r3 = findRun(ctx, 100, 200);
          return '**Runs 1 → 2**: same cart, twice the pull, and the acceleration went from ' + f3(r1.a) + ' to ' + f3(r2.a) + ' m/s². It doubled: **a ∝ F**, and it points the way the winch pulls.\n\n' +
            '**Runs 2 → 3**: same pull, twice the mass, and it fell from ' + f3(r2.a) + ' to ' + f3(r3.a) + ' m/s². It halved: **a ∝ 1/m**.\n\n' +
            'Both at once: a ∝ F/m, so **F = k m a** for some constant k that depends only on the units we pick. Look at your numbers: F ÷ (m a) is ' + f3(100 / (50 * r1.a)) + ', ' + f3(200 / (50 * r2.a)) + ' and ' + f3(200 / (100 * r3.a)) + '.';
        }
      },
      {
        type: 'rule', title: 'Newton\'s second law',
        kicker: 'Newton\'s second law',
        law: 'F = ma \\qquad \\t{(Eq. 1–1)}',
        eq: '1\\u{ N} = 1\\u{ kg} \\times 1\\u{ m/s^2} \\quad \\Rightarrow \\quad k = 1',
        text: 'We get to choose the size of the force unit, so choose the one that makes k = 1: the force that gives **1 kg** an acceleration of **1 m/s²**. That is the **newton**, a derived unit, 1 N = 1 kg·m/s².\n\nAn unbalanced force **F** on a particle of mass **m** gives it an acceleration **a** in the **same direction** as the force and **proportional** to it. The first law is the special case F = 0, so a = 0.',
        formula: 'ch01.newton2'
      },
      {
        type: 'job', id: 'H4.winch', who: 'juno',
        yard: { design: SUPPLY, camera: { fit: { lo: { x: -5, y: -1 }, hi: { x: 32, y: 4 } } }, bin: [], readouts: ['sled.speed', 'winch.tension', 'pack.front'] },
        text: 'Juno, over the radio: "The pack is coming up the spur. That cart is **125 kg** of fuel and medicine and it has to get into the shed before they reach it."\n\nHask has worked the timing: on the greased rail the cart needs an acceleration of exactly **1.60 m/s²**. Any less and the lead runner gets a hand on it. Any more and it hits the shed buffer faster than the buffer is rated for.\n\nThe shed winch is the only force along the rail. Set its **max pull** and run it.',
        goalText: 'Cart into the shed, ahead of the pack, without wrecking the buffer',
        goal: WINCH_GOAL,
        timeout: 20,
        hints: [
          'The rollers are frictionless and the winch line is level, so the winch pull is the **unbalanced force** on the cart.',
          'Newton\'s second law: unbalanced force = mass × acceleration.',
          'F = m a = 125 kg × 1.60 m/s² = **200 N**. Type it as 200 N or 0.200 kN.'
        ],
        onFail: function (ctx) {
          var F = ctx.si('winch', 'pull');
          return isFinite(F) ? 'With **' + f3(F) + ' N** on 125 kg the cart accelerated at **' + f3(F / W.m) + ' m/s²**. It needs 1.60 m/s².' : '';
        },
        success: function (ctx) {
          var a = ctx.si('winch', 'pull') / W.m, closest = W.gap0 - W.vz * W.vz / (2 * a);
          return 'Door shut. At a = ' + f3(a) + ' m/s² the lead runner came within **' + Math.max(0, closest * 100).toFixed(0) + ' cm** of the tail. One force along the rail, so F = ma gave the setting directly, and half a percent either way would have cost you the cart.';
        }
      },

      // ------------------------------------------------------- third law
      {
        type: 'watch', who: 'hask',
        yard: { design: pair('40 kg', '200 kg', 'survivor cart', 'ore cart'), camera: PAIR_CAM, goal: G.after(2), readouts: ['kick.onA', 'kick.onB', 'A.speed', 'B.speed'] },
        text: 'A survivor on a light **40 kg** cart has wedged a spring pack against a **200 kg** ore cart. The pack fires for **0.4 s** and then falls clear. It has a force gauge on each end.\n\nBefore you run it, decide which cart you think will feel the **bigger push**. Then press **▶ Run** (try **¼×** speed) and watch both gauges.',
        goalText: 'Fire the spring pack',
        until: function (ctx, type) { return type === 'result' && !!ctx.result; },
        after: function (ctx) {
          var vA = endSpeed(ctx.result, 'A'), vB = endSpeed(ctx.result, 'B'), F = ctx.si('kick', 'force');
          ctx.values.pair = { mA: ctx.si('A', 'mass'), mB: ctx.si('B', 'mass'), vA: vA, vB: vB, F: F, t: ctx.si('kick', 'time') };
          return 'Both gauges read **' + f3(F) + ' N** the whole time the pack fired. But the survivor cart left at **' + f3(Math.abs(vA)) + ' m/s** to the left and the ore cart at **' + f3(Math.abs(vB)) + ' m/s** to the right.';
        }
      },
      {
        type: 'rule', title: 'Newton\'s third law',
        law: 'F_{A \\t{ on } B} = -F_{B \\t{ on } A}',
        eq: function (ctx) {
          var p = ctx.values.pair;
          if (!p) return null;
          return ['a_A = \\frac{F}{m_A} = \\frac{' + f3(p.F) + '\\u{ N}}{' + f3(p.mA) + '\\u{ kg}} = ' + f3(p.F / p.mA) + '\\u{ m/s^2}',
            'a_B = \\frac{F}{m_B} = \\frac{' + f3(p.F) + '\\u{ N}}{' + f3(p.mB) + '\\u{ kg}} = ' + f3(p.F / p.mB) + '\\u{ m/s^2}'];
        },
        text: 'When two bodies push or pull on each other, the two forces are **equal** in size, **opposite** in direction and **collinear** (on one line).\n\nThey act on **different bodies**: one on the survivor cart, one on the ore cart. That is why they never cancel. To find what one body does, count only the forces acting **on that body**, then use the second law on it alone. Same force, five times the mass, a fifth of the acceleration.',
        formula: 'ch01.newton3'
      },
      {
        type: 'rule', title: 'The second law in momentum form',
        kicker: 'Look again at your run',
        law: 'F = \\frac{d(mv)}{dt} = m\\frac{dv}{dt} = ma \\quad (m \\t{ constant})',
        eq: function (ctx) {
          var p = ctx.values.pair;
          if (!p) return null;
          return ['m_A v_A = (' + f3(p.mA) + '\\u{ kg})(' + f3(Math.abs(p.vA)) + '\\u{ m/s}) = ' + f3(p.mA * Math.abs(p.vA)) + '\\u{ kg·m/s}',
            'm_B v_B = (' + f3(p.mB) + '\\u{ kg})(' + f3(Math.abs(p.vB)) + '\\u{ m/s}) = ' + f3(p.mB * Math.abs(p.vB)) + '\\u{ kg·m/s}',
            '\\frac{\\Delta(mv)}{\\Delta t} = \\frac{' + f3(p.mB * Math.abs(p.vB)) + '\\u{ kg·m/s}}{' + f3(p.t) + '\\u{ s}} = ' + f3(p.mB * Math.abs(p.vB) / p.t) + '\\u{ N}'];
        },
        text: 'Newton actually wrote the second law with **linear momentum**, mass times velocity: the unbalanced force on a particle is proportional to the **time rate of change of its momentum**. For a body whose mass doesn\'t change, the m comes straight out of the derivative and you are back at F = ma.\n\nYour two carts left with equal and opposite momenta, and the momentum each one gained, divided by the time the pack fired, is the gauge reading.'
      },
      {
        type: 'job', id: 'H4.reaction', who: 'hask',
        yard: { design: couplerDesign(), camera: PAIR_CAM, goal: COUPLE_GOAL, bin: [], readouts: ['kick.onA', 'A.speed', 'B.speed'] },
        text: 'Ore cart B has to roll into the **coupler** at **0.400 m/s**: the latch only catches between 0.39 and 0.41 m/s.\n\nThe spring pack\'s dial is hidden and its gauge only reads on **cart A\'s side**. Its tag says it gives a **60.0 kg** cart an acceleration of **3.20 m/s²** for **0.500 s**. Cart A is 60.0 kg.\n\nYou can\'t change the pack. You can load ore into **cart B**: set its **mass** so it leaves at exactly 0.400 m/s.',
        goalText: 'Cart B latches into the coupler',
        goal: COUPLE_GOAL,
        timeout: 25,
        hints: [
          'Start from what you know about cart A. Its mass and acceleration tell you the force the pack puts on it.',
          'By the third law, the pack pushes on B just as hard as on A. Then use the second law on B alone: v = F t / m.',
          'F = 60.0 kg × 3.20 m/s² = 192 N on each cart. B needs v = 0.400 m/s after 0.500 s, so m = F t / v = 192 × 0.500 / 0.400 = **240 kg**.'
        ],
        onFail: function (ctx) {
          var m = ctx.si('B', 'mass');
          return isFinite(m) ? 'With B at **' + f3(m) + ' kg**, the pack gave it ' + f3(R.F * R.t / m) + ' m/s. Count the force on B, then a = F / m.' : '';
        },
        success: 'Latched. The pack pushed A and B equally hard (third law) and each cart answered on its own mass (second law). Four times the mass, a quarter of the acceleration: 0.800 m/s² against A\'s 3.20.'
      },
      {
        type: 'deeper', title: 'The leaking sand cart',
        teaser: 'A cart leaks sand through a hole in its floor. Does F = d(mv)/dt mean it speeds up just by leaking?',
        steps: [
          { type: 'say', who: 'hask', text: 'Picture a cart carrying 60 kg of sand that pours out of a hole in its floor at 4 kg/s while it rolls at 2 m/s with nothing pulling it. Its momentum mv falls as the sand drains. Does it speed up to keep mv constant?\n\nNo. Each grain leaves straight down relative to the cart, so it leaves with the cart\'s own speed and carries its share of momentum away. Nothing pushes the cart forward or back, so its velocity stays at 2 m/s. You can\'t apply F = d(mv)/dt to the cart alone here: the sand that left is part of the system.' },
          { type: 'say', who: 'hask', text: 'Now put a steady 60 N on it from rest for 8 s. Keeping all 120 kg, it would reach 60 × 8 ÷ 120 = 4.00 m/s. Leaking, its mass is m(t) = 120 − 4t, so the same force gives a growing acceleration a = F / m(t). Add that up over the 8 s and v = (F / 4) ln(120 / 88) = 4.65 m/s. Same force, more speed, because there is less of it to push by the end.' }
        ]
      },
      {
        type: 'deeper', title: 'When the laws seem to fail: riding in the braking truck',
        teaser: 'From a braking truck, a loose drum slides forward with nothing pushing it. Is the first law broken?',
        steps: [
          { type: 'say', who: 'hask', text: 'A truck brakes with a fuel drum loose on its icy bed. From the driver\'s seat the drum **slides forward**, and nothing pushed it.\n\nThe first law isn\'t broken. The driver is measuring from an **accelerating** frame. Seen from the road, the drum just carries on at the speed it had, because nothing acts on it along the bed. It\'s the truck that slows down underneath it. That\'s why Newton\'s laws come with the small print: measure from a frame that isn\'t accelerating.' }
        ]
      },
      {
        type: 'free', who: 'hask',
        yard: {
          design: { parts: rail(null).parts.concat(pair('40 kg', '200 kg', 'cart A', 'cart B').parts) },
          camera: { fit: { lo: { x: -1, y: -1 }, hi: { x: 28, y: 4 } } },
          bin: [{ type: 'winch', count: 2, dials: { pull: '200 N', speed: '12 m/s' } }, { type: 'h04-kicker', count: 2 }, { type: 'push', count: 2 }, { type: 'cart', count: 2 }, { type: 'speedo', count: 3 }],
          goal: null, poke: true
        },
        text: 'The rail is yours: winches, spring packs, pushes and spare carts. While it runs you can **drag a cart** with the mouse.',
        prompts: [
          'Pull backwards on a cart that is rolling forwards. Which way does the acceleration point?',
          'Make carts A and B the same mass and fire the pack. What happens to the two speeds?',
          'Winch cart A while the spring pack fires. Do the two gauges on the pack still agree?'
        ]
      },
      {
        type: 'summary',
        points: [
          'Newton\'s laws hold for a particle measured from a **non-accelerating reference frame**. Learn all three by heart.',
          '**First law**: with no unbalanced force, a particle at rest stays at rest, and a moving particle keeps a constant velocity.',
          '**Second law**: **F = ma** (Eq. 1–1). The acceleration points along the unbalanced force and is proportional to it. Defining the newton as 1 kg·m/s² makes the constant equal to 1.',
          'With momentum: the unbalanced force is the time rate of change of linear momentum. For a constant mass this is F = ma.',
          '**Third law**: action and reaction are **equal, opposite and collinear**, and they act on **different bodies**, so they never cancel on one body.'
        ]
      }
    ]
  });
})(globalThis.SE);
