/* Refit-by-geometry animator — L9 "Refit by geometry — the idea".
 *
 * THREADS carry TRIANGLES up a wide-BVH; every node bound is a SOBB
 * (parallelogram, each node its own skewed basis). The deck's numbers:
 *   - node clouds mirror the propagation: a leaf shows its own 2-3
 *     triangles, a mid node 2 minis per descendant leaf (8), the root
 *     2 micros per leaf (16). Minis start pending-faint and brighten
 *     when their own thread is tested at that node.
 *   - NO invalid-init ghost bounds and NO running commentary: bounds
 *     simply POP into existence at the first arrival ("first write
 *     always commits"); later commits MORPH them to the union + red
 *     atomic flash + comic starburst badge.
 *   - resident triangles fill their SOBBs tightly at every level:
 *     leaf triangles run as a diagonal chain along the leaf's long
 *     slab axis; mid/root blob pairs sit at slab-space corner slots.
 *     Cross-level correspondence is deliberately loose; the refit
 *     (grow-on-commit, never shrink) is what must read correctly.
 *   - threads wait INSIDE the node at their blob position (the thread
 *     is at the node, testing locally) — no floating wait rows that
 *     collide with the skewed bound edges.
 *   - thread order: departure ranks shuffled with a seeded mulberry32
 *     (local copy — DeckSVG.mulberry32 is not exported on window.DeckSVG
 *     and common.js is outside this file's edit allowance) plus jittered
 *     hop durations, so arrivals at parents are visibly out of order.
 *     The climb runs ~4x slower than the original draft so the viewer
 *     can parse each local test.
 *   - every arrival gets a comic starburst badge near the node — a big
 *     red "BANG!" for commits (atomic min/max write), a small dim "pew"
 *     for passes — plus ONE persistent red "atomic min/max" badge in
 *     the middle of the canvas, visible from the first thread reaching
 *     an internal node until the end.
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: spawn — one green dot per leaf child; leaf SOBBs pop in fitted
 *       (bounds appear out of nothing)
 *   s2: climb — shuffled, overlapping; ghost local test per arrival;
 *       commits morph the SOBB + red flash + BANG! badge, passes get a
 *       quiet pew badge; the persistent atomic badge fades in at the
 *       first internal-node arrival and stays.
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
  var PASS_INK = '#8a909a';

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
   * derived: resident triangles sit at slab-space slots of their node's
   * basis, so each parallelogram fit wraps its cloud snugly. */

  var ROOT = { cx: 560, cy: 100, a1: 101, a2: 159, pad: 9, scale: 0.6, w: 3 };
  var MIDS = [
    { cx: 285, cy: 260, a1: 96, a2: 167, pad: 9, scale: 0.72, w: 2.6 },
    { cx: 835, cy: 260, a1: 104, a2: 154, pad: 9, scale: 0.72, w: 2.6 }
  ];
  var LEAF_X = [150, 240, 330, 420, 700, 790, 880, 970];
  var LEAF_Y = 404;
  var LEAF_PAD = 5;
  var LEAF_W = 2.2;
  var JA = [-9, -4, 3, 8, -7, -2, 5, 10];   // per-leaf basis jitter, deg
  var JB = [7, 2, -5, -10, 9, 4, -3, -8];
  var TRI_LITE = [2, 6];                   // leaves drawn with 2 triangles

  /* blob slots in unit slab coords (s1 along basis normal 1, s2 along
   * normal 2): corners for mids, corner+edge-mid ring for the root.
   * Multiplied by per-node slab half-extents A/B. */
  var MID_SLOT = [
    { s1: -1, s2: -1 }, { s1: -1, s2: 1 }, { s1: 1, s2: 1 }, { s1: 1, s2: -1 }
  ];
  var MID_A = 20, MID_B = 70;
  var ROOT_SLOT = [
    { s1: -1, s2: -1 }, { s1: -1, s2: 0 }, { s1: -1, s2: 1 }, { s1: 0, s2: 1 },
    { s1: 1, s2: 1 }, { s1: 1, s2: 0 }, { s1: 1, s2: -1 }, { s1: 0, s2: -1 }
  ];
  var ROOT_A = 15, ROOT_BH = 122;

  /* leaf triangle slots in unit slab coords (fraction of LEAF_A/B):
   * a diagonal chain along the parallelogram's long (skewed) axis, so
   * the fitted bound hugs the chain on all four sides */
  var LEAF_TRI_SLOT3 = [
    { s1: -0.6, s2: -0.62 }, { s1: 0.02, s2: 0.02 }, { s1: 0.6, s2: 0.62 }
  ];
  var LEAF_TRI_SLOT2 = [
    { s1: -0.58, s2: -0.6 }, { s1: 0.58, s2: 0.6 }
  ];
  var LEAF_A = 15, LEAF_B = 20;

  var SIDE_LABELS = [
    { text: 'ROOT', y: 104 },
    { text: 'INTERNAL', y: 264 },
    { text: 'LEAVES', y: 408 }
  ];

  /* persistent atomic legend badge, dead center of the canvas */
  var ATOMIC_LABEL = 'atomic min/max';
  var ATOMIC_LX = 560, ATOMIC_LY = 260;

  /* timing — the climb runs ~4x slower than the original draft so each
   * local test (ghost triangle, morph, badge) is parseable */
  var SEED = 20260417;
  var STAG = 0.55;
  var HOP1 = 2.9, HOP2 = 3.1;
  var T_PASS = 1.05, T_COMMIT = 1.75;

  var OP_PENDING = 0.16, OP_MINI = 0.85, OP_MICRO = 0.8;

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

  /* xy point whose slab projections are (d1, d2) in basis b */
  function slabXY(b, d1, d2) {
    var det = b.n1[0] * b.n2[1] - b.n1[1] * b.n2[0];
    return [
      (d1 * b.n2[1] - d2 * b.n1[1]) / det,
      (b.n1[0] * d2 - b.n2[0] * d1) / det
    ];
  }

  /* xy point at node (cx,cy) offset by (s1,s2) in slab space of b */
  function relSlab(cx, cy, b, s1, s2) {
    return slabXY(b,
      cx * b.n1[0] + cy * b.n1[1] + s1,
      cx * b.n2[0] + cy * b.n2[1] + s2);
  }

  /* corners of parallelogram {lo1,hi1,lo2,hi2} in basis -> 4 pts in a
   * FIXED canonical order: (lo1,lo2) (hi1,lo2) (hi1,hi2) (lo1,hi2).
   * No angle sort on purpose: successive fit stages of a node pair up
   * corner-for-corner in GSAP's points tween, so every intermediate
   * frame stays a true parallelogram with the node's fixed edge
   * slopes — the bound only ever GROWS outward on refits, its
   * orientation never changes. */
  function corners(st, b) {
    return [
      slabXY(b, st.lo1, st.lo2), slabXY(b, st.hi1, st.lo2),
      slabXY(b, st.hi1, st.hi2), slabXY(b, st.lo1, st.hi2)
    ];
  }

  /* fit verts in basis b with pad -> slab stage {lo1,hi1,lo2,hi2} */
  function fitStage(verts, b, pad) {
    var e1 = extents(verts, b.n1), e2 = extents(verts, b.n2);
    return { lo1: e1[0] - pad, hi1: e1[1] + pad, lo2: e2[0] - pad, hi2: e2[1] + pad };
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

  /* ==================== derived layout (computed once at load) ==================== */

  var leafBasis = [];
  for (var lbi = 0; lbi < 8; lbi++) {
    leafBasis.push(basis(100 + JA[lbi], 160 + JB[lbi]));
  }

  /* leaf-local triangle geometry: 2-3 triangles as a diagonal chain
   * along the leaf's own slab axes so the leaf parallelogram wraps
   * them snugly */
  var leafTris = [];   // [leaf] -> array of 3-pt arrays (absolute viewBox)
  (function () {
    var rng = mulberry32(SEED ^ 0x5eed);
    var proto = [
      { s: 17, rot: 0.9 }, { s: 15, rot: 2.8 }, { s: 16, rot: 4.6 }
    ];
    for (var i = 0; i < 8; i++) {
      var lite = TRI_LITE.indexOf(i) >= 0;
      var n = lite ? 2 : 3;
      var slots = lite ? LEAF_TRI_SLOT2 : LEAF_TRI_SLOT3;
      var tris = [];
      for (var j = 0; j < n; j++) {
        var slot = slots[j];
        var s = proto[j].s * (0.92 + rng() * 0.16);
        var rot = proto[j].rot + (rng() - 0.5) * 0.5;
        var c = relSlab(LEAF_X[i], LEAF_Y, leafBasis[i],
          slot.s1 * LEAF_A + (rng() - 0.5) * 3,
          slot.s2 * LEAF_B + (rng() - 0.5) * 3);
        tris.push(triVerts(c[0], c[1], s, rot));
      }
      leafTris.push(tris);
    }
  })();

  var midBasis = MIDS.map(function (m) { return basis(m.a1, m.a2); });
  var ROOT_B = basis(ROOT.a1, ROOT.a2);

  /* canonical mini pair: two small triangles around a blob center */
  var BLOB_PROTO = [triVerts(-5, 3, 12, 0.7), triVerts(6, -4, 10.5, 2.9)];

  /* resident blob verts at a node: the descendant-k mini pair, scaled,
   * centered on the node's slab slot for k */
  function blobVerts(node, b, k) {
    var isRoot = node === ROOT;
    var slot = (isRoot ? ROOT_SLOT : MID_SLOT)[k];
    var A = isRoot ? ROOT_A : MID_A;
    var B = isRoot ? ROOT_BH : MID_B;
    var c = relSlab(node.cx, node.cy, b, slot.s1 * A, slot.s2 * B);
    var out = [];
    BLOB_PROTO.forEach(function (tri) {
      tri.forEach(function (q) {
        out.push([c[0] + q[0] * node.scale, c[1] + q[1] * node.scale]);
      });
    });
    return out;
  }

  /* blob centers: resident data positions and thread wait spots
   * (threads hover just above their own blob, inside the node) */
  var midBlobXY = MIDS.map(function (m, mi) {
    var out = [];
    for (var k = 0; k < 4; k++) {
      out.push(relSlab(m.cx, m.cy, midBasis[mi], MID_SLOT[k].s1 * MID_A, MID_SLOT[k].s2 * MID_B));
    }
    return out;
  });
  var rootBlobXY = [];
  for (var rb = 0; rb < 8; rb++) {
    rootBlobXY.push(relSlab(ROOT.cx, ROOT.cy, ROOT_B, ROOT_SLOT[rb].s1 * ROOT_A, ROOT_SLOT[rb].s2 * ROOT_BH));
  }

  /* final (all-arrivals) stages — initial, invisible points of the
   * node parallelograms; per-event stages never exceed these extents */
  function nodeFinalStage(node, b, n) {
    var all = [];
    for (var k = 0; k < n; k++) all = all.concat(blobVerts(node, b, k));
    return fitStage(all, b, node.pad);
  }
  var ROOT_FINAL = nodeFinalStage(ROOT, ROOT_B, 8);
  var MID_FINAL = MIDS.map(function (m, mi) { return nodeFinalStage(m, midBasis[mi], 4); });

  /* leaf-stage fits */
  var leafFit = [], leafFitStr = [];
  for (var li = 0; li < 8; li++) {
    var lverts = [];
    leafTris[li].forEach(function (t) { lverts = lverts.concat(t); });
    leafFit.push(fitStage(lverts, leafBasis[li], LEAF_PAD));
    leafFitStr.push(pts2str(corners(leafFit[li], leafBasis[li])));
  }

  var ROOT_FINAL_STR = pts2str(corners(ROOT_FINAL, ROOT_B));
  var MID_FINAL_STR = MID_FINAL.map(function (st, mi) { return pts2str(corners(st, midBasis[mi])); });

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
        depart: rankOf[i] * STAG + rng() * 0.4,
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
        var verts = blobVerts(MIDS[mi], midBasis[mi], k);
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
      var verts = blobVerts(ROOT, ROOT_B, t.leaf);
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

  /* ==================== badges (comic starbursts) ====================
   * One badge per arrival event. Strong = commit/pop (atomic write),
   * weak = pass. Layout is pure seeded data so build() and the _test
   * bounds probe agree. */
  function computeBadges(sim) {
    var rng = mulberry32(SEED ^ 0xbada09);
    var badges = [];

    /* Deterministic per-node badge slots (offsets from node center).
     * Root arrivals bunch within ~1.5s, so simultaneous bursts must be
     * separated by construction, not by retry: every slot pair is far
     * apart, and rng only shuffles the slot assignment and jitters
     * placement/rotation/size. */
    var MID_BADGE_SLOTS = [
      [-108, -42], [110, -38], [-104, 44], [106, 40]
    ];
    var ROOT_BADGE_SLOTS = [
      [-115, -38], [-40, -44], [40, -38], [115, -42],
      [-111, 40], [-36, 44], [36, 40], [111, 38]
    ];

    function mk(node, ev, slot) {
      var strong = ev.kind !== 'pass';
      var R = strong ? 22 + rng() * 4 : 14 + rng() * 3;
      var bx = Math.max(80, Math.min(1040, node.cx + slot[0] + (rng() * 2 - 1) * 8));
      var by = Math.max(58, Math.min(468, node.cy + slot[1] + (rng() * 2 - 1) * 8));
      var rot = (rng() * 2 - 1) * 24;
      var spikes = strong ? 9 : 7;
      var pts = [];
      for (var i = 0; i < spikes * 2; i++) {
        var a = i * Math.PI / spikes;
        var r = (i % 2 === 0) ? R * (1 + (rng() - 0.5) * 0.3) : R * 0.55;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      var bd = {
        strong: strong, bx: bx, by: by, rot: rot, R: R, pts: pts,
        hold: strong ? 1.15 : 0.8,
        label: strong ? 'BANG!' : 'pew'
      };
      badges.push(bd);
      ev.bidx = badges.length - 1;
    }
    sim.midEvents.forEach(function (evs, mi) {
      var slots = shuffled(MID_BADGE_SLOTS, rng);
      evs.forEach(function (ev, j) { mk(MIDS[mi], ev, slots[j]); });
    });
    var rootSlots = shuffled(ROOT_BADGE_SLOTS, rng);
    sim.rootEvents.forEach(function (ev, j) { mk(ROOT, ev, rootSlots[j]); });
    sim.badges = badges;
  }

  /* shared deterministic sim + badges (build, timeline, _test all agree) */
  var PRE = null;
  function sim() {
    if (!PRE) {
      PRE = simulate();
      computeBadges(PRE);
    }
    return PRE;
  }

  /* ==================== DOM refs ==================== */

  var built = false;
  var svg;
  var pgEls = { root: null, mids: [], leaves: [] };
  var miniEls = { mids: [[], []], root: [] };  // per descendant leaf: 2 polys
  var dotEls = [], ghostEls = [];
  var badgeEls = [];                           // by ev.bidx
  var persistEl = null;                        // atomic min/max legend badge
  var tl = null;
  var SECTIONS = 2;

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

    /* node parallelograms — ALL animated paint as attributes. No ghost
     * state: they are invisible until the first write pops them in. */
    pgEls.root = el('polygon', {
      points: ROOT_FINAL_STR,
      fill: '#ffffff', stroke: BLUE, 'stroke-width': ROOT.w,
      'stroke-linejoin': 'round', opacity: 0
    }, svg);
    MIDS.forEach(function (m, mi) {
      pgEls.mids.push(el('polygon', {
        points: MID_FINAL_STR[mi],
        fill: '#ffffff', stroke: BLUE, 'stroke-width': m.w,
        'stroke-linejoin': 'round', opacity: 0
      }, svg));
    });
    for (var i = 0; i < 8; i++) {
      pgEls.leaves.push(el('polygon', {
        points: leafFitStr[i],
        fill: '#ffffff', stroke: BLUE, 'stroke-width': LEAF_W,
        'stroke-linejoin': 'round', opacity: 0
      }, svg));
    }

    /* leaf cluster triangles (full strength, static paint attrs) */
    leafTris.forEach(function (tris) {
      tris.forEach(function (t) {
        el('polygon', { points: pts2str(t), fill: LIGHT, stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, svg);
      });
    });

    /* node-resident minis: pending-faint until their thread is tested */
    function addMini(verts, sw) {
      return el('polygon', {
        points: pts2str(verts), fill: MINI_FILL, stroke: MINI_INK,
        'stroke-width': sw, 'stroke-linejoin': 'round', opacity: OP_PENDING
      }, svg);
    }
    MIDS.forEach(function (m, mi) {
      for (var k = 0; k < 4; k++) {
        var blob = blobVerts(m, midBasis[mi], k);
        miniEls.mids[mi].push([
          addMini(blob.slice(0, 3), 0.8),
          addMini(blob.slice(3, 6), 0.8)
        ]);
      }
    });
    for (var r = 0; r < 8; r++) {
      var rb = blobVerts(ROOT, ROOT_B, r);
      miniEls.root.push([
        addMini(rb.slice(0, 3), 0.65),
        addMini(rb.slice(3, 6), 0.65)
      ]);
    }

    /* threads + per-thread carried-geometry ghosts */
    for (var d = 0; d < 8; d++) {
      dotEls.push(el('circle', { cx: LEAF_X[d], cy: 454, r: 0, fill: GREEN, opacity: 0 }, svg));
      ghostEls.push(el('polygon', {
        points: '0,0 0,0 0,0', fill: 'none', stroke: GREEN,
        'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: 0
      }, svg));
    }

    /* comic atomic badges — on top of the geometry */
    sim().badges.forEach(function (bd) {
      var g = el('g', {
        transform: 'translate(' + bd.bx + ',' + bd.by + ') rotate(' + bd.rot + ')',
        opacity: 0
      }, svg);
      var inner = el('g', { transform: 'scale(0)' }, g);
      el('polygon', {
        points: pts2str(bd.pts), fill: '#ffffff',
        stroke: bd.strong ? ATOMIC_RED : PASS_INK,
        'stroke-width': bd.strong ? 2.6 : 1.7,
        'stroke-linejoin': 'miter'
      }, inner);
      /* comic lettering: thick white stroke behind the glyphs so the
       * text stays readable where it crosses the star's spikes */
      text(bd.label, {
        x: 0, y: bd.strong ? 5 : 4, 'text-anchor': 'middle',
        'font-size': bd.strong ? 15 : 12, 'font-weight': 700,
        fill: bd.strong ? ATOMIC_RED : PASS_INK,
        stroke: '#ffffff', 'stroke-width': 5, 'paint-order': 'stroke'
      }, inner);
      badgeEls.push({ outer: g, inner: inner });
    });

    /* persistent red atomic badge, middle of the canvas — appears when
     * the first thread reaches an internal node, stays until the end */
    persistEl = el('g', { opacity: 0 }, svg);
    el('rect', {
      x: ATOMIC_LX - 92, y: ATOMIC_LY - 17, width: 184, height: 34, rx: 17,
      fill: '#ffffff', stroke: ATOMIC_RED, 'stroke-width': 2.4
    }, persistEl);
    text(ATOMIC_LABEL, {
      x: ATOMIC_LX, y: ATOMIC_LY + 6, 'text-anchor': 'middle',
      'font-size': 18, 'font-weight': 700, fill: ATOMIC_RED
    }, persistEl);

    built = true;
  }

  /* ==================== state / reset ==================== */

  function resetDom() {
    gsap.killTweensOf(pgEls.root);
    pgEls.root.setAttribute('points', ROOT_FINAL_STR);
    pgEls.root.setAttribute('opacity', 0);
    pgEls.root.setAttribute('stroke', BLUE);
    pgEls.root.setAttribute('stroke-width', ROOT.w);
    pgEls.mids.forEach(function (pg, mi) {
      gsap.killTweensOf(pg);
      pg.setAttribute('points', MID_FINAL_STR[mi]);
      pg.setAttribute('opacity', 0);
      pg.setAttribute('stroke', BLUE);
      pg.setAttribute('stroke-width', MIDS[mi].w);
    });
    pgEls.leaves.forEach(function (pg, i) {
      gsap.killTweensOf(pg);
      pg.setAttribute('points', leafFitStr[i]);
      pg.setAttribute('opacity', 0);
      pg.setAttribute('stroke', BLUE);
      pg.setAttribute('stroke-width', LEAF_W);
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
      d.setAttribute('cy', 454);
      d.setAttribute('r', 0);
      d.setAttribute('opacity', 0);
    });
    ghostEls.forEach(function (g) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
    });
    badgeEls.forEach(function (b) {
      gsap.killTweensOf(b.outer);
      gsap.killTweensOf(b.inner);
      b.outer.setAttribute('opacity', 0);
      b.inner.setAttribute('transform', 'scale(0)');
    });
    if (persistEl) {
      gsap.killTweensOf(persistEl);
      persistEl.setAttribute('opacity', 0);
    }
  }

  /* ==================== timeline ==================== */

  function flashCommit(pg, at, w) {
    tl.set(pg, { attr: { stroke: ATOMIC_RED } }, at);
    tl.to(pg, { attr: { 'stroke-width': w + 2.2 }, duration: 0.35, ease: 'power1.out' }, at);
    tl.to(pg, { attr: { 'stroke-width': w }, duration: 1.0, ease: 'power1.inOut' }, at + 0.45);
    tl.to(pg, { attr: { stroke: BLUE }, duration: 1.0, ease: 'power1.inOut' }, at + 0.9);
  }

  /* comic badge: pop in, hold briefly, pop out */
  function bang(ev, at) {
    var b = badgeEls[ev.bidx];
    if (!b) return;
    var bd = sim().badges[ev.bidx];
    tl.set(b.outer, { attr: { opacity: bd.strong ? 1 : 0.9 } }, at);
    tl.fromTo(b.inner,
      { attr: { transform: 'scale(0)' } },
      { attr: { transform: 'scale(1)' }, duration: 0.34, ease: 'back.out(3.2)' }, at);
    tl.to(b.outer, { attr: { opacity: 0 }, duration: 0.5, ease: 'power1.in' }, at + 0.34 + bd.hold);
  }

  /* thread wait spot: a bit inward of its blob, safely inside the node
   * (blobs sit near the skewed bound's corners; a fixed -y offset can
   * cross the sloped edges) */
  function waitSpot(blob, node) {
    return [blob[0] + (node.cx - blob[0]) * 0.28, blob[1] + (node.cy - blob[1]) * 0.28];
  }

  function buildTimeline() {
    var S = sim();
    tl = gsap.timeline({ paused: true });

    /* ---- s1: spawn — dots appear, leaf SOBBs pop into existence ---- */
    tl.to({}, { duration: 0.25 }, '>');
    var a1 = tl.duration();
    dotEls.forEach(function (d, i) {
      tl.to(d, { attr: { opacity: 1, r: 5.5 }, duration: 0.45, ease: 'back.out(2)' }, a1 + i * 0.07);
      var pg = pgEls.leaves[i];
      var t0 = a1 + 0.3 + i * 0.07;
      tl.fromTo(pg,
        { attr: { opacity: 0, 'stroke-width': 0.8 } },
        { attr: { opacity: 1, 'stroke-width': LEAF_W }, duration: 0.55, ease: 'back.out(2.2)' }, t0);
    });
    tl.addLabel('s1', tl.duration());

    /* ---- s2: the climb — shuffled departures, local test per arrival ---- */
    tl.to({}, { duration: 0.3 }, '>');
    var a2 = tl.duration();

    /* first thread to reach an internal node wakes the atomic legend */
    var firstMidAt = Infinity;
    S.midEvents.forEach(function (evs) {
      evs.forEach(function (e) { if (e.at < firstMidAt) firstMidAt = e.at; });
    });
    tl.fromTo(persistEl,
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.55, ease: 'power2.out' }, a2 + firstMidAt);

    S.threads.forEach(function (t) {
      var i = t.leaf;
      var mi = i < 4 ? 0 : 1;
      var k = i - mi * 4;
      var dot = dotEls[i], ghost = ghostEls[i];
      var dep = a2 + t.depart;
      var midBlob = midBlobXY[mi][k];
      var rootBlob = rootBlobXY[i];

      /* hop 1: leaf -> just inside the mid node, near its own blob */
      tl.to(dot, {
        attr: { cx: waitSpot(midBlob, MIDS[mi])[0], cy: waitSpot(midBlob, MIDS[mi])[1] },
        duration: t.h1, ease: 'power1.inOut'
      }, dep);

      /* mid test */
      var mev = t.midEvent, mt = a2 + mev.at;
      ghostRefit(ghost, blobVerts(MIDS[mi], midBasis[mi], k).slice(0, 3));
      tl.to(ghost, { attr: { opacity: 0.85 }, duration: 0.4 }, mt);
      if (mev.kind === 'pass') {
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.6 }, mt + 0.5);
      } else {
        var mpg = pgEls.mids[mi];
        if (mev.kind === 'pop') {
          tl.set(mpg, { attr: { points: mev.stageStr } }, mt);
          tl.fromTo(mpg,
            { attr: { opacity: 0 } },
            { attr: { opacity: 1 }, duration: 0.35, ease: 'power2.out' }, mt);
        } else {
          tl.to(mpg, { attr: { points: mev.stageStr }, duration: 1.1, ease: 'power2.inOut' }, mt + 0.15);
        }
        flashCommit(mpg, mt + 0.1, MIDS[mi].w);
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.6 }, mt + 1.0);
      }
      bang(mev, mt + 0.1);
      brighten(miniEls.mids[mi][k], OP_MINI, mt + 0.2);

      /* hop 2: mid blob -> just inside the root, near its own blob */
      var dep2 = mt + mev.dur;
      tl.to(dot, {
        attr: { cx: waitSpot(rootBlob, ROOT)[0], cy: waitSpot(rootBlob, ROOT)[1] },
        duration: t.h2, ease: 'power1.inOut'
      }, dep2);

      /* root test */
      var rev = t.rootEvent, rt = a2 + rev.at;
      ghostRefit(ghost, blobVerts(ROOT, ROOT_B, i).slice(0, 3));
      tl.to(ghost, { attr: { opacity: 0.85 }, duration: 0.4 }, rt);
      if (rev.kind === 'pass') {
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.6 }, rt + 0.5);
      } else {
        if (rev.kind === 'pop') {
          tl.set(pgEls.root, { attr: { points: rev.stageStr } }, rt);
          tl.fromTo(pgEls.root,
            { attr: { opacity: 0 } },
            { attr: { opacity: 1 }, duration: 0.35, ease: 'power2.out' }, rt);
        } else {
          tl.to(pgEls.root, { attr: { points: rev.stageStr }, duration: 1.1, ease: 'power2.inOut' }, rt + 0.15);
        }
        flashCommit(pgEls.root, rt + 0.1, ROOT.w);
        tl.to(ghost, { attr: { opacity: 0 }, duration: 0.6 }, rt + 1.0);
      }
      bang(rev, rt + 0.1);
      brighten(miniEls.root[i], OP_MICRO, rt + 0.2);

      /* thread done */
      tl.to(dot, { attr: { opacity: 0 }, duration: 0.3 }, rt + rev.dur + 0.1);
    });
    tl.addLabel('s2', tl.duration());
  }

  /* position a carried-geometry ghost onto a mini slot */
  function ghostRefit(ghost, verts) {
    ghost.setAttribute('points', pts2str(verts));
  }

  function brighten(polys, to, at) {
    polys.forEach(function (p) {
      tl.to(p, { attr: { opacity: to }, duration: 0.8 }, at);
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
      var target = D.stopsFor(tl, SECTIONS)[fragStep];
      var cur = tl.time();
      if (Math.abs(target - cur) < 0.02) {
        tl.pause(target); // zero-distance tweenTo would resume free playback
        return;
      }
      if (target < cur) {
        /* backward rewinds at capped speed — the climb is ~15s now and
         * a real-time reverse would stall the presenter */
        tl.tweenTo(target, { duration: Math.min(2.5, cur - target), ease: 'none' });
      } else {
        tl.tweenTo(target, { ease: 'none' });
      }
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  /* debug/smoke hook: current timeline (labels, time) for headless probes */
  animator._tl = function () { return tl; };

  /* pure layout exposure for headless smoke tests: every parallelogram
   * stage (per-event fits + final fits + leaf fits), every leaf triangle,
   * every badge and the persistent atomic badge must sit well inside
   * the viewBox — SVG clips silently at the edge. */
  animator._test = (function () {
    var S = sim();
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
    leafTris.forEach(function (tris) {
      tris.forEach(function (t) { all = all.concat(t); });
    });
    S.badges.forEach(function (bd) {
      var r = bd.R * 1.2;
      all = all.concat([[bd.bx - r, bd.by - r], [bd.bx + r, bd.by + r]]);
    });
    all = all.concat([[ATOMIC_LX - 92, ATOMIC_LY - 17], [ATOMIC_LX + 92, ATOMIC_LY + 17]]);
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
      badgeCount: S.badges.length,
      bounds: box,
      viewBox: [1120, 520]
    };
  })();

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.refitgeo = animator;
})();
