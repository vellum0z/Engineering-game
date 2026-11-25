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
 * Line blocks: an inextensible or stiff winch line is solved together with
 * the ropes, rods and stiff springs hanging from it (P.lineBlocks in
 * pulley.js), so a light hook block between the line and a sling still
 * passes an 18 t load's weight up to the drum.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

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
    // an inextensible or stiff line is solved with the ropes it hangs (pulley.js)
    P.lineBlocks.prepare(this, h, cfg);
  };

  WinchJoint.prototype.warmStart = function () {
    var blk = P.lineBlocks.active(this);
    if (blk) { if (blk.leader === this) P.lineBlocks.warmStart(blk); return; }
    this.path.update(); this.path.pull(this.impulse);
  };

  // The drum turns once per substep: ramp the speed, solve against the line
  // out at the start of the substep with the drum's speed as the velocity
  // target, then wind the line so the relax pass (after the bodies have
  // moved) compares against where the drum now is.
  WinchJoint.prototype.beforeBlock = function (h) {
    var target = this.reelSpeed, dv = this.accel * h;
    this.speed = Math.abs(target - this.speed) <= dv ? target : this.speed + (target > this.speed ? dv : -dv);
  };
  WinchJoint.prototype.afterBlock = function (h) {
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

  WinchJoint.prototype.solve = function (h, useBias) {
    var blk = P.lineBlocks.active(this);
    if (blk) { if (blk.leader === this) P.lineBlocks.solve(blk, h, useBias); return; }
    if (useBias) this.beforeBlock(h);
    this.impulse = P.solveLine(this.path, this.length, this.speed, this.impulse, this.capH, h, useBias, this.jointSoft, this.spring);
    if (useBias) this.afterBlock(h);
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
    return P.lineBlocks.active(this) && this.linePeak ? Math.max(T, this.linePeak * this.invH) : T;
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
