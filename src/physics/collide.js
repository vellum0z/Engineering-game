/*
 * Narrowphase: contact manifolds between pairs of shapes.
 *
 * collide(shapeA, xfA, shapeB, xfB) returns null or
 *   { normal: {x, y} (world, pointing from A to B),
 *     points: [{ point: {x, y} (world, midway between the surfaces),
 *                separation (m, negative = overlap), id }] }
 * Points are reported up to SPECULATIVE metres apart so the solver can stop
 * fast bodies before they pass through each other (speculative contacts, as
 * in Box2D 3). Polygons use the separating axis test plus reference/incident
 * edge clipping, which gives up to two points per pair.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  var LINEAR_SLOP = 0.005;
  var SPECULATIVE = 4 * LINEAR_SLOP;

  function worldPoly(shape, t) {
    return {
      v: shape.vertices.map(function (p) { return M.xfPoint(t, p); }),
      n: shape.normals.map(function (n) { return M.rotate(t.q, n); }),
      count: shape.count
    };
  }

  function circleCircle(a, ta, b, tb) {
    var pa = M.xfPoint(ta, a.center), pb = M.xfPoint(tb, b.center);
    var d = M.sub(pb, pa), dist = M.len(d);
    var sep = dist - a.radius - b.radius;
    if (sep > SPECULATIVE) return null;
    var n = dist > 1e-9 ? M.scale(d, 1 / dist) : M.v(0, 1);
    var ca = M.mulAdd(pa, a.radius, n), cb = M.mulAdd(pb, -b.radius, n);
    return { normal: n, points: [{ point: M.lerp(ca, cb, 0.5), separation: sep, id: 0 }] };
  }

  function polygonCircle(a, ta, b, tb) {
    var poly = worldPoly(a, ta), c = M.xfPoint(tb, b.center), r = b.radius;
    // face of greatest separation from the circle centre
    var best = -Infinity, bi = 0;
    for (var i = 0; i < poly.count; i++) {
      var s = M.dot(poly.n[i], M.sub(c, poly.v[i]));
      if (s > best) { best = s; bi = i; }
    }
    var v1 = poly.v[bi], v2 = poly.v[(bi + 1) % poly.count];
    var n, cp, sep;
    var u1 = M.dot(M.sub(c, v1), M.sub(v2, v1)), u2 = M.dot(M.sub(c, v2), M.sub(v1, v2));
    if (best > 0 && u1 < 0) {            // vertex region of v1
      var d1 = M.sub(c, v1), l1 = M.len(d1);
      sep = l1 - r; if (sep > SPECULATIVE) return null;
      n = M.scale(d1, 1 / l1); cp = v1;
    } else if (best > 0 && u2 < 0) {     // vertex region of v2
      var d2 = M.sub(c, v2), l2 = M.len(d2);
      sep = l2 - r; if (sep > SPECULATIVE) return null;
      n = M.scale(d2, 1 / l2); cp = v2;
    } else {                             // face region
      sep = best - r; if (sep > SPECULATIVE) return null;
      n = poly.n[bi]; cp = M.mulAdd(c, -best, n);
    }
    var onCircle = M.mulAdd(c, -r, n);
    return { normal: n, points: [{ point: M.lerp(cp, onCircle, 0.5), separation: sep, id: bi }] };
  }

  // Largest separation of polygon q from the faces of polygon p.
  function maxSeparation(p, q) {
    var best = -Infinity, bi = 0;
    for (var i = 0; i < p.count; i++) {
      var n = p.n[i], v = p.v[i], smin = Infinity;
      for (var j = 0; j < q.count; j++) {
        var s = M.dot(n, M.sub(q.v[j], v));
        if (s < smin) smin = s;
      }
      if (smin > best) { best = smin; bi = i; }
    }
    return { sep: best, index: bi };
  }

  function polygonPolygon(a, ta, b, tb) {
    var pa = worldPoly(a, ta), pb = worldPoly(b, tb);
    var ea = maxSeparation(pa, pb); if (ea.sep > SPECULATIVE) return null;
    var eb = maxSeparation(pb, pa); if (eb.sep > SPECULATIVE) return null;
    var ref, inc, ri, flip;
    if (eb.sep > ea.sep + 0.1 * LINEAR_SLOP) { ref = pb; inc = pa; ri = eb.index; flip = true; }
    else { ref = pa; inc = pb; ri = ea.index; flip = false; }
    var rn = ref.n[ri];
    // incident edge: the one most anti-parallel to the reference normal
    var ii = 0, minDot = Infinity;
    for (var i = 0; i < inc.count; i++) { var d = M.dot(rn, inc.n[i]); if (d < minDot) { minDot = d; ii = i; } }
    var i1 = inc.v[ii], i2 = inc.v[(ii + 1) % inc.count];
    var r1 = ref.v[ri], r2 = ref.v[(ri + 1) % ref.count];
    var tangent = M.norm(M.sub(r2, r1));
    // clip the incident segment to the side planes of the reference edge
    var pts = [{ p: i1, id: ii }, { p: i2, id: (ii + 1) % inc.count }];
    pts = clip(pts, M.neg(tangent), -M.dot(tangent, r1), ri);
    if (pts.length < 2) return null;
    pts = clip(pts, tangent, M.dot(tangent, r2), ri);
    if (pts.length < 2) return null;
    var out = [];
    pts.forEach(function (cp) {
      var sep = M.dot(rn, M.sub(cp.p, r1));
      if (sep <= SPECULATIVE) {
        var onRef = M.mulAdd(cp.p, -sep, rn);
        out.push({ point: M.lerp(cp.p, onRef, 0.5), separation: sep, id: (flip ? 1000 : 0) + ri * 100 + cp.id });
      }
    });
    if (!out.length) return null;
    return { normal: flip ? M.neg(rn) : rn, points: out };
  }

  // Keep the parts of a two-point segment with dot(n, p) <= offset.
  function clip(pts, n, offset, refIndex) {
    var d0 = M.dot(n, pts[0].p) - offset, d1 = M.dot(n, pts[1].p) - offset, out = [];
    if (d0 <= 0) out.push(pts[0]);
    if (d1 <= 0) out.push(pts[1]);
    if (d0 * d1 < 0) {
      var t = d0 / (d0 - d1);
      // a clipped point keeps the id of the incident vertex it replaces, so the
      // id doesn't flip when a vertex sits exactly on a side plane
      out.push({ p: M.lerp(pts[0].p, pts[1].p, t), id: d0 > 0 ? pts[0].id : pts[1].id });
    }
    return out;
  }

  function collide(a, ta, b, tb) {
    if (a.type === 'circle' && b.type === 'circle') return circleCircle(a, ta, b, tb);
    if (a.type === 'polygon' && b.type === 'circle') return polygonCircle(a, ta, b, tb);
    if (a.type === 'circle' && b.type === 'polygon') {
      var m = polygonCircle(b, tb, a, ta);
      if (m) m.normal = M.neg(m.normal);
      return m;
    }
    return polygonPolygon(a, ta, b, tb);
  }

  P.collide = collide;
  P.LINEAR_SLOP = LINEAR_SLOP;
  P.SPECULATIVE = SPECULATIVE;
})(globalThis.SE);
