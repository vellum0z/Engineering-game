'use strict';
// P.diagnose: build diagnostics for what the engine can't simulate
// faithfully. Each limit is checked from both sides: a build just past it is
// reported with the right code and severity, and a build comfortably inside
// it is not. The thresholds come from experiments against the engine, noted
// next to each test.
const { suite, test, ok } = require('./harness');
const P = globalThis.SE.phys;
const g = 9.81;


/* ------------------------------------------------- shared report helpers */
// The e09 files share one table through a global, printed on exit.
const E09 = globalThis.__E09 || (globalThis.__E09 = { rows: [] });
if (!E09.hooked) {
  E09.hooked = true;
  process.on('exit', () => {
    if (!process.env.E09_REPORT) return;
    const w = [52, 10, 14, 8];
    const line = cols => cols.map((c, i) => String(c).padEnd(w[i])).join(' ');
    console.log('\n' + line(['check', 'tolerance', 'error', 'result']));
    E09.rows.forEach(r => console.log(line([r.name.slice(0, w[0]), r.tol, r.err, r.status])));
  });
}
function pending(name) {
  console.log('  pending: ' + name);
  E09.rows.push({ name, tol: '-', err: '-', status: 'pending' });
}
function row(name, pass, detail) {
  E09.rows.push({ name, tol: '-', err: detail, status: pass ? 'pass' : 'FAIL' });
  ok(pass, name + ': ' + detail);
}

/* ---------------------------------------------------------- helpers */
function world() { return new P.World({ gravity: { x: 0, y: -g } }); }
function floor(w) { return w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(40, 0.5)], label: 'ground' })); }
function sky(w, y) { return w.add(new P.Body({ type: 'static', position: { x: 0, y: y || 10 }, label: 'gantry' })); }
function crate(w, x, y, m, hw, hh, extra) {
  return w.add(new P.Body(Object.assign({ position: { x, y }, shapes: [P.box(hw || 0.5, hh || hw || 0.5)], mass: m, label: 'crate' }, extra || {})));
}
function ball(w, x, y, m, r, extra) {
  return w.add(new P.Body(Object.assign({ position: { x, y }, shapes: [P.circle(r || 0.1)], mass: m }, extra || {})));
}
const codes = (list) => list.map(i => i.severity + ':' + i.code);
function has(list, code, severity) { return list.find(i => i.code === code && (!severity || i.severity === severity)); }
function expect(name, list, code, severity) {
  const hit = has(list, code, severity);
  row('diagnose: ' + name, !!hit, hit ? hit.severity + ' ' + code + ' (' + (+hit.value).toPrecision(3) + ')' : 'got [' + codes(list).join(', ') + ']');
  return hit;
}
function expectNone(name, list, code) {
  const hit = list.filter(i => !code || i.code === code);
  row('diagnose: ' + name, hit.length === 0, hit.length ? 'got [' + codes(hit).join(', ') + ']' : 'clean');
}

/* ------------------------------------------------------ clean builds */
suite('e09 diagnose: sound builds stay quiet', () => {
  test('crate stack, pendulum, pinned chain, welded frame and a winch lift report nothing', () => {
    const w = world(), top = sky(w, 12); floor(w);
    for (let i = 0; i < 5; i++) crate(w, 0, 0.5 + i * 1.0, 50 + 20 * i);
    const bob = ball(w, 4, 8, 5);
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: bob, localAnchorA: top.localPoint({ x: 4, y: 12 }) }));
    let prev = top;
    for (let i = 0; i < 6; i++) {
      const link = w.add(new P.Body({ position: { x: -4 + 0.2 + 0.4 * i, y: 11.9 }, shapes: [{ shape: P.box(0.2, 0.03), group: -1 }], mass: 1 }));
      w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: link, worldAnchor: { x: -4 + 0.4 * i, y: 11.9 } }));
      prev = link;
    }
    // welded square frame: a closed loop of welds is fine (the direct solve copes)
    const s = [[8, 3.5, 0.5, 0.05], [8, 2.5, 0.5, 0.05], [7.5, 3, 0.05, 0.5], [8.5, 3, 0.05, 0.5]].map(([x, y, hw, hh]) => w.add(new P.Body({ position: { x, y }, shapes: [{ shape: P.box(hw, hh), group: -2 }], mass: 5 })));
    [[0, 2, 7.5, 3.5], [0, 3, 8.5, 3.5], [1, 2, 7.5, 2.5], [1, 3, 8.5, 2.5]].forEach(([a, b, x, y]) => w.addJoint(new P.WeldJoint({ bodyA: s[a], bodyB: s[b], worldAnchor: { x, y } })));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: s[0], localAnchorA: top.localPoint({ x: 8, y: 12 }), rope: true }));
    // light hook under a winch lifting a heavy load: solved as one block, fine
    if (P.WinchJoint) {
      const hook = ball(w, -8, 6, 5, 0.15);
      const load = crate(w, -8, 0.5, 2000);
      w.addJoint(new P.WinchJoint({ bodyA: top, localAnchorA: top.localPoint({ x: -8, y: 12 }), bodyB: hook, reelSpeed: 0.5, maxPull: 5e4 }));
      w.addJoint(new P.DistanceJoint({ bodyA: hook, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true }));
    }
    expectNone('sound yard: nothing at build time', P.diagnose(w));
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    expectNone('sound yard: nothing while running', P.diagnose(w).filter(i => i.severity !== 'info'));
  });
  test('beam and truss builders report nothing', () => {
    if (!P.structures || !P.structures.beam) { pending('structures quiet (needs structures.js)'); return; }
    const w = world(); floor(w);
    P.structures.beam(w, { start: { x: 0, y: 2 }, end: { x: 6, y: 2 }, section: { b: 0.1, h: 0.2 }, material: 'steel', segments: 12, supports: [{ at: 'start', type: 'pin' }, { at: 'end', type: 'roller' }] });
    expectNone('beam on pin and roller', P.diagnose(w).filter(i => i.severity !== 'info'));
  });
});

/* --------------------------------------------------------- overlaps */
suite('e09 diagnose: overlapping parts', () => {
  test('crates built 5 cm into each other warn; 60 cm into a 1 m crate is an error; 5 mm and jointed pairs are fine', () => {
    let w = world(); floor(w);
    crate(w, 0, 0.5, 50); crate(w, 0, 1.45, 50);
    const shallow = expect('5 cm overlap warns', P.diagnose(w), 'overlap', 'warning');
    ok(Math.abs(shallow.value - 0.05) < 0.005, 'depth ' + shallow.value);
    w = world(); floor(w); crate(w, 0, 0.5, 50); crate(w, 0, 0.9, 50);
    expect('60 cm overlap is an error', P.diagnose(w), 'overlap', 'error');
    w = world(); floor(w); crate(w, 0, 0.5, 50); crate(w, 0, 1.495, 50);
    expectNone('5 mm overlap is ignored', P.diagnose(w), 'overlap');
    w = world(); floor(w);
    const a = crate(w, 0, 0.5, 50), b = crate(w, 0.6, 0.5, 50);
    w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.3, y: 0.5 } }));
    expectNone('overlapping parts joined by a pin are ignored', P.diagnose(w), 'overlap');
  });
  test('overlap is a build-time check: not reported once the run has started, unless asked', () => {
    const w = world(); floor(w); crate(w, 0, 0.5, 50); crate(w, 0, 1.45, 50);
    w.step(1 / 60);
    expectNone('overlap after first step', P.diagnose(w), 'overlap');
    // the solver has pushed them most of the way apart by now; put them back
    w.bodies[2].setTransform({ x: 0, y: 1.4 }, 0);
    expect('overlap on request with build: true', P.diagnose(w, { build: true }), 'overlap');
  });
});

/* ------------------------------------------------ redundant joints */
suite('e09 diagnose: redundant joints', () => {
  // Two pins at different points between the same pair blow up today (NaN
  // within a second); a weld plus a pin, two welds, or two pins at the same
  // point run fine but the extra joint carries no load.
  function pair(add) {
    const w = world(), top = sky(w);
    const a = w.add(new P.Body({ position: { x: 0, y: 9 }, shapes: [P.box(0.5, 0.1)], mass: 10 }));
    const b = w.add(new P.Body({ position: { x: 1, y: 9 }, shapes: [P.box(0.5, 0.1)], mass: 10 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: a, worldAnchor: { x: -0.5, y: 9 } }));
    add(w, a, b);
    return P.diagnose(w);
  }
  test('two pins at different points between the same parts: error', () => {
    const d = pair((w, a, b) => { w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.5, y: 9 } })); w.addJoint(new P.RevoluteJoint({ bodyA: b, bodyB: a, worldAnchor: { x: 0.3, y: 9 } })); });
    const hit = expect('double pin is an error', d, 'redundant-pins', 'error');
    ok(hit.joints.length === 2 && hit.bodies.length === 2, 'should name both pins and both parts');
  });
  test('a weld plus a pin warns; a pin plus a rod (3 freedoms) does not', () => {
    expect('weld + pin warns', pair((w, a, b) => { w.addJoint(new P.WeldJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.5, y: 9 } })); w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.6, y: 9 } })); }), 'redundant-joints', 'warning');
    expectNone('pin + rod is fine', pair((w, a, b) => { w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.5, y: 9 } })); w.addJoint(new P.DistanceJoint({ bodyA: a, bodyB: b, localAnchorA: { x: 0, y: 0 }, localAnchorB: { x: 0.3, y: 0 } })); }));
  });
  test('a part pinned to two different ground points counts the ground as one body', () => {
    const w = world(), wall = sky(w), post = sky(w, 5);
    const bar = w.add(new P.Body({ position: { x: 1, y: 7 }, shapes: [P.box(1, 0.05)], mass: 10 }));
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: bar, worldAnchor: { x: 0, y: 7 } }));
    w.addJoint(new P.RevoluteJoint({ bodyA: post, bodyB: bar, worldAnchor: { x: 2, y: 7 } }));
    expect('two ground pins on one bar', P.diagnose(w), 'redundant-pins', 'error');
  });
});

/* ------------------------------------------------------- mass ratio */
suite('e09 diagnose: mass ratios', () => {
  // Rod between a 1 kg and an m kg ball, hanging from a pin: measured drift
  // over 10 s was 2 cm at 1:100 and 20 cm at 1:1000.
  function rodPair(m) {
    const w = world(), top = sky(w);
    const light = ball(w, 0, 9, 1), heavy = ball(w, 0, 8, m, 0.2);
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: light, worldAnchor: { x: 0, y: 9 } }));
    w.addJoint(new P.DistanceJoint({ bodyA: light, bodyB: heavy }));
    return P.diagnose(w);
  }
  test('rod from a 1 kg part to 2000 kg: error; to 300 kg: warning; to 50 kg: nothing', () => {
    expect('rod 1:2000 is an error', rodPair(2000), 'mass-ratio-joint', 'error');
    expect('rod 1:300 warns', rodPair(300), 'mass-ratio-joint', 'warning');
    expectNone('rod 1:50 is fine', rodPair(50));
  });
  test('a small part on a long lever arm counts as light (effective mass 1/(1/m + r²/I))', () => {
    // 1 kg, 0.2 m box pinned 5 m away to a 3000 kg crate: blew up at step 60
    // in the robustness pass. Effective mass at the pin: I = 1·0.08/12, so
    // 1/(1 + 25·150) = 2.7e-4 kg against ~3000 kg.
    const w = world(); floor(w);
    const heavy = crate(w, 0, 0.5, 3000), light = w.add(new P.Body({ position: { x: 0, y: 3 }, shapes: [P.box(0.1, 0.1)], mass: 1, label: 'bracket' }));
    w.addJoint(new P.RevoluteJoint({ bodyA: light, bodyB: heavy, worldAnchor: { x: 5, y: 3 } }));
    const d = P.diagnose(w);
    expect('lever arm: mass ratio error', d, 'mass-ratio-joint', 'error');
    expect('lever arm: anchor far error', d, 'anchor-far', 'error');
    ok(/bracket/.test(has(d, 'mass-ratio-joint').message), 'message should name the light part');
  });
  test('equal parts joined far away get only the far-anchor warning, not a mass ratio', () => {
    const w = world(), top = sky(w);
    const a = w.add(new P.Body({ position: { x: -2, y: 8 }, shapes: [P.box(0.15, 0.15)], mass: 5 }));
    const b = w.add(new P.Body({ position: { x: 2, y: 8 }, shapes: [P.box(0.15, 0.15)], mass: 5 }));
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: a, localAnchorA: { x: -2, y: 0 }, rope: true }));
    w.addJoint(new P.RevoluteJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0, y: 8 } }));
    const d = P.diagnose(w);
    expectNone('far equal parts: no mass ratio', d, 'mass-ratio-joint');
    expect('far equal parts: far anchor warns', d, 'anchor-far', 'warning');
  });
  test('heavy crate on a light one: 1:500 error, 1:150 warning, 1:20 and light-on-heavy fine', () => {
    // measured sink of a 1 kg crate under a heavier one after 10 s:
    // 1:100 ≈ 1 cm, 1:300 ≈ 2.6 cm, 1:1000 crushed through the floor
    const stack = (top, bottom) => { const w = world(); floor(w); crate(w, 0, 0.25, bottom, 0.25); crate(w, 0, 0.5 + 0.4 + 0.005, top, 0.5, 0.4); return w; };
    expect('stack 1:500 is an error', P.diagnose(stack(500, 1)), 'mass-ratio-stack', 'error');
    expect('stack 1:150 warns', P.diagnose(stack(150, 1)), 'mass-ratio-stack', 'warning');
    expectNone('stack 1:20 is fine', P.diagnose(stack(20, 1)));
    expectNone('light on heavy is fine', P.diagnose(stack(1, 5000)));
    const w = stack(500, 1); for (let i = 0; i < 10; i++) w.step(1 / 60);
    expect('stack 1:500 still reported while running (from contacts)', P.diagnose(w), 'mass-ratio-stack', 'error');
  });
  test('a light link in the middle of a hanging chain carrying a heavy load', () => {
    // ground - rod - 0.5 kg - rod - 20 kg - rod - 2000 kg: the 0.5 kg link
    // carries 4000 times its mass through the chain.
    const w = world(), top = sky(w);
    const n1 = ball(w, 0, 9, 0.5, 0.05, { label: 'small link' }), n2 = ball(w, 0, 8, 20), load = ball(w, 0, 7, 2000, 0.3, { label: 'load' });
    w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: n1, localAnchorA: { x: 0, y: 0 } }));
    w.addJoint(new P.DistanceJoint({ bodyA: n1, bodyB: n2 }));
    w.addJoint(new P.DistanceJoint({ bodyA: n2, bodyB: load }));
    const hit = expect('light link carrying 1:4000', P.diagnose(w), 'light-carries-heavy', 'error');
    ok(hit.bodies[0] === n1 && hit.bodies[1] === load, 'should name the light link and the load');
  });
});

/* --------------------------------------------------- runtime checks */
suite('e09 diagnose: while running', () => {
  // A part passes through another when it moves further in one step than
  // the two are thick together: from a 192-case sweep (2–30 cm walls,
  // 10–300 m/s), v·dt > own + wall thickness predicted 132 of 136
  // pass-throughs; the factor 0.75 catches the rest.
  function shot(v, dir) {
    const w = new P.World({ gravity: { x: 0, y: 0 } });
    w.add(new P.Body({ type: 'static', position: { x: 1, y: 0 }, shapes: [P.box(0.01, 1)], label: 'sheet' }));
    const b = w.add(new P.Body({ position: { x: -0.6, y: 0 }, velocity: { x: v * dir, y: 0 }, shapes: [P.circle(0.05)], mass: 1, label: 'bolt' }));
    w.step(1 / 60);
    return { w, b, d: P.diagnose(w, { dt: 1 / 60 }) };
  }
  test('a 10 cm bolt at 60 m/s heading for a 2 cm sheet warns; at 3 m/s or flying away it does not', () => {
    const fast = expect('tunnel risk at 60 m/s', shot(60, 1).d, 'tunnel-risk', 'warning');
    ok(fast.bodies[1].label === 'sheet', 'should name the sheet');
    expectNone('no tunnel risk at 3 m/s', shot(3, 1).d, 'tunnel-risk');
    expectNone('no tunnel risk flying away', shot(60, -1).d, 'tunnel-risk');
  });
  test('NaN or a speed at the engine cap: "simulation unstable" naming the culprits', () => {
    const w = world(); floor(w);
    const a = crate(w, 0, 0.5, 10), b = crate(w, 3, 0.5, 10, 0.5, 0.5, { label: 'runaway' });
    w.step(1 / 60);
    expectNone('steady before', P.diagnose(w), 'unstable');
    a.v = { x: NaN, y: 0 }; b.v = { x: 0.95 * w.cfg.maxLinearSpeed, y: 0 };
    const hit = expect('NaN and capped speed are unstable', P.diagnose(w), 'unstable', 'error');
    ok(hit.bodies.includes(a) && hit.bodies.includes(b) && hit.bodies.length === 2, 'should list exactly the two culprits');
    ok(/unstable/i.test(hit.message), 'message says unstable');
  });
  test('a sudden kick from 1 m/s to 80 m/s in one step warns', () => {
    const w = new P.World({ gravity: { x: 0, y: 0 } });
    const b = w.add(new P.Body({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 }, shapes: [P.box(0.5, 0.5)], mass: 1 }));
    w.step(1 / 60); P.diagnose(w);
    b.v = { x: 80, y: 0 }; w.step(1 / 60);
    expect('speed jump warns', P.diagnose(w), 'speed-jump', 'warning');
    w.step(1 / 60);
    expectNone('steady fast motion is not a jump', P.diagnose(w), 'speed-jump');
  });
  test('a rope at 91% of its rating gives a near-break hint; at 33% it does not', () => {
    const hang = (rating) => {
      const w = world(), top = sky(w);
      const load = crate(w, 0, 8, 100);
      w.addJoint(new P.DistanceJoint({ bodyA: top, bodyB: load, localAnchorB: { x: 0, y: 0.5 }, rope: true, breakForce: rating, label: 'sling' }));
      for (let i = 0; i < 60; i++) w.step(1 / 60);
      return P.diagnose(w);
    };
    const hit = expect('near break at 91%', hang(1.1 * 100 * g), 'near-break', 'info');
    ok(Math.abs(hit.value - 1 / 1.1) < 0.02 && /sling/.test(hit.message), 'utilisation ' + hit.value);
    expectNone('far from break at 33%', hang(3 * 100 * g), 'near-break');
  });
});

/* ------------------------------------------------- cache and cost */
suite('e09 diagnose: cache and cost', () => {
  test('adding or removing a joint updates the cached structural checks', () => {
    const w = world(), top = sky(w);
    const a = ball(w, 0, 9, 1), b = ball(w, 0, 8, 5000, 0.3);
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: a, worldAnchor: { x: 0, y: 9 } }));
    expectNone('before the rod', P.diagnose(w), 'mass-ratio-joint');
    const rod = w.addJoint(new P.DistanceJoint({ bodyA: a, bodyB: b }));
    expect('after adding the rod', P.diagnose(w), 'mass-ratio-joint', 'error');
    w.removeJoint(rod);
    expectNone('after removing it', P.diagnose(w), 'mass-ratio-joint');
  });
  test('busy yard (60 bodies, 40 joints): a running frame costs under 0.5 ms', () => {
    const w = world(), top = sky(w, 20); floor(w);
    for (let i = 0; i < 20; i++) crate(w, (i % 5) * 1.2 - 10, 0.5 + Math.floor(i / 5), 20);
    for (let c = 0; c < 4; c++) {
      let prev = top;
      for (let k = 0; k < 10; k++) {
        const l = w.add(new P.Body({ position: { x: 2 + c * 4 + 0.2 + 0.4 * k, y: 19.9 }, shapes: [{ shape: P.box(0.2, 0.04), group: -1 }], mass: 1 }));
        w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: l, worldAnchor: { x: 2 + c * 4 + 0.4 * k, y: 19.9 } }));
        prev = l;
      }
    }
    for (let i = 0; i < 60; i++) { w.step(1 / 60); P.diagnose(w); }
    const times = [];
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60);
      const t0 = process.hrtime.bigint(); P.diagnose(w); times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    times.sort((x, y) => x - y);
    const med = times[30];
    E09.rows.push({ name: 'diagnose: running frame, 60 bodies / 40 joints', tol: '< 0.5 ms', err: med.toFixed(3) + ' ms', status: med < 0.5 ? 'pass' : 'FAIL' });
    ok(w.bodies.length >= 60 && w.joints.length >= 40, 'scene size');
    ok(med < 0.5, 'median ' + med.toFixed(3) + ' ms');
  });
  test('every message is short plain text', () => {
    const w = world(), top = sky(w); floor(w);
    crate(w, 0, 0.5, 50); crate(w, 0, 1.4, 50);
    const a = ball(w, 0, 9, 1), b = ball(w, 0, 8, 5000, 0.3);
    w.addJoint(new P.RevoluteJoint({ bodyA: top, bodyB: a, worldAnchor: { x: 0, y: 9 } }));
    w.addJoint(new P.DistanceJoint({ bodyA: a, bodyB: b }));
    const d = P.diagnose(w);
    ok(d.length >= 2, 'expected some issues');
    d.forEach(i => ok(typeof i.message === 'string' && i.message.length > 10 && i.message.length < 200 && !/NaN|undefined|\[object/.test(i.message), 'bad message: ' + i.message));
    ok(d.every(i => ['error', 'warning', 'info'].includes(i.severity) && Array.isArray(i.bodies) && Array.isArray(i.joints) && Array.isArray(i.fixtures)), 'shape of each issue');
  });
});

/* ------------------------------------------------ fuzzer cross-check */
suite('e09 diagnose: fuzzer builds', () => {
  test('every busy random build that blows up today is flagged with an error before it runs', () => {
    let fz;
    try { fz = require('./fuzz-physics.js'); } catch (e) { pending('fuzzer cross-check (needs tests/fuzz-physics.js)'); return; }
    let failing = 0, caught = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const spec = fz.BUILDS.mix(fz.rng(seed * 7919 + 'mix'.length));
      const errs = P.diagnose(spec.w).filter(i => i.severity === 'error');
      const res = fz.runCase('mix', seed);
      if (res.issues.some(s => /NaN|explosion/.test(s))) { failing++; if (errs.length) caught++; }
    }
    row('diagnose: blown-up fuzz builds flagged', caught === failing, caught + ' of ' + failing);
  });
});
