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
