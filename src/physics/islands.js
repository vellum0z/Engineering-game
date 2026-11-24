/*
 * Islands and sleeping.
 *
 *   P.islands.update(world, dt)
 * runs after each step. It may set body.awake = false on bodies that have
 * been still long enough; the world skips sleeping bodies when it integrates
 * and skips contacts and joints whose bodies are all asleep.
 * body.wake() (or applyForce / applyImpulse) wakes a body.
 *
 * This placeholder keeps every body awake.
 */
(function (SE) {
  'use strict';
  var P = SE.phys;
  P.islands = { update: function () {} };
})(globalThis.SE);
