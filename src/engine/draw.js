/*
 * Drawing kit for the game's look: rust, scrap and blueprint ink.
 *
 * Everything is procedural (no image assets). "Sketchy" strokes are drawn
 * with a small deterministic wobble so diagrams look hand-drafted but do not
 * shimmer from frame to frame.
 */
(function (SE) {
  'use strict';

  var C = {
    night: '#14110f', soot: '#1d1916', iron: '#2b2622', steel: '#6f6b64', steelHi: '#a7a29a',
    rust: '#b4532a', rustDark: '#7a3418', rustHi: '#d9824f', paper: '#ece2c6', paperDim: '#d6c9a6',
    ink: '#2a2a33', hazard: '#e6b422', blood: '#a1281e', rot: '#7f9a4a', rotDark: '#4a5d2c',
    blue: '#173a5e', blueInk: '#8fb8e8', blueGrid: 'rgba(143,184,232,0.16)', sky1: '#3a2a26', sky2: '#c06a3c',
    good: '#8fcf6a', bad: '#e2553f', force: '#ffb347', accel: '#6ad0ff', vel: '#b98cff', weight: '#ff6b6b', wood: '#8a5a33', woodDark: '#5e3a1e'
  };

  // Deterministic pseudo-random from a seed (mulberry32).
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function sketchLine(ctx, x1, y1, x2, y2, opts) {
    opts = opts || {};
    var r = rng(opts.seed || (Math.round(x1 * 7 + y1 * 13 + x2 * 17 + y2 * 19) | 0));
    var wob = opts.wobble == null ? 1.2 : opts.wobble;
    var passes = opts.passes || 2;
    for (var p = 0; p < passes; p++) {
      ctx.beginPath();
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.hypot(dx, dy);
      var nx = -dy / (len || 1), ny = dx / (len || 1);
      var o1 = (r() - 0.5) * wob, o2 = (r() - 0.5) * wob, om = (r() - 0.5) * wob * 1.5;
      ctx.moveTo(x1 + nx * o1, y1 + ny * o1);
      ctx.quadraticCurveTo((x1 + x2) / 2 + nx * om, (y1 + y2) / 2 + ny * om, x2 + nx * o2, y2 + ny * o2);
      ctx.stroke();
    }
  }

  function sketchRect(ctx, x, y, w, h, opts) {
    sketchLine(ctx, x, y, x + w, y, opts);
    sketchLine(ctx, x + w, y, x + w, y + h, opts);
    sketchLine(ctx, x + w, y + h, x, y + h, opts);
    sketchLine(ctx, x, y + h, x, y, opts);
  }

  // Arrow for force / velocity / acceleration vectors.
  function arrow(ctx, x1, y1, x2, y2, color, label, opts) {
    opts = opts || {};
    var len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    var ang = Math.atan2(y2 - y1, x2 - x1);
    var head = Math.min(14, len * 0.45) * (opts.headScale || 1);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = opts.width || 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.4) * head, y2 - Math.sin(ang - 0.4) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.4) * head, y2 - Math.sin(ang + 0.4) * head);
    ctx.closePath(); ctx.fill();
    if (label) {
      ctx.font = (opts.font || '600 13px "IBM Plex Mono", monospace');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var lx = x2 + Math.cos(ang) * 14 + (opts.lx || 0), ly = y2 + Math.sin(ang) * 14 - 10 + (opts.ly || 0);
      labelBox(ctx, label, lx, ly, color);
    }
    ctx.restore();
  }

  function labelBox(ctx, text, x, y, color, bg) {
    ctx.save();
    ctx.font = ctx.font || '600 13px "IBM Plex Mono", monospace';
    var w = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg || 'rgba(20,17,15,0.78)';
    roundRect(ctx, x - w / 2, y - 10, w, 20, 4); ctx.fill();
    ctx.fillStyle = color || C.paper;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // Cached rust/metal texture patterns.
  var patternCache = {};
  function rustPattern(ctx, base, seed) {
    var key = base + '|' + (seed || 0);
    if (patternCache[key]) return patternCache[key];
    if (typeof document === 'undefined') return base;
    var c = document.createElement('canvas'); c.width = c.height = 96;
    var g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 96, 96);
    var r = rng(seed || 7);
    for (var i = 0; i < 260; i++) {
      var x = r() * 96, y = r() * 96, s = r() * 3 + 0.5;
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,' + (r() * 0.18) + ')' : 'rgba(255,170,110,' + (r() * 0.12) + ')';
      g.fillRect(x, y, s, s);
    }
    for (var j = 0; j < 7; j++) {
      g.fillStyle = 'rgba(120,45,15,' + (0.15 + r() * 0.2) + ')';
      g.beginPath(); g.ellipse(r() * 96, r() * 96, 4 + r() * 10, 2 + r() * 6, r() * 3, 0, Math.PI * 2); g.fill();
    }
    patternCache[key] = ctx.createPattern(c, 'repeat');
    return patternCache[key];
  }

  function hazardStripes(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = C.hazard; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1b1b1b';
    for (var i = -h; i < w + h; i += 16) {
      ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 8, y + h); ctx.lineTo(x + i + 8 + h, y); ctx.lineTo(x + i + h, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function crate(ctx, x, y, w, h, opts) {
    // x,y = bottom-left in screen px
    opts = opts || {};
    ctx.save();
    ctx.fillStyle = rustPattern(ctx, opts.color || C.wood, 3);
    ctx.fillRect(x, y - h, w, h);
    ctx.strokeStyle = C.woodDark; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y - h + 1, w - 2, h - 2);
    ctx.beginPath(); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x + w - 3, y - h + 3); ctx.moveTo(x + 3, y - h + 3); ctx.lineTo(x + w - 3, y - 3); ctx.stroke();
    if (opts.label) {
      ctx.font = '600 ' + Math.max(10, Math.min(15, w / 6)) + 'px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(20,17,15,0.75)';
      var tw = ctx.measureText(opts.label).width + 8;
      ctx.fillRect(x + w / 2 - tw / 2, y - h / 2 - 9, tw, 18);
      ctx.fillStyle = C.paper; ctx.fillText(opts.label, x + w / 2, y - h / 2);
    }
    ctx.restore();
  }

  function zombie(ctx, x, y, s, t, seed) {
    // shambling silhouette standing on (x,y); s = height px
    var r = rng(seed || 1);
    var sway = Math.sin(t * (1.5 + r()) + seed) * 0.08;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(sway);
    ctx.fillStyle = r() < 0.5 ? C.rotDark : '#3b3a2e';
    ctx.beginPath(); ctx.ellipse(0, -s * 0.88, s * 0.09, s * 0.11, 0, 0, Math.PI * 2); ctx.fill();     // head
    ctx.fillRect(-s * 0.1, -s * 0.78, s * 0.2, s * 0.42);                                                  // torso
    ctx.save(); ctx.translate(0, -s * 0.7); ctx.rotate(-1.2 + Math.sin(t * 2 + seed) * 0.15);
    ctx.fillRect(0, -s * 0.03, s * 0.34, s * 0.06); ctx.restore();                                         // arm
    ctx.save(); ctx.translate(0, -s * 0.66); ctx.rotate(-1.35 + Math.cos(t * 2.3 + seed) * 0.15);
    ctx.fillRect(0, -s * 0.03, s * 0.3, s * 0.06); ctx.restore();
    var step = Math.sin(t * 2 + seed) * 0.25;
    ctx.save(); ctx.translate(-s * 0.05, -s * 0.37); ctx.rotate(step); ctx.fillRect(-s * 0.04, 0, s * 0.08, s * 0.37); ctx.restore();
    ctx.save(); ctx.translate(s * 0.05, -s * 0.37); ctx.rotate(-step); ctx.fillRect(-s * 0.04, 0, s * 0.08, s * 0.37); ctx.restore();
    ctx.fillStyle = 'rgba(230,200,90,0.8)';
    ctx.fillRect(s * 0.02, -s * 0.9, s * 0.03, s * 0.02);
    ctx.restore();
  }

  function survivor(ctx, x, y, s, t, color) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = color || '#2f3a44';
    ctx.beginPath(); ctx.arc(0, -s * 0.88, s * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.hazard; ctx.fillRect(-s * 0.13, -s * 0.97, s * 0.26, s * 0.06); // hard hat brim
    ctx.beginPath(); ctx.arc(0, -s * 0.95, s * 0.1, Math.PI, 0); ctx.fill();
    ctx.fillStyle = color || '#2f3a44';
    ctx.fillRect(-s * 0.11, -s * 0.76, s * 0.22, s * 0.4);
    ctx.fillStyle = C.rust; ctx.fillRect(-s * 0.11, -s * 0.62, s * 0.22, s * 0.05);
    ctx.fillStyle = '#22282e';
    ctx.fillRect(-s * 0.1, -s * 0.36, s * 0.08, s * 0.36); ctx.fillRect(s * 0.02, -s * 0.36, s * 0.08, s * 0.36);
    ctx.restore();
  }

  // Far background: dusk sky, ruined skyline, fence.
  function backdrop(ctx, w, h, t, opts) {
    opts = opts || {};
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, opts.sky1 || C.sky1); g.addColorStop(0.65, opts.sky2 || C.sky2); g.addColorStop(1, '#2a1c15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // sun disc behind haze
    ctx.fillStyle = 'rgba(255,200,140,0.35)';
    ctx.beginPath(); ctx.arc(w * 0.78, h * 0.42, Math.min(w, h) * 0.09, 0, Math.PI * 2); ctx.fill();
    // skyline layers
    var r = rng(42);
    for (var layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer === 0 ? 'rgba(40,26,22,0.55)' : 'rgba(25,18,15,0.85)';
      var base = h * (layer === 0 ? 0.62 : 0.7);
      var x = -20;
      while (x < w + 40) {
        var bw = 30 + r() * 70, bh = (layer === 0 ? 40 : 25) + r() * (layer === 0 ? 120 : 80);
        ctx.fillRect(x, base - bh, bw, bh + h);
        if (r() < 0.25) { ctx.fillRect(x + bw * 0.4, base - bh - 30, 4, 30); }        // antenna / broken beam
        if (r() < 0.2) { ctx.beginPath(); ctx.moveTo(x, base - bh); ctx.lineTo(x + bw * 0.5, base - bh - 18); ctx.lineTo(x + bw, base - bh); ctx.fill(); }
        x += bw + r() * 12;
      }
    }
    // water tower silhouette
    ctx.fillStyle = 'rgba(20,14,12,0.9)';
    var wx = w * 0.15, wy = h * 0.7;
    ctx.fillRect(wx - 30, wy - 110, 60, 40);
    ctx.beginPath(); ctx.moveTo(wx - 34, wy - 110); ctx.lineTo(wx, wy - 128); ctx.lineTo(wx + 34, wy - 110); ctx.fill();
    ctx.fillRect(wx - 26, wy - 70, 4, 70); ctx.fillRect(wx + 22, wy - 70, 4, 70);
    ctx.strokeStyle = 'rgba(20,14,12,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wx - 24, wy - 70); ctx.lineTo(wx + 24, wy); ctx.moveTo(wx + 24, wy - 70); ctx.lineTo(wx - 24, wy); ctx.stroke();
    // drifting dust
    if (!opts.still) {
      ctx.fillStyle = 'rgba(255,220,180,0.06)';
      for (var i = 0; i < 30; i++) {
        var px = ((i * 97 + t * (8 + i % 5)) % (w + 40)) - 20, py = (i * 53) % h;
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }

  function ground(ctx, w, y, h) {
    ctx.fillStyle = rustPattern(ctx, '#3a2f27', 11);
    ctx.fillRect(0, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y, w, 3);
    ctx.fillStyle = 'rgba(255,180,120,0.08)'; ctx.fillRect(0, y + 3, w, 1);
  }

  function fence(ctx, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(150,140,130,0.55)'; ctx.lineWidth = 1;
    for (var i = 0; i <= w; i += 10) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + 10, y - h); ctx.moveTo(x + i + 10, y); ctx.lineTo(x + i, y - h); ctx.stroke(); }
    ctx.fillStyle = C.steel;
    for (var j = 0; j <= w; j += 60) ctx.fillRect(x + j - 2, y - h - 6, 4, h + 6);
    ctx.restore();
  }

  function blueprintGrid(ctx, w, h, step) {
    ctx.save();
    ctx.fillStyle = 'rgba(23,58,94,0.35)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.blueGrid; ctx.lineWidth = 1;
    step = step || 24;
    for (var x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (var y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  // Engineering dimension line with ticks and a centred label.
  function dimLine(ctx, x1, y1, x2, y2, label, color) {
    ctx.save();
    ctx.strokeStyle = color || C.blueInk; ctx.fillStyle = color || C.blueInk; ctx.lineWidth = 1.2;
    sketchLine(ctx, x1, y1, x2, y2, { wobble: 0.6, passes: 1 });
    var ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang) * 6, ny = Math.cos(ang) * 6;
    [[x1, y1], [x2, y2]].forEach(function (p) { ctx.beginPath(); ctx.moveTo(p[0] - nx, p[1] - ny); ctx.lineTo(p[0] + nx, p[1] + ny); ctx.stroke(); });
    if (label) { ctx.font = '600 12px "IBM Plex Mono", monospace'; labelBox(ctx, label, (x1 + x2) / 2, (y1 + y2) / 2 - 12, color || C.blueInk, 'rgba(15,30,50,0.85)'); }
    ctx.restore();
  }

  function text(ctx, s, x, y, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = opts.font || '600 13px "IBM Plex Mono", monospace';
    ctx.fillStyle = opts.color || C.paper;
    ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.baseline || 'alphabetic';
    if (opts.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3; }
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  SE.draw = {
    C: C, rng: rng, sketchLine: sketchLine, sketchRect: sketchRect, arrow: arrow, labelBox: labelBox,
    roundRect: roundRect, rustPattern: rustPattern, hazardStripes: hazardStripes, crate: crate,
    zombie: zombie, survivor: survivor, backdrop: backdrop, ground: ground, fence: fence,
    blueprintGrid: blueprintGrid, dimLine: dimLine, text: text
  };
})(globalThis.SE);
