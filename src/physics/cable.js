/*
 * Cables and chains made of links, so they sag, drape and snap visibly.
 *
 *   var c = SE.phys.cable.build(world, {
 *     from: { body, localAnchor }, to: { body, localAnchor },
 *     length,                    total unstretched length, m (default: the span, taut)
 *     segments,                  number of links (default: about one per 0.5 m)
 *     path,                      optional world points to lay it along at the start
 *     material, diameter,        e.g. 'steel', 0.012 m: weight and stretch from the
 *                                material's density and E (A = π d²/4)
 *     massPerLength, EA,         or give them directly (kg/m, N)
 *     breakForce,                N, for every link, or function (i) -> N
 *     linearDamping,             on the nodes, 1/s (default 0.5, air drag)
 *     label
 *   });
 *   -> { bodies, joints, tensionAt(i), maxTension(), weakest(), intact(), ... }
 *
 * The model is the lumped-mass chain statics texts use for a cable under its
 * own weight: segments-1 small round nodes, each carrying the weight of one
 * link, joined by rope links (pull-only DistanceJoints). With EA known the
 * links stretch by T·l/(EA); without it they are inextensible. The ends hang
 * on the given bodies. Nodes share a collision group so a cable doesn't
 * snag on itself, but it does drape over other parts.
 *
 * Every link is a joint with a breakForce, so the cable snaps where the
 * tension first exceeds its rating: for a uniform cable that is the link
 * with the highest tension (near the supports of a sagging span).
 *
 *   SE.phys.cable.catenary(span, length, w)
 * solves the textbook catenary between level supports: length = 2a·sinh(S/2a),
 * returns { a, sag, H, Tmax } with H = w·a (horizontal tension, N) and
 * Tmax = w·(a + sag) (tension at the supports), for w in N/m.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var nextGroup = -0x40000;   // negative: links of one cable never collide with each other

  function catenary(span, length, w) {
    if (length <= span) return { a: Infinity, sag: 0, H: Infinity, Tmax: Infinity };
    // length / span = sinh(x)/x with x = S/(2a); solve for x by bisection
    var r = length / span, lo = 1e-9, hi = 1;
    while (Math.sinh(hi) / hi < r) hi *= 2;
    for (var i = 0; i < 200; i++) {
      var mid = 0.5 * (lo + hi);
      if (Math.sinh(mid) / mid < r) lo = mid; else hi = mid;
    }
    var x = 0.5 * (lo + hi), a = span / (2 * x), sag = a * (Math.cosh(x) - 1);
    return { a: a, sag: sag, H: w * a, Tmax: w * (a + sag) };
  }

  // Points k/n of the way along a polyline, k = 1..n-1, by arc length.
  function along(poly, n) {
    var lens = [], tot = 0, i;
    for (i = 0; i + 1 < poly.length; i++) { lens.push(M.dist(poly[i], poly[i + 1])); tot += lens[i]; }
    var pts = [], seg = 0, start = 0;
    for (var k = 1; k < n; k++) {
      var s = tot * k / n;
      while (seg < lens.length - 1 && s > start + lens[seg]) { start += lens[seg]; seg++; }
      pts.push(M.lerp(poly[seg], poly[seg + 1], lens[seg] > 0 ? (s - start) / lens[seg] : 0));
    }
    return pts;
  }

  // Lay `length` of cable from p to q: along `path` if given, straight if
  // taut, else a V that hangs below the chord with the right total length.
  // The solver pulls it into shape.
  function layout(p, q, length, n, path) {
    if (path && path.length) return along([p].concat(path, [q]), n);
    var chord = M.dist(p, q), mid = M.lerp(p, q, 0.5), low = mid;
    if (length > chord + 1e-9) {
      var lo = 0, hi = length;
      for (var i = 0; i < 100; i++) {
        var d = 0.5 * (lo + hi), pt = M.v(mid.x, mid.y - d);
        if (M.dist(p, pt) + M.dist(pt, q) < length) lo = d; else hi = d;
      }
      low = M.v(mid.x, mid.y - 0.5 * (lo + hi));
    }
    return along([p, low, q], n);
  }

  function build(world, o) {
    var from = o.from, to = o.to;
    var la = from.localAnchor || M.v(0, 0), lb = to.localAnchor || M.v(0, 0);
    var p = from.body.worldPoint(la), q = to.body.worldPoint(lb);
    var length = o.length || M.dist(p, q);
    var n = o.segments || Math.max(2, Math.round(length / 0.5));
    var mat = P.material(o.material || 'steel');
    var area = o.diameter ? Math.PI * o.diameter * o.diameter / 4 : 0;
    var mpl = o.massPerLength || (area ? mat.density * area : 1);
    var EA = o.EA || (area && mat.E ? mat.E * area : 0);
    var linkLen = length / n, radius = Math.max(0.01, (o.diameter || 0.02) / 2);
    var group = nextGroup--, label = o.label || 'cable';
    var rating = typeof o.breakForce === 'function' ? o.breakForce : function () { return o.breakForce == null ? Infinity : o.breakForce; };

    var bodies = layout(p, q, length, n, o.path).map(function (pt, i) {
      return world.add(new P.Body({
        position: pt, mass: mpl * linkLen, fixedRotation: true,
        linearDamping: o.linearDamping == null ? 0.5 : o.linearDamping,
        shapes: [{ shape: P.circle(radius), material: mat, group: group }],
        label: label + ' node ' + i
      }));
    });
    var ends = [{ body: from.body, local: la }].concat(bodies.map(function (b) { return { body: b, local: M.v(0, 0) }; }), [{ body: to.body, local: lb }]);
    var joints = [];
    for (var i = 0; i < n; i++) {
      joints.push(world.addJoint(new P.DistanceJoint({
        bodyA: ends[i].body, localAnchorA: ends[i].local,
        bodyB: ends[i + 1].body, localAnchorB: ends[i + 1].local,
        length: linkLen, rope: true, EA: EA, breakForce: rating(i),
        label: label + ' link ' + i, userData: { cable: label, link: i }
      })));
    }

    return {
      bodies: bodies, joints: joints, length: length, linkLength: linkLen,
      massPerLength: mpl, EA: EA, group: group,
      tensionAt: function (i) { return joints[i].broken ? 0 : Math.max(0, joints[i].tension()); },
      maxTension: function () { return Math.max.apply(null, joints.map(function (j, k) { return this.tensionAt(k); }, this)); },
      // index of the link closest to its rating right now
      weakest: function () {
        var best = 0, worst = -1;
        joints.forEach(function (j, k) { var u = Math.max(0, j.tension()) / j.breakForce; if (u > worst) { worst = u; best = k; } });
        return best;
      },
      intact: function () { return joints.every(function (j) { return !j.broken; }); }
    };
  }

  P.cable = { build: build, catenary: catenary };
})(globalThis.SE);
