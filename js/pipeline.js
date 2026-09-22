/* Build pipeline animator — five beats, one sequential chain:
 *   s1 binary build — an UNBALANCED binary AABB BVH, as SAH splits really
 *      produce: one deep zigzag chain on the left, stray shallow leaves,
 *      and a shallower balanced subtree on the right (15 nodes, 8 leaves).
 *   s2 interior collapse — the binary tree collapses to an APPROXIMATE 8-ary
 *      wide layout: schematic wide root (8 slot dividers) + 4 wide leaves.
 *      Deliberately loose; no mini-triangle leaf glyphs (out of focus here).
 *   s3 fit k-DOP — per-node proxies: randomly sized HEXAGONS (one k across
 *      the slide). Axis-aligned — k-DOP slab directions are shared/fixed,
 *      only the per-node extents vary.
 *   s4 form SOBB — proxies become randomly sized AND rotated PARALLELOGRAMS
 *      (skewed SOBB bases). One plain rectangle (a plain OBB) among them.
 *   s5 quantization — as it ORIGINALLY was over a wide AABB node: an
 *      orthogonal grid with the child bounds as axis-aligned boxes snapped
 *      to grid cells. The following slide upgrades this to the shared basis.
 * Chip strip (binary build → interior collapse → fit k-DOP → form SOBB →
 * quantization) builds SEQUENTIALLY — the "shared basis" insertion lives on
 * the next slide; chip geometry + label list exported via _test for reuse.
 * 5 fragments; GSAP timeline synced to labels s1..s5 via DeckSVG.stopsFor.
 * All GSAP-animated paint props are SVG ATTRIBUTES, never CSS.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;

  /* deterministic proxy randomness — stable seed, same picture every session */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20260922);

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ==================== */

  var SQ = 26;
  /* UNBALANCED binary layout: left side carries the deep chain r-u-a-b-s0/s1
   * (depth 4) with s2/s3 stranded at depths 3/2; right side is a shallow
   * balanced subtree (depth 3). Sibling heights visibly differ under u and a. */
  var BIN = {
    r:  { cx: 560, cy: 90 },
    u:  { cx: 350, cy: 185 },
    v:  { cx: 800, cy: 185 },
    a:  { cx: 240, cy: 280 },
    s3: { cx: 450, cy: 280 },
    b:  { cx: 300, cy: 375 },
    s2: { cx: 180, cy: 375 },
    w2: { cx: 700, cy: 280 },
    w3: { cx: 900, cy: 280 },
    s0: { cx: 260, cy: 470 },
    s1: { cx: 340, cy: 470 },
    s4: { cx: 660, cy: 375 },
    s5: { cx: 740, cy: 375 },
    s6: { cx: 860, cy: 375 },
    s7: { cx: 940, cy: 375 }
  };
  var LEAFSQ = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
  var MIDS = ['u', 'v', 'a', 'b', 'w2', 'w3'];
  /* s1 reveal order: root out, roughly depth by depth */
  var REVEAL = ['r', 'u', 'v', 'a', 'w2', 'w3', 's3', 'b', 's2', 's4', 's5', 's6', 's7', 's0', 's1'];
  var BIN_EDGES = [
    ['r', 'u'], ['r', 'v'],
    ['u', 'a'], ['u', 's3'],
    ['a', 'b'], ['a', 's2'],
    ['b', 's0'], ['b', 's1'],
    ['v', 'w2'], ['v', 'w3'],
    ['w2', 's4'], ['w2', 's5'],
    ['w3', 's6'], ['w3', 's7']
  ];
  /* which wide leaf each binary leaf collapses toward */
  var LEAF_TARGET = { s0: 'wl0', s1: 'wl0', s2: 'wl1', s3: 'wl1', s4: 'wl2', s5: 'wl2', s6: 'wl3', s7: 'wl3' };

  /* wide-node geometry after the collapse — approximate 8-ary layout */
  var WIDE = {
    root: { x: 390, y: 66, w: 340, h: 70 },
    wl0:  { x: 130, y: 300, w: 200, h: 60 },
    wl1:  { x: 350, y: 300, w: 200, h: 60 },
    wl2:  { x: 570, y: 300, w: 200, h: 60 },
    wl3:  { x: 790, y: 300, w: 200, h: 60 }
  };
  var WIDE_ORDER = ['wl0', 'wl1', 'wl2', 'wl3', 'root']; // bottom-up proxy order
  var SLOTS = 8;                                        // 8-ary wide root

  /* quantization grid over the wide root + snapped child-bound boxes */
  var GRID = { cols: 8, rows: 4 };
  var SNAP_CELLS = [ // (col,row,cols,rows) — 4 children, snapped to the grid
    { c: 0, r: 0, w: 2, h: 2 },
    { c: 2, r: 1, w: 3, h: 2 },
    { c: 5, r: 0, w: 2, h: 3 },
    { c: 6, r: 3, w: 2, h: 1 }
  ];

  /* proxies: per-node HEXAGONS (fit k-DOP) → per-node PARALLELOGRAMS
   * (form SOBB). Random sizes/rotations, deterministic seed. All absolute
   * extents verified inside the 1120x520 viewBox with margin (see _test). */
  var PROXY_FILL = '#eaf2fd';
  var HEX = {};  // id -> {cx, cy, pts:[6 abs pts]}
  var PAR = {};  // id -> {cx, cy, theta, rel:[4 pts], abs:[4 pts]}
  (function computeProxies() {
    var i;
    WIDE_ORDER.forEach(function (id) {
      var W = WIDE[id], cx = W.x + W.w / 2, cy = W.y + W.h / 2;
      var root = id === 'root';

      /* leaf hexagons must not kiss their neighbours (leaf rects sit 20px
       * apart) — keep leaf half-widths at/under the rect half-width */
      var hw = (W.w / 2) * (root ? 1.02 + 0.28 * rand() : 0.85 + 0.17 * rand());
      /* root hexagon also stays under the chip row (chips bottom y=58) */
      var hh = (W.h / 2) * (root ? 0.7 + 0.2 * rand() : 1.06 + 0.34 * rand());
      var hp = [];
      for (i = 0; i < 6; i++) {
        var ang = i * Math.PI / 3;
        hp.push([cx + hw * Math.cos(ang), cy + hh * Math.sin(ang)]);
      }
      HEX[id] = { cx: cx, cy: cy, pts: hp };

      /* root parallelogram must clear the chip row above it (rect top y=66,
       * chips bottom y=58); leaf neighbour gap is 20px, so cap leaf sizes */
      var a2 = (W.w / 2) * (root ? 0.52 + 0.1 * rand() : 0.72 + 0.2 * rand());
      var b2 = (W.h / 2) * (root ? 0.55 + 0.12 * rand() : 1.05 + 0.35 * rand());
      /* wl1 carries the one plain rectangle; the rest skew at 65..105 deg */
      var phi = (id === 'wl1' ? 90 : 65 + 40 * rand()) * Math.PI / 180;
      var theta = (rand() * 2 - 1) * (root ? 6 : 26);
      var e2 = [Math.cos(phi), Math.sin(phi)];
      var rel = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (s) {
        return [s[0] * a2 + s[1] * b2 * e2[0], s[1] * b2 * e2[1]];
      });
      var t = theta * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      var abs = rel.map(function (p) {
        return [cx + p[0] * ct - p[1] * st, cy + p[0] * st + p[1] * ct];
      });
      PAR[id] = { cx: cx, cy: cy, theta: theta, rel: rel, abs: abs };
    });
  })();

  /* stage chips — the sequential chain (matches the next slide's strip) */
  var CHIP_TXT = ['binary build', 'interior collapse', 'fit k-DOP', 'form SOBB', 'quantization'];
  var CHIP_W = [150, 170, 110, 120, 140];
  var CHIP_X = [155, 335, 535, 675, 825];
  var ARROW_X = [320, 520, 660, 810];
  var CHIP_H = 34, CHIP_Y = 24;

  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: D.EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  var CAPTIONS = [
    'The original chain: binary build → interior collapse → fit k-DOP → form SOBB → quantization.',
    'Binary AABB BVH from SAH splits — deep chains one side, shallow subtrees the other.',
    'Interiors collapse to 8-ary wide nodes — the 8-wide layout here is approximate.',
    'Fit a temporary k-DOP per node — shared slab directions, per-node extents.',
    'Form the SOBB per node — a skewed basis proxy for each.',
    'Quantization as it originally was — child bounds snap to the orthogonal grid.'
  ];

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var nodeEls = {};     // binary squares; r morphs into the wide root
  var binEdgeEls = [];
  var wideLeafRects = {}; // 4 wide leaves (appear at the collapse)
  var wideEdgeEls = [];
  var slotLines = [];   // SLOTS-1 dividers inside the wide root
  var hexWraps = {}, hexPolys = {};
  var parWraps = {}, parPolys = {};
  var gridLines = [];   // orthogonal quantization grid over the wide root
  var snapBoxes = [];   // axis-aligned child bounds snapped to grid cells
  var chipRects = [], chipTexts = [];
  var captionEl;
  var tl = null;

  var SNAP_ABS = SNAP_CELLS.map(function (b) {
    var R = WIDE.root;
    return {
      x: R.x + (R.w / GRID.cols) * b.c,
      y: R.y + (R.h / GRID.rows) * b.r,
      w: (R.w / GRID.cols) * b.w,
      h: (R.h / GRID.rows) * b.h
    };
  });

  function ptsStr(pts) {
    return pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
  }

  function setChip(i, styleName) {
    var s = CHIP_STYLE[styleName];
    chipRects[i].setAttribute('fill', s.fill);
    chipRects[i].setAttribute('stroke', s.stroke);
    chipTexts[i].setAttribute('fill', s.txt);
  }

  function build() {
    var host = document.getElementById('pipe-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);
    var i;

    /* stage chips — static row, sequential activation only */
    for (i = 0; i < 5; i++) {
      chipRects.push(el('rect', {
        'class': 'chip-rect',
        x: CHIP_X[i], y: CHIP_Y, width: CHIP_W[i], height: CHIP_H, rx: 6,
        'stroke-width': 1.4
      }, svg));
      chipTexts.push(text(CHIP_TXT[i], {
        'class': 'chip-text',
        x: CHIP_X[i] + CHIP_W[i] / 2, y: CHIP_Y + 22,
        'text-anchor': 'middle', 'font-size': 15
      }, svg));
    }
    ARROW_X.forEach(function (x) {
      text('→', {
        'class': 'chip-arrow',
        x: x, y: CHIP_Y + 22, 'text-anchor': 'middle', 'font-size': 16, fill: FAINT
      }, svg);
    });

    /* binary edges */
    BIN_EDGES.forEach(function (pair) {
      var a = BIN[pair[0]], b = BIN[pair[1]];
      binEdgeEls.push(el('line', {
        'class': 'bin-edge',
        x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, 'stroke-width': 1.4
      }, svg));
    });

    /* binary nodes (squares) */
    Object.keys(BIN).forEach(function (nid) {
      var n = BIN[nid];
      nodeEls[nid] = el('rect', {
        'class': 'bin-node', 'data-node': nid,
        x: n.cx - SQ / 2, y: n.cy - SQ / 2, width: SQ, height: SQ, rx: 4,
        fill: '#ffffff', 'stroke-width': 1.5
      }, svg);
    });

    /* wide leaves (appear with the collapse) */
    WIDE_ORDER.slice(0, 4).forEach(function (wid) {
      var w = WIDE[wid];
      wideLeafRects[wid] = el('rect', {
        'class': 'wide-leaf', 'data-node': wid,
        x: w.x, y: w.y, width: w.w, height: w.h, rx: 8,
        fill: '#ffffff', 'stroke-width': 1.5
      }, svg);
    });

    /* wide-node edges (root -> wide leaves) */
    var R = WIDE.root;
    WIDE_ORDER.slice(0, 4).forEach(function (wid) {
      var w = WIDE[wid];
      wideEdgeEls.push(el('line', {
        'class': 'wide-edge',
        x1: R.x + R.w / 2, y1: R.y + R.h,
        x2: w.x + w.w / 2, y2: w.y, 'stroke-width': 1.5
      }, svg));
    });

    /* 8-ary slot dividers inside the wide root */
    for (i = 1; i < SLOTS; i++) {
      slotLines.push(el('line', {
        'class': 'slot-line',
        x1: R.x + (R.w / SLOTS) * i, y1: R.y + 8,
        x2: R.x + (R.w / SLOTS) * i, y2: R.y + R.h - 8,
        'stroke-width': 1.2
      }, svg));
    }

    /* proxies: hexagons (s3) and parallelograms (s4) per wide node */
    WIDE_ORDER.forEach(function (id) {
      var H = HEX[id], P = PAR[id];
      hexWraps[id] = el('g', { transform: 'translate(' + H.cx + ' ' + H.cy + ')' }, svg);
      hexPolys[id] = el('polygon', {
        'class': 'kdop-proxy', 'data-node': id,
        points: ptsStr(H.pts.map(function (p) { return [p[0] - H.cx, p[1] - H.cy]; })),
        fill: PROXY_FILL, stroke: BLUE, 'stroke-width': 1.6
      }, hexWraps[id]);
      parWraps[id] = el('g', { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, svg);
      parPolys[id] = el('polygon', {
        'class': 'sobb-proxy', 'data-node': id,
        points: ptsStr(P.rel),
        fill: PROXY_FILL, stroke: BLUE, 'stroke-width': 1.6
      }, parWraps[id]);
    });

    /* quantization grid over the wide root (s5) */
    var cw = R.w / GRID.cols, rh = R.h / GRID.rows;
    for (i = 1; i < GRID.cols; i++) {
      gridLines.push(el('line', {
        'class': 'quant-grid',
        x1: R.x + cw * i, y1: R.y, x2: R.x + cw * i, y2: R.y + R.h,
        'stroke-width': 1
      }, svg));
    }
    for (i = 1; i < GRID.rows; i++) {
      gridLines.push(el('line', {
        'class': 'quant-grid',
        x1: R.x, y1: R.y + rh * i, x2: R.x + R.w, y2: R.y + rh * i,
        'stroke-width': 1
      }, svg));
    }

    /* child bounds: axis-aligned boxes snapped to grid cells */
    SNAP_ABS.forEach(function (b) {
      snapBoxes.push(el('rect', {
        'class': 'quant-box',
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 1,
        fill: LIGHT, 'fill-opacity': 0.55, stroke: INK, 'stroke-width': 1.4
      }, svg));
    });

    captionEl = document.getElementById('pipe-caption');
    built = true;
  }

  /* ==================== state / reset ==================== */

  function resetDom() {
    Object.keys(nodeEls).forEach(function (id) {
      var r = nodeEls[id];
      gsap.killTweensOf(r);
      var n = BIN[id];
      r.setAttribute('x', n.cx - SQ / 2);
      r.setAttribute('y', n.cy - SQ / 2);
      r.setAttribute('width', SQ);
      r.setAttribute('height', SQ);
      r.setAttribute('rx', 4);
      r.setAttribute('opacity', 0);
      r.setAttribute('stroke', INK);
    });
    binEdgeEls.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', EDGE);
    });
    Object.keys(wideLeafRects).forEach(function (wid) {
      var r = wideLeafRects[wid], w = WIDE[wid];
      gsap.killTweensOf(r);
      r.setAttribute('x', w.x);
      r.setAttribute('y', w.y);
      r.setAttribute('width', w.w);
      r.setAttribute('height', w.h);
      r.setAttribute('opacity', 0);
      r.setAttribute('stroke', INK);
    });
    wideEdgeEls.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', EDGE);
    });
    slotLines.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', EDGE);
    });
    WIDE_ORDER.forEach(function (id) {
      gsap.killTweensOf(hexWraps[id]);
      gsap.killTweensOf(hexPolys[id]);
      gsap.killTweensOf(parWraps[id]);
      gsap.killTweensOf(parPolys[id]);
      hexWraps[id].setAttribute('transform', 'translate(' + HEX[id].cx + ' ' + HEX[id].cy + ')');
      hexPolys[id].setAttribute('opacity', 0);
      parWraps[id].setAttribute('transform',
        'translate(' + PAR[id].cx + ' ' + PAR[id].cy + ') rotate(' + PAR[id].theta + ')');
      parPolys[id].setAttribute('opacity', 0);
    });
    gridLines.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', FAINT);
    });
    snapBoxes.forEach(function (r) {
      gsap.killTweensOf(r);
      r.setAttribute('opacity', 0);
    });
    for (var i = 0; i < 5; i++) setChip(i, 'todo');
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 5;

  /* chip styling as timeline sets (reverse-safe, unlike callbacks) */
  function tlChip(timeline, i, styleName, pos) {
    var s = CHIP_STYLE[styleName];
    timeline.set(chipRects[i], { attr: { fill: s.fill, stroke: s.stroke } }, pos);
    timeline.set(chipTexts[i], { attr: { fill: s.txt } }, pos);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at, c0;

    function pad(d) { tl.to({}, { duration: d }, tl.duration()); }

    /* ---------- s1 — binary build (unbalanced) ---------- */
    pad(0.2);
    tlChip(tl, 0, 'active', tl.duration());
    at = tl.duration();
    tl.to(binEdgeEls, { attr: { opacity: 1 }, duration: 0.55, stagger: 0.03, ease: 'power1.out' }, at);
    tl.to(REVEAL.map(function (id) { return nodeEls[id]; }),
      { attr: { opacity: 1 }, duration: 0.55, stagger: 0.04, ease: 'power1.out' }, at);
    tl.addLabel('s1', tl.duration());

    /* ---------- s2 — interior collapse to approximate 8-ary wide ---------- */
    pad(0.25);
    tlChip(tl, 0, 'done', tl.duration());
    tlChip(tl, 1, 'active', tl.duration());
    c0 = tl.duration();
    /* leaves fly toward their wide-leaf centers and fade (approximate merge) */
    LEAFSQ.forEach(function (s, i) {
      var W = WIDE[LEAF_TARGET[s]];
      tl.to(nodeEls[s], {
        attr: { x: W.x + W.w / 2 - SQ / 2, y: W.y + W.h / 2 - SQ / 2, opacity: 0 },
        duration: 0.65, ease: 'power2.inOut'
      }, c0 + 0.15 + i * 0.03);
    });
    /* interior mids fly into the root and fade */
    MIDS.forEach(function (id, i) {
      tl.to(nodeEls[id], {
        attr: { x: WIDE.root.x + WIDE.root.w / 2 - SQ / 2, y: WIDE.root.y + WIDE.root.h / 2 - SQ / 2, opacity: 0 },
        duration: 0.65, ease: 'power2.inOut'
      }, c0 + 0.3 + i * 0.04);
    });
    /* all binary edges fade */
    tl.to(binEdgeEls, { attr: { opacity: 0 }, duration: 0.4, stagger: 0.015 }, c0 + 0.15);
    /* binary root fatten into the wide root */
    tl.to(nodeEls.r, {
      attr: { x: WIDE.root.x, y: WIDE.root.y, width: WIDE.root.w, height: WIDE.root.h, rx: 10 },
      duration: 0.8, ease: 'power2.inOut'
    }, c0 + 0.45);
    /* wide leaves open out of nothing (schematic) */
    WIDE_ORDER.slice(0, 4).forEach(function (wid, i) {
      var W = WIDE[wid], r = wideLeafRects[wid];
      tl.fromTo(r,
        { attr: { x: W.x + W.w / 2, y: W.y + W.h / 2, width: 0, height: 0, opacity: 0 } },
        { attr: { x: W.x, y: W.y, width: W.w, height: W.h, opacity: 1 }, duration: 0.6, ease: 'power2.out' },
        c0 + 0.8 + i * 0.09);
    });
    tl.to(wideEdgeEls, { attr: { opacity: 1 }, duration: 0.4 }, c0 + 1.5);
    tl.to(slotLines, { attr: { opacity: 1 }, duration: 0.4, stagger: 0.03 }, c0 + 1.55);
    tl.addLabel('s2', tl.duration());

    /* ---------- s3 — fit k-DOP: hexagon proxy per wide node ---------- */
    pad(0.25);
    tlChip(tl, 1, 'done', tl.duration());
    tlChip(tl, 2, 'active', tl.duration());
    at = tl.duration();
    WIDE_ORDER.forEach(function (id, i) {
      var H = HEX[id];
      tl.fromTo(hexWraps[id],
        { attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(0.35)' } },
        { attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(1)' }, duration: 0.45, ease: 'power2.out' },
        at + i * 0.09);
      tl.fromTo(hexPolys[id], { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.3 }, at + i * 0.09);
    });
    tl.addLabel('s3', tl.duration());

    /* ---------- s4 — form SOBB: skewed parallelogram proxies ---------- */
    pad(0.25);
    tlChip(tl, 2, 'done', tl.duration());
    tlChip(tl, 3, 'active', tl.duration());
    at = tl.duration();
    WIDE_ORDER.forEach(function (id, i) {
      var H = HEX[id], P = PAR[id];
      tl.to(hexPolys[id], { attr: { opacity: 0 }, duration: 0.3 }, at + i * 0.05);
      tl.to(hexWraps[id], {
        attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(0.55)' },
        duration: 0.4, ease: 'power2.in'
      }, at + i * 0.05);
      tl.fromTo(parWraps[id],
        { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + (P.theta - 18) + ')' } },
        { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, duration: 0.55, ease: 'power2.out' },
        at + 0.15 + i * 0.09);
      tl.fromTo(parPolys[id], { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.35 }, at + 0.15 + i * 0.09);
    });
    tl.addLabel('s4', tl.duration());

    /* ---------- s5 — quantization, as it originally was ---------- */
    pad(0.25);
    tlChip(tl, 3, 'done', tl.duration());
    tlChip(tl, 4, 'active', tl.duration());
    at = tl.duration();
    /* slot read-out gives way to the orthogonal quantization grid */
    tl.to(slotLines, { attr: { opacity: 0 }, duration: 0.3 }, at);
    tl.to(gridLines, { attr: { opacity: 1 }, duration: 0.35, stagger: 0.025 }, at + 0.1);
    snapBoxes.forEach(function (r, i) {
      tl.fromTo(r, { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.35 }, at + 0.3 + i * 0.09);
    });
    tlChip(tl, 4, 'done', tl.duration());
    tl.addLabel('s5', tl.duration());
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetDom();
      buildTimeline();
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      if (fragStep > 0) tl.seek(D.stopsFor(tl, SECTIONS)[fragStep], true);
      gsap.fromTo(svg, { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },
    step: function (fragStep) {
      if (!tl) return;
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      tl.tweenTo(D.stopsFor(tl, SECTIONS)[fragStep], { ease: 'none' });
    },
    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  animator._test = {
    /* chip strip — the next slide reuses this strip + inserts "shared basis" */
    labels: CHIP_TXT.slice(),
    chips: { X: CHIP_X, W: CHIP_W, Y: CHIP_Y, H: CHIP_H, ARROW_X: ARROW_X },
    layout: {
      BIN: BIN, BIN_EDGES: BIN_EDGES, LEAFSQ: LEAFSQ, MIDS: MIDS,
      LEAF_TARGET: LEAF_TARGET, REVEAL: REVEAL, SQ: SQ,
      WIDE: WIDE, WIDE_ORDER: WIDE_ORDER, SLOTS: SLOTS
    },
    geom: {
      kSides: 6,          // hexagons: the one k used slide-wide
      parSides: 4,        // parallelograms
      hex: HEX, par: PAR,
      grid: GRID, snap: SNAP_ABS,
      viewBox: [0, 0, 1120, 520]
    },
    captions: CAPTIONS.slice(),
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.pipeline = animator;
})();
