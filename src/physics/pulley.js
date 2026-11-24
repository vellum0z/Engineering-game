/*
 * Pulleys and block-and-tackle rigs.
 *
 * Both are built on a rope path: a single line made of straight runs between
 * points that are fixed in the world or carried by bodies. Each run i has a
 * factor k_i (how many parts of line it stands for), and the line keeps
 *   sum k_i |q_i - p_i| <= length
 * with tension T >= 0 the same everywhere along it. Each body gets the pull of
 * every run that ends on it, so a 4-part tackle puts 4T on the load block.
 * Sheaves are treated as frictionless points, so T is uniform.
 *
 *   new SE.phys.PulleyJoint({
 *     bodyA, bodyB, localAnchorA, localAnchorB (or worldAnchorA/B),
 *     groundAnchorA, groundAnchorB, world points the two sides hang from
 *     ratio,                        lengthA + ratio·lengthB = constant (default 1)
 *     length,                       that constant (default: as built)
 *     EA,                           optional axial stiffness of the line, N
 *     breakForce })                 rates the line on side A
 * Each side only pulls: tensionA() = T and tensionB() = ratio·T, in N. With
 * ratio 1 and two hanging masses this is the Atwood machine.
 *
 *   P.pulley.tackle(world, {
 *     block: { body, localAnchor },   the fixed upper block (body null = world point)
 *     load:  { body, localAnchor },   the moving block / hook
 *     n,                               parts of line supporting the load
 *     haul:  { body, localAnchor }     the free end, pulled by a body, or
 *     winch: { body, localAnchor, ...WinchJoint options }  wound on a drum
 *   })
 * returns a PulleyJoint (haul) or a WinchJoint (winch) whose line tension is
 * W/n for a load W held still: mechanical advantage n.
 *
 * P.RopePath is exported for winch.js and other line-based joints.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys, Joint = P.Joint;

  /* ----------------------------------------------------------- rope path */
  // runs: [{ a: { body | null, local }, b: { body | null, local }, k }]
  // A null body means `local` is a world point.
  function RopePath(runs) {
    this.runs = runs;
    var bodies = [];
    runs.forEach(function (r) {
      [r.a, r.b].forEach(function (e) { if (e.body && bodies.indexOf(e.body) < 0) bodies.push(e.body); });
    });
    this.bodies = bodies;
    this.lin = bodies.map(function () { return M.v(0, 0); });
    this.ang = bodies.map(function () { return 0; });
  }

  function endPoint(e) {
    if (!e.body) return { p: e.local, r: null };
    var B = e.body, r = M.rotate(B.q, M.sub(e.local, B.localCenter));
    return { p: M.add(B.c, r), r: r };
  }

  // Current length and the Jacobian of length with respect to each body's velocity.
  RopePath.prototype.update = function () {
    var bodies = this.bodies, lin = this.lin, ang = this.ang, total = 0, i;
    for (i = 0; i < bodies.length; i++) { lin[i] = M.v(0, 0); ang[i] = 0; }
    for (i = 0; i < this.runs.length; i++) {
      var run = this.runs[i], a = endPoint(run.a), b = endPoint(run.b);
      var d = M.sub(b.p, a.p), L = M.len(d);
      run.len = L;
      total += run.k * L;
      if (L < 1e-9) continue;
      var u = M.scale(d, run.k / L);
      if (run.b.body) { var ib = bodies.indexOf(run.b.body); lin[ib] = M.add(lin[ib], u); ang[ib] += M.cross(b.r, u); }
      if (run.a.body) { var ia = bodies.indexOf(run.a.body); lin[ia] = M.sub(lin[ia], u); ang[ia] -= M.cross(a.r, u); }
    }
    this.total = total;
    var K = 0;
    for (i = 0; i < bodies.length; i++) K += bodies[i].invM * M.lenSq(lin[i]) + bodies[i].invI * ang[i] * ang[i];
    this.mass = K > 0 ? 1 / K : 0;
    return total;
  };

  // Rate of change of the path length, m/s.
  RopePath.prototype.rate = function () {
    var s = 0;
    for (var i = 0; i < this.bodies.length; i++) {
      var B = this.bodies[i];
      s += M.dot(this.lin[i], B.v) + this.ang[i] * B.w;
    }
    return s;
  };

  // Apply a tension impulse T·h (N·s); positive pulls the line's ends in.
  RopePath.prototype.pull = function (imp) {
    for (var i = 0; i < this.bodies.length; i++) {
      var B = this.bodies[i];
      B.v = M.mulAdd(B.v, -B.invM * imp, this.lin[i]);
      B.w -= B.invI * this.ang[i] * imp;
    }
  };

  // Force the line puts on one body for tension T (N).
  RopePath.prototype.forceOn = function (body, T) {
    var i = this.bodies.indexOf(body);
    return i < 0 ? M.v(0, 0) : M.scale(this.lin[i], -T);
  };

  // { force, torque, point } on one body for tension T: the resultant of
  // every run pulling on it, placed at the first point the line touches it,
  // with torque the couple left over when several runs pull on one body
  // (a drum and a sheave on the same crane). null if the line misses it.
  RopePath.prototype.reactionOn = function (body, T) {
    var F = M.v(0, 0), point = null, moment = 0;
    for (var i = 0; i < this.runs.length; i++) {
      var run = this.runs[i], a = endPoint(run.a), b = endPoint(run.b);
      var d = M.sub(b.p, a.p), L = M.len(d);
      if (L < 1e-9) continue;
      var u = M.scale(d, run.k * T / L);           // pull on a toward b
      [[run.a, a, u], [run.b, b, M.neg(u)]].forEach(function (e) {
        if (e[0].body !== body) return;
        if (!point) point = e[1].p;
        F = M.add(F, e[2]);
        moment += M.cross(M.sub(e[1].p, point), e[2]);
      });
    }
    return point ? { force: F, torque: moment, point: point } : null;
  };

  /*
   * One substep of a line held to rest length L, whose rest length is moving
   * in at `speed` m/s (0 for a fixed line). acc is the accumulated tension
   * impulse, kept in [0, cap]. Returns the new accumulated impulse.
   *   s = length - L (stretch), ds/dt = rate + speed
   * Inextensible: speculative while slack, joint softness when stretched.
   * With an elastic line (spring from lineSpring) the spring acts in every
   * pass, pulling only. A line too stiff for the substep to resolve is solved
   * as inextensible at its stretched length L + T/k instead.
   */
  function solveLine(path, L, speed, acc, cap, h, useBias, jointSoft, spring) {
    path.update();
    var mass = path.mass;
    if (mass === 0) return acc;
    if (spring && !spring.soft) L += acc / (h * spring.k);
    var s = path.total - L, sdot = path.rate() + speed, imp;
    if (spring && spring.soft) {
      var sp = spring.soft;
      imp = mass * sp.massScale * (sdot + sp.biasRate * s) - sp.impulseScale * acc;
    } else if (s < 0) {
      imp = mass * (sdot + s / h);
    } else if (useBias) {
      imp = mass * jointSoft.massScale * (sdot + jointSoft.biasRate * s) - jointSoft.impulseScale * acc;
    } else {
      imp = mass * sdot;
    }
    var next = M.clamp(acc + imp, 0, cap);
    path.pull(next - acc);
    return next;
  }

  // Spring for a line of axial stiffness EA and length L: { k, soft }, with
  // soft null when the line's frequency is above the joint stiffness the
  // solver resolves (cfg.jointHertz); such a line is solved as stiff.
  function lineSpring(EA, L, path, h, zeta, cfg) {
    if (!EA) return null;
    path.update();
    if (path.mass === 0) return null;
    var k = EA / Math.max(L, 1e-3), hz = Math.sqrt(k / path.mass) / (2 * Math.PI);
    return { k: k, soft: hz > cfg.jointHertz ? null : P.softness(hz, zeta, h) };
  }

  /* ---------------------------------------------------------- pulley joint */
  function PulleyJoint(def) {
    Joint.call(this, def);
    this.type = 'pulley';
    if (def.worldAnchorA) this.localAnchorA = this.bodyA.localPoint(def.worldAnchorA);
    if (def.worldAnchorB) this.localAnchorB = this.bodyB.localPoint(def.worldAnchorB);
    var gA = def.groundAnchorA || def.groundA, gB = def.groundAnchorB || def.groundB;
    this.groundAnchorA = M.v(gA.x, gA.y);
    this.groundAnchorB = M.v(gB.x, gB.y);
    this.ratio = def.ratio || 1;
    this.EA = def.EA || 0;
    this.dampingRatio = def.dampingRatio == null ? 0.1 : def.dampingRatio;
    this.path = new RopePath([
      { a: { body: null, local: this.groundAnchorA }, b: { body: this.bodyA, local: this.localAnchorA }, k: 1 },
      { a: { body: null, local: this.groundAnchorB }, b: { body: this.bodyB, local: this.localAnchorB }, k: this.ratio }
    ]);
    this.length = def.length != null ? def.length : this.path.update();
    this.impulse = 0;
  }
  PulleyJoint.prototype = Object.create(Joint.prototype);

  PulleyJoint.prototype.prepare = function (h, cfg) {
    this.invH = 1 / h;
    this.jointSoft = P.softness(cfg.jointHertz, cfg.jointDampingRatio, h);
    this.spring = lineSpring(this.EA, this.length, this.path, h, this.dampingRatio, cfg);
  };
  PulleyJoint.prototype.warmStart = function () { this.path.update(); this.path.pull(this.impulse); };
  PulleyJoint.prototype.solve = function (h, useBias) {
    this.impulse = solveLine(this.path, this.length, 0, this.impulse, Infinity, h, useBias, this.jointSoft, this.spring);
  };
  PulleyJoint.prototype.tensionA = function () { return this.impulse * this.invH; };
  PulleyJoint.prototype.tensionB = function () { return this.ratio * this.impulse * this.invH; };
  PulleyJoint.prototype.tension = PulleyJoint.prototype.tensionA;
  PulleyJoint.prototype.force = PulleyJoint.prototype.tensionA;
  PulleyJoint.prototype.lengthA = function () { this.path.update(); return this.path.runs[0].len; };
  PulleyJoint.prototype.lengthB = function () { this.path.update(); return this.path.runs[1].len; };
  PulleyJoint.prototype.isSlack = function () { return this.path.update() < this.length - P.LINEAR_SLOP; };
  PulleyJoint.prototype.reactionOn = function (body) { return this.path.reactionOn(body, this.tensionA()); };
  PulleyJoint.prototype.reaction = function () {
    this.path.update();
    return { force: this.path.forceOn(this.bodyB, this.tensionA()), torque: 0 };
  };

  /* -------------------------------------------------------- block and tackle */
  function end(e) { return { body: e.body || null, local: e.localAnchor ? M.v(e.localAnchor.x, e.localAnchor.y) : M.v(0, 0) }; }

  function tackle(world, o) {
    var n = o.n || 2, block = end(o.block), load = end(o.load);
    var blockPoint = block.body ? block.body.worldPoint(block.local) : block.local;
    var j;
    if (o.winch) {
      var def = Object.assign({}, o.winch, {
        bodyA: o.winch.body, localAnchorA: o.winch.localAnchor,
        bodyB: load.body, localAnchorB: load.local,
        via: block, parts: n
      });
      delete def.body; delete def.localAnchor;
      j = new P.WinchJoint(def);
    } else {
      var haul = end(o.haul);
      j = new PulleyJoint({
        bodyA: haul.body, localAnchorA: haul.local, groundAnchorA: blockPoint,
        bodyB: load.body, localAnchorB: load.local, groundAnchorB: blockPoint,
        ratio: n, EA: o.EA, breakForce: o.breakForce, label: o.label
      });
    }
    j.mechanicalAdvantage = n;
    if (world) world.addJoint(j);
    return j;
  }

  // scenes (serialize.js) rebuild a pulley from these definition fields
  (P.jointTypes = P.jointTypes || {}).pulley = { ctor: PulleyJoint,
    fields: ['groundAnchorA', 'groundAnchorB', 'ratio', 'length', 'EA', 'dampingRatio'] };

  P.RopePath = RopePath;
  P.solveLine = solveLine;
  P.lineSpring = lineSpring;
  P.PulleyJoint = PulleyJoint;
  P.pulley = { tackle: tackle };
})(globalThis.SE);
