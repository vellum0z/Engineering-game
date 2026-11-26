# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Play on phones and tablets. Touch controls in the build yard: tap to place and select, drag to move parts or pan, pinch to zoom, and a Fit button. Phone layouts for upright (yard pinned on top, cards below) and sideways (yard and cards side by side).
- Installable app: a web app manifest, home-screen icons and a service worker, so Chrome on Android (and desktop Chrome or Edge) can install the game and it opens offline. The title screen shows an "Install as an app" button when the browser offers it.

### Fixed
- The page no longer grows wider than a narrow screen in the build yard.
- Selecting a part in a manual project opens the Jobs tab, where Properties lives.

## [0.2.0] - 2026-11-24

### Changed
- Act I is rebuilt as a physics sandbox. Every level and project is played in the build yard: place parts, type their settings with units, press Run, and the simulation decides. Multiple-choice questions and answer boxes are gone.
- Handheld levels give a kit, ghost outlines and a guide, and teach each idea by showing it in the simulation before the rule is written with the player's own numbers.
- Manual projects give a job card and the full parts library; each job is signed off by the simulation.
- Scoring now judges the build: hints, failed runs and margin, plus the value, units, figures and SI form of any setting a job asks you to write down.

### Added
- A new physics engine: rigid bodies with a soft-step solver, contact friction, distance, revolute, weld, prismatic, pulley and winch joints, cables and chains with breaking loads, structures, sensors, replay and a camera.
- The build yard: typed dials with unit checking, a parts library (loads, pushes, cables, chains, springs, sheaves, jibs, winches, counterweights, spring scales, load cells, stopwatches, tapes, pendulums, balances, calipers, gates, rams, tanks, latches, sleds, boards and posts), a gauge strip, and Run, Step and Reset.
- A physics lab page for trying the engine on its own.
- Reference builds for every job, checked headless by the tests.

## [0.1.0] - 2026-11-24

### Added
- Game engine: unit and dimension parser with SI prefix rules, significant-figure and rounding checker, answer checker that classifies errors, scoring with S/A/B/C grades, and a versioned save system with export and import.
- Handheld (guided) and manual (brief-only) mode runners, tiered hints and "prove it" mastery checks.
- Workshop tools: formula sheet, calculator, unit converter, dimension checker, sig-fig gauge and field notebook.
- Physics scenes: gantry hoist, rail yard, gate and cantilever beam, gravity lab, scales and lunar rig, equipment ratings (bridge, lift, axle) and measuring bench.
- Synthesized sound effects and ambience.
- Play online through GitHub Pages, and an offline zip download attached to each release.
- Act I, Rustline Depot (Chapter 1, General Principles): chapter hub, formula sheet entries, eleven handheld levels (H1 to H11), six manual projects (P1 to P6) and six free sandboxes.
