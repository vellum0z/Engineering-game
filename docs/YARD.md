# The build yard

Every Act I level and project is played in the **build yard**. You place parts, type their settings with units, press Run, and the physics engine decides what happens. There are no multiple-choice questions and no answer boxes. A number only matters once it is a setting on a part.

- **Handheld levels** give you a small kit, ghost outlines and a guide. Each idea follows the same loop: set it up, poke it, see the rule, do the job, free play.
- **Manual projects** give you a job card and the whole parts library. The simulation is the only judge.

The code is in `src/yard/`:

| File | What it does |
| --- | --- |
| `dial.js` | Parses typed settings ("2.5 kN", "300 lb") into SI, refuses the wrong kind of unit |
| `design.js` | Part registry (`definePart`), part instances, and `build(design, site)` → physics world |
| `judge.js` | Runs a design until a goal passes or fails. Goal helpers. Job score |
| `yard.js` | The yard screen: canvas, parts bin, inspector, gauge strip, Run/Step/Reset |
| `steps.js` | Handheld step types for levels with a `yard` block |
| `manual.js` | Manual projects with a `yard` block |
| `parts/*.js` | The parts themselves |

Physics is `SE.phys` (`src/physics/`). Each file's header is its API. Don't edit `src/physics` from yard or level work.

## Units and dials

A dial has a quantity (`force`, `mass`, `length`, `time`, `speed`, `accel`, `angle`, `stiffness`, `pressure`, `moment`, `energy`, `density`, `number`) or a `choice` list. The player types any unit of that quantity. A prefix slip such as mN for kN is accepted, because it is a valid force, and the part does exactly what was typed. A unit of the wrong kind (kg on a force dial) is refused with a reason.

Inside the engine everything is SI: m, kg, s, N, rad.

## Writing a part

```js
SE.yard.definePart({
  type: 'winch', name: 'Winch', category: 'Rigging',
  blurb: 'One sentence the inspector shows.',
  size: { w: 0.8, h: 0.6 },                       // m: bin preview, hit box, ghosts
  dials: [
    { key: 'pull', label: 'Pull', q: 'force', def: '2 kN', min: 0 },
    { key: 'grade', label: 'Grade', choice: ['steel', 'timber'], def: 'steel' }
  ],
  anchors: { drum: { x: 0, y: 0.3 } },            // named points in the part frame
  connector: false,                               // true: joins inst.a and inst.b
  attach: false,                                  // true (with connector): clips onto one part (inst.a)
  library: true,                                  // false: job scenery only, not in the manual library
  build: function (b) {
    var body = b.body({ type: 'static', position: b.at({ x: 0, y: 0 }), shapes: [b.P.box(0.4, 0.3)] });
    return { body: body };                        // anchors come from `anchors` when you return one body
  },
  plate: function (inst) { return ['WLL ' + inst.dials.pull]; },     // rating plate lines
  readouts: function (built) { return [{ key: 'pull', label: 'line pull', q: 'force', read: function (w) { return 0; } }]; },
  draw: function (ctx, cam, built, yard) { }      // optional art on top of the debug renderer
});
```

The builder `b` gives `b.si(key)` (dial in SI), `b.text(key)` (as typed), `b.at(local)` (part frame to world), `b.body(def)`, `b.joint(joint)`, `b.end('a' | 'b')` (connector ends as `{ body, local, world }`), `b.on(type, fn)` (world events), `b.ground`, `b.world`, `b.site`, `b.P`.

Rules for parts:

- **Physics decides.** A part sets up bodies, joints and forces. It never decides success itself.
- **Ratings break things.** A rated part passes its rating as `breakForce` (or the structure's own limits) so it really snaps.
- **Readouts are SI.** The gauge strip converts to whatever unit the player picks.
- **Rating plates can be in any unit**, including lb, kip or kgf, so the player has to convert.
- Add a test for each part in `tests/yard-parts.test.js` that checks it against the textbook result it stands for.

## Rigging parts

`src/yard/parts/rigging.js`, tested in `tests/yard-parts-rigging.test.js`.

| Part | Kind | Dials | Readouts | Anchors |
| --- | --- | --- | --- | --- |
| `winch` | connector: `a` = drum, `b` = hook | `pull` (max pull), `speed` (+ reels in), `rating` (line breaks), `brake` on/off, `stop` (line out to stop at), `route`, `parts` (falls to the hook) | `tension`, `lineOut`, `speed`, `hook` (only with 2+ falls) | |
| `chain` | connector | `size` (6 to 16 mm, grade 80), `length` (empty = taut) | `tension` | |
| `spring` | connector | `k`, `rest` (empty = as built), `rating`, `damping` light/none | `force` (+ = tension), `stretch` | |
| `sheave` | static wheel | `size` (diameter) | | `rim` |
| `jib` | static mast and boom, origin at the mast foot; its size and anchors follow the dials (`sizeFor`, `anchorsFor`) | `height`, `reach`, `facing` right/left | | `tip` (the tip sheave), `base` (drum mount) |
| `counterweight` | load | `mass`, `cast` kg/lb (the unit on the side) | `speed` (vertical) | `top`, `left`, `right`, `bottom` |

What each one does in the engine:

- **Winch**: a `WinchJoint`. While the load needs all of `pull` the drum slips: if the load still rises (it is only speeding up) the art says FULL PULL and the tension reads the pull; once the line out stops falling it says STALLED and the load runs down. The built part has `stalled()` and `atMaxPull()`. Near its `stop` the drum slows at 0.5 m/s² so the load stays on a taut line, and at the stop a braked drum holds whatever the line can carry. With `brake` on, a stopped drum holds anything the line can carry. With `brake` off and speed 0 the drum free-wheels and the load falls. `stop` stops reeling in (or paying out, for a negative speed) when the line out reaches it. Line out counts every run, including drum to sheave.
- **Chain**: a pull-only rope joint rated at `P.rating.cable('chain80', d)` (10 mm breaks at about 126 kN). The plate prints the working load limit (breaking load / 4) and the breaking load in kN and lb. Its own weight is applied half at each end, and the art drapes it when slack. A slack chain that jerks tight can snap: that is a real shock load.
- **Spring**: a `DistanceJoint` spring, F = k·(L − rest), pushing and pulling. `light` damping is a damping ratio of 0.05 on the lighter end.

### Running a line over a sheave

A `winch` or a `cable` has a `route` dial:

- `direct`: the line runs straight from end `a` to end `b`.
- `over sheave`: the line runs from `a` to the nearest sheave to end `b` (a `sheave` part, or the tip of a `jib`), then down to `b`. With no sheave in the yard the build is refused with a reason.

A level can name the sheave instead: `{ type: 'winch', via: { part: 'jibA' }, ... }`. That wins over the dial. Sheaves are frictionless, so the tension is the same all along the line: a sheave turns a pull, it doesn't change its size. Each run leaves the wheel at its rim tangent point (worked out when the run starts, with the wheel on the inside of the bend), so a load hung under one edge of the wheel hangs straight down. Two loads under opposite rims make an Atwood machine. A winch's falls leave at the hook-side tangent.

The winch's `parts` dial is the number of falls between the sheave and the hook (a block and tackle). The hook carries `parts` × line tension and rises at speed / `parts`, so a winch too weak for a direct lift can manage it with a tackle.

A cable over a sheave is a `PulleyJoint` with both sides on the sheave, so the same breaking load applies on both sides. Any part that wants lines to run over it can return `sheave: { body, local, r }` from `build`.

A typical crane: a `jib`, a `winch` from the jib's `base` to the load's `top` with `route: 'over sheave'`.

## Measuring parts

`src/yard/parts/measure.js`, tested in `tests/yard-parts-measure.test.js`. They only read the world; none of them decides a job. Readouts are SI like every gauge.

| Part | Kind | Dials | Readouts | Anchors |
| --- | --- | --- | --- | --- |
| `springscale` | connector: `a` = hook above, `b` = load | `k`, `face` N/kN/lb/kgf (the printed unit), `capacity` (empty = never snaps) | `force`, `stretch` | |
| `weight` | load | `nominal` stamp: 1 to 20 kg, 1 to 25 lb, 1 slug | | `top` |
| `loadcell` | connector, a rigid link | `rating` (fails above it) | `force` (+ = tension) | |
| `stopwatch` | static, one per design | `start` run/release/zone, `stop` impact/zone/time, `zone` (ids), `limit` (for stop = time) | `t` | |
| `tape` | connector, adds nothing to the world | | `length`, `dx`, `dy` | |
| `pendulum` | static pivot + bob | `length`, `mass`, `angle` (pulled back), `line` string/rod | `period`, `angle`, `swings` | `pivot`, `bob` |
| `balance` | stand, beam on a pin, two hanging pans | `arm`, `beam` (mass) | `tilt` (+ = right pan down) | `left`, `right` (the pans), `pivot` |
| `caliper` | clips onto a part (`attach`) | | `width`, `height`, `hole` (only if the part has one) | |

What each one does in the engine:

- **Spring scale**: a `DistanceJoint` spring rested at the rigged length, F = k·x, with a dashpot at about half critical for the hung load so the needle settles. The face art draws the reading in the face unit (kgf uses 9.80665 N).
- **Weight**: mass from the stamp. Kilograms are masses; a pound stamp weighs that many pounds at the game's g, so m = n·4.448 / 9.81 kg; 1 slug is 14.59 kg. `SE.yard.weightMass(stamp)` gives the mass. On another site's g it weighs differently, which a spring scale shows and a balance doesn't.
- **Load cell**: a rigid `DistanceJoint` with `breakForce` = rating.
- **Stopwatch**: `release` starts when a `latch` lets go (on the step it releases), or with no latch on the first motion. `zone` starts when a body's centre enters the zone. `impact` stops on the first hit of a free body (touching nothing, on no joint) faster than 0.5 m/s; `zone` stops when a body enters the stop zone (with start = zone and one zone, when it leaves it); `time` stops after `limit`. The `zone` dial takes ids, "start, stop"; empty uses the design's zones in order. Other part ids there limit `impact` to hits on those parts.
- **Tape**: a `TapeMeasure` between the two ends; it follows parts that move.
- **Pendulum**: a bob on a rope (string) or rod `DistanceJoint`. It times passes through straight down; `period` is twice the mean time between passes, 0 until it has seen two. For small swings T = 2π√(L/g), so it measures local g.
- **Balance**: the beam pins 4 cm above its centre of mass, so it hangs level with equal pans and tips (up to about 17°) toward the heavier one. A `weight` sits on a pan at the balance's y + 0.59 m. It compares masses, so it reads the same on any site.
- **Caliper**: the part's extent along its own x (width) and y (height) from its shapes, rounded to 0.01 mm. `hole` is the hole centre from the left end, from the part's `holeLocal` or its `hole` dial (the `board`).

## Writing a yard level

See `src/chapters/ch01/levels/h01-still-or-moving.js` for a complete example.

```js
SE.content.registerLevel('ch01', {
  id: 'H2', order: 2, title, subtitle, sections: ['1.2'], minutes: 20, intro, goals: [...],
  yard: { site: { g: 9.81, floor: 'concrete' }, camera: { fit: { lo, hi } }, design: { parts: [...] } },
  solutions: { 'H2.job': [{ add: [...], set: { partId: { key: 'text' } } }, { pass: false, add: [...] }] },
  steps: [ ... ]
});
```

Pre-placed parts in `design.parts` are part instances: `{ id, type, x, y, angle, dials, locked, open: ['mass'], fixed: [...], hide: [...], label }`. `locked` parts can't be moved or removed, and their dials are fixed unless listed in `open`.

### Step types

| Type | Use it to | Fields |
| --- | --- | --- |
| `say` | talk | `who`, `text` |
| `build` | set something up | `text`, `yard`, `until(ctx, eventType)`, `goalText`, `after`, `hint` |
| `watch` | run it and look | as `build`; `until` usually checks `type === 'result'` |
| `rule` | write the law with the player's numbers | `title`, `law`, `eq(ctx)`, `text(ctx)`, `formula` |
| `reveal` | a definition | as before |
| `job` | the scored goal | `id`, `text`, `yard`, `goal`, `timeout`, `goalText`, `hints`, `margin(s)`, `grade`, `success`, `onFail` |
| `free` | free play | `text`, `prompts`, `yard` |
| `deeper`, `summary` | as before | |

`yard` on a step changes the yard: `{ design, bin, ghosts, goal, readouts, camera, site, poke, keep: true, add: [...] }`. `keep: true` keeps the player's build. A `bin` is a kit: `[{ type: 'push', count: 2, dials: {...}, label }]`, or `'library'` for everything.

`until(ctx, type)` runs after every edit, run and result. Return `true` when the step is done, or a string to nudge. `ctx` has `yard`, `design`, `built`, `result` (the last finished run, with `result.state`), `runs`, `inst(id)`, `find(type)`, `all(type)`, `si(id | inst, key)`, `text(id, key)`, `read(gaugeId)`, `fmt(si, unit, sf)` and `values` (your own scratch).

### Goals

A goal is `function (s) -> undefined | true | { fail: 'why' }`, called after every step. `s` has `t`, `pos(id)`, `vel(id)`, `speed(id)`, `body(id)`, `part(id)`, `breaks`, `impacts`, `read(gaugeId)`, `held(key, cond, seconds)`, `peak(key, v)` and `memo`.

Helpers in `SE.yard.goals`:

- `all(...)`: passes when all pass. Guards are checked on every step.
- `noBreaks(ids?)`: guard. Fails when something snaps.
- `never(fn)`: guard. Fails with the string `fn` returns.
- `restIn(id, box, { maxSpeed, hold })`, `reach(id, box)`, `holdFor(key, fn, s)`, `before(t, goal)`, `after(t, fn?)`.

The same goal judges the live run and the headless tests, so what passes on screen passes in CI.

### Reference solutions

Every `job` needs at least one reference build in `solutions`. Also give one build that must fail (`pass: false`). `tests/yard.test.js` runs them all headless, and checks that the untouched start does not pass.

### Writing rules

- Original words, scenarios and numbers only. Never copy a textbook's text, figures or problem wording.
- No multiple choice. If you want a prediction, ask the player to set something up and run it.
- Keep Hask's voice: short, practical and a little dry.
