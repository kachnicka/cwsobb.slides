/* Animator: L3 "Fitting SOBBs — EG25 in one slide".
 *
 * How a SOBB is fitted from a k-DOP:
 *   base: triangle cluster + faint radial fan of 12 oriented slab pairs;
 *         the k-DOP (intersection of all slab pairs) as a dashed outline
 *   s1:   exactly 3 slab pairs highlight in blue, the rest fade
 *   s2:   the parallelogram spanned by those slab directions (the SOBB)
 *         draws tight around the cluster in blue (deck semantics: ours)
 *   s3:   SOBB emphasis (tint); fan and k-DOP recede
 *   s4:   promise beat — fills #kdop-promise and fades it in
 *
 * Geometry is fixed and seeded: the SOBB parallelogram is the intersection
 * of two cluster-tight slabs whose normals are fan members, so its edges
 * are collinear with two highlighted slab pairs and the third (bisector)
 * pair touches its wide corners. Host: #kdop-canvas. Fragments: 4 (s1..s4).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;

  /* ==================== LAYOUT DATA ==================== */

  var VB_W = 1040, VB_H = 560;
  var SEED = 20260919;
  var AXIS1 = 10, AXIS2 = 70;    // SOBB frame axes, degrees (60 deg apart)
  var S = 190, T = 105;          // cluster half-extents along each axis
  var TRI = 15;
  var CENTER = [470, 285];

  var FAN_OFF = 10;             // fan: 12 directions at 10 + 30k degrees
  var FAN_N = 12;
  var HILITE = [100, 130, 160];  // slab pairs kept at s1 (fan members:
                                 // 100 ⊥ AXIS1, 160 ⊥ AXIS2, 130 bisector)
  var MARGIN = 30;              // clip rect inside the viewBox

  var PROMISE_TEXT = 'This talk: static scenes first, then what changes when they move.';

  /* ==================== pure helpers ==================== */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rad(d) { return d * Math.PI / 180; }

  function perp(v) { return [-v[1], v[0]]; }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }

  function flatVerts(tris) {
    var out = [];
    tris.forEach(function (t) { out = out.concat(t); });
    return out;
  }

  function makeCluster() {
    var rand = mulberry32(SEED);
    var e1 = [Math.cos(rad(AXIS1)), Math.sin(rad(AXIS1))];
    var e2 = [Math.cos(rad(AXIS2)), Math.sin(rad(AXIS2))];
    var tris = [];
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 2; j++) {
        var s = -S + (2 * S) * i / 3 + (rand() - 0.5) * 0.06 * S;
        var t = -T + (2 * T) * j + (rand() - 0.5) * 0.06 * T;
        var cx = CENTER[0] + s * e1[0] + t * e2[0];
        var cy = CENTER[1] + s * e1[1] + t * e2[1];
        var a0 = rand() * 2 * Math.PI;
        var rr = TRI * (0.75 + rand() * 0.5);
        var tri = [];
        for (var k = 0; k < 3; k++) {
          var a = a0 + k * 2 * Math.PI / 3;
          tri.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
        }
        tris.push(tri);
      }
    }
    return tris;
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

  function frameFit(pts, c, u, v) {
    var nu = perp(u), nv = perp(v);
    var du = u[0] * nv[0] + u[1] * nv[1];
    var dv = v[0] * nu[0] + v[1] * nu[1];
    var s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    pts.forEach(function (p) {
      var s = ((p[0] - c[0]) * nv[0] + (p[1] - c[1]) * nv[1]) / du;
      var t = ((p[0] - c[0]) * nu[0] + (p[1] - c[1]) * nu[1]) / dv;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    });
    return { s0: s0, s1: s1, t0: t0, t1: t1 };
  }

  function parCorners(c, u, v, f) {
    return [
      [c[0] + f.s0 * u[0] + f.t0 * v[0], c[1] + f.s0 * u[1] + f.t0 * v[1]],
      [c[0] + f.s1 * u[0] + f.t0 * v[0], c[1] + f.s1 * u[1] + f.t0 * v[1]],
      [c[0] + f.s1 * u[0] + f.t1 * v[0], c[1] + f.s1 * u[1] + f.t1 * v[1]],
      [c[0] + f.s0 * u[0] + f.t1 * v[0], c[1] + f.s0 * u[1] + f.t1 * v[1]]
    ];
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* ==================== animator ==================== */

  var built = false;
  var svg, kdopEl, sobbEl, sobbLabelEl, promiseEl;
  var hiliteEls, faintEls;
  var sobbPathLen = 0;
  var sobbCorners = null, kdopPts = null;
  var tl = null;

  function build() {
    var tris = makeCluster();
    var pts = flatVerts(tris);
    var c = centroid(pts);
    var e1 = [Math.cos(rad(AXIS1)), Math.sin(rad(AXIS1))];
    var e2 = [Math.cos(rad(AXIS2)), Math.sin(rad(AXIS2))];

    var host = document.getElementById('kdop-canvas');
    svg = D.el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: '100%', height: '100%'
    }, host);

    // slab pairs, cluster-tight; the two SOBB-defining normals (100/160)
    // are fan members, so their lines end up collinear with the SOBB edges
    var slabs = [];
    for (var k = 0; k < FAN_N; k++) {
      var ang = FAN_OFF + k * 30;
      var n = [Math.cos(rad(ang)), Math.sin(rad(ang))];
      var ext = slabExtents(pts, n);
      slabs.push({ ang: ang, n: n, lo: ext[0], hi: ext[1] });
    }

    // fan lines first (behind everything), clipped to the margin rect
    var RECT = { x0: MARGIN, y0: MARGIN, x1: VB_W - MARGIN, y1: VB_H - MARGIN };
    hiliteEls = [];
    faintEls = [];
    slabs.forEach(function (s) {
      var isHilite = HILITE.indexOf(s.ang) >= 0;
      [s.lo, s.hi].forEach(function (m) {
        var pt = [s.n[0] * m, s.n[1] * m];
        var t = perp(s.n);
        var seg = clipSegRect(
          [pt[0] - 500 * t[0], pt[1] - 500 * t[1]],
          [pt[0] + 500 * t[0], pt[1] + 500 * t[1]],
          RECT
        );
        if (!seg) return;
        var line = D.el('line', {
          x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1],
          stroke: D.FAINT, 'stroke-width': 1, opacity: 0.55
        }, svg);
        (isHilite ? hiliteEls : faintEls).push(line);
      });
    });

    // triangles
    tris.forEach(function (tri) {
      D.el('polygon', { 'class': 'svg-tri', points: pts2str(tri) }, svg);
    });

    // k-DOP: intersection of all slab pairs (start from the clip rect)
    var kdop = [
      [RECT.x0, RECT.y0], [RECT.x1, RECT.y0],
      [RECT.x1, RECT.y1], [RECT.x0, RECT.y1]
    ];
    slabs.forEach(function (s) {
      kdop = clipHalf(kdop, s.n, s.hi);
      kdop = clipHalf(kdop, [-s.n[0], -s.n[1]], -s.lo);
    });
    // drop consecutive duplicates from degenerate clips
    kdopPts = kdop.filter(function (p, i) {
      var q = kdop[(i + 1) % kdop.length];
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.5;
    });
    // ink (not faint): the dashed hull must read against 24 same-gray fan
    // lines crossing the same region; it recedes to 0.35/0.2 later anyway
    kdopEl = D.el('polygon', {
      points: pts2str(kdopPts),
      fill: 'none', stroke: D.INK, 'stroke-width': 1.3,
      'stroke-dasharray': '6 5', 'stroke-linejoin': 'round'
    }, svg);

    D.text('K-DOP = SLAB PAIRS', {
      'class': 'svg-side-label', x: 748, y: 88
    }, svg);

    // the SOBB: parallelogram spanned by the skewed frame, tight on the
    // cluster — drawn on at s2 via a stroke-dashoffset sweep
    sobbCorners = parCorners(c, e1, e2, frameFit(pts, c, e1, e2));
    sobbEl = D.el('polygon', {
      points: pts2str(sobbCorners),
      fill: D.BLUE, 'fill-opacity': 0,
      stroke: D.BLUE, 'stroke-width': 2, 'stroke-linejoin': 'round',
      opacity: 0
    }, svg);
    sobbPathLen = sobbEl.getTotalLength();
    sobbEl.setAttribute('stroke-dasharray', sobbPathLen);
    sobbEl.setAttribute('stroke-dashoffset', sobbPathLen);

    var top = sobbCorners.reduce(function (a, p) { return p[1] < a[1] ? p : a; });
    sobbLabelEl = D.text('SOBB', {
      x: top[0], y: top[1] - 14, 'text-anchor': 'middle',
      fill: D.BLUE, 'font-size': 20, 'font-weight': 600, opacity: 0
    }, svg);

    promiseEl = document.getElementById('kdop-promise');
    built = true;
  }

  function resetState() {
    gsap.killTweensOf(faintEls);
    gsap.killTweensOf(hiliteEls);
    gsap.killTweensOf([kdopEl, sobbEl, sobbLabelEl, promiseEl]);
    hiliteEls.forEach(function (l) {
      l.setAttribute('stroke', D.FAINT);
      l.setAttribute('stroke-width', 1);
      l.setAttribute('opacity', 0.55);
    });
    faintEls.forEach(function (l) { l.setAttribute('opacity', 0.55); });
    kdopEl.setAttribute('opacity', 1);
    sobbEl.setAttribute('opacity', 0);
    sobbEl.setAttribute('stroke-dashoffset', sobbPathLen);
    sobbEl.setAttribute('fill-opacity', 0);
    sobbEl.setAttribute('stroke-width', 2);
    sobbLabelEl.setAttribute('opacity', 0);
    promiseEl.textContent = PROMISE_TEXT;
    gsap.set(promiseEl, { opacity: 0 });
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: exactly 3 slab pairs highlight, the rest recede
    tl.to(hiliteEls, {
      attr: { stroke: D.BLUE, 'stroke-width': 2.4 },
      duration: 0.6, ease: 'power1.out'
    }, 0);
    tl.to(faintEls, {
      attr: { opacity: 0.18 }, duration: 0.6, ease: 'power1.out'
    }, 0);
    tl.to(kdopEl, { attr: { opacity: 0.35 }, duration: 0.6 }, 0);
    tl.addLabel('s1', 0.9);

    // s2: the SOBB draws tight around the cluster
    tl.to(sobbEl, {
      attr: { opacity: 1, 'stroke-dashoffset': 0 },
      duration: 1.1, ease: 'power2.inOut'
    }, 's1+=0.25');
    tl.to(sobbLabelEl, {
      attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out'
    }, 's1+=1.0');
    tl.addLabel('s2', 's1+=1.45');

    // s3: emphasize the SOBB, let the fan and k-DOP recede further
    tl.to(sobbEl, {
      attr: { 'fill-opacity': 0.08, 'stroke-width': 2.6 },
      duration: 0.6, ease: 'power1.inOut'
    }, 's2+=0.25');
    tl.to(faintEls, { attr: { opacity: 0.1 }, duration: 0.6 }, 's2+=0.25');
    tl.to(kdopEl, { attr: { opacity: 0.2 }, duration: 0.6 }, 's2+=0.25');
    tl.addLabel('s3', 's2+=0.95');

    // s4: promise beat (HTML caption element)
    tl.fromTo(promiseEl,
      { opacity: 0 },
      { opacity: 1, duration: 0.55, ease: 'power1.out', immediateRender: false },
      's3+=0.2');
    tl.addLabel('s4', 's3+=0.85');
  }

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetState();
      buildTimeline();
      if (fragStep > 0) tl.seek(D.stopsFor(tl, 4)[fragStep], true);
      gsap.fromTo(svg,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(D.stopsFor(tl, 4)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  // expose pure geometry for headless smoke tests
  animator._test = {
    kdopPts: function () { return kdopPts; },
    sobbCorners: function () { return sobbCorners; }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.kdopfan = animator;
})();
