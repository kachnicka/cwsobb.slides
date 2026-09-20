/* Build pipeline animator — paper Fig. 2, four stages.
 * One tree morphs through the whole pipeline:
 *   s1: binary AABB BVH appears (PLOC++ build)
 *   s2: leaf collapse — 8 leaves merge into 4 fat wide-leaf nodes
 *   s3: interior collapse — remaining internals merge into the wide root
 *   s4: SOBB fit glyphs tilt inside each wide node (orient + compress)
 * One fragment per stage; stage chips at the top track progress.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;

  /* ==================== LAYOUT DATA (viewBox 0 0 1120 520) ==================== */

  /* binary layout: node centers + square size */
  var SQ = 26;
  var BIN = {
    r:  { cx: 560, cy: 96 },
    u:  { cx: 340, cy: 200 },
    v:  { cx: 780, cy: 200 },
    w0: { cx: 230, cy: 304 },
    w1: { cx: 450, cy: 304 },
    w2: { cx: 670, cy: 304 },
    w3: { cx: 890, cy: 304 },
    s0: { cx: 190, cy: 408 }, s1: { cx: 270, cy: 408 },
    s2: { cx: 410, cy: 408 }, s3: { cx: 490, cy: 408 },
    s4: { cx: 630, cy: 408 }, s5: { cx: 710, cy: 408 },
    s6: { cx: 850, cy: 408 }, s7: { cx: 930, cy: 408 }
  };
  var LEAFSQ = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
  var BIN_EDGES = [
    ['r', 'u'], ['r', 'v'],
    ['u', 'w0'], ['u', 'w1'], ['v', 'w2'], ['v', 'w3'],
    ['w0', 's0'], ['w0', 's1'], ['w1', 's2'], ['w1', 's3'],
    ['w2', 's4'], ['w2', 's5'], ['w3', 's6'], ['w3', 's7']
  ];
  /* which level-2 node each leaf merges into (stage 2) */
  var LEAF_PARENT = { s0: 'w0', s1: 'w0', s2: 'w1', s3: 'w1', s4: 'w2', s5: 'w2', s6: 'w3', s7: 'w3' };

  /* wide-node final geometry (stage 3+) */
  var WIDE = {
    root: { x: 390, y: 66, w: 340, h: 70 },
    w0: { x: 130, y: 300, w: 200, h: 60 },
    w1: { x: 350, y: 300, w: 200, h: 60 },
    w2: { x: 570, y: 300, w: 200, h: 60 },
    w3: { x: 790, y: 300, w: 200, h: 60 }
  };
  var WIDE_LEAVES = ['w0', 'w1', 'w2', 'w3'];

  var CHIPS = [
    '1 · binary build', '2 · leaf collapse',
    '3 · interior collapse', '4 · SOBB + compress'
  ];
  var CHIP_W = 230, CHIP_H = 36;
  var CHIP_X = [40, 315, 590, 865], CHIP_Y = 26;

  var CAPTIONS = [
    'The build pipeline — four stages, topology only set once.',
    'Stage 1 — fast binary AABB BVH (PLOC++).',
    'Stage 2 — leaf collapse: triangles grouped under wide leaves.',
    'Stage 3 — interior collapse: binary fan-out merges into one 8-ary node.',
    'Stage 4 — fit SOBBs per node, quantize and compress.'
  ];

  /* ==================== build ==================== */

  var built = false;
  var svg;
  var nodeEls = {};     // binary squares
  var binEdgeEls = [];  // {el, a, b}
  var wideEdgeEls = [];
  var leafGlyphs = [];  // mini triangles inside wide leaves
  var tiltGlyphs = [];  // SOBB glyphs (group elements)
  var slotLines = [];   // dividers inside the wide root
  var chipRects = [], chipTexts = [];
  var captionEl;
  var tl = null;

  /* chip styles — ATTRIBUTE based (animated inside the timeline) */
  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: D.EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  function setChip(i, styleName) {
    var s = CHIP_STYLE[styleName];
    chipRects[i].setAttribute('fill', s.fill);
    chipRects[i].setAttribute('stroke', s.stroke);
    chipTexts[i].setAttribute('fill', s.txt);
  }

  function build() {
    var host = document.getElementById('pipe-canvas');
    svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);

    /* stage chips */
    CHIPS.forEach(function (c, i) {
      var g = el('g', {}, svg);
      var r = el('rect', {
        x: CHIP_X[i], y: CHIP_Y, width: CHIP_W, height: CHIP_H, rx: 6,
        'stroke-width': 1.4
      }, g);
      var t = text(c, {
        x: CHIP_X[i] + CHIP_W / 2, y: CHIP_Y + 23,
        'text-anchor': 'middle', 'font-size': 15
      }, g);
      chipRects.push(r); chipTexts.push(t);
      if (i < 3) {
        text('→', {
          x: CHIP_X[i] + CHIP_W + 22, y: CHIP_Y + 23,
          'text-anchor': 'middle', 'font-size': 16, fill: FAINT
        }, svg);
      }
    });

    /* binary edges */
    BIN_EDGES.forEach(function (pair) {
      var a = BIN[pair[0]], b = BIN[pair[1]];
      var l = el('line', {
        x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy,
        'stroke-width': 1.4
      }, svg);
      binEdgeEls.push({ el: l, a: pair[0], b: pair[1] });
    });

    /* binary nodes (squares) */
    Object.keys(BIN).forEach(function (id) {
      var n = BIN[id];
      var r = el('rect', {
        x: n.cx - SQ / 2, y: n.cy - SQ / 2, width: SQ, height: SQ, rx: 4,
        fill: '#ffffff', 'stroke-width': 1.5
      }, svg);
      nodeEls[id] = r;
    });

    /* wide-node edges (appear in stage 3) */
    var root = WIDE.root;
    WIDE_LEAVES.forEach(function (id) {
      var w = WIDE[id];
      var l = el('line', {
        x1: root.x + root.w / 2, y1: root.y + root.h,
        x2: w.x + w.w / 2, y2: w.y,
        'stroke-width': 1.5
      }, svg);
      wideEdgeEls.push(l);
    });

    /* slot dividers inside the wide root (interior collapse read-out) */
    for (var i = 1; i < 4; i++) {
      slotLines.push(el('line', {
        x1: root.x + (root.w / 4) * i, y1: root.y + 8,
        x2: root.x + (root.w / 4) * i, y2: root.y + root.h - 8,
        'stroke-width': 1.2
      }, svg));
    }

    /* mini triangle clusters inside each wide leaf */
    WIDE_LEAVES.forEach(function (id) {
      var w = WIDE[id];
      for (var k = 0; k < 3; k++) {
        var bx = w.x + 28 + k * 56, by = w.y + 16;
        leafGlyphs.push(el('polygon', {
          points: bx + ',' + (by + 6) + ' ' + (bx + 30) + ',' + by + ' ' + (bx + 22) + ',' + (by + 28),
          'stroke-width': 1.1
        }, svg));
      }
    });

    /* SOBB tilt glyph inside every wide node (stage 4) */
    var glyphHosts = [WIDE.root].concat(WIDE_LEAVES.map(function (id) { return WIDE[id]; }));
    glyphHosts.forEach(function (w) {
      var cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      var g = el('g', {
        transform: 'rotate(0 ' + cx + ' ' + cy + ')'
      }, svg);
      var r = el('rect', {
        x: cx - 34, y: cy - 12, width: 68, height: 24, rx: 3,
        'stroke-width': 1.6
      }, g);
      tiltGlyphs.push({ g: g, rect: r, cx: cx, cy: cy });
    });

    captionEl = document.getElementById('pipe-caption');
    built = true;
  }

  /* ==================== state / reset ==================== */

  function resetDom() {
    Object.keys(nodeEls).forEach(function (id) {
      gsap.killTweensOf(nodeEls[id]);
      var n = BIN[id];
      nodeEls[id].setAttribute('x', n.cx - SQ / 2);
      nodeEls[id].setAttribute('y', n.cy - SQ / 2);
      nodeEls[id].setAttribute('width', SQ);
      nodeEls[id].setAttribute('height', SQ);
      nodeEls[id].setAttribute('rx', 4);
      nodeEls[id].setAttribute('opacity', 0);
      nodeEls[id].setAttribute('stroke', INK);
    });
    binEdgeEls.forEach(function (e) {
      gsap.killTweensOf(e.el);
      var a = BIN[e.a], b = BIN[e.b];
      e.el.setAttribute('x1', a.cx); e.el.setAttribute('y1', a.cy);
      e.el.setAttribute('x2', b.cx); e.el.setAttribute('y2', b.cy);
      e.el.setAttribute('opacity', 0);
      e.el.setAttribute('stroke', EDGE);
    });
    wideEdgeEls.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', EDGE);
    });
    slotLines.forEach(function (l) {
      gsap.killTweensOf(l);
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke', EDGE);
    });
    leafGlyphs.forEach(function (p) {
      gsap.killTweensOf(p);
      p.setAttribute('opacity', 0);
      p.setAttribute('fill', LIGHT);
      p.setAttribute('stroke', INK);
    });
    tiltGlyphs.forEach(function (t) {
      gsap.killTweensOf(t.g);
      gsap.killTweensOf(t.rect);
      t.g.setAttribute('transform', 'rotate(0 ' + t.cx + ' ' + t.cy + ')');
      t.rect.setAttribute('opacity', 0);
      t.rect.setAttribute('fill', 'none');
      t.rect.setAttribute('stroke', BLUE);
    });
    for (var i = 0; i < 4; i++) setChip(i, 'todo');
  }

  /* ==================== timeline ==================== */

  var SECTIONS = 4;

  /* chip styling as timeline sets (reverse-safe, unlike callbacks) */
  function tlChip(timeline, i, styleName, pos) {
    var s = CHIP_STYLE[styleName];
    timeline.set(chipRects[i], { attr: { fill: s.fill, stroke: s.stroke } }, pos);
    timeline.set(chipTexts[i], { attr: { fill: s.txt } }, pos);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var at;

    /* s1 — binary tree appears */
    tl.to({}, { duration: 0.15 }, '>');
    tlChip(tl, 0, 'active', '>');
    at = tl.duration();
    tl.to(binEdgeEls.map(function (e) { return e.el; }),
      { attr: { opacity: 1 }, duration: 0.6, stagger: 0.03, ease: 'power1.out' }, at);
    tl.to(Object.keys(nodeEls).map(function (id) { return nodeEls[id]; }),
      { attr: { opacity: 1 }, duration: 0.6, stagger: 0.035, ease: 'power1.out' }, at);
    tl.addLabel('s1', tl.duration()); /* label at true timeline end */

    /* s2 — leaf collapse: leaves fly into their level-2 parent, parents fatten */
    tl.to({}, { duration: 0.25 }, '>');
    tlChip(tl, 0, 'done', '>');
    tlChip(tl, 1, 'active', '>');
    at = tl.duration();
    LEAFSQ.forEach(function (s) {
      var target = BIN[LEAF_PARENT[s]];
      tl.to(nodeEls[s], {
        attr: {
          x: target.cx - SQ / 2, y: target.cy - SQ / 2,
          opacity: 0
        },
        duration: 0.75, ease: 'power2.inOut'
      }, at);
    });
    // leaf edges fade
    tl.to(binEdgeEls.filter(function (e) {
      return LEAFSQ.indexOf(e.b) >= 0;
    }).map(function (e) { return e.el; }),
      { attr: { opacity: 0 }, duration: 0.4 }, at);
    // level-2 nodes fatten into wide leaves
    WIDE_LEAVES.forEach(function (id) {
      var w = WIDE[id];
      tl.to(nodeEls[id], {
        attr: { x: w.x, y: w.y, width: w.w, height: w.h, rx: 8 },
        duration: 0.8, ease: 'power2.inOut'
      }, at + 0.15);
    });
    // mini triangle glyphs appear inside wide leaves
    tl.to(leafGlyphs, { attr: { opacity: 1 }, duration: 0.5, stagger: 0.03 }, at + 0.95);
    tl.addLabel('s2', tl.duration()); /* label at true timeline end */

    /* s3 — interior collapse: mid internals fly into the root, root fatten */
    tl.to({}, { duration: 0.25 }, '>');
    tlChip(tl, 1, 'done', '>');
    tlChip(tl, 2, 'active', '>');
    at = tl.duration();
    var rootC = BIN.r, rootW = WIDE.root;
    ['u', 'v'].forEach(function (id) {
      tl.to(nodeEls[id], {
        attr: {
          x: rootC.cx - SQ / 2, y: rootC.cy - SQ / 2, opacity: 0
        },
        duration: 0.75, ease: 'power2.inOut'
      }, at);
    });
    // upper binary edges fade (all edges that touch r, u or v)
    tl.to(binEdgeEls.filter(function (e) {
      return e.a === 'r' || e.a === 'u' || e.a === 'v';
    }).map(function (e) { return e.el; }),
      { attr: { opacity: 0 }, duration: 0.4 }, at);
    // root becomes the wide root node
    tl.to(nodeEls.r, {
      attr: { x: rootW.x, y: rootW.y, width: rootW.w, height: rootW.h, rx: 10 },
      duration: 0.8, ease: 'power2.inOut'
    }, at + 0.15);
    tl.to(wideEdgeEls, { attr: { opacity: 1 }, duration: 0.5 }, at + 0.95);
    tl.to(slotLines, { attr: { opacity: 1 }, duration: 0.5 }, at + 0.95);
    tl.addLabel('s3', tl.duration()); /* label at true timeline end */

    /* s4 — SOBB fit: glyphs fade in and tilt, node strokes go blue */
    tl.to({}, { duration: 0.25 }, '>');
    tlChip(tl, 2, 'done', '>');
    tlChip(tl, 3, 'active', '>');
    at = tl.duration();
    tiltGlyphs.forEach(function (t) {
      tl.to(t.rect, { attr: { opacity: 1 }, duration: 0.4 }, at);
      tl.to(t.g, {
        attr: { transform: 'rotate(-9 ' + t.cx + ' ' + t.cy + ')' },
        duration: 0.9, ease: 'power2.inOut'
      }, at);
    });
    tl.to([nodeEls.r, nodeEls.w0, nodeEls.w1, nodeEls.w2, nodeEls.w3],
      { attr: { stroke: BLUE }, duration: 0.5 }, at + 0.3);
    tl.to(wideEdgeEls, { attr: { stroke: BLUE }, duration: 0.5 }, at + 0.3);
    tlChip(tl, 3, 'done', at + 1.0);
    tl.addLabel('s4', tl.duration()); /* label at true timeline end */
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
    layout: { BIN: BIN, WIDE: WIDE, WIDE_LEAVES: WIDE_LEAVES, LEAF_PARENT: LEAF_PARENT },
    sections: SECTIONS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.pipeline = animator;
})();
