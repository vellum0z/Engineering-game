'use strict';
// Yard parts: site and mechanisms. Each part is checked against the formula it stands for.
const { suite, test, near, ok, eq } = require('./harness');
const SE = globalThis.SE, Y = SE.yard, G = Y.goals;
const part = (type, props) => Y.makeInstance(type, props);
const GR = SE.physics.gravity;

suite('yard parts: site', () => {
  const gOf = (dials) => {
    const d = { parts: [part('site', { id: 's', dials }), part('crate', { id: 'c', x: 0, y: 50 })] };
    const r = Y.judge({ design: d, site: { floor: null }, goal: G.after(1), timeout: 2 });
    return { g: r.state.read('s.g'), vy: r.state.vel('c').y };
  };
  test('Earth at sea level: g = G·M/R² with the course constants, 9.81 m/s²', () => {
    const r = gOf({ body: 'Earth' });
    near(r.g, GR.G * GR.EARTH_MASS / (GR.EARTH_RADIUS * GR.EARTH_RADIUS), 1e-12);
    ok(Math.abs(r.g - 9.81) < 0.01, 'g = ' + r.g);
  });
  test('the world really falls at the site g (v = g·t after 1 s)', () => { const r = gOf({ body: 'Moon' }); near(-r.vy, r.g, 1e-9); });
  test('altitude adds to the radius: 400 km up gives the P5 orbit value 8.69 m/s²', () => {
    const r = gOf({ body: 'Earth', altitude: '400 km' });
    near(r.g, GR.G * GR.EARTH_MASS / Math.pow(GR.EARTH_RADIUS + 400e3, 2), 1e-12);
    eq(Y.dial.fmtNum(r.g, 3), '8.69');
  });
  test('Moon and Mars use their own mass and radius', () => {
    near(gOf({ body: 'Moon' }).g, GR.G * GR.MOON_MASS / (GR.MOON_RADIUS * GR.MOON_RADIUS), 1e-12);
    near(gOf({ body: 'Mars' }).g, GR.G * GR.MARS_MASS / (GR.MARS_RADIUS * GR.MARS_RADIUS), 1e-12);
    eq(Y.dial.fmtNum(gOf({ body: 'Moon' }).g, 3), '1.62');
    eq(Y.dial.fmtNum(gOf({ body: 'Mars' }).g, 3), '3.73');
  });
  test('latitude scales Earth g by the gravity formula ratio (about +0.5 % at the pole)', () => {
    const g0 = gOf({ body: 'Earth' }).g, g90 = gOf({ body: 'Earth', latitude: '90 deg' }).g;
    near(g90 / g0, GR.gLatitude(90) / GR.gLatitude(0), 1e-12);
    ok(g90 / g0 > 1.004 && g90 / g0 < 1.006);
    near(gOf({ body: 'Moon', latitude: '60 deg' }).g, gOf({ body: 'Moon' }).g, 1e-12);
  });
  test('the wrong kind of unit on the altitude dial is refused', () => {
    const r = Y.judge({ design: { parts: [part('site', { dials: { altitude: '3 kg' } })] }, goal: G.after(1) });
    ok(!r.pass && /length dial/.test(r.reason), r.reason);
  });
});

suite('yard parts: gate', () => {
  test('anchors every 0.5 m from the pin plus the end, for the gate as built', () => {
    const b = Y.build({ parts: [part('gate', { id: 'g', x: 1, y: 2, dials: { width: '2.5 m' } })] }, { floor: null });
    const an = b.parts.g.anchors;
    eq(Object.keys(an).filter(k => /^a\d+$/.test(k)).length, 6);
    const w = k => b.parts.g.body.worldPoint(an[k].local);
    near(w('a0').x, 1, 1e-12); near(w('a3').x, 2.5, 1e-12); near(w('end').x, 3.5, 1e-12); near(w('end').y, 2, 1e-12);
  });
  test('a level gate held by a vertical cable: T = W·(w/2)/x and the pin takes the rest', () => {
    const W = 100 * 9.81;
    const d = { parts: [part('gate', { id: 'g', x: 0, y: 3, dials: { width: '3 m', mass: '100 kg' } }),
      part('cable', { id: 'k', a: { part: 'ground', at: { x: 2, y: 5 } }, b: { part: 'g', anchor: 'a4' }, dials: { rating: '50 kN' } })] };
    const r = Y.judge({ design: d, site: { floor: null }, goal: G.after(3), timeout: 4 });
    near(r.state.read('k.tension'), W * 1.5 / 2, 1e-4);
    near(r.state.read('g.pinForce'), W - W * 1.5 / 2, 1e-3);
    ok(Math.abs(r.state.read('g.angle')) < 1e-4);
  });
  test('in plan view (no gravity, no floor) a push far from the pin turns it faster', () => {
    const swing = (anchor) => {
      const d = { parts: [part('gate', { id: 'g', x: 0, y: 0 }),
        part('ram', { id: 'r', a: { part: 'ground', at: { x: 0.5 * +anchor.slice(1), y: -1 } }, b: { part: 'g', anchor }, dials: { force: '200 N', stroke: '2 m' } })] };
      return Y.judge({ design: d, site: { g: 0, floor: null }, goal: G.after(0.5), timeout: 1 }).state.read('g.angle');
    };
    const near2 = swing('a2'), far = swing('a6');
    ok(far > near2 * 2.5, 'near ' + near2 + ' far ' + far);
  });
  test('a rated pin shears when the load is too big', () => {
    const d = { parts: [part('gate', { id: 'g', x: 0, y: 3, dials: { mass: '100 kg', rating: '500 N' } }),
      part('cable', { a: { part: 'ground', at: { x: 3, y: 5 } }, b: { part: 'g', anchor: 'end' }, dials: { rating: '50 kN' } })] };
    // pin carries W/2 = 490 N: holds
    ok(Y.judge({ design: d, site: { floor: null }, goal: G.all(G.noBreaks(), G.after(2)), timeout: 3 }).pass);
    d.parts[0].dials.mass = '120 kg';    // pin needs 589 N: shears
    ok(!Y.judge({ design: d, site: { floor: null }, goal: G.all(G.noBreaks(), G.after(2)), timeout: 3 }).pass);
  });
  test('hinge friction holds a gate against a small turning moment', () => {
    const mk = fr => ({ parts: [part('gate', { id: 'g', x: 0, y: 0, dials: { friction: fr } }),
      part('ram', { a: { part: 'ground', at: { x: 2, y: -1 } }, b: { part: 'g', anchor: 'a4' }, dials: { force: '15 N' } })] });
    const free = Y.judge({ design: mk(''), site: { g: 0, floor: null }, goal: G.after(1), timeout: 2 }).state.read('g.angle');
    const held = Y.judge({ design: mk('40 N*m'), site: { g: 0, floor: null }, goal: G.after(1), timeout: 2 }).state.read('g.angle');
    ok(free > 0.01 && Math.abs(held) < 1e-3, 'free ' + free + ' held ' + held);
  });
});

suite('yard parts: ram and tank', () => {
  const cartRam = (dials, t) => {
    const d = { parts: [part('cart', { id: 'c', x: 2, y: 0.25, dials: { mass: '100 kg' } }),
      part('ram', { id: 'r', a: { part: 'ground', at: { x: 0.2, y: 0.25 } }, b: { part: 'c', anchor: 'left' }, dials })] };
    return Y.judge({ design: d, goal: G.after(t), timeout: t + 1 });
  };
  test('a ram on a cart on rollers: a = F/m exactly', () => {
    const r = cartRam({ force: '200 N', stroke: '1 m' }, 0.5);
    near(r.state.vel('c').x, 1, 1e-6); near(r.state.read('r.extension'), 0.25, 0.01); near(r.state.read('r.force'), 200, 1e-9);
  });
  test('a ram waits for its start time', () => {
    near(cartRam({ force: '200 N', stroke: '1 m', start: '1 s' }, 1.5).state.vel('c').x, 1, 1e-6);
  });
  test('at the end of its stroke it stops and carries the load (W of a crate it lifted)', () => {
    const d = { parts: [part('crate', { id: 'c', x: 0, y: 1.5, dials: { mass: '200 kg' } }),
      part('ram', { id: 'r', a: { part: 'ground', at: { x: 0, y: 0 } }, b: { part: 'c', anchor: 'bottom' }, dials: { force: '5 kN', stroke: '0.8 m' } })] };
    const r = Y.judge({ design: d, goal: G.after(3), timeout: 4 });
    near(r.state.read('r.extension'), 0.8, 2e-3); near(r.state.read('r.force'), 200 * 9.81, 1e-3);
  });
  test('tank piston force is p·πd²/4 (1000 psi on a 2 in bore)', () => {
    const b = Y.build({ parts: [part('tank', { id: 't', x: 0, y: 0.5, dials: { pressure: '1000 psi', bore: '2 in' } })] });
    const F = Y.dial.parse('1000 psi', 'pressure').si * Math.PI * 0.0508 * 0.0508 / 4;
    near(b.readouts.find(x => x.id === 't.force').read(b.world), F, 1e-5);
    near(Y.site.pistonForce(2e6, 0.05), 2e6 * Math.PI * 0.0025 / 4, 1e-12);
  });
  test('a ram mounted on a tank port pushes with the tank force, not its own dial', () => {
    const d = { parts: [part('tank', { id: 't', x: 0, y: 0.5, dials: { pressure: '1000 psi', bore: '2 in' } }),
      part('crate', { id: 'c', x: 0, y: 3, dials: { mass: '200 kg' } }),
      part('ram', { id: 'r', a: { part: 't', anchor: 'port' }, b: { part: 'c', anchor: 'bottom' }, dials: { force: '1 N', stroke: '1.5 m' } })] };
    const F = Y.dial.parse('1000 psi', 'pressure').si * Math.PI * 0.0508 * 0.0508 / 4;
    const r = Y.judge({ design: d, goal: G.after(0.2), timeout: 1 });
    near(r.state.vel('c').y, (F / 200 - 9.81) * 0.2, 1e-3);
    near(r.state.read('r.force'), F, 1e-6);
  });
  test('a 1000x prefix slip on the tank (MPa for kPa) does exactly what was typed', () => {
    const b = Y.build({ parts: [part('tank', { id: 't', dials: { pressure: '2 MPa', bore: '50 mm' } })] });
    const b2 = Y.build({ parts: [part('tank', { id: 't', dials: { pressure: '2 kPa', bore: '50 mm' } })] });
    near(b.parts.t.force / b2.parts.t.force, 1000, 1e-12);
  });
});

suite('yard parts: latch, sled, board, post', () => {
  test('a latch holds a crate in the air, then lets it fall freely', () => {
    const d = { parts: [part('crate', { id: 'c', x: 0, y: 5, dials: { mass: '50 kg' } }), part('latch', { id: 'l', a: { part: 'c' }, dials: { release: '1 s' } })] };
    const held = Y.judge({ design: d, goal: G.after(0.5), timeout: 1 });
    near(held.state.pos('c').y, 5, 1e-3); eq(held.state.read('l.released'), 0); near(held.state.read('l.force'), 50 * 9.81, 1e-3);
    const fell = Y.judge({ design: d, goal: G.after(1.5), timeout: 2 });
    eq(fell.state.read('l.released'), 1); near(fell.state.vel('c').y, -9.81 * 0.5, 1e-6);
  });
  test('a sled sliding on ice stops in v²/(2·μk·g), μk mixed from runner and ice', () => {
    ['steel', 'timber', 'rubber'].forEach(run => {
      const d = { parts: [part('surface', { x: 10, y: 0.1, dials: { length: '30 m', material: 'ice' } }),
        part('sled', { id: 'k', x: 2, y: 0.5, v: { x: 3 }, dials: { mass: '80 kg', runner: run } })] };
      const r = Y.judge({ design: d, site: { floor: null }, goal: G.after(6), timeout: 7 });
      const mu = SE.phys.mixFriction(SE.phys.material(run).muK, SE.phys.material('ice').muK);
      near(r.state.pos('k').x - 2, 9 / (2 * mu * 9.81), 5e-3, run);
      near(r.state.vel('k').x, 0, 1e-9);
    });
  });
  test('a board is cut to length with its hole measured from the left end', () => {
    const b = Y.build({ parts: [part('board', { id: 'b', x: 0, y: 2, dials: { length: '1.8 m', hole: '450 mm', fixed: 'yes' } })] });
    const bb = b.parts.b;
    near(bb.body.worldPoint(bb.anchors.hole.local).x, -0.9 + 0.45, 1e-12); near(bb.hole, 0.45); eq(bb.body.type, 'static');
    near(bb.body.worldPoint(bb.anchors.right.local).x, 0.9, 1e-12);
    const loose = Y.build({ parts: [part('board', { id: 'b', y: 0.075 })] }).parts.b.body;
    near(loose.m, 550 * 2 * 0.15 * 0.05, 1e-9); eq(loose.type, 'dynamic');
    const bad = Y.build({ parts: [part('board', { id: 'b', dials: { length: '1 m', hole: '1.2 m' } })] });
    ok(bad.errors.length && /past the end/.test(bad.errors[0].error));
  });
  test('a fence post holds a cable at its top', () => {
    const d = { parts: [part('post', { id: 'p', x: 0, y: 0.6 }), part('cart', { id: 'c', x: 3, y: 0.25, v: { x: 1 } }),
      part('cable', { id: 'k', a: { part: 'p', anchor: 'top' }, b: { part: 'c', anchor: 'left' }, dials: { length: '2.5 m' } })] };
    const b = Y.build(d); eq(b.errors.length, 0);
    near(b.parts.p.body.worldPoint(b.parts.p.anchors.top.local).y, 1.2, 1e-12); eq(b.parts.p.body.type, 'static');
  });
  test('every site part is in the manual library and builds with its defaults', () => {
    const lib = Y.library();
    ['site', 'gate', 'ram', 'tank', 'latch', 'sled', 'board', 'post'].forEach(t => ok(lib.indexOf(t) >= 0, t));
    ['site', 'gate', 'tank', 'sled', 'board', 'post'].forEach(t => {
      const b = Y.build({ parts: [part(t, { id: 'x', x: 0, y: 2 })] });
      eq(b.errors.length, 0, t + ': ' + JSON.stringify(b.errors));
    });
  });
});
