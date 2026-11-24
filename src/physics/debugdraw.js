/*
 * Debug renderer: draws what the physics engine is doing, on a 2D canvas.
 *
 *   var cam = new SE.phys.Camera({ center: {x: 0, y: 2}, zoom: 60, canvas: el });
 *   cam.resize();                                   // sync the backing store to CSS size × devicePixelRatio
 *   SE.phys.debugDraw(ctx, world, cam, { contacts: true, forces: true, forceUnit: 'kN' });
 *   SE.phys.debugDrawFreeBody(ctx, forces, cam, { maxLength: 90 });
 *
 * Camera
 *   World space is SI metres with y up; screen space is CSS pixels with y
 *   down. zoom is pixels per metre. The camera keeps the world point `center`
 *   in the middle of the view:
 *     sx = W/2 + (x - cx)·zoom        sy = H/2 - (y - cy)·zoom
 *   apply(ctx) sets the canvas transform to devicePixelRatio so everything is
 *   drawn in CSS pixels and stays sharp on high-density screens. All drawing
 *   here happens in screen space (points are transformed one by one), so line
 *   widths and labels keep the same size at every zoom.
 *
 * debugDraw options (all optional):
 *   clear     true      fill the background first
 *   grid      true      1 m blueprint grid with labelled axes
 *   shapes    true      fixtures, filled by material colour; sleeping bodies dimmed
 *   angles    true      a tick from the centre of mass along the body's x axis
 *   joints    true      ropes, rods, springs, pins, welds, sliders, pulleys, winches
 *   stress    true      colour joints by lastForce / breakForce (green → amber → red)
 *   contacts  false     contact points and normals
 *   aabbs     false     bounding boxes
 *   forces    false     joint reaction arrows (force on body B) with magnitude labels
 *   contactForces false contact force arrows (normal + friction) per point
 *   weights   false     weight arrows m·g at each centre of mass
 *   forceUnit 'N'       unit for labels; any unit SE.units can convert N to
 *   forceScale          px per N; omit for an automatic scale that eases toward
 *                       the largest force on screen
 *   breaks    true      flash + fragments for 'break' events
 *   labels    false     body.label above each labelled body
 *   highlight           a body to outline (selected or dragged)
 *   dt        1/60      step size, to turn contact impulses into forces
 *
 * The renderer subscribes to a world's 'break' events the first time it draws
 * that world (or when P.debugDraw.track(world) is called), so a snapped cable flashes even though the joint is gone. The
 * flash runs on world.time: pausing the sim freezes it for inspection.
 *
 * This file only touches the canvas when its functions are called, so it
 * loads headless in the Node test runner.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  /* ------------------------------------------------------------ palette */
  // Same inks as src/engine/draw.js, repeated so the renderer works without it.
  var C = {
    night: '#14110f', soot: '#1d1916', iron: '#2b2622', iron2: '#3a332d', steel: '#6f6b64', steelHi: '#a7a29a',
    rust: '#b4532a', rustDark: '#7a3418', rustHi: '#d9824f', paper: '#ece2c6', paperDim: '#d6c9a6',
    hazard: '#e6b422', good: '#8fcf6a', bad: '#e2553f', force: '#ffb347', accel: '#6ad0ff',
    weight: '#ff6b6b', blueInk: '#8fb8e8', blueGrid: 'rgba(143,184,232,0.16)', wood: '#8a5a33', woodDark: '#5e3a1e'
  };
  var MATERIAL_FILL = {
    steel: '#6f6b64', timber: '#8a5a33', concrete: '#86807a', rubber: '#34302d', ice: '#a9d4e6',
    rope: '#c9a86a', aluminium: '#aeb3b7', cargo: '#b4532a', frictionless: '#8fb8e8'
  };
  var FONT = '600 12px "IBM Plex Mono", ui-monospace, monospace';
  var FONT_SMALL = '600 11px "IBM Plex Mono", ui-monospace, monospace';

  /* ------------------------------------------------------------- camera */
  function Camera(def) {
    def = def || {};
    this.center = def.center ? M.v(def.center.x, def.center.y) : M.v(0, 0);
    this.zoom = def.zoom || 50;                       // px per metre
    this.minZoom = def.minZoom || 2;
    this.maxZoom = def.maxZoom || 2000;
    this.canvas = def.canvas || null;
    this.dpr = def.dpr || 0;                          // 0 = read devicePixelRatio when needed
    this._w = def.width || 0;                         // CSS px, for headless use
    this._h = def.height || 0;
  }

  Camera.prototype.pixelRatio = function () {
    if (this.dpr) return this.dpr;
    return (typeof globalThis.devicePixelRatio === 'number' && globalThis.devicePixelRatio > 0) ? globalThis.devicePixelRatio : 1;
  };
  // View size in CSS pixels.
  Camera.prototype.width = function () {
    if (this._w) return this._w;
    var c = this.canvas;
    return c ? (c.clientWidth || c.width / this.pixelRatio()) : 800;
  };
  Camera.prototype.height = function () {
    if (this._h) return this._h;
    var c = this.canvas;
    return c ? (c.clientHeight || c.height / this.pixelRatio()) : 600;
  };
  Camera.prototype.setSize = function (w, h) { this._w = w; this._h = h; return this; };

  // Make the canvas backing store match its CSS size × devicePixelRatio.
  // Returns true when the size changed.
  Camera.prototype.resize = function () {
    var c = this.canvas; if (!c) return false;
    var r = this.pixelRatio(), w = c.clientWidth || this._w || c.width, h = c.clientHeight || this._h || c.height;
    var bw = Math.round(w * r), bh = Math.round(h * r);
    if (c.width === bw && c.height === bh) return false;
    c.width = bw; c.height = bh;
    return true;
  };
  // Draw in CSS pixels from here on.
  Camera.prototype.apply = function (ctx) {
    var r = this.pixelRatio();
    ctx.setTransform(r, 0, 0, r, 0, 0);
  };

  Camera.prototype.worldToScreen = function (p) {
    return { x: this.width() / 2 + (p.x - this.center.x) * this.zoom,
             y: this.height() / 2 - (p.y - this.center.y) * this.zoom };
  };
  Camera.prototype.screenToWorld = function (s) {
    return { x: this.center.x + (s.x - this.width() / 2) / this.zoom,
             y: this.center.y - (s.y - this.height() / 2) / this.zoom };
  };
  // A length in metres as pixels.
  Camera.prototype.px = function (metres) { return metres * this.zoom; };

  // Pan by a screen drag (dx, dy in CSS px): the world follows the pointer.
  Camera.prototype.pan = function (dx, dy) {
    this.center = M.v(this.center.x - dx / this.zoom, this.center.y + dy / this.zoom);
    return this;
  };
  // Zoom by `factor` keeping the world point under screen point s fixed.
  //   world(s) = c + (s - W/2)/z  must equal  c' + (s - W/2)/z'
  //   => c' = c + (s - W/2)(1/z - 1/z')   (y with the opposite sign)
  Camera.prototype.zoomAt = function (s, factor) {
    var z0 = this.zoom, z1 = M.clamp(z0 * factor, this.minZoom, this.maxZoom);
    var ox = s.x - this.width() / 2, oy = s.y - this.height() / 2;
    var k = 1 / z0 - 1 / z1;
    this.center = M.v(this.center.x + ox * k, this.center.y - oy * k);
    this.zoom = z1;
    return this;
  };
  // Frame a world box { lo, hi } with `padding` CSS px on every side.
  Camera.prototype.fit = function (bounds, padding) {
    padding = padding == null ? 24 : padding;
    var bw = Math.max(bounds.hi.x - bounds.lo.x, 1e-6), bh = Math.max(bounds.hi.y - bounds.lo.y, 1e-6);
    var W = Math.max(this.width() - 2 * padding, 1), H = Math.max(this.height() - 2 * padding, 1);
    this.zoom = M.clamp(Math.min(W / bw, H / bh), this.minZoom, this.maxZoom);
    this.center = M.v((bounds.lo.x + bounds.hi.x) / 2, (bounds.lo.y + bounds.hi.y) / 2);
    return this;
  };
  // The world box currently on screen.
  Camera.prototype.viewBounds = function () {
    var a = this.screenToWorld({ x: 0, y: this.height() }), b = this.screenToWorld({ x: this.width(), y: 0 });
    return { lo: a, hi: b };
  };

  // Bounds of every body in a world (statics included), for Camera.fit.
  function worldBounds(world, skipHuge) {
    var lo = M.v(Infinity, Infinity), hi = M.v(-Infinity, -Infinity);
    world.bodies.forEach(function (b) {
      if (!b.fixtures.length) return;
      var bb = b.aabb();
      // very long static ground would otherwise make the view tiny
      if (skipHuge && b.type === 'static' && bb.hi.x - bb.lo.x > skipHuge) {
        lo.y = Math.min(lo.y, bb.hi.y - 0.5); hi.y = Math.max(hi.y, bb.hi.y);
        return;
      }
      lo.x = Math.min(lo.x, bb.lo.x); lo.y = Math.min(lo.y, bb.lo.y);
      hi.x = Math.max(hi.x, bb.hi.x); hi.y = Math.max(hi.y, bb.hi.y);
    });
    if (!isFinite(lo.x)) return { lo: M.v(-5, -1), hi: M.v(5, 5) };
    return { lo: lo, hi: hi };
  }

  /* ------------------------------------------------------------ helpers */
  function hex(c) {
    var n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    var x = hex(a), y = hex(b);
    var r = Math.round(x[0] + (y[0] - x[0]) * t), g = Math.round(x[1] + (y[1] - x[1]) * t), bl = Math.round(x[2] + (y[2] - x[2]) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  // Utilisation 0 → green, 0.5 → amber, 1 → red. Past 1 stays red.
  function stressColor(u) {
    u = M.clamp(u, 0, 1);
    return u < 0.5 ? mix(C.good, C.hazard, u / 0.5) : mix(C.hazard, C.bad, (u - 0.5) / 0.5);
  }
  // How close a joint is to breaking: the worse of force and torque ratios.
  function utilisation(j) {
    var u = -1;
    var F = j.lastForce != null ? j.lastForce : (j.force ? j.force() : 0);
    if (isFinite(j.breakForce) && j.breakForce > 0) u = Math.max(u, F / j.breakForce);
    if (j.breakTorque != null && isFinite(j.breakTorque) && j.breakTorque > 0) {
      var T = j.lastTorque != null ? j.lastTorque : (j.torque ? Math.abs(j.torque()) : 0);
      u = Math.max(u, T / j.breakTorque);
    }
    return u;                                  // -1 = not rated
  }

  // Magnitude in the chosen unit, 3 significant figures. 'N' switches to kN / MN
  // for big numbers so labels stay short.
  function formatForce(F, unit) {
    unit = unit || 'N';
    var value = F, u = unit;
    if (unit === 'N') {
      if (Math.abs(F) >= 1e6) { value = F / 1e6; u = 'MN'; }
      else if (Math.abs(F) >= 1e3) { value = F / 1e3; u = 'kN'; }
    } else if (unit === 'kN') value = F / 1e3;
    else if (SE.units && SE.units.convert) {
      try { value = SE.units.convert(F, 'N', unit); } catch (e) { u = 'N'; }
    }
    return sig3(value) + ' ' + u;
  }
  function sig3(x) {
    if (x === 0 || !isFinite(x)) return '0';
    var a = Math.abs(x), d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : Math.min(6, 2 - Math.floor(Math.log10(a)));
    return x.toFixed(d);
  }

  function arrow(ctx, x1, y1, x2, y2, color, label, width) {
    if (SE.draw && SE.draw.arrow) { SE.draw.arrow(ctx, x1, y1, x2, y2, color, label, { width: width || 2.5, font: FONT }); return; }
    var len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    var ang = Math.atan2(y2 - y1, x2 - x1), head = Math.min(12, len * 0.45);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.4) * head, y2 - Math.sin(ang - 0.4) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.4) * head, y2 - Math.sin(ang + 0.4) * head);
    ctx.closePath(); ctx.fill();
    if (label) label_(ctx, label, x2 + Math.cos(ang) * 14, y2 + Math.sin(ang) * 14 - 10, color);
    ctx.restore();
  }
  function label_(ctx, text, x, y, color) {
    if (SE.draw && SE.draw.labelBox) { ctx.save(); ctx.font = FONT; SE.draw.labelBox(ctx, text, x, y, color); ctx.restore(); return; }
    ctx.save();
    ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(20,17,15,0.85)'; ctx.fillRect(x - w / 2, y - 9, w, 18);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* --------------------------------------------------------- per-world state */
  // Break flashes and the eased auto force scale, kept per world.
  var states = typeof WeakMap === 'function' ? new WeakMap() : null;
  var FLASH_TIME = 0.7;                             // s of world time

  function stateFor(world) {
    var st = states && states.get(world);
    if (st) return st;
    st = { flashes: [], scale: 0 };
    if (states) states.set(world, st);
    if (world.on) world.on('break', function (e) { addFlash(st, e, world); });
    return st;
  }
  function addFlash(st, e, world) {
    // where it let go: mid-span for a rope or rod, the anchor for pins and welds
    var j = e.joint, a = safeAnchor(j, 'A'), b = safeAnchor(j, 'B');
    var p = (j.type === 'distance' && a && b) ? M.lerp(a, b, 0.5) : (b || a || M.v(0, 0));
    var seed = (j.id || 1) * 9973, frags = [];
    for (var i = 0; i < 9; i++) {
      seed = (seed * 16807) % 2147483647;
      var ang = (seed / 2147483647) * Math.PI * 2;
      seed = (seed * 16807) % 2147483647;
      var sp = 1.5 + 3 * (seed / 2147483647);
      frags.push({ v: M.v(Math.cos(ang) * sp, Math.sin(ang) * sp + 1.5), spin: ang * 4, size: 0.04 + 0.05 * (i % 3) });
    }
    var g = world.gravity || M.v(0, -9.81);
    st.flashes.push({ p: p, t0: world.time, frags: frags, g: g, force: e.force, torque: e.torque, reason: e.reason, label: j.label || j.type || 'joint' });
    if (st.flashes.length > 24) st.flashes.shift();
  }
  function safeAnchor(j, which) {
    try { return which === 'A' ? j.anchorA() : j.anchorB(); } catch (err) { return null; }
  }

  /* ------------------------------------------------------------- drawing */
  function drawGrid(ctx, cam) {
    var W = cam.width(), H = cam.height(), vb = cam.viewBounds();
    // pick a grid step that lands 30-150 px apart: 0.1, 0.2, 0.5, 1, 2, 5, 10 m ...
    var step = 1, steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
    for (var i = 0; i < steps.length; i++) { step = steps[i]; if (step * cam.zoom >= 32) break; }
    ctx.save();
    ctx.fillStyle = 'rgba(23,58,94,0.22)'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    var x0 = Math.floor(vb.lo.x / step) * step, y0 = Math.floor(vb.lo.y / step) * step;
    for (var x = x0; x <= vb.hi.x + step; x += step) {
      var sx = Math.round(cam.worldToScreen({ x: x, y: 0 }).x) + 0.5;
      ctx.strokeStyle = Math.abs(x) < step * 1e-6 ? 'rgba(143,184,232,0.45)' : C.blueGrid;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    for (var y = y0; y <= vb.hi.y + step; y += step) {
      var sy = Math.round(cam.worldToScreen({ x: 0, y: y }).y) + 0.5;
      ctx.strokeStyle = Math.abs(y) < step * 1e-6 ? 'rgba(143,184,232,0.45)' : C.blueGrid;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
    // scale bar, bottom left
    var bar = step * cam.zoom;
    ctx.strokeStyle = C.blueInk; ctx.fillStyle = C.blueInk; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, H - 14); ctx.lineTo(14 + bar, H - 14);
    ctx.moveTo(14, H - 19); ctx.lineTo(14, H - 9); ctx.moveTo(14 + bar, H - 19); ctx.lineTo(14 + bar, H - 9); ctx.stroke();
    ctx.font = FONT_SMALL; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(sig3(step) + ' m', 18 + bar, H - 8);
    ctx.restore();
  }

  function fixturePath(ctx, cam, body, shape) {
    var t = body.transform();
    ctx.beginPath();
    if (shape.type === 'circle') {
      var c = cam.worldToScreen(M.xfPoint(t, shape.center));
      ctx.arc(c.x, c.y, Math.max(shape.radius * cam.zoom, 0.5), 0, Math.PI * 2);
      return;
    }
    var vs = shape.vertices;
    for (var i = 0; i < vs.length; i++) {
      var s = cam.worldToScreen(M.xfPoint(t, vs[i]));
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
  }

  function bodyFill(body, f) {
    if (body.type === 'static') return C.iron2;
    if (body.type === 'kinematic') return '#4b5a6a';
    var name = f.material && f.material.name;
    return (name && MATERIAL_FILL[name]) || C.steel;
  }

  function drawBodies(ctx, world, cam, o) {
    world.bodies.forEach(function (b) {
      var asleep = b.type !== 'static' && b.awake === false;
      ctx.save();
      if (asleep) ctx.globalAlpha = 0.45;
      b.fixtures.forEach(function (f) {
        fixturePath(ctx, cam, b, f.shape);
        if (f.sensor) {
          ctx.setLineDash([5, 4]); ctx.strokeStyle = C.accel; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
          return;
        }
        ctx.fillStyle = bodyFill(b, f); ctx.fill();
        ctx.lineWidth = b.type === 'static' ? 2 : 1.5;
        ctx.strokeStyle = b.type === 'static' ? C.steel : (asleep ? C.steel : 'rgba(20,17,15,0.9)');
        ctx.stroke();
        if (b.type === 'static') hatch(ctx, cam, b, f.shape);
      });
      if (o.angles !== false && b.type !== 'static' && b.fixtures.length) {
        // angle tick: from the centre of mass along the body's x axis
        var c = cam.worldToScreen(b.c), r = Math.min(Math.max(reach(b) * cam.zoom, 6), 60);
        var e = { x: c.x + b.q.c * r, y: c.y - b.q.s * r };
        ctx.strokeStyle = asleep ? C.steelHi : C.paper; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        ctx.fillStyle = asleep ? C.steelHi : C.paper;
        ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });
    if (o.highlight && o.highlight.fixtures) {
      ctx.save();
      ctx.strokeStyle = C.hazard; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
      o.highlight.fixtures.forEach(function (f) { fixturePath(ctx, cam, o.highlight, f.shape); ctx.stroke(); });
      ctx.restore();
    }
  }
  // Distance from the centre of mass to the nearest edge, roughly: how long the angle tick can be.
  function reach(b) {
    var best = Infinity;
    b.fixtures.forEach(function (f) {
      var s = f.shape;
      if (s.type === 'circle') best = Math.min(best, s.radius);
      else {
        var lc = b.localCenter;
        for (var i = 0; i < s.count; i++) best = Math.min(best, Math.abs(M.dot(s.normals[i], M.sub(s.vertices[i], lc))));
      }
    });
    return isFinite(best) ? best * 0.85 : 0.2;
  }
  // Diagonal hatching on fixed ground, the drafting convention for "anchored".
  function hatch(ctx, cam, b, shape) {
    ctx.save();
    fixturePath(ctx, cam, b, shape); ctx.clip();
    var bb = P.aabb(shape, b.transform()), lo = cam.worldToScreen({ x: bb.lo.x, y: bb.hi.y }), hi = cam.worldToScreen({ x: bb.hi.x, y: bb.lo.y });
    var w = Math.min(hi.x - lo.x, 6000), h = Math.min(hi.y - lo.y, 6000);
    var x0 = Math.max(lo.x, -h), x1 = Math.min(lo.x + w, cam.width() + h);
    ctx.strokeStyle = 'rgba(167,162,154,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = x0 - h; x < x1; x += 10) { ctx.moveTo(x, lo.y + h); ctx.lineTo(x + h, lo.y); }
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------------------------- joints */
  function jointColor(j, o, fallback) {
    if (o.stress === false) return fallback;
    var u = utilisation(j);
    return u < 0 ? fallback : stressColor(u);
  }

  function zigzag(ctx, a, b, coils, amp) {
    var d = M.sub(b, a), L = M.len(d); if (L < 1) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); return; }
    var u = M.scale(d, 1 / L), n = M.perp(u), lead = Math.min(8, L * 0.15), body = L - 2 * lead;
    ctx.moveTo(a.x, a.y);
    var p = M.mulAdd(a, lead, u); ctx.lineTo(p.x, p.y);
    var segs = coils * 2;
    for (var i = 1; i < segs; i++) {
      var q = M.mulAdd(M.mulAdd(a, lead + body * i / segs, u), (i % 2 ? amp : -amp), n);
      ctx.lineTo(q.x, q.y);
    }
    p = M.mulAdd(b, -lead, u); ctx.lineTo(p.x, p.y); ctx.lineTo(b.x, b.y);
  }

  // A slack rope hangs as (roughly) a parabola. For a shallow sag d over a
  // chord c, the arc length is s ≈ c + 8d²/(3c), so d ≈ √(3c(s - c)/8).
  // The sag is drawn straight down (gravity), from the chord midpoint.
  function slackRope(ctx, a, b, slackPx, chordPx) {
    var d = Math.sqrt(Math.max(0, 3 * chordPx * slackPx / 8));
    if (chordPx < 1) d = slackPx / 2;
    var mid = M.lerp(a, b, 0.5);
    // a quadratic Bézier with control point at mid + 2d puts the curve's midpoint d below the chord
    ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mid.x, mid.y + 2 * d, b.x, b.y);
  }

  function drawJoints(ctx, world, cam, o) {
    world.joints.forEach(function (j) {
      var a = safeAnchor(j, 'A'), b = safeAnchor(j, 'B');
      if (!a || !b) return;
      var sa = cam.worldToScreen(a), sb = cam.worldToScreen(b);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var type = j.type;
      if (type === 'distance') drawDistance(ctx, j, sa, sb, cam, o);
      else if (type === 'revolute') drawPin(ctx, sa, jointColor(j, o, C.paper));
      else if (type === 'weld') drawWeld(ctx, j, sa, jointColor(j, o, C.hazard));
      else if (type === 'prismatic') drawPrismatic(ctx, j, sa, sb, cam, jointColor(j, o, C.blueInk));
      else if (type === 'mouse') drawMouse(ctx, j, sb, cam);
      else if (type === 'pulley') drawPulley(ctx, j, sa, sb, cam, jointColor(j, o, C.paperDim));
      else if (type === 'winch') drawWinch(ctx, j, sa, sb, cam, jointColor(j, o, C.paperDim));
      else {
        ctx.strokeStyle = jointColor(j, o, C.steelHi); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawDistance(ctx, j, sa, sb, cam, o) {
    var spring = !j.rope && (j.stiffness > 0 || j.hertz > 0);
    var col = jointColor(j, o, j.rope ? '#c9a86a' : (spring ? C.accel : C.steelHi));
    ctx.strokeStyle = col;
    ctx.beginPath();
    if (j.rope) {
      var L = M.dist(j.anchorA(), j.anchorB()), slack = j.length - L;
      if (slack > (P.LINEAR_SLOP || 0.005)) {
        ctx.setLineDash([7, 5]); ctx.lineWidth = 2;
        slackRope(ctx, sa, sb, slack * cam.zoom, L * cam.zoom);
      } else {
        ctx.lineWidth = 2.5;
        ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    } else if (spring) {
      ctx.lineWidth = 2;
      zigzag(ctx, sa, sb, 7, 6);
      ctx.stroke();
    } else {
      // rigid rod: a bar with a lighter core
      ctx.lineWidth = 5; ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,17,15,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }
    [sa, sb].forEach(function (s) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); });
  }

  function drawPin(ctx, s, col) {
    ctx.fillStyle = C.night; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  function drawWeld(ctx, j, s, col) {
    var ang = j.bodyA ? j.bodyA.angle : 0, h = 7;
    ctx.translate(s.x, s.y); ctx.rotate(-ang);
    ctx.fillStyle = col; ctx.strokeStyle = C.night; ctx.lineWidth = 1.5;
    ctx.fillRect(-h, -h, 2 * h, 2 * h); ctx.strokeRect(-h, -h, 2 * h, 2 * h);
    ctx.beginPath(); ctx.moveTo(-h, -h); ctx.lineTo(h, h); ctx.moveTo(-h, h); ctx.lineTo(h, -h); ctx.stroke();
  }

  // Slider: a rail along the joint axis through anchor A, and a block at anchor B.
  function drawPrismatic(ctx, j, sa, sb, cam, col) {
    var axisL = j.localAxisA || j.axis || M.v(1, 0);
    var ax = j.bodyA ? M.rotate(j.bodyA.q, M.norm(axisL)) : M.norm(axisL);
    var lo = j.lowerTranslation, hi = j.upperTranslation;
    var aW = j.anchorA();
    var r0 = isFinite(lo) ? lo : -1, r1 = isFinite(hi) ? hi : 1;
    var p0 = cam.worldToScreen(M.mulAdd(aW, r0, ax)), p1 = cam.worldToScreen(M.mulAdd(aW, r1, ax));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.setLineDash([]);
    [p0, p1].forEach(function (p) { ctx.beginPath(); ctx.moveTo(p.x - 4 * ax.y, p.y - 4 * ax.x); ctx.lineTo(p.x + 4 * ax.y, p.y + 4 * ax.x); ctx.stroke(); });
    ctx.translate(sb.x, sb.y); ctx.rotate(-Math.atan2(ax.y, ax.x));
    ctx.fillStyle = col; ctx.fillRect(-7, -4, 14, 8);
  }

  // Mouse drag: dashed line from the grab point to the pointer target.
  function drawMouse(ctx, j, sb, cam) {
    var t = j.target || j.targetA || j.worldTarget;
    if (!t) return;
    var st = cam.worldToScreen(t);
    ctx.strokeStyle = C.hazard; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sb.x, sb.y); ctx.lineTo(st.x, st.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(st.x, st.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // Pulley: rope from anchor A up to wheel A, across to wheel B, down to anchor B.
  function drawPulley(ctx, j, sa, sb, cam, col) {
    var gA = j.groundAnchorA || j.groundA, gB = j.groundAnchorB || j.groundB;
    if (!gA || !gB) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke(); return; }
    var ga = cam.worldToScreen(gA), gb = cam.worldToScreen(gB), r = Math.max(6, (j.radius || 0.15) * cam.zoom);
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(ga.x, ga.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    [ga, gb].forEach(function (g) { wheel(ctx, g, r); });
  }

  // Tangent point on circle (C, r) of a line from the outside point Pt.
  // side +1 rotates the radius toward Pt counter-clockwise by α = acos(r/d), -1 clockwise.
  function tangentPoint(Pt, C, r, side) {
    var d = M.sub(Pt, C), L = M.len(d);
    if (L <= r + 1e-9) return M.mulAdd(C, r, M.norm(d.x || d.y ? d : M.v(0, 1)));
    var u = M.scale(d, 1 / L), al = side * Math.acos(r / L);
    return M.mulAdd(C, r, M.rotate(M.rot(al), u));
  }

  // Winch: a drum at anchor A with the line paid out to the hook at anchor B.
  // With a `via` sheave the line leaves the drum, wraps over the sheave rim
  // (tangent in, arc, tangent out) and drops to the hook; with parts > 1 it
  // is a tackle, drawn as `parts` falls between the sheave block and a lower
  // block on the hook. The physics treats the sheave as a point (winch.js);
  // the rim here is only for the picture.
  function drawWinch(ctx, j, sa, sb, cam, col) {
    var D = j.anchorA(), H = j.anchorB(), z = cam.zoom;
    var rd = Math.max(j.drumRadius || j.radius || 0.15, 7 / z);
    var slack = j.isSlack ? j.isSlack() : false;
    var parts = Math.max(1, Math.round(j.parts || 1));
    var S = null, rs = 0;
    if (j.via) {
      S = j.via.body ? j.via.body.worldPoint(j.via.local) : j.via.local;
      rs = Math.max(j.via.radius || j.sheaveRadius || 0.15, 6 / z);
    }
    var W = function (p) { return cam.worldToScreen(p); };

    // the drum and sheave wheels go underneath the line
    wheel(ctx, sa, rd * z);
    ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 1;
    for (var k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(sa.x, sa.y, rd * z * (0.45 + 0.15 * k), 0, Math.PI * 2); ctx.stroke(); }
    // the block the falls hang from: the sheave, or the drum itself with no sheave
    var top = S || D, rt = S ? rs : rd;
    if (S) wheel(ctx, W(S), rs * z);

    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    if (slack) ctx.setLineDash([7, 5]);
    ctx.beginPath();
    var outPt = null, inS = null, sense = -1;
    if (S) {
      // bend direction: −1 = the line turns clockwise over the sheave (e.g. up, over, down)
      sense = M.cross(M.sub(S, D), M.sub(H, S)) > 0 ? 1 : -1;
      inS = tangentPoint(D, S, rs, sense);
      var offD = tangentPoint(inS, D, rd, -sense);                // leaves the drum on the same side
      outPt = tangentPoint(H, S, rs, -sense);
      var p0 = W(offD), p1 = W(inS);
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    } else {
      outPt = tangentPoint(H, D, rd, 1);
      var q0 = W(outPt); ctx.moveTo(q0.x, q0.y);
    }

    if (parts === 1) {
      if (S) arcTo(ctx, cam, S, rs, inS, outPt, sense);
      var h = W(H); ctx.lineTo(h.x, h.y);
      ctx.stroke(); ctx.setLineDash([]);
      return;
    }

    // tackle: falls spread across the top block, converging on a lower block above the hook
    var dir = M.norm(M.sub(H, top)), n = M.perp(dir);
    var rb = rt * 0.7, Hb = M.mulAdd(H, -(rb + 0.08), dir);
    var outSide = M.dot(M.sub(outPt, top), n) >= 0 ? 1 : -1;
    var falls = [];
    for (var i = 0; i < parts; i++) {
      var o = rt * (-1 + 2 * i / (parts - 1));
      falls.push({ o: o, a: M.mulAdd(top, o, n), b: M.mulAdd(Hb, o * (rb / rt), n) });
    }
    // the line from the drum wraps onto the outermost fall on its side
    falls.sort(function (f, g) { return outSide * (g.o - f.o); });
    if (S) arcTo(ctx, cam, S, rs, inS, falls[0].a, sense);
    else { var fa = W(falls[0].a); ctx.lineTo(fa.x, fa.y); }
    ctx.stroke();
    ctx.beginPath();
    falls.forEach(function (f) { var a1 = W(f.a), b1 = W(f.b); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); });
    ctx.stroke(); ctx.setLineDash([]);
    // lower block and its hook
    var hb = W(Hb), hk = W(H);
    ctx.strokeStyle = C.steelHi; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hb.x, hb.y); ctx.lineTo(hk.x, hk.y); ctx.stroke();
    wheel(ctx, hb, rb * z);
    var mid = W(M.lerp(falls[0].a, falls[0].b, 0.5));
    label_(ctx, '×' + parts, mid.x + (outSide > 0 ? 1 : -1) * (n.x >= 0 ? 18 : -18), mid.y, col);
  }

  // Continue the current path around circle (C, r) from point `from` to point `to`,
  // turning the way the line bends (sense −1 = clockwise as seen on screen).
  function arcTo(ctx, cam, C, r, from, to, sense) {
    var c = cam.worldToScreen(C), f = cam.worldToScreen(from), t = cam.worldToScreen(to);
    var a0 = Math.atan2(f.y - c.y, f.x - c.x), a1 = Math.atan2(t.y - c.y, t.x - c.x);
    ctx.arc(c.x, c.y, r * cam.zoom, a0, a1, sense > 0);
  }

  function wheel(ctx, c, r) {
    ctx.fillStyle = C.iron; ctx.strokeStyle = C.steelHi; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.steelHi; ctx.beginPath(); ctx.arc(c.x, c.y, 2, 0, Math.PI * 2); ctx.fill();
  }

  /* ------------------------------------------------ contacts and bounds */
  function drawContacts(ctx, world, cam) {
    ctx.save();
    world.contacts.forEach(function (ct) {
      var n = ct.normal || (ct.manifold && ct.manifold.normal);
      (ct.points || []).forEach(function (cp) {
        if (!cp.point) return;
        var s = cam.worldToScreen(cp.point), touching = cp.separation == null || cp.separation < (P.LINEAR_SLOP || 0.005);
        ctx.fillStyle = touching ? C.bad : 'rgba(0,0,0,0)';
        ctx.strokeStyle = touching ? C.bad : C.steelHi; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (n) {
          ctx.strokeStyle = touching ? C.hazard : 'rgba(230,180,34,0.4)';
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + n.x * 14, s.y - n.y * 14); ctx.stroke();
        }
      });
    });
    ctx.restore();
  }

  function drawAABBs(ctx, world, cam) {
    ctx.save();
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    world.bodies.forEach(function (b) {
      if (!b.fixtures.length) return;
      var bb = b.aabb(), lo = cam.worldToScreen({ x: bb.lo.x, y: bb.hi.y }), hi = cam.worldToScreen({ x: bb.hi.x, y: bb.lo.y });
      ctx.strokeStyle = b.awake === false ? 'rgba(143,184,232,0.3)' : 'rgba(143,184,232,0.75)';
      ctx.strokeRect(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y);
    });
    ctx.restore();
  }

  function drawLabels(ctx, world, cam) {
    ctx.save();
    ctx.font = FONT_SMALL; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    world.bodies.forEach(function (b) {
      if (!b.label || !b.fixtures.length) return;
      var bb = b.aabb(), s = cam.worldToScreen({ x: (bb.lo.x + bb.hi.x) / 2, y: bb.hi.y });
      ctx.fillStyle = 'rgba(20,17,15,0.7)';
      var w = ctx.measureText(b.label).width + 6;
      ctx.fillRect(s.x - w / 2, s.y - 18, w, 15);
      ctx.fillStyle = C.paperDim; ctx.fillText(b.label, s.x, s.y - 4);
    });
    ctx.restore();
  }

  /* --------------------------------------------------------------- forces */
  // Arrow length: forceScale px/N if given, otherwise an automatic scale that
  // makes the biggest force about 90 px and eases over a few frames.
  function forceScaleFor(st, o, maxF) {
    if (o.forceScale) return o.forceScale;
    var target = maxF > 1e-9 ? 90 / maxF : 0;
    if (!st.scale || !isFinite(st.scale)) st.scale = target;
    else if (target) st.scale += (target - st.scale) * (target < st.scale ? 0.5 : 0.1);
    return st.scale;
  }

  function collectForces(world, o) {
    var list = [];
    if (o.forces) world.joints.forEach(function (j) {
      if (!j.reaction || j.type === 'mouse') return;
      var r = j.reaction(), F = r && r.force; if (!F) return;
      var mag = M.len(F); if (!(mag > 1e-6)) return;
      var p = safeAnchor(j, 'B'); if (!p) return;
      list.push({ point: p, vector: F, color: C.force, mag: mag });
    });
    if (o.contactForces) {
      // one arrow per manifold: the summed normal + friction force on body B, at the points' centroid
      var invH = world.substeps * (o.dt ? 1 / o.dt : 60);
      world.contacts.forEach(function (ct) {
        if (!ct.normal || !ct.points || !ct.points.length) return;
        var N = 0, T = 0, c = M.v(0, 0);
        ct.points.forEach(function (cp) { N += cp.normalImpulse || 0; T += cp.tangentImpulse || 0; c = M.add(c, cp.point); });
        var Fv = M.add(M.scale(ct.normal, N * invH), M.scale(ct.tangent || M.v(0, 0), T * invH));
        var mag = M.len(Fv); if (!(mag > 1e-3)) return;
        list.push({ point: M.scale(c, 1 / ct.points.length), vector: Fv, color: C.accel, mag: mag });
      });
    }
    if (o.weights) {
      var g = world.gravity, gl = M.len(g);
      world.bodies.forEach(function (b) {
        if (b.type !== 'dynamic' || !gl) return;
        var W = M.scale(g, b.m * b.gravityScale);
        list.push({ point: b.c, vector: W, color: C.weight, mag: M.len(W) });
      });
    }
    return list;
  }

  function drawForceList(ctx, cam, list, scale, unit) {
    list.forEach(function (f) {
      var s = cam.worldToScreen(f.point);
      var len = Math.min(f.mag * scale, 220);
      var dx = f.vector.x / f.mag * len, dy = -f.vector.y / f.mag * len;
      // short arrows skip the label so small forces don't bury the scene in text
      arrow(ctx, s.x, s.y, s.x + dx, s.y + dy, f.color, len >= 24 ? formatForce(f.mag, unit) : null, 2.5);
    });
  }

  /* --------------------------------------------------------------- breaks */
  function drawBreaks(ctx, world, cam, st) {
    var now = world.time;
    st.flashes = st.flashes.filter(function (fl) { return now - fl.t0 <= FLASH_TIME && now >= fl.t0; });
    st.flashes.forEach(function (fl) {
      var t = now - fl.t0, k = 1 - t / FLASH_TIME, s = cam.worldToScreen(fl.p);
      ctx.save();
      // flash: a burst ring that grows and fades
      var r = 10 + 60 * (t / FLASH_TIME);
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = 'rgba(255,220,140,' + (0.55 * k).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.hazard; ctx.lineWidth = 3 * k + 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      // fragments fly out ballistically: p = p0 + v t + ½ g t²
      ctx.strokeStyle = C.rustHi; ctx.lineWidth = 2;
      fl.frags.forEach(function (fr) {
        var p = M.v(fl.p.x + fr.v.x * t + 0.5 * fl.g.x * t * t, fl.p.y + fr.v.y * t + 0.5 * fl.g.y * t * t);
        var q = cam.worldToScreen(p), a = fr.spin + t * 12, hl = Math.max(2, fr.size * cam.zoom);
        ctx.beginPath(); ctx.moveTo(q.x - Math.cos(a) * hl, q.y - Math.sin(a) * hl); ctx.lineTo(q.x + Math.cos(a) * hl, q.y + Math.sin(a) * hl); ctx.stroke();
      });
      if (t < FLASH_TIME * 0.8) {
        var what = fl.reason === 'torque' ? formatForce(fl.torque || 0, 'N').replace(/N$/, 'N·m') : formatForce(fl.force || 0, 'N');
        label_(ctx, 'SNAP ' + what, s.x, s.y - 26, C.bad);
      }
      ctx.restore();
    });
  }

  /* ----------------------------------------------------------- debugDraw */
  function debugDraw(ctx, world, camera, options) {
    var o = options || {};
    var st = stateFor(world);
    camera.apply(ctx);
    if (o.clear !== false) {
      ctx.fillStyle = o.background || C.night;
      ctx.fillRect(0, 0, camera.width(), camera.height());
    }
    if (o.grid !== false) drawGrid(ctx, camera);
    if (o.shapes !== false) drawBodies(ctx, world, camera, o);
    if (o.aabbs) drawAABBs(ctx, world, camera);
    if (o.joints !== false) drawJoints(ctx, world, camera, o);
    if (o.contacts) drawContacts(ctx, world, camera);
    if (o.labels) drawLabels(ctx, world, camera);
    if (o.forces || o.contactForces || o.weights) {
      var list = collectForces(world, o), maxF = 0;
      list.forEach(function (f) { if (f.mag > maxF) maxF = f.mag; });
      drawForceList(ctx, camera, list, forceScaleFor(st, o, maxF), o.forceUnit);
    }
    if (o.breaks !== false) drawBreaks(ctx, world, camera, st);
  }

  /* ------------------------------------------------------ free-body overlay */
  // forces: [{ kind, point: {x, y} (world), vector: {x, y} (N), label }]
  // kind picks the colour: weight, normal, friction, tension, reaction, applied,
  // spring, contact. A 'moment' entry with a scalar `moment` (N·m, CCW +) and
  // no vector draws as a curved arrow. Arrows share one scale so their
  // lengths compare; the largest is opts.maxLength px (default 90).
  var KIND_COLOR = {
    weight: C.weight, gravity: C.weight, normal: C.accel, contact: C.accel, friction: '#b98cff',
    tension: C.force, cable: C.force, rope: C.force, reaction: C.hazard, pin: C.hazard, weld: C.hazard,
    applied: C.good, spring: '#6ad0ff', moment: C.hazard
  };

  function debugDrawFreeBody(ctx, forces, camera, opts) {
    opts = opts || {};
    if (!forces || !forces.length) return;
    var maxLen = opts.maxLength || 90, minLen = opts.minLength || 18, unit = opts.forceUnit || 'N';
    var maxF = 0;
    forces.forEach(function (f) { if (f.vector) maxF = Math.max(maxF, M.len(f.vector)); });
    var scale = maxF > 0 ? maxLen / maxF : 0;
    ctx.save();
    if (opts.applyCamera !== false) camera.apply(ctx);
    forces.forEach(function (f, i) {
      var color = f.color || KIND_COLOR[f.kind] || C.paper;
      var s = camera.worldToScreen(f.point || M.v(0, 0));
      if (!f.vector && f.moment != null) { momentArrow(ctx, s, f.moment, color, f.label || (sig3(f.moment) + ' N·m')); return; }
      if (!f.vector) return;
      var mag = M.len(f.vector); if (!(mag > 0)) return;
      var len = Math.max(minLen, mag * scale), ux = f.vector.x / mag, uy = -f.vector.y / mag;
      var text = f.label != null ? f.label : ((f.kind ? f.kind + ' ' : '') + formatForce(mag, unit));
      // pushes (normal, contact) end at the point; everything else starts there
      var pushes = f.kind === 'normal' || f.kind === 'contact';
      if (pushes) arrow(ctx, s.x - ux * len, s.y - uy * len, s.x, s.y, color, null, 3);
      else arrow(ctx, s.x, s.y, s.x + ux * len, s.y + uy * len, color, null, 3);
      // label at the free end, nudged sideways so overlapping arrows stay readable
      var lx = pushes ? s.x - ux * (len + 16) : s.x + ux * (len + 16), ly = pushes ? s.y - uy * (len + 16) : s.y + uy * (len + 16);
      label_(ctx, text, lx + (-uy) * 6 * ((i % 2) ? 1 : -1), ly + ux * 6 * ((i % 2) ? 1 : -1), color);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // Three-quarter circle with a head. On screen y points down, so a CCW
  // moment sweeps with anticlockwise = true from angle 0 to -3π/2.
  function momentArrow(ctx, s, m, color, label) {
    var r = 22, ccw = m >= 0, end = ccw ? -1.5 * Math.PI : 1.5 * Math.PI;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, end, ccw); ctx.stroke();
    var ex = s.x + r * Math.cos(end), ey = s.y + r * Math.sin(end);
    // direction of travel at the end of the sweep
    var tx = ccw ? Math.sin(end) : -Math.sin(end), ty = ccw ? -Math.cos(end) : Math.cos(end);
    var ang = Math.atan2(ty, tx);
    ctx.beginPath(); ctx.moveTo(ex + tx * 4, ey + ty * 4);
    ctx.lineTo(ex - 9 * Math.cos(ang - 0.45), ey - 9 * Math.sin(ang - 0.45));
    ctx.lineTo(ex - 9 * Math.cos(ang + 0.45), ey - 9 * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    label_(ctx, label, s.x, s.y - r - 12, color);
  }

  P.Camera = Camera;
  P.debugDraw = debugDraw;
  P.debugDrawFreeBody = debugDrawFreeBody;
  // Start listening for a world's 'break' events now, so a joint that snaps
  // before the first frame is drawn still flashes.
  // The build yard checks this to drop its own rope-over-sheave overlay.
  P.debugDrawsWinchVia = true;
  P.debugDraw.track = function (world) { stateFor(world); return world; };
  P.debugDraw.worldBounds = worldBounds;
  P.debugDraw.stressColor = stressColor;
  P.debugDraw.utilisation = utilisation;
  P.debugDraw.formatForce = formatForce;
  P.debugDraw.MATERIAL_FILL = MATERIAL_FILL;
})(globalThis.SE);
