/*
 * Parts and designs: what the player builds in the yard.
 *
 * A part type is registered once:
 *
 *   SE.yard.definePart({
 *     type: 'crate', name: 'Crate', category: 'Loads',
 *     blurb: 'A box of salvage. Its mass is printed on the side.',
 *     size: { w: 1, h: 1 },                 // m, for the bin icon, hit test and ghosts
 *     dials: [{ key: 'mass', label: 'Mass', q: 'mass', def: '120 kg', locked }],
 *     anchors: { top: { x: 0, y: 0.5 } },   // named points in the part frame, m
 *     connector: false,                     // true: joins two anchors (inst.a, inst.b)
 *     onePerDesign: false,
 *     build: function (b) { ... },          // see the builder below
 *     plate: function (inst, b) -> ['WLL 2.0 kN', ...],   // rating plate lines (optional)
 *     readouts: function (built, b) -> [{ key, label, q, read: function (world) -> SI }],
 *     draw: function (ctx, cam, built, view) { ... }      // optional extra art on top
 *   });
 *
 * A part instance (what a design stores, plain JSON):
 *   { id: 'p3', type: 'crate', x, y, angle (rad), dials: { mass: '120 kg' },
 *     a: { part: 'p1', anchor: 'top' }, b: { part: 'ground', at: { x, y } },  // connectors
 *     locked: true,    // placed by the job: can't be moved or deleted
 *     fixed: ['mass'], // dials the player can't change
 *     label: 'scrap' }
 * A design is { parts: [instance, ...] }.
 *
 * SE.yard.build(design, site) makes a fresh physics world from a design:
 *   site = { g: 9.81, floor: 'concrete' | null, floorWidth: 60 }
 *   -> { world, ground, parts: { id: built }, errors: [{ part, key, error }],
 *        readouts: [...], site }
 * Parts build in order: bodies first, then connectors, so a connector can
 * always find both ends. A dial that doesn't parse leaves its part out of
 * the world and lists an error; the yard shows it on the part and won't run.
 *
 * The builder `b` handed to part.build:
 *   b.P, b.world, b.ground (static yard floor body), b.site, b.inst, b.def
 *   b.si(key)            the dial's value in SI (number); angles in rad
 *   b.text(key)          the dial exactly as typed
 *   b.at(local)          part-frame point -> world point
 *   b.body(def)          new P.Body(def) added to the world, tagged with this part
 *   b.joint(joint)       adds a joint, tagged with this part
 *   b.end('a' | 'b')     -> { body, local, world } for a connector end
 *   b.on(type, fn)       world listener (step, break, ...)
 * build returns `built`: { body, bodies, joints, anchors: { name: { body, local } },
 * gauges: { key: gauge }, ... anything the part wants to keep }. When it
 * returns a single `body` and no anchors, the part's own `anchors` table is
 * used on that body.
 */
(function (SE) {
  'use strict';
  SE.yard = SE.yard || {};
  var D = SE.yard.dial;
  var PARTS = {};

  function definePart(def) {
    if (!def.type || !def.build) throw new Error('definePart needs type and build');
    def.name = def.name || def.type;
    def.category = def.category || 'Misc';
    def.dials = def.dials || [];
    def.anchors = def.anchors || {};
    def.size = def.size || { w: 1, h: 1 };
    PARTS[def.type] = def;
    return def;
  }
  function partDef(type) { return PARTS[type] || null; }
  function partTypes() { return Object.keys(PARTS); }

  var nextId = 1;
  // New instance of a part type with its default dials.
  function makeInstance(type, props) {
    var def = PARTS[type];
    if (!def) throw new Error('unknown part type ' + type);
    var inst = { id: (props && props.id) || ('p' + (nextId++)), type: type, x: 0, y: 0, angle: 0, dials: {} };
    def.dials.forEach(function (dl) { inst.dials[dl.key] = dl.def; });
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'dials') Object.assign(inst.dials, props.dials);
      else inst[k] = props[k];
    });
    return inst;
  }

  function rot(a, p) { var c = Math.cos(a), s = Math.sin(a); return { x: c * p.x - s * p.y, y: s * p.x + c * p.y }; }

  // Parse every dial of an instance. -> { values: { key: si }, errors: [...] }
  function readDials(inst) {
    var def = PARTS[inst.type], values = {}, errors = [];
    def.dials.forEach(function (dl) {
      var txt = inst.dials && inst.dials[dl.key] != null ? inst.dials[dl.key] : dl.def;
      if (dl.choice) {
        if (dl.choice.indexOf(txt) < 0) errors.push({ part: inst.id, key: dl.key, label: dl.label, error: 'Pick one of: ' + dl.choice.join(', ') + '.' });
        else values[dl.key] = txt;
        return;
      }
      if (dl.optional && (txt == null || String(txt).trim() === '')) { values[dl.key] = null; return; }
      var r = D.parse(txt, dl.q);
      if (!r.ok) { errors.push({ part: inst.id, key: dl.key, label: dl.label, error: r.error }); return; }
      if (dl.min != null && r.si < dl.min) { errors.push({ part: inst.id, key: dl.key, label: dl.label, error: dl.label + ' must be at least ' + D.format(dl.min, D.QUANTITIES[dl.q].si, 3, dl.q) + '.' }); return; }
      if (dl.max != null && r.si > dl.max) { errors.push({ part: inst.id, key: dl.key, label: dl.label, error: dl.label + ' can be at most ' + D.format(dl.max, D.QUANTITIES[dl.q].si, 3, dl.q) + ' on this part.' }); return; }
      values[dl.key] = r.si;
    });
    return { values: values, errors: errors };
  }

  function build(design, site) {
    var P = SE.phys;
    site = Object.assign({ g: 9.81, floor: 'concrete', floorWidth: 80 }, site || {});
    var world = new P.World({ gravity: { x: 0, y: -site.g }, substeps: site.substeps || 4 });
    var ground;
    if (site.floor) {
      ground = world.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, label: 'floor', shapes: [{ shape: P.box(site.floorWidth / 2, 0.5), material: site.floor }] }));
    } else {
      ground = world.add(new P.Body({ type: 'static', position: { x: 0, y: -1000 }, label: 'anchor', shapes: [] }));
    }
    ground.userData = { part: 'ground' };
    var out = { world: world, ground: ground, parts: {}, errors: [], readouts: [], site: site, design: design };
    var parts = (design.parts || []).slice();
    var order = parts.filter(function (p) { return PARTS[p.type] && !PARTS[p.type].connector; })
      .concat(parts.filter(function (p) { return PARTS[p.type] && PARTS[p.type].connector; }));
    parts.forEach(function (p) { if (!PARTS[p.type]) out.errors.push({ part: p.id, error: 'Unknown part type ' + p.type }); });

    order.forEach(function (inst) {
      var def = PARTS[inst.type];
      var dials = readDials(inst);
      if (dials.errors.length) { out.errors = out.errors.concat(dials.errors); return; }
      var tagged = { bodies: [], joints: [] };
      var b = {
        P: P, world: world, ground: ground, site: site, inst: inst, def: def, out: out,
        si: function (k) { return dials.values[k]; },
        text: function (k) { return inst.dials[k]; },
        at: function (local) { var r = rot(inst.angle || 0, local); return { x: inst.x + r.x, y: inst.y + r.y }; },
        body: function (bd) {
          var body = world.add(new P.Body(bd));
          body.userData = Object.assign({}, bd.userData || {}, { part: inst.id });
          tagged.bodies.push(body); return body;
        },
        joint: function (j) { world.addJoint(j); j.userData = Object.assign({}, j.userData || {}, { part: inst.id }); tagged.joints.push(j); return j; },
        end: function (which) { return resolveEnd(out, inst[which], inst.id + '.' + which); },
        on: function (type, fn) { world.on(type, fn); }
      };
      var built;
      try { built = def.build(b) || {}; }
      catch (e) { out.errors.push({ part: inst.id, error: e.message }); return; }
      built.inst = inst; built.def = def; built.values = dials.values;
      built.bodies = built.bodies || tagged.bodies;
      built.joints = built.joints || tagged.joints;
      if (!built.body && built.bodies.length === 1) built.body = built.bodies[0];
      if (!built.anchors) {
        built.anchors = {};
        if (built.body) Object.keys(def.anchors).forEach(function (k) {
          built.anchors[k] = { body: built.body, local: built.body.localPoint(b.at(def.anchors[k])) };
        });
      }
      out.parts[inst.id] = built;
      if (def.readouts) {
        def.readouts(built, b).forEach(function (r) {
          out.readouts.push(Object.assign({ part: inst.id, id: inst.id + '.' + r.key, partLabel: inst.label || def.name }, r));
        });
      }
    });
    return out;
  }

  // A connector end: { part, anchor } | { part, local } | { part } (its centre of mass) | { part: 'ground', at } | { at } (ground)
  function resolveEnd(out, ref, who) {
    if (!ref) throw new Error((who || 'connector') + ' is not attached');
    if (ref.part === 'ground' || !ref.part) {
      var at = ref.at || { x: 0, y: 0 };
      return { body: out.ground, local: out.ground.localPoint(at), world: { x: at.x, y: at.y } };
    }
    var pb = out.parts[ref.part];
    if (!pb) throw new Error((who || 'connector') + ': part ' + ref.part + ' is missing or not set up');
    var a;
    if (ref.anchor) {
      a = pb.anchors[ref.anchor];
      if (!a) throw new Error((who || 'connector') + ': ' + ref.part + ' has no anchor "' + ref.anchor + '"');
    } else if (pb.body) a = { body: pb.body, local: ref.local || pb.body.localCenter || { x: 0, y: 0 } };
    else throw new Error((who || 'connector') + ': ' + ref.part + ' has nothing to attach to');
    return { body: a.body, local: a.local, world: a.body.worldPoint(a.local) };
  }

  // World positions of every anchor of every placed (non-connector) part, for snapping.
  function anchorsOf(design) {
    var list = [];
    (design.parts || []).forEach(function (inst) {
      var def = PARTS[inst.type];
      if (!def || def.connector) return;
      Object.keys(def.anchors).forEach(function (k) {
        var r = rot(inst.angle || 0, def.anchors[k]);
        list.push({ part: inst.id, anchor: k, x: inst.x + r.x, y: inst.y + r.y });
      });
    });
    return list;
  }

  // Parts in the manual-mode library: every registered part that doesn't opt
  // out (library: false), optionally limited to an act (def.act <= unlocked act).
  function library(unlocks) {
    var act = (unlocks && unlocks.act) || Infinity;
    return Object.keys(PARTS).filter(function (t) { var d = PARTS[t]; return d.library !== false && (d.act || 1) <= act; });
  }

  function clone(design) { return JSON.parse(JSON.stringify(design)); }

  SE.yard.definePart = definePart;
  SE.yard.partDef = partDef;
  SE.yard.partTypes = partTypes;
  SE.yard.PARTS = PARTS;
  SE.yard.makeInstance = makeInstance;
  SE.yard.readDials = readDials;
  SE.yard.build = build;
  SE.yard.resolveEnd = resolveEnd;
  SE.yard.anchorsOf = anchorsOf;
  SE.yard.cloneDesign = clone;
  SE.yard.library = library;
  SE.yard.rot = rot;
})(globalThis.SE);
