/* Service worker: keeps a copy of the game on the device so the installed
   app (and the web page) opens without a connection.

   Pages and files come from the cache first, so the game starts instantly
   and offline; each request also checks the network in the background and
   refreshes the cached copy, so an update shows up on the next launch.
   FILES must list everything index.html loads (tests/pwa.test.js checks). */
'use strict';
var CACHE = 'salvage-engineer-v1';
var FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/main.css',
  'styles/yard.css',
  'styles/mobile.css',
  'src/engine/ns.js',
  'src/engine/units.js',
  'src/engine/sigfig.js',
  'src/engine/checker.js',
  'src/engine/scoring.js',
  'src/engine/save.js',
  'src/engine/eq.js',
  'src/engine/draw.js',
  'src/engine/stage.js',
  'src/engine/audio.js',
  'src/engine/expr.js',
  'src/engine/content.js',
  'src/engine/acts.js',
  'src/physics/math.js',
  'src/physics/shapes.js',
  'src/physics/materials.js',
  'src/physics/body.js',
  'src/physics/collide.js',
  'src/physics/query.js',
  'src/physics/soft.js',
  'src/physics/contact.js',
  'src/physics/broadphase.js',
  'src/physics/islands.js',
  'src/physics/joint.js',
  'src/physics/distance.js',
  'src/physics/revolute.js',
  'src/physics/weld.js',
  'src/physics/prismatic.js',
  'src/physics/mouse.js',
  'src/physics/pulley.js',
  'src/physics/winch.js',
  'src/physics/cable.js',
  'src/physics/structures.js',
  'src/physics/breakage.js',
  'src/physics/island.js',
  'src/physics/world.js',
  'src/physics/sensors.js',
  'src/physics/recorder.js',
  'src/physics/serialize.js',
  'src/physics/stepper.js',
  'src/physics/diagnose.js',
  'src/physics/debugdraw.js',
  'src/yard/dial.js',
  'src/yard/design.js',
  'src/yard/judge.js',
  'src/yard/yard.js',
  'src/yard/panels.js',
  'src/yard/sound.js',
  'src/yard/parts/core.js',
  'src/yard/parts/rigging.js',
  'src/yard/parts/measure.js',
  'src/yard/parts/site.js',
  'src/engine/scenes/hoist.js',
  'src/engine/scenes/track.js',
  'src/engine/scenes/gate.js',
  'src/engine/scenes/gravity.js',
  'src/engine/scenes/scales.js',
  'src/engine/scenes/haul.js',
  'src/engine/scenes/bench.js',
  'src/engine/ui.js',
  'src/engine/tools.js',
  'src/engine/runner.js',
  'src/engine/manual.js',
  'src/yard/steps.js',
  'src/yard/manual.js',
  'src/engine/game.js',
  'src/chapters/ch01/chapter.js',
  'src/chapters/ch01/levels/h01-still-or-moving.js',
  'src/chapters/ch01/levels/h02-push-and-pull.js',
  'src/chapters/ch01/levels/h03-good-enough-models.js',
  'src/chapters/ch01/levels/h04-newtons-yard.js',
  'src/chapters/ch01/levels/h05-the-long-fall.js',
  'src/chapters/ch01/levels/h06-three-rulers.js',
  'src/chapters/ch01/levels/h07-trade-ledger.js',
  'src/chapters/ch01/levels/h08-stamp-the-plate.js',
  'src/chapters/ch01/levels/h09-balance-the-books.js',
  'src/chapters/ch01/levels/h10-measure-twice.js',
  'src/chapters/ch01/levels/h11-the-engineers-loop.js',
  'src/chapters/ch01/projects/p01-ridge-station-winch.js',
  'src/chapters/ch01/projects/p02-caravan-manifest.js',
  'src/chapters/ch01/projects/p03-controller-labels.js',
  'src/chapters/ch01/projects/p04-calibration-bench.js',
  'src/chapters/ch01/projects/p05-ghost-satellite.js',
  'src/chapters/ch01/projects/p06-settlement-standard.js',
  'src/main.js',
  'assets/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/fonts/BlackOpsOne-Regular.woff2',
  'assets/fonts/SpecialElite-Regular.woff2',
  'assets/fonts/IBMPlexMono-Regular.woff2',
  'assets/fonts/IBMPlexMono-SemiBold.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('salvage-engineer-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    // a page load (any #/route) is the game's index.html
    var key = req.mode === 'navigate' ? './' : req;
    return c.match(key, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(key, res.clone());
        return res;
      });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  }));
});
