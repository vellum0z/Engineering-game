/*
 * Yard parts: rigging. See docs/YARD.md for how parts are written.
 *
 *   winch         motor drum that reels a line in or out, with a pull limit,
 *                 a brake, a line rating and an optional stop
 *   chain         grade 80 lifting chain in standard sizes, drawn as links
 *   spring        a coil spring between two anchors: F = k·(L - rest)
 *   sheave        a pulley wheel bolted to the yard; winch lines and cables
 *                 can run over it
 *   jib           a fixed crane: mast and boom, with a sheave at the tip
 *   counterweight a concrete block with its mass cast on the side
 *
 * Running a line over a sheave ("via"). A winch or cable has a `route` dial:
 *   'direct'       the line runs straight from end a to end b
 *   'over sheave'  the line runs from end a up over the nearest sheave (any
 *                  `sheave` part or the tip of any `jib`, nearest to end b)
 *                  and down to end b
 * A level can name the sheave instead with `via: { part: 'id' }` on the
 * instance, which wins over the dial. The winch's `parts` dial is the number
 * of falls from the sheave to the hook (a block and tackle): the hook gets
 * parts × line tension. Sheaves are frictionless, so the tension is the same
 * all along the line. Each run leaves the wheel at its rim tangent point (on
 * the outside of the bend, fixed when the run starts), so a load under one
 * edge of the wheel hangs straight down from that edge.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial;
  var LB = 4.4482216152605;    // N per lbf
  var LBM = 0.45359237;        // kg per lb

  function fmtF(N) { return D.format(N, D.autoUnit(N, 'force'), 3, 'force'); }
  function fmtLb(N) { return D.format(N, 'lb', 3, 'force'); }

  /* ------------------------------------------------------ sheave routing */
  // Every place a line can run over in this build: { part, body, local, world, r }
  function sheavesIn(out) {
    var list = [];
    Object.keys(out.parts).forEach(function (id) {
      var bp = out.parts[id];
      if (bp && bp.sheave) list.push(Object.assign({ part: id }, bp.sheave, { world: bp.sheave.body.worldPoint(bp.sheave.local) }));
    });
    return list;
  }
  // The sheave a connector's line runs over, or null for a direct line.
  function routeFor(b, hookWorld) {
    var inst = b.inst, list = sheavesIn(b.out);
    if (inst.via && inst.via.part) {
      var named = list.filter(function (s) { return s.part === inst.via.part; })[0];
      if (!named) throw new Error((inst.label || inst.id) + ': ' + inst.via.part + ' is not a sheave or jib to run over');
      return named;
    }
    if (b.text('route') !== 'over sheave') return null;
    if (!list.length) throw new Error('There is no sheave or jib in the yard for the line to run over.');
    var best = null, bd = Infinity;
    list.forEach(function (s) { var d = Math.hypot(s.world.x - hookWorld.x, s.world.y - hookWorld.y); if (d < bd) { bd = d; best = s; } });
    return best;
  }
  // Where the runs of a line A -> wheel -> B leave the wheel (centre C,
  // radius r). The line bends round the wheel, so the wheel is on the inside
  // of the turn: each leave point is the tangent point from its end with the
  // centre on the turning side. An end inside the wheel leaves at the hub.
  function cross(a, b) { return a.x * b.y - a.y * b.x; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function tangentPoint(C, r, P, turn, Q) {
    var dx = P.x - C.x, dy = P.y - C.y, d = Math.hypot(dx, dy);
    if (!(r > 0) || d <= r * 1.0001) return { x: C.x, y: C.y };
    var th = Math.atan2(dy, dx), al = Math.acos(r / d);
    var t1 = { x: C.x + r * Math.cos(th + al), y: C.y + r * Math.sin(th + al) };
    var t2 = { x: C.x + r * Math.cos(th - al), y: C.y + r * Math.sin(th - al) };
    if (turn) return Math.sign(cross(sub(t1, P), sub(C, t1))) === turn ? t1 : t2;
    // a straight line through the hub: the side away from the other end
    return Math.hypot(t1.x - Q.x, t1.y - Q.y) >= Math.hypot(t2.x - Q.x, t2.y - Q.y) ? t1 : t2;
  }
  function wrap(s, A, B) {
    var C = s.world, r = s.r || 0, turn = Math.sign(cross(sub(C, A), sub(B, C)));
    return { a: tangentPoint(C, r, A, turn, B), b: tangentPoint(C, r, B, -turn, A) };
  }
  function drawWrap(ctx, cam, s, w, col) {
    var C = cam.worldToScreen(s.world), R = (s.r || 0) * cam.zoom + 1.5;
    if (R < 3) return;
    var a0 = Math.atan2(-(w.a.y - s.world.y), w.a.x - s.world.x), a1 = Math.atan2(-(w.b.y - s.world.y), w.b.x - s.world.x);
    // the short way round over the outside of the wheel
    var da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(C.x, C.y, R, a0, a0 + da, da < 0); ctx.stroke(); ctx.restore();
  }
  var ROUTE = { key: 'route', label: 'Route', choice: ['direct', 'over sheave'], def: 'direct' };

  /* ------------------------------------------------------------- drawing */
  function line(ctx, cam, pts, col, w, dash) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach(function (p, i) { var s = cam.worldToScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.stroke(); ctx.restore();
  }
  function wheel(ctx, cam, c, r) {
    var s = cam.worldToScreen(c), R = Math.max(6, r * cam.zoom);
    ctx.save(); ctx.fillStyle = '#3a3f44'; ctx.strokeStyle = '#9aa3ab'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#6d747a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c9ced3'; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function tag(ctx, cam, p, text, dy) {
    var s = cam.worldToScreen(p);
    ctx.save(); ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(230,225,211,.9)';
    ctx.textAlign = 'center'; ctx.fillText(text, s.x, s.y + (dy || 0)); ctx.restore();
  }

  /* --------------------------------------------------------------- winch */
  var STOP_DECEL = 0.5;   // m/s², drum slowing into its stop (well under g, so the line stays taut)
  Y.definePart({
    type: 'winch', name: 'Winch', category: 'Rigging',
    blurb: 'A motor drum that reels its line in (positive speed) or pays it out. It stalls if the load needs more than its pull, and the line snaps above its rating.',
    size: { w: 0.6, h: 0.6 },
    connector: true,
    dials: [
      { key: 'pull', label: 'Max pull', q: 'force', def: '5 kN', min: 0 },
      { key: 'speed', label: 'Reel speed', q: 'speed', def: '0.3 m/s', min: -20, max: 20 },
      { key: 'rating', label: 'Line breaks at', q: 'force', def: '20 kN', min: 1 },
      { key: 'brake', label: 'Brake', choice: ['on', 'off'], def: 'on' },
      { key: 'stop', label: 'Stop at line out', q: 'length', def: '', optional: true, min: 0 },
      ROUTE,
      { key: 'parts', label: 'Falls to hook', choice: ['1', '2', '3', '4'], def: '1' }
    ],
    build: function (b) {
      var P = b.P, A = b.end('a'), B = b.end('b');
      var speed = b.si('speed'), pull = b.si('pull'), stop = b.si('stop');
      var brake = b.text('brake') === 'on';
      var s = routeFor(b, B.world);
      var def = {
        bodyA: A.body, localAnchorA: A.local, bodyB: B.body, localAnchorB: B.local,
        reelSpeed: speed, drumRadius: 0.25,
        // a stopped drum with the brake off free-wheels: nothing holds the line
        maxPull: (!brake && speed === 0) ? 0 : pull,
        brake: brake, brakeForce: Infinity,
        parts: Number(b.text('parts')) || 1,
        breakForce: b.si('rating'), label: b.inst.label || 'winch'
      };
      var lead = null;
      if (s) {
        // the falls leave the wheel at the hook-side tangent (the drum run is
        // drawn to its own tangent; its length barely differs)
        lead = wrap(s, A.world, B.world);
        def.via = { body: s.body, local: s.body.localPoint(lead.b) };
      }
      if (stop != null) { if (speed >= 0) def.minLength = stop; else def.maxLength = stop; }
      var j = b.joint(new P.WinchJoint(def));
      var st = { prev: j.length, stalled: false, maxed: false, braked: false };
      // Each step: is the drum winning? At max pull the drum slips, but a load
      // that still rises (line out falling) is only accelerating at full
      // pull. It is stalled when the line out stops falling.
      // Near a stop the drum slows at STOP_DECEL so the load doesn't fly up
      // off the line, and at the stop a braked drum holds (the brake takes
      // over from the motor).
      b.on('step', function () {
        if (j.broken) return;
        var dL = j.length - st.prev;
        st.prev = j.length;
        st.maxed = j.slipping;
        st.stalled = j.slipping && speed > 0 ? dL > -1e-7 : false;
        if (stop == null || st.braked || speed === 0) return;
        var left = speed > 0 ? j.length - stop : stop - j.length;
        if (left <= 1e-4) {
          if (brake) { j.reelSpeed = 0; st.braked = true; }
          return;
        }
        var v = Math.min(Math.abs(speed), Math.sqrt(2 * STOP_DECEL * left));
        j.reelSpeed = speed > 0 ? v : -v;
      });
      return { joint: j, sheave: null, over: s, lead: lead, drum: A, hook: B, state: st,
        stalled: function () { return st.stalled; }, atMaxPull: function () { return st.maxed; } };
    },
    plate: function (inst) {
      return ['Pull ' + (inst.dials.pull || '?') + ' at ' + (inst.dials.speed || '?'), 'Line breaks at ' + (inst.dials.rating || '?')];
    },
    readouts: function (built) {
      var j = built.joint, list = [
        { key: 'tension', label: 'line tension', q: 'force', read: function () { return j.broken ? 0 : j.lineTension(); } },
        { key: 'lineOut', label: 'line out', q: 'length', read: function () { return j.lineOut(); } },
        { key: 'speed', label: 'drum speed', q: 'speed', read: function () { return j.broken ? 0 : j.speed; } }
      ];
      if (j.parts > 1) list.push({ key: 'hook', label: 'hook load', q: 'force', read: function () { return j.broken ? 0 : j.hookForce(); } });
      return list;
    },
    draw: function (ctx, cam, built) {
      var j = built.joint;
      if (j.broken) return;
      if (built.stalled()) tag(ctx, cam, j.anchorA(), 'STALLED', -16);
      else if (built.atMaxPull()) tag(ctx, cam, j.anchorA(), 'FULL PULL', -16);
      if (!built.over || SE.phys.debugDrawsWinchVia) return;
      // the debug renderer draws drum to hook; show the real path over the sheave
      // (set SE.phys.debugDrawsWinchVia once debugdraw.js draws it itself)
      var a = j.anchorA(), v = j.via.body ? j.via.body.worldPoint(j.via.local) : j.via.local, h = j.anchorB();
      var slack = j.isSlack(), col = '#c9a86a', dash = slack ? [7, 5] : null;
      wheel(ctx, cam, built.over.world, built.over.r || 0.2);
      line(ctx, cam, [a, built.lead.a], col, 2.5, dash);
      drawWrap(ctx, cam, built.over, built.lead, col);
      for (var k = 0; k < j.parts; k++) {
        var off = (k - (j.parts - 1) / 2) * 0.08;
        line(ctx, cam, [{ x: v.x + off, y: v.y }, { x: h.x + off, y: h.y }], col, 2, dash);
      }
    }
  });

  /* --------------------------------------------------------------- chain */
  var CHAIN_SIZES = ['6 mm', '8 mm', '10 mm', '13 mm', '16 mm'];
  var CHAIN_FACTOR = 4;       // grade 80 working load limit = breaking load / 4
  function chainRatings(size) {
    var d = parseFloat(size) / 1000, brk = SE.phys.rating.cable('chain80', d);
    return { d: d, breaking: brk, wll: brk / CHAIN_FACTOR };
  }
  Y.definePart({
    type: 'chain', name: 'Chain', category: 'Rigging',
    blurb: 'Grade 80 lifting chain. It has weight of its own, it hangs slack if you give it extra length, and it snaps at its breaking load. The working load limit on the plate is a quarter of that.',
    size: { w: 0.1, h: 2 },
    connector: true,
    dials: [
      { key: 'size', label: 'Size', choice: CHAIN_SIZES, def: '10 mm' },
      { key: 'length', label: 'Length', q: 'length', def: '', optional: true, min: 0.1 }
    ],
    // One rope joint carries the load (a chain of light links under a heavy
    // load is beyond an iterative solver), with the chain's own weight
    // applied at its two ends. The art draws the links, draped when slack.
    build: function (b) {
      var A = b.end('a'), B = b.end('b'), r = chainRatings(b.text('size'));
      var span = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var L = b.si('length') != null ? b.si('length') : span;
      if (L < span - 1e-6) throw new Error('The chain is ' + D.format(L, 'm', 3) + ' but the ends are ' + D.format(span, 'm', 3) + ' apart.');
      var mpl = b.P.material('chain80').density * Math.PI * r.d * r.d / 4;
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        rope: true, length: L, breakForce: r.breaking, label: b.inst.label || 'chain' }));
      var half = { x: 0, y: -mpl * L * b.site.g / 2 };
      function weigh() {
        if (j.broken) return;
        [A, B].forEach(function (e) { if (e.body.type === 'dynamic') e.body.applyForce(half, e.body.worldPoint(e.local)); });
      }
      weigh();
      b.on('step', weigh);
      return { joint: j, ratings: r, massPerLength: mpl, length: L };
    },
    plate: function (inst) {
      var r = chainRatings(inst.dials.size || '10 mm');
      return ['Grade 80 chain ' + inst.dials.size, 'WLL ' + fmtF(r.wll) + ' (' + fmtLb(r.wll) + ')', 'Breaks at ' + fmtF(r.breaking) + ' (' + fmtLb(r.breaking) + ')'];
    },
    readouts: function (built) {
      var j = built.joint;
      return [{ key: 'tension', label: 'tension', q: 'force', read: function () { return j.broken ? 0 : Math.max(0, j.tension()); } }];
    },
    draw: function (ctx, cam, built) {
      var j = built.joint;
      if (j.broken) return;
      var a = cam.worldToScreen(j.anchorA()), q = cam.worldToScreen(j.anchorB());
      var chord = Math.hypot(q.x - a.x, q.y - a.y), slack = Math.max(0, built.length * cam.zoom - chord);
      // a slack chain hangs about a parabola: sag d with s ≈ c + 8d²/(3c)
      var d = chord > 1 ? Math.sqrt(3 * chord * slack / 8) : slack / 2;
      var ctl = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 + 2 * d };
      function at(t) { var u = 1 - t; return { x: u * u * a.x + 2 * u * t * ctl.x + t * t * q.x, y: u * u * a.y + 2 * u * t * ctl.y + t * t * q.y }; }
      var px = Math.max(3, built.ratings.d * 2.2 * cam.zoom), linkPx = px * 2.6;
      var n = Math.max(2, Math.min(400, Math.round(Math.max(chord, built.length * cam.zoom) / linkPx)));
      ctx.save(); ctx.strokeStyle = '#8b939a'; ctx.lineWidth = Math.max(1.5, px / 3);
      for (var k = 0; k < n; k++) {
        var p0 = at(k / n), p1 = at((k + 1) / n), cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
        var ang = Math.atan2(p1.y - p0.y, p1.x - p0.x), hl = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.62;
        ctx.beginPath();
        // links alternate face-on (an oval) and edge-on (a bar)
        if (k % 2) ctx.ellipse(cx, cy, hl, px / 2, ang, 0, Math.PI * 2);
        else { ctx.moveTo(cx - Math.cos(ang) * hl, cy - Math.sin(ang) * hl); ctx.lineTo(cx + Math.cos(ang) * hl, cy + Math.sin(ang) * hl); }
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  /* -------------------------------------------------------------- spring */
  function massOf(body) { return body.type === 'dynamic' && body.m > 0 ? body.m : Infinity; }
  Y.definePart({
    type: 'spring', name: 'Spring', category: 'Rigging',
    blurb: 'A coil spring. It pushes back in proportion to how far you stretch or squash it: F = k × stretch.',
    size: { w: 0.2, h: 1 },
    connector: true,
    dials: [
      { key: 'k', label: 'Stiffness', q: 'stiffness', def: '2 kN/m', min: 1 },
      { key: 'rest', label: 'Rest length', q: 'length', def: '', optional: true, min: 0.01 },
      { key: 'rating', label: 'Breaks at', q: 'force', def: '', optional: true, min: 1 },
      { key: 'damping', label: 'Damping', choice: ['light', 'none'], def: 'light' }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      var span = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var def = { bodyA: A.body, localAnchorA: A.local, bodyB: B.body, localAnchorB: B.local,
        length: b.si('rest') != null ? b.si('rest') : span, stiffness: b.si('k'), label: b.inst.label || 'spring' };
      // light: a damping ratio of 0.05 on whatever hangs from it, so a bounce
      // dies away over a few dozen swings (the period changes by 0.1 %)
      var m = Math.min(massOf(A.body), massOf(B.body));
      def.damping = b.text('damping') === 'light' && isFinite(m) ? 2 * 0.05 * Math.sqrt(b.si('k') * m) : 0;
      if (b.si('rating') != null) def.breakForce = b.si('rating');
      return { joint: b.joint(new b.P.DistanceJoint(def)) };
    },
    plate: function (inst) { return ['k = ' + (inst.dials.k || '?')].concat(inst.dials.rating ? ['Breaks at ' + inst.dials.rating] : []); },
    readouts: function (built) {
      var j = built.joint;
      return [
        { key: 'force', label: 'force', q: 'force', read: function () { return j.broken ? 0 : j.stiffness * (j.currentLength() - j.length); } },
        { key: 'stretch', label: 'stretch', q: 'length', read: function () { return j.broken ? 0 : j.currentLength() - j.length; } }
      ];
    }
  });

  /* -------------------------------------------------------------- sheave */
  Y.definePart({
    type: 'sheave', name: 'Sheave', category: 'Rigging',
    blurb: 'A pulley wheel bolted in place. Set a winch or cable to run "over sheave" and its line turns here. It changes the direction of the pull, not its size.',
    size: { w: 0.4, h: 0.4 },
    dials: [{ key: 'size', label: 'Wheel diameter', q: 'length', def: '0.4 m', min: 0.05, max: 3 }],
    anchors: { rim: { x: 0, y: 0 } },
    build: function (b) {
      var r = b.si('size') / 2;
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'sheave', shapes: [{ shape: b.P.circle(r), material: 'steel' }] });
      return { body: body, anchors: { rim: { body: body, local: { x: 0, y: 0 } } }, sheave: { body: body, local: { x: 0, y: 0 }, r: r } };
    },
    draw: function (ctx, cam, built) { wheel(ctx, cam, built.body.c, built.sheave.r); }
  });

  /* ----------------------------------------------------------------- jib */
  // Origin at the foot of the mast. The boom runs out at the top; the tip
  // sheave hangs just under its end.
  Y.definePart({
    type: 'jib', name: 'Jib crane', category: 'Rigging',
    blurb: 'A fixed mast with a boom. Mount a winch drum at the base, run its line over the tip, and hang the load from the hook.',
    size: { w: 4.5, h: 6 },
    dials: [
      { key: 'height', label: 'Mast height', q: 'length', def: '6 m', min: 1, max: 60 },
      { key: 'reach', label: 'Reach', q: 'length', def: '4 m', min: 0.5, max: 60 },
      { key: 'facing', label: 'Boom points', choice: ['right', 'left'], def: 'right' }
    ],
    anchors: { tip: { x: 4, y: 5.65 }, base: { x: 0.4, y: 0.5 } },
    anchorsFor: function (inst, v) {
      var s = v.facing === 'left' ? -1 : 1;
      return { tip: { x: s * v.reach, y: v.height - 0.35 }, base: { x: s * 0.4, y: 0.5 } };
    },
    sizeFor: function (inst, v) { return { w: v.reach + 0.5, h: v.height }; },
    build: function (b) {
      var H = b.si('height'), R = b.si('reach'), s = b.text('facing') === 'left' ? -1 : 1;
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'jib', shapes: [
        { shape: b.P.box(0.15, H / 2, { x: 0, y: H / 2 }), material: 'steel' },
        { shape: b.P.box(R / 2 + 0.15, 0.12, { x: s * (R / 2), y: H - 0.12 }), material: 'steel' }
      ] });
      var tip = { x: s * R, y: H - 0.35 }, base = { x: s * 0.4, y: 0.5 };
      return { body: body, anchors: { tip: { body: body, local: tip }, base: { body: body, local: base } },
        sheave: { body: body, local: tip, r: 0.2 }, dims: { H: H, R: R, s: s } };
    },
    plate: function (inst) { return ['Mast ' + (inst.dials.height || '?') + ', reach ' + (inst.dials.reach || '?')]; },
    draw: function (ctx, cam, built) { wheel(ctx, cam, built.body.worldPoint(built.sheave.local), 0.2); }
  });

  /* -------------------------------------------------------- counterweight */
  Y.definePart({
    type: 'counterweight', name: 'Counterweight', category: 'Loads',
    blurb: 'A cast concrete block. Its mass is cast into the side, in kilograms or pounds (1 lb = 0.4536 kg).',
    size: { w: 0.9, h: 0.7 },
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '500 kg', min: 0.1, max: 1e6 },
      { key: 'cast', label: 'Cast in', choice: ['kg', 'lb'], def: 'kg' }
    ],
    anchors: { top: { x: 0, y: 0.35 }, left: { x: -0.45, y: 0 }, right: { x: 0.45, y: 0 }, bottom: { x: 0, y: -0.35 } },
    build: function (b) {
      return { body: b.body({ position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'counterweight',
        shapes: [{ shape: b.P.box(0.45, 0.35), material: 'concrete' }], mass: b.si('mass') }) };
    },
    plate: function (inst) {
      var r = D.parse(inst.dials.mass, 'mass');
      if (!r.ok) return ['?'];
      return [inst.dials.cast === 'lb' ? D.fmtNum(r.si / LBM, 3) + ' lb' : D.format(r.si, 'kg', 3, 'mass')];
    },
    readouts: function (built) { return [{ key: 'speed', label: 'vertical speed', q: 'speed', read: function () { return built.body.v.y; } }]; },
    draw: function (ctx, cam, built) {
      var line0 = Y.PARTS.counterweight.plate(built.inst)[0];
      var s = cam.worldToScreen(built.body.c);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-built.body.angle);
      ctx.font = 'bold ' + Math.max(9, Math.min(16, cam.zoom * 0.18)) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(30,28,25,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(line0, 0, 0); ctx.restore();
    }
  });

  /* ------------------------------------------- cable over a sheave (core) */
  // The core cable gains the same `route` dial: over a sheave it becomes a
  // single line with equal tension on both sides of the wheel.
  var cable = Y.PARTS.cable;
  if (cable && !cable.dials.some(function (d) { return d.key === 'route'; })) {
    cable.dials.push(ROUTE);
    var direct = cable.build;
    cable.build = function (b) {
      var A = b.end('a'), B = b.end('b');
      var s = routeFor(b, B.world);
      if (!s) return direct(b);
      var w = wrap(s, A.world, B.world);
      var j = b.joint(new b.P.PulleyJoint({ bodyA: A.body, localAnchorA: A.local, bodyB: B.body, localAnchorB: B.local,
        groundAnchorA: w.a, groundAnchorB: w.b, length: b.text('length') ? b.si('length') : undefined,
        breakForce: b.si('rating'), label: b.inst.label || 'cable' }));
      j.radius = 0.001;   // the debug renderer marks the leave points; the wheel is drawn below
      return { joint: j, over: s, lead: w };
    };
    var coreDraw = cable.draw;
    cable.draw = function (ctx, cam, built, view) {
      if (coreDraw) coreDraw(ctx, cam, built, view);
      if (!built.over || built.joint.broken) return;
      wheel(ctx, cam, built.over.world, built.over.r || 0.2);
      drawWrap(ctx, cam, built.over, built.lead, '#c9a86a');
    };
  }

  Y.rigging = { chainRatings: chainRatings, sheavesIn: sheavesIn, CHAIN_SIZES: CHAIN_SIZES, LB: LB };
})(globalThis.SE);
