/* SOBB basis animator — paper Sec. 3.3: HOW the shared basis is built.
 *
 * Follows slide-quant ("Quantization demands a shared basis"); explains
 * the paper's three candidate strategies for picking the one basis:
 *
 *   f0/base: one wide node, 8 children — each with its own k-DOP
 *            (hexagons, matching the pipeline slide's proxies). No fitting
 *            yet — the question: one basis must fit all eight.
 *   s1 SUM:  each candidate basis is applied to ALL 8 children at once —
 *            all eight parallelograms simultaneously, 3 candidates
 *            (corner-morph idiom from kdopfan), Σ area ticks down.
 *            Exact, but 3×8 fits — slow.
 *   s2 UNION: the 8 hexagons merge into ONE union k-DOP (per-direction
 *            slab extents merged — visibly fatter than any child). One
 *            fit on the union (short candidate morphs on the right stage),
 *            the basis flows back down: 8 parallelograms on the union's
 *            basis — cheap, but loose.
 *   s3 AVG:  the averaged k-DOP (per-slab mean of the children's extents —
 *            slimmer than the union). One fit, back down: 8 parallelograms
 *            on the deck's shared frame n1=100°/n2=160° (kdopfan/widenode
 *            frame). Marked ✓ — our choice. Three-way summary appears.
 *   s4 closer: avg locks (parallelograms thicken, ✓ summary stays),
 *            slot glyphs tilt onto the shared frame — hand-off to results.
 *
 * All SOBB parallelograms are genuine 2D SOBBs: intersection of two slab
 * pairs, corners sorted CCW, kdopfan-style morph-safe. GSAP-animated
 * paint props are SVG attributes only. Pure math exported via _test.
 * Host: #sobb-canvas + #sobb-caption. Fragments: 5 (f0 + s1..s4).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE,
      FAINT = D.FAINT, LIGHT = D.LIGHT;

  function rad(d) { return d * Math.PI / 180; }

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ==================== */

  /* eight children, two rows — hexagon k-DOPs (centre, radius, rotation),
   * positioned so tight parallelograms never touch; region boxed by FRAME */
  var CHILDREN = [
    { c: [190, 156], r: 46, rot: 0 },
    { c: [345, 162], r: 52, rot: 8 },
    { c: [500, 152], r: 43, rot: -9 },
    { c: [655, 160], r: 49, rot: 5 },
    { c: [215, 322], r: 50, rot: -6 },
    { c: [370, 328], r: 44, rot: 12 },
    { c: [525, 320], r: 52, rot: -4 },
    { c: [680, 326], r: 45, rot: 10 }
  ];
  var CENTROID = [435, 242];         // mean of the child centres
  var FRAME = { x: 116, y: 76, w: 660, h: 336 };   // the node's extent
  var WIDE = { x: 56, y: 442, w: 244, h: 56 };     // wide node strip
  var SLOT_N = 8;

  /* right stage: the single proxy (union / avg) + its candidate fit */
  var STAGE = [930, 300];

  /* deck-wide shared frame (identical numbers to widenode/sharedbasis/
   * kdopfan: normals n1=100° teal pair, n2=160° amber pair) */
  var N1 = [Math.cos(rad(100)), Math.sin(rad(100))];
  var N2 = [Math.cos(rad(160)), Math.sin(rad(160))];
  var GLYPH_DEG = 10;                // slot glyphs settle on the frame
  var MINI_PTS = '16,5.2 -10,5.2 -16,-5.2 10,-5.2';

  /* k-DOP slab normal directions: 6-DOP = pairs along 0°/60°/120° */
  var HEX_DIRS = [0, 60, 120].map(function (a) {
    return [Math.cos(rad(a)), Math.sin(rad(a))];
  });

  var PAD_TIGHT = 3;                 // world padding for fitted parallelograms

  /* candidate bases [n1°, n2°] — sorted by cost at build (descending);
   * SUM and AVG end on the shared frame [100,160]; UNION ends one notch
   * off ([85,145] wins on the fat union — the union pays slack) */
  var SUM_BASES_RAW = [[10, 70], [45, 105], [100, 160]];
  var UNION_BASES_RAW = [[20, 80], [35, 95], [85, 145]];
  var AVG_BASES_RAW = [[25, 85], [90, 150], [100, 160]];

  var CAPTIONS = [
    'One wide node — its eight children each carry a k-DOP; a single basis must fit all eight.',
    'SUM: score every candidate basis on all eight children at once — exact, but 3 × 8 fits are slow.',
    'UNION: merge the eight k-DOPs into one, fit a single proxy — cheap, but the union is loose.',
    'AVG: average the slab extents, fit once — cheap and tight enough. Our choice.',
    'Locked: one averaged-fit basis, eight tight shared-basis SOBBs. On to the numbers.'
  ];

  /* ==================== pure math ==================== */

  function hexagon(c, r, rotDeg) {
    var out = [];
    for (var i = 0; i < 6; i++) {
      var a = (rotDeg + i * 60) * Math.PI / 180;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return out;
  }

  function project(verts, n) {
    var mn = Infinity, mx = -Infinity;
    verts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    });
    return [mn, mx];
  }

  function solveCorner(n1, n2, a, b) {
    var det = n1[0] * n2[1] - n1[1] * n2[0];
    return [
      (a * n2[1] - n1[1] * b) / det,
      (n1[0] * b - a * n2[0]) / det
    ];
  }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }

  /* CCW order about the centroid — kdopfan's morph-safe idiom */
  function sortCorners(poly) {
    var c = centroid(poly);
    return poly.slice().sort(function (p, q) {
      return Math.atan2(p[1] - c[1], p[0] - c[0]) -
             Math.atan2(q[1] - c[1], q[0] - c[0]);
    });
  }

  function polyArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  /* 2D SOBB = intersection of slab pairs (n1,[a1,b1]) × (n2,[a2,b2]),
   * fitted to verts, sorted CCW for corner-morph safety */
  function fitSkew(verts, a1deg, a2deg, pad) {
    var n1 = [Math.cos(rad(a1deg)), Math.sin(rad(a1deg))];
    var n2 = [Math.cos(rad(a2deg)), Math.sin(rad(a2deg))];
    var p1 = project(verts, n1), p2 = project(verts, n2);
    var a1 = p1[0] - pad, b1 = p1[1] + pad;
    var a2 = p2[0] - pad, b2 = p2[1] + pad;
    return sortCorners([
      solveCorner(n1, n2, a1, a2),
      solveCorner(n1, n2, b1, a2),
      solveCorner(n1, n2, b1, b2),
      solveCorner(n1, n2, a1, b2)
    ]);
  }

  /* intersection of 3 slab pairs (exts[i] = [lo,hi] along HEX_DIRS[i]):
   * candidate corners = all pairwise boundary intersections, keep the
   * ones inside every slab, dedupe, sort — a (≤)6-gon */
  function kdopFromExtents(exts) {
    var dirs = HEX_DIRS;
    var lines = [];
    for (var i = 0; i < 3; i++) {
      lines.push({ n: dirs[i], m: exts[i][0] });
      lines.push({ n: dirs[i], m: exts[i][1] });
    }
    var pts = [];
    for (var a = 0; a < 6; a++) {
      for (var b = a + 1; b < 6; b++) {
        if (lines[a].n === lines[b].n) continue;
        var p = solveCorner(lines[a].n, lines[b].n, lines[a].m, lines[b].m);
        var inside = true;
        for (var k = 0; k < 3 && inside; k++) {
          var d = p[0] * dirs[k][0] + p[1] * dirs[k][1];
          if (d < exts[k][0] - 1e-6 || d > exts[k][1] + 1e-6) inside = false;
        }
        if (inside) pts.push(p);
      }
    }
    /* dedupe */
    var tri = [];
    pts.forEach(function (p) {
      var dup = tri.some(function (q) {
        return Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01;
      });
      if (!dup) tri.push(p);
    });
    return sortCorners(tri);
  }

  function flatVerts(sets) {
    var out = [];
    sets.forEach(function (s) { out = out.concat(s); });
    return out;
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* ==================== derived geometry (deterministic) ==================== */

  var HEXVERTS = CHILDREN.map(function (ch) {
    return hexagon(ch.c, ch.r, ch.rot);
  });
  var ALL_VERTS = flatVerts(HEXVERTS);

  /* per-child slab extents along the k-DOP directions */
  var CHILD_EXTS = HEXVERTS.map(function (verts) {
    return HEX_DIRS.map(function (n) { return project(verts, n); });
  });

  /* UNION: per-direction min/max over all children (⊇ every child) */
  var UNION_EXTS = HEX_DIRS.map(function (n, k) {
    var lo = Infinity, hi = -Infinity;
    CHILD_EXTS.forEach(function (e) {
      if (e[k][0] < lo) lo = e[k][0];
      if (e[k][1] > hi) hi = e[k][1];
    });
    return [lo, hi];
  });
  var UNION_VERTS = kdopFromExtents(UNION_EXTS);

  /* AVG: per-direction mean of the child extents (inside [min,max]) */
  var AVG_EXTS = HEX_DIRS.map(function (n, k) {
    var lo = 0, hi = 0;
    CHILD_EXTS.forEach(function (e) { lo += e[k][0]; hi += e[k][1]; });
    return [lo / 8, hi / 8];
  });
  var AVG_VERTS = kdopFromExtents(AVG_EXTS);

  /* right-stage mapping: world → stage, scale fitted to the union fit */
  function toStageRaw(p, s) {
    return [
      STAGE[0] + s * (p[0] - CENTROID[0]),
      STAGE[1] + s * (p[1] - CENTROID[1])
    ];
  }
  var PROXY_SCALE = (function () {
    var fitU = fitSkew(UNION_VERTS, 85, 145, PAD_TIGHT);
    var md = 0, nd = 0;
    UNION_VERTS.concat(fitU).forEach(function (p) {
      md = Math.max(md, Math.abs(p[0] - CENTROID[0]));
      nd = Math.max(nd, Math.abs(p[1] - CENTROID[1]));
    });
    return Math.round(Math.min(0.62, 178 / md, 148 / nd) * 1000) / 1000;
  })();
  function toStage(p) { return toStageRaw(p, PROXY_SCALE); }

  /* candidate helper: sort basis list by cost descending, keep corners */
  function buildCandidates(rawBases, vertsFn) {
    return rawBases.map(function (b) {
      var cornersList = vertsFn(b);
      var cost = cornersList.reduce(function (s, cs) {
        return s + polyArea(cs);
      }, 0);
      return { basis: b, cornersList: cornersList, cost: cost };
    }).sort(function (a, b) { return b.cost - a.cost; });
  }

  /* SUM: candidates fitted on EVERY child — corners per child per cand */
  var SUM_CANDS = buildCandidates(SUM_BASES_RAW, function (b) {
    return HEXVERTS.map(function (verts) {
      return fitSkew(verts, b[0], b[1], PAD_TIGHT);
    });
  });

  /* UNION / AVG: candidates fitted on the single proxy (staged coords) */
  function proxyCandidates(rawBases, proxyVerts) {
    return rawBases.map(function (b) {
      var corners = fitSkew(proxyVerts, b[0], b[1], PAD_TIGHT);
      return {
        basis: b,
        corners: corners.map(toStage),
        cost: polyArea(corners)
      };
    }).sort(function (a, b) { return b.cost - a.cost; });
  }
  var UNION_CANDS = proxyCandidates(UNION_BASES_RAW, UNION_VERTS);
  var AVG_CANDS = proxyCandidates(AVG_BASES_RAW, AVG_VERTS);

  /* settle parallelograms: SUM/AVG land on the shared frame, UNION on
   * its own winner — exposed for tests */
  var WIN_BASIS = [100, 160];
  var FINAL_PARAS = HEXVERTS.map(function (verts) {
    return fitSkew(verts, WIN_BASIS[0], WIN_BASIS[1], PAD_TIGHT);
  });
  var UNION_PARAS = HEXVERTS.map(function (verts) {
    var w = UNION_CANDS[UNION_CANDS.length - 1].basis;
    return fitSkew(verts, w[0], w[1], PAD_TIGHT);
  });

  /* read-out strings (numbers deterministic, formatted once) */
  function kfmt(v) { return Math.round(v / 1000) + 'k'; }
  var SUM_READS = SUM_CANDS.map(function (c, i) {
    return 'Σ ' + kfmt(c.cost) + ' — candidate ' + (i + 1) + '/' +
      SUM_CANDS.length + ' × 8 children';
  });
  SUM_READS[SUM_READS.length - 1] =
    'Σ ' + kfmt(SUM_CANDS[SUM_CANDS.length - 1].cost) +
    ' — the best · cost: 3 × 8 = 24 fits';
  var UNION_READS = UNION_CANDS.map(function (c, i) {
    return '∪ ' + kfmt(c.cost) + ' — candidate ' + (i + 1) + '/' +
      UNION_CANDS.length + ' on ONE proxy';
  });
  UNION_READS[UNION_READS.length - 1] =
    '∪ ' + kfmt(UNION_CANDS[UNION_CANDS.length - 1].cost) +
    ' — basis flows back: 8 loose parallelograms';
  var AVG_READS = AVG_CANDS.map(function (c, i) {
    return 'avg ' + kfmt(c.cost) + ' — candidate ' + (i + 1) + '/' +
      AVG_CANDS.length + ' on ONE proxy';
  });
  AVG_READS[AVG_READS.length - 1] =
    'avg ' + kfmt(AVG_CANDS[AVG_CANDS.length - 1].cost) +
    ' — 8 tight parallelograms · 1 fit total';

  var PROXY_BASE_TF = 'translate(0 0) scale(1) translate(0 0)';
  var PROXY_STAGE_TF = 'translate(' + STAGE[0] + ' ' + STAGE[1] + ') scale(' +
    PROXY_SCALE + ') translate(' + (-CENTROID[0]) + ' ' + (-CENTROID[1]) + ')';

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var slotGlyphs = [];
  var hexPolys = [], paras = [];
  var proxyG, unionPoly, avgPoly, fitCand;
  var sumBadge, stageBadge, checkT, sumLabel, fitLabel, avgLabel;
  var readEl, sumG, closerCue;
  var captionEl;
  var tl = null;

  function glyphTransform(i, deg) {
    var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
    var gy = WIDE.y + WIDE.h / 2 - 14;
    return 'translate(' + gx + ' ' + gy + ') rotate(' + deg + ')';
  }

  function chip(x, w, txt, fill, parent) {
    var g = el('g', {}, parent);
    el('rect', {
      x: x, y: 508, width: w, height: 30, rx: 8,
      fill: '#ffffff', stroke: EDGE, 'stroke-width': 1.2
    }, g);
    text(txt, {
      x: x + w / 2, y: 527, 'text-anchor': 'middle',
      'font-size': 13, fill: fill
    }, g);
    return g;
  }

  function build() {
    var host = document.getElementById('sobb-canvas');
    svg = el('svg', { viewBox: '0 0 1120 560', width: '100%', height: '100%' }, host);
    el('title', {}, svg).textContent =
      'Eight child k-DOPs; three ways to pick one shared SOBB basis — sum, union, average';

    var i;

    /* ---- static scaffold: node frame, wide strip, connector ---- */
    el('rect', {
      x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.4
    }, svg);
    el('rect', {
      x: WIDE.x, y: WIDE.y, width: WIDE.w, height: WIDE.h, rx: 8,
      fill: '#ffffff', stroke: INK, 'stroke-width': 1.8
    }, svg);
    for (i = 1; i < SLOT_N; i++) {
      el('line', {
        x1: WIDE.x + (WIDE.w / SLOT_N) * i, y1: WIDE.y + 7,
        x2: WIDE.x + (WIDE.w / SLOT_N) * i, y2: WIDE.y + WIDE.h - 7,
        stroke: EDGE, 'stroke-width': 1.2
      }, svg);
    }
    var cy = WIDE.y + WIDE.h / 2;
    for (i = 0; i < SLOT_N; i++) {
      el('circle', {
        cx: WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5), cy: cy, r: 2.2, fill: INK
      }, svg);
      var g = el('g', { transform: glyphTransform(i, GLYPH_DEG), opacity: 0 }, svg);
      el('polygon', {
        points: MINI_PTS, fill: 'none', stroke: INK,
        'stroke-width': 1.3, 'stroke-linejoin': 'round'
      }, g);
      slotGlyphs.push(g);
    }
    text('one wide node · 8 child k-DOPs', {
      x: WIDE.x + WIDE.w / 2, y: 524, 'text-anchor': 'middle',
      'font-size': 15, fill: FAINT
    }, svg);
    /* connector: strip → its extent frame */
    el('line', {
      x1: WIDE.x + WIDE.w / 2, y1: WIDE.y - 4,
      x2: WIDE.x + WIDE.w / 2, y2: FRAME.y + FRAME.h + 6,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
    }, svg);

    /* ---- children: hexagon k-DOPs + shared-basis parallelograms ---- */
    HEXVERTS.forEach(function (verts, k) {
      hexPolys.push(el('polygon', {
        points: pts2str(verts),
        fill: LIGHT, stroke: INK, 'stroke-width': 1.4,
        'stroke-linejoin': 'round', opacity: 1
      }, svg));
    });
    SUM_CANDS[0].cornersList.forEach(function (cs, k) {
      paras.push(el('polygon', {
        points: pts2str(cs),
        fill: 'none', stroke: INK, 'stroke-width': 1.6,
        'stroke-dasharray': '6 5', 'stroke-linejoin': 'round', opacity: 0
      }, svg));
    });

    /* ---- right stage: proxy group (union + avg) + candidate fit ---- */
    proxyG = el('g', { transform: PROXY_BASE_TF }, svg);
    unionPoly = el('polygon', {
      points: pts2str(UNION_VERTS),
      fill: 'none', stroke: BLUE, 'stroke-width': 3.4,
      'stroke-dasharray': '7 5', 'stroke-linejoin': 'round', opacity: 0
    }, proxyG);
    avgPoly = el('polygon', {
      points: pts2str(AVG_VERTS),
      fill: '#eaf2fd', stroke: BLUE, 'stroke-width': 2.8,
      'stroke-linejoin': 'round', opacity: 0
    }, proxyG);
    fitCand = el('polygon', {
      points: pts2str(UNION_CANDS[0].corners),
      fill: INK, 'fill-opacity': 0.05, stroke: INK,
      'stroke-width': 1.3, 'stroke-dasharray': '5 4',
      'stroke-linejoin': 'round', opacity: 0
    }, svg);

    /* ---- badges / labels (all hidden at base) ---- */
    sumBadge = text('Σ — score every candidate on all eight', {
      x: 446, y: 398, 'text-anchor': 'middle', 'font-size': 15,
      fill: INK, opacity: 0
    }, svg);
    stageBadge = text('∪ — merge, then fit ONE proxy', {
      x: STAGE[0], y: 168, 'text-anchor': 'middle', 'font-size': 15,
      fill: INK, opacity: 0
    }, svg);
    checkT = text('✓', {
      x: 1068, y: 169, 'text-anchor': 'middle', 'font-size': 22,
      'font-weight': 700, fill: BLUE, opacity: 0
    }, svg);
    sumLabel = text('all eight parallelograms per candidate — 3 × 8 = 24 fits', {
      x: 306, y: 470, 'font-size': 13, fill: FAINT, opacity: 0
    }, svg);
    fitLabel = text('one candidate SOBB on the proxy, morphing between bases', {
      x: STAGE[0], y: 470, 'text-anchor': 'middle', 'font-size': 13,
      fill: FAINT, opacity: 0
    }, svg);
    avgLabel = text('avg of the eight slab extents — slimmer than the union', {
      x: STAGE[0], y: 494, 'text-anchor': 'middle', 'font-size': 12.5,
      fill: FAINT, opacity: 0
    }, svg);
    closerCue = text('one stored frame — eight tight shared-basis SOBBs', {
      x: 446, y: 64, 'text-anchor': 'middle', 'font-size': 15,
      fill: INK, opacity: 0
    }, svg);
    readEl = text(SUM_READS[0], {
      x: 56, y: 545, 'font-size': 14, fill: INK, opacity: 0
    }, svg);

    /* ---- three-way summary chips (s3 on) ---- */
    sumG = el('g', { opacity: 0 }, svg);
    chip(455, 172, 'Σ sum — exact · slow', INK, sumG);
    chip(645, 172, '∪ union — cheap · loose', INK, sumG);
    chip(835, 212, '✓ avg — cheap · tight enough', BLUE, sumG);

    captionEl = document.getElementById('sobb-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    hexPolys.forEach(function (p) {
      gsap.killTweensOf(p);
      p.setAttribute('opacity', 1);
    });
    SUM_CANDS[0].cornersList.forEach(function (cs, k) {
      gsap.killTweensOf(paras[k]);
      paras[k].setAttribute('points', pts2str(cs));
      paras[k].setAttribute('opacity', 0);
      paras[k].setAttribute('stroke', INK);
      paras[k].setAttribute('stroke-width', 1.6);
      paras[k].setAttribute('stroke-dasharray', '6 5');
    });
    gsap.killTweensOf(proxyG);
    proxyG.setAttribute('transform', PROXY_BASE_TF);
    gsap.killTweensOf(unionPoly);
    unionPoly.setAttribute('opacity', 0);
    gsap.killTweensOf(avgPoly);
    avgPoly.setAttribute('opacity', 0);
    gsap.killTweensOf(fitCand);
    fitCand.setAttribute('points', pts2str(UNION_CANDS[0].corners));
    fitCand.setAttribute('opacity', 0);
    [
      [sumBadge, 0], [stageBadge, 0], [checkT, 0], [sumLabel, 0],
      [fitLabel, 0], [avgLabel, 0], [readEl, 0], [sumG, 0], [closerCue, 0]
    ].forEach(function (pair) {
      gsap.killTweensOf(pair[0]);
      pair[0].setAttribute('opacity', pair[1]);
    });
    stageBadge.textContent = '∪ — merge, then fit ONE proxy';
    readEl.textContent = SUM_READS[0];
    slotGlyphs.forEach(function (g, k) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
      g.setAttribute('transform', glyphTransform(k, GLYPH_DEG));
    });
  }

  /* ==================== timeline ====================
   * Numeric/'>' positions only; labels sit at true section ends where
   * every scheduled tween completes — seek-safe in both directions. */

  var SECTIONS = 4;
  var MORPH = 0.8, HOLD = 0.4;        // SUM corner-morph pacing (kdopfan idiom)
  var FMORPH = 0.65, FHOLD = 0.3;     // proxy fit pacing

  function buildTimeline() {
    /* Cursor-driven, absolute numeric positions only — real GSAP does NOT
     * extend duration() when a label sits beyond the last tween, so a
     * running tl.duration() would drift behind the labels. The cursor T
     * is the source of truth; every section starts exactly at the previous
     * label, every label sits at a fixed offset after its content. */
    tl = gsap.timeline({ paused: true });
    var T, i;

    /* ---- s1 — SUM: every candidate on all eight children at once ---- */
    T = 0.15;
    tl.to(sumBadge, { attr: { opacity: 1 }, duration: 0.4 }, T);
    tl.to(sumLabel, { attr: { opacity: 1 }, duration: 0.4 }, T + 0.1);
    tl.to(readEl, { attr: { opacity: 1 }, duration: 0.35 }, T + 0.15);
    /* candidate 0 fades in (its corners are already set from reset) */
    tl.to(paras, {
      attr: { opacity: 1 }, duration: 0.5, stagger: 0.03, ease: 'power1.out'
    }, T + 0.5);
    tl.set(readEl, { textContent: SUM_READS[0] }, T + 1.0);
    for (i = 1; i < SUM_CANDS.length; i++) {
      var mSum = T + 0.5 + 0.5 + (i - 1) * (MORPH + HOLD) + HOLD;
      (function (ci, at) {
        HEXVERTS.forEach(function (v, k) {
          tl.to(paras[k], {
            attr: { points: pts2str(ci.cornersList[k]) },
            duration: MORPH, ease: 'power2.inOut'
          }, at);
        });
      })(SUM_CANDS[i], mSum);
      tl.set(readEl, { textContent: SUM_READS[i] }, mSum + MORPH);
    }
    T += 0.5 + 0.5 + (SUM_CANDS.length - 2) * (MORPH + HOLD) + HOLD + MORPH + 0.75;
    tl.addLabel('s1', T);   /* T = 4.30: 3 morphs landed, short settle */

    /* ---- s2 — UNION: merge to one k-DOP, fit once, flow back down ---- */
    tl.to(sumBadge, { attr: { opacity: 0 }, duration: 0.4 }, T);
    tl.to(sumLabel, { attr: { opacity: 0 }, duration: 0.4 }, T);
    tl.to(paras, { attr: { opacity: 0 }, duration: 0.35, stagger: 0.02 }, T);
    tl.set(readEl, { textContent: UNION_READS[0] }, T + 0.3);
    /* merge: children ghost, the union outline appears around them */
    tl.to(hexPolys, { attr: { opacity: 0.2 }, duration: 0.5, stagger: 0.03 }, T + 0.15);
    tl.to(unionPoly, { attr: { opacity: 0.9 }, duration: 0.6, ease: 'power1.inOut' }, T + 0.35);
    /* carry the union to the right stage; fit candidates morph over it */
    var mMove = T + 1.15;
    tl.to(proxyG, {
      attr: { transform: PROXY_STAGE_TF }, duration: 0.75, ease: 'power2.inOut'
    }, mMove);
    tl.to(stageBadge, { attr: { opacity: 1 }, duration: 0.4 }, mMove + 0.2);
    tl.to(fitLabel, { attr: { opacity: 1 }, duration: 0.4 }, mMove + 0.3);
    tl.to(fitCand, { attr: { opacity: 1 }, duration: 0.35 }, mMove + 0.55);
    for (i = 1; i < UNION_CANDS.length; i++) {
      var mU = mMove + 0.55 + 0.35 + (i - 1) * (FMORPH + FHOLD) + FHOLD;
      (function (ci, at) {
        tl.to(fitCand, {
          attr: { points: pts2str(ci.corners) },
          duration: FMORPH, ease: 'power2.inOut'
        }, at);
      })(UNION_CANDS[i], mU);
      tl.set(readEl, { textContent: UNION_READS[i] }, mU + FMORPH);
    }
    /* the basis flows back down: children form loose parallelograms */
    var mDist = mMove + 0.55 + 0.35 +
      (UNION_CANDS.length - 2) * (FMORPH + FHOLD) + FHOLD + FMORPH + 0.3;
    var winU = UNION_CANDS[UNION_CANDS.length - 1];
    HEXVERTS.forEach(function (v, k) {
      tl.to(paras[k], {
        attr: {
          points: pts2str(fitSkew(v, winU.basis[0], winU.basis[1], PAD_TIGHT)),
          opacity: 1
        },
        duration: 0.55, ease: 'power2.inOut'
      }, mDist + k * 0.04);
    });
    tl.to(hexPolys, { attr: { opacity: 1 }, duration: 0.4 }, mDist + 0.1);
    tl.to(unionPoly, { attr: { opacity: 0.7 }, duration: 0.5 }, mDist + 0.2);
    tl.to(fitCand, { attr: { opacity: 0.65 }, duration: 0.4 }, mDist + 0.3);
    tl.set(readEl, { textContent: UNION_READS[UNION_READS.length - 1] }, mDist + 0.3);
    T = mDist + 0.55 + 0.3;
    tl.addLabel('s2', T);   /* distributed loose fit settled */

    /* ---- s3 — AVG: slimmer proxy, one fit, tight enough ✓ ---- */
    /* boundary sets sit an epsilon PAST the s2 label: zero-duration sets
     * render when the playhead lands exactly on them — seeking to the s2
     * stop must not fire AVG text yet */
    tl.set(readEl, { textContent: AVG_READS[0] }, T + 0.05);
    tl.set(stageBadge, { textContent: 'avg — fit ONE slimmer proxy' }, T + 0.05);
    tl.to(unionPoly, { attr: { opacity: 0 }, duration: 0.5 }, T + 0.1);
    tl.to(avgPoly, { attr: { opacity: 0.9 }, duration: 0.55, ease: 'power1.out' }, T + 0.15);
    tl.to(fitCand, {
      attr: { points: pts2str(AVG_CANDS[0].corners), opacity: 1 },
      duration: 0.6, ease: 'power2.inOut'
    }, T + 0.25);
    for (i = 1; i < AVG_CANDS.length; i++) {
      var mA = T + 0.25 + 0.6 + (i - 1) * (FMORPH + FHOLD) + FHOLD;
      (function (ci, at) {
        tl.to(fitCand, {
          attr: { points: pts2str(ci.corners) },
          duration: FMORPH, ease: 'power2.inOut'
        }, at);
      })(AVG_CANDS[i], mA);
      tl.set(readEl, { textContent: AVG_READS[i] }, mA + FMORPH);
    }
    var mAvgDist = T + 0.25 + 0.6 +
      (AVG_CANDS.length - 2) * (FMORPH + FHOLD) + FHOLD + FMORPH + 0.25;
    var winA = AVG_CANDS[AVG_CANDS.length - 1];
    HEXVERTS.forEach(function (v, k) {
      tl.to(paras[k], {
        attr: {
          points: pts2str(fitSkew(v, winA.basis[0], winA.basis[1], PAD_TIGHT)),
          stroke: BLUE
        },
        duration: 0.6, ease: 'power2.inOut'
      }, mAvgDist + k * 0.035);
    });
    tl.set(readEl, { textContent: AVG_READS[AVG_READS.length - 1] }, mAvgDist + 0.3);
    tl.to(checkT, { attr: { opacity: 1 }, duration: 0.35 }, mAvgDist + 0.45);
    tl.to(sumG, { attr: { opacity: 1 }, duration: 0.45 }, mAvgDist + 0.55);
    tl.to(avgLabel, { attr: { opacity: 1 }, duration: 0.35 }, mAvgDist + 0.6);
    tl.to(avgPoly, { attr: { opacity: 0.55 }, duration: 0.5 }, mAvgDist + 0.5);
    tl.to(fitCand, { attr: { opacity: 0.4 }, duration: 0.45 }, mAvgDist + 0.5);
    T = mAvgDist + 0.6 + 0.45;
    tl.addLabel('s3', T);   /* avg distributed, marked, summary up */

    /* ---- s4 — closer: the avg winner locks ---- */
    [readEl, stageBadge, fitLabel, avgLabel, checkT, avgPoly, fitCand].forEach(function (e) {
      tl.to(e, { attr: { opacity: 0 }, duration: 0.4 }, T);
    });
    tl.to(paras, {
      attr: { 'stroke-width': 2.4 }, duration: 0.55, ease: 'power2.inOut'
    }, T + 0.15);
    tl.to(closerCue, { attr: { opacity: 1 }, duration: 0.45 }, T + 0.3);
    tl.to(slotGlyphs, {
      attr: { opacity: 1 }, duration: 0.35, stagger: 0.04
    }, T + 0.45);
    T += 0.45 + 0.35 + 0.35;
    tl.addLabel('s4', T);
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetDom();
      buildTimeline();
      var k = Math.min(fragStep, SECTIONS);
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[SECTIONS];
      if (k > 0) tl.seek(D.stopsFor(tl, SECTIONS)[k], true);
      gsap.fromTo(svg, { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },
    step: function (fragStep) {
      if (!tl) return;
      var k = Math.min(fragStep, SECTIONS);
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[SECTIONS];
      tl.tweenTo(D.stopsFor(tl, SECTIONS)[k], { ease: 'none' });
    },
    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  animator._test = {
    TL: function () { return tl; },
    tlInfo: function () {
      return tl ? { labels: tl.labels, duration: tl.duration() } : null;
    },
    hexagon: hexagon,
    project: project,
    solveCorner: solveCorner,
    fitSkew: fitSkew,
    kdopFromExtents: kdopFromExtents,
    sortCorners: sortCorners,
    polyArea: polyArea,
    pts2str: pts2str,
    toStage: toStage,
    CHILDREN: CHILDREN,
    CENTROID: CENTROID,
    HEXVERTS: HEXVERTS,
    CHILD_EXTS: CHILD_EXTS,
    UNION_EXTS: UNION_EXTS,
    UNION_VERTS: UNION_VERTS,
    AVG_EXTS: AVG_EXTS,
    AVG_VERTS: AVG_VERTS,
    SUM_CANDS: SUM_CANDS,
    UNION_CANDS: UNION_CANDS,
    AVG_CANDS: AVG_CANDS,
    UNION_PARAS: UNION_PARAS,
    FINAL_PARAS: FINAL_PARAS,
    WIN_BASIS: WIN_BASIS,
    PROXY_SCALE: PROXY_SCALE,
    PROXY_STAGE_TF: PROXY_STAGE_TF,
    SUM_READS: SUM_READS,
    UNION_READS: UNION_READS,
    AVG_READS: AVG_READS,
    N1: N1, N2: N2,
    HEX_DIRS: HEX_DIRS,
    WIDE: WIDE, FRAME: FRAME, STAGE: STAGE,
    GLYPH_DEG: GLYPH_DEG,
    CAPTIONS: CAPTIONS,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbasis = animator;
})();
