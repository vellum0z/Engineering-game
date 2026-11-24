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
 * The copy is generic: own fields of each body, fixture, joint, structure
 * (beams, trusses, their loads and members) and of the world are cloned (plain objects, arrays and Maps deep, numbers as-is),
 * while references to bodies, joints, fixtures, shapes and materials stay
 * references. So a joint module that adds a new runtime field gets it
 * snapshotted without touching this file. Fields that appeared after the
 * snapshot are removed on restore, so lazily created fields (peakForce,
 * sleepTime) don't leak from the later run into the replay.
 * Modules whose state isn't plain data (the broadphase's trees and pair
 * set) keep it in fields starting with `_bp` on the world and the bodies;
 * those are skipped here and saved through the module's own
 * saveState(world) / loadState(world, state) hooks instead.
 *
 *   var scene = SE.phys.toScene(world);   // plain JSON-able object
 *   var w2 = SE.phys.fromScene(scene);    // scene object or JSON string
 * A scene is a design: bodies (type, position, angle, velocity, shapes,
 * material by name, mass override, damping, label, userData when it is plain
 * JSON) and joints (type, bodies by index, local anchors, every definition
 * field), plus gravity, substeps and the solver settings. Runtime impulses
 * are not saved; a scene loads as a fresh world. Format (version 2):
 *   { version: 2, gravity, substeps, cfg, bodies: [...], joints: [...],
 *     structures: [{ kind: 'beam' | 'truss', def, ground, loads }] }
 * Beams and trusses (structures.js) are stored as their build definition
 * `def`, rebuilt with SE.phys.structures[kind]. Their bodies and joints
 * appear in the lists as placeholders { structure: k } so everything comes
 * back in the original order; `ground` is the index of the support body
 * when the level supplied one (left out when the structure made its own)
 * and `loads` are the standing loads ({ x | node, F }). Version 1 scenes
 * (no structures) still load.
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
  var SCENE_VERSION = 2;

  /* ------------------------------------------------------------ cloning */
  function isPlain(v) {
    var p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
  }

  // Deep copy of plain data; anything in `refs`, and any class instance
  // (Body, Joint, World...), is kept as the same reference. `memo` keeps
  // shared sub-objects shared (a structure solver and its links hold the
  // same row objects, for example).
  function clone(v, refs, memo) {
    if (v === null || typeof v !== 'object') return v;
    if (refs.has(v)) return v;
    var seen = memo.get(v);
    if (seen) return seen;
    if (Array.isArray(v)) {
      var a = new Array(v.length);
      memo.set(v, a);
      for (var i = 0; i < v.length; i++) a[i] = clone(v[i], refs, memo);
      return a;
    }
    if (v instanceof Map) {
      var m = new Map();
      memo.set(v, m);
      v.forEach(function (val, k) { m.set(k, clone(val, refs, memo)); });
      return m;
    }
    if (ArrayBuffer.isView(v)) { var t = v.slice(); memo.set(v, t); return t; }
    if (!isPlain(v)) return v;
    var o = {};
    memo.set(v, o);
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k], refs, memo);
    return o;
  }

  // Fields owned by a module's saveState/loadState hooks, not copied here.
  function hooked(k) { return k.charCodeAt(0) === 95 && k.lastIndexOf('_bp', 0) === 0; }

  function captureFields(obj, skip, refs, memo) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (!skip[k] && !hooked(k)) out[k] = clone(obj[k], refs, memo); });
    return out;
  }

  function restoreFields(obj, saved, skip, refs, memo) {
    Object.keys(obj).forEach(function (k) {
      if (!skip[k] && !hooked(k) && !Object.prototype.hasOwnProperty.call(saved, k)) delete obj[k];
    });
    Object.keys(saved).forEach(function (k) { obj[k] = clone(saved[k], refs, memo); });
  }

  var SKIP_NONE = {};
  var SKIP_WORLD = { listeners: true };
  var SKIP_BODY = { world: true, fixtures: true, userData: true };
  var SKIP_FIXTURE = { body: true, shape: true, material: true };
  var SKIP_JOINT = { bodyA: true, bodyB: true, userData: true };

  // Everything whose identity matters and whose fields are state: these are
  // restored in place, so outside references to them (a beam handle, a load
  // handle the level keeps to change F) stay valid.
  function tracked(world) {
    var list = [{ obj: world, skip: SKIP_WORLD }], refs = new Set([world]);
    var add = function (obj, skip) { if (obj && !refs.has(obj)) { refs.add(obj); list.push({ obj: obj, skip: skip }); } };
    world.bodies.forEach(function (b) {
      add(b, SKIP_BODY);
      if (b.userData && typeof b.userData === 'object') refs.add(b.userData);
      b.fixtures.forEach(function (f) { add(f, SKIP_FIXTURE); refs.add(f.shape); refs.add(f.material); });
    });
    world.joints.forEach(function (j) {
      add(j, SKIP_JOINT);
      if (j.userData && typeof j.userData === 'object') refs.add(j.userData);
    });
    // beams and trusses: the structure object, its loads and truss members
    (world.structures || []).forEach(function (st) {
      add(st, SKIP_NONE);
      (st.loads || []).forEach(function (ld) { add(ld, SKIP_NONE); });
      (st.members || []).forEach(function (m) { add(m, SKIP_NONE); });
      if (st.material) refs.add(st.material);
    });
    return { list: list, refs: refs };
  }

  /* ---------------------------------------------------------- snapshots */
  // Stage modules with their own saveState/loadState, called in this order.
  var HOOKED = ['broadphase', 'islands'];
  function hookStates(world) {
    var out = {};
    HOOKED.forEach(function (name) {
      var mod = P[name];
      if (mod && mod.saveState) out[name] = mod.saveState(world);
    });
    return out;
  }

  function snapshot(world) {
    var t = tracked(world), memo = new Map();
    return {
      entries: t.list.map(function (e) { return { obj: e.obj, skip: e.skip, state: captureFields(e.obj, e.skip, t.refs, memo) }; }),
      hooks: hookStates(world),
      refs: t.refs
    };
  }

  function restore(world, snap) {
    var memo = new Map();
    snap.entries.forEach(function (e) { restoreFields(e.obj, e.state, e.skip, snap.refs, memo); });
    world.bodies.forEach(function (b) { b.world = world; });
    HOOKED.forEach(function (name) {
      var mod = P[name];
      if (mod && mod.loadState && snap.hooks) mod.loadState(world, snap.hooks[name] === undefined ? null : snap.hooks[name]);
    });
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
        if (f.muS != null) s.muS = f.muS;
        if (f.muK != null) s.muK = f.muK;
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
          muS: s.muS, muK: s.muK, restitution: s.restitution, sensor: s.sensor, group: s.group };
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
  if (P.DistanceJoint && !jointTypes.distance) registerJointType('distance', P.DistanceJoint, ['length', 'rope', 'hertz', 'dampingRatio', 'stiffness', 'damping', 'minLength', 'maxLength', 'EA', 'motorSpeed', 'maxMotorForce']);
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

  /* ---------------------------------------------------------- structures */
  // Beams and trusses are saved as the call that built them, not as the
  // dozens of bodies and links they made. In the body and joint lists a
  // structure's parts are a placeholder { structure: k } at each place they
  // occupy, so after rebuilding, the lists come back in the same order (the
  // solver's results depend on that order).
  function structureOf(world) {
    var bodyOwner = new Map(), jointOwner = new Map();
    (world.structures || []).forEach(function (st, k) {
      var mine = function (b) { return b && b.userData && b.userData.structure === st; };
      world.bodies.forEach(function (b) { if (mine(b) || (st.ownsGround && b === st.ground)) bodyOwner.set(b, k); });
      world.joints.forEach(function (j) { if (j === st.solver || (j.part && j.part.structure === st)) jointOwner.set(j, k); });
    });
    return { body: bodyOwner, joint: jointOwner };
  }

  function structureToJSON(st, indexOf) {
    var o = { kind: st.kind, def: jsonOrUndefined(st.def) };
    if (st.ground && !st.ownsGround) o.ground = indexOf(st.ground);
    if (st.loads && st.loads.length) {
      o.loads = st.loads.map(function (ld) {
        return st.kind === 'truss' ? { node: ld.node, F: vec(ld.F) } : { x: ld.x, F: vec(ld.F) };
      });
    }
    return o;
  }

  function buildStructure(world, o, ground) {
    var make = P.structures && P.structures[o.kind];
    if (!make) throw new Error('cannot rebuild structure kind "' + o.kind + '": no SE.phys.structures.' + o.kind);
    var def = Object.assign({}, o.def);
    if (ground) def.ground = ground;
    var st = make(world, def);
    (o.loads || []).forEach(function (ld) {
      if (st.kind === 'truss') st.load(ld.node, ld.F); else st.load(ld.x, ld.F);
    });
    return st;
  }

  /* --------------------------------------------------------------- scenes */
  function toScene(world) {
    var index = new Map();
    world.bodies.forEach(function (b, i) { index.set(b, i); });
    var indexOf = function (b) {
      if (!index.has(b)) throw new Error('joint refers to a body that is not in the world');
      return index.get(b);
    };
    var owner = structureOf(world), placed = new Set();
    var joints = [];
    world.joints.forEach(function (j) {
      if (owner.joint.has(j)) {
        var k = owner.joint.get(j);
        if (!placed.has(k)) { placed.add(k); joints.push({ structure: k }); }
        return;
      }
      joints.push(codec(j.type).toJSON(j, indexOf));
    });
    return {
      version: SCENE_VERSION,
      gravity: vec(world.gravity),
      substeps: world.substeps,
      cfg: jsonOrUndefined(world.cfg),
      bodies: world.bodies.map(function (b) {
        return owner.body.has(b) ? { structure: owner.body.get(b) } : bodyToJSON(b);
      }),
      joints: joints,
      structures: (world.structures || []).map(function (st) { return structureToJSON(st, indexOf); })
    };
  }

  function fromScene(scene) {
    if (typeof scene === 'string') scene = JSON.parse(scene);
    if (!scene || typeof scene !== 'object') throw new Error('scene must be an object or JSON string');
    if (scene.version !== 1 && scene.version !== SCENE_VERSION) {
      throw new Error('unsupported scene version ' + scene.version + ' (this build reads 1 to ' + SCENE_VERSION + ')');
    }
    var def = Object.assign({}, scene.cfg || {}, { gravity: scene.gravity, substeps: scene.substeps });
    var world = new P.World(def);
    var list = scene.bodies || [], sdefs = scene.structures || [];
    var bodies = new Array(list.length), built = [];
    // where each structure's bodies go, in creation order
    var slotsOf = sdefs.map(function () { return []; });
    list.forEach(function (o, i) {
      if (o && o.structure != null) {
        if (!slotsOf[o.structure]) throw new Error('scene body ' + i + ' refers to missing structure ' + o.structure);
        slotsOf[o.structure].push(i);
      }
    });
    var plainBody = function (i) {
      if (!bodies[i]) bodies[i] = world.add(bodyFromJSON(list[i]));
      return bodies[i];
    };
    var structure = function (k) {
      if (built[k]) return built[k];
      var o = sdefs[k], ground = null;
      if (o.ground != null) {
        if (!list[o.ground] || list[o.ground].structure != null) throw new Error('structure ' + k + ' ground must be a plain body');
        ground = plainBody(o.ground);
      }
      var before = world.bodies.length;
      var st = built[k] = buildStructure(world, o, ground);
      var made = world.bodies.slice(before), slots = slotsOf[k];
      if (made.length !== slots.length) {
        throw new Error(o.kind + ' ' + k + ' rebuilt with ' + made.length + ' bodies, scene has ' + slots.length);
      }
      slots.forEach(function (i, n) { bodies[i] = made[n]; });
      return st;
    };
    list.forEach(function (o, i) { if (o && o.structure != null) structure(o.structure); else plainBody(i); });
    sdefs.forEach(function (o, k) { structure(k); });   // structures with no bodies listed
    world.bodies = bodies.concat(world.bodies.filter(function (b) { return bodies.indexOf(b) < 0; }));

    // joints, with each structure's links and solver at its placeholder
    var jointsOf = built.map(function (st) {
      return world.joints.filter(function (j) { return j === st.solver || (j.part && j.part.structure === st); });
    });
    var order = [], used = new Set();
    (scene.joints || []).forEach(function (o) {
      if (o && o.structure != null) {
        if (!jointsOf[o.structure]) throw new Error('scene joint refers to missing structure ' + o.structure);
        jointsOf[o.structure].forEach(function (j) { order.push(j); });
        used.add(o.structure);
      } else {
        order.push(codec(o.type).fromJSON(o, bodies));
      }
    });
    jointsOf.forEach(function (js, k) { if (!used.has(k)) js.forEach(function (j) { order.push(j); }); });
    world.joints = order;
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
