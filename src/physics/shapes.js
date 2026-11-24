/*
 * Collision shapes and their mass properties.
 *
 * A shape is defined in its body's local frame:
 *   circle   { type: 'circle', radius, center: {x, y} }
 *   polygon  { type: 'polygon', vertices: [{x, y}...] (convex, CCW), normals, radius: 0 }
 * Use SE.phys.circle(), SE.phys.box() and SE.phys.polygon() to make them.
 *
 * massData(shape, density) returns { mass, center, I } where I is the
 * rotational inertia about the body origin, so a body can sum its shapes
 * directly before shifting to its centre of mass.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath;

  function circle(radius, center) {
    return { type: 'circle', radius: radius, center: center ? M.v(center.x, center.y) : M.v(0, 0) };
  }

  // Convex hull (gift wrapping is enough for the handful of vertices a part has).
  function hull(points) {
    var pts = points.map(function (p) { return M.v(p.x, p.y); });
    if (pts.length < 3) throw new Error('polygon needs at least 3 points');
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
    // gift wrapping above walks clockwise; flip to counter-clockwise
    return out.reverse();
  }

  function polygon(points, radius) {
    var vs = hull(points);
    var area2 = 0; for (var k = 0; k < vs.length; k++) area2 += M.cross(vs[k], vs[(k + 1) % vs.length]);
    if (area2 < 0) vs.reverse();
    var ns = vs.map(function (a, i) { var b = vs[(i + 1) % vs.length]; return M.norm(M.rightPerp(M.sub(b, a))); });
    return { type: 'polygon', vertices: vs, normals: ns, radius: radius || 0, count: vs.length };
  }

  // Box of half-width hw and half-height hh, optionally offset and rotated in the body frame.
  function box(hw, hh, center, angle) {
    var q = M.rot(angle || 0), c = center || M.v(0, 0);
    var corners = [M.v(-hw, -hh), M.v(hw, -hh), M.v(hw, hh), M.v(-hw, hh)].map(function (p) { return M.add(M.rotate(q, p), c); });
    return polygon(corners);
  }

  function massData(shape, density) {
    if (shape.type === 'circle') {
      var r = shape.radius, m = density * Math.PI * r * r;
      var Ic = 0.5 * m * r * r;
      return { mass: m, center: M.v(shape.center.x, shape.center.y), I: Ic + m * M.lenSq(shape.center) };
    }
    // polygon: triangle fan from a reference point inside the polygon
    var vs = shape.vertices, n = vs.length, ref = vs[0];
    var area = 0, cx = 0, cy = 0, I = 0;
    for (var i = 1; i < n - 1; i++) {
      var e1 = M.sub(vs[i], ref), e2 = M.sub(vs[i + 1], ref);
      var D = M.cross(e1, e2), a = 0.5 * D;
      area += a;
      cx += a * (e1.x + e2.x) / 3; cy += a * (e1.y + e2.y) / 3;
      var intx2 = e1.x * e1.x + e2.x * e1.x + e2.x * e2.x;
      var inty2 = e1.y * e1.y + e2.y * e1.y + e2.y * e2.y;
      I += (0.25 / 3) * D * (intx2 + inty2);
    }
    var mass = density * area;
    var c = M.v(cx / area, cy / area);                 // centroid relative to ref
    var center = M.add(ref, c);
    // I about ref -> about centroid -> about body origin
    var Iref = density * I;
    var Icen = Iref - mass * M.lenSq(c);
    return { mass: mass, center: center, I: Icen + mass * M.lenSq(center), area: area };
  }

  // World-space axis-aligned bounding box of a shape on a transform.
  function aabb(shape, t) {
    if (shape.type === 'circle') {
      var p = M.xfPoint(t, shape.center), r = shape.radius;
      return { lo: M.v(p.x - r, p.y - r), hi: M.v(p.x + r, p.y + r) };
    }
    var lo = M.v(Infinity, Infinity), hi = M.v(-Infinity, -Infinity);
    shape.vertices.forEach(function (vl) {
      var w = M.xfPoint(t, vl);
      if (w.x < lo.x) lo.x = w.x; if (w.y < lo.y) lo.y = w.y;
      if (w.x > hi.x) hi.x = w.x; if (w.y > hi.y) hi.y = w.y;
    });
    var rr = shape.radius || 0;
    return { lo: M.v(lo.x - rr, lo.y - rr), hi: M.v(hi.x + rr, hi.y + rr) };
  }

  // Is a world point inside the shape? Used by the editor to pick parts.
  function testPoint(shape, t, pw) {
    var p = M.xfInvPoint(t, pw);
    if (shape.type === 'circle') return M.lenSq(M.sub(p, shape.center)) <= shape.radius * shape.radius;
    for (var i = 0; i < shape.count; i++) {
      if (M.dot(shape.normals[i], M.sub(p, shape.vertices[i])) > shape.radius) return false;
    }
    return true;
  }

  SE.phys = SE.phys || {};
  SE.phys.circle = circle;
  SE.phys.polygon = polygon;
  SE.phys.box = box;
  SE.phys.massData = massData;
  SE.phys.aabb = aabb;
  SE.phys.testPoint = testPoint;
})(globalThis.SE);
