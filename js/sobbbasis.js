/* SOBB basis animator — paper Sec. 3.3: HOW the shared basis is built.
 *
 * Follows slide-quant ("Quantization demands a shared basis"); explains
 * the paper's three candidate strategies for picking the one basis.
 * NO numeric read-outs anywhere — the geometry speaks: candidate progress
 * is shown by dot rows, per-beat words are one or two tokens, wordy
 * sentences live only in the footer caption.
 *
 *   f0/base: one wide node, 8 children — each with its own k-DOP
 *            (hexagons, matching the pipeline slide's proxies).
 *   s1 SUM:  each candidate basis is applied to ALL 8 children at once —
 *            eight aligned parallelograms morphing together through FOUR
 *            candidates, slow (corner-morph idiom from kdopfan).
 *   s2 UNION: fresh baseline, then the 8 children fly one by one into a
 *            merge point — KEEPING their spatial arrangement (compacted
 *            toward the merge point), so every child lands on the
 *            actual border of the growing union k-DOP (running
 *            per-direction min/max, 6-corner morph-safe): a genuinely
 *            fat merged proxy. The union carries to the right stage,
 *            one SOBB fit morphs through the candidates — and the union
 *            fit's BASIS is handed back and refit per child: 8 tight
 *            parallelograms, each hugging its own k-DOP.
 *   s3 AVG:  fresh baseline again, same fly-in — but the accumulating
 *            k-DOP does NOT grow: running per-direction mean only nudges
 *            its shape. One fit on the mean proxy lands on the deck's
 *            shared frame n1=100°/n2=160°; its BASIS is handed back and
 *            refit per child: 8 tight BLUE parallelograms, ✓, and the
 *            three-way summary chips appear.
 *   s4 closer: avg locks (parallelograms thicken), slot glyphs tilt onto
 *            the shared frame — hand-off to results.
 *
 * Every approach beat re-establishes the SAME clean baseline node at its
 * start (losing tweens at the section boundary), so backward walks and
 * deep entries never show residue from the previous strategy.
 *
 * All SOBB parallelograms are genuine 2D SOBBs: intersection of two slab
 * pairs, corners sorted CCW, kdopfan-style morph-safe. Union/avg k-DOPs
 * use a fixed 6-corner slab parametrization (kdop6) so point-counts are
 * ALWAYS equal for morphs. GSAP-animated paint props are SVG attributes
 * only. Pure math exported via _test.
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

  /* eight children, two rows — ELONGATED hexagon k-DOPs: half-axes a×b,
   * long-axis direction psi, vertex phase th0. Two orientation families
   * echo the scene cluster (e1≈10°, e2≈70° — makeCluster): even slots
   * lean ~10°, odd slots ~70°, amplitudes ascending so the union fly-in
   * fattens on every arrival. Region boxed by FRAME. */
  var CHILDREN = [
    { c: [190, 156], a: 42, b: 25.2, psi: 4,  th0: 3 },
    { c: [345, 162], a: 44, b: 28.2, psi: 63, th0: 3 },
    { c: [500, 152], a: 46, b: 27.6, psi: 17, th0: 3 },
    { c: [655, 160], a: 48, b: 30.7, psi: 75, th0: 3 },
    { c: [215, 322], a: 50, b: 30.0, psi: 7,  th0: 3 },
    { c: [370, 328], a: 52, b: 33.3, psi: 66, th0: 3 },
    { c: [525, 320], a: 54, b: 32.4, psi: 15, th0: 3 },
    { c: [680, 326], a: 56, b: 35.8, psi: 78, th0: 3 }
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

  /* k-DOP slab normal directions: 40°/100°/160° — the children's k-DOPs
   * share the shared-basis frame's own normals (SOBB = k-DOP on a shared
   * orientation), which is what lets ONE basis stay tight on all eight */
  var HEX_DIRS = [40, 100, 160].map(function (a) {
    return [Math.cos(rad(a)), Math.sin(rad(a))];
  });

  var PAD_TIGHT = 3;                 // world padding for fitted parallelograms

  /* the candidate fan: four basis pairs, normals 60° apart on the deck's
   * fan (10+30k in kdopfan). ALL THREE strategies evaluate these same
   * four; every approach's winner is honestly the deck's shared frame
   * [100,160] — the difference is WHAT gets handed back to the children
   * (sum: per-child refits, union: the one merged fit, avg: per-child
   * refits on the mean-proxy basis). Sorted by cost descending at build. */
  var FAN_BASES = [[10, 70], [40, 100], [70, 130], [100, 160]];

  /* summary chips — the closer stays, BIG and readable (viewBox units,
   * rendered ~1.5× larger than the old 13px chips) */
  var CHIPS = [
    { x: 40,  w: 262, t: 'Σ sum · exact · slow',          fill: INK,  win: false },
    { x: 318, w: 280, t: '∪ union · cheap · loose',       fill: INK,  win: false },
    { x: 614, w: 366, t: '✓ avg · cheap · tight enough',  fill: BLUE, win: true }
  ];
  var CHIP_FS = 21;

  var CAPTIONS = [
    'One wide node — eight children must be tightly bounded with a single basis.',
    'Sum — score every candidate basis on every child at once: exact, but slow.',
    'Union — merge the children into one k-DOP, then fit once: cheap, but the union is loose.',
    'Average — one mean k-DOP, one fit: cheap and tight enough. Our choice.',
    'Locked: one stored frame, eight tight shared-basis SOBBs.'
  ];

  /* ==================== pure math ==================== */

  /* elongated hexagon: vertices on an a×b ellipse, long axis at psi° */
  function hexagon(ch) {
    var out = [];
    var cs = Math.cos(rad(ch.psi)), sn = Math.sin(rad(ch.psi));
    for (var i = 0; i < 6; i++) {
      var a = rad(ch.th0 + i * 60);
      var lx = ch.a * Math.cos(a), ly = ch.b * Math.sin(a);
      out.push([ch.c[0] + lx * cs - ly * sn, ch.c[1] + lx * sn + ly * cs]);
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

  /* Fixed 6-corner k-DOP from slab extents (exts[k] = [lo,hi] along
   * HEX_DIRS[k]). Edges in fixed CCW normal order +n0,+n1,+n2,−n0,−n1,−n2;
   * corner j = intersection of edges j and j+1. ALWAYS 6 corners (an
   * absent edge degenerates to a duplicated point, never a missing one),
   * so unions/averages of these stay morph-safe at every accumulation
   * step — unlike a dedupe-and-sort intersection, whose count varies. */
  function kdop6(exts) {
    var d = HEX_DIRS, e = exts;
    return [
      solveCorner(d[0], d[1], e[0][1], e[1][1]),
      solveCorner(d[1], d[2], e[1][1], e[2][1]),
      solveCorner(d[2], d[0], e[2][1], e[0][0]),
      solveCorner(d[0], d[1], e[0][0], e[1][0]),
      solveCorner(d[1], d[2], e[1][0], e[2][0]),
      solveCorner(d[2], d[0], e[2][0], e[0][1])
    ];
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
    return hexagon(ch);
  });

  /* per-child slab extents along the k-DOP directions */
  var CHILD_EXTS = HEXVERTS.map(function (verts) {
    return HEX_DIRS.map(function (n) { return project(verts, n); });
  });

  /* FLY-IN basis: children KEEP their spatial arrangement, compacted
   * toward the merge point — each centre lands at CENTROID + SHRINK·
   * (c − CENTROID), i.e. a translate of (1−SHRINK)·(CENTROID − c). The
   * landed children imitate their real positions, so the accumulating
   * union k-DOP is the honest union of the POSITIONED children: every
   * child ends on the actual border of the merged k-DOP, and the merged
   * proxy is naturally much fatter than any single child. */
  var SHRINK = 0.4;
  var SHIFT = CHILDREN.map(function (ch) {
    return [(1 - SHRINK) * (CENTROID[0] - ch.c[0]),
            (1 - SHRINK) * (CENTROID[1] - ch.c[1])];
  });
  var SHIFT_EXTS = CHILD_EXTS.map(function (ext, k) {
    return ext.map(function (pair, m) {
      var s = SHIFT[k][0] * HEX_DIRS[m][0] + SHIFT[k][1] * HEX_DIRS[m][1];
      return [pair[0] + s, pair[1] + s];
    });
  });

  /* running union: per-direction min/max over the arrived children —
   * the tight union of the landed (positioned) children, so its border
   * is formed by the children themselves */
  var CUMU_EXTS = [];
  for (var ui = 0; ui < 8; ui++) {
    CUMU_EXTS.push(HEX_DIRS.map(function (n, m) {
      var lo = Infinity, hi = -Infinity;
      for (var k = 0; k <= ui; k++) {
        if (SHIFT_EXTS[k][m][0] < lo) lo = SHIFT_EXTS[k][m][0];
        if (SHIFT_EXTS[k][m][1] > hi) hi = SHIFT_EXTS[k][m][1];
      }
      return [lo, hi];
    }));
  }
  var CUMU_VERTS = CUMU_EXTS.map(kdop6);
  var UNION_EXTS = CUMU_EXTS[7];
  var UNION_VERTS = CUMU_VERTS[7];

  /* running mean: per-direction average over the arrived children —
   * never exceeds the union (means stay inside [min,max]) */
  var CUMA_EXTS = [];
  for (var ai = 0; ai < 8; ai++) {
    CUMA_EXTS.push(HEX_DIRS.map(function (n, m) {
      var lo = 0, hi = 0;
      for (var k = 0; k <= ai; k++) {
        lo += SHIFT_EXTS[k][m][0]; hi += SHIFT_EXTS[k][m][1];
      }
      return [lo / (ai + 1), hi / (ai + 1)];
    }));
  }
  var CUMA_VERTS = CUMA_EXTS.map(kdop6);
  var AVG_EXTS = CUMA_EXTS[7];
  var AVG_VERTS = CUMA_VERTS[7];

  /* right-stage mapping: world → stage around the merge point; each
   * proxy gets its OWN scale — the inflated union needs tighter stage
   * budgets to fit, the mean k-DOP keeps the classic 1.2 cap. The
   * scale is measured over the proxy AND every candidate fit: the
   * stage morph passes through the worst (biggest) candidate too. */
  function toStageRaw(p, s) {
    return [
      STAGE[0] + s * (p[0] - CENTROID[0]),
      STAGE[1] + s * (p[1] - CENTROID[1])
    ];
  }
  function fanFits(rawBases, proxyVerts) {
    return rawBases.map(function (b) {
      return fitSkew(proxyVerts, b[0], b[1], PAD_TIGHT);
    });
  }
  function stageScaleFor(proxyVerts, fits, capH, capV) {
    var md = 0, nd = 0;
    proxyVerts.concat(flatVerts(fits)).forEach(function (p) {
      md = Math.max(md, Math.abs(p[0] - CENTROID[0]));
      nd = Math.max(nd, Math.abs(p[1] - CENTROID[1]));
    });
    return Math.round(Math.min(capH / md, capV / nd) * 1000) / 1000;
  }
  var PROXY_SCALE_U = stageScaleFor(UNION_VERTS, fanFits(FAN_BASES, UNION_VERTS), 150, 116);
  var PROXY_SCALE_A = Math.min(1.2, stageScaleFor(AVG_VERTS, fanFits(FAN_BASES, AVG_VERTS), 190, 150));
  function toStage(p) { return toStageRaw(p, PROXY_SCALE_A); }
  function toStageU(p) { return toStageRaw(p, PROXY_SCALE_U); }

  /* candidate helper: sort basis list by cost descending */
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
  var SUM_CANDS = buildCandidates(FAN_BASES, function (b) {
    return HEXVERTS.map(function (verts) {
      return fitSkew(verts, b[0], b[1], PAD_TIGHT);
    });
  });

  /* UNION / AVG: candidates fitted on the single proxy (staged coords) */
  function proxyCandidates(rawBases, proxyVerts, toStg) {
    return rawBases.map(function (b) {
      var corners = fitSkew(proxyVerts, b[0], b[1], PAD_TIGHT);
      return {
        basis: b,
        corners: corners.map(toStg),
        cost: polyArea(corners)
      };
    }).sort(function (a, b) { return b.cost - a.cost; });
  }
  var UNION_CANDS = proxyCandidates(FAN_BASES, UNION_VERTS, toStageU);
  var AVG_CANDS = proxyCandidates(FAN_BASES, AVG_VERTS, toStage);

  /* settle parallelograms: per-child refits on the shared frame (the
   * tight, correct answer — what SUM and AVG hand back) */
  var WIN_BASIS = [100, 160];
  var FINAL_PARAS = HEXVERTS.map(function (verts) {
    return fitSkew(verts, WIN_BASIS[0], WIN_BASIS[1], PAD_TIGHT);
  });

  /* UNION hand-back: the union fit only picks the BASIS — every child
   * is then refit TIGHTLY on its own k-DOP with that basis, so the
   * bounds propagated back hug each child. The looseness of the union
   * strategy lives in the inflated merged k-DOP the basis was fitted
   * on, not in the child bounds. */
  var UNION_WIN = UNION_CANDS[UNION_CANDS.length - 1].basis;
  var UNION_PARAS = HEXVERTS.map(function (verts) {
    return fitSkew(verts, UNION_WIN[0], UNION_WIN[1], PAD_TIGHT);
  });

  var PROXY_BASE_TF = 'translate(0 0) scale(1) translate(0 0)';
  function stageTf(s) {
    return 'translate(' + STAGE[0] + ' ' + STAGE[1] + ') scale(' + s +
      ') translate(' + (-CENTROID[0]) + ' ' + (-CENTROID[1]) + ')';
  }

  function hexHome(k) { return 'translate(0 0)'; }
  function hexAtMerge(k) {
    return 'translate(' + SHIFT[k][0] + ' ' + SHIFT[k][1] + ')';
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var slotGlyphs = [];
  var hexGs = [], hexPolys = [], paras = [];
  var proxyG, unionPoly, avgPoly, fitCand;
  var sumBadge, stageBadge, closerCue;
  var sumDotG, stageDotG, sumDots = [], stageDots = [];
  var sumG;
  var captionEl;
  var tl = null;

  function glyphTransform(i, deg) {
    var gx = WIDE.x + (WIDE.w / SLOT_N) * (i + 0.5);
    var gy = WIDE.y + WIDE.h / 2 - 14;
    return 'translate(' + gx + ' ' + gy + ') rotate(' + deg + ')';
  }

  /* dot row: wordless candidate-progress indicator (replaces the old
   * numeric Σ/∪/avg read-outs) */
  function dotRow(count, cx, cy, parent) {
    var g = el('g', { opacity: 0 }, parent);
    var dots = [];
    for (var k = 0; k < count; k++) {
      dots.push(el('circle', {
        cx: cx + (k - (count - 1) / 2) * 22, cy: cy, r: 4.6,
        fill: '#ffffff', stroke: INK, 'stroke-width': 1.4
      }, g));
    }
    return { g: g, dots: dots };
  }

  function chip(c, parent) {
    var g = el('g', {}, parent);
    el('rect', {
      x: c.x, y: 500, width: c.w, height: 42, rx: 12,
      fill: '#ffffff', stroke: c.win ? BLUE : EDGE,
      'stroke-width': c.win ? 2 : 1.4
    }, g);
    text(c.t, {
      x: c.x + c.w / 2, y: 528, 'text-anchor': 'middle',
      'font-size': CHIP_FS, 'font-weight': 650, fill: c.fill
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
    /* connector: strip → its extent frame */
    el('line', {
      x1: WIDE.x + WIDE.w / 2, y1: WIDE.y - 4,
      x2: WIDE.x + WIDE.w / 2, y2: FRAME.y + FRAME.h + 6,
      stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
    }, svg);

    /* ---- children: hexagon k-DOPs (wrapped in a <g> so the fly-in is a
     * translate tween, points untouched) + shared-basis parallelograms ---- */
    HEXVERTS.forEach(function (verts, k) {
      var hg = el('g', { transform: hexHome(k) }, svg);
      hexGs.push(hg);
      hexPolys.push(el('polygon', {
        points: pts2str(verts),
        fill: LIGHT, stroke: INK, 'stroke-width': 1.4,
        'stroke-linejoin': 'round', opacity: 1
      }, hg));
    });
    /* paras start on the WORST candidate — the sum run improves on stage */
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
      points: pts2str(CUMU_VERTS[0]),
      fill: 'none', stroke: BLUE, 'stroke-width': 3.4,
      'stroke-dasharray': '7 5', 'stroke-linejoin': 'round', opacity: 0
    }, proxyG);
    avgPoly = el('polygon', {
      points: pts2str(CUMA_VERTS[0]),
      fill: '#eaf2fd', stroke: BLUE, 'stroke-width': 2.8,
      'stroke-linejoin': 'round', opacity: 0
    }, proxyG);
    fitCand = el('polygon', {
      points: pts2str(UNION_CANDS[0].corners),
      fill: INK, 'fill-opacity': 0.05, stroke: INK,
      'stroke-width': 1.3, 'stroke-dasharray': '5 4',
      'stroke-linejoin': 'round', opacity: 0
    }, svg);

    /* ---- badges / dots / closer cue (all hidden at base) ---- */
    sumBadge = text('Σ sum', {
      x: 446, y: 402, 'text-anchor': 'middle', 'font-size': 22,
      'font-weight': 650, fill: INK, opacity: 0
    }, svg);
    stageBadge = text('∪ union', {
      x: STAGE[0], y: 144, 'text-anchor': 'middle', 'font-size': 22,
      'font-weight': 650, fill: INK, opacity: 0
    }, svg);
    closerCue = text('one stored frame', {
      x: 446, y: 100, 'text-anchor': 'middle', 'font-size': 21,
      'font-weight': 650, fill: INK, opacity: 0
    }, svg);
    var r1 = dotRow(SUM_CANDS.length, 446, 434, svg);
    sumDotG = r1.g; sumDots = r1.dots;
    var r2 = dotRow(UNION_CANDS.length, STAGE[0], 172, svg);
    stageDotG = r2.g; stageDots = r2.dots;

    /* ---- three-way summary chips (s3 on) ---- */
    sumG = el('g', { opacity: 0 }, svg);
    CHIPS.forEach(function (c) { chip(c, sumG); });

    captionEl = document.getElementById('sobb-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    hexGs.forEach(function (g, k) {
      gsap.killTweensOf(g);
      g.setAttribute('transform', hexHome(k));
    });
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
    proxyG.setAttribute('opacity', 1);
    gsap.killTweensOf(unionPoly);
    unionPoly.setAttribute('points', pts2str(CUMU_VERTS[0]));
    unionPoly.setAttribute('opacity', 0);
    unionPoly.setAttribute('stroke-width', 3.4);
    gsap.killTweensOf(avgPoly);
    avgPoly.setAttribute('points', pts2str(CUMA_VERTS[0]));
    avgPoly.setAttribute('opacity', 0);
    avgPoly.setAttribute('stroke-width', 2.8);
    gsap.killTweensOf(fitCand);
    fitCand.setAttribute('points', pts2str(UNION_CANDS[0].corners));
    fitCand.setAttribute('opacity', 0);
    [
      sumBadge, stageBadge, closerCue, sumDotG, stageDotG, sumG
    ].forEach(function (n) {
      gsap.killTweensOf(n);
      n.setAttribute('opacity', 0);
    });
    stageBadge.textContent = '∪ union';
    sumDots.concat(stageDots).forEach(function (d) {
      gsap.killTweensOf(d);
      d.setAttribute('fill', '#ffffff');
    });
    slotGlyphs.forEach(function (g, k) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
      g.setAttribute('transform', glyphTransform(k, GLYPH_DEG));
    });
  }

  /* ==================== timeline ====================
   * Numeric/'>' positions only; labels sit at true section ends where
   * every scheduled tween completes — seek-safe in both directions.
   * The cursor T is the source of truth: real GSAP does NOT extend
   * duration() when a label sits past the last tween, so a running
   * tl.duration() would drift behind the labels. */

  var SECTIONS = 4;
  /* SUM: slow candidate exploration (four candidates);
   * FLY: one child arrival per 0.42s, 0.5s flight, morph on landing;
   * FIT: single-proxy candidate morph pacing */
  var MORPH = 1.05, HOLD = 0.4;
  var FLY_STEP = 0.42, FLY_DUR = 0.5, FLY_MORPH = 0.35;
  var FMORPH = 0.7, FHOLD = 0.35;

  /* one arrival per child: hex glides to the merge point and ghosts,
   * the accumulating k-DOP morphs to its new extents with a pulse
   * (baseW keeps the pulse centred on each proxy's own stroke width) */
  function scheduleFlyIn(t0, poly, vertsSeq, baseW) {
    for (var k = 0; k < 8; k++) {
      var t = t0 + k * FLY_STEP;
      (function (i, at) {
        tl.to(hexGs[i], {
          attr: { transform: hexAtMerge(i) },
          duration: FLY_DUR, ease: 'power2.in'
        }, at);
        tl.to(hexPolys[i], { attr: { opacity: 0.14 }, duration: 0.35 }, at + 0.15);
        if (i === 0) {
          /* first landed child defines the k-DOP; instant swap, then show */
          tl.set(poly, { attr: { points: pts2str(vertsSeq[0]) } }, at + 0.36);
          tl.to(poly, { attr: { opacity: 0.92 }, duration: 0.25 }, at + 0.38);
        } else {
          tl.to(poly, {
            attr: { points: pts2str(vertsSeq[i]) },
            duration: FLY_MORPH, ease: 'power2.out'
          }, at + 0.36);
        }
        tl.to(poly, { attr: { 'stroke-width': baseW + 1.4 }, duration: 0.15 }, at + 0.38);
        tl.to(poly, { attr: { 'stroke-width': baseW }, duration: 0.35 }, at + 0.55);
      })(k, t);
    }
    return t0 + 7 * FLY_STEP + FLY_DUR + 0.55;
  }

  function distribute(t0, paraFn, color, stagger) {
    for (var k = 0; k < 8; k++) {
      var at = t0 + k * stagger;
      (function (i, at2) {
        tl.to(paras[i], {
          attr: { points: pts2str(paraFn(i)), opacity: 1, stroke: color },
          duration: 0.55, ease: 'power2.inOut'
        }, at2);
        tl.to(hexGs[i], {
          attr: { transform: hexHome(i) }, duration: 0.55, ease: 'power2.out'
        }, at2);
        tl.to(hexPolys[i], { attr: { opacity: 1 }, duration: 0.4 }, at2 + 0.12);
      })(k, at);
    }
    return t0 + 7 * stagger + 0.55;
  }

  function scheduleFits(t0, cands, dots) {
    tl.to(fitCand, { attr: { opacity: 1 }, duration: 0.3 }, t0);
    tl.set(dots[0], { attr: { fill: INK } }, t0);
    var T = t0 + 0.3 + 0.3;
    for (var i = 1; i < cands.length; i++) {
      var at = T + (i - 1) * (FMORPH + FHOLD);
      (function (ci, k, at2) {
        tl.to(fitCand, {
          attr: { points: pts2str(ci.corners) },
          duration: FMORPH, ease: 'power2.inOut'
        }, at2);
        tl.set(dots[k - 1], { attr: { fill: '#ffffff' } }, at2);
        tl.set(dots[k], { attr: { fill: INK } }, at2);
      })(cands[i], i, at);
    }
    return T + (cands.length - 2) * (FMORPH + FHOLD) + FMORPH + FHOLD + 0.1;
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var i;

    /* ---- s1 — SUM: every candidate on all eight children at once ---- */
    var T = 0.15;
    tl.to(sumBadge, { attr: { opacity: 1 }, duration: 0.35 }, T);
    tl.to(sumDotG, { attr: { opacity: 1 }, duration: 0.35 }, T + 0.1);
    /* worst candidate’s baselines are set at reset; fade its 8 fits in */
    tl.to(paras, {
      attr: { opacity: 1 }, duration: 0.65, stagger: 0.05, ease: 'power1.out'
    }, T + 0.45);
    tl.set(sumDots[0], { attr: { fill: INK } }, T + 0.45);
    var mBase = T + 0.45 + 0.65 + 0.45;   /* first candidate lands, holds */
    for (i = 1; i < SUM_CANDS.length; i++) {
      var mSum = mBase + (i - 1) * (MORPH + HOLD);
      (function (ci, k, at) {
        HEXVERTS.forEach(function (v, j) {
          tl.to(paras[j], {
            attr: { points: pts2str(ci.cornersList[j]) },
            duration: MORPH, ease: 'power2.inOut'
          }, at);
        });
        tl.set(sumDots[k - 1], { attr: { fill: '#ffffff' } }, at);
        tl.set(sumDots[k], { attr: { fill: INK } }, at);
      })(SUM_CANDS[i], i, mSum);
    }
    T = mBase + (SUM_CANDS.length - 2) * (MORPH + HOLD) + MORPH + 0.8;
    tl.addLabel('s1', T);   /* best-of-four settled on the children */

    /* ---- s2 — UNION ---- */
    /* clean baseline first: sum badge/dots + every parallelogram leave
     * BEFORE the first child takes off — nothing from the sum run remains */
    tl.to(sumBadge, { attr: { opacity: 0 }, duration: 0.3 }, T);
    tl.to(sumDotG, { attr: { opacity: 0 }, duration: 0.3 }, T);
    tl.to(paras, { attr: { opacity: 0 }, duration: 0.3, stagger: 0.025 }, T + 0.02);
    var tFly = T + 0.55;
    var tFlyEnd = scheduleFlyIn(tFly, unionPoly, CUMU_VERTS, 3.4);
    /* the positional union (border formed by the children) carries right */
    tl.to(proxyG, {
      attr: { transform: stageTf(PROXY_SCALE_U) }, duration: 0.75, ease: 'power2.inOut'
    }, tFlyEnd);
    tl.to(stageBadge, { attr: { opacity: 1 }, duration: 0.35 }, tFlyEnd + 0.3);
    tl.to(stageDotG, { attr: { opacity: 1 }, duration: 0.3 }, tFlyEnd + 0.4);
    var tFitsEnd = scheduleFits(tFlyEnd + 0.75 + 0.15, UNION_CANDS, stageDots);
    /* the basis flows back down: children spring home, and every child
     * is refit TIGHTLY on its own k-DOP with the union fit's basis */
    var tDistEnd = distribute(tFitsEnd + 0.1, function (j) {
      return UNION_PARAS[j];
    }, INK, 0.05);
    tl.to(unionPoly, { attr: { opacity: 0.7 }, duration: 0.4 }, tDistEnd - 0.3);
    tl.to(fitCand, { attr: { opacity: 0.6 }, duration: 0.4 }, tDistEnd - 0.2);
    T = tDistEnd + 0.25;
    tl.addLabel('s2', T);   /* tight refits on the union basis settled */

    /* ---- s3 — AVG ---- */
    /* boundary swaps sit past the s2 label AND past the fade-out below:
     * seeking to the s2 stop must not fire them, and playing forward
     * must never swap shapes while still visible */
    tl.set(fitCand, { attr: { points: pts2str(AVG_CANDS[0].corners) } }, T + 0.5);
    tl.set(stageBadge, { textContent: '✓ avg' }, T + 0.5);
    /* clean baseline again: union proxy + fit + the handed-back refits
     * leave BEFORE the avg fly-in; the stage transform resets while
     * nothing proxy-shaped is visible (union faded, avg not yet shown) */
    tl.to(unionPoly, { attr: { opacity: 0 }, duration: 0.4 }, T + 0.1);
    tl.to(fitCand, { attr: { opacity: 0 }, duration: 0.35 }, T + 0.1);
    tl.to(stageBadge, { attr: { opacity: 0 }, duration: 0.3 }, T + 0.1);
    tl.to(stageDotG, { attr: { opacity: 0 }, duration: 0.3 }, T + 0.1);
    tl.to(paras, { attr: { opacity: 0 }, duration: 0.3, stagger: 0.025 }, T + 0.02);
    tl.set(proxyG, { attr: { transform: PROXY_BASE_TF } }, T + 0.62);
    var tFlyA = T + 0.75;
    /* same fly-in — but the mean k-DOP only nudges shape, never grows */
    var tFlyAEnd = scheduleFlyIn(tFlyA, avgPoly, CUMA_VERTS, 2.8);
    tl.to(proxyG, {
      attr: { transform: stageTf(PROXY_SCALE_A) }, duration: 0.75, ease: 'power2.inOut'
    }, tFlyAEnd);
    tl.to(stageBadge, { attr: { opacity: 1 }, duration: 0.35 }, tFlyAEnd + 0.3);
    tl.to(stageDotG, { attr: { opacity: 1 }, duration: 0.3 }, tFlyAEnd + 0.4);
    var tFitsAEnd = scheduleFits(tFlyAEnd + 0.75 + 0.15, AVG_CANDS, stageDots);
    /* distribute: children spring home, fits go tight BLUE on the frame */
    var tDistAEnd = distribute(tFitsAEnd + 0.1, function (j) {
      return FINAL_PARAS[j];
    }, BLUE, 0.04);
    tl.to(avgPoly, { attr: { opacity: 0.55 }, duration: 0.4 }, tDistAEnd - 0.3);
    tl.to(fitCand, { attr: { opacity: 0.4 }, duration: 0.4 }, tDistAEnd - 0.2);
    tl.to(sumG, { attr: { opacity: 1 }, duration: 0.45 }, tDistAEnd + 0.15);
    T = tDistAEnd + 0.7;
    tl.addLabel('s3', T);   /* avg distributed, marked, summary up */

    /* ---- s4 — closer: the avg winner locks ---- */
    tl.to(proxyG, { attr: { opacity: 0 }, duration: 0.4 }, T);
    tl.to(fitCand, { attr: { opacity: 0 }, duration: 0.35 }, T);
    tl.to(stageBadge, { attr: { opacity: 0 }, duration: 0.3 }, T);
    tl.to(stageDotG, { attr: { opacity: 0 }, duration: 0.3 }, T);
    tl.to(paras, {
      attr: { 'stroke-width': 2.4 }, duration: 0.55, ease: 'power2.inOut'
    }, T + 0.2);
    tl.to(closerCue, { attr: { opacity: 1 }, duration: 0.4 }, T + 0.3);
    tl.to(slotGlyphs, {
      attr: { opacity: 1 }, duration: 0.35, stagger: 0.04
    }, T + 0.5);
    T += 0.5 + 0.35 + 0.4;
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
    kdop6: kdop6,
    sortCorners: sortCorners,
    polyArea: polyArea,
    pts2str: pts2str,
    toStage: toStage,
    toStageU: toStageU,
    CHILDREN: CHILDREN,
    CENTROID: CENTROID,
    HEXVERTS: HEXVERTS,
    CHILD_EXTS: CHILD_EXTS,
    SHIFT_EXTS: SHIFT_EXTS,
    CUMU_EXTS: CUMU_EXTS,
    CUMU_VERTS: CUMU_VERTS,
    CUMA_EXTS: CUMA_EXTS,
    CUMA_VERTS: CUMA_VERTS,
    UNION_EXTS: UNION_EXTS,
    UNION_VERTS: UNION_VERTS,
    AVG_EXTS: AVG_EXTS,
    AVG_VERTS: AVG_VERTS,
    SUM_CANDS: SUM_CANDS,
    UNION_CANDS: UNION_CANDS,
    AVG_CANDS: AVG_CANDS,
    UNION_PARAS: UNION_PARAS,
    UNION_WIN: UNION_WIN,
    FINAL_PARAS: FINAL_PARAS,
    WIN_BASIS: WIN_BASIS,
    FAN_BASES: FAN_BASES,
    PROXY_SCALE_U: PROXY_SCALE_U,
    PROXY_SCALE_A: PROXY_SCALE_A,
    stageTf: stageTf,
    SHRINK: SHRINK,
    N1: N1, N2: N2,
    HEX_DIRS: HEX_DIRS,
    WIDE: WIDE, FRAME: FRAME, STAGE: STAGE,
    GLYPH_DEG: GLYPH_DEG,
    CHIPS: CHIPS,
    CHIP_FS: CHIP_FS,
    CAPTIONS: CAPTIONS,
    sections: SECTIONS,
    pacing: {
      MORPH: MORPH, HOLD: HOLD,
      FLY_STEP: FLY_STEP, FLY_DUR: FLY_DUR, FLY_MORPH: FLY_MORPH,
      FMORPH: FMORPH, FHOLD: FHOLD
    }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbasis = animator;
})();
