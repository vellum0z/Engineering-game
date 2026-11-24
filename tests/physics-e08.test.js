'use strict';
// Debug renderer: camera maths, and every lab scene drawn into a stub canvas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys;

// A 2D context that records calls and checks every numeric argument is finite.
function stubContext() {
  const calls = [];
  const bad = [];
  const gradient = { addColorStop() {} };
  const target = {
    calls, bad,
    measureText: (s) => ({ width: String(s).length * 7 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createPattern: () => ({}), getImageData: () => ({ data: [] })
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return function () {
        const args = Array.from(arguments);
        args.forEach((a) => { if (typeof a === 'number' && !isFinite(a)) bad.push(k + '(' + args.join(', ') + ')'); });
        calls.push(k);
      };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function labScenes() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'physics-lab.html'), 'utf8');
  const m = html.match(/<script id="lab-scenes">([\s\S]*?)<\/script>/);
  ok(m, 'lab-scenes script block not found in physics-lab.html');
  vm.runInThisContext(m[1], { filename: 'physics-lab.html#lab-scenes' });
  return globalThis.SE.labScenes;
}

suite('physics E08: camera', () => {
  const cams = [];
  [5, 37.5, 120, 900].forEach((zoom) => {
    [{ x: 0, y: 0 }, { x: -12.3, y: 4.56 }, { x: 1e3, y: -250 }].forEach((center) => {
      cams.push(new P.Camera({ center, zoom, width: 960, height: 540 }));
    });
  });
  const pts = [{ x: 0, y: 0 }, { x: 3.25, y: -7.5 }, { x: -1234.5, y: 987.25 }, { x: 1e-4, y: 2e-4 }];

  test('world -> screen -> world round trips to 1e-9 m across zoom and pan', () => {
    let worst = 0;
    cams.forEach((c) => {
      c.pan(17, -33);
      pts.forEach((p) => {
        const q = c.screenToWorld(c.worldToScreen(p));
        worst = Math.max(worst, Math.abs(q.x - p.x), Math.abs(q.y - p.y));
      });
    });
    ok(worst < 1e-9, 'worst error ' + worst);
  });

  test('y points up: a higher world point is higher on screen (smaller sy)', () => {
    const c = new P.Camera({ zoom: 50, width: 800, height: 600 });
    ok(c.worldToScreen({ x: 0, y: 1 }).y < c.worldToScreen({ x: 0, y: 0 }).y);
    // centre of view maps to the middle of the canvas; 1 m = zoom px
    near(c.worldToScreen({ x: 0, y: 0 }).x, 400, 1e-12);
    near(c.worldToScreen({ x: 1, y: 0 }).x - 400, 50, 1e-12);
  });

  test('zoom about a point keeps that point fixed on screen (1e-9 m)', () => {
    const c = new P.Camera({ center: { x: 2, y: 3 }, zoom: 40, width: 1000, height: 700 });
    const s = { x: 731, y: 122 };
    [1.7, 0.31, 4, 0.9].forEach((f) => {
      const before = c.screenToWorld(s);
      c.zoomAt(s, f);
      const after = c.screenToWorld(s);
      near(after.x, before.x, 1e-9); near(after.y, before.y, 1e-9);
    });
    near(c.zoom, 40 * 1.7 * 0.31 * 4 * 0.9, 1e-9);
  });

  test('pan moves the world with the pointer: a dragged point follows the drag exactly', () => {
    const c = new P.Camera({ zoom: 64, width: 800, height: 600 });
    const p = { x: 1.5, y: -2 }, s0 = c.worldToScreen(p);
    c.pan(40, -25);
    const s1 = c.worldToScreen(p);
    near(s1.x - s0.x, 40, 1e-9); near(s1.y - s0.y, -25, 1e-9);
  });

  test('fit frames a box inside the padded view and centres it', () => {
    const c = new P.Camera({ width: 800, height: 400 });
    c.fit({ lo: { x: -1, y: 0 }, hi: { x: 9, y: 2 } }, 20);
    // width-limited: (800 - 40) / 10 = 76 px/m; height would allow (400 - 40) / 2 = 180
    near(c.zoom, 76, 1e-12);
    near(c.center.x, 4, 1e-12); near(c.center.y, 1, 1e-12);
    const lo = c.worldToScreen({ x: -1, y: 0 }), hi = c.worldToScreen({ x: 9, y: 2 });
    near(lo.x, 20, 1e-9); near(hi.x, 780, 1e-9);
    ok(hi.y >= 20 && lo.y <= 380, 'box off screen');
  });

  test('devicePixelRatio: resize sizes the backing store, apply scales to CSS px', () => {
    const canvas = { clientWidth: 300, clientHeight: 150, width: 0, height: 0 };
    const c = new P.Camera({ canvas, dpr: 2 });
    ok(c.resize(), 'resize should report a change');
    ok(canvas.width === 600 && canvas.height === 300, 'backing store ' + canvas.width + '×' + canvas.height);
    ok(!c.resize(), 'second resize should be a no-op');
    near(c.width(), 300, 1e-12);
    let m = null;
    c.apply({ setTransform: function () { m = Array.from(arguments); } });
    ok(m && m[0] === 2 && m[3] === 2 && m[4] === 0, 'transform ' + JSON.stringify(m));
  });
});

suite('physics E08: debug drawing', () => {
  test('stress colour runs green -> amber -> red with utilisation', () => {
    const c = P.debugDraw.stressColor;
    ok(c(0) === '#8fcf6a' && c(0.5) === '#e6b422' && c(1) === '#e2553f' && c(3) === '#e2553f', [c(0), c(0.5), c(1)].join(' '));
  });

  test('force labels: 3 significant figures, kN above 1000 N, converts to lbf through SE.units', () => {
    const f = P.debugDraw.formatForce;
    ok(f(12.345, 'N') === '12.3 N', f(12.345, 'N'));
    ok(f(1962, 'N') === '1.96 kN', f(1962, 'N'));
    // 4.448 N per lbf (Table 1-2): 444.8 N = 100 lbf
    ok(f(444.8, 'lbf') === '100 lbf', f(444.8, 'lbf'));
  });

  const scenes = labScenes();
  test('the lab defines the seven demo scenes', () => {
    const ids = scenes.map((s) => s.id).join(',');
    ok(ids === 'stack,pyramid,pendulum,cradle,hoist,cantilever,ramp', ids);
  });

  const everything = { contacts: true, aabbs: true, forces: true, contactForces: true, weights: true, labels: true, dt: 1 / 60 };
  scenes.forEach((def) => {
    test('scene "' + def.id + '": runs 5 s and draws every overlay with no throw and no NaN', () => {
      const sc = def.build(P), w = sc.world;
      const cam = new P.Camera({ width: 960, height: 600 }).fit(P.debugDraw.worldBounds(w, 40), 40);
      const ctx = stubContext();
      for (let i = 0; i < 300; i++) {
        if (sc.update) sc.update(w);
        w.step(1 / 60);
        if (i % 30 === 0) {
          P.debugDraw(ctx, w, cam, Object.assign({ highlight: w.bodies[w.bodies.length - 1] }, everything));
          P.debugDrawFreeBody(ctx, [
            { kind: 'weight', point: w.bodies[1].c, vector: { x: 0, y: -w.bodies[1].m * 9.81 } },
            { kind: 'normal', point: { x: 0, y: 0 }, vector: { x: 0, y: w.bodies[1].m * 9.81 }, label: 'N' },
            { kind: 'moment', point: { x: 1, y: 0 }, moment: -42 }
          ], cam);
        }
      }
      ok(ctx.calls.length > 100, 'too few draw calls: ' + ctx.calls.length);
      ok(ctx.bad.length === 0, 'non-finite canvas arguments: ' + ctx.bad.slice(0, 3).join('; '));
      w.bodies.forEach((b) => ok(isFinite(b.c.x) && isFinite(b.c.y), 'NaN body in ' + def.id));
    });
  });

  test('hoist: the rope snaps after the drop and the break flash is drawn', () => {
    const def = scenes.find((s) => s.id === 'hoist'), sc = def.build(P), w = sc.world;
    const cam = new P.Camera({ width: 960, height: 600 }).fit(P.debugDraw.worldBounds(w, 40), 40);
    const ctx = stubContext();
    P.debugDraw(ctx, w, cam, {});          // subscribes to 'break' before it happens
    let broke = null;
    w.on('break', (e) => { if (!broke) broke = e; });
    for (let i = 0; i < 240 && !broke; i++) { sc.update(w); w.step(1 / 60); }
    ok(broke && broke.joint.label === 'hoist rope', 'hoist rope did not snap');
    ok(w.time > 2, 'snapped before the drop at t = ' + w.time.toFixed(2));
    const ctx2 = stubContext();
    P.debugDraw(ctx2, w, cam, {});
    ok(ctx2.calls.indexOf('fillText') >= 0, 'no SNAP label drawn');
  });

  test('cantilever: mean root moment = Σ m g x (10%), largest at the wall, root weld breaks when the crate lands', () => {
    const def = scenes.find((s) => s.id === 'cantilever'), sc = def.build(P), w = sc.world;
    // the beam is released straight and swings about its sagged shape, so average the moments over 2 s (about 3 periods)
    const sum = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 120; i++) { w.step(1 / 60); w.joints.forEach((j, k) => { sum[k] += j.lastTorque / 120; }); }
    ok(sum[0] > sum[2] && sum[2] > sum[5], 'moments ' + sum.map((x) => x.toFixed(0)).join(','));
    // static root moment of six 165 kg segments: Σ m g x = 165·9.81·(0.5 + 1.5 + … + 5.5) = 29.1 kN·m (within 10%)
    near(sum[0], 165 * 9.81 * 18, 0.1);
    let broke = null;
    w.on('break', (e) => { if (!broke) broke = e; });
    for (let i = 0; i < 180 && !broke; i++) { sc.update(w); w.step(1 / 60); }
    ok(broke && broke.joint.label === 'weld 0', 'root weld did not break: ' + (broke && broke.joint.label));
  });

  test('debugdraw.js loads headless: no window or document used at load time', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/physics/debugdraw.js'), 'utf8');
    ok(!/\bdocument\./.test(src) && !/\bwindow\./.test(src), 'touches the DOM');
  });
});
