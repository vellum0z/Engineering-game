#!/usr/bin/env node
/*
 * Robustness fuzzer: random player-style builds, run headless, checked for
 * the failures a sandbox can't hide: NaN, explosions, energy gain, joints
 * drifting apart, jitter at rest, tunnelling and frame-time spikes.
 *
 *   node tests/fuzz-physics.js [runs=200] [seed=1] [--only=kind] [--verbose]
 *
 * Every build is reproducible from (kind, seed). A failing case prints the
 * command that replays it alone. Exit code 1 if any case fails.
 */
'use strict';
const path = require('path');
require(path.join(__dirname, 'harness')).loadGame();
const P = globalThis.SE.phys, M = globalThis.SE.pmath;

const argv = process.argv.slice(2);
const flag = (k) => { const a = argv.find(x => x.startsWith('--' + k)); return a ? (a.split('=')[1] || true) : null; };
const nums = argv.filter(a => !a.startsWith('--')).map(Number);
const RUNS = nums[0] || 200, SEED0 = nums[1] || 1, ONLY = flag('only'), VERBOSE = !!flag('verbose');

// small deterministic PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
  f.pick = (xs) => xs[Math.floor(f() * xs.length)];
  f.logRange = (lo, hi) => Math.exp(f.range(Math.log(lo), Math.log(hi)));
  return f;
}

const G = 9.81;
function baseWorld() {
  const w = new P.World({ gravity: { x: 0, y: -G } });
  w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(60, 0.5)], label: 'ground' }));
  return w;
}
function crate(w, x, y, hw, hh, m, extra) {
  return w.add(new P.Body(Object.assign({ position: { x, y }, shapes: [P.box(hw, hh)], mass: m, material: 'cargo' }, extra || {})));
}
function gantry(w, x, y) { return w.add(new P.Body({ type: 'static', position: { x, y }, shapes: [P.box(1.5, 0.15)], label: 'gantry' })); }

/* --------------------------------------------------------------- builds */
// Each returns { w, expect } where expect describes what "settled" means.
const BUILDS = {
  stack(r) {   // crates of random size and mass, piled up
    const w = baseWorld(); let y = 0;
    const n = r.int(3, 14);
    for (let i = 0; i < n; i++) {
      const hw = r.range(0.2, 0.8), hh = r.range(0.15, 0.6);
      crate(w, r.range(-0.1, 0.1) * hw, y + hh + 0.01, hw, hh, r.logRange(1, 2000));
      y += 2 * hh + 0.01;
    }
    return { w, rest: true };
  },
  massRatio(r) {   // very heavy on very light, up to 1:10⁴
    const w = baseWorld();
    const light = r.logRange(0.5, 5), heavy = light * r.logRange(100, 1e4);
    const small = crate(w, 0, 0.25, 0.25, 0.25, light);
    crate(w, r.range(-0.1, 0.1), 0.5 + 0.4 + 0.02, 0.5, 0.4, heavy);
    return { w, rest: true, crush: small, note: 'ratio ' + (heavy / light).toFixed(0) };
  },
  chain(r) {   // a long hanging chain of ropes, rods and springs with a load
    const w = baseWorld(), top = gantry(w, 0, 20);
    let prev = top, prevAnchor = { x: 0, y: -0.15 }, y = 19.85;
    const n = r.int(5, 30), link = r.range(0.2, 0.6);
    for (let i = 0; i < n; i++) {
      y -= link;
      const b = w.add(new P.Body({ position: { x: r.range(-0.05, 0.05), y }, shapes: [{ shape: P.circle(0.05), group: -7 }], mass: r.logRange(0.2, 5) }));
      const kind = r.pick(['rope', 'rod', 'spring']);
      const def = { bodyA: prev, bodyB: b, localAnchorA: prevAnchor, localAnchorB: { x: 0, y: 0 } };
      if (kind === 'rope') def.rope = true;
      if (kind === 'spring') { def.stiffness = r.logRange(200, 2e5); def.damping = r.range(0, 50); }
      w.addJoint(new P.DistanceJoint(def));
      prev = b; prevAnchor = { x: 0, y: 0 };
    }
    const load = crate(w, 0, y - 0.6, 0.3, 0.3, r.logRange(1, 500));
    w.addJoint(new P.DistanceJoint({ bodyA: prev, bodyB: load, localAnchorB: { x: 0, y: 0.3 }, rope: true }));
    return { w, rest: false, swingOk: true };
  },
  winchLight(r) {   // winch on a light body lifting something heavy
    const w = baseWorld(), top = gantry(w, 0, 12);
    const hookM = r.logRange(1, 50), loadM = r.logRange(10, 2e4);
    const hook = w.add(new P.Body({ position: { x: 0, y: 6 }, shapes: [P.circle(0.15)], mass: hookM }));
    const load = crate(w, r.range(-0.3, 0.3), 0.5, 0.5, 0.5, loadM);
    const pull = loadM * G * r.range(0.5, 2.5);
    w.addJoint(new P.WinchJoint({ bodyA: top, localAnchorA: { x: 0, y: -0.15 }, bodyB: hook, reelSpeed: r.range(0.1, 2), maxPull: pull }));
    w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    return { w, rest: false, winch: true, note: 'hook ' + hookM.toFixed(1) + ' kg, load ' + loadM.toFixed(0) + ' kg' };
  },
  tunnel(r) {   // a fast crate pushed into a thin block
    const w = baseWorld();
    const thick = r.range(0.02, 0.1), dyn = r() < 0.5;
    const wall = w.add(new P.Body({ type: dyn ? 'dynamic' : 'static', position: { x: 5, y: 1.5 }, shapes: [P.box(thick / 2, 1.5)], mass: dyn ? r.logRange(5, 500) : undefined }));
    const v = r.range(20, 150), size = r.range(0.05, 0.4);
    const bullet = w.add(new P.Body({ position: { x: 0, y: 1.5 }, velocity: { x: v, y: 0 }, shapes: [r() < 0.5 ? P.box(size, size) : P.circle(size)], mass: r.logRange(0.1, 50) }));
    return { w, rest: false, tunnel: { bullet, wall, x: 5 }, note: 'v ' + v.toFixed(0) + ' m/s, wall ' + (thick * 100).toFixed(1) + ' cm' + (dyn ? ' dynamic' : ' static') };
  },
  overlap(r) {   // parts dropped on top of each other
    const w = baseWorld();
    const n = r.int(2, 12);
    for (let i = 0; i < n; i++) crate(w, r.range(-0.4, 0.4), r.range(0.3, 1.2), r.range(0.2, 0.6), r.range(0.2, 0.6), r.logRange(1, 500), { angle: r.range(-1, 1) });
    return { w, rest: true, overlap: true };
  },
  hub(r) {   // many joints on one body
    const w = baseWorld(), top = gantry(w, 0, 10);
    const hub = w.add(new P.Body({ position: { x: 0, y: 7 }, shapes: [P.circle(0.4)], mass: r.logRange(1, 200) }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: hub, localAnchorA: { x: 0, y: -0.15 }, rope: true }));
    const n = r.int(6, 24);
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n, L = r.range(0.8, 2);
      const b = w.add(new P.Body({ position: { x: L * Math.cos(a), y: 7 + L * Math.sin(a) }, shapes: [{ shape: P.box(0.1, 0.1), group: -3 }], mass: r.logRange(0.5, 100) }));
      const kind = r.pick(['pin', 'rod', 'weld', 'spring']);
      if (kind === 'pin') {
        const mid = { x: 0.4 * Math.cos(a), y: 7 + 0.4 * Math.sin(a) };
        const arm = w.add(new P.Body({ position: { x: (mid.x + b.c.x) / 2, y: (mid.y + b.c.y) / 2 }, angle: a, shapes: [{ shape: P.box(L / 2 - 0.2, 0.03), group: -3 }], mass: 1 }));
        w.addJoint(new P.RevoluteJoint({ bodyA: hub, bodyB: arm, worldAnchor: mid }));
        w.addJoint(new P.RevoluteJoint({ bodyA: arm, bodyB: b, worldAnchor: b.c }));
      } else if (kind === 'weld') w.addJoint(new P.WeldJoint({ bodyA: hub, bodyB: b, worldAnchor: b.c }));
      else if (kind === 'rod') w.addJoint(new P.DistanceJoint({ bodyA: hub, bodyB: b }));
      else w.addJoint(new P.DistanceJoint({ bodyA: hub, bodyB: b, stiffness: r.logRange(500, 1e5), damping: r.range(0, 30) }));
    }
    return { w, rest: false, swingOk: true };
  },
  mix(r) {   // ~60 bodies and ~40 joints of every kind, like a busy yard
    const w = baseWorld(), top = gantry(w, 0, 14), bodies = [];
    for (let i = 0; i < 60; i++) {
      const x = r.range(-12, 12), y = r.range(0.5, 10), m = r.logRange(1, 3000);
      const s = r() < 0.3 ? P.circle(r.range(0.1, 0.5)) : (r() < 0.2 && P.capsule ? P.capsule({ x: -0.4, y: 0 }, { x: 0.4, y: 0 }, 0.1) : P.box(r.range(0.1, 0.7), r.range(0.1, 0.5)));
      bodies.push(w.add(new P.Body({ position: { x, y }, angle: r.range(-0.5, 0.5), shapes: [s], mass: m })));
    }
    for (let i = 0; i < 40; i++) {
      const a = r.pick(bodies), b = r() < 0.15 ? top : r.pick(bodies);
      if (a === b) continue;
      const kind = r.pick(['rope', 'rod', 'spring', 'pin', 'weld', 'slider', 'winch']);
      const mid = M.lerp(a.c, b.c, 0.5);
      try {
        if (kind === 'rope') w.addJoint(new P.DistanceJoint({ bodyA: b, bodyB: a, rope: true }));
        else if (kind === 'rod') w.addJoint(new P.DistanceJoint({ bodyA: b, bodyB: a }));
        else if (kind === 'spring') w.addJoint(new P.DistanceJoint({ bodyA: b, bodyB: a, stiffness: r.logRange(100, 1e5), damping: r.range(0, 100) }));
        else if (kind === 'pin') w.addJoint(new P.RevoluteJoint({ bodyA: b, bodyB: a, worldAnchor: mid }));
        else if (kind === 'weld') w.addJoint(new P.WeldJoint({ bodyA: b, bodyB: a, worldAnchor: mid }));
        else if (kind === 'slider') w.addJoint(new P.PrismaticJoint({ bodyA: b, bodyB: a, worldAnchor: mid, worldAxis: M.norm({ x: r.range(-1, 1), y: r.range(-1, 1) }), motorForce: r.range(0, 2e4) }));
        else w.addJoint(new P.WinchJoint({ bodyA: b, bodyB: a, reelSpeed: r.range(-1, 1), maxPull: r.logRange(100, 1e5) }));
      } catch (e) { /* a definition the API rejects is fine: that's a yard error, not a sim fault */ }
    }
    return { w, rest: false, swingOk: true, busy: true };
  }
};

/* ---------------------------------------------------------------- checks */
function energy(w) {
  let E = 0;
  w.bodies.forEach(b => { if (b.type === 'dynamic') E += b.kineticEnergy() + b.m * G * b.c.y; });
  w.joints.forEach(j => { if (j.stiffness > 0 && j.geometry) { const x = j.geometry().L - j.length; E += 0.5 * j.stiffness * x * x; } });
  return E;
}
function rigidGap(j) {
  if (j.broken) return 0;
  if (j.type === 'revolute' || j.type === 'weld') return M.dist(j.anchorA(), j.anchorB());
  if (j.type === 'distance' && !j.rope && !(j.stiffness > 0) && !(j.hertz > 0) && j.geometry) return Math.abs(j.geometry().L - j.length);
  return 0;
}

function runCase(kind, seed) {
  const r = rng(seed * 7919 + kind.length);
  const spec = BUILDS[kind](r), w = spec.w;
  const dt = 1 / 60, steps = 600;
  const E0 = energy(w);
  let maxStep = 0, total = 0, worstGap = 0, maxSpeed = 0, issues = [];
  let Eprev = E0, Emax = E0;
  let startSpeed = 0; w.bodies.forEach(b => { startSpeed = Math.max(startSpeed, M.len(b.v)); });
  for (let s = 0; s < steps; s++) {
    const t0 = process.hrtime.bigint();
    try { w.step(dt); } catch (e) { issues.push('threw: ' + e.message); break; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    total += ms; if (s > 5) maxStep = Math.max(maxStep, ms);
    let bad = false;
    w.bodies.forEach(b => {
      if (!isFinite(b.c.x) || !isFinite(b.c.y) || !isFinite(b.angle) || !isFinite(b.v.x) || !isFinite(b.w)) bad = true;
      // a body that rolled off the end of the ground (|x| > 60 m) is in free
      // fall, not an explosion; one that fell through the ground still counts
      if (b.c.y > -2 || Math.abs(b.c.x) < 60) maxSpeed = Math.max(maxSpeed, M.len(b.v));
    });
    if (bad) { issues.push('NaN at step ' + s); break; }
    w.joints.forEach(j => { worstGap = Math.max(worstGap, rigidGap(j)); });
    const E = energy(w); Emax = Math.max(Emax, E); Eprev = E;
  }
  // explosion: something moving far faster than anything could fall or was thrown
  const fallSpeed = Math.sqrt(2 * G * 25);
  if (maxSpeed > Math.max(startSpeed * 1.2, fallSpeed * 1.5) + 5 && !spec.winch && !spec.busy) issues.push('explosion: speed ' + maxSpeed.toFixed(1) + ' m/s');
  if (maxSpeed > 200) issues.push('explosion: speed ' + maxSpeed.toFixed(0) + ' m/s');
  // energy gain beyond what motors/winches could supply
  const scaleE = Math.max(Math.abs(E0), 1);
  if (!spec.winch && !spec.busy && !spec.overlap && Emax > E0 + 0.05 * scaleE + 5) issues.push('energy gain: ' + ((Emax - E0) / scaleE * 100).toFixed(1) + '%');
  if (worstGap > 0.05) issues.push('joint drift: ' + (worstGap * 100).toFixed(1) + ' cm');
  if (spec.rest) {
    let ke = 0, mtot = 0;
    w.bodies.forEach(b => { if (b.type === 'dynamic') { ke += b.kineticEnergy(); mtot += b.m; } });
    const vrms = Math.sqrt(2 * ke / Math.max(mtot, 1e-9));
    if (vrms > (spec.swingOk ? 0.5 : 0.05)) issues.push('not at rest: v_rms ' + vrms.toFixed(3) + ' m/s');
  }
  if (spec.overlap) {
    // overlapping parts should be pushed apart, not left interpenetrating
    let worst = 0;
    w.contacts.forEach(ct => ct.points.forEach(p => { worst = Math.min(worst, p.separation); }));
    if (worst < -0.05) issues.push('still overlapping by ' + (-worst * 100).toFixed(1) + ' cm');
  }
  if (spec.crush) {
    // the light crate must still be under the heavy one, at its own height
    const b = spec.crush;
    if (b.c.y < 0.25 - 0.02 || Math.abs(b.c.x) > 0.3) issues.push('light crate crushed or squeezed out (y ' + b.c.y.toFixed(3) + ', x ' + b.c.x.toFixed(2) + ')');
  }
  if (spec.tunnel) {
    const { bullet, wall } = spec.tunnel;
    if (bullet.c.x > wall.c.x + 0.5 && wall.c.x < 6 && Math.abs(bullet.c.y - wall.c.y) < 1.5) issues.push('tunnelled through the wall');
  }
  if (maxStep > 16) issues.push('frame spike: ' + maxStep.toFixed(1) + ' ms');
  return { kind, seed, issues, mean: total / steps, maxStep, note: spec.note || '', bodies: w.bodies.length, joints: w.joints.length };
}

if (require.main === module) {
  const kinds = ONLY ? [ONLY] : Object.keys(BUILDS);
  const fails = [], perKind = {};
  for (let i = 0; i < RUNS; i++) {
    const kind = kinds[i % kinds.length], seed = SEED0 + Math.floor(i / kinds.length);
    const res = runCase(kind, seed);
    const k = perKind[kind] = perKind[kind] || { n: 0, fail: 0, mean: 0, max: 0 };
    k.n++; k.mean += res.mean; k.max = Math.max(k.max, res.maxStep);
    if (res.issues.length) { k.fail++; fails.push(res); }
    if (VERBOSE) console.log(kind, seed, res.issues.join('; ') || 'ok', res.note);
  }
  console.log('kind         runs  fail   mean ms  max ms');
  Object.keys(perKind).forEach(k => {
    const s = perKind[k];
    console.log(k.padEnd(12), String(s.n).padStart(4), String(s.fail).padStart(5), (s.mean / s.n).toFixed(3).padStart(9), s.max.toFixed(2).padStart(7));
  });
  fails.slice(0, +(flag('show') || 40)).forEach(f => console.log(`✗ ${f.kind} seed ${f.seed} (${f.bodies} bodies, ${f.joints} joints) ${f.note}: ${f.issues.join('; ')}\n    node tests/fuzz-physics.js 1 ${f.seed} --only=${f.kind}`));
  console.log(`\n${RUNS - fails.length}/${RUNS} builds clean`);
  process.exit(fails.length ? 1 : 0);
}
module.exports = { runCase, BUILDS, rng };
