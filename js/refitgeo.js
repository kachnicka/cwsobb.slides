/* Refit-by-geometry animator — L9 "Refit by geometry — the idea".
 *
 * The climax mechanism: THREADS, not bounds, propagate up a wide-BVH.
 * One green dot per leaf cluster climbs to the root independently —
 * no level barrier, no waiting. Every node a thread passes re-fits
 * locally (dashed-red stale -> solid blue); atomics are rare, shown as
 * a single red mid-tree pulse and a barely-visible root pulse.
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: threads spawn — one green dot per leaf cluster (+ "8 threads")
 *   s2: threads ascend — staggered but overlapping, nobody waits;
 *       each touched node flips stale -> re-fitted, first arrival wins
 *   s3: rare atomics — one mid node pulses red ("atomic" tag); the
 *       root pulses barely visibly + whisper tag "~0.0003% of tests"
 *   s4: stat stamp — quiet footer line inside the SVG, canvas settled
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;
  var GREEN = '#2f9e5f';           // threads (the one non-palette accent,
  var ATOMIC_RED = '#c23c3c';      // by design: green = thread, red = atomic)

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ====================
   * Wide-BVH tree: wide root -> 2 wide internal nodes -> 8 leaf clusters
   * (up to 3 tiny triangles each). All geometry hand-placed with >= 30
   * viewBox units of margin — SVG clips silently at the viewBox edge.
   */
  var ROOT = { x: 390, y: 54, w: 340, h: 60, cx: 560, cy: 84 };
  var MIDS = [
    { id: 'mL', x: 150, y: 196, w: 300, h: 56, cx: 300 },
    { id: 'mR', x: 670, y: 196, w: 300, h: 56, cx: 820 }
  ];
  var CLUSTER_Y = 352, CLUSTER_W = 76, CLUSTER_H = 56;
  var CLUSTER_CX = [165, 255, 345, 435, 685, 775, 865, 955]; // 0-3 -> mL, 4-7 -> mR
  var TRI_LITE = [2, 6]; // clusters drawn with 2 instead of 3 triangles

  var SIDE_LABELS = [
    { text: 'ROOT', y: 89 },
    { text: 'INTERNAL', y: 229 },
    { text: 'LEAVES', y: 385 }
  ];

  var STAT_TEXT = '~20% of local tests → atomics (avg) · 0.0003% at root';
  var THREAD_TAG = '8 threads — one per leaf cluster';
  var ROOT_TAG = 'root: ~0.0003% of tests';

  /* thread motion timing (s2) */
  var STAG = 0.11;   // per-thread stagger — hops overlap heavily
  var HOP1 = 0.7;    // leaf cluster -> mid node
  var HOP2 = 0.75;   // mid node -> root

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var nodeEls = {};        // 'root' | 'mL' | 'mR' | 'c0'..'c7' -> rect
  var dotEls = [];         // green thread circles, cluster order
  var edgeEls = [];        // tree edges (static paint)
  var tagThread, tagAtomic, tagRoot, statEl;
  var tl = null;
  var SECTIONS = 4;

  /* tiny triangle polygon points at (x, y) with side s */
  function triPts(x, y, s) {
    return x + ',' + (y + s * 0.62) + ' ' + (x + s) + ',' + y + ' ' + (x + s * 0.72) + ',' + (y + s);
  }

  function build() {
    var host = document.getElementById('geo-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);

    /* side labels (static paint only -> class is safe) */
    SIDE_LABELS.forEach(function (l) {
      var t = el('text', { 'class': 'svg-side-label', x: 18, y: l.y }, svg);
      t.textContent = l.text;
    });

    /* edges: root -> mids, mids -> their clusters */
    MIDS.forEach(function (m) {
      edgeEls.push(el('line', {
        x1: ROOT.cx, y1: ROOT.y + ROOT.h, x2: m.cx, y2: m.y,
        stroke: EDGE, 'stroke-width': 1.6
      }, svg));
    });
    CLUSTER_CX.forEach(function (cx, i) {
      var m = MIDS[i < 4 ? 0 : 1];
      edgeEls.push(el('line', {
        x1: m.cx, y1: m.y + m.h, x2: cx, y2: CLUSTER_Y,
        stroke: EDGE, 'stroke-width': 1.6
      }, svg));
    });

    /* wide root node + the triangle slots it holds */
    nodeEls.root = el('rect', {
      x: ROOT.x, y: ROOT.y, width: ROOT.w, height: ROOT.h, rx: 10,
      fill: '#ffffff', 'stroke-width': 2.2
    }, svg);
    [[430, 70, 20], [500, 66, 22], [570, 72, 19], [640, 68, 21]].forEach(function (t) {
      el('polygon', {
        points: triPts(t[0], t[1], t[2]),
        fill: LIGHT, stroke: INK, 'stroke-width': 1
      }, svg);
    });

    /* wide internal nodes */
    MIDS.forEach(function (m) {
      nodeEls[m.id] = el('rect', {
        x: m.x, y: m.y, width: m.w, height: m.h, rx: 8,
        fill: '#ffffff', 'stroke-width': 2
      }, svg);
      [[70, 212, 20], [140, 208, 22], [210, 214, 19]].forEach(function (t) {
        el('polygon', {
          points: triPts(m.x + t[0], t[1], t[2]),
          fill: LIGHT, stroke: INK, 'stroke-width': 1
        }, svg);
      });
    });

    /* leaf clusters: small wide-leaf rects, 2-3 tiny triangles each */
    CLUSTER_CX.forEach(function (cx, i) {
      var x0 = cx - CLUSTER_W / 2;
      nodeEls['c' + i] = el('rect', {
        x: x0, y: CLUSTER_Y, width: CLUSTER_W, height: CLUSTER_H, rx: 6,
        fill: '#ffffff', 'stroke-width': 1.8
      }, svg);
      var spots = [[6, 368, 17], [30, 364, 19]];
      if (TRI_LITE.indexOf(i) < 0) spots.push([18, 384, 15]);
      spots.forEach(function (t) {
        el('polygon', {
          points: triPts(x0 + t[0], t[1], t[2]),
          fill: LIGHT, stroke: INK, 'stroke-width': 1
        }, svg);
      });
    });

    /* thread dots (spawn under their leaf cluster; animated paint = attrs) */
    CLUSTER_CX.forEach(function (cx) {
      dotEls.push(el('circle', {
        cx: cx, cy: 422, r: 0, fill: GREEN, opacity: 0
      }, svg));
    });

    /* floating tags + stat stamp — all fade in via the timeline */
    tagThread = text(THREAD_TAG, {
      x: 1090, y: 452, 'text-anchor': 'end', 'font-size': 13, fill: GREEN, opacity: 0
    }, svg);
    tagAtomic = text('atomic', {
      x: 984, y: 229, 'font-size': 13, fill: ATOMIC_RED, opacity: 0
    }, svg);
    tagRoot = text(ROOT_TAG, {
      x: 742, y: 88, 'font-size': 13, fill: FAINT, opacity: 0
    }, svg);
    statEl = text(STAT_TEXT, {
      x: 560, y: 488, 'text-anchor': 'middle', 'font-size': 15, fill: FAINT, opacity: 0
    }, svg);

    built = true;
  }

  /* ==================== state / reset ==================== */

  /* All animated paint as attributes (GSAP attr tweens write presentation
   * attributes; CSS rules would beat them and freeze the tween). */
  function staleStyle(r) {
    r.setAttribute('stroke', RED);
    r.setAttribute('stroke-dasharray', '7 5');
  }

  function resetDom() {
    ['root', 'mL', 'mR'].forEach(function (id) {
      gsap.killTweensOf(nodeEls[id]);
      staleStyle(nodeEls[id]);
      nodeEls[id].setAttribute('stroke-width', id === 'root' ? 2.2 : 2);
    });
    CLUSTER_CX.forEach(function (cx, i) {
      gsap.killTweensOf(nodeEls['c' + i]);
      staleStyle(nodeEls['c' + i]);
      nodeEls['c' + i].setAttribute('stroke-width', 1.8);
    });
    dotEls.forEach(function (d) {
      gsap.killTweensOf(d);
      d.setAttribute('r', 0);
      d.setAttribute('opacity', 0);
    });
    [tagThread, tagAtomic, tagRoot, statEl].forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 0);
    });
  }

  /* ==================== timeline ==================== */

  /* stale -> re-fitted flip (reverse-safe timeline set, like refit.js) */
  function tlRefit(timeline, id, at) {
    timeline.set(nodeEls[id], { attr: { stroke: BLUE, 'stroke-dasharray': 'none' } }, at);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    /* s1 — threads spawn at the leaf clusters */
    tl.to({}, { duration: 0.25 }, '>');
    var a1 = tl.duration();
    tl.to(dotEls, {
      attr: { opacity: 1, r: 5.5 },
      duration: 0.45, stagger: 0.055, ease: 'back.out(2)'
    }, a1);
    tl.to(tagThread, { attr: { opacity: 1 }, duration: 0.4 }, a1 + 0.25);
    tl.addLabel('s1', tl.duration());

    /* s2 — threads ascend independently: staggered but heavily
     * overlapping hops; each touched node re-fits on first arrival.
     * NO level barrier anywhere — that is the whole point. */
    tl.to({}, { duration: 0.25 }, '>');
    var a2 = tl.duration();
    dotEls.forEach(function (d, i) {
      var t = a2 + i * STAG;
      var mid = MIDS[i < 4 ? 0 : 1];
      tlRefit(tl, 'c' + i, t + 0.05);                       // own leaf: local fit first
      tl.to(d, { attr: { cx: mid.cx, cy: mid.y + 28 }, duration: HOP1, ease: 'power1.inOut' }, t);
      tl.to(d, { attr: { cx: ROOT.cx, cy: ROOT.cy }, duration: HOP2, ease: 'power1.inOut' }, t + HOP1);
      tl.to(d, { attr: { opacity: 0 }, duration: 0.3 }, t + HOP1 + HOP2); // thread done
    });
    /* first arrival per internal node flips it (later arrivals are no-ops) */
    tlRefit(tl, 'mL', a2 + HOP1);
    tlRefit(tl, 'mR', a2 + 4 * STAG + HOP1);
    tlRefit(tl, 'root', a2 + HOP1 + HOP2);
    /* brief stroke-width flare on first arrival, settles back */
    [['mL', a2 + HOP1, 2], ['mR', a2 + 4 * STAG + HOP1, 2], ['root', a2 + HOP1 + HOP2, 2.2]]
      .forEach(function (f) {
        tl.set(nodeEls[f[0]], { attr: { 'stroke-width': f[2] + 1.2 } }, f[1]);
        tl.to(nodeEls[f[0]], { attr: { 'stroke-width': f[2] }, duration: 0.6 }, f[1] + 0.05);
      });
    tl.addLabel('s2', tl.duration());

    /* s3 — rare atomics: bounds grew -> atomic min/max write.
     * One mid node pulses red; the root pulse is barely visible —
     * local pre-testing filters almost everything near the root. */
    tl.to({}, { duration: 0.25 }, '>');
    var a3 = tl.duration();
    tl.to(nodeEls.mR, { attr: { stroke: RED }, duration: 0.22, ease: 'power1.out' }, a3);
    tl.to(nodeEls.mR, { attr: { stroke: BLUE }, duration: 0.45, ease: 'power1.inOut' }, a3 + 0.26);
    tl.to(tagAtomic, { attr: { opacity: 1 }, duration: 0.4 }, a3 + 0.2);
    tl.to(nodeEls.root, { attr: { stroke: '#dd8b8b' }, duration: 0.25 }, a3 + 0.55);
    tl.to(nodeEls.root, { attr: { stroke: BLUE }, duration: 0.5 }, a3 + 0.85);
    tl.to(tagRoot, { attr: { opacity: 1 }, duration: 0.45 }, a3 + 0.7);
    tl.addLabel('s3', tl.duration());

    /* s4 — stat stamp; canvas otherwise settled (final refit state) */
    tl.to({}, { duration: 0.25 }, '>');
    tl.to(statEl, { attr: { opacity: 1 }, duration: 0.6 }, '>');
    tl.addLabel('s4', tl.duration());
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

  // expose pure layout for headless smoke tests
  animator._test = {
    sections: SECTIONS,
    clusters: CLUSTER_CX.length,
    statText: STAT_TEXT
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.refitgeo = animator;
})();
