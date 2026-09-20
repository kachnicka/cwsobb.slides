/* Greedy swaps animator — paper Fig. 4.
 *
 * 8 slots, node IDs placed by greedy assignment; then the swap
 * iterations of the paper: iteration 1 swaps (0,2) and (6,4),
 * iteration 2 swaps (6,7). Cost = sum of |slot - homeSlot(id)| over
 * the converged order, so the counter provably decreases each step
 * and ends at 0 (converged). States are pure data — exported for
 * the harness to assert the cost sequence.
 *
 * s1: initial greedy assignment drops in, cost 10
 * s2: iteration 1 — swap pairs (0,2), (6,4), cost 2
 * s3: iteration 2 — swap (6,7), cost 0, converged
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT;

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 460) ==================== */

  var SLOT_W = 104, SLOT_H = 104, SLOT_GAP = 18;
  var ROW_Y = 130;
  var N = 8;

  /* greedy assignment: id placed at each slot */
  var INITIAL = [2, 5, 0, 7, 4, 1, 3, 6];
  /* the paper's swap iterations: pairs of NODE IDS */
  var ITER1 = [[0, 2], [6, 4]];
  var ITER2 = [[6, 7]];
  /* converged arrangement (after all swaps) used as the cost home */
  var HOME_ASSIGN = [0, 5, 2, 6, 7, 1, 3, 4];

  var CAPTIONS = [
    'Wide nodes store children in a fixed order — order costs ray-test work.',
    'Greedy initial assignment by ray octant.',
    'Iteration 1: swap pairs (0,2) and (6,4) — cost drops.',
    'Iteration 2: swap (6,7) — converged.'
  ];

  /* ==================== pure model (exported) ==================== */

  function posOf(assign) {
    var p = new Array(N);
    assign.forEach(function (id, slot) { p[id] = slot; });
    return p;
  }

  /* cost: distance of every id from its converged slot */
  function cost(assign) {
    var home = posOf(HOME_ASSIGN);
    var pos = posOf(assign);
    var c = 0;
    for (var id = 0; id < N; id++) c += Math.abs(pos[id] - home[id]);
    return c;
  }

  function applySwaps(assign, pairs) {
    var pos = posOf(assign);
    var out = assign.slice();
    pairs.forEach(function (pair) {
      var s0 = pos[pair[0]], s1 = pos[pair[1]];
      out[s0] = pair[1];
      out[s1] = pair[0];
      pos[pair[0]] = s1;
      pos[pair[1]] = s0;
    });
    return out;
  }

  var STATES = [INITIAL];
  STATES.push(applySwaps(INITIAL, ITER1));
  STATES.push(applySwaps(STATES[1], ITER2));
  var COSTS = STATES.map(cost);

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var slotEls = [], chipEls = [];   // chipEls[id] = <g> with rect+text
  var costText, iterText, deltaText, convText;
  var captionEl;
  var tl = null;
  var costProxy = { v: COSTS[0] };

  function slotX(slot) {
    var total = N * SLOT_W + (N - 1) * SLOT_GAP;
    return (1120 - total) / 2 + slot * (SLOT_W + SLOT_GAP);
  }

  function build() {
    var host = document.getElementById('swap-canvas');
    svg = el('svg', { viewBox: '0 0 1120 460', width: 1090, height: 448 }, host);

    /* slots */
    for (var s = 0; s < N; s++) {
      var r = el('rect', {
        x: slotX(s), y: ROW_Y, width: SLOT_W, height: SLOT_H, rx: 8,
        fill: '#ffffff', stroke: EDGE, 'stroke-width': 1.4
      }, svg);
      slotEls.push(r);
      text('slot ' + s, {
        x: slotX(s) + SLOT_W / 2, y: ROW_Y + SLOT_H + 28,
        'text-anchor': 'middle', 'font-size': 13, fill: FAINT
      }, svg);
    }

    /* chips: one <g> per node id, transformed with gsap x/y */
    for (var id = 0; id < N; id++) {
      var g = el('g', {}, svg);
      el('rect', {
        x: 4, y: 4, width: SLOT_W - 8, height: SLOT_H - 8, rx: 7,
        fill: '#ffffff', stroke: INK, 'stroke-width': 1.6
      }, g);
      text(String(id), {
        x: SLOT_W / 2, y: SLOT_H / 2 + 12,
        'text-anchor': 'middle', 'font-size': 34, fill: INK
      }, g);
      chipEls.push(g);
    }

    /* cost readout */
    text('total order cost', {
      x: 560, y: 330, 'text-anchor': 'middle', 'font-size': 16, fill: FAINT
    }, svg);
    costText = text(String(COSTS[0]), {
      x: 560, y: 392, 'text-anchor': 'middle', 'font-size': 52, fill: INK,
      'font-weight': 650
    }, svg);
    deltaText = text('', {
      x: 660, y: 392, 'text-anchor': 'start', 'font-size': 24, fill: BLUE
    }, svg);
    iterText = text('', {
      x: 560, y: 96, 'text-anchor': 'middle', 'font-size': 18, fill: BLUE
    }, svg);
    convText = text('', {
      x: 560, y: 432, 'text-anchor': 'middle', 'font-size': 16, fill: BLUE
    }, svg);

    captionEl = document.getElementById('swap-caption');
    built = true;
  }

  function placeChips(assign) {
    assign.forEach(function (id, slot) {
      gsap.set(chipEls[id], { x: slotX(slot), y: ROW_Y, opacity: 1 });
    });
  }

  /* ==================== reset ==================== */

  function resetDom() {
    chipEls.forEach(function (g) { gsap.killTweensOf(g); });
    slotEls.forEach(function (r) {
      gsap.killTweensOf(r);
      r.setAttribute('stroke', EDGE);
      r.setAttribute('fill', '#ffffff');
    });
    placeChips(INITIAL);
    // all chips start above the row for the drop-in (state at timeline t=0)
    chipEls.forEach(function (g) {
      gsap.set(g, { y: ROW_Y - 170, opacity: 0 });
    });
    costProxy.v = COSTS[0];
    costText.textContent = String(COSTS[0]);
    gsap.set([costText, iterText], { opacity: 0 });
    gsap.set(deltaText, { opacity: 0 });
    gsap.set(convText, { opacity: 0 });
    iterText.textContent = '';
    deltaText.textContent = '';
    convText.textContent = '';
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 3;

  /* swap animation: both chips lift, cross, land; slots flash blue.
   * Slot model is read at build time and committed immediately (GSAP
   * reversals handle the visual undo, the model is only positional). */
  var curSlot = [];

  function addSwap(timeline, idA, idB, at) {
    var sA = curSlot[idA], sB = curSlot[idB];
    var gA = chipEls[idA], gB = chipEls[idB];
    var xA = slotX(sA), xB = slotX(sB);
    timeline.to([gA, gB], { y: ROW_Y - 78, duration: 0.28, ease: 'power2.out' }, at);
    timeline.to(gA, { x: xB, duration: 0.55, ease: 'power2.inOut' }, at + 0.28);
    timeline.to(gB, { x: xA, duration: 0.55, ease: 'power2.inOut' }, at + 0.28);
    timeline.to([gA, gB], { y: ROW_Y, duration: 0.28, ease: 'power2.in' }, at + 0.83);
    timeline.set(slotEls[sA], { attr: { stroke: BLUE } }, at + 1.1);
    timeline.set(slotEls[sB], { attr: { stroke: BLUE } }, at + 1.1);
    timeline.set(slotEls[sA], { attr: { stroke: EDGE } }, at + 2.0);
    timeline.set(slotEls[sB], { attr: { stroke: EDGE } }, at + 2.0);
    curSlot[idA] = sB;
    curSlot[idB] = sA;
  }

  function addCostTo(timeline, target, at) {
    timeline.to(costText, { opacity: 1, duration: 0.3 }, at);
    timeline.to(costProxy, {
      v: target, duration: 0.7, ease: 'power1.inOut',
      onUpdate: function () { costText.textContent = String(Math.round(costProxy.v * 10) / 10); }
    }, at);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — greedy assignment drops in */
    tl.to({}, { duration: 0.15 }, '>');
    at = tl.duration();
    chipEls.forEach(function (g, id) {
      tl.to(g, { y: ROW_Y, opacity: 1, duration: 0.55, ease: 'power2.out' }, at + id * 0.05);
    });
    addCostTo(tl, COSTS[0], at + N * 0.05 + 0.2);
    tl.add(function () { iterText.textContent = 'greedy assignment'; }, at);
    tl.to(iterText, { opacity: 1, duration: 0.3 }, at);
    tl.addLabel('s1', tl.duration()); /* label at true timeline end */

    /* s2 — iteration 1: swap (0,2) and (6,4) */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.add(function () { iterText.textContent = 'iteration 1'; }, at);
    addSwap(tl, 0, 2, at);
    addSwap(tl, 6, 4, at + 0.15);
    addCostTo(tl, COSTS[1], at + 2.1);
    tl.add(function () {
      deltaText.textContent = '−' + (COSTS[0] - COSTS[1]);
    }, at + 2.2);
    tl.to(deltaText, { opacity: 1, duration: 0.3 }, at + 2.2);
    tl.addLabel('s2', tl.duration()); /* label at true timeline end */

    /* s3 — iteration 2: swap (6,7), converged */
    tl.to({}, { duration: 0.25 }, '>');
    at = tl.duration();
    tl.add(function () {
      iterText.textContent = 'iteration 2';
      deltaText.textContent = '';
    }, at);
    tl.to(deltaText, { opacity: 0, duration: 0.2 }, at);
    addSwap(tl, 6, 7, at);
    addCostTo(tl, COSTS[2], at + 2.1);
    tl.add(function () { convText.textContent = 'converged — no improving swap left'; }, at + 2.6);
    tl.to(convText, { opacity: 1, duration: 0.3 }, at + 2.6);
    tl.addLabel('s3', tl.duration()); /* label at true timeline end */
  }

  /* ==================== animator ==================== */

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      // model position tracking must follow the chips
      curSlot = posOf(INITIAL);
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
    INITIAL: INITIAL, ITER1: ITER1, ITER2: ITER2,
    STATES: STATES, COSTS: COSTS,
    cost: cost, applySwaps: applySwaps,
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.swaps = animator;
})();
