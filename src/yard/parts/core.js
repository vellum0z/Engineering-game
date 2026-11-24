/*
 * Core yard parts: the few every job uses. Each one is also the reference
 * for writing new parts (see docs/YARD.md).
 *
 *   surface   a strip of ground made of a chosen material (ice, timber, ...)
 *   crate     a box load with a mass dial
 *   cart      a low-friction box on rollers with a mass dial
 *   hook      a fixed anchor point (bolted to the yard)
 *   push      a push/pull on a part: force, direction, how long
 *   cable     a rope between two anchors, with a rated breaking load
 *   speedo    a speed gauge clipped to a part
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial;
  var HALF_PI = Math.PI / 2;

  var SURFACES = ['ice', 'timber', 'steel', 'concrete', 'rubber', 'frictionless'];

  Y.definePart({
    type: 'surface', name: 'Ground strip', category: 'Site',
    blurb: 'A strip of yard surface. Its material sets the friction a sliding load feels.',
    size: { w: 10, h: 0.2 },
    dials: [
      { key: 'length', label: 'Length', q: 'length', def: '10 m', min: 0.5, max: 200 },
      { key: 'material', label: 'Material', choice: SURFACES, def: 'ice' }
    ],
    anchors: { left: { x: -5, y: 0.1 }, right: { x: 5, y: 0.1 } },
    build: function (b) {
      var L = b.si('length'), mat = b.text('material');
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || mat,
        shapes: [{ shape: b.P.box(L / 2, 0.1), material: mat }] });
      return { body: body, anchors: { left: { body: body, local: { x: -L / 2, y: 0.1 } }, right: { body: body, local: { x: L / 2, y: 0.1 } } } };
    },
    plate: function (inst) { var m = SE.phys.material(inst.dials.material || 'ice'); return [m.label || inst.dials.material, 'μs ' + (m.muS != null ? m.muS : m.friction) + '  μk ' + (m.muK != null ? m.muK : m.friction)]; }
  });

  function boxLoad(type, name, blurb, w, h, material, extra) {
    Y.definePart(Object.assign({
      type: type, name: name, category: 'Loads', blurb: blurb,
      size: { w: w, h: h },
      dials: [{ key: 'mass', label: 'Mass', q: 'mass', def: '120 kg', min: 0.01, max: 1e6 }],
      anchors: { top: { x: 0, y: h / 2 }, left: { x: -w / 2, y: 0 }, right: { x: w / 2, y: 0 }, bottom: { x: 0, y: -h / 2 } },
      build: function (b) {
        var body = b.body({ position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || name.toLowerCase(),
          shapes: [{ shape: b.P.box(w / 2, h / 2), material: material }], mass: b.si('mass'),
          velocity: b.inst.v ? { x: b.inst.v.x || 0, y: b.inst.v.y || 0 } : undefined });
        return { body: body };
      },
      readouts: function (built) {
        var body = built.body;
        return [
          { key: 'speed', label: 'speed', q: 'speed', read: function () { return body.v.x; } }
        ];
      }
    }, extra || {}));
  }
  boxLoad('crate', 'Crate', 'A box of salvage. You set its mass.', 1, 1, 'cargo');
  boxLoad('cart', 'Cart', 'A flat cart on greased rollers. Low friction, so it keeps going.', 1.6, 0.5, 'frictionless');

  Y.definePart({
    type: 'hook', name: 'Anchor hook', category: 'Site',
    blurb: 'A hook bolted to the yard. Cables tie off here.',
    size: { w: 0.3, h: 0.3 },
    anchors: { eye: { x: 0, y: 0 } },
    build: function (b) {
      var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: 'hook', shapes: [{ shape: b.P.circle(0.12), sensor: true }] });
      return { body: body, anchors: { eye: { body: body, local: { x: 0, y: 0 } } } };
    }
  });

  // A hand/ram push on a part's centre: force F in direction θ for t seconds.
  Y.definePart({
    type: 'push', name: 'Push', category: 'Forces',
    blurb: 'A steady push at the point where it is clipped on, for as long as you set. 0° pushes right, 90° pushes up.',
    size: { w: 0.8, h: 0.4 },
    attach: true,        // clips onto one part (inst.a = { part })
    dials: [
      { key: 'force', label: 'Force', q: 'force', def: '100 N', min: 0, max: 1e7 },
      { key: 'angle', label: 'Direction', q: 'angle', def: '0 deg' },
      { key: 'time', label: 'For', q: 'time', def: '2 s', min: 0, max: 600 },
      { key: 'start', label: 'Starting at', q: 'time', def: '0 s', min: 0, max: 600 }
    ],
    connector: true,
    build: function (b) {
      var end = b.end('a'), body = end.body;
      var F = b.si('force'), th = b.si('angle'), T = b.si('time'), t0 = b.si('start') || 0;
      var vec = { x: F * Math.cos(th), y: F * Math.sin(th) };
      var world = b.world, eps = 1e-9;
      // forces act for the next step: push during [t0, t0 + T)
      function active() { var t = world.time; return t >= t0 - eps && t < t0 + T - eps; }
      // acts at the clip point (an anchor or the clicked spot; the centre of mass for a bare { part })
      var local = end.local;
      function point() { return body.worldPoint(local); }
      function apply() { if (active() && body.type === 'dynamic') body.applyForce(vec, point()); }
      apply();
      b.on('step', apply);
      return { body: null, bodies: [], target: body, vector: vec, active: active, point: point };
    },
    draw: function (ctx, cam, built) {
      if (!built.target || !built.active()) return;
      var c = built.point(), F = built.vector, L = Math.hypot(F.x, F.y);
      if (!L) return;
      var s = cam.worldToScreen(c), ux = F.x / L, uy = -F.y / L, len = 46;
      ctx.save(); ctx.strokeStyle = '#ffb347'; ctx.fillStyle = '#ffb347'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.x - ux * (len + 14), s.y - uy * (len + 14)); ctx.lineTo(s.x - ux * 14, s.y - uy * 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - ux * 8, s.y - uy * 8);
      ctx.lineTo(s.x - ux * 18 - uy * 6, s.y - uy * 18 + ux * 6); ctx.lineTo(s.x - ux * 18 + uy * 6, s.y - uy * 18 - ux * 6); ctx.fill();
      ctx.restore();
    },
    readouts: function (built) { return [{ key: 'force', label: 'push', q: 'force', read: function () { return built.active() ? Math.hypot(built.vector.x, built.vector.y) : 0; } }]; }
  });

  // Rope between two anchors. Rated breaking load from a plate (any force unit).
  Y.definePart({
    type: 'cable', name: 'Cable', category: 'Rigging',
    blurb: 'A rope that pulls but never pushes. It snaps above its rated load.',
    size: { w: 0.1, h: 2 },
    connector: true,
    dials: [
      { key: 'rating', label: 'Breaking load', q: 'force', def: '5 kN', min: 1 },
      { key: 'length', label: 'Length', q: 'length', def: '', optional: true }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      var L = b.text('length') ? b.si('length') : Math.hypot(B.world.x - A.world.x, B.world.y - A.world.y);
      var j = b.joint(new b.P.DistanceJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        rope: true, length: L, breakForce: b.si('rating'), label: b.inst.label || 'cable' }));
      return { joint: j };
    },
    readouts: function (built) { return [{ key: 'tension', label: 'tension', q: 'force', read: function () { return built.joint.broken ? 0 : Math.max(0, built.joint.tension ? built.joint.tension() : built.joint.force()); } }]; },
    plate: function (inst) { return ['Breaks at ' + (inst.dials.rating || '?')]; }
  });
  // cable length is optional: empty means "as rigged"
  Y.PARTS.cable.dials[1].q = 'length';

  Y.definePart({
    type: 'speedo', name: 'Speed gauge', category: 'Measure',
    blurb: 'Clip it to a part to read its speed along the ground.',
    size: { w: 0.5, h: 0.5 },
    connector: true, attach: true, attachCentre: true,
    build: function (b) {
      var end = b.end('a');
      return { target: end.body, gauge: new b.P.sensors.Speedometer(end.body, { component: 'x' }) };
    },
    readouts: function (built) { return [{ key: 'v', label: 'speed', q: 'speed', read: function (w) { return built.gauge.read(w); } }]; }
  });

  // A fixed block: buffer stop, wall, dock edge. Static, so nothing moves it.
  Y.definePart({
    type: 'block', name: 'Buffer block', category: 'Site', library: false,
    blurb: 'A concrete block set in the ground. Anything that hits it stops hard.',
    size: { w: 0.6, h: 1.2 },
    dials: [{ key: 'width', label: 'Width', q: 'length', def: '0.6 m', min: 0.05 }, { key: 'height', label: 'Height', q: 'length', def: '1.2 m', min: 0.05 }],
    build: function (b) {
      var w = b.si('width'), h = b.si('height');
      return { body: b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), angle: b.inst.angle || 0, label: b.inst.label || 'buffer', shapes: [{ shape: b.P.box(w / 2, h / 2), material: 'concrete' }] }) };
    }
  });

  // A marked target area (a dock, a landing pad). A sensor: nothing hits it.
  Y.definePart({
    type: 'zone', name: 'Target zone', category: 'Site', library: false,
    blurb: 'A painted area. Jobs often ask for a load to end up here.',
    size: { w: 3, h: 1.5 },
    dials: [{ key: 'width', label: 'Width', q: 'length', def: '3 m', min: 0.1 }, { key: 'height', label: 'Height', q: 'length', def: '1.5 m', min: 0.1 }],
    build: function (b) {
      var w = b.si('width'), h = b.si('height'), c = b.at({ x: 0, y: 0 });
      var body = b.body({ type: 'static', position: c, label: '', shapes: [{ shape: b.P.box(w / 2, h / 2), sensor: true }] });
      return { body: body, box: { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 } };
    },
    draw: function (ctx, cam, built) {
      var bx = built.box, a = cam.worldToScreen({ x: bx.x0, y: bx.y1 }), w = (bx.x1 - bx.x0) * cam.zoom, h = (bx.y1 - bx.y0) * cam.zoom;
      ctx.save(); ctx.fillStyle = 'rgba(79,138,46,.18)'; ctx.fillRect(a.x, a.y, w, h);
      ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(120,190,80,.9)'; ctx.lineWidth = 2; ctx.strokeRect(a.x, a.y, w, h);
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(160,220,120,.95)'; ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillText(built.inst.label || 'target', a.x + 4, a.y + 14); ctx.restore();
    }
  });

  Y.SURFACES = SURFACES;
})(globalThis.SE);
