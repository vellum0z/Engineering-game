/*
 * Yard parts: measure. The instruments a player reads the world with.
 * See docs/YARD.md for how parts are written.
 *
 *   springscale  a hanging spring balance (connector: a = hook above, b = load).
 *                F = k·x; the face is printed in N, kN, lb or kgf
 *   weight       a calibration mass stamped with its nominal: 1 kg … 20 kg,
 *                1 lb … 25 lb, 1 slug. m comes from the stamp, W = m·g from the site
 *   loadcell     a rigid inline link that reads the force through it (tension +)
 *   stopwatch    starts and stops on run / release / impact / a zone / a set time
 *   tape         a tape measure between two anchors or points
 *   pendulum     a bob on a string or rod; times its own swings (T = 2π√(L/g))
 *   balance      a beam balance on a pin with two pans; reads its tilt
 *   caliper      clips onto a part and reads its width (and a drilled hole) to 0.01 mm
 *
 * Every reading is SI. A face unit or plate only changes what is printed.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial, U = SE.units;
  var G0 = 9.81;              // standard g used for stamped weights (the game's g)
  var KGF = 9.80665;          // N per kilogram-force (conventional standard gravity)
  var LB = 4.448;             // N per lb (units.js)
  var SLUG = 14.59;           // kg per slug (units.js)
  var IDENT = { p: { x: 0, y: 0 }, q: { c: 1, s: 0 } };

  var MONO = '"IBM Plex Mono", monospace';
  function txt(ctx, s, x, y, size, color, align) {
    ctx.font = (size || 12) + 'px ' + MONO; ctx.fillStyle = color || '#e8e2d0';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
  }
  function panel(ctx, x, y, w, h, fill, stroke) {
    ctx.fillStyle = fill || 'rgba(20,24,28,.88)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke || 'rgba(232,226,208,.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  }
  function endsOf(built) { var j = built.joint; return j && j.anchorA ? [j.anchorA(), j.anchorB()] : null; }

  /* ------------------------------------------------------------ spring scale */
  var FACES = { N: { f: 1, sf: 3 }, kN: { f: 1000, sf: 3 }, lb: { f: LB, sf: 3 }, kgf: { f: KGF, sf: 3 } };
  function faceText(F, face) { var fc = FACES[face] || FACES.N; return D.fmtNum(F / fc.f, fc.sf) + ' ' + face; }

  Y.definePart({
    type: 'springscale', name: 'Spring scale', category: 'Measure',
    blurb: 'A hanging spring balance. Hook it above, hang the load below: the spring stretches until it pulls back as hard as the load hangs (F = k·x). The face is printed in the unit you pick.',
    size: { w: 0.16, h: 0.5 },
    connector: true,
    dials: [
      { key: 'k', label: 'Spring stiffness', q: 'stiffness', def: '5 kN/m', min: 1 },
      { key: 'face', label: 'Face', choice: ['N', 'kN', 'lb', 'kgf'], def: 'N' },
      { key: 'capacity', label: 'Capacity', q: 'force', def: '', optional: true, min: 0.01 }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b'), k = b.si('k');
      var L = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      // a dashpot so the needle settles: about half critical for the hung load
      var load = B.body.type === 'dynamic' ? B.body : A.body;
      var m = load.type === 'dynamic' ? load.m : 1;
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        length: L, stiffness: k, damping: 2 * 0.5 * Math.sqrt(k * m), minLength: 0,
        breakForce: b.si('capacity') != null ? b.si('capacity') : undefined, label: b.inst.label || 'spring scale' }));
      return { joint: j, gauge: new b.P.sensors.SpringScale(j), face: b.text('face'), k: k };
    },
    plate: function (inst) {
      return ['k = ' + inst.dials.k, 'Face in ' + inst.dials.face].concat(inst.dials.capacity ? ['Capacity ' + inst.dials.capacity] : []);
    },
    readouts: function (built) {
      return [
        { key: 'force', label: 'reading', q: 'force', read: function (w) { return built.joint.broken ? 0 : built.gauge.read(w); } },
        { key: 'stretch', label: 'stretch', q: 'length', read: function (w) { return built.joint.broken ? 0 : built.gauge.stretch(w); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var e = endsOf(built); if (!e || built.joint.broken) return;
      var a = cam.worldToScreen(e[0]), c = cam.worldToScreen(e[1]);
      var mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      var F = Math.max(0, built.gauge.read(built.joint.world || null));
      ctx.save();
      // round face with a needle: full scale is the capacity, or 2x the reading rounded up
      var R = 22;
      ctx.beginPath(); ctx.arc(mx, my, R, 0, 2 * Math.PI); ctx.fillStyle = '#f2ecd8'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#3a3a3a'; ctx.stroke();
      var fc = FACES[built.face] || FACES.N, full = built.joint.breakForce && isFinite(built.joint.breakForce) ? built.joint.breakForce : Math.max(10 * fc.f, niceCeil(2 * F / fc.f) * fc.f);
      var frac = Math.min(1, F / full), ang = -Math.PI * 0.75 + frac * Math.PI * 1.5;
      for (var i = 0; i <= 10; i++) {
        var t = -Math.PI * 0.75 + i / 10 * Math.PI * 1.5, r0 = i % 5 ? R - 4 : R - 7;
        ctx.beginPath(); ctx.moveTo(mx + Math.sin(t) * r0, my - Math.cos(t) * r0); ctx.lineTo(mx + Math.sin(t) * (R - 1), my - Math.cos(t) * (R - 1));
        ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.sin(ang) * (R - 5), my - Math.cos(ang) * (R - 5));
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.stroke();
      txt(ctx, built.face, mx, my + 10, 8, '#3a3a3a');
      panel(ctx, mx + R + 4, my - 9, 82, 18);
      txt(ctx, faceText(F, built.face), mx + R + 45, my, 11, '#ffe08a');
      ctx.restore();
    }
  });
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /* -------------------------------------------------------- calibration weight */
  var NOMINALS = ['1 kg', '2 kg', '5 kg', '10 kg', '20 kg', '1 lb', '5 lb', '10 lb', '25 lb', '1 slug'];
  // Mass of a stamped weight, kg. A pound weight weighs its stamp at standard g.
  function nominalMass(nom) {
    var m = /^([\d.]+)\s*(kg|lb|slug)$/.exec(nom || '');
    if (!m) return NaN;
    var n = Number(m[1]);
    return m[2] === 'kg' ? n : m[2] === 'lb' ? n * LB / G0 : n * SLUG;
  }
  var WW = 0.3, WH = 0.24;
  Y.definePart({
    type: 'weight', name: 'Calibration weight', category: 'Measure',
    blurb: 'A stamped test weight. Kilogram stamps are masses; a pound stamp weighs that many pounds at standard g; a slug is the mass 1 lb accelerates at 1 ft/s².',
    size: { w: WW, h: WH },
    dials: [{ key: 'nominal', label: 'Stamp', choice: NOMINALS, def: '10 kg' }],
    anchors: { top: { x: 0, y: WH / 2 + 0.04 } },
    build: function (b) {
      var m = nominalMass(b.text('nominal'));
      var body = b.body({ position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || b.text('nominal'), material: 'steel',
        shapes: [b.P.box(WW / 2, WH / 2, null, 0, 0.02), { shape: b.P.box(0.04, 0.03, { x: 0, y: WH / 2 + 0.01 }), material: 'steel' }], mass: m });
      return { body: body, mass: m, nominal: b.text('nominal') };
    },
    plate: function (inst) { var m = nominalMass(inst.dials.nominal); return ['Stamped ' + inst.dials.nominal].concat(/kg/.test(inst.dials.nominal) ? [] : ['Certified to the ' + (/slug/.test(inst.dials.nominal) ? 'FPS mass standard' : 'standard pound')]); },
    draw: function (ctx, cam, built) {
      var b = built.body, p = cam.worldToScreen(b.position);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-b.angle);
      txt(ctx, built.nominal, 0, 0, Math.max(8, Math.min(14, 0.09 * cam.zoom)), '#1d1d1d');
      ctx.restore();
    }
  });
  Y.weightMass = nominalMass;

  /* ---------------------------------------------------------------- load cell */
  Y.definePart({
    type: 'loadcell', name: 'Load cell', category: 'Measure',
    blurb: 'A short rigid link with a strain gauge inside. Put it in line with a rope or between two parts: it reads the force through it (pulling is +). Overload it past its rating and it fails.',
    size: { w: 0.12, h: 0.3 },
    connector: true,
    dials: [{ key: 'rating', label: 'Rated capacity', q: 'force', def: '10 kN', min: 0.01 }],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      var L = Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        length: L, breakForce: b.si('rating'), label: b.inst.label || 'load cell' }));
      return { joint: j, cell: new b.P.sensors.LoadCell(j) };
    },
    plate: function (inst) { return ['Capacity ' + inst.dials.rating]; },
    readouts: function (built) { return [{ key: 'force', label: 'force', q: 'force', read: function (w) { return built.joint.broken ? 0 : built.cell.read(w); } }]; },
    draw: function (ctx, cam, built) {
      var e = endsOf(built); if (!e || built.joint.broken) return;
      var a = cam.worldToScreen(e[0]), c = cam.worldToScreen(e[1]), mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      var F = built.cell.read(built.joint.world || null);
      ctx.save();
      panel(ctx, mx - 9, my - 13, 18, 26, '#9aa3ad', '#2b2f33');
      panel(ctx, mx + 13, my - 9, 76, 18);
      txt(ctx, D.format(F, D.autoUnit(F, 'force'), 4, 'force'), mx + 51, my, 11, '#8fe39a');
      ctx.restore();
    }
  });

  /* ---------------------------------------------------------------- stopwatch */
  // start: 'run' (t = 0), 'release' (a latch lets go, or with no latch when
  // anything first moves), 'zone' (a body's centre enters the zone).
  // stop: 'impact' (the first hit after it starts), 'zone' (a body enters the
  // stop zone; with start 'zone' too and one zone, when it leaves), 'time'
  // (after the set time). The ids dial names zone part ids, "start, stop";
  // empty uses the zones in the design in order. Ids of other parts there
  // limit 'impact' to hits on those parts. With none, a hit counts when a
  // free body (touching nothing and on no joint or rope: in flight) lands
  // faster than 0.5 m/s, so loads settling on a pan or swinging rigs don't
  // stop the clock.
  function zoneIds(b) {
    var typed = String(b.text('zone') || '').split(/[\s,]+/).filter(Boolean);
    var isZone = function (id) { return b.out.parts[id] && b.out.parts[id].def.type === 'zone'; };
    var zones = typed.filter(isZone), others = typed.filter(function (id) { return !isZone(id); });
    if (!zones.length) zones = (b.out.design.parts || []).filter(function (p) { return p.type === 'zone'; }).map(function (p) { return p.id; });
    return { zones: zones, watch: others };
  }
  function zoneBox(out, id) { var z = id && out.parts[id]; return z && z.box ? z.box : null; }
  function bodiesIn(world, box) {
    return world.bodies.filter(function (bd) { return bd.type === 'dynamic' && Y.inBox(bd.c, box); });
  }
  Y.definePart({
    type: 'stopwatch', name: 'Stopwatch', category: 'Measure', onePerDesign: true,
    blurb: 'A timer on a post with big digits. Pick what starts it and what stops it; it reads the time between, to the step.',
    size: { w: 0.5, h: 0.4 },
    dials: [
      { key: 'start', label: 'Starts on', choice: ['run', 'release', 'zone'], def: 'run' },
      { key: 'stop', label: 'Stops on', choice: ['impact', 'zone', 'time'], def: 'impact' },
      { key: 'zone', label: 'Zones / parts (ids)', text: true, def: '', optional: true },
      { key: 'limit', label: 'Stop after', q: 'time', def: '1 s', min: 0 }
    ],
    build: function (b) {
      var out = b.out, world = b.world, start = b.text('start'), stop = b.text('stop'), limit = b.si('limit');
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: '', shapes: [{ shape: b.P.box(0.25, 0.2), sensor: true }] });
      var ids = zoneIds(b), zs = ids.zones, startZone = zs[0], stopZone = zs.length > 1 && start === 'zone' ? zs[1] : zs[0];
      function counts(e) {
        if (ids.watch.length) return [e.a, e.b].some(function (bd) { return bd.userData && ids.watch.indexOf(bd.userData.part) >= 0; });
        var free = function (bd) { return bd.type === 'dynamic' && !touching.has(bd) && !held.has(bd); };
        return e.speed > 0.5 && (free(e.a) || free(e.b));
      }
      var touching = new Set(), held = new Set();
      function noteContacts() {
        touching = new Set(); held = new Set();
        world.joints.forEach(function (j) { if (!j.broken) { held.add(j.bodyA); held.add(j.bodyB); } });
        world.contacts.forEach(function (ct) { if (ct.points && ct.points.length) { touching.add(ct.fa.body); touching.add(ct.fb.body); } });
      }
      var w = { t0: null, t1: null, who: null, prevMoving: false };
      function begin() { if (w.t0 == null) w.t0 = world.time; }
      function end() { if (w.t0 != null && w.t1 == null) w.t1 = world.time; }
      if (start === 'run') begin();
      world.on('impact', function (e) { if (stop === 'impact' && w.t0 != null && world.time > w.t0 + 1e-9 && counts(e)) end(); });
      world.on('step', function () {
        noteContacts();
        if (w.t0 == null) {
          if (start === 'release') {
            var latches = out.readouts.filter(function (r) { return r.key === 'released' && out.parts[r.part] && out.parts[r.part].def.type === 'latch'; });
            if (latches.length ? latches.some(function (r) { return !!r.read(world); })
              : world.bodies.some(function (bd) { return bd.type === 'dynamic' && Math.hypot(bd.v.x, bd.v.y) > 0.02; })) begin();
          } else if (start === 'zone') {
            var zb = zoneBox(out, startZone), inside = zb ? bodiesIn(world, zb) : [];
            if (inside.length) { w.who = inside[0]; begin(); }
          }
        }
        if (w.t0 == null || w.t1 != null) return;
        if (stop === 'time' && world.time - w.t0 >= limit - 1e-9) end();
        else if (stop === 'zone') {
          var sb = zoneBox(out, stopZone);
          if (!sb) return;
          if (start === 'zone' && stopZone === startZone) { if (w.who && !Y.inBox(w.who.c, sb)) end(); }
          else if (bodiesIn(world, sb).length) end();
        }
      });
      var watch = {
        running: function () { return w.t0 != null && w.t1 == null; },
        stopped: function () { return w.t1 != null; },
        read: function () { return w.t0 == null ? 0 : (w.t1 != null ? w.t1 : world.time) - w.t0; }
      };
      return { body: body, watch: watch, startOn: start, stopOn: stop };
    },
    plate: function (inst) { return ['Start: ' + inst.dials.start, 'Stop: ' + inst.dials.stop + (inst.dials.stop === 'time' ? ' (' + inst.dials.limit + ')' : '')]; },
    readouts: function (built) { return [{ key: 't', label: 'time', q: 'time', read: function () { return built.watch.read(); } }]; },
    draw: function (ctx, cam, built) {
      var p = cam.worldToScreen(built.body.position), wv = built.watch;
      ctx.save();
      panel(ctx, p.x - 58, p.y - 22, 116, 44, '#101418', wv.stopped() ? '#ffe08a' : wv.running() ? '#8fe39a' : 'rgba(232,226,208,.6)');
      txt(ctx, wv.read().toFixed(2) + ' s', p.x, p.y + 1, 24, wv.stopped() ? '#ffe08a' : '#8fe39a');
      var t0 = built.body.world && built.body.world.time === 0;
      txt(ctx, wv.stopped() ? 'stopped' : t0 ? 'ready: starts on ' + built.startOn : wv.running() ? 'running' : 'waiting: ' + built.startOn, p.x, p.y + 30, 10, 'rgba(232,226,208,.85)');
      ctx.restore();
    }
  });

  /* --------------------------------------------------------------- tape measure */
  Y.definePart({
    type: 'tape', name: 'Tape measure', category: 'Measure',
    blurb: 'Hook one end on a point and pull the tape to another. It reads the straight distance between them, and follows parts that move.',
    size: { w: 0.1, h: 1 },
    connector: true,
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      var pa = { body: A.body, local: A.local }, pb = { body: B.body, local: B.local };
      var tape = new b.P.sensors.TapeMeasure(pa, pb);
      // a pseudo-joint so the yard can pick the tape by its line (nothing is added to the world)
      var line = { anchorA: function () { return A.body.worldPoint(A.local); }, anchorB: function () { return B.body.worldPoint(B.local); } };
      return { joint: line, bodies: [], joints: [], tape: tape };
    },
    readouts: function (built) {
      return [
        { key: 'length', label: 'length', q: 'length', read: function (w) { return built.tape.read(w); } },
        { key: 'dx', label: 'across', q: 'length', read: function (w) { return built.tape.vector(w).x; } },
        { key: 'dy', label: 'up', q: 'length', read: function (w) { return built.tape.vector(w).y; } }
      ];
    },
    draw: function (ctx, cam, built) {
      var A = built.joint.anchorA(), B = built.joint.anchorB(), L = Math.hypot(B.x - A.x, B.y - A.y);
      var a = cam.worldToScreen(A), c = cam.worldToScreen(B);
      ctx.save();
      ctx.strokeStyle = '#e8c547'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      if (L > 1e-6) {
        var ux = (B.x - A.x) / L, uy = (B.y - A.y) / L, nx = -uy, ny = ux;
        var step = cam.zoom * 0.1 < 6 ? 1 : 0.1, n = Math.min(400, Math.floor(L / step + 1e-9));
        ctx.strokeStyle = '#3a2f0a'; ctx.lineWidth = 1;
        for (var i = 0; i <= n; i++) {
          var d = i * step, big = Math.abs(d - Math.round(d)) < 1e-6, h = big ? 0.06 : 0.03;
          var p0 = cam.worldToScreen({ x: A.x + ux * d, y: A.y + uy * d }), p1 = cam.worldToScreen({ x: A.x + ux * d + nx * h, y: A.y + uy * d + ny * h });
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      }
      var mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
      panel(ctx, mx - 40, my - 26, 80, 18);
      txt(ctx, D.format(L, L < 1 ? 'mm' : 'm', 4, 'length'), mx, my - 17, 11, '#ffe08a');
      ctx.restore();
    }
  });

  /* ---------------------------------------------------------------- pendulum */
  // Swing timing: the bob passes straight down twice per period. Crossings are
  // interpolated within the step; the period readout is twice the average
  // time between crossings so far (0 until it has seen two).
  Y.definePart({
    type: 'pendulum', name: 'Pendulum', category: 'Measure',
    blurb: 'A bob on a light string (or rod) from a fixed pivot. Pull it aside, let go and it times its own swings. For small swings T = 2π√(L/g), so a pendulum and a tape tell you the local g.',
    size: { w: 0.3, h: 1.2 },
    dials: [
      { key: 'length', label: 'Length', q: 'length', def: '1 m', min: 0.05, max: 50 },
      { key: 'mass', label: 'Bob mass', q: 'mass', def: '1 kg', min: 0.01, max: 1e4 },
      { key: 'angle', label: 'Pulled back', q: 'angle', def: '10 deg' },
      { key: 'line', label: 'Hung on', choice: ['string', 'rod'], def: 'string' }
    ],
    anchors: { pivot: { x: 0, y: 0 } },
    build: function (b) {
      var L = b.si('length'), th = b.si('angle'), m = b.si('mass'), world = b.world;
      var piv = b.at({ x: 0, y: 0 });
      var r = Math.min(0.08, L * 0.15);
      var pivot = b.body({ type: 'static', position: piv, label: '', shapes: [{ shape: b.P.box(0.1, 0.04), material: 'steel' }] });
      var bob = b.body({ position: { x: piv.x + L * Math.sin(th), y: piv.y - L * Math.cos(th) }, label: b.inst.label || 'bob', material: 'steel',
        shapes: [{ shape: b.P.circle(r), material: 'steel' }], mass: m, allowSleep: false });
      var j = b.joint(new b.P.DistanceJoint({ bodyA: pivot, localAnchorA: { x: 0, y: 0 }, bodyB: bob, localAnchorB: { x: 0, y: 0 },
        length: L, rope: b.text('line') === 'string', label: 'pendulum ' + b.text('line') }));
      function phi() { return Math.atan2(bob.c.x - piv.x, -(bob.c.y - piv.y)); }
      var sw = { crossings: [], prev: phi(), prevT: 0 };
      world.on('step', function () {
        var f = phi(), t = world.time;
        if ((sw.prev < 0 && f >= 0) || (sw.prev > 0 && f <= 0)) sw.crossings.push(sw.prevT + (t - sw.prevT) * (-sw.prev) / (f - sw.prev));
        sw.prev = f; sw.prevT = t;
      });
      function period() { var c = sw.crossings; return c.length < 2 ? 0 : 2 * (c[c.length - 1] - c[0]) / (c.length - 1); }
      return { body: bob, bodies: [pivot, bob], joint: j, bob: bob, pivotAt: piv, angle: phi, period: period, swings: function () { return Math.floor(Math.max(0, sw.crossings.length - 1) / 2); },
        anchors: { pivot: { body: pivot, local: { x: 0, y: 0 } }, bob: { body: bob, local: { x: 0, y: 0 } } } };
    },
    plate: function (inst) { return ['L = ' + inst.dials.length + ', bob ' + inst.dials.mass]; },
    readouts: function (built) {
      return [
        { key: 'period', label: 'period', q: 'time', read: function () { return built.period(); } },
        { key: 'angle', label: 'angle', q: 'angle', read: function () { return built.angle(); } },
        { key: 'swings', label: 'swings', q: 'number', read: function () { return built.swings(); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var p = cam.worldToScreen(built.pivotAt), T = built.period();
      ctx.save();
      panel(ctx, p.x + 10, p.y - 30, 104, 20);
      txt(ctx, T ? 'T ' + T.toFixed(3) + ' s ×' + built.swings() : 'T —', p.x + 62, p.y - 20, 11, '#ffe08a');
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ balance */
  // Beam on a pin a little above its centre of mass, so it hangs level when
  // empty and tips toward the heavier pan until gravity on the beam balances
  // the difference. Pans hang on pins from the beam ends and stay level.
  var PAN_DROP = 0.5, PAN_HW = 0.18;
  Y.definePart({
    type: 'balance', name: 'Beam balance', category: 'Measure',
    blurb: 'A beam on a pin with a pan hanging from each end. Equal weights hang level; the heavier side goes down. It compares weights, so it reads the same on the Moon.',
    size: { w: 1.4, h: 1.4 },
    dials: [
      { key: 'arm', label: 'Arm length', q: 'length', def: '0.5 m', min: 0.25, max: 5 },
      { key: 'beam', label: 'Beam mass', q: 'mass', def: '2 kg', min: 0.1, max: 1000 }
    ],
    anchors: { left: { x: -0.5, y: 0.972 - PAN_DROP }, right: { x: 0.5, y: 0.972 - PAN_DROP }, pivot: { x: 0, y: 1 } },
    build: function (b) {
      var P = b.P, arm = b.si('arm'), H = 1;              // pivot 1 m above the part origin (its foot)
      var base = b.at({ x: 0, y: 0 }), piv = { x: base.x, y: base.y + H };
      var stand = b.body({ type: 'static', position: base, label: '', material: 'steel',
        shapes: [{ shape: P.box(0.25, 0.03, { x: 0, y: 0.03 }) }, { shape: P.box(0.025, (H - 0.1) / 2, { x: 0, y: (H - 0.1) / 2 + 0.06 }) }] });
      var drop = 0.04;                                      // beam centre of mass below the pin
      var beam = b.body({ position: { x: piv.x, y: piv.y - drop }, label: b.inst.label || 'beam', material: 'steel', allowSleep: false,
        shapes: [{ shape: P.box(arm, 0.02), filter: { group: -7071 } }], mass: b.si('beam') });
      var pin = b.joint(new P.RevoluteJoint({ bodyA: stand, bodyB: beam, worldAnchor: piv, enableLimit: true,
        lowerAngle: -0.3, upperAngle: 0.3, damping: 0.6 * b.si('beam') * arm, label: 'balance pin' }));
      function pan(side) {
        var top = { x: piv.x + side * arm, y: piv.y - drop };
        var body = b.body({ position: { x: top.x, y: top.y - PAN_DROP }, label: '', material: 'steel', allowSleep: false, angularDamping: 2,
          shapes: [{ shape: P.box(PAN_HW, 0.012), filter: { group: -7071 } }, { shape: P.box(0.01, 0.04, { x: -PAN_HW + 0.01, y: 0.05 }), filter: { group: -7071 } },
            { shape: P.box(0.01, 0.04, { x: PAN_HW - 0.01, y: 0.05 }), filter: { group: -7071 } }], mass: 0.4 });
        b.joint(new P.RevoluteJoint({ bodyA: beam, bodyB: body, worldAnchor: top, label: 'pan hanger' }));
        return { body: body, top: top };
      }
      var L = pan(-1), R = pan(1);
      return {
        body: beam, bodies: [stand, beam, L.body, R.body], beam: beam, pin: pin, pans: [L.body, R.body], arm: arm,
        tilt: function () { return -beam.angle; },
        anchors: {
          left: { body: L.body, local: { x: 0, y: 0.012 } }, right: { body: R.body, local: { x: 0, y: 0.012 } },
          pivot: { body: stand, local: stand.localPoint(piv) }
        }
      };
    },
    plate: function (inst) { return ['Arms ' + inst.dials.arm + ' each side']; },
    readouts: function (built) { return [{ key: 'tilt', label: 'tilt (+ right down)', q: 'angle', read: function () { return built.tilt(); } }]; },
    draw: function (ctx, cam, built) {
      ctx.save(); ctx.strokeStyle = 'rgba(232,226,208,.8)'; ctx.lineWidth = 1.2;
      built.pans.forEach(function (pb, i) {
        var top = cam.worldToScreen(built.beam.worldPoint({ x: (i ? 1 : -1) * built.arm, y: 0 }));
        [-PAN_HW + 0.02, PAN_HW - 0.02].forEach(function (x) {
          var q = cam.worldToScreen(pb.worldPoint({ x: x, y: 0 }));
          ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        });
      });
      var c = cam.worldToScreen(built.beam.worldPoint({ x: 0, y: 0.04 })), deg = built.tilt() * 180 / Math.PI;
      panel(ctx, c.x - 36, c.y - 34, 72, 18);
      txt(ctx, (deg >= 0 ? '+' : '') + deg.toFixed(1) + '°', c.x, c.y - 25, 11, Math.abs(deg) < 0.5 ? '#8fe39a' : '#ffe08a');
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ caliper */
  // Width = the part's extent along its own x axis, height along its y axis,
  // from the shapes themselves. A part that reports a drilled hole (a board
  // with `holeLocal` in its body frame, or a `hole` dial) also gets a hole
  // reading: centre of the hole from the part's left end.
  var RES = 1e-5;   // 0.01 mm
  function round(v) { return Math.round(v / RES) * RES; }
  function localBox(body) {
    var lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
    body.fixtures.forEach(function (f) {
      if (f.sensor) return;
      var bb = SE.phys.aabb(f.shape, IDENT);
      lo.x = Math.min(lo.x, bb.lo.x); lo.y = Math.min(lo.y, bb.lo.y); hi.x = Math.max(hi.x, bb.hi.x); hi.y = Math.max(hi.y, bb.hi.y);
    });
    return isFinite(lo.x) ? { lo: lo, hi: hi } : { lo: { x: 0, y: 0 }, hi: { x: 0, y: 0 } };
  }
  Y.definePart({
    type: 'caliper', name: 'Caliper', category: 'Measure',
    blurb: 'Clip the jaws over a part: it reads the part\'s width (along the part) and height to 0.01 mm, and where a drilled hole sits from the left end.',
    size: { w: 0.4, h: 0.2 },
    connector: true, attach: true,
    build: function (b) {
      var end = b.end('a'), body = end.body, target = b.out.parts[b.inst.a.part] || null;
      var box = localBox(body);
      var hole = null;
      if (target) {
        if (target.holeLocal) hole = target.holeLocal.x - box.lo.x;
        else if (target.values && target.values.hole != null) hole = target.values.hole;
      }
      return { target: body, box: box, hole: hole, bodies: [], joints: [] };
    },
    readouts: function (built) {
      var list = [
        { key: 'width', label: 'width', q: 'length', read: function () { return round(built.box.hi.x - built.box.lo.x); } },
        { key: 'height', label: 'height', q: 'length', read: function () { return round(built.box.hi.y - built.box.lo.y); } }
      ];
      if (built.hole != null) list.push({ key: 'hole', label: 'hole from left end', q: 'length', read: function () { return round(built.hole); } });
      return list;
    },
    draw: function (ctx, cam, built) {
      var b = built.target, bx = built.box;
      var p0 = cam.worldToScreen(b.worldPoint({ x: bx.lo.x, y: bx.hi.y })), p1 = cam.worldToScreen(b.worldPoint({ x: bx.hi.x, y: bx.hi.y }));
      var w = (bx.hi.x - bx.lo.x);
      ctx.save(); ctx.strokeStyle = '#c9d2db'; ctx.fillStyle = '#c9d2db'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y - 18); ctx.lineTo(p1.x, p1.y - 18); ctx.stroke();
      [p0, p1].forEach(function (p) { ctx.fillRect(p.x - 2, p.y - 20, 4, 22); });
      var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2 - 34;
      panel(ctx, mx - 52, my - 10, 104, 20, '#101418');
      txt(ctx, (round(w) * 1000).toFixed(2) + ' mm', mx, my, 12, '#8fe39a');
      if (built.hole != null) txt(ctx, 'hole ' + (round(built.hole) * 1000).toFixed(2) + ' mm', mx, my + 18, 10, '#ffe08a');
      ctx.restore();
    }
  });

  Y.MEASURE = { FACES: FACES, NOMINALS: NOMINALS, KGF: KGF };
})(globalThis.SE);
