# Salvage Engineer

**The world ended. Physics didn't.**

Salvage Engineer is a free, open-source browser game that teaches engineering mechanics through survival. You are the salvage engineer of a settlement rebuilding after a zombie apocalypse: hauling scrap, rigging cranes, building walls and bridges. Every job is a real mechanics problem, and the physics simulation decides the outcome. Get the maths right and the load hovers on the hook. Get it wrong and the cable snaps, the wall comes down, or the horde gets in.

The game follows the topic order of R.C. Hibbeler's *Engineering Mechanics: Statics* (14th edition) as a companion for students and teachers. It is **not affiliated with the author or the publisher**, and contains no text, figures or problems from the book. Every explanation, scenario and problem is original.

## Play

- **In the browser:** the GitHub Pages link will go here once the first act is published.
- **Offline:** download or clone this repository and open `index.html` in a desktop browser (Chrome, Firefox, Edge or Safari). No install, no build step and no internet connection are needed.

Keyboard: `F` formula sheet · `C` calculator · `U` unit converter · `D` dimension checker · `G` sig-fig gauge · `N` notebook · `M` sound on/off · `Esc` closes a window.

## Two ways to play every act

**Handheld mode** is guided and Socratic. Each idea starts as a situation and a question: what do you think happens? You try it in the simulation, and only then is the principle stated and every equation derived on screen, step by step. Each concept ends with a hands-on job and a free sandbox. Optional **Go deeper** branches go beyond the course (history, the physics behind the idealizations, error propagation, real engineering practice).

Strong players can take a **Prove it** check at the start of a level to skip explanations they already know. The scored jobs still have to be done.

**Manual mode** gives you a project brief from the settlement, the sandbox and your tools, and nothing else. You do all the maths; the game checks your numbers against the real physics. Hints exist but only appear if you ask (nudge → method → worked step), and each costs score. Manual briefs include real-world factors beyond the course text, such as gravity at altitude, measurement precision or another planet's gravity, and you have to account for them.

## Scoring

Each answer is checked for its **value**, **units** (dimensions), **significant figures / notation / rounding**, and **method** (correct SI form, dimensionally homogeneous equations). When something is wrong, the game names the kind of error (unit, conversion, prefix, rounding, sig-fig, algebra, concept) and shows its physical consequence. Tasks are graded S/A/B/C, and each chapter shows a mastery percentage and your personal bests. Scores are feedback only and never lock you out of anything.

## Acts

| Act | Region | Chapter | Status |
|---|---|---|---|
| I | Rustline Depot | 1 · General Principles | In development |
| II | The Pylon Fields | 2 · Force Vectors | Planned |
| III | Hangman's Rigging | 3 · Equilibrium of a Particle | Planned |
| IV | Lever Row | 4 · Force System Resultants | Planned |
| V | The Crane Yard | 5 · Equilibrium of a Rigid Body | Planned |
| VI | Truss Bridge Crossing | 6 · Structural Analysis | Planned |
| VII | The Long Span | 7 · Internal Forces | Planned |
| VIII | Gravel Grade | 8 · Friction | Planned |
| IX | The Reservoir | 9 · Center of Gravity and Centroid | Planned |
| X | Flywheel Works | 10 · Moments of Inertia | Planned |
| XI | The Balance Tower | 11 · Virtual Work | Planned |

What each level covers is listed in [docs/CURRICULUM.md](docs/CURRICULUM.md), for learners and teachers.

## Saves

There is one save for the whole game. Your progress, unlocked tools, formula sheet and notebook carry across every act. Progress saves automatically in your browser. Use **Settings → Export save file** to back it up or move it to another computer, and **Import** to load it. Save files are versioned and upgraded automatically, so game updates never wipe your progress.

If your browser blocks storage (some private windows do), the game warns you; export before closing.

## For developers

```
index.html            entry point; script order is load order
styles/main.css
src/engine/           units & dimensions, sig figs, answer checker, scoring, saves, UI, runners
src/engine/scenes/    physics scenes: hoist, track, gate, gravity, scales, haul, bench
src/chapters/chNN/    one module per chapter: chapter.js, levels/, projects/
tests/                node tests
```

Run the tests with Node 18 or newer:

```
node tests/run.js
```

The tests cover the unit parser, dimension checker, sig-fig and rounding rules, scoring, save migration, every scene's physics, and every answer key in the game. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to write levels and projects.

## Credits

- Game design, code, writing and art: the Salvage Engineer contributors. All art is drawn procedurally in code, and all sound is synthesized in the browser. There are no image or audio files.
- Fonts, bundled in `assets/fonts/` with their licenses:
  - [Black Ops One](https://fonts.google.com/specimen/Black+Ops+One) by James Grieshaber / Eben Sorkin, SIL Open Font License 1.1
  - [Special Elite](https://fonts.google.com/specimen/Special+Elite) by Astigmatic, Apache License 2.0
  - [IBM Plex Mono](https://github.com/IBM/plex) by IBM, SIL Open Font License 1.1

## License

[Apache License 2.0](LICENSE).
