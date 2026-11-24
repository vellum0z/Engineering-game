/*
 * WinchJoint: a line wound on a motor-driven drum.
 *
 *   new SE.phys.WinchJoint({
 *     bodyA, localAnchorA,      drum (where the line leaves it)
 *     bodyB, localAnchorB,      hook on the load
 *     length,                   line paid out, m (default: as built)
 *     reelSpeed,                m/s, + = pay in (lift), - = pay out
 *     accel,                    drum ramp, m/s² (default Infinity: instant)
 *     maxPull,                  N: the most the motor can pull; above it the
 *                               winch stalls and the load overhauls the drum
 *     brake, brakeForce,        holds the line when reelSpeed is 0, up to brakeForce (N)
 *     drumRadius,               m, for drumTorque() (default 0.15)
 *     minLength, maxLength,     drum limits on line out, m
 *     via: { body | null, local, radius }, parts,   optional sheave the line runs over,
 *                               then `parts` falls down to the hook (a tackle)
 *     EA,                       optional axial stiffness of the line, N
 *     breakForce })             the line snaps above this tension
 *
 * The line out (this.length, m) is a state of the drum. Each substep the drum speed ramps
 * toward reelSpeed, the drum turns by speed·h, and the line is
 * held to sum(parts·run length) <= L with tension T in [0, cap], where
 * cap = maxPull while reeling (or holding with no brake), brakeForce when
 * braked. If T reaches the cap the drum can't keep its speed: it turns only
 * as fast as the line really moves (slower, stopped, or backwards as the
 * load overhauls it and pulls line out). slipping is true for such a step
 * and stalled() when it was reeling in and won no line. So a winch rated
 * below the weight cannot lift it, and a weak brake lets the load creep down.
 *
 * Readouts: lineTension() (N, in the line), hookForce() (N, parts·T on the
 * hook), drumTorque(r) = T·r (N·m), lineOut() (m), speed (m/s).
 *
 * Line blocks. A winch usually hangs a chain of ropes: line -> hook block ->
 * sling -> load. Solved one rope at a time, a light hook between two ropes
 * can't pass the load's weight along in one pass (each rope only "sees" the
 * hook's mass), so a 40 kg hook under an 18 t load stretches the line, the
 * drum saturates and the load never lifts. So the winch line and every
 * inextensible rope DistanceJoint hanging from it (found through shared
 * bodies, up to MAX_ROWS rows) are solved together each substep: a small
 * bounded problem
 *   u' = u - A Δλ,   λ = λ0 + Δλ in [0, cap],   A = J M⁻¹ Jᵀ
 * with u' at its target where 0 < λ < cap, u' <= target where the rope is
 * slack (λ = 0), u' >= target where the drum is at its cap. It is solved
 * exactly by an active-set loop on the dense n×n system (n is a handful),
 * then scaled by the joint softness like any other soft constraint. The
 * ropes keep their own impulses, so their tension() reads as usual.
 * world.lineBlockSolve = false falls back to one rope at a time.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  var MAX_ROWS = 8;

  // Can this distance joint be a row of a line block? Inextensible ropes and
  // lines too stiff for a soft spring (held at L + T/k), with no motor or
  // lower limit. Returns 'rigid', 'stiff' or null.
  function ropeRowKind(j, cfg) {
    if (j.type !== 'distance' || !j.rope || j.broken || j.maxMotorForce > 0 || j.minLength > 0) return null;
    if (!j.spring) return j.maxLength < Infinity ? 'rigid' : null;
    if (!(j.stiffness > 0)) return null;
    var m = j.effMass(j.geometry());
    return m > 0 && Math.sqrt(j.stiffness / m) / (2 * Math.PI) > cfg.jointHertz ? 'stiff' : null;
  }
  function isDyn(b) { return b.type === 'dynamic' && (b.invM > 0 || b.invI > 0); }

  // Collect the ropes hanging off this winch's moving bodies.
  function buildBlock(winch, cfg) {
    var world = winch.bodyA.world || winch.bodyB.world;
    if (!world || world.lineBlockSolve === false) return null;
    var seen = new Set(), queue = [], rows = [];
    winch.path.bodies.forEach(function (b) { if (isDyn(b)) { seen.add(b); queue.push(b); } });
    var claimed = world._lineBlockClaim || (world._lineBlockClaim = new Map());
    while (queue.length && rows.length < MAX_ROWS - 1) {
      var body = queue.shift();
      for (var i = 0; i < world.joints.length && rows.length < MAX_ROWS - 1; i++) {
        var j = world.joints[i];
        if (j.bodyA !== body && j.bodyB !== body) continue;
        if (rows.some(function (r) { return r.joint === j; })) continue;
        var owner = claimed.get(j);
        if (owner && owner !== winch && owner.lineBlockStep === world.stepCount) continue;
        var kind = ropeRowKind(j, cfg);
        if (!kind) continue;
        if (!j.linePath) j.linePath = new P.RopePath([{ a: { body: j.bodyA, local: j.localAnchorA }, b: { body: j.bodyB, local: j.localAnchorB }, k: 1 }]);
        rows.push({ joint: j, kind: kind, path: j.linePath });
        var other = j.bodyA === body ? j.bodyB : j.bodyA;
        if (isDyn(other) && !seen.has(other)) { seen.add(other); queue.push(other); }
      }
    }
    if (!rows.length) return null;
    rows.forEach(function (r) { claimed.set(r.joint, winch); r.joint.lineBlockStep = world.stepCount; r.joint.linePeak = 0; });
    winch.linePeak = 0;
    winch.lineBlockStep = world.stepCount;
    return { world: world, rows: [{ joint: winch, kind: 'winch', path: winch.path }].concat(rows) };
  }

  // A_ij = sum over shared bodies of invM (lin_i · lin_j) + invI ang_i ang_j
  function coupling(pi, pj) {
    var a = 0;
    for (var x = 0; x < pi.bodies.length; x++) {
      var y = pj.bodies.indexOf(pi.bodies[x]);
      if (y < 0) continue;
      var B = pi.bodies[x];
      a += B.invM * M.dot(pi.lin[x], pj.lin[y]) + B.invI * pi.ang[x] * pj.ang[y];
    }
    return a;
  }

  // Solve A x = b for the rows in `idx` (Gaussian elimination, partial pivot).
  function solveDense(A, b, idx) {
    var n = idx.length, m = [], i, k, r;
    for (i = 0; i < n; i++) { m.push(idx.map(function (c) { return A[idx[i]][c]; })); m[i].push(b[i]); }
    for (k = 0; k < n; k++) {
      var piv = k;
      for (r = k + 1; r < n; r++) if (Math.abs(m[r][k]) > Math.abs(m[piv][k])) piv = r;
      var t = m[k]; m[k] = m[piv]; m[piv] = t;
      if (Math.abs(m[k][k]) < 1e-300) continue;
      for (r = k + 1; r < n; r++) {
        var f = m[r][k] / m[k][k];
        if (f) for (var c = k; c <= n; c++) m[r][c] -= f * m[k][c];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var sum = m[i][n];
      for (k = i + 1; k < n; k++) sum -= m[i][k] * x[k];
      x[i] = Math.abs(m[i][i]) < 1e-300 ? 0 : sum / m[i][i];
    }
    return x;
  }

  /*
   * A light body hung between ropes under a big load (a hook block between
   * the line and an 18 t sling) has a stiff swinging mode: the pull T at an
   * anchor r off its centre gives a restoring torque ~T·r per radian, so
   * omega² ~ Σ T·r / I. Once omega·h passes 1 the rotation can't be followed
   * by straight-line position steps and the block spins up. Such a body is
   * treated as a point for the ropes (their angular terms are dropped): it
   * still hangs where they hold it, but they don't twist it.
   */
  function pointBodies(rows, h) {
    // judge by the larger of the present pull and what the drum can pull, so
    // the guard is on before the load comes on
    var lever = new Map(), w0 = rows[0].joint, full = isFinite(w0.capH) ? w0.capH * w0.parts / h : 0;
    rows.forEach(function (r) {
      var j = r.joint, T = Math.max((r.kind === 'winch' ? j.impulse : j.upperImpulse) / h, full);
      r.path.runs.forEach(function (run) {
        [run.a, run.b].forEach(function (e) {
          var B = e.body;
          if (!B || !(B.invI > 0)) return;
          var arm = M.len(M.sub(e.local, B.localCenter));
          lever.set(B, (lever.get(B) || 0) + run.k * T * arm);
        });
      });
    });
    var pointed = [];
    lever.forEach(function (kRot, B) { if (kRot * B.invI * h * h > 1) pointed.push(B); });
    dropTwist(rows, pointed);
    return pointed;
  }
  function dropTwist(rows, pointed) {
    pointed.forEach(function (B) {
      rows.forEach(function (r) {
        var x = r.path.bodies.indexOf(B);
        if (x >= 0) r.path.ang[x] = 0;
      });
    });
  }

  /*
   * One pass of a line block. For each row: u = rate of stretch (+ drum
   * speed for the winch), s = stretch past its length, target velocity
   *   s < 0 (slack)          -s/h  (may close the gap, no further)
   *   s >= 0 and useBias     -biasRate · s   (soft position correction)
   *   relax pass             0
   * then the bounded solve for Δλ, then softness on the stretched rows.
   */
  function solveBlock(blk, h, useBias, soft) {
    var rows = blk.rows, n = rows.length, i, k;
    var acc = new Array(n), cap = new Array(n), bvec = new Array(n), stretched = new Array(n);
    for (i = 0; i < n; i++) rows[i].path.update();
    blk.pointed = pointBodies(rows, h);
    for (i = 0; i < n; i++) {
      var r = rows[i], j = r.joint;
      var L, u = r.path.rate();
      if (r.kind === 'winch') {
        acc[i] = j.impulse; cap[i] = j.capH; L = j.length; u += j.speed;
        if (j.spring && !j.spring.soft) L += acc[i] / (h * j.spring.k);
      } else {
        acc[i] = j.upperImpulse; cap[i] = Infinity;
        L = r.kind === 'stiff' ? j.length + acc[i] / (h * j.stiffness) : j.maxLength;
      }
      // within the slop a rope counts as taut, so a hair of slack in a sling
      // doesn't let the hook run away from the load for a substep
      var sres = r.path.total - L, target;
      stretched[i] = sres >= -P.LINEAR_SLOP;
      if (!stretched[i]) target = -sres / h;
      else target = useBias ? -soft.biasRate * sres : 0;
      bvec[i] = u - target;
    }
    var A = [];
    for (i = 0; i < n; i++) { A.push(new Array(n)); for (k = 0; k < n; k++) A[i][k] = k < i ? A[k][i] : coupling(rows[i].path, rows[k].path); }

    // active set: 0 = free (u' = target), 1 = at 0 (slack), 2 = at cap
    var state = new Array(n).fill(0), d = new Array(n).fill(0);
    for (var iter = 0; iter < 4 * n + 4; iter++) {
      var free = [], rhs = [];
      for (i = 0; i < n; i++) {
        if (state[i] === 1) d[i] = -acc[i];
        else if (state[i] === 2) d[i] = cap[i] - acc[i];
        else free.push(i);
      }
      free.forEach(function (fi) {
        var v = bvec[fi];
        for (var c = 0; c < n; c++) if (state[c] !== 0) v -= A[fi][c] * d[c];
        rhs.push(v);
      });
      var x = free.length ? solveDense(A, rhs, free) : [];
      free.forEach(function (fi, q) { d[fi] = x[q]; });
      var changed = false;
      for (i = 0; i < n; i++) {
        var lam = acc[i] + d[i];
        if (state[i] === 0) {
          if (lam < -1e-12) { state[i] = 1; changed = true; }
          else if (lam > cap[i] * (1 + 1e-12)) { state[i] = 2; changed = true; }
        } else {
          var w = bvec[i];
          for (k = 0; k < n; k++) w -= A[i][k] * d[k];
          if ((state[i] === 1 && w > 1e-12) || (state[i] === 2 && w < -1e-12)) { state[i] = 0; changed = true; }
        }
      }
      if (!changed) break;
    }
    for (i = 0; i < n; i++) {
      var next = M.clamp(acc[i] + d[i], 0, cap[i]);
      rows[i].path.pull(next - acc[i]);
      if (rows[i].kind === 'winch') rows[i].joint.impulse = next; else rows[i].joint.upperImpulse = next;
      // Solved rigidly, a snatch (a drum starting at full speed under a
      // heavy load) lasts a single substep; breakage compares the largest
      // pull of the step, so a rope still snaps on it.
      if (!useBias) rows[i].joint.linePeak = Math.max(rows[i].joint.linePeak || 0, next);
    }
  }

  function WinchJoint(def) {
    Joint.call(this, def);
    this.type = 'winch';
    if (def.worldAnchorA) this.localAnchorA = this.bodyA.localPoint(def.worldAnchorA);
    if (def.worldAnchorB) this.localAnchorB = this.bodyB.localPoint(def.worldAnchorB);
    this.reelSpeed = def.reelSpeed || 0;
    this.accel = def.accel == null ? Infinity : def.accel;
    this.maxPull = def.maxPull == null ? Infinity : def.maxPull;
    this.brake = !!def.brake;
    this.brakeForce = def.brakeForce == null ? Infinity : def.brakeForce;
    this.drumRadius = def.drumRadius || 0.15;
    this.parts = def.parts || 1;
    this.EA = def.EA || 0;
    this.dampingRatio = def.dampingRatio == null ? 0.1 : def.dampingRatio;
    var drum = { body: this.bodyA, local: this.localAnchorA }, hook = { body: this.bodyB, local: this.localAnchorB };
    var runs;
    if (def.via) {
      var vl = def.via.local || def.via.localAnchor || M.v(0, 0);
      var via = this.via = { body: def.via.body || null, local: M.v(vl.x, vl.y) };
      if (def.via.radius) via.radius = def.via.radius;   // sheave size, for drawing only
      runs = [{ a: drum, b: via, k: 1 }, { a: via, b: hook, k: this.parts }];
    } else {
      runs = [{ a: drum, b: hook, k: this.parts }];
    }
    this.path = new P.RopePath(runs);
    var built = this.path.update();
    this.length = def.length != null ? def.length : built;
    // line that never leaves the drum-to-sheave run can't be wound in
    var fixed = def.via ? this.path.runs[0].len : 0;
    this.minLength = Math.max(def.minLength || 0, fixed);
    this.maxLength = def.maxLength == null ? Infinity : def.maxLength;
    this.speed = 0;
    this.impulse = 0;
    this.slipping = false;
    this.atLimit = false;
  }
  WinchJoint.prototype = Object.create(Joint.prototype);

  // a reeling winch keeps its load awake
  WinchJoint.prototype.preStep = function () {
    if (this.reelSpeed !== 0 || this.speed !== 0) { this.bodyA.wake(); this.bodyB.wake(); }
  };

  WinchJoint.prototype.cap = function () {
    if (this.reelSpeed === 0 && this.brake) return this.brakeForce;
    return this.maxPull;
  };

  WinchJoint.prototype.prepare = function (h, cfg) {
    this.h = h; this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.spring = P.lineSpring(this.EA, this.length, this.path, h, this.dampingRatio, cfg);
    this.capH = this.cap() * h;
    if (this.impulse > this.capH) this.impulse = this.capH;
    // an elastic (soft) line stays on its own; inextensible and stiff lines
    // are solved with the ropes they hang
    this.block = this.spring && this.spring.soft ? null : buildBlock(this, cfg);
  };

  WinchJoint.prototype.warmStart = function () {
    if (!this.block) { this.path.update(); this.path.pull(this.impulse); return; }
    // the block warm-starts its ropes too, with the same point treatment
    var rows = this.block.rows;
    if (!this.block.pointed) this.block.pointed = pointBodies(rows.map(function (r) { r.path.update(); return r; }), this.h);
    rows.forEach(function (r) { r.path.update(); });
    dropTwist(rows, this.block.pointed);
    rows.forEach(function (r) { r.path.pull(r.kind === 'winch' ? r.joint.impulse : r.joint.upperImpulse); });
  };

  WinchJoint.prototype.solve = function (h, useBias) {
    if (!useBias) { this.lineSolve(h, false); return; }
    // The drum turns once per substep: ramp the speed, solve against the line
    // out at the start of the substep with the drum's speed as the velocity
    // target, then wind the line so the relax pass (after the bodies have
    // moved) compares against where the drum now is.
    var target = this.reelSpeed, dv = this.accel * h;
    this.speed = Math.abs(target - this.speed) <= dv ? target : this.speed + (target > this.speed ? dv : -dv);
    this.lineSolve(h, true);
    if (this.capH < Infinity && this.impulse >= this.capH * (1 - 1e-9)) {
      // At its cap the motor (or brake) can't hold the commanded speed: the
      // drum turns only as fast as the line actually moves, so a heavy load
      // slows it, stalls it or overhauls it and pays line out.
      this.path.update();
      var actual = -this.path.rate();
      if (actual < this.speed) this.speed = actual;
      this.capped = true;
    }
    var free = this.length - this.speed * h, next = M.clamp(free, this.minLength, this.maxLength);
    this.atLimit = next !== free;
    this.length = next;
    if (this.atLimit) this.speed = 0;
  };

  WinchJoint.prototype.lineSolve = function (h, useBias) {
    if (this.block) solveBlock(this.block, h, useBias, this.jointSoft);
    else this.impulse = P.solveLine(this.path, this.length, this.speed, this.impulse, this.capH, h, useBias, this.jointSoft, this.spring);
  };

  WinchJoint.prototype.postStep = function () {
    // slipping: the drum spent part of this step at its cap
    this.slipping = !!this.capped;
    this.capped = false;
  };

  // stalled: told to reel in, at full pull, and not winning any line
  WinchJoint.prototype.stalled = function () { return this.slipping && this.reelSpeed > 0 && this.speed <= 1e-6; };
  WinchJoint.prototype.lineTension = function () { return this.impulse * this.invH; };
  WinchJoint.prototype.tension = WinchJoint.prototype.lineTension;
  // what breakage reads: the line tension, or in a line block the largest
  // tension of the step
  WinchJoint.prototype.force = function () {
    var T = this.lineTension();
    return this.block && this.linePeak ? Math.max(T, this.linePeak * this.invH) : T;
  };
  WinchJoint.prototype.hookForce = function () { return this.parts * this.lineTension(); };
  WinchJoint.prototype.drumTorque = function (r) { return this.lineTension() * (r == null ? this.drumRadius : r); };
  WinchJoint.prototype.lineOut = function () { return this.length; };
  WinchJoint.prototype.isSlack = function () { return this.path.update() < this.length - P.LINEAR_SLOP; };
  WinchJoint.prototype.reactionOn = function (body) { return this.path.reactionOn(body, this.lineTension()); };
  WinchJoint.prototype.reaction = function () {
    this.path.update();
    return { force: this.path.forceOn(this.bodyB, this.lineTension()), torque: 0 };
  };

  // Scenes (serialize.js): the common definition fields plus these. `via`
  // holds a body, so it is saved as { body: index | null, local }.
  var FIELDS = ['length', 'reelSpeed', 'accel', 'maxPull', 'brake', 'brakeForce', 'drumRadius',
    'minLength', 'maxLength', 'parts', 'EA', 'dampingRatio', 'via'];
  var base = null;
  function fieldsCodec() {
    if (!base) {
      var mine = P.jointTypes.winch;
      base = P.registerJointType('winch', WinchJoint, FIELDS);
      P.jointTypes.winch = mine;
    }
    return base;
  }
  (P.jointTypes = P.jointTypes || {}).winch = {
    toJSON: function (j, indexOf) {
      var o = fieldsCodec().toJSON(j, indexOf);
      if (j.via) { o.via = { body: j.via.body ? indexOf(j.via.body) : null, local: { x: j.via.local.x, y: j.via.local.y } }; if (j.via.radius) o.via.radius = j.via.radius; }
      return o;
    },
    fromJSON: function (o, bodies) {
      var copy = Object.assign({}, o);
      if (o.via) copy.via = { body: o.via.body == null ? null : bodies[o.via.body], local: o.via.local, radius: o.via.radius };
      return fieldsCodec().fromJSON(copy, bodies);
    }
  };

  P.WinchJoint = WinchJoint;
})(globalThis.SE);
