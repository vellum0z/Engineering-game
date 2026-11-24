# Contributing to Salvage Engineer

Thanks for helping! The game is plain HTML, CSS and JavaScript with no build step. To play your changes, open `index.html`. To run the tests, run `node tests/run.js`.

## Ground rules

- **Teach the concepts, write your own words.** The game follows the topic order of an engineering-mechanics course textbook, but every explanation, scenario, problem statement and drawing in this repository must be original. Never copy text, figures or problem wording from a textbook. Constants, units and standard equations are facts and are fine to use.
- **Physics decides outcomes.** Simulations compute what happens from the player's numbers. Never script a fake success or failure.
- **Classic scripts only.** No ES modules, because browsers block them on `file://`. Each file is an IIFE that attaches to the global `SE` namespace and must load in Node without touching the DOM.
- **Small, conventional commits**, for example `feat(ch01): add trade-ledger level`, `fix(engine): sig-fig check for trailing zeros`.

## Layout

```
index.html                 script order = load order (tests read it too)
styles/main.css
src/engine/                shared engine (units, sig figs, checker, scoring, save, UI, runners)
src/engine/scenes/         reusable physics scenes (hoist, track, gate, gravity, scales, haul, bench)
src/chapters/chNN/         one folder per chapter: chapter.js, levels/, projects/
tests/                     node tests: node tests/run.js
docs/CURRICULUM.md         which levels teach which topics
```

## Writing a handheld level

Create `src/chapters/chNN/levels/hNN-short-name.js`, then add a `<script>` tag for it in `index.html` after the chapter's `chapter.js`.

```js
(function (SE) {
  'use strict';
  SE.content.registerLevel('ch01', {
    id: 'H2', order: 2, title: 'Push and Pull', subtitle: '…', sections: ['1.2'], minutes: 20,
    intro: 'markup…', goals: ['…'],
    scene: { type: 'gate', params: { mode: 'gate' } },   // starting scene
    proveIt: [ /* task steps; passing all first time skips explanations */ ],
    unlocks: { tools: [], formulas: [], materials: [] },  // granted on completion
    steps: [ /* see below */ ]
  });
})(globalThis.SE);
```

**Markup** in any text: `**bold**`, `*italic*`, `` `code` ``, `$equation$` (inline), a paragraph that is only `$$ … \tag{1–2} $$` (display equation), `- bullets`, and a blank line for a new paragraph.

**Equation syntax** (`src/engine/eq.js`): `\frac{a}{b}`, `x^{2}`, `m_{1}`, `\sqrt{x}`, `\u{kg·m/s^2}` (upright units), `\t{text}`, `\hl{…}` (highlight), `\strike{…}` (cancel a unit), and symbols such as `\cdot \times \approx \Delta \mu \rho \theta \pi`.

### Step types

Every step may set `scene: { type, params }` to switch the scene first, `hud: [lines]` for a stage overlay, and `who: 'hask' | 'juno' | 'radio' | 'narrator'`. Side effects are applied when the step finishes, including when "prove it" skips it: `formula: id | [ids]` adds formula-sheet entries, `unlock: toolId | [ids]` unlocks workshop tools, and `material`.

| type | fields |
|---|---|
| `say` | `text`, optional `action(ctx)` |
| `predict` | `q`, `choices: [{ t, correct?, why }]`, optional `run(ctx, choiceIndex) → Promise<string?>` (play the sim, return a measured result message), `reveal` |
| `try` | `text`, `controls: [scene control keys]`, `goal(ctx) → bool`, `goalText`, `after`, `actions: [{ label, run(ctx) }]` |
| `reveal` | `kicker`, `title`, `eq`, `tag` (equation number), `text`, `table: { head, rows }`, `formula` |
| `derive` | `title`, `intro`, `lines: [{ eq, why, ask?: { q, choices: [{ t, correct, why }] } }]`, `outro` |
| `task` | `id` (unique, e.g. `H2.gate-spec`), `title`, `text`, `inputs: [{ key, label, spec, answer, wrong?, placeholder }]`, `hints: [nudge, method, worked]`, `consequence(ctx, answers, allCorrect) → Promise<string>`, `explain`, `required` (default true) |
| `classify` | `id`, `text`, `bins: [...]`, `items: [{ t, bin, why, hint?, preview?(ctx) }]` |
| `sandbox` | `text`, `controls`, `prompts: [...]`, `actions` |
| `deeper` | `title`, `teaser`, `steps: [...]` (optional "go deeper" branch, never required) |
| `summary` | `points: [...]` |

### Answer specs (`src/engine/checker.js`)

```js
spec: { value: 4624.6 /* SI base units */, unit: 'N', sf: 3, form: 'si', tol: 0.005 }
```

- **`value`** is always in SI base units (kg, m, s, N…). Compute it from the givens in code (`var W = m * 9.81;`), not by hand.
- **`unit`** fixes the required dimensions. **`sf`** sets the required significant figures; `null` skips that check.
- **`form`**:
  - `'any'`: no form rules.
  - `'si'`: SI usage rules, including the 0.1–1000 range.
  - `'si-units'`: the rules without the range.
- **`expressIn`**: a unit string (`'ft/s'`) or `'SI'`/`'FPS'` that the answer must be written in.
- **`exactRounding`**: use it when rounding itself is the skill being tested.
- **`mistakes`**: extra diagnoses, `[{ ratio, kind, msg }]`.

Every input needs a canonical **`answer`** string that passes, such as `'4.62 kN'`. `tests/answers.test.js` checks all of them automatically. Add `wrong: [{ input, kind }]` samples for the common mistakes so the feedback is tested too. Put the hand-worked arithmetic in a comment next to each answer.

### Consequences

`consequence(ctx, answers)` receives `answers[key] = { result, si, spec }`, where `si` is the player's value in SI units (or `null`). Run the scene with the player's number and the true value, and return a short message describing what physically happened. Examples:

```js
consequence: function (ctx, a) {
  var s = ctx.setScene('hoist', { mass: 471, label: 'bollard', rating: 6000, mode: 'lift' });
  return s.run(a.W.si || 0).then(function (r) { return r.outcome === 'snapped' ? 'The cable parted at …' : '…'; });
}
```

### Scenes

Each scene's parameters, `run()` options and outcomes are documented at the top of its file in `src/engine/scenes/`. Pure physics helpers live on `SE.physics.<scene>` so they can be tested.

## Writing a manual project

Create `src/chapters/chNN/projects/pNN-short-name.js`:

```js
SE.content.registerProject('ch01', {
  id: 'P1', order: 1, title: '…', subtitle: '…',
  brief: 'markup', conditions: ['…'],
  scene: { type, params }, controls: [keys for the test rig], rigActions: [{ label, run(ctx) }],
  lockedTools: ['converter'],      // tools that would do the skill being tested
  deliverables: [{ id: 'P1.weight', label: 'markup', spec, answer, wrong, hints: [3], consequence(ctx, answer, ok) }],
  deeper: ['beyond-the-book factor this brief required…'],
  debrief: 'markup'
});
```

Manual briefs show only the brief, the scene, the tools and the work order. They must include at least one condition where a beyond-the-book factor matters, such as local g, measurement precision or a non-standard location, and the answer key must account for it.

## Tests

`node tests/run.js` loads every non-UI script listed in `index.html`, then runs every `tests/*.test.js`. Add tests for any new engine behaviour, and for every scene's pure physics.
