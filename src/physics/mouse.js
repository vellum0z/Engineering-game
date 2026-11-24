/*
 * MouseJoint: drags a point of a body toward a target, like a stiff spring
 * on a handle that can pull no harder than maxForce. The build yard uses it
 * for the player's drag and poke.
 *
 *   var drag = new SE.phys.MouseJoint({
 *     body,                     // (or bodyB) the body being dragged
 *     target: {x, y},           // world point; the grabbed point starts here
 *     localAnchor,              // optional grab point in body frame (default: under target)
 *     maxForce (N),             // default 1000 · body mass, i.e. ~100 g
 *     hertz (default 5), dampingRatio (default 0.7),
 *     angularDamping (default 0.5 = fraction of spin removed per second-ish)
 *   });
 *   world.addJoint(drag); drag.setTarget(p); ... world.removeJoint(drag);
 *
 * Method (as Box2D 3's mouse joint): a soft point constraint between the
 * grabbed point and the target, with frequency and damping relative to the
 * body's own mass, solved in every pass (it is a spring, not error
 * correction). The accumulated impulse is clamped to maxForce·h, so the
 * force on the body never exceeds maxForce and the drag can add no more
 * energy than maxForce times the distance it pulls. The closing speed is
 * also capped at √(2·0.8·a·d) (a = maxForce/m, d = distance to target), the
 * speed from which the handle can still brake to a stop on the target, so a
 * heavy crate dragged with a weak handle arrives instead of swinging past.
 * A little angular damping keeps a grabbed crate from spinning on the handle.
 *
 * bodyA is an internal static anchor that is not in the world, so the
 * joint never wakes or collides with anything else.
 *
 * Readouts: force() (N, never above maxForce), reaction() { force on the
 * body, torque: 0 }, target.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  function MouseJoint(def) {
    var body = def.body || def.bodyB;
    var ground = def.bodyA || new P.Body({ type: 'static', label: 'mouse anchor' });
    var target = def.target ? M.v(def.target.x, def.target.y) : body.c;
    Joint.call(this, {
      bodyA: ground, bodyB: body,
      localAnchorB: def.localAnchor || def.localAnchorB || body.localPoint(target),
      breakForce: def.breakForce, label: def.label, userData: def.userData
    });
    this.type = 'mouse';
    this.target = M.v(target.x, target.y);
    this.maxForce = def.maxForce != null ? def.maxForce : 1000 * body.m;
    this.hertz = def.hertz != null ? def.hertz : 5;
    this.dampingRatio = def.dampingRatio != null ? def.dampingRatio : 0.7;
    this.angularDampingRate = def.angularDamping != null ? def.angularDamping : 0.5;
    this.impulse = M.v(0, 0);
  }
  MouseJoint.prototype = Object.create(Joint.prototype);

  MouseJoint.prototype.setTarget = function (p) {
    this.target = M.v(p.x, p.y);
    this.bodyB.wake();
  };
  MouseJoint.prototype.anchorA = function () { return M.v(this.target.x, this.target.y); };

  MouseJoint.prototype.prepare = function (h) {
    this.invH = 1 / h;
    var B = this.bodyB;
    this.soft = P.softness(this.hertz, this.dampingRatio, h);
    // spin damping: an implicit rotary damper with rate c/I = angularDamping (1/s)
    this.angularMass = B.invI > 0 ? 1 / B.invI : 0;
    this.angularSoft = h * this.angularDampingRate;
  };

  MouseJoint.prototype.warmStart = function () {
    var B = this.bodyB, b = this.frame(B, this.localAnchorB);
    B.v = M.mulAdd(B.v, B.invM, this.impulse);
    B.w += B.invI * M.cross(b.r, this.impulse);
  };

  // A drag moves things, so it keeps its body awake while it holds it.
  MouseJoint.prototype.preStep = function () { this.bodyB.wake(); };

  MouseJoint.prototype.solve = function (h) {
    var B = this.bodyB;
    if (B.type !== 'dynamic') return;
    // rotary damper: removes a fraction of the spin, never adds any
    if (this.angularMass > 0 && this.angularSoft > 0) {
      var ai = -this.angularMass * B.w * this.angularSoft / (1 + this.angularSoft);
      B.w += B.invI * ai;
    }
    var b = this.frame(B, this.localAnchorB), r = b.r;
    var Cdot = M.add(B.v, M.crossSV(B.w, r));
    var C = M.sub(b.p, this.target);
    var K = { k11: B.invM + r.y * r.y * B.invI, k12: -r.y * r.x * B.invI, k22: B.invM + r.x * r.x * B.invI };
    // Closing speed the spring asks for, capped at the speed from which
    // maxForce can still stop the body at the target, √(2 a d) with
    // a = maxForce / m. Without the cap a force-limited drag overshoots and
    // swings back and forth across the target.
    var bx = this.soft.biasRate * C.x, by = this.soft.biasRate * C.y;
    var dist = M.len(C), vCap = Math.sqrt(2 * 0.8 * this.maxForce * B.invM * dist), vb = Math.sqrt(bx * bx + by * by);
    if (vb > vCap && vb > 0) { bx *= vCap / vb; by *= vCap / vb; }
    var s = P.solve2(K, Cdot.x + bx, Cdot.y + by);
    var old = this.impulse;
    var next = M.v(old.x - this.soft.massScale * s.x - this.soft.impulseScale * old.x,
                   old.y - this.soft.massScale * s.y - this.soft.impulseScale * old.y);
    var maxI = this.maxForce * h, L = M.len(next);
    if (L > maxI) next = M.scale(next, maxI / L);
    var d = M.sub(next, old);
    this.impulse = next;
    B.v = M.mulAdd(B.v, B.invM, d);
    B.w += B.invI * M.cross(r, d);
  };

  MouseJoint.prototype.force = function () { return M.len(this.impulse) * this.invH; };
  MouseJoint.prototype.reaction = function () { return { force: M.scale(this.impulse, this.invH), torque: 0 }; };

  P.MouseJoint = MouseJoint;
  // Saved with scenes like any joint; its anchor body is internal, so it has
  // its own codec.
  (P.jointTypes = P.jointTypes || {}).mouse = {
    toJSON: function (j, indexOf) {
      var o = { type: 'mouse', bodyB: indexOf(j.bodyB), localAnchorB: { x: j.localAnchorB.x, y: j.localAnchorB.y },
        target: { x: j.target.x, y: j.target.y }, maxForce: j.maxForce, hertz: j.hertz,
        dampingRatio: j.dampingRatio, angularDamping: j.angularDampingRate };
      if (isFinite(j.breakForce)) o.breakForce = j.breakForce;
      if (j.label) o.label = j.label;
      return o;
    },
    fromJSON: function (o, bodies) {
      var B = bodies[o.bodyB];
      if (!B) throw new Error('scene joint "mouse" refers to a missing body (' + o.bodyB + ')');
      return new MouseJoint({ body: B, localAnchor: o.localAnchorB, target: o.target, maxForce: o.maxForce,
        hertz: o.hertz, dampingRatio: o.dampingRatio, angularDamping: o.angularDamping,
        breakForce: o.breakForce, label: o.label });
    }
  };
})(globalThis.SE);
