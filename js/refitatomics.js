/* Atomic-congestion animator — L9.5 "Atomics — pressure self-balances".
 *
 * Re-imagination of the paper's congestion figure (per-depth local
 * tests vs global atomics, Bistro ext. 2.8M tris) in deck language.
 *
 * The story: green (local tests) rides high through the whole tree —
 * every thread tests every node on its path. Red (atomic writes) hugs
 * zero at the root and bells out toward the leaf side. Pressure
 * self-balances: near the root all threads hit few nodes but
 * pre-testing filters almost everything; near the leaves writes peak,
 * but nodes are many and per-node contenders few.
 *
 * Lines draw right-to-left (leaves first, root last) — the refit's own
 * work order: the tree is maintained bottom-up, so the sweep starts
 * where the work starts. Polyline point order is simply reversed;
 * dashoffset then grows the stroke from the leaf side.
 *
 * Curves are hand-shaped to the paper figure (green plateau ~8M then
 * taper, red bell peaking ~2/3 down-tree, zero at depth 0); no y units
 * and no percentages — the shape carries the argument.
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: scaffold — axis, depth captions
 *   s2: green local-tests line sweeps in from the leaf side + legend
 *   s3: red atomics line + legend + faint red area
 *   s4: the two "why" cards — root side vs leaf side
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT;
  var SOFT = '#5b6068';
  var GREEN = '#2f9e5f';           // local tests (thread color, match L9)
  var ATOMIC_RED = '#c23c3c';      // atomics (match L9)

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ==================== */

  var N = 15;                       // depths 0..14, 0 = root (paper parity)
  var X0 = 96, DX = 62;             // depth d -> x = X0 + d*DX
  var YBASE = 340, YSCALE = 34;     // value v -> y = YBASE - v*YSCALE, v in M

  /* per-depth totals (millions), shaped to the paper figure */
  var TESTS = [8.0, 8.02, 8.04, 8.03, 8.05, 8.0, 7.98, 7.9, 7.2, 5.4, 3.2, 1.6, 0.7, 0.3, 0.12];
  var RATIO = [3e-6, 1e-5, 4e-4, 0.004, 0.02, 0.08, 0.16, 0.22, 0.24, 0.25, 0.22, 0.20, 0.19, 0.18, 0.17];
  var ATOM = TESTS.map(function (t, d) { return t * RATIO[d]; });

  var WHY1A = 'root side — every thread passes through few nodes';
  var WHY1B = 'almost every test stays local, atomics nearly vanish';
  var WHY2A = 'leaf side — atomics cluster here';
  var WHY2B = 'nodes are many, contenders per node few';

  /* ==================== pure helpers ==================== */

  function X(d) { return X0 + d * DX; }
  function Y(v) { return YBASE - v * YSCALE; }

  /* points string; rev=true walks depths leaves->root so dashoffset
   * draws the stroke right-to-left */
  function ptsStr(vals, rev) {
    var out = [];
    for (var d = 0; d < vals.length; d++) {
      var i = rev ? vals.length - 1 - d : d;
      out.push(Math.round(X(i) * 10) / 10 + ',' + Math.round(Y(vals[i]) * 10) / 10);
    }
    return out.join(' ');
  }

  function pathLen(vals) {
    var L = 0;
    for (var d = 1; d < vals.length; d++) {
      L += Math.hypot(X(d) - X(d - 1), Y(vals[d]) - Y(vals[d - 1]));
    }
    return L;
  }

  /* ==================== DOM refs ==================== */

  var built = false;
  var svg;
  var scaffoldG, greenLine, redLine, redArea, greenDots = [], redDots = [];
  var legendGreen, legendRed;
  var why1, why2;
  var tl = null;
  var SECTIONS = 4;

  /* ==================== build ==================== */

  function build() {
    var host = document.getElementById('atomics-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);

    /* ---- scaffold (s1 fades in): axis, depth ticks/captions ---- */
    scaffoldG = el('g', { opacity: 0 }, svg);
    el('line', { x1: 60, y1: YBASE, x2: 1080, y2: YBASE, stroke: SOFT, 'stroke-width': 1.5 }, scaffoldG);
    for (var d = 0; d < N; d++) {
      el('line', { x1: X(d), y1: YBASE, x2: X(d), y2: YBASE + 5, stroke: FAINT, 'stroke-width': 1 }, scaffoldG);
    }
    text('depth 0 = root', { x: 60, y: 364, 'font-size': 18, fill: FAINT }, scaffoldG);
    text('depth 14 = leaves', { x: 1026, y: 364, 'text-anchor': 'end', 'font-size': 18, fill: FAINT }, scaffoldG);

    /* ---- data lines: drawn with dashoffset sweeps (attrs, GSAP-safe).
     * Point order is leaves->root, so offset->0 paints right-to-left.
     * NB: dasharray = len+1 with rest offset len+1.5 parks every dash/
     * gap boundary off the path — with round caps, a zero-length dash
     * boundary coinciding with the path renders a phantom dot. ---- */
    var greenLen = pathLen(TESTS), redLen = pathLen(ATOM);
    greenLine = el('polyline', {
      points: ptsStr(TESTS, true), fill: 'none', stroke: GREEN, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': greenLen + 1, 'stroke-dashoffset': greenLen + 1.5
    }, svg);
    redArea = el('polygon', {
      points: ptsStr(ATOM, true) + ' ' + X0 + ',' + YBASE + ' ' + X(N - 1) + ',' + YBASE,
      fill: ATOMIC_RED, opacity: 0
    }, svg);
    redLine = el('polyline', {
      points: ptsStr(ATOM, true), fill: 'none', stroke: ATOMIC_RED, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': redLen + 1, 'stroke-dashoffset': redLen + 1.5
    }, svg);
    for (var g = 0; g < N; g++) {
      greenDots.push(el('circle', { cx: X(g), cy: Y(TESTS[g]), r: 3, fill: GREEN, opacity: 0 }, svg));
      redDots.push(el('circle', { cx: X(g), cy: Y(ATOM[g]), r: 3, fill: ATOMIC_RED, opacity: 0 }, svg));
    }

    /* ---- legends (top-right: green rides at y~68-95 across x<=654, the
     * atomics bell peaks around y~281 — this corner is always empty) ---- */
    legendGreen = el('g', { opacity: 0 }, svg);
    el('line', { x1: 700, y1: 42, x2: 736, y2: 42, stroke: GREEN, 'stroke-width': 3 }, legendGreen);
    text('local boundary tests', { x: 746, y: 50, 'font-size': 18, fill: INK }, legendGreen);
    legendRed = el('g', { opacity: 0 }, svg);
    el('line', { x1: 700, y1: 78, x2: 736, y2: 78, stroke: ATOMIC_RED, 'stroke-width': 3 }, legendRed);
    text('atomic min/max writes', { x: 746, y: 86, 'font-size': 18, fill: INK }, legendRed);

    /* ---- why cards (s4): bordered cards, two lines each. They sit in
     * a dedicated band below the axis (y386-478): the chart is squashed
     * upward (YBASE 340) so 18px text fits at full width — green tail
     * bottoms out at y~336, depth captions end ~366, 20px clear. ---- */
    function whyCard(x, l1, l2) {
      var gEl = el('g', { opacity: 0 }, svg);
      el('rect', { x: x, y: 386, width: 450, height: 92, rx: 8, fill: '#ffffff', stroke: EDGE, 'stroke-width': 1.5 }, gEl);
      text(l1, { x: x + 225, y: 424, 'text-anchor': 'middle', 'font-size': 18, fill: INK }, gEl);
      text(l2, { x: x + 225, y: 455, 'text-anchor': 'middle', 'font-size': 17, fill: SOFT }, gEl);
      return gEl;
    }
    why1 = whyCard(80, WHY1A, WHY1B);
    why2 = whyCard(590, WHY2A, WHY2B);

    built = true;
  }

  /* ==================== state / reset ==================== */

  function resetDom() {
    [scaffoldG, legendGreen, legendRed, why1, why2].forEach(function (g) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
    });
    [[greenLine, pathLen(TESTS)], [redLine, pathLen(ATOM)]].forEach(function (pair) {
      gsap.killTweensOf(pair[0]);
      pair[0].setAttribute('stroke-dashoffset', pair[1] + 1.5);
    });
    gsap.killTweensOf(redArea);
    redArea.setAttribute('opacity', 0);
    greenDots.concat(redDots).forEach(function (dt) {
      gsap.killTweensOf(dt);
      dt.setAttribute('opacity', 0);
    });
  }

  /* ==================== timeline ==================== */

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    /* EXPLICIT section times (no phantom-spacer + '>' chaining at label
     * boundaries): stop labels must sit exactly past real tweens. */
    var a1 = 0.2, a2 = a1 + 0.9, a3 = a2 + 1.95, a4 = a3 + 1.9;

    /* s1 — scaffold: axis + depth captions */
    tl.to(scaffoldG, { attr: { opacity: 1 }, duration: 0.5 }, a1);
    tl.addLabel('s1', a2 - 0.25);

    /* s2 — green sweeps right->left (leaf side first), dots follow */
    tl.to(greenLine, { attr: { 'stroke-dashoffset': 0 }, duration: 1.6, ease: 'power1.inOut' }, a2);
    greenDots.forEach(function (dt, d) {
      tl.to(dt, { attr: { opacity: 1 }, duration: 0.2 }, a2 + 0.1 + ((N - 1 - d) / (N - 1)) * 1.5);
    });
    tl.to(legendGreen, { attr: { opacity: 1 }, duration: 0.4 }, a2 + 0.2);
    tl.addLabel('s2', a3 - 0.25);

    /* s3 — red sweeps right->left, legend, faint area */
    tl.to(redLine, { attr: { 'stroke-dashoffset': 0 }, duration: 1.4, ease: 'power1.inOut' }, a3);
    redDots.forEach(function (dt, d) {
      tl.to(dt, { attr: { opacity: 1 }, duration: 0.2 }, a3 + 0.1 + ((N - 1 - d) / (N - 1)) * 1.3);
    });
    tl.to(redArea, { attr: { opacity: 0.08 }, duration: 0.8 }, a3 + 0.9);
    tl.to(legendRed, { attr: { opacity: 1 }, duration: 0.4 }, a3 + 0.2);
    tl.addLabel('s3', a4 - 0.25);

    /* s4 — why cards: the self-balancing explanation */
    tl.to([why1, why2], { attr: { opacity: 1 }, duration: 0.55, stagger: 0.2 }, a4);
    tl.addLabel('s4', a4 + 0.8);
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetDom();
      buildTimeline();

      if (fragStep > 0) {
        tl.seek(D.stopsFor(tl, SECTIONS)[fragStep], true); // jump, no callbacks
      }

      gsap.fromTo(svg,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(D.stopsFor(tl, SECTIONS)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  /* pure layout exposure for headless smoke tests */
  animator._test = (function () {
    var pts = [];
    ptsStr(TESTS).split(' ').concat(ptsStr(ATOM).split(' ')).forEach(function (pair) {
      var xy = pair.split(',');
      pts.push([parseFloat(xy[0]), parseFloat(xy[1])]);
    });
    var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    pts.forEach(function (p) {
      box.x0 = Math.min(box.x0, p[0]); box.y0 = Math.min(box.y0, p[1]);
      box.x1 = Math.max(box.x1, p[0]); box.y1 = Math.max(box.y1, p[1]);
    });
    return {
      sections: SECTIONS,
      depths: N,
      atomPeak: Math.max.apply(null, ATOM),
      lineBounds: box,
      viewBox: [1120, 520]
    };
  })();

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.refitatomics = animator;
})();
