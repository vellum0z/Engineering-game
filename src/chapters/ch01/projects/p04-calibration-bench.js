/*
 * P4 · Calibration Bench (manual project, played in the build yard).
 *
 * Before the workshop fabricates the splice plate for the north bridge,
 * every machine on the bench gets its figures checked, and every figure is
 * a setting the machine obeys:
 *
 *   P4.feed   punch table   feed rate from a jog test (prefix quotient, 3 s.f.)
 *             -> the table runs for 465 mm / feed at its real speed; the bolt
 *                drops through the new hole and the flange hole, or it doesn't
 *   P4.press  hydraulic press  relief pressure from the ram bore (squared
 *             prefix) -> the slug shears out, the punch stalls, or the frame
 *             cracks when the ram dead-heads at the end of its stroke
 *   P4.cut    scaffold walk  two boards of the cut list rounded to 3 s.f.;
 *             the crew cuts the other 28 the same way -> the walk closes on
 *             the end post, overruns it, or leaves a gap a heel drops into
 *   P4.stay   crane stay bolt  position to the nearest millimetre with full
 *             precision -> the stay pin goes home or it doesn't
 *   P4.area   caliper   splice plate area stamped to the figures a ±0.02 mm
 *             caliper justifies -> the inspector re-measures and accepts or
 *             rejects the stamp
 *
 * The bench machines are job scenery (library: false) defined at the bottom
 * of this file, prefixed p04-. Every number is computed from the givens; the
 * hand check sits next to each one.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial, B = SE.physics.bench;
  var rs = function (x, n, rule) { return SE.sigfig.roundSig(x, n, rule); };
  var MM = 1e-3;

  // Area dials (the stamp takes mm^2). Until dial.js has an area quantity.
  if (!D.QUANTITIES.area) D.QUANTITIES.area = { dims: SE.units.dim(2, 0, 0), si: 'm^2', name: 'area', examples: 'mm^2, m^2, in^2' };

  // ---------------------------------------------------------------- givens

  // 1. Punch-table feed. The lead screw moved the table 835 μm in 46.0 ms.
  var JOG = 835e-6, JOG_T = 46.0e-3;
  var FEED = JOG / JOG_T;
  // 835(10^-6) m / 46.0(10^-3) s = 18.152(10^-3) m/s  ->  18.2 mm/s
  var FAR_HOLE = 465 * MM;          // last hole of the row, from the datum edge
  var HOLE = 24 * MM, BOLT = 22 * MM;   // 2 mm of play
  var TABLE_TRAVEL = 0.5;           // end stop
  // 18.2 mm/s: t = 0.465 / 0.0182 = 25.55 s, real travel 0.018152 × 25.55 = 463.77 mm (-1.23 mm): fits
  // 18 mm/s:   real travel 468.93 mm (+3.93 mm): misfit

  // 2. Press. Salvaged cylinder, bore 127 mm.
  var BORE = 127 * MM;
  var RAM_A = Math.PI / 4 * BORE * BORE;
  // (127 mm)^2 = (0.127 m)^2 = 0.016 129 m^2; A = (π/4)(0.016 129) = 0.012 668 m^2
  var PUNCH_F = 483e3;              // N to shear a 24 mm hole through the 16 mm plate
  var MARGIN = 1.15;                // the controller aims 15 % over the punch force
  var FRAME_RATING = 750e3;         // N, press frame
  var RELIEF = MARGIN * PUNCH_F / RAM_A;
  // p = 1.15(483 kN) / 0.012 668 m^2 = 555.45(10^3) / 0.012 668 = 43.85(10^6) Pa  ->  43.8 MPa
  // 43.8 MPa on the real ram: 43.8(10^6)(0.012 668) = 554.9 kN, between 483 and 750 kN

  // 3. Scaffold walk. 30 boards read to the millimetre (bench pile, seed 23).
  var PILE = B.makeBoards(23, 30, 0.6);
  var BOARD3 = PILE[2], BOARD11 = PILE[10];     // 2.065 m, 2.375 m
  // 2.065 -> exact 5 after an even 6 -> 2.06 m; 2.375 -> exact 5 after an odd 7 -> 2.38 m
  var ALLOW = 40 * MM;              // the end post stands 40 mm clear of the true run
  var HEEL = 60 * MM;               // a gap wider than a boot heel is a fail
  // drift over 30 boards: book +13 mm, always-up +83 mm, truncate -147 mm

  // 4. Crane stay bolt. Boom tip 3.92 m up and 7.26 m out, 9 bays, stay at node 7.
  var CRANE = { h: 3.92, r: 7.26, bays: 9, k: 7 };
  var CHAIN = B.chainError(B.craneSteps(), { n: 3, rule: 'book', inputs: CRANE });
  var STAY = CHAIN.exact, STAY_SHEET = CHAIN.rounded;
  var BOOM_L = Math.sqrt(CRANE.h * CRANE.h + CRANE.r * CRANE.r);
  // h^2 + r^2 = 15.3664 + 52.7076 = 68.0740, L = 8.250 697 m
  // s = 7 L / 9 = 6.417 209 m  ->  6.417 m. Rounded every step: 6.42 m, 2.8 mm out
  var PIN = 25.5 * MM, PIN_HOLE = 26 * MM;   // the holes can be 0.5 mm apart at most

  // 5. Splice plate area from the caliper (least count 0.02 mm).
  var PLATE_A = 112.463, PLATE_B = 63.177, RES = 0.02;
  var RA = B.vernierRead(PLATE_A, RES), RB = B.vernierRead(PLATE_B, RES);
  var AREA = B.propagate('product', [RA.reading, RB.reading], [RA.res, RB.res]);
  var AREA_SF = B.sigFigsJustified(AREA.value, AREA.abs);
  // 112.46 × 63.18 = 7105.2228 mm^2; u/A = √((0.02/112.46)^2 + (0.02/63.18)^2) = 3.63(10^-4)
  // u = 2.58 mm^2 -> 3 mm^2: the units place is the last honest digit -> 7105 mm^2, 4 s.f.

  // ------------------------------------------------------------- helpers

  function mm(x, d) { return (x * 1000).toFixed(d == null ? 2 : d) + ' mm'; }
  function signedMm(x, d) { return (x >= 0 ? '+' : '−') + mm(Math.abs(x), d); }
  function f3(x, n) { return D.fmtNum(x, n || 3); }
  function kN(F) { return f3(F / 1000) + ' kN'; }

  var CAT_PIN = 0x10, CAT_BENCH = 0x20;

  // Which rounding rule turns `reading` into `si` at 3 s.f.?
  function rulesFor(reading, si) {
    return B.RULES.filter(function (rule) { return Math.abs(rs(reading, 3, rule).value - si) < 1e-9; });
  }
  var RULE_TALK = {
    book: 'the course rule (an exact 5 after an even digit drops, after an odd digit goes up)',
    up: '"always round a 5 up"',
    truncate: '"just drop the extra digit"'
  };

  // Magnifier box drawn in the top-right corner of the yard.
  function loupe(ctx, cam, o) {
    var W = cam.width ? cam.width() : 800, w = o.w || 250, h = o.h || 210;
    var head = 16 + 14 * (o.lines || []).length;
    var box = { x: W - w - 12, y: 12, w: w, h: h };
    var map = function (p) { return { x: box.x + w / 2 + (p.x - o.at.x) * o.zoom, y: box.y + head + (h - head) / 2 - (p.y - o.at.y) * o.zoom }; };
    map.rect = function (x0, y0, x1, y1, fill, stroke) {
      var a = map({ x: x0, y: y1 }), b = map({ x: x1, y: y0 });
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    };
    map.body = function (body, fill) {
      if (!body) return;
      body.fixtures.forEach(function (fx) {
        var s = fx.shape; if (!s.vertices) return;
        ctx.beginPath();
        s.vertices.forEach(function (v, i) { var p = map(body.worldPoint(v)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
      });
    };
    // leader line from the spot to the box
    var spot = cam.worldToScreen(o.at);
    ctx.save();
    ctx.strokeStyle = 'rgba(230,180,34,.7)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(spot.x, spot.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(spot.x, spot.y); ctx.lineTo(box.x, box.y + h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(18,22,26,.92)'; ctx.fillRect(box.x, box.y, w, h);
    ctx.beginPath(); ctx.rect(box.x, box.y + head, w, h - head); ctx.clip();
    o.draw(map, ctx);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(230,180,34,.9)'; ctx.lineWidth = 2; ctx.strokeRect(box.x, box.y, w, h);
    ctx.fillStyle = 'rgba(230,180,34,.95)'; ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(o.title || '', box.x + 6, box.y + 14);
    (o.lines || []).forEach(function (t, i) { ctx.fillStyle = 'rgba(235,235,225,.95)'; ctx.fillText(t, box.x + 6, box.y + 30 + 14 * i); });
    ctx.restore();
  }

  function label(ctx, cam, p, text, color) {
    var s = cam.worldToScreen(p);
    ctx.save(); ctx.font = '12px "IBM Plex Mono", monospace'; ctx.fillStyle = color || 'rgba(235,235,225,.95)';
    ctx.fillText(text, s.x, s.y); ctx.restore();
  }

  // A bolt or pin: a shank that only the cap can stop, and a head that sits on
  // the plates. `fits` is decided from where the holes really ended up: the
  // opening is the overlap of the two holes, and the shank goes through when
  // the opening is at least its diameter.
  function dropPin(world, part, o) {
    var P = SE.phys;
    var lo = Math.max(o.holeA - o.hole / 2, o.holeB - o.hole / 2), hi = Math.min(o.holeA + o.hole / 2, o.holeB + o.hole / 2);
    var opening = hi - lo, cx = (lo + hi) / 2, fits = opening >= o.dia;
    var shankH = o.shank, headH = o.dia * 0.6;
    var pin = world.add(new P.Body({
      position: { x: fits || opening > 0 ? cx : o.holeB, y: o.top + shankH + 0.03 }, fixedRotation: true, label: o.label,
      shapes: [
        { shape: P.box(o.dia / 2, shankH / 2), material: 'steel', friction: 0, filter: { category: CAT_PIN, mask: 0xFFFF & ~CAT_BENCH } },
        { shape: P.box(o.dia * 0.8, headH / 2, { x: 0, y: shankH / 2 + headH / 2 }), material: 'steel', friction: 0.4 }
      ],
      mass: o.mass || 0.4
    }));
    pin.userData = { part: part };
    var cap = null;
    if (!fits) {
      cap = world.add(new P.Body({ type: 'static', position: { x: pin.c.x, y: o.top + 0.001 }, label: '',
        shapes: [{ shape: P.box(o.dia / 2 + 0.004, 0.001), sensor: false, filter: { category: CAT_BENCH, mask: CAT_PIN } }] }));
      cap.userData = { part: part };
    }
    return { body: pin, cap: cap, fits: fits, opening: opening, centre: cx, shankH: shankH };
  }

  // Static slab with a hole: two pieces either side of `hole` centred at hx.
  function holedSlab(world, part, x0, x1, y0, t, hx, hole, material) {
    var P = SE.phys, out = [];
    [[x0, hx - hole / 2], [hx + hole / 2, x1]].forEach(function (seg) {
      if (seg[1] - seg[0] <= 1e-6) return;
      var b = world.add(new P.Body({ type: 'static', position: { x: (seg[0] + seg[1]) / 2, y: y0 + t / 2 }, label: '',
        shapes: [{ shape: P.box((seg[1] - seg[0]) / 2, t / 2), material: material || 'steel', filter: { category: CAT_BENCH, mask: 0xFFFF } }] }));
      b.userData = { part: part };
      out.push(b);
    });
    return out;
  }

  // Pin at rest: through (head on the plates) or stopped on the cap.
  function pinVerdict(s, id, key, text) {
    var bp = s.part(id), pin = bp && bp.pin;
    if (!pin) return null;
    var still = s.held(key, Math.abs(pin.body.v.y) < 0.005 && s.t > pin.t0 + 0.3, 0.4);
    if (!still) return null;
    return pin.fits ? 'pass' : { fail: text(bp) };
  }

  // ------------------------------------------------------------- designs

  var SITE = { g: 9.81, floor: 'concrete', floorWidth: 160 };

  var TABLE = { parts: [
    { id: 'table', type: 'p04-table', x: 0, y: 0.8, dials: { feed: '20.0 mm/s' }, locked: true, open: ['feed'], label: 'punch table' }
  ] };
  var PRESS = { parts: [
    { id: 'press', type: 'p04-press', x: 0, y: 0.9, dials: { relief: '30.0 MPa' }, locked: true, open: ['relief'], label: 'press' }
  ] };
  var WALK = { parts: [
    { id: 'walk', type: 'p04-walk', x: 0, y: 0.5, dials: { board3: '2.065 m', board11: '2.375 m' }, locked: true, open: ['board3', 'board11'], label: 'scaffold walk' }
  ] };
  var BOOM = { parts: [
    { id: 'boom', type: 'p04-boom', x: 0, y: 0.9, dials: { mark: '6.42 m' }, locked: true, open: ['mark'], label: 'crane boom' }
  ] };
  var GAUGE = { parts: [
    { id: 'gauge', type: 'p04-gauge', x: 0, y: 0.9, dials: { stamp: '7105.2228 mm^2' }, locked: true, open: ['stamp'], label: 'inspection bench' }
  ] };

  // ------------------------------------------------------------- project

  SE.content.registerProject('ch01', {
    id: 'P4', order: 4,
    title: 'Calibration Bench',
    subtitle: 'Every digit before the steel',

    brief: [
      'The north bridge needs a **splice plate**: a slab of salvaged steel bolted across the cracked girder, through holes that already exist in the old flange. If the new holes are off, the bolts won\'t go through, and we don\'t get a second plate.',
      'So before anyone touches the steel, the workshop recalibrates the bench: the punch table, the hydraulic press, the scaffold the crew stands on, the crane that lifts the plate, and the caliper. Every machine takes your figure **exactly as written** and does what it says. Get a prefix wrong and it punches a hole in the wrong county.',
      'Each job is a machine with one setting open. Type the figure, press Run and watch what the machine does with it. The whole parts library is there too: clip a speed gauge to the punch table if you want to check the jog test yourself. Report figures to three significant figures with one SI prefix in the numerator unless the job says otherwise. — *Juno*'
    ].join('\n\n'),

    conditions: [
      'Punch-table jog test: the lead screw moved the table **835 μm** in **46.0 ms**. Holes are 24 mm for 22 mm bolts; the last hole in the row is **465 mm** from the datum edge.',
      'Press: salvaged cylinder with a **127 mm** bore. A 24 mm hole through this 16 mm plate takes **483 kN**; set the relief valve so the ram pushes **15 % over** that. Frame rated **750 kN**.',
      'Scaffold boards are read to the millimetre and cut to **3 s.f.**: board 3 reads **2.065 m**, board 11 reads **2.375 m**. The crew cuts the rest of the pile the way your two cuts show.',
      'Crane stay: boom tip **3.92 m** up and **7.26 m** out from the heel pin, 9 equal bays, stay pinned at node 7. Pin 25.5 mm through 26 mm holes in the lug and the boom; the fitter drills to the **nearest millimetre**.',
      'Caliper least count **0.02 mm**, so every reading is ±0.02 mm. The splice plate reads **112.46 mm × 63.18 mm**.'
    ],

    lockedTools: ['sigfig', 'converter'],

    yard: { site: SITE, design: TABLE, camera: { fit: { lo: { x: -0.7, y: 0.45 }, hi: { x: 1.7, y: 1.15 } } } },

    jobs: [
      {
        id: 'P4.feed',
        label: '**Punch-table feed.** Set the controller\'s feed rate from the jog test, $\\frac{835\\u{ μm}}{46.0\\u{ ms}}$. It runs the table for 465 mm ÷ feed, and the table moves at its real speed.',
        design: TABLE,
        yard: { camera: { fit: { lo: { x: -0.7, y: 0.45 }, hi: { x: 1.7, y: 1.15 } } } },
        timeout: 45,
        goal: G.all(
          G.never(function (s) { var t = s.part('table'); return t && t.crashed ? 'The table ran into its end stop at 500 mm and the punch came down on the bench rail.' : null; }),
          function (s) { return pinVerdict(s, 'table', 'feed-bolt', function (bp) { return 'The new hole is ' + signedMm(bp.hole - FAR_HOLE) + ' from the flange hole. The two holes leave only ' + mm(Math.max(0, bp.pin.opening)) + ' for a 22 mm bolt, and it won\'t go.'; }); }
        ),
        grade: { part: 'table', key: 'feed', spec: { value: FEED, unit: 'm/s', sf: 3, form: 'si' } },
        hints: [
          'Turn each prefix into a power of ten before you divide. Micro is 10⁻⁶, milli is 10⁻³.',
          'Work in base units: 835(10⁻⁶) m over 46.0(10⁻³) s. Divide the numbers and subtract the exponents, then pick one prefix for the result. It has to sit in the numerator: mm/s, not μm/ms.',
          '835 ÷ 46.0 = 18.15…, and 10⁻⁶ / 10⁻³ = 10⁻³. So the speed is 18.15…(10⁻³) m/s. Now name that with a prefix and round.'
        ],
        margin: function (s) { var t = s.part('table'); return t && t.hole != null ? Math.round(Math.abs(t.hole - FAR_HOLE) / MM * 4) : 0; },
        onFail: function (ctx) {
          var t = ctx.yard && ctx.yard.built && ctx.yard.built.parts.table;
          if (!t || t.hole == null) return '';
          return 'The controller ran the table for ' + f3(t.tRun) + ' s. At its real ' + f3(FEED * 1000, 4) + ' mm/s that is ' + mm(t.hole, 2) + ' of travel instead of 465.00 mm.';
        },
        success: function (ctx) {
          var t = ctx.yard && ctx.yard.built && ctx.yard.built.parts.table, off = t ? t.hole - FAR_HOLE : 0;
          return 'The bolt drops through both holes. The new hole is ' + signedMm(off) + ' from the flange hole' + (Math.abs(off) > 0.5 * MM ? ': a three-figure feed already used up more than half of the 2 mm of play over 465 mm. A controller deserves more digits than a report does.' : '.');
        }
      },
      {
        id: 'P4.press',
        label: '**Press relief valve.** Set the pressure so the 127 mm ram pushes 15 % over the 483 kN punch load: $p = \\frac{1.15\\,(483\\u{ kN})}{\\frac{\\pi}{4}(127\\u{ mm})^{2}}$. The pump builds up to it; at the end of the stroke the ram pushes the full setting into the frame.',
        design: PRESS,
        yard: { camera: { fit: { lo: { x: -0.9, y: -0.05 }, hi: { x: 0.9, y: 1.75 } } } },
        timeout: 8,
        goal: G.all(
          G.never(function (s) { var p = s.part('press'); return p && p.frameBroken ? 'At the end of the stroke the ram pushed ' + kN(p.setForce) + ' into a frame rated 750 kN. It cracked at the throat.' : null; }),
          G.never(function (s) { var p = s.part('press'); return p && p.stalled ? 'The ram topped out at ' + kN(p.setForce) + ', short of the 483 kN the plate needs. The punch stalls halfway into the steel and has to be jacked back out.' : null; }),
          function (s) { var p = s.part('press'); return p && p.done ? 'pass' : null; }
        ),
        grade: { part: 'press', key: 'relief', spec: { value: RELIEF, unit: 'Pa', sf: 3, form: 'si' } },
        hints: [
          'The ram force is pressure times the piston area, so you need the area first. The exponent squares the prefix as well as the number: mm² means (mm)².',
          'Write the bore in metres, 0.127 m, square it and multiply by π/4 to get the area in m². Then p = 1.15 × 483 kN ÷ A, with the kilo turned into 10³ too.',
          'A = (π/4)(0.127 m)² = 0.012 67 m², and 1.15 × 483 kN = 555.45(10³) N. Divide and name the result with one prefix.'
        ],
        margin: function (s) { var p = s.part('press'); return p ? Math.round(Math.abs(p.setForce - MARGIN * PUNCH_F) / 10e3) : 0; },
        success: function (ctx) {
          var p = ctx.yard && ctx.yard.built && ctx.yard.built.parts.press;
          return 'The slug sheared out at 483 kN and the ram dead-headed at ' + (p ? kN(p.setForce) : '') + ', inside the frame\'s 750 kN. A clean hole.';
        }
      },
      {
        id: 'P4.cut',
        label: '**Scaffold cut list.** Round boards 3 (**2.065 m**) and 11 (**2.375 m**) to three significant figures. The crew cuts all 30 boards the way you did and lays the walk to the end post.',
        design: WALK,
        yard: { camera: { fit: { lo: { x: -6.5, y: -0.1 }, hi: { x: 0.8, y: 1.3 } } } },
        timeout: 8,
        goal: G.all(
          G.never(function (s) { var w = s.part('walk'); return w && !w.rule && s.t > 0.1 ? w.why : null; }),
          function (s) {
            var w = s.part('walk'); if (!w || !w.rule || s.t < 3.6) return null;
            var lb = w.last, ang = Math.abs(lb.angle) * 180 / Math.PI;
            if (ang > 0.5 || lb.c.y > w.boardY + 0.01) return { fail: 'The crew cut the pile with ' + RULE_TALK[w.rule] + '. The boards came out ' + signedMm(w.drift, 0) + ' against the posts, so the last board doesn\'t fit: it rides up on the end post. Hammering it in would split the post.' };
            if (w.probe && w.probe.c.y < w.boardY + 0.025 - 0.01) return { fail: 'The crew cut the pile with ' + RULE_TALK[w.rule] + '. The boards came out ' + signedMm(w.drift, 0) + ' short of the true run, which leaves a ' + mm(w.gap, 0) + ' gap at the end post. The boot heel dropped into it.' };
            return s.held('walk-ok', true, 0.3) ? 'pass' : null;
          }
        ),
        grade: { part: 'walk', key: 'board3', spec: { value: BOARD3, unit: 'm', sf: 3, form: 'any', exactRounding: true } },
        hints: [
          'In both readings the digit you drop is exactly 5, with nothing after it. That is the one case where "5 goes up" is not the course rule.',
          'For an exact 5, look at the digit in front of it. Even: leave it alone. Odd: round it up. Over a long cut list half the exact 5s go up and half go down, so the errors cancel.',
          'Board 3: keep 2.06, drop the 5; the 6 is even. Board 11: keep 2.37, drop the 5; the 7 is odd.'
        ],
        success: function (ctx) {
          var w = ctx.yard && ctx.yard.built && ctx.yard.built.parts.walk;
          return 'The last board drops in and the heel can\'t find a gap. Over 30 boards the course rule came out ' + (w ? signedMm(w.drift, 0) : '') + ': the exact 5s that went up and the ones that stayed down cancelled out.';
        }
      },
      {
        id: 'P4.stay',
        label: '**Crane stay bolt.** Set where the fitter drills, measured from the heel pin along the boom to node 7: $s = \\frac{7}{9}\\sqrt{h^{2} + r^{2}}$, **to the nearest millimetre**.',
        design: BOOM,
        yard: { camera: { fit: { lo: { x: -0.6, y: -0.1 }, hi: { x: 8.9, y: 2.2 } } } },
        timeout: 6,
        goal: function (s) {
          var bp = s.part('boom');
          if (bp && bp.offEnd && s.t > 0.1) return { fail: 'The mark is ' + mm(bp.drill, 0) + ' from the heel pin, but the boom is only ' + f3(BOOM_L, 4) + ' m long.' };
          return pinVerdict(s, 'boom', 'stay-pin', function (b) {
            return 'Drilled at ' + mm(b.drill, 0) + '; the stay\'s hole is ' + signedMm(b.drill - STAY, 1) + ' away, and the pin only goes through when they are within 0.5 mm. The pin won\'t go.' + (Math.abs(b.drill - STAY_SHEET) < 0.6 * MM ? ' That is exactly where the round-every-step sheet put it: six small roundings, ' + mm(STAY_SHEET - STAY, 1) + ' of error.' : '');
          });
        },
        grade: { part: 'boom', key: 'mark', spec: {
          value: STAY, unit: 'm', sf: 4, form: 'any', tol: 0.5 * MM / STAY,
          mistakes: [{ test: function (r) { return Math.abs(r * STAY - STAY_SHEET) < 0.6 * MM; }, kind: 'rounding', msg: 'That is the position you get by rounding every intermediate step to 3 s.f. Carry full precision through and round once, at the end.' }]
        } },
        hints: [
          'A millimetre on a length of a few metres is the fourth significant figure, so the usual three won\'t do. And the only rounding allowed is the last one.',
          'Boom length first: L = √(h² + r²). One bay is L/9, and node 7 is seven bays out. Keep every digit your calculator gives you until the very end.',
          'h² + r² = 15.3664 + 52.7076 = 68.0740, so L = 8.250 70 m. Now 7 × L / 9.'
        ],
        success: 'The pin slides home and the stay takes up the boom.'
      },
      {
        id: 'P4.area',
        label: '**Splice plate stamp.** Stamp the plate\'s area from the caliper readings, written to **only the figures the ±0.02 mm caliper justifies**. The inspector measures it again eight times before accepting the stamp.',
        design: GAUGE,
        yard: { camera: { fit: { lo: { x: -0.35, y: 0.6 }, hi: { x: 0.35, y: 1.2 } } } },
        timeout: 8,
        goal: function (s) {
          var g = s.part('gauge');
          if (!g || !g.verdict) return null;
          return g.verdict.pass ? 'pass' : { fail: g.verdict.why };
        },
        grade: { part: 'gauge', key: 'stamp', spec: { value: AREA.value * MM * MM, unit: 'm^2', sf: AREA_SF, form: 'any' } },
        hints: [
          'Each side is only known to ±0.02 mm, so the area is only known to some ± too. Work that out first, then decide how many digits of the area mean anything.',
          'For a product, relative uncertainties combine: u_A/A = √((0.02/112.46)² + (0.02/63.18)²). Multiply by A to get u_A, round u_A to one figure, and keep the area\'s digits down to that place.',
          'A = 112.46 × 63.18 = 7105.2228 mm². u_A/A ≈ 3.6(10⁻⁴), so u_A ≈ 2.6 mm², about ±3 mm². Which place does that make the last honest digit?'
        ],
        success: 'The eight readings scatter by a few square millimetres, and your stamp claims exactly that much. The inspector stamps the plate.'
      }
    ],

    solutions: {
      'P4.feed': [
        { set: { table: { feed: '18.2 mm/s' } } },
        { pass: false, set: { table: { feed: '18 mm/s' } } },
        { pass: false, set: { table: { feed: '18.2 μm/s' } } },
        { pass: false, set: { table: { feed: '18.2 m/s' } } }
      ],
      'P4.press': [
        { set: { press: { relief: '43.8 MPa' } } },
        { pass: false, set: { press: { relief: '43.8 kPa' } } },
        { pass: false, set: { press: { relief: '34.4 MPa' } } },
        { pass: false, set: { press: { relief: '62.0 MPa' } } }
      ],
      'P4.cut': [
        { set: { walk: { board3: '2.06 m', board11: '2.38 m' } } },
        { pass: false, set: { walk: { board3: '2.07 m', board11: '2.38 m' } } },
        { pass: false, set: { walk: { board3: '2.06 m', board11: '2.37 m' } } },
        { pass: false, set: { walk: { board3: '2.07 m', board11: '2.37 m' } } }
      ],
      'P4.stay': [
        { set: { boom: { mark: '6.417 m' } } },
        { pass: false, set: { boom: { mark: '6.420 m' } } },
        { pass: false, set: { boom: { mark: '6.417 mm' } } },
        { pass: false, set: { boom: { mark: '6.42 km' } } }
      ],
      'P4.area': [
        { set: { gauge: { stamp: '7105 mm^2' } } },
        { pass: false, set: { gauge: { stamp: '7105.2 mm^2' } } },
        { pass: false, set: { gauge: { stamp: '7.11(10^3) mm^2' } } },
        { pass: false, set: { gauge: { stamp: '7150 mm^2' } } }
      ]
    },

    deeper: [
      '**Uncertainty propagation.** A ±0.02 mm least count on both sides of the plate gives the area an uncertainty of about ±3 mm², so it carries 4 significant figures: not the default 3, and not the 8 the calculator shows. Watch the inspector\'s eight readings: the units digit wobbles, the tens digit never does.',
      '**Marking resolution.** A bolt hole has to be placed to the millimetre. On a 6 m boom that is a fourth significant figure, so the 3 s.f. convention for reported answers is not enough for a fabrication drawing.',
      '**Rounding early.** Rounding each step of the stay sheet to 3 s.f. moved the pin 2.8 mm, more than five times the hole\'s play. The same 3 s.f. feed rate used up over half of the punch table\'s 2 mm of play across 465 mm.',
      '**Rounding bias.** Over the 30-board pile, "always round 5 up" overran the posts by 83 mm and truncating left a 147 mm gap. The course rule, which sends exact 5s to the even digit, came out 13 mm long.',
      '**Dead-heading.** A ram set too high doesn\'t hurt the plate: the hole shears at 483 kN whatever the valve says. The damage comes at the end of the stroke, when the pump keeps going until it reaches the relief setting and all of it goes into the frame.'
    ],

    debrief: [
      'The bench is calibrated. The punch table, the press and the crane all ran on figures you gave them, and the splice plate went up with every bolt home.',
      'Two habits did the work. Convert prefixes to powers of ten, calculate, then name the answer with **one** prefix in the numerator. And keep every digit until the last line: the rounding goes on the report, never in the middle of the sum.',
      'The other lesson is the caliper\'s. A number is only as good as the instrument behind it, and the honest number of figures comes from the uncertainty, not from habit.'
    ].join('\n\n')
  });

  // ================================================================ parts
  // Bench machines for P4. Job scenery: not in the manual library.

  /*
   * Punch table. The plate rides on a carriage under a fixed punch; its datum
   * (right) edge starts under the punch. The controller runs the lead screw
   * for t = 465 mm / feed (the feed as typed); the screw really moves at the
   * jog-test speed. The punch fires where the table stopped, then the plate
   * is laid on the flange at the fit-up stand and a bolt is dropped in.
   */
  var PLATE_LEN = 0.52, FIT_X = 1.55;
  Y.definePart({
    type: 'p04-table', name: 'Punch table', category: 'Bench', library: false,
    blurb: 'A carriage on a lead screw under a fixed punch. The controller runs it for 465 mm ÷ feed, then punches.',
    size: { w: 1.4, h: 0.5 },
    dials: [{ key: 'feed', label: 'Feed rate', q: 'speed', def: '20.0 mm/s', min: 1e-12, max: 1e6 }],
    build: function (b) {
      var P = b.P, o = b.at({ x: 0, y: 0 }), part = b.inst.id, world = b.world;
      var feed = b.si('feed');
      b.body({ type: 'static', position: { x: o.x + 0.05, y: o.y - 0.05 }, label: 'bed', shapes: [{ shape: P.box(0.75, 0.05), material: 'steel', filter: { category: CAT_BENCH, mask: 0xFFFF } }] });
      b.body({ type: 'static', position: { x: o.x + TABLE_TRAVEL + 0.02, y: o.y + 0.04 }, label: 'end stop', shapes: [{ shape: P.box(0.02, 0.04), material: 'steel', filter: { category: CAT_BENCH, mask: 0xFFFF } }] });
      var carriage = b.body({ type: 'kinematic', position: { x: o.x - PLATE_LEN / 2, y: o.y + 0.015 }, label: 'carriage',
        shapes: [{ shape: P.box(PLATE_LEN / 2, 0.015), material: 'steel', filter: { category: CAT_BENCH, mask: 0xFFFF } }] });
      var punch = b.body({ type: 'kinematic', position: { x: o.x, y: o.y + 0.03 + 0.016 + 0.09 }, label: 'punch',
        shapes: [{ shape: P.box(HOLE / 2, 0.06), material: 'steel', filter: { category: CAT_BENCH, mask: 0 } }] });
      // fit-up stand: the old flange with its hole 465 mm from the datum edge
      var fy = o.y - 0.25, fx0 = o.x + FIT_X - PLATE_LEN, fx1 = o.x + FIT_X;
      b.body({ type: 'static', position: { x: (fx0 + fx1) / 2, y: fy - 0.11 }, label: 'trestle', shapes: [{ shape: P.box(0.02, 0.1, { x: -0.2, y: 0 }), material: 'timber' }, { shape: P.box(0.02, 0.1, { x: 0.2, y: 0 }), material: 'timber' }] });
      holedSlab(world, part, fx0, fx1, fy, 0.016, fx1 - FAR_HOLE, HOLE, 'steel');
      var built = { body: carriage, carriage: carriage, punch: punch, tRun: Math.min(1e7, FAR_HOLE / feed), hole: null, crashed: false, pin: null,
        origin: o, fit: { x0: fx0, x1: fx1, y: fy }, feed: feed };
      var punchY = punch.c.y, t0 = 0;
      b.on('step', function () {
        var t = world.time;
        if (built.hole == null) {
          var travel = FEED * Math.min(t, built.tRun);
          if (travel >= TABLE_TRAVEL) { travel = TABLE_TRAVEL; built.crashed = true; }
          carriage.setTransform({ x: o.x - PLATE_LEN / 2 + travel, y: carriage.position.y }, 0);
          carriage.v = { x: t < built.tRun && !built.crashed ? FEED : 0, y: 0 };
          built.travel = travel;
          if (t >= built.tRun && !built.crashed) { built.hole = travel; t0 = t; }
          return;
        }
        // punch stroke, then the fit-up
        var k = t - t0, dy = k < 0.2 ? -0.09 * k / 0.2 : k < 0.4 ? -0.09 * (0.4 - k) / 0.2 : 0;
        punch.setTransform({ x: punch.position.x, y: punchY + dy }, 0);
        if (k >= 0.5 && !built.pin) {
          built.plate = holedSlab(world, part, fx0, fx1, fy + 0.016, 0.016, fx1 - built.hole, HOLE, 'steel');
          built.pin = dropPin(world, part, { holeA: fx1 - FAR_HOLE, holeB: fx1 - built.hole, hole: HOLE, dia: BOLT, top: fy + 0.032, shank: 0.06, label: 'bolt', mass: 0.3 });
          built.pin.t0 = t;
        }
      });
      return built;
    },
    plate: function () { return ['Lead screw jog: 835 μm in 46.0 ms', 'Travel 500 mm to the end stop']; },
    readouts: function (built) {
      return [{ key: 'travel', label: 'table travel', q: 'length', read: function () { return built.travel || 0; } }];
    },
    draw: function (ctx, cam, built) {
      var o = built.origin, hole = built.hole;
      // plate on the carriage, with the punched hole once there is one
      var c = built.carriage, x1 = c.c.x + PLATE_LEN / 2, x0 = x1 - PLATE_LEN, y0 = o.y + 0.03;
      var a = cam.worldToScreen({ x: x0, y: y0 + 0.016 }), w = PLATE_LEN * cam.zoom, h = Math.max(2, 0.016 * cam.zoom);
      ctx.save(); ctx.fillStyle = '#8a9aa6'; ctx.fillRect(a.x, a.y, w, h);
      if (hole != null) { var hx = cam.worldToScreen({ x: x1 - hole - HOLE / 2, y: 0 }).x; ctx.clearRect(hx, a.y, HOLE * cam.zoom, h); ctx.fillStyle = '#1b1f23'; ctx.fillRect(hx, a.y, HOLE * cam.zoom, h); }
      ctx.restore();
      label(ctx, cam, { x: o.x - 0.62, y: o.y + 0.3 }, 'feed ' + (built.inst.dials.feed || '') + '  →  run ' + (built.tRun < 1e5 ? f3(built.tRun, 4) + ' s' : 'forever'));
      label(ctx, cam, { x: o.x - 0.62, y: o.y + 0.25 }, 'travel ' + mm(built.travel || 0, 2), 'rgba(230,180,34,.95)');
      label(ctx, cam, { x: built.fit.x0, y: built.fit.y + 0.1 }, 'fit-up: plate on the old flange');
      if (!built.pin) return;
      var F = built.fit, hA = F.x1 - FAR_HOLE, hB = F.x1 - hole, mid = (hA + hB) / 2;
      loupe(ctx, cam, {
        at: { x: mid, y: F.y + 0.03 }, zoom: 3200, title: 'bolt hole ×' + Math.round(3200 / cam.zoom),
        lines: ['new hole ' + signedMm(hole - FAR_HOLE) + ' off', 'opening ' + mm(Math.max(0, built.pin.opening)) + ' / bolt 22.00 mm'],
        draw: function (map) {
          map.rect(hA - 0.04, F.y, hA - HOLE / 2, F.y + 0.016, '#59646e'); map.rect(hA + HOLE / 2, F.y, hA + 0.04, F.y + 0.016, '#59646e');
          map.rect(hB - 0.04, F.y + 0.016, hB - HOLE / 2, F.y + 0.032, '#8a9aa6'); map.rect(hB + HOLE / 2, F.y + 0.016, hB + 0.04, F.y + 0.032, '#8a9aa6');
          map.body(built.pin.body, '#c9a227');
        }
      });
    }
  });

  /*
   * Hydraulic press. The pump raises the ram force at 250 kN/s up to the
   * relief setting times the real ram area. The slug is welded into the plate
   * with the shear load as its breaking force; the crown is welded to the
   * column with the frame rating. While the punch presses, the ram force acts
   * down on the slug and up on the crown; once the slug shears the punch runs
   * to the end of its stroke and dead-heads, and the pressure climbs to the
   * relief setting with the whole of it on the frame.
   */
  var RAMP = 250e3;
  Y.definePart({
    type: 'p04-press', name: 'Hydraulic press', category: 'Bench', library: false,
    blurb: 'A punch press on a salvaged 127 mm ram. Ram force = relief pressure × ram area.',
    size: { w: 1.2, h: 1.6 },
    dials: [{ key: 'relief', label: 'Relief pressure', q: 'pressure', def: '30.0 MPa', min: 0, max: 1e12 }],
    build: function (b) {
      var P = b.P, o = b.at({ x: 0, y: 0 }), world = b.world, part = b.inst.id;
      var setF = b.si('relief') * RAM_A;
      var bench = { category: CAT_BENCH, mask: 0xFFFF };
      // die block with a hole, and the plate on it
      holedSlab(world, part, o.x - 0.3, o.x + 0.3, o.y - 0.2, 0.2, o.x, HOLE + 0.004, 'steel');
      holedSlab(world, part, o.x - 0.3, o.x + 0.3, o.y, 0.016, o.x, HOLE, 'steel');
      b.body({ type: 'static', position: { x: o.x - 0.5, y: (o.y + 0.515) / 2 }, label: 'column', shapes: [{ shape: P.box(0.06, (o.y + 0.515) / 2), material: 'steel', filter: bench }] });
      var anchor = b.body({ type: 'static', position: { x: o.x, y: o.y + 0.6 }, label: '', shapes: [] });
      var crown = b.body({ position: { x: o.x - 0.17, y: o.y + 0.6 }, label: 'crown', gravityScale: 0, mass: 5000,
        shapes: [{ shape: P.box(0.4, 0.08), material: 'steel', filter: bench }] });
      var frameWeld = b.joint(new P.WeldJoint({ bodyA: anchor, bodyB: crown, worldAnchor: { x: o.x - 0.5, y: o.y + 0.6 }, breakForce: FRAME_RATING, label: 'frame' }));
      var slug = b.body({ position: { x: o.x, y: o.y + 0.008 }, label: 'slug', gravityScale: 0, mass: 2000,
        shapes: [{ shape: P.box(HOLE / 2, 0.008), material: 'steel', filter: { category: 1, mask: 1 } }] });
      var shear = b.joint(new P.WeldJoint({ bodyA: anchor, bodyB: slug, worldAnchor: { x: o.x, y: o.y + 0.008 }, breakForce: PUNCH_F, label: 'slug' }));
      var punch = b.body({ type: 'kinematic', position: { x: o.x, y: o.y + 0.016 + 0.03 + 0.1 }, label: 'punch',
        shapes: [{ shape: P.box(HOLE / 2, 0.1), material: 'steel', filter: { category: CAT_BENCH, mask: 0 } }] });
      var built = { body: crown, crown: crown, slug: slug, punch: punch, frameWeld: frameWeld, shear: shear, origin: o,
        setForce: setF, force: 0, phase: 'approach', frameBroken: false, stalled: false, done: false };
      var punchY0 = punch.c.y, tPhase = 0, reached = null;
      function frameIntact() { return world.joints.indexOf(frameWeld) >= 0; }
      b.on('step', function () {
        var t = world.time, dt = 1 / 60;
        if (!frameIntact()) {
          if (!built.frameBroken) { built.frameBroken = true; crown.gravityScale = 1; }
          built.force = 0;
          return;
        }
        if (built.phase === 'approach') {
          punch.setTransform({ x: o.x, y: punchY0 - Math.min(0.03, 0.1 * t) }, 0);
          if (t >= 0.3) { built.phase = 'press'; tPhase = t; }
        } else if (built.phase === 'press') {
          built.force = Math.min(setF, RAMP * (t - tPhase));
          if (world.joints.indexOf(shear) < 0) { built.phase = 'through'; tPhase = t; slug.gravityScale = 1; slug.applyForce({ x: 0, y: -built.force }, slug.c); return; }
          slug.applyForce({ x: 0, y: -built.force }, slug.c);
          crown.applyForce({ x: 0, y: built.force }, crown.c);
          if (built.force >= setF - 1e-6) { if (reached == null) reached = t; if (t - reached > 1.0) built.stalled = true; }
        } else if (built.phase === 'through') {
          // free stroke: 16 mm of plate and 2 mm of overtravel at 0.25 m/s, nothing to push
          var k = t - tPhase;
          punch.setTransform({ x: o.x, y: punchY0 - 0.03 - Math.min(0.018, 0.25 * k) }, 0);
          built.force = 0;
          if (0.25 * k >= 0.018) { built.phase = 'deadhead'; tPhase = t; }
        } else if (built.phase === 'deadhead') {
          built.force = Math.min(setF, RAMP * 2 * (t - tPhase));
          crown.applyForce({ x: 0, y: built.force }, crown.c);
          if (built.force >= setF - 1e-6) { if (reached == null || reached < tPhase) reached = t; if (t - reached > 0.5) { built.phase = 'done'; built.done = true; } }
        }
        void dt;
      });
      return built;
    },
    plate: function () { return ['Ram bore 127 mm', 'Punch load 483 kN · frame 750 kN']; },
    readouts: function (built) {
      return [
        { key: 'ram', label: 'ram force', q: 'force', read: function () { return built.force; } },
        { key: 'frame', label: 'frame load', q: 'force', read: function () { return built.frameBroken ? 0 : built.frameWeld.force(); } }
      ];
    },
    draw: function (ctx, cam, built) {
      var o = built.origin, cr = built.crown.c, pu = built.punch.c;
      var a = cam.worldToScreen({ x: o.x - 0.05, y: cr.y - 0.08 }), bb = cam.worldToScreen({ x: o.x + 0.05, y: pu.y + 0.1 });
      ctx.save(); ctx.fillStyle = 'rgba(120,140,160,.8)'; ctx.fillRect(a.x, a.y, bb.x - a.x, bb.y - a.y); ctx.restore();
      label(ctx, cam, { x: o.x + 0.12, y: o.y + 0.32 }, 'ram ' + kN(built.force), 'rgba(230,180,34,.95)');
      label(ctx, cam, { x: o.x + 0.12, y: o.y + 0.26 }, 'setting ' + kN(built.setForce));
      label(ctx, cam, { x: o.x + 0.12, y: o.y + 0.20 }, built.frameBroken ? 'FRAME CRACKED' : built.stalled ? 'STALLED' : built.phase === 'deadhead' || built.done ? 'dead-headed: all of it on the frame' : built.phase === 'through' ? 'slug out' : built.phase === 'press' ? 'pressing' : '', built.frameBroken || built.stalled ? '#e0644a' : undefined);
    }
  });

  /*
   * Scaffold walk. The crew infers your rounding rule from the two boards you
   * cut and cuts the whole pile with it. Boards 1-29 are nailed down end to
   * end from the left post; the last one is dropped into its slot, then a
   * boot heel is set down at the end post. The end post stands 40 mm clear of
   * the true run.
   */
  Y.definePart({
    type: 'p04-walk', name: 'Scaffold walk', category: 'Bench', library: false,
    blurb: 'Thirty boards laid end to end between two posts set at the true lengths, plus a 40 mm allowance at the end.',
    size: { w: 2, h: 1 },
    dials: [
      { key: 'board3', label: 'Board 3 cut', q: 'length', def: '2.065 m', min: 0.01, max: 100 },
      { key: 'board11', label: 'Board 11 cut', q: 'length', def: '2.375 m', min: 0.01, max: 100 }
    ],
    build: function (b) {
      var P = b.P, o = b.at({ x: 0, y: 0 }), world = b.world, part = b.inst.id;
      var r3 = rulesFor(BOARD3, b.si('board3')), r11 = rulesFor(BOARD11, b.si('board11'));
      var common = r3.filter(function (r) { return r11.indexOf(r) >= 0; });
      var built = { origin: o, boardY: o.y + 0.025, rule: common[0] || null, why: null };
      if (!r3.length || !r11.length) built.why = 'The crew can\'t cut from that: ' + (!r3.length ? 'board 3 (' + b.text('board3') + ')' : 'board 11 (' + b.text('board11') + ')') + ' is not ' + (!r3.length ? '2.065' : '2.375') + ' m rounded to three significant figures. They wait.';
      else if (!common.length) built.why = 'Your two cuts follow different rules, so the crew can\'t tell how to cut the other 28 boards. They wait.';
      var fd = B.fenceDrift(PILE, 3, built.rule || 'book');
      var x0 = o.x - ALLOW - fd.trueTotal;
      built.drift = fd.drift; built.gap = ALLOW - fd.drift; built.x0 = x0; built.cuts = fd.cuts;
      // bearer, posts
      b.body({ type: 'static', position: { x: (x0 - 0.3 + o.x + 0.3) / 2, y: o.y / 2 }, label: 'bearer', shapes: [{ shape: P.box((o.x + 0.3 - x0 + 0.3) / 2, o.y / 2), material: 'timber' }] });
      b.body({ type: 'static', position: { x: x0 - 0.06, y: (o.y + 0.3) / 2 }, label: 'post', shapes: [{ shape: P.box(0.06, (o.y + 0.3) / 2), material: 'timber' }] });
      b.body({ type: 'static', position: { x: o.x + 0.06, y: (o.y + 0.3) / 2 }, label: 'end post', shapes: [{ shape: P.box(0.06, (o.y + 0.3) / 2), material: 'timber' }] });
      if (!built.rule) return built;
      var x = x0;
      fd.cuts.forEach(function (c, i) {
        if (i < fd.cuts.length - 1) b.body({ type: 'static', position: { x: x + c / 2, y: o.y + 0.025 }, label: '', shapes: [{ shape: P.box(c / 2, 0.025), material: 'timber' }] });
        else built.slot = { x: x + 0.003, len: c };
        x += c;
      });
      built.end = x;
      var started = false;
      b.on('step', function () {
        var t = world.time;
        if (!started && t >= 0.4) {
          started = true;
          var s = built.slot, fitsIn = s.x + s.len <= o.x;
          built.last = world.add(new P.Body({ position: { x: s.x + s.len / 2, y: o.y + 0.025 + (fitsIn ? 0.004 : 0.3) }, label: 'board 30',
            shapes: [{ shape: P.box(s.len / 2, 0.025), material: 'timber' }] }));
          built.last.userData = { part: part };
        }
        if (built.last && !built.probe && t >= 2.2 && Math.abs(built.last.angle) < 0.01) {
          built.probe = world.add(new P.Body({ position: { x: o.x - HEEL / 2 - 0.001, y: o.y + 0.05 + 0.02 + 0.004 }, label: 'heel', fixedRotation: true,
            shapes: [{ shape: P.box(HEEL / 2, 0.02), material: 'rubber', friction: 0 }], mass: 2 }));
          built.probe.userData = { part: part };
        }
      });
      return built;
    },
    plate: function () { return ['30 boards, read to the mm, cut to 3 s.f.', 'End post 40 mm clear of the true run']; },
    readouts: function (built) {
      return [{ key: 'drift', label: 'cut total − true run', q: 'length', read: function () { return built.rule ? built.drift : 0; } }];
    },
    draw: function (ctx, cam, built) {
      var o = built.origin;
      label(ctx, cam, { x: o.x - 6.3, y: o.y + 0.75 }, built.rule ? 'crew cuts with: ' + ({ book: 'course rule', up: 'always 5 up', truncate: 'truncate' })[built.rule] : 'crew waiting for a cut list', 'rgba(230,180,34,.95)');
      if (built.rule) label(ctx, cam, { x: o.x - 6.3, y: o.y + 0.65 }, 'boards 1–29 nailed · total drift ' + signedMm(built.drift, 0));
      if (!built.last) return;
      loupe(ctx, cam, {
        at: { x: o.x - 0.03, y: o.y + 0.05 }, zoom: 900, title: 'end post ×' + Math.round(900 / cam.zoom),
        lines: [built.drift <= ALLOW ? 'gap at the post ' + mm(built.gap, 0) : 'overrun ' + mm(built.drift - ALLOW, 0), 'heel 60 mm'],
        draw: function (map) {
          map.rect(o.x - 0.2, o.y - 0.05, o.x + 0.1, o.y, '#6d5233');
          map.rect(o.x, o.y - 0.05, o.x + 0.12, o.y + 0.3, '#8c6b43');
          map.rect(built.slot.x - 0.2, o.y, built.slot.x - 0.003, o.y + 0.05, '#b38b59');
          map.body(built.last, '#c99f68');
          if (built.probe) map.body(built.probe, '#3c3c3c');
        }
      });
    }
  });

  /*
   * Crane boom laid on trestles for drilling. The fitter drills the stay hole
   * where the setting says, to the nearest millimetre. The stay's lug arrives
   * at the true node 7 and its pin is dropped in.
   */
  Y.definePart({
    type: 'p04-boom', name: 'Crane boom', category: 'Bench', library: false,
    blurb: 'The new boom on trestles. Node 7 gets the stay; the fitter drills where you say, to the millimetre.',
    size: { w: 8.4, h: 0.4 },
    dials: [{ key: 'mark', label: 'Drill at (from heel pin)', q: 'length', def: '6.42 m', min: 0, max: 1e6 }],
    build: function (b) {
      var P = b.P, o = b.at({ x: 0, y: 0 }), world = b.world, part = b.inst.id;
      var drill = Math.round(b.si('mark') / MM) * MM;
      var built = { origin: o, drill: drill, offEnd: drill > BOOM_L - 0.02, pin: null };
      b.body({ type: 'static', position: { x: o.x + 1.2, y: o.y / 2 - 0.03 }, label: 'trestle', shapes: [{ shape: P.box(0.05, o.y / 2 - 0.03), material: 'timber' }] });
      b.body({ type: 'static', position: { x: o.x + 7.2, y: o.y / 2 - 0.03 }, label: 'trestle', shapes: [{ shape: P.box(0.05, o.y / 2 - 0.03), material: 'timber' }] });
      // top chord (with the drilled hole) and the stay lug on it
      var top = o.y + 0.06;
      if (built.offEnd) { b.body({ type: 'static', position: { x: o.x + BOOM_L / 2, y: o.y + 0.03 }, label: 'boom', shapes: [{ shape: P.box(BOOM_L / 2, 0.03), material: 'steel' }] }); return built; }
      holedSlab(world, part, o.x, o.x + BOOM_L, o.y, 0.06, o.x + drill, PIN_HOLE, 'steel');
      holedSlab(world, part, o.x + STAY - 0.12, o.x + STAY + 0.12, top, 0.03, o.x + STAY, PIN_HOLE, 'steel');
      b.on('step', function () {
        var t = world.time;
        if (!built.pin && t >= 0.3) {
          built.pin = dropPin(world, part, { holeA: o.x + STAY, holeB: o.x + drill, hole: PIN_HOLE, dia: PIN, top: top + 0.03, shank: 0.11, label: 'stay pin', mass: 1.5 });
          built.pin.t0 = t;
        }
      });
      return built;
    },
    plate: function () { return ['Heel pin to tip ' + f3(BOOM_L, 4) + ' m, 9 bays', 'Stay pin 25.5 mm, holes 26 mm']; },
    draw: function (ctx, cam, built) {
      var o = built.origin;
      // stay rope up to the mast, and node ticks
      ctx.save(); ctx.strokeStyle = 'rgba(200,200,190,.7)'; ctx.lineWidth = 2;
      var a = cam.worldToScreen({ x: o.x + STAY, y: o.y + 0.12 }), m = cam.worldToScreen({ x: o.x + STAY - 1.5, y: o.y + 1.6 });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
      ctx.fillStyle = 'rgba(230,180,34,.9)';
      for (var i = 0; i <= CRANE.bays; i++) { var n = cam.worldToScreen({ x: o.x + i * BOOM_L / CRANE.bays, y: o.y }); ctx.fillRect(n.x - 1, n.y, 2, 6); }
      ctx.restore();
      label(ctx, cam, { x: o.x, y: o.y + 1.3 }, 'drill at ' + mm(built.drill, 0) + ' (marked to the mm)', 'rgba(230,180,34,.95)');
      if (!built.pin) return;
      loupe(ctx, cam, {
        at: { x: o.x + (STAY + built.drill) / 2, y: o.y + 0.07 }, zoom: 2400, title: 'node 7 ×' + Math.round(2400 / cam.zoom),
        lines: ['hole ' + signedMm(built.drill - STAY, 1) + ' from the stay', 'opening ' + mm(Math.max(0, built.pin.opening)) + ' / pin 25.50 mm'],
        draw: function (map) {
          var y = o.y, hs = o.x + STAY, hd = o.x + built.drill;
          map.rect(hd - 0.06, y + 0.02, hd - PIN_HOLE / 2, y + 0.06, '#59646e'); map.rect(hd + PIN_HOLE / 2, y + 0.02, hd + 0.06, y + 0.06, '#59646e');
          map.rect(hs - 0.06, y + 0.06, hs - PIN_HOLE / 2, y + 0.09, '#8a9aa6'); map.rect(hs + PIN_HOLE / 2, y + 0.06, hs + 0.06, y + 0.09, '#8a9aa6');
          map.body(built.pin.body, '#c9a227');
        }
      });
    }
  });

  /*
   * Inspection bench. The inspector closes the caliper on both sides of the
   * plate eight times. Each reading lands on the nearest 0.02 mm line, with a
   * little jaw-pressure and parallax scatter (fixed seed, so every run sees
   * the same eight). The stamp is accepted when it matches the readings and
   * its last digit sits exactly where the propagated uncertainty puts the
   * last honest digit.
   */
  var READS = (function () {
    var r = B.rng(41), out = [];
    for (var i = 0; i < 8; i++) {
      var a = B.vernierRead(PLATE_A + (r() - 0.5) * 0.026, RES).reading, bb = B.vernierRead(PLATE_B + (r() - 0.5) * 0.026, RES).reading;
      out.push({ a: a, b: bb, area: a * bb });
    }
    return out;
  })();
  function stampVerdict(text, si) {
    var areaMm = si / (MM * MM), p = SE.units.parseQuantity(text);
    var n = p && p.ok ? SE.sigfig.countSigFigs(p.number.mantissa) : null;
    if (!n || !(areaMm > 0)) return { pass: false, why: 'The stamp can\'t be read as a number of figures.' };
    var nf = n.min, place = Math.floor(Math.log10(areaMm) + 1e-12) - nf + 1;
    var u = AREA.abs, placeU = Math.floor(Math.log10(rs(u, 1).value) + 1e-12);
    var mean = READS.reduce(function (s, x) { return s + x.area; }, 0) / READS.length;
    var lo = Math.min.apply(null, READS.map(function (x) { return x.area; })), hi = Math.max.apply(null, READS.map(function (x) { return x.area; }));
    var spread = 'The eight readings run from ' + lo.toFixed(1) + ' to ' + hi.toFixed(1) + ' mm² (±' + f3(u, 2) + ' mm² from the caliper\'s ±0.02 mm).';
    if (Math.abs(areaMm - mean) > Math.max(2 * u, 0.5 * Math.pow(10, place))) return { pass: false, why: spread + ' Your stamp, ' + text + ', doesn\'t match them.' };
    if (place < placeU) return { pass: false, why: spread + ' You stamped ' + nf + ' figures, but the last of them changes from one reading to the next. The inspector won\'t stamp a digit the caliper can\'t back.' };
    if (place > placeU) return { pass: false, why: spread + ' You stamped only ' + nf + ' figures, throwing away a digit the caliper really did measure. The bolt-group check needs the units place.' };
    return { pass: true, why: spread };
  }
  Y.definePart({
    type: 'p04-gauge', name: 'Inspection bench', category: 'Bench', library: false,
    blurb: 'The splice plate, a vernier caliper reading to 0.02 mm, and the stamp you set.',
    size: { w: 0.6, h: 0.3 },
    dials: [{ key: 'stamp', label: 'Stamp (area)', q: 'area', def: '7105.2228 mm^2', min: 0, max: 1e6 }],
    build: function (b) {
      var P = b.P, o = b.at({ x: 0, y: 0 }), world = b.world;
      b.body({ type: 'static', position: { x: o.x, y: o.y / 2 - 0.01 }, label: 'bench', shapes: [{ shape: P.box(0.3, o.y / 2 - 0.01), material: 'timber' }] });
      var plate = b.body({ position: { x: o.x, y: o.y + 0.008 + 0.0005 }, label: 'splice plate', shapes: [{ shape: P.box(PLATE_A * MM / 2, 0.008), material: 'steel' }] });
      var built = { body: plate, plate: plate, origin: o, shown: 0, verdict: null };
      var text = b.text('stamp'), si = b.si('stamp');
      b.on('step', function () {
        var t = world.time;
        built.shown = Math.min(READS.length, Math.floor(t / 0.5));
        if (!built.verdict && t >= 0.5 * READS.length + 0.3) built.verdict = stampVerdict(text, si);
      });
      return built;
    },
    plate: function () { return ['Caliper least count 0.02 mm']; },
    readouts: function (built) {
      return [{ key: 'area', label: 'last reading', q: 'area', read: function () { return built.shown ? READS[built.shown - 1].area * MM * MM : 0; } }];
    },
    draw: function (ctx, cam, built) {
      var o = built.origin, k = built.shown;
      // caliper over the plate: jaws close on each reading
      var c = built.plate.c, half = PLATE_A * MM / 2;
      var phase = (built.plate && k < READS.length) ? 1 : 0;
      var jl = cam.worldToScreen({ x: c.x - half, y: c.y + 0.05 }), jr = cam.worldToScreen({ x: c.x + half + 0.002 * phase, y: c.y + 0.05 });
      ctx.save(); ctx.fillStyle = 'rgba(200,205,210,.9)';
      var bar = cam.worldToScreen({ x: c.x - half - 0.03, y: c.y + 0.07 });
      ctx.fillRect(bar.x, bar.y, (PLATE_A * MM + 0.09) * cam.zoom, 0.012 * cam.zoom);
      ctx.fillRect(jl.x - 4, jl.y, 4, 0.05 * cam.zoom); ctx.fillRect(jr.x, jr.y, 4, 0.05 * cam.zoom);
      ctx.restore();
      ctx.save(); ctx.font = '12px "IBM Plex Mono", monospace';
      var s0 = cam.worldToScreen({ x: o.x - 0.32, y: o.y + 0.27 });
      ctx.fillStyle = 'rgba(230,180,34,.95)'; ctx.fillText('stamp: ' + (built.inst.dials.stamp || ''), s0.x, s0.y);
      for (var i = 0; i < k; i++) {
        var r = READS[i];
        ctx.fillStyle = 'rgba(235,235,225,.95)';
        ctx.fillText((i + 1) + '.  ' + r.a.toFixed(2) + ' × ' + r.b.toFixed(2) + ' = ' + r.area.toFixed(4) + ' mm²', s0.x, s0.y + 16 * (i + 1));
      }
      if (built.verdict) { ctx.fillStyle = built.verdict.pass ? '#8fd16a' : '#e0644a'; ctx.fillText(built.verdict.pass ? 'STAMP ACCEPTED' : 'STAMP REJECTED', s0.x, s0.y + 16 * (READS.length + 1.3)); }
      ctx.restore();
    }
  });

  // the figures behind every job, for tests
  SE.content.chapter('ch01').projectMap.P4.keys = { FEED: FEED, RAM_A: RAM_A, RELIEF: RELIEF, STAY: STAY, STAY_SHEET: STAY_SHEET, AREA: AREA, AREA_SF: AREA_SF, READS: READS, stampVerdict: stampVerdict, PILE: PILE };
})(globalThis.SE);
