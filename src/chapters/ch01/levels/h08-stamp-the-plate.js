/*
 * H8 · Stamp the Plate: SI prefixes (Table 1–3) and the rules for using
 * them. Course section 1.4 (prefixes, rules for use) and the worked example
 * on prefixed products and quotients.
 *
 * The device: the depot's salvaged port-crane controller reads the label on
 * a plate literally. It parses prefix and unit exactly as stamped, converts
 * to base units and drives the winch governor with that number. In strict
 * mode its firmware also refuses any label that breaks the SI rules, and a
 * refused label means the winch never starts.
 */
(function (SE) {
  'use strict';
  var U = SE.units, S = SE.sigfig;

  var G = 9.81;
  // The generator on the hook. Its weight is the number on its plate, so the
  // governor holds it exactly when the controller reads 2.45 kN.
  var GEN_W = 2450;                    // N
  var RATING = 12000;                  // N, the gantry cable
  var GEN = { mass: GEN_W / G, g: G, label: 'generator', rating: RATING, mode: 'hover', hookHeight: 4, height: 9, zombies: 4 };
  function HOIST(extra) { return { type: 'hoist', params: Object.assign({}, GEN, extra || {}) }; }

  function sig(x, n) { return S.roundSig(x, n || 3).text; }
  function kN(N) { return Math.abs(N) >= 1e6 ? sig(N / 1e6) + ' MN' : Math.abs(N) >= 1e3 ? sig(N / 1e3) + ' kN' : Math.abs(N) >= 1 ? sig(N) + ' N' : sig(N * 1e3) + ' mN'; }

  // How the controller reads a label: "2.45 kN" -> 2.45 kN = 2450 N.
  function echo(q) {
    var s = q.number.mantissa + (q.number.hasExp ? '(10' + S.supNum(q.number.exp10) + ')' : '') + ' ' + U.formatFactors(q.unit.factors);
    var si = U.dimsEqual(q.dims, U.unitInfo('N').dims) ? 'N' : U.dimsToSI(q.dims);
    return '`' + s + '`' + (si ? ' = ' + sig(q.value, 4) + ' ' + si : '');
  }

  // Read one plate the way the controller does. In strict mode the firmware
  // applies the SI rules (one prefix, none in a denominator, powers of 1000,
  // number between 0.1 and 1000) and halts on the first one broken.
  function readPlate(text, strict, wantDims) {
    var q = U.parseQuantity(text);
    if (!q.ok) return { ok: false, halt: 'could not parse the label (' + q.error + ')' };
    if (wantDims && !U.dimsEqual(q.dims, wantDims)) return { ok: false, q: q, halt: 'the label is not a force (' + (U.dimsName(q.dims) || U.dimsToSI(q.dims)) + ')' };
    var issues = strict ? U.checkSIForm(q) : [];
    return { ok: !issues.length, q: q, si: q.value, halt: issues.length ? issues[0].msg : null };
  }

  /* ------------------------------------------------------------ the crane */

  // Hang the generator with governor tension T and describe what the
  // physics did.
  function hold(ctx, T, note) {
    var s = ctx.setScene('hoist', Object.assign({}, GEN));
    var run = s.run(T, { duration: 5 });
    // The generator is already hanging on the cable, so the governor steps
    // straight from the weight to the new set point. The scene's 0.3 s
    // take-up ramp starts from zero tension, which would let a correctly
    // set load sag for a moment; starting the clock past the ramp skips it.
    s.time = 0.3;
    return run.then(function (r) {
      var d = r.detail, pre = note ? note + ' ' : '';
      var hit = function (v) { return Math.abs(v) > 100 ? 'over 100 m/s' : Math.abs(v).toFixed(1) + ' m/s'; };
      if (r.outcome === 'snapped') return pre + 'The governor pulled **' + kN(T) + '** on a cable rated ' + kN(RATING) + '. It parted at the drum and the generator fell 4 m, hitting the slab at **' + hit(d.impact) + '**.';
      if (r.outcome === 'slammed') return pre + 'Line pull **' + kN(T) + '** against a weight of ' + kN(GEN_W) + ': net ' + kN(T - GEN_W) + ' upward. The generator shot up and hit the gantry head at **' + hit(d.impact) + '**.';
      if (r.outcome === 'dropped') return pre + 'Line pull **' + kN(T) + '** against a weight of ' + kN(GEN_W) + '. That cannot carry the weight, so it came down and hit the slab at **' + hit(d.impact) + '**.';
      if (r.outcome === 'held' || Math.abs(d.v) < 0.02) return pre + 'Line pull ' + kN(T) + ' equals the weight, so a = 0: the generator **hangs still at 4 m** for the crew.';
      return pre + 'Line pull ' + kN(T) + ': the generator is creeping at ' + d.v.toFixed(2) + ' m/s.';
    });
  }

  // Strict firmware refused a label: the winch never takes up the cable.
  // Run it with zero tension and report how far the dead walked meanwhile.
  function halt(ctx, why, label) {
    var s = ctx.setScene('hoist', Object.assign({}, GEN, { mode: 'lift', zombies: 5 }));
    return s.run(0, { duration: 3 }).then(function () {
      var near = Math.max.apply(null, s.zombieX);
      var walked = 0.12 * s.time;               // the scene's shuffle speed, m/s
      var gap = 7.5 - Math.min(near, 1.5);
      return '**FIRMWARE HALT** on `' + label + '`: ' + why + ' The winch never started. The generator sat on the slab for ' + s.time.toFixed(1) + ' s while the nearest of the dead shuffled ' + walked.toFixed(2) + ' m closer, now ' + gap.toFixed(1) + ' m from the gantry.';
    });
  }

  /*
   * Shared consequence for plate tasks. Each item is { key, trueSI }. The
   * controller builds its governor set point from every plate, so a plate's
   * read-to-true ratio scales the line pull by the same factor.
   *   a label the firmware refuses -> halt (the winch stalls);
   *   a misread value -> the hoist runs with W times the worst ratio;
   *   all good -> the generator hangs at 4 m.
   */
  function controller(ctx, a, items) {
    var refused = null, worst = null;
    items.forEach(function (it) {
      var ans = a[it.key], r = ans.result;
      var label = (r.input || '').trim() || '(blank)';
      if (refused) return;
      if (!r.parsed || !r.parsed.ok) { refused = { why: 'it could not parse that label.', label: label }; return; }
      if (!r.parts.units) { refused = { why: 'the units are the wrong kind of quantity (' + (U.dimsName(r.parsed.dims) || U.dimsToSI(r.parsed.dims)) + ').', label: label }; return; }
      var bad = r.errors.filter(function (e) { return e.kind === 'form'; })[0];
      if (bad) { refused = { why: bad.msg, label: label }; return; }
      if (!r.parts.value) {
        var ratio = ans.si / it.trueSI;
        if (!worst || Math.abs(Math.log(Math.abs(ratio))) > Math.abs(Math.log(Math.abs(worst.ratio)))) worst = { ratio: ratio, label: label, read: echo(r.parsed) };
      }
    });
    if (refused) return halt(ctx, refused.why, refused.label);
    if (worst) return hold(ctx, GEN_W * Math.abs(worst.ratio), 'The controller read ' + worst.read + ', which is **×' + sig(Math.abs(worst.ratio)) + '** the intended value, and that factor went straight into the line pull.');
    return hold(ctx, GEN_W, 'Every plate read as intended and the firmware accepted them all.');
  }

  // One lenient-mode plate on the generator's governor (the try step).
  function stampAndRun(ctx, label, noCount) {
    var p = readPlate(label, false, U.unitInfo('N').dims);
    if (!noCount) ctx.runner._h8plates = (ctx.runner._h8plates || 0) + 1;
    if (!p.ok) return halt(ctx, p.halt + '.', label);
    var msg = 'Plate `' + label + '` reads as ' + echo(p.q) + '.';
    return hold(ctx, p.si, msg).then(function (m) {
      if (Math.abs(p.si - GEN_W) < 1e-6 * GEN_W) ctx.runner._h8held = true;
      return m;
    });
  }

  // Same, with the strict firmware on (the sandbox).
  function stampStrict(ctx, label) {
    var p = readPlate(label, true, U.unitInfo('N').dims);
    if (!p.ok) return halt(ctx, /\.$/.test(p.halt) ? p.halt : p.halt + '.', label);
    return hold(ctx, p.si, 'Plate `' + label + '` reads as ' + echo(p.q) + ' and passes the firmware.');
  }

  /* ----------------------------------------------------- the answer keys */

  // H8.keep-digits: restamp the crate plates, keeping every digit.
  var KD_TIME = 7246e-3;   // 7246 ms = 7.246 s (4 s.f.)
  var KD_LOAD = 6359;      // 6359 N = 6.359 kN (4 s.f.)
  var KD_HOOK = 0.712;     // 0.712 kg = 712 g (3 s.f.)

  // H8.combos: unit combinations, each written as "1 <unit>" so the value is
  // fixed and only the form is in play.
  var C_RAMP = 1e6 / 1e3;           // 1 MN/ks = 10^3 N/s = 1 kN/s
  var C_GAIN = 1e-3 / (1 * 1e-9);   // 1 mN/(kg·ns) = 10^6 N/(kg·s) = 1 MN/(kg·s)
  var C_STIFF = 1e3 / 1e-3;         // 1 kN/mm = 10^6 N/m = 1 MN/m
  var C_ARM = 1e6 * 1e-6;           // 1 Mm·mg = 10^6 m · 10^-6 kg = 1 m·kg
  var C_GAP = 1e-9 * 1e3;           // 1 nkm = 10^-9 · 10^3 m = 10^-6 m = 1 μm

  // H8.prefix-range: one prefix, number between 0.1 and 1000.
  var R_BOLLARD = 38470e3;          // 38 470 kN = 38.47 MN -> 38.5 MN
  var R_RUN = 734e4 * 1e-3;         // 734(10^4) mm = 7.34(10^3) m = 7.34 km
  var R_DRIFT = 0.00872e-6;         // 0.008 72 mg = 8.72(10^-9) kg = 8.72 μg
  var R_SHIM = 0.000276;            // 0.000 276 kg = 0.276 g (or 276 mg)

  // H8.ex13: prefixed products and quotients (3 s.f.).
  var EX_A = (45e-3) * (7e9);               // (45 mN)(7 GN) = 315(10^6) N^2 = 315 kN^2
  var EX_B = (250e-3) * Math.pow(0.4e6, 2); // (250 mm)(0.4 MN)^2 = 0.25 m · 0.16(10^12) N^2 = 40.0(10^9) m·N^2 = 40.0 Gm·N^2
  var EX_C = 48 * 1e18 / (750e9 * 1e-3);    // 48 MN^3 / 750 Gg = 48(10^18) N^3 / 750(10^6) kg = 64.0(10^9) N^3/kg = 64.0 kN^3/kg

  SE.content.registerLevel('ch01', {
    id: 'H8', order: 8, title: 'Stamp the Plate',
    subtitle: 'Prefixes and the rules for using them',
    sections: ['1.4'],
    minutes: 25,
    intro: [
      'The crew dragged a crane controller out of a drowned container port. It still works, and it is very literal: it reads the label stamped on a plate, letter for letter, converts it to base units and drives the winch with that number.',
      'Hask taps the plate on the generator. "This box doesn\'t guess what you meant. It reads what you **wrote**. So we\'re going to learn to write it properly."'
    ].join('\n\n'),
    goals: [
      'Know the sizes of G, M, k, m, μ and n, and move a decimal point three places per prefix',
      'Apply the SI rules: dots between units, exponents on prefixed units, no prefix in a denominator (kg excepted)',
      'Work a calculation in base units and powers of 10, then re-express it with one prefix and a number between 0.1 and 1000'
    ],
    scene: HOIST(),
    proveIt: [
      {
        id: 'H8.prove-range', text: 'Restamp each with one SI prefix and a number between 0.1 and 1000: **0.006 18 km** and **42.1(10³) N**.',
        inputs: [
          // 0.006 18 km = 0.006 18(10^3) m = 6.18 m
          { key: 'L', label: '0.006 18 km', placeholder: 'e.g. 6.18 m', spec: { value: 0.00618e3, unit: 'm', sf: 3, form: 'si' }, answer: '6.18 m', wrong: [{ input: '6.18 km', kind: 'prefix' }] },
          // 42.1(10^3) N = 42.1 kN
          { key: 'F', label: '42.1(10³) N', placeholder: 'e.g. 42.1 kN', spec: { value: 42.1e3, unit: 'N', sf: 3, form: 'si' }, answer: '42.1 kN' }
        ]
      },
      {
        id: 'H8.prove-combo', text: 'Rewrite each in correct SI form (the number stays 1): **1 MN·nm** and **1 Gg/km**.',
        inputs: [
          // 1 MN·nm = 10^6 N · 10^-9 m = 10^-3 N·m = 1 mN·m
          { key: 'M', label: '1 MN·nm', placeholder: 'e.g. 1 mN·m', spec: { value: 1e-3, unit: 'N·m', sf: null, form: 'si' }, answer: '1 mN·m', wrong: [{ input: '1 MN·nm', kind: 'form' }] },
          // 1 Gg/km = 10^6 kg / 10^3 m = 10^3 kg/m = 1 Mg/m
          { key: 'D', label: '1 Gg/km', placeholder: 'e.g. 1 Mg/m', spec: { value: 1e3, unit: 'kg/m', sf: null, form: 'si' }, answer: '1 Mg/m', wrong: [{ input: '1 Gg/km', kind: 'form' }] }
        ]
      },
      {
        id: 'H8.prove-ex', text: 'Evaluate **(45 mN)(7 GN)** and write it with one prefix, to 3 s.f.',
        inputs: [{ key: 'P', label: '(45 mN)(7 GN)', placeholder: 'e.g. 315 kN^2', spec: { value: EX_A, unit: 'N^2', sf: 3, form: 'si' }, answer: '315 kN^2' }]
      }
    ],
    steps: [
      /* ------------------------------------------------ prefixes */
      {
        type: 'predict', who: 'hask',
        q: 'The generator weighs **2.45 kN**, and the governor holds whatever tension the plate says. Somebody tired stamped the plate **2.45 MN**.\n\nThe cable is rated 12 kN. What happens when the controller hangs the generator?',
        choices: [
          { t: 'It hangs still. 2.45 is 2.45.', why: 'The controller reads the M as mega: 2.45(10⁶) N, a thousand times the weight. Watch the cable.' },
          { t: 'It sinks slowly to the slab.', why: 'That would need a tension below the weight. The M made it a thousand times above.' },
          { t: 'The winch rips it straight up into the gantry.', correct: true, why: 'Right. One letter is a factor of 1000: 2.45 MN = 2 450 000 N of line pull on a 2450 N generator. The 12 kN cable would part too, if the load didn\'t hit the gantry head first.' }
        ],
        run: function (ctx) { return stampAndRun(ctx, '2.45 MN', true); },
        reveal: 'A prefix is a multiplier, and the controller applies it faithfully. **M** is 10⁶ and **k** is 10³, so swapping one for the other is a factor of a thousand in the line pull.'
      },
      {
        type: 'reveal', kicker: 'Table 1–3', title: 'SI prefixes',
        eq: '4\\ 000\\ 000\\ \\u{N} = 4000\\ \\u{kN} = 4\\ \\u{MN}',
        table: { head: ['Multiple', 'Exponential', 'Prefix', 'Symbol'], rows: [['1 000 000 000', '10⁹', 'giga', 'G'], ['1 000 000', '10⁶', 'mega', 'M'], ['1 000', '10³', 'kilo', 'k'], ['0.001', '10⁻³', 'milli', 'm'], ['0.000 001', '10⁻⁶', 'micro', 'μ'], ['0.000 000 001', '10⁻⁹', 'nano', 'n']] },
        text: 'When a number gets very large or very small, a **prefix** on the unit carries the size instead. Each step in the table is a factor of 1000, so each one moves the decimal point **three places**: 7 000 000 N = 7000 kN = 7 MN, and 0.003 m = 3 mm.\n\nThe metric system also has **deca** (10) and **centi** (0.01), but SI practice in engineering avoids them, apart from a few area and volume measurements (you will still see cm² on old drawings).\n\nOne oddity: the **kilogram** is the only base unit whose name already carries a prefix. The gram is the thing the prefixes attach to, so 1000 kg is a **megagram**, Mg, not a "kilo-kilogram".',
        formula: 'ch01.table-prefix'
      },
      {
        type: 'try', who: 'hask',
        scene: HOIST(),
        text: 'The firmware is in its lenient service mode for now: it reads any label. Stamp a few plates for the 2.45 kN generator and watch what the governor does with each one. Find at least one that holds it, and try ones that don\'t.',
        controls: [],
        goalText: 'Run three plates, at least one of which holds the generator still',
        goal: function (ctx) { return (ctx.runner._h8plates || 0) >= 3 && !!ctx.runner._h8held; },
        actions: [
          { label: 'Stamp 2.45 kN', run: function (ctx) { return stampAndRun(ctx, '2.45 kN'); } },
          { label: 'Stamp 2450 N', run: function (ctx) { return stampAndRun(ctx, '2450 N'); } },
          { label: 'Stamp 2.45 N', run: function (ctx) { return stampAndRun(ctx, '2.45 N'); } },
          { label: 'Stamp 2 450 000 mN', run: function (ctx) { return stampAndRun(ctx, '2 450 000 mN'); } },
          { label: 'Stamp 0.002 45 MN', run: function (ctx) { return stampAndRun(ctx, '0.002 45 MN'); } }
        ],
        after: 'Four of those labels are the **same force** written four ways: 2.45 kN, 2450 N, 2 450 000 mN and 0.002 45 MN all hold the generator. Only the one with the wrong size dropped it. Some of those labels are still ugly, though, and the firmware has opinions about that. More soon.'
      },
      {
        type: 'classify', id: 'H8.prefix-size',
        text: 'Each salvaged plate has a prefix. What power of ten does the prefix stand for?',
        bins: ['10⁹', '10⁶', '10³', '10⁻³', '10⁻⁶', '10⁻⁹'],
        items: [
          { t: 'Dock winch rated pull: 0.8 **M**N', bin: '10⁶', why: 'mega, M = 10⁶. So 0.8 MN = 800 000 N.' },
          { t: 'Drum brake force: 3.2 **k**N', bin: '10³', why: 'kilo, k = 10³. So 3.2 kN = 3200 N.' },
          { t: 'Old port gantry design load: 1.2 **G**N', bin: '10⁹', why: 'giga, G = 10⁹.' },
          { t: 'Brake dwell: 250 **m**s', bin: '10⁻³', why: 'milli, m = 10⁻³. So 250 ms = 0.250 s.' },
          { t: 'Strain gauge drift: 40 **μ**m', bin: '10⁻⁶', why: 'micro, μ = 10⁻⁶.' },
          { t: 'Coating thickness on the drum: 90 **n**m', bin: '10⁻⁹', why: 'nano, n = 10⁻⁹.' }
        ]
      },
      {
        type: 'task', id: 'H8.keep-digits', who: 'juno',
        title: 'Restamp the crate plates',
        text: 'Juno\'s crew is moving three crates and wants the plates in sensible units. Restamp each with a prefix that moves the decimal point three places, **keeping every digit** that was measured.\n\n- Brake dwell: **7246 ms**, restamp in seconds\n- Load on the pallet: **6359 N**, restamp in kilonewtons\n- Hook block: **0.712 kg**, restamp in grams\n\nThe crew reads the load plate to pick their lifting kit.',
        inputs: [
          // 7246 ms = 7246(10^-3) s = 7.246 s, 4 s.f. as measured
          { key: 't', label: 'Brake dwell (s)', placeholder: 'e.g. 7.246 s', spec: { value: KD_TIME, unit: 's', sf: 4, form: 'si', expressIn: 's' }, answer: '7.246 s', wrong: [{ input: '7.25 s', kind: 'sigfig' }, { input: '7.246 ks', kind: 'prefix' }] },
          // 6359 N = 6359(10^-3) kN = 6.359 kN
          { key: 'F', label: 'Load (kN)', placeholder: 'e.g. 6.359 kN', spec: { value: KD_LOAD, unit: 'N', sf: 4, form: 'si', expressIn: 'kN' }, answer: '6.359 kN', wrong: [{ input: '6.359 MN', kind: 'prefix' }, { input: '6.36 kN', kind: 'sigfig' }] },
          // 0.712 kg = 0.712(10^3) g = 712 g, 3 s.f.
          { key: 'm', label: 'Hook block (g)', placeholder: 'e.g. 712 g', spec: { value: KD_HOOK, unit: 'kg', sf: 3, form: 'si', expressIn: 'g' }, answer: '712 g', wrong: [{ input: '712 kg', kind: 'prefix' }] }
        ],
        hints: [
          'Each prefix step is three decimal places. Going from a smaller unit to a bigger one, the number gets smaller.',
          'ms to s: divide by 1000. N to kN: divide by 1000. kg to g: multiply by 1000. Write every digit you started with.',
          '7246 ms = 7.246 s. 6359 N = 6.359 kN. 0.712 kg = 712 g.'
        ],
        consequence: function (ctx, a) {
          var claimed = a.F.si;
          var s = ctx.setScene('haul', { mode: 'lift', quantity: 'force', trueValue: KD_LOAD, claimed: claimed == null ? NaN : claimed, label: 'pallet' });
          return s.run({ claimed: claimed == null ? NaN : claimed, trueValue: KD_LOAD }).then(function (r) {
            var d = r.detail, kit = d.chosen ? d.chosen.name : 'nothing';
            var plate = a.F.result.parsed && a.F.result.parsed.ok ? 'The crew read your plate as ' + echo(a.F.result.parsed) + ' and took the **' + kit + '**.' : 'The crew could not read the plate and grabbed the **' + kit + '**.';
            if (r.outcome === 'overloaded') return plate + ' The real load is 6.36 kN, ' + Math.round(d.utilization * 100) + '% of its rating. It buckled under the pallet.';
            if (r.outcome === 'oversized') return plate + ' It lifted the 6.36 kN pallet easily, but the crew ' + d.cost + '.';
            return plate + ' The 6.36 kN pallet sits at ' + Math.round(d.utilization * 100) + '% of its rating. Lifted clean.';
          });
        },
        explain: 'Changing the prefix moves the decimal point, nothing else. The digits that were measured stay, so 7246 ms keeps all four of them as 7.246 s.'
      },
      {
        type: 'sandbox', scene: { type: 'haul', params: { mode: 'lift', quantity: 'force', trueValue: KD_LOAD, claimed: KD_LOAD, label: 'pallet' } },
        text: 'The crew picks kit from whatever figure is on the plate. Slide **your figure** to 1000× too small, or 1000× too big, and watch what a slipped prefix costs. Then change the true load.',
        controls: ['claimed', 'trueValue', 'safety'],
        prompts: ['Set your figure to 0.006 kN (a kN plate read as N). What does the crew take?', 'Set it to 6359 kN (an N plate read as kN). It works, but what does it cost?', 'Is there a figure that is wrong but harmless?']
      },

      /* ------------------------------------------------ rules for use */
      {
        type: 'predict', who: 'hask',
        scene: HOIST(),
        q: 'A plate on the drum brake reads **250 ms**. The stamper meant "metre-second", a unit some of the old drum calculations use. How does the controller read it?',
        choices: [
          { t: 'As 250 metre-seconds. It can tell from context.', why: 'It has no context. It sees an m stuck to an s, and that is the milli prefix.' },
          { t: 'As 250 milliseconds, 0.250 s.', correct: true, why: 'Right. Two symbols run together are read as a prefix and a unit. To mean a product, separate them with a dot: m·s.' },
          { t: 'It refuses the plate as ambiguous.', why: 'The label is perfectly legal. It just doesn\'t say what the stamper meant.' }
        ],
        reveal: 'Units that multiply are separated by a **dot**: **m·s** is a metre-second, **ms** is a millisecond. The same goes for N = kg·m/s² = kg·m·s⁻².'
      },
      {
        type: 'predict', who: 'hask',
        q: 'A design note gives a load-squared term as **3 mN²**. In base units, how big is that?',
        choices: [
          { t: '3(10⁻³) N², since milli is 10⁻³.', why: 'That would be milli applied to N² as a whole. The exponent applies to the prefixed unit: (mN)².' },
          { t: '3(10⁻⁶) N², since it means 3 (mN)².', correct: true, why: 'Right. mN² = (mN)² = (10⁻³ N)² = 10⁻⁶ N². Likewise mm² = (mm)², so 1 mm² = 10⁻⁶ m².' }
        ],
        reveal: 'An exponent on a prefixed unit raises the **prefix too**: mN² = (mN)² = mN·mN, and mm² = (mm)².'
      },
      {
        type: 'reveal', kicker: 'Rules for use', title: 'Writing SI properly',
        eq: '(80\\ \\u{kN})(45\\ \\u{nm}) = 3.60\\ \\u{mN·m}',
        text: '- **Dots** separate units that multiply: m·s (metre-second) vs ms (millisecond).\n- An **exponent** applies to the prefix and the unit together: mN² = (mN)², mm² = (mm)².\n- **No prefix in a denominator**, the kilogram excepted. Write kN/m, not N/mm. Write Mm/kg, not m/mg.\n- **Calculate in base units** with powers of 10, then re-express the result with **one** prefix, keeping the number **between 0.1 and 1000**.\n\nThe example above follows the last rule: write 80 kN as 80(10³) N and 45 nm as 45(10⁻⁹) m, multiply to get 3600(10⁻⁶) N·m, then pick the single prefix that brings 0.003 60 N·m into range.',
        formula: 'ch01.si-rules'
      },
      {
        type: 'predict', who: 'hask',
        scene: HOIST(),
        q: 'Hask flips the controller out of service mode and into **strict** mode, the way it ran at the port. You stamp **2450 N** on the generator, which is the right force.\n\nWhat happens now?',
        choices: [
          { t: 'It holds, like before. The value is right.', why: 'The value is right, but the firmware checks the form first. 2450 is outside 0.1 to 1000.' },
          { t: 'The firmware halts and the winch never starts.', correct: true, why: 'Right. Strict firmware refuses a label that breaks the rules, even when the number is correct. 2.45 kN would pass.' }
        ],
        run: function (ctx) { return stampStrict(ctx, '2450 N'); },
        reveal: 'A **value** error makes the crane do the wrong thing. A **form** error makes the strict firmware do nothing at all. Out here, nothing at all is also dangerous.'
      },
      {
        type: 'classify', id: 'H8.legal-labels',
        text: 'Strict firmware: will each label pass, or halt the crane?',
        bins: ['Passes', 'Halts'],
        items: [
          { t: '1 Mm/s', bin: 'Passes', why: 'One prefix, in the numerator. (1 mm/ns written properly.)' },
          { t: '1 mm/ns', bin: 'Halts', why: 'Prefix in the denominator. 10⁻³ m / 10⁻⁹ s = 10⁶ m/s = 1 Mm/s.' },
          { t: '1 Gg/MN', bin: 'Halts', why: 'Two prefixes, one in the denominator. 10⁶ kg / 10⁶ N = 1 kg/N.' },
          { t: '1 kg/N', bin: 'Passes', why: 'kg is the one prefixed unit allowed anywhere.' },
          { t: '1 μN/ms', bin: 'Halts', why: 'Prefix in the denominator. 10⁻⁶ N / 10⁻³ s = 10⁻³ N/s = 1 mN/s.' },
          { t: '1 ks/g', bin: 'Passes', why: 'One prefix, numerator. Equal to 1 s/mg = 10³ s/g, which you could also write 1 Ms/kg.' },
          { t: '1 Mm·nN', bin: 'Halts', why: 'Two prefixes. 10⁶ m · 10⁻⁹ N = 10⁻³ m·N = 1 mm·N.' },
          { t: '1 mN/s²', bin: 'Passes', why: 'One prefix, numerator. (1 kN/ks² = 10³ N / 10⁶ s² = 10⁻³ N/s².)' },
          { t: '45 cm', bin: 'Halts', why: 'centi is not used in engineering. Write 450 mm or 0.450 m.' }
        ]
      },
      {
        type: 'task', id: 'H8.combos', who: 'hask',
        title: 'Rewrite the controller\'s setup plates',
        text: 'The controller builds its line-pull set point from five setup plates. Each was stamped in a form the strict firmware refuses. Rewrite each one in correct SI form. The value is fixed by the conversion, so the number stays **1**.\n\nIf any label still breaks a rule, the firmware halts. If you change a value, that factor goes into the line pull.',
        inputs: [
          // 1 MN/ks = 10^6 N / 10^3 s = 10^3 N/s = 1 kN/s
          { key: 'ramp', label: 'Tension ramp: 1 MN/ks', placeholder: 'e.g. 1 kN/s', spec: { value: C_RAMP, unit: 'N/s', sf: null, form: 'si' }, answer: '1 kN/s', wrong: [{ input: '1 MN/ks', kind: 'form' }, { input: '1 MN/s', kind: 'prefix' }] },
          // 1 mN/(kg·ns) = 10^-3 N / (kg · 10^-9 s) = 10^6 N/(kg·s) = 1 MN/(kg·s)
          { key: 'gain', label: 'Governor gain: 1 mN/(kg·ns)', placeholder: 'e.g. 1 MN/(kg·s)', spec: { value: C_GAIN, unit: 'N/(kg·s)', sf: null, form: 'si' }, answer: '1 MN/(kg·s)', wrong: [{ input: '1 GN/(kg·s)', kind: 'prefix' }] },
          // 1 kN/mm = 10^3 N / 10^-3 m = 10^6 N/m = 1 MN/m
          { key: 'stiff', label: 'Cable stiffness: 1 kN/mm', placeholder: 'e.g. 1 MN/m', spec: { value: C_STIFF, unit: 'N/m', sf: null, form: 'si' }, answer: '1 MN/m', wrong: [{ input: '1 kN/mm', kind: 'form' }, { input: '1 N/m', kind: 'prefix' }] },
          // 1 Mm·mg = 10^6 m · 10^-6 kg = 1 m·kg
          { key: 'arm', label: 'Counterweight moment arm: 1 Mm·mg', placeholder: 'e.g. 1 m·kg', spec: { value: C_ARM, unit: 'm·kg', sf: null, form: 'si' }, answer: '1 m·kg', wrong: [{ input: '1 Mm·mg', kind: 'form' }, { input: '1 m·g', kind: 'prefix' }] },
          // 1 nkm = 10^-9 · 10^3 m = 10^-6 m = 1 μm (two stacked prefixes collapse to one)
          { key: 'gap', label: 'Brake gap: 1 nkm', placeholder: 'e.g. 1 um', spec: { value: C_GAP, unit: 'm', sf: null, form: 'si' }, answer: '1 μm', wrong: [{ input: '1 nkm', kind: 'form' }, { input: '1 mm', kind: 'prefix' }] }
        ],
        hints: [
          'Turn every prefix into its power of ten, combine them, then choose one prefix for the numerator. kg is the only prefix allowed below the line.',
          'MN/ks: 10⁶ / 10³ = 10³, so kilo. kN/mm: 10³ / 10⁻³ = 10⁶ on the N. nkm: 10⁻⁹ · 10³ = 10⁻⁶ m. Mm·mg: 10⁶ m · 10⁻³ g = 10³ g·m, and 10³ g is a kg.',
          '1 kN/s, 1 MN/(kg·s), 1 MN/m, 1 m·kg, 1 μm.'
        ],
        consequence: function (ctx, a) {
          return controller(ctx, a, [{ key: 'ramp', trueSI: C_RAMP }, { key: 'gain', trueSI: C_GAIN }, { key: 'stiff', trueSI: C_STIFF }, { key: 'arm', trueSI: C_ARM }, { key: 'gap', trueSI: C_GAP }]);
        },
        explain: 'Collapse all the prefixes into one power of ten and give it to the numerator. The kilogram is the only exception: it can sit in a denominator (N/(kg·s)) and still counts as unprefixed.'
      },
      {
        type: 'task', id: 'H8.prefix-range', who: 'juno',
        title: 'Restamp the port inventory',
        text: 'Juno wants four numbers off the port\'s inventory sheet fed to the controller. Restamp each with **one** prefix and a number **between 0.1 and 1000**, to 3 s.f.\n\n- Bollard rating: **38 470 kN**\n- Cable run: **734(10⁴) mm**\n- Load-cell drift: **0.008 72 mg**\n- Brass shim: **0.000 276 kg**',
        inputs: [
          // 38 470 kN = 38.47(10^3) kN = 38.47 MN -> 38.5 MN (first dropped digit 7 > 5, round up)
          { key: 'bollard', label: 'Bollard rating', placeholder: 'e.g. 38.5 MN', spec: { value: R_BOLLARD, unit: 'N', sf: 3, form: 'si' }, answer: '38.5 MN', wrong: [{ input: '38.5 kN', kind: 'prefix' }, { input: '0.0385 GN', kind: 'form' }, { input: '38.47 MN', kind: 'sigfig' }] },
          // 734(10^4) mm = 734(10^4)(10^-3) m = 7.34(10^3) m = 7.34 km
          { key: 'run', label: 'Cable run', placeholder: 'e.g. 7.34 km', spec: { value: R_RUN, unit: 'm', sf: 3, form: 'si' }, answer: '7.34 km', wrong: [{ input: '7.34 Mm', kind: 'prefix' }] },
          // 0.008 72 mg = 8.72(10^-3) mg = 8.72(10^-3)(10^-3) g = 8.72(10^-6) g = 8.72 μg
          { key: 'drift', label: 'Load-cell drift', placeholder: 'e.g. 8.72 ug', spec: { value: R_DRIFT, unit: 'kg', sf: 3, form: 'si' }, answer: '8.72 μg', wrong: [{ input: '0.00872 mg', kind: 'form' }, { input: '8.72 ng', kind: 'prefix' }] },
          // 0.000 276 kg = 0.276(10^-3) kg = 0.276 g (276 mg is equally legal)
          { key: 'shim', label: 'Brass shim', placeholder: 'e.g. 0.276 g', spec: { value: R_SHIM, unit: 'kg', sf: 3, form: 'si' }, answer: '0.276 g', wrong: [{ input: '0.276 kg', kind: 'prefix' }, { input: '0.000276 kg', kind: 'form' }] }
        ],
        hints: [
          'Get to base units first, as a number times a power of ten. Then pick the prefix whose power of ten leaves 0.1 to 1000 in front.',
          '38 470 kN = 38.47(10⁶) N. 734(10⁴) mm = 7.34(10³) m. 0.008 72 mg = 8.72(10⁻⁶) g. 0.000 276 kg = 0.276 g.',
          '38.5 MN, 7.34 km, 8.72 μg (type ug if you have no μ key), 0.276 g or 276 mg.'
        ],
        consequence: function (ctx, a) {
          return controller(ctx, a, [{ key: 'bollard', trueSI: R_BOLLARD }, { key: 'run', trueSI: R_RUN }, { key: 'drift', trueSI: R_DRIFT }, { key: 'shim', trueSI: R_SHIM }]);
        },
        explain: 'Base units and powers of ten first, one prefix last. 0.276 g and 276 mg are both inside the range, so both pass.'
      },
      {
        type: 'derive', title: 'Prefixed products and quotients',
        intro: 'Hask works three on the chalkboard: **(a)** (40 mN)(5 GN), **(b)** (300 mm)(0.5 MN)², **(c)** 36 MN³ / 600 Gg. Every one goes the same way: prefixes to powers of ten, compute, one prefix back.',
        lines: [
          { eq: '(40\\ \\u{mN})(5\\ \\u{GN}) = 200(10^{6})\\ \\u{N^2}', why: '(a) Write 40 mN = 40(10⁻³) N and 5 GN = 5(10⁹) N. Multiply the numbers and add the exponents: −3 + 9 = 6.' },
          { eq: '200(10^{6})\\ \\u{N^2} = 200\\ (10^{3}\\ \\u{N})^{2} = 200\\ \\u{kN^2}', why: 'A prefix on a squared unit is squared too, so 10⁶ N² is (10³ N)².', ask: { q: 'Which prefix turns 10⁶ N² into a single prefixed unit?', choices: [{ t: 'kN², because (10³)² = 10⁶', correct: true, why: 'Yes. kN² means (kN)².' }, { t: 'MN², because mega is 10⁶', why: 'MN² = (10⁶ N)² = 10¹² N². The exponent squares the prefix.' }] } },
          { eq: '(300\\ \\u{mm})(0.5\\ \\u{MN})^{2} = [0.3\\ \\u{m}][0.25(10^{12})\\ \\u{N^2}]', why: '(b) 300 mm = 0.3 m. Square the whole bracket, number and power of ten alike: [0.5(10⁶) N]² = 0.25(10¹²) N².' },
          { eq: '= 0.075(10^{12})\\ \\u{m·N^2} = 75.0\\ \\u{Gm·N^2}', why: 'Shift three places into the exponent, 75.0(10⁹), and put the single prefix on the first unit.', ask: { q: 'Why not stop at 0.075 m·MN²? That is the same value.', choices: [{ t: 'Because 0.075 is below 0.1', correct: true, why: 'Right. Keep the number between 0.1 and 1000, so shift three places and use giga on the metre.' }, { t: 'Because MN² is not a real unit', why: 'It is real: (MN)². The problem is the 0.075.' }] } },
          { eq: '600\\ \\u{Gg} = 600(10^{9})\\ \\u{g} = 600(10^{6})\\ \\u{kg}', why: '(c) The denominator first. Giga sits on the gram, and a kilogram is 10³ g.', ask: { q: 'What is 600 Gg in kilograms?', choices: [{ t: '600(10⁶) kg', correct: true, why: 'Yes. Giga is 10⁹ on the gram, and a kg is 10³ g.' }, { t: '600(10⁹) kg', why: 'Gg is 10⁹ **grams**, not 10⁹ kilograms. Take off three places.' }] } },
          { eq: '\\frac{36\\ \\u{MN^3}}{600\\ \\u{Gg}} = \\frac{36(10^{18})\\ \\u{N^3}}{600(10^{6})\\ \\u{kg}}', why: '36 MN³ means 36 (10⁶ N)³ = 36(10¹⁸) N³. Only the unit is cubed, not the 36.' },
          { eq: '= 0.06(10^{12})\\ \\u{N^3/kg} = 60.0\\ \\u{kN^3/kg}', why: '0.06(10¹²) = 60(10⁹), and 10⁹ N³ is (10³ N)³, so kilo on the newton. The kg stays below the line, the one prefixed unit allowed there.' }
        ],
        outro: 'Three different units, one method. Never stack prefixes on top of the answer as you go: convert everything, compute, then re-express once.'
      },
      {
        type: 'task', id: 'H8.ex13', who: 'hask',
        title: 'Your turn on the chalkboard',
        text: 'Evaluate each and write the result with **one** prefix, a number between 0.1 and 1000, to 3 s.f.\n\n- **(a)** (45 mN)(7 GN)\n- **(b)** (250 mm)(0.4 MN)²\n- **(c)** 48 MN³ / 750 Gg\n\nThe answers go onto the controller\'s calibration plates.',
        inputs: [
          // (45 mN)(7 GN) = 45(10^-3)(7)(10^9) N^2 = 315(10^6) N^2 = 315 kN^2
          { key: 'a', label: '(a) (45 mN)(7 GN)', placeholder: 'e.g. 315 kN^2', spec: { value: EX_A, unit: 'N^2', sf: 3, form: 'si' }, answer: '315 kN^2', wrong: [{ input: '315 MN^2', kind: 'prefix' }, { input: '315 mN·GN', kind: 'form' }] },
          // (250 mm)(0.4 MN)^2 = 0.25 m (0.16)(10^12) N^2 = 0.04(10^12) m·N^2 = 40.0(10^9) m·N^2 = 40.0 Gm·N^2
          { key: 'b', label: '(b) (250 mm)(0.4 MN)²', placeholder: 'e.g. 40.0 Gm·N^2', spec: { value: EX_B, unit: 'm·N^2', sf: 3, form: 'si' }, answer: '40.0 Gm·N^2', wrong: [{ input: '0.0400 m·MN^2', kind: 'form' }, { input: '40.0 Mm·N^2', kind: 'prefix' }] },
          // 48 MN^3 / 750 Gg = 48(10^18) N^3 / 750(10^6) kg = 0.064(10^12) N^3/kg = 64.0(10^9) N^3/kg = 64.0 kN^3/kg
          { key: 'c', label: '(c) 48 MN³ / 750 Gg', placeholder: 'e.g. 64.0 kN^3/kg', spec: { value: EX_C, unit: 'N^3/kg', sf: 3, form: 'si' }, answer: '64.0 kN^3/kg', wrong: [{ input: '64.0 N^3/ug', kind: 'form' }, { input: '64.0 MN^3/kg', kind: 'prefix' }] }
        ],
        hints: [
          'Write each prefix as a power of ten, square or cube the whole bracket in (b), and remember the coefficient in 48 MN³ is not cubed.',
          '(a) 315(10⁶) N². (b) 0.25 × 0.16(10¹²) = 0.04(10¹²) m·N². (c) 750 Gg = 750(10⁶) kg, and 48(10¹⁸)/750(10⁶) = 0.064(10¹²) N³/kg.',
          '(a) 10⁶ N² = kN²: 315 kN². (b) 40.0(10⁹) m·N² = 40.0 Gm·N². (c) 64.0(10⁹) N³/kg = 64.0 kN³/kg.'
        ],
        consequence: function (ctx, a) {
          return controller(ctx, a, [{ key: 'a', trueSI: EX_A }, { key: 'b', trueSI: EX_B }, { key: 'c', trueSI: EX_C }]);
        },
        explain: 'Powers of ten first, one prefix last, and remember a prefix on a squared or cubed unit is squared or cubed with it: kN² is 10⁶ N², kN³ is 10⁹ N³.'
      },
      {
        type: 'sandbox', scene: HOIST(), controls: [],
        text: 'Strict firmware is on. Stamp plates for the 2.45 kN generator and see which ones the controller accepts, which ones it reads differently from what you meant, and which ones halt it.',
        actions: [
          { label: '2.45 kN', run: function (ctx) { return stampStrict(ctx, '2.45 kN'); } },
          { label: '2450 N', run: function (ctx) { return stampStrict(ctx, '2450 N'); } },
          { label: '0.002 45 MN', run: function (ctx) { return stampStrict(ctx, '0.002 45 MN'); } },
          { label: '245 daN', run: function (ctx) { return stampStrict(ctx, '245 daN'); } },
          { label: '2.45 MN', run: function (ctx) { return stampStrict(ctx, '2.45 MN'); } },
          { label: '2.45 kN·m', run: function (ctx) { return stampStrict(ctx, '2.45 kN·m'); } }
        ],
        prompts: ['Which labels hold the generator, and which halt the winch?', 'Find a label with the right force that the firmware still refuses. Which rule does it break?', 'Why does 2.45 kN·m halt it, even though the digits are right?']
      },
      {
        type: 'deeper', title: 'Powers of a thousand, and a kilogram with a prefix',
        teaser: 'Why steps of 1000, how far the table really goes, and why the kilogram is the odd one out.',
        steps: [
          { type: 'say', who: 'hask', text: 'Steps of 1000 line up with how numbers are written in groups of three digits, 7 000 000, so a prefix change is always "move the gap". It also means engineering notation needs only exponents that are multiples of 3, and the number in front always lands between 1 and 1000. Hecto, deca, deci and centi break that pattern, which is why engineers leave them alone.' },
          { type: 'say', who: 'hask', text: 'The full SI list runs much further than Table 1–3: tera (10¹²), peta (10¹⁵), exa (10¹⁸), zetta (10²¹), yotta (10²⁴) up top, and pico, femto, atto, zepto, yocto below. In 2022 the General Conference on Weights and Measures added **ronna** (R, 10²⁷) and **quetta** (Q, 10³⁰), with **ronto** (r) and **quecto** (q) for the small end, mostly because data storage and the mass of planets were running off the end of the list.' },
          { type: 'predict', who: 'hask', q: 'The kilogram is the only base unit with a prefix in its name. Why?', choices: [
            { t: 'Because the gram was defined first, and the practical standard that got built was a 1 kg block.', correct: true, why: 'Yes. The 1790s metric system started from the gram (a cubic centimetre of water), but a gram is too small to make a good physical standard, so the platinum reference was a kilogram. When the base units were chosen, the kilogram was the one with a real artefact, so it became the base unit and kept its prefix. Since 2019 it is defined by the Planck constant instead.' },
            { t: 'Because the gram is not an SI unit.', why: 'The gram is a perfectly good SI unit (it takes all the prefixes). The kilogram is the base unit for historical reasons.' }
          ] }
        ]
      },
      {
        type: 'summary',
        points: [
          'Prefixes G, M, k, m, μ, n are 10⁹, 10⁶, 10³, 10⁻³, 10⁻⁶, 10⁻⁹. Each step moves the decimal point three places: 4 000 000 N = 4000 kN = 4 MN.',
          'No deca or centi in engineering. The **kilogram** is the only base unit defined with a prefix, so 1000 kg is 1 Mg.',
          'A **dot** separates multiplied units (m·s vs ms). An **exponent** applies to the prefix too (mm² = (mm)²).',
          '**No prefix in a denominator**, except kg: kN/m, not N/mm.',
          'Calculate in base units and powers of ten, then re-express with **one** prefix and a number between **0.1 and 1000**.',
          'A wrong value makes a literal machine do the wrong thing. A wrong form makes a strict one do nothing.'
        ]
      }
    ]
  });
})(globalThis.SE);
