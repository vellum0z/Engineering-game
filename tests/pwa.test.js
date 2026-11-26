'use strict';
// Installable app: the manifest is valid and the service worker caches every
// file the game loads, so the installed app opens offline.
const fs = require('fs');
const path = require('path');
const { suite, test, ok, eq } = require('./harness');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

suite('pwa: install and offline', () => {
  const html = read('index.html');
  const sw = read('sw.js');
  const listed = (sw.match(/var FILES = \[([\s\S]*?)\];/) || [])[1] || '';
  const files = (listed.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));

  test('index.html links the manifest', () => {
    ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), 'manifest link');
    ok(/name="theme-color"/.test(html), 'theme colour');
  });
  test('manifest has a name, start url and the icons Android needs', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    ok(m.name && m.short_name, 'names');
    eq(m.start_url, './');
    ok(['fullscreen', 'standalone'].indexOf(m.display) >= 0, 'display mode');
    const sizes = m.icons.map(i => i.sizes);
    ok(sizes.indexOf('192x192') >= 0 && sizes.indexOf('512x512') >= 0, 'icon sizes');
    ok(m.icons.some(i => i.purpose === 'maskable'), 'maskable icon');
    m.icons.forEach(i => ok(fs.existsSync(path.join(root, i.src)), 'missing icon ' + i.src));
  });
  test('service worker caches every script and stylesheet index.html loads', () => {
    const wanted = (html.match(/(?:src|href)="([^"]+\.(?:js|css))"/g) || []).map(s => s.replace(/^(?:src|href)="|"$/g, ''));
    ok(wanted.length > 50, 'found the scripts');
    wanted.forEach(f => ok(files.indexOf(f) >= 0, 'sw.js FILES is missing ' + f));
  });
  test('service worker caches the fonts the styles use', () => {
    const css = fs.readdirSync(path.join(root, 'styles')).map(f => read('styles/' + f)).join('\n');
    (css.match(/url\('\.\.\/([^']+)'\)/g) || []).forEach(u => {
      const f = u.replace(/^url\('\.\.\/|'\)$/g, '');
      ok(files.indexOf(f) >= 0, 'sw.js FILES is missing ' + f);
    });
  });
  test('every cached file exists', () => {
    files.filter(f => f !== './').forEach(f => ok(fs.existsSync(path.join(root, f)), 'sw.js lists a missing file ' + f));
  });
});
