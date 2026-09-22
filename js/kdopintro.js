/* Animator: L2.5 "From slab pairs to a k-DOP".
 *
 * What a k-DOP is, built up one slab pair at a time:
 *   base: the shared triangle cluster alone (side label GEOMETRY)
 *   s1:   first three slab pairs (70, 40, 10 deg) draw on in their
 *         identity colors; a light blue fill shows the running
 *         intersection shrinking after each pair lands (GEOMETRY fades)
 *   s2:   remaining three slab pairs (160, 130, 100 deg) accumulate the
 *         same way, ending at the full 12-half-plane k-DOP
 *   s3:   the dashed ink k-DOP outline affirms + the gray side label
 *         "K-DOP = SLAB PAIRS"; the fill fades out and the colored slab
 *         lines recede to 0.55 — the exact base state of the L3 slide
 *         (slide-fit / kdopfan), for a seamless fade across slides
 *
 * Geometry is the shared deterministic cluster (DeckSVG.makeCluster at
 * 470,285); the panel reads as one continuous diagram across the L2.5→L3
 * fade. Host: #kdopintro-canvas. Fragments: 3 (s1..s3).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;

  /* ==================== LAYOUT DATA ==================== */

  var VB_W = 1040, VB_H = 560;
  var CENTER = [470, 285];
  var MARGIN = 30;               // clip rect inside the viewBox

  var FAN_OFF = 10;              // k-DOP: 12 directions at 10 + 30k deg
  var FAN_N = 12;

  /* the 6 unique slab pairs, in accumulation order — interleaved so each
   * added pair visibly cuts the running intersection (area drops per
   * step: 23.0 / 15.8 / 28.1 / 32.9 / 14.4 / 31.3 %; best worst-case
   * drop over all 720 orders). s1 gets the first three, s2 the rest. */
  var PAIRS = [
    { ang: 70,  color: 'ROSE' },
    { ang: 40,  color: 'VIOLET' },
    { ang: 10,  color: 'BLUE' },
    { ang: 160, color: 'AMBER' },
    { ang: 130, color: 'SLATE' },
    { ang: 100, color: 'TEAL' }
  ];

  var LINE_W = 2;                // slab line weight
  var RECEDE = 0.5;              // slab line opacity at rest (L3 base: LS_BASE 0.5)
  var FILL_OP = 0.07;            // running-intersection fill opacity

  /* ==================== pure helpers ==================== */

  function rad(d) { return d * Math.PI / 180; }

  function perp(v) { return [-v[1], v[0]]; }

  function flatVerts(tris) {
    var out = [];
    tris.forEach(function (t) { out = out.concat(t); });
    return out;
  }

  function slabExtents(pts, n) {
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    });
    return [lo, hi];
  }

  /* Sutherland-Hodgman: clip polygon by half-plane n·p <= m. */
  function clipHalf(poly, n, m) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var dp = p[0] * n[0] + p[1] * n[1];
      var dq = q[0] * n[0] + q[1] * n[1];
      if (dp <= m) out.push(p);
      if ((dp < m && dq > m) || (dp > m && dq < m)) {
        var t = (m - dp) / (dq - dp);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return out;
  }

  /* drop consecutive duplicates from degenerate clips */
  function dedupe(poly) {
    return poly.filter(function (p, i) {
      var q = poly[(i + 1) % poly.length];
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.5;
    });
  }

  /* Clip segment a→b to rect [x0,y0,x1,y1]; null if fully outside. */
  function clipSegRect(a, b, r) {
    var t0 = 0, t1 = 1;
    var d = [b[0] - a[0], b[1] - a[1]];
    var edges = [
      { n: [1, 0], m: r.x1 }, { n: [-1, 0], m: -r.x0 },
      { n: [0, 1], m: r.y1 }, { n: [0, -1], m: -r.y0 }
    ];
    for (var i = 0; i < edges.length; i++) {
      var dn = d[0] * edges[i].n[0] + d[1] * edges[i].n[1];
      var an = a[0] * edges[i].n[0] + a[1] * edges[i].n[1];
      if (Math.abs(dn) < 1e-9) { if (an > edges[i].m) return null; }
      else {
        var t = (edges[i].m - an) / dn;
        if (dn > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
      }
    }
    if (t0 > t1) return null;
    return [
      [a[0] + t0 * d[0], a[1] + t0 * d[1]],
      [a[0] + t1 * d[0], a[1] + t1 * d[1]]
    ];
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  function marginRectPts() {
    return [
      [MARGIN, MARGIN], [VB_W - MARGIN, MARGIN],
      [VB_W - MARGIN, VB_H - MARGIN], [MARGIN, VB_H - MARGIN]
    ];
  }

  /* Running intersection of the first (count) pairs in accumulation
   * order, against the margin rect (unclipped sides run to the margin). */
  function intersectOf(slabs, count) {
    var poly = marginRectPts();
    for (var i = 0; i < count && i < slabs.length; i++) {
      var s = slabs[i];
      poly = clipHalf(poly, s.n, s.hi);
      poly = clipHalf(poly, [-s.n[0], -s.n[1]], -s.lo);
    }
    return dedupe(poly);
  }

  /* ==================== animator ==================== */

  var built = false;
  var svg, kdopEl, kdopSideLabelEl, geoLabelEl;
  var lineEls = [];        // per pair: [lineLo, lineHi]
  var lineLens = [];       // per pair: [lenLo, lenHi]
  var fillEls = [];        // running-intersection polys, one per pair count
  var allLines = [];
  var kdopPts = null, slabsData = null, intersections = null;
  var tl = null;

  function build() {
    var cluster = D.makeCluster(CENTER[0], CENTER[1]);
    var tris = cluster.tris;
    var pts = flatVerts(tris);

    var host = document.getElementById('kdopintro-canvas');
    svg = D.el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: '100%', height: '100%'
    }, host);

    var RECT = { x0: MARGIN, y0: MARGIN, x1: VB_W - MARGIN, y1: VB_H - MARGIN };

    // cluster-tight slab extents, one entry per pair in accumulation order
    slabsData = PAIRS.map(function (p) {
      var n = [Math.cos(rad(p.ang)), Math.sin(rad(p.ang))];
      var ext = slabExtents(pts, n);
      return { ang: p.ang, n: n, lo: ext[0], hi: ext[1], color: D[p.color] };
    });

    // final k-DOP: identical construction to kdopfan — clip the margin
    // rect by all 12 half-planes (10 + 30k deg), then dedupe
    var kdop = marginRectPts();
    for (var k = 0; k < FAN_N; k++) {
      var n = [Math.cos(rad(FAN_OFF + k * 30)), Math.sin(rad(FAN_OFF + k * 30))];
      var ext = slabExtents(pts, n);
      kdop = clipHalf(kdop, n, ext[1]);
      kdop = clipHalf(kdop, [-n[0], -n[1]], -ext[0]);
    }
    kdopPts = dedupe(kdop);

    // running intersections (after 1..6 pairs), one polygon each —
    // different vertex counts per step, so they crossfade rather than tween
    intersections = [];
    for (var c = 1; c <= slabsData.length; c++) {
      intersections.push(intersectOf(slabsData, c));
    }

    // running-intersection fills first (bottom of the z stack)
    fillEls = intersections.map(function (poly) {
      return D.el('polygon', {
        points: pts2str(poly),
        fill: D.BLUE, 'fill-opacity': 0, stroke: 'none'
      }, svg);
    });

    // colored slab boundary lines, clipped to the margin rect
    lineEls = [];
    lineLens = [];
    allLines = [];
    slabsData.forEach(function (s) {
      var pair = [], lens = [];
      [s.lo, s.hi].forEach(function (m) {
        var pt = [s.n[0] * m, s.n[1] * m];
        var t = perp(s.n);
        // extend the slab line far past the panel on both sides before
        // clipping — 500 was too short for off-center feet, leaving steep
        // lines stranded mid-rect; 2000 covers any chord across 1040x560
        var seg = clipSegRect(
          [pt[0] - 2000 * t[0], pt[1] - 2000 * t[1]],
          [pt[0] + 2000 * t[0], pt[1] + 2000 * t[1]],
          RECT
        );
        if (!seg) return;
        // no stroke-linecap: must match kdopfan's butt caps pixel-for-
        // pixel — and round caps would render the zero-length dash at the
        // hidden path end (dasharray=len, dashoffset=len) as a stray dot
        var line = D.el('line', {
          x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1],
          stroke: s.color, 'stroke-width': LINE_W, opacity: 1
        }, svg);
        var len = Math.hypot(
          seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
        line.setAttribute('stroke-dasharray', len);
        line.setAttribute('stroke-dashoffset', len);
        pair.push(line); lens.push(len); allLines.push(line);
      });
      lineEls.push(pair); lineLens.push(lens);
    });

    // triangles
    tris.forEach(function (tri) {
      D.el('polygon', { 'class': 'svg-tri', points: pts2str(tri) }, svg);
    });

    // solid ink k-DOP outline — the payoff, affirmed at s3 (slide-fit
    // base state: same ink, same polygon, width 2.2, no dash)
    kdopEl = D.el('polygon', {
      points: pts2str(kdopPts),
      fill: 'none', stroke: D.INK, 'stroke-width': 2.2,
      'stroke-linejoin': 'round',
      opacity: 0
    }, svg);

    // side label EXACTLY as kdopfan's base (gray class styling, 748,88)
    // — faded in at s3 so the final state matches slide-fit pixel-for-
    // pixel across the fade transition
    kdopSideLabelEl = D.text('K-DOP = SLAB PAIRS', {
      'class': 'svg-side-label', x: 748, y: 88, opacity: 0
    }, svg);

    geoLabelEl = D.text('GEOMETRY', {
      'class': 'svg-side-label', x: 60, y: 82, opacity: 0.85
    }, svg);

    built = true;
  }

  function resetState() {
    gsap.killTweensOf(allLines);
    gsap.killTweensOf(fillEls);
    gsap.killTweensOf([kdopEl, kdopSideLabelEl, geoLabelEl]);
    lineEls.forEach(function (pair, i) {
      pair.forEach(function (line, j) {
        line.setAttribute('stroke-dashoffset', lineLens[i][j]);
        line.setAttribute('opacity', 1);
        line.setAttribute('stroke-width', LINE_W);
      });
    });
    fillEls.forEach(function (f) { f.setAttribute('fill-opacity', 0); });
    kdopEl.setAttribute('opacity', 0);
    kdopSideLabelEl.setAttribute('opacity', 0);
    geoLabelEl.setAttribute('opacity', 0.85);
  }

  /* pair i draws on (both boundary lines sweep in) and the running
   * intersection crossfades to its new, tighter polygon — slow enough
   * that each clip reads as its own beat (~1.1s sweep, fill lands as
   * the lines settle) */
  function paintPair(pos, i) {
    tl.to(lineEls[i], {
      attr: { 'stroke-dashoffset': 0 },
      duration: 1.1, ease: 'power1.inOut'
    }, pos);
    if (i > 0) {
      tl.to(fillEls[i - 1], {
        attr: { 'fill-opacity': 0 }, duration: 0.55, ease: 'power1.inOut'
      }, pos + 0.7);
    }
    tl.to(fillEls[i], {
      attr: { 'fill-opacity': FILL_OP }, duration: 0.55, ease: 'power1.out'
    }, pos + 0.7);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: first three slab pairs arrive, the region visibly shrinks;
    // the GEOMETRY label retires once the slabs take over the story
    tl.to(geoLabelEl, {
      attr: { opacity: 0 }, duration: 0.4, ease: 'power1.inOut'
    }, 0);
    paintPair(0, 0);
    paintPair(0.95, 1);
    paintPair(1.9, 2);
    tl.addLabel('s1', 3.5);

    // s2: the rest accumulate — full 12-half-plane k-DOP
    paintPair('s1+=0.2', 3);
    paintPair('s1+=1.15', 4);
    paintPair('s1+=2.1', 5);
    tl.addLabel('s2', 's1+=3.5');

    // s3: name it — dashed outline + K-DOP label carry the meaning,
    // fill fades out, colored lines recede to their L3 rest state
    tl.to(fillEls[5], {
      attr: { 'fill-opacity': 0 }, duration: 0.6, ease: 'power1.inOut'
    }, 's2+=0.25');
    tl.to(kdopEl, {
      attr: { opacity: 1 }, duration: 0.55, ease: 'power1.out'
    }, 's2+=0.3');
    tl.to(allLines, {
      // opacity AND width: the rest state must equal slide-fit's base
      // lines (LS_BASE 0.5 / 1.3) for a clean cross-slide handoff
      attr: { opacity: RECEDE, 'stroke-width': 1.3 },
      duration: 0.6, ease: 'power1.inOut'
    }, 's2+=0.35');
    tl.to(kdopSideLabelEl, {
      attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out'
    }, 's2+=0.8');
    tl.addLabel('s3', 's2+=1.35');
  }

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetState();
      buildTimeline();
      if (fragStep > 0) tl.seek(D.stopsFor(tl, 3)[fragStep], true);
      gsap.fromTo(svg,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(D.stopsFor(tl, 3)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  // expose pure geometry for headless smoke tests
  animator._test = {
    kdopPts: function () { return kdopPts; },
    slabs: function () { return slabsData; },
    intersections: function () { return intersections; }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.kdopintro = animator;
})();
