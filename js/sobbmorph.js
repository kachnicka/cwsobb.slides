/* Animator: L2 "What is a SOBB?" — stacking bounds: AABB → OBB → SOBB.
 *
 * One deterministic triangle cluster (DeckSVG.makeCluster, shared with
 * L3 kdopfan), fitted three ways, and all three bounds stay on screen:
 *   base: tight AABB in ink (SA = 100%)
 *   s1:   tight OBB draws in over it in blue (frame e1, perp(e1), ~80%);
 *         the AABB recedes
 *   s2:   tight SOBB draws in the same way in teal (frame e1, e2, ~65%);
 *         the OBB recedes
 *   s3:   #sobb-ineq caption (AABB ⊆ OBB ⊆ SOBB)
 *   s4:   #sobb-saineq caption (SA(AABB) ≥ SA(OBB) ≥ SA(SOBB))
 * The right-column rows #bv-obb / #bv-sobb fade in at s1 / s2 with
 * computed area percentages. Host: #morph-canvas. Fragments: 4 (s1..s4).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;

  /* ==================== LAYOUT DATA ==================== */

  var VB_W = 800, VB_H = 540;     // logical viewBox (SVG scales to the slot)
  var CENTER = [385, 275];        // cluster center

  /* ==================== pure helpers ==================== */

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

  function aabbPts(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* Tight box in the (possibly skewed) basis (u, v) around pts:
   * p - c = s*u + t*v, so s is read out with the normal of v and vice
   * versa. Corners come out in (s,t) sign order: (-,-), (+,-), (+,+), (-,+). */
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

  function polyArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* ==================== animator ==================== */

  var built = false;
  var svg, aabbEl, obbEl, obbLabelEl, sobbEl, sobbLabelEl;
  var bvObb, bvSobb, bvObbSa, bvSobbSa, capIneq, capSa;
  var aabbC, obbC, sobbC, areaStrs;
  var obbLen = 0, sobbLen = 0;
  var tl = null;

  function build() {
    var cl = D.makeCluster(CENTER[0], CENTER[1]);
    var tris = cl.tris;
    var pts = flatVerts(tris);
    var c = centroid(pts);
    var e1 = cl.e1, e2 = cl.e2;
    var v1 = perp(e1);

    // the three tight fits
    var b = aabbPts(pts);
    aabbC = [
      [b.x, b.y], [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]
    ];
    obbC = parCorners(c, e1, v1, frameFit(pts, c, e1, v1));
    sobbC = parCorners(c, e1, e2, frameFit(pts, c, e1, e2));

    var a0 = b.w * b.h;
    areaStrs = [
      'SA = 100%',
      'SA = ' + Math.round(polyArea(obbC) / a0 * 100) + '%',
      'SA = ' + Math.round(polyArea(sobbC) / a0 * 100) + '%'
    ];

    var host = document.getElementById('morph-canvas');
    svg = D.el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: '100%', height: '100%'
    }, host);

    tris.forEach(function (tri) {
      D.el('polygon', { 'class': 'svg-tri', points: pts2str(tri) }, svg);
    });

    // AABB: ink, always present from the base state
    aabbEl = D.el('polygon', {
      points: pts2str(aabbC),
      fill: 'none',
      stroke: D.INK, 'stroke-width': 1.6, 'stroke-opacity': 1,
      'stroke-linejoin': 'round'
    }, svg);
    D.text('AABB', {
      x: 156, y: 112,
      fill: D.INK, 'font-size': 16, 'font-weight': 600
    }, svg);

    // OBB: blue, swept on at s1 (stroke-dashoffset draw, kdopfan pattern)
    obbEl = D.el('polygon', {
      points: pts2str(obbC),
      fill: D.BLUE, 'fill-opacity': 0,
      stroke: D.BLUE, 'stroke-width': 2, 'stroke-opacity': 1,
      'stroke-linejoin': 'round', opacity: 0
    }, svg);
    obbLen = obbEl.getTotalLength();
    obbEl.setAttribute('stroke-dasharray', obbLen);
    obbEl.setAttribute('stroke-dashoffset', obbLen);
    obbLabelEl = D.text('SA(OBB)', {
      x: 666, y: 218,
      fill: D.BLUE, 'font-size': 18, 'font-weight': 600, opacity: 0
    }, svg);

    // SOBB: teal, swept on at s2 the same way
    sobbEl = D.el('polygon', {
      points: pts2str(sobbC),
      fill: D.TEAL, 'fill-opacity': 0,
      stroke: D.TEAL, 'stroke-width': 2,
      'stroke-linejoin': 'round', opacity: 0
    }, svg);
    sobbLen = sobbEl.getTotalLength();
    sobbEl.setAttribute('stroke-dasharray', sobbLen);
    sobbEl.setAttribute('stroke-dashoffset', sobbLen);
    sobbLabelEl = D.text('SA(SOBB)', {
      x: 540, y: 460,
      fill: D.TEAL, 'font-size': 18, 'font-weight': 600, opacity: 0
    }, svg);

    // right-column rows + caption lines (start visible in CSS; hidden here)
    bvObb = document.getElementById('bv-obb');
    bvSobb = document.getElementById('bv-sobb');
    bvObbSa = document.getElementById('bv-obb-sa');
    bvSobbSa = document.getElementById('bv-sobb-sa');
    capIneq = document.getElementById('sobb-ineq');
    capSa = document.getElementById('sobb-saineq');
    bvObbSa.textContent = areaStrs[1];
    bvSobbSa.textContent = areaStrs[2];

    built = true;
  }

  function resetState() {
    var animEls = [aabbEl, obbEl, obbLabelEl, sobbEl, sobbLabelEl,
      bvObb, bvSobb, capIneq, capSa];
    gsap.killTweensOf(animEls);
    aabbEl.setAttribute('stroke-opacity', 1);
    obbEl.setAttribute('opacity', 0);
    obbEl.setAttribute('stroke-dashoffset', obbLen);
    obbEl.setAttribute('fill-opacity', 0);
    obbEl.setAttribute('stroke-opacity', 1);
    obbLabelEl.setAttribute('opacity', 0);
    sobbEl.setAttribute('opacity', 0);
    sobbEl.setAttribute('stroke-dashoffset', sobbLen);
    sobbEl.setAttribute('fill-opacity', 0);
    sobbLabelEl.setAttribute('opacity', 0);
    gsap.set([bvObb, bvSobb, capIneq, capSa], { opacity: 0, y: 0 });
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: the OBB draws in over the AABB; the AABB recedes
    tl.to(obbEl, {
      attr: { opacity: 1, 'stroke-dashoffset': 0 },
      duration: 1.1, ease: 'power2.inOut'
    }, 0);
    tl.to(obbEl, {
      attr: { 'fill-opacity': 0.08 }, duration: 0.5, ease: 'power1.out'
    }, 0.7);
    tl.to(aabbEl, {
      attr: { 'stroke-opacity': 0.5 }, duration: 0.5, ease: 'power1.out'
    }, 0.3);
    tl.to(obbLabelEl, {
      attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out'
    }, 0.75);
    tl.fromTo(bvObb,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', immediateRender: false },
      0.4);
    tl.addLabel('s1', 1.2);

    // s2: the SOBB draws in in teal; the OBB recedes
    tl.to(sobbEl, {
      attr: { opacity: 1, 'stroke-dashoffset': 0 },
      duration: 1.1, ease: 'power2.inOut'
    }, 's1+=0.25');
    tl.to(sobbEl, {
      attr: { 'fill-opacity': 0.08 }, duration: 0.5, ease: 'power1.out'
    }, 's1+=0.95');
    tl.to(obbEl, {
      attr: { 'stroke-opacity': 0.5, 'fill-opacity': 0.05 },
      duration: 0.5, ease: 'power1.out'
    }, 's1+=0.45');
    tl.to(sobbLabelEl, {
      attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out'
    }, 's1+=1.05');
    tl.fromTo(bvSobb,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', immediateRender: false },
      's1+=0.45');
    tl.addLabel('s2', 's1+=1.5');

    // s3: family caption
    tl.fromTo(capIneq,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power1.out', immediateRender: false },
      's2+=0.2');
    tl.addLabel('s3', 's2+=0.8');

    // s4: surface-area caption
    tl.fromTo(capSa,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power1.out', immediateRender: false },
      's3+=0.2');
    tl.addLabel('s4', 's3+=0.8');
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
    aabb: function () { return aabbC; },
    obb: function () { return obbC; },
    sobb: function () { return sobbC; },
    areaStrs: function () { return areaStrs; }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbmorph = animator;
})();
