/*
 * P5 · Ghost Satellite & Moon Rig (manual project, played in the build yard).
 *
 * The salvage crew has opened an old space-agency training annex out past
 * the rail spur. Juno wants the lunar-gravity rig set right, a rumour about
 * falling satellite debris settled, the annex's gravity bench brought back
 * to life, and the lunar platform's survivor kit checked.
 *
 * Every job is a build the simulation judges:
 *   P5.rig      hang a counterweight over the rig sheave so an 80 kg trainee
 *               falls at the Moon's g, worked out from G M / R²  (Atwood)
 *   P5.debris   rate a breakaway link for a 500 kg dummy at 400 km: it must
 *               hold the dummy's weight up there and snap when it snags
 *   P5.bench    hold a free 450 kg steel ball still against the pull of the
 *               ball it touches, with a push sized from Eq. 1-2
 *   P5.coil     give the bench controller G with units that make Eq. 1-2
 *               come out in newtons (dimensional homogeneity)
 *   P5.hover    hover a 190 lb (Earth weight) survivor on the Moon with a lift
 *               jet rated in pounds: weight on the Moon in lb
 *   P5.balance  balance the same survivor on the Moon with a counterweight:
 *               mass in kg doesn't change on the trip
 *
 * Covers: the law of gravitation (Eq. 1-2) between particles and between
 * touching spheres, homogeneity of Eq. 1-2 (the units of G), weight and mass
 * on another body, and weight falling off with altitude.
 *
 * P5 parts (level-local, not in other projects' libraries):
 *   p05-rope    a rope over the nearest sheave between two loads, leaving the
 *               wheel at both rims so the falls hang straight (Atwood)
 *   p05-dummy   a person-sized harness dummy (trainee, survivor)
 *   p05-sphere  a gravity-bench ball; every pair of them attracts by G m1 m2 / r²
 *   p05-coil    the bench controller: pushes a ball with G m1 m2 / r² using the
 *               G typed on its dial
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, D = Y.dial, U = SE.units, GL = Y.goals;
  var GR = (SE.physics && SE.physics.gravity) || {};

  // ------------------------------------------------------------- constants
  var G = GR.G || 66.73e-12;                        // m^3/(kg s^2), course value
  var M_EARTH = GR.EARTH_MASS || 5.9722e24, R_EARTH = GR.EARTH_RADIUS || 6371e3;
  var M_MOON = GR.MOON_MASS || 7.342e22, R_MOON = GR.MOON_RADIUS || 1737.4e3;
  var G_EARTH = 9.81, G_MOON = 1.62, G_FPS = 32.2, LBF = 4.448, SLUG = 14.59;

  // 1. The Moon's surface g from its mass and radius, then the Atwood counterweight.
  var gMoonCalc = G * M_MOON / (R_MOON * R_MOON);
  // 66.73e-12 * 7.342e22 = 4.8993e12;  R^2 = (1.7374e6)^2 = 3.01856e12  ->  1.6231 m/s^2
  var TRAINEE = 80;
  var mcIdeal = TRAINEE * (G_EARTH - gMoonCalc) / (G_EARTH + gMoonCalc);
  // a = (m - mc) g / (m + mc)  ->  mc = 80 (9.81 - 1.623) / (9.81 + 1.623) = 57.29 kg
  var mcStatic = TRAINEE * (1 - gMoonCalc / G_EARTH);   // 66.8 kg: forgets the counterweight's inertia
  var A_LO = 1.56, A_HI = 1.68, T_RIG = 1.5;            // the rig's "Moon-like" band, m/s^2

  // 2. Debris at 400 km: g at r = R + h.
  var DEBRIS = 500, H_DEBRIS = 400e3;
  var gDebris = G * M_EARTH / Math.pow(R_EARTH + H_DEBRIS, 2);
  // r = 6771 km;  GM = 3.98525e14;  g = 3.98525e14 / 4.58464e13 = 8.6926 m/s^2
  var W_DEBRIS = DEBRIS * gDebris;                      // 4346 N = 4.35 kN (ground: 4.905 kN)
  var SNAG = 400, T_SNAG = 3;                           // the snag: 400 N more, from t = 3 s

  // 3. Two cast-steel ballast balls touching: r = 2R.
  var BALL = 450, R_BALL = 0.240;
  var F_BALL = G * BALL * BALL / Math.pow(2 * R_BALL, 2);
  // 66.73e-12 * 202500 / 0.2304 = 58.65e-6 N  ->  58.6 uN
  var T_BENCH = 20, DRIFT_MAX = 2e-6;                   // laser gauge: 2 um in 20 s

  // 4. Bench controller on the 40 kg and 65 kg test masses, centres 1.20 m apart.
  var M_A = 40, M_B = 65, R_AB = 1.20;
  var F_AB = G * M_A * M_B / (R_AB * R_AB);             // 0.1205 uN
  var T_COIL = 30, COIL_DRIFT = 0.05e-6;                // 0.05 um in 30 s (free: 0.83 um)

  // 5-6. A 190 lb (Earth weight) survivor on the Moon.
  var W_LB = 190;
  var mSlug = W_LB / G_FPS;                             // 5.9006 slug
  var M_SURV = mSlug * SLUG;                            // 86.09 kg
  var W_MOON_LB = mSlug * 5.32;                         // 31.39 lb  (SI route: 86.09 x 1.62 / 4.448 = 31.36 lb)
  var HOVER_TOL = 0.15, HOVER_T = 4, BAL_TOL = 0.05, BAL_T = 4;

  var f3 = function (x) { return D.fmtNum(x, 3); };
  var fmt = function (si, q, unit, sf) { return D.format(si, unit || D.autoUnit(si, q), sf || 3, q); };
  var um = function (x) { return D.fmtNum(x * 1e6, 3) + ' µm'; };

  // --------------------------------------------- the G dial (units of G)
  if (!D.QUANTITIES.gravconst) {
    D.QUANTITIES.gravconst = { dims: U.dim(3, -1, -2), si: 'm^3/(kg·s^2)', name: 'gravitational constant', examples: 'm^3/(kg·s^2)' };
  }

  // -------------------------------------------------------------- parts
  var SHEAVE_R = 0.6;                               // the rig sheaves: 1.2 m wheels

  // Rope over a sheave: an Atwood line between two loads.
  Y.definePart({
    type: 'p05-rope', name: 'Rope over a sheave', category: 'Rigging', library: false,
    blurb: 'A rope from one load, up over the nearest sheave and down to another, leaving the wheel at both edges of its rim. Same tension on both sides; it only pulls.',
    size: { w: 0.1, h: 2 },
    connector: true,
    dials: [{ key: 'rating', label: 'Breaking load', q: 'force', def: '10 kN', min: 1 }],
    build: function (b) {
      var A = b.end('a'), B = b.end('b');
      // any part that offers a wheel (a sheave, a jib tip): { body, local, r }
      var sheaves = Object.keys(b.out.parts).map(function (k) { return b.out.parts[k]; }).filter(function (p) { return p.sheave; }).map(function (p) {
        var c = p.sheave.body.worldPoint(p.sheave.local), r = Math.max(p.sheave.r || 0, 0.05);
        return { center: c, rims: [{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }] };
      });
      if (!sheaves.length) throw new Error('This rope needs a sheave to run over.');
      var mid = { x: (A.world.x + B.world.x) / 2, y: (A.world.y + B.world.y) / 2 };
      var sh = sheaves.sort(function (p, q) { return dist(p.center, mid) - dist(q.center, mid); })[0];
      var rimA = sh.rims[0], rimB = sh.rims[1];
      if (dist(rimA, A.world) + dist(rimB, B.world) > dist(rimB, A.world) + dist(rimA, B.world)) { var t = rimA; rimA = rimB; rimB = t; }
      var j = b.joint(new b.P.PulleyJoint({ bodyA: A.body, bodyB: B.body, localAnchorA: A.local, localAnchorB: B.local,
        groundAnchorA: rimA, groundAnchorB: rimB, breakForce: b.si('rating'), label: b.inst.label || 'rope' }));
      return { joint: j, rims: [rimA, rimB] };
    },
    readouts: function (built) { return [{ key: 'tension', label: 'rope tension', q: 'force', read: function () { return built.joint.broken ? 0 : Math.max(0, built.joint.tensionA()); } }]; },
    plate: function (inst) { return ['Breaks at ' + (inst.dials.rating || '?')]; }
  });

  var DUMMY_W = 0.6, DUMMY_H = 1.8;
  Y.definePart({
    type: 'p05-dummy', name: 'Harness dummy', category: 'Loads', library: false,
    blurb: 'A person in a training harness. The harness ring is at the top.',
    size: { w: DUMMY_W, h: DUMMY_H },
    dials: [{ key: 'mass', label: 'Mass', q: 'mass', def: '80 kg', min: 1, max: 1000 }],
    anchors: { top: { x: 0, y: DUMMY_H / 2 }, bottom: { x: 0, y: -DUMMY_H / 2 } },
    build: function (b) {
      return { body: b.body({ position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'dummy', allowSleep: false,
        shapes: [{ shape: b.P.box(DUMMY_W / 2, DUMMY_H / 2), material: 'rubber' }], mass: b.si('mass'), fixedRotation: true }) };
    },
    readouts: function (built) {
      var body = built.body, y0 = body.c.y;
      return [
        { key: 'vy', label: 'vertical speed', q: 'speed', read: function () { return body.v.y; } },
        { key: 'dy', label: 'height change', q: 'length', read: function () { return body.c.y - y0; } }
      ];
    },
    draw: function (ctx, cam, built) {
      var c = cam.worldToScreen(built.body.c), z = cam.zoom;
      ctx.save(); ctx.fillStyle = 'rgba(230,200,120,.9)';
      ctx.beginPath(); ctx.arc(c.x, c.y - 0.62 * z, 0.16 * z, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
    }
  });

  // Gravity-bench balls. All p05-sphere bodies in a world attract each other.
  function gravityField(out) {
    if (out._p05field) return out._p05field;
    var field = out._p05field = { balls: [] };
    field.pull = function (ball, Gval) {             // gravitational force on `ball` from every other ball
      var F = { x: 0, y: 0 };
      field.balls.forEach(function (o) {
        if (o === ball) return;
        var dx = o.body.c.x - ball.body.c.x, dy = o.body.c.y - ball.body.c.y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
        if (r < 1e-6) return;
        var f = (Gval == null ? G : Gval) * ball.mass * o.mass / r2;
        F.x += f * dx / r; F.y += f * dy / r;
      });
      return F;
    };
    out.world.on('step', function () {
      field.balls.forEach(function (bl) {
        if (bl.body.type !== 'dynamic') return;
        var F = field.pull(bl);
        bl.body.applyForce(F);
        bl.last = F;
      });
    });
    return field;
  }

  Y.definePart({
    type: 'p05-sphere', name: 'Bench ball', category: 'Loads', library: false,
    blurb: 'A solid steel ball on the gravity bench. Every ball pulls on every other one with F = G m₁m₂ / r², r centre to centre. A bolted ball stays put; a ball on the air bearing floats free sideways.',
    size: { w: 0.48, h: 0.48 },
    dials: [
      { key: 'mass', label: 'Mass', q: 'mass', def: '450 kg', min: 0.01, max: 1e5 },
      { key: 'radius', label: 'Radius', q: 'length', def: '240 mm', min: 0.005, max: 2 },
      { key: 'mount', label: 'Mount', choice: ['bolted', 'air bearing'], def: 'air bearing' }
    ],
    build: function (b) {
      var R = b.si('radius'), m = b.si('mass'), free = b.text('mount') === 'air bearing';
      // balls don't collide with each other (they sit in separate cradles) and the air bearing carries the weight
      var body = b.body({ type: free ? 'dynamic' : 'static', position: b.at({ x: 0, y: 0 }), label: b.inst.label || 'ball',
        shapes: [{ shape: b.P.circle(R), material: 'steel', filter: { group: -5 } }], mass: free ? m : undefined,
        gravityScale: 0, fixedRotation: true, allowSleep: false });
      var field = gravityField(b.out), ball = { body: body, mass: m, x0: body.c.x, y0: body.c.y, R: R };
      field.balls.push(ball);
      return { body: body, ball: ball, field: field, anchors: { center: { body: body, local: { x: 0, y: 0 } } } };
    },
    readouts: function (built) {
      var ball = built.ball;
      return [
        { key: 'pull', label: 'gravity pull', q: 'force', read: function () { var F = built.field.pull(ball); return Math.hypot(F.x, F.y); } },
        { key: 'drift', label: 'drift (laser gauge)', q: 'length', read: function () { return ball.body.c.x - ball.x0; } }
      ];
    },
    plate: function (inst) { return [inst.dials.mount === 'bolted' ? 'Bolted to the bench' : 'Air bearing: free to slide sideways']; },
    draw: function (ctx, cam, built) {
      var ball = built.ball, c = cam.worldToScreen(ball.body.c), z = cam.zoom;
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.beginPath(); ctx.arc(c.x - ball.R * z * 0.35, c.y - ball.R * z * 0.35, ball.R * z * 0.3, 0, 2 * Math.PI); ctx.fill();
      if (ball.body.type === 'dynamic') {
        var dx = ball.body.c.x - ball.x0, um = dx * 1e6;
        ctx.fillStyle = Math.abs(dx) < 1e-9 ? '#9fd27a' : '#ffb347'; ctx.font = '12px "IBM Plex Mono", monospace';
        ctx.fillText('laser ' + (um >= 0 ? '+' : '') + um.toFixed(3) + ' µm', c.x - ball.R * z, c.y + ball.R * z + 18);
      }
      ctx.restore();
    }
  });

  // The bench controller: a coil that pushes a ball with exactly the pull Eq. 1-2
  // predicts, worked out from the G on its dial and the balls as they stand.
  Y.definePart({
    type: 'p05-coil', name: 'Bench controller', category: 'Forces', library: false,
    blurb: 'A magnetic coil clipped to a ball. Each step it works out G m₁m₂ / r² for that ball with the G on its dial, and pushes the opposite way with that force.',
    size: { w: 0.6, h: 0.4 },
    connector: true, attach: true,
    dials: [{ key: 'G', label: 'G', q: 'gravconst', def: '' }],
    build: function (b) {
      var end = b.end('a'), body = end.body, Gval = b.si('G');
      var field = b.out._p05field, ball = field && field.balls.filter(function (x) { return x.body === body; })[0];
      if (!ball) throw new Error('Clip the controller onto a bench ball.');
      var built = { target: body, F: { x: 0, y: 0 } };
      function apply() { var F = field.pull(ball, Gval); built.F = { x: -F.x, y: -F.y }; body.applyForce(built.F); }
      b.on('step', apply);
      return built;
    },
    readouts: function (built) { return [{ key: 'force', label: 'coil push', q: 'force', read: function () { return Math.hypot(built.F.x, built.F.y); } }]; },
    plate: function () { return ['Computes F = G m₁ m₂ / r²', 'G memory: wiped']; }
  });

  function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

  // ------------------------------------------------------------ helpers
  // Connector parts (built) whose a or b end is on part `id`.
  function linksTo(s, id, types) {
    return Object.keys(s.built.parts).map(function (k) { return s.built.parts[k]; }).filter(function (p) {
      var i = p.inst; if (!p.def.connector) return false;
      if (types && types.indexOf(p.def.type) < 0) return false;
      return (i.a && i.a.part === id) || (i.b && i.b.part === id);
    });
  }
  function pushesOn(s, id) { return linksTo(s, id, ['push']); }

  // A job's bin: the whole library plus the level-local parts this job needs.
  function libraryPlus(extra) {
    return function () { return Y.library().map(function (t) { return { type: t }; }).concat(extra.map(function (t) { return { type: t }; })); };
  }
  function yardFor(o) {
    var y = { site: o.site, camera: o.camera, poke: false };
    if (o.design) y.design = o.design;
    if (o.readouts) y.readouts = o.readouts;
    // a getter, so the library is listed when the job opens (every parts file has loaded by then)
    Object.defineProperty(y, 'bin', { enumerable: true, get: libraryPlus(o.extra || []) });
    return y;
  }

  // ------------------------------------------------------------ designs
  var RIG_SITE = { g: G_EARTH, floor: 'concrete' };
  var RIG = { parts: [
    { id: 'sheave', type: 'sheave', x: 0, y: 8, dials: { size: 2 * SHEAVE_R + ' m' }, locked: true, label: 'rig sheave' },
    { id: 'trainee', type: 'p05-dummy', x: -SHEAVE_R, y: 4.6, dials: { mass: TRAINEE + ' kg' }, locked: true, label: 'trainee' }
  ] };

  var ORBIT_SITE = { g: gDebris, floor: null };
  var MAST = { parts: [
    { id: 'mast', type: 'hook', x: 0, y: 6, locked: true, label: 'mast head' },
    { id: 'debris', type: 'crate', x: 0, y: 4, dials: { mass: DEBRIS + ' kg' }, locked: true, label: 'debris dummy' },
    { id: 'snag', type: 'push', a: { part: 'debris' }, dials: { force: SNAG + ' N', angle: '-90 deg', time: '4 s', start: T_SNAG + ' s' }, locked: true, label: 'snag' }
  ] };

  var BENCH_SITE = { g: G_EARTH, floor: 'concrete' };
  var BENCH = { parts: [
    { id: 'ballA', type: 'p05-sphere', x: -R_BALL, y: 1.2, dials: { mass: BALL + ' kg', radius: '240 mm', mount: 'bolted' }, locked: true, label: 'ball A' },
    { id: 'ballB', type: 'p05-sphere', x: R_BALL, y: 1.2, dials: { mass: BALL + ' kg', radius: '240 mm', mount: 'air bearing' }, locked: true, label: 'ball B' }
  ] };
  var COIL = { parts: [
    { id: 'massA', type: 'p05-sphere', x: -R_AB / 2, y: 1.2, dials: { mass: M_A + ' kg', radius: '107 mm', mount: 'bolted' }, locked: true, open: ['mass'], label: 'test mass A' },
    { id: 'massB', type: 'p05-sphere', x: R_AB / 2, y: 1.2, dials: { mass: M_B + ' kg', radius: '126 mm', mount: 'air bearing' }, locked: true, open: ['mass'], label: 'test mass B' },
    { id: 'coil', type: 'p05-coil', a: { part: 'massB' }, dials: { G: '' }, locked: true, open: ['G'], label: 'bench controller' }
  ] };

  // The platform carries a site marker set to the Moon: g = G M / R^2 = 1.623 m/s^2.
  var MOON_SITE = { g: gMoonCalc, floor: 'concrete' };
  var MOON_MARKER = { id: 'site', type: 'site', x: 3.6, y: 0.7, dials: { body: 'Moon', altitude: '0 m', latitude: '0 deg' }, locked: true, label: 'lunar platform' };
  var SURVIVOR = { id: 'survivor', type: 'p05-dummy', dials: { mass: M_SURV.toFixed(2) + ' kg' }, locked: true, hide: ['mass'], plate: ['Depot scale (Earth): 190 lb'], label: 'survivor' };
  var PAD = { parts: [Object.assign({}, SURVIVOR, { x: 0, y: 2.5 }), MOON_MARKER] };
  var MOON_RIG = { parts: [
    { id: 'sheave', type: 'sheave', x: 0, y: 7, dials: { size: 2 * SHEAVE_R + ' m' }, locked: true, label: 'platform sheave' },
    MOON_MARKER,
    Object.assign({}, SURVIVOR, { x: -SHEAVE_R, y: 3.6 })
  ] };

  // -------------------------------------------------------------- goals
  // A site marker the player drops in moves the whole job somewhere else.
  function siteGuard(g, where) {
    return GL.never(function (s) {
      var m = Object.keys(s.built.parts).map(function (k) { return s.built.parts[k]; }).filter(function (p) { return p.def.type === 'site' && !p.inst.locked; })[0];
      return m && Math.abs(m.g - g) > 2e-3 * g ? 'This job is ' + where + '. Your site marker moved it somewhere with g = ' + D.fmtNum(m.g, 4) + ' m/s².' : null;
    });
  }
  var rigGoal = GL.all(siteGuard(G_EARTH, 'in the annex hall, on Earth: the trainees can\'t take the Moon with them'), function (s) {
    var dy = s.pos('trainee').y - 4.6;
    if (dy < -3) {
      if (!linksTo(s, 'trainee').length) return { fail: 'Nothing is holding the trainee: that was a plain Earth fall, straight to the floor.' };
      return { fail: 'The trainee dropped 3 m in **' + f3(s.t) + ' s**, about ' + f3(-2 * dy / (s.t * s.t)) + ' m/s². Too much Earth left in it: the Moon is about ' + f3(gMoonCalc) + ' m/s².' };
    }
    if (s.t < T_RIG - 1e-9) {
      if (dy > 0.02) return { fail: 'The trainee was hauled **up**: the counterweight is heavier than they are.' };
      return null;
    }
    var a = -s.vel('trainee').y / s.t;
    s.memo.a = a;
    if (a < 0) return { fail: 'The trainee was hauled **up**: the counterweight is heavier than they are.' };
    if (a > A_HI) return { fail: 'The trainee fell at **' + f3(a) + ' m/s²**. Too much Earth left in it: the Moon is about ' + f3(gMoonCalc) + ' m/s².' };
    if (a < A_LO) return { fail: 'The trainee fell at only **' + f3(a) + ' m/s²**. Too floaty: the counterweight is doing more than lunar gravity allows.' };
    return 'pass';
  });

  var debrisGoal = GL.all(siteGuard(gDebris, 'on the test mast at 400 km'), function (s) {
    var y = s.pos('debris').y;
    var br = s.breaks.filter(function (x) { return x.part !== 'snag'; })[0];
    if (s.t < T_SNAG - 1e-9) {
      if (br) return { fail: 'The link snapped at **t = ' + f3(br.t) + ' s**, with the dummy just hanging there. Its rating is below the dummy\'s weight at 400 km.' };
      if (y < 4 - 0.05) return { fail: 'Nothing is holding the dummy. Hang it from the mast head on a link.' };
      return null;
    }
    if (br && y < 3) return 'pass';
    if (s.t > T_SNAG + 2) return { fail: 'The link held through the snag. Rated that high it never lets go, and the dummy drags the mast down with it.' };
    return null;
  });

  function benchGoal(id, T, tol, what) {
    return function (s) {
      var b = s.part(id).ball, dx = b.body.c.x - b.x0;
      if (dx < -tol) return { fail: 'The laser gauge saw ' + what + ' drift **' + um(-dx) + ' toward** the other ball at t = ' + f3(s.t) + ' s. The pull is not cancelled' + (pushesOn(s, id).length || id === 'massB' ? ', or not for long enough.' : '.') };
      if (dx > tol) return { fail: 'The laser gauge saw ' + what + ' pushed **' + um(dx) + ' away** from the other ball at t = ' + f3(s.t) + ' s. The hold force is bigger than the pull.' };
      return s.t >= T - 1e-9 ? 'pass' : null;
    };
  }

  var hoverGoal = GL.all(siteGuard(gMoonCalc, 'on the lunar platform'),
    GL.never(function (s) { return linksTo(s, 'survivor').some(function (p) { return p.def.type !== 'push'; }) ? 'Only the suit\'s lift jet is allowed on this test: no ropes or cables on the survivor.' : null; }),
    function (s) {
      var dy = s.pos('survivor').y - 2.5;
      if (dy < -HOVER_TOL) return { fail: pushesOn(s, 'survivor').length ? 'The survivor sank **' + fmt(-dy, 'length', 'm') + '**: the jet is weaker than their weight on the Moon.' : 'With no jet the survivor just drops (slowly: this is the Moon).' };
      if (dy > HOVER_TOL) return { fail: 'The survivor shot up **' + fmt(dy, 'length', 'm') + '**: the jet is stronger than their weight on the Moon.' };
      return s.t >= HOVER_T - 1e-9 ? 'pass' : null;
    }
  );

  var balanceGoal = GL.all(siteGuard(gMoonCalc, 'on the lunar platform'),
    GL.never(function (s) { return pushesOn(s, 'survivor').length ? 'The lift jets are off for this test. Balance the survivor against a counterweight.' : null; }),
    GL.never(function (s) {
      // the objective says "against a counterweight": a line tied to the yard or a fixed part doesn't count
      var fixed = linksTo(s, 'survivor').some(function (p) {
        var other = p.inst.a && p.inst.a.part === 'survivor' ? p.inst.b : p.inst.a;
        if (!other || !other.part || other.part === 'ground') return true;
        var o = s.body(other.part); return !o || o.type === 'static';
      });
      return fixed ? 'That ties the survivor to something fixed. Balance them against a counterweight that hangs free.' : null;
    }),
    function (s) {
      var dy = s.pos('survivor').y - 3.6;
      if (dy < -BAL_TOL) return { fail: 'The survivor sank **' + fmt(-dy, 'length', 'm') + '**. ' + (linksTo(s, 'survivor').length ? 'The counterweight is lighter than they are.' : 'Nothing is holding them.') };
      if (dy > BAL_TOL) return { fail: 'The survivor rose **' + fmt(dy, 'length', 'm') + '**: the counterweight is heavier than they are.' };
      return s.t >= BAL_T - 1e-9 ? 'pass' : null;
    }
  );

  // ------------------------------------------------------------ project
  SE.content.registerProject('ch01', {
    id: 'P5', order: 5, title: 'Ghost Satellite & Moon Rig',
    subtitle: 'Gravity, here and elsewhere',
    objective: 'Six annex jobs: fake the Moon, settle the rumour, wake the bench',
    pitch: 'An old space-agency annex: a lunar rig, a gravity bench and a Moon platform, all running real physics. Every job is one law, F = G m₁m₂ / r², so build whatever gets the result.',
    brief: [
      'The scavengers broke into the old **space-agency training annex** past the rail spur. There\'s a lunar-gravity rig in the main hall, a gravity bench with two steel balls on it, a lunar training platform, and a wall of laminated placards nobody has checked in thirty years.',
      'There\'s also a rumour going round the depot: a dead satellite is coming down, and a piece of it "as heavy as a car" could flatten the water tower. People are losing sleep.',
      'I need the rig set right before anyone trains on it, the rumour answered on the test mast, the bench working again, and the platform kit checked. The annex simulators run the real physics, so the runs will tell you whether your numbers hold.',
      '— Juno'
    ].join('\n\n'),
    conditions: [
      'Course constants: $G = 66.73(10^{-12})\\u{ m^3/(kg·s^2)}$, $g = 9.81\\u{ m/s^2} = 32.2\\u{ ft/s^2}$ in the annex, 1 lb = 4.448 N, 1 slug = 14.59 kg.',
      'Moon: mass $7.342(10^{22})$ kg, mean radius 1737.4 km. Earth: mass $5.9722(10^{24})$ kg, mean radius 6371 km.',
      'The rig sheave is frictionless and light, and the rope doesn\'t stretch. The counterweight has inertia too.',
      'The test mast replays gravity **400 km up**. Up there g is **not** 9.81.',
      'The bench balls are cast steel, 450 kg each, radius 240 mm, **touching**. Its test masses are 40 kg and 65 kg with centres 1.20 m apart.',
      'The lunar platform\'s site marker is set to the Moon (the placard there says **5.32 ft/s²**). The survivor weighed **190 lb** on the depot scale.'
    ],
    yard: yardFor({ site: RIG_SITE, design: RIG, extra: ['p05-rope'], camera: { fit: { lo: { x: -5, y: -0.5 }, hi: { x: 5, y: 11 } } } }),
    jobs: [
      {
        id: 'P5.rig', objective: 'Make the 80 kg trainee fall at Moon g, here in the annex',
        label: '**Lunar rig.** The 80 kg trainee should fall at the Moon\'s g while standing in the annex on Earth. Work the Moon\'s g out from its mass and radius (📖 Guide).',
        design: RIG, yard: yardFor({ site: RIG_SITE, extra: ['p05-rope'], camera: { fit: { lo: { x: -5, y: -0.5 }, hi: { x: 5, y: 11 } } } }),
        goal: rigGoal, timeout: T_RIG + 0.5,
        hints: [
          'First the Moon: a body on its surface is pulled by the whole Moon, so $m g = G m M / R^2$. Then the rig: put a **crate** or a **counterweight** on the free side and a **Rope over a sheave** from the trainee\'s harness to the crate.',
          'Both bodies share the rope tension *T* and the size of the acceleration. Trainee (down +): $m g - T = m a$. Counterweight (up +): $T - m_c g = m_c a$. Add them: $a = (m - m_c) g / (m + m_c)$, so $m_c = m (g - a)/(g + a)$.',
          '$g_{moon} = 66.73(10^{-12}) \\times 7.342(10^{22}) / (1.7374(10^{6}))^2 = 1.623$ m/s². Then $m_c = 80 (9.81 - 1.623)/(9.81 + 1.623) = 57.3$ kg.'
        ],
        margin: function (s) { return s.memo.a ? Math.round(Math.min(10, Math.abs(s.memo.a - gMoonCalc) * 200)) : 0; },
        onFail: function (ctx) {
          var cw = ctx.yard && ctx.yard.design.parts.filter(function (p) { return p.type === 'crate' || p.type === 'counterweight'; })[0];
          if (cw && Math.abs(D.parse(cw.dials.mass, 'mass').si - mcStatic) < 1) return 'That counterweight cancels the right share of the trainee\'s **weight**, but it forgets the counterweight has to be **accelerated** too. Write F = ma for each side of the rope.';
          return '';
        },
        success: 'A lunar hop on an Earth floor. The placard holds up: $G M / R^2$ = ' + D.fmtNum(gMoonCalc, 4) + ' m/s², and the counterweight that fakes it is ' + D.fmtNum(mcIdeal, 3) + ' kg, not the ' + D.fmtNum(mcStatic, 3) + ' kg you\'d get by ignoring its inertia.'
      },
      {
        id: 'P5.debris', objective: 'Hold the 500 kg dummy at 400 km, then let go on the snag',
        label: '**The rumour.** Hang the **500 kg** dummy from the mast head at 400 km. It must hold while the dummy hangs, then let go when the snag adds **400 N** at t = 3 s.',
        design: MAST, yard: yardFor({ site: ORBIT_SITE, camera: { fit: { lo: { x: -4, y: -1 }, hi: { x: 4, y: 8.5 } } } }),
        goal: debrisGoal, timeout: T_SNAG + 2.5,
        hints: [
          'A **Cable** is a breakaway link: it snaps above its rated breaking load. Its rating has to sit between the dummy\'s weight **at 400 km** and that weight plus 400 N.',
          'Weight is $W = m g$, and up here $g = G M_e / r^2$ with *r* measured from Earth\'s centre: $r = 6371 + 400 = 6771$ km.',
          '$g = 66.73(10^{-12}) \\times 5.9722(10^{24}) / (6.771(10^{6}))^2 = 8.69$ m/s², so $W = 500 \\times 8.69 = 4.35$ kN. Rate the link about **4.5 kN**.'
        ],
        onFail: function (ctx) {
          var c = ctx.yard && ctx.yard.design.parts.filter(function (p) { return p.type === 'cable'; })[0];
          var r = c && D.parse(c.dials.rating, 'force');
          if (r && r.ok && r.si >= W_DEBRIS + SNAG && r.si < DEBRIS * G_EARTH * 1.03) return 'That rating is about the dummy\'s weight **on the ground** (500 kg × 9.81). At 400 km it is farther from Earth\'s centre, so g is smaller.';
          return '';
        },
        success: 'The link held the dummy\'s **' + fmt(W_DEBRIS, 'force', 'kN') + '** (on the ground it would be ' + fmt(DEBRIS * G_EARTH, 'force', 'kN') + ') and let go on the snag. So a piece up there is still heavy: g at 400 km is ' + f3(gDebris) + ' m/s², about 89 % of the ground value. Orbiting things are not weightless; they are falling around the Earth. And most debris burns up long before it reaches a water tower.'
      },
      {
        id: 'P5.bench', objective: 'Keep ball B within 2 µm of where it starts for 20 s',
        label: '**Gravity bench.** Ball B floats free, touching ball A, and A pulls it in. Cancel that pull so the laser gauge sees under **2 µm** of drift in **20 s**.',
        design: BENCH, yard: yardFor({ site: BENCH_SITE, readouts: ['ballB.pull', 'ballB.drift'], camera: { fit: { lo: { x: -2, y: -0.2 }, hi: { x: 2, y: 2.4 } } } }),
        goal: benchGoal('ballB', T_BENCH, DRIFT_MAX, 'ball B'), timeout: T_BENCH + 1,
        hints: [
          'Clip a **Push** onto ball B, pointing away from A (0°), and make it last the whole run. Its force is the attraction from Eq. 1–2.',
          'A uniform sphere pulls as if all its mass sat at its centre. Touching balls have their centres **two radii** apart: $r = 0.480$ m. Then $F = G m^2 / r^2$.',
          '$F = 66.73(10^{-12}) \\times 450^2 / 0.480^2 = 58.6(10^{-6})$ N. Push **58.6 µN** at 0° for 20 s or more.'
        ],
        onFail: function (ctx) {
          var p = ctx.yard && ctx.yard.design.parts.filter(function (q) { return q.type === 'push'; })[0];
          var r = p && D.parse(p.dials.force, 'force');
          if (r && r.ok && Math.abs(r.si / F_BALL - 4) < 0.05) return 'Four times too strong: that used the **radius** as *r*. Gravity is measured centre to centre, two radii when the balls touch.';
          if (p && D.parse(p.dials.time, 'time').si < T_BENCH) return 'The push stops before the 20 s are up. After that the pull wins again.';
          return '';
        },
        success: 'Held to the micrometre. The pull between two 450 kg balls is **' + D.fmtNum(F_BALL * 1e6, 3) + ' µN' + '**, about the weight of a few grains of sand. That is why the bench needs an air bearing and a laser to see it at all.'
      },
      {
        id: 'P5.coil', objective: 'Type G into the controller so mass B holds still for 30 s',
        label: '**Bench controller.** It works out $G m_1 m_2 / r^2$ itself but lost **G**. Type G with units that make the answer come out in newtons (SI base units score best).',
        design: COIL, yard: yardFor({ site: BENCH_SITE, readouts: ['massB.pull', 'massB.drift', 'coil.force'], camera: { fit: { lo: { x: -1.6, y: -0.2 }, hi: { x: 1.6, y: 2.4 } } } }),
        goal: benchGoal('massB', T_COIL, COIL_DRIFT, 'test mass B'), timeout: T_COIL + 1,
        grade: { part: 'coil', key: 'G', spec: { value: G, unit: 'm^3/(kg·s^2)', sf: 3, form: 'any', expressIn: 'SI' } },
        hints: [
          'Every term of a valid equation carries the same units. Solve Eq. 1–2 for *G* and look at what units are left over.',
          '$G = F r^2 / (m_1 m_2)$, so its units are $\\u{N·m^2/kg^2}$. Now write the newton in base units: $\\u{N} = \\u{kg·m/s^2}$.',
          '$\\u{(kg·m/s^2)·m^2/kg^2} = \\u{m^3/(kg·s^2)}$. Type **66.7(10^-12) m^3/(kg·s^2)**.'
        ],
        onFail: function (ctx) {
          var c = ctx.yard && ctx.yard.inst('coil'), r = c && D.parse(c.dials.G, 'gravconst');
          if (r && r.ok && Math.abs(Math.log10(r.si / G)) > 0.5) return 'The units passed, but the number is ' + D.fmtNum(r.si / G, 2) + ' times the real G, so the coil pushes ' + D.fmtNum(r.si / G, 2) + ' times too hard. Check the power of ten.';
          return '';
        },
        success: 'The controller holds the mass against a pull of **' + D.fmtNum(F_AB * 1e6, 3) + ' µN' + '**. With G in $\\u{m^3/(kg·s^2)}$, $G m_1 m_2 / r^2$ is $\\u{m^3/(kg·s^2) · kg · kg / m^2 = kg·m/s^2}$: a newton. Change the masses or move them and it keeps up, because it is the law, not a number, that you gave it.'
      },
      {
        id: 'P5.hover', objective: 'Hover the survivor on lift jets alone for 4 s',
        label: '**Lunar platform: weight.** The survivor weighed **190 lb** at the depot. Hover them on the Moon with lift jets (rated in pounds), within 15 cm for **4 s**. No lines on this test.',
        design: PAD, yard: yardFor({ site: MOON_SITE, camera: { fit: { lo: { x: -4, y: -0.5 }, hi: { x: 4, y: 5 } } } }),
        goal: hoverGoal, timeout: HOVER_T + 0.5,
        hints: [
          'Clip a **Push** onto the survivor pointing up (90°), lasting the whole test. To hover, it must equal their **weight on the Moon**.',
          'The survivor\'s mass doesn\'t change on the trip. Get it from the Earth weight: $m = W / g = 190 / 32.2$ slug. On the Moon $W_m = m g_m$ with $g_m = 5.32$ ft/s².',
          '$m = 5.90$ slug, so $W_m = 5.90 \\times 5.32 = 31.4$ lb. Set the jet to **31.4 lb** at 90° for 4 s.'
        ],
        onFail: function (ctx) {
          var p = ctx.yard && ctx.yard.design.parts.filter(function (q) { return q.type === 'push'; })[0];
          var r = p && D.parse(p.dials.force, 'force');
          if (r && r.ok && Math.abs(r.si / (W_LB * LBF) - 1) < 0.02) return 'That is the survivor\'s **Earth** weight. Weight is m g, and g on the Moon is about a sixth of Earth\'s.';
          return '';
        },
        success: 'Hovering. The survivor weighs about **' + D.fmtNum(W_MOON_LB, 3) + ' lb** on the Moon (' + D.fmtNum(mSlug, 3) + ' slug × 5.32 ft/s²), a sixth of the 190 lb the depot scale showed, because weight is $m g$ and only g changed. Work it in SI from the marker\'s ' + D.fmtNum(gMoonCalc, 4) + ' m/s² and you get ' + D.fmtNum(M_SURV * gMoonCalc / LBF, 3) + ' lb: the course constants are rounded, and the jet doesn\'t mind the difference.'
      },
      {
        id: 'P5.balance', objective: 'Balance the survivor against a counterweight, jets off',
        label: '**Lunar platform: mass.** Jets are off. Balance the same survivor against a hanging counterweight so they stay within 5 cm for **4 s**.',
        design: MOON_RIG, yard: yardFor({ site: MOON_SITE, extra: ['p05-rope'], camera: { fit: { lo: { x: -5, y: -0.5 }, hi: { x: 5, y: 10 } } } }),
        goal: balanceGoal, timeout: BAL_T + 0.5,
        hints: [
          'Put a **crate** or a **counterweight** on the free side and a **Rope over a sheave** to it. The rope pulls both sides equally, so when does nothing move?',
          'The two sides balance when their weights match: $m_c g = m g$. The g is the same on both sides, so it cancels: you need the survivor\'s **mass**, wherever you are.',
          '$m = 190 / 32.2 = 5.90$ slug $= 5.90 \\times 14.59 = 86.1$ kg. Set it to **86.1 kg**.'
        ],
        onFail: function (ctx) {
          var cw = ctx.yard && ctx.yard.design.parts.filter(function (p) { return p.type === 'crate' || p.type === 'counterweight'; })[0];
          var r = cw && D.parse(cw.dials.mass, 'mass');
          if (r && r.ok && Math.abs(r.si / (M_SURV * G_MOON / G_EARTH) - 1) < 0.03) return 'That is the mass that would *weigh* the same on Earth as the survivor does on the Moon. But the counterweight is on the Moon too: it feels the same g.';
          return '';
        },
        success: 'Balanced at **' + fmt(M_SURV, 'mass', 'kg') + '**, the same counterweight that would balance them in the annex hall. A balance compares masses: g pulls on both sides and cancels. Mass came along unchanged; only weight changed.'
      }
    ],
    solutions: {
      'P5.rig': [
        { add: [
          { id: 'cw', type: 'crate', x: SHEAVE_R, y: 4.6, dials: { mass: '57.3 kg' } },
          { type: 'p05-rope', a: { part: 'trainee', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }
        ] },
        // a different way: a steady upward push of m (g - g_moon) on the trainee
        { add: [{ type: 'push', a: { part: 'trainee' }, dials: { force: '655 N', angle: '90 deg', time: '3 s' } }] },
        { pass: false, add: [
          { id: 'cw', type: 'crate', x: SHEAVE_R, y: 4.6, dials: { mass: '66.8 kg' } },
          { type: 'p05-rope', a: { part: 'trainee', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }
        ] },
        { pass: false, add: [
          { id: 'cw', type: 'crate', x: SHEAVE_R, y: 4.6, dials: { mass: '90 kg' } },
          { type: 'p05-rope', a: { part: 'trainee', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }
        ] }
      ],
      'P5.debris': [
        { add: [{ type: 'cable', a: { part: 'mast', anchor: 'eye' }, b: { part: 'debris', anchor: 'top' }, dials: { rating: '4.5 kN' } }] },
        { add: [{ type: 'winch', a: { part: 'mast', anchor: 'eye' }, b: { part: 'debris', anchor: 'top' }, dials: { rating: '4.5 kN', speed: '0 m/s', pull: '20 kN' } }] },
        { pass: false, add: [{ type: 'cable', a: { part: 'mast', anchor: 'eye' }, b: { part: 'debris', anchor: 'top' }, dials: { rating: '4.91 kN' } }] },
        { pass: false, add: [{ type: 'cable', a: { part: 'mast', anchor: 'eye' }, b: { part: 'debris', anchor: 'top' }, dials: { rating: '4.2 kN' } }] }
      ],
      'P5.bench': [
        { add: [{ type: 'push', a: { part: 'ballB' }, dials: { force: '58.6 uN', angle: '0 deg', time: '25 s' } }] },
        // a different way: a weak spring to a hook, stretched to pull with the same force
        { add: [{ id: 'hk', type: 'hook', x: R_BALL + 2, y: 1.2 }, { type: 'spring', a: { part: 'ballB' }, b: { part: 'hk', anchor: 'eye' }, dials: { k: '1 N/m', rest: (2 - F_BALL) + ' m', damping: 'none' } }] },
        { pass: false, add: [{ type: 'push', a: { part: 'ballB' }, dials: { force: '235 uN', angle: '0 deg', time: '25 s' } }] },
        { pass: false, add: [{ type: 'push', a: { part: 'ballB' }, dials: { force: '58.6 uN', angle: '0 deg', time: '2 s' } }] }
      ],
      'P5.coil': [
        { set: { coil: { G: '66.7(10^-12) m^3/(kg·s^2)' } } },
        { set: { coil: { G: '6.673e-11 N·m^2/kg^2' } } },
        // the controller keeps up with heavier masses, because it has the law, not a number
        { set: { coil: { G: '66.73(10^-12) m^3/(kg·s^2)' }, massA: { mass: '400 kg' }, massB: { mass: '20 kg' } } },
        { pass: false, set: { coil: { G: '6.67(10^-12) m^3/(kg·s^2)' } } },
        { pass: false, set: { coil: { G: '66.7(10^-12) N·m^2' } } }
      ],
      'P5.hover': [
        { add: [{ type: 'push', a: { part: 'survivor' }, dials: { force: '31.3 lb', angle: '90 deg', time: '5 s' } }] },
        { add: [
          { type: 'push', a: { part: 'survivor' }, dials: { force: '15.7 lb', angle: '90 deg', time: '5 s' } },
          { type: 'push', a: { part: 'survivor' }, dials: { force: '70 N', angle: '90 deg', time: '5 s' } }
        ] },
        { pass: false, add: [{ type: 'push', a: { part: 'survivor' }, dials: { force: '190 lb', angle: '90 deg', time: '5 s' } }] },
        { pass: false, add: [{ type: 'push', a: { part: 'survivor' }, dials: { force: '28 lb', angle: '90 deg', time: '5 s' } }] }
      ],
      'P5.balance': [
        { add: [
          { id: 'cw', type: 'crate', x: SHEAVE_R, y: 3.6, dials: { mass: '86.1 kg' } },
          { type: 'p05-rope', a: { part: 'survivor', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }
        ] },
        // a different way: the library counterweight on a cable run over the sheave
        { add: [
          { id: 'cw', type: 'counterweight', x: SHEAVE_R, y: 3.6, dials: { mass: '5.90 slug' } },
          { type: 'cable', a: { part: 'survivor', anchor: 'top' }, b: { part: 'cw', anchor: 'top' }, dials: { route: 'over sheave', rating: '5 kN' } }
        ] },
        { pass: false, add: [{ id: 'hk', type: 'hook', x: -SHEAVE_R, y: 5.5 }, { type: 'cable', a: { part: 'hk', anchor: 'eye' }, b: { part: 'survivor', anchor: 'top' } }] },
        { pass: false, add: [
          { id: 'cw', type: 'crate', x: SHEAVE_R, y: 3.6, dials: { mass: '14.2 kg' } },
          { type: 'p05-rope', a: { part: 'survivor', anchor: 'top' }, b: { part: 'cw', anchor: 'top' } }
        ] }
      ]
    },

    deeper: [
      'The Moon\'s g from $G M / R^2$ (' + D.fmtNum(gMoonCalc, 4) + ' m/s²) rather than taken on trust from a placard.',
      'Weight at 400 km: g has dropped to about ' + f3(gDebris) + ' m/s², so using 9.81 overstates the debris weight by 13 %. Orbiting objects are not weightless; they are in free fall.',
      'A balance (or a counterweight over a sheave) reads the same on the Moon because g acts on both sides and cancels. A spring scale or a lift jet works against weight, so it needs about a sixth.'
    ],

    debrief: [
      'Juno pins your sheet to the annex door.',
      '"So the Moon placard is right, the rig is safe to train on, the satellite rumour was half true and the scary half is wrong, the bench works again, and the steel balls really do pull on each other, by about the weight of a few grains of sand. Good. I\'ll tell the water-tower crew to get some sleep."',
      'Everything you built today ran on one law: $F = G m_1 m_2 / r^2$. Weight is that law with the planet as one of the masses, which is why it changes with altitude and with which world you stand on, and mass never does.'
    ].join('\n\n')
  });

  // Numbers the tests check against hand working.
  SE.content.chapter('ch01').projectMap.P5.numbers = {
    gMoonCalc: gMoonCalc, mcIdeal: mcIdeal, mcStatic: mcStatic, gDebris: gDebris, W_DEBRIS: W_DEBRIS,
    F_BALL: F_BALL, F_AB: F_AB, M_SURV: M_SURV, W_MOON_LB: W_MOON_LB
  };
})(globalThis.SE);
