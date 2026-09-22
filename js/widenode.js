/* Wide-node quantization animator — paper Sec. 3.3, second half.
 *
 * The conversion story (independent bases -> one shared basis) now lives
 * one slide earlier (#slide-sharedbasis). This slide opens EXACTLY where
 * that one settled: 8 children as tight shared-basis parallelogram SOBBs,
 * and focuses purely on quantization of the skewed space.
 *
 * s1: hand-off — the wide node with its 8 child SOBBs already on the
 *     shared basis (frame normals n1=100° teal, n2=160° amber), tight
 * s2: the skewed slab grid appears — two wire families of parallel slab
 *     lines tile the node bounds (the shared basis makes ONE grid serve
 *     the whole node)
 * s3: quantization — every bound snaps OUTWARD onto the skewed cells,
 *     conservative by construction (slab-space floor/ceil)
 * s4: closer — the grid falls quiet; 8 tight quantized shared-basis
 *     bounds remain: this is what the shared basis enables
 *
 * Children, bounds and quantized results are ALL parallelograms on the
 * shared frame — no axis-aligned rects anywhere in the quantization story.
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
      FAINT = D.FAINT, LIGHT = D.LIGHT, TEAL = D.TEAL, AMBER = D.AMBER;

  function rad(d) { return d * Math.PI / 180; }

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ====================
   * NOTE: WIDE strip / P panel / CHILD_TRIS / slab frame are numerically
   * identical to js/sharedbasis.js — the settle state of that slide is the
   * entry state of this one (hand-off continuity), so the constants are
   * duplicated on purpose. */

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

  /* 8 child triangles inside P — sized ~80x75 so a ~10-cell skewed grid
   * reads as *refining* each bound, not swallowing it; positioned with
   * margin so snapped parallelograms stay inside the node bounds */
  var CHILD_TRIS = [
    [[604, 168], [680, 158], [642, 234]],
    [[710, 170], [784, 162], [750, 238]],
    [[812, 166], [888, 158], [854, 232]],
    [[892, 180], [960, 174], [930, 240]],
    [[600, 330], [676, 320], [640, 390]],
    [[706, 328], [782, 318], [746, 388]],
    [[814, 332], [890, 324], [856, 394]],
    [[898, 326], [966, 318], [936, 386]]
  ];

  /* shared slab frame — the deck's SOBB normal pair (100° teal / 160°
   * amber in kdopfan + sobbmorph). Grid line directions are the perps.
   * Children arrive already on this basis (settled one slide earlier). */
  var N1 = [Math.cos(rad(100)), Math.sin(rad(100))];
  var N2 = [Math.cos(rad(160)), Math.sin(rad(160))];
  var E1 = [N1[1], -N1[0]];
  var E2 = [N2[1], -N2[0]];
  var CELLS = 10;               // skewed grid cells per family (11 wires each)
  var GLYPH_DEG = 10;           // slot glyphs sit on the shared basis

  var CAPTIONS = [
    'The shared basis is in — now quantize the wide node in its skewed space.',
    'Hand-off from the shared-basis stage: 8 children arrive as tight shared-basis SOBBs.',
    'One skewed slab grid per wide node — slab normals n1 (teal, 100°) and n2 (amber, 160°).',
    'Quantize: every bound snaps OUTWARD onto the skewed cells — conservative, never inward.',
    'Eight tight quantized bounds on one stored frame — this is what the shared basis enables.'
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

  /* skewed grid spec: line-family positions along n1/n2 covering P's
   * slab projection range in CELLS equal cells */
  var GRIDSPEC = (function () {
    var pc = boxCorners(P);
    var r1 = project(pc, N1), r2 = project(pc, N2);
    return {
      o1: r1[0], s1: (r1[1] - r1[0]) / CELLS,
      o2: r2[0], s2: (r2[1] - r2[0]) / CELLS
    };
  })();

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

  /* Liang–Barsky clip of a segment against P — skewed grid lines enter
   * as long chords and get clipped to the node-bounds window */
  function clipSegRect(p0, p1, r) {
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var t0 = 0, t1 = 1;
    var pp = [-dx, dx, -dy, dy];
    var qq = [p0[0] - r.x, r.x + r.w - p0[0], p0[1] - r.y, r.y + r.h - p0[1]];
    for (var i = 0; i < 4; i++) {
      var p = pp[i], q = qq[i];
      if (p === 0) { if (q < 0) return null; continue; }
      var t = q / p;
      if (p < 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; }
    }
    if (t0 > t1) return null;
    return [
      [p0[0] + t0 * dx, p0[1] + t0 * dy],
      [p0[0] + t1 * dx, p0[1] + t1 * dy]
    ];
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var wideRect, wideSlots = [], slotDots = [], slotGlyphs = [];
  var miniCapEl, connLine, connHead, legendG, quantCapEl;
  var parentRect, skewLines1 = [], skewLines2 = [];
  var childTris = [], ghostParas = [], quantParas = [];
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

    /* ---- left: the wide node (strip + slots + shared-basis glyphs) ---- */
    wideRect = el('rect', {
      x: WIDE.x, y: WIDE.y, width: WIDE.w, height: WIDE.h, rx: 8,
      fill: '#ffffff', stroke: INK, 'stroke-width': 1.8, opacity: 0
    }, svg);
    for (var k = 1; k < SLOT_N; k++) {
      wideSlots.push(el('line', {
        x1: WIDE.x + (WIDE.w / SLOT_N) * k, y1: WIDE.y + 7,
        x2: WIDE.x + (WIDE.w / SLOT_N) * k, y2: WIDE.y + WIDE.h - 7,
        stroke: EDGE, 'stroke-width': 1.2, opacity: 0
      }, svg));
    }
    var cy = WIDE.y + WIDE.h / 2;
    for (var i = 0; i < SLOT_N; i++) {
      var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
      slotDots.push(el('circle', {
        cx: gx, cy: cy, r: 2.2, fill: INK, opacity: 0
      }, svg));
      var g = el('g', { transform: glyphTransform(i, GLYPH_DEG), opacity: 0 }, svg);
      el('polygon', {
        points: MINI_PTS,
        fill: 'none', stroke: INK, 'stroke-width': 1.3,
        'stroke-linejoin': 'round'
      }, g);
      slotGlyphs.push(g);
    }
    miniCapEl = text('one wide node · 8 child SOBBs', {
      x: WIDE.x + WIDE.w / 2, y: WIDE.y + WIDE.h + 34,
      'text-anchor': 'middle', 'font-size': 15, fill: FAINT, opacity: 0
    }, svg);

    /* connector: wide node → its bounds box */
    connLine = el('line', {
      x1: WIDE.x + WIDE.w + 14, y1: cy, x2: P.x - 22, y2: cy,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4', opacity: 0
    }, svg);
    connHead = el('polygon', {
      points: (P.x - 24) + ',' + (cy - 5) + ' ' + (P.x - 24) + ',' + (cy + 5) + ' ' + (P.x - 14) + ',' + cy,
      fill: EDGE, opacity: 0
    }, svg);

    /* ---- right: node bounds + grids ---- */
    /* grid wires are genuinely oblique to the axis-aligned frame and are
     * clipped to the node bounds; children/parallelograms are positioned
     * with margin so the clip never bites them */
    var defs = el('defs', {}, svg);
    var clip = el('clipPath', { id: 'wide-frame-clip' }, defs);
    el('rect', { x: P.x, y: P.y, width: P.w, height: P.h }, clip);
    var stageG = el('g', { 'clip-path': 'url(#wide-frame-clip)' }, svg);

    parentRect = el('rect', {
      x: P.x, y: P.y, width: P.w, height: P.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.8, opacity: 0
    }, svg);

    /* skewed slab grid (s2): family 1 along E1 (normal n1, teal),
     * family 2 along E2 (normal n2, amber), wire-thin, clipped to P */
    for (var k1 = 0; k1 <= CELLS; k1++) {
      var m1 = GRIDSPEC.o1 + GRIDSPEC.s1 * k1;
      var a1 = [N1[0] * m1 - 1500 * E1[0], N1[1] * m1 - 1500 * E1[1]];
      var b1 = [N1[0] * m1 + 1500 * E1[0], N1[1] * m1 + 1500 * E1[1]];
      var s1 = clipSegRect(a1, b1, P);
      if (!s1) continue;
      skewLines1.push(el('line', {
        x1: s1[0][0], y1: s1[0][1], x2: s1[1][0], y2: s1[1][1],
        stroke: TEAL, 'stroke-width': 1.3, opacity: 0
      }, stageG));
    }
    for (var k2 = 0; k2 <= CELLS; k2++) {
      var m2 = GRIDSPEC.o2 + GRIDSPEC.s2 * k2;
      var a2 = [N2[0] * m2 - 1500 * E2[0], N2[1] * m2 - 1500 * E2[1]];
      var b2 = [N2[0] * m2 + 1500 * E2[0], N2[1] * m2 + 1500 * E2[1]];
      var s2 = clipSegRect(a2, b2, P);
      if (!s2) continue;
      skewLines2.push(el('line', {
        x1: s2[0][0], y1: s2[0][1], x2: s2[1][0], y2: s2[1][1],
        stroke: AMBER, 'stroke-width': 1.3, opacity: 0
      }, stageG));
    }

    /* children: tris + tight shared-basis parallelograms + blue
     * quantized parallelograms (start superimposed on tight, snap out) */
    CHILD.forEach(function (c, i) {
      childTris.push(el('polygon', {
        points: pts2str(CHILD_TRIS[i]),
        fill: LIGHT, stroke: INK, 'stroke-width': 1.2,
        'stroke-linejoin': 'round', opacity: 0
      }, stageG));
      ghostParas.push(el('polygon', {
        points: pts2str(c.tight),
        fill: 'none', stroke: INK, 'stroke-width': 1.4,
        'stroke-linejoin': 'round', opacity: 0
      }, stageG));
      quantParas.push(el('polygon', {
        points: pts2str(c.tight),
        fill: 'none', stroke: BLUE, 'stroke-width': 2.4,
        'stroke-linejoin': 'round', opacity: 0
      }, stageG));
    });

    /* slab-frame legend (s2): tie the wire colors to the deck's slab ids */
    legendG = el('g', { opacity: 0 }, svg);
    text('shared slab frame', {
      x: 130, y: 356, 'font-size': 12.5, fill: FAINT
    }, legendG);
    el('line', {
      x1: 130, y1: 392, x2: 130 + E1[0] * 62, y2: 392 + E1[1] * 62,
      stroke: TEAL, 'stroke-width': 2.4
    }, legendG);
    text('n1 · 100°', { x: 210, y: 396, 'font-size': 14, fill: TEAL }, legendG);
    el('line', {
      x1: 148, y1: 492, x2: 148 - E2[0] * 52, y2: 492 - E2[1] * 52,
      stroke: AMBER, 'stroke-width': 2.4
    }, legendG);
    text('n2 · 160°', { x: 170, y: 468, 'font-size': 14, fill: AMBER }, legendG);

    /* closer read-out under the panel (s4) */
    quantCapEl = text('8 bounds · one shared frame · snapped outward', {
      x: P.x + P.w / 2, y: P.y + P.h + 34,
      'text-anchor': 'middle', 'font-size': 15, fill: BLUE, opacity: 0
    }, svg);

    captionEl = document.getElementById('wide-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    gsap.killTweensOf(wideRect);
    wideRect.setAttribute('opacity', 0);
    wideRect.setAttribute('stroke', INK);
    wideSlots.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    slotDots.forEach(function (d) {
      gsap.killTweensOf(d);
      d.setAttribute('opacity', 0);
    });
    slotGlyphs.forEach(function (g, i) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
      g.setAttribute('transform', glyphTransform(i, GLYPH_DEG));
    });
    gsap.killTweensOf(miniCapEl);
    miniCapEl.setAttribute('opacity', 0);
    gsap.killTweensOf(connLine);
    connLine.setAttribute('opacity', 0);
    gsap.killTweensOf(connHead);
    connHead.setAttribute('opacity', 0);
    gsap.killTweensOf(parentRect);
    parentRect.setAttribute('opacity', 0);
    parentRect.setAttribute('stroke', INK);
    skewLines1.concat(skewLines2).forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
    });
    CHILD.forEach(function (c, i) {
      gsap.killTweensOf(childTris[i]);
      childTris[i].setAttribute('opacity', 0);
      gsap.killTweensOf(ghostParas[i]);
      ghostParas[i].setAttribute('opacity', 0);
      ghostParas[i].setAttribute('stroke', INK);
      ghostParas[i].setAttribute('points', pts2str(c.tight));
      gsap.killTweensOf(quantParas[i]);
      quantParas[i].setAttribute('opacity', 0);
      quantParas[i].setAttribute('points', pts2str(c.tight));
    });
    gsap.killTweensOf(legendG);
    legendG.setAttribute('opacity', 0);
    gsap.killTweensOf(quantCapEl);
    quantCapEl.setAttribute('opacity', 0);
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 4;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — hand-off: the wide node with 8 tight shared-basis SOBBs,
     * exactly where #slide-sharedbasis settled (same layout constants,
     * same parallelograms, same glyph tilt) */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    tl.to(wideRect, { attr: { opacity: 1 }, duration: 0.35 }, at);
    tl.to(wideSlots, { attr: { opacity: 1 }, duration: 0.3, stagger: 0.02 }, at + 0.15);
    tl.to(slotDots, { attr: { opacity: 1 }, duration: 0.25, stagger: 0.03 }, at + 0.25);
    tl.to(slotGlyphs, { attr: { opacity: 1 }, duration: 0.3, stagger: 0.03 }, at + 0.35);
    tl.to(miniCapEl, { attr: { opacity: 1 }, duration: 0.4 }, at + 0.55);
    tl.to([connLine, connHead], { attr: { opacity: 1 }, duration: 0.35 }, at + 0.55);
    tl.to(parentRect, { attr: { opacity: 1 }, duration: 0.5 }, at + 0.5);
    CHILD.forEach(function (c, i) {
      var w = at + 0.8 + i * 0.05;
      tl.to(childTris[i], { attr: { opacity: 1 }, duration: 0.3 }, w);
      tl.to(ghostParas[i], { attr: { opacity: 1 }, duration: 0.3 }, w);
    });
    tl.addLabel('s1', tl.duration());

    /* s2 — the skewed slab grid: one shared basis → ONE grid per node */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(skewLines1, { attr: { opacity: 0.85 }, duration: 0.45, stagger: 0.03 }, at);
    tl.to(skewLines2, { attr: { opacity: 0.85 }, duration: 0.45, stagger: 0.03 }, at + 0.25);
    tl.to(legendG, { attr: { opacity: 1 }, duration: 0.4 }, at + 0.35);
    tl.addLabel('s2', tl.duration());

    /* s3 — quantization: bounds snap OUTWARD onto the skewed cells */
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
    tl.addLabel('s3', tl.duration());

    /* s4 — closer: grid falls quiet, 8 tight quantized shared-basis
     * bounds remain; the node + its bounds go blue (one stored frame) */
    tl.to({}, { duration: 0.2 }, '>');
    at = tl.duration();
    tl.to(skewLines1.concat(skewLines2), { attr: { opacity: 0.3 }, duration: 0.5 }, at);
    tl.to(ghostParas, { attr: { opacity: 0.55 }, duration: 0.4 }, at);
    tl.to(childTris, { attr: { opacity: 0.75 }, duration: 0.4 }, at);
    tl.to([wideRect, parentRect], { attr: { stroke: BLUE }, duration: 0.5 }, at + 0.25);
    tl.to(quantCapEl, { attr: { opacity: 1 }, duration: 0.45 }, at + 0.45);
    tl.addLabel('s4', tl.duration());
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
