'use strict';
// E04 joints: pins, welds, sliders and rams, and the drag handle. Each
// physical claim is checked against a hand calculation; the tolerance is in
// the test name and the working is in a comment.
const { suite, test, near, ok } = require('./harness');
const P = globalThis.SE.phys, M = globalThis.SE.pmath;
const g = 9.81, DEG = Math.PI / 180;

function world(opts) { return new P.World(Object.assign({ gravity: { x: 0, y: -g }, enableSleep: false }, opts || {})); }
function anchor(w, x, y) { return w.add(new P.Body({ type: 'static', position: { x: x || 0, y: y || 0 } })); }
function bar(w, x, y, halfL, m, angle, opts) {
  return w.add(new P.Body(Object.assign({ position: { x, y }, angle: angle || 0, shapes: [{ shape: P.box(halfL, 0.05), group: 1 }], mass: m }, opts || {})));
}
// Apply a force every step (forces are cleared after each step).
function runWithLoad(w, seconds, body, F, localPoint, each) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    body.applyForce(F, body.worldPoint(localPoint));
    w.step(1 / 60);
    if (each) each(w);
  }
}

suite('physics E04: pins', () => {
  test('beam on a pin and a roller: reactions from ΣM = 0 (within 1%)', () => {
    // 4 m beam, 50 kg (W = 490.5 N), pinned at x = 0, resting on a
    // frictionless roller at x = 3 m, 500 N down at x = 1 m. About the pin:
    //   R·3 = W·2 + 500·1  ->  R = (981 + 500)/3 = 493.67 N
    //   ΣFy: pin V = W + 500 − R = 496.83 N;  ΣFx: pin H = 0.
    const w = world(), wall = anchor(w, 0, 0), W = 50 * g;
    const beam = bar(w, 2, 0, 2, 50);
    const pin = w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: beam, worldAnchor: { x: 0, y: 0 } }));
    w.add(new P.Body({ type: 'static', position: { x: 3, y: -0.15 }, shapes: [{ shape: P.circle(0.1), friction: 0 }] }));
    runWithLoad(w, 3, beam, { x: 0, y: -500 }, { x: -1, y: 0 });
    const R = w.contactForceOn(beam, 1 / 60), F = pin.reaction().force;
    near(R.y, (W * 2 + 500 * 1) / 3, 0.01, 'roller');
    near(F.y, W + 500 - (W * 2 + 500 * 1) / 3, 0.01, 'pin vertical');
    ok(Math.abs(F.x) < 0.01 * W, 'pin horizontal should be ~0, got ' + F.x);
  });

  test('door limit stops at 90° and holds it, limit torque = mgL/2 (within 1%)', () => {
    // 1 m, 20 kg door hinged at its foot, standing up and nudged to tip
    // CCW; the upper limit at +90° catches it lying flat pointing −x.
    // Holding torque = m g (L/2) = 20 · 9.81 · 0.5 = 98.1 N·m (clockwise).
    const w = world(), wall = anchor(w);
    const door = bar(w, 0, 0.5, 0.5, 20, 90 * DEG, { angularVelocity: 0.5 });
    const hinge = w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: door, worldAnchor: { x: 0, y: 0 }, lowerAngle: -10 * DEG, upperAngle: 90 * DEG }));
    w.run(4);
    ok(Math.abs(hinge.angle() - 90 * DEG) < 0.5 * DEG, 'door at ' + (hinge.angle() / DEG).toFixed(2) + '°');
    near(hinge.torque(), -20 * g * 0.5, 0.01);
    near(hinge.limitTorque(), -20 * g * 0.5, 0.01);
    ok(Math.abs(hinge.angularSpeed()) < 1e-3, 'door should be still');
  });

  test('motor stalls when the load torque exceeds maxMotorTorque, lifts when not (2% margin)', () => {
    // Horizontal 2 m, 30 kg arm on a motorised pin: load = m g L/2 = 294.3 N·m.
    const load = 30 * g * 1;
    [[0.98, false], [1.02, true]].forEach(([f, lifts]) => {
      const w = world(), wall = anchor(w);
      const arm = bar(w, 1, 0, 1, 30);
      const j = w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, motorSpeed: 0.5, maxMotorTorque: f * load }));
      w.run(0.5);
      ok((j.angle() > 0) === lifts, f + '× load: angle ' + (j.angle() / DEG).toFixed(2) + '°');
      if (!lifts) near(j.motorTorque(), f * load, 1e-9, 'saturated motor torque');
    });
  });

  test('a motor holding against a load reads the load torque (within 1%)', () => {
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 30);
    const j = w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, motorSpeed: 0, maxMotorTorque: 1000 }));
    w.run(2);
    near(j.motorTorque(), 30 * g * 1, 0.01);
    ok(Math.abs(j.angle()) < 0.2 * DEG, 'arm should not droop: ' + j.angle());
  });

  test('rotational spring: static deflection θ with k θ = m g (L/2) cos θ (within 2%)', () => {
    // k = 3000 N·m/rad, 2 m 30 kg arm: θ ≈ 294.3/3000 ≈ 0.098 rad.
    const k = 3000, w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 30);
    const j = w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, stiffness: k, damping: 200 }));
    w.run(5);
    const th = -j.angle();
    near(k * th, 30 * g * 1 * Math.cos(th), 0.02);
    near(j.springTorque(), k * th, 0.02);
  });

  test('a motor pushing past breakTorque shears the pin (reason torque)', () => {
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 30);
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, motorSpeed: 0, maxMotorTorque: 1000, breakTorque: 250 }));
    let e = null; w.on('break', x => { e = x; });
    w.run(1);
    ok(e && e.reason === 'torque', 'expected a torque break');
  });

  test('ten-link pinned chain released at 30°, 10 s: pins stay within 1 mm, energy within 2%', () => {
    // Links 0.3 m, 1 kg, in one collision group, hung from a shapeless pivot.
    const w = world(), top = anchor(w, 0, 10), th = 30 * DEG, s = 0.3;
    const dir = { x: Math.sin(th), y: -Math.cos(th) };
    let prev = top; const links = [];
    for (let i = 0; i < 10; i++) {
      const c = M.add({ x: 0, y: 10 }, M.scale(dir, s * i + s / 2));
      const b = bar(w, c.x, c.y, s / 2, 1, th - 90 * DEG);
      w.addJoint(new P.RevoluteJoint({ bodyA: prev, bodyB: b, worldAnchor: M.add({ x: 0, y: 10 }, M.scale(dir, s * i)) }));
      links.push(b); prev = b;
    }
    const E = () => links.reduce((e, b) => e + b.kineticEnergy() + b.m * g * b.c.y, 0);
    // Swing energy scale: drop of the chain's centre of mass from 30° to hanging,
    // 10 kg · g · 1.5 m · (1 − cos 30°) = 19.7 J.
    const E0 = E(), scale = 10 * g * 1.5 * (1 - Math.cos(th));
    let gap = 0, dE = 0;
    w.run(10, 1 / 60, () => {
      w.joints.forEach(j => { gap = Math.max(gap, M.dist(j.anchorA(), j.anchorB())); });
      dE = Math.max(dE, Math.abs(E() - E0));
    });
    ok(gap < 1e-3, 'pin gap ' + (gap * 1000).toFixed(3) + ' mm');
    ok(dE / scale < 0.02, 'energy drift ' + (100 * dE / scale).toFixed(2) + '%');
  });
});

suite('physics E04: welds', () => {
  test('weld torque at a cantilever root = W·L/2 + P·L (within 1%)', () => {
    // 2 m, 40 kg arm, 1000 N at the tip: M = 392.4·1 + 1000·2 = 2392.4 N·m, V = 1392.4 N.
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 40);
    const weld = w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 } }));
    runWithLoad(w, 2, arm, { x: 0, y: -1000 }, { x: 1, y: 0 });
    near(weld.torque(), 40 * g * 1 + 1000 * 2, 0.01);
    near(weld.force(), 40 * g + 1000, 0.01);
    near(weld.reaction().torque, weld.torque(), 1e-12);
  });

  test('rigid 10-segment welded cantilever: sags under 1 cm, settles, root moment = W·L/2 (within 1%)', () => {
    // 10 segments of 0.5 m, 10 kg: W = 981 N over 5 m, root moment 981·2.5 = 2452.5 N·m.
    const w = world(), wall = anchor(w);
    let prev = wall; const segs = [];
    for (let i = 0; i < 10; i++) {
      const b = bar(w, 0.5 * i + 0.25, 0, 0.25, 10);
      w.addJoint(new P.WeldJoint({ bodyA: prev, bodyB: b, worldAnchor: { x: 0.5 * i, y: 0 } }));
      segs.push(b); prev = b;
    }
    w.run(3);
    const tip = segs[9].worldPoint({ x: 0.25, y: 0 });
    ok(-tip.y < 0.01, 'tip sag ' + (-tip.y * 1000).toFixed(2) + ' mm');
    ok(segs.every(b => Math.abs(b.w) < 1e-3 && M.len(b.v) < 1e-3), 'should have settled');
    near(w.joints[0].torque(), 100 * g * 2.5, 0.01);
  });

  test('rigid 20-segment welded chain holds straight (tip sag under 1 cm)', () => {
    const w = world(), wall = anchor(w);
    let prev = wall, last = null;
    for (let i = 0; i < 20; i++) {
      last = bar(w, 0.5 * i + 0.25, 0, 0.25, 5);
      w.addJoint(new P.WeldJoint({ bodyA: prev, bodyB: last, worldAnchor: { x: 0.5 * i, y: 0 } }));
      prev = last;
    }
    w.run(5);
    ok(-last.worldPoint({ x: 0.25, y: 0 }).y < 0.01, 'tip sag ' + (-last.worldPoint({ x: 0.25, y: 0 }).y * 1000).toFixed(2) + ' mm');
    near(w.joints[0].torque(), 100 * g * 5, 0.01);   // 100 kg acting 5 m out
  });

  test('torsion-spring weld: deflection θ with k θ = M cos θ (within 2%)', () => {
    // k = 20 kN·m/rad, 2 m 40 kg arm, 1000 N at the tip: M ≈ 2392 N·m, θ ≈ 0.12 rad.
    const k = 20000, w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 40);
    const weld = w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, angularStiffness: k, angularDamping: 2000 }));
    runWithLoad(w, 5, arm, { x: 0, y: -1000 }, { x: 1, y: 0 });
    const th = -weld.angle();
    near(k * th, (40 * g * 1 + 1000 * 2) * Math.cos(th), 0.02);
    near(weld.torque(), k * th, 0.02);
  });

  test('a very stiff torsion weld (2e7 N·m/rad) holds like a rigid one', () => {
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 40);
    const weld = w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, angularStiffness: 2e7, breakTorque: 2000 }));
    let broke = false; w.on('break', () => { broke = true; });
    w.run(2);
    ok(!broke, 'should not break: peak torque ' + weld.peakTorque);
    near(weld.torque(), 40 * g, 0.01);
  });

  test('linear-spring weld: a hanging 50 kg load stretches it by mg/k (within 2%)', () => {
    const k = 50000, w = world(), top = anchor(w, 0, 5);
    const load = w.add(new P.Body({ position: { x: 0, y: 4.5 }, shapes: [P.box(0.2, 0.5)], mass: 50 }));
    const weld = w.addJoint(new P.WeldJoint({ bodyA: top, bodyB: load, worldAnchor: { x: 0, y: 5 }, linearStiffness: k, linearDamping: 2000 }));
    w.run(3);
    near(-weld.offset().y, 50 * g / k, 0.02);
    near(weld.force(), 50 * g, 0.01);
  });

  test('weld and pin chains without the group solve still work (plain Gauss-Seidel)', () => {
    const w = world(), wall = anchor(w);
    w.jointBlockSolve = false;
    const arm = bar(w, 1, 0, 1, 20);
    const weld = w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 } }));
    w.run(2);
    near(weld.torque(), 20 * g, 0.01);
    ok(!weld.block, 'no group when switched off');
  });
});

suite('physics E04: sliders and rams', () => {
  // A crate on a floor; the ram is a light piston on a slider that pushes the
  // crate through contact, so the crate's weight goes entirely to the floor.
  function ramRig(opts) {
    const w = world();
    const floor = w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [{ shape: P.box(50, 0.5), friction: opts.mu }] }));
    const crate = w.add(new P.Body({ position: { x: 0.5, y: 0.5 }, shapes: [{ shape: P.box(0.5, 0.5), friction: opts.mu }], mass: 100 }));
    const piston = w.add(new P.Body({ position: { x: -0.1, y: 0.5 }, shapes: [{ shape: P.box(0.1, 0.3), friction: 0 }], mass: 1, gravityScale: 0 }));
    const ram = w.addJoint(new P.PrismaticJoint(Object.assign({ bodyA: floor, bodyB: piston, worldAnchor: { x: -0.1, y: 0.5 }, worldAxis: { x: 1, y: 0 } }, opts.ram)));
    return { w, crate, piston, ram };
  }

  test('force-controlled ram on ice: a = F/(m_crate + m_piston) (within 1%)', () => {
    // 500 N on 101 kg: a = 4.950 m/s², v(2 s) = 9.90 m/s.
    const { w, crate, ram } = ramRig({ mu: 0, ram: { motorForce: 500, maxRamSpeed: 20 } });
    w.run(0.5); const v0 = crate.v.x, t0 = w.time;
    w.run(1.5);
    near((crate.v.x - v0) / (w.time - t0), 500 / 101, 0.01);
    near(ram.axialForce(), 500, 1e-9);
  });

  test('a crate on a slider with a 500 N ram on ice: a = F/m (within 1%) and the limit stops it at 1 m travel', () => {
    // Slider straight on the crate: the joint and the floor share the weight,
    // nothing resists along the axis, so a = 500/100 = 5 m/s².
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [{ shape: P.box(50, 0.5), friction: 0 }] }));
    const crate = w.add(new P.Body({ position: { x: 0, y: 0.5 }, shapes: [{ shape: P.box(0.5, 0.5), friction: 0 }], mass: 100 }));
    const rail = anchor(w, 0, 0.5);
    const ram = w.addJoint(new P.PrismaticJoint({ bodyA: rail, bodyB: crate, worldAnchor: { x: 0, y: 0.5 }, worldAxis: { x: 1, y: 0 }, motorForce: 500, upperTranslation: 1 }));
    w.run(0.3);
    near(crate.v.x / w.time, 5, 0.01);
    w.run(2);
    ok(Math.abs(ram.translation() - 1) < 5e-3, 'stopped at ' + ram.translation().toFixed(4) + ' m');
    ok(Math.abs(ram.speed()) < 1e-3, 'should be still: ' + ram.speed());
    near(ram.reaction().force.x, 0, 1, 'ram push and limit cancel');
    near(-ram.upperImpulse * ram.invH, -500, 0.01, 'limit holds the 500 N');
  });

  test('speed-controlled ram stalls when friction μmg exceeds maxMotorForce (5% margin)', () => {
    // μ = 0.5, 100 kg: friction 490.5 N.
    const fr = 0.5 * 100 * g;
    [[0.95, false], [1.05, true]].forEach(([f, moves]) => {
      const { w, crate, ram } = ramRig({ mu: 0.5, ram: { motorSpeed: 0.5, maxMotorForce: f * fr } });
      w.run(1.5);
      // with 5% to spare the crate accelerates at 0.05·490.5/101 = 0.24 m/s²
      ok((crate.v.x > 0.2) === moves, f + '× friction: crate speed ' + crate.v.x.toFixed(4));
      if (!moves) { ok(Math.abs(crate.v.x) < 0.01, 'stalled crate creeps at ' + crate.v.x); near(ram.axialForce(), f * fr, 1e-6); }
    });
  });

  test('ram spring: static compression under a 100 kg crate = mg/k (within 2%)', () => {
    // Vertical slider with a spring: a crate standing on a platform.
    const k = 20000, w = world(), base = anchor(w, 0, 0);
    const plate = w.add(new P.Body({ position: { x: 0, y: 1 }, shapes: [P.box(0.5, 0.05)], mass: 100 }));
    const sp = w.addJoint(new P.PrismaticJoint({ bodyA: base, bodyB: plate, worldAnchor: { x: 0, y: 1 }, worldAxis: { x: 0, y: 1 }, stiffness: k, damping: 3000 }));
    w.run(3);
    near(-sp.translation(), 100 * g / k, 0.02);
    near(sp.axialForce(), 100 * g, 0.01);
  });

  test('slider keeps its axis and angle under a side load (within 1 mm, 0.1°)', () => {
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 30);
    const j = w.addJoint(new P.PrismaticJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, worldAxis: { x: 1, y: 0 }, lowerTranslation: 0, upperTranslation: 0 }));
    runWithLoad(w, 2, arm, { x: 0, y: -2000 }, { x: 1, y: 0 });
    const d = M.sub(j.anchorB(), j.anchorA());
    ok(Math.abs(d.y) < 1e-3 && Math.abs(j.angle()) < 0.1 * DEG, 'offset ' + d.y + ', angle ' + j.angle());
    near(j.torque(), 30 * g * 1 + 2000 * 2, 0.01);
  });
});

suite('physics E04: drag handle', () => {
  test('dragging a 100 kg crate: the handle force never exceeds maxForce', () => {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(50, 0.5)] }));
    const crate = w.add(new P.Body({ position: { x: 0, y: 0.5 }, shapes: [P.box(0.5, 0.5)], mass: 100, material: 'cargo' }));
    const drag = w.addJoint(new P.MouseJoint({ body: crate, target: { x: 0, y: 0.8 }, maxForce: 800 }));
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      drag.setTarget({ x: Math.min(4, i * 0.05), y: 0.8 });
      w.step(1 / 60);
      peak = Math.max(peak, drag.force());
    }
    ok(peak <= 800 * (1 + 1e-9), 'peak handle force ' + peak);
    ok(peak > 700, 'the drag should have been force-limited, peak ' + peak);
    ok(crate.c.x > 1, 'crate should have moved: x = ' + crate.c.x);
  });

  test('drag in zero g never adds more kinetic energy than maxForce × distance, and settles on the target', () => {
    // 200 N over 3 m can do at most 600 J of work.
    const w = world({ gravity: { x: 0, y: 0 } });
    const crate = w.add(new P.Body({ position: { x: 0, y: 0 }, shapes: [P.box(0.5, 0.5)], mass: 100 }));
    const drag = w.addJoint(new P.MouseJoint({ body: crate, target: { x: 0, y: 0 }, maxForce: 200 }));
    drag.setTarget({ x: 3, y: 0 });
    let peakKE = 0;
    w.run(15, 1 / 60, () => { peakKE = Math.max(peakKE, crate.kineticEnergy()); });
    ok(peakKE <= 600, 'peak KE ' + peakKE.toFixed(1) + ' J');
    ok(M.dist(crate.c, { x: 3, y: 0 }) < 0.01, 'ended at ' + JSON.stringify(crate.c));
  });

  test('yanking the top crate of a stack and letting go: no blow-up', () => {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(50, 0.5)] }));
    const crates = [];
    for (let i = 0; i < 5; i++) crates.push(w.add(new P.Body({ position: { x: 0, y: 0.5 + i }, shapes: [P.box(0.5, 0.5)], mass: 50, material: 'cargo' })));
    w.run(1);
    const top = crates[4];
    const drag = w.addJoint(new P.MouseJoint({ body: top, target: top.worldPoint({ x: 0.3, y: 0.3 }) }));
    let vmax = 0;
    for (let i = 0; i < 60; i++) {
      drag.setTarget({ x: 0.3 + 1.5 * Math.sin(i / 30), y: 4.8 });   // hand moving at up to 3 m/s
      w.step(1 / 60);
      crates.forEach(b => { vmax = Math.max(vmax, M.len(b.v)); });
    }
    w.removeJoint(drag);
    w.run(4, 1 / 60, () => crates.forEach(b => { vmax = Math.max(vmax, M.len(b.v)); }));
    ok(crates.every(b => isFinite(b.c.x) && isFinite(b.c.y)), 'NaN');
    ok(vmax < 10, 'peak crate speed ' + vmax.toFixed(1) + ' m/s');
    ok(crates.every(b => b.c.y > 0.4), 'a crate went through the floor');
  });
});

suite('physics E04: saving joints', () => {
  test('pins, sliders and drags round-trip through a JSON scene with their settings', () => {
    const w = world(), wall = anchor(w);
    const arm = bar(w, 1, 0, 1, 30), box = bar(w, 3, 0, 0.5, 10);
    w.addJoint(new P.RevoluteJoint({ bodyA: wall, bodyB: arm, worldAnchor: { x: 0, y: 0 }, lowerAngle: -0.5, upperAngle: 0.25, motorSpeed: 1, maxMotorTorque: 50, stiffness: 10, damping: 1 }));
    w.addJoint(new P.PrismaticJoint({ bodyA: arm, bodyB: box, worldAnchor: { x: 2.5, y: 0 }, worldAxis: { x: 1, y: 0 }, upperTranslation: 0.4, motorForce: 75 }));
    w.addJoint(new P.WeldJoint({ bodyA: wall, bodyB: box, worldAnchor: { x: 3, y: 0 }, linearStiffness: 900, linearDamping: 9, angularStiffness: 400 }));
    w.addJoint(new P.MouseJoint({ body: box, target: { x: 3, y: 1 }, maxForce: 300 }));
    const B = P.fromScene(JSON.stringify(P.toScene(w)));
    const [r, p, wd, m] = B.joints;
    ok(r.enableLimit && r.lowerAngle === -0.5 && r.upperAngle === 0.25 && r.maxMotorTorque === 50 && r.stiffness === 10, 'revolute');
    ok(p.upperTranslation === 0.4 && p.lowerTranslation === -Infinity && p.motorForce === 75 && !p.enableMotor, 'prismatic');
    ok(wd.linearStiffness === 900 && wd.angularStiffness === 400, 'weld');
    ok(m.type === 'mouse' && m.bodyB === B.bodies[2] && m.maxForce === 300 && m.target.y === 1, 'mouse');
    for (let i = 0; i < 60; i++) { w.step(1 / 60); B.step(1 / 60); }
    ok(Math.abs(w.bodies[2].c.x - B.bodies[2].c.x) < 1e-12, 'replay should match');
  });
});

suite('physics E04: builds nobody planned stay stable', () => {
  function speeds(w) { let v = 0; w.bodies.forEach(b => { v = Math.max(v, M.len(b.v) + Math.abs(b.w)); }); return v; }
  function floorWorld() {
    const w = world();
    w.add(new P.Body({ type: 'static', position: { x: 0, y: -0.5 }, shapes: [P.box(60, 0.5)] }));
    return w;
  }

  test('a 1 kg box pinned through a long lever to a 3000 kg box: no blow-up in 10 s', () => {
    // Pin halfway between them: 2.5 m lever on each side, mass ratio 3000.
    [true, false].forEach(block => {
      const w = floorWorld(); w.jointBlockSolve = block;
      const big = w.add(new P.Body({ position: { x: 0, y: 2 }, shapes: [P.box(0.5, 0.5)], mass: 3000 }));
      const small = w.add(new P.Body({ position: { x: 5, y: 2 }, shapes: [P.box(0.1, 0.1)], mass: 1 }));
      w.addJoint(new P.RevoluteJoint({ bodyA: big, bodyB: small, worldAnchor: { x: 2.5, y: 2 } }));
      let peak = 0;
      w.run(10, 1 / 60, () => { peak = Math.max(peak, speeds(w)); });
      ok(isFinite(peak) && peak < 30, (block ? 'group' : 'plain') + ' solve: peak speed ' + peak);
    });
  });

  test('two pins between the same pair (over-constrained, as a weld): no blow-up, the pair holds together', () => {
    [[0.5, 3], [0.7, 3.1]].forEach(second => {
      const w = floorWorld();
      const A = w.add(new P.Body({ position: { x: 0, y: 3 }, shapes: [P.box(0.5, 0.2)], mass: 10 }));
      const B = w.add(new P.Body({ position: { x: 1, y: 3 }, shapes: [P.box(0.5, 0.2)], mass: 10 }));
      const j1 = w.addJoint(new P.RevoluteJoint({ bodyA: A, bodyB: B, worldAnchor: { x: 0.5, y: 3 } }));
      const j2 = w.addJoint(new P.RevoluteJoint({ bodyA: A, bodyB: B, worldAnchor: { x: second[0], y: second[1] } }));
      const gapNow = () => Math.max(M.dist(j1.anchorA(), j1.anchorB()), M.dist(j2.anchorA(), j2.anchorB()));
      let peak = 0, gap = 0;
      w.run(10, 1 / 60, () => { peak = Math.max(peak, speeds(w)); gap = Math.max(gap, gapNow()); });
      ok(isFinite(peak) && peak < 15, 'peak speed ' + peak);
      // landing from 3 m opens the pins for a moment (a single pin does the same)
      ok(gap < 0.02, 'pins opened by ' + (gap * 1000).toFixed(1) + ' mm on landing');
      ok(gapNow() < 0.001, 'pins still open by ' + (gapNow() * 1000).toFixed(2) + ' mm at rest');
    });
  });

  test('a light box welded far out between heavy ones (a star of long welds) settles without gaining energy', () => {
    // high enough that no box starts inside the floor
    const w = floorWorld();
    const hub = w.add(new P.Body({ position: { x: 0, y: 5 }, shapes: [P.box(0.1, 0.1)], mass: 1 }));
    for (let i = 0; i < 5; i++) {
      const a = 2 * Math.PI * i / 5, p = { x: 4 * Math.cos(a), y: 5 + 4 * Math.sin(a) };
      const b = w.add(new P.Body({ position: p, shapes: [P.box(0.3, 0.3)], mass: 2000 }));
      w.addJoint(new P.WeldJoint({ bodyA: hub, bodyB: b, worldAnchor: M.lerp(hub.c, p, 0.5) }));
    }
    const E = () => w.bodies.reduce((e, b) => b.type === 'dynamic' ? e + b.kineticEnergy() + b.m * g * b.c.y : e, 0);
    const E0 = E(); let Emax = E0, peak = 0;
    w.run(8, 1 / 60, () => { Emax = Math.max(Emax, E()); peak = Math.max(peak, speeds(w)); });
    ok(isFinite(peak) && peak < 20, 'peak speed ' + peak);
    ok(Emax <= E0 + 0.01 * Math.abs(E0) + 1, 'energy rose from ' + E0.toFixed(0) + ' to ' + Emax.toFixed(0) + ' J');
  });

  test('a 20 kN ram on a 1 kg part stops accelerating at its stroke speed (maxRamSpeed)', () => {
    const w = world({ gravity: { x: 0, y: 0 } });
    const a = w.add(new P.Body({ position: { x: 0, y: 0 }, shapes: [{ shape: P.box(0.2, 0.2), sensor: true }], mass: 1 }));
    const b = w.add(new P.Body({ position: { x: 1, y: 0 }, shapes: [{ shape: P.box(0.2, 0.2), sensor: true }], mass: 1 }));
    const ram = w.addJoint(new P.PrismaticJoint({ bodyA: a, bodyB: b, worldAnchor: { x: 0.5, y: 0 }, worldAxis: { x: 1, y: 0 }, motorForce: 20000, maxRamSpeed: 1.5 }));
    let peak = 0;
    w.run(2, 1 / 60, () => { peak = Math.max(peak, ram.speed()); });
    ok(peak < 1.5 * 1.02, 'ram speed ' + peak);
  });
});
