/*
 * Breakage: parts fail when they carry more than they are rated for.
 *
 *   P.breakage.check(world, dt)
 * runs once per step, after the solver. For each joint it records
 * lastForce / peakForce (N) and, for joints with torque(), lastTorque /
 * peakTorque (N·m). A joint past breakForce or breakTorque is removed and a
 * 'break' event { joint, force, torque, reason: 'force' | 'torque' } fires. The simulation
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
      var T = j.torque ? Math.abs(j.torque()) : 0;
      j.lastTorque = T;
      j.peakTorque = Math.max(j.peakTorque || 0, T);
      var why = F > j.breakForce ? 'force' : (j.breakTorque != null && T > j.breakTorque ? 'torque' : null);
      if (why) {
        j.broken = true;
        world.removeJoint(j);
        world.emit('break', { joint: j, force: F, torque: T, reason: why });
      }
    });
  }

  P.breakage = { check: check };
})(globalThis.SE);
