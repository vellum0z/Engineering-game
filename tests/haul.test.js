'use strict';
const { suite, test, eq, near, ok } = require('./harness');
const H = SE.physics.haul;
const LB = 4.448;

// Default lifting yard: hand truck 600 lb = 2668.8 N, pallet jack 5000 lb = 22 240 N,
// forklift 8000 lb = 35 584 N, crane 50 000 lb = 222 400 N.
const yard = [
  { id: 'crane', name: 'crane', rating: 50000 * LB, kind: 'crane', cost: 'burned 2 days of fuel' },
  { id: 'hand', name: 'hand truck', rating: 600 * LB, kind: 'handtruck' },
  { id: 'fork', name: 'forklift', rating: 8000 * LB, kind: 'forklift' },
  { id: 'jack', name: 'pallet jack', rating: 5000 * LB, kind: 'palletjack' }
];

function runHeadless(params, cfg, maxT) {
  const scene = new SE.scenes.haul();
  scene.init({ shake() {}, burst() {}, flash() {} }, params);
  scene.resize(800, 500);
  scene.run(cfg);
  const dt = 1 / 240;
  for (let t = 0; t < (maxT || 30) && !scene.result; t += dt) scene.step(dt);
  return scene;
}

suite('haul: pick', () => {
  test('smallest rating at least the claim, regardless of list order', () => {
    eq(H.pick(yard, 3000).id, 'jack');
    eq(H.pick(yard, 2000).id, 'hand');
  });
  test('a rating equal to the claim is enough', () => eq(H.pick(yard, 600 * LB).id, 'hand'));
  test('claim bigger than the yard gets the biggest kit', () => eq(H.pick(yard, 1e9).id, 'crane'));
  test('no usable figure or empty yard gives null', () => {
    eq(H.pick(yard, NaN), null);
    eq(H.pick(yard, undefined), null);
    eq(H.pick([], 5), null);
  });
  test('negative claim takes the smallest', () => eq(H.pick(yard, -10).id, 'hand'));
});

suite('haul: evaluate outcomes', () => {
  const W = 3000 * LB; // 13 344 N true load
  test('right figure: pallet jack at 60 % of rating', () => {
    const r = H.evaluate(yard, W, W);
    eq(r.outcome, 'ok'); eq(r.chosen.id, 'jack');
    near(r.utilization, 0.6, 1e-12);            // 3000 lb / 5000 lb
  });
  test('underestimate puts 5x the rating on the hand truck', () => {
    const r = H.evaluate(yard, 2000, W);
    eq(r.outcome, 'overloaded'); eq(r.chosen.id, 'hand');
    near(r.utilization, 5, 1e-12);              // 3000 lb / 600 lb
  });
  test('wild overestimate brings the crane: oversized with its cost', () => {
    const r = H.evaluate(yard, 40000, W);
    eq(r.outcome, 'oversized'); eq(r.chosen.id, 'crane'); eq(r.ideal.id, 'jack');
    near(r.ratio, 50000 / 3000, 1e-12);
    eq(r.cost, 'burned 2 days of fuel');
  });
  test('modest overestimate (forklift, 2.67x) is still ok', () => {
    const r = H.evaluate(yard, 30000, W);
    eq(r.chosen.id, 'fork'); eq(r.outcome, 'ok');
  });
  test('safety factor lets a 10 % overload survive', () => {
    const o = [{ id: 'a', name: 'a', rating: 100 }, { id: 'b', name: 'b', rating: 1000 }];
    eq(H.evaluate(o, 90, 110).outcome, 'overloaded');
    eq(H.evaluate(o, 90, 110, { safety: 1.25 }).outcome, 'ok');   // capacity 125 >= 110
  });
  test('not oversized when nothing smaller would have done', () => {
    const o = [{ id: 'big', name: 'big', rating: 1000 }];
    eq(H.evaluate(o, 100, 100).outcome, 'ok');
  });
  test('oversized cost falls back to a generic note', () => {
    const o = [{ id: 's', name: 'small', rating: 10 }, { id: 'L', name: 'large', rating: 100 }];
    const r = H.evaluate(o, 50, 10);
    eq(r.outcome, 'oversized'); ok(/large.*small/.test(r.cost));
  });
  test('no figure: crew takes the smallest', () => {
    const r = H.evaluate(yard, NaN, W);
    ok(r.fallback); eq(r.chosen.id, 'hand'); eq(r.outcome, 'overloaded');
  });
});

suite('haul: beam physics', () => {
  test('midspan influence: 1 at centre, a(3L²-4a²)/L³ off centre, symmetric', () => {
    near(H.midspanInfluence(0.5), 1);
    near(H.midspanInfluence(0.25), 0.6875);     // 0.25 * (3 - 0.25)
    near(H.midspanInfluence(0.75), 0.6875);
    eq(H.midspanInfluence(0), 0);
  });
  test('collapse position for twice the capacity: (1 - √0.5)/2 = 0.14645', () => {
    near(H.collapsePosition(2), 0.1464466, 1e-6);
    near(H.momentDemand(2, H.collapsePosition(2)), 1, 1e-12);
    eq(H.collapsePosition(1), null);
    eq(H.collapsePosition(0.5), null);
  });
  test('forklift tip: g(u-1)/(ua+b) = 9.81/3.4 for u=2, a=1.2, b=1', () => {
    near(H.tipAccel(2, 1.2, 1, 9.81), 9.81 / 3.4, 1e-12);
    eq(H.tipAccel(0.9, 1.2, 1, 9.81), 0);
  });
});

suite('haul: scene runs headless', () => {
  test('bridge holds with the right figure', () => {
    const s = runHeadless({ mode: 'bridge' }, { claimed: 90e3, trueValue: 90e3 });
    eq(s.result.outcome, 'ok'); eq(s.result.detail.chosen.id, 'county');
    near(s.result.detail.utilization, 0.6, 1e-12);   // 90 / 150 kN
  });
  test('bridge collapses where 4ξ(1-ξ)u = 1', () => {
    // footbridge 20 kN under 90 kN: u = 4.5, ξ = (1 - √(1 - 1/4.5))/2 = 0.05904
    const s = runHeadless({ mode: 'bridge' }, { claimed: 15e3, trueValue: 90e3 });
    eq(s.result.outcome, 'overloaded'); eq(s.result.detail.chosen.id, 'foot');
    near(s.result.detail.failedAt, 0.05904, 0.02);
  });
  test('bridge oversized: dam detour', () => {
    const s = runHeadless({ mode: 'bridge' }, { claimed: 1e6, trueValue: 90e3 });
    eq(s.result.outcome, 'oversized'); eq(s.result.detail.chosen.id, 'dam');
    ok(/fuel/.test(s.result.detail.cost));
  });
  test('lift: forklift tips, hand truck buckles, jack ok', () => {
    const W = 3000 * LB;
    eq(runHeadless({ mode: 'lift' }, { claimed: W, trueValue: W }).result.outcome, 'ok');
    const b = runHeadless({ mode: 'lift' }, { claimed: 500 * LB, trueValue: W });
    eq(b.result.outcome, 'overloaded'); eq(b.result.detail.mechanism, 'buckled');
    const t = runHeadless({ mode: 'lift' }, { claimed: 6000 * LB, trueValue: 12000 * LB });
    eq(t.result.outcome, 'overloaded'); eq(t.result.detail.mechanism, 'tipped');
  });
  test('axle snaps when the load passes the rating', () => {
    // utility trailer 3500 lb under 5000 lb: snaps at 70 % of the load transferred
    const s = runHeadless({ mode: 'axle' }, { claimed: 3000 * LB, trueValue: 5000 * LB });
    eq(s.result.outcome, 'overloaded'); eq(s.result.detail.chosen.id, 'util');
    near(s.result.detail.failedAt, 0.7, 0.01);
    eq(runHeadless({ mode: 'axle' }, { claimed: 2000 * LB, trueValue: 2000 * LB }).result.outcome, 'ok');
  });
  test('mass quantity works with custom options', () => {
    const o = [{ id: 'a', name: 'cart', rating: 200, kind: 'cart' }, { id: 'b', name: 'trailer', rating: 900, kind: 'trailer' }];
    const s = runHeadless({ mode: 'axle', quantity: 'mass', options: o }, { claimed: 150, trueValue: 180 });
    eq(s.result.outcome, 'ok'); near(s.result.detail.utilization, 0.9, 1e-12);
  });
  test('controls and set', () => {
    const s = new SE.scenes.haul();
    s.init({ shake() {}, burst() {}, flash() {} }, { mode: 'lift' });
    const c = s.controls();
    eq(c[0].key, 'claimed'); eq(c[0].unit, 'kN');
    s.set('claimed', 2); near(s.p.claimed, 2000);
    ok(s.readouts().length >= 4);
  });
});
