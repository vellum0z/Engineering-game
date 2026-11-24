/*
 * Broadphase and contact bookkeeping.
 *
 *   P.broadphase.update(world)
 * finds every pair of fixtures whose fattened boxes overlap, runs the
 * narrowphase (P.collide) on them, and replaces world.contacts with a Map of
 * key -> contact. A contact that existed last step keeps its points' impulses
 * (matched by feature id) so the solver can warm-start.
 *
 * A contact is
 *   { key, fa, fb, manifold, points: [{ point, separation, id,
 *     normalImpulse, tangentImpulse }], touching, isNew }
 * with fa.body.id < fb.body.id, so the normal always points from fa to fb.
 *
 *   P.broadphase.shouldCollide(world, fa, fb)
 * is the single filtering rule: sensors, shared groups, static-static and
 * bodies joined by a joint (unless collideConnected) never collide.
 *
 * The current pass is sort-and-sweep on x, rebuilt every step.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  function shouldCollide(world, fa, fb) {
    var A = fa.body, B = fb.body;
    if (A === B) return false;
    if (A.type !== 'dynamic' && B.type !== 'dynamic') return false;
    if (fa.sensor || fb.sensor) return false;
    if (fa.group && fa.group === fb.group) return false;
    if (world.jointed(A, B)) return false;
    return true;
  }

  function update(world) {
    var items = [], pad = P.SPECULATIVE;
    world.bodies.forEach(function (b) {
      var t = b.transform();
      b.fixtures.forEach(function (f, i) {
        var bb = P.aabb(f.shape, t);
        items.push({ f: f, b: b, key: b.id + ':' + i, t: t,
          lo: M.v(bb.lo.x - pad, bb.lo.y - pad), hi: M.v(bb.hi.x + pad, bb.hi.y + pad) });
      });
    });
    items.sort(function (a, b) { return a.lo.x - b.lo.x; });
    var next = new Map();
    for (var i = 0; i < items.length; i++) {
      var A = items[i];
      for (var j = i + 1; j < items.length; j++) {
        var B = items[j];
        if (B.lo.x > A.hi.x) break;
        if (B.lo.y > A.hi.y || B.hi.y < A.lo.y) continue;
        if (!shouldCollide(world, A.f, B.f)) continue;
        // stable order so the normal always points the same way
        var first = A.b.id < B.b.id ? A : B, second = first === A ? B : A;
        var man = P.collide(first.f.shape, first.t, second.f.shape, second.t);
        if (!man) continue;
        var key = first.key + '|' + second.key;
        var old = world.contacts.get(key);
        var points = man.points.map(function (p) {
          var cp = { point: p.point, separation: p.separation, id: p.id, normalImpulse: 0, tangentImpulse: 0 };
          if (old) old.points.forEach(function (o) { if (o.id === p.id) { cp.normalImpulse = o.normalImpulse; cp.tangentImpulse = o.tangentImpulse; } });
          return cp;
        });
        var ct = { key: key, fa: first.f, fb: second.f, manifold: man, points: points,
          touching: man.points.some(function (p) { return p.separation < P.LINEAR_SLOP; }) };
        ct.isNew = !old || !old.touching;
        next.set(key, ct);
      }
    }
    world.contacts = next;
  }

  P.broadphase = { update: update, shouldCollide: shouldCollide };
})(globalThis.SE);
