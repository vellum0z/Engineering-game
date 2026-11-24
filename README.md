# Salvage Engineer

**The world ended. Physics didn't.**

Salvage Engineer is a free, open-source browser game that teaches engineering mechanics through survival. You are the salvage engineer of a settlement rebuilding after a zombie apocalypse: hauling scrap, rigging cranes, building walls and bridges. Every job is a real mechanics problem, and the physics simulation decides the outcome. Get the maths right and the load hovers on the hook. Get it wrong and the cable snaps, the wall comes down, or the horde gets in.

The game follows the topic order of R.C. Hibbeler's *Engineering Mechanics: Statics* (14th edition) as a companion for students and teachers. It is **not affiliated with the author or the publisher**, and contains no text, figures or problems from the book. Every explanation, scenario and problem is original.

## Play

### ▶ [Play online](https://vellum0z.github.io/Engineering-game/)

Opens in any desktop browser (Chrome, Firefox, Edge or Safari). Nothing to install.

### ⬇ [Download to play offline](https://github.com/vellum0z/Engineering-game/releases/latest/download/salvage-engineer.zip)

1. Download the zip file.
2. Unzip it.
3. Open `index.html` in the unzipped folder by double-clicking it.

That's it. The game runs from the files on your computer with no internet connection. Older versions are on the [Releases](https://github.com/vellum0z/Engineering-game/releases) page.

Keyboard: `F` formula sheet · `C` calculator · `U` unit converter · `D` dimension checker · `G` sig-fig gauge · `N` notebook · `M` sound on/off · `Esc` closes a window.

## Two ways to play every act

Every level and project is played in the **build yard**, a physics sandbox. You place parts (crates, carts, cables, winches, springs, scales, rams, jibs), type their settings with units ("2.5 kN", "300 lb", "0.45 m"), and press **Run**. The physics engine decides what happens. There are no multiple-choice questions and no answer boxes: a number only matters once it is a setting on a part, and the part does exactly what you typed.

**Handheld mode** gives you a small kit of parts and a guide. Each idea follows the same loop: set it up, poke it, watch the rule appear with your own numbers, do a scored job, then free play. Optional **Go deeper** branches go beyond the course (history, the physics behind the idealizations, error propagation, real engineering practice).

**Manual mode** gives you a job card from the settlement and the whole parts library, and nothing else. You do all the maths and build it your way; the simulation is the only judge. Hints exist but only appear if you ask (nudge → method → worked step), and each costs score. Manual job cards include real-world factors beyond the course text, such as gravity at altitude, measurement precision or another planet's gravity, and you have to account for them.

## Scoring

A job is signed off when the simulation passes it: the load hovers, the cart parks in the dock, the cable holds. The score then takes off points for hints, failed runs and how close to the edge you built. Where a job asks you to write a setting down (a rating plate, a label, a certificate), that setting is also checked for its **value**, **units**, **significant figures / notation / rounding** and **SI form**. Jobs are graded S/A/B/C, and each chapter shows a mastery percentage and your personal bests. Scores are feedback only and never lock you out of anything.

## Acts

| Act | Region | Chapter | Status |
|---|---|---|---|
| I | Rustline Depot | 1 · General Principles | Playable: 11 handheld levels, 6 manual projects |
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
physics-lab.html      physics engine test bench
styles/               main.css, yard.css
src/physics/          the physics engine (rigid bodies, joints, cables, breakage, sensors, camera)
src/yard/             the build yard: dials, parts, the judge, the yard screen, level and project runners
src/engine/           units & dimensions, sig figs, checker, scoring, saves, UI
src/chapters/chNN/    one module per chapter: chapter.js, levels/, projects/
tests/                node tests
```

Run the tests with Node 18 or newer:

```
node tests/run.js
```

The tests cover the unit parser, dimension checker, sig-fig and rounding rules, scoring, save migration, the physics engine against textbook results, every yard part, and a reference build for every job in the game (one that must pass and one that must fail), run headless through the same judge the game uses. See [docs/YARD.md](docs/YARD.md) for how to write parts, levels and projects, and [CONTRIBUTING.md](CONTRIBUTING.md) for the rules.

## Credits

- Game design, code, writing and art: the Salvage Engineer contributors. All art is drawn procedurally in code, and all sound is synthesized in the browser. There are no image or audio files.
- Fonts, bundled in `assets/fonts/` with their licenses:
  - [Black Ops One](https://fonts.google.com/specimen/Black+Ops+One) by James Grieshaber / Eben Sorkin, SIL Open Font License 1.1
  - [Special Elite](https://fonts.google.com/specimen/Special+Elite) by Astigmatic, Apache License 2.0
  - [IBM Plex Mono](https://github.com/IBM/plex) by IBM, SIL Open Font License 1.1

## License

[Apache License 2.0](LICENSE).
