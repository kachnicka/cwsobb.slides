/* Ordered traversal & early-out animator — paper Sec. 3.4/3.5.
 *
 * One wide node with 8 child AABBs; a ray crosses the node.
 * Children are tested in stored (octant-derived, front-to-back for
 * this ray) order; the first geometry hit ends traversal and the
 * remaining children are culled untested.
 *
 * All hit/miss/t data come from real ray–AABB slab tests on the
 * authored boxes — exported for the harness: ascending t order,
 * culled set, hit point inside the hit box.
 *
 * s1: ray sweeps; children tested in order, t badges, hit found
 * s2: remaining children fade (culled), hit point locks
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, RED = D.RED, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT;

  /* ==================== LAYOUT DATA (viewBox 0 0 640 560) ==================== */

  var PARENT = { x: 60, y: 60, w: 540, h: 460 };

  /* child boxes: id -> rect (4 cols x 2 rows, gaps) */
  var BOXES = [
    { x: 100, y: 120, w: 100, h: 140 },
    { x: 220, y: 120, w: 100, h: 140 },
    { x: 340, y: 120, w: 100, h: 140 },
    { x: 460, y: 120, w: 100, h: 140 },
    { x: 100, y: 300, w: 100, h: 140 },
    { x: 220, y: 300, w: 100, h: 140 },
    { x: 340, y: 300, w: 100, h: 140 },
    { x: 460, y: 300, w: 100, h: 140 }
  ];

  /* ray: P(t) = P0 + t * D */
  var P0 = [40, 470], DIR = [540, -360];

  /* which child holds geometry the ray actually hits (demo choice):
   * the ray enters several boxes; geometry hit is placed in HIT_ID */
  var HIT_ID = 3;

  var CAPTIONS = [
    'Stored child order matches the ray direction — front to back for this octant.',
    'Test children in stored order; t is the box entry distance.',
    'First geometry hit ends the traversal — the rest is culled untested.'
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

  /* test order = ascending entry t of ray-intersected boxes, misses last */
  function computeTests() {
    var tests = BOXES.map(function (b, id) {
      var r = rayBox(b, P0, DIR);
      return { id: id, hit: !!r, t: r ? r.t : Infinity };
    });
    tests.sort(function (a, b) { return a.t - b.t; });
    return tests;
  }

  var TESTS = computeTests();
  /* story: walk the ordered tests; geometry HIT is inside HIT_ID's box */
  var ORDER = TESTS;
  var HIT_T = (function () {
    for (var i = 0; i < ORDER.length; i++) {
      if (ORDER[i].id === HIT_ID) return ORDER[i].t;
    }
    return 1;
  })();
  var CULLED = ORDER.filter(function (t) { return t.t > HIT_T; }).map(function (t) { return t.id; });
  var TESTED = ORDER.filter(function (t) { return t.t <= HIT_T; });

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var parentRect, boxEls = [], idTexts = [];
  var rayLine, rayDot;
  var badgeEls = [], badgeTexts = [];
  var hitRing, cullCap, orderCap;
  var captionEl;
  var tl = null;
  var rayStart = { t: 0, x: 0, y: 0 };  // parent entry point of the ray
  var RAY_END_T = 0.98;                  // param where the drawn segment stops

  function build() {
    var host = document.getElementById('ray-canvas');
    svg = el('svg', { viewBox: '0 0 640 560', width: '100%', height: '100%' }, host);

    parentRect = el('rect', {
      x: PARENT.x, y: PARENT.y, width: PARENT.w, height: PARENT.h,
      fill: 'none', stroke: INK, 'stroke-width': 1.8
    }, svg);
    text('wide node', {
      x: PARENT.x + 6, y: PARENT.y - 14, 'font-size': 14, fill: FAINT
    }, svg);

    /* child boxes */
    BOXES.forEach(function (b, id) {
      var r = el('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h,
        fill: '#ffffff', stroke: INK, 'stroke-width': 1.5
      }, svg);
      boxEls.push(r);
      idTexts.push(text('id ' + id, {
        x: b.x + b.w / 2, y: b.y + 24, 'text-anchor': 'middle',
        'font-size': 14, fill: FAINT
      }, svg));
      /* tiny triangle glyph inside each child */
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 18;
      el('polygon', {
        points: (cx - 26) + ',' + (cy + 18) + ' ' + (cx + 28) + ',' + (cy + 10) + ' ' + (cx + 6) + ',' + (cy - 20),
        fill: D.LIGHT, stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round'
      }, svg);
    });

    /* order badges + t badges (one pair per child, hidden) */
    BOXES.forEach(function (b, id) {
      badgeEls.push(text('', {
        x: b.x + b.w / 2, y: b.y - 12, 'text-anchor': 'middle',
        'font-size': 15, fill: BLUE, opacity: 0, 'font-weight': 650
      }, svg));
      badgeTexts.push(text('', {
        x: b.x + b.w / 2, y: b.y + b.h + 24, 'text-anchor': 'middle',
        'font-size': 13, fill: INK, opacity: 0
      }, svg));
    });

    /* ray (drawn from parent entry point to a stop inside the node) */
    var pe = rayBox(PARENT, P0, DIR);
    rayStart.t = pe ? pe.t : 0;
    rayStart.x = P0[0] + DIR[0] * rayStart.t;
    rayStart.y = P0[1] + DIR[1] * rayStart.t;
    rayLine = el('line', {
      x1: rayStart.x, y1: rayStart.y, x2: rayStart.x, y2: rayStart.y,
      stroke: INK, 'stroke-width': 2, opacity: 0
    }, svg);
    rayDot = el('circle', {
      cx: rayStart.x, cy: rayStart.y, r: 5, fill: INK, opacity: 0
    }, svg);

    orderCap = text('', {
      x: 330, y: 552, 'text-anchor': 'middle', 'font-size': 14, fill: FAINT, opacity: 0
    }, svg);

    /* hit marker — placed slightly PAST box entry (HIT_T is exactly on
       box id 3's left border, and a ring straddling the border reads as
       a stray circle between cells). +0.06 in t keeps the ring on the
       ray but unambiguously inside the hit box, with clear margins even
       at the pulse's max radius (r=16). */
    var HIT_MARK_T = HIT_T + 0.06;
    var hx = P0[0] + DIR[0] * HIT_MARK_T, hy = P0[1] + DIR[1] * HIT_MARK_T;
    hitRing = el('circle', {
      cx: hx, cy: hy, r: 14, fill: 'none', stroke: RED, 'stroke-width': 2.4, opacity: 0
    }, svg);

    cullCap = text('4 of 8 children culled — no box test, no traversal', {
      x: 330, y: 552, 'text-anchor': 'middle', 'font-size': 15, fill: RED, opacity: 0
    }, svg);

    captionEl = document.getElementById('ray-caption');
    built = true;
  }

  /* ==================== reset ==================== */

  function resetDom() {
    boxEls.forEach(function (r) {
      gsap.killTweensOf(r);
      r.setAttribute('opacity', 1);
      r.setAttribute('fill', '#ffffff');
      r.setAttribute('stroke', INK);
      r.setAttribute('stroke-width', 1.5);
    });
    idTexts.forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 1);
    });
    badgeEls.forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 0);
      t.textContent = '';
    });
    badgeTexts.forEach(function (t) {
      gsap.killTweensOf(t);
      t.setAttribute('opacity', 0);
      t.textContent = '';
    });
    gsap.killTweensOf(rayLine);
    rayLine.setAttribute('x2', rayLine.getAttribute('x1'));
    rayLine.setAttribute('y2', rayLine.getAttribute('y1'));
    rayLine.setAttribute('opacity', 0);
    gsap.killTweensOf(rayDot);
    rayDot.setAttribute('opacity', 0);
    gsap.killTweensOf(hitRing);
    hitRing.setAttribute('opacity', 0);
    gsap.killTweensOf(orderCap);
    orderCap.setAttribute('opacity', 0);
    gsap.killTweensOf(cullCap);
    cullCap.setAttribute('opacity', 0);
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 2;

  function fmtT(t) { return 't=' + t.toFixed(2); }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — ray sweeps through the node; ordered tests with t badges */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    tl.to(rayLine, { attr: { opacity: 1 }, duration: 0.2 }, at);
    tl.to(rayDot, { attr: { opacity: 1 }, duration: 0.2 }, at);
    // sweep the segment from parent entry to full length, and drag the dot
    var ex = P0[0] + DIR[0] * RAY_END_T, ey = P0[1] + DIR[1] * RAY_END_T;
    var SWEEP = 1.15;
    tl.to(rayLine, {
      attr: { x2: ex, y2: ey }, duration: SWEEP, ease: 'power1.inOut'
    }, at);
    tl.to(rayDot, { attr: { cx: ex, cy: ey }, duration: SWEEP, ease: 'power1.inOut' }, at);
    tl.add(function () {
      orderCap.textContent = 'test order (stored): ' +
        TESTED.map(function (t) { return t.id; }).join(' → ') +
        (CULLED.length ? ' → …' : '');
    }, at);
    tl.to(orderCap, { attr: { opacity: 1 }, duration: 0.4 }, at + 0.2);

    // each test: box flashes, order number + t badge; the hit box turns red
    TESTED.forEach(function (test, i) {
      // sync the flash to the sweep tip reaching the box entry point
      var frac = (test.t - rayStart.t) / (RAY_END_T - rayStart.t);
      var when = at + frac * SWEEP;
      var isHit = test.id === HIT_ID;
      var r = boxEls[test.id];
      tl.to(r, {
        attr: { stroke: isHit ? RED : BLUE, 'stroke-width': 2.4 },
        duration: 0.25
      }, when);
      if (!isHit) {
        tl.to(r, {
          attr: { stroke: INK, 'stroke-width': 1.5 },
          duration: 0.5
        }, when + 0.55);
      }
      tl.add(function () {
        badgeEls[test.id].textContent = String(i + 1) + (isHit ? ' ✓' : '');
        badgeTexts[test.id].textContent = fmtT(test.t) + (isHit ? ' — hit' : '');
      }, when);
      tl.to(badgeEls[test.id], { attr: { opacity: 1 }, duration: 0.25 }, when);
      tl.to(badgeTexts[test.id], { attr: { opacity: 1 }, duration: 0.25 }, when);
    });
    // hit ring pulse at sweep end
    tl.fromTo(hitRing, { attr: { opacity: 1, r: 8 } },
      { attr: { r: 16 }, duration: 0.6, ease: 'power1.out' }, at + 1.25);
    tl.addLabel('s1', tl.duration()); /* label at true timeline end */

    /* s2 — cull: everything after the hit fades */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    CULLED.forEach(function (id) {
      tl.to([boxEls[id], idTexts[id], badgeEls[id], badgeTexts[id]],
        { attr: { opacity: 0.22 }, duration: 0.6 }, at);
    });
    tl.to(cullCap, { attr: { opacity: 1 }, duration: 0.5 }, at + 0.4);
    tl.addLabel('s2', tl.duration()); /* label at true timeline end */
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
    BOXES: BOXES, PARENT: PARENT, P0: P0, DIR: DIR, HIT_ID: HIT_ID,
    rayBox: rayBox, computeTests: computeTests,
    TESTS: TESTS, HIT_T: HIT_T, CULLED: CULLED, TESTED: TESTED,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.raytest = animator;
})();
