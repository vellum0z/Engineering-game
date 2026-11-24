/*
 * H3 · Good Enough Models: the three idealizations of mechanics (particle,
 * rigid body, concentrated force) and how to tell when each one is fair.
 * Course section 1.2.
 *
 * The rigid-body and concentrated-force parts run on the gate scene's beam
 * mode (a cantilever with a tip load). The particle part runs on the rail
 * yard, where two sleds of very different length get the same push.
 */
(function (SE) {
  'use strict';

  var GP = SE.physics.gate;

  // The yard's standard test beam: 3 m steel cantilever, 100 x 150 mm, 1 kN at the tip.
  function BEAM(extra) { return { type: 'gate', params: Object.assign({ mode: 'beam', material: 'steel', L: 3, b: 0.1, h: 0.15, P: 1000, patch: 'none' }, extra || {}) }; }

  // Same mass, same runners (mu = 0.10 on concrete), very different lengths.
  function sled(id, x, w, label) { return { id: id, m: 60, x: x, v: 0, mu: 0.1, label: label, kind: 'sled', w: w }; }
  var YARD = function (bodies) { return { type: 'track', params: { surface: 'concrete', length: 30, trail: true, showVectors: true, bodies: bodies } }; };
  var SLEDS = function () { return YARD([sled('a', 3, 1.0, 'crate sled 1 m'), sled('b', 8, 4.5, 'ladder sled 4.5 m')]); };

  function sig(x, n) { return SE.sigfig.roundSig(x, n || 3).text; }
  function mm(x) { return sig(x * 1e3, 3) + ' mm'; }

  // Load a beam setup and run it; resolves with the scene's { outcome, detail }.
  function runBeam(ctx, extra) {
    var b = BEAM(extra);
    var s = ctx.setScene(b.type, b.params);
    return s.run({});
  }

  /*
   * Workshop job: a salvaged steel bar as a cantilever trolley rail.
   *   I = b h^3 / 12 = 0.080 * 0.120^3 / 12 = 0.080 * 0.001728 / 12 = 11.52e-6 m^4
   *   delta = P L^3 / (3 E I) = 3200 * 2.4^3 / (3 * 200e9 * 11.52e-6)
   *         = 3200 * 13.824 / 6.912e6 = 44 236.8 / 6 912 000 = 0.006 40 m = 6.40 mm
   *   delta / L = 0.0064 / 2.4 = 0.27 %, so the rigid-body model is fair.
   *   Root stress M c / I = 3200 * 2.4 * 0.060 / 11.52e-6 = 40 MPa, well under 250 MPa.
   */
  var JOB = { L: 2.4, b: 0.080, h: 0.120, P: 3200, E: GP.MATERIALS.steel.E };
  var JOB_I = GP.secondMoment(JOB.b, JOB.h);
  var JOB_D = GP.tipDeflection(JOB.P, JOB.L, JOB.E, JOB_I);

  /*
   * Prove-it beam: steel, L = 2.0 m, 50 x 100 mm, 2.5 kN.
   *   I = 0.050 * 0.100^3 / 12 = 4.1667e-6 m^4
   *   delta = 2500 * 8 / (3 * 200e9 * 4.1667e-6) = 20 000 / 2.5e6 = 0.008 00 m = 8.00 mm
   */
  var PROVE = { L: 2.0, b: 0.050, h: 0.100, P: 2500, E: GP.MATERIALS.steel.E };
  var PROVE_D = GP.tipDeflection(PROVE.P, PROVE.L, PROVE.E, GP.secondMoment(PROVE.b, PROVE.h));

  // Prove-it contact ratio: a 0.45 m sandbag on a 1.8 m beam, c/L = 0.45 / 1.8 = 0.250.
  var PROVE_CL = 0.45 / 1.8;

  var deltaMistakes = [
    { ratio: 1 / 12, kind: 'algebra', msg: 'That is 12 times too small: the /12 in I = bh³/12 went missing, which made I twelve times too big.' },
    { ratio: 9 / 4, kind: 'algebra', msg: 'b and h are swapped. The depth h (the dimension in the direction of the sag) is the one that gets cubed.' },
    { ratio: 3, kind: 'algebra', msg: 'Three times too big: the 3 in the denominator of PL³/(3EI) was dropped.' },
    { ratio: 1 / (2.4 * 2.4), kind: 'algebra', msg: 'Off by L²: the length has to be cubed, not used once.' }
  ];

  SE.content.registerLevel('ch01', {
    id: 'H3', order: 3, title: 'Good Enough Models',
    subtitle: 'Particles, rigid bodies and point loads',
    sections: ['1.2'],
    minutes: 20,
    intro: [
      'Hask has chalked three sketches on the side of a boxcar: a dot, a stiff bar, and a single arrow.',
      '"Real things are messy. A beam sags, a wheel squashes a little where it meets the rail, and a sled has a length. If we tracked all of that for every job we would never finish a calculation. So we **model**: we throw away the details that don\'t change the answer. The trick is knowing which details those are."'
    ].join('\n\n'),
    goals: [
      'Say what a **particle** is and when a body can be treated as one',
      'Say what a **rigid body** is and check whether a real beam qualifies',
      'Say when a load can be treated as a **concentrated force**, using the contact-to-length ratio',
      'Spot situations where none of the three models is fair'
    ],
    scene: SLEDS(),
    proveIt: [
      {
        id: 'H3.prove-delta',
        text: 'A steel cantilever ($E = 200\\u{ GPa}$), $L = 2.0\\u{ m}$, cross-section $b = 50\\u{ mm}$ wide by $h = 100\\u{ mm}$ deep, carries $P = 2.5\\u{ kN}$ at its tip. Using $I = bh^3/12$ and $\\delta = PL^3/(3EI)$, find the tip deflection in **mm**, to 3 s.f.',
        inputs: [{ key: 'd', label: 'Tip deflection δ', placeholder: 'e.g. 4.25 mm', spec: { value: PROVE_D, unit: 'm', sf: 3, expressIn: 'mm', mistakes: deltaMistakes.slice(0, 3) }, answer: '8.00 mm', wrong: [{ input: '8 mm', kind: 'sigfig' }, { input: '0.667 mm', kind: 'algebra' }] }]
      },
      {
        id: 'H3.prove-ratio',
        text: 'A sandbag that touches **0.45 m** of a **1.8 m** beam. What is the contact-to-length ratio $c/L$, to 3 s.f.? (A plain number, no units.)',
        inputs: [{ key: 'r', label: 'c / L', placeholder: 'e.g. 0.125', spec: { value: PROVE_CL, unit: '', sf: 3 }, answer: '0.250', wrong: [{ input: '4.00', kind: 'algebra' }] }]
      }
    ],
    steps: [
      // ------------------------------------------------------------ particle
      {
        type: 'predict', who: 'hask',
        scene: SLEDS(),
        q: 'Two sleds on the concrete, both **60 kg**, both on the same steel runners. One is a stubby **1 m** crate sled. The other is a long **4.5 m** ladder sled. Each gets the same **120 N** shove for 3 seconds, straight along its length, then slides to a stop.\n\nWhose centre ends up farther down the yard?',
        choices: [
          { t: 'The crate sled. It is compact, so the push goes into it more effectively.', why: 'The push doesn\'t care how compact the sled is. Watch the two trails: the marks line up mark for mark.' },
          { t: 'The ladder sled. Its front starts nearer the far end.', why: 'Its front does start ahead, but we\'re tracking the centres. Both centres move exactly the same distance.' },
          { t: 'Neither. They move exactly the same distance.', correct: true, why: 'Right. Same force, same mass, same friction, so the same acceleration at every moment. The length never entered the calculation.' }
        ],
        run: function (ctx) {
          var s = ctx.scene;
          var a0 = s.body('a').x, b0 = s.body('b').x;
          // push phase  a = (120 - 0.10*60*9.81)/60 = 1.019 m/s^2 for 3 s -> 4.58 m, v = 3.06 m/s
          // slide phase a = -0.981 m/s^2 -> 4.77 m more; total about 9.35 m for both
          return s.run({ duration: 10, pushes: [{ id: 'a', F: 120, at: 0, duration: 3 }, { id: 'b', F: 120, at: 0, duration: 3 }] }).then(function () {
            var da = s.body('a').x - a0, db = s.body('b').x - b0;
            return 'Measured: crate sled centre moved **' + sig(da) + ' m**, ladder sled centre moved **' + sig(db) + ' m**. During the shove both had $a = (F - \\mu mg)/m = 1.02\\u{ m/s^2}$, then both slowed at $\\mu g = 0.981\\u{ m/s^2}$.';
          });
        },
        reveal: 'For motion along a straight line, the centre moves according to the forces and the mass alone: $a = F_{net}/m$, and even the friction $\\mu mg$ has no length in it. The sled\'s **size and shape never appear**. That is what lets us shrink a body to a dot.'
      },
      {
        type: 'say', who: 'hask',
        text: 'Two places this pays off:\n\n- The **supply drone** has a frame 1.2 m across and flies a 5 km run over the valley. The frame is about 0.02 % of the trip. For where it goes and how long it takes, it is a dot with mass.\n- Three haul ropes are tied to a small **steel ring**. All three ropes pull along lines that pass through the ring\'s centre, so the ring\'s diameter never shows up when you balance the forces. Treat it as a dot too.\n\nThat dot is called a **particle**: it has mass, but its size can be neglected. With no geometry to carry, the analysis gets much simpler.\n\nThe catch: the moment a body can **turn**, its size matters again, because where a force acts decides how it spins. Then you need the next model.'
      },

      // ---------------------------------------------------------- rigid body
      {
        type: 'predict', who: 'hask',
        scene: BEAM(),
        q: 'Here is a 3 m beam bolted to the shed wall, 100 mm wide and 150 mm deep, with a **1 kN** crate hung at its tip. We\'ll run it twice: once in **steel**, once in **rubber** of the same size.\n\nCan we treat the beam as perfectly stiff in both cases?',
        choices: [
          { t: 'Yes. Same shape, same load, so the same answer.', why: 'Same shape, but not the same stiffness. Steel is about twenty thousand times stiffer than rubber. Look at the sag readouts.' },
          { t: 'Steel, yes. Rubber, no.', correct: true, why: 'Right. Steel sags under 2 mm, too small to change where any force acts. The rubber beam just folds.' },
          { t: 'Neither. Every beam bends, so neither is rigid.', why: 'Every beam does bend, but 1.6 mm on a 3 m steel beam changes nothing about the forces. Rubber is another story.' }
        ],
        run: function (ctx) {
          var steel;
          return runBeam(ctx, { material: 'steel' }).then(function (r) {
            steel = r.detail;
            return runBeam(ctx, { material: 'rubber' });
          }).then(function (r) {
            var rub = r.detail;
            return 'Measured tip sag: steel **' + mm(steel.delta) + '** (δ/L = ' + sig(steel.deflectionRatio * 100, 2) + ' %). Rubber **' + sig(rub.delta, 3) + ' m** by the small-deflection formula, which means the beam simply drooped to the floor (outcome: **' + r.outcome + '**).';
          });
        },
        reveal: 'A beam is never truly rigid, but when its deformation is tiny compared with its size, pretending it is rigid changes nothing important. Real steel structures are almost always in that regime.'
      },
      {
        type: 'try', who: 'hask',
        scene: BEAM(),
        text: 'Step the **material** slider through all four materials the yard has (steel, aluminium, timber, rubber) with the same 1 kN load. Watch the **δ tip** readout and the **rigid body** verdict. (The scene calls a beam rigid when it sags less than 1 % of its length.)',
        controls: ['material'],
        goalText: 'Try all four materials',
        goal: function (ctx) {
          var s = ctx.scene;
          if (!s || !s.p || s.p.mode !== 'beam') return false;
          var seen = ctx.runner._h3mats = ctx.runner._h3mats || {};
          seen[GP.materialOf(s.p.material).name] = true;
          return GP.MATERIAL_ORDER.every(function (m) { return seen[m]; });
        },
        after: 'Steel 1.60 mm, aluminium 4.57 mm, timber 29.1 mm (only just under 1 %), rubber hopeless. The **reactions at the wall** are the same for all four: a 1 kN upward force and a 3 kN·m moment, because they come from balancing the load, not from the material. That is the payoff of the rigid model: once it is fair, you don\'t need to know what the body is made of.'
      },
      {
        type: 'reveal', kicker: 'Idealization', title: 'Particle and rigid body',
        text: '- A **particle** has mass, but its size can be neglected. The body\'s geometry drops out of the analysis.\n- A **rigid body** is a huge number of particles that all stay at fixed distances from one another, before and after a load goes on. Its shape doesn\'t change, so the material it is made of doesn\'t enter the analysis.\n\nMost real structures and machines deform so little that the rigid-body model is the right one to start with.'
      },

      // -------------------------------------------------- concentrated force
      {
        type: 'predict', who: 'hask',
        scene: BEAM({ patch: 'pallet' }),
        q: 'Back to the steel beam and its 1 kN load. This time the load sits on a **pallet** that rests on the last **1.2 m** of the beam. Lazy model: draw the whole 1 kN as one arrow **at the tip**.\n\nHow far off is that model\'s tip sag?',
        choices: [
          { t: 'Under 1 %. A load is a load.', why: 'That is true for a cart wheel, but not here. The pallet\'s weight is spread toward the wall, where it bends the beam much less.' },
          { t: 'About 5 %.', why: 'Bigger than that. Run it and compare the two numbers.' },
          { t: 'Around 40 %.', correct: true, why: 'Right. A wide load acting partly near the wall bends the beam far less than the same load hung right at the tip.' }
        ],
        run: function (ctx) {
          var wheel;
          return runBeam(ctx, { patch: 'wheel' }).then(function (r) {
            wheel = r.detail;
            return runBeam(ctx, { patch: 'pallet' });
          }).then(function (r) {
            var pal = r.detail;
            return 'Cart wheel (15 mm contact, c/L = ' + sig(wheel.contactRatio, 2) + '): real sag **' + mm(wheel.delta) + '**, tip-arrow model **' + mm(wheel.deltaPoint) + '**. Pallet (c/L = ' + sig(pal.contactRatio, 2) + '): real sag **' + mm(pal.delta) + '**, tip-arrow model **' + mm(pal.deltaPoint) + '**, ' + sig((pal.deltaPoint / pal.delta - 1) * 100, 2) + ' % too high.';
          });
        },
        reveal: 'For the wheel, it hardly matters where in its tiny patch you put the arrow: anywhere gives the same answer. For the pallet it matters a lot. If you do draw the arrow at the **middle** of the pallet the sag comes out within 0.6 %, but now you had to think about where it goes, and the model still says nothing about what happens right under the pallet.'
      },
      {
        type: 'try', who: 'hask',
        scene: BEAM({ patch: 'wheel' }),
        text: 'Start from the cart wheel and drag the **contact length** up. Watch the **contact/L** line. Where does the scene stop calling a single point load fair?',
        controls: ['contact'],
        goalText: 'Widen the contact until the point-load verdict flips',
        goal: function (ctx) {
          var s = ctx.scene;
          if (!s || !s.p || s.p.mode !== 'beam') return false;
          return !GP.beamAnalysis(s.p).concentratedFair;
        },
        after: 'It flips at **c/L = 0.1**, a 0.3 m patch on this 3 m beam. That is a workshop rule of thumb, not a law of nature: below it, you can treat the load as acting at a point and stop worrying; above it, check how the load is really spread before you trust a single arrow.'
      },
      {
        type: 'reveal', kicker: 'Idealization', title: 'Concentrated force',
        eq: '\\frac{c}{L} \\ll 1 \\quad \\Rightarrow \\quad \\t{treat the load as acting at a point}',
        text: 'A **concentrated force** stands for a load that is assumed to act at a **single point** on a body. It is a fair model when the area the load acts over is very small compared with the body, like a wheel pressing on a rail.\n\nSo the three idealizations are:\n\n- **Particle**: mass, negligible size.\n- **Rigid body**: no deformation under load.\n- **Concentrated force**: a load acting at a point.',
        formula: 'ch01.idealizations'
      },
      {
        type: 'classify', id: 'H3.models',
        text: 'Which model fits each job best? Use **▶ watch** where there is one. Pick **None of these fits** when the detail a model would throw away is the very thing you need.',
        bins: ['Particle', 'Rigid body', 'Concentrated force', 'None of these fits'],
        items: [
          { t: 'Drone (1.2 m frame) crossing the 5 km valley: how long it takes', bin: 'Particle', why: 'The frame is a tiny fraction of the trip, so only its mass and position matter.', hint: 'Compare the drone\'s size with the distance it travels.' },
          { t: 'Three ropes tied to a small steel ring: balancing their pulls', bin: 'Particle', why: 'All three ropes pull through the ring\'s centre, so its size never enters the force balance.', hint: 'Where do the three ropes\' lines of pull meet?' },
          { t: 'Steel gantry arm holding a 1 kN hoist: the wall reactions', bin: 'Rigid body', why: 'The arm sags under 2 mm on 3 m, so its shape is effectively fixed. Size matters (the moment depends on the arm\'s length) but deformation does not.', hint: 'The arm\'s length matters here, so it\'s not a dot. Does it change shape?', preview: function (ctx) { return runBeam(ctx, { material: 'steel' }); } },
          { t: 'A cart wheel pressing on the rail', bin: 'Concentrated force', why: 'The contact patch is about 15 mm long on a rail metres long: c/L is tiny.', hint: 'How big is the patch the wheel touches, compared with the rail?', preview: function (ctx) { return runBeam(ctx, { patch: 'wheel' }); } },
          { t: 'Rubber gate seal: how much it squashes', bin: 'None of these fits', why: 'The squash is the whole point, so a rigid model throws away the answer.', hint: 'Would a model that forbids deformation tell you how much it squashes?', preview: function (ctx) { return runBeam(ctx, { material: 'rubber', P: 50 }); } },
          { t: 'Sandbags laid along 2.5 m of a 3 m beam', bin: 'None of these fits', why: 'c/L is about 0.83. The load is spread along most of the beam, so a single point is a poor stand-in. Later chapters handle spread loads properly.', hint: 'Work out c/L.', preview: function (ctx) { return runBeam(ctx, { contact: 2.5 }); } }
        ]
      },

      // ------------------------------------------------------------- the job
      {
        type: 'derive', who: 'hask',
        title: 'Reading the workshop chart',
        intro: 'To decide whether a real beam is rigid enough, you need its sag. Working that out from scratch belongs to deformable-body mechanics, a later course. The workshop wall has the answer for a cantilever with a tip load, and we can at least check its units with what you already know.',
        lines: [
          { eq: '\\delta = \\frac{PL^{3}}{3EI}, \\qquad I = \\frac{bh^{3}}{12}', why: 'P tip load, L length, E the material\'s stiffness (Young\'s modulus), I how well the cross-section resists bending.' },
          {
            eq: '[I] = \\u{m}\\cdot\\u{m}^{3} = \\u{m^4}',
            why: 'A width times a depth cubed.',
            ask: { q: 'What are the units of $I = bh^3/12$?', choices: [
              { t: 'm²', why: 'That would be b × h. Here h is cubed.' },
              { t: 'm⁴', correct: true, why: 'Right: one length times a length cubed.' },
              { t: 'm³', why: 'Count the lengths again: b once, h three times.' }
            ] }
          },
          { eq: '[\\delta] = \\frac{\\u{N}\\cdot\\u{m^3}}{\\u{(N/m^2)}\\cdot\\u{m^4}}', why: 'E is a stress, measured in pascals: 1 Pa = 1 N/m².' },
          {
            eq: '[\\delta] = \\frac{\\strike{\\u{N}}\\cdot\\u{m^3}}{\\strike{\\u{N}}\\cdot\\u{m^2}} = \\u{m}',
            why: 'The newtons cancel and m³/m² leaves metres.',
            ask: { q: 'After the newtons cancel, what is left?', choices: [
              { t: 'm, a length', correct: true, why: 'Right. A deflection is a length, so the chart formula is at least dimensionally consistent.' },
              { t: 'm², an area', why: 'm³ on top and m² underneath: one metre is left, not two.' },
              { t: 'Nothing. It\'s a pure number.', why: 'The metres don\'t all cancel. One is left over.' }
            ] }
          }
        ],
        outro: 'One more habit: keep everything in base SI units (N, m, Pa) through the calculation, then convert the answer to mm at the end.'
      },
      {
        type: 'task', id: 'H3.rigid-check', who: 'juno',
        title: 'Trolley rail from a salvaged bar',
        text: 'Juno wants a hoist trolley running out over the loading bay on a salvaged **steel** bar bolted to the depot wall as a cantilever. The crew will pre-bend the rail upward by exactly the sag you predict, so the trolley runs level when loaded.\n\n- $L = 2.4\\u{ m}$, cross-section $b = 80\\u{ mm}$ wide, $h = 120\\u{ mm}$ deep\n- Loaded trolley at the tip: $P = 3.2\\u{ kN}$\n- Steel: $E = 200\\u{ GPa}$\n\nFind $I$, then the tip sag $\\delta$ in **mm**, both to 3 s.f.',
        inputs: [
          { key: 'I', label: 'Second moment of area I', placeholder: 'e.g. 4.50(10^-6) m^4', spec: { value: JOB_I, unit: 'm^4', sf: 3, mistakes: [{ ratio: 12, kind: 'algebra', msg: 'Twelve times too big: divide bh³ by 12.' }, { ratio: 4 / 9, kind: 'algebra', msg: 'b and h are swapped. The depth h (in the direction of the sag) is cubed.' }] }, answer: '11.5(10^-6) m^4', wrong: [{ input: '138(10^-6) m^4', kind: 'algebra' }, { input: '5.12(10^-6) m^4', kind: 'algebra' }, { input: '11.52(10^-6) m^4', kind: 'sigfig' }] },
          { key: 'd', label: 'Tip sag δ', placeholder: 'e.g. 3.75 mm', spec: { value: JOB_D, unit: 'm', sf: 3, expressIn: 'mm', mistakes: deltaMistakes }, answer: '6.40 mm', wrong: [{ input: '0.533 mm', kind: 'algebra' }, { input: '14.4 mm', kind: 'algebra' }, { input: '6.40 m', kind: 'prefix' }, { input: '6.4 mm', kind: 'sigfig' }, { input: '0.00640 m', kind: 'form' }] }
        ],
        hints: [
          'Do $I$ first, in metres: 80 mm = 0.080 m and 120 mm = 0.120 m. The depth is the one that gets cubed.',
          '$I = 0.080 \\times 0.120^3 / 12$. Then $\\delta = PL^3/(3EI)$ with P in N, L in m and E in Pa (200 GPa = 200(10⁹) Pa). The result is in metres; multiply by 1000 for mm.',
          '$I = 0.080 \\times 0.001728 / 12 = 11.52(10^{-6})\\u{ m^4}$. $\\delta = 3200 \\times 13.824 / (3 \\times 200(10^9) \\times 11.52(10^{-6})) = 44 236.8 / 6 912 000 = 0.00640\\u{ m}$.'
        ],
        consequence: function (ctx, a) {
          var s = ctx.setScene('gate', { mode: 'beam', material: 'steel', L: JOB.L, b: JOB.b, h: JOB.h, P: JOB.P, patch: 'none' });
          var guess = a.d.si;
          return s.run({}).then(function (r) {
            var real = r.detail.delta;
            if (guess == null) return 'The crew had no camber figure to bend to. Measured sag under the trolley: **' + mm(real) + '**.';
            var step = guess - real;
            var gap = Math.abs(step);
            var level = gap < 0.25e-3;
            var where = step > 0 ? 'the tip now sits **' + mm(gap) + ' high**, so the trolley has to climb out to the end' : 'the tip still droops **' + mm(gap) + '**, so the loaded trolley runs downhill and slams the end stop';
            if (level) return 'Measured sag under the loaded trolley: **' + mm(real) + '**. The pre-bend cancels it almost exactly, and the trolley rolls out level. δ/L = ' + sig(real / JOB.L * 100, 2) + ' %: this bar is as good as rigid for working out the forces.';
            return 'Measured sag under the loaded trolley: **' + mm(real) + '**. The crew bent the rail by ' + mm(guess) + ', so ' + where + '.';
          });
        },
        explain: '$\\delta/L = 6.40/2400 \\approx 0.27 %$. The bar bends enough to matter for a level rail, but far too little to change any force or lever arm, so for statics the rigid-body model is fair. Both things can be true: small enough to ignore in the force analysis, big enough to plan for in the fit-up.'
      },

      // ------------------------------------------------------------- sandbox
      {
        type: 'sandbox', scene: BEAM(),
        text: 'Free beam. Change the material, load, size and contact length. Watch which models stay fair and which break.',
        controls: ['material', 'P', 'L', 'b', 'h', 'contact'],
        prompts: [
          'Find the smallest steel beam depth that still counts as rigid at 5 kN on 3 m.',
          'Make a timber beam fail the rigid check. What did you change, and by how much?',
          'Double the depth h. By what factor does the sag drop? (Look at the h³.)',
          'Load the beam until it breaks. Was it still "rigid" just before it did?'
        ]
      },

      // -------------------------------------------------------------- deeper
      {
        type: 'deeper', title: 'When good models go bad',
        teaser: 'Each idealization has a way to fail without warning. Three of them, briefly.',
        steps: [
          { type: 'say', who: 'hask', text: '**Slender struts buckle.** A rigid body can never buckle, because buckling *is* a change of shape. A long thin steel rod in compression can stay straight, then suddenly bow sideways at a load far below what would crush the steel. For short, stocky members the rigid model is fine. For long, slender ones in compression, the deformation is the whole story. Euler worked out the critical load in 1744.' },
          {
            type: 'predict', who: 'hask',
            q: 'The Earth is a fine particle for its orbit. But the Moon pulls on the near side of the Earth harder than on the far side, and that difference raises the tides. With the Moon 384 400 km away and the Earth\'s radius 6371 km, how different is the Moon\'s pull per kilogram on the near side compared with the far side?',
            choices: [
              { t: 'About 0.01 %. Far too little to notice.', why: 'Work it out from $1/r^2$ with $r = d - R$ and $d + R$. It is bigger than that.' },
              { t: 'About 7 %.', correct: true, why: 'Right. Roughly $4R/d \\approx 6.6 %$ of the average pull. Small, but it moves whole oceans. For tides the Earth\'s size is exactly what matters, so the particle model fails.' },
              { t: 'About 50 %.', why: 'The Earth is small compared with the Moon\'s distance, so not that much. Try $1/(d-R)^2$ against $1/(d+R)^2$.' }
            ]
          },
          { type: 'say', who: 'hask', text: '**Why the pallet\'s arrow at its centre worked so well.** Far from where a load is applied, a body cannot tell how the load was spread out: only the total force and where it acts matter. That is **Saint-Venant\'s principle**. It is why a point load placed at the right spot predicts the tip sag closely even for a wide pallet. It is also why it tells you nothing about the steel right under the pallet, where the local crushing and bearing pressure live.' }
        ]
      },

      // ------------------------------------------------------------- summary
      {
        type: 'summary',
        points: [
          'Models (idealizations) simplify the theory by dropping details that don\'t change the answer.',
          'A **particle** has a mass but a size that can be neglected. Its geometry drops out of the analysis.',
          'A **rigid body** does not deform under load: its particles stay a fixed distance apart, so its material doesn\'t matter. Real steel structures deform so little that this is usually fair.',
          '**Concentrated forces** are assumed to act at a point on a body. That is fair when the loaded area is small compared with the body (c/L small, like a wheel on a rail).',
          'Check the model before you trust it: rubber is not rigid, and a long line of sandbags is not a point load.'
        ]
      }
    ]
  });
})(globalThis.SE);
