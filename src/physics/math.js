/*
 * 2D vector and rotation helpers for the physics engine.
 *
 * Vectors are plain {x, y} objects. Functions never mutate their inputs, so
 * the solver code reads like the maths. Angles are in radians, measured
 * counter-clockwise; y points up. All quantities are SI (m, kg, s, N).
 */
(function (SE) {
  'use strict';

  function v(x, y) { return { x: x, y: y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
  function mulAdd(a, s, b) { return { x: a.x + s * b.x, y: a.y + s * b.y }; }   // a + s b
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function cross(a, b) { return a.x * b.y - a.y * b.x; }                     // scalar z of a × b
  function crossSV(s, a) { return { x: -s * a.y, y: s * a.x }; }              // ω × r
  function crossVS(a, s) { return { x: s * a.y, y: -s * a.x }; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function lenSq(a) { return a.x * a.x + a.y * a.y; }
  function dist(a, b) { return len(sub(a, b)); }
  function norm(a) { var l = len(a); return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; }
  function neg(a) { return { x: -a.x, y: -a.y }; }
  function perp(a) { return { x: -a.y, y: a.x }; }                            // left normal
  function rightPerp(a) { return { x: a.y, y: -a.x }; }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  // A rotation stored as cosine and sine.
  function rot(angle) { return { c: Math.cos(angle), s: Math.sin(angle) }; }
  function rotate(q, a) { return { x: q.c * a.x - q.s * a.y, y: q.s * a.x + q.c * a.y }; }
  function invRotate(q, a) { return { x: q.c * a.x + q.s * a.y, y: -q.s * a.x + q.c * a.y }; }

  // Transform = position p + rotation q.
  function xf(p, angle) { return { p: { x: p.x, y: p.y }, q: rot(angle) }; }
  function xfPoint(t, a) { return add(rotate(t.q, a), t.p); }
  function xfInvPoint(t, a) { return invRotate(t.q, sub(a, t.p)); }

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  SE.pmath = {
    v: v, add: add, sub: sub, scale: scale, mulAdd: mulAdd, dot: dot, cross: cross,
    crossSV: crossSV, crossVS: crossVS, len: len, lenSq: lenSq, dist: dist, norm: norm,
    neg: neg, perp: perp, rightPerp: rightPerp, lerp: lerp,
    rot: rot, rotate: rotate, invRotate: invRotate,
    xf: xf, xfPoint: xfPoint, xfInvPoint: xfInvPoint, clamp: clamp
  };
})(globalThis.SE);
