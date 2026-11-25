'use strict';
// Physics benchmark: milliseconds per world.step(1/60) for four kinds of
// scene at 50, 200 and 500 bodies (plus a 300-body pile and a 200-body structures row).
//
//   node tests/bench-physics.js            table + gate
//   node tests/bench-physics.js --quick    fewer steps, for a smoke run
//
//   stack  columns of 10 crates side by side (resting contact, warm starting)
//   pile   boxes and discs dropped into a walled bin (lots of new contacts)
//   beams  four steel beams and a truss (structures.js), kept awake
//   chain  pinned chains hanging from a beam and swinging (joints only)
//
// Timing skips the first steps (JIT warm-up, the pile still falling in) and
// reports the mean, median and slowest step over the measured window. The
// median is the steadier number on a busy machine; the gate uses the mean.
// 'awake' is how many bodies were still awake at the end: once sleeping
// lands, a settled stack costs little, so read the times together with it.
// Gate: the 200-body scenes must average under 4 ms per step; exit code 1
// if any of them doesn't. The 200-body rows also show the headroom left under
// the gate, and the pile gets an extra 300-body row, so the trend is visible
// as the broadphase and solver change.
const path = require('path');
require(path.join(__dirname, 'harness')).loadGame();
const P = globalThis.SE.phys;

const quick = process.argv.includes('--quick');
const WARM = quick ? 30 : 120, STEPS = quick ? 60 : 300, GATE_MS = 4;

function ground(w) { return w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(200, 0.5)] })); }

const scenes = {
  stack(n) {
    const w = new P.World(); ground(w);
    const cols = Math.ceil(n / 10);
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      w.add(new P.Body({ position: { x: (c - cols / 2) * 1.5, y: 0.5 + r }, shapes: [P.box(0.5, 0.5)], mass: 20, material: 'cargo' }));
    }
    return w;
  },
  pile(n) {
    const w = new P.World(); ground(w);
    const half = Math.max(3, Math.sqrt(n) * 0.5);
    w.add(new P.Body({ type: 'static', position: { x: -half - 0.25, y: 10 }, shapes: [P.box(0.25, 10)] }));
    w.add(new P.Body({ type: 'static', position: { x: half + 0.25, y: 10 }, shapes: [P.box(0.25, 10)] }));
    let seed = 12345;                                   // fixed LCG so every run builds the same pile
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const perRow = Math.floor(2 * half / 0.6);
    for (let i = 0; i < n; i++) {
      const x = -half + 0.3 + (i % perRow) * 0.6 + 0.05 * rnd(), y = 0.5 + Math.floor(i / perRow) * 0.6;
      const shape = i % 2 ? P.circle(0.2 + 0.05 * rnd()) : P.box(0.2 + 0.05 * rnd(), 0.2);
      w.add(new P.Body({ position: { x, y }, angle: rnd(), shapes: [shape], mass: 5 }));
    }
    return w;
  },
  // 4 pinned-roller steel beams of 40 segments and a 13-member truss, kept
  // awake so the structure solver is timed every step (only at 200 bodies)
  beams() {
    const w = new P.World(); w.cfg.enableSleep = false;
    for (let k = 0; k < 4; k++) {
      P.structures.beam(w, { start: { x: 0, y: k * 3 }, end: { x: 8, y: k * 3 }, section: { b: 0.1, h: 0.2 },
        material: 'steel', segments: 40, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    }
    const nodes = []; for (let i = 0; i <= 6; i++) nodes.push({ x: 2 * i, y: 20 }, { x: 2 * i, y: 22 });
    const members = [];
    for (let i = 0; i < 6; i++) members.push([2 * i, 2 * i + 2], [2 * i + 1, 2 * i + 3], [2 * i, 2 * i + 1], [2 * i, 2 * i + 3]);
    members.push([12, 13]);
    P.structures.truss(w, { nodes, members, material: 'steel', area: 2e-3, I: 1e-6, supports: [{ node: 0 }, { node: 12, type: 'roller' }] });
    return w;
  },
  chain(n) {
    const w = new P.World();
    const per = 10, chains = Math.ceil(n / per);
    const beam = w.add(new P.Body({ type: 'static', position: { x: 0, y: 20 }, shapes: [P.box(chains, 0.1)] }));
    let made = 0;
    for (let c = 0; c < chains; c++) {
      let prev = beam; const x0 = -chains + 0.5 + 2 * c;
      for (let k = 0; k < per && made < n; k++, made++) {
        // links lie out sideways so the chains swing for the whole run
        const link = w.add(new P.Body({ position: { x: x0 + 0.2 + 0.4 * k, y: 19.9 }, shapes: [{ shape: P.box(0.2, 0.04), group: -(c + 1) }], mass: 1 }));
        w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: x0 + 0.4 * k, y: 19.9 } }));
        prev = link;
      }
    }
    return w;
  }
};

function time(build, n) {
  const w = build(n);
  for (let i = 0; i < WARM; i++) w.step(1 / 60);
  let total = 0, worst = 0; const all = [];
  for (let i = 0; i < STEPS; i++) {
    const t0 = process.hrtime.bigint();
    w.step(1 / 60);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    total += ms; all.push(ms); if (ms > worst) worst = ms;
  }
  const bad = w.bodies.some(b => !Number.isFinite(b.c.x) || !Number.isFinite(b.c.y));
  const awake = w.bodies.filter(b => b.type !== 'static' && b.awake !== false).length;
  all.sort((a, b) => a - b);
  return { mean: total / STEPS, median: all[all.length >> 1], worst, contacts: w.contacts.size, awake, bad };
}

const sizes = { stack: [50, 200, 500], pile: [50, 200, 300, 500], beams: [200], chain: [50, 200, 500] };
const pad = (s, n) => String(s).padStart(n);
console.log(`physics step benchmark (dt 1/60, ${new P.World().substeps} substeps, ${STEPS} timed steps after ${WARM} warm-up), node ${process.version}`);
console.log('scene   bodies   mean ms   median ms   worst ms   contacts   awake');
let failed = [];
Object.keys(scenes).forEach(name => {
  sizes[name].forEach(n => {
    const r = time(scenes[name], n);
    const head = 100 * (1 - r.mean / GATE_MS);
    const gate = n === 200 ? (r.mean < GATE_MS ? `  ok, ${head.toFixed(0)}% headroom` : '  OVER ' + GATE_MS + ' ms') : '';
    if (n === 200 && r.mean >= GATE_MS) failed.push(name);
    if (r.bad) failed.push(name + ' (NaN)');
    console.log(`${name.padEnd(6)} ${pad(n, 7)} ${pad(r.mean.toFixed(3), 9)} ${pad(r.median.toFixed(3), 11)} ${pad(r.worst.toFixed(3), 10)} ${pad(r.contacts, 10)} ${pad(r.awake, 7)}${gate}${r.bad ? '  NaN!' : ''}`);
  });
});
if (failed.length) { console.log('\nGATE FAILED (200 bodies < ' + GATE_MS + ' ms/step): ' + failed.join(', ')); process.exit(1); }
console.log('\ngate passed: every 200-body scene under ' + GATE_MS + ' ms/step');
