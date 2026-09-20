/* Animator: L2 "What is a SOBB?" — morph AABB → OBB → SOBB.
 *
 * One seeded triangle cluster, fitted three ways over the fragments:
 *   base: axis-aligned box (AABB, area 100%)
 *   s1:   frame rotates to the cluster's dominant axis (OBB, ~87%)
 *   s2:   frame shears to the cluster's skewed axes (SOBB, ~77%)
 *   s3:   settle on the SOBB (tint emphasis)
 * All three fits are computed once from the deterministic cluster, so the
 * geometry and the area numbers are stable across runs. A small axis glyph
 * in the corner mirrors the frame: orthogonal through s1, visibly skewed
 * at s2 (skew ≠ rotation). Host: #morph-canvas. Fragments: 3 (s1..s3).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;

  /* ==================== LAYOUT DATA ==================== */

  var VB_W = 1040, VB_H = 560;   // logical viewBox (SVG scales to the slot)
  var SEED = 20260918;
  var AXIS1 = 6;                 // dominant cluster axis, degrees
  var AXIS2 = 115;               // skewed second axis, degrees
  var S = 190, T = 100;          // cluster half-extents along each axis
  var TRI = 16;                  // triangle radius scale
  var CENTER = [430, 290];
  var GLYPH = [930, 482];        // axis glyph origin (bottom-right)
  var GLYPH_LEN = 50;
  var SKEW = AXIS2 - AXIS1 - 90; // glyph deviation from perpendicular at s2

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

  /* 4x2 jittered grid of small triangles in the skewed basis (e1, e2);
   * s spans +/-S, t spans +/-T so the cluster fills its parallelogram. */
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
   * versa. Returns coefficient bounds; corners come out in a consistent
   * (s,t) sign order: (-,-), (+,-), (+,+), (-,+). */
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
  var svg, boxEl, labelEls, glyphG, arrowBLine, arrowBHead;
  var aabbC, obbC, sobbC, areaStrs;
  var tl = null;
  var proxy = { rot: 0, skew: 0 };

  function makeLabel(name, area, col, visible) {
    var g = D.el('g', { opacity: visible ? 1 : 0 }, svg);
    D.text(name, {
      x: 788, y: 150, fill: col, 'font-size': 24, 'font-weight': 600
    }, g);
    D.text(area, { x: 788, y: 180, fill: col, 'font-size': 16 }, g);
    return g;
  }

  /* Axis glyph: arrow A fixed along +x, arrow B at -90 deg + skew; the
   * whole group rotates with the frame. Updated from the proxy. */
  function updateGlyph() {
    glyphG.setAttribute('transform',
      'rotate(' + proxy.rot + ' ' + GLYPH[0] + ' ' + GLYPH[1] + ')');
    var phi = rad(-90 + proxy.skew);
    var dx = Math.cos(phi), dy = Math.sin(phi);
    var px = -dy, py = dx;
    var L = GLYPH_LEN;
    arrowBLine.setAttribute('x2', GLYPH[0] + (L - 8) * dx);
    arrowBLine.setAttribute('y2', GLYPH[1] + (L - 8) * dy);
    var tx = GLYPH[0] + (L + 2) * dx, ty = GLYPH[1] + (L + 2) * dy;
    arrowBHead.setAttribute('points', pts2str([
      [tx, ty],
      [tx - 9 * dx + 5 * px, ty - 9 * dy + 5 * py],
      [tx - 9 * dx - 5 * px, ty - 9 * dy - 5 * py]
    ]));
  }

  function build() {
    var tris = makeCluster();
    var pts = flatVerts(tris);
    var c = centroid(pts);
    var e1 = [Math.cos(rad(AXIS1)), Math.sin(rad(AXIS1))];
    var e2 = [Math.cos(rad(AXIS2)), Math.sin(rad(AXIS2))];
    var v1 = perp(e1);

    var b = aabbPts(pts);
    aabbC = [
      [b.x, b.y], [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]
    ];
    obbC = parCorners(c, e1, v1, frameFit(pts, c, e1, v1));
    sobbC = parCorners(c, e1, e2, frameFit(pts, c, e1, e2));

    var a0 = b.w * b.h;
    areaStrs = [
      'area 100%',
      'area ' + Math.round(polyArea(obbC) / a0 * 100) + '%',
      'area ' + Math.round(polyArea(sobbC) / a0 * 100) + '%'
    ];

    var host = document.getElementById('morph-canvas');
    svg = D.el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: '100%', height: '100%'
    }, host);

    tris.forEach(function (tri) {
      D.el('polygon', { 'class': 'svg-tri', points: pts2str(tri) }, svg);
    });

    // the morphing bound: 4 corners, same sign order in every frame
    boxEl = D.el('polygon', {
      points: pts2str(aabbC),
      fill: D.BLUE, 'fill-opacity': 0,
      stroke: D.INK, 'stroke-width': 1.6, 'stroke-linejoin': 'round'
    }, svg);

    // name + area tags, one group per state, cross-faded by the timeline
    labelEls = [
      makeLabel('AABB', areaStrs[0], D.INK, true),
      makeLabel('OBB', areaStrs[1], D.BLUE, false),
      makeLabel('SOBB', areaStrs[2], D.BLUE, false)
    ];

    // corner axis glyph
    glyphG = D.el('g', {}, svg);
    D.el('line', {
      x1: GLYPH[0], y1: GLYPH[1],
      x2: GLYPH[0] + GLYPH_LEN - 8, y2: GLYPH[1],
      stroke: D.INK, 'stroke-width': 2
    }, glyphG);
    D.el('polygon', {
      points: pts2str([
        [GLYPH[0] + GLYPH_LEN + 2, GLYPH[1]],
        [GLYPH[0] + GLYPH_LEN - 7, GLYPH[1] - 5],
        [GLYPH[0] + GLYPH_LEN - 7, GLYPH[1] + 5]
      ]),
      fill: D.INK
    }, glyphG);
    arrowBLine = D.el('line', {
      x1: GLYPH[0], y1: GLYPH[1],
      x2: GLYPH[0], y2: GLYPH[1] - GLYPH_LEN + 8,
      stroke: D.INK, 'stroke-width': 2
    }, glyphG);
    arrowBHead = D.el('polygon', { fill: D.INK }, glyphG);
    D.text('AXES', {
      'class': 'svg-side-label',
      x: GLYPH[0], y: GLYPH[1] + 34, 'text-anchor': 'middle'
    }, svg);

    updateGlyph();
    built = true;
  }

  function resetState() {
    var animEls = [boxEl].concat(labelEls);
    gsap.killTweensOf(animEls);
    boxEl.setAttribute('points', pts2str(aabbC));
    boxEl.setAttribute('stroke', D.INK);
    boxEl.setAttribute('fill-opacity', 0);
    boxEl.setAttribute('stroke-width', 1.6);
    labelEls[0].setAttribute('opacity', 1);
    labelEls[1].setAttribute('opacity', 0);
    labelEls[2].setAttribute('opacity', 0);
    proxy.rot = 0;
    proxy.skew = 0;
    updateGlyph();
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // section 1 (0 → s1): rotate the frame into the OBB
    tl.to(boxEl, {
      attr: { points: pts2str(obbC) },
      duration: 1.15, ease: 'power2.inOut'
    }, 0);
    tl.to(proxy, {
      rot: AXIS1, duration: 1.15, ease: 'power2.inOut', onUpdate: updateGlyph
    }, 0);
    tl.to(labelEls[0], { attr: { opacity: 0 }, duration: 0.35, ease: 'power1.out' }, 0.25);
    tl.to(labelEls[1], { attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out' }, 0.5);
    tl.set(boxEl, { attr: { stroke: D.BLUE } }, 1.0);
    tl.addLabel('s1', 1.2);

    // section 2 (s1 → s2): shear the frame into the SOBB
    tl.to(boxEl, {
      attr: { points: pts2str(sobbC) },
      duration: 1.15, ease: 'power2.inOut'
    }, 's1+=0.25');
    tl.to(proxy, {
      skew: SKEW, duration: 1.15, ease: 'power2.inOut', onUpdate: updateGlyph
    }, 's1+=0.25');
    tl.to(labelEls[1], { attr: { opacity: 0 }, duration: 0.35, ease: 'power1.out' }, 's1+=0.5');
    tl.to(labelEls[2], { attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out' }, 's1+=0.75');
    tl.addLabel('s2', 's1+=1.45');

    // section 3 (s2 → s3): settle on the SOBB
    tl.to(boxEl, {
      attr: { 'fill-opacity': 0.08, 'stroke-width': 2.2 },
      duration: 0.7, ease: 'power1.inOut'
    }, 's2+=0.25');
    tl.addLabel('s3', 's2+=1.0');
  }

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetState();
      buildTimeline();
      if (fragStep > 0) {
        tl.seek(D.stopsFor(tl, 3)[fragStep], true);
        updateGlyph(); // seek may suppress tween onUpdate callbacks
      }
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
    aabbC: function () { return aabbC; },
    obbC: function () { return obbC; },
    sobbC: function () { return sobbC; },
    areaStrs: function () { return areaStrs; }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbmorph = animator;
})();
