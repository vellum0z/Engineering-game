/*
 * P3 · Controller Labels (manual project, build yard). SI prefixes and the
 * rules for writing SI units, course section 1.4.
 *
 * The depot crane's controller was rebuilt after the fire, and its firmware is
 * strict: it parses every panel label literally and runs the crane on what it
 * read. Each job is one replacement label, typed onto a label plate in the
 * yard, and a test bay where the crane runs on it:
 *
 *   swl     safe working load   the overload trip: lift the generator, refuse the sled
 *   travel  hook travel         the upper limit: stop the block at the loft door
 *   creep   creep speed         the set-down speed: land the glass-lined tank
 *   rate    cable spring rate   the pretension: take the weight before the latch lets go
 *   brake   accumulator         the brake's holding force: keep the generator up
 *   delay   brake set time      the motor-to-brake handover: nothing drops
 *
 * A wrong value makes the crane do exactly what it read. A right value in an
 * illegal form (cm, a prefix under the fraction bar, a number outside
 * 0.1–1000, the wrong count of figures for the field) is refused by the
 * firmware and the crane locks out.
 *
 * Beyond the book: the surviving plates are pre-SI and use the kilogram-force,
 * which is DEFINED with standard gravity (1 kgf = 9.806 65 N exactly), not the
 * local g of the site. The site conditions give a local g on purpose.
 *
 * Parts defined here (job scenery, not in the library):
 *   p03-label-<slot>  a label plate for one controller field
 *   p03-crane         a gantry hoist whose controller runs one duty on the labels
 */
(function (SE) {
  'use strict';
  var Y = SE.yard, G = Y.goals, D = Y.dial;

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

  // Loads on the test rig
  var GEN = 3050;               // generator skid, kg (under the SWL)
  var SLED = 3400;              // overload test sled, kg (over the SWL)
  var BLOCK = 2400;             // general cargo block, kg
  var TANK = 2400;              // glass-lined water tank, kg (fragile)

  var BURST = 10e6;             // accumulator burst disc, Pa
  var BRAKE_HOLD = 1.5 * SWL;   // brake holding force at the plate pressure, N
  var THERMAL = 30;             // s the motor may hold at stall
  var CRACK = 0.1;              // m/s: the tank's glass lining cracks above this landing speed
  var HEAD_GAP = 0.4;           // m between the travel limit and the gantry head
  var CREEP_H = 0.3;            // m: the fast lower stops this far up, creep does the rest

  function fmt(v, unit, sf) { return D.format(v, unit, sf || 3); }

  /* ------------------------------------------------------------ labels */

  // One plate per controller field. `fig` is the field's figure count: the
  // firmware stores the label exactly, so a field printed for 4 figures
  // refuses 3 and refuses 5.
  var SLOTS = {
    swl:    { name: 'Safe working load', q: 'force',     fig: 4, def: '' },
    travel: { name: 'Hook travel',       q: 'length',    fig: 3, def: TRAVEL_CM + ' cm' },
    creep:  { name: 'Creep speed',       q: 'speed',     fig: 3, def: '' },
    rate:   { name: 'Cable spring rate', q: 'stiffness', fig: 3, def: STIFF_N_PER_MM + ' N/mm' },
    brake:  { name: 'Brake accumulator', q: 'pressure',  fig: 3, def: '' },
    delay:  { name: 'Brake set time',    q: 'time',      fig: 4, def: BRAKE_DELAY_MS + ' ms' }
  };

  // What the firmware makes of a label: { ok, v (SI), text } or { ok: false, why }.
  function firmwareRead(text, slot) {
    var S = SLOTS[slot], raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, why: 'the ' + S.name.toLowerCase() + ' field is blank.' };
    var q = SE.units.parseQuantity(raw);
    if (!q.ok) return { ok: false, why: 'it can\'t read "' + raw + '".' };
    var r = SE.checker.check(raw, { value: q.value, dims: q.dims, sf: S.fig, form: 'si' });
    if (!r.parts.units) return { ok: false, why: '"' + raw + '" is the wrong kind of quantity for this field.' };
    var bad = r.errors.filter(function (e) { return e.kind === 'form'; })[0];
    if (bad) return { ok: false, why: '"' + raw + '": ' + bad.msg };
    if (!r.parts.sigfigs) return { ok: false, why: '"' + raw + '" does not fit the field, which is printed for ' + S.fig + ' significant figures.' };
    return { ok: true, v: q.value, text: raw };
  }

  Object.keys(SLOTS).forEach(function (slot) {
    var S = SLOTS[slot];
    Y.definePart({
      type: 'p03-label-' + slot, name: S.name + ' label', category: 'Controller', library: false,
      blurb: 'A blank label plate for the controller\'s ' + S.name.toLowerCase() + ' field (' + S.fig + ' figures). The firmware reads it exactly as typed.',
      size: { w: 2.4, h: 0.9 },
      dials: [{ key: 'label', label: S.name, q: S.q, def: S.def }],
      build: function (b) {
        var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), label: '', shapes: [{ shape: b.P.box(1.2, 0.45), sensor: true }] });
        return { body: body, slot: slot, read: firmwareRead(b.text('label'), slot) };
      },
      plate: function (inst) { return [S.name + ' · ' + S.fig + ' figures']; },
      draw: function (ctx, cam, built) {
        var c = cam.worldToScreen(built.body.c), w = 2.4 * cam.zoom, h = 0.9 * cam.zoom, r = built.read;
        ctx.save();
        ctx.fillStyle = '#1d2226'; ctx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
        ctx.strokeStyle = r.ok ? '#78be50' : '#d0552f'; ctx.lineWidth = 2; ctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h);
        ctx.fillStyle = '#a7a29a'; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(S.name.toUpperCase(), c.x, c.y - h / 2 + 14);
        ctx.fillStyle = r.ok ? '#d6f2c4' : '#f2b8a4'; ctx.font = 'bold 15px "IBM Plex Mono", monospace';
        ctx.fillText(built.inst.dials.label || '— blank —', c.x, c.y + 4);
        ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = r.ok ? '#78be50' : '#d0552f';
        ctx.fillText(r.ok ? 'ACCEPTED' : 'REFUSED', c.x, c.y + h / 2 - 7);
        ctx.restore();
      }
    });
  });

  /* ------------------------------------------------------------- crane */

  // The gantry hoist. Its drum is a point on the gantry head (a = ground),
  // its hook end the load (b). The controller runs one duty on the label in
  // its slot; if the firmware refused that label the winch never energises.
  var DUTY_SLOT = { lift: 'swl', travel: 'travel', setdown: 'creep', pretension: 'rate', brake: 'brake', handover: 'delay' };

  Y.definePart({
    type: 'p03-crane', name: 'Depot crane', category: 'Controller', library: false,
    blurb: 'The depot gantry crane. Its controller runs a test duty on the label plates and does exactly what they say.',
    size: { w: 0.4, h: 0.4 },
    connector: true,
    dials: [
      { key: 'duty', label: 'Test duty', choice: Object.keys(DUTY_SLOT), def: 'lift' },
      { key: 'motor', label: 'Motor pull', q: 'force', def: '60 kN', min: 0 },
      { key: 'rating', label: 'Line breaking load', q: 'force', def: '40 kN', min: 1 },
      { key: 'load', label: 'Rated load on the ticket', q: 'mass', def: BLOCK + ' kg', min: 1 }
    ],
    build: function (b) {
      var A = b.end('a'), B = b.end('b'), P = b.P, world = b.world;
      var duty = b.text('duty'), slot = DUTY_SLOT[duty], g = b.site.g;
      var plate = null;
      Object.keys(b.out.parts).forEach(function (id) { var p = b.out.parts[id]; if (p.slot === slot) plate = p; });
      var read = plate ? plate.read : { ok: false, why: 'there is no ' + SLOTS[slot].name.toLowerCase() + ' label on the panel.' };
      // the drum gets its own body, so the load still collides with the deck and the gantry
      var drum = b.body({ type: 'static', position: A.world, label: '', shapes: [{ shape: P.circle(0.15), sensor: true }] });
      var line = new P.WinchJoint({ bodyA: drum, localAnchorA: { x: 0, y: 0 }, bodyB: B.body, localAnchorB: B.local,
        reelSpeed: 0, brake: true, maxPull: b.si('motor'), breakForce: b.si('rating'), label: b.inst.label || 'hoist line' });
      b.joint(line);
      var L0 = line.length, W = b.si('load') * g, v = read.ok ? Math.abs(read.v) : 0;
      var ctl = { duty: duty, halted: read.ok ? null : read.why, value: read.ok ? read.v : null, tripped: false,
        released: false, burnt: false, burst: false, done: false, note: '', L0: L0, y0: B.world.y, over: 0 };
      var latch = null;

      if (!ctl.halted) {
        if (duty === 'lift') {
          // a stretchy hoist rope (200 kN/m as rigged) and a slow take-up, so the
          // load cell sees the tension build before the load leaves the deck
          line.EA = 200e3 * L0; line.reelSpeed = 0.1; line.accel = 0.2; line.minLength = Math.max(0.2, L0 - 2.2);
        }
        if (duty === 'travel') { line.reelSpeed = 0.8; line.accel = 0.4; line.minLength = Math.max(0.2, L0 - v); }
        if (duty === 'setdown') { line.maxLength = L0 + CREEP_H + 0.5; }
        if (duty === 'pretension') {
          ctl.need = W / STIFF; ctl.wind = W / Math.max(v, 1e-12);
          line.EA = STIFF * L0;
          latch = b.joint(new P.WeldJoint({ bodyA: b.ground, bodyB: B.body, worldAnchor: B.world }));
        }
        if (duty === 'brake') {
          ctl.burst = v > BURST;
          line.brakeForce = ctl.burst ? 0 : BRAKE_HOLD * v / BRAKE_P;
          ctl.hold = line.brakeForce;
        }
        if (duty === 'handover') { line.brake = false; ctl.brakeAt = 0.5 + DELAY; ctl.motorOffAt = 0.5 + v; }
      }

      b.on('step', function (e) {
        var t = world.time;
        if (ctl.halted || line.broken) return;
        if (duty === 'pretension') line.EA = STIFF * line.length;   // the plate rate, whatever line is out
        if (duty === 'lift') {
          if (!ctl.tripped && line.lineTension() > v) { ctl.tripped = true; line.reelSpeed = 0; line.speed = 0; }
          if (!ctl.tripped && line.reelSpeed > 0) {
            // clear of the deck: speed up; near the top: back to a crawl so the stop doesn't snatch
            // two-speed take-up: fast until the load cell reads 70 % of the label, then a crawl
            if (line.length - line.minLength < 0.35) line.reelSpeed = 0.02;
            else if (B.body.c.y > ctl.y0 - 0.5 + 0.02) { line.reelSpeed = 0.25; line.accel = 0.1; }
            else if (line.lineTension() > 0.7 * v) line.reelSpeed = 0.02;
          }
          if (line.length <= line.minLength + 1e-6) { line.reelSpeed = 0; ctl.done = true; }
        }
        if (duty === 'travel' && line.length <= line.minLength + 1e-6) { line.reelSpeed = 0; ctl.done = true; }
        if (duty === 'setdown') {
          if (t >= 0.5 && !ctl.done) line.reelSpeed = -v;
          if (line.length >= line.maxLength - 1e-6) { line.reelSpeed = 0; ctl.done = true; }
        }
        if (duty === 'pretension' && !ctl.released) {
          if (t >= 0.3) line.reelSpeed = 0.5;
          if (L0 - line.length >= ctl.wind - 1e-9) {
            line.reelSpeed = 0; line.speed = 0;
            world.removeJoint(latch); ctl.released = true; ctl.releasedAt = t; ctl.yRelease = B.body.c.y;
          }
        }
        if (duty === 'handover') {
          if (t >= ctl.brakeAt - 1e-9 && !line.brake) { line.brake = true; line.brakeForce = BRAKE_HOLD; }
          if (t >= ctl.motorOffAt - 1e-9 && !ctl.released) { ctl.released = true; line.maxPull = 0; }
          if (!ctl.released && t >= 0.5 + THERMAL) { ctl.burnt = true; ctl.released = true; line.maxPull = 0; }
        }
      });
      return { joint: line, ctl: ctl, load: B.body };
    },
    readouts: function (built) {
      var j = built.joint;
      return [
        { key: 'tension', label: 'tension', q: 'force', read: function () { return j.broken ? 0 : j.lineTension(); } },
        { key: 'lineOut', label: 'out', q: 'length', read: function () { return j.lineOut(); } }
      ];
    },
    plate: function (inst) { return ['Line breaks at ' + inst.dials.rating, 'Motor ' + inst.dials.motor]; },
    draw: function (ctx, cam, built) {
      var c = built.ctl, A = built.joint.anchorA(), s = cam.worldToScreen(A);
      ctx.save();
      ctx.fillStyle = '#3b4148'; ctx.fillRect(s.x - 14, s.y - 10, 28, 20);
      ctx.font = 'bold 12px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
      var msg = c.halted ? 'FIRMWARE HALT' : c.burnt ? 'MOTOR BURNT OUT' : c.tripped ? 'OVERLOAD TRIP' : c.burst ? 'BURST DISC GONE' : '';
      if (msg) { ctx.fillStyle = '#f2b8a4'; ctx.fillText(msg, s.x + 20, s.y + 4); }
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------ bays */

  // A gantry bay: legs, the head beam, a deck, the crane and its load.
  // `head` is the y of the drum; the beam sits just under it.
  function bay(o) {
    var x = o.x || 0, parts = [];
    parts.push({ id: o.id + 'Head', type: 'block', x: x, y: o.head + 0.1, dials: { width: '3 m', height: '0.4 m' }, locked: true, label: 'gantry head' });
    parts.push({ id: o.id + 'LegL', type: 'block', x: x - 1.7, y: (o.head + 0.3) / 2, dials: { width: '0.3 m', height: (o.head + 0.3).toFixed(2) + ' m' }, locked: true, label: 'leg' });
    parts.push({ id: o.id + 'LegR', type: 'block', x: x + 1.7, y: (o.head + 0.3) / 2, dials: { width: '0.3 m', height: (o.head + 0.3).toFixed(2) + ' m' }, locked: true, label: 'leg' });
    parts.push({ id: o.load, type: 'crate', x: x, y: o.loadY, dials: { mass: o.mass + ' kg' }, locked: true, label: o.loadLabel });
    parts.push({ id: o.id, type: 'p03-crane', a: { part: 'ground', at: { x: x, y: o.head - 0.1 } }, b: { part: o.load, anchor: 'top' },
      dials: Object.assign({ duty: o.duty, load: o.mass + ' kg' }, o.dials || {}), locked: true, label: o.label || 'hoist line' });
    return parts;
  }
  function plateAt(slot, x, y) {
    return { id: 'label', type: 'p03-label-' + slot, x: x, y: y, dials: { label: SLOTS[slot].def }, locked: true, open: ['label'], label: SLOTS[slot].name + ' label' };
  }
  function design() { var parts = []; Array.prototype.slice.call(arguments).forEach(function (a) { parts = parts.concat(a); }); return { parts: parts }; }
  function cam(lo, hi) { return { fit: { lo: lo, hi: hi } }; }

  // Head heights: lifts start from the deck (crate centre at 0.5 m).
  var HEAD_TRAVEL = 0.5 + 0.5 + TRAVEL + HEAD_GAP + 0.1 + 0.1;   // beam bottom = crate top at the true limit + gap

  /* ------------------------------------------------------------ goals */

  function ctl(s, id) { var p = s.part(id); return p ? p.ctl : null; }
  function firmware(id, what) {
    return G.never(function (s) { var c = ctl(s, id); return c && c.halted ? '**FIRMWARE HALT** on the ' + what + ' label: ' + c.halted + ' The controller locks the winch out and the crane sits dead.' : null; });
  }
  function rise(s, id) { var c = ctl(s, id), p = s.pos(id === 'craneA' ? 'gen' : id === 'craneB' ? 'sled' : 'load'); return p ? p.y - c.y0 + 0.5 : 0; }
  function loadY(s, load) { var p = s.pos(load); return p ? p.y : 0; }

  var swlGoal = G.all(
    firmware('craneA', 'safe working load'),
    G.noBreaks(null, 'The overload sled was lifted past what the line can carry, and the line parted. The label let it through.'),
    G.never(function (s) { return loadY(s, 'sled') > 0.5 + 0.3 ? 'The overload sled (' + fmt(SLED * G_LOCAL, 'kN', 4) + ') is off the deck. The firmware should have refused it.' : null; }),
    G.holdFor('genUp', function (s) { return loadY(s, 'gen') > 0.5 + 1.9 && s.speed('gen') < 0.02; }, 0.5),
    G.holdFor('sledDown', function (s) { return s.t > 3 && loadY(s, 'sled') < 0.6 && s.speed('sled') < 0.02; }, 0.5)
  );

  var travelGoal = G.all(
    firmware('crane', 'hook travel'),
    G.noBreaks(null, 'The block hit the gantry head and the winch kept pulling until the line parted.'),
    G.never(function (s) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'load' && i.b === 'craneHead') || (i.b === 'load' && i.a === 'craneHead'); })[0];
      return hit ? 'The controller thought it had ' + fmt(ctl(s, 'crane').value, 'm') + ' of travel. The block hit the gantry head at ' + hit.speed.toFixed(2) + ' m/s.' : null;
    }),
    G.holdFor('atDoor', function (s) { var y = loadY(s, 'load') - 0.5; return y > TRAVEL - 0.1 && y < TRAVEL + 0.1 && s.speed('load') < 0.02; }, 0.5)
  );

  var creepGoal = G.all(
    firmware('crane', 'creep speed'),
    G.noBreaks(),
    G.never(function (s) {
      var hit = s.impacts.filter(function (i) { return (i.a === 'load' || i.b === 'load') && i.speed > CRACK; })[0];
      return hit ? 'The tank landed at ' + hit.speed.toFixed(2) + ' m/s and its glass lining cracked. The controller read the creep speed as ' + fmt(Math.abs(ctl(s, 'crane').value), D.autoUnit(Math.abs(ctl(s, 'crane').value), 'speed')) + '.' : null;
    }),
    G.holdFor('landed', function (s) { return loadY(s, 'load') < 0.52 && s.speed('load') < 0.01; }, 0.5)
  );

  var MOVE = 0.02;   // m the latched block may move when the latch lets go
  var rateGoal = G.all(
    firmware('crane', 'spring rate'),
    G.noBreaks(null, null),
    G.never(function (s) {
      var c = ctl(s, 'crane');
      if (!c || !c.released) return null;
      var d = loadY(s, 'load') - c.yRelease;
      if (d > MOVE) return 'Read as ' + fmt(c.value, D.autoUnit(c.value, 'stiffness')) + ', the controller wound in ' + fmt(c.wind, 'm') + ' of stretch. When the latch let go, the block jerked ' + fmt(d, 'mm') + ' upward.';
      if (d < -MOVE) return 'Read as ' + fmt(c.value, D.autoUnit(c.value, 'stiffness')) + ', the controller wound in only ' + fmt(c.wind, 'mm') + '. When the latch let go, the block dropped ' + fmt(-d, 'mm') + ' onto the cable.';
      return null;
    }),
    G.holdFor('steady', function (s) { var c = ctl(s, 'crane'); return c && c.released && s.t - c.releasedAt > 0.1; }, 2)
  );

  var brakeGoal = G.all(
    firmware('crane', 'brake pressure'),
    G.noBreaks(),
    G.never(function (s) {
      var c = ctl(s, 'crane');
      if (!c) return null;
      var drop = s.memo.y0 == null ? (s.memo.y0 = loadY(s, 'load'), 0) : s.memo.y0 - loadY(s, 'load');
      if (drop < 0.05) return null;
      if (c.burst) return 'The pump chased ' + fmt(c.value, 'MPa') + ', blew the ' + BURST / 1e6 + ' MPa burst disc and the brake let go. The generator is falling.';
      return 'At ' + fmt(c.value, D.autoUnit(c.value, 'pressure')) + ' the brake holds only ' + fmt(c.hold, 'kN') + ' against the generator\'s ' + fmt(GEN * G_LOCAL, 'kN') + '. It is sliding through the brake.';
    }),
    G.after(4)
  );

  var delayGoal = G.all(
    firmware('crane', 'brake set time'),
    G.noBreaks(),
    G.never(function (s) { var c = ctl(s, 'crane'); return c && c.burnt ? 'The brake set at ' + DELAY + ' s, but the motor kept holding: it read the set time as ' + fmt(c.value, 's', 4) + '. Past its ' + THERMAL + ' s thermal limit, the windings cooked.' : null; }),
    G.never(function (s) {
      var c = ctl(s, 'crane');
      var drop = s.memo.y0 == null ? (s.memo.y0 = loadY(s, 'load'), 0) : s.memo.y0 - loadY(s, 'load');
      if (drop < 0.05) return null;
      return 'The motor let go after ' + fmt(c.value, 's', 4) + ', with the brake still ' + fmt(Math.max(DELAY - c.value, 0), 's') + ' from setting. The block is falling.';
    }),
    G.holdFor('handedOver', function (s) { var c = ctl(s, 'crane'); return c && c.released && !c.burnt && s.t > Math.max(c.brakeAt, c.motorOffAt) + 0.2; }, 1)
  );

  // Why a run timed out, told from what the crane's controller did.
  function whyNot(ctx, id) {
    var st = ctx.result && ctx.result.state, c = st && ctl(st, id);
    if (!c || c.halted || ctx.result.time < 1) return '';
    var unit = D.autoUnit(Math.abs(c.value), SLOTS[DUTY_SLOT[c.duty]].q);
    if (c.duty === 'lift' && c.tripped) return 'The controller read a safe working load of ' + fmt(c.value, unit, 4) + ' and tripped as soon as the load cell went past it.';
    if (c.duty === 'travel' && c.done) return 'The controller stopped the winch after ' + fmt(c.value, unit) + ' of travel. The loft door is at ' + TRAVEL + ' m.';
    if (c.duty === 'setdown') {
      var v = Math.abs(c.value), t = CREEP_H / Math.max(v, 1e-12);
      return 'At ' + fmt(v, 'm/s') + ' the last ' + CREEP_H + ' m takes ' + (t < 7200 ? (t / 60).toFixed(0) + ' min' : (t / 3600).toFixed(0) + ' h') + '. The crew gives up and the dead don\'t.';
    }
    return '';
  }

  /* ------------------------------------------------------------ the project */

  // Every job's yard: a crane bay, the label plate to the left, the panel's
  // other plates already done or not part of this test.
  var JOB_DESIGNS = {
    swl: design(
      plateAt('swl', -7, 3),
      bay({ id: 'craneA', x: -2.5, head: 5, load: 'gen', loadY: 0.5, mass: GEN, loadLabel: 'generator', duty: 'lift', label: 'generator hoist', dials: { rating: '32.5 kN' } }),
      bay({ id: 'craneB', x: 2.5, head: 5, load: 'sled', loadY: 0.5, mass: SLED, loadLabel: 'overload sled', duty: 'lift', label: 'sled hoist', dials: { rating: '32.5 kN' } })
    ),
    travel: design(
      plateAt('travel', -5, 3),
      bay({ id: 'crane', x: 0, head: HEAD_TRAVEL, load: 'load', loadY: 0.5, mass: BLOCK, loadLabel: 'cargo block', duty: 'travel' }),
      [{ id: 'door', type: 'zone', x: 2.6, y: TRAVEL + 1, dials: { width: '1.4 m', height: '1 m' }, locked: true, label: 'loft door' }]
    ),
    creep: design(
      plateAt('creep', -5, 3),
      bay({ id: 'crane', x: 0, head: 5, load: 'load', loadY: 0.5 + CREEP_H, mass: TANK, loadLabel: 'glass-lined tank', duty: 'setdown' })
    ),
    rate: design(
      plateAt('rate', -5, 3),
      bay({ id: 'crane', x: 0, head: 8, load: 'load', loadY: 3.5, mass: BLOCK, loadLabel: 'cargo block (latched)', duty: 'pretension' })
    ),
    brake: design(
      plateAt('brake', -5, 3),
      bay({ id: 'crane', x: 0, head: 6, load: 'load', loadY: 3.5, mass: GEN, loadLabel: 'generator', duty: 'brake', dials: { rating: '50 kN' } })
    ),
    delay: design(
      plateAt('delay', -5, 3),
      bay({ id: 'crane', x: 0, head: 6, load: 'load', loadY: 3.5, mass: BLOCK, loadLabel: 'cargo block', duty: 'handover', dials: { rating: '50 kN' } })
    )
  };
  var SITE = { g: G_LOCAL, floor: 'concrete' };

  function job(slot, o) {
    return Object.assign({
      id: 'P3.' + slot, design: JOB_DESIGNS[slot],
      yard: { camera: o.camera, site: SITE },
      grade: { part: 'label', key: 'label', spec: o.spec },
      onFail: function (ctx) { return whyNot(ctx, slot === 'swl' ? 'craneA' : 'crane'); },
      success: function (ctx) {
        var inst = ctx.yard.inst('label'), r = SE.checker.check(inst ? inst.dials.label : '', o.spec);
        return o.ok + (r.correct ? '' : ' The job works, but the inspector won\'t pass the label itself: ' + (r.feedback || 'it is off in its last figure.'));
      }
    }, o);
  }
  function set(text) { return { label: { label: text } }; }
  // A second way: the label is legal but does less, and the player's own
  // parts do the work (a winch of their own, or a prop under the load).
  function ownWinch(x, y, load, dials) {
    return [{ id: 'myHook', type: 'hook', x: x, y: y }, { id: 'myWinch', type: 'winch', a: { part: 'myHook', anchor: 'eye' }, b: { part: load, anchor: 'top' }, dials: dials }];
  }
  function prop(x, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ id: 'prop' + i, type: 'crate', x: x, y: 0.5 + i, dials: { mass: '100 kg' } });
    return out;
  }

  SE.content.registerProject('ch01', {
    id: 'P3', order: 3,
    title: 'Controller Labels',
    subtitle: 'Relabel the depot crane after the fire',
    objective: 'Six labels the strict firmware accepts and the crane obeys',
    pitch: 'The crane\'s new firmware runs on its panel labels, exactly as written. Write each one in proper SI, run its test bay, and make the crane behave. How you get the job done is up to you; the label just has to be right.',
    brief: [
      'The fire in the north shed took the crane\'s control panel with it. Pell rebuilt the controller from salvage, and the firmware he flashed onto it is the strict kind: it reads every label **exactly as written** and runs the winch on what it read. A label it doesn\'t like, it refuses, and the crane locks out.',
      'The old cast plates survived, more or less. They\'re pre-war, in **kilogram-force** and **centimetres**, and some of the numbers came off the old controller\'s logs in awkward prefixes. I need six new labels in **proper SI**: one prefix, the number between 0.1 and 1000, no prefix under a fraction bar unless it\'s the kilogram. Each field is printed for a set number of figures, and the firmware won\'t take more or fewer.',
      'Each job is one label plate in a test bay. Type the label on the plate, run the bay, and watch the crane do what it read. Nothing goes on the panel until it passes the rig.'
    ].join('\n\n'),
    conditions: [
      'Site: Rustline Depot, latitude ' + LAT + '° N, ' + ALT + ' m above sea level. Local g measured at **' + G_LOCAL.toFixed(5) + ' m/s²**.',
      'Plate stamp: "SAFE WORKING LOAD **' + SWL_KGF + ' kgf**" (manufacturer\'s figure, 4 s.f.). Field: 4 figures.',
      'Plate stamp: "HOOK TRAVEL **' + TRAVEL_CM + ' cm**". Field: 3 figures.',
      'Old log: hook encoder pays out **' + ENC_STEP_UM + ' μm** of cable per tick, one tick every **' + ENC_TICK_MS.toFixed(1) + ' ms** at creep. Field: 3 figures.',
      'Old log: cable spring rate **' + STIFF_N_PER_MM + ' N/mm**. Field: 3 figures.',
      'Plate stamp: "BRAKE ACCUMULATOR **' + BRAKE_KGF_CM2 + ' kgf/cm²**". Accumulator burst disc: 10 MPa. Field: 3 figures.',
      'Old log: brake set time **' + BRAKE_DELAY_MS + ' ms** (4 s.f.). Winch motor thermal limit: ' + THERMAL + ' s holding at stall. Field: 4 figures.',
      'The firmware stores labels in SI only and treats the figure count as part of the label.'
    ],
    lockedTools: ['converter'],
    yard: { site: SITE, design: JOB_DESIGNS.swl, camera: cam({ x: -9, y: -1 }, { x: 5, y: 6.5 }) },
    jobs: [
      job('swl', {
        objective: 'Label the SWL: generator goes up, overload sled stays down',
        label: 'The old plate says **' + SWL_KGF + ' kgf**. Type the new label on the plate (4 figures) and run the bay.',
        camera: cam({ x: -9, y: -1 }, { x: 5, y: 6.5 }),
        goal: swlGoal, timeout: 20,
        answer: '31.19 kN',
        wrong: [{ input: '31.20 kN', kind: 'concept' }, { input: '31.17 kN', kind: 'concept' }, { input: '31.19 N', kind: 'prefix' }, { input: '31185 N', kind: 'sigfig' }, { input: '31.2 kN', kind: 'concept' }],
        // 1 kgf is defined as 9.806 65 N, whatever the local g.
        // 3180 × 9.806 65 = 31 185.147 N → 31.19 kN (4 s.f.).
        // Using 9.81: 31 195.8 N → 31.20 kN. Using local g 9.80157: 31 169.0 N → 31.17 kN.
        spec: {
          value: SWL, unit: 'N', sf: 4, form: 'si', tol: 0.0002,
          mistakes: [
            { ratio: 9.81 / G0, tol: 0.00025, kind: 'concept', msg: 'That matches using g = 9.81 m/s². The kilogram-force is defined with standard gravity, 9.806 65 m/s² exactly, and at the 4 figures this label needs the difference shows.' },
            { ratio: G_LOCAL / G0, tol: 0.00025, kind: 'concept', msg: 'You used the local g. A kgf is a defined unit (9.806 65 N), not the weight of a kilogram wherever you happen to be.' }
          ]
        },
        hints: [
          'A kilogram-force is a *force*: the label needs newtons. Which value of g defines it?',
          'The kgf is defined with **standard gravity**, 1 kgf = 9.806 65 N exactly. Multiply, then choose the prefix that puts the number between 0.1 and 1000, and keep 4 figures.',
          '3180 × 9.806 65 = 31 185.1 N = 31.1851(10³) N. Four figures with the kilo prefix: **31.19 kN**.'
        ],
        ok: 'The generator is up and the ' + fmt(SLED * G_LOCAL, 'kN', 4) + ' overload sled never left the deck.'
      }),
      job('travel', {
        objective: 'Label the travel and stop the block at the loft door',
        label: 'The old plate says **' + TRAVEL_CM + ' cm**. The gantry head is only ' + HEAD_GAP + ' m above the loft door.',
        camera: cam({ x: -7, y: -1 }, { x: 4, y: HEAD_TRAVEL + 1 }),
        goal: travelGoal, timeout: 25,
        answer: '7.35 m',
        wrong: [{ input: '735 cm', kind: 'form' }, { input: '7350 mm', kind: 'sigfig' }, { input: '7.35 km', kind: 'prefix' }, { input: '73.5 m', kind: 'prefix' }],
        // 735 cm = 735 × 10⁻² m = 7.35 m. The centi prefix is not used in engineering labels.
        spec: { value: TRAVEL, unit: 'm', sf: 3, form: 'si' },
        hints: [
          'The firmware won\'t take centi. Which engineering prefixes are left that suit a few metres?',
          'Centi is 10⁻². Convert to metres first, then check the number lands between 0.1 and 1000.',
          '735 cm = 735(10⁻²) m = **7.35 m**. (7350 mm has the right value but breaks the range rule.)'
        ],
        ok: 'The block stopped level with the loft door, clear of the gantry head.'
      }),
      job('creep', {
        objective: 'Label the creep speed and land the tank uncracked',
        label: 'The encoder log says **' + ENC_STEP_UM + ' μm per tick, one tick every ' + ENC_TICK_MS.toFixed(1) + ' ms**. The tank cracks above ' + CRACK + ' m/s.',
        camera: cam({ x: -7, y: -1 }, { x: 4, y: 6 }),
        goal: creepGoal, timeout: 41,
        answer: '13.9 mm/s',
        wrong: [{ input: '13.9 μm/ms', kind: 'form' }, { input: '0.0139 m/s', kind: 'form' }, { input: '13.9 m/s', kind: 'prefix' }, { input: '13.9 μm/s', kind: 'prefix' }],
        // v = 527 μm / 38.0 ms = 527(10⁻⁶) m / 38.0(10⁻³) s = 13.868(10⁻³) m/s → 13.9 mm/s.
        // The prefix goes on the numerator only: mm/s, not μm/ms.
        spec: { value: CREEP, unit: 'm/s', sf: 3, form: 'si' },
        hints: [
          'Speed is distance over time. Can a label keep a prefix under the fraction bar?',
          'Rewrite both prefixes as powers of ten, divide in base units, then put one prefix back on the numerator.',
          '527(10⁻⁶) m ÷ 38.0(10⁻³) s = 13.9(10⁻³) m/s = **13.9 mm/s**.'
        ],
        ok: 'The tank settled onto the deck at a walking-pace creep. Not a mark on the lining.'
      }),
      job('rate', {
        objective: 'Label the spring rate: latch lets go, block stays put',
        label: 'The log says **' + STIFF_N_PER_MM + ' N/mm**. The controller winds in weight ÷ rate of stretch, then the latch lets go.',
        camera: cam({ x: -7, y: -1 }, { x: 4, y: 9 }),
        goal: rateGoal, timeout: 15,
        answer: '48.6 kN/m',
        wrong: [{ input: '48.6 N/mm', kind: 'form' }, { input: '48600 N/m', kind: 'sigfig' }, { input: '48.6 N/m', kind: 'prefix' }, { input: '48.6 MN/m', kind: 'prefix' }],
        // 48.6 N/mm = 48.6 N / 10⁻³ m = 48.6(10³) N/m = 48.6 kN/m.
        spec: { value: STIFF, unit: 'N/m', sf: 3, form: 'si' },
        hints: [
          'There is a prefix in the denominator. The rules don\'t allow it.',
          'Replace "mm" with 10⁻³ m and carry the power of ten up to the numerator.',
          '48.6 N/(10⁻³ m) = 48.6(10³) N/m = **48.6 kN/m**.'
        ],
        ok: 'The latch let go and the block didn\'t jolt. (The cable takes ' + fmt(BLOCK * G_LOCAL / STIFF, 'mm') + ' of stretch under it.)'
      }),
      job('brake', {
        objective: 'Label the brake pressure and keep the generator hanging still',
        label: 'The old plate says **' + BRAKE_KGF_CM2 + ' kgf/cm²**. Grip goes with pressure; the burst disc goes at 10 MPa.',
        camera: cam({ x: -7, y: -1 }, { x: 4, y: 7 }),
        goal: brakeGoal, timeout: 6,
        answer: '6.91 MPa',
        wrong: [{ input: '6.92 MPa', kind: 'concept' }, { input: '69.1 kPa', kind: 'prefix' }, { input: '0.00691 GPa', kind: 'form' }, { input: '691 N/cm^2', kind: 'form' }],
        // 70.5 kgf/cm² = 70.5 × 9.806 65 N / (10⁻² m)² = 691.37 N / 10⁻⁴ m²
        //             = 6 913 688 Pa → 6.91 MPa. The exponent squares the centi too.
        // With 9.81 the same sum gives 6 916 050 Pa → 6.92 MPa.
        spec: {
          value: BRAKE_P, unit: 'Pa', sf: 3, form: 'si', tol: 0.0007,
          mistakes: [{ ratio: 9.81 / G0, tol: 0.0006, kind: 'concept', msg: 'You used g = 9.81 m/s². The kgf is defined with standard gravity, 9.806 65 m/s², and here it changes the third figure.' }]
        },
        hints: [
          'Two legacy units in one label: a force unit and a squared length unit. Deal with each.',
          'Turn kgf into N with 9.806 65. Then remember the exponent applies to the prefix as well: cm² = (10⁻² m)² = 10⁻⁴ m².',
          '70.5 × 9.806 65 = 691.37 N on 10⁻⁴ m² gives 6.914(10⁶) Pa = **6.91 MPa**.'
        ],
        ok: 'The generator hangs still. At the plate pressure the brake grips with ' + fmt(BRAKE_HOLD, 'kN') + '.'
      }),
      job('delay', {
        objective: 'Label the brake set time: motor hands over, nothing drops',
        label: 'The log says **' + BRAKE_DELAY_MS + ' ms** (4 figures). The motor lets go when the label says the brake has set.',
        camera: cam({ x: -7, y: -1 }, { x: 4, y: 7 }),
        goal: delayGoal, timeout: 34,
        answer: '2.416 s',
        wrong: [{ input: '2416 ms', kind: 'form' }, { input: '2.42 s', kind: 'sigfig' }, { input: '2.416 ms', kind: 'prefix' }, { input: '2.416 ks', kind: 'prefix' }],
        // 2416 ms = 2416(10⁻³) s = 2.416 s. 2416 ms has the right value but
        // breaks the 0.1–1000 range rule.
        spec: { value: DELAY, unit: 's', sf: 4, form: 'si' },
        hints: [
          'The number on the log is fine. Is it in the allowed range?',
          'Move the decimal point three places and change the prefix to match. Keep all four figures.',
          '2416 ms = 2.416(10³)(10⁻³) s = **2.416 s**.'
        ],
        ok: 'The block didn\'t move through the handover.'
      })
    ],
    solutions: {
      'P3.swl': [
        { set: set('31.19 kN') },
        { set: set('31.20 kN') },                 // passes the rig; the grade marks the g slip
        // a low label trips both cranes; the generator goes up on the player's own winch
        { set: set('29.00 kN'), add: ownWinch(-2.5, 4.5, 'gen', { pull: '40 kN', speed: '0.3 m/s', rating: '50 kN', stop: '1.50 m' }) },
        { pass: false, set: set('31.19 N') },     // trips on the generator
        { pass: false, set: set('31.19 MN') },    // lifts the sled, line parts
        { pass: false, set: set('31185 N') },     // range rule: firmware halt
        { pass: false, set: set('31.2 kN') }      // 3 figures in a 4-figure field
      ],
      'P3.travel': [
        { set: set('7.35 m') },
        // the crane barely lifts it; the player's winch takes it to the door
        { set: set('0.100 m'), add: ownWinch(0, HEAD_TRAVEL - 0.3, 'load', { pull: '40 kN', speed: '0.5 m/s', rating: '50 kN', stop: (HEAD_TRAVEL - 0.3 - (TRAVEL + 1)).toFixed(3) + ' m' }) },
        { pass: false, set: set('735 cm') },
        { pass: false, set: set('7350 mm') },
        { pass: false, set: set('73.5 m') },
        { pass: false, set: set('7.35 mm') }
      ],
      'P3.creep': [
        { set: set('13.9 mm/s') },
        // the crane line pays out at once; the player's winch lowers the tank
        { set: set('13.9 m/s'), add: ownWinch(0, 4.6, 'load', { pull: '100 kN', speed: '-0.03 m/s', rating: '150 kN' }) },
        { pass: false, set: set('13.9 μm/ms') },
        { pass: false, set: set('0.0139 m/s') },
        { pass: false, set: set('13.9 m/s') },
        { pass: false, set: set('13.9 μm/s') }
      ],
      'P3.rate': [
        { set: set('48.6 kN/m') },
        { set: set('48.6 MN/m'), add: prop(0, 3) },   // far too stiff a rate, but the block already sits on a prop
        { pass: false, set: set('48.6 N/mm') },
        { pass: false, set: set('48.6 N/m') },
        { pass: false, set: set('48.6 MN/m') }
      ],
      'P3.brake': [
        { set: set('6.91 MPa') },
        { set: set('6.92 MPa') },
        { set: set('69.1 kPa'), add: prop(0, 3) },    // a weak brake, but the generator sits on a prop
        { pass: false, set: set('69.1 kPa') },
        { pass: false, set: set('6.91 GPa') },
        { pass: false, set: set('0.00691 GPa') }
      ],
      'P3.delay': [
        { set: set('2.416 s') },
        { set: set('1.000 s'), add: prop(0, 3) },     // early handover onto a prop
        { pass: false, set: set('2416 ms') },
        { pass: false, set: set('2.42 s') },
        { pass: false, set: set('2.416 ms') },
        { pass: false, set: set('2.416 ks') }
      ]
    },
    deeper: [
      'The **kilogram-force** is a defined unit: 1 kgf = 1 kg × 9.806 65 m/s² = 9.806 65 N exactly. Standard gravity is a convention, so a kgf rating means the same force at the equator, at the poles or here at ' + G_LOCAL.toFixed(5) + ' m/s². Using local g, or the rounded 9.81, shifts a four-figure label.',
      'A prefix belongs to its unit when the unit is raised to a power: 1 cm² = (10⁻² m)² = 10⁻⁴ m², not 10⁻² m². That is why kgf/cm² converts to MPa and not kPa.',
      'The firmware refusing a correct value in the wrong form is not pedantry. A parser that reads "mm" as millimetre and "m·m" as square metre has to be strict to be safe.'
    ],
    debrief: [
      'All six labels are on the panel and the firmware accepted every one. The crane lifts the generator, refuses the sled, stops at the loft door, sets loads down at a walking-pace creep and holds them on the brake.',
      'Juno signs off the sheet. "Pell says the old plates can go in the scrap bin. I told him to keep them. Somebody will want to know what the numbers used to mean."'
    ].join('\n\n')
  });
})(globalThis.SE);
