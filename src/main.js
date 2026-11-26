/* Boot the game once the page has loaded. */
(function (SE) {
  'use strict';

  // Installable app (phones, tablets, desktop Chrome/Edge): the service worker
  // keeps a copy of the game so it opens offline, and the browser's install
  // offer is kept so the title screen can show an "Install as an app" button.
  var deferredInstall = null;
  SE.app = {
    canInstall: function () { return !!deferredInstall; },
    install: function () {
      var ev = deferredInstall; deferredInstall = null;
      if (!ev) return;
      ev.prompt();
      if (ev.userChoice) ev.userChoice.then(function () { if (SE.game && SE.game.screen === 'title') SE.game.show('title'); });
    }
  };
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    if (SE.game && SE.game.screen === 'title') SE.game.show('title');
  });
  window.addEventListener('appinstalled', function () { deferredInstall = null; });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* the game still runs online */ });
    });
  }

  function start() { SE.game.boot(document.getElementById('app')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(globalThis.SE);
