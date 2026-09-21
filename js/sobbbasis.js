/* SOBB basis animator — paper Fig. 3 (2D version).
 *
 * s1: three child k-DOP polygons; a blue PROXY polygon forms by
 *     averaging their per-direction slab extents
 * s2: the proxy rotates through candidate bases
 * s3: lowest-cost basis locks in
 * s4: red tight SKEWED boxes (parallelograms from two non-orthogonal
 *     slab pairs) fit around every child in that basis
 *
 * The skewed box is a genuine 2D SOBB: the intersection of two slab
 * pairs with non-orthogonal normals n1, n2, fit exactly to the child
 * vertices (min/max projections). Pure math exported for the harness.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT;

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 560) ==================== */

  /* three child k-DOP hexagons: center, radius, rotation */
  var CHILDREN = [
    { c: [300, 300], r: 78, rot: 12 },
    { c: [560, 235], r: 68, rot: 34 },
    { c: [825, 315], r: 84, rot: -18 }
  ];
  var PROXY_C = [560, 300];

  /* proxy k: 4 axes -> octagon */
  var PROXY_AXES = [0, 45, 90, 135].map(function (d) { return [Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180)]; });

  /* candidate basis rotations (degrees) applied to the proxy */
  var CANDIDATES = [0, 14, 26, 36];
  var BEST = 2;                     // index of winning candidate
  var SKEW_OFF = 66;                // degrees between slab normals n1, n2

  var CAPTIONS = [
    'Fitting SOBBs: one shared oriented basis for all children.',
    'Three ways to price a candidate basis: exact sum, quick union, or an averaged proxy.',
    'Merge child k-DOPs into one averaged proxy.',
    'Rotate the proxy through candidate bases.',
    'Lock the lowest-cost basis.',
    'Fit tight skewed boxes to every child in that basis — cheaper than summing children, smarter than the union.'
  ];

  /* cost-function comparison strip: C_sum (fit each child, then add areas —
   * accurate, expensive), C_union (one box around everyone — cheap, blind
   * to overlap), C_avg (our proxy — cheap, close enough). x aligned with
   * the three children below for a visual echo. */
  var COST_GLYPHS = [
    { x: 300, kind: 'sum', l1: 'per-child sum', l2: 'exact · slow' },
    { x: 560, kind: 'union', l1: 'one union box', l2: 'cheap · loose' },
    { x: 820, kind: 'avg', l1: 'averaged proxy', l2: 'cheap · tight enough' }
  ];
  var GLYPH_Y = 40;

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

  /* proxy polygon: average of child slab extents per axis direction,
   * both directions ±n share the same normal axis */
  function proxyPolygon(center, childVerts, axes) {
    var corners = [];
    axes.forEach(function (n) {
      // average extents across children
      var amn = 0, amx = 0;
      childVerts.forEach(function (verts) {
        // express child verts relative to the proxy center so slabs are comparable
        var pr = project(verts.map(function (p) {
          return [p[0] - center[0], p[1] - center[1]];
        }), n);
        amn += pr[0]; amx += pr[1];
      });
      amn /= childVerts.length; amx /= childVerts.length;

      // scale rmin/rmax down: the proxy is a shape, not a bound
      var r = (Math.abs(amn) + Math.abs(amx)) / 2 * 0.62;
      corners.push([center[0] - n[0] * r, center[1] - n[1] * r]);
      corners.push([center[0] + n[0] * r, center[1] + n[1] * r]);
    });
    // order corners by angle about the center
    corners.sort(function (a, b) {
      return Math.atan2(a[1] - center[1], a[0] - center[0]) -
             Math.atan2(b[1] - center[1], b[0] - center[0]);
    });
    return corners;
  }

  /* 2D SOBB = intersection of slabs (n1,[a1,b1]) and (n2,[a2,b2]);
   * corners from solving the 2x2 systems. Returns 4 corners ordered. */
  function solveCorner(n1, n2, a, b) {
    var det = n1[0] * n2[1] - n1[1] * n2[0];
    return [
      (a * n2[1] - n1[1] * b) / det,
      (n1[0] * b - a * n2[0]) / det
    ];
  }

  function fitSkew(verts, n1, n2, pad) {
    var p1 = project(verts, n1), p2 = project(verts, n2);
    var a1 = p1[0] - pad, b1 = p1[1] + pad;
    var a2 = p2[0] - pad, b2 = p2[1] + pad;
    var cs = [
      solveCorner(n1, n2, a1, a2),
      solveCorner(n1, n2, b1, a2),
      solveCorner(n1, n2, b1, b2),
      solveCorner(n1, n2, a1, b2)
    ];
    return cs;
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* small pictogram for one cost-function option: three dots stand in for
   * the wide node's children, with a per-kind overlay showing how each
   * function would bound them. */
  function buildCostGlyph(g, svg) {
    var grp = el('g', { opacity: 0 }, svg);
    var offs = [[-13, 5], [0, -11], [13, 5]];
    offs.forEach(function (o) {
      el('circle', { cx: g.x + o[0], cy: GLYPH_Y + o[1], r: 3.2, fill: INK }, grp);
    });
    if (g.kind === 'sum') {
      offs.forEach(function (o) {
        el('rect', {
          x: g.x + o[0] - 7, y: GLYPH_Y + o[1] - 7, width: 14, height: 14,
          fill: 'none', stroke: RED, 'stroke-width': 1.3
        }, grp);
      });
    } else if (g.kind === 'union') {
      el('rect', {
        x: g.x - 26, y: GLYPH_Y - 20, width: 52, height: 40,
        fill: 'none', stroke: INK, 'stroke-width': 1.3, 'stroke-dasharray': '4 3'
      }, grp);
    } else {
      el('polygon', {
        points: pts2str(hexagon([g.x, GLYPH_Y], 24, 0)),
        fill: '#eaf2fd', 'fill-opacity': 0.6, stroke: BLUE,
        'stroke-width': 1.6, 'stroke-linejoin': 'round'
      }, grp);
      text('✓', {
        x: g.x + 35, y: GLYPH_Y + 5, 'text-anchor': 'middle',
        'font-size': 16, fill: BLUE, 'font-weight': 700
      }, grp);
    }
    text(g.l1, {
      x: g.x, y: GLYPH_Y + 35, 'text-anchor': 'middle', 'font-size': 12.5,
      fill: g.kind === 'avg' ? BLUE : INK
    }, grp);
    text(g.l2, {
      x: g.x, y: GLYPH_Y + 50, 'text-anchor': 'middle', 'font-size': 10.5, fill: FAINT
    }, grp);
    return grp;
  }

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var childPolys = [], childVerts = [];
  var proxyG, proxyPoly;
  var candText;
  var lockRing;
  var skewPolys = [], skewTargets = [];
  var costGlyphs = [];
  var captionEl;
  var tl = null;

  function build() {
    var host = document.getElementById('sobb-canvas');
    svg = el('svg', { viewBox: '0 0 1120 560', width: '100%', height: '100%' }, host);

    /* children k-DOP polygons (black) */
    CHILDREN.forEach(function (ch) {
      var verts = hexagon(ch.c, ch.r, ch.rot);
      childVerts.push(verts);
      childPolys.push(el('polygon', {
        points: pts2str(verts),
        fill: '#f4f6fa', stroke: INK, 'stroke-width': 1.4, 'stroke-linejoin': 'round'
      }, svg));
    });

    /* skewed box targets, computed for the winning basis */
    var ang = CANDIDATES[BEST] * Math.PI / 180;
    var n1 = [Math.cos(ang), Math.sin(ang)];
    var ang2 = (CANDIDATES[BEST] + SKEW_OFF) * Math.PI / 180;
    var n2 = [Math.cos(ang2), Math.sin(ang2)];
    childVerts.forEach(function (verts) {
      var corners = fitSkew(verts, n1, n2, 10);
      skewTargets.push(corners);
      var p = el('polygon', {
        points: pts2str(corners),
        fill: 'none', stroke: RED, 'stroke-width': 2, 'stroke-linejoin': 'round',
        opacity: 0
      }, svg);
      skewPolys.push(p);
    });

    /* proxy: group carries the candidate rotations */
    var proxyCorners = proxyPolygon(PROXY_C, childVerts, PROXY_AXES);
    proxyG = el('g', {
      transform: 'rotate(0 ' + PROXY_C[0] + ' ' + PROXY_C[1] + ')'
    }, svg);
    proxyPoly = el('polygon', {
      points: pts2str(proxyCorners),
      fill: '#eaf2fd', 'fill-opacity': 0.55, stroke: BLUE,
      'stroke-width': 1.6, 'stroke-linejoin': 'round'
    }, proxyG);

    candText = text('candidate 1/' + CANDIDATES.length, {
      x: PROXY_C[0], y: 96, 'text-anchor': 'middle', 'font-size': 16, fill: FAINT
    }, svg);

    /* lock ring around the proxy center for the selection beat */
    lockRing = el('rect', {
      x: PROXY_C[0] - 120, y: PROXY_C[1] - 120, width: 240, height: 240,
      rx: 10, fill: 'none', stroke: BLUE, 'stroke-width': 2,
      'stroke-dasharray': '6 5', opacity: 0,
      transform: 'rotate(45 ' + PROXY_C[0] + ' ' + PROXY_C[1] + ')'
    }, svg);

    COST_GLYPHS.forEach(function (g) {
      costGlyphs.push(buildCostGlyph(g, svg));
    });

    captionEl = document.getElementById('sobb-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    childPolys.forEach(function (p) {
      gsap.killTweensOf(p);
      p.setAttribute('opacity', 1);
    });
    gsap.killTweensOf(proxyPoly);
    proxyPoly.setAttribute('opacity', 0);
    proxyPoly.setAttribute('stroke-width', 1.6);
    gsap.killTweensOf(proxyG);
    proxyG.setAttribute('transform', 'rotate(0 ' + PROXY_C[0] + ' ' + PROXY_C[1] + ')');
    proxyG.setAttribute('opacity', 1);
    gsap.killTweensOf(candText);
    candText.setAttribute('opacity', 0);
    candText.textContent = 'candidate 1/' + CANDIDATES.length;
    gsap.killTweensOf(lockRing);
    lockRing.setAttribute('opacity', 0);
    skewPolys.forEach(function (p) {
      gsap.killTweensOf(p);
      p.setAttribute('opacity', 0);
    });
    costGlyphs.forEach(function (g) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
    });
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 5;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — three ways to price a candidate basis */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    tl.to(costGlyphs, { attr: { opacity: 1 }, duration: 0.4, stagger: 0.18 }, at);
    tl.addLabel('s1', tl.duration()); /* label at true timeline end */

    /* s2 — proxy forms, cost triad recedes */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.to(costGlyphs, { attr: { opacity: 0 }, duration: 0.4 }, at);
    tl.fromTo(proxyPoly, { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.7, ease: 'power1.out' }, at + 0.15);
    tl.addLabel('s2', tl.duration()); /* label at true timeline end */

    /* s3 — rotate through candidate bases */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.to(candText, { attr: { opacity: 1 }, duration: 0.3 }, at);
    CANDIDATES.forEach(function (deg, i) {
      if (i === 0) return;
      var when = at + i * 0.7;
      tl.to(proxyG, {
        attr: { transform: 'rotate(' + deg + ' ' + PROXY_C[0] + ' ' + PROXY_C[1] + ')' },
        duration: 0.55, ease: 'power1.inOut'
      }, when);
      tl.add(function () {
        candText.textContent = 'candidate ' + (i + 1) + '/' + CANDIDATES.length;
      }, when);
    });
    tl.addLabel('s3', tl.duration()); /* label at true timeline end */

    /* s4 — best basis wins: settle back onto the winner and lock */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    var win = CANDIDATES[BEST];
    tl.to(proxyG, {
      attr: { transform: 'rotate(' + win + ' ' + PROXY_C[0] + ' ' + PROXY_C[1] + ')' },
      duration: 0.5, ease: 'power2.inOut'
    }, at);
    tl.to(proxyPoly, { attr: { 'stroke-width': 2.6 }, duration: 0.35 }, at + 0.4);
    tl.add(function () { candText.textContent = 'basis locked'; }, at + 0.4);
    /* set() + to(), not fromTo(): fromTo's immediateRender applies its
     * "from" value at build time regardless of where it sits on the
     * timeline, which would flash the ring visible from frag 0. */
    tl.set(lockRing, { attr: { opacity: 0.9 } }, at + 0.5);
    tl.to(lockRing, { attr: { opacity: 0 }, duration: 0.8, ease: 'power1.out' }, at + 0.5);
    tl.addLabel('s4', tl.duration()); /* label at true timeline end */

    /* s5 — red skewed boxes fit every child */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    skewPolys.forEach(function (p, i) {
      tl.to(p, { attr: { opacity: 1 }, duration: 0.5, ease: 'power1.out' }, at + i * 0.12);
    });
    /* fully clear, not dimmed: a lingering ghost proxy behind the red
     * boxes reads as an unexplained leftover shape once the timeline
     * settles on this final frame. */
    tl.to(proxyG, { attr: { opacity: 0 }, duration: 0.5 }, at);
    tl.to(candText, { attr: { opacity: 0 }, duration: 0.4 }, at);
    tl.addLabel('s5', tl.duration()); /* label at true timeline end */
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
    hexagon: hexagon,
    fitSkew: fitSkew,
    solveCorner: solveCorner,
    project: project,
    CANDIDATES: CANDIDATES, BEST: BEST, SKEW_OFF: SKEW_OFF,
    CHILDREN: CHILDREN,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbasis = animator;
})();
