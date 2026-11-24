/*
 * Broadphase, collision filtering and contact/sensor events.
 *
 *   P.broadphase.update(world)
 * keeps a persistent set of fixture pairs whose fattened boxes overlap, runs
 * the narrowphase (P.collide) on the pairs that involve an awake body, and
 * keeps world.contacts as a Map of key -> contact. A contact that existed
 * last step keeps its points' impulses (matched by feature id) so the solver
 * can warm-start.
 *
 * A contact is
 *   { key, fa, fb, manifold, points: [{ point, separation, id,
 *     normalImpulse, tangentImpulse }], touching, isNew }
 * with fa.body.id < fb.body.id, so the normal always points from fa to fb.
 * The key is 'bodyIdA:fixtureIndexA|bodyIdB:fixtureIndexB'. Contacts between
 * two sleeping (or sleeping and static) bodies are left exactly as they were.
 *
 *   P.broadphase.shouldCollide(world, fa, fb)
 * is the single filtering rule for solid contacts:
 *   - never the same body, never two non-dynamic bodies, never sensors;
 *   - fixture filters { category, mask, group } with Box2D semantics: two
 *     fixtures in the same non-zero group always collide if the group is
 *     positive and never if it is negative; otherwise both
 *     (catA & maskB) and (catB & maskA) must be non-zero;
 *   - bodies joined by a joint don't collide unless it has collideConnected.
 *
 * How the pairs are found (after Box2D's dynamic_tree.c):
 *   Every fixture owns a proxy in one of two dynamic AABB trees, one for
 *   static bodies and one for everything else. A proxy stores a "fat" box:
 *   the shape's box padded by the speculative distance plus a margin
 *   (AABB_MARGIN). While the shape stays inside its fat box nothing in the
 *   tree changes. When it pokes out, the proxy is re-inserted with a fresh fat
 *   box and goes in the move buffer. Only moved proxies query the trees for
 *   new pairs, so a scene at rest costs almost nothing. Pairs are dropped
 *   when their fat boxes stop overlapping. Insertion picks the sibling with
 *   the smallest perimeter growth and the tree is kept balanced with AVL
 *   style rotations, so queries stay O(log n).
 *
 * Events emitted through world.emit:
 *   'contactBegin' { a, b, fa, fb, point, normal }  a pair starts touching
 *   'contactEnd'   { a, b, fa, fb }                 a touching pair separates
 *   'sensorBegin'  { sensor, visitor, sensorBody, visitorBody }
 *   'sensorEnd'    { sensor, visitor, sensorBody, visitorBody }
 * sensor and visitor are fixtures. A sensor fixture overlaps another
 * (non-sensor) fixture when their shapes actually intersect; sensors never
 * make contacts and never push anything. Filters apply to sensors too.
 *
 *   P.broadphase.sensorVisitors(world, sensorFixtureOrBody) -> [fixture]
 *   P.broadphase.pairs(world) -> [key]          (tests and debug drawing)
 *   P.broadphase.proxies(world) -> [{ fixture, lo, hi, isStatic }]
 *   P.DynamicTree                                the tree itself
 *
 * At the end of update(), P.islands.beforeStep(world) wakes any sleeping
 * island that an awake body has reached, so the solver never pushes on a
 * sleeping body.
 */
(function (SE) {
  'use strict';
  var M = SE.pmath, P = SE.phys;

  var AABB_MARGIN = 0.1;                  // m, same as Box2D's b2_aabbMargin
  var DEFAULT_FILTER = { category: 1, mask: 0xFFFFFFFF, group: 0 };

  /* ------------------------------------------------------ dynamic tree */
  // Nodes live in a growable array; leaves carry user data (a proxy).
  function DynamicTree() {
    this.nodes = [];
    this.free = [];
    this.root = -1;
    this.stack = [];
  }

  DynamicTree.prototype.alloc = function () {
    var id;
    if (this.free.length) id = this.free.pop();
    else { id = this.nodes.length; this.nodes.push(null); }
    this.nodes[id] = { lx: 0, ly: 0, ux: 0, uy: 0, parent: -1, c1: -1, c2: -1, height: 0, data: null };
    return id;
  };
  DynamicTree.prototype.release = function (id) { this.nodes[id] = null; this.free.push(id); };

  function perimeter(lx, ly, ux, uy) { return 2 * ((ux - lx) + (uy - ly)); }

  DynamicTree.prototype.createProxy = function (lx, ly, ux, uy, data) {
    var id = this.alloc(), n = this.nodes[id];
    n.lx = lx; n.ly = ly; n.ux = ux; n.uy = uy; n.data = data;
    this.insertLeaf(id);
    return id;
  };
  DynamicTree.prototype.destroyProxy = function (id) { this.removeLeaf(id); this.release(id); };
  DynamicTree.prototype.moveProxy = function (id, lx, ly, ux, uy) {
    this.removeLeaf(id);
    var n = this.nodes[id];
    n.lx = lx; n.ly = ly; n.ux = ux; n.uy = uy;
    this.insertLeaf(id);
  };

  DynamicTree.prototype.insertLeaf = function (leaf) {
    var N = this.nodes, L = N[leaf];
    if (this.root === -1) { this.root = leaf; L.parent = -1; return; }
    // walk down, at each node choosing whichever is cheaper: pair the leaf
    // with this node, or push it into the child whose perimeter grows least
    var idx = this.root;
    while (N[idx].c1 !== -1) {
      var node = N[idx], c1 = N[node.c1], c2 = N[node.c2];
      var area = perimeter(node.lx, node.ly, node.ux, node.uy);
      var cArea = perimeter(Math.min(node.lx, L.lx), Math.min(node.ly, L.ly), Math.max(node.ux, L.ux), Math.max(node.uy, L.uy));
      var cost = 2 * cArea, inherit = 2 * (cArea - area);
      var cost1 = childCost(c1, L) + inherit, cost2 = childCost(c2, L) + inherit;
      if (cost < cost1 && cost < cost2) break;
      idx = cost1 < cost2 ? node.c1 : node.c2;
    }
    var sib = idx, S = N[sib], oldParent = S.parent;
    var np = this.alloc(), P2 = N[np];
    P2.parent = oldParent;
    P2.lx = Math.min(S.lx, L.lx); P2.ly = Math.min(S.ly, L.ly);
    P2.ux = Math.max(S.ux, L.ux); P2.uy = Math.max(S.uy, L.uy);
    P2.height = S.height + 1;
    P2.c1 = sib; P2.c2 = leaf; S.parent = np; L.parent = np;
    if (oldParent !== -1) {
      if (N[oldParent].c1 === sib) N[oldParent].c1 = np; else N[oldParent].c2 = np;
    } else this.root = np;
    this.refit(L.parent);
  };

  function childCost(c, L) {
    var lx = Math.min(c.lx, L.lx), ly = Math.min(c.ly, L.ly), ux = Math.max(c.ux, L.ux), uy = Math.max(c.uy, L.uy);
    var p = perimeter(lx, ly, ux, uy);
    return c.c1 === -1 ? p : p - perimeter(c.lx, c.ly, c.ux, c.uy);
  }

  // Walk to the root fixing heights and boxes, rotating where unbalanced.
  DynamicTree.prototype.refit = function (idx) {
    var N = this.nodes;
    while (idx !== -1) {
      idx = this.balance(idx);
      var n = N[idx], a = N[n.c1], b = N[n.c2];
      n.height = 1 + Math.max(a.height, b.height);
      n.lx = Math.min(a.lx, b.lx); n.ly = Math.min(a.ly, b.ly);
      n.ux = Math.max(a.ux, b.ux); n.uy = Math.max(a.uy, b.uy);
      idx = n.parent;
    }
  };

  DynamicTree.prototype.removeLeaf = function (leaf) {
    var N = this.nodes;
    if (leaf === this.root) { this.root = -1; return; }
    var parent = N[leaf].parent, gp = N[parent].parent;
    var sib = N[parent].c1 === leaf ? N[parent].c2 : N[parent].c1;
    if (gp !== -1) {
      if (N[gp].c1 === parent) N[gp].c1 = sib; else N[gp].c2 = sib;
      N[sib].parent = gp;
      this.release(parent);
      this.refit(gp);
    } else {
      this.root = sib; N[sib].parent = -1;
      this.release(parent);
    }
  };

  // AVL rotation: if one child of A is two levels taller than the other,
  // promote it. Returns the index of the node now at A's place.
  DynamicTree.prototype.balance = function (iA) {
    var N = this.nodes, A = N[iA];
    if (A.c1 === -1 || A.height < 2) return iA;
    var iB = A.c1, iC = A.c2, B = N[iB], C = N[iC];
    var bal = C.height - B.height;
    if (bal > 1) return this.rotate(iA, iC, iB);
    if (bal < -1) return this.rotate(iA, iB, iC);
    return iA;
  };

  // Promote the tall child iT of iA over its sibling iS.
  DynamicTree.prototype.rotate = function (iA, iT, iS) {
    var N = this.nodes, A = N[iA], T = N[iT], S = N[iS];
    var iF = T.c1, iG = T.c2, F = N[iF], G = N[iG];
    T.c1 = iA; T.parent = A.parent; A.parent = iT;
    if (T.parent !== -1) {
      if (N[T.parent].c1 === iA) N[T.parent].c1 = iT; else N[T.parent].c2 = iT;
    } else this.root = iT;
    // keep the taller grandchild under T, give the shorter one to A
    var keep = F.height > G.height ? iF : iG, give = keep === iF ? iG : iF;
    var K = N[keep], Gv = N[give];
    T.c2 = keep;
    if (A.c1 === iT) A.c1 = give; else A.c2 = give;
    Gv.parent = iA;
    A.lx = Math.min(S.lx, Gv.lx); A.ly = Math.min(S.ly, Gv.ly);
    A.ux = Math.max(S.ux, Gv.ux); A.uy = Math.max(S.uy, Gv.uy);
    A.height = 1 + Math.max(S.height, Gv.height);
    T.lx = Math.min(A.lx, K.lx); T.ly = Math.min(A.ly, K.ly);
    T.ux = Math.max(A.ux, K.ux); T.uy = Math.max(A.uy, K.uy);
    T.height = 1 + Math.max(A.height, K.height);
    return iT;
  };

  // Call fn(leafData, leafId) for every leaf overlapping the box.
  DynamicTree.prototype.query = function (lx, ly, ux, uy, fn) {
    if (this.root === -1) return;
    var N = this.nodes, st = this.stack, top = 0;
    st[top++] = this.root;
    while (top > 0) {
      var n = N[st[--top]];
      if (n.lx > ux || n.ux < lx || n.ly > uy || n.uy < ly) continue;
      if (n.c1 === -1) fn(n.data);
      else { st[top++] = n.c1; st[top++] = n.c2; }
    }
  };

  DynamicTree.prototype.height = function () { return this.root === -1 ? 0 : this.nodes[this.root].height; };

  // Structural check for tests: parents, heights and boxes all consistent.
  DynamicTree.prototype.validate = function () {
    var N = this.nodes, self = this, leaves = 0;
    function walk(i, parent) {
      var n = N[i];
      if (n.parent !== parent) throw new Error('bad parent at ' + i);
      if (n.c1 === -1) { if (n.height !== 0) throw new Error('leaf height'); leaves++; return 0; }
      var a = N[n.c1], b = N[n.c2];
      var h1 = walk(n.c1, i), h2 = walk(n.c2, i);
      if (n.height !== 1 + Math.max(h1, h2)) throw new Error('bad height at ' + i);
      if (Math.abs(h1 - h2) > 1) throw new Error('unbalanced at ' + i);
      if (n.lx > Math.min(a.lx, b.lx) || n.ux < Math.max(a.ux, b.ux) || n.ly > Math.min(a.ly, b.ly) || n.uy < Math.max(a.uy, b.uy)) throw new Error('box does not enclose children at ' + i);
      return n.height;
    }
    if (self.root !== -1) walk(self.root, -1);
    return leaves;
  };

  /* --------------------------------------------------------- filtering */
  function filterOf(f) { return f.filter || DEFAULT_FILTER; }

  function filtersPass(fa, fb) {
    var A = filterOf(fa), B = filterOf(fb);
    if (A.group !== 0 && A.group === B.group) return A.group > 0;
    return (A.mask & B.category) !== 0 && (A.category & B.mask) !== 0;
  }

  // body -> Set of bodies it is jointed to (joints without collideConnected)
  function jointed(world, A, B) {
    var st = world._bp;
    if (st && st.jointMap) { var s = st.jointMap.get(A); return !!s && s.has(B); }
    return world.jointed(A, B);
  }

  function shouldCollide(world, fa, fb) {
    var A = fa.body, B = fb.body;
    if (A === B) return false;
    if (A.type !== 'dynamic' && B.type !== 'dynamic') return false;
    if (fa.sensor || fb.sensor) return false;
    if (!filtersPass(fa, fb)) return false;
    if (jointed(world, A, B)) return false;
    return true;
  }

  // Sensors see any non-sensor fixture on another body that passes the
  // filter, as long as at least one of the two bodies can move.
  function shouldSense(fa, fb) {
    if (fa.sensor === fb.sensor) return false;
    var A = fa.body, B = fb.body;
    if (A === B) return false;
    if (A.type === 'static' && B.type === 'static') return false;
    return filtersPass(fa, fb);
  }

  /* ------------------------------------------------------------- state */
  function state(world) {
    if (!world._bp) {
      world._bp = {
        dyn: new DynamicTree(), stat: new DynamicTree(),
        pairs: new Map(),            // key -> pair
        known: new Set(),            // bodies with proxies
        joints: new Set(), jointMap: new Map(),
        moved: [], stamp: 0
      };
    }
    return world._bp;
  }

  function isActive(b) { return b.type !== 'static' && b.awake !== false; }

  function fixtureBox(f, t, out) {
    var bb = P.aabb(f.shape, t), pad = P.SPECULATIVE;
    out.lx = bb.lo.x - pad; out.ly = bb.lo.y - pad; out.ux = bb.hi.x + pad; out.uy = bb.hi.y + pad;
    return out;
  }

  function createProxies(st, b) {
    var t = b.transform(), box = {}, isStatic = b.type === 'static';
    var tree = isStatic ? st.stat : st.dyn, m = isStatic ? 0 : AABB_MARGIN;
    b._bpProxies = b.fixtures.map(function (f, i) {
      fixtureBox(f, t, box);
      var px = { fixture: f, body: b, index: i, key: b.id + ':' + i, isStatic: isStatic, tree: tree, id: -1,
        lx: box.lx - m, ly: box.ly - m, ux: box.ux + m, uy: box.uy + m,
        // the tight (speculatively padded) box, for a cheap pre-check before the narrowphase
        tlx: box.lx, tly: box.ly, tux: box.ux, tuy: box.uy };
      px.id = tree.createProxy(px.lx, px.ly, px.ux, px.uy, px);
      st.moved.push(px);
      return px;
    });
    b._bpType = b.type;
    b._bpPose = { x: b.c.x, y: b.c.y, a: b.angle };
  }

  function destroyProxies(world, st, b) {
    (b._bpProxies || []).forEach(function (px) { px.tree.destroyProxy(px.id); px.dead = true; });
    b._bpProxies = null;
    st.pairs.forEach(function (pr, key) {
      if (pr.fa.body === b || pr.fb.body === b) destroyPair(world, st, pr);
    });
  }

  // Joint list changed (added, removed or broken)? Rebuild the lookup of
  // jointed body pairs and wake both bodies of every changed joint.
  function syncJoints(world) {
    var st = state(world), js = world.joints, changed = js.length !== st.joints.size;
    if (!changed) for (var i = 0; i < js.length; i++) if (!st.joints.has(js[i])) { changed = true; break; }
    if (!changed) return;
    var now = new Set(js);
    var touched = [];
    now.forEach(function (j) { if (!st.joints.has(j)) touched.push(j); });
    st.joints.forEach(function (j) { if (!now.has(j)) touched.push(j); });
    st.joints = now;
    var map = st.jointMap = new Map();
    function link(a, b) { var s = map.get(a); if (!s) map.set(a, s = new Set()); s.add(b); }
    js.forEach(function (j) { if (!j.collideConnected && j.bodyA && j.bodyB) { link(j.bodyA, j.bodyB); link(j.bodyB, j.bodyA); } });
    touched.forEach(function (j) {
      [j.bodyA, j.bodyB].forEach(function (b) {
        if (!b || b.type === 'static') return;
        if (P.islands && P.islands.wakeIsland) P.islands.wakeIsland(world, b); else b.wake();
        // a removed joint may let a pair collide again: let the proxies re-query
        if (b._bpProxies) b._bpProxies.forEach(function (px) { if (st.moved.indexOf(px) < 0) st.moved.push(px); });
      });
    });
  }

  /* ------------------------------------------------------------- pairs */
  function makePair(st, p1, p2, sensor) {
    var first = p1.body.id < p2.body.id || (p1.body === p2.body && p1.index < p2.index) ? p1 : p2;
    var second = first === p1 ? p2 : p1;
    var key = first.key + '|' + second.key;
    if (st.pairs.has(key)) return;
    st.pairs.set(key, { key: key, pa: first, pb: second, fa: first.fixture, fb: second.fixture,
      sensor: sensor, touching: false, overlapping: false, fresh: true });
  }

  function destroyPair(world, st, pr) {
    st.pairs.delete(pr.key);
    if (pr.sensor) { if (pr.overlapping) emitSensor(world, pr, 'sensorEnd'); return; }
    if (world.contacts.has(pr.key)) world.contacts.delete(pr.key);
    if (pr.touching) world.emit('contactEnd', { a: pr.fa.body, b: pr.fb.body, fa: pr.fa, fb: pr.fb });
  }

  function emitSensor(world, pr, type) {
    var s = pr.fa.sensor ? pr.fa : pr.fb, v = s === pr.fa ? pr.fb : pr.fa;
    world.emit(type, { sensor: s, visitor: v, sensorBody: s.body, visitorBody: v.body });
  }

  function fatOverlap(a, b) { return !(a.lx > b.ux || a.ux < b.lx || a.ly > b.uy || a.uy < b.ly); }

  /* ------------------------------------------------------------ update */
  function update(world) {
    var st = state(world), bodies = world.bodies, stamp = ++st.stamp, i, k;
    syncJoints(world);

    // 1. proxies follow the bodies
    var box = { lx: 0, ly: 0, ux: 0, uy: 0 };
    for (i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      b._bpStamp = stamp;
      if (!st.known.has(b)) { st.known.add(b); createProxies(st, b); continue; }
      if (b._bpType !== b.type || b._bpProxies.length !== b.fixtures.length) {
        destroyProxies(world, st, b); createProxies(st, b); continue;
      }
      var pose = b._bpPose;
      if (pose.x === b.c.x && pose.y === b.c.y && pose.a === b.angle) continue;
      pose.x = b.c.x; pose.y = b.c.y; pose.a = b.angle;
      if (b.type === 'static') b._bpMovedStamp = stamp;     // moved by setTransform
      var t = b.transform(), m = b.type === 'static' ? 0 : AABB_MARGIN;
      for (k = 0; k < b._bpProxies.length; k++) {
        var px = b._bpProxies[k];
        fixtureBox(px.fixture, t, box);
        px.tlx = box.lx; px.tly = box.ly; px.tux = box.ux; px.tuy = box.uy;
        if (m > 0 && px.lx <= box.lx && px.ly <= box.ly && px.ux >= box.ux && px.uy >= box.uy) continue;
        px.lx = box.lx - m; px.ly = box.ly - m; px.ux = box.ux + m; px.uy = box.uy + m;
        px.tree.moveProxy(px.id, px.lx, px.ly, px.ux, px.uy);
        st.moved.push(px);
      }
    }
    if (st.known.size !== bodies.length) {
      st.known.forEach(function (b) { if (b._bpStamp !== stamp) { st.known.delete(b); destroyProxies(world, st, b); } });
    }

    // 2. moved proxies look for new pairs
    var moved = st.moved;
    for (i = 0; i < moved.length; i++) {
      var mp = moved[i];
      if (mp.dead) continue;
      var visit = function (other) {
        if (other === mp || other.body === mp.body) return;
        var fa = mp.fixture, fb = other.fixture;
        if (fa.sensor || fb.sensor) { if (shouldSense(fa, fb)) makePair(st, mp, other, true); }
        else if (shouldCollide(world, fa, fb)) makePair(st, mp, other, false);
      };
      st.dyn.query(mp.lx, mp.ly, mp.ux, mp.uy, visit);
      if (!mp.isStatic) st.stat.query(mp.lx, mp.ly, mp.ux, mp.uy, visit);
    }
    st.moved = [];

    // 3. update every pair: drop stale ones, narrowphase the active ones
    function xf(body) {
      if (body._bpXfStamp !== stamp) { body._bpXf = body.transform(); body._bpXfStamp = stamp; }
      return body._bpXf;
    }
    var begins = [];
    st.pairs.forEach(function (pr) {
      var fa = pr.fa, fb = pr.fb, A = fa.body, B = fb.body;
      // a static body moved by hand wakes whatever it was holding
      if (P.islands && P.islands.wakeIsland) {
        if (A._bpMovedStamp === stamp && B.awake === false) P.islands.wakeIsland(world, B);
        if (B._bpMovedStamp === stamp && A.awake === false) P.islands.wakeIsland(world, A);
      }
      // both bodies asleep or static: nothing moved, so nothing to redo
      if (!pr.fresh && !isActive(A) && !isActive(B)) {
        var keep = world.contacts.get(pr.key);
        if (keep) keep.isNew = false;
        return;
      }
      if (pr.pa.dead || pr.pb.dead || !fatOverlap(pr.pa, pr.pb) ||
          (pr.sensor ? !shouldSense(fa, fb) : !shouldCollide(world, fa, fb))) { destroyPair(world, st, pr); return; }
      pr.fresh = false;
      if (pr.sensor) {
        var sm = P.collide(fa.shape, xf(A), fb.shape, xf(B)), over = false;
        if (sm) for (var s = 0; s < sm.points.length; s++) if (sm.points[s].separation < 0) { over = true; break; }
        if (over !== pr.overlapping) { pr.overlapping = over; emitSensor(world, pr, over ? 'sensorBegin' : 'sensorEnd'); }
        return;
      }
      // shapes further apart than twice the speculative distance have no manifold
      var pa = pr.pa, pb = pr.pb;
      var man = pa.tlx > pb.tux || pa.tux < pb.tlx || pa.tly > pb.tuy || pa.tuy < pb.tly ? null
        : P.collide(fa.shape, xf(A), fb.shape, xf(B));
      var old = world.contacts.get(pr.key);
      if (!man) {
        if (old) world.contacts.delete(pr.key);
        if (pr.touching) { pr.touching = false; world.emit('contactEnd', { a: A, b: B, fa: fa, fb: fb }); }
        return;
      }
      var pts = man.points, points = new Array(pts.length), touching = false;
      for (var q = 0; q < pts.length; q++) {
        var p = pts[q], cp = { point: p.point, separation: p.separation, id: p.id, normalImpulse: 0, tangentImpulse: 0 };
        if (old) for (var o = 0; o < old.points.length; o++) {
          var op = old.points[o];
          if (op.id === p.id) { cp.normalImpulse = op.normalImpulse; cp.tangentImpulse = op.tangentImpulse; break; }
        }
        if (p.separation < P.LINEAR_SLOP) touching = true;
        points[q] = cp;
      }
      var ct = old || { key: pr.key, fa: fa, fb: fb };
      ct.manifold = man; ct.points = points; ct.touching = touching;
      ct.isNew = !old || !pr.touching;
      if (!old) world.contacts.set(pr.key, ct);
      if (touching !== pr.touching) {
        pr.touching = touching;
        if (touching) begins.push(ct);
        else world.emit('contactEnd', { a: A, b: B, fa: fa, fb: fb });
      }
    });
    // contacts can be left behind if world.remove() dropped a body's pairs
    if (world.contacts.size > st.pairs.size) {
      world.contacts.forEach(function (ct, key) { if (!st.pairs.has(key)) world.contacts.delete(key); });
    }
    begins.forEach(function (ct) {
      world.emit('contactBegin', { a: ct.fa.body, b: ct.fb.body, fa: ct.fa, fb: ct.fb,
        point: ct.points[0].point, normal: ct.manifold.normal });
    });

    if (P.islands && P.islands.beforeStep) P.islands.beforeStep(world);
  }

  /* ------------------------------------------------------- inspection */
  function pairs(world) { return world._bp ? Array.from(world._bp.pairs.keys()) : []; }

  function proxies(world) {
    var out = [];
    world.bodies.forEach(function (b) {
      (b._bpProxies || []).forEach(function (px) {
        out.push({ fixture: px.fixture, lo: M.v(px.lx, px.ly), hi: M.v(px.ux, px.uy), isStatic: px.isStatic });
      });
    });
    return out;
  }

  function sensorVisitors(world, target) {
    var out = [];
    if (!world._bp) return out;
    world._bp.pairs.forEach(function (pr) {
      if (!pr.sensor || !pr.overlapping) return;
      var s = pr.fa.sensor ? pr.fa : pr.fb, v = s === pr.fa ? pr.fb : pr.fa;
      if (s === target || s.body === target) out.push(v);
    });
    return out;
  }

  P.DynamicTree = DynamicTree;
  P.AABB_MARGIN = AABB_MARGIN;
  P.broadphase = {
    update: update, shouldCollide: shouldCollide, shouldSense: shouldSense, filtersPass: filtersPass,
    syncJoints: syncJoints, pairs: pairs, proxies: proxies, sensorVisitors: sensorVisitors
  };
})(globalThis.SE);
