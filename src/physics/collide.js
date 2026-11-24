/*
 * Narrowphase: contact manifolds between pairs of shapes.
 *
 *   P.collide(shapeA, xfA, shapeB, xfB) -> null or
 *     { normal: {x, y} (world, pointing from A to B),
 *       points: [{ point: {x, y} (world, midway between the surfaces),
 *                  separation (m, negative = overlap), id }] }   at most 2 points
 *
 * Points are reported up to SPECULATIVE metres apart so the solver can stop
 * fast bodies before they pass through each other (speculative contacts, as
 * in Box2D 3).
 *
 * Method (after Box2D 3's manifold.c). Every shape is a convex "core" grown
 * by a radius: a circle is a rounded point, a capsule a rounded segment, a
 * rounded box a smaller box plus a radius. So:
 *   - circle pairs and capsule/circle use closest points directly;
 *   - polygon/circle finds the face of greatest separation, then decides
 *     between the face and its two vertex regions;
 *   - polygon/polygon (capsules and two-sided segments are 2-gons here) uses
 *     the separating axis test on the cores, then clips the incident edge
 *     against the reference edge's side planes to get up to two points. When
 *     the cores are apart and the nearest features are two vertices, one
 *     point along the vertex-vertex line is used instead;
 *   - chain segments (and one-sided segments) are one-sided and look at their
 *     ghost vertices, the far ends of the neighbouring segments. A contact
 *     normal that belongs to a neighbour is skipped, and one that would point
 *     into a flat or concave joint is snapped to the segment normal. That is
 *     what keeps a box sliding along terrain from catching on internal
 *     vertices.
 *
 * Feature ids pack (feature on A) << 8 | (feature on B), where a feature is a
 * vertex or edge index. They stay the same while the configuration does, so
 * the broadphase can carry warm-start impulses from step to step.
 *
 * Also exported for query.js: P.gjk(proxyA, proxyB), the GJK distance between
 * two convex point sets, and P.shapeCore(shape, xf), a shape's core in world
 * space.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  var LINEAR_SLOP = 0.005;
  var SPECULATIVE = 4 * LINEAR_SLOP;
  var EPS = 1e-12;

  function makeId(a, b) { return ((a & 0xff) << 8) | (b & 0xff); }

  /* ------------------------------------------------------------ cores */
  // World-space core: vertices v, edge normals n (polygon rule: right of each
  // edge v[i] -> v[i+1]), count, radius, centroid.
  function shapeCore(shape, t) {
    var ty = shape.type;
    if (ty === 'circle') {
      var c = M.xfPoint(t, shape.center);
      return { v: [c], n: [], count: 1, radius: shape.radius, centroid: c };
    }
    if (ty === 'polygon') {
      var vs = new Array(shape.count), ns = new Array(shape.count);
      for (var i = 0; i < shape.count; i++) { vs[i] = M.xfPoint(t, shape.vertices[i]); ns[i] = M.rotate(t.q, shape.normals[i]); }
      return { v: vs, n: ns, count: shape.count, radius: shape.radius || 0,
        centroid: M.xfPoint(t, shape.centroid || shape.vertices[0]) };
    }
    var a, b, r = 0;
    if (ty === 'capsule') { a = shape.center1; b = shape.center2; r = shape.radius; }
    else { a = shape.point1; b = shape.point2; }
    return twoGon(M.xfPoint(t, a), M.xfPoint(t, b), r);
  }

  function twoGon(p1, p2, r) {
    var nr = M.norm(M.rightPerp(M.sub(p2, p1)));
    return { v: [p1, p2], n: [nr, M.neg(nr)], count: 2, radius: r, centroid: M.lerp(p1, p2, 0.5) };
  }

  /* -------------------------------------------------------------- GJK */
  // Distance between the convex hulls of two point sets (radii ignored).
  // Returns { pointA, pointB, distance, count, indexA: [], indexB: [] } where
  // the index lists name the simplex vertices on each set (1-3 of them).
  function support(pr, d) {
    var best = 0, bv = M.dot(pr.v[0], d);
    for (var i = 1; i < pr.count; i++) { var s = M.dot(pr.v[i], d); if (s > bv) { bv = s; best = i; } }
    return best;
  }
  function vert(A, B, iA, iB) {
    var wA = A.v[iA], wB = B.v[iB];
    return { wA: wA, wB: wB, w: M.sub(wB, wA), a: 1, iA: iA, iB: iB };
  }
  function solve2(s) {
    var w1 = s[0].w, w2 = s[1].w, e12 = M.sub(w2, w1);
    var d12_2 = -M.dot(w1, e12);
    if (d12_2 <= 0) { s[0].a = 1; s.length = 1; return; }
    var d12_1 = M.dot(w2, e12);
    if (d12_1 <= 0) { s[1].a = 1; s[0] = s[1]; s.length = 1; return; }
    var inv = 1 / (d12_1 + d12_2);
    s[0].a = d12_1 * inv; s[1].a = d12_2 * inv;
  }
  function solve3(s) {
    var w1 = s[0].w, w2 = s[1].w, w3 = s[2].w;
    var e12 = M.sub(w2, w1), d12_1 = M.dot(w2, e12), d12_2 = -M.dot(w1, e12);
    var e13 = M.sub(w3, w1), d13_1 = M.dot(w3, e13), d13_2 = -M.dot(w1, e13);
    var e23 = M.sub(w3, w2), d23_1 = M.dot(w3, e23), d23_2 = -M.dot(w2, e23);
    var n123 = M.cross(e12, e13);
    var d123_1 = n123 * M.cross(w2, w3), d123_2 = n123 * M.cross(w3, w1), d123_3 = n123 * M.cross(w1, w2);
    var inv;
    if (d12_2 <= 0 && d13_2 <= 0) { s[0].a = 1; s.length = 1; return; }
    if (d12_1 > 0 && d12_2 > 0 && d123_3 <= 0) { inv = 1 / (d12_1 + d12_2); s[0].a = d12_1 * inv; s[1].a = d12_2 * inv; s.length = 2; return; }
    if (d13_1 > 0 && d13_2 > 0 && d123_2 <= 0) { inv = 1 / (d13_1 + d13_2); s[0].a = d13_1 * inv; s[2].a = d13_2 * inv; s[1] = s[2]; s.length = 2; return; }
    if (d12_1 <= 0 && d23_2 <= 0) { s[1].a = 1; s[0] = s[1]; s.length = 1; return; }
    if (d13_1 <= 0 && d23_1 <= 0) { s[2].a = 1; s[0] = s[2]; s.length = 1; return; }
    if (d23_1 > 0 && d23_2 > 0 && d123_1 <= 0) { inv = 1 / (d23_1 + d23_2); s[2].a = d23_2 * inv; s[1].a = d23_1 * inv; s[0] = s[2]; s.length = 2; return; }
    inv = 1 / (d123_1 + d123_2 + d123_3);
    s[0].a = d123_1 * inv; s[1].a = d123_2 * inv; s[2].a = d123_3 * inv;
  }
  function gjk(A, B) {
    var s = [vert(A, B, 0, 0)];
    var saveA = [], saveB = [];
    for (var iter = 0; iter < 40; iter++) {
      saveA.length = 0; saveB.length = 0;
      for (var k = 0; k < s.length; k++) { saveA.push(s[k].iA); saveB.push(s[k].iB); }
      if (s.length === 2) solve2(s); else if (s.length === 3) solve3(s);
      if (s.length === 3) break;                      // origin inside: overlap
      var d;
      if (s.length === 1) d = M.neg(s[0].w);
      else {
        var e12 = M.sub(s[1].w, s[0].w);
        d = M.cross(e12, M.neg(s[0].w)) > 0 ? M.perp(e12) : M.rightPerp(e12);
      }
      if (M.lenSq(d) < EPS * EPS) break;              // origin on the simplex
      var iA = support(A, M.neg(d)), iB = support(B, d), dup = false;
      for (var j = 0; j < saveA.length; j++) if (saveA[j] === iA && saveB[j] === iB) { dup = true; break; }
      if (dup) break;
      s.push(vert(A, B, iA, iB));
    }
    var pA, pB;
    if (s.length === 1) { pA = s[0].wA; pB = s[0].wB; }
    else if (s.length === 2) {
      pA = M.add(M.scale(s[0].wA, s[0].a), M.scale(s[1].wA, s[1].a));
      pB = M.add(M.scale(s[0].wB, s[0].a), M.scale(s[1].wB, s[1].a));
    } else {
      pA = M.add(M.add(M.scale(s[0].wA, s[0].a), M.scale(s[1].wA, s[1].a)), M.scale(s[2].wA, s[2].a));
      pB = pA;
    }
    return { pointA: pA, pointB: pB, distance: s.length === 3 ? 0 : M.dist(pA, pB), count: s.length,
      indexA: s.map(function (x) { return x.iA; }), indexB: s.map(function (x) { return x.iB; }) };
  }

  // Closest points between segments p1-q1 and p2-q2 (fractions along each).
  function segmentDistance(p1, q1, p2, q2) {
    var d1 = M.sub(q1, p1), d2 = M.sub(q2, p2), r = M.sub(p1, p2);
    var dd1 = M.lenSq(d1), dd2 = M.lenSq(d2), rd1 = M.dot(r, d1), rd2 = M.dot(r, d2);
    var f1 = 0, f2 = 0;
    if (dd1 < EPS || dd2 < EPS) {
      if (dd1 >= EPS) f1 = M.clamp(-rd1 / dd1, 0, 1);
      else if (dd2 >= EPS) f2 = M.clamp(rd2 / dd2, 0, 1);
    } else {
      var d12 = M.dot(d1, d2), denom = dd1 * dd2 - d12 * d12;
      if (denom > 1e-12 * dd1 * dd2) f1 = M.clamp((d12 * rd2 - rd1 * dd2) / denom, 0, 1);
      f2 = (d12 * f1 + rd2) / dd2;
      if (f2 < 0) { f2 = 0; f1 = M.clamp(-rd1 / dd1, 0, 1); }
      else if (f2 > 1) { f2 = 1; f1 = M.clamp((d12 - rd1) / dd1, 0, 1); }
    }
    var c1 = M.mulAdd(p1, f1, d1), c2 = M.mulAdd(p2, f2, d2);
    return { fraction1: f1, fraction2: f2, closest1: c1, closest2: c2, distanceSquared: M.lenSq(M.sub(c2, c1)) };
  }

  /* ---------------------------------------------------- manifold helpers */
  function single(normal, pA, pB, rA, rB, dist, id) {
    var cA = M.mulAdd(pA, rA, normal), cB = M.mulAdd(pB, -rB, normal);
    var sep = dist - rA - rB;
    if (sep > SPECULATIVE) return null;
    return { normal: normal, points: [{ point: M.lerp(cA, cB, 0.5), separation: sep, id: id }] };
  }

  function cull(m) {
    if (!m) return null;
    var pts = m.points.filter(function (p) { return p.separation <= SPECULATIVE; });
    if (!pts.length) return null;
    m.points = pts;
    return m;
  }

  /* -------------------------------------------------------- round pairs */
  function circleCircle(A, B) {
    var pa = A.v[0], pb = B.v[0], d = M.sub(pb, pa), dist = M.len(d);
    var n = dist > EPS ? M.scale(d, 1 / dist) : M.v(0, 1);
    return single(n, pa, pb, A.radius, B.radius, dist, 0);
  }

  // A is a 2-gon (capsule or two-sided segment), B a circle.
  function capsuleCircle(A, B) {
    var p1 = A.v[0], p2 = A.v[1], c = B.v[0], e = M.sub(p2, p1);
    var u = M.clamp(M.dot(M.sub(c, p1), e) / M.lenSq(e), 0, 1);
    var pA = M.mulAdd(p1, u, e), d = M.sub(c, pA), dist = M.len(d);
    var n = dist > EPS ? M.scale(d, 1 / dist) : A.n[0];
    return single(n, pA, c, A.radius, B.radius, dist, 0);
  }

  // A is a polygon core (count >= 3, maybe rounded), B a circle.
  function polygonCircle(A, B) {
    var c = B.v[0], rA = A.radius, rB = B.radius, radius = rA + rB;
    var sep = -Infinity, ni = 0;
    for (var i = 0; i < A.count; i++) {
      var s = M.dot(A.n[i], M.sub(c, A.v[i]));
      if (s > sep) { sep = s; ni = i; }
    }
    if (sep - radius > SPECULATIVE) return null;
    var v1 = A.v[ni], v2 = A.v[(ni + 1) % A.count];
    var u1 = M.dot(M.sub(c, v1), M.sub(v2, v1)), u2 = M.dot(M.sub(c, v2), M.sub(v1, v2));
    var corner = null;
    if (u1 < 0 && sep > EPS) corner = v1;          // vertex region of v1, centre safely outside
    else if (u2 < 0 && sep > EPS) corner = v2;
    if (corner) {
      var d = M.sub(c, corner), dist = M.len(d);
      return single(M.scale(d, 1 / dist), corner, c, rA, rB, dist, 0);
    }
    // face region (the centre may be inside the core)
    var n = A.n[ni];
    var cA = M.mulAdd(c, rA - M.dot(M.sub(c, v1), n), n), cB = M.mulAdd(c, -rB, n);
    return { normal: n, points: [{ point: M.lerp(cA, cB, 0.5), separation: M.dot(M.sub(cB, cA), n), id: 0 }] };
  }

  /* ---------------------------------------------------- polygon pairs */
  // Largest separation of q's vertices from the faces of p.
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

  function incidentEdge(p, dir) {
    var ii = 0, minDot = Infinity;
    for (var i = 0; i < p.count; i++) { var d = M.dot(dir, p.n[i]); if (d < minDot) { minDot = d; ii = i; } }
    return ii;
  }

  // Clip incident edge b1 -> b2 against reference edge a1 -> a2 (normal n).
  // ra, rb are the reference and incident radii. Returns null when the edges
  // don't overlap along the reference edge.
  function clipSegments(a1, a2, b1, b2, n, ra, rb, id1, id2) {
    var t = M.perp(n);
    var lower1 = 0, upper1 = M.dot(M.sub(a2, a1), t);
    // the incident edge runs against the tangent (both polygons wind CCW)
    var upper2 = M.dot(M.sub(b1, a1), t), lower2 = M.dot(M.sub(b2, a1), t);
    if (upper2 < lower1 || upper1 < lower2) return null;
    var span = upper2 - lower2;
    var vLower = (lower2 < lower1 && span > EPS) ? M.lerp(b2, b1, (lower1 - lower2) / span) : b2;
    var vUpper = (upper2 > upper1 && span > EPS) ? M.lerp(b2, b1, (upper1 - lower2) / span) : b1;
    var sLower = M.dot(M.sub(vLower, a1), n), sUpper = M.dot(M.sub(vUpper, a1), n);
    // contact points midway between the two surfaces
    vLower = M.mulAdd(vLower, 0.5 * (ra - rb - sLower), n);
    vUpper = M.mulAdd(vUpper, 0.5 * (ra - rb - sUpper), n);
    return { normal: n, points: [
      { point: vLower, separation: sLower - ra - rb, id: id1 },
      { point: vUpper, separation: sUpper - ra - rb, id: id2 }] };
  }

  function clipPolygons(A, B, edgeA, edgeB, flip) {
    var ref = flip ? B : A, inc = flip ? A : B;
    var i11 = flip ? edgeB : edgeA, i12 = (i11 + 1) % ref.count;
    var i21 = flip ? edgeA : edgeB, i22 = (i21 + 1) % inc.count;
    var m = clipSegments(ref.v[i11], ref.v[i12], inc.v[i21], inc.v[i22], ref.n[i11], ref.radius, inc.radius,
      flip ? makeId(i22, i11) : makeId(i11, i22), flip ? makeId(i21, i12) : makeId(i12, i21));
    if (!m) return null;
    if (flip) { m.normal = M.neg(m.normal); m.points.reverse(); }
    return m;
  }

  // Nearest points of the two chosen edges; one point along their line.
  function edgePoint(A, B, edgeA, edgeB) {
    var i11 = edgeA, i12 = (edgeA + 1) % A.count, i21 = edgeB, i22 = (edgeB + 1) % B.count;
    var r = segmentDistance(A.v[i11], A.v[i12], B.v[i21], B.v[i22]);
    var d = Math.sqrt(r.distanceSquared);
    if (d < EPS) return null;
    var n = M.scale(M.sub(r.closest2, r.closest1), 1 / d);
    var fa = r.fraction1 === 0 ? i11 : (r.fraction1 === 1 ? i12 : i11);
    var fb = r.fraction2 === 0 ? i21 : (r.fraction2 === 1 ? i22 : i21);
    return { res: r, m: single(n, r.closest1, r.closest2, A.radius, B.radius, d, makeId(fa, fb)) };
  }

  // A and B are cores with count >= 2 (polygons, capsules, two-sided segments).
  function collidePolygons(A, B) {
    var radius = A.radius + B.radius;
    var sa = maxSeparation(A, B); if (sa.sep > SPECULATIVE + radius) return null;
    var sb = maxSeparation(B, A); if (sb.sep > SPECULATIVE + radius) return null;
    var flip, edgeA, edgeB;
    if (sb.sep > sa.sep + 0.1 * LINEAR_SLOP) { flip = true; edgeB = sb.index; edgeA = incidentEdge(A, B.n[edgeB]); }
    else { flip = false; edgeA = sa.index; edgeB = incidentEdge(B, A.n[edgeA]); }
    var m = null;
    if (Math.max(sa.sep, sb.sep) > 0.1 * LINEAR_SLOP) {
      // cores apart: if the nearest features are two vertices, use one point between them
      var ep = edgePoint(A, B, edgeA, edgeB);
      if (ep) {
        var f1 = ep.res.fraction1, f2 = ep.res.fraction2;
        if ((f1 === 0 || f1 === 1) && (f2 === 0 || f2 === 1)) return ep.m;
      }
      m = clipPolygons(A, B, edgeA, edgeB, flip);
      if (!m && ep) return ep.m;
    } else {
      m = clipPolygons(A, B, edgeA, edgeB, flip);
      if (!m) {
        // The incident edge lies past the end of the reference edge (two
        // segments end to end, say): fall back to the nearest points.
        var ep2 = edgePoint(A, B, edgeA, edgeB);
        if (ep2) return ep2.m;
        var n0 = flip ? M.neg(B.n[edgeB]) : A.n[edgeA];
        var pa = A.v[edgeA];
        return single(n0, pa, pa, A.radius, B.radius, 0, makeId(edgeA, edgeB));
      }
    }
    return cull(m);
  }

  /* ----------------------------------------------------- chain segments */
  // World-space chain segment with the neighbour information Box2D calls
  // "smooth params": edge1 (unit direction), normal1, the neighbours'
  // normals and whether each joint is convex.
  function chainInfo(shape, t) {
    var p1 = M.xfPoint(t, shape.point1), p2 = M.xfPoint(t, shape.point2);
    var g1 = M.xfPoint(t, shape.ghost1), g2 = M.xfPoint(t, shape.ghost2);
    var edge1 = M.norm(M.sub(p2, p1)), edge0 = M.norm(M.sub(p1, g1)), edge2 = M.norm(M.sub(g2, p2));
    var convexTol = 0.01;
    return { p1: p1, p2: p2, g1: g1, g2: g2, edge1: edge1, normal1: M.rightPerp(edge1),
      normal0: M.rightPerp(edge0), normal2: M.rightPerp(edge2),
      convex1: M.cross(edge0, edge1) >= convexTol, convex2: M.cross(edge1, edge2) >= convexTol };
  }

  var ADMIT = 0, SKIP = 1, SNAP = 2;
  // Is a candidate normal (pointing away from the segment) ours, a
  // neighbour's, or one to snap to our face normal?
  function classify(S, n) {
    var sinTol = 0.01;
    if (M.dot(n, S.edge1) < 0) {           // leans toward point1
      if (!S.convex1) return SNAP;
      return M.cross(n, S.normal0) > sinTol ? SKIP : ADMIT;
    }
    if (!S.convex2) return SNAP;
    return M.cross(S.normal2, n) > sinTol ? SKIP : ADMIT;
  }

  function chainCircle(S, B) {
    var p1 = S.p1, p2 = S.p2, c = B.v[0], e = M.sub(p2, p1);
    if (M.dot(M.rightPerp(e), M.sub(c, p1)) < 0) return null;      // one-sided
    var u = M.dot(e, M.sub(p2, c)), v = M.dot(e, M.sub(c, p1)), pA;
    if (v <= 0) {
      // before point1: the previous segment owns it unless we're past its end too
      if (M.dot(M.sub(p1, S.g1), M.sub(c, p1)) <= 0) return null;
      pA = p1;
    } else if (u <= 0) {
      if (M.dot(M.sub(S.g2, p2), M.sub(c, p2)) > 0) return null;
      pA = p2;
    } else {
      pA = M.scale(M.add(M.scale(p1, u), M.scale(p2, v)), 1 / M.lenSq(e));
    }
    var d = M.sub(c, pA), dist = M.len(d);
    var n = dist > EPS ? M.scale(d, 1 / dist) : S.normal1;
    return single(n, pA, c, 0, B.radius, dist, 0);
  }

  // S is a chain segment, B a polygon or capsule core.
  function chainPolygon(S, B) {
    var p1 = S.p1, p2 = S.p2, normal1 = S.normal1, rB = B.radius, cnt = B.count;
    var vs = B.v, ns = B.n;
    var behind1 = M.dot(normal1, M.sub(B.centroid, p1)) < 0;
    var behind0 = S.convex1 ? M.dot(S.normal0, M.sub(B.centroid, p1)) < 0 : true;
    var behind2 = S.convex2 ? M.dot(S.normal2, M.sub(B.centroid, p2)) < 0 : true;
    if (behind1 && behind0 && behind2) return null;                 // one-sided

    var segProxy = { v: [p1, p2], count: 2 };
    var out = gjk(segProxy, B);
    if (out.distance > rB + SPECULATIVE) return null;

    // concave joints snap to our own normal
    var n0 = S.convex1 ? S.normal0 : normal1, n2 = S.convex2 ? S.normal2 : normal1;
    var incidentIndex = -1, incidentNormal = -1, i, s, type;

    if (!behind1 && out.distance > 0.1 * LINEAR_SLOP) {
      if (out.count === 1) {
        // vertex-vertex
        var pA = out.pointA, pB = out.pointB, nrm = M.scale(M.sub(pB, pA), 1 / out.distance);
        type = classify(S, nrm);
        if (type === SKIP) return null;
        if (type === ADMIT) return single(nrm, pA, pB, 0, rB, out.distance, makeId(out.indexA[0], out.indexB[0]));
        incidentIndex = out.indexB[0];
      } else {
        var ia1 = out.indexA[0], ia2 = out.indexA[1], ib1 = out.indexB[0], ib2 = out.indexB[1];
        if (ia1 === ia2) {
          // a segment vertex against a polygon edge: take the polygon normal
          // most aligned with the line between the closest points
          var dirB = M.sub(out.pointA, out.pointB);
          var ib = M.dot(dirB, ns[ib1]) > M.dot(dirB, ns[ib2]) ? ib1 : ib2;
          var normalB = ns[ib];
          type = classify(S, M.neg(normalB));
          if (type === SKIP) return null;
          if (type === ADMIT) {
            var j1 = ib, j2 = (ib + 1) % cnt, b1 = vs[j1];
            var dt1 = M.dot(normalB, M.sub(p1, b1)), dt2 = M.dot(normalB, M.sub(p2, b1));
            if (dt1 < dt2) { if (M.dot(n0, normalB) < M.dot(normal1, normalB)) return null; }  // neighbour is incident
            else if (M.dot(n2, normalB) < M.dot(normal1, normalB)) return null;
            var mm = clipSegments(b1, vs[j2], p1, p2, normalB, rB, 0, makeId(1, j1), makeId(0, j2));
            if (!mm) return null;
            mm.normal = M.neg(normalB);
            return cull(mm);
          }
          incidentNormal = ib;
        } else {
          var e1 = M.dot(normal1, M.sub(vs[ib1], p1)), e2 = M.dot(normal1, M.sub(vs[ib2], p2));
          incidentIndex = e1 < e2 ? ib1 : ib2;
        }
      }
    } else {
      // separating axis test against our normal and the convex neighbours'
      var edgeSep = Infinity;
      for (i = 0; i < cnt; i++) { s = M.dot(normal1, M.sub(vs[i], p1)); if (s < edgeSep) { edgeSep = s; incidentIndex = i; } }
      if (S.convex1) {
        var s0 = Infinity;
        for (i = 0; i < cnt; i++) { s = M.dot(S.normal0, M.sub(vs[i], p1)); if (s < s0) s0 = s; }
        if (s0 > edgeSep) { edgeSep = s0; incidentIndex = -1; }     // the neighbour owns it
      }
      if (S.convex2) {
        var s2 = Infinity;
        for (i = 0; i < cnt; i++) { s = M.dot(S.normal2, M.sub(vs[i], p2)); if (s < s2) s2 = s; }
        if (s2 > edgeSep) { edgeSep = s2; incidentIndex = -1; }
      }
      // ...and against the polygon's own face normals
      var polySep = -Infinity, refIndex = -1;
      for (i = 0; i < cnt; i++) {
        var n = ns[i];
        if (classify(S, M.neg(n)) !== ADMIT) continue;
        var pv = vs[i];
        s = Math.min(M.dot(n, M.sub(p2, pv)), M.dot(n, M.sub(p1, pv)));
        if (s > polySep) { polySep = s; refIndex = i; }
      }
      if (polySep > edgeSep) {
        var a1i = refIndex, a2i = (refIndex + 1) % cnt, a1 = vs[a1i], nn = ns[a1i];
        var q1 = M.dot(nn, M.sub(p1, a1)), q2 = M.dot(nn, M.sub(p2, a1));
        if (q1 < q2) { if (M.dot(n0, nn) < M.dot(normal1, nn)) return null; }
        else if (M.dot(n2, nn) < M.dot(normal1, nn)) return null;
        var m2 = clipSegments(a1, vs[a2i], p1, p2, nn, rB, 0, makeId(1, a1i), makeId(0, a2i));
        if (!m2) return null;
        m2.normal = M.neg(nn);
        return cull(m2);
      }
      if (incidentIndex === -1) return null;                        // a neighbour does it better
    }

    // Our face is the reference. Incident polygon edge: of the two edges at
    // the incident vertex, the one most anti-parallel to our normal.
    var k1, k2;
    if (incidentNormal !== -1) { k1 = incidentNormal; k2 = (k1 + 1) % cnt; }
    else {
      var j = incidentIndex, jPrev = (j - 1 + cnt) % cnt;
      if (M.dot(normal1, ns[jPrev]) < M.dot(normal1, ns[j])) { k1 = jPrev; k2 = j; }
      else { k1 = j; k2 = (j + 1) % cnt; }
    }
    return cull(clipSegments(p1, p2, vs[k1], vs[k2], normal1, 0, rB, makeId(0, k2), makeId(1, k1)));
  }

  /* ------------------------------------------------------------ dispatch */
  function chainLike(s) { return s.type === 'chainSegment' || (s.type === 'segment' && s.oneSided); }
  // Pairs are solved with the lower rank as A; the other order flips the normal.
  function rank(s) {
    if (chainLike(s)) return 0;
    switch (s.type) { case 'segment': return 1; case 'polygon': return 2; case 'capsule': return 3; default: return 4; }
  }

  function collidePair(a, ta, b, tb) {
    var ra = rank(a), rb = rank(b);
    if (rb <= 1) return null;                         // segment/chain against segment/chain: both static
    var B = shapeCore(b, tb);
    if (ra === 0) {
      var S = chainInfo(a, ta);
      return rb === 4 ? chainCircle(S, B) : chainPolygon(S, B);
    }
    var A = shapeCore(a, ta);
    if (rb === 4) {
      if (ra === 4) return circleCircle(A, B);
      if (A.count === 2) return capsuleCircle(A, B);
      return polygonCircle(A, B);
    }
    return collidePolygons(A, B);
  }

  function collide(a, ta, b, tb) {
    if (rank(a) > rank(b)) {
      var m = collidePair(b, tb, a, ta);
      if (m) m.normal = M.neg(m.normal);
      return m;
    }
    return collidePair(a, ta, b, tb);
  }

  P.collide = collide;
  P.gjk = gjk;
  P.segmentDistance = segmentDistance;
  P.shapeCore = shapeCore;
  P.LINEAR_SLOP = LINEAR_SLOP;
  P.SPECULATIVE = SPECULATIVE;
})(globalThis.SE);
