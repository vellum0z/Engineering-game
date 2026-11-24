/*
 * World queries: ray casts, point and box picks, shape distance.
 *
 *   P.query.rayCast(world, p1, p2, filter)     nearest hit or null
 *       -> { body, fixture, point, normal, fraction }   point = p1 + fraction (p2 - p1)
 *   P.query.rayCastAll(world, p1, p2, filter)  every hit, nearest first
 *   P.query.pointQuery(world, point, filter)   fixtures containing the point, top-most first
 *   P.query.boxQuery(world, lo, hi, filter)    fixtures whose bounding box overlaps lo..hi
 *   P.query.shapeDistance(shapeA, xfA, shapeB, xfB)
 *       -> { distance, pointA, pointB, normal }  0 and the midpoint when they overlap
 *   P.query.rayCastShape(shape, xf, p1, p2, maxFraction)
 *       -> { point, normal, fraction } or null, for one shape
 *
 * `filter(fixture)` returning false skips a fixture. Ray casts also skip
 * sensors. A ray that starts inside a shape doesn't hit it (there is no
 * surface to report), and chain segments and one-sided segments are only
 * hit from their colliding side.
 *
 * Every shape is a core (point, segment, convex polygon) grown by a radius,
 * so a ray against a rounded shape is the nearest of: the core's edges
 * pushed out by the radius, and a circle of that radius at each core vertex.
 * That is exact for circles, capsules and rounded boxes alike.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  function rayCircle(c, r, p1, d, maxF) {
    var m = M.sub(p1, c), b = M.dot(m, d), cc = M.lenSq(m) - r * r, dd = M.lenSq(d);
    if (cc <= 0) return null;                          // starts inside
    var disc = b * b - dd * cc;
    if (disc < 0 || b > 0) return null;
    var t = (-b - Math.sqrt(disc)) / dd;
    if (t < 0 || t > maxF) return null;
    var pt = M.mulAdd(p1, t, d);
    return { point: pt, normal: M.scale(M.sub(pt, c), 1 / r), fraction: t };
  }

  // Ray against segment a-b. Two-sided unless oneSided, in which case only a
  // ray coming from the side the right normal points to can hit.
  function raySegment(a, b, p1, d, maxF, oneSided) {
    var e = M.sub(b, a), n = M.norm(M.rightPerp(e));
    var num = M.dot(n, M.sub(a, p1)), den = M.dot(n, d);
    if (den === 0) return null;
    if (oneSided && num > 0) return null;              // origin behind the face
    var t = num / den;
    if (t < 0 || t > maxF) return null;
    var pt = M.mulAdd(p1, t, d), s = M.dot(M.sub(pt, a), e) / M.lenSq(e);
    if (s < 0 || s > 1) return null;
    return { point: pt, normal: num > 0 ? M.neg(n) : n, fraction: t };
  }

  // Ray against a sharp convex polygon core (Cyrus-Beck clipping).
  function rayPolygon(core, p1, d, maxF) {
    var lower = 0, upper = maxF, index = -1;
    for (var i = 0; i < core.count; i++) {
      var num = M.dot(core.n[i], M.sub(core.v[i], p1)), den = M.dot(core.n[i], d);
      if (den === 0) { if (num < 0) return null; continue; }
      if (den < 0 && num < lower * den) { lower = num / den; index = i; }     // entering
      else if (den > 0 && num < upper * den) upper = num / den;             // leaving
      if (upper < lower) return null;
    }
    if (index < 0) return null;                        // started inside
    return { point: M.mulAdd(p1, lower, d), normal: core.n[index], fraction: lower };
  }

  function insideRounded(core, p) {
    var r2 = core.radius * core.radius, i;
    if (core.count === 1) return M.lenSq(M.sub(p, core.v[0])) <= r2;
    if (core.count >= 3) {
      var inside = true;
      for (i = 0; i < core.count; i++) if (M.dot(core.n[i], M.sub(p, core.v[i])) > 0) { inside = false; break; }
      if (inside) return true;
    }
    var edges = core.count === 2 ? 1 : core.count;
    for (i = 0; i < edges; i++) {
      var r = P.segmentDistance(p, p, core.v[i], core.v[(i + 1) % core.count]);
      if (r.distanceSquared <= r2) return true;
    }
    return false;
  }

  function rayRounded(core, p1, d, maxF) {
    if (insideRounded(core, p1)) return null;
    var best = null, lim = maxF, r = core.radius, i, h;
    var edges = core.count === 1 ? 0 : core.count;     // a 2-gon has two faces, one per side
    for (i = 0; i < edges; i++) {
      var n = core.n[i], den = M.dot(n, d);
      if (den >= 0) continue;
      var a = M.mulAdd(core.v[i], r, n), b = M.mulAdd(core.v[(i + 1) % core.count], r, n);
      var t = M.dot(n, M.sub(a, p1)) / den;
      if (t < 0 || t > lim) continue;
      var pt = M.mulAdd(p1, t, d), e = M.sub(b, a), s = M.dot(M.sub(pt, a), e) / M.lenSq(e);
      if (s < 0 || s > 1) continue;
      best = { point: pt, normal: n, fraction: t }; lim = t;
    }
    for (i = 0; i < core.count; i++) {
      h = rayCircle(core.v[i], r, p1, d, lim);
      if (h) { best = h; lim = h.fraction; }
    }
    return best;
  }

  function rayCastShape(shape, xf, p1, p2, maxFraction) {
    var maxF = maxFraction == null ? 1 : maxFraction, d = M.sub(p2, p1);
    if (M.lenSq(d) === 0) return null;
    var ty = shape.type;
    if (ty === 'segment' || ty === 'chainSegment') {
      return raySegment(M.xfPoint(xf, shape.point1), M.xfPoint(xf, shape.point2), p1, d, maxF,
        ty === 'chainSegment' || shape.oneSided);
    }
    var core = P.shapeCore(shape, xf);
    if (core.radius === 0) return rayPolygon(core, p1, d, maxF);
    return rayRounded(core, p1, d, maxF);
  }

  // Does segment p1 -> p1 + d (fractions 0..maxF) touch the box?
  function rayHitsBox(bb, p1, d, maxF) {
    var lo = 0, hi = maxF;
    var ax = ['x', 'y'];
    for (var k = 0; k < 2; k++) {
      var c = ax[k];
      if (d[c] === 0) { if (p1[c] < bb.lo[c] || p1[c] > bb.hi[c]) return false; continue; }
      var t1 = (bb.lo[c] - p1[c]) / d[c], t2 = (bb.hi[c] - p1[c]) / d[c];
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
      if (t1 > lo) lo = t1; if (t2 < hi) hi = t2;
      if (lo > hi) return false;
    }
    return true;
  }

  function eachFixture(world, filter, fn) {
    for (var i = world.bodies.length - 1; i >= 0; i--) {
      var b = world.bodies[i], t = b.transform();
      for (var j = 0; j < b.fixtures.length; j++) {
        var f = b.fixtures[j];
        if (filter && filter(f) === false) continue;
        if (fn(f, b, t) === false) return;
      }
    }
  }

  function castAll(world, p1, p2, filter, nearestOnly) {
    var d = M.sub(p2, p1), hits = [], lim = 1;
    eachFixture(world, filter, function (f, b, t) {
      if (f.sensor) return;
      if (!rayHitsBox(P.aabb(f.shape, t), p1, d, lim)) return;
      var h = rayCastShape(f.shape, t, p1, p2, lim);
      if (!h) return;
      h.body = b; h.fixture = f;
      hits.push(h);
      if (nearestOnly) lim = h.fraction;
    });
    hits.sort(function (a, b) { return a.fraction - b.fraction; });
    return hits;
  }

  function rayCast(world, p1, p2, filter) { return castAll(world, p1, p2, filter, true)[0] || null; }
  function rayCastAll(world, p1, p2, filter) { return castAll(world, p1, p2, filter, false); }

  function pointQuery(world, point, filter) {
    var out = [];
    eachFixture(world, filter, function (f, b, t) { if (P.testPoint(f.shape, t, point)) out.push(f); });
    return out;
  }

  function boxQuery(world, lo, hi, filter) {
    var out = [];
    eachFixture(world, filter, function (f, b, t) {
      var bb = P.aabb(f.shape, t);
      if (bb.lo.x <= hi.x && bb.hi.x >= lo.x && bb.lo.y <= hi.y && bb.hi.y >= lo.y) out.push(f);
    });
    return out;
  }

  // Distance between two shapes' surfaces: GJK on the cores, minus the radii.
  function shapeDistance(shapeA, xfA, shapeB, xfB) {
    var A = P.shapeCore(shapeA, xfA), B = P.shapeCore(shapeB, xfB);
    var out = P.gjk(A, B), rA = A.radius, rB = B.radius;
    if (out.distance > rA + rB && out.distance > 1e-12) {
      var n = M.scale(M.sub(out.pointB, out.pointA), 1 / out.distance);
      return { distance: out.distance - rA - rB, pointA: M.mulAdd(out.pointA, rA, n), pointB: M.mulAdd(out.pointB, -rB, n), normal: n };
    }
    var mid = M.lerp(out.pointA, out.pointB, 0.5);
    return { distance: 0, pointA: mid, pointB: mid, normal: null };
  }

  P.query = {
    rayCast: rayCast, rayCastAll: rayCastAll, pointQuery: pointQuery, boxQuery: boxQuery,
    shapeDistance: shapeDistance, rayCastShape: rayCastShape
  };
})(globalThis.SE);
