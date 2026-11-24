/*
 * P3 · Controller Labels (manual project). SI prefixes and the rules for
 * writing SI units, course section 1.4.
 *
 * The depot crane's controller was rebuilt after the fire, but its firmware is
 * strict: it parses every panel label literally and runs the crane on what it
 * read. Each deliverable is one replacement label. A wrong value makes the
 * crane misbehave in the hoist sim; a right value written in an illegal form
 * (cm, a prefix in a denominator, a number outside 0.1–1000, the wrong count
 * of figures) is refused by the firmware and the crane locks out.
 *
 * Beyond the book: the surviving plates are pre-SI and use the kilogram-force,
 * which is DEFINED with standard gravity (1 kgf = 9.806 65 N exactly), not the
 * local g of the site. The site conditions give a local g on purpose.
 */
(function (SE) {
  'use strict';

  var G0 = 9.80665;                                  // standard gravity, defines the kgf
  var LAT = 41.3, ALT = 420;                         // Rustline Depot
  var G_LOCAL = SE.physics.gravity.gSite(LAT, ALT);  // ≈ 9.80157 m/s²

  // Givens printed on the scorched plates (legacy units, as found)
  var SWL_KGF = 3180;           // safe working load, kgf
  var TRAVEL_CM = 735;          // hook travel, cm
  var ENC_STEP_UM = 527;        // encoder: cable paid out per tick, μm
  var ENC_TICK_MS = 38.0;       // encoder tick period, ms
  var STIFF_N_PER_MM = 48.6;    // cable spring rate, N/mm
  var BRAKE_KGF_CM2 = 70.5;     // brake accumulator pressure, kgf/cm²
  var BRAKE_DELAY_MS = 2416;    // brake set time, ms

  // Answer values in SI base units
  var SWL = SWL_KGF * G0;                                    // 31 185.147 N
  var TRAVEL = TRAVEL_CM / 100;                              // 7.35 m
  var CREEP = (ENC_STEP_UM * 1e-6) / (ENC_TICK_MS * 1e-3);   // 0.013 868 m/s
  var STIFF = STIFF_N_PER_MM * 1000;                         // 48 600 N/m
  var BRAKE_P = BRAKE_KGF_CM2 * G0 / 1e-4;                   // 6 913 688 Pa
  var DELAY = BRAKE_DELAY_MS / 1000;                         // 2.416 s

  // Loads used on the test rig
  var GEN = 3050;               // generator skid, kg (under the SWL)
  var SLED = 3400;              // overload test sled, kg (over the SWL)
  var BLOCK = 2400;             // general cargo block, kg
  var HOOK_H = 3;               // m, hook height for the hold tests

  var CLOSE = 'The rig could not tell the difference, but the inspector could: the label is off in its last figure.';

  function fmt(v, unit, sf) { return SE.sigfig.roundSig(v, sf || 3).text + ' ' + unit; }

  // Run a hold test. The hoist scene ramps tension up from zero over 0.3 s,
  // which suits a lift from the deck but lets a block that is already hanging
  // sag and keep sinking. Here the load starts on the brake with the cable
  // already loaded, so skip the ramp by starting the scene clock at 0.3 s.
  function hold(s, T, opts) {
    var pr = s.run(T, opts);
    s.time = 0.3;
    return pr;
  }

  // Decide how the firmware treats a label: it refuses anything it cannot
  // parse, anything with the wrong dimensions, and any label that breaks the
  // SI rules or the figure count. Only a well-formed label is acted on.
  function read(a) {
    var r = a.result;
    if (!r.parsed || !r.parsed.ok || !r.parts.units) return { halt: true, why: r.errors[0] ? r.errors[0].msg : 'unreadable label' };
    if (!r.parts.form || !r.parts.sigfigs) {
      var e = r.errors.filter(function (x) { return x.kind === 'form' || x.kind === 'sigfig'; })[0];
      return { halt: true, why: e ? e.msg : 'label rejected' };
    }
    return { halt: false, v: a.si };
  }

  // The strict firmware refusing a label: the winch never energises and the
  // walkers at the fence keep coming.
  function lockout(ctx, label, why) {
    var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'lift', label: 'LOCKED OUT', zombies: 5 });
    return s.run(0, { duration: 2 }).then(function () {
      return '**FIRMWARE HALT** on the ' + label + ' label: ' + why + ' The controller locks the winch out and the crane sits dead while the fence line fills up.';
    });
  }

  SE.content.registerProject('ch01', {
    id: 'P3', order: 3,
    title: 'Controller Labels',
    subtitle: 'Relabel the depot crane after the fire',
    brief: [
      'The fire in the north shed took the crane\'s control panel with it. Pell rebuilt the controller from salvage, and the firmware he flashed onto it is the strict kind: it reads every label **exactly as written** and runs the winch on what it read. A label it doesn\'t like, it refuses, and the crane locks out.',
      'The old cast plates survived, more or less. They\'re pre-war, in **kilogram-force** and **centimetres**, and some of the numbers came off the old controller\'s logs in awkward prefixes. I need six new labels in **proper SI**: one prefix, the number between 0.1 and 1000, no prefix under a fraction bar unless it\'s the kilogram. Where the plate carries four figures, the label keeps four.',
      'Nothing goes on the panel until it passes the test rig. We have a generator skid, an overload sled and a cargo block to try it with.'
    ].join('\n\n'),
    conditions: [
      'Site: Rustline Depot, latitude ' + LAT + '° N, ' + ALT + ' m above sea level. Local g measured at **' + G_LOCAL.toFixed(5) + ' m/s²**.',
      'Plate stamp: "SAFE WORKING LOAD **' + SWL_KGF + ' kgf**" (manufacturer\'s figure, 4 s.f.).',
      'Plate stamp: "HOOK TRAVEL **' + TRAVEL_CM + ' cm**".',
      'Old log: hook encoder pays out **' + ENC_STEP_UM + ' μm** of cable per tick, one tick every **' + ENC_TICK_MS.toFixed(1) + ' ms** at creep.',
      'Old log: cable spring rate **' + STIFF_N_PER_MM + ' N/mm**.',
      'Plate stamp: "BRAKE ACCUMULATOR **' + BRAKE_KGF_CM2 + ' kgf/cm²**". Accumulator burst disc: 10 MPa.',
      'Old log: brake set time **' + BRAKE_DELAY_MS + ' ms** (4 s.f.). Winch motor thermal limit: 30 s holding at stall.',
      'The firmware stores labels in SI only and treats a figure count as part of the label.'
    ],
    scene: { type: 'hoist', params: { mass: GEN, g: G_LOCAL, mode: 'lift', label: 'generator ' + GEN + ' kg', rating: SWL, zombies: 3 } },
    rigText: 'The rig runs the crane on the factory plate values so you can see what a healthy panel does. Your labels get tested here automatically when you sign them off.',
    rigActions: [
      {
        label: 'Lift the generator skid (' + GEN + ' kg)',
        run: function (ctx) {
          var W = GEN * G_LOCAL;
          var s = ctx.setScene('hoist', { mass: GEN, g: G_LOCAL, mode: 'lift', label: 'generator ' + GEN + ' kg', rating: SWL });
          return s.run(1.03 * W, { duration: 5 }).then(function () {
            return 'Generator weighs ' + fmt(W / 1000, 'kN', 4) + ' here: under the safe working load, so the winch takes it.';
          });
        }
      },
      {
        label: 'Hold the cargo block at ' + HOOK_H + ' m',
        run: function (ctx) {
          var W = BLOCK * G_LOCAL;
          var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'hover', hookHeight: HOOK_H, label: 'block ' + BLOCK + ' kg', rating: SWL });
          return hold(s, W, { duration: 4 }).then(function (r) { return 'Held: tension ' + fmt(W / 1000, 'kN', 4) + ', acceleration zero.'; });
        }
      }
    ],
    lockedTools: ['converter'],
    deliverables: [
      {
        id: 'P3.swl',
        label: '**Safe working load** label, from the "' + SWL_KGF + ' kgf" plate. Keep 4 figures.',
        placeholder: 'e.g. 12.34 kN',
        // 1 kgf is defined as 9.806 65 N, whatever the local g.
        // 3180 × 9.806 65 = 31 185.147 N → 31.19 kN (4 s.f.).
        // Using 9.81: 31 195.8 N → 31.20 kN. Using local g 9.80157: 31 169.0 N → 31.17 kN.
        spec: {
          value: SWL, unit: 'N', sf: 4, form: 'si', tol: 0.0002,
          mistakes: [
            { ratio: 9.81 / G0, tol: 0.00025, kind: 'concept', msg: 'That matches using g = 9.81 m/s² (or rounding to 3 figures). The kilogram-force is defined with standard gravity, 9.806 65 m/s² exactly, and at the 4 figures this label needs the difference shows.' },
            { ratio: G_LOCAL / G0, tol: 0.00025, kind: 'concept', msg: 'You used the local g. A kgf is a defined unit (9.806 65 N), not the weight of a kilogram wherever you happen to be.' }
          ]
        },
        answer: '31.19 kN',
        wrong: [
          { input: '31.20 kN', kind: 'concept' },
          { input: '31.17 kN', kind: 'concept' },
          { input: '31.19 N', kind: 'prefix' },
          { input: '31185 N', kind: 'sigfig' },
          { input: '31.2 kN', kind: 'concept' },
          { input: '3180 kg', kind: 'concept' }
        ],
        hints: [
          'A kilogram-force is a *force*: the label needs newtons. Which value of g defines it?',
          'The kgf is defined with **standard gravity**, 1 kgf = 9.806 65 N exactly. Multiply, then choose the prefix that puts the number between 0.1 and 1000, and keep 4 figures.',
          '3180 × 9.806 65 = 31 185.1 N = 31.1851(10³) N. Four figures with the kilo prefix: **31.19 kN**.'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'safe working load', f.why);
          var lim = f.v, Wg = GEN * G_LOCAL, Ws = SLED * G_LOCAL;
          // The firmware compares the load-cell reading against the label:
          // under it, lift; over it, refuse.
          if (lim < Wg) {
            var s1 = ctx.setScene('hoist', { mass: GEN, g: G_LOCAL, mode: 'lift', label: 'generator ' + GEN + ' kg', rating: SWL });
            return s1.run(0, { duration: 2 }).then(function () {
              return 'The firmware read a safe working load of ' + fmt(lim, 'N', 4) + ' and refused the ' + fmt(Wg / 1000, 'kN', 4) + ' generator as an overload. Nothing at the depot is light enough to lift now.';
            });
          }
          if (lim >= Ws) {
            var s2 = ctx.setScene('hoist', { mass: SLED, g: G_LOCAL, mode: 'lift', label: 'overload sled ' + SLED + ' kg', rating: SWL });
            return s2.run(1.03 * Ws, { duration: 5 }).then(function (r) {
              return 'The label let the ' + fmt(Ws / 1000, 'kN', 4) + ' overload sled through, because ' + fmt(lim / 1000, 'kN', 4) + ' sounded fine to the firmware. The cable is only good for ' + fmt(SWL / 1000, 'kN', 4) + ': ' + (r.outcome === 'snapped' ? 'it parted and the sled came down.' : 'it held, barely.');
            });
          }
          var s3 = ctx.setScene('hoist', { mass: SLED, g: G_LOCAL, mode: 'lift', label: 'overload sled ' + SLED + ' kg', rating: SWL });
          return s3.run(0, { duration: 2 }).then(function () {
            var ok = a.result.correct;
            return 'Generator: lifted. Overload sled (' + fmt(Ws / 1000, 'kN', 4) + '): refused, as it should be.' + (ok ? '' : ' ' + CLOSE);
          });
        }
      },
      {
        id: 'P3.travel',
        label: '**Hook travel** limit, from the "' + TRAVEL_CM + ' cm" plate.',
        placeholder: 'e.g. 4.20 m',
        // 735 cm = 735 × 10⁻² m = 7.35 m. The centi prefix is not used in engineering labels.
        spec: { value: TRAVEL, unit: 'm', sf: 3, form: 'si' },
        answer: '7.35 m',
        wrong: [
          { input: '735 cm', kind: 'form' },
          { input: '7350 mm', kind: 'sigfig' },
          { input: '7.35 km', kind: 'prefix' },
          { input: '73.5 m', kind: 'prefix' }
        ],
        hints: [
          'The firmware won\'t take centi. Which engineering prefixes are left that suit a few metres?',
          'Centi is 10⁻². Convert to metres first, then check the number lands between 0.1 and 1000.',
          '735 cm = 735(10⁻²) m = **7.35 m**. (7350 mm has the right value but breaks the range rule.)'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'hook travel', f.why);
          var W = BLOCK * G_LOCAL, T = 1.15 * W, acc = (T - W) / BLOCK;
          // The gantry head sits 0.4 m above the true travel limit. The
          // controller cuts the winch when it thinks the hook has gone the
          // labelled distance: t = sqrt(2 s / a), plus the ramp's ~0.26 s before lift-off.
          var tCut = Math.sqrt(2 * Math.max(f.v, 0) / acc) + 0.26;
          var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'lift', label: 'block ' + BLOCK + ' kg', height: TRAVEL + 2.7, rating: SWL });
          return s.run(T, { duration: Math.min(tCut, 9) }).then(function (r) {
            if (r.outcome === 'slammed') return 'The controller thought it had ' + fmt(f.v, 'm') + ' of travel. The block hit the gantry head at ' + Math.abs(r.detail.impact).toFixed(2) + ' m/s.';
            if (r.outcome === 'stalled' || (r.detail && r.detail.y < 0.2)) return 'The controller thought the whole travel was ' + fmt(f.v, 'm') + ', so it cut the winch before the block left the deck.';
            var y = r.detail && r.detail.y != null ? r.detail.y : 0;
            return 'Winch cut out with the block ' + y.toFixed(2) + ' m up, inside the travel limit.' + (a.result.correct ? '' : ' ' + CLOSE);
          });
        }
      },
      {
        id: 'P3.creep',
        label: '**Creep speed** for setting loads down, from the encoder log.',
        placeholder: 'e.g. 22.1 mm/s',
        // v = 527 μm / 38.0 ms = 527(10⁻⁶) m / 38.0(10⁻³) s = 13.868(10⁻³) m/s → 13.9 mm/s.
        // The prefix goes on the numerator only: mm/s, not μm/ms.
        spec: { value: CREEP, unit: 'm/s', sf: 3, form: 'si' },
        answer: '13.9 mm/s',
        wrong: [
          { input: '13.9 μm/ms', kind: 'form' },
          { input: '0.0139 m/s', kind: 'form' },
          { input: '13.9 m/s', kind: 'prefix' },
          { input: '13.9 μm/s', kind: 'prefix' }
        ],
        hints: [
          'Speed is distance over time. Can a label keep a prefix under the fraction bar?',
          'Rewrite both prefixes as powers of ten, divide in base units, then put one prefix back on the numerator.',
          '527(10⁻⁶) m ÷ 38.0(10⁻³) s = 13.9(10⁻³) m/s = **13.9 mm/s**.'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'creep speed', f.why);
          var v = Math.abs(f.v), W = BLOCK * G_LOCAL;
          // The controller lets the block accelerate down so that it reaches
          // the labelled speed at the deck: v² = 2 a h, so a = v² / (2h).
          // If that needs more than g, the winch simply lets go (T = 0).
          var acc = v * v / (2 * HOOK_H), T = Math.max(0, BLOCK * (G_LOCAL - acc));
          var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'hover', hookHeight: HOOK_H, label: 'block ' + BLOCK + ' kg', rating: SWL });
          return hold(s, T, { duration: 5 }).then(function (r) {
            if (r.outcome === 'dropped') return 'Read as ' + fmt(v, 'm/s') + ', so the winch let the block run. It hit the deck at ' + Math.abs(r.detail.impact).toFixed(2) + ' m/s.';
            var t = HOOK_H / Math.max(v, 1e-12);
            var tt = t < 600 ? t.toFixed(0) + ' s' : t < 7200 ? (t / 60).toFixed(0) + ' min' : (t / 3600).toFixed(0) + ' h';
            if (v > 0.1) return 'Set down at ' + fmt(v, 'm/s') + ': hard enough to crack the block\'s skids.';
            if (t > 600) return 'Read as ' + fmt(v, 'm/s') + '. At that rate the ' + HOOK_H + ' m descent takes ' + tt + '. The crew gives up and the dead don\'t.';
            return 'Set down gently over ' + tt + '.' + (a.result.correct ? '' : ' ' + CLOSE);
          });
        }
      },
      {
        id: 'P3.stiffness',
        label: '**Cable spring rate**, from the "' + STIFF_N_PER_MM + ' N/mm" log entry.',
        placeholder: 'e.g. 12.5 kN/m',
        // 48.6 N/mm = 48.6 N / 10⁻³ m = 48.6(10³) N/m = 48.6 kN/m.
        spec: { value: STIFF, unit: 'N/m', sf: 3, form: 'si' },
        answer: '48.6 kN/m',
        wrong: [
          { input: '48.6 N/mm', kind: 'form' },
          { input: '48600 N/m', kind: 'sigfig' },
          { input: '48.6 N/m', kind: 'prefix' },
          { input: '48.6 MN/m', kind: 'prefix' }
        ],
        hints: [
          'There is a prefix in the denominator. The rules don\'t allow it.',
          'Replace "mm" with 10⁻³ m and carry the power of ten up to the numerator.',
          '48.6 N/(10⁻³ m) = 48.6(10³) N/m = **48.6 kN/m**.'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'spring rate', f.why);
          var W = BLOCK * G_LOCAL, k = Math.abs(f.v);
          // Before the brake releases, the controller winds in the stretch the
          // cable will take, W/k. Wind in too much and the hook jumps up;
          // too little and the block drops onto the cable and snatches it.
          var need = W / STIFF, wound = W / Math.max(k, 1e-9), err = wound - need;
          var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'hover', hookHeight: HOOK_H, label: 'block ' + BLOCK + ' kg', rating: SWL });
          if (err > 0.02) {
            var T = 1.2 * W, acc = (T - W) / BLOCK;
            return hold(s, T, { duration: Math.min(Math.sqrt(2 * err / acc), 8) }).then(function (r) {
              if (r.outcome === 'slammed') return 'Read as ' + fmt(k, 'N/m') + ', the controller wound in ' + fmt(wound, 'm') + ' of "stretch". The block slammed into the gantry head.';
              return 'The controller over-wound by ' + fmt(err, 'm') + ' and the block jerked upward.';
            });
          }
          if (err < -0.02) {
            // Drop of h onto a spring of rate k: peak tension W(1 + sqrt(1 + 2kh/W)).
            var h = -err, peak = W * (1 + Math.sqrt(1 + 2 * STIFF * h / W));
            return hold(s, peak, { duration: 3 }).then(function (r) {
              return 'Read as ' + fmt(k, 'N/m') + ', the controller barely wound in. The block dropped ' + fmt(h, 'm') + ' onto the cable, peak tension ' + fmt(peak / 1000, 'kN') + (r.outcome === 'snapped' ? ': past the cable\'s rating, and it parted.' : '.');
            });
          }
          return hold(s, W, { duration: 4 }).then(function () {
            return 'Wound in ' + fmt(wound * 1000, 'mm') + ' of stretch; the brake released without a jolt.' + (a.result.correct ? '' : ' ' + CLOSE);
          });
        }
      },
      {
        id: 'P3.brake',
        label: '**Brake accumulator pressure**, from the "' + BRAKE_KGF_CM2 + ' kgf/cm²" plate.',
        placeholder: 'e.g. 2.45 MPa',
        // 70.5 kgf/cm² = 70.5 × 9.806 65 N / (10⁻² m)² = 691.37 N / 10⁻⁴ m²
        //             = 6 913 688 Pa → 6.91 MPa. The exponent squares the centi too.
        // With 9.81 the same sum gives 6 916 050 Pa → 6.92 MPa.
        spec: {
          value: BRAKE_P, unit: 'Pa', sf: 3, form: 'si', tol: 0.0007,
          mistakes: [{ ratio: 9.81 / G0, tol: 0.0006, kind: 'concept', msg: 'You used g = 9.81 m/s². The kgf is defined with standard gravity, 9.806 65 m/s², and here it changes the third figure.' }]
        },
        answer: '6.91 MPa',
        wrong: [
          { input: '6.92 MPa', kind: 'concept' },
          { input: '69.1 kPa', kind: 'prefix' },
          { input: '0.00691 GPa', kind: 'form' },
          { input: '691 N/cm^2', kind: 'form' }
        ],
        hints: [
          'Two legacy units in one label: a force unit and a squared length unit. Deal with each.',
          'Turn kgf into N with 9.806 65. Then remember the exponent applies to the prefix as well: cm² = (10⁻² m)² = 10⁻⁴ m².',
          '70.5 × 9.806 65 = 691.37 N on 10⁻⁴ m² gives 6.914(10⁶) Pa = **6.91 MPa**.'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'brake pressure', f.why);
          var p = Math.abs(f.v), W = GEN * G_LOCAL;
          // At the plate pressure the brake holds 1.5 × the safe working load;
          // holding force scales with pressure. Over 10 MPa the burst disc
          // goes and the brake has nothing.
          var holdF = p > 10e6 ? 0 : 1.5 * SWL * p / BRAKE_P;
          var s = ctx.setScene('hoist', { mass: GEN, g: G_LOCAL, mode: 'hover', hookHeight: HOOK_H, label: 'generator ' + GEN + ' kg', rating: SWL });
          return hold(s, Math.min(holdF, W), { duration: 4 }).then(function (r) {
            if (p > 10e6) return 'The pump chased ' + fmt(p / 1e6, 'MPa') + ', blew the 10 MPa burst disc and the brake let go. The generator ' + (r.outcome === 'dropped' ? 'hit the deck at ' + Math.abs(r.detail.impact).toFixed(2) + ' m/s.' : 'fell.');
            if (holdF < W) return 'At ' + fmt(p, 'Pa') + ' the brake holds only ' + fmt(holdF, 'N') + '. The generator slid through it' + (r.outcome === 'dropped' ? ' and hit the deck at ' + Math.abs(r.detail.impact).toFixed(2) + ' m/s.' : '.');
            return 'Brake holds ' + fmt(holdF / 1000, 'kN') + ' against the generator\'s ' + fmt(W / 1000, 'kN') + '. It hangs still.' + (a.result.correct ? '' : ' ' + CLOSE);
          });
        }
      },
      {
        id: 'P3.delay',
        label: '**Brake set time**, from the "' + BRAKE_DELAY_MS + ' ms" log entry. Keep 4 figures.',
        placeholder: 'e.g. 1.234 s',
        // 2416 ms = 2416(10⁻³) s = 2.416 s. 2416 ms has the right value but
        // breaks the 0.1–1000 range rule.
        spec: { value: DELAY, unit: 's', sf: 4, form: 'si' },
        answer: '2.416 s',
        wrong: [
          { input: '2416 ms', kind: 'form' },
          { input: '2.42 s', kind: 'sigfig' },
          { input: '2.416 ms', kind: 'prefix' },
          { input: '2.416 ks', kind: 'prefix' }
        ],
        hints: [
          'The number on the log is fine. Is it in the allowed range?',
          'Move the decimal point three places and change the prefix to match. Keep all four figures.',
          '2416 ms = 2.416(10³)(10⁻³) s = **2.416 s**.'
        ],
        consequence: function (ctx, a) {
          var f = read(a);
          if (f.halt) return lockout(ctx, 'brake set time', f.why);
          var t = Math.abs(f.v), gap = DELAY - t;
          // The winch motor holds the load until the brake has set. Release
          // early and the load is unsupported for the remaining time.
          var s = ctx.setScene('hoist', { mass: BLOCK, g: G_LOCAL, mode: 'hover', hookHeight: HOOK_H, label: 'block ' + BLOCK + ' kg', rating: SWL });
          if (gap > 0.01) {
            var fall = 0.5 * G_LOCAL * gap * gap;
            if (fall >= HOOK_H) {
              return hold(s, 0, { duration: 3 }).then(function (r) {
                return 'The motor let go after ' + fmt(t, 's') + ', with the brake still ' + fmt(gap, 's') + ' from setting. The block ' + (r.outcome === 'dropped' ? 'hit the deck at ' + Math.abs(r.detail.impact).toFixed(2) + ' m/s.' : 'fell.');
              });
            }
            return hold(s, BLOCK * G_LOCAL, { duration: 3 }).then(function () {
              return 'The motor let go ' + fmt(gap, 's') + ' early. The block dropped ' + fmt(fall * 1000, 'mm') + ' before the brake caught it.';
            });
          }
          return hold(s, BLOCK * G_LOCAL, { duration: 3 }).then(function () {
            if (t > 30) return 'The brake set at ' + DELAY + ' s, but the motor kept holding for ' + fmt(t, 's') + '. Past its 30 s thermal limit, the windings cooked.';
            return 'Motor held for ' + fmt(t, 's', 4) + ', the brake set, then the motor let go. The block didn\'t move.' + (a.result.correct ? '' : ' ' + CLOSE);
          });
        }
      }
    ],
    deeper: [
      'The **kilogram-force** is a defined unit: 1 kgf = 1 kg × 9.806 65 m/s² = 9.806 65 N exactly. Standard gravity is a convention, so a kgf rating means the same force at the equator, at the poles or here at ' + G_LOCAL.toFixed(5) + ' m/s². Using local g, or the rounded 9.81, shifts a four-figure label.',
      'A prefix belongs to its unit when the unit is raised to a power: 1 cm² = (10⁻² m)² = 10⁻⁴ m², not 10⁻² m². That is why kgf/cm² converts to MPa and not kPa.',
      'The firmware refusing a correct value in the wrong form is not pedantry. A parser that reads "mm" as millimetre and "m·m" as square metre has to be strict to be safe.'
    ],
    debrief: [
      'All six labels are on the panel and the firmware accepted every one. The crane lifts the generator, refuses the sled, sets loads down at a walking-pace creep and holds them on the brake.',
      'Juno signs off the sheet. "Pell says the old plates can go in the scrap bin. I told him to keep them. Somebody will want to know what the numbers used to mean."'
    ].join('\n\n')
  });
})(globalThis.SE);
