/*
 * Islands and sleeping.
 *
 *   P.islands.update(world, dt)       after each step: sleep still islands
 *   P.islands.beforeStep(world)       called by the broadphase before the
 *                                     solver: wake islands that were reached
 *   P.islands.wakeIsland(world, body) wake a body and everything in its island
 *   P.islands.islandOf(world, body)   the bodies sharing body's island (array)
 *
 * An island is a set of dynamic bodies linked by contacts (any contact with
 * a manifold, speculative ones included) or by joints, found with union-find each step. Static bodies never join an
 * island (a floor would otherwise glue the whole level into one island), and
 * neither do kinematic ones; a kinematic body that is moving keeps every
 * island it touches awake.
 *
 * A body is "still" while |v| < SLEEP_LINEAR (0.01 m/s),
 * |w| < SLEEP_ANGULAR (0.5°/s) and every joint and touching contact on it
 * has settled: its force changed by less than SETTLE_TOLERANCE (1e-4)
 * relative to its size since the last step. body.sleepTime counts how long
 * it has been still; it must also stay within SLEEP_DRIFT (1 mm) and
 * 0.1° of where it was when the still time started, so slow creep doesn't
 * count as rest. When every body in an island has been still for
 * TIME_TO_SLEEP (0.5 s), the whole island sleeps: awake = false, v = w = 0.
 * The force check matters for statics: soft joints keep creeping towards
 * equilibrium long after the bodies look still, and a structure must not
 * freeze before its gauges read the equilibrium values. Each threshold can
 * be overridden on world.cfg (sleepLinear, sleepAngular, timeToSleep,
 * sleepSettleTolerance). The world then
 * skips those bodies, and skips contacts and joints whose bodies are all
 * asleep or static, so a settled stack costs nothing. The contact impulses
 * are kept, so the stack warm-starts when it wakes.
 *
 * An island wakes when any body in it is woken (applyForce, applyImpulse,
 * applyTorque, setTransform or wake()), when a sleeping body is given a
 * velocity directly, when an awake body (or a moving kinematic one) reaches
 * it through a contact or a joint, when a joint on it is added or removed,
 * and when a joint on it breaks.
 *
 * world.cfg.enableSleep = false keeps everything awake. A body made with
 * allowSleep: false never sleeps and keeps its island awake.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;

  var SLEEP_LINEAR = 0.01;                    // m/s
  var SLEEP_ANGULAR = 0.5 * Math.PI / 180;     // rad/s
  var TIME_TO_SLEEP = 0.5;                     // s
  var SLEEP_DRIFT = 0.001;                     // m a body may creep during its still time
  var SLEEP_DRIFT_ANGLE = 0.1 * Math.PI / 180;   // rad
  var SETTLE_TOLERANCE = 1e-4;                 // relative change in a force per step
  var FORCE_FLOOR = 1;                         // N (or N·m): below this, changes count as absolute

  function cfgOr(world, k, d) { var v = world.cfg && world.cfg[k]; return v == null ? d : v; }

  // Has a force stopped changing? Relative change against the larger of the
  // two readings, with a 1 N floor so a force that is near zero isn't judged
  // by its rounding noise.
  function settled(now, prev, tol, ref) {
    if (prev == null) return false;
    var d = Math.abs(now - prev), scale = Math.max(Math.abs(now), Math.abs(prev), ref || 0, FORCE_FLOOR);
    return d <= tol * scale;
  }

  function enabled(world) { return !world.cfg || world.cfg.enableSleep !== false; }
  function moving(b) { return b.v.x !== 0 || b.v.y !== 0 || b.w !== 0; }

  function find(b) {
    while (b._ufParent !== b) { b._ufParent = b._ufParent._ufParent; b = b._ufParent; }
    return b;
  }
  function union(a, b) {
    var ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra._ufRank < rb._ufRank) { var t = ra; ra = rb; rb = t; }
    rb._ufParent = ra;
    if (ra._ufRank === rb._ufRank) ra._ufRank++;
  }

  function islandOf(world, body) {
    var map = world._islands;
    var isl = map && body._island != null ? map.get(body._island) : null;
    return isl && isl.indexOf(body) >= 0 ? isl : [body];
  }

  function wakeIsland(world, body) {
    var isl = islandOf(world, body), woke = false;
    for (var i = 0; i < isl.length; i++) {
      var b = isl[i];
      if (b.type === 'static') continue;
      if (b.awake === false) { woke = true; }
      if (b.awake === false || b === body) { b.awake = true; b.sleepTime = 0; }
    }
    return woke;
  }

  // Wake rules that must hold before the solver runs.
  function beforeStep(world) {
    var bodies = world.bodies, i, b;
    if (!enabled(world)) {
      for (i = 0; i < bodies.length; i++) if (bodies[i].awake === false) bodies[i].wake();
      return;
    }
    // a velocity set by hand on a sleeping body, or a kinematic body set moving
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (b.type !== 'static' && b.awake === false && moving(b)) wakeIsland(world, b);
    }
    // an island with any awake member is awake as a whole
    if (world._islands) world._islands.forEach(function (isl) {
      var anyAwake = false, anyAsleep = false;
      for (var k = 0; k < isl.length; k++) { if (isl[k].awake === false) anyAsleep = true; else anyAwake = true; }
      if (anyAwake && anyAsleep) for (k = 0; k < isl.length; k++) if (isl[k].awake === false) { isl[k].awake = true; isl[k].sleepTime = 0; }
    });
    // an awake body reaching a sleeping one through a contact or joint wakes
    // it; repeat because the newly woken island may reach another
    function reach(A, B) {
      var aOn = A.type !== 'static' && A.awake !== false, bOn = B.type !== 'static' && B.awake !== false;
      if (aOn && !bOn && B.type === 'dynamic') return wakeIsland(world, B);
      if (bOn && !aOn && A.type === 'dynamic') return wakeIsland(world, A);
      return false;
    }
    for (var pass = 0; pass < 8; pass++) {
      var changed = false;
      world.contacts.forEach(function (ct) { if (reach(ct.fa.body, ct.fb.body)) changed = true; });
      world.joints.forEach(function (j) { if (j.bodyA && j.bodyB && reach(j.bodyA, j.bodyB)) changed = true; });
      if (!changed) break;
    }
  }

  function update(world, dt) {
    var bodies = world.bodies, i, b;
    // a joint that broke this step (or was removed) wakes its bodies
    if (P.broadphase && P.broadphase.syncJoints) P.broadphase.syncJoints(world);
    if (!enabled(world)) {
      for (i = 0; i < bodies.length; i++) { bodies[i].awake = true; bodies[i].sleepTime = 0; }
      world._islands = null;
      return;
    }
    // union-find over dynamic bodies
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      b._ufParent = b; b._ufRank = 0; b._keepAwake = false;
      if (b.sleepTime == null) b.sleepTime = 0;
    }
    function link(A, B, touching) {
      var dA = A.type === 'dynamic', dB = B.type === 'dynamic';
      if (dA && dB) { if (touching) union(A, B); return; }
      // a moving kinematic body keeps whatever it touches awake
      if (dA && B.type === 'kinematic' && moving(B)) A._keepAwake = true;
      if (dB && A.type === 'kinematic' && moving(A)) B._keepAwake = true;
    }
    // every contact with a manifold links its bodies, speculative ones too
    // (as in Box2D 3): a box resting a hair above the one below is still
    // part of the stack, and must not sleep on top of a moving body
    world.contacts.forEach(function (ct) { link(ct.fa.body, ct.fb.body, true); });
    world.joints.forEach(function (j) { if (j.bodyA && j.bodyB) link(j.bodyA, j.bodyB, true); });

    // forces still changing keep their bodies awake (sleeping ones are frozen
    // and so read as settled)
    var tol = cfgOr(world, 'sleepSettleTolerance', SETTLE_TOLERANCE);
    function unsettle(A, B) { A._unsettled = true; B._unsettled = true; }
    for (i = 0; i < bodies.length; i++) bodies[i]._unsettled = false;
    world.joints.forEach(function (j) {
      if (!j.bodyA || !j.bodyB) return;
      var F = j.lastForce != null ? j.lastForce : j.force(), T = j.lastTorque || 0;
      var ok = settled(F, j._sleepForce, tol) && settled(T, j._sleepTorque, tol);
      j._sleepForce = F; j._sleepTorque = T;
      if (!ok) unsettle(j.bodyA, j.bodyB);
    });
    world.contacts.forEach(function (ct) {
      if (!ct.touching) return;
      var N = 0, Tn = 0, invH = world.substeps / dt;
      for (var q = 0; q < ct.points.length; q++) { N += ct.points[q].normalImpulse; Tn += ct.points[q].tangentImpulse; }
      N *= invH; Tn *= invH;
      // friction is judged against the normal force it is bounded by
      var ok = settled(N, ct._sleepN, tol) && settled(Tn, ct._sleepT, tol, Math.abs(N));
      ct._sleepN = N; ct._sleepT = Tn;
      if (!ok) unsettle(ct.fa.body, ct.fb.body);
    });
    var linTol = cfgOr(world, 'sleepLinear', SLEEP_LINEAR), angTol = cfgOr(world, 'sleepAngular', SLEEP_ANGULAR);
    var timeToSleep = cfgOr(world, 'timeToSleep', TIME_TO_SLEEP);

    // still-time per awake body
    var groups = new Map();
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (b.type === 'static') continue;
      if (b.type === 'kinematic') {
        // a kinematic body at rest sleeps so it doesn't keep contacts alive
        b.awake = moving(b); b.sleepTime = 0; b._island = null;
        continue;
      }
      if (b.awake !== false) {
        var still = b.allowSleep !== false && !b._keepAwake && !b._unsettled &&
          b.v.x * b.v.x + b.v.y * b.v.y < linTol * linTol && Math.abs(b.w) < angTol;
        // slow creep (a tall soft column rocking at a few mm/s) is under the
        // speed limits, so a body must also stay put while its still time runs
        var an = b._sleepAnchor;
        if (still && an && (Math.abs(b.c.x - an.x) > SLEEP_DRIFT || Math.abs(b.c.y - an.y) > SLEEP_DRIFT ||
            Math.abs(b.angle - an.a) > SLEEP_DRIFT_ANGLE)) still = false;
        if (still && b.sleepTime > 0 && an) b.sleepTime += dt;
        else if (still) { b.sleepTime = dt; b._sleepAnchor = { x: b.c.x, y: b.c.y, a: b.angle }; }
        else { b.sleepTime = 0; b._sleepAnchor = null; }
      }
      var root = find(b);
      var g = groups.get(root.id);
      if (!g) groups.set(root.id, g = []);
      g.push(b);
      b._island = root.id;
    }

    // sleep islands whose every body has been still long enough
    groups.forEach(function (isl) {
      var minSleep = Infinity, anyAwake = false, k;
      for (k = 0; k < isl.length; k++) {
        if (isl[k].awake === false) continue;
        anyAwake = true;
        if (isl[k].sleepTime < minSleep) minSleep = isl[k].sleepTime;
      }
      if (!anyAwake) return;
      if (minSleep >= timeToSleep) {
        for (k = 0; k < isl.length; k++) {
          var s = isl[k];
          s.awake = false; s.v = { x: 0, y: 0 }; s.w = 0;
        }
      } else {
        for (k = 0; k < isl.length; k++) if (isl[k].awake === false) { isl[k].awake = true; isl[k].sleepTime = 0; }
      }
    });
    world._islands = groups;
  }

  P.SLEEP_LINEAR = SLEEP_LINEAR;
  P.SLEEP_ANGULAR = SLEEP_ANGULAR;
  P.TIME_TO_SLEEP = TIME_TO_SLEEP;
  P.SLEEP_SETTLE_TOLERANCE = SETTLE_TOLERANCE;
  P.islands = { update: update, beforeStep: beforeStep, wakeIsland: wakeIsland, islandOf: islandOf };
})(globalThis.SE);
