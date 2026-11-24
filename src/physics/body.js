/*
 * Rigid bodies.
 *
 *   var b = new SE.phys.Body({
 *     type: 'dynamic' | 'static' | 'kinematic',
 *     position: {x, y}, angle, velocity: {x, y}, angularVelocity,
 *     shapes: [shape | { shape, material, friction, muS, muK, restitution, density, sensor,
 *                        rollingResistance, tangentSpeed, filter: { category, mask, group } }],
 *     material: 'steel',            // default for shapes that don't set one
 *     mass: 250,                     // optional: overrides density-derived mass (keeps the centroid)
 *     fixedRotation: false, linearDamping: 0, angularDamping: 0, gravityScale: 1,
 *     allowSleep: true, label, userData
 *   });
 *
 * The body origin is `position`; the solver works on the centre of mass `c`.
 * Forces added with applyForce act for one step and are then cleared;
 * body.lastApplied lists the ones that acted during the last step.
 * Applying a force, torque or impulse, or moving the body with setTransform,
 * wakes it (and, through islands.js, everything it is resting on).
 * Fixture filters default to { category: 1, mask: 0xFFFFFFFF, group: 0 };
 * see broadphase.js for the rules. A plain `group` on a shape is the same as
 * filter.group.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;
  var nextId = 1;

  function Body(def) {
    def = def || {};
    this.id = nextId++;
    this.type = def.type || 'dynamic';
    this.label = def.label || '';
    this.userData = def.userData || null;
    this.angle = def.angle || 0;
    this.q = M.rot(this.angle);
    this.v = def.velocity ? M.v(def.velocity.x, def.velocity.y) : M.v(0, 0);
    this.w = def.angularVelocity || 0;
    this.force = M.v(0, 0);
    this.torque = 0;
    // Forces applied since the last step, and the ones that acted during it
    // (the world moves appliedLog to lastApplied when it clears forces), so
    // gauges can show where each applied force acted.
    this.appliedLog = [];
    this.lastApplied = [];
    this.linearDamping = def.linearDamping || 0;
    this.angularDamping = def.angularDamping || 0;
    this.gravityScale = def.gravityScale == null ? 1 : def.gravityScale;
    this.fixedRotation = !!def.fixedRotation;
    this.awake = true;
    this.sleepTime = 0;
    this.allowSleep = def.allowSleep !== false;
    this.world = null;
    this.broken = false;
    var defMat = def.material || 'steel';
    this.fixtures = (def.shapes || []).map(function (s) {
      var f = s.shape ? s : { shape: s };
      var mat = P.material(f.material || defMat);
      var fx = {
        shape: f.shape, material: mat,
        density: f.density != null ? f.density : mat.density,
        friction: f.friction != null ? f.friction : mat.friction,
        restitution: f.restitution != null ? f.restitution : mat.restitution,
        sensor: !!f.sensor, group: 0, filter: null, body: null,
        // static / kinetic friction: the fixture's own values, else the
        // material's (only when the fixture didn't override `friction`)
        muS: f.muS != null ? f.muS : (f.friction == null && mat.muS != null ? mat.muS : null),
        muK: f.muK != null ? f.muK : (f.friction == null && mat.muK != null ? mat.muK : null),
        rollingResistance: f.rollingResistance != null ? f.rollingResistance : (mat.rollingResistance || 0),
        tangentSpeed: f.tangentSpeed || 0
      };
      var fl = f.filter || {};
      fx.filter = {
        category: fl.category != null ? fl.category : 1,
        mask: fl.mask != null ? fl.mask : 0xFFFFFFFF,
        group: fl.group != null ? fl.group : (f.group || 0)
      };
      fx.group = fx.filter.group;
      return fx;
    });
    var self = this;
    this.fixtures.forEach(function (f) { f.body = self; });
    this.localCenter = M.v(0, 0);
    this.c = M.v(def.position ? def.position.x : 0, def.position ? def.position.y : 0);
    this.massOverride = def.mass;
    this.updateMass();
    this.setTransform(def.position || M.v(0, 0), this.angle);
  }

  Body.prototype.updateMass = function () {
    this.m = 0; this.invM = 0; this.I = 0; this.invI = 0; this.localCenter = M.v(0, 0);
    if (this.type !== 'dynamic') return;
    var mass = 0, cx = 0, cy = 0, I = 0;
    this.fixtures.forEach(function (f) {
      if (f.sensor || f.density === 0) return;
      var md = P.massData(f.shape, f.density);
      mass += md.mass; cx += md.mass * md.center.x; cy += md.mass * md.center.y; I += md.I;
    });
    if (mass <= 0) { mass = 1; I = 1; }
    var center = M.v(cx / mass, cy / mass);
    var Ic = I - mass * M.lenSq(center);                // about the centre of mass
    if (this.massOverride) { Ic *= this.massOverride / mass; mass = this.massOverride; }
    this.m = mass; this.invM = 1 / mass;
    this.localCenter = center;
    if (!this.fixedRotation && Ic > 0) { this.I = Ic; this.invI = 1 / Ic; }
  };

  Body.prototype.setTransform = function (p, angle) {
    this.angle = angle; this.q = M.rot(angle);
    this.c = M.add(M.rotate(this.q, this.localCenter), p);
    if (this.world && this.type !== 'static') this.wake();
  };

  // Body origin in world space.
  Object.defineProperty(Body.prototype, 'position', {
    get: function () { return M.sub(this.c, M.rotate(this.q, this.localCenter)); }
  });

  Body.prototype.transform = function () { return { p: this.position, q: this.q }; };
  Body.prototype.worldPoint = function (local) { return M.add(M.rotate(this.q, local), this.position); };
  Body.prototype.localPoint = function (world) { return M.invRotate(this.q, M.sub(world, this.position)); };
  Body.prototype.velocityAt = function (world) { return M.add(this.v, M.crossSV(this.w, M.sub(world, this.c))); };

  Body.prototype.applyForce = function (F, worldPoint) {
    if (this.type !== 'dynamic') return;
    this.force = M.add(this.force, F);
    if (worldPoint) this.torque += M.cross(M.sub(worldPoint, this.c), F);
    this.appliedLog.push({ vector: M.v(F.x, F.y), point: worldPoint ? M.v(worldPoint.x, worldPoint.y) : null, torque: 0 });
    if (this.awake === false) this.wake();
  };
  Body.prototype.applyTorque = function (T) {
    if (this.type !== 'dynamic') return;
    this.torque += T;
    this.appliedLog.push({ vector: M.v(0, 0), point: null, torque: T });
    if (this.awake === false) this.wake();
  };
  Body.prototype.applyImpulse = function (J, worldPoint) {
    if (this.type !== 'dynamic') return;
    this.v = M.mulAdd(this.v, this.invM, J);
    if (worldPoint) this.w += this.invI * M.cross(M.sub(worldPoint, this.c), J);
    if (this.awake === false) this.wake();
  };

  Body.prototype.wake = function () { this.awake = true; this.sleepTime = 0; };

  Body.prototype.kineticEnergy = function () {
    return 0.5 * this.m * M.lenSq(this.v) + 0.5 * this.I * this.w * this.w;
  };

  Body.prototype.aabb = function () {
    var t = this.transform(), lo = M.v(Infinity, Infinity), hi = M.v(-Infinity, -Infinity);
    this.fixtures.forEach(function (f) {
      var b = P.aabb(f.shape, t);
      lo.x = Math.min(lo.x, b.lo.x); lo.y = Math.min(lo.y, b.lo.y);
      hi.x = Math.max(hi.x, b.hi.x); hi.y = Math.max(hi.y, b.hi.y);
    });
    return { lo: lo, hi: hi };
  };

  Body.prototype.containsPoint = function (pw) {
    var t = this.transform();
    return this.fixtures.some(function (f) { return P.testPoint(f.shape, t, pw); });
  };

  P.Body = Body;
})(globalThis.SE);
