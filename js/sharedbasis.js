/* Shared-basis animator — paper Sec. 3.3, first half.
 *
 * Picks the SOBB BVH₈ pipeline up exactly where pipesobb8 left it (chip
 * row pixel-identical, quantization chip ACTIVE) and presents the shared
 * basis as what it is: a PROPERTY of the wide node, not a pipeline build
 * phase. No chip is inserted — the chip row never changes on this slide.
 * The story is told as an annotation on the node itself.
 *
 * s1: the pipeline so far — chip strip as handed over, and ONE 8-wide
 *     node below (root box + slots + bounds region): the children are
 *     parallelogram SOBBs at independent orientations, big enough to
 *     spill over each other — a tangle of skewed boxes covering the node
 * s2: THE ANNOTATION — a basis callout fades in beside the node: one
 *     shared basis for all 8 children, a property of the wide node
 * s3: THE CONVERSION — all 8 parallelograms re-tilt in one deliberate
 *     sweep onto the shared basis (normals n1=100°/n2=160°, edges
 *     E1=10°/E2=70°); the callout stays up and hands off to the next
 *     slide (skewed quantization), which opens pixel-identical
 *
 * Layout note: WIDE strip / P panel / CHILD_TRIS / slab frame / chip row
 * / basis callout are numerically identical to js/widenode.js — the
 * settle state here IS the entry state there (hand-off continuity),
 * constants duplicated on purpose.
 * All GSAP-animated paint props are SVG ATTRIBUTES, never CSS.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE,
      FAINT = D.FAINT;

  function rad(d) { return d * Math.PI / 180; }

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ==================== */

  /* stage chips — the SOBB BVH₈ pipeline slide's end-state strip (first
   * three done, quantization ACTIVE, exactly as pipesobb8 left it).
   * STATIC on this slide: the shared basis is a property of the wide
   * node, not a pipeline phase, so the row never re-spaces and no chip
   * is inserted. Geometry mirrors js/pipeline.js CFG_SOBB8 (hand-off)
   * and js/widenode.js (settle = its entry). */
  var CHIP_TXT = ['AABB BVH₂', 'AABB BVH₈', 'SOBB BVH₈', 'quantization'];
  var CHIP_W = [168, 168, 168, 190];
  var CHIP_H = 44, CHIP_Y = 14;
  var CHIP_X = [144, 358, 572, 786];
  var CHIP_ARROW_X = [335, 549, 763];
  var CHIP_STATE = ['done', 'done', 'done', 'active'];

  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  /* the wide node (mirror of widenode.js) */
  var WIDE = { x: 80, y: 130, w: 360, h: 64 };
  var SLOT_N = 8;

  /* mini glyph: unit parallelogram with edge directions 0°/60°; shared
   * basis = group rotated to 10° (edges land on E1=10° / E2=70°) */
  var MINI_PTS = '16,5.2 -10,5.2 -16,-5.2 10,-5.2';
  var GLYPH_DEG = 10;

  /* right: node bounds region the children spill over */
  var P = { x: 560, y: 90, w: 440, h: 380 };
  var BOX_PAD = 4;

  /* 8 child source triangles inside P — geometry only (tight-box
   * derivation), never rendered; identical to widenode.js so the settled
   * parallelograms this slide ends on are the ones the next slide opens
   * with. Child 4 (the bottom-left box) starts at the grid anchor of the
   * next slide's frame — its tight corner sits ~3px inside the anchor,
   * so the snapped corner lands exactly on it (see widenode.js) */
  var CHILD_TRIS = [
    [[604, 168], [680, 158], [642, 234]],
    [[710, 170], [784, 162], [750, 238]],
    [[812, 166], [888, 158], [854, 232]],
    [[878, 180], [946, 174], [916, 240]],
    [[595.6, 337], [671.6, 327], [635.6, 397]],
    [[706, 328], [782, 318], [746, 388]],
    [[814, 332], [890, 324], [856, 394]],
    [[884, 326], [952, 318], [922, 386]]
  ];

  /* shared slab frame (deck's SOBB pair: normals 100° / 160°) */
  var N1 = [Math.cos(rad(100)), Math.sin(rad(100))];
  var N2 = [Math.cos(rad(160)), Math.sin(rad(160))];

  /* each child's independent basis (deg) + oversize factor — visually
   * noisy on purpose: the tangle reads as 8 private orientations whose
   * bounds are too big to pack */
  var FAIL_ROT = [24, -16, 30, -12, 20, -28, 14, -22];
  var BIG_SCALE = [1.30, 1.16, 1.34, 1.22, 1.26, 1.14, 1.32, 1.20];

  /* basis callout (s2): the shared basis presented as a PROPERTY of the
   * wide node — an enlarged basis glyph (the slot mini parallelogram at
   * 3x, on the shared tilt) plus two lines of annotation, parked in the
   * empty lower-left region. Identical geometry in js/widenode.js. */
  var CALLOUT = { x: 250, y: 296 };
  var CALLOUT_PTS = '48,15.6 -30,15.6 -48,-15.6 30,-15.6';  // MINI_PTS × 3

  var CAPTIONS = [
    'Quantization: the eight child bounds snap onto the local grid.',
    'Eight children, eight independent SOBB bases — awkward to quantize.',
    'The wide node carries ONE shared basis — chosen once for all eight children.',
    'All eight children re-tilt onto the shared basis (DOBB-style, Kern et al. 2025).',
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

  /* per-child geometry: tight shared-basis parallelogram, and the BIG
   * independently-oriented version (tight corners overscaled about the
   * center, then rotated onto the child's private basis) */
  function childGeom() {
    return CHILD_TRIS.map(function (tri, i) {
      var eb = exactBox(tri);
      var cx = eb.x + eb.w / 2, cy = eb.y + eb.h / 2;
      var tight = slabCorners(slabExtents(boxCorners(eb)));
      var r = rad(FAIL_ROT[i]);
      var cos = Math.cos(r), sin = Math.sin(r), s = BIG_SCALE[i];
      var big = tight.map(function (p) {
        var dx = (p[0] - cx) * s, dy = (p[1] - cy) * s;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
      });
      return { exact: eb, cx: cx, cy: cy, tight: tight, big: big };
    });
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var chipRects = [], chipTexts = [];
  var wideRect, wideSlots = [], slotDots = [], slotGlyphs = [];
  var calloutG;
  var miniCapEl, connLine, connHead;
  var parentRect;
  var paras = [];
  var CHILD = null;
  var captionEl;
  var tl = null;

  function glyphTransform(i, deg) {
    var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
    var gy = WIDE.y + WIDE.h / 2 - 14;
    return 'translate(' + gx + ' ' + gy + ') rotate(' + deg + ')';
  }

  function build() {
    CHILD = childGeom();

    var host = document.getElementById('sb-canvas');
    svg = el('svg', { viewBox: '0 0 1120 560', width: '100%', height: '100%' }, host);
    var i;

    /* stage chips: pipesobb8's exact hand-off row, static states */
    for (i = 0; i < CHIP_TXT.length; i++) {
      var s = CHIP_STYLE[CHIP_STATE[i]];
      chipRects.push(el('rect', {
        'class': 'chip-rect',
        x: CHIP_X[i], y: CHIP_Y, width: CHIP_W[i], height: CHIP_H, rx: 6,
        'stroke-width': 1.4, fill: s.fill, stroke: s.stroke
      }, svg));
      chipTexts.push(text(CHIP_TXT[i], {
        'class': 'chip-text',
        x: CHIP_X[i] + CHIP_W[i] / 2, y: CHIP_Y + 27,
        'text-anchor': 'middle', 'font-size': 25, fill: s.txt
      }, svg));
    }
    CHIP_ARROW_X.forEach(function (x) {
      text('→', {
        'class': 'chip-arrow',
        x: x, y: CHIP_Y + 27, 'text-anchor': 'middle', 'font-size': 26, fill: FAINT
      }, svg);
    });

    /* ---- the wide node (identical layout to widenode.js) ---- */
    wideRect = el('rect', {
      x: WIDE.x, y: WIDE.y, width: WIDE.w, height: WIDE.h, rx: 8,
      fill: '#ffffff', stroke: INK, 'stroke-width': 1.8
    }, svg);
    for (i = 1; i < SLOT_N; i++) {
      wideSlots.push(el('line', {
        x1: WIDE.x + (WIDE.w / SLOT_N) * i, y1: WIDE.y + 7,
        x2: WIDE.x + (WIDE.w / SLOT_N) * i, y2: WIDE.y + WIDE.h - 7,
        stroke: EDGE, 'stroke-width': 1.2
      }, svg));
    }
    var cy = WIDE.y + WIDE.h / 2;
    for (i = 0; i < SLOT_N; i++) {
      var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
      slotDots.push(el('circle', { cx: gx, cy: cy, r: 2.2, fill: INK }, svg));
      var sg = el('g', { transform: glyphTransform(i, FAIL_ROT[i]), opacity: 0 }, svg);
      el('polygon', {
        points: MINI_PTS,
        fill: 'none', stroke: INK, 'stroke-width': 1.3,
        'stroke-linejoin': 'round'
      }, sg);
      slotGlyphs.push(sg);
    }
    miniCapEl = text('one wide node · 8 child SOBBs', {
      x: WIDE.x + WIDE.w / 2, y: WIDE.y + WIDE.h + 34,
      'text-anchor': 'middle', 'font-size': 25, fill: FAINT
    }, svg);

    /* basis callout (s2): the shared basis as a node PROPERTY — an
     * enlarged basis glyph on the shared tilt + annotation, in the
     * empty lower-left region. Hidden until s2; identical geometry in
     * widenode.js, which opens with it and retires it as the skewed
     * grid (the basis made visible) arrives. */
    calloutG = el('g', { opacity: 0 }, svg);
    var calloutGlyph = el('g', {
      transform: 'translate(' + CALLOUT.x + ' ' + CALLOUT.y + ') rotate(' + GLYPH_DEG + ')'
    }, calloutG);
    el('polygon', {
      points: CALLOUT_PTS,
      fill: 'none', stroke: INK, 'stroke-width': 1.6,
      'stroke-linejoin': 'round'
    }, calloutGlyph);
    text('one shared basis', {
      x: CALLOUT.x, y: CALLOUT.y + 62,
      'text-anchor': 'middle', 'font-size': 25, 'font-weight': 600, fill: INK
    }, calloutG);
    text('a property of the wide node', {
      x: CALLOUT.x, y: CALLOUT.y + 94,
      'text-anchor': 'middle', 'font-size': 20, fill: FAINT
    }, calloutG);

    /* connector: wide node → its bounds region */
    connLine = el('line', {
      x1: WIDE.x + WIDE.w + 14, y1: cy, x2: P.x - 22, y2: cy,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
    }, svg);
    connHead = el('polygon', {
      points: (P.x - 24) + ',' + (cy - 5) + ' ' + (P.x - 24) + ',' + (cy + 5) + ' ' + (P.x - 14) + ',' + cy,
      fill: EDGE
    }, svg);

    /* node bounds region (axis-aligned extent; children spill over it) */
    parentRect = el('rect', {
      x: P.x, y: P.y, width: P.w, height: P.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.8
    }, svg);

    /* children: fixed geometry, parallelogram SOBBs on private bases —
     * oversized on purpose so they overlap into a tangle covering the
     * whole node region (deliberately NOT clipped: spilling past the
     * axis-aligned extent is the point). Source triangles are not drawn —
     * the settled end state (widenode's entry frame) is bounds only. */
    CHILD.forEach(function (c, i) {
      paras.push(el('polygon', {
        points: pts2str(c.big),
        fill: 'none', stroke: INK, 'stroke-width': 2.4,
        'stroke-linejoin': 'round', opacity: 0
      }, svg));
    });

    captionEl = document.getElementById('sb-caption');
    built = true;
  }

  /* ==================== reset ====================
   * Base state = the SOBB BVH₈ pipeline slide's END state, pixel-for-pixel:
   * first three chips DONE, quantization ACTIVE + the wide node scaffold;
   * tangle/glyphs/insert hidden. */

  function resetDom() {
    chipRects.forEach(function (r, i) {
      var s = CHIP_STYLE[CHIP_STATE[i]];
      r.setAttribute('fill', s.fill);
      r.setAttribute('stroke', s.stroke);
    });
    chipTexts.forEach(function (t, i) {
      t.setAttribute('fill', CHIP_STYLE[CHIP_STATE[i]].txt);
    });
    gsap.killTweensOf(calloutG);
    calloutG.setAttribute('opacity', 0);
    slotGlyphs.forEach(function (g, k) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
      g.setAttribute('transform', glyphTransform(k, FAIL_ROT[k]));
    });
    CHILD.forEach(function (c, k) {
      gsap.killTweensOf(paras[k]);
      paras[k].setAttribute('opacity', 0);
      paras[k].setAttribute('points', pts2str(c.big));
    });
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 3;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — return to the pipeline: one wide node, whose children are
     * parallelogram SOBBs on 8 independent bases, oversized and
     * overlapping — the tangle the transform left behind */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    tl.to(slotGlyphs, { attr: { opacity: 1 }, duration: 0.3, stagger: 0.03 }, at + 0.2);
    CHILD.forEach(function (c, i) {
      var w = at + 0.4 + i * 0.06;
      tl.to(paras[i], { attr: { opacity: 1 }, duration: 0.35 }, w + 0.1);
    });
    tl.addLabel('s1', tl.duration());

    /* s2 — THE ANNOTATION: the basis callout fades in beside the node.
     * The shared basis is framed as a property the wide node carries,
     * not a stage the pipeline runs — the chip row never moves. */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.to(calloutG, {
      attr: { opacity: 1 }, duration: 0.55, ease: 'power1.inOut'
    }, at + 0.15);
    tl.addLabel('s2', tl.duration());

    /* s3 — THE CONVERSION: one deliberate sweep — every parallelogram
     * re-tilts from its private basis onto the ONE shared basis */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    CHILD.forEach(function (c, i) {
      var w = at + 0.15 + i * 0.045;
      tl.to(paras[i], {
        attr: { points: pts2str(c.tight) },
        duration: 1.0, ease: 'power2.inOut'
      }, w);
      tl.to(slotGlyphs[i], {
        attr: { transform: glyphTransform(i, GLYPH_DEG) },
        duration: 1.0, ease: 'power2.inOut'
      }, w);
    });
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
      /* NO entrance fade/rise: this slide opens pixel-identical to
       * pipesobb8's settled frame (hard-cut hand-off) — a fromTo here
       * would read as a bounce on identical content. */
      gsap.set(svg, { opacity: 1, y: 0 });
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
    childGeom: childGeom,
    pts2str: pts2str,
    chips: {
      TXT: CHIP_TXT, W: CHIP_W, Y: CHIP_Y, H: CHIP_H,
      X: CHIP_X, ARROW_X: CHIP_ARROW_X, STATE: CHIP_STATE,
      STYLE: CHIP_STYLE
    },
    CALLOUT: CALLOUT, CALLOUT_PTS: CALLOUT_PTS,
    N1: N1, N2: N2,
    GLYPH_DEG: GLYPH_DEG,
    FAIL_ROT: FAIL_ROT, BIG_SCALE: BIG_SCALE,
    CHILD_TRIS: CHILD_TRIS,
    WIDE: WIDE, P: P,
    CAPTIONS: CAPTIONS,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sharedbasis = animator;
})();
