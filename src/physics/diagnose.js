/*
 * Build diagnostics: things in a player's build that the engine can't
 * simulate faithfully. The yard shows them as plain warnings ("these parts
 * overlap", "this pin is far too light for what hangs on it") instead of
 * letting the simulation quietly produce wrong physics.
 *
 *   var issues = P.diagnose(world, { dt: 1/60 });
 *   // [{ code, severity: 'error' | 'warning' | 'info', message,
 *   //    bodies: [Body], joints: [Joint], fixtures: [fixture], value }]
 *
 * Severity: 'error' = the sim will be visibly wrong or blow up; 'warning' =
 * results will be off (soft, stretchy, may pass through); 'info' = a hint
 * (a part close to its rating). `value` is the number behind the verdict
 * (ratio, depth in m, speed in m/s...), handy for tests and tooltips.
 *
 * Checks
 *   overlap               parts that start inside each other (> 1 cm). Only
 *                         before the first step, or with { build: true }.
 *   mass-ratio-joint      rigid joint between two bodies whose effective
 *                         masses at the joint differ hugely. The effective
 *                         mass 1/(1/m + r²/I) includes the lever arm, so a
 *                         small part on a long arm counts as very light.
 *   mass-ratio-stack      a heavy part resting on a much lighter one.
 *   light-carries-heavy   a heavy part hanging from the ground through a
 *                         joint path with a much lighter part in it.
 *   redundant-pins        two pins at different points between the same two
 *                         parts (that's a weld); the solver fights itself.
 *   redundant-joints      more joints between two parts than they have
 *                         freedoms (e.g. a weld plus a pin): harmless, but the
 *                         extra joint carries no load and its reading is
 *                         meaningless.
 *   anchor-far            a joint anchor much further from its part than the
 *                         part is big (lever arm over 10x its size).
 *   tunnel-risk           a part that moves more than a part's thickness in
 *                         one step towards something it could pass through.
 *   unstable              NaN, or speeds near the engine's cap.
 *   speed-jump            a part's speed jumped by an implausible amount in
 *                         one step (the start of a blow-up).
 *   near-break            a joint above 80% of its rating (info).
 *
 * The thresholds are in P.diagnose.limits; they were picked from scripted
 * experiments against the engine (see tests/physics-e09-diagnose.test.js)
 * and should be re-tuned as the solver gets better.
 *
 * Cost: the structural checks only depend on which parts and joints exist
 * and their masses, so they're cached per world and redone only when that
 * changes. The overlap pass is cached on the bodies' poses. What's left each
 * frame is O(bodies + joints + contacts).
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  var LIMITS = {
    overlapDepth: 0.01,          // m
    restGap: 0.1,                // m: a part this close above another will rest on it
    overlapError: 0.5,           // overlap deeper than this share of the thinner part
    jointRatioWarn: 100,         // effective-mass ratio across a rigid joint
    jointRatioError: 1000,       //   rods: 1:100 drifts ~2 cm, 1:1000 ~20 cm
    stackRatioWarn: 100,         // heavy on light: 1:100 sinks ~1-2 cm
    stackRatioError: 300,        //   1:300 sinks ~5 cm, 1:1000 is crushed through
    carryRatioWarn: 100,         // heaviest load / lightest part on its path to ground
    carryRatioError: 1000,
    leverWarn: 10,               // anchor distance / part size
    leverError: 25,              //   a 0.2 m part on a 5 m arm blows up
    tunnelFactor: 0.75,          // flag when v·dt > factor · (own + other thickness)
    unstableSpeed: 0.9,          // fraction of world.cfg.maxLinearSpeed
    unstableSpin: 500,           // rad/s
    jumpSpeed: 30,               // m/s change in one step, and more than 3x the old speed
    nearBreak: 0.8               // utilisation for an info hint
  };

  var cache = new WeakMap();     // world -> { sig, structural, poseSig, overlap, prev }
  var thick = new WeakMap();     // shape -> smallest thickness (m)

  /* ------------------------------------------------------------ helpers */
  function issue(code, severity, message, bodies, joints, value, fixtures) {
    return { code: code, severity: severity, message: message, bodies: bodies || [], joints: joints || [], fixtures: fixtures || [], value: value };
  }
  function dynamic(b) { return b && b.type === 'dynamic'; }
  function nameOf(b) { return b.label || ('part ' + b.id); }
  function fmtRatio(r) { return r >= 1e4 ? '1:' + r.toExponential(0).replace('e+', 'e') : '1:' + Math.round(r); }

  // Smallest width of a shape across any direction (circle: diameter).
  function shapeThickness(s) {
    var t = thick.get(s);
    if (t != null) return t;
    if (s.type === 'circle' || s.type === 'capsule') t = 2 * s.radius;
    else if (s.type === 'polygon') {
      t = Infinity;
      for (var i = 0; i < s.count; i++) {
        var n = s.normals[i], lo = Infinity, hi = -Infinity;
        for (var k = 0; k < s.count; k++) { var d = M.dot(n, s.vertices[k]); if (d < lo) lo = d; if (d > hi) hi = d; }
        if (hi - lo < t) t = hi - lo;
      }
      t += 2 * (s.radius || 0);
    } else t = 0;                                  // segments: no thickness at all
    thick.set(s, t);
    return t;
  }
  function bodyThickness(b) {
    var t = Infinity;
    for (var i = 0; i < b.fixtures.length; i++) if (!b.fixtures[i].sensor) t = Math.min(t, shapeThickness(b.fixtures[i].shape));
    return t;
  }
  // Radius of the part around its centre of mass (half its biggest extent).
  function bodySize(b) {
    var bb = b.aabb();
    if (!isFinite(bb.lo.x)) return 0;
    var c = b.c, rx = Math.max(c.x - bb.lo.x, bb.hi.x - c.x), ry = Math.max(c.y - bb.lo.y, bb.hi.y - c.y);
    return Math.max(rx, ry, 0.01);
  }
  // Mass the body presents at a world point, in the worst direction.
  function effMass(b, p) {
    if (!dynamic(b)) return Infinity;
    var r2 = M.lenSq(M.sub(p, b.c));
    var k = b.invM + b.invI * r2;
    return k > 0 ? 1 / k : Infinity;
  }
  function anchors(j) {
    var a = null, b = null;
    try { a = j.anchorA(); b = j.anchorB(); } catch (e) { /* joints without anchors */ }
    return { a: a, b: b };
  }
  // Does this joint hold its two bodies rigidly along at least one direction?
  // Returns the number of constraint rows (0 = soft or one-sided only).
  function rows(j) {
    switch (j.type) {
      case 'revolute': return 2;
      case 'weld': return j.angularStiffness > 0 || j.linearStiffness > 0 ? 2 : 3;
      case 'prismatic': return 2;
      case 'roller': return 1;
      case 'distance': return j.spring ? 0 : (j.rope ? 0 : 1);
      default: return 0;                           // mouse, winch, pulley, springs
    }
  }
  // Load-bearing link for the carry check: rigid joints and ropes.
  function bearing(j) {
    if (j.type === 'distance') return !j.spring;
    return j.type === 'revolute' || j.type === 'weld' || j.type === 'prismatic' || j.type === 'roller';
  }
  function skipJoint(j) { return j.broken || j.internal || j.part || !j.bodyA || !j.bodyB; }

  /* ------------------------------------------------- structural checks */
  function signature(world) {
    var h = world.bodies.length * 31 + world.joints.length;
    for (var i = 0; i < world.bodies.length; i++) {
      var b = world.bodies[i];
      h = (h * 33 + b.id) | 0; h = (h * 33 + (b.type === 'dynamic' ? 1 : 2)) | 0;
      h = (h * 33 + Math.round(b.m * 1000)) | 0; h = (h * 33 + Math.round(b.I * 1e6)) | 0;
    }
    for (var k = 0; k < world.joints.length; k++) {
      var j = world.joints[k];
      h = (h * 33 + j.id) | 0; h = (h * 33 + (j.broken ? 1 : 0)) | 0;
    }
    return h;
  }

  function structural(world) {
    var out = [], L = LIMITS, joints = world.joints.filter(function (j) { return !skipJoint(j); });
    var groundKey = function (b) { return dynamic(b) ? b.id : 0; };

    // joints pair by pair
    var pairs = new Map();
    joints.forEach(function (j) {
      var ka = groundKey(j.bodyA), kb = groundKey(j.bodyB);
      if (ka === kb) return;
      var key = ka < kb ? ka + ':' + kb : kb + ':' + ka;
      var list = pairs.get(key); if (!list) pairs.set(key, list = []);
      list.push(j);
    });
    pairs.forEach(function (list) {
      var pins = list.filter(function (j) { return j.type === 'revolute'; });
      var bodies = [list[0].bodyA, list[0].bodyB];
      if (pins.length >= 2) {
        var p0 = pins[0].anchorA(), apart = pins.some(function (j) { return M.dist(j.anchorA(), p0) > 0.001; });
        if (apart) {
          out.push(issue('redundant-pins', 'error', 'Two pins lock the same two parts together. Use one weld instead.', bodies, pins, pins.length));
          return;
        }
      }
      var n = list.reduce(function (s, j) { return s + rows(j); }, 0);
      if (n > 3) out.push(issue('redundant-joints', 'warning', 'More joints than needed between these two parts. The extra ones carry no load.', bodies, list, n));
    });

    // ropes hanging from a winch hook or pulley block are solved together
    // with the winch line as one block, so the hook's mass doesn't matter
    var hooks = new Set();
    joints.forEach(function (j) { if (j.type === 'winch' || j.type === 'pulley') { hooks.add(j.bodyA); hooks.add(j.bodyB); } });

    // each rigid joint between two moving parts: mass ratio and lever arm
    joints.forEach(function (j) {
      var A = j.bodyA, B = j.bodyB, an = anchors(j);
      if (!an.a || !an.b) return;
      if (rows(j) > 0 || (j.type === 'distance' && j.rope)) {
        if (dynamic(A) && dynamic(B) && !(j.rope && (hooks.has(A) || hooks.has(B)))) {
          var mA = effMass(A, an.a), mB = effMass(B, an.b);
          var r = Math.max(mA, mB) / Math.min(mA, mB);
          if (r > L.jointRatioWarn) {
            var light = mA < mB ? A : B;
            out.push(issue('mass-ratio-joint', r > L.jointRatioError ? 'error' : 'warning',
              'Mass ratio ' + fmtRatio(r) + ' across this joint: ' + nameOf(light) + ' is far too light for what it holds, so the joint will stretch' + (r > L.jointRatioError ? ' and may fly apart.' : '.'),
              [A, B], [j], r));
          }
        }
        [[A, an.a], [B, an.b]].forEach(function (pair) {
          var b = pair[0]; if (!dynamic(b)) return;
          var size = bodySize(b), arm = M.dist(pair[1], b.c), q = arm / size;
          if (q > L.leverWarn) {
            out.push(issue('anchor-far', q > L.leverError ? 'error' : 'warning',
              'This joint is ' + arm.toFixed(1) + ' m from ' + nameOf(b) + ', ' + Math.round(q) + 'x its size. Move the joint onto the part, or add a beam to reach it.',
              [b], [j], q));
          }
        });
      }
    });

    // light part carrying a heavy one: breadth-first from the ground through
    // load-bearing joints, then follow each heavy body's path back down
    var adj = new Map(), byId = new Map();
    world.bodies.forEach(function (b) { if (dynamic(b)) byId.set(b.id, b); });
    joints.forEach(function (j) {
      if (!bearing(j)) return;
      var ka = groundKey(j.bodyA), kb = groundKey(j.bodyB);
      if (ka === kb) return;
      (adj.get(ka) || adj.set(ka, []).get(ka)).push(kb);
      (adj.get(kb) || adj.set(kb, []).get(kb)).push(ka);
    });
    if (adj.has(0)) {
      var parent = new Map([[0, -1]]), queue = [0];
      for (var qi = 0; qi < queue.length; qi++) {
        var nb = adj.get(queue[qi]) || [];
        for (var t = 0; t < nb.length; t++) if (!parent.has(nb[t])) { parent.set(nb[t], queue[qi]); queue.push(nb[t]); }
      }
      var seen = new Set();
      parent.forEach(function (_, id) {
        if (id === 0) return;
        var heavy = byId.get(id), lightest = null, k = parent.get(id);
        while (k > 0) { var b = byId.get(k); if (!lightest || b.m < lightest.m) lightest = b; k = parent.get(k); }
        // a light part joined straight to the load is the joint check's job
        if (!lightest || lightest.id === parent.get(id)) return;
        var r = heavy.m / lightest.m;
        if (r > L.carryRatioWarn && !seen.has(lightest.id)) {
          seen.add(lightest.id);
          out.push(issue('light-carries-heavy', r > L.carryRatioError ? 'error' : 'warning',
            nameOf(lightest) + ' (' + +lightest.m.toPrecision(3) + ' kg) holds up ' + nameOf(heavy) + ' (' + +heavy.m.toPrecision(3) + ' kg). Joints through a part this light will stretch.',
            [lightest, heavy], [], r));
        }
      });
    }
    return out;
  }

  /* -------------------------------------------------------- overlaps */
  function poseSignature(world) {
    var h = 0;
    for (var i = 0; i < world.bodies.length; i++) {
      var b = world.bodies[i];
      h = (h * 31 + Math.round(b.c.x * 1e4)) | 0; h = (h * 31 + Math.round(b.c.y * 1e4)) | 0; h = (h * 31 + Math.round(b.angle * 1e5)) | 0;
    }
    return h;
  }

  function overlaps(world) {
    var out = [], L = LIMITS, items = [], pad = P.SPECULATIVE || 0.02;
    world.bodies.forEach(function (b) {
      var t = b.transform();
            b.fixtures.forEach(function (f) { if (!f.sensor) { var bb = P.aabb(f.shape, t); items.push({ f: f, b: b, t: t, lo: M.v(bb.lo.x - pad, bb.lo.y - pad), hi: M.v(bb.hi.x + pad, bb.hi.y + pad) }); } });
    });
    items.sort(function (a, b) { return a.lo.x - b.lo.x; });
    var jointed = new Set();
    world.joints.forEach(function (j) { if (j.bodyA && j.bodyB) { jointed.add(j.bodyA.id + ':' + j.bodyB.id); jointed.add(j.bodyB.id + ':' + j.bodyA.id); } });
    var ok = P.broadphase && P.broadphase.shouldCollide, deep = new Map();
    for (var i = 0; i < items.length; i++) {
      var A = items[i];
      for (var k = i + 1; k < items.length; k++) {
        var B = items[k];
        if (B.lo.x > A.hi.x) break;
        if (B.lo.y > A.hi.y || B.hi.y < A.lo.y || A.b === B.b) continue;
        if (jointed.has(A.b.id + ':' + B.b.id)) continue;
        if (ok ? !P.broadphase.shouldCollide(world, A.f, B.f) : (!dynamic(A.b) && !dynamic(B.b))) continue;
        var man = P.collide(A.f.shape, A.t, B.f.shape, B.t);
        if (!man || !man.points.length) {
          // not touching yet: a part dropped a few cm onto another still
          // ends up resting on it
          var top = A.b.c.y > B.b.c.y ? A : B, bot = top === A ? B : A;
          var gap = (top.lo.y + pad) - (bot.hi.y - pad);
          if (gap >= 0 && gap < L.restGap && Math.min(A.hi.x, B.hi.x) - Math.max(A.lo.x, B.lo.x) > 2 * pad) stackCheck(out, top.b, bot.b);
          continue;
        }
        var depth = 0;
        man.points.forEach(function (p) { depth = Math.max(depth, -p.separation); });
        var upper = A.b.c.y > B.b.c.y ? A.b : B.b, lower = upper === A.b ? B.b : A.b;
        if (depth > L.overlapDepth) {
          var key = Math.min(A.b.id, B.b.id) + ':' + Math.max(A.b.id, B.b.id), prev = deep.get(key);
          if (!prev || depth > prev.depth) deep.set(key, { A: A, B: B, depth: depth });
        } else if (depth > -P.SPECULATIVE && Math.abs(man.normal.y) > 0.5) {
          stackCheck(out, upper, lower);
        }
      }
    }
    // one report per pair of parts. Shallow overlaps just get shoved apart
    // when the run starts; past half the thinner part they can pop out on
    // the wrong side.
    deep.forEach(function (o) {
      var thin = Math.min(shapeThickness(o.A.f.shape), shapeThickness(o.B.f.shape));
      var bad = o.depth > L.overlapError * thin;
      out.push(issue('overlap', bad ? 'error' : 'warning',
        nameOf(o.A.b) + ' and ' + nameOf(o.B.b) + ' overlap by ' + Math.round(o.depth * 100) + ' cm. ' + (bad ? 'Move them apart: the run would throw them out the wrong way.' : 'They will be shoved apart when the run starts.'),
        [o.A.b, o.B.b], [], o.depth, [o.A.f, o.B.f]));
    });
    return out;
  }
  // heavy part resting on a much lighter one
  function stackCheck(out, upper, lower) {
    if (!dynamic(upper) || !dynamic(lower)) return;
    var r = upper.m / lower.m;
    if (r <= LIMITS.stackRatioWarn) return;
    out.push(issue('mass-ratio-stack', r > LIMITS.stackRatioError ? 'error' : 'warning',
      nameOf(upper) + ' is ' + fmtRatio(r).slice(2) + 'x heavier than ' + nameOf(lower) + ' under it. The light part will be squashed' + (r > LIMITS.stackRatioError ? ' flat.' : ' a little.'),
      [upper, lower], [], r));
  }
  function contactStacks(world) {
    var out = [], seen = new Set();
    world.contacts.forEach(function (ct) {
      if (!ct.touching && ct.touching !== undefined) return;
      var A = ct.fa.body, B = ct.fb.body;
      if (!dynamic(A) || !dynamic(B) || !ct.manifold || Math.abs(ct.manifold.normal.y) < 0.5) return;
      var upper = A.c.y > B.c.y ? A : B, lower = upper === A ? B : A;
      var key = upper.id + ':' + lower.id;
      if (seen.has(key)) return; seen.add(key);
      stackCheck(out, upper, lower);
    });
    return out;
  }

  /* ---------------------------------------------------- runtime checks */
  function runtime(world, dt, st) {
    var out = [], L = LIMITS, bad = [], fast = [], jumps = [];
    var vcap = (world.cfg && world.cfg.maxLinearSpeed || 400) * L.unstableSpeed;
    var prev = st.prev, next = new Map();
    world.bodies.forEach(function (b) {
      if (!dynamic(b)) return;
      var ok = isFinite(b.c.x) && isFinite(b.c.y) && isFinite(b.angle) && isFinite(b.v.x) && isFinite(b.v.y) && isFinite(b.w);
      var sp = ok ? M.len(b.v) : Infinity;
      if (!ok || sp > vcap || Math.abs(b.w) > L.unstableSpin) bad.push(b);
      else {
        var was = prev && prev.get(b.id);
        if (was != null && world.time !== st.prevTime && sp - was > L.jumpSpeed && sp > 3 * was) jumps.push(b);
        if (sp * dt > 0.01) fast.push(b);
      }
      next.set(b.id, sp);
    });
    st.prev = next; st.prevTime = world.time;
    if (bad.length) out.push(issue('unstable', 'error', 'Simulation unstable: ' + bad.slice(0, 3).map(nameOf).join(', ') + (bad.length > 3 ? ' and others' : '') + ' went out of control. Check the warnings on these parts.', bad, [], bad.length));
    if (jumps.length) out.push(issue('speed-jump', 'warning', 'Something kicked ' + jumps.slice(0, 3).map(nameOf).join(', ') + ' far too hard in one step. The build may be about to blow up.', jumps, [], jumps.length));

    // tunnelling: compare the distance per step with the thickness of the
    // part and of anything inside its swept box
    var boxes = fast.length ? world.bodies.map(function (o) { return o.fixtures.length ? o.aabb() : null; }) : null;
    fast.forEach(function (b) {
      var d = M.len(b.v) * dt, own = bodyThickness(b), bb = boxes[world.bodies.indexOf(b)];
      var lo = M.v(Math.min(bb.lo.x, bb.lo.x + b.v.x * dt), Math.min(bb.lo.y, bb.lo.y + b.v.y * dt));
      var hi = M.v(Math.max(bb.hi.x, bb.hi.x + b.v.x * dt), Math.max(bb.hi.y, bb.hi.y + b.v.y * dt));
      var worst = null, wt = Infinity;
      world.bodies.forEach(function (o, oi) {
        var ob = boxes[oi];
        if (o === b || !ob) return;
        if (ob.lo.x > hi.x || ob.hi.x < lo.x || ob.lo.y > hi.y || ob.hi.y < lo.y) return;
        // only parts it is heading towards
        if (M.dot(M.sub(b.v, o.v), M.sub(o.c, b.c)) <= 0 || !canHit(world, b, o)) return;
        var t = bodyThickness(o);
        if (t < wt) { wt = t; worst = o; }
      });
      if (worst && d > L.tunnelFactor * (own + wt)) {
        out.push(issue('tunnel-risk', 'warning', nameOf(b) + ' moves ' + d.toFixed(2) + ' m per step, more than it and ' + nameOf(worst) + ' are thick. It may pass straight through.', [b, worst], [], d / (own + wt)));
      }
    });

    // joints near their rating
    world.joints.forEach(function (j) {
      if (j.broken || j.internal) return;
      var u = utilisation(j);
      if (u >= L.nearBreak) out.push(issue('near-break', 'info', (j.label || 'This ' + j.type + ' joint') + ' is at ' + Math.round(u * 100) + '% of its rating.', [j.bodyA, j.bodyB].filter(Boolean), [j], u));
    });
    return out;
  }
  // Could any fixture of a hit any fixture of b (filters, joints, sensors)?
  function canHit(world, a, b) {
    var sc = P.broadphase && P.broadphase.shouldCollide;
    if (!sc) return dynamic(a) || dynamic(b);
    for (var i = 0; i < a.fixtures.length; i++) for (var k = 0; k < b.fixtures.length; k++) if (sc(world, a.fixtures[i], b.fixtures[k])) return true;
    return false;
  }
  function utilisation(j) {
    var u = 0, F, T;
    try { F = j.force(); T = j.torque ? Math.abs(j.torque()) : 0; } catch (e) { return 0; }
    if (isFinite(j.breakForce) && j.breakForce > 0) u = Math.max(u, F / j.breakForce);
    if (j.breakTorque != null && isFinite(j.breakTorque) && j.breakTorque > 0) u = Math.max(u, T / j.breakTorque);
    if (j.limits && j.loads) {
      var q = j.loads(), Lm = j.limits;
      if (Lm.moment) u = Math.max(u, Math.abs(q.moment) / Lm.moment);
      if (Lm.axial) u = Math.max(u, Math.abs(q.axial) / Lm.axial);
      if (Lm.shear) u = Math.max(u, Math.abs(q.shear) / Lm.shear);
    }
    return isFinite(u) ? u : 0;
  }

  /* -------------------------------------------------------------- entry */
  var ORDER = { error: 0, warning: 1, info: 2 };
  function diagnose(world, opts) {
    opts = opts || {};
    var dt = opts.dt || 1 / 60;
    var st = cache.get(world);
    if (!st) cache.set(world, st = { sig: null, structural: [], poseSig: null, overlap: [], prev: null, prevTime: null });
    var sig = signature(world);
    if (sig !== st.sig) { st.sig = sig; st.structural = structural(world); st.poseSig = null; }
    var out = st.structural.slice();
    var building = opts.build != null ? opts.build : !world.stepCount;
    if (building) {
      var ps = poseSignature(world);
      if (ps !== st.poseSig) { st.poseSig = ps; st.overlap = overlaps(world); }
      out = out.concat(st.overlap);
    } else {
      out = out.concat(contactStacks(world));
    }
    out = out.concat(runtime(world, dt, st));
    out.sort(function (a, b) { return ORDER[a.severity] - ORDER[b.severity]; });
    return out;
  }

  diagnose.limits = LIMITS;
  diagnose.thickness = bodyThickness;
  diagnose.effectiveMass = effMass;
  // Forget cached results, e.g. after editing a part's shape in place.
  diagnose.reset = function (world) { cache.delete(world); };
  P.diagnose = diagnose;
})(globalThis.SE);
