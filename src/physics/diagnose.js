/*
 * Build diagnostics: problems in a player's build that the engine can't
 * simulate faithfully, reported as plain warnings for the yard to show
 * ("parts overlap", "mass ratio too large on this cable") instead of letting
 * the simulation quietly produce wrong physics.
 *
 *   P.diagnose(world) -> [{ code, severity: 'error' | 'warning', message, bodies, joints }]
 *
 * This placeholder reports nothing yet.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;
  P.diagnose = function () { return []; };
})(globalThis.SE);
