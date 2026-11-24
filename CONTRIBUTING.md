# Contributing to Salvage Engineer

Thanks for helping! The game is plain HTML, CSS and JavaScript with no build step. To play your changes, open `index.html`. To run the tests, run `node tests/run.js`.

## Ground rules

- **Teach the concepts, write your own words.** The game follows the topic order of an engineering-mechanics course textbook, but every explanation, scenario, problem statement and drawing in this repository must be original. Never copy text, figures or problem wording from a textbook. Constants, units and standard equations are facts and are fine to use.
- **Physics decides outcomes.** Simulations compute what happens from the player's numbers. Never script a fake success or failure.
- **No multiple choice, no answer boxes.** A number only matters once it is a setting on a part. If you want a prediction, have the player set something up and run it.
- **Classic scripts only.** No ES modules, because browsers block them on `file://`. Each file is an IIFE that attaches to the global `SE` namespace and must load in Node without touching the DOM.
- **Small, conventional commits**, for example `feat(ch01): add trade-ledger level`, `fix(engine): sig-fig check for trailing zeros`.

## Layout

```
index.html                 script order = load order (tests read it too)
physics-lab.html           physics engine test bench
styles/                    main.css, yard.css
src/physics/               the physics engine (SE.phys); each file's header is its API
src/yard/                  the build yard: dials, parts, judge, yard screen, level and project runners
src/engine/                shared engine (units, sig figs, checker, scoring, save, UI)
src/chapters/chNN/         one folder per chapter: chapter.js, levels/, projects/
tests/                     node tests: node tests/run.js
docs/YARD.md               how to write parts, levels and projects
docs/CURRICULUM.md         which levels teach which topics
```

## Writing levels, projects and parts

Every level and project is played in the build yard. [docs/YARD.md](docs/YARD.md) covers dials, writing a part, the handheld step types, manual job cards, goals and reference solutions, with H1 (`src/chapters/ch01/levels/h01-still-or-moving.js`) as the worked example.

Manual job cards must include at least one condition where a beyond-the-book factor matters, such as local g, measurement precision or a non-standard location, and the reference builds must account for it.

## Grade specs (`src/engine/checker.js`)

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

A job that asks the player to write a setting down (a plate, a label, a certificate) grades that dial with `grade: { part, key, spec }`. `part` is a part id, or a part type for a part the player adds. Put the hand-worked arithmetic in a comment next to each value.

## Tests

`node tests/run.js` loads every non-UI script listed in `index.html`, then runs every `tests/*.test.js`. Every job needs a reference build that passes and one that must fail, in the level's `solutions`; `tests/yard.test.js` runs them headless through the same judge the game uses. Add a test for each new part against the textbook result it stands for, and for any new engine behaviour.
