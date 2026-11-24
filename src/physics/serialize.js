/*
 * Snapshots and JSON scenes.
 *
 * Two different jobs:
 *
 *   var snap = SE.phys.snapshot(world);   // in-memory, opaque
 *   SE.phys.restore(world, snap);         // back to exactly that moment
 * A snapshot is the full runtime state: every body's pose, velocity, forces
 * and sleep state, every joint's accumulated impulses and runtime fields
 * (winch line paid out, peak force so far, broken flag), the contact map
 * with its warm-start impulses, the body and joint lists (so joints that
 * broke come back), time, stepCount and the event log. Stepping after a
 * restore repeats the original run bit for bit. This is what the build
 * yard's Reset and the job judge's "try again" use. Listeners are not part
 * of the state and stay attached.
 *
 * The copy is generic: own fields of each body, fixture, joint and of the
 * world are cloned (plain objects, arrays and Maps deep, numbers as-is),
 * while references to bodies, joints, fixtures, shapes and materials stay
 * references. So a joint module that adds a new runtime field gets it
 * snapshotted without touching this file. Fields that appeared after the
 * snapshot are removed on restore, so lazily created fields (peakForce,
 * sleepTime) don't leak from the later run into the replay.
 *
 *   var scene = SE.phys.toScene(world);   // plain JSON-able object
 *   var w2 = SE.phys.fromScene(scene);    // scene object or JSON string
 * A scene is a design: bodies (type, position, angle, velocity, shapes,
 * material by name, mass override, damping, label, userData when it is plain
 * JSON) and joints (type, bodies by index, local anchors, every definition
 * field), plus gravity, substeps and the solver settings. Runtime impulses
 * are not saved; a scene loads as a fresh world. Format:
 *   { version: 1, gravity, substeps, cfg, bodies: [...], joints: [...] }
 *
 * Joint types are handled through a registry so joint modules can add
 * themselves:
 *   SE.phys.jointTypes[type] = { toJSON(joint, indexOf) -> obj,
 *                                fromJSON(obj, bodies) -> joint }
 * or, for the common case of "constructor + list of definition fields",
 * from a joint file (which loads before this one):
 *   (SE.phys.jointTypes = SE.phys.jointTypes || {}).prismatic =
 *     { ctor: PrismaticJoint, fields: ['localAxisA', 'referenceAngle', ...] };
 * or after load: SE.phys.registerJointType(type, Ctor, fields).
 * The shared fields (bodies, localAnchorA/B, collideConnected, breakForce,
 * breakTorque, label, userData) are always handled. A joint whose type has
 * no entry makes toScene / fromScene throw, naming the type.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;
  var SCENE_VERSION = 1;

  /* ------------------------------------------------------------ cloning */
  function isPlain(v) {
    var p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
  }

  // Deep copy of plain data; anything in `refs`, and any class instance
  // (Body, Joint, World...), is kept as the same reference.
  function clone(v, refs) {
    if (v === null || typeof v !== 'object') return v;
    if (refs.has(v)) return v;
    if (Array.isArray(v)) {
      var a = new Array(v.length);
      for (var i = 0; i < v.length; i++) a[i] = clone(v[i], refs);
      return a;
    }
    if (v instanceof Map) {
      var m = new Map();
      v.forEach(function (val, k) { m.set(k, clone(val, refs)); });
      return m;
    }
    if (ArrayBuffer.isView(v)) return v.slice();
    if (!isPlain(v)) return v;
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k], refs);
    return o;
  }

  function captureFields(obj, skip, refs) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (!skip[k]) out[k] = clone(obj[k], refs); });
    return out;
  }

  function restoreFields(obj, saved, skip, refs) {
    Object.keys(obj).forEach(function (k) {
      if (!skip[k] && !Object.prototype.hasOwnProperty.call(saved, k)) delete obj[k];
    });
    Object.keys(saved).forEach(function (k) { obj[k] = clone(saved[k], refs); });
  }

  var SKIP_WORLD = { listeners: true };
  var SKIP_BODY = { world: true, fixtures: true, userData: true };
  var SKIP_FIXTURE = { body: true, shape: true, material: true };
  var SKIP_JOINT = { bodyA: true, bodyB: true, userData: true };

  function refSet(bodies, joints) {
    var refs = new Set();
    bodies.forEach(function (b) {
      refs.add(b);
      if (b.userData && typeof b.userData === 'object') refs.add(b.userData);
      b.fixtures.forEach(function (f) { refs.add(f); refs.add(f.shape); refs.add(f.material); });
    });
    joints.forEach(function (j) {
      refs.add(j);
      if (j.userData && typeof j.userData === 'object') refs.add(j.userData);
    });
    return refs;
  }

  /* ---------------------------------------------------------- snapshots */
  function snapshot(world) {
    var bodies = world.bodies.slice(), joints = world.joints.slice();
    var refs = refSet(bodies, joints);
    return {
      world: captureFields(world, SKIP_WORLD, refs),
      bodies: bodies.map(function (b) {
        return {
          body: b, state: captureFields(b, SKIP_BODY, refs),
          fixtures: b.fixtures.map(function (f) { return captureFields(f, SKIP_FIXTURE, refs); })
        };
      }),
      joints: joints.map(function (j) { return { joint: j, state: captureFields(j, SKIP_JOINT, refs) }; }),
      refs: refs
    };
  }

  function restore(world, snap) {
    var refs = snap.refs;
    restoreFields(world, snap.world, SKIP_WORLD, refs);
    snap.bodies.forEach(function (e) {
      restoreFields(e.body, e.state, SKIP_BODY, refs);
      e.body.world = world;
      e.body.fixtures.forEach(function (f, i) { restoreFields(f, e.fixtures[i], SKIP_FIXTURE, refs); });
    });
    snap.joints.forEach(function (e) { restoreFields(e.joint, e.state, SKIP_JOINT, refs); });
    return world;
  }

  /* -------------------------------------------------------------- scenes */
  // Plain JSON copy, or undefined if the value doesn't survive JSON.
  function jsonOrUndefined(v) {
    if (v == null) return undefined;
    try {
      var s = JSON.stringify(v);
      return s === undefined ? undefined : JSON.parse(s);
    } catch (e) { return undefined; }
  }
  function vec(v) { return { x: v.x, y: v.y }; }

  function materialJSON(mat) {
    return P.MATERIALS && P.MATERIALS[mat.name] === mat ? mat.name : jsonOrUndefined(mat);
  }

  function bodyToJSON(b) {
    var pos = b.position;
    var o = {
      type: b.type,
      position: vec(pos),
      angle: b.angle,
      velocity: vec(b.v),
      angularVelocity: b.w,
      shapes: b.fixtures.map(function (f) {
        var s = { shape: jsonOrUndefined(f.shape), material: materialJSON(f.material),
          density: f.density, friction: f.friction, restitution: f.restitution };
        if (f.sensor) s.sensor = true;
        if (f.group) s.group = f.group;
        return s;
      })
    };
    if (b.massOverride) o.mass = b.massOverride;
    if (b.fixedRotation) o.fixedRotation = true;
    if (b.linearDamping) o.linearDamping = b.linearDamping;
    if (b.angularDamping) o.angularDamping = b.angularDamping;
    if (b.gravityScale !== 1) o.gravityScale = b.gravityScale;
    if (b.awake === false) o.awake = false;
    if (b.label) o.label = b.label;
    var ud = jsonOrUndefined(b.userData);
    if (ud !== undefined) o.userData = ud;
    return o;
  }

  function bodyFromJSON(o) {
    var b = new P.Body({
      type: o.type, position: o.position, angle: o.angle || 0,
      velocity: o.velocity, angularVelocity: o.angularVelocity || 0,
      shapes: (o.shapes || []).map(function (s) {
        return { shape: s.shape, material: s.material, density: s.density, friction: s.friction,
          restitution: s.restitution, sensor: s.sensor, group: s.group };
      }),
      mass: o.mass, fixedRotation: o.fixedRotation, linearDamping: o.linearDamping,
      angularDamping: o.angularDamping, gravityScale: o.gravityScale,
      label: o.label, userData: o.userData
    });
    if (o.awake === false) b.awake = false;
    return b;
  }

  // Fields every joint has. Infinite limits are left out (JSON has no
  // Infinity) and come back as the constructor's default.
  function commonToJSON(j, indexOf) {
    var o = { type: j.type, bodyA: indexOf(j.bodyA), bodyB: indexOf(j.bodyB),
      localAnchorA: vec(j.localAnchorA), localAnchorB: vec(j.localAnchorB) };
    if (j.collideConnected) o.collideConnected = true;
    if (isFinite(j.breakForce)) o.breakForce = j.breakForce;
    if (j.breakTorque != null && isFinite(j.breakTorque)) o.breakTorque = j.breakTorque;
    if (j.label) o.label = j.label;
    var ud = jsonOrUndefined(j.userData);
    if (ud !== undefined) o.userData = ud;
    return o;
  }

  function commonDef(o, bodies) {
    var A = bodies[o.bodyA], B = bodies[o.bodyB];
    if (!A || !B) throw new Error('scene joint "' + o.type + '" refers to a missing body (' + o.bodyA + ', ' + o.bodyB + ')');
    var def = { bodyA: A, bodyB: B, localAnchorA: o.localAnchorA, localAnchorB: o.localAnchorB,
      collideConnected: o.collideConnected, label: o.label, userData: o.userData };
    if (o.breakForce != null) def.breakForce = o.breakForce;
    if (o.breakTorque != null) def.breakTorque = o.breakTorque;
    return def;
  }

  // Joint files load before this one, so they register by writing
  // `(SE.phys.jointTypes = SE.phys.jointTypes || {}).mytype = { ctor, fields }`
  // (or a full { toJSON, fromJSON }); entries already there are kept.
  var jointTypes = P.jointTypes || {};

  // Codec for a joint built as `new Ctor(def)` whose extra definition fields
  // are stored on the joint under the same names.
  function registerJointType(type, Ctor, fields) {
    fields = fields || [];
    jointTypes[type] = {
      toJSON: function (j, indexOf) {
        var o = commonToJSON(j, indexOf);
        fields.forEach(function (k) {
          var v = jsonOrUndefined(j[k]);
          if (typeof j[k] === 'number' && !isFinite(j[k])) v = undefined;
          if (v !== undefined) o[k] = v;
        });
        return o;
      },
      fromJSON: function (o, bodies) {
        var def = commonDef(o, bodies);
        fields.forEach(function (k) { if (o[k] !== undefined) def[k] = o[k]; });
        return new Ctor(def);
      }
    };
    return jointTypes[type];
  }

  // Joint types that exist when this file loads. length and referenceAngle
  // are saved explicitly: their constructors would otherwise recompute them
  // from wherever the bodies happen to be.
  if (P.DistanceJoint && !jointTypes.distance) registerJointType('distance', P.DistanceJoint, ['length', 'rope', 'hertz', 'dampingRatio', 'stiffness', 'damping']);
  if (P.RevoluteJoint && !jointTypes.revolute) registerJointType('revolute', P.RevoluteJoint, []);
  if (P.WeldJoint && !jointTypes.weld) registerJointType('weld', P.WeldJoint, ['referenceAngle', 'angularStiffness', 'angularDamping']);

  function codec(type) {
    var c = jointTypes[type];
    if (c && !c.toJSON && c.ctor) c = registerJointType(type, c.ctor, c.fields);
    if (!c) {
      throw new Error('cannot serialize joint type "' + type + '": no entry in SE.phys.jointTypes ' +
        '(known: ' + Object.keys(jointTypes).join(', ') + ')');
    }
    return c;
  }

  function toScene(world) {
    var index = new Map();
    world.bodies.forEach(function (b, i) { index.set(b, i); });
    var indexOf = function (b) {
      if (!index.has(b)) throw new Error('joint refers to a body that is not in the world');
      return index.get(b);
    };
    return {
      version: SCENE_VERSION,
      gravity: vec(world.gravity),
      substeps: world.substeps,
      cfg: jsonOrUndefined(world.cfg),
      bodies: world.bodies.map(bodyToJSON),
      joints: world.joints.map(function (j) { return codec(j.type).toJSON(j, indexOf); })
    };
  }

  function fromScene(scene) {
    if (typeof scene === 'string') scene = JSON.parse(scene);
    if (!scene || typeof scene !== 'object') throw new Error('scene must be an object or JSON string');
    if (scene.version !== SCENE_VERSION) throw new Error('unsupported scene version ' + scene.version + ' (expected ' + SCENE_VERSION + ')');
    var def = Object.assign({}, scene.cfg || {}, { gravity: scene.gravity, substeps: scene.substeps });
    var world = new P.World(def);
    var bodies = (scene.bodies || []).map(function (o) { return world.add(bodyFromJSON(o)); });
    (scene.joints || []).forEach(function (o) { world.addJoint(codec(o.type).fromJSON(o, bodies)); });
    return world;
  }

  P.snapshot = snapshot;
  P.restore = restore;
  P.toScene = toScene;
  P.fromScene = fromScene;
  P.jointTypes = jointTypes;
  P.registerJointType = registerJointType;
  P.SCENE_VERSION = SCENE_VERSION;
})(globalThis.SE);
