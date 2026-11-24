/*
 * Minimal test harness: no dependencies, runs with `node tests/run.js`.
 * Loads the engine and chapter scripts into the shared global namespace in
 * the same order index.html does.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function loadGame() {
  // Read the script list straight from index.html so tests always cover
  // exactly what the browser loads.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  // UI-only scripts touch the DOM at load time; everything else must load
  // headless so physics and answer keys can be tested.
  const skip = /\/(ui|game|tools|runner|manual|main)\.js$/;
  srcs.filter(s => s.startsWith('src/') && !skip.test(s)).forEach(s => require(path.join(ROOT, s)));
  return globalThis.SE;
}

const results = { pass: 0, fail: 0, failures: [] };
let current = '';

function suite(name, fn) { current = name; fn(); }
function test(name, fn) {
  try { fn(); results.pass++; }
  catch (e) { results.fail++; results.failures.push(`${current} › ${name}\n    ${e.message}`); }
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function near(actual, expected, rel, msg) {
  rel = rel == null ? 1e-9 : rel;
  const ok = expected === 0 ? Math.abs(actual) < rel : Math.abs(actual - expected) / Math.abs(expected) <= rel;
  if (!ok) throw new Error(`${msg || ''} expected ≈${expected}, got ${actual}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

module.exports = { loadGame, suite, test, eq, near, ok, results };
