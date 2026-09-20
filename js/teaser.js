/* Teaser slide animator — "Why tight bounds?"
 *
 * Same generated point cloud in two panels:
 *   left:  static axis-aligned bounding box (the "wasteful" fit)
 *   right: on the fragment step, the box rotates while recomputing its
 *          bounds every frame, ending as the minimum-area oriented box.
 * The optimal angle is found by an actual coarse-to-fine area search,
 * so the result is a genuinely tight fit, not a hand-tuned picture.
 *
 * s2 (second fragment): per-pixel triangle-test heatmap strip under each
 * box — the loose AABB panel runs mostly hot (wasted ray–triangle tests),
 * the tight oriented box mostly cool. Same viewBox, appended beneath the
 * deepest geometry (cloud dots + OBB corners), placed from the actual
 * fitted bounds so it never collides with the drawing.
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var BLUE = '#1f6fe5';
  var INK = '#14161a';

  /* ==================== heatmap strip data (s2) ====================
   * One compact strip of cells per panel beneath the boxes. Left (loose
   * AABB) = mostly warm/red with a few orange; right (tight box) = mostly
   * cool greens. 14 cells at 24x16 + 4px gap = 388px wide, centered. */
  var STRIP_CELLS = 14;
  var STRIP_CELL_W = 24, STRIP_CELL_H = 16, STRIP_CELL_GAP = 4;
  var STRIP_LABEL = 'triangle tests per pixel';
  var STRIP_HOT = [
    '#d93636', '#cf4b4b', '#d93636', '#e06a3c', '#d93636',
    '#cf4b4b', '#d93636', '#e08a3c', '#d93636', '#d93636',
    '#e06a3c', '#d93636', '#cf4b4b', '#d93636'
  ];
  var STRIP_COOL = [
    '#3a9a5e', '#6fbf8b', '#3a9a5e', '#8fceaa', '#3a9a5e',
    '#6fbf8b', '#3a9a5e', '#8fceaa', '#3a9a5e', '#6fbf8b',
    '#3a9a5e', '#8fceaa', '#3a9a5e', '#6fbf8b'
  ];

  /* ==================== LAYOUT DATA ====================
   * Point cloud: deterministic (seeded PRNG), an elongated Gaussian
   * blob rotated ROT0 deg — clearly bad for an AABB, good for an OBB.
   */
  var N_POINTS = 30;
  var CLOUD_CENTER = [300, 290];
  var CLOUD_SPREAD = [200, 62];   // stddev along the two principal axes
  var SEED = 20260917;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    // Box-Muller
    var u = 0, v = 0;
    while (u === 0) u = rand();
    v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function makeCloud() {
    var rand = mulberry32(SEED);
    var rot = 24 * Math.PI / 180;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var pts = [];
    for (var i = 0; i < N_POINTS; i++) {
      var x = gauss(rand) * CLOUD_SPREAD[0];
      var y = gauss(rand) * CLOUD_SPREAD[1];
      pts.push([
        CLOUD_CENTER[0] + x * cos - y * sin,
        CLOUD_CENTER[1] + x * sin + y * cos
      ]);
    }
    // Normalize into the 600x600 viewBox: the seeded Gaussian has unbounded
    // tails, and this seed's raw cloud spans x -95..699 — points, the padded
    // AABB, and the OBB's rotated corners all clipped at the viewBox edge.
    // Uniform scale + recenter (bbox center -> 300,300) keeps the exact
    // seeded shape; everything downstream (boxes, areas, angles) derives
    // from the normalized points, so the "genuine tight fit" story is intact.
    var b = aabb(pts);
    var M = 46; // inner margin: 14px AABB pad + dot radius + OBB corner
                // overhang past the point extents (worst ~29% of bbox height
                // for this seed; overhang scales with the same factor)
    var s = Math.min((600 - 2 * M) / b.w, (600 - 2 * M) / b.h);
    var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    return pts.map(function (p) {
      return [300 + (p[0] - bcx) * s, 300 + (p[1] - bcy) * s];
    });
  }

  /* ==================== pure geometry helpers ==================== */

  function rotate(pts, cx, cy, deg) {
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    return pts.map(function (p) {
      var x = p[0] - cx, y = p[1] - cy;
      return [cx + x * cos - y * sin, cy + x * sin + y * cos];
    });
  }

  function aabb(pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function area(b) { return b.w * b.h; }

  /* Minimum-area oriented box angle: coarse 1 deg scan + golden refine.
   * Angle of the BOX frame; points are rotated by -deg into the frame. */
  function bestAngle(pts, c) {
    var theta = 0, best = Infinity;
    for (var d = 0; d <= 90; d += 1) {
      var a = area(aabb(rotate(pts, c[0], c[1], -d)));
      if (a < best) { best = a; theta = d; }
    }
    // golden-section refine in [theta-1, theta+1]
    var lo = theta - 1, hi = theta + 1, gr = (Math.sqrt(5) - 1) / 2;
    var x1 = hi - gr * (hi - lo), x2 = lo + gr * (hi - lo);
    var f = function (d) { return area(aabb(rotate(pts, c[0], c[1], -d))); };
    var f1 = f(x1), f2 = f(x2);
    for (var i = 0; i < 24; i++) {
      if (f1 > f2) { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = f(x2); }
      else { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = f(x1); }
    }
    return (lo + hi) / 2;
  }

  /* ==================== DOM helpers ==================== */

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ==================== animator ==================== */

  var built = false;
  var pts, center, looseBox, thetaStar, tightStart, tightEnd;
  var looseRectEl, tightGroup, tightRectEl, looseDotsG, tightDotsG;
  var areaLooseEl, areaTightEl;
  var stripL, stripR; // { cells: [rect...], label } per panel (s2)
  var tl = null;
  var proxy = { theta: 0 };

  function drawCloud(g) {
    pts.forEach(function (p) {
      el('circle', { 'class': 'svg-dot', cx: p[0], cy: p[1], r: 4.5 }, g);
    });
  }

  function setBox(rectEl, b) {
    rectEl.setAttribute('x', b.x);
    rectEl.setAttribute('y', b.y);
    rectEl.setAttribute('width', b.w);
    rectEl.setAttribute('height', b.h);
  }

  /* Recompute the tight panel's oriented box for a frame angle.
   * The <g> carries rotate(+theta); the rect inside is the AABB of the
   * points counter-rotated by theta, so the result hugs the cloud. */
  function updateTightBox(deg) {
    var b = aabb(rotate(pts, center[0], center[1], -deg));
    tightGroup.setAttribute('transform',
      'rotate(' + deg + ' ' + center[0] + ' ' + center[1] + ')');
    setBox(tightRectEl, b);
    return b;
  }

  function fmtArea(b) {
    return Math.round(area(b) / 100) / 10 + 'k';
  }

  /* Build one heatmap strip into a panel SVG at y = top. Returns
   * { cells: [rect...], label } with everything at opacity 0 — the
   * timeline's s2 fromTo tweens own the reveal (and hide it again when
   * scrubbed back to the s1 stop). */
  function buildStrip(svg, colors, top) {
    var total = STRIP_CELLS * STRIP_CELL_W + (STRIP_CELLS - 1) * STRIP_CELL_GAP;
    var x0 = 300 - total / 2;
    var cells = [];
    for (var i = 0; i < STRIP_CELLS; i++) {
      cells.push(el('rect', {
        x: x0 + i * (STRIP_CELL_W + STRIP_CELL_GAP),
        y: top,
        width: STRIP_CELL_W,
        height: STRIP_CELL_H,
        rx: 2,
        fill: colors[i],
        opacity: 0
      }, svg));
    }
    var label = el('text', {
      'class': 'svg-side-label',
      x: 300, y: top - 10,
      'text-anchor': 'middle',
      opacity: 0
    }, svg);
    label.textContent = STRIP_LABEL;
    return { cells: cells, label: label };
  }

  function build() {
    pts = makeCloud();
    center = [0, 0];
    pts.forEach(function (p) { center[0] += p[0]; center[1] += p[1]; });
    center[0] /= pts.length; center[1] /= pts.length;

    looseBox = aabb(pts);
    thetaStar = bestAngle(pts, center);

    areaLooseEl = document.getElementById('area-loose');
    areaTightEl = document.getElementById('area-tight');

    // left panel: static AABB — exact, no padding, so it is identical to
    // the right panel's theta=0 state (the morph then reads as pure
    // rotation into the tight OBB) and matches the area label below.
    var hostL = document.getElementById('teaser-loose');
    var svgL = el('svg', { viewBox: '0 0 600 600', width: '100%', height: '100%' }, hostL);
    looseDotsG = el('g', {}, svgL);
    drawCloud(looseDotsG);
    looseRectEl = el('rect', { 'class': 'svg-cloud-box' }, svgL);
    setBox(looseRectEl, looseBox);

    // right panel: morphing oriented box
    var hostR = document.getElementById('teaser-tight');
    var svgR = el('svg', { viewBox: '0 0 600 600', width: '100%', height: '100%' }, hostR);
    tightDotsG = el('g', {}, svgR);
    drawCloud(tightDotsG);
    tightGroup = el('g', {}, svgR);
    tightRectEl = el('rect', { 'class': 'svg-cloud-box' }, tightGroup);
    tightStart = updateTightBox(0);
    tightEnd = updateTightBox(thetaStar);
    updateTightBox(0);

    // s2 strips: beneath the deepest drawing in either panel — cloud
    // dots (aabb bottom + dot radius) on the left, the OBB's rotated
    // corners on the right. Placed from the fitted geometry, clamped
    // inside the viewBox (600 - 16 cell - 8 bottom margin).
    var obbCorners = [
      [tightEnd.x, tightEnd.y],
      [tightEnd.x + tightEnd.w, tightEnd.y],
      [tightEnd.x, tightEnd.y + tightEnd.h],
      [tightEnd.x + tightEnd.w, tightEnd.y + tightEnd.h]
    ];
    var contentBottom = looseBox.y + looseBox.h + 4.5; // + dot radius
    rotate(obbCorners, center[0], center[1], thetaStar).forEach(function (p) {
      contentBottom = Math.max(contentBottom, p[1]);
    });
    var stripTop = Math.min(contentBottom + 30, 600 - STRIP_CELL_H - 8);
    stripL = buildStrip(svgL, STRIP_HOT, stripTop);
    stripR = buildStrip(svgR, STRIP_COOL, stripTop);

    built = true;
  }

  function startAreaText() {
    areaLooseEl.textContent = 'area ' + fmtArea(looseBox);
    areaTightEl.textContent = 'area ' + fmtArea(tightStart);
  }

  function endAreaText() {
    var pct = Math.round((1 - area(tightEnd) / area(looseBox)) * 100);
    areaTightEl.textContent = 'area ' + fmtArea(tightEnd) + '  (−' + pct + '%)';
  }

  function resetState() {
    proxy.theta = 0;
    updateTightBox(0);
    looseRectEl.setAttribute('stroke', INK);
    tightRectEl.setAttribute('stroke', INK);
    startAreaText();
    // strips back to hidden (the rebuilt timeline reveals them at s2)
    [stripL, stripR].forEach(function (strip) {
      strip.cells.forEach(function (c) { c.setAttribute('opacity', 0); });
      strip.label.setAttribute('opacity', 0);
    });
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // placed at t=0 so scrubbing back to 0 restores the start label
    tl.add(startAreaText, 0);

    // one fragment: rotate + shrink-wrap to the minimum-area fit
    tl.to(proxy, {
      theta: thetaStar,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: function () { updateTightBox(proxy.theta); }
    }, 0);
    tl.set(tightRectEl, { attr: { stroke: BLUE } }, 0.15);
    tl.add(endAreaText, 1.65);
    tl.addLabel('s1');

    // s2: heatmap strips stagger in beneath both boxes — the loose box's
    // cells run hot, the tight box's cool. fromTo tweens so scrubbing
    // back to the s1 stop hides them cleanly.
    tl.to({}, { duration: 0.35 }, '>');
    tl.fromTo(stripL.cells.concat(stripR.cells),
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.3, ease: 'power1.out', stagger: 0.05 },
      '>');
    tl.fromTo([stripL.label, stripR.label],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out' },
      '<');
    tl.addLabel('s2');
  }

  function stopTimes() {
    return [0, tl.labels.s1, tl.labels.s2];
  }

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetState();
      buildTimeline();
      if (fragStep > 0) {
        tl.seek(stopTimes()[fragStep], true);
        // seek suppresses the area-label callback; set it directly
        endAreaText();
      }
      gsap.fromTo([looseDotsG, tightDotsG],
        { opacity: 0 },
        { opacity: 1, duration: 0.7, ease: 'power1.out', overwrite: 'auto' });
      gsap.fromTo([looseRectEl, tightRectEl],
        { opacity: 0 },
        { opacity: 1, duration: 0.7, delay: 0.25, ease: 'power1.out', overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(stopTimes()[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  animator._test = {
    makeCloud: makeCloud,
    bestAngle: bestAngle,
    aabb: aabb,
    rotate: rotate
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.teaser = animator;
})();
