/* Wide-node quantization animator — paper Sec. 3.3, second half.
 *
 * SEAMLESS JOIN: this slide's entry state IS #slide-sharedbasis's settled
 * state, pixel-for-pixel — same 5-chip final row (shared basis DONE,
 * quantization ACTIVE), same wide-node strip, same 8 tight shared-basis
 * parallelograms — and the section carries data-transition="none" (the
 * C→sharedbasis hard-cut idiom), so the cut reads as a continuation.
 * The story then focuses purely on quantization of the skewed space.
 *
 * s0: hand-off — the wide node with its 8 child SOBBs already on the
 *     shared basis, tight
 * s1: the node-bounds frame morphs from the entry AABB into a
 *     parallelogram on the shared basis, and the skewed slab grid
 *     appears inside it — two wire families whose lines ARE the frame's
 *     grid lines, edge to edge, no clipping (the shared basis makes ONE
 *     grid serve the whole node; the frame is just a grid cell span);
 *     the frame's bottom-left corner is dotted as the ANCHOR and every
 *     wire picks up its integer coordinate (0 at the anchor,
 *     increasing outward)
 * s2: quantization — every bound snaps OUTWARD onto the skewed cells,
 *     conservative by construction (slab-space floor/ceil)
 * s3: closer — the grid falls quiet; 8 tight quantized shared-basis
 *     bounds remain: this is what the shared basis enables
 *
 * Children, bounds and quantized results are ALL parallelograms on the
 * shared frame — no axis-aligned rects anywhere in the quantization story.
 *
 * Layout note: WIDE strip / P panel / CHILD_TRIS / slab frame / chip row
 * are numerically identical to js/sharedbasis.js (the settle state there)
 * and js/aabbquant.js (the aligned-grid mirror) — constants duplicated on
 * purpose (hand-off continuity, machine-checked via _test).
 *
 * Skewed-grid quantization math is pure and exported (_test): snapped
 * slab extents provably contain the true extents and land exactly on
 * grid lines.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE,
      FAINT = D.FAINT;

  function rad(d) { return d * Math.PI / 180; }

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ==================== */

  /* stage chips — sharedbasis's FINAL row (post-insertion), exactly as that
   * slide settled: stages done, "shared basis" done, quantization ACTIVE.
   * Mirrored constants (js/sharedbasis.js FINAL_*), row order written out:
   * "shared basis" sits in the inserted slot, "quantization" last. */
  var SUB2 = '₂', SUB8 = '₈';
  var CHIP_TXT = ['AABB BVH' + SUB2, 'AABB BVH' + SUB8, 'SOBB BVH' + SUB8, 'shared basis', 'quantization'];
  var CHIP_W = [150, 150, 160, 170, 170];
  var CHIP_H = 34, CHIP_Y = 24;
  var CHIP_X = [88, 274, 460, 656, 862];
  var CHIP_ARROW_X = [256, 442, 638, 844];
  var CHIP_STATE = ['done', 'done', 'done', 'done', 'active']; // static per chip
  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  /* left: the wide node the shared-basis slide ended on */
  var WIDE = { x: 80, y: 130, w: 360, h: 64 };
  var SLOT_N = 8;

  /* mini glyph: unit parallelogram with edge directions 0°/60°, centered
   * on the origin — drawn inside a group rotated by GLYPH_DEG (=10°), so
   * its final edge directions are E1=10°/E2=70°, the shared frame. */
  var MINI_PTS = '16,5.2 -10,5.2 -16,-5.2 10,-5.2';

  /* right: node bounds holding the 8 children + the skewed grid */
  var P = { x: 560, y: 90, w: 440, h: 380 };
  var BOX_PAD = 4;

  /* 8 child source triangles inside P — geometry only (tight-box
   * derivation), never rendered; sized ~80x75 so a ~10-cell skewed grid
   * reads as *refining* each bound, not swallowing it; positioned with
   * margin so snapped parallelograms stay inside the node bounds */
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

  /* shared slab frame — the deck's SOBB normal pair (100° / 160° in
   * kdopfan + sobbmorph). Grid line directions are the perps; grid wires
   * are drawn in black ink, slightly transparent. Children arrive already
   * on this basis (settled one slide earlier). */
  var N1 = [Math.cos(rad(100)), Math.sin(rad(100))];
  var N2 = [Math.cos(rad(160)), Math.sin(rad(160))];
  var E1 = [N1[1], -N1[0]];
  var E2 = [N2[1], -N2[0]];
  var CELLS = 10;               // skewed grid cells per family (11 wires each)
  var GLYPH_DEG = 10;           // slot glyphs sit on the shared basis

  var CAPTIONS = [
    'With shared basis, quantization is as efficient as with AABBs.',
    'Local skewed grid: anchor + integer coordinates.',
    'Quantize: every bound snaps onto the grid cells conservatively.',
    'Bounds are slightly inflated, memory footprint is down.'
  ];

  /* ==================== pure math (exported for tests) ==================== */

  function project(pts, n) {
    var mn = Infinity, mx = -Infinity;
    pts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    });
    return [mn, mx];
  }

  /* solve n1·p = a, n2·p = b — corner of two slab boundary lines */
  function solveCorner(n1, n2, a, b) {
    var det = n1[0] * n2[1] - n1[1] * n2[0];
    return [
      (a * n2[1] - n1[1] * b) / det,
      (n1[0] * b - a * n2[0]) / det
    ];
  }

  function boxCorners(b) {
    return [
      [b.x, b.y], [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]
    ];
  }

  function exactBox(tri) {
    return D.inflate(D.aabb(tri), BOX_PAD);
  }

  /* TARGET FRAME: the node-bounds parallelogram the slide morphs into
   * at s1 — a slab-extent rectangle on the shared basis, sized CELLS
   * equal cells per family and centered on the union of the children's
   * tight slab extents. Derived FIRST (not from P's corner projections,
   * whose circumscribed parallelogram would spill out of the viewBox);
   * the grid spec below is then derived from the frame, so grid wires
   * land exactly on the frame's edges and tile it perfectly. Verified:
   * corners (466,68) (955,154) (1078,490) (589,404) — inside the
   * 1120x560 viewBox with margin, all 8 tight child parallelograms
   * inside the slab span. */
  var FRAME_EXT = (function () {
    var lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    CHILD_TRIS.forEach(function (tri) {
      var eb = D.inflate(D.aabb(tri), BOX_PAD);
      var r1 = project(boxCorners(eb), N1), r2 = project(boxCorners(eb), N2);
      lo1 = Math.min(lo1, r1[0]); hi1 = Math.max(hi1, r1[1]);
      lo2 = Math.min(lo2, r2[0]); hi2 = Math.max(hi2, r2[1]);
    });
    var W1 = 310, W2 = 430;              // slab spans: 10 cells of 31 / 43
    var g1lo = lo1 - (W1 - (hi1 - lo1)) / 2;
    var g2lo = lo2 - (W2 - (hi2 - lo2)) / 2;
    return [[g1lo, g1lo + W1], [g2lo, g2lo + W2]];
  })();

  /* skewed grid spec: line-family positions along n1/n2 — the frame's
   * slab span divided into CELLS equal cells, so wire k of each family
   * lies on a frame grid line and wires run edge to edge */
  var GRIDSPEC = {
    o1: FRAME_EXT[0][0], s1: (FRAME_EXT[0][1] - FRAME_EXT[0][0]) / CELLS,
    o2: FRAME_EXT[1][0], s2: (FRAME_EXT[1][1] - FRAME_EXT[1][0]) / CELLS
  };

  /* slab extents of points along the shared frame: [[lo1,hi1],[lo2,hi2]] */
  function slabExtents(pts) {
    return [project(pts, N1), project(pts, N2)];
  }

  /* parallelogram corners from slab extents, ordered around */
  function slabCorners(ext) {
    return [
      solveCorner(N1, N2, ext[0][0], ext[1][0]),
      solveCorner(N1, N2, ext[0][1], ext[1][0]),
      solveCorner(N1, N2, ext[0][1], ext[1][1]),
      solveCorner(N1, N2, ext[0][0], ext[1][1])
    ];
  }

  /* snap slab extents outward onto the skewed grid lines. Conservative
   * by construction: every snapped cell fully contains the true cell. */
  function quantizeSlab(ext) {
    function lo(v, o, s) { return o + Math.floor((v - o) / s - 1e-9) * s; }
    function hi(v, o, s) { return o + Math.ceil((v - o) / s + 1e-9) * s; }
    return [
      [lo(ext[0][0], GRIDSPEC.o1, GRIDSPEC.s1), hi(ext[0][1], GRIDSPEC.o1, GRIDSPEC.s1)],
      [lo(ext[1][0], GRIDSPEC.o2, GRIDSPEC.s2), hi(ext[1][1], GRIDSPEC.o2, GRIDSPEC.s2)]
    ];
  }

  /* containment predicate for tests: does snapped q contain true t? */
  function containsSlab(q, t, eps) {
    var e = eps || 1e-9;
    return q[0][0] <= t[0][0] + e && q[0][1] >= t[0][1] - e &&
           q[1][0] <= t[1][0] + e && q[1][1] >= t[1][1] - e;
  }

  /* per-child full geometry set: exact padded box, tight shared-basis
   * slab parallelogram, conservative quantized parallelogram */
  function childSlabs() {
    return CHILD_TRIS.map(function (tri) {
      var eb = exactBox(tri);
      var cx = eb.x + eb.w / 2, cy = eb.y + eb.h / 2;
      var tightExt = slabExtents(boxCorners(eb));
      var quantExt = quantizeSlab(tightExt);
      return {
        exact: eb, cx: cx, cy: cy,
        tightExt: tightExt, tight: slabCorners(tightExt),
        quantExt: quantExt, quant: slabCorners(quantExt)
      };
    });
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* frame morph endpoints: the entry frame is P's AABB (pixel-identical
   * to sharedbasis's settled frame); the s1 target is the grid-aligned
   * parallelogram. slabCorners order is c1..c4 around the loop; P's
   * order is TL,TR,BR,BL — matched by proximity (TL→c4, TR→c1, BR→c2,
   * BL→c3) so the points tween never self-intersects. Same point count
   * and same "x,y x,y ..." format, so GSAP interpolates numerically. */
  var P_PTS = pts2str(boxCorners(P));
  var FRAME_CORNERS = slabCorners(FRAME_EXT);
  var FRAME_PTS = pts2str([
    FRAME_CORNERS[3], FRAME_CORNERS[0],
    FRAME_CORNERS[1], FRAME_CORNERS[2]
  ]);

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var chipRects = [], chipTexts = [];
  var wideRect, wideSlots = [], slotDots = [], slotGlyphs = [];
  var miniCapEl, connLine, connHead, quantCapEl;
  var parentRect, skewLines1 = [], skewLines2 = [];  var ghostParas = [], quantParas = [];
  var anchorDot, anchorLbl, tick1 = [], tick2 = [];
  var CHILD = null;
  var captionEl;
  var tl = null;

  function glyphTransform(i, deg) {
    var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
    var gy = WIDE.y + WIDE.h / 2 - 14;
    return 'translate(' + gx + ' ' + gy + ') rotate(' + deg + ')';
  }

  function build() {
    CHILD = childSlabs();

    var host = document.getElementById('wide-canvas');
    svg = el('svg', { viewBox: '0 0 1120 560', width: '100%', height: '100%' }, host);
    var i;

    /* stage chips: sharedbasis's settled final row, static states */
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
        'text-anchor': 'middle', 'font-size': 25, fill: s.txt
      }, svg));
    }
    CHIP_ARROW_X.forEach(function (x) {
      text('→', {
        'class': 'chip-arrow',
        x: x, y: CHIP_Y + 22, 'text-anchor': 'middle', 'font-size': 26, fill: FAINT
      }, svg);
    });

    /* ---- left: the wide node (strip + slots + shared-basis glyphs) ---- */
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
      var g = el('g', { transform: glyphTransform(i, GLYPH_DEG) }, svg);
      el('polygon', {
        points: MINI_PTS,
        fill: 'none', stroke: INK, 'stroke-width': 1.3,
        'stroke-linejoin': 'round'
      }, g);
      slotGlyphs.push(g);
    }
    miniCapEl = text('one wide node · 8 child SOBBs', {
      x: WIDE.x + WIDE.w / 2, y: WIDE.y + WIDE.h + 34,
      'text-anchor': 'middle', 'font-size': 25, fill: FAINT
    }, svg);

    /* connector: wide node → its bounds frame. Aims at the frame's
     * settled (morphed) left edge: the n2=g2hi slab line crosses the
     * connector height (cy=162) at x≈500.5 — tip sits just short of it. */
    connLine = el('line', {
      x1: WIDE.x + WIDE.w + 14, y1: cy, x2: 492, y2: cy,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
    }, svg);
    connHead = el('polygon', {
      points: '490,' + (cy - 5) + ' 490,' + (cy + 5) + ' 500,' + cy,
      fill: EDGE
    }, svg);

    /* ---- right: node bounds + grid ---- */
    /* the frame is a polygon so it can morph: it opens as P's AABB
     * (entry parity with sharedbasis) and tweens to the grid-aligned
     * parallelogram at s1. No clipping anywhere — grid wires span the
     * frame's slab extents exactly, edge to edge. */
    var stageG = el('g', {}, svg);

    parentRect = el('polygon', {
      points: P_PTS,
      fill: 'none', stroke: INK, 'stroke-width': 1.8,
      'stroke-linejoin': 'round'
    }, svg);

    /* skewed slab grid (s1): family 1 along E1 (normal n1), family 2
     * along E2 (normal n2), wire-thin. Each wire runs from one frame
     * edge to the opposite one — the outermost wires ARE frame edges.
     * Black and slightly transparent: subordinate to the blue bounds. */
    for (var k1 = 0; k1 <= CELLS; k1++) {
      var m1 = GRIDSPEC.o1 + GRIDSPEC.s1 * k1;
      var a1 = solveCorner(N1, N2, m1, FRAME_EXT[1][0]);
      var b1 = solveCorner(N1, N2, m1, FRAME_EXT[1][1]);
      skewLines1.push(el('line', {
        x1: a1[0], y1: a1[1], x2: b1[0], y2: b1[1],
        stroke: INK, 'stroke-width': 1.3, opacity: 0
      }, stageG));
    }
    for (var k2 = 0; k2 <= CELLS; k2++) {
      var m2 = GRIDSPEC.o2 + GRIDSPEC.s2 * k2;
      var a2 = solveCorner(N1, N2, FRAME_EXT[0][0], m2);
      var b2 = solveCorner(N1, N2, FRAME_EXT[0][1], m2);
      skewLines2.push(el('line', {
        x1: a2[0], y1: a2[1], x2: b2[0], y2: b2[1],
        stroke: INK, 'stroke-width': 1.3, opacity: 0
      }, stageG));
    }

    /* anchor + integer coordinates (s1): the frame's bottom-left corner
     * is the local origin — a dotted anchor, and every wire labeled
     * with its integer coordinate: 0 at the anchor, increasing
     * monotonically away from it along each family (both anchor wires
     * are index CELLS, so a wire's value is CELLS-k). Ticks sit just
     * OUTSIDE the frame in its settled pose: family-1 wires (10°)
     * labeled along the left edge, offset along +N2; family-2 wires
     * (70°) along the bottom edge, offset along +N1. */
    var ANCHOR = solveCorner(N1, N2, FRAME_EXT[0][1], FRAME_EXT[1][1]);
    anchorDot = el('circle', {
      cx: ANCHOR[0], cy: ANCHOR[1], r: 4.5,
      fill: BLUE, stroke: '#ffffff', 'stroke-width': 2, opacity: 0
    }, svg);
    anchorLbl = text('anchor', {
      x: ANCHOR[0] - 40, y: ANCHOR[1] + 55,
      'text-anchor': 'end', 'font-size': 17, fill: BLUE, opacity: 0
    }, svg);
    for (var a1 = 0; a1 <= CELLS; a1++) {
      var q1 = solveCorner(N1, N2, GRIDSPEC.o1 + GRIDSPEC.s1 * a1, FRAME_EXT[1][1]);
      tick1.push(text(String(CELLS - a1), {
        x: q1[0] + N2[0] * 22, y: q1[1] + N2[1] * 22 + 4.5,
        'text-anchor': 'middle', 'font-size': 16, fill: INK, opacity: 0
      }, svg));
    }
    for (var a2 = 0; a2 <= CELLS; a2++) {
      var q2 = solveCorner(N1, N2, FRAME_EXT[0][1], GRIDSPEC.o2 + GRIDSPEC.s2 * a2);
      tick2.push(text(String(CELLS - a2), {
        x: q2[0] + N1[0] * 20, y: q2[1] + N1[1] * 20 + 4.5,
        'text-anchor': 'middle', 'font-size': 16, fill: INK, opacity: 0
      }, svg));
    }

    /* children: tight shared-basis parallelograms + blue quantized
     * parallelograms (start superimposed on tight, snap out). Source
     * triangles are not drawn — the bounds alone carry the concept. */
    CHILD.forEach(function (c, i) {
      ghostParas.push(el('polygon', {
        points: pts2str(c.tight),
        fill: 'none', stroke: INK, 'stroke-width': 1.4,
        'stroke-linejoin': 'round'
      }, stageG));
      quantParas.push(el('polygon', {
        points: pts2str(c.tight),
        fill: 'none', stroke: BLUE, 'stroke-width': 2.4,
        'stroke-linejoin': 'round', opacity: 0
      }, stageG));
    });

    /* closer read-out under the morphed frame (its lowest corner sits
     * at y≈490, x≈1078 — caption centered under the frame's mid-x) */
    quantCapEl = text('8 bounds · one shared frame · snapped outward', {
      x: 772, y: 524,
      'text-anchor': 'middle', 'font-size': 25, fill: BLUE, opacity: 0
    }, svg);

    captionEl = document.getElementById('wide-caption');
    built = true;
  }

  /* ==================== reset ====================
   * Base state = #slide-sharedbasis's SETTLED state, pixel-for-pixel:
   * chips final row (quantization ACTIVE), strip + glyphs on the shared
   * tilt, tight shared-basis parallelograms crisp; grids/legend/
   * quantized bounds hidden. The entry is a continuation, not a rebuild. */

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
    parentRect.setAttribute('points', P_PTS);
    skewLines1.concat(skewLines2).forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    [anchorDot, anchorLbl].forEach(function (e) {
      gsap.killTweensOf(e);
      e.setAttribute('opacity', 0);
    });
    tick1.concat(tick2).forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 0);
    });
    CHILD.forEach(function (c, i) {
      gsap.killTweensOf(ghostParas[i]);
      ghostParas[i].setAttribute('opacity', 1);
      ghostParas[i].setAttribute('stroke', INK);
      ghostParas[i].setAttribute('points', pts2str(c.tight));
      gsap.killTweensOf(quantParas[i]);
      quantParas[i].setAttribute('opacity', 0);
      quantParas[i].setAttribute('points', pts2str(c.tight));
    });
    gsap.killTweensOf(quantCapEl);
    quantCapEl.setAttribute('opacity', 0);
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 3;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — the frame morphs from the entry AABB into the grid-aligned
     * parallelogram, then the skewed slab grid fades in edge to edge:
     * one shared basis → ONE grid per node, and the bounds are just a
     * cell span of that grid */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(parentRect, {
      attr: { points: FRAME_PTS },
      duration: 0.55, ease: 'power2.inOut'
    }, at);
    tl.to(skewLines1, { attr: { opacity: 0.4 }, duration: 0.45, stagger: 0.03 }, at + 0.35);
    tl.to(skewLines2, { attr: { opacity: 0.4 }, duration: 0.45, stagger: 0.03 }, at + 0.6);
    /* anchor + integer coordinates ride in once the morph has settled
     * (their positions are in the frame's final pose): the corner dot
     * first, then the tick numbers */
    tl.to([anchorDot, anchorLbl], { attr: { opacity: 1 }, duration: 0.3 }, at + 0.75);
    tl.to(tick1, { attr: { opacity: 0.85 }, duration: 0.35, stagger: 0.02 }, at + 0.9);
    tl.to(tick2, { attr: { opacity: 0.85 }, duration: 0.35, stagger: 0.02 }, at + 0.95);
    tl.addLabel('s1', tl.duration());

    /* s2 — quantization: bounds snap OUTWARD onto the skewed cells */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    /* quiet the tight fit so the blue quantized fit is the loud one */
    tl.to(ghostParas, { attr: { stroke: FAINT }, duration: 0.5, ease: 'power1.inOut' }, at);
    CHILD.forEach(function (c, i) {
      var w = at + 0.3 + i * 0.045;
      tl.to(quantParas[i], { attr: { opacity: 1 }, duration: 0.25 }, w);
      tl.to(quantParas[i], {
        attr: { points: pts2str(c.quant) },
        duration: 0.6, ease: 'power2.inOut'
      }, w + 0.1);
    });
    tl.addLabel('s2', tl.duration());

    /* s3 — closer: grid falls quiet, 8 tight quantized shared-basis
     * bounds remain; the node + its bounds go blue (one stored frame) */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(skewLines1.concat(skewLines2), { attr: { opacity: 0.18 }, duration: 0.5 }, at);
    tl.to(tick1.concat(tick2), { attr: { opacity: 0.35 }, duration: 0.5 }, at);
    tl.to(ghostParas, { attr: { opacity: 0.55 }, duration: 0.4 }, at);
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
    project: project,
    solveCorner: solveCorner,
    exactBox: exactBox,
    slabExtents: slabExtents,
    slabCorners: slabCorners,
    quantizeSlab: quantizeSlab,
    containsSlab: containsSlab,
    childSlabs: childSlabs,
    pts2str: pts2str,
    GRIDSPEC: GRIDSPEC,
    FRAME_EXT: FRAME_EXT,
    FRAME_CORNERS: FRAME_CORNERS,
    P_PTS: P_PTS,
    FRAME_PTS: FRAME_PTS,
    chips: {
      TXT: CHIP_TXT, X: CHIP_X, W: CHIP_W, Y: CHIP_Y, H: CHIP_H,
      ARROW_X: CHIP_ARROW_X, STATE: CHIP_STATE, STYLE: CHIP_STYLE
    },
    N1: N1, N2: N2, E1: E1, E2: E2,
    GLYPH_DEG: GLYPH_DEG,
    CHILD_TRIS: CHILD_TRIS,
    WIDE: WIDE,
    P: P, CELLS: CELLS,
    CAPTIONS: CAPTIONS,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.widenode = animator;
})();
