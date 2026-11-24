/*
 * Collision shapes and their mass properties.
 *
 * A shape is defined in its body's local frame (metres):
 *   circle        { type: 'circle', radius, center }
 *   capsule       { type: 'capsule', center1, center2, radius }        logs, pipes, rope links
 *   polygon       { type: 'polygon', vertices (convex, CCW), normals, count, radius, centroid }
 *   segment       { type: 'segment', point1, point2, oneSided }          static only
 *   chainSegment  { type: 'chainSegment', point1, point2, ghost1, ghost2 } static only
 *
 * Makers:
 *   P.circle(radius, center)
 *   P.capsule(p1, p2, radius)
 *   P.polygon(points, radius)       radius rounds the polygon outward (the core is `points`)
 *   P.box(hw, hh, center, angle, radius)
 *                                   radius rounds the corners inside the given size, so a
 *                                   box(0.5, 0.5, null, 0, 0.05) crate is still 1 m across
 *   P.segment(p1, p2, { oneSided }) one-sided segments collide only on the left of p1 -> p2
 *   P.chain(points, { loop, inside, flip })
 *                                   an array of chainSegment shapes for terrain; pass it as
 *                                   `shapes: P.chain(pts)` (or concat it with other shapes)
 *
 * Every rounded shape is a "core" (a point, a segment or a convex polygon)
 * grown by a radius, which is how the narrowphase and the ray casts treat
 * them: a circle is a rounded point and a capsule a rounded segment.
 *
 * Chains are one-sided. An open chain collides on the left of the direction
 * its points are listed in, so terrain listed left to right faces up (`flip`
 * reverses that). A loop collides on its outside whatever the winding
 * (`inside: true` makes a container instead). Each segment remembers its
 * neighbours' far ends as ghost vertices, so a box sliding over an internal
 * vertex sees one smooth surface instead of catching on the joint. Internally
 * a chain segment's free (colliding) side is on the right of point1 -> point2,
 * where its normal points: the same rule polygon edges follow.
 *
 * massData(shape, density) returns { mass, center, I } where I is the
 * rotational inertia about the body origin, so a body can sum its shapes
 * directly before shifting to its centre of mass. Segments and chains have
 * no area and no mass.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath;

  function copy(p) { return M.v(p.x, p.y); }
  function finite(p) { return p && isFinite(p.x) && isFinite(p.y); }
  function checkPoint(p, what) { if (!finite(p)) throw new Error(what + ': bad point ' + JSON.stringify(p)); }
  function checkRadius(r, what) { if (!(r >= 0) || !isFinite(r)) throw new Error(what + ': radius must be a finite number >= 0, got ' + r); }

  function circle(radius, center) {
    checkRadius(radius, 'circle'); if (!(radius > 0)) throw new Error('circle: radius must be > 0');
    if (center) checkPoint(center, 'circle');
    return { type: 'circle', radius: radius, center: center ? copy(center) : M.v(0, 0) };
  }

  function capsule(p1, p2, radius) {
    checkPoint(p1, 'capsule'); checkPoint(p2, 'capsule'); checkRadius(radius, 'capsule');
    if (!(radius > 0)) throw new Error('capsule: radius must be > 0');
    if (M.dist(p1, p2) < 0.005) throw new Error('capsule: the two centres are closer than 5 mm; use a circle');
    return { type: 'capsule', center1: copy(p1), center2: copy(p2), radius: radius };
  }

  // Convex hull by gift wrapping (parts have a handful of vertices). Collinear
  // points are dropped. Returns the hull counter-clockwise.
  function hull(pts) {
    var i0 = 0;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].x > pts[i0].x || (pts[i].x === pts[i0].x && pts[i].y < pts[i0].y)) i0 = i;
    }
    var out = [], ih = i0;
    for (;;) {
      out.push(pts[ih]);
      var ie = 0;
      for (var j = 1; j < pts.length; j++) {
        if (ie === ih) { ie = j; continue; }
        var r = M.sub(pts[ie], pts[ih]), w = M.sub(pts[j], pts[ih]), c = M.cross(r, w);
        if (c < 0 || (c === 0 && M.lenSq(w) > M.lenSq(r))) ie = j;
      }
      ih = ie;
      if (ie === i0 || out.length > pts.length) break;
    }
    return out;                 // orientation is fixed by the caller
  }

  // Convex polygon. Points may be in any order but must already be convex:
  // a point inside the hull means the outline was concave, which is an error
  // (split concave parts into several convex shapes on the same body).
  function polygon(points, radius) {
    radius = radius || 0;
    checkRadius(radius, 'polygon');
    if (!points || points.length < 3) throw new Error('polygon needs at least 3 points');
    var pts = points.map(function (p) { checkPoint(p, 'polygon'); return copy(p); });
    var vs = hull(pts);
    var area2 = 0;
    for (var k = 0; k < vs.length; k++) area2 += M.cross(vs[k], vs[(k + 1) % vs.length]);
    if (area2 < 0) { vs.reverse(); area2 = -area2; }
    var span = 0;
    pts.forEach(function (p) { span = Math.max(span, M.dist(p, pts[0])); });
    if (vs.length < 3 || !(area2 > 1e-10 * Math.max(1, span * span))) {
      throw new Error('polygon is degenerate: its points are coincident or collinear');
    }
    var ns = vs.map(function (a, i) { var b = vs[(i + 1) % vs.length]; return M.norm(M.rightPerp(M.sub(b, a))); });
    // every input point must lie on the hull boundary, otherwise the outline was concave
    var tol = 1e-9 * Math.max(1, span);
    pts.forEach(function (p) {
      var dmax = -Infinity;
      for (var i = 0; i < vs.length; i++) dmax = Math.max(dmax, M.dot(ns[i], M.sub(p, vs[i])));
      if (dmax < -tol) throw new Error('polygon is not convex: point (' + p.x + ', ' + p.y + ') lies inside the outline; split it into convex parts');
    });
    var poly = { type: 'polygon', vertices: vs, normals: ns, radius: radius, count: vs.length };
    poly.centroid = coreArea(vs).centroid;
    return poly;
  }

  // Box of half-width hw and half-height hh, optionally offset, rotated and
  // rounded. The rounding stays inside hw x hh.
  function box(hw, hh, center, angle, radius) {
    radius = radius || 0;
    if (!(hw > 0) || !(hh > 0)) throw new Error('box: half-width and half-height must be > 0');
    checkRadius(radius, 'box');
    if (radius >= Math.min(hw, hh)) throw new Error('box: corner radius must be smaller than the half-width and half-height');
    var q = M.rot(angle || 0), c = center || M.v(0, 0), cw = hw - radius, ch = hh - radius;
    var corners = [M.v(-cw, -ch), M.v(cw, -ch), M.v(cw, ch), M.v(-cw, ch)].map(function (p) { return M.add(M.rotate(q, p), c); });
    return polygon(corners, radius);
  }

  function segment(p1, p2, opts) {
    checkPoint(p1, 'segment'); checkPoint(p2, 'segment');
    if (M.dist(p1, p2) < 1e-6) throw new Error('segment: the two ends coincide');
    var s = { type: 'segment', point1: copy(p1), point2: copy(p2), oneSided: !!(opts && opts.oneSided) };
    if (s.oneSided) {
      // Internally the colliding side is on the right of point1 -> point2, so swap
      // the ends to put the colliding side on the left of the caller's order.
      var t = s.point1; s.point1 = s.point2; s.point2 = t;
      // The ends behave like square corners of a wall with nothing behind it.
      var n = M.norm(M.rightPerp(M.sub(s.point2, s.point1)));
      s.ghost1 = M.sub(s.point1, n); s.ghost2 = M.sub(s.point2, n);
    }
    return s;
  }

  // Terrain polyline: an array of one-sided chain segments with ghost vertices.
  function chain(points, opts) {
    opts = opts || {};
    var loop = !!opts.loop;
    if (!points || points.length < (loop ? 3 : 2)) throw new Error('chain needs at least ' + (loop ? 3 : 2) + ' points');
    var pts = points.map(function (p) { checkPoint(p, 'chain'); return copy(p); });
    for (var i = 0; i < pts.length - (loop ? 0 : 1); i++) {
      if (M.dist(pts[i], pts[(i + 1) % pts.length]) < 0.005) throw new Error('chain: points ' + i + ' and ' + ((i + 1) % pts.length) + ' are closer than 5 mm');
    }
    // Orient so the colliding side is on the right of each segment.
    var reversed = false;
    if (loop) {
      var a2 = 0; for (var k = 0; k < pts.length; k++) a2 += M.cross(pts[k], pts[(k + 1) % pts.length]);
      // CCW loop -> right is outward. Reverse when that isn't what was asked for.
      if ((a2 > 0) === !!opts.inside) { pts.reverse(); reversed = true; }
    } else if (!opts.flip) {
      pts.reverse(); reversed = true;        // caller's left side is the colliding side
    }
    var n = pts.length, segs = [], count = loop ? n : n - 1;
    for (var s = 0; s < count; s++) {
      var p1 = pts[s], p2 = pts[(s + 1) % n], g1, g2;
      if (loop) { g1 = pts[(s - 1 + n) % n]; g2 = pts[(s + 2) % n]; }
      else {
        var nn = M.norm(M.rightPerp(M.sub(p2, p1)));
        // open ends behave like the square end of a one-sided wall
        g1 = s > 0 ? pts[s - 1] : M.sub(p1, nn);
        g2 = s < count - 1 ? pts[s + 2] : M.sub(p2, nn);
      }
      segs.push({ type: 'chainSegment', point1: copy(p1), point2: copy(p2), ghost1: copy(g1), ghost2: copy(g2), index: 0 });
    }
    // hand the segments back in the caller's order: segs[i] spans points[i] .. points[i + 1]
    if (reversed) segs.reverse();
    if (reversed && loop) segs.push(segs.shift());
    segs.forEach(function (sg, i) { sg.index = i; });
    segs.loop = loop;
    return segs;
  }

  // Area, centroid and polar second moment (about the centroid) of a convex
  // polygon of uniform unit density, by a triangle fan from vertex 0.
  function coreArea(vs) {
    var n = vs.length, ref = vs[0], area = 0, cx = 0, cy = 0, I = 0;
    for (var i = 1; i < n - 1; i++) {
      var e1 = M.sub(vs[i], ref), e2 = M.sub(vs[i + 1], ref);
      var D = M.cross(e1, e2), a = 0.5 * D;
      area += a;
      cx += a * (e1.x + e2.x) / 3; cy += a * (e1.y + e2.y) / 3;
      var intx2 = e1.x * e1.x + e2.x * e1.x + e2.x * e2.x;
      var inty2 = e1.y * e1.y + e2.y * e1.y + e2.y * e2.y;
      I += (0.25 / 3) * D * (intx2 + inty2);
    }
    var c = M.v(cx / area, cy / area);             // relative to ref
    return { area: area, centroid: M.add(ref, c), Ic: I - area * M.lenSq(c) };
  }

  // Accumulates area pieces as (area, centroid, I about the origin).
  function Acc() { this.a = 0; this.mx = 0; this.my = 0; this.I = 0; }
  Acc.prototype.add = function (area, centroid, Ic) {
    this.a += area; this.mx += area * centroid.x; this.my += area * centroid.y;
    this.I += Ic + area * M.lenSq(centroid);
  };
  Acc.prototype.result = function (density) {
    var c = M.v(this.mx / this.a, this.my / this.a);
    return { mass: density * this.a, center: c, I: density * this.I, area: this.a };
  };

  // A circular sector of radius r and opening angle th with its apex at p,
  // bisector along unit vector u. About the apex J = th r^4 / 4; centroid at
  // 4 r sin(th/2) / (3 th) along the bisector.
  function addSector(acc, p, u, r, th) {
    if (th <= 0) return;
    var area = 0.5 * th * r * r, d = 4 * r * Math.sin(0.5 * th) / (3 * th);
    var c = M.mulAdd(p, d, u);
    acc.add(area, c, 0.25 * th * r * r * r * r - area * d * d);
  }

  function massData(shape, density) {
    var t = shape.type;
    if (t === 'circle') {
      var r = shape.radius, m = density * Math.PI * r * r;
      return { mass: m, center: copy(shape.center), I: 0.5 * m * r * r + m * M.lenSq(shape.center), area: Math.PI * r * r };
    }
    if (t === 'segment' || t === 'chainSegment') {
      return { mass: 0, center: M.lerp(shape.point1, shape.point2, 0.5), I: 0, area: 0 };
    }
    if (t === 'capsule') {
      // Rectangle L x 2r plus a full disc split into two half-discs at the ends.
      // Half-disc centroid sits lc = 4r/(3π) beyond its end, so by the parallel
      // axis theorem (twice) the pair about the capsule centre gives
      // m_disc (r²/2 + h² + 2 h lc) with h = L/2.
      var cr = shape.radius, L = M.dist(shape.center1, shape.center2), h = 0.5 * L;
      var mDisc = density * Math.PI * cr * cr, mBox = density * 2 * cr * L, lc = 4 * cr / (3 * Math.PI);
      var Ic = mDisc * (0.5 * cr * cr + h * h + 2 * h * lc) + mBox * (4 * cr * cr + L * L) / 12;
      var mc = mDisc + mBox, cc = M.lerp(shape.center1, shape.center2, 0.5);
      return { mass: mc, center: cc, I: Ic + mc * M.lenSq(cc), area: Math.PI * cr * cr + 2 * cr * L };
    }
    // polygon, possibly rounded: core + one rectangle per edge + one sector per vertex
    var vs = shape.vertices, ns = shape.normals, n = vs.length, rr = shape.radius || 0;
    var core = coreArea(vs);
    if (rr === 0) {
      var mass = density * core.area;
      return { mass: mass, center: core.centroid, I: density * (core.Ic + core.area * M.lenSq(core.centroid)), area: core.area };
    }
    var acc = new Acc();
    acc.add(core.area, core.centroid, core.Ic);
    for (var i = 0; i < n; i++) {
      var a = vs[i], b = vs[(i + 1) % n], nrm = ns[i], L2 = M.dist(a, b);
      // edge strip: L2 x rr rectangle, centred half a radius out from the edge
      acc.add(L2 * rr, M.mulAdd(M.lerp(a, b, 0.5), 0.5 * rr, nrm), L2 * rr * (L2 * L2 + rr * rr) / 12);
      // corner sector between the normals of the edges meeting at b
      var n2 = ns[(i + 1) % n];
      var th = Math.atan2(M.cross(nrm, n2), M.dot(nrm, n2));
      addSector(acc, b, M.norm(M.add(nrm, n2)), rr, th);
    }
    return acc.result(density);
  }

  // World-space axis-aligned bounding box of a shape on a transform.
  function aabb(shape, t) {
    var t2 = shape.type, lo, hi, r;
    if (t2 === 'circle') {
      var p = M.xfPoint(t, shape.center); r = shape.radius;
      return { lo: M.v(p.x - r, p.y - r), hi: M.v(p.x + r, p.y + r) };
    }
    var pts, rr = 0;
    if (t2 === 'capsule') { pts = [shape.center1, shape.center2]; rr = shape.radius; }
    else if (t2 === 'segment' || t2 === 'chainSegment') pts = [shape.point1, shape.point2];
    else { pts = shape.vertices; rr = shape.radius || 0; }
    lo = M.v(Infinity, Infinity); hi = M.v(-Infinity, -Infinity);
    for (var i = 0; i < pts.length; i++) {
      var w = M.xfPoint(t, pts[i]);
      if (w.x < lo.x) lo.x = w.x; if (w.y < lo.y) lo.y = w.y;
      if (w.x > hi.x) hi.x = w.x; if (w.y > hi.y) hi.y = w.y;
    }
    return { lo: M.v(lo.x - rr, lo.y - rr), hi: M.v(hi.x + rr, hi.y + rr) };
  }

  // Squared distance from p to segment a-b.
  function segDistSq(p, a, b) {
    var e = M.sub(b, a), ee = M.lenSq(e), u = ee > 0 ? M.clamp(M.dot(M.sub(p, a), e) / ee, 0, 1) : 0;
    return M.lenSq(M.sub(p, M.mulAdd(a, u, e)));
  }

  // Is a world point inside the shape? Used by the editor to pick parts.
  // Segments and chains have no inside.
  function testPoint(shape, t, pw) {
    var p = M.xfInvPoint(t, pw), ty = shape.type;
    if (ty === 'circle') return M.lenSq(M.sub(p, shape.center)) <= shape.radius * shape.radius;
    if (ty === 'capsule') return segDistSq(p, shape.center1, shape.center2) <= shape.radius * shape.radius;
    if (ty !== 'polygon') return false;
    var rr = shape.radius || 0, outside = false;
    for (var i = 0; i < shape.count; i++) {
      var s = M.dot(shape.normals[i], M.sub(p, shape.vertices[i]));
      if (s > rr) return false;
      if (s > 0) outside = true;
    }
    if (!outside) return true;
    // outside the core but within the rounding band: check the true distance
    for (var j = 0; j < shape.count; j++) {
      if (segDistSq(p, shape.vertices[j], shape.vertices[(j + 1) % shape.count]) <= rr * rr) return true;
    }
    return false;
  }

  SE.phys = SE.phys || {};
  SE.phys.circle = circle;
  SE.phys.capsule = capsule;
  SE.phys.polygon = polygon;
  SE.phys.box = box;
  SE.phys.segment = segment;
  SE.phys.chain = chain;
  SE.phys.massData = massData;
  SE.phys.aabb = aabb;
  SE.phys.testPoint = testPoint;
})(globalThis.SE);
