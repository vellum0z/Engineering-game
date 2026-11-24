/*
 * Joints: constraints between two bodies.
 *
 * Every joint has the same interface, which world.js calls each step:
 *   prepare(h, cfg)              once per step, before the substeps
 *   warmStart()                  each substep, re-applies last impulse
 *   solve(h, useBias, cfg)       each substep (useBias false = relax pass)
 *   force()                      magnitude of the constraint force, N
 * and the same definition fields:
 *   bodyA, bodyB, localAnchorA, localAnchorB (body-origin frame, m),
 *   collideConnected (default false), breakForce (N, default Infinity),
 *   label, userData.
 * After each step the world compares force() with breakForce and breaks the
 * joint (removes it and fires a 'break' event) when it is exceeded. That is
 * how a cable snaps or a pin shears: the simulation decides, not a script.
 *
 * Optional hooks a joint may add:
 *   preStep(dt)                  before prepare (winches pay out line here)
 *   postStep(dt)                 after the step
 *   reaction()                   { force: {x, y} on body B (N), torque (N·m) }
 *   breakTorque (N·m)            checked by breakage.js like breakForce
 *
 * Each joint type lives in its own file and registers on SE.phys:
 *   distance.js  DistanceJoint (rod, spring, rope)
 *   revolute.js  RevoluteJoint (pin)
 *   weld.js     WeldJoint (rigid or torsion-spring weld)
 * Planned: prismatic.js, mouse.js, pulley.js, winch.js.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var nextId = 1;

  function Joint(def) {
    this.id = nextId++;
    this.bodyA = def.bodyA; this.bodyB = def.bodyB;
    this.localAnchorA = def.localAnchorA ? M.v(def.localAnchorA.x, def.localAnchorA.y) : M.v(0, 0);
    this.localAnchorB = def.localAnchorB ? M.v(def.localAnchorB.x, def.localAnchorB.y) : M.v(0, 0);
    this.collideConnected = !!def.collideConnected;
    this.breakForce = def.breakForce == null ? Infinity : def.breakForce;
    this.label = def.label || '';
    this.userData = def.userData || null;
    this.broken = false;
    this.invH = 0;
  }
  // World anchor and its offset from the centre of mass, from current state.
  Joint.prototype.frame = function (body, local) {
    var r = M.rotate(body.q, M.sub(local, body.localCenter));
    return { r: r, p: M.add(body.c, r) };
  };
  Joint.prototype.anchorA = function () { return this.frame(this.bodyA, this.localAnchorA).p; };
  Joint.prototype.anchorB = function () { return this.frame(this.bodyB, this.localAnchorB).p; };

  // Default reaction: the constraint force along whatever impulse the joint
  // stores, as a vector on body B. Joints with an angular part add torque.
  Joint.prototype.reaction = function () { return { force: M.v(0, 0), torque: 0 }; };

  P.Joint = Joint;
})(globalThis.SE);
