'use strict';
// Shapes, narrowphase manifolds and queries. Mass properties are checked
// against closed forms derived by hand in the comments; manifolds against
// the geometry of each setup.
const { suite, test, near, ok, eq } = require('./harness');
const P = globalThis.SE.phys, M = globalThis.SE.pmath;
const g = 9.81;

const I0 = { p: { x: 0, y: 0 }, q: M.rot(0) };
function xf(x, y, a) { return M.xf({ x: x, y: y }, a || 0); }
function abs(x) { return Math.abs(x); }
function vnear(a, b, tol, msg) {
  ok(abs(a.x - b.x) <= tol && abs(a.y - b.y) <= tol, (msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function throws(fn, re) {
  let err = null; try { fn(); } catch (e) { err = e; }
  ok(err, 'expected an error'); if (re) ok(re.test(err.message), 'wrong message: ' + err.message);
}

suite('physics E01: shapes and mass', () => {
  test('capsule mass and inertia match the closed form (1e-12)', () => {
    // Capsule along x, half-length h, radius r, density ρ. By direct integration:
    //   rectangle 2h × 2r: ∫x² = (4/3) r h³, ∫y² = (4/3) h r³
    //   two half-discs centred at ±h: each ∫((h+u)² + v²) = h²·πr²/2 + 2h·(2/3)r³ + πr⁴/4
    //   I = ρ[(4/3) r h³ + (4/3) h r³ + π r² h² + (8/3) h r³ + π r⁴ / 2],  m = ρ(πr² + 4hr)
    const r = 0.15, h = 0.6, rho = 550;
    const md = P.massData(P.capsule({ x: -h, y: 0 }, { x: h, y: 0 }, r), rho);
    near(md.mass, rho * (Math.PI * r * r + 4 * h * r), 1e-12);
    const I = rho * (4 / 3 * r * h ** 3 + 4 / 3 * h * r ** 3 + Math.PI * r * r * h * h + 8 / 3 * h * r ** 3 + Math.PI * r ** 4 / 2);
    near(md.I, I, 1e-12);
    vnear(md.center, { x: 0, y: 0 }, 1e-15);
  });
  test('an offset, tilted capsule: centroid at its middle and I by the parallel axis theorem (1e-12)', () => {
    const r = 0.1, h = 0.5, a = 0.7, c = { x: 2, y: -1 };
    const e = { x: h * Math.cos(a), y: h * Math.sin(a) };
    const md0 = P.massData(P.capsule({ x: -h, y: 0 }, { x: h, y: 0 }, r), 1000);
    const md = P.massData(P.capsule(M.sub(c, e), M.add(c, e), r), 1000);
    vnear(md.center, c, 1e-12);
    near(md.I, md0.I + md0.mass * M.lenSq(c), 1e-12);
  });
  test('rounded box: area 4ab + 2r(2a+2b) + πr², inertia from strips and quarter discs (1e-12)', () => {
    // box(hw, hh, ..., r) keeps its outer size, so the core is a = hw - r by b = hh - r.
    // Pieces about the centre: core 2a×2b; four edge strips; four quarter discs
    // of radius r at the core corners (polar moment πr⁴/8 about the apex,
    // centroid 4r/3π along each axis, shifted to the origin).
    const hw = 0.5, hh = 0.3, r = 0.08, rho = 400, a = hw - r, b = hh - r;
    const md = P.massData(P.box(hw, hh, null, 0, r), rho);
    const area = 4 * a * b + 2 * r * (2 * a + 2 * b) + Math.PI * r * r;
    near(md.mass, rho * area, 1e-12);
    let J = 4 * a * b * (4 * a * a + 4 * b * b) / 12;
    J += 2 * (2 * a * r * (4 * a * a + r * r) / 12 + 2 * a * r * (b + r / 2) ** 2);   // top and bottom strips
    J += 2 * (2 * b * r * (4 * b * b + r * r) / 12 + 2 * b * r * (a + r / 2) ** 2);   // side strips
    const qa = Math.PI * r * r / 4, d = 4 * r / (3 * Math.PI);
    J += 4 * (Math.PI * r ** 4 / 8 + qa * (a * a + b * b) + 2 * qa * (a * d + b * d));
    near(md.I, rho * J, 1e-12);
    vnear(md.center, { x: 0, y: 0 }, 1e-14);
  });
  test('rounded box AABB and point test respect the rounded corners', () => {
    const s = P.box(0.5, 0.5, null, 0, 0.1);
    const bb = P.aabb(s, I0);
    vnear(bb.lo, { x: -0.5, y: -0.5 }, 1e-15); vnear(bb.hi, { x: 0.5, y: 0.5 }, 1e-15);
    ok(P.testPoint(s, I0, { x: 0.49, y: 0 }), 'face point inside');
    ok(!P.testPoint(s, I0, { x: 0.49, y: 0.49 }), 'the cut-off corner is outside');
    ok(P.testPoint(s, I0, { x: 0.46, y: 0.46 }), 'inside the arc');  // 0.06·√2 = 0.085 < 0.1 from (0.4, 0.4)
  });
  test('L-shape built from two convex parts: centroid (0.6786, 0.6786) and I by parallel axes (1e-12)', () => {
    // bar 2 × 0.5 at (1, 0.25) plus post 0.5 × 1.5 at (0.25, 1.25): areas 1 and 0.75
    // x̄ = (1·1 + 0.75·0.25) / 1.75 = 0.678571...,  ȳ = (1·0.25 + 0.75·1.25) / 1.75 = same
    const body = new P.Body({ shapes: [
      { shape: P.box(1, 0.25, { x: 1, y: 0.25 }), density: 1 },
      { shape: P.box(0.25, 0.75, { x: 0.25, y: 1.25 }), density: 1 }] });
    near(body.localCenter.x, 1.1875 / 1.75, 1e-12); near(body.localCenter.y, 1.1875 / 1.75, 1e-12);
    const c = body.localCenter;
    const Ibar = 1 * (4 + 0.25) / 12 + 1 * M.lenSq(M.sub({ x: 1, y: 0.25 }, c));
    const Ipost = 0.75 * (0.25 + 2.25) / 12 + 0.75 * M.lenSq(M.sub({ x: 0.25, y: 1.25 }, c));
    near(body.I, Ibar + Ipost, 1e-12);
  });
  test('the L outline as one polygon is rejected as non-convex', () => {
    throws(() => P.polygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 2 }, { x: 0, y: 2 }]), /not convex/);
  });
  test('degenerate input throws a clear error', () => {
    throws(() => P.polygon([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), /degenerate/);
    throws(() => P.polygon([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]), /degenerate/);
    throws(() => P.polygon([{ x: 0, y: 0 }, { x: 1, y: 0 }]), /at least 3/);
    throws(() => P.polygon([{ x: 0, y: 0 }, { x: 1, y: NaN }, { x: 0, y: 1 }]), /bad point/);
    throws(() => P.capsule({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.1), /circle/);
    throws(() => P.segment({ x: 1, y: 1 }, { x: 1, y: 1 }), /coincide/);
    throws(() => P.box(0.5, 0.5, null, 0, 0.5), /radius/);
    throws(() => P.chain([{ x: 0, y: 0 }]), /at least 2/);
  });
  test('points given clockwise or with a collinear extra still make a valid CCW polygon', () => {
    const p = P.polygon([{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: 0 }]);
    eq(p.count, 4);
    near(P.massData(p, 1).mass, 1, 1e-12);
  });
  test('segments and chains are massless; a chain has one segment per span with ghosts', () => {
    eq(P.massData(P.segment({ x: 0, y: 0 }, { x: 1, y: 0 }), 1000).mass, 0);
    const c = P.chain([{ x: -3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }]);
    eq(c.length, 3);
    // listed left to right, it faces up: the inner segment's ghosts are its neighbours' far ends
    const mid = c[1];
    vnear(mid.ghost1, { x: 3, y: 0 }, 0); vnear(mid.ghost2, { x: -3, y: 0 }, 0);
    eq(P.chain([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], { loop: true }).length, 3);
  });
});

function man(a, ta, b, tb) { return P.collide(a, ta, b, tb); }

suite('physics E01: manifolds', () => {
  test('box resting on a box: 2 points at the corners, separation 0, normal up (1e-12)', () => {
    const m = man(P.box(5, 0.5), xf(0, -0.5), P.box(0.5, 0.5), xf(0.2, 0.5));
    ok(m, 'no manifold'); eq(m.points.length, 2);
    vnear(m.normal, { x: 0, y: 1 }, 1e-12);
    m.points.forEach(p => near(p.separation, 0, 1e-12));
    const xs = m.points.map(p => p.point.x).sort((a, b) => a - b);
    near(xs[0], -0.3, 1e-12); near(xs[1], 0.7, 1e-12);
    m.points.forEach(p => near(p.point.y, 0, 1e-12));
  });
  test('the normal points from A to B whichever order the pair comes in', () => {
    const m = man(P.box(0.5, 0.5), xf(0.2, 0.5), P.box(5, 0.5), xf(0, -0.5));
    vnear(m.normal, { x: 0, y: -1 }, 1e-12); eq(m.points.length, 2);
  });
  test('box on a box tilted 0.3 rad: normal along the tilted face, 2 points, overlap 2 mm (1e-9)', () => {
    const th = 0.3, q = M.rot(th), up = M.rotate(q, { x: 0, y: 1 });
    const cB = M.mulAdd({ x: 1, y: 2 }, 0.4 + 0.25 - 0.002, up);
    const m = man(P.box(2, 0.4), xf(1, 2, th), P.box(0.25, 0.25), M.xf(cB, th));
    eq(m.points.length, 2); vnear(m.normal, up, 1e-9);
    m.points.forEach(p => near(p.separation, -0.002, 1e-9));
  });
  test('a box standing on its corner: one point at the corner (1e-12)', () => {
    const h = 0.5 * Math.SQRT2;
    const m = man(P.box(5, 0.5), xf(0, -0.5), P.box(0.5, 0.5), xf(0, h + 0.01, Math.PI / 4));
    eq(m.points.length, 1); vnear(m.normal, { x: 0, y: 1 }, 1e-12);
    near(m.points[0].separation, 0.01, 1e-12); vnear(m.points[0].point, { x: 0, y: 0.005 }, 1e-12);
  });
  test('beyond the speculative distance there is no manifold', () => {
    ok(!man(P.box(5, 0.5), xf(0, -0.5), P.box(0.5, 0.5), xf(0, 0.5 + P.SPECULATIVE + 1e-4)));
    ok(!man(P.circle(0.5), xf(0, 0), P.circle(0.5), xf(1 + P.SPECULATIVE + 1e-4, 0)));
  });
  test('circle on a capsule side, and off its rounded end (1e-12)', () => {
    const cap = P.capsule({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.2);
    let m = man(cap, I0, P.circle(0.3), xf(0.4, 0.499));
    vnear(m.normal, { x: 0, y: 1 }, 1e-12); near(m.points[0].separation, -0.001, 1e-12);
    vnear(m.points[0].point, { x: 0.4, y: 0.1995 }, 1e-12);
    const u = M.norm({ x: 1, y: 1 });
    m = man(P.circle(0.3), M.xf(M.mulAdd({ x: 1, y: 0 }, 0.5, u), 0), cap, I0);
    vnear(m.normal, M.neg(u), 1e-12); near(m.points[0].separation, 0, 1e-12);
  });
  test('capsule lying on a capsule: two points, normal up (1e-12)', () => {
    const a = P.capsule({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.1);
    const m = man(a, I0, P.capsule({ x: -0.5, y: 0 }, { x: 0.5, y: 0 }, 0.1), xf(0.3, 0.2));
    eq(m.points.length, 2); vnear(m.normal, { x: 0, y: 1 }, 1e-12);
    m.points.forEach(p => near(p.separation, 0, 1e-12));
  });
  test('capsules end to end along one line touch at their caps only', () => {
    const a = P.capsule({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.1);
    const m = man(a, I0, a, xf(1.19, 0));
    eq(m.points.length, 1); vnear(m.normal, { x: 1, y: 0 }, 1e-12);
    near(m.points[0].separation, -0.01, 1e-12);
  });
  test('rounded box on a box: contact at the rounded surface (1e-12)', () => {
    const m = man(P.box(5, 0.5), xf(0, -0.5), P.box(0.5, 0.5, null, 0, 0.1), xf(0, 0.499));
    eq(m.points.length, 2); vnear(m.normal, { x: 0, y: 1 }, 1e-12);
    m.points.forEach(p => near(p.separation, -0.001, 1e-12));
    const xs = m.points.map(p => p.point.x).sort((a, b) => a - b);
    near(xs[0], -0.4, 1e-12); near(xs[1], 0.4, 1e-12);       // the flat part of the rounded face
  });
  test('circle against a rounded box corner: normal along the diagonal (1e-12)', () => {
    const u = M.norm({ x: 1, y: 1 });
    const c = M.mulAdd({ x: 0.4, y: 0.4 }, 0.1 + 0.2, u);
    const m = man(P.box(0.5, 0.5, null, 0, 0.1), I0, P.circle(0.2), M.xf(c, 0));
    vnear(m.normal, u, 1e-12); near(m.points[0].separation, 0, 1e-12);
  });
  test('capsule lying on a chain: two points, normal up, separation 0 (1e-12)', () => {
    const ch = P.chain([{ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }]);
    const m = man(ch[0], I0, P.capsule({ x: -0.5, y: 0 }, { x: 0.5, y: 0 }, 0.1), xf(-2, 0.1));
    ok(m, 'no manifold'); eq(m.points.length, 2); vnear(m.normal, { x: 0, y: 1 }, 1e-12);
    m.points.forEach(p => near(p.separation, 0, 1e-12));
  });
  test('circle on a chain, and nothing from below (one-sided)', () => {
    const ch = P.chain([{ x: -5, y: 0 }, { x: 5, y: 0 }]);
    const m = man(ch[0], I0, P.circle(0.2), xf(1, 0.19));
    vnear(m.normal, { x: 0, y: 1 }, 1e-12); near(m.points[0].separation, -0.01, 1e-12);
    ok(!man(ch[0], I0, P.circle(0.2), xf(1, -0.19)), 'hit from behind');
    ok(!man(ch[0], I0, P.box(0.2, 0.2), xf(1, -0.19)), 'box hit from behind');
  });
  test('a box straddling an internal chain vertex: both segments push straight up', () => {
    const ch = P.chain([{ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }]);
    // box slightly sunk with its leading corner just past the vertex
    [ch[0], ch[1]].forEach(s => {
      const m = man(s, I0, P.box(0.5, 0.5), xf(-0.498, 0.497));
      if (m) { vnear(m.normal, { x: 0, y: 1 }, 1e-12); m.points.forEach(p => near(p.separation, -0.003, 1e-9)); }
    });
    // whereas a bare two-sided segment there would push sideways (the snag ghosts fix)
    const bare = man(P.segment({ x: 0, y: 0 }, { x: 5, y: 0 }), I0, P.box(0.5, 0.5), xf(-0.498, 0.497));
    ok(abs(bare.normal.x) > 0.9, 'expected the naive segment to snag: ' + JSON.stringify(bare.normal));
  });
  test('feature ids stay the same for a box resting on the ground across 60 steps', () => {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(20, 0.5)] }));
    w.add(new P.Body({ position: { x: 0.3, y: 0.5 }, shapes: [P.box(0.5, 0.5)], mass: 100 }));
    let first = null;
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      const ids = Array.from(w.contacts.values()).map(ct => ct.points.map(p => p.id).sort().join(',')).join(';');
      if (first === null) first = ids; else eq(ids, first, 'step ' + i);
    }
    eq(first.split(',').length, 2);
  });
});

suite('physics E01: chains in the world', () => {
  function chainGround(w, pts, opts) {
    return w.add(new P.Body({ type: 'static', shapes: P.chain(pts, opts).map(s => ({ shape: s, friction: 0 })) }));
  }
  test('a box sliding on ice over a 3-segment flat chain keeps its speed (within 0.5%)', () => {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    chainGround(w, [{ x: -20, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 20, y: 0 }]);
    const b = w.add(new P.Body({ position: { x: -4, y: 0.5 }, velocity: { x: 3, y: 0 },
      shapes: [{ shape: P.box(0.5, 0.5), friction: 0 }], mass: 80 }));
    let minVx = Infinity, maxW = 0;
    w.run(4, 1 / 60, () => { minVx = Math.min(minVx, b.v.x); maxW = Math.max(maxW, abs(b.w)); });
    ok(b.c.x > 1.5, 'did not cross both vertices: x = ' + b.c.x);
    ok(minVx >= 3 * 0.995, 'slowed to ' + minVx);
    ok(maxW < 1e-3, 'tipped: w = ' + maxW);
    ok(abs(b.c.y - 0.5) < 0.01, 'height ' + b.c.y);
  });
  test('a frictionless capsule slides down a 2-segment chain ramp: v² = 2gΔh (within 1%), then on along the flat', () => {
    // Ramp (-10, 5) -> (-5, 2.5) -> (0, 0) has one internal vertex on the slope; it meets the flat at x = 0.
    // Lying along the slope with no friction the log only translates, so energy gives v = √(2 g Δy).
    const w = new P.World({ gravity: { x: 0, y: -g } });
    chainGround(w, [{ x: -10, y: 5 }, { x: -5, y: 2.5 }, { x: 0, y: 0 }, { x: 100, y: 0 }]);
    const th = Math.atan2(-2.5, 5), n = { x: -Math.sin(th), y: Math.cos(th) };
    const c0 = M.mulAdd({ x: -9, y: 4.5 }, 0.15, n);
    const log = w.add(new P.Body({ position: c0, angle: th, shapes: [{ shape: P.capsule({ x: -0.3, y: 0 }, { x: 0.3, y: 0 }, 0.15), friction: 0 }], material: 'timber' }));
    let checked = false;
    w.run(3, 1 / 60, () => {
      if (!checked && log.c.x > -1.5) {
        checked = true;
        near(M.len(log.v), Math.sqrt(2 * g * (c0.y - log.c.y)), 0.01, 'speed on the ramp');
        ok(abs(log.w) < 1e-3, 'log started spinning: ' + log.w);
      }
    });
    ok(checked, 'never reached the bottom: x = ' + log.c.x);
    ok(log.c.x > 3, 'stuck at the foot: x = ' + log.c.x);
    ok(log.c.y > 0.1 && log.c.y < 0.3, 'height ' + log.c.y);
  });
  test('a ball dropped on a loop chain rests on top of it', () => {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    w.add(new P.Body({ type: 'static', shapes: P.chain([{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 0 }, { x: -2, y: 0 }], { loop: true }) }));
    const ball = w.add(new P.Body({ position: { x: 0.5, y: 2 }, shapes: [P.circle(0.25)], material: 'rubber', mass: 1 }));
    w.run(5);
    near(ball.c.y, 0.25, 0.02);
  });
  test('regression: a 10-box stack on a chain ground settles upright (5 s, still to 1 cm)', () => {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    w.add(new P.Body({ type: 'static', shapes: P.chain([{ x: -10, y: 0 }, { x: -3, y: 0 }, { x: 0.2, y: 0 }, { x: 10, y: 0 }]) }));
    const boxes = [];
    for (let i = 0; i < 10; i++) boxes.push(w.add(new P.Body({ position: { x: 0, y: 0.5 + i }, shapes: [P.box(0.5, 0.5)], mass: 50, material: 'cargo' })));
    // A chain vertex sits under the bottom box. The stack must behave like one on a solid
    // box ground: upright, centred, and still to within the contact solver's sway
    // (about 5 mm per 0.5 s today, with no sleeping yet).
    w.run(4.5);
    const snap = boxes.map(b => ({ x: b.c.x, y: b.c.y }));
    w.run(0.5);
    boxes.forEach((b, i) => {
      ok(M.dist(b.c, snap[i]) < 0.01, 'box ' + i + ' still moving: ' + M.dist(b.c, snap[i]));
      ok(abs(b.c.x) < 0.05 && abs(b.c.y - (0.5 + i)) < 0.05, 'box ' + i + ' at ' + JSON.stringify(b.c));
      ok(abs(b.angle) < 0.01, 'box ' + i + ' tilted ' + b.angle);
    });
  });
});

suite('physics E01: ray casts and queries', () => {
  const ray = (s, t, p1, p2) => P.query.rayCastShape(s, t, p1, p2);
  test('ray hits a circle: point and normal (1e-9)', () => {
    // from (-3, 0.3) along +x at a unit circle at (0,0): x = -√(1 - 0.09)
    const h = ray(P.circle(1), I0, { x: -3, y: 0.3 }, { x: 3, y: 0.3 });
    const x = -Math.sqrt(0.91);
    vnear(h.point, { x: x, y: 0.3 }, 1e-9); vnear(h.normal, { x: x, y: 0.3 }, 1e-9);
    near(h.fraction, (x + 3) / 6, 1e-9);
  });
  test('ray hits a capsule side and its rounded cap (1e-9)', () => {
    const cap = P.capsule({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.25);
    let h = ray(cap, xf(0, 1), { x: 0.5, y: 3 }, { x: 0.5, y: -3 });
    vnear(h.point, { x: 0.5, y: 1.25 }, 1e-9); vnear(h.normal, { x: 0, y: 1 }, 1e-9);
    h = ray(cap, xf(0, 1), { x: 3, y: 1.1 }, { x: -3, y: 1.1 });
    const x = 1 + Math.sqrt(0.0625 - 0.01);
    vnear(h.point, { x: x, y: 1.1 }, 1e-9); vnear(h.normal, { x: (x - 1) / 0.25, y: 0.4 }, 1e-9);
  });
  test('ray hits a rotated box face (1e-9)', () => {
    const th = Math.PI / 6, q = M.rot(th);
    const h = ray(P.box(1, 0.5), xf(0, 0, th), { x: 0, y: 5 }, { x: 0, y: -5 });
    // top face: points with dot(up', p) = 0.5 where up' = (−sin, cos); on x = 0 → y = 0.5 / cos
    vnear(h.point, { x: 0, y: 0.5 / Math.cos(th) }, 1e-9);
    vnear(h.normal, M.rotate(q, { x: 0, y: 1 }), 1e-9);
  });
  test('ray hits a rounded box on its flat face and on a corner arc (1e-9)', () => {
    const s = P.box(0.5, 0.5, null, 0, 0.1);
    let h = ray(s, I0, { x: 0.2, y: 2 }, { x: 0.2, y: -2 });
    vnear(h.point, { x: 0.2, y: 0.5 }, 1e-9); vnear(h.normal, { x: 0, y: 1 }, 1e-9);
    h = ray(s, I0, { x: 0.45, y: 2 }, { x: 0.45, y: -2 });
    const y = 0.4 + Math.sqrt(0.01 - 0.0025);
    vnear(h.point, { x: 0.45, y: y }, 1e-9); vnear(h.normal, { x: 0.5, y: (y - 0.4) / 0.1 }, 1e-9);
  });
  test('ray hits a segment from either side, a one-sided segment only from the front (1e-9)', () => {
    const s = P.segment({ x: -1, y: 0 }, { x: 1, y: 0 });
    let h = ray(s, I0, { x: 0.3, y: 1 }, { x: 0.3, y: -1 });
    vnear(h.point, { x: 0.3, y: 0 }, 1e-9); vnear(h.normal, { x: 0, y: 1 }, 1e-9); near(h.fraction, 0.5, 1e-9);
    h = ray(s, I0, { x: 0.3, y: -1 }, { x: 0.3, y: 1 });
    vnear(h.normal, { x: 0, y: -1 }, 1e-9);
    const one = P.segment({ x: -1, y: 0 }, { x: 1, y: 0 }, { oneSided: true });   // faces up (left of travel)
    ok(ray(one, I0, { x: 0.3, y: 1 }, { x: 0.3, y: -1 }), 'front');
    ok(!ray(one, I0, { x: 0.3, y: -1 }, { x: 0.3, y: 1 }), 'back');
    const ch = P.chain([{ x: -1, y: 0 }, { x: 1, y: 0 }]);
    h = ray(ch[0], I0, { x: 0, y: 2 }, { x: 0, y: -2 });
    vnear(h.point, { x: 0, y: 0 }, 1e-9); vnear(h.normal, { x: 0, y: 1 }, 1e-9);
    ok(!ray(ch[0], I0, { x: 0, y: -2 }, { x: 0, y: 2 }), 'chain back');
  });
  test('misses: past the shape, too short, starting inside, parallel', () => {
    ok(!ray(P.circle(1), I0, { x: -3, y: 1.01 }, { x: 3, y: 1.01 }));
    ok(!ray(P.circle(1), I0, { x: -3, y: 0 }, { x: -1.01, y: 0 }));
    ok(!ray(P.circle(1), I0, { x: 0, y: 0 }, { x: 3, y: 0 }));
    ok(!ray(P.box(1, 1), I0, { x: -3, y: 1.5 }, { x: 3, y: 1.5 }));
    ok(!ray(P.box(1, 1), I0, { x: 0, y: 0 }, { x: 3, y: 0 }));
    ok(!ray(P.capsule({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.2), I0, { x: 1.21, y: 3 }, { x: 1.21, y: -3 }));
    // the line x + y = 0.98 clips the sharp box's corner but passes 0.127 m from the rounded core corner
    ok(ray(P.box(0.5, 0.5), I0, { x: 2.49, y: -1.51 }, { x: -1.51, y: 2.49 }), 'sharp corner');
    ok(!ray(P.box(0.5, 0.5, null, 0, 0.1), I0, { x: 2.49, y: -1.51 }, { x: -1.51, y: 2.49 }), 'rounded corner');
    ok(!ray(P.segment({ x: -1, y: 0 }, { x: 1, y: 0 }), I0, { x: -3, y: 0.1 }, { x: 3, y: 0.1 }));
  });
  function scene() {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    const ground = w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(10, 0.5)], label: 'ground' }));
    const a = w.add(new P.Body({ position: { x: 0, y: 0.5 }, shapes: [P.box(0.5, 0.5)], label: 'a' }));
    const b = w.add(new P.Body({ position: { x: 0, y: 2 }, shapes: [P.circle(0.5)], label: 'b' }));
    const s = w.add(new P.Body({ position: { x: 3, y: 1 }, shapes: [{ shape: P.box(0.5, 0.5), sensor: true }], label: 's' }));
    return { w, ground, a, b, s };
  }
  test('world rayCast returns the nearest hit; rayCastAll every hit nearest first; sensors are skipped', () => {
    const { w, ground, a, b } = scene();
    const h = P.query.rayCast(w, { x: 0, y: 5 }, { x: 0, y: -5 });
    eq(h.body, b); vnear(h.point, { x: 0, y: 2.5 }, 1e-9); near(h.fraction, 0.25, 1e-9);
    const all = P.query.rayCastAll(w, { x: 0, y: 5 }, { x: 0, y: -5 });
    eq(all.map(x => x.body.label).join(','), 'b,a,ground');
    const skip = P.query.rayCast(w, { x: 0, y: 5 }, { x: 0, y: -5 }, f => f.body !== b);
    eq(skip.body, a);
    ok(!P.query.rayCast(w, { x: 3, y: 5 }, { x: 3, y: 0.1 }), 'hit a sensor');
    eq(P.query.rayCast(w, { x: 3, y: 5 }, { x: 3, y: -5 }).body, ground);
  });
  test('pointQuery picks the fixtures under the cursor; boxQuery finds overlapping boxes', () => {
    const { w, a, b, s } = scene();
    eq(P.query.pointQuery(w, { x: 0.2, y: 0.4 }).map(f => f.body).join(), [a].join());
    eq(P.query.pointQuery(w, { x: 3, y: 1 })[0].body, s);
    eq(P.query.pointQuery(w, { x: 6, y: 3 }).length, 0);
    const hits = P.query.boxQuery(w, { x: -0.1, y: 1.2 }, { x: 0.1, y: 1.6 }).map(f => f.body.label).sort();
    eq(hits.join(), 'b');
    eq(P.query.boxQuery(w, { x: -20, y: -20 }, { x: 20, y: 20 }).length, 4);
  });
  test('shapeDistance: circles, box to box, capsule to segment, overlap (1e-9)', () => {
    let d = P.query.shapeDistance(P.circle(0.5), xf(0, 0), P.circle(0.25), xf(3, 4));
    near(d.distance, 5 - 0.75, 1e-9); vnear(d.pointA, { x: 0.3, y: 0.4 }, 1e-9); vnear(d.pointB, { x: 3 - 0.15, y: 4 - 0.2 }, 1e-9);
    d = P.query.shapeDistance(P.box(1, 1), I0, P.box(1, 1), xf(3, 3.5, Math.PI / 4));
    // nearest: corner (1, 1) of A to the lower-left face of the diamond: distance from (1,1)
    // to the line through the diamond's left and bottom corners
    const cB = { x: 3, y: 3.5 }, nB = M.norm({ x: -1, y: -1 });
    near(d.distance, M.dot(M.sub(cB, { x: 1, y: 1 }), M.neg(nB)) - 1, 1e-9);
    d = P.query.shapeDistance(P.capsule({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.1), I0, P.segment({ x: -1, y: 2 }, { x: 3, y: 2 }), I0);
    near(d.distance, 1.9, 1e-9);
    d = P.query.shapeDistance(P.box(1, 1), I0, P.circle(0.5), xf(1.2, 0));
    eq(d.distance, 0);
  });
});

suite('physics E01: performance', () => {
  test('200 mixed bodies on a chain step in under 4 ms', () => {
    const w = new P.World({ gravity: { x: 0, y: -g } });
    w.add(new P.Body({ type: 'static', shapes: P.chain([{ x: -30, y: 0 }, { x: -10, y: 0 }, { x: 0, y: -1 }, { x: 10, y: 0 }, { x: 30, y: 0 }]) }));
    for (let i = 0; i < 200; i++) {
      const s = i % 3 === 0 ? P.box(0.3, 0.3) : (i % 3 === 1 ? P.circle(0.3) : P.capsule({ x: -0.25, y: 0 }, { x: 0.25, y: 0 }, 0.15));
      w.add(new P.Body({ position: { x: -12 + (i % 25), y: 1 + 0.8 * Math.floor(i / 25) }, shapes: [s], material: 'timber' }));
    }
    w.run(2);
    const t0 = process.hrtime.bigint();
    w.run(1);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 60;
    ok(ms < 4, ms.toFixed(2) + ' ms per step');
  });
});
