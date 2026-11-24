/*
 * Yard parts: the site and simple mechanisms. See docs/YARD.md for how
 * parts are written.
 *
 *   site     sets the world's gravity from where the yard is: body, altitude, latitude
 *   gate     a panel hinged on a pin at its left end
 *   ram      hydraulic ram between two anchors, pinned at both ends
 *   tank     pressure tank; a ram whose end a is on the tank's `port` anchor
 *            is driven by it and pushes with p·πd²/4 (its own force dial is ignored)
 *   latch    holds a part where it is until a set time, then lets go
 *   sled     a box load on runners of a chosen material
 *   board    a timber board cut to length, with an optional bolt hole
 *   post     a fence post set in the ground
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial;
  var DEG = Math.PI / 180;

  // ------------------------------------------------------------------ site
  //
  // Constants are the course values in SE.physics.gravity (H5, P1 and P5 use
  // the same ones): G = 66.73e-12 m^3/(kg s^2) and the mean radius and mass
  // of each body. Earth at 0 m and 0 deg gives 9.81 m/s^2.
  //
  // Model: g = G·M / r^2 with r = R + altitude (a sphere). On Earth the
  // latitude dial scales that by the international gravity formula's ratio
  // g(φ)/g(0), which carries the spin and the flattening: about +0.5 % at
  // the poles. Moon and Mars ignore latitude.
  var BODY_CHOICES = ['Earth', 'Moon', 'Mars'];
  function gravityConsts() {
    var GR = SE.physics && SE.physics.gravity;
    if (GR) return GR;
    // fallback if the scenes are not loaded (same numbers as scenes/gravity.js)
    return {
      G: 66.73e-12,
      BODIES: { earth: { M: 5.9722e24, R: 6.371e6 }, moon: { M: 7.342e22, R: 1.7374e6 }, mars: { M: 6.4171e23, R: 3.3895e6 } },
      gLatitude: function (phi) { var s = Math.sin(phi * DEG), s2 = Math.sin(2 * phi * DEG); return 9.780327 * (1 + 0.0053024 * s * s - 0.0000058 * s2 * s2); }
    };
  }
  function siteG(bodyName, altitude, latitudeRad) {
    var GR = gravityConsts(), key = String(bodyName || 'Earth').toLowerCase();
    var B = GR.BODIES[key] || GR.BODIES.earth, r = B.R + (altitude || 0);
    var g = GR.G * B.M / (r * r);
    if (key === 'earth' && latitudeRad) g *= GR.gLatitude(latitudeRad / DEG) / GR.gLatitude(0);
    return g;
  }

  Y.definePart({
    type: 'site', name: 'Site marker', category: 'Site', onePerDesign: true,
    blurb: 'Where the yard is. Sets gravity as g = G·M/r², with r the body\'s radius plus the altitude. On Earth the latitude adds the spin and flattening correction (up to +0.5 % at the poles).',
    size: { w: 0.8, h: 1.4 },
    dials: [
      { key: 'body', label: 'Body', choice: BODY_CHOICES, def: 'Earth' },
      { key: 'altitude', label: 'Altitude', q: 'length', def: '0 m', min: -1e4, max: 1e9 },
      { key: 'latitude', label: 'Latitude', q: 'angle', def: '0 deg', min: -HALF(), max: HALF() }
    ],
    build: function (b) {
      var g = siteG(b.si('body'), b.si('altitude'), b.si('latitude'));
      b.world.gravity = { x: 0, y: -g };
      b.site.g = g;
      return { body: null, bodies: [], g: g, at: b.at({ x: 0, y: 0 }) };
    },
    plate: function (inst) { return [inst.dials.body || 'Earth', 'Alt ' + (inst.dials.altitude || '0 m'), 'Lat ' + (inst.dials.latitude || '0 deg')]; },
    readouts: function (built) { return [{ key: 'g', label: 'g', q: 'accel', read: function () { return built.g; } }]; },
    draw: function (ctx, cam, built) {
      var s = cam.worldToScreen(built.at), z = cam.zoom;
      ctx.save();
      ctx.strokeStyle = '#8a857c'; ctx.lineWidth = Math.max(2, 0.06 * z);
      ctx.beginPath(); ctx.moveTo(s.x, s.y + 0.7 * z); ctx.lineTo(s.x, s.y - 0.2 * z); ctx.stroke();
      ctx.fillStyle = '#2d3a2a'; ctx.strokeStyle = '#a7c48a'; ctx.lineWidth = 1.5;
      var w = Math.max(70, 1.4 * z), h = Math.max(30, 0.5 * z);
      ctx.fillRect(s.x - w / 2, s.y - 0.2 * z - h, w, h); ctx.strokeRect(s.x - w / 2, s.y - 0.2 * z - h, w, h);
      ctx.fillStyle = '#dfe9cf'; ctx.font = '12px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
      ctx.fillText((built.inst.dials.body || 'Earth').toUpperCase(), s.x, s.y - 0.2 * z - h + 13);
      ctx.fillText('g ' + D.fmtNum(built.g, 4), s.x, s.y - 0.2 * z - 5);
      ctx.restore();
    }
  });
  function HALF() { return Math.PI / 2; }

  // ------------------------------------------------------------------ gate
  //
  // The pin is at the instance x,y. The panel runs from the pin along the
  // instance angle for `width`. Anchors a0, a1, ... sit every 0.5 m from the
  // pin (a0 is on the pin), plus `end` at the free end. The part's own
  // anchor table lists them for the default 3 m gate; a built gate has them
  // for its real width.
  var GATE_T = 0.12;          // panel thickness, m
  function gateAnchorTable(width) {
    var t = {}, n = Math.floor(width / 0.5 + 1e-9);
    for (var i = 0; i <= n; i++) t['a' + i] = { x: 0.5 * i, y: 0 };
    t.end = { x: width, y: 0 };
    return t;
  }
  Y.definePart({
    type: 'gate', name: 'Gate', category: 'Mechanisms',
    blurb: 'A panel hinged on a pin at its left end. Push it anywhere along its length: the farther from the pin, the easier it turns.',
    size: { w: 3, h: 0.3 },
    dials: [
      { key: 'width', label: 'Width', q: 'length', def: '3 m', min: 0.5, max: 20 },
      { key: 'mass', label: 'Mass', q: 'mass', def: '120 kg', min: 0.1, max: 1e5 },
      { key: 'friction', label: 'Hinge friction', q: 'moment', def: '', optional: true, min: 0 },
      { key: 'rating', label: 'Pin rating', q: 'force', def: '', optional: true, min: 1 }
    ],
    anchors: gateAnchorTable(3),
    build: function (b) {
      var W = b.si('width'), ang = b.inst.angle || 0, pin = b.at({ x: 0, y: 0 });
      var c = b.at({ x: W / 2, y: 0 });
      var body = b.body({ position: c, angle: ang, label: b.inst.label || 'gate',
        shapes: [{ shape: b.P.box(W / 2, GATE_T / 2), material: 'timber' }], mass: b.si('mass') });
      // collideConnected: the panel still lands on the yard floor it is pinned to
      var jd = { bodyA: b.ground, bodyB: body, worldAnchor: pin, collideConnected: true, label: (b.inst.label || 'gate') + ' pin' };
      var fr = b.si('friction');
      if (fr) { jd.enableMotor = true; jd.motorSpeed = 0; jd.maxMotorTorque = fr; }
      if (b.si('rating')) jd.breakForce = b.si('rating');
      var pinJ = b.joint(new b.P.RevoluteJoint(jd));
      var anchors = {}, tab = gateAnchorTable(W);
      Object.keys(tab).forEach(function (k) { anchors[k] = { body: body, local: { x: tab[k].x - W / 2, y: 0 } }; });
      return { body: body, pin: pinJ, anchors: anchors, width: W };
    },
    plate: function (inst) { var l = [inst.dials.width + ' · ' + inst.dials.mass]; if (inst.dials.rating) l.push('Pin rated ' + inst.dials.rating); return l; },
    readouts: function (built) {
      return [
        { key: 'angle', label: 'angle', q: 'angle', read: function () { return built.pin.broken ? NaN : built.pin.angle(); } },
        { key: 'pinForce', label: 'pin force', q: 'force', read: function () { return built.pin.broken ? 0 : built.pin.force(); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var pin = built.body.worldPoint(built.anchors.a0.local), s = cam.worldToScreen(pin), r = Math.max(4, 0.09 * cam.zoom);
      ctx.save(); ctx.fillStyle = '#d8d2c4'; ctx.strokeStyle = '#3a352e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  });

  // ------------------------------------------------------------------ tank
  var TANK_W = 0.7, TANK_H = 1.0;
  function pistonForce(p, bore) { return p * Math.PI * bore * bore / 4; }
  Y.definePart({
    type: 'tank', name: 'Pressure tank', category: 'Mechanisms',
    blurb: 'A charged hydraulic tank. Mount a ram on its port and the ram pushes with F = p·πd²/4, where d is the piston bore.',
    size: { w: TANK_W, h: TANK_H },
    dials: [
      { key: 'pressure', label: 'Pressure', q: 'pressure', def: '2 MPa', min: 0, max: 1e9 },
      { key: 'bore', label: 'Piston bore', q: 'length', def: '50 mm', min: 1e-3, max: 2 }
    ],
    anchors: { port: { x: 0, y: TANK_H / 2 }, side: { x: TANK_W / 2, y: 0 } },
    build: function (b) {
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'tank',
        shapes: [{ shape: b.P.box(TANK_W / 2, TANK_H / 2), material: 'steel' }] });
      return { body: body, force: pistonForce(b.si('pressure'), b.si('bore')), pressure: b.si('pressure'), bore: b.si('bore') };
    },
    plate: function (inst) { return ['Charged to ' + inst.dials.pressure, 'Bore ' + inst.dials.bore]; },
    readouts: function (built) {
      return [
        { key: 'pressure', label: 'pressure', q: 'pressure', read: function () { return built.pressure; } },
        { key: 'force', label: 'piston force', q: 'force', read: function () { return built.force; } }
      ];
    }
  });

  // ------------------------------------------------------------------ ram
  //
  // A pin-ended ram is a two-force member: it pushes along the line between
  // its two pins and never stops the parts it joins from turning. So the
  // ram is a force pair along the current line a -> b, applied at the two
  // anchors (positive pushes b away from a), plus a DistanceJoint between
  // the same anchors that only acts at the ends of travel: the as-built
  // length is the closed ram, and it can extend by `stroke` and no more.
  // When end a sits on a tank's port, the tank sets the force (p·πd²/4) and
  // the ram's own force dial is ignored. `retract` lets a load push the rod
  // back in below the as-built length by up to that much (default 0: it
  // stops there like a strut).
  function tankFor(b) {
    var ref = b.inst.a;
    if (!ref || !ref.part || ref.part === 'ground') return null;
    var p = b.out.parts[ref.part];
    return p && p.def && p.def.type === 'tank' ? p : null;
  }
  Y.definePart({
    type: 'ram', name: 'Hydraulic ram', category: 'Mechanisms',
    blurb: 'A pin-ended ram between two anchors. It pushes the second end away from the first with the force you set, until it runs out of stroke.',
    size: { w: 0.2, h: 1.2 },
    connector: true,
    dials: [
      { key: 'force', label: 'Force', q: 'force', def: '1 kN', min: -1e8, max: 1e8 },
      { key: 'stroke', label: 'Stroke', q: 'length', def: '1 m', min: 0.01, max: 20 },
      { key: 'start', label: 'Starting at', q: 'time', def: '0 s', min: 0, max: 600 },
      { key: 'retract', label: 'Can retract', q: 'length', def: '', optional: true, min: 0, max: 20 }
    ],
    build: function (b) {
      var P = b.P, A = b.end('a'), B = b.end('b');
      var L0 = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      if (L0 < 0.05) throw new Error('the ram needs its two ends apart');
      var tank = tankFor(b), F = tank ? tank.force : b.si('force'), t0 = b.si('start') || 0, world = b.world, eps = 1e-9;
      var stop = b.joint(new P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        length: L0, minLength: Math.max(0.05, L0 - (b.si('retract') || 0)), maxLength: L0 + b.si('stroke'), collideConnected: true, label: b.inst.label || 'ram' }));
      function ends() { return { pa: A.body.worldPoint(A.local), pb: B.body.worldPoint(B.local) }; }
      function active() { return world.time >= t0 - eps && !stop.broken; }
      // forces act for the next step, like a push
      function apply() {
        if (!active() || !F) return;
        var e = ends(), dx = e.pb.x - e.pa.x, dy = e.pb.y - e.pa.y, L = Math.hypot(dx, dy);
        if (L < 1e-9) return;
        var fx = F * dx / L, fy = F * dy / L;
        if (B.body.type === 'dynamic') B.body.applyForce({ x: fx, y: fy }, e.pb);
        if (A.body.type === 'dynamic') A.body.applyForce({ x: -fx, y: -fy }, e.pa);
      }
      apply();
      b.on('step', apply);
      var built = { body: null, bodies: [], stop: stop, setForce: F, tank: tank, closed: L0, active: active, ends: ends };
      built.length = function () { var e = ends(); return Math.hypot(e.pb.x - e.pa.x, e.pb.y - e.pa.y); };
      // force the rod carries, + pushing: the set force less what the end stops take
      built.force = function () { return (active() ? F : 0) - (stop.broken ? 0 : stop.tension()); };
      return built;
    },
    plate: function (inst) {
      return [inst.a && inst.a.anchor === 'port' ? 'Driven by tank' : 'Push ' + inst.dials.force, 'Stroke ' + inst.dials.stroke];
    },
    readouts: function (built) {
      return [
        { key: 'force', label: 'force', q: 'force', read: function () { return built.force(); } },
        { key: 'extension', label: 'extension', q: 'length', read: function () { return built.length() - built.closed; } }
      ];
    },
    draw: function (ctx, cam, built) {
      var e = built.ends(), sa = cam.worldToScreen(e.pa), sb = cam.worldToScreen(e.pb);
      var L = Math.hypot(sb.x - sa.x, sb.y - sa.y); if (L < 1) return;
      var ux = (sb.x - sa.x) / L, uy = (sb.y - sa.y) / L;
      var barrel = Math.max(6, Math.min(L, built.closed * cam.zoom * 0.85)), w = Math.max(5, 0.08 * cam.zoom);
      ctx.save(); ctx.lineCap = 'round';
      ctx.strokeStyle = '#c9c4ba'; ctx.lineWidth = w * 0.45;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.strokeStyle = '#b5483a'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sa.x + ux * barrel, sa.y + uy * barrel); ctx.stroke();
      ctx.fillStyle = '#2b2722';
      [sa, sb].forEach(function (p) { ctx.beginPath(); ctx.arc(p.x, p.y, w * 0.4, 0, 2 * Math.PI); ctx.fill(); });
      ctx.restore();
    }
  });


  // ----------------------------------------------------------------- latch
  Y.definePart({
    type: 'latch', name: 'Latch', category: 'Mechanisms',
    blurb: 'Clip it to a part to hold it exactly where it is. At the release time it lets go and the physics takes over.',
    size: { w: 0.4, h: 0.4 },
    connector: true, attach: true,
    dials: [
      { key: 'release', label: 'Release at', q: 'time', def: '1 s', min: 0, max: 600 },
      { key: 'rating', label: 'Holding force', q: 'force', def: '', optional: true, min: 1 }
    ],
    build: function (b) {
      var end = b.end('a'), body = end.body, world = b.world, T = b.si('release');
      var built = { body: null, bodies: [], target: body, released: false, joint: null };
      if (body === b.ground || body.type !== 'dynamic') { built.released = true; return built; }
      if (T <= 0) { built.released = true; return built; }
      var jd = { bodyA: b.ground, bodyB: body, worldAnchor: body.worldPoint(body.localCenter || { x: 0, y: 0 }), label: 'latch' };
      if (b.si('rating')) jd.breakForce = b.si('rating');
      var j = built.joint = b.joint(new b.P.WeldJoint(jd));
      b.on('step', function () {
        if (built.released) return;
        if (j.broken) { built.released = true; return; }
        // the weld holds through the step that ends at T, then is gone
        if (world.time >= T - 1e-9) { world.removeJoint(j); built.released = true; body.wake && body.wake(); }
      });
      return built;
    },
    plate: function (inst) { return ['Lets go at ' + inst.dials.release]; },
    readouts: function (built) {
      var r = [{ key: 'released', label: 'released', q: 'number', read: function () { return built.released ? 1 : 0; } }];
      if (built.joint) r.push({ key: 'force', label: 'holding force', q: 'force', read: function () { return built.released ? 0 : built.joint.force(); } });
      return r;
    },
    draw: function (ctx, cam, built) {
      if (built.released) return;
      var s = cam.worldToScreen(built.target.c), r = Math.max(7, 0.14 * cam.zoom);
      ctx.save(); ctx.strokeStyle = '#e0b040'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.stroke();
      ctx.restore();
    }
  });

  // ------------------------------------------------------------------ sled
  var RUNNERS = ['steel', 'timber', 'rubber'];
  var SLED_W = 1.4, SLED_H = 0.6, RUNNER_H = 0.08;
  Y.definePart({
    type: 'sled', name: 'Sled', category: 'Loads',
    blurb: 'A load box on runners. The runner material and the ground under it set the friction.',
    size: { w: SLED_W, h: SLED_H },
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '80 kg', min: 0.1, max: 1e6 },
      { key: 'runner', label: 'Runners', choice: RUNNERS, def: 'steel' }
    ],
    anchors: { top: { x: 0, y: SLED_H / 2 }, left: { x: -SLED_W / 2, y: 0 }, right: { x: SLED_W / 2, y: 0 }, bottom: { x: 0, y: -SLED_H / 2 } },
    build: function (b) {
      var P = b.P, hw = SLED_W / 2, hh = SLED_H / 2, boxH = (SLED_H - RUNNER_H) / 2;
      var body = b.body({ position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'sled', mass: b.si('mass'),
        velocity: b.inst.v ? { x: b.inst.v.x || 0, y: b.inst.v.y || 0 } : undefined,
        shapes: [
          { shape: P.box(hw - 0.05, boxH, { x: 0, y: hh - boxH }), material: 'timber' },
          { shape: P.box(hw, RUNNER_H / 2, { x: 0, y: -hh + RUNNER_H / 2 }), material: b.si('runner') }
        ] });
      return { body: body };
    },
    plate: function (inst) { return [inst.dials.mass, inst.dials.runner + ' runners']; },
    readouts: function (built) { return [{ key: 'speed', label: 'speed', q: 'speed', read: function () { return built.body.v.x; } }]; }
  });

  // ----------------------------------------------------------------- board
  //
  // Centred on x,y. `length` is the cut; `width` is the drawn depth of the
  // board; the board is 50 mm thick into the page, timber at 550 kg/m^3.
  // Anchors left, right, mid, and hole when a hole is drilled. built.hole
  // is the hole's distance from the left end (m), for the caliper.
  var BOARD_THICK = 0.05;
  Y.definePart({
    type: 'board', name: 'Timber board', category: 'Build',
    blurb: 'A timber board you cut to length, with an optional bolt hole measured from the left end.',
    size: { w: 2, h: 0.15 },
    dials: [
      { key: 'length', label: 'Cut length', q: 'length', def: '2 m', min: 0.02, max: 12 },
      { key: 'width', label: 'Width', q: 'length', def: '150 mm', min: 0.01, max: 1 },
      { key: 'hole', label: 'Hole from left end', q: 'length', def: '', optional: true, min: 0 },
      { key: 'fixed', label: 'Fixed', choice: ['no', 'yes'], def: 'no' }
    ],
    anchors: { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, mid: { x: 0, y: 0 } },
    build: function (b) {
      var L = b.si('length'), w = b.si('width'), hole = b.si('hole');
      if (hole != null && hole > L) throw new Error('the hole is past the end of the board');
      var mat = SE.phys.material('timber');
      var body = b.body({ type: b.si('fixed') === 'yes' ? 'static' : 'dynamic', position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0,
        label: b.inst.label || 'board', shapes: [{ shape: b.P.box(L / 2, w / 2), material: 'timber' }],
        mass: b.si('fixed') === 'yes' ? undefined : mat.density * L * w * BOARD_THICK });
      var anchors = { left: { body: body, local: { x: -L / 2, y: 0 } }, right: { body: body, local: { x: L / 2, y: 0 } }, mid: { body: body, local: { x: 0, y: 0 } } };
      if (hole != null) anchors.hole = { body: body, local: { x: -L / 2 + hole, y: 0 } };
      return { body: body, anchors: anchors, length: L, width: w, hole: hole };
    },
    plate: function (inst) { var l = ['Cut ' + inst.dials.length]; if (inst.dials.hole) l.push('Hole at ' + inst.dials.hole); return l; },
    draw: function (ctx, cam, built) {
      if (built.hole == null) return;
      var p = built.body.worldPoint(built.anchors.hole.local), s = cam.worldToScreen(p), r = Math.max(2.5, Math.min(built.width * 0.25, 0.02) * cam.zoom);
      ctx.save(); ctx.fillStyle = '#1d1a16'; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
    }
  });

  // ------------------------------------------------------------------ post
  var POST_W = 0.15, POST_H = 1.2;
  Y.definePart({
    type: 'post', name: 'Fence post', category: 'Site',
    blurb: 'A post set in the ground. Tie off to its top or middle.',
    size: { w: POST_W, h: POST_H },
    anchors: { top: { x: 0, y: POST_H / 2 }, mid: { x: 0, y: 0 } },
    build: function (b) {
      return { body: b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'post',
        shapes: [{ shape: b.P.box(POST_W / 2, POST_H / 2), material: 'timber' }] }) };
    }
  });

  Y.site = { g: siteG, pistonForce: pistonForce, BODIES: BODY_CHOICES, RUNNERS: RUNNERS };
})(globalThis.SE);
