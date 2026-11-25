/*
 * H9 · Balance the Books: dimensional homogeneity. Every term of a physical
 * equation must carry the same units, which makes the units a quick (but
 * partial) check on algebra. Course section 1.5.
 *
 * Played in the build yard. The depot plow runs on a brake controller that
 * computes its braking from a formula typed into it. The controller plugs
 * the numbers in exactly as written, so a formula whose units don't balance
 * commands nonsense and the plow hits the barricade. The controller's plate
 * audits the units of every term, the run shows what the formula really does.
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, U = SE.units;
  var f3 = function (x) { return Y.dial.fmtNum(x, 3); };

  /* ------------------------------------------------- the brake controller */
  // Symbols the controller knows, and their units. v is read off the plow
  // as the run starts; s and t are dials.
  var SYMS = { s: 'm', v: 'm/s', t: 's' };
  var ACCEL = Y.dial.QUANTITIES.accel.dims;
  var SYM_DIMS = {};
  Object.keys(SYMS).forEach(function (k) { SYM_DIMS[k] = U.unitInfo(SYMS[k]).dims; });

  function unitText(d) {
    if (!d) return '?';
    var s = U.dimsToSI(d);
    return s ? s.replace('^2', '²').replace('^3', '³') : 'no units';
  }
  // Like SE.expr.toText, but a product or quotient under a division keeps
  // its brackets, so v^2/(2*s) doesn't print as v^2/2·s.
  function show(n) {
    if ((n.type === 'div' || n.type === 'mul') && n.l.type === 'neg') return '−' + show({ type: n.type, l: n.l.a, r: n.r });
    if (n.type === 'div') return wrap(n.l) + '/' + (['mul', 'div', 'sum', 'neg'].indexOf(n.r.type) >= 0 ? '(' + show(n.r) + ')' : wrap(n.r));
    if (n.type === 'mul') return wrap(n.l) + '·' + wrap(n.r);
    if (n.type === 'neg') return '−' + wrap(n.a);
    if (n.type === 'pow') return wrap(n.b) + '^' + wrap(n.e);
    if (n.type === 'fn') return n.f + '(' + show(n.a) + ')';
    if (n.type === 'sum') return n.terms.map(function (t, i) { return (i ? (t.sign < 0 ? ' − ' : ' + ') : (t.sign < 0 ? '−' : '')) + show(t.node); }).join('');
    return SE.expr.toText(n);
  }
  function wrap(n) { return n.type === 'sum' || n.type === 'neg' ? '(' + show(n) + ')' : show(n); }
  function termsOf(rhs) {
    var list = rhs.type === 'sum' ? rhs.terms : [{ node: rhs, sign: 1 }];
    return list.map(function (t) { var d = SE.expr.evalDims(t.node, SYM_DIMS, { problems: [] }); return { text: show(t.node), sign: t.sign, dims: d }; });
  }
  function varsIn(n, out) {
    out = out || {};
    if (!n) return out;
    if (n.type === 'var') out[n.name] = true;
    ['l', 'r', 'a', 'b', 'e'].forEach(function (k) { if (n[k] && typeof n[k] === 'object') varsIn(n[k], out); });
    if (n.terms) n.terms.forEach(function (t) { varsIn(t.node, out); });
    return out;
  }

  /*
   * Read a controller formula: 'a = 2*s/t^2 - 2*v/t' (or just the right side).
   * -> { ok, error, rhs (AST), terms: [{ text, sign, dims, units, ok }], dims,
   *      homogeneous (every term in m/s²), uses: { s, v, t } }
   */
  function audit(text) {
    var src = String(text == null ? '' : text).trim();
    if (!src) return { ok: false, error: 'Type a formula for a, e.g. a = -v/t.' };
    var ast;
    try { ast = SE.expr.parse(src); } catch (e) { return { ok: false, error: 'The controller can\'t read that formula: ' + e.message }; }
    var rhs = ast;
    if (ast.type === 'eq') {
      if (ast.l.type !== 'var' || ast.l.name !== 'a') return { ok: false, error: 'The controller sets the acceleration: start the formula with "a =".' };
      rhs = ast.r;
    }
    var uses = varsIn(rhs);
    var unknown = Object.keys(uses).filter(function (k) { return !SYMS[k]; });
    if (unknown.length) return { ok: false, error: 'The controller only knows s (stop distance), v (speed) and t (stop time), not ' + unknown.join(', ') + '.' };
    var terms = termsOf(rhs).map(function (t) {
      return { text: t.text, sign: t.sign, dims: t.dims, units: unitText(t.dims), ok: !!t.dims && U.dimsEqual(t.dims, ACCEL) };
    });
    var rep = { problems: [] }, dims = SE.expr.evalDims(rhs, SYM_DIMS, rep);
    var homogeneous = terms.every(function (t) { return t.ok; }) && !rep.problems.length;
    return { ok: true, rhs: rhs, terms: terms, dims: dims, homogeneous: homogeneous, uses: uses };
  }

  // Plate lines: the formula, the unit audit of each term, the command.
  function auditLines(text) {
    var A = audit(text);
    if (!A.ok) return ['Formula: ' + (text || '(none)'), A.error];
    var lines = ['a = ' + show(A.rhs)];
    A.terms.forEach(function (t, i) {
      lines.push('  ' + (i ? (t.sign < 0 ? '− ' : '+ ') : (t.sign < 0 ? '−' : '')) + t.text + '  →  ' + t.units + (t.ok ? '  ✔' : '  ✘'));
    });
    lines.push(A.homogeneous ? 'Every term in m/s²: balanced.' : 'Not all m/s²: units do not balance.');
    return lines;
  }

  Y.definePart({
    type: 'h09-controller', name: 'Brake controller', category: 'Controls', library: false,
    blurb: 'Brakes the cart it is clipped to by its formula for a, plugging in the numbers exactly as typed (negative brakes, positive drives).',
    size: { w: 0.6, h: 0.4 },
    connector: true, attach: true,
    dials: [
      { key: 'formula', label: 'Formula', q: 'text', def: 'a = -v/t' },
      { key: 's', label: 'Stop line ahead (s)', q: 'length', def: '25 m', min: 0.1, max: 500 },
      { key: 't', label: 'Stop over (t)', q: 'time', def: '5 s', min: 0.1, max: 120, optional: true },
      { key: 'rating', label: 'Brake ram rating', q: 'force', def: '50 kN', locked: true }
    ],
    build: function (b) {
      var end = b.end('a'), body = end.body, world = b.world;
      var A = audit(b.text('formula'));
      if (!A.ok) throw new Error(A.error);
      var T = b.si('t');
      if (A.uses.t && T == null) throw new Error('This formula uses t, so set the stop time.');
      var v0 = body.v.x;
      var a = SE.expr.evalNum(A.rhs, { s: b.si('s'), v: v0, t: T == null ? NaN : T });
      if (!isFinite(a)) throw new Error('The formula gives no number with these settings (a division by zero?).');
      var m = body.m, F = m * a, rating = b.si('rating');
      var built = { target: body, a: a, F: F, v0: v0, audit: A, rating: rating, blown: Math.abs(F) > rating, now: 0 };
      // Braking acts like a brake: it opposes the motion and never drives the
      // plow backwards, and it stays on once the plow has stopped. Driving
      // (a > 0) pushes forward, for the stop time if one is set.
      function apply(dt) {
        built.now = 0;
        if (built.blown || body.type !== 'dynamic') return;
        if (a >= 0) {
          if (T == null || world.time < T - 1e-9) { body.applyForce({ x: F, y: 0 }, body.c); built.now = F; }
          return;
        }
        var vx = body.v.x;
        if (Math.abs(vx) < 1e-12) return;
        var f = Math.min(-F, m * Math.abs(vx) / dt);
        body.applyForce({ x: -Math.sign(vx) * f, y: 0 }, body.c);
        built.now = -Math.sign(vx) * f;
      }
      apply(1 / 60);
      b.on('step', function (e) { apply(e.dt || 1 / 60); });
      return Object.assign(built, { body: null, bodies: [] });
    },
    plate: function (inst, built) {
      var lines = auditLines(inst.dials.formula);
      if (built && isFinite(built.a)) {
        lines.push('v = ' + f3(built.v0) + ' m/s → a = ' + (built.a > 0 ? '+' : '') + f3(built.a) + ' m/s²');
        if (built.blown) lines.push('Needs ' + f3(Math.abs(built.F) / 1000) + ' kN, ram rated ' + f3(built.rating / 1000) + ' kN: TOO MUCH');
      }
      return lines;
    },
    readouts: function (built) {
      return [
        { key: 'a', label: 'commanded a', q: 'accel', read: function () { return built.a; } },
        { key: 'force', label: 'ram force', q: 'force', read: function () { return built.now; } }
      ];
    },
    draw: function (ctx, cam, built) {
      var body = built.target; if (!body) return;
      var c = cam.worldToScreen(body.c);
      ctx.save();
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillStyle = built.blown ? '#ff6b5b' : (built.a > 0 ? '#ffb347' : '#9fd4ff');
      var tag = built.blown ? 'ram blown' : 'a = ' + (built.a > 0 ? '+' : '') + f3(built.a) + ' m/s²';
      ctx.fillText(tag, c.x - 40, c.y - 44);
      if (built.now) {
        var dir = built.now > 0 ? 1 : -1, len = 18 + Math.min(40, Math.abs(built.now) / 400);
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3;
        var x0 = c.x + dir * 4, x1 = x0 + dir * len;
        ctx.beginPath(); ctx.moveTo(x0, c.y); ctx.lineTo(x1, c.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1 + dir * 8, c.y); ctx.lineTo(x1, c.y - 5); ctx.lineTo(x1, c.y + 5); ctx.fill();
      }
      ctx.restore();
    }
  });

  /* ----------------------------------------------------------- the spurs */
  // The plow is a 4 t cart on greased rails. It comes past the marker at v
  // and has to stop with its centre inside the stop box, short of the
  // barricade. Its centre starts at x = 2 m.
  var M_PLOW = '4000 kg', X0 = 2;

  function spur(v, s) {
    var stop = X0 + s;
    return {
      v: v, s: s, stop: stop,
      box: { x0: stop - 0.5, x1: stop + 0.5 },
      site: { g: 9.81, floor: 'concrete' },
      camera: { fit: { lo: { x: -1, y: -1 }, hi: { x: stop + 4.5, y: 3 } } },
      poke: false,
      design: { parts: [
        { id: 'plow', type: 'cart', x: X0, y: 0.25, v: { x: v, y: 0 }, dials: { mass: M_PLOW }, locked: true, label: 'plow' },
        { id: 'line', type: 'zone', x: stop, y: 0.75, dials: { width: '1 m', height: '1.5 m' }, locked: true, label: 'stop box' },
        { id: 'barricade', type: 'block', x: stop + 3.1, y: 0.6, locked: true, label: 'barricade' }
      ] }
    };
  }
  // The depot spur: 10.0 m/s, stop line 25.0 m ahead, stop over 5.00 s.
  //   a = 2s/t^2 - 2v/t = 2(25.0)/5.00^2 - 2(10.0)/5.00 = 2.00 - 4.00 = -2.00 m/s^2
  //   the slip 2s/t - 2v/t^2 = 10.0 - 0.800 = +9.20 (m/s and m/s^3, not m/s^2)
  var DEPOT = spur(10, 25);
  // The long spur, no timer on the controller: 8.00 m/s, stop line 32.0 m.
  //   a = -v^2/(2s) = -64.0/64.0 = -1.00 m/s^2 (from v^2 = v0^2 + 2as with v = 0)
  //   the cab note -v/(2s) = -0.125, in 1/s; -v^2/s = -2.00 stops at 16.0 m
  var LONG = spur(8, 32);
  LONG.design.parts.push({ id: 'ctl', type: 'h09-controller', a: { part: 'plow' }, locked: true, open: ['formula'], hide: ['t'], label: 'long-spur controller',
    dials: { formula: 'a = -v/(2*s)', s: '32 m', t: '', rating: '50 kN' } });

  var SLIP = 'a = 2*s/t - 2*v/t^2';
  var CAB_NOTE = 'a = -v/(2*s)';

  function hitBarricade(s) {
    return s.impacts.filter(function (i) { return (i.a === 'plow' && i.b === 'barricade') || (i.a === 'barricade' && i.b === 'plow'); })[0] || null;
  }
  function ctlOf(s) {
    var ids = Object.keys(s.built.parts).filter(function (id) { return s.built.parts[id].def.type === 'h09-controller'; });
    return ids.length ? s.built.parts[ids[0]] : null;
  }
  // Plow at rest in the stop box, without touching the barricade.
  function stopGoal(sp, extra) {
    return G.all.apply(null, [
      G.never(function (s) { var hit = hitBarricade(s);
        if (!hit) return null;
        var c = ctlOf(s);
        return 'The plow hit the barricade at ' + f3(hit.speed) + ' m/s.' + (c && c.blown ? ' The controller had asked the brake ram for ' + f3(Math.abs(c.F) / 1000) + ' kN, more than its ' + f3(c.rating / 1000) + ' kN rating, and it blew its seals.' : ''); }),
      G.never(function (s) { var p = s.pos('plow'); return p && p.x < X0 - 1 ? 'The plow ran backwards off the marker.' : null; }),
      G.never(function (s) { var p = s.pos('plow'); return p && s.speed('plow') < 1e-3 && s.t > 0.2 && p.x < sp.box.x0 ? 'The plow stopped ' + f3(sp.box.x0 + 0.5 - p.x) + ' m short of the line.' : null; })
    ].concat(extra || []).concat([G.restIn('plow', sp.box, { maxSpeed: 0.02, hold: 0.5 })]));
  }
  var DEPOT_GOAL = stopGoal(DEPOT);
  // The long spur also wants a balanced formula, checked once the plow has
  // stopped, so a broken one still gets to show what it does.
  var LONG_STOP = stopGoal(LONG);
  function LONG_GOAL(s) {
    var c = ctlOf(s);
    if (!c) return { fail: 'The plow needs its controller.' };
    var v = Y.verdict(LONG_STOP(s));
    if (v && v.pass && !c.audit.homogeneous) return { fail: 'The plow stopped in the box, but the depot won\'t sign off a controller whose formula doesn\'t balance. Check the unit audit on its plate.' };
    return v ? (v.pass ? 'pass' : { fail: v.reason }) : null;
  }

  function ctlInst(ctx) { return ctx.all('h09-controller').filter(function (p) { return p.a && p.a.part === 'plow'; })[0] || null; }
  function ctlBuilt(ctx) { var i = ctlInst(ctx); return i && ctx.built.parts[i.id]; }
  function lastA(ctx) { var b = ctlBuilt(ctx); return b ? b.a : NaN; }
  function plowX(ctx) { var p = ctx.result && ctx.result.state.pos('plow'); return p ? p.x : NaN; }

  // Commanded a for a formula on the depot spur (headless, for checks and text).
  function commandFor(formula, sp, t) {
    var A = audit(formula); if (!A.ok) return NaN;
    try { return SE.expr.evalNum(A.rhs, { s: sp.s, v: sp.v, t: t == null ? 5 : t }); } catch (e) { return NaN; }
  }

  SE.content.registerLevel('ch01', {
    id: 'H9', order: 9, title: 'Balance the Books',
    subtitle: 'Dimensional homogeneity',
    sections: ['1.5'],
    minutes: 20,
    pitch: 'The depot plow brakes by whatever formula is typed into its controller. Make the units balance, then make it stop on the line.',
    objective: 'Stop the plow on the line with a formula that balances',
    intro: [
      'The depot plow has no working speedometer and a brake controller that the last driver described as "moody". Hask has the logbook open on the hood.',
      '"Quartermaster won\'t let you add bolts to litres in her ledger, and physics won\'t let you add metres to seconds. Every term of a real equation is in the same currency. Learn to check that, and you\'ll catch half your algebra mistakes before they catch you."'
    ].join('\n\n'),
    goals: [
      'Check that every term of an equation has the same units',
      'Use homogeneity to test a rearrangement, such as solving $s = v t + \\frac{1}{2}a t^2$ for *a*',
      'Show that Eq. 1–2 gives a force in newtons',
      'Explain why a homogeneous equation can still be wrong'
    ],
    yard: DEPOT,
    api: { audit: audit, auditLines: auditLines, DEPOT: DEPOT, LONG: LONG, SLIP: SLIP, CAB_NOTE: CAB_NOTE, goals: { depot: DEPOT_GOAL, long: LONG_GOAL } },
    unlocks: { tools: ['dimcheck'], formulas: ['ch01.homogeneity'], materials: [] },
    solutions: {
      'H9.governor': [
        { set: { ctl: { formula: 'a = -v^2/(2*s)' } } },
        { set: { ctl: { formula: 'a = -(v*v)/(2*s)' } } },
        // half the braking from the controller, the other half from a hand ram: 2 kN back for 8 s
        { set: { ctl: { formula: 'a = -v^2/(4*s)' } }, add: [{ type: 'push', a: { part: 'plow' }, dials: { force: '2 kN', angle: '180 deg', time: '8 s' } }] },
        // the controller only holds it once stopped; two hand rams do all the braking
        { set: { ctl: { formula: 'a = -v^2/(1000*s)' } }, add: [
          { type: 'push', a: { part: 'plow' }, dials: { force: '2 kN', angle: '180 deg', time: '8 s' } },
          { type: 'push', a: { part: 'plow' }, dials: { force: '2 kN', angle: '180 deg', time: '8 s' } }] },
        { pass: false, set: { ctl: { formula: 'a = -v^2/s' } } },
        { pass: false, set: { ctl: { formula: 'a = -1' } } },
        { pass: false, set: { ctl: { formula: 'a = v^2/(2*s)' } } }
      ]
    },
    steps: [
      {
        type: 'build', who: 'hask',
        yard: { bin: [{ type: 'h09-controller', count: 1, dials: { formula: SLIP, s: '25 m', t: '5 s' } }] },
        objective: 'Clip the brake controller onto the plow',
        brief: 'The plow comes in at 10 m/s and its controller brakes by formula. Clip the **Brake controller** from the bin onto the plow.',
        text: 'The plow comes down the depot spur at **10 m/s**. Its brake controller reads the speed *v* as the plow passes the marker, then drives a brake ram to give whatever acceleration *a* its formula works out. The stop line is **25 m** ahead, and the controller should take **5 s** to stop.\n\nSomebody rewired it last week and typed the formula in from memory. The controller doesn\'t know physics. It plugs the numbers in, in SI, and does exactly what it gets.\n\nTake the **Brake controller** from the bin and click the plow to clip it on. Select it and look at its dials: the formula as it was typed in, **s = 25 m** and **t = 5 s**.',
        goalText: 'Controller clipped onto the plow',
        until: function (ctx) { return !!ctlInst(ctx) || (ctx.find('h09-controller') ? 'Clip it onto the **plow**.' : false); }
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DEPOT_GOAL, timeout: 20 },
        objective: 'Run the plow on the formula as typed',
        brief: 'Press **▶ Run** and watch the plow and the **commanded a** gauge.',
        text: 'Press **▶ Run** and watch the plow, and the **commanded a** gauge.',
        goalText: 'Run it',
        until: function (ctx, type) { return type === 'result' && !!ctx.result; },
        after: function (ctx) {
          var a = lastA(ctx);
          return 'The controller commanded **a = ' + (a > 0 ? '+' : '') + f3(a) + ' m/s²**. ' + (a > 0 ? 'Positive is *forward*: it drove the plow into the barricade instead of braking.' : 'That was not the stop it needed.') + ' Select the controller and read the **unit audit** on its plate.';
        }
      },
      {
        type: 'build', who: 'hask',
        yard: { keep: true, goal: DEPOT_GOAL, timeout: 20 },
        objective: 'Fix the formula so the plow stops in the box',
        brief: 'The audit says the terms are m/s and m/s³, not m/s². Solve $s = v t + \\frac{1}{2}a t^2$ for *a*, type it in and run.',
        text: 'The audit puts each symbol\'s units in place of the symbol: *s* in m, *v* in m/s, *t* in s. The first term, 2s/t, comes out in **m/s**, a speed. The second, 2v/t², comes out in **m/s³**. Neither is an acceleration, and you can\'t even subtract one from the other. No number in front could fix that.\n\nRebuild the formula yourself. Start from where the plow is after time *t*, braking steadily from speed *v*:\n\n$s = v t + \\frac{1}{2}a t^2$\n\nSolve it for *a*, type it into the controller (use `*`, `/` and `^`, e.g. `a = 3*s/t^2`), check the audit, and run it.',
        goalText: 'The plow stops in the stop box',
        until: function (ctx, type) {
          if (type !== 'result' || !ctx.result) return false;
          if (ctx.result.pass) return true;
          var b = ctlBuilt(ctx);
          return b && !b.audit.homogeneous ? 'The audit still shows terms that aren\'t m/s². Fix the units first.' : 'The units balance now, but the plow still missed. Check the algebra: subtract *vt* first, then multiply both sides by 2/t².';
        },
        hint: 'Subtract *vt* from both sides: $\\frac{1}{2}a t^2 = s - v t$. Multiply both sides by $\\frac{2}{t^2}$: `a = 2*s/t^2 - 2*v/t`.',
        after: function (ctx) { return 'It commanded **' + f3(lastA(ctx)) + ' m/s²** and the plow stopped on the line, at **x = ' + f3(plowX(ctx)) + ' m**.'; }
      },
      {
        type: 'rule', title: 'Every term in the same units',
        brief: 'The slip mixed m/s and m/s³ and came out as full throttle. Your formula is m/s² term by term, and the minus sign brakes.',
        law: 's = v t + \\frac{1}{2}a t^{2} \\quad \\Rightarrow \\quad \\u{m} = \\u{(m/s)·s} + \\u{(m/s^2)·s^2} = \\u{m} + \\u{m}',
        eq: function () {
          return [
            'a = \\frac{2s}{t^2} - \\frac{2v}{t} \\quad \\Rightarrow \\quad \\u{m/s^2} = \\frac{\\u{m}}{\\u{s^2}} - \\frac{\\u{m/s}}{\\u{s}} = \\u{m/s^2} - \\u{m/s^2}',
            'a = \\frac{2(25.0)}{5.00^2} - \\frac{2(10.0)}{5.00} = 2.00 - 4.00 = ' + f3(commandFor('a = 2*s/t^2 - 2*v/t', DEPOT)) + '\\u{ m/s^2}'
          ];
        },
        text: function () { return 'The slip, **2s/t − 2v/t²**, had its powers of *t* swapped. Its terms came out in m/s and m/s³, and the controller turned that into **+9.20 m/s²**, full throttle. The fixed formula balances term by term, and the minus sign tells the ram to brake. The ½ and the 2 are pure numbers: they change the value of a term, never its units.'; }
      },
      {
        type: 'reveal', kicker: 'Principle', title: 'Dimensional homogeneity',
        brief: 'Every term of a real equation has the same units. Check it after every algebra step. The **dimension checker** (key **d**) is now in the workshop.',
        eq: 's = v t + \\frac{1}{2}a t^{2}',
        text: 'An equation that models something real has to be **dimensionally homogeneous**: every term carries the **same units**. Only then can the terms be added once numbers go in.\n\nAfter every algebra step, check the equation still balances. It catches a lot of slips before they reach the plow.\n\nThe workshop now has a **dimension checker** (key **d**) that audits any equation the way the controller does.',
        formula: 'ch01.homogeneity',
        unlock: 'dimcheck'
      },
      {
        type: 'watch', who: 'hask',
        yard: { keep: true, goal: DEPOT_GOAL, timeout: 20 },
        objective: 'Crash the plow with a formula that balances',
        brief: 'Type `a = 2*s/t^2 + 2*v/t` or `a = s/t^2 - v/t`. Both balance. Run one.',
        text: 'Now try two slips the audit **can\'t** see. Type either of these, read the audit, and run it:\n\n- the minus sign dropped: `a = 2*s/t^2 + 2*v/t`\n- the ½ forgotten: `a = s/t^2 - v/t`',
        goalText: 'A balanced formula that still misses',
        until: function (ctx, type) {
          var i = ctlInst(ctx), A = i && audit(i.dials.formula);
          if (!A || !A.ok) return false;
          if (!A.homogeneous) return 'That one doesn\'t balance. Pick a formula whose audit says **balanced**.';
          if (Math.abs(commandFor(i.dials.formula, DEPOT) + 2) < 0.01) return 'That one is right. Try one of the two slips.';
          return type === 'result' && !!ctx.result && !ctx.result.pass;
        },
        after: function (ctx) {
          var a = lastA(ctx);
          return 'Every term in m/s², the audit said balanced, and it commanded **' + (a > 0 ? '+' : '') + f3(a) + ' m/s²**. ' + (a > 0 ? 'A sign has no units, so a missing minus slips straight through.' : 'Half the braking: ½ and 1 are both pure numbers, and units can\'t see numbers.') + '\n\nHomogeneity is a **partial** check. It catches mistakes in units and powers. It can\'t catch a wrong number in front, a wrong sign, or a wrong term that happens to have the right units. The run catches those.';
        }
      },
      {
        type: 'reveal', kicker: 'Same check, bigger formula', title: 'Why G has such odd units',
        brief: '*G* carries whatever units make Eq. 1–2 come out in newtons: m³/(kg·s²).',
        eq: 'F = G\\frac{m_1 m_2}{r^2} \\quad \\Rightarrow \\quad \\frac{\\u{m^3}}{\\u{kg·s^2}} \\cdot \\frac{\\u{kg·kg}}{\\u{m^2}} = \\u{kg·m/s^2} = \\u{N}',
        text: 'Newton\'s law of gravitation (Eq. 1–2) has to give a force, so *G* carries whatever units make that happen: $\\u{m^3/(kg·s^2)}$. Two of its three metres cancel the r², one kilogram cancels one of the two masses, and what is left is kg·m/s², exactly a newton.\n\nThat is also how to remember a constant\'s units: they are whatever makes the equation balance.'
      },
      {
        type: 'job', id: 'H9.governor', who: 'juno',
        yard: { design: LONG.design, camera: LONG.camera, site: LONG.site, bin: [{ type: 'push', count: 2, label: 'Hand ram', dials: { force: '1 kN', angle: '180 deg', time: '4 s' } }] },
        objective: 'Stop the plow in the box. The controller\'s formula must balance',
        brief: 'This controller has no timer: just s = 32 m and v = 8 m/s. Its cab-note formula doesn\'t balance. Fix it, or share the braking with the hand rams.',
        text: 'The long spur\'s controller has **no timer**, only the distance to the line, **s = 32 m**, and the speed it reads, **8 m/s**. Its formula was copied off a cab note: `a = -v/(2*s)`.\n\nRead its audit, fix the formula so the plow stops in the box, and run it. The depot won\'t run a controller whose units don\'t balance, so `a = -1` won\'t do.\n\nYou also have two **hand rams** (pushes) you can clip on the plow. Any mix that stops the plow in the box counts.',
        goalText: 'Plow at rest in the stop box, formula balanced',
        goal: LONG_GOAL,
        timeout: 30,
        onFail: function (ctx) { var x = plowX(ctx); return isFinite(x) ? 'The plow\'s centre ended at **x = ' + f3(x) + ' m**. The stop box runs from ' + f3(LONG.box.x0) + ' m to ' + f3(LONG.box.x1) + ' m.' : ''; },
        hints: [
          'The cab note, v/(2s), comes out in (m/s)/m = **1/s**. You need m/s². Which way of combining *v* and *s* gives m/s²?',
          'v²/s does: (m²/s²)/m = m/s². So the formula is $a = -C\\frac{v^2}{s}$ for some pure number *C* that the units can\'t tell you. Try one and let the run tell you if it\'s too much or too little.',
          'With $v^2 = v_0^2 + 2as$ and the plow ending at rest, $a = -\\frac{v_0^2}{2s}$: `a = -v^2/(2*s)`, which is **−1.00 m/s²** here.'
        ],
        margin: function (s) { var p = s.pos('plow'); return p ? Math.round(Math.min(10, Math.abs(p.x - LONG.stop) * 20)) : 0; },
        success: 'Stopped on the line. The units gave you the **form**, v²/s. They could never give you the ½: the run did that.'
      },
      {
        type: 'free', who: 'hask',
        yard: { design: DEPOT.design, bin: [{ type: 'h09-controller', count: 1, dials: { formula: SLIP, s: '25 m', t: '5 s' } }, { type: 'push', count: 3, label: 'Hand ram' }, { type: 'speedo' }], goal: DEPOT_GOAL, timeout: 20, poke: false },
        objective: 'Stop the plow on the depot line, any way you like',
        brief: 'The depot spur is yours: a fresh controller, hand rams and a speed gauge.',
        text: 'The depot spur is yours, with a fresh controller, three hand rams and a speed gauge.',
        prompts: [
          'Try `a = -v/t`. It balances. Does it stop on the line in 5 s? Why do these numbers make it agree with the long-spur formula?',
          'Try `a = -v^2/(2*s)` here. Then set **t = 4 s** with `a = 2*s/t^2 - 2*v/t`. What does the plow do?',
          'Make the formula ask for more than the 50 kN ram can give, and watch what happens to the brake.'
        ]
      },
      {
        type: 'deeper', title: 'Equations from units alone',
        teaser: 'On the long spur the units found v²/s for you. Sometimes units are enough to find the whole equation, up to a pure number.',
        steps: [
          { type: 'say', who: 'hask', text: 'A pendulum\'s period *T* (s) could depend on the bob\'s mass *m* (kg), the string length *L* (m) and *g* (m/s²). Suppose $T = C m^{x} L^{y} g^{z}$ with *C* a pure number. The right side has to come out in seconds:\n\n$\\u{s} = \\u{kg}^{x} \\u{m}^{y+z} \\u{s}^{-2z}$\n\nNothing else has kilograms, so *x* = 0: the mass doesn\'t matter. Seconds need −2*z* = 1, so *z* = −½. Metres must cancel, so *y* = ½. That gives $T = C\\sqrt{L/g}$. A full analysis says C = 2π, which units could never tell you.' },
          { type: 'say', who: 'hask', text: 'This is the idea behind the **Buckingham π theorem**, which engineers use to plan experiments and scale models before any theory exists. It also tells you, for free, that a string 4 times longer doubles the period.' }
        ]
      },
      {
        type: 'summary',
        points: [
          'Every term of a physical equation must have the **same units** (dimensional homogeneity). Only then can the terms be combined numerically.',
          '$s = v t + \\frac{1}{2}a t^2$ is in metres term by term. Solved for *a*, $a = \\frac{2s}{t^2} - \\frac{2v}{t}$ is in m/s² term by term.',
          'Eq. 1–2 with $G$ in $\\u{m^3/(kg·s^2)}$ gives kg·m/s², a newton.',
          'Homogeneity is a **partial** check: pure numbers (½ vs 1), signs and wrong-but-same-unit terms slip through. Test the answer too.'
        ]
      }
    ]
  });
})(globalThis.SE);
