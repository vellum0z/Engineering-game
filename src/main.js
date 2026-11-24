/* Boot the game once the page has loaded. */
(function (SE) {
  'use strict';
  function start() { SE.game.boot(document.getElementById('app')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(globalThis.SE);
