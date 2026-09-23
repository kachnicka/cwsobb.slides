/* Animator: L0.5 "Ray tracing with a BVH" — brute force vs. BVH culling.
 *
 * 12 triangles in a scene, one ray, binary BVH of depth 2.
 *   base: dormant scene, ray + tally hidden
 *   s1:   brute force — ray sweeps the scene, every triangle tested in
 *         sweep order (12 tests, no early-out); the true hit flashes red
 *         and keeps a red hit-ring + check
 *   s2:   the flat scene fades out and the BVH replaces it: the ROOT box
 *         fades in as a faded, untested container (the step stops here —
 *         the user advances to unpack the root)
 *   s3:   the root's two children A (miss) and B (hit) grow out of it and
 *         are tested right away — a miss culls A's whole subtree
 *   s4:   the hit child B unpacks into leaves L1 (miss) and L0 (hit);
 *         each leaf's triangles reappear inside it — L1's faded, L0's
 *         at full strength. A's triangles stay hidden (culled subtree)
 *   s5:   only the hit leaf's two triangles are tested — 4 box + 2
 *         triangle tests total (the root itself is never tested)
 *
 * Every box hit/miss comes from a real slab ray–box test on the computed
 * boxes; the hit triangle is found by a point-in-triangle test of a
 * marker point on the ray. Boxes are computed as padded unions of the
 * triangles they contain (D.aabb + D.inflate), so they always enclose
 * their contents. Exported for the harness via animator._test.
 *
 * Colors: root D.BLUE (faded container only), children GREEN, leaves
 * AMBER (the one extra accent for this slide). Host: #bvh-canvas.
 * Fragments: 5 (s1..s5).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, LIGHT = D.LIGHT;
  var GREEN = '#2f9e5f'; /* child boxes */
  var AMBER = '#c07a10'; /* leaf boxes — the one extra accent for this slide */

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ==================== */

  var P0 = [80, 330], DIR = [960, -190]; /* ray: P(t) = P0 + t·DIR */
  var RAY_END_T = 0.9583;               /* drawn segment stops ≈ (1000, 148) */
  var HIT_MARK_T = 0.75;                /* marker point on the ray, inside the hit triangle */
  var PAD = 4;                          /* triangles → leaf/child box padding */
  var ROOT_PAD = 6;

  /* triangles, grouped by BVH node. L0's first triangle is the true hit
   * (the marker point lands inside it); its second is a deliberate
   * near-miss the ray passes just below. */
  var M0_TRIS = [
    [[325, 395], [368, 372], [345, 330]],
    [[415, 432], [458, 410], [440, 368]],
    [[318, 338], [346, 326], [336, 302]],
    [[455, 352], [490, 340], [472, 306]]
  ];
  /* A's second cluster: the old lower-right group relocated to sit right
   * of the M0 cluster and strictly below the ray path (the ray's y is
   * ≤ ~284 for x ≥ 314; these stay at y ≥ 348). Shapes/rotations kept. */
  var A2_TRIS = [
    [[490, 425], [532, 402], [512, 362]],
    [[545, 430], [585, 408], [565, 368]],
    [[600, 418], [638, 395], [618, 352]]
  ];
  var L1_TRIS = [
    [[585, 188], [620, 172], [600, 142]],
    [[640, 185], [668, 168], [655, 136]],
    [[610, 160], [632, 150], [625, 131]]
  ];
  var L0_TRIS = [
    [[780, 205], [830, 193], [805, 158]], /* true hit */
    [[842, 170], [888, 148], [866, 126]]  /* near-miss */
  ];

  var CAPTIONS = [
    'Naively, a ray is traced by testing it against every triangle.',
    'Naively, a ray is traced by testing it against every triangle.',
    'With BVH, a ray is traced by testing it against the boxes, starting at the root — a miss culls the whole subtree.',
    'With BVH, a ray is traced by testing it against the boxes, starting at the root — a miss culls the whole subtree.',
    'If the hit node is a leaf, we test the triangles.',
    'If the hit node is a leaf, we test the triangles.',
  ];

  /* ==================== pure math (exported) ==================== */

  /* slab method: returns t enter/exit or null */
  function rayBox(b, p0, d) {
    var t0 = -Infinity, t1 = Infinity;
    for (var ax = 0; ax < 2; ax++) {
      var lo = ax === 0 ? b.x : b.y;
      var hi = lo + (ax === 0 ? b.w : b.h);
      var inv = 1 / d[ax];
      var tn = (lo - p0[ax]) * inv;
      var tf = (hi - p0[ax]) * inv;
      if (tn > tf) { var tmp = tn; tn = tf; tf = tmp; }
      if (tn > t0) t0 = tn;
      if (tf < t1) t1 = tf;
    }
    if (t1 < Math.max(t0, 0)) return null;
    return { t: Math.max(t0, 0), tExit: t1 };
  }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }

  /* ray parameter of a point's projection onto the ray line */
  function tRayOf(pts) {
    var c = centroid(pts);
    return ((c[0] - P0[0]) * DIR[0] + (c[1] - P0[1]) * DIR[1]) /
      (DIR[0] * DIR[0] + DIR[1] * DIR[1]);
  }

  function ptInTri(p, a, b, c) {
    function cross(o, u, v) {
      return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
    }
    var d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a);
    var neg = d1 < 0 || d2 < 0 || d3 < 0;
    var pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  /* padded union of the triangles' AABBs — always encloses the tris */
  function boxOfTris(tris) {
    var b = null;
    tris.forEach(function (t) {
      b = b ? D.union(b, D.aabb(t)) : D.aabb(t);
    });
    return D.inflate(b, PAD);
  }

  /* hierarchy: every box computed from the geometry it contains.
   * Binary tree, depth 2: child A = missed subtree (two flat clusters),
   * child B = hit subtree (both leaves live inside it). */
  var LEAVES = [
    { id: 'L1', tris: L1_TRIS },
    { id: 'L0', tris: L0_TRIS }
  ];
  LEAVES.forEach(function (lf) { lf.box = boxOfTris(lf.tris); });

  var CHILDREN = [
    { id: 'A', tris: M0_TRIS.concat(A2_TRIS) },
    /* B padded 2px beyond the leaf union so the amber leaves sit visibly
     * inside the green child instead of sharing its edge */
    { id: 'B', box: D.inflate(D.union(LEAVES[0].box, LEAVES[1].box), 2), tris: L1_TRIS.concat(L0_TRIS) }
  ];
  CHILDREN[0].box = boxOfTris(CHILDREN[0].tris);
  var ROOT = D.inflate(
    D.union(CHILDREN[0].box, CHILDREN[1].box), ROOT_PAD);

  /* flat triangle list with node membership */
  var TRIS = [];
  function addTris(list, childId, leafId) {
    list.forEach(function (pts) {
      TRIS.push({ pts: pts, child: childId, leaf: leafId, tRay: tRayOf(pts) });
    });
  }
  addTris(M0_TRIS, 'A', null);
  addTris(A2_TRIS, 'A', null);
  addTris(L1_TRIS, 'B', 'L1');
  addTris(L0_TRIS, 'B', 'L0');

  var CHILD_BY_ID = {}, LEAF_BY_ID = {};
  CHILDREN.forEach(function (c) { c.triIdx = []; CHILD_BY_ID[c.id] = c; });
  LEAVES.forEach(function (lf) { lf.triIdx = []; LEAF_BY_ID[lf.id] = lf; });
  TRIS.forEach(function (t, i) {
    CHILD_BY_ID[t.child].triIdx.push(i);
    if (t.leaf) LEAF_BY_ID[t.leaf].triIdx.push(i);
  });

  /* brute-force test order = stored order = sweep order (ascending tRay) */
  var TEST_ORDER = TRIS.map(function (t, i) { return i; })
    .sort(function (a, b) { return TRIS[a].tRay - TRIS[b].tRay; });

  /* hit sets from real slab tests — never hardcoded */
  var HIT_MARK = [P0[0] + DIR[0] * HIT_MARK_T, P0[1] + DIR[1] * HIT_MARK_T];
  var HIT_TRI = (function () {
    for (var i = 0; i < TRIS.length; i++) {
      if (ptInTri(HIT_MARK, TRIS[i].pts[0], TRIS[i].pts[1], TRIS[i].pts[2])) return i;
    }
    return -1;
  })();
  var ROOT_HIT = !!rayBox(ROOT, P0, DIR); /* container only — never tested */
  var CHILD_HITS = CHILDREN.map(function (c) { return !!rayBox(c.box, P0, DIR); });
  var LEAF_HITS = LEAVES.map(function (lf) { return !!rayBox(lf.box, P0, DIR); });
  var HIT_CHILD_I = CHILD_HITS.indexOf(true);
  var HIT_LEAF_I = LEAF_HITS.indexOf(true);
  /* Box-test count: the root itself is excluded — real BVH traversal
   * skips the root test and starts at the root's children (2 tests),
   * then tests both leaves inside the hit child (2 tests). */
  var COUNTS = {
    boxTests: CHILDREN.length + LEAVES.length,
    triTestsBVH: LEAVES[HIT_LEAF_I].triIdx.length,
    triTestsBrute: TRIS.length
  };

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var triEls = [], badgeEls = [];
  var rootRect, childRects = [], leafRects = [];
  var rayLine, rayDot;
  var hitRing, checkEl;
  var tallyEl;
  var captionEl;
  var tl = null;

  function ptsStr(pts) {
    return pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
  }

  function build() {
    var host = document.getElementById('bvh-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);

    /* triangles first (bottom layer) + one hidden order badge each */
    TRIS.forEach(function (t) {
      triEls.push(el('polygon', {
        points: ptsStr(t.pts), fill: LIGHT, stroke: INK,
        'stroke-width': 1.1, 'stroke-linejoin': 'round'
      }, svg));
      var b = D.aabb(t.pts);
      badgeEls.push(text('', {
        x: b.x + b.w / 2, y: b.y - 10, 'text-anchor': 'middle',
        'font-size': 14, fill: BLUE, 'font-weight': 650, opacity: 0
      }, svg));
    });

    /* boxes on top of triangles: root → children → leaves. The root is a
     * faded, dashed container only — it never flashes and is never
     * counted as a test. */
    rootRect = el('rect', {
      x: ROOT.x, y: ROOT.y, width: ROOT.w, height: ROOT.h,
      fill: 'none', stroke: BLUE, 'stroke-width': 1.2,
      'stroke-dasharray': '7 5', opacity: 0
    }, svg);
    CHILDREN.forEach(function (c) {
      childRects.push(el('rect', {
        x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h,
        fill: 'none', stroke: GREEN, 'stroke-width': 1.6, opacity: 0
      }, svg));
    });
    LEAVES.forEach(function (lf) {
      leafRects.push(el('rect', {
        x: lf.box.x, y: lf.box.y, width: lf.box.w, height: lf.box.h,
        fill: 'none', stroke: AMBER, 'stroke-width': 1.6, opacity: 0
      }, svg));
    });

    /* ray (INK line + leading dot, like raytest) */
    rayLine = el('line', {
      x1: P0[0], y1: P0[1], x2: P0[0], y2: P0[1],
      stroke: INK, 'stroke-width': 2, opacity: 0
    }, svg);
    rayDot = el('circle', {
      cx: P0[0], cy: P0[1], r: 5, fill: INK, opacity: 0
    }, svg);

    /* hit marker: red ring + check at the marker point on the ray */
    hitRing = el('circle', {
      cx: HIT_MARK[0], cy: HIT_MARK[1], r: 13,
      fill: 'none', stroke: RED, 'stroke-width': 2.4, opacity: 0
    }, svg);
    checkEl = text('✓', {
      x: HIT_MARK[0] + 20, y: HIT_MARK[1] - 8,
      'font-size': 18, fill: RED, 'font-weight': 700, opacity: 0
    }, svg);

    /* in-canvas test tally (top-right, content via timeline callbacks) */
    tallyEl = text('', {
      x: 1090, y: 30, 'text-anchor': 'end', 'font-size': 16,
      fill: INK, 'font-weight': 600, opacity: 0
    }, svg);

    captionEl = document.getElementById('bvh-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    gsap.killTweensOf([rayLine, rayDot, hitRing, checkEl, tallyEl, rootRect]
      .concat(triEls, badgeEls, childRects, leafRects));
    triEls.forEach(function (p) {
      p.setAttribute('opacity', 1);
      p.setAttribute('stroke', INK);
      p.setAttribute('stroke-width', 1.1);
    });
    badgeEls.forEach(function (t) {
      t.setAttribute('opacity', 0);
      t.textContent = '';
    });
    rayLine.setAttribute('x2', P0[0]);
    rayLine.setAttribute('y2', P0[1]);
    rayLine.setAttribute('opacity', 0);
    rayDot.setAttribute('cx', P0[0]);
    rayDot.setAttribute('cy', P0[1]);
    rayDot.setAttribute('opacity', 0);
    hitRing.setAttribute('r', 13);
    hitRing.setAttribute('opacity', 0);
    checkEl.setAttribute('opacity', 0);
    tallyEl.setAttribute('opacity', 0);
    tallyEl.setAttribute('fill', INK);
    tallyEl.textContent = '';
    D.setRect(rootRect, ROOT);
    rootRect.setAttribute('stroke-width', 1.2);
    rootRect.setAttribute('opacity', 0);
    childRects.forEach(function (r, i) {
      D.setRect(r, CHILDREN[i].box);
      r.setAttribute('stroke-width', 1.6);
      r.setAttribute('opacity', 0);
    });
    leafRects.forEach(function (r, i) {
      D.setRect(r, LEAVES[i].box);
      r.setAttribute('stroke-width', 1.6);
      r.setAttribute('opacity', 0);
    });
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 5;
  var SWEEP = 1.7;

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — brute force: ray sweeps, every triangle tested in sweep order */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    tl.to(rayLine, { attr: { opacity: 1 }, duration: 0.2 }, at);
    tl.to(rayDot, { attr: { opacity: 1 }, duration: 0.2 }, at);
    var ex = P0[0] + DIR[0] * RAY_END_T, ey = P0[1] + DIR[1] * RAY_END_T;
    tl.to(rayLine, { attr: { x2: ex, y2: ey }, duration: SWEEP, ease: 'power1.inOut' }, at);
    tl.to(rayDot, { attr: { cx: ex, cy: ey }, duration: SWEEP, ease: 'power1.inOut' }, at);
    tl.add(function () { tallyEl.textContent = 'triangle tests: 0'; }, at);
    tl.to(tallyEl, { attr: { opacity: 1 }, duration: 0.4 }, at + 0.2);

    TEST_ORDER.forEach(function (idx, i) {
      var frac = Math.min(1, TRIS[idx].tRay / RAY_END_T);
      var when = at + frac * SWEEP;
      var isHit = idx === HIT_TRI;
      /* flash as the sweep tip passes; the hit flashes red and holds */
      tl.to(triEls[idx], {
        attr: { stroke: isHit ? RED : BLUE, 'stroke-width': 2.4 },
        duration: 0.22
      }, when);
      if (isHit) {
        /* plain to() tweens only — a fromTo whose from ≠ the resting
         * state (opacity 0) re-renders opacity 1 whenever the playhead
         * sits before this point, leaving a stale ring at s0 on reverse
         * scrub */
        tl.to(hitRing, { attr: { opacity: 1, r: 8 }, duration: 0.06 }, when + 0.1);
        tl.to(hitRing, { attr: { r: 15 }, duration: 0.55, ease: 'power1.out' }, when + 0.16);
        tl.to(checkEl, { attr: { opacity: 1 }, duration: 0.3 }, when + 0.15);
      } else {
        tl.to(triEls[idx], {
          attr: { stroke: INK, 'stroke-width': 1.1 }, duration: 0.5
        }, when + 0.55);
      }
      tl.add(function () {
        badgeEls[idx].textContent = String(i + 1);
        tallyEl.textContent = 'triangle tests: ' + (i + 1);
      }, when);
      tl.to(badgeEls[idx], { attr: { opacity: 1 }, duration: 0.25 }, when);
    });
    tl.to({}, { duration: 0.25 }, '>');
    tl.addLabel('s1', tl.duration());

    /* s2 — binary BVH: the flat scene fades out, the root fades in as a
     * container only, and its two children are tested right away */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    /* the BVH replaces the flat scene: triangles + badges fade out
     * (plain opacity tweens, so backward scrubbing restores them) */
    triEls.forEach(function (p) {
      tl.to(p, { attr: { opacity: 0 }, duration: 0.45 }, at);
    });
    tl.to(hitRing, { attr: { opacity: 0 }, duration: 0.45 }, at);
    tl.to(checkEl, { attr: { opacity: 0 }, duration: 0.45 }, at);
    badgeEls.forEach(function (b) {
      tl.to(b, { attr: { opacity: 0 }, duration: 0.3 }, at);
    });
    /* the root is a visual container only — faded from its first
     * appearance, never flashed, never counted */
    tl.to(rootRect, { attr: { opacity: 0.35 }, duration: 0.6 }, at + 0.15);
    tl.to({}, { duration: 0.25 }, '>');
    tl.addLabel('s2', tl.duration());

    /* s3 — the root unpacks: children grow out of it and are tested */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    CHILDREN.forEach(function (c, i) {
      tl.fromTo(childRects[i],
        { attr: { x: ROOT.x, y: ROOT.y, width: ROOT.w, height: ROOT.h, opacity: 0 } },
        { attr: { x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h, opacity: 1 },
          duration: 0.6, ease: 'power2.out' }, at + 0.35 + i * 0.25);
    });
    CHILDREN.forEach(function (c, i) {
      var when = at + 1.25 + i * 0.6;
      var r = childRects[i];
      if (CHILD_HITS[i]) {
        /* hit child: bright green, stays */
        tl.to(r, { attr: { 'stroke-width': 2.6 }, duration: 0.25 }, when);
      } else {
        /* missed child: flashes, fades — the whole subtree is culled */
        tl.to(r, { attr: { 'stroke-width': 2.4 }, duration: 0.2 }, when);
        tl.to(r, { attr: { opacity: 0.25, 'stroke-width': 1.6 }, duration: 0.5 }, when + 0.35);
      }
      tl.add(function () { tallyEl.textContent = 'box tests: ' + (i + 1); }, when);
    });
    tl.to({}, { duration: 0.25 }, '>');
    tl.addLabel('s3', tl.duration());

    /* s4 — the hit child unpacks into leaves */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.to(childRects[HIT_CHILD_I], { attr: { 'stroke-width': 1.6 }, duration: 0.4 }, at);
    var bb = CHILDREN[HIT_CHILD_I].box;
    LEAVES.forEach(function (lf, i) {
      tl.fromTo(leafRects[i],
        { attr: { x: bb.x, y: bb.y, width: bb.w, height: bb.h, opacity: 0 } },
        { attr: { x: lf.box.x, y: lf.box.y, width: lf.box.w, height: lf.box.h, opacity: 1 },
          duration: 0.6, ease: 'power2.out' }, at + 0.2 + i * 0.25);
      /* triangles reappear inside each leaf: the hit leaf's at full
       * strength, the missed leaf's faded. A's triangles stay hidden —
       * the culled subtree is never unpacked, never seen again. */
      lf.triIdx.forEach(function (ti) {
        if (LEAF_HITS[i]) {
          tl.to(triEls[ti], {
            attr: { opacity: 1, stroke: INK, 'stroke-width': 1.1 },
            duration: 0.5
          }, at + 0.45 + i * 0.25);
        } else {
          tl.to(triEls[ti], { attr: { opacity: 0.25 }, duration: 0.5 }, at + 0.45 + i * 0.25);
        }
      });
    });
    LEAVES.forEach(function (lf, i) {
      var when = at + 1.3 + i * 0.7;
      var r = leafRects[i];
      if (LEAF_HITS[i]) {
        /* hit leaf: bright amber, stays */
        tl.to(r, { attr: { 'stroke-width': 2.6 }, duration: 0.25 }, when);
      } else {
        tl.to(r, { attr: { 'stroke-width': 2.4 }, duration: 0.2 }, when);
        tl.to(r, { attr: { opacity: 0.25, 'stroke-width': 1.6 }, duration: 0.5 }, when + 0.35);
      }
      tl.add(function () { tallyEl.textContent = 'box tests: ' + (2 + i + 1); }, when);
    });
    tl.to({}, { duration: 0.25 }, '>');
    tl.addLabel('s4', tl.duration());

    /* s5 — only the hit leaf's triangles are actually tested */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    var tw = at + 0.35;
    LEAVES[HIT_LEAF_I].triIdx.forEach(function (ti, k) {
      var w2 = tw + k * 0.5;
      tl.to(triEls[ti], { attr: { stroke: AMBER, 'stroke-width': 2.4 }, duration: 0.25 }, w2);
      if (ti === HIT_TRI) {
        tl.to(triEls[ti], { attr: { 'stroke-width': 2.2 }, duration: 0.4 }, w2 + 0.55);
        tl.to(hitRing, { attr: { r: 9 }, duration: 0.08 }, w2 + 0.2);
        tl.to(hitRing, { attr: { opacity: 1, r: 16 }, duration: 0.55, ease: 'power1.out' }, w2 + 0.28);
        tl.to(checkEl, { attr: { opacity: 1 }, duration: 0.55 }, w2 + 0.28);
      } else {
        tl.to(triEls[ti], { attr: { 'stroke-width': 2.0 }, duration: 0.4 }, w2 + 0.55);
      }
    });
    tl.add(function () {
      tallyEl.textContent = COUNTS.boxTests + ' box + ' + COUNTS.triTestsBVH +
        ' triangle tests — instead of ' + COUNTS.triTestsBrute;
      tallyEl.setAttribute('fill', RED);
    }, tw + 1.3);
    tl.to({}, { duration: 0.3 }, '>');
    tl.addLabel('s5', tl.duration());
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetDom();
      buildTimeline();
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      /* seek without suppressing events so the tally/badge callbacks run
       * on a direct jump into the middle of the deck */
      if (fragStep > 0) tl.seek(D.stopsFor(tl, SECTIONS)[fragStep], false);
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
    P0: P0, DIR: DIR,
    rayBox: rayBox,
    ROOT: ROOT, CHILDREN: CHILDREN, LEAVES: LEAVES,
    TRIS: TRIS, TEST_ORDER: TEST_ORDER, HIT_TRI: HIT_TRI,
    HIT_MARK: HIT_MARK,
    ROOT_HIT: ROOT_HIT, CHILD_HITS: CHILD_HITS, LEAF_HITS: LEAF_HITS,
    HIT_CHILD_I: HIT_CHILD_I, HIT_LEAF_I: HIT_LEAF_I,
    COUNTS: COUNTS, sections: SECTIONS,
    rootExcludedFromTests: true
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.bvhintro = animator;
})();
