/*
 * Breakage: parts fail when they carry more than they are rated for.
 *
 *   P.breakage.check(world, dt)
 * runs once per step, after the solver. For each joint it records
 * lastForce and peakForce (N); a joint whose force() passes breakForce is
 * removed and a 'break' event { joint, force } is fired. The simulation
 * decides when a cable snaps or a pin shears, not a script.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;

  function check(world) {
    world.joints.slice().forEach(function (j) {
      var F = j.force();
      j.lastForce = F;
      j.peakForce = Math.max(j.peakForce || 0, F);
      if (F > j.breakForce) {
        j.broken = true;
        world.removeJoint(j);
        world.emit('break', { joint: j, force: F });
      }
    });
  }

  P.breakage = { check: check };
})(globalThis.SE);
