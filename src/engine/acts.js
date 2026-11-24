/*
 * The world map: one region (act) per chapter, in course order. A region
 * opens on the map once its chapter module has registered levels.
 */
(function (SE) {
  'use strict';
  SE.ACTS_PLANNED = [
    { id: 'ch01', act: 'I', number: 1, region: 'Rustline Depot', title: 'General Principles' },
    { id: 'ch02', act: 'II', number: 2, region: 'The Pylon Fields', title: 'Force Vectors' },
    { id: 'ch03', act: 'III', number: 3, region: 'Hangman\'s Rigging', title: 'Equilibrium of a Particle' },
    { id: 'ch04', act: 'IV', number: 4, region: 'Lever Row', title: 'Force System Resultants' },
    { id: 'ch05', act: 'V', number: 5, region: 'The Crane Yard', title: 'Equilibrium of a Rigid Body' },
    { id: 'ch06', act: 'VI', number: 6, region: 'Truss Bridge Crossing', title: 'Structural Analysis' },
    { id: 'ch07', act: 'VII', number: 7, region: 'The Long Span', title: 'Internal Forces' },
    { id: 'ch08', act: 'VIII', number: 8, region: 'Gravel Grade', title: 'Friction' },
    { id: 'ch09', act: 'IX', number: 9, region: 'The Reservoir', title: 'Center of Gravity and Centroid' },
    { id: 'ch10', act: 'X', number: 10, region: 'Flywheel Works', title: 'Moments of Inertia' },
    { id: 'ch11', act: 'XI', number: 11, region: 'The Balance Tower', title: 'Virtual Work' }
  ];
})(globalThis.SE);
