/* Wide node construction & quantization animator — paper Sec. 3.2.
 *
 * s1: interior collapse — 7 binary nodes merge into one 8-wide node
 * s2: a local quantization grid appears over the node bounds
 * s3: child boxes snap OUTWARD to grid cells (conservative: the
 *     quantized bound always fully contains the true bound)
 *
 * Boxes are computed from actual child geometry (8 small triangles).
 * Quantize math is pure and exported for the headless harness:
 * for every child, quantized bounds contain the exact bounds AND all
 * edges land on grid lines.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ==================== */

  /* left: binary subtree that collapses */
  var SQ = 24;
  var SUB = {
    p:  { cx: 260, cy: 90 },
    a:  { cx: 175, cy: 175 },
    b:  { cx: 345, cy: 175 },
    c0: { cx: 120, cy: 260 }, c1: { cx: 230, cy: 260 },
    c2: { cx: 290, cy: 260 }, c3: { cx: 400, cy: 260 }
  };
  var SUB_IDS = Object.keys(SUB);
  var SUB_EDGES = [
    ['p', 'a'], ['p', 'b'],
    ['a', 'c0'], ['a', 'c1'], ['b', 'c2'], ['b', 'c3']
  ];
  var SUB_DOTS = 8;            // leaf dots that become wide-node slots
  var DOT_Y = 330;

  /* wide node the subtree collapses into */
  var WIDE_NODE = { x: 100, y: 72, w: 320, h: 58 };

  /* right: parent node bounds + quantization grid + child geometry */
  var P = { x: 560, y: 110, w: 440, h: 380 };
  var GRID = 8;                 // cells per axis (schematic; paper uses 15 intervals)
  var CELL = { w: P.w / GRID, h: P.h / GRID };

  /* 8 child triangles inside P (the wide node's children) */
  var CHILD_TRIS = [
    [[600, 165], [648, 152], [622, 202]],
    [[700, 150], [760, 168], [718, 208]],
    [[830, 168], [886, 150], [872, 212]],
    [[912, 190], [968, 176], [950, 228]],
    [[596, 300], [654, 284], [630, 344]],
    [[706, 330], [766, 306], [748, 366]],
    [[836, 314], [894, 296], [878, 356]],
    [[930, 340], [980, 320], [962, 372]]
  ];
  var BOX_PAD = 4;

  var CAPTIONS = [
    'A wide node packs up to 8 child boxes into one compressed record.',
    'Interior collapse: 7 binary nodes become one 8-ary node.',
    'Each node defines a local quantization grid over its bounds.',
    'Child boxes snap OUTWARD to grid cells — conservative, never smaller.'
  ];

  /* ==================== pure math (exported for tests) ==================== */

  function exactBox(tri) {
    return D.inflate(D.aabb(tri), BOX_PAD);
  }

  /* Snap a box outward to the grid: min edges floor, max edges ceil.
   * Guaranteed conservative by construction. */
  function quantizeBox(b, origin, cell) {
    var q = {
      x: origin.x + Math.floor((b.x - origin.x) / cell.w) * cell.w,
      y: origin.y + Math.floor((b.y - origin.y) / cell.h) * cell.h
    };
    q.w = origin.x + Math.ceil((b.x + b.w - origin.x) / cell.w) * cell.w - q.x;
    q.h = origin.y + Math.ceil((b.y + b.h - origin.y) / cell.h) * cell.h - q.y;
    return q;
  }

  function childBoxes() {
    return CHILD_TRIS.map(function (tri) {
      var e = exactBox(tri);
      return { exact: e, quant: quantizeBox(e, { x: P.x, y: P.y }, CELL) };
    });
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var subNodes = {}, subEdges = [], dots = [];
  var wideSlots = [];
  var miniCapEl;
  var parentRect, gridLines = [];
  var childTris = [], ghostRects = [], quantRects = [];
  var BOXES = null;
  var captionEl;
  var tl = null;

  function build() {
    BOXES = childBoxes();

    var host = document.getElementById('wide-canvas');
    svg = el('svg', { viewBox: '0 0 1120 560', width: '100%', height: '100%' }, host);

    /* ---- left: binary subtree ---- */
    SUB_EDGES.forEach(function (pair) {
      var a = SUB[pair[0]], b = SUB[pair[1]];
      subEdges.push(el('line', {
        x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy,
        stroke: EDGE, 'stroke-width': 1.4
      }, svg));
    });
    SUB_IDS.forEach(function (id) {
      var n = SUB[id];
      subNodes[id] = el('rect', {
        x: n.cx - SQ / 2, y: n.cy - SQ / 2, width: SQ, height: SQ, rx: 4,
        fill: '#ffffff', stroke: INK, 'stroke-width': 1.5
      }, svg);
    });
    for (var i = 0; i < SUB_DOTS; i++) {
      dots.push(el('circle', {
        cx: 95 + i * 48, cy: DOT_Y, r: 7,
        fill: INK
      }, svg));
    }

    /* slot dividers of the wide node (appear after the root square morphs) */
    for (var k = 1; k < 8; k++) {
      wideSlots.push(el('line', {
        x1: WIDE_NODE.x + (WIDE_NODE.w / 8) * k, y1: WIDE_NODE.y + 7,
        x2: WIDE_NODE.x + (WIDE_NODE.w / 8) * k, y2: WIDE_NODE.y + WIDE_NODE.h - 7,
        stroke: EDGE, 'stroke-width': 1.1, opacity: 0
      }, svg));
    }

    /* left mini-caption */
    miniCapEl = text('one wide node', {
      x: 260, y: 160, 'text-anchor': 'middle', 'font-size': 14, fill: FAINT, opacity: 0
    }, svg);

    /* ---- right: parent bounds, grid, children ---- */
    parentRect = el('rect', {
      x: P.x, y: P.y, width: P.w, height: P.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.8, opacity: 0
    }, svg);

    for (var gx = 1; gx < GRID; gx++) {
      gridLines.push(el('line', {
        x1: P.x + CELL.w * gx, y1: P.y, x2: P.x + CELL.w * gx, y2: P.y + P.h,
        stroke: EDGE, 'stroke-width': 1, opacity: 0
      }, svg));
    }
    for (var gy = 1; gy < GRID; gy++) {
      gridLines.push(el('line', {
        x1: P.x, y1: P.y + CELL.h * gy, x2: P.x + P.w, y2: P.y + CELL.h * gy,
        stroke: EDGE, 'stroke-width': 1, opacity: 0
      }, svg));
    }

    CHILD_TRIS.forEach(function (tri, i) {
      childTris.push(el('polygon', {
        points: tri.map(function (p) { return p.join(','); }).join(' '),
        fill: LIGHT, stroke: INK, 'stroke-width': 1.2, 'stroke-linejoin': 'round'
      }, svg));
      var g = el('rect', {
        x: BOXES[i].exact.x, y: BOXES[i].exact.y,
        width: BOXES[i].exact.w, height: BOXES[i].exact.h,
        fill: 'none', stroke: INK, 'stroke-width': 1.3
      }, svg);
      ghostRects.push(g);
      var q = el('rect', {
        x: BOXES[i].exact.x, y: BOXES[i].exact.y,
        width: BOXES[i].exact.w, height: BOXES[i].exact.h,
        fill: 'none', stroke: BLUE, 'stroke-width': 2, opacity: 0
      }, svg);
      quantRects.push(q);
    });

    captionEl = document.getElementById('wide-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    SUB_IDS.forEach(function (id) {
      var n = SUB[id];
      gsap.killTweensOf(subNodes[id]);
      subNodes[id].setAttribute('x', n.cx - SQ / 2);
      subNodes[id].setAttribute('y', n.cy - SQ / 2);
      subNodes[id].setAttribute('width', SQ);
      subNodes[id].setAttribute('height', SQ);
      subNodes[id].setAttribute('rx', 4);
      subNodes[id].setAttribute('opacity', 1);
      subNodes[id].setAttribute('stroke', INK);
    });
    subEdges.forEach(function (e) {
      gsap.killTweensOf(e);
      e.setAttribute('opacity', 1);
    });
    dots.forEach(function (d, i) {
      gsap.killTweensOf(d);
      d.setAttribute('cx', 95 + i * 48);
      d.setAttribute('cy', DOT_Y);
      d.setAttribute('r', 7);
      d.setAttribute('opacity', 1);
    });
    wideSlots.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    gsap.killTweensOf(miniCapEl);
    miniCapEl.setAttribute('opacity', 0);
    gsap.killTweensOf(parentRect);
    parentRect.setAttribute('opacity', 0);
    gridLines.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    childTris.forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 1);
    });
    ghostRects.forEach(function (g, i) {
      gsap.killTweensOf(g);
      D.setRect(g, BOXES[i].exact);
      g.setAttribute('opacity', 1);
      g.setAttribute('stroke', INK);
    });
    quantRects.forEach(function (q, i) {
      gsap.killTweensOf(q);
      D.setRect(q, BOXES[i].exact);
      q.setAttribute('opacity', 0);
      q.setAttribute('stroke', BLUE);
    });
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 3;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — interior collapse: subtree flies into one wide node */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    // internal square nodes converge on the root position and vanish
    var rootC = SUB.p;
    SUB_IDS.forEach(function (id) {
      if (id === 'p') return;
      tl.to(subNodes[id], {
        attr: {
          x: rootC.cx - SQ / 2, y: rootC.cy - SQ / 2, opacity: 0
        },
        duration: 0.8, ease: 'power2.inOut'
      }, at);
    });
    tl.to(subEdges, { attr: { opacity: 0 }, duration: 0.4 }, at);
    // root square morphs into the wide node
    tl.to(subNodes.p, {
      attr: {
        x: WIDE_NODE.x, y: WIDE_NODE.y,
        width: WIDE_NODE.w, height: WIDE_NODE.h, rx: 8
      },
      duration: 0.8, ease: 'power2.inOut'
    }, at + 0.2);
    // leaf dots rise into the wide node's slots
    dots.forEach(function (d, i) {
      var slotX = WIDE_NODE.x + (WIDE_NODE.w / 8) * (i + 0.5);
      var slotY = WIDE_NODE.y + WIDE_NODE.h / 2;
      tl.to(d, {
        attr: { cx: slotX, cy: slotY, r: 5 },
        duration: 0.8, ease: 'power2.inOut'
      }, at + 0.2);
    });
    tl.to(wideSlots, { attr: { opacity: 1 }, duration: 0.4, stagger: 0.02 }, at + 1.0);
    tl.to(miniCapEl, { attr: { opacity: 1 }, duration: 0.4 }, at + 1.0);
    // the parent box on the right draws in at the same time
    tl.to(parentRect, { attr: { opacity: 1 }, duration: 0.6 }, at + 0.5);
    tl.addLabel('s1', tl.duration()); /* label at true timeline end */

    /* s2 — grid appears */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.to(gridLines, { attr: { opacity: 1 }, duration: 0.5, stagger: 0.02 }, at);
    tl.addLabel('s2', tl.duration()); /* label at true timeline end */

    /* s3 — child boxes snap outward to grid cells */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    quantRects.forEach(function (q, i) {
      var qb = BOXES[i].quant;
      tl.to(q, { attr: { opacity: 1 }, duration: 0.25 }, at + i * 0.04);
      tl.to(q, {
        attr: { x: qb.x, y: qb.y, width: qb.w, height: qb.h },
        duration: 0.7, ease: 'power2.inOut'
      }, at + i * 0.04);
    });
    // ghosts dim slightly so the inflated blue bounds dominate
    tl.to(ghostRects, { attr: { opacity: 0.55 }, duration: 0.4 }, at + 0.3);
    tl.addLabel('s3', tl.duration()); /* label at true timeline end */
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
    childBoxes: childBoxes,
    quantizeBox: quantizeBox,
    P: P, GRID: GRID, CELL: CELL,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.widenode = animator;
})();
