/* AABB quantization animator — the ALIGNED (orthogonal) grid.
 *
 * Structural mirror of js/widenode.js (the quant slide), same beats:
 * where that slide quantizes SOBBs onto the SKEWED grid of one shared
 * basis, this one quantizes AABBs onto the axis-aligned grid — the state
 * of the art's whole quantization story.
 *
 * SEAMLESS JOIN: entry state IS slide B's (pipeaabb8) lead-in END state,
 * pixel-for-pixel — same 3-chip row (AABB BVH₂ / AABB BVH₈ done,
 * quantization ACTIVE), same wide-node slot strip, same bounds region
 * with the same eight tight child AABBs — B's lead-in travels into this
 * frame; both sections carry data-transition="none", and this slide
 * builds at full opacity (no entrance fade), so the cut reads as a
 * continuation.
 *
 * ViewBox note: 1120×520, identical to js/pipeline.js — the pipeline
 * slides and this one place the chip row in the exact same screen band
 * (meet-scaled identical). widenode.js/sharedbasis.js use 1120×560;
 * every shared WIDE/P/CHILD_TRIS coordinate stays numerically identical
 * (same rendering scale — the join only differs in vertical letterbox).
 *
 * s0: hand-off — one wide node · eight tight axis-aligned child bounds
 * s1: the orthogonal slab grid appears — one wire family per axis
 *     (black, slightly transparent), tiling the node bounds
 * s2: quantization — every bound snaps OUTWARD onto the grid cells,
 *     conservative by construction (axis-space floor/ceil)
 * s3: closer — the grid falls quiet; eight crisp quantized AABBs remain;
 *     terse caption, no numeric readouts
 *
 * Layout note: WIDE strip / P panel / CHILD_TRIS are numerically identical
 * to js/widenode.js + js/sharedbasis.js so the two quantization slides are
 * directly comparable; the chip row mirrors pipeline.js CFG_AABB8 exactly
 * (constants duplicated on purpose, parity machine-checked via _test).
 *
 * Aligned-grid quantization math is pure and exported (_test): snapped
 * rects provably contain the tight rects, land exactly on grid lines and
 * stay inside the node bounds.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE,
      FAINT = D.FAINT, LIGHT = D.LIGHT;

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520 — pipeline.js match) ==================== */

  /* stage chips — slide B's exact row (pipeline.js CFG_AABB8, mirrored for
   * a pixel-continuous hand-off): first two done, quantization ACTIVE. */
  var SUB2 = '₂', SUB8 = '₈';
  var CHIP_TXT = ['AABB BVH' + SUB2, 'AABB BVH' + SUB8, 'quantization'];
  var CHIP_W = [150, 150, 140];
  var CHIP_H = 34, CHIP_Y = 24;
  var CHIP_X = [304, 490, 676];
  var CHIP_ARROW_X = [472, 658];
  var CHIP_STATE = ['done', 'done', 'active']; // static per chip
  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  /* left: the wide node (identical layout to widenode.js) */
  var WIDE = { x: 80, y: 130, w: 360, h: 64 };
  var SLOT_N = 8;

  /* right: node bounds holding the 8 children + the orthogonal grid */
  var P = { x: 560, y: 90, w: 440, h: 380 };
  var BOX_PAD = 4;

  /* 8 child triangles inside P — identical to widenode.js/grid mirror */
  var CHILD_TRIS = [
    [[604, 168], [680, 158], [642, 234]],
    [[710, 170], [784, 162], [750, 238]],
    [[812, 166], [888, 158], [854, 232]],
    [[878, 180], [946, 174], [916, 240]],
    [[600, 330], [676, 320], [640, 390]],
    [[706, 328], [782, 318], [746, 388]],
    [[814, 332], [890, 324], [856, 394]],
    [[884, 326], [952, 318], [922, 386]]
  ];

  /* orthogonal slab grid: CELLS cells per axis over P, origins on the
   * panel edges so snapped bounds stay inside the node bounds */
  var CELLS = 10;               // 11 wires per axis
  var GRIDSPEC = { ox: P.x, oy: P.y, sx: P.w / CELLS, sy: P.h / CELLS };

  var CAPTIONS = [
    'Quantization: the eight child bounds snap onto the local orthogonal grid.',
    'Local orthogonal grid: anchor + integer coordinates.',
    'Quantize: every bound snaps onto the grid cells conservatively.',
    'Bounds are slightly inflated, memory footprint is down.'
  ];

  /* ==================== pure math (exported for tests) ==================== */

  function exactBox(tri) {
    return D.inflate(D.aabb(tri), BOX_PAD);
  }

  /* snap an axis-aligned rect OUTWARD onto the grid lines. Conservative
   * by construction: every snapped rect fully contains the tight rect. */
  function quantizeRect(b) {
    function lo(v, o, s) { return o + Math.floor((v - o) / s - 1e-9) * s; }
    function hi(v, o, s) { return o + Math.ceil((v - o) / s + 1e-9) * s; }
    var x = lo(b.x, GRIDSPEC.ox, GRIDSPEC.sx), y = lo(b.y, GRIDSPEC.oy, GRIDSPEC.sy);
    return {
      x: x, y: y,
      w: hi(b.x + b.w, GRIDSPEC.ox, GRIDSPEC.sx) - x,
      h: hi(b.y + b.h, GRIDSPEC.oy, GRIDSPEC.sy) - y
    };
  }

  /* containment predicate for tests: does snapped q contain tight t? */
  function containsRect(q, t, eps) {
    var e = eps || 1e-9;
    return q.x <= t.x + e && q.y <= t.y + e &&
           q.x + q.w >= t.x + t.w - e && q.y + q.h >= t.y + t.h - e;
  }

  /* per-child geometry: exact padded AABB + conservative quantized AABB */
  function childBoxes() {
    return CHILD_TRIS.map(function (tri) {
      var eb = exactBox(tri);
      return { exact: eb, quant: quantizeRect(eb) };
    });
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  function rectAttrs(b) {
    return { x: b.x, y: b.y, width: b.w, height: b.h };
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var chipRects = [], chipTexts = [];
  var wideRect, wideSlots = [], slotDots = [], slotGlyphs = [];
  var miniCapEl, connLine, connHead, quantCapEl;
  var parentRect, gridV = [], gridH = [];
  var childTris = [], tightRects = [], quantRects = [];
  var CHILD = null;
  var captionEl;
  var tl = null;

  function build() {
    CHILD = childBoxes();

    var host = document.getElementById('aabbquant-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);
    var i;

    /* stage chips: slide B's settled row, static states */
    for (i = 0; i < CHIP_TXT.length; i++) {
      var s = CHIP_STYLE[CHIP_STATE[i]];
      chipRects.push(el('rect', {
        'class': 'chip-rect',
        x: CHIP_X[i], y: CHIP_Y, width: CHIP_W[i], height: CHIP_H, rx: 6,
        'stroke-width': 1.4, fill: s.fill, stroke: s.stroke
      }, svg));
      chipTexts.push(text(CHIP_TXT[i], {
        'class': 'chip-text',
        x: CHIP_X[i] + CHIP_W[i] / 2, y: CHIP_Y + 22,
        'text-anchor': 'middle', 'font-size': 15, fill: s.txt
      }, svg));
    }
    CHIP_ARROW_X.forEach(function (x) {
      text('→', {
        'class': 'chip-arrow',
        x: x, y: CHIP_Y + 22, 'text-anchor': 'middle', 'font-size': 16, fill: FAINT
      }, svg);
    });

    /* ---- left: the wide node (strip + slots + axis-aligned glyphs) ---- */
    wideRect = el('rect', {
      x: WIDE.x, y: WIDE.y, width: WIDE.w, height: WIDE.h, rx: 8,
      fill: '#ffffff', stroke: INK, 'stroke-width': 1.8
    }, svg);
    for (var k = 1; k < SLOT_N; k++) {
      wideSlots.push(el('line', {
        x1: WIDE.x + (WIDE.w / SLOT_N) * k, y1: WIDE.y + 7,
        x2: WIDE.x + (WIDE.w / SLOT_N) * k, y2: WIDE.y + WIDE.h - 7,
        stroke: EDGE, 'stroke-width': 1.2
      }, svg));
    }
    var cy = WIDE.y + WIDE.h / 2;
    for (i = 0; i < SLOT_N; i++) {
      var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
      slotDots.push(el('circle', { cx: gx, cy: cy, r: 2.2, fill: INK }, svg));
      /* axis-aligned mini glyph: a plain rect — the aligned basis */
      slotGlyphs.push(el('rect', {
        'class': 'aabb-glyph',
        x: gx - 10, y: cy - 19, width: 20, height: 10, rx: 2,
        fill: 'none', stroke: INK, 'stroke-width': 1.3
      }, svg));
    }
    miniCapEl = text('one wide node · eight child AABBs', {
      x: WIDE.x + WIDE.w / 2, y: WIDE.y + WIDE.h + 34,
      'text-anchor': 'middle', 'font-size': 15, fill: FAINT
    }, svg);

    /* connector: wide node → its bounds box */
    connLine = el('line', {
      x1: WIDE.x + WIDE.w + 14, y1: cy, x2: P.x - 22, y2: cy,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
    }, svg);
    connHead = el('polygon', {
      points: (P.x - 24) + ',' + (cy - 5) + ' ' + (P.x - 24) + ',' + (cy + 5) + ' ' + (P.x - 14) + ',' + cy,
      fill: EDGE
    }, svg);

    /* ---- right: node bounds + orthogonal grid + children ---- */
    parentRect = el('rect', {
      x: P.x, y: P.y, width: P.w, height: P.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.8
    }, svg);

    /* orthogonal slab grid (s1): family V = vertical wires (normal = x),
     * family H = horizontal wires (normal = y). Axis-aligned, so the wires
     * land exactly on the panel — no clip needed. Black and slightly
     * transparent: subordinate to the blue quantized bounds. */
    for (i = 0; i <= CELLS; i++) {
      gridV.push(el('line', {
        'class': 'aabb-grid-v',
        x1: P.x + P.w * i / CELLS, y1: P.y,
        x2: P.x + P.w * i / CELLS, y2: P.y + P.h,
        stroke: INK, 'stroke-width': 1.3, opacity: 0
      }, svg));
      gridH.push(el('line', {
        'class': 'aabb-grid-h',
        x1: P.x, y1: P.y + P.h * i / CELLS,
        x2: P.x + P.w, y2: P.y + P.h * i / CELLS,
        stroke: INK, 'stroke-width': 1.3, opacity: 0
      }, svg));
    }

    /* children: tris + tight AABBs + blue quantized AABBs (start
     * superimposed on tight, snap out) */
    CHILD.forEach(function (c, i) {
      childTris.push(el('polygon', {
        points: pts2str(CHILD_TRIS[i]),
        fill: LIGHT, stroke: INK, 'stroke-width': 1.2,
        'stroke-linejoin': 'round'
      }, svg));
      var ta = rectAttrs(c.exact);
      tightRects.push(el('rect', {
        'class': 'aabb-tight',
        x: ta.x, y: ta.y, width: ta.width, height: ta.height,
        fill: 'none', stroke: INK, 'stroke-width': 1.4
      }, svg));
      quantRects.push(el('rect', {
        'class': 'aabb-quant',
        x: ta.x, y: ta.y, width: ta.width, height: ta.height,
        fill: 'none', stroke: BLUE, 'stroke-width': 2.4, opacity: 0
      }, svg));
    });

    /* closer under the panel (s3) — terse, no numeric readouts */
    quantCapEl = text('snapped outward — conservative by construction', {
      x: P.x + P.w / 2, y: P.y + P.h + 34,
      'text-anchor': 'middle', 'font-size': 15, fill: BLUE, opacity: 0
    }, svg);

    captionEl = document.getElementById('aabbquant-caption');
    built = true;
  }

  /* ==================== reset ====================
   * Base state = slide B's lead-in END state, pixel-for-pixel: chips
   * settled (quantization ACTIVE), the wide root in its 8-slot strip
   * pose + dots + glyphs + connector, the node bounds region with the
   * eight tight child AABBs crisp; grids/legend/quantized bounds hidden.
   * Continuation, not a rebuild. */

  function resetDom() {
    chipRects.forEach(function (r, i) {
      var s = CHIP_STYLE[CHIP_STATE[i]];
      r.setAttribute('fill', s.fill);
      r.setAttribute('stroke', s.stroke);
    });
    chipTexts.forEach(function (t, i) {
      t.setAttribute('fill', CHIP_STYLE[CHIP_STATE[i]].txt);
    });
    gsap.killTweensOf(wideRect);
    wideRect.setAttribute('stroke', INK);
    gsap.killTweensOf(miniCapEl);
    gsap.killTweensOf(connLine);
    gsap.killTweensOf(connHead);
    gsap.killTweensOf(parentRect);
    parentRect.setAttribute('stroke', INK);
    gridV.concat(gridH).forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    CHILD.forEach(function (c, i) {
      var ta = rectAttrs(c.exact);
      gsap.killTweensOf(childTris[i]);
      childTris[i].setAttribute('opacity', 1);
      gsap.killTweensOf(tightRects[i]);
      tightRects[i].setAttribute('opacity', 1);
      tightRects[i].setAttribute('stroke', INK);
      tightRects[i].setAttribute('x', ta.x);
      tightRects[i].setAttribute('y', ta.y);
      tightRects[i].setAttribute('width', ta.width);
      tightRects[i].setAttribute('height', ta.height);
      gsap.killTweensOf(quantRects[i]);
      quantRects[i].setAttribute('opacity', 0);
      quantRects[i].setAttribute('x', ta.x);
      quantRects[i].setAttribute('y', ta.y);
      quantRects[i].setAttribute('width', ta.width);
      quantRects[i].setAttribute('height', ta.height);
    });
    gsap.killTweensOf(quantCapEl);
    quantCapEl.setAttribute('opacity', 0);
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 3;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — the orthogonal slab grid: one wire family per axis */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(gridV, { attr: { opacity: 0.4 }, duration: 0.45, stagger: 0.03 }, at);
    tl.to(gridH, { attr: { opacity: 0.4 }, duration: 0.45, stagger: 0.03 }, at + 0.25);
    tl.addLabel('s1', tl.duration());

    /* s2 — quantization: bounds snap OUTWARD onto the grid cells */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    /* quiet the tight fit so the blue quantized fit is the loud one */
    tl.to(tightRects, { attr: { stroke: FAINT }, duration: 0.5, ease: 'power1.inOut' }, at);
    CHILD.forEach(function (c, i) {
      var qa = rectAttrs(c.quant);
      var w = at + 0.3 + i * 0.045;
      tl.to(quantRects[i], { attr: { opacity: 1 }, duration: 0.25 }, w);
      tl.to(quantRects[i], {
        attr: { x: qa.x, y: qa.y, width: qa.width, height: qa.height },
        duration: 0.6, ease: 'power2.inOut'
      }, w + 0.1);
    });
    tl.addLabel('s2', tl.duration());

    /* s3 — closer: grid falls quiet, eight crisp quantized AABBs remain;
     * the node + its bounds go blue (the stored representation) */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(gridV.concat(gridH), { attr: { opacity: 0.18 }, duration: 0.5 }, at);
    tl.to(tightRects, { attr: { opacity: 0.55 }, duration: 0.4 }, at);
    tl.to(childTris, { attr: { opacity: 0.75 }, duration: 0.4 }, at);
    tl.to([wideRect, parentRect], { attr: { stroke: BLUE }, duration: 0.5 }, at + 0.25);
    tl.to(quantCapEl, { attr: { opacity: 1 }, duration: 0.45 }, at + 0.45);
    tl.addLabel('s3', tl.duration());
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
      /* NO entrance fade/rise here (unlike the other animators): this
       * slide is the hard-cut continuation of slide B's hand-off frame
       * and must be composited complete on entry — an opacity dip or a
       * 14px rise would read as a double-exposure over the outgoing
       * slide. */
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
    exactBox: exactBox,
    quantizeRect: quantizeRect,
    containsRect: containsRect,
    childBoxes: childBoxes,
    pts2str: pts2str,
    GRIDSPEC: GRIDSPEC,
    chips: {
      TXT: CHIP_TXT, X: CHIP_X, W: CHIP_W, Y: CHIP_Y, H: CHIP_H,
      ARROW_X: CHIP_ARROW_X, STATE: CHIP_STATE, STYLE: CHIP_STYLE
    },
    CHILD_TRIS: CHILD_TRIS,
    WIDE: WIDE, SLOT_N: SLOT_N,
    P: P, CELLS: CELLS,
    CAPTIONS: CAPTIONS,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.aabbquant = animator;
})();
