/* Teaser slide animator — "Why tight bounds?"
 *
 * One point cloud, one image: the exact AABB first, then (fragment 1)
 * the box rotates while recomputing its bounds every frame, ending as
 * the minimum-area oriented box — the loose AABB outline stays visible
 * behind it (thinner, dashed). The optimal angle comes from an actual
 * coarse-to-fine area search, so the tight fit is genuine, not
 * hand-tuned. Labels: 'SA(AABB) = N' vs 'SA(OBB) ≤ N' — surface areas
 * compared symbolically, no absolute numbers (the real computed ratio
 * stays exported in _test for verification).
 *
 * s2 (second fragment): a ray sweeps in from the left, HITS the AABB
 * (red flash + tick at the entry point) and MISSES the OBB (blue
 * '✗ miss' badge) — smaller bounds, lower hit probability. The ray is
 * picked deterministically: candidate directions toward the AABB
 * quadrants are tested with a real segment–AABB slab test and a real
 * segment–OBB polygon test (edge intersections + containment); the
 * longest-travel candidate that hits the AABB, provably misses the
 * OBB, and keeps a healthy clearance to it wins. All ray geometry
 * lives inside the same translated cloud group, so it stays within
 * the 1040x600 viewBox with margin.
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var BLUE = '#1f6fe5';
  var INK = '#14161a';
  var RED = '#d93636';

  /* ==================== LAYOUT DATA ====================
   * Point cloud: deterministic (seeded PRNG), an elongated Gaussian
   * blob rotated ROT0 deg — clearly bad for an AABB, good for an OBB.
   */
  var N_POINTS = 30;
  var CLOUD_CENTER = [300, 290];
  var CLOUD_SPREAD = [200, 62];   // stddev along the two principal axes
  var SEED = 20260917;

  /* Canvas: wide viewBox; the 600x600 cloud space is centered
   * (group translate TX = (1040-600)/2 = 220, so 220px free on each
   * side). Ray math runs in cloud coordinates (negative x allowed
   * down to -TX) inside that same translated group. */
  var TX = 220;
  var VB_W = 1040, VB_H = 600;

  /* Ray pick: fixed start left of the box, candidate directions toward
   * the AABB's quadrant target grids (top-left first per the design,
   * then the others — for this seed the OBB's protruding corner seals
   * the top-left, so the winner comes from the bottom region). The
   * chosen ray must hit the AABB, provably miss the OBB, and keep at
   * least RAY_CLEARANCE px of distance to it (avoids grazing picks). */
  var RAY_START_X = -185;   // cloud coords; SVG x = 35
  var RAY_TAIL = 40;        // ray extends this far past the AABB exit
  var RAY_CLEARANCE = 18;
  var QUADS = [
    [0.05, 0.45, 0.05, 0.45],  // top-left
    [0.55, 0.95, 0.05, 0.45],  // top-right
    [0.05, 0.45, 0.55, 0.95],  // bottom-left
    [0.55, 0.95, 0.55, 0.95]   // bottom-right
  ];

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
    // Normalize into the 600x600 cloud space: the seeded Gaussian has
    // unbounded tails, and this seed's raw cloud spans x -95..699 —
    // points, the padded AABB, and the OBB's rotated corners all
    // clipped at the space edge. Uniform scale + recenter (bbox center
    // -> 300,300) keeps the exact seeded shape; everything downstream
    // (boxes, areas, angles, the ray) derives from the normalized
    // points, so the "genuine tight fit" story is intact.
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

  function corners(b) {
    return [
      [b.x, b.y], [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]
    ];
  }

  function centroid(poly) {
    var x = 0, y = 0;
    poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / poly.length, y / poly.length];
  }

  /* Point in (convex) polygon via crossing test. */
  function inPoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      if (((yi > p[1]) !== (yj > p[1])) &&
          (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* Segment–segment intersection (inclusive). */
  function segSeg(p1, p2, p3, p4) {
    var d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    var d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    var den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return false;
    var s = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
    var t = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  }

  /* Does the segment touch the polygon (edge intersection or an
   * endpoint inside)? */
  function segHitsPoly(p1, p2, poly) {
    if (inPoly(p1, poly) || inPoly(p2, poly)) return true;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segSeg(p1, p2, poly[j], poly[i])) return true;
    }
    return false;
  }

  /* Segment–AABB slab test. Returns { tEnter, tExit } or null. */
  function segAABB(p0, d, box, tMax) {
    var tmin = 0, tmax = tMax;
    var axes = [
      [p0[0], d[0], box.x, box.x + box.w],
      [p0[1], d[1], box.y, box.y + box.h]
    ];
    for (var i = 0; i < 2; i++) {
      var o = axes[i][0], dd = axes[i][1], lo = axes[i][2], hi = axes[i][3];
      if (Math.abs(dd) < 1e-12) {
        if (o < lo || o > hi) return null;
      } else {
        var t1 = (lo - o) / dd, t2 = (hi - o) / dd;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return { tEnter: tmin, tExit: tmax };
  }

  function ptSegDist(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = p[0] - a[0], wy = p[1] - a[1];
    var t = (wx * vx + wy * vy) / (vx * vx + vy * vy);
    t = Math.max(0, Math.min(1, t));
    var dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Min segment-to-polygon distance (sampled along the segment —
   * deterministic, plenty exact for a clearance threshold). */
  function segPolyDist(p1, p2, poly) {
    var best = Infinity;
    for (var k = 0; k <= 40; k++) {
      var t = k / 40;
      var p = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var d = ptSegDist(p, poly[j], poly[i]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  /* Deterministic ray pick (see QUADS comment). Returns null if no
   * candidate qualifies (does not happen for this seed). */
  function pickRay(loose, obbPoly) {
    var p0 = [RAY_START_X, loose.y - 30];
    var best = null;
    for (var q = 0; q < QUADS.length; q++) {
      for (var i = 0; i <= 6; i++) {
        for (var j = 0; j <= 6; j++) {
          var tx = loose.x + loose.w * (QUADS[q][0] + (QUADS[q][1] - QUADS[q][0]) * i / 6);
          var ty = loose.y + loose.h * (QUADS[q][2] + (QUADS[q][3] - QUADS[q][2]) * j / 6);
          var dx = tx - p0[0], dy = ty - p0[1];
          var len0 = Math.sqrt(dx * dx + dy * dy);
          var dir = [dx / len0, dy / len0];
          var hit = segAABB(p0, dir, loose, 4000);
          if (!hit || hit.tEnter <= 0) continue;         // must HIT the AABB
          var len = hit.tExit + RAY_TAIL;
          var end = [p0[0] + dir[0] * len, p0[1] + dir[1] * len];
          if (segHitsPoly(p0, end, obbPoly)) continue;    // must MISS the OBB
          if (segPolyDist(p0, end, obbPoly) < RAY_CLEARANCE) continue;
          // stay inside the viewBox (cloud coords) with margin
          if (end[0] > VB_W - TX - 12 || end[1] > VB_H - 12 || end[1] < 12) continue;
          var travel = hit.tExit - hit.tEnter;
          if (!best || travel > best.travel) {
            best = {
              p0: p0, dir: dir, len: len, travel: travel, quad: q,
              tEnter: hit.tEnter, tExit: hit.tExit,
              entry: [p0[0] + dir[0] * hit.tEnter, p0[1] + dir[1] * hit.tEnter],
              exit: [p0[0] + dir[0] * hit.tExit, p0[1] + dir[1] * hit.tExit],
              end: end,
              clearance: segPolyDist(p0, end, obbPoly)
            };
          }
        }
      }
    }
    return best;
  }

  /* Point offset from a polygon edge, on the side away from the
   * centroid — used to place the OBB label / miss badge clear of the
   * drawing. f = fraction along edge poly[i]→poly[j], off = distance. */
  function edgeOffset(poly, i, j, f, off) {
    var a = poly[i], b = poly[j];
    var p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var L = Math.sqrt(dx * dx + dy * dy);
    var n = [-dy / L, dx / L];
    var c = centroid(poly);
    if ((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] > 0) n = [dy / L, -dx / L];
    return [p[0] + off * n[0], p[1] + off * n[1]];
  }

  /* ==================== DOM helpers ==================== */

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function setText(t, str) { t.textContent = str; return t; }

  /* ==================== scene (pure, DOM-free) ==================== */

  var CAPTIONS = [
    'One point cloud, axis-aligned box first.',
    'Rotate into the minimum-area oriented box — both bounds visible.',
    'A ray can hit the loose box and miss the tight one — smaller bounds, lower hit probability.'
  ];

  function computeScene() {
    var pts = makeCloud();
    var center = [0, 0];
    pts.forEach(function (p) { center[0] += p[0]; center[1] += p[1]; });
    center[0] /= pts.length; center[1] /= pts.length;

    var loose = aabb(pts);
    var thetaStar = bestAngle(pts, center);
    var tightEnd = aabb(rotate(pts, center[0], center[1], -thetaStar));
    var obbPoly = rotate(corners(tightEnd), center[0], center[1], thetaStar);
    var obbTop = Infinity;
    obbPoly.forEach(function (p) { if (p[1] < obbTop) obbTop = p[1]; });

    var ray = pickRay(loose, obbPoly);
    var ratio = area(tightEnd) / area(loose);

    /* miss badge starts below the OBB's bottom edge, then gets nudged
     * perpendicular off the ray line so the ray never strikes through
     * the text */
    var badge = edgeOffset(obbPoly, 3, 2, 0.30, 36);
    if (ray) {
      var rd = ray.dir, rl = Math.sqrt(rd[0] * rd[0] + rd[1] * rd[1]);
      var rn = [-rd[1] / rl, rd[0] / rl];
      var d = -((badge[0] - ray.p0[0]) * rd[1] - (badge[1] - ray.p0[1]) * rd[0]) / (rl * rl);
      if (Math.abs(d) < 22) {
        var push = (24 - Math.abs(d)) * (d >= 0 ? 1 : -1);
        badge = [badge[0] + rn[0] * push, badge[1] + rn[1] * push];
      }
    }

    /* SA(AABB) tag hugs the AABB's top-left corner from outside — baseline
     * just above the top edge, right-aligned to clear the OBB's protruding
     * corner (whose slanted left edge seals the corner region itself).
     * SA(OBB) slides along the OBB's top edge until it sits right of AND
     * below the AABB tag, so the AABB is read first. */
    var aabbY = loose.y - 9;
    var edgeX = Infinity;
    obbPoly.forEach(function (p, i) {
      var q = obbPoly[(i + 1) % obbPoly.length];
      var y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
      if (aabbY > y0 && aabbY < y1) {
        var x = p[0] + (q[0] - p[0]) * (aabbY - p[1]) / (q[1] - p[1]);
        if (x < edgeX) edgeX = x;
      }
    });
    var aabbX = isFinite(edgeX) ? edgeX - 10 : loose.x + 108;
    /* the OBB tag rides the OBB's top edge, rotated to match its slope,
     * so it hugs the box it names; it starts far enough along the edge
     * to sit right of and below the AABB tag (AABB reads first) */
    var ea = obbPoly[0], eb = obbPoly[1];
    var obbAng = Math.atan2(eb[1] - ea[1], eb[0] - ea[0]) * 180 / Math.PI;
    var obbLbl = null;
    for (var f = 0.35; f <= 0.75; f += 0.05) {
      var cand = edgeOffset(obbPoly, 0, 1, f, 20);
      if (cand[1] - 11 >= loose.y + 3 && cand[0] > aabbX + 40) { obbLbl = cand; break; }
    }
    if (!obbLbl) obbLbl = edgeOffset(obbPoly, 0, 1, 0.55, 20);

    return {
      pts: pts, center: center,
      loose: loose, thetaStar: thetaStar,
      tightEnd: tightEnd, obbPoly: obbPoly, obbTop: obbTop,
      ratio: ratio, ratioStr: ratio.toFixed(2),
      ray: ray,
      labels: {
        // AABB tag: right-aligned (text-anchor 'end' in build) at the
        // top-left corner, above the top edge, clear of the OBB edge.
        aabb: [aabbX, aabbY],
        obb: obbLbl, obbAngle: obbAng,                 // rides the OBB top edge
        badge: badge,                                     // below OBB bottom edge
        hit: [ray ? ray.entry[0] - 26 : 0, ray ? ray.entry[1] + 26 : 0]
      }
    };
  }

  /* ==================== animator ==================== */

  var built = false;
  var scene, captionEl;
  var dotsG, looseRectEl, tightGroup, tightRectEl;
  var aabbLabelEl, obbLabelEl, hitTickEl, hitTextEl, missBadgeEl;
  var rayLineEl, rayDotEl;
  var tl = null;
  var proxy = { theta: 0 };
  var rayT = { t: 0 };

  var SWEEP_DUR = 1.5;   // s2 ray sweep (linear, so time == param fraction)

  function drawCloud(g) {
    scene.pts.forEach(function (p) {
      el('circle', { 'class': 'svg-dot', cx: p[0], cy: p[1], r: 4.5 }, g);
    });
  }

  function setBox(rectEl, b) {
    rectEl.setAttribute('x', b.x);
    rectEl.setAttribute('y', b.y);
    rectEl.setAttribute('width', b.w);
    rectEl.setAttribute('height', b.h);
  }

  /* Recompute the oriented box for a frame angle. The <g> carries
   * rotate(+theta); the rect inside is the AABB of the points
   * counter-rotated by theta, so the result hugs the cloud. */
  function updateTightBox(deg) {
    var b = aabb(rotate(scene.pts, scene.center[0], scene.center[1], -deg));
    tightGroup.setAttribute('transform',
      'rotate(' + deg + ' ' + scene.center[0] + ' ' + scene.center[1] + ')');
    setBox(tightRectEl, b);
    return b;
  }

  function drawRay() {
    var d = rayT.t * scene.ray.len;
    var x = scene.ray.p0[0] + scene.ray.dir[0] * d;
    var y = scene.ray.p0[1] + scene.ray.dir[1] * d;
    rayLineEl.setAttribute('x2', x);
    rayLineEl.setAttribute('y2', y);
    rayDotEl.setAttribute('cx', x);
    rayDotEl.setAttribute('cy', y);
  }

  function setOpacity(els, v) {
    els.forEach(function (e) { e.setAttribute('opacity', v); });
  }

  function build() {
    scene = computeScene();
    captionEl = document.getElementById('teaser-caption');

    var host = document.getElementById('teaser-canvas');
    var svg = el('svg', { viewBox: '0 0 ' + VB_W + ' ' + VB_H, width: '100%', height: '100%' }, host);
    var g = el('g', { transform: 'translate(' + TX + ' 0)' }, svg);

    // cloud + boxes (AABB behind, oriented box on top)
    dotsG = el('g', {}, g);
    drawCloud(dotsG);
    // AABB rect: pure attributes (GSAP tweens its stroke AND
    // stroke-width — a CSS stroke-width rule would freeze those).
    looseRectEl = el('rect', {
      fill: 'none', stroke: INK, 'stroke-width': 1.6
    }, g);
    setBox(looseRectEl, scene.loose);
    tightGroup = el('g', {}, g);
    tightRectEl = el('rect', { 'class': 'svg-cloud-box' }, tightGroup);
    updateTightBox(0);

    // ray (on top of the boxes), hidden until s2
    var r = scene.ray;
    rayLineEl = el('line', {
      x1: r.p0[0], y1: r.p0[1], x2: r.p0[0], y2: r.p0[1],
      stroke: INK, 'stroke-width': 2, opacity: 0
    }, g);
    rayDotEl = el('circle', {
      cx: r.p0[0], cy: r.p0[1], r: 5, fill: INK, opacity: 0
    }, g);

    // s1 end labels: 'SA(AABB) = N' / 'SA(OBB) ≤ N'
    aabbLabelEl = setText(el('text', {
      x: scene.labels.aabb[0], y: scene.labels.aabb[1],
      'text-anchor': 'end',
      'font-size': 15, fill: INK, opacity: 0
    }, g), 'SA(AABB) = N');
    obbLabelEl = setText(el('text', {
      x: scene.labels.obb[0], y: scene.labels.obb[1],
      transform: 'rotate(' + scene.labels.obbAngle.toFixed(2) + ' ' +
        scene.labels.obb[0] + ' ' + scene.labels.obb[1] + ')',
      'font-size': 15, fill: BLUE, 'font-weight': 650, opacity: 0
    }, g), 'SA(OBB) ≤ N');

    // s2 hit tick + label at the AABB entry point
    var n = [-r.dir[1], r.dir[0]];  // perpendicular to the ray
    hitTickEl = el('line', {
      x1: r.entry[0] - 9 * n[0], y1: r.entry[1] - 9 * n[1],
      x2: r.entry[0] + 9 * n[0], y2: r.entry[1] + 9 * n[1],
      stroke: RED, 'stroke-width': 2.2, opacity: 0
    }, g);
    hitTextEl = setText(el('text', {
      x: scene.labels.hit[0], y: scene.labels.hit[1],
      'text-anchor': 'middle', 'font-size': 14, fill: RED,
      'font-weight': 650, opacity: 0
    }, g), 'hit');

    // s2 miss badge near the OBB's bottom edge
    missBadgeEl = setText(el('text', {
      x: scene.labels.badge[0], y: scene.labels.badge[1],
      'text-anchor': 'middle', 'font-size': 14, fill: BLUE,
      'font-weight': 650, opacity: 0
    }, g), '✗ miss');

    built = true;
  }

  function resetState() {
    proxy.theta = 0;
    updateTightBox(0);
    looseRectEl.setAttribute('stroke', INK);
    looseRectEl.setAttribute('stroke-width', 1.6);
    looseRectEl.setAttribute('stroke-dasharray', 'none');
    tightRectEl.setAttribute('stroke', INK);
    setOpacity([aabbLabelEl, obbLabelEl, hitTickEl, hitTextEl, missBadgeEl,
                rayLineEl, rayDotEl], 0);
    rayT.t = 0;
    drawRay();
    captionEl.textContent = CAPTIONS[0];
  }

  /* Static state for a stop (start() seeks with events suppressed, so
   * onUpdate-driven geometry and caption callbacks must be applied
   * directly — same idea as the old startAreaText/endAreaText). */
  function applyStopState(n) {
    proxy.theta = n >= 1 ? scene.thetaStar : 0;
    updateTightBox(proxy.theta);
    rayT.t = n >= 2 ? 1 : 0;
    drawRay();
    if (n >= 1) {
      looseRectEl.setAttribute('stroke-width', 1.2);
      looseRectEl.setAttribute('stroke-dasharray', '6 5');
      tightRectEl.setAttribute('stroke', BLUE);
      setOpacity([aabbLabelEl, obbLabelEl], 1);
    } else {
      looseRectEl.setAttribute('stroke-width', 1.6);
      looseRectEl.setAttribute('stroke-dasharray', 'none');
      tightRectEl.setAttribute('stroke', INK);
      setOpacity([aabbLabelEl, obbLabelEl], 0);
    }
    setOpacity([rayLineEl, rayDotEl, hitTickEl, hitTextEl, missBadgeEl],
               n >= 2 ? 1 : 0);
    captionEl.textContent = CAPTIONS[n];
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: rotate + shrink-wrap to the minimum-area fit; the AABB stays
    // behind, going thinner + dashed so the two read as separate.
    tl.to(proxy, {
      theta: scene.thetaStar,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: function () { updateTightBox(proxy.theta); }
    }, 0);
    tl.set(tightRectEl, { attr: { stroke: BLUE } }, 0.15);
    tl.set(looseRectEl, {
      attr: { 'stroke-width': 1.2, 'stroke-dasharray': '6 5' }
    }, 0.15);
    tl.fromTo([aabbLabelEl, obbLabelEl],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.35, stagger: 0.08, ease: 'power1.out' },
      1.3);
    tl.add(function () { captionEl.textContent = CAPTIONS[1]; }, 1.65);
    tl.addLabel('s1');

    // s2: the ray. Linear sweep so the flash/badge times below map
    // exactly onto ray-parameter fractions.
    var t0 = tl.labels.s1 + 0.3;
    var fEnter = scene.ray.tEnter / scene.ray.len;
    var badgeX = scene.labels.badge[0];
    var fBadge = Math.max(0.55, Math.min(0.95,
      ((badgeX - scene.ray.p0[0]) / scene.ray.dir[0]) / scene.ray.len));
    var tEnter = t0 + fEnter * SWEEP_DUR;
    var tBadge = t0 + fBadge * SWEEP_DUR;

    tl.fromTo([rayLineEl, rayDotEl],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.25, ease: 'power1.out' }, t0);
    tl.to(rayT, {
      t: 1, duration: SWEEP_DUR, ease: 'none', onUpdate: drawRay
    }, t0);
    // AABB boundary crossing: red flash on the loose stroke + hit tick
    tl.to(looseRectEl, {
      attr: { stroke: RED, 'stroke-width': 2.2 }, duration: 0.1
    }, tEnter);
    tl.to(looseRectEl, {
      attr: { stroke: INK, 'stroke-width': 1.2 },
      duration: 0.5, ease: 'power2.out'
    }, tEnter + 0.22);
    tl.fromTo([hitTickEl, hitTextEl],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.25, ease: 'power1.out' },
      tEnter + 0.08);
    // OBB miss badge once the sweep has passed the OBB edge
    tl.fromTo(missBadgeEl,
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.3, ease: 'power1.out' }, tBadge);
    tl.add(function () { captionEl.textContent = CAPTIONS[2]; }, t0 + SWEEP_DUR + 0.1);
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
        // seek suppresses callbacks + onUpdate — apply the stop state
        applyStopState(fragStep);
      }
      gsap.fromTo([dotsG],
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
    rotate: rotate,
    computeScene: computeScene
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.teaser = animator;
})();
