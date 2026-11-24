/*
 * Materials: the physical data parts are made of.
 *
 *   density      kg/m^3 (the 2D engine treats each body as a slab 1 m deep
 *                unless a part sets its own thickness, see body.js)
 *   friction     Coulomb coefficient used for both static and kinetic
 *                contact unless muS / muK are given
 *   restitution  0 = dead stop, 1 = perfectly bouncy
 *   E            Young's modulus, Pa (for beams and stretchy cables)
 *   yield        yield strength, Pa (for beams, welds and solid rods)
 *
 * Values are typical handbook figures rounded to the precision a game needs.
 * Mixing rules follow common engine practice: friction is the geometric mean
 * of the two surfaces, restitution the larger of the two.
 */
(function (SE) {
  'use strict';

  var MATERIALS = {
    steel:    { name: 'steel',    density: 7850, friction: 0.55, restitution: 0.10, E: 200e9, yield: 250e6 },
    timber:   { name: 'timber',   density: 550,  friction: 0.45, restitution: 0.15, E: 11e9,  yield: 40e6 },
    concrete: { name: 'concrete', density: 2400, friction: 0.70, restitution: 0.05, E: 25e9,  yield: 3e6 },
    rubber:   { name: 'rubber',   density: 1100, friction: 0.90, restitution: 0.60, E: 0.05e9, yield: 15e6 },
    ice:      { name: 'ice',      density: 917,  friction: 0.03, restitution: 0.05, E: 9e9,   yield: 1e6 },
    rope:     { name: 'rope',     density: 1140, friction: 0.50, restitution: 0.00, E: 2e9,   yield: 60e6 },
    aluminium:{ name: 'aluminium',density: 2700, friction: 0.45, restitution: 0.10, E: 69e9,  yield: 95e6 },
    cargo:    { name: 'cargo',    density: 400,  friction: 0.50, restitution: 0.05, E: 1e9,   yield: 5e6 },
    frictionless: { name: 'frictionless', density: 1000, friction: 0, restitution: 0, E: 1e9, yield: 1e9 }
  };

  function material(name) {
    if (typeof name === 'object' && name) return name;
    var m = MATERIALS[name || 'steel'];
    if (!m) throw new Error('unknown material "' + name + '"');
    return m;
  }

  function mixFriction(a, b) { return Math.sqrt(a * b); }
  function mixRestitution(a, b) { return Math.max(a, b); }

  SE.phys = SE.phys || {};
  SE.phys.MATERIALS = MATERIALS;
  SE.phys.material = material;
  SE.phys.mixFriction = mixFriction;
  SE.phys.mixRestitution = mixRestitution;
})(globalThis.SE);
