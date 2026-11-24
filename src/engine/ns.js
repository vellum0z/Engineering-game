/*
 * Salvage Engineer — global namespace.
 *
 * The game must run by double-clicking index.html (file://), where browsers
 * refuse to load ES modules. Every source file is therefore a classic script
 * that attaches itself to one shared namespace object, `SE`. The same files
 * are loaded by the Node test runner, which shares `globalThis` the same way.
 */
(function (root) {
  'use strict';
  var SE = root.SE || {};
  SE.version = '0.2.0';
  SE.chapters = SE.chapters || {};
  SE.scenes = SE.scenes || {};
  root.SE = SE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
