/* Refit-by-geometry animator — L9 "Refit by geometry — the idea".
 *
 * THREADS carry TRIANGLES up a wide-BVH; every node bound is a SOBB
 * (parallelogram, each node its own skewed basis). The deck's numbers:
 *   - node clouds mirror the propagation: a leaf shows its own 2-3
 *     triangles, a mid node 2 minis per descendant leaf (8), the root
 *     2 micros per leaf (16). Minis start pending-faint and brighten
 *     when their own thread is tested at that node.
 *   - bounds start INVALID (paper init: [+FLT_MAX,-FLT_MAX]) — a tiny
 *     dashed ghost parallelogram. First arrival at a node always
 *     commits (pop); later arrivals locally test their carried
 *     triangle against the current bound (ghost outline appears):
 *     fits -> passes silently; pokes out -> the parallelogram MORPHS
 *     to the union + red atomic flash. Which arrivals commit is not
 *     scripted: a tiny slab-extent simulation over the shuffled
 *     arrival order decides, exactly like the real local test.
 *   - thread order: departure ranks shuffled with a seeded mulberry32
 *     (local copy — DeckSVG.mulberry32 is not exported on window.DeckSVG
 *     and common.js is outside this file's edit allowance) plus jittered
 *     hop durations, so arrivals at parents are visibly out of order.
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: spawn — one green dot per leaf child; leaf SOBBs pop from
 *       invalid ghosts to fitted; init note tag
 *   s2: climb — shuffled, overlapping; ghost local test per arrival;
 *       commits morph the SOBB + flash red ("changed -> atomic min/max"
 *       tag on the first mid-tree grow), passes stay silent
 *       ("no change -> nothing written" at the first root pass)
 *   s3: numbers stamp — writes-per-test gradient
 *   s4: meaning stamp + root emphasis
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;
  var GREEN = '#2f9e5f';           // threads (the one non-palette accent,
  var ATOMIC_RED = '#c23c3c';      // by design: green = thread, red = atomic)
  var MINI_INK = '#6a7078';
  var MINI_FILL = '#f2f4f9';

  /* DeckSVG.mulberry32 is module-local in common.js (not on the exported
   * object) and common.js is outside my edit allowance — local copy. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ====================
   * Wide-BVH tree: root -> 2 internal -> 8 leaf clusters. All geometry
   * derived (parallelograms are parasitic fits of their resident clouds),
   * then smoke-checked to sit >= 24 units inside the viewBox. */

  var ROOT = { cx: 560, cy: 102, a1: 101, a2: 159, pad: 13, blobDx: 31, scale: 0.34 };
  var MIDS = [
    { cx: 285, cy: 232, a1: 96, a2: 167, pad: 11, blobDx: 46, scale: 0.5 },
    { cx: 835, cy: 232, a1: 104, a2: 154, pad: 11, blobDx: 46, scale: 0.5 }
  ];
  var LEAF_X = [150, 240, 330, 420, 700, 790, 880, 970];
  var LEAF_Y = 386;
  var LEAF_PAD = 8;
  var JA = [-9, -4, 3, 8, -7, -2, 5, 10];   // per-leaf basis jitter, deg
  var JB = [7, 2, -5, -10, 9, 4, -3, -8];
  var TRI_LITE = [2, 6];                   // leaves drawn with 2 triangles

  var SIDE_LABELS = [
    { text: 'ROOT', y: 106 },
    { text: 'INTERNAL', y: 236 },
    { text: 'LEAVES', y: 390 }
  ];

  /* stamps + tags */
  var TAG_INIT = 'every new bound starts invalid — first write always commits';
  var TAG_ATOMIC = 'changed → atomic min/max';
  var TAG_PASS = 'no change → nothing written';
  var STAMP_NUM = 'writes per test: 16–26% near the leaves · ~20% overall · ~0.0003% at the root';
  var STAMP_MEAN = 'every triangle reaches the root — the top bound saw them all';

  /* timing */
  var SEED = 20260417;
  var STAG = 0.13;
  var HOP1 = 0.7, HOP2 = 0.75;
  var T_PASS = 0.32, T_COMMIT = 0.58;

  var OP_PENDING = 0.16, OP_MINI = 0.75, OP_MICRO = 0.7;

  /* ==================== pure geometry ==================== */

  function rad(d) { return d * Math.PI / 180; }

  function basis(a1, a2) {
    return {
      n1: [Math.cos(rad(a1)), Math.sin(rad(a1))],
      n2: [Math.cos(rad(a2)), Math.sin(rad(a2))]
    };
  }

  /* small upright-ish triangle polygon around (cx,cy), side s, rotated */
  function triVerts(cx, cy, s, rot) {
    var pts = [];
    for (var k = 0; k < 3; k++) {
      var a = rot + k * 2 * Math.PI / 3;
      pts.push([cx + s * 0.62 * Math.cos(a), cy + s * 0.62 * Math.sin(a)]);
    }
    return pts;
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* slab extents of verts along n -> [lo, hi] */
  function extents(verts, n) {
    var lo = Infinity, hi = -Infinity;
    verts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    });
    return [lo, hi];
  }

  /* corners of parallelogram {lo1,hi1,lo2,hi2} in basis -> 4 pts CCW */
  function corners(st, b) {
    var det = b.n1[0] * b.n2[1] - b.n1[1] * b.n2[0];
    function solve(a, c) {
      return [
        (a * b.n2[1] - c * b.n1[1]) / det,
        (b.n1[0] * c - b.n2[0] * a) / det
      ];
    }
    var poly = [
      solve(st.lo1, st.lo2), solve(st.hi1, st.lo2),
      solve(st.hi1, st.hi2), solve(st.lo1, st.hi2)
    ];
    var cx = 0, cy = 0;
    poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= 4; cy /= 4;
    return poly.sort(function (p, q) {
      return Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx);
    });
  }

  /* fit verts in basis b with pad -> slab stage {lo1,hi1,lo2,hi2} */
  function fitStage(verts, b, pad) {
    var e1 = extents(verts, b.n1), e2 = extents(verts, b.n2);
    return { lo1: e1[0] - pad, hi1: e1[1] + pad, lo2: e2[0] - pad, hi2: e2[1] + pad };
  }

  /* invalid-init ghost: collapsed fit around a center point */
  function ghostStage(cx, cy, b) {
    var c1 = cx * b.n1[0] + cy * b.n1[1];
    var c2 = cx * b.n2[0] + cy * b.n2[1];
    return { lo1: c1 - 3, hi1: c1 + 3, lo2: c2 - 3, hi2: c2 + 3 };
  }

  function mergeStages(a, b) {
    return {
      lo1: Math.min(a.lo1, b.lo1), hi1: Math.max(a.hi1, b.hi1),
      lo2: Math.min(a.lo2, b.lo2), hi2: Math.max(a.hi2, b.hi2)
    };
  }

  /* local test: all verts inside current stage (+eps slack)? */
  function insideStage(verts, st, b, eps) {
    for (var i = 0; i < verts.length; i++) {
      var p = verts[i];
      var d1 = p[0] * b.n1[0] + p[1] * b.n1[1];
      var d2 = p[0] * b.n2[0] + p[1] * b.n2[1];
      if (d1 < st.lo1 - eps || d1 > st.hi1 + eps) return false;
      if (d2 < st.lo2 - eps || d2 > st.hi2 + eps) return false;
    }
    return true;
  }

  function unionVerts(a, b) { return a.concat(b); }

  /* ==================== derived layout (computed once at load) ==================== */

  /* leaf-local triangle geometry (relative to leaf center) */
  var leafTris = [];   // [leaf] -> array of 3-pt arrays (absolute viewBox)
  var leafLocal = [];  // same, relative to leaf center (minis derive from this)
  (function () {
    var rng = mulberry32(SEED ^ 0x5eed);
    var proto = [[-12, -3, 13, 0.9], [10, -8, 12, 2.8], [-1, 9, 11, 4.6]];
    for (var i = 0; i < 8; i++) {
      var abs = [], rel = [];
      var n = TRI_LITE.indexOf(i) >= 0 ? 2 : 3;
      for (var j = 0; j < n; j++) {
        var p = proto[j];
        var s = p[2] * (0.92 + rng() * 0.16);
        var rot = p[3] + (rng() - 0.5) * 0.5;
        var ox = p[0] + (rng() - 0.5) * 3, oy = p[1] + (rng() - 0.5) * 3;
        var loc = triVerts(ox, oy, s, rot);
        rel.push(loc);
        abs.push(loc.map(function (q) { return [q[0] + LEAF_X[i], q[1] + LEAF_Y]; }));
      }
      leafLocal.push(rel);
      leafTris.push(abs);
    }
  })();

  /* node descriptors: centers, bases, resident clouds, stage fits */
  function nodeBasis(a1, a2) { return basis(a1, a2); }

  /* minis of leaf i at a node: first two leaf tris scaled into the
   * leaf's blob slot at that node (blob slot = descendant position) */
  function miniVertsAt(node, k, i) {
    var bx = node.cx + node.blobDx * (k - (node === ROOT ? 3.5 : 1.5));
    var by = node.cy;
    var out = [];
    leafLocal[i].slice(0, 2).forEach(function (tri) {
      tri.forEach(function (q) {
        out.push([bx + q[0] * node.scale, by + q[1] * node.scale]);
      });
    });
    return out;
  }

  /* leaf-stage fits */
  var leafBasis = [], leafFit = [], leafGhost = [];
  for (var li = 0; li < 8; li++) {
    var lb = nodeBasis(100 + JA[li], 160 + JB[li]);
    leafBasis.push(lb);
    var lverts = [];
    leafTris[li].forEach(function (t) { lverts = lverts.concat(t); });
    leafFit.push(fitStage(lverts, lb, LEAF_PAD));
    leafGhost.push(ghostStage(LEAF_X[li], LEAF_Y, lb));
  }

  var midBasis = MIDS.map(function (m) { return nodeBasis(m.a1, m.a2); });
  var midGhost = MIDS.map(function (m) { return ghostStage(m.cx, m.cy, nodeBasis(m.a1, m.a2)); });
  var ROOT_B = nodeBasis(ROOT.a1, ROOT.a2);
  var ROOT_GHOST = ghostStage(ROOT.cx, ROOT.cy, ROOT_B);

  /* ==================== DOM refs ==================== */

  var built = false;
  var svg;
  var pgEls = { root: null, mids: [], leaves: [] };
  var miniEls = { mids: [[], []], root: [] };  // per descendant leaf: 2 polys
  var dotEls = [], ghostEls = [];
  var tagInitEl, tagAtomicEl, tagPassEl, stampNumEl, stampMeanEl;
  var tl = null;
  var SECTIONS = 4;

  /* ==================== build ==================== */

  function build() {
    var host = document.getElementById('geo-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);

    /* side labels (static paint only -> class is safe) */
    SIDE_LABELS.forEach(function (l) {
      var t = el('text', { 'class': 'svg-side-label', x: 18, y: l.y }, svg);
      t.textContent = l.text;
    });

    /* edges (static, behind everything) */
    MIDS.forEach(function (m, mi) {
      el('line', { x1: ROOT.cx, y1: ROOT.cy + 46, x2: m.cx, y2: m.cy - 40, stroke: EDGE, 'stroke-width': 1.6 }, svg);
      for (var k = 0; k < 4; k++) {
        var i = mi * 4 + k;
        el('line', { x1: m.cx, y1: m.cy + 40, x2: LEAF_X[i], y2: LEAF_Y - 30, stroke: EDGE, 'stroke-width': 1.6 }, svg);
      }
    });

    /* node parallelograms — ALL animated paint as attributes */
    pgEls.root = el('polygon', {
      points: pts2str(corners(ROOT_GHOST, ROOT_B)),
      fill: '#ffffff', stroke: FAINT, 'stroke-width': 2.4, 'stroke-dasharray': '7 5',
      'stroke-linejoin': 'round'
    }, svg);
    MIDS.forEach(function (m, mi) {
      pgEls.mids.push(el('polygon', {
        points: pts2str(corners(midGhost[mi], midBasis[mi])),
        fill: '#ffffff', stroke: FAINT, 'stroke-width': 2, 'stroke-dasharray': '7 5',
        'stroke-linejoin': 'round'
      }, svg));
    });
    for (var i = 0; i < 8; i++) {
      pgEls.leaves.push(el('polygon', {
        points: pts2str(corners(leafGhost[i], leafBasis[i])),
        fill: '#ffffff', stroke: FAINT, 'stroke-width': 1.6, 'stroke-dasharray': '6 4',
        'stroke-linejoin': 'round'
      }, svg));
    }

    /* leaf cluster triangles (full strength, static paint attrs) */
    leafTris.forEach(function (tris) {
      tris.forEach(function (t) {
        el('polygon', { points: pts2str(t), fill: LIGHT, stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, svg);
      });
    });

    /* node-resident minis: pending-faint until their thread is tested */
    function addMini(verts) {
      return el('polygon', {
        points: pts2str(verts), fill: MINI_FILL, stroke: MINI_INK,
        'stroke-width': 0.8, 'stroke-linejoin': 'round', opacity: OP_PENDING
      }, svg);
    }
    MIDS.forEach(function (m, mi) {
      for (var k = 0; k < 4; k++) {
        var li2 = mi * 4 + k;
        var polys = [];
        var blob = miniVertsAt(m, k, li2);
        /* 2 tris of 3 verts each */
        polys.push(addMini(blob.slice(0, 3)));
        polys.push(addMini(blob.slice(3, 6)));
        miniEls.mids[mi].push(polys);
      }
    });
    for (var r = 0; r < 8; r++) {
      var rb = miniVertsAt(ROOT, r, r);
      var rp = [];
      rp.push(el('polygon', {
        points: pts2str(rb.slice(0, 3)), fill: MINI_FILL, stroke: MINI_INK,
        'stroke-width': 0.65, 'stroke-linejoin': 'round', opacity: OP_PENDING
      }, svg));
      rp.push(el('polygon', {
        points: pts2str(rb.slice(3, 6)), fill: MINI_FILL, stroke: MINI_INK,
        'stroke-width': 0.65, 'stroke-linejoin': 'round', opacity: OP_PENDING
      }, svg));
      miniEls.root.push(rp);
    }

    /* threads + per-thread carried-geometry ghosts */
    for (var d = 0; d < 8; d++) {
      dotEls.push(el('circle', { cx: LEAF_X[d], cy: 436, r: 0, fill: GREEN, opacity: 0 }, svg));
      ghostEls.push(el('polygon', {
        points: '0,0 0,0 0,0', fill: 'none', stroke: GREEN,
        'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: 0
      }, svg));
    }

    /* tags + stamps */
    tagInitEl = text(TAG_INIT, { x: 1105, y: 470, 'text-anchor': 'end', 'font-size': 18, fill: FAINT, opacity: 0 }, svg);
    tagAtomicEl = text(TAG_ATOMIC, { x: 1010, y: 178, 'text-anchor': 'end', 'font-size': 18, fill: ATOMIC_RED, opacity: 0 }, svg);
    tagPassEl = text(TAG_PASS, { x: 795, y: 70, 'text-anchor': 'start', 'font-size': 18, fill: FAINT, opacity: 0 }, svg);
    stampNumEl = text(STAMP_NUM, { x: 560, y: 492, 'text-anchor': 'middle', 'font-size': 20, fill: FAINT, opacity: 0 }, svg);
    stampMeanEl = text(STAMP_MEAN, { x: 560, y: 464, 'text-anchor': 'middle', 'font-size': 20, fill: INK, opacity: 0 }, svg);

    built = true;
  }

  /* ==================== schedule (seeded sim, runs per start) ==================== */

  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* The honest bit: per node, walk arrivals in time order; a thread's
   * carried verts are slab-tested against the node's current stage —
   * inside -> pass, outside -> commit (merge like the atomic min/max).
   * Which arrivals commit emerges from the shuffled order, it is not
   * hand-picked. */
  function simulate() {
    var rng = mulberry32(SEED);
    var th = [];
    var rankOf = shuffled([0, 1, 2, 3, 4, 5, 6, 7], rng);
    for (var i = 0; i < 8; i++) {
      th.push({
        leaf: i,
        depart: rankOf[i] * STAG + rng() * 0.1,
        h1: HOP1 * (0.85 + rng() * 0.3),
        h2: HOP2 * (0.85 + rng() * 0.3)
      });
    }
    /* per-mid arrival lists (sorted by mid-arrival time) */
    var midEvents = [[], []];
    var midState = [null, null];
    for (var m = 0; m < 2; m++) {
      var arrivals = th.slice(m * 4, m * 4 + 4).sort(function (a, b) {
        return (a.depart + a.h1) - (b.depart + b.h1);
      });
      arrivals.forEach(function (t) {
        var mi = m, k = t.leaf - m * 4;
        var at = t.depart + t.h1;
        var verts = miniVertsAt(MIDS[mi], k, t.leaf);
        var ev = { node: 'm' + mi, leaf: t.leaf, k: k, at: at };
        if (!midState[mi]) {
          midState[mi] = fitStage(verts, midBasis[mi], MIDS[mi].pad);
          ev.kind = 'pop'; ev.dur = T_COMMIT;
          ev.stageStr = pts2str(corners(midState[mi], midBasis[mi]));
        } else if (insideStage(verts, midState[mi], midBasis[mi], 1)) {
          ev.kind = 'pass'; ev.dur = T_PASS;
        } else {
          midState[mi] = mergeStages(midState[mi], fitStage(verts, midBasis[mi], MIDS[mi].pad));
          ev.kind = 'commit'; ev.dur = T_COMMIT;
          ev.stageStr = pts2str(corners(midState[mi], midBasis[mi]));
        }
        t.midEvent = ev;
        midEvents[mi].push(ev);
      });
    }
    /* root arrivals */
    var rootState = null;
    var rootEvents = [];
    var rootArrivals = th.slice().sort(function (a, b) {
      return (a.midEvent.at + a.midEvent.dur + a.h2) - (b.midEvent.at + b.midEvent.dur + b.h2);
    });
    rootArrivals.forEach(function (t) {
      var at = t.midEvent.at + t.midEvent.dur + t.h2;
      var verts = miniVertsAt(ROOT, t.leaf, t.leaf);
      var ev = { node: 'root', leaf: t.leaf, at: at };
      if (!rootState) {
        rootState = fitStage(verts, ROOT_B, ROOT.pad);
        ev.kind = 'pop'; ev.dur = T_COMMIT;
        ev.stageStr = pts2str(corners(rootState, ROOT_B));
      } else if (insideStage(verts, rootState, ROOT_B, 1)) {
        ev.kind = 'pass'; ev.dur = T_PASS;
      } else {
        rootState = mergeStages(rootState, fitStage(verts, ROOT_B, ROOT.pad));
        ev.kind = 'commit'; ev.dur = T_COMMIT;
        ev.stageStr = pts2str(corners(rootState, ROOT_B));
      }
      t.rootEvent = ev;
      rootEvents.push(ev);
    });
    rootEvents.sort(function (a, b) { return a.at - b.at; });
    return { threads: th, midEvents: midEvents, rootEvents: rootEvents };
  }

  /* ==================== state / reset ==================== */

  function ghostify(pg, st, b, w) {
    pg.setAttribute('points', pts2str(corners(st, b)));
    pg.setAttribute('stroke', FAINT);
    pg.setAttribute('stroke-dasharray', '7 5');
    pg.setAttribute('stroke-width', w);
  }

  function resetDom() {
    gsap.killTweensOf(pgEls.root);
    ghostify(pgEls.root, ROOT_GHOST, ROOT_B, 2.4);
    pgEls.mids.forEach(function (pg, mi) {
      gsap.killTweensOf(pg);
      ghostify(pg, midGhost[mi], midBasis[mi], 2);
    });
    pgEls.leaves.forEach(function (pg, i) {
      gsap.killTweensOf(pg);
      ghostify(pg, leafGhost[i], leafBasis[i], 1.6);
    });
    miniEls.mids.forEach(function (per) {
      per.forEach(function (polys) {
        polys.forEach(function (p) {
          gsap.killTweensOf(p);
          p.setAttribute('opacity', OP_PENDING);
        });
      });
    });
    miniEls.root.forEach(function (polys) {
      polys.forEach(function (p) {
        gsap.killTweensOf(p);
        p.setAttribute('opacity', OP_PENDING);
      });
    });
    dotEls.forEach(function (d, i) {
      gsap.killTweensOf(d);
      d.setAttribute('cx', LEAF_X[i]);
      d.setAttribute('cy', 436);
      d.setAttribute('r', 0);
      d.setAttribute('opacity', 0);
    });
    ghostEls.forEach(function (g) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
    });
    [tagInitEl, tagAtomicEl, tagPassEl, stampNumEl, stampMeanEl].forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 0);
    });
  }

  /* ==================== timeline ==================== */

  function flashCommit(pg, at, w) {
    tl.set(pg, { attr: { stroke: ATOMIC_RED, 'stroke-dasharray': 'none' } }, at);
    tl.to(pg, { attr: { 'stroke-width': w + 1.3 }, duration: 0.18, ease: 'power1.out' }, at);
    tl.to(pg, { attr: { 'stroke-width': w }, duration: 0.5, ease: 'power1.inOut' }, at + 0.2);
    tl.to(pg, { attr: { stroke: BLUE }, duration: 0.55, ease: 'power1.inOut' }, at + 0.45);
  }

  function buildTimeline() {
    var S = simulate();
    tl = gsap.timeline({ paused: true });

    /* ---- s1: spawn — dots appear, leaf SOBBs pop invalid -> fitted ---- */
    tl.to({}, { duration: 0.25 }, '>');
    var a1 = tl.duration();
    dotEls.forEach(function (d, i) {
      tl.to(d, { attr: { opacity: 1, r: 5.5 }, duration: 0.45, ease: 'back.out(2)' }, a1 + i * 0.06);
      var pg = pgEls.leaves[i];
      var t0 = a1 + 0.3 + i * 0.06;
      tl.to(pg, { attr: { points: pts2str(corners(leafFit[i], leafBasis[i])) }, duration: 0.5, ease: 'power2.out' }, t0);
      tl.set(pg, { attr: { stroke: BLUE, 'stroke-dasharray': 'none' } }, t0 + 0.05);
    });
    tl.to(tagInitEl, { attr: { opacity: 1 }, duration: 0.5 }, a1 + 0.6);
    tl.addLabel('s1', tl.duration());

    /* ---- s2: the climb — shuffled departures, local test per arrival ---- */
    tl.to({}, { duration: 0.3 }, '>');
    var a2 = tl.duration();
    var atomicTagged = false, passTagged = false;

    S.threads.forEach(function (t) {
      var i = t.leaf;
      var mi = i < 4 ? 0 : 1;
      var k = i - mi * 4;
      var dot = dotEls[i], ghost = ghostEls[i];
      var dep = a2 + t.depart;
      var slotMx = MIDS[mi].cx + (k - 1.5) * 38;
      var slotRx = ROOT.cx + (i - 3.5) * 26;

      /* hop 1: leaf -> mid wait slot */
      tl.to(dot, { attr: { cx: slotMx, cy: 300 }, duration: t.h1, ease: 'power1.inOut' }, dep);

      /* mid test */
      var mev = t.midEvent, mt = a2 + mev.at;
      ghostRefit(ghost, miniVertsAt(MIDS[mi], k, i).slice(0, 3));
      tl.to(ghost, { attr: { opacity: 0.8 }, duration: 0.22 }, mt);
      if (mev.kind === 'pass') {
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.3 }, mt + 0.24);
      } else {
        var mpg = pgEls.mids[mi];
        tl.to(mpg, { attr: { points: mev.stageStr }, duration: 0.5, ease: 'power2.inOut' }, mt + 0.08);
        flashCommit(mpg, mt + 0.08, 2);
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.3 }, mt + 0.42);
        if (mev.kind === 'commit' && !atomicTagged) {
          atomicTagged = true;
          tl.to(tagAtomicEl, { attr: { opacity: 1 }, duration: 0.35 }, mt + 0.15);
          tl.to(tagAtomicEl, { attr: { opacity: 0 }, duration: 0.5 }, mt + 1.7);
        }
      }
      brighten(miniEls.mids[mi][k], OP_MINI, mt + 0.1);

      /* hop 2: mid -> root wait slot */
      var dep2 = mt + mev.dur;
      tl.to(dot, { attr: { cx: slotRx, cy: 192 }, duration: t.h2, ease: 'power1.inOut' }, dep2);

      /* root test */
      var rev = t.rootEvent, rt = a2 + rev.at;
      ghostRefit(ghost, miniVertsAt(ROOT, i, i).slice(0, 3));
      tl.to(ghost, { attr: { opacity: 0.8 }, duration: 0.22 }, rt);
      if (rev.kind === 'pass') {
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.3 }, rt + 0.24);
        if (!passTagged) {
          passTagged = true;
          tl.to(tagPassEl, { attr: { opacity: 1 }, duration: 0.35 }, rt + 0.15);
          tl.to(tagPassEl, { attr: { opacity: 0 }, duration: 0.5 }, rt + 1.9);
        }
      } else {
        tl.to(pgEls.root, { attr: { points: rev.stageStr }, duration: 0.5, ease: 'power2.inOut' }, rt + 0.08);
        flashCommit(pgEls.root, rt + 0.08, 2.4);
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.3 }, rt + 0.42);
      }
      brighten(miniEls.root[i], OP_MICRO, rt + 0.1);

      /* thread done */
      tl.to(dot, { attr: { opacity: 0 }, duration: 0.3 }, rt + rev.dur + 0.1);
    });
    /* init note retires as the climb settles — s3's stamps take over */
    tl.to(tagInitEl, { attr: { opacity: 0 }, duration: 0.5 }, tl.duration() - 0.6);
    tl.addLabel('s2', tl.duration());

    /* ---- s3: numbers stamp ----
     * EXPLICIT times below (no phantom-spacer + '>' chaining): the stop
     * labels must sit exactly past real tweens. */
    var t3 = tl.duration();
    tl.to(stampNumEl, { attr: { opacity: 1 }, duration: 0.6 }, t3 + 0.25);
    tl.addLabel('s3', t3 + 0.85);

    /* ---- s4: meaning stamp + root emphasis ---- */
    var a4 = t3 + 0.85 + 0.25;
    tl.to(stampMeanEl, { attr: { opacity: 1 }, duration: 0.6 }, a4);
    tl.to(pgEls.root, { attr: { 'stroke-width': 3.4 }, duration: 0.35, ease: 'power1.out' }, a4);
    tl.to(pgEls.root, { attr: { 'stroke-width': 2.4 }, duration: 0.6, ease: 'power1.inOut' }, a4 + 0.4);
    miniEls.root.forEach(function (polys) {
      polys.forEach(function (p) {
        tl.to(p, { attr: { opacity: 0.9 }, duration: 0.6 }, a4);
      });
    });
    tl.addLabel('s4', tl.duration());
  }

  /* position a carried-geometry ghost onto a mini slot */
  function ghostRefit(ghost, verts) {
    ghost.setAttribute('points', pts2str(verts));
  }

  function brighten(polys, to, at) {
    polys.forEach(function (p) {
      tl.to(p, { attr: { opacity: to }, duration: 0.35 }, at);
    });
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetDom();
      buildTimeline();

      if (fragStep > 0) {
        tl.seek(D.stopsFor(tl, SECTIONS)[fragStep], true); // jump, no callbacks
      }

      gsap.fromTo(svg,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(D.stopsFor(tl, SECTIONS)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  /* debug/smoke hook: current timeline (labels, time) for headless probes */
  animator._tl = function () { return tl; };

  /* pure layout exposure for headless smoke tests: every parallelogram
   * stage (ghost + per-event fits + leaf fits) must sit well inside the
   * viewBox — SVG clips silently at the edge. */
  animator._test = (function () {
    var S = simulate();
    var stageStrs = [S.rootEvents, S.midEvents[0], S.midEvents[1]].reduce(function (acc, evs) {
      return acc.concat(evs.filter(function (e) { return e.stageStr; }).map(function (e) { return e.stageStr; }));
    }, []);
    var all = [];
    stageStrs.forEach(function (s) {
      s.split(' ').forEach(function (pair) {
        var xy = pair.split(',');
        all.push([parseFloat(xy[0]), parseFloat(xy[1])]);
      });
    });
    leafFit.forEach(function (st, i) {
      all = all.concat(corners(st, leafBasis[i]));
    });
    all = all.concat(corners(ROOT_GHOST, ROOT_B));
    var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    all.forEach(function (p) {
      box.x0 = Math.min(box.x0, p[0]); box.y0 = Math.min(box.y0, p[1]);
      box.x1 = Math.max(box.x1, p[0]); box.y1 = Math.max(box.y1, p[1]);
    });
    var commits = 0, passes = 0;
    S.rootEvents.concat(S.midEvents[0], S.midEvents[1]).forEach(function (e) {
      if (e.kind === 'pass') passes++; else commits++;
    });
    return {
      sections: SECTIONS,
      stageCount: stageStrs.length,
      commits: commits, passes: passes,
      bounds: box,
      viewBox: [1120, 520]
    };
  })();

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.refitgeo = animator;
})();
