/* Build-pipeline animators — ONE story, told as THREE separate pipelines,
 * one slide each. All three share the same unbalanced binary AABB tree
 * and (B/C) the same approximate 8-ary collapse, so stepping from slide
 * to slide keeps the geometry stable — only the chip strip and the
 * continuation differ.
 *
 *   pipesobb2 (slide A — the old paper's chain, per-node fitting)
 *     s1 AABB BVH₂   — unbalanced binary build (SAH zigzag, 15 nodes)
 *     s2 fit k-DOP   — EVERY binary node transforms to its axis-aligned
 *                      hexagon k-DOP (shared slab directions)
 *     s3 SOBB BVH₂   — every node becomes an independently oriented,
 *                      skewed parallelogram SOBB. Nothing shared.
 *
 *   pipeaabb8 (slide B — state of the art)
 *     s1 AABB BVH₂   — identical binary build
 *     s2 AABB BVH₈   — interiors collapse to approximate 8-ary wide nodes
 *     s3 quantization — LEAD-IN + HAND-OFF: chip goes active, the four
 *                      wide leaves fade away, and the wide root slides
 *                      left into its stored slot-strip pose while its
 *                      bounds region opens on the right holding the eight
 *                      tight child AABBs — B's final frame IS the entry
 *                      frame of #slide-aabb-quant, pixel-for-pixel (the
 *                      story continues there without a cut)
 *
 *   pipesobb8 (slide C — our chain)
 *     s1 AABB BVH₂   — identical binary build
 *     s2 AABB BVH₈   — identical collapse
 *     s3 SOBB BVH₈   — wide nodes get skewed parallelogram SOBB proxies at
 *                      independent orientations (overlay; rects stay)
 *     s4 quantization — LEAD-IN ONLY: chip goes active, slots fall quiet,
 *                      the leaves dim so the wide root carries the
 *                      hand-off to #slide-sharedbasis (skewed-space
 *                      quantization is the next two slides' story)
 *
 * Chip strip on B ends: AABB BVH₂ / AABB BVH₈ done, quantization ACTIVE —
 * exactly the entry state on aabbquant, whose chip row mirrors B's geometry
 * pixel-for-pixel. Chip strip on C ends: AABB BVH₂ / AABB BVH₈ / SOBB BVH₈
 * done, quantization ACTIVE — exactly the entry state on sharedbasis, whose
 * BASE chip row mirrors C's geometry pixel-for-pixel (_test exports keep
 * both parities machine-checkable).
 * 3/3/4 fragments; GSAP timelines synced to labels s1..sN via
 * DeckSVG.stopsFor. All GSAP-animated paint props are SVG ATTRIBUTES.
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var el = D.el, text = D.text;
  var BLUE = D.BLUE, INK = D.INK, EDGE = D.EDGE, FAINT = D.FAINT, LIGHT = D.LIGHT;

  /* deterministic proxy randomness — stable seed, same picture every session */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20260922);

  /* ==================== SHARED LAYOUT DATA (viewBox 0 0 1120 520) ========== */

  var SQ = 26;
  /* UNBALANCED binary layout: left side carries the deep chain r-u-a-b-s0/s1
   * (depth 4) with s2/s3 stranded at depths 3/2; right side is a shallow
   * balanced subtree (depth 3). Sibling heights visibly differ under u and a. */
  var BIN = {
    r:  { cx: 560, cy: 90 },
    u:  { cx: 350, cy: 185 },
    v:  { cx: 800, cy: 185 },
    a:  { cx: 240, cy: 280 },
    s3: { cx: 450, cy: 280 },
    b:  { cx: 300, cy: 375 },
    s2: { cx: 180, cy: 375 },
    w2: { cx: 700, cy: 280 },
    w3: { cx: 900, cy: 280 },
    s0: { cx: 260, cy: 470 },
    s1: { cx: 340, cy: 470 },
    s4: { cx: 660, cy: 375 },
    s5: { cx: 740, cy: 375 },
    s6: { cx: 860, cy: 375 },
    s7: { cx: 940, cy: 375 }
  };
  var NODE_IDS = Object.keys(BIN);
  var LEAFSQ = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
  var MIDS = ['u', 'v', 'a', 'b', 'w2', 'w3'];
  /* build reveal order: root out, roughly depth by depth */
  var REVEAL = ['r', 'u', 'v', 'a', 'w2', 'w3', 's3', 'b', 's2', 's4', 's5', 's6', 's7', 's0', 's1'];
  var BIN_EDGES = [
    ['r', 'u'], ['r', 'v'],
    ['u', 'a'], ['u', 's3'],
    ['a', 'b'], ['a', 's2'],
    ['b', 's0'], ['b', 's1'],
    ['v', 'w2'], ['v', 'w3'],
    ['w2', 's4'], ['w2', 's5'],
    ['w3', 's6'], ['w3', 's7']
  ];
  /* which wide leaf each binary leaf collapses toward */
  var LEAF_TARGET = { s0: 'wl0', s1: 'wl0', s2: 'wl1', s3: 'wl1', s4: 'wl2', s5: 'wl2', s6: 'wl3', s7: 'wl3' };

  /* wide-node geometry after the collapse — approximate 8-ary layout */
  var WIDE = {
    root: { x: 390, y: 66, w: 340, h: 70 },
    wl0:  { x: 130, y: 300, w: 200, h: 60 },
    wl1:  { x: 350, y: 300, w: 200, h: 60 },
    wl2:  { x: 570, y: 300, w: 200, h: 60 },
    wl3:  { x: 790, y: 300, w: 200, h: 60 }
  };
  var WIDE_ORDER = ['wl0', 'wl1', 'wl2', 'wl3', 'root']; // bottom-up proxy order
  var SLOTS = 8;                                        // 8-ary wide root

  /* ---- proxies over the WIDE nodes (slide C overlay; same numbers the
   * old 'form SOBB' beat used — random sizes/rotations, deterministic) ---- */
  var PROXY_FILL = '#eaf2fd';
  var PARW = {}; // wide id -> {cx, cy, theta, swing, rel:[4], abs:[4]}
  (function computeWideProxies() {
    var i;
    WIDE_ORDER.forEach(function (id) {
      var W = WIDE[id], cx = W.x + W.w / 2, cy = W.y + W.h / 2;
      var root = id === 'root';
      /* root parallelogram must clear the chip row above it, INCLUDING the
       * rotate-in transient (chips bottom y=58): root extents are capped
       * tighter and swing in from only 6 degrees back */
      var a2 = (W.w / 2) * (root ? 0.48 + 0.08 * rand() : 0.72 + 0.2 * rand());
      var b2 = (W.h / 2) * (root ? 0.5 + 0.12 * rand() : 1.05 + 0.35 * rand());
      /* wl1 carries the one plain rectangle; the rest skew at 65..105 deg */
      var phi = (id === 'wl1' ? 90 : 65 + 40 * rand()) * Math.PI / 180;
      var theta = (rand() * 2 - 1) * (root ? 6 : 26);
      var e2 = [Math.cos(phi), Math.sin(phi)];
      var rel = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (s) {
        return [s[0] * a2 + s[1] * b2 * e2[0], s[1] * b2 * e2[1]];
      });
      var t = theta * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      var abs = rel.map(function (p) {
        return [cx + p[0] * ct - p[1] * st, cy + p[0] * st + p[1] * ct];
      });
      PARW[id] = { cx: cx, cy: cy, theta: theta, swing: root ? 6 : 18, phi: phi * 180 / Math.PI, rel: rel, abs: abs };
    });
  })();

  /* ---- proxies over the 15 BINARY nodes (slide A: hexagon k-DOPs that
   * become independent SOBB parallelograms). Sizes are role-capped so every
   * shape — including the rotate-in transient — clears the chip row, the
   * viewBox bottom and side margins (machine-checked via _test). ---- */
  var HEXB = {}, PARB = {};
  (function computeNodeProxies() {
    var i;
    /* independent orientations with a GUARANTEED pairwise gap: an evenly
     * spaced ladder of 15 rungs across ±26 deg (3.7 deg apart), shuffled
     * onto the nodes and jittered ±0.35 — maximal spread, never two
     * near-parallel fittings. Band-constrained nodes (root must stay ≤ 6
     * deg clear of the chip row; bottom leaves 8..14 deg for the viewBox
     * floor, transient included) CLAIM their nearest ladder rung first;
     * the rest draw shuffled rungs after. */
    var rungs = [];
    for (i = 0; i < NODE_IDS.length; i++) rungs.push(-26 + (52 * i) / (NODE_IDS.length - 1));
    function claimRung(lo, hi, jitter) {
      var best = -1, bi = -1;
      rungs.forEach(function (r, idx) {
        if (r >= lo && r <= hi && (best < 0 || Math.abs(r - (lo + hi) / 2) < best)) {
          best = Math.abs(r - (lo + hi) / 2); bi = idx;
        }
      });
      var r = rungs.splice(bi, 1)[0];
      return r + (rand() * 2 - 1) * jitter;
    }
    var THETA = {};
    THETA.r = claimRung(-5, 5, 0.35);
    THETA.s0 = claimRung(8, 14, 0.35);
    THETA.s1 = claimRung(8, 14, 0.35);
    /* shuffle the remaining rungs, then deal them out */
    for (i = rungs.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = rungs[i]; rungs[i] = rungs[j]; rungs[j] = tmp;
    }
    NODE_IDS.forEach(function (nid) {
      if (!(nid in THETA)) THETA[nid] = rungs.pop() + (rand() * 0.7 - 0.35);
    });
    NODE_IDS.forEach(function (nid) {
      var n = BIN[nid], cx = n.cx, cy = n.cy;
      var root = nid === 'r';
      var bottom = nid === 's0' || nid === 's1';
      var mid = MIDS.indexOf(nid) >= 0;

      /* hexagon half-extents */
      var hw = root ? 40 + 10 * rand()
        : bottom ? 26 + 6 * rand()
        : mid ? 34 + 12 * rand()
        : 30 + 12 * rand();
      var hh = root ? 21 + 4 * rand()
        : bottom ? 19 + 3 * rand()
        : 23 + 9 * rand();
      var hp = [];
      for (i = 0; i < 6; i++) {
        var ang = i * Math.PI / 3;
        hp.push([cx + hw * Math.cos(ang), cy + hh * Math.sin(ang)]);
      }
      HEXB[nid] = { cx: cx, cy: cy, hw: hw, hh: hh, pts: hp };

      /* parallelogram: independent orientation per node.
       * w3 carries the one plain rectangle (a plain OBB); the rest skew. */
      var a2 = hw * (0.72 + 0.2 * rand());
      var b2 = hh * (0.95 + 0.25 * rand());
      var phi = (nid === 'w3' ? 90 : 65 + 40 * rand()) * Math.PI / 180;
      var theta = THETA[nid];
      var e2 = [Math.cos(phi), Math.sin(phi)];
      var rel = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (s) {
        return [s[0] * a2 + s[1] * b2 * e2[0], s[1] * b2 * e2[1]];
      });
      var t = theta * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      var abs = rel.map(function (p) {
        return [cx + p[0] * ct - p[1] * st, cy + p[0] * st + p[1] * ct];
      });
      PARB[nid] = { cx: cx, cy: cy, theta: theta, swing: 18, phi: phi * 180 / Math.PI, rel: rel, abs: abs };
    });
  })();

  /* worst-case parallelogram corners over the rotate-in sweep
   * (fromTo starts at theta-18, eases to theta) — exported for tests */
  function sweptAbs(P, delta) {
    var out = [];
    for (var k = 0; k <= 20; k++) {
      var th = P.theta - delta + (delta * k / 20);
      var t = th * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      P.rel.forEach(function (p) {
        out.push([P.cx + p[0] * ct - p[1] * st, P.cy + p[0] * st + p[1] * ct]);
      });
    }
    return out;
  }

  /* ==================== slide configs ==================== */

  var CHIP_H = 34, CHIP_Y = 24;
  var CHIP_STYLE = {
    todo:   { fill: '#ffffff', stroke: EDGE, txt: FAINT },
    active: { fill: '#eaf2fd', stroke: BLUE, txt: INK },
    done:   { fill: '#ffffff', stroke: INK, txt: INK }
  };

  var SUB2 = '₂', SUB8 = '₈'; // unicode subscripts, verbatim user vocabulary

  var CFG_SOBB2 = {
    host: 'pipe-sobb2-canvas', caption: 'pipe-sobb2-caption',
    chips: {
      TXT: ['AABB BVH' + SUB2, 'fit k-DOP', 'SOBB BVH' + SUB2],
      W: [150, 110, 150],
      X: [319, 505, 651],
      ARROW_X: [487, 633]
    },
    beats: ['build', 'hexbin', 'parbin'],
    captions: [
      'The original SOBB construction — every node fitted on its own, nothing shared.',
      'Binary AABB BVH from SAH splits — deep chains one side, shallow subtrees the other.',
      'Fit a temporary k-DOP per node — shared slab directions, per-node extents.',
      'Form the SOBB per node — its own basis, its own orientation, independent of every neighbour.'
    ]
  };

  var CFG_AABB8 = {
    host: 'pipe-aabb8-canvas', caption: 'pipe-aabb8-caption',
    chips: {
      /* this exact row is mirrored as aabbquant.js CHIP_* (hand-off) */
      TXT: ['AABB BVH' + SUB2, 'AABB BVH' + SUB8, 'quantization'],
      W: [150, 150, 140],
      X: [304, 490, 676],
      ARROW_X: [472, 658]
    },
    beats: ['build', 'collapse', 'quantleadabb'],
    captions: [
      'The state of the art: an AABB BVH₂ widened to AABB BVH₈, then quantized.',
      'The same binary AABB BVH from SAH splits.',
      'Interiors collapse to 8-ary wide nodes — the 8-wide layout here is approximate.',
      'Quantization is the one remaining step: the wide node packs into its slot strip — the eight child bounds snap onto the orthogonal grid next.'
    ]
  };

  /* ---- slide B hand-off geometry: EXACTLY the entry state of
   * js/aabbquant.js (constants duplicated on purpose, parity
   * machine-checked via _test.handoff vs aabbquant._test). B's final
   * frame resolves into this — the cut reads as a continuation. ---- */
  var HANDOFF = {
    STRIP: { x: 80, y: 130, w: 360, h: 64 },   // = aabbquant WIDE
    SLOT_N: 8,
    P: { x: 560, y: 90, w: 440, h: 380 },      // = aabbquant P
    BOX_PAD: 4,
    TRIS: [                                     // = aabbquant CHILD_TRIS
      [[604, 168], [680, 158], [642, 234]],
      [[710, 170], [784, 162], [750, 238]],
      [[812, 166], [888, 158], [854, 232]],
      [[878, 180], [946, 174], [916, 240]],
      [[600, 330], [676, 320], [640, 390]],
      [[706, 328], [782, 318], [746, 388]],
      [[814, 332], [890, 324], [856, 394]],
      [[884, 326], [952, 318], [922, 386]]
    ],
    MINICAP: 'one wide node · eight child AABBs'
  };

  var CFG_SOBB8 = {
    host: 'pipe-sobb8-canvas', caption: 'pipe-sobb8-caption',
    chips: {
      /* this exact row is mirrored as sharedbasis.js BASE_* (hand-off) */
      TXT: ['AABB BVH' + SUB2, 'AABB BVH' + SUB8, 'SOBB BVH' + SUB8, 'quantization'],
      W: [150, 150, 160, 140],
      X: [206, 392, 578, 774],
      ARROW_X: [374, 560, 756]
    },
    beats: ['build', 'collapse', 'parwide', 'quantlead'],
    captions: [
      'Our chain: widen as usual, then overlay SOBBs — quantization comes after.',
      'The same binary AABB BVH from SAH splits.',
      'Interiors collapse to 8-ary wide nodes — same as the state of the art.',
      'Overlay every wide node with its own SOBB — skewed, independently oriented.',
      'Quantization is the one step that needs more: inside the wide node, bounds must snap in the SKEWED space — the next two slides.'
    ]
  };

  /* ==================== scene factory ==================== */

  function ptsStr(pts) {
    return pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
  }

  function makeScene(cfg) {
    var NCH = cfg.chips.TXT.length;
    var NSEC = cfg.beats.length;
    var built = false;
    var svg;
    var nodeEls = {};       // binary squares; r morphs into the wide root
    var binEdgeEls = [];
    var wideLeafRects = {}; // 4 wide leaves (appear at the collapse)
    var wideEdgeEls = [];
    var slotLines = [];     // SLOTS-1 dividers inside the wide root
    var hexWraps = {}, hexPolys = {};   // slide A: per binary node
    var parWraps = {}, parPolys = {};   // slide A: per binary node
    var parWWraps = {}, parWPolys = {}; // slide C: per wide node
    /* slide B hand-off gear (aabbquant entry frame, mirrored exactly) */
    var handDots = [], handGlyphs = [], handMinicap, handConn, handHead;
    var handPanel, handTris = [], handTights = [];
    var chipRects = [], chipTexts = [];
    var captionEl;
    var tl = null;

    var has = function (b) { return cfg.beats.indexOf(b) >= 0; };

    function setChip(i, styleName) {
      var s = CHIP_STYLE[styleName];
      chipRects[i].setAttribute('fill', s.fill);
      chipRects[i].setAttribute('stroke', s.stroke);
      chipTexts[i].setAttribute('fill', s.txt);
    }

    /* chip styling as timeline sets (reverse-safe, unlike callbacks) */
    function tlChip(i, styleName, pos) {
      var s = CHIP_STYLE[styleName];
      tl.set(chipRects[i], { attr: { fill: s.fill, stroke: s.stroke } }, pos);
      tl.set(chipTexts[i], { attr: { fill: s.txt } }, pos);
    }

    /* -------------------- build -------------------- */

    function build() {
      var host = document.getElementById(cfg.host);
      svg = el('svg', { viewBox: '0 0 1120 520', width: '100%', height: '100%' }, host);
      var i;

      /* stage chips — static row, sequential activation only */
      for (i = 0; i < NCH; i++) {
        chipRects.push(el('rect', {
          'class': 'chip-rect',
          x: cfg.chips.X[i], y: CHIP_Y, width: cfg.chips.W[i], height: CHIP_H, rx: 6,
          'stroke-width': 1.4
        }, svg));
        chipTexts.push(text(cfg.chips.TXT[i], {
          'class': 'chip-text',
          x: cfg.chips.X[i] + cfg.chips.W[i] / 2, y: CHIP_Y + 22,
          'text-anchor': 'middle', 'font-size': 15
        }, svg));
      }
      cfg.chips.ARROW_X.forEach(function (x) {
        text('→', {
          'class': 'chip-arrow',
          x: x, y: CHIP_Y + 22, 'text-anchor': 'middle', 'font-size': 16, fill: FAINT
        }, svg);
      });

      /* binary edges + nodes (all three slides start here) */
      BIN_EDGES.forEach(function (pair) {
        var a = BIN[pair[0]], b = BIN[pair[1]];
        binEdgeEls.push(el('line', {
          'class': 'bin-edge',
          x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, 'stroke-width': 1.4
        }, svg));
      });
      NODE_IDS.forEach(function (nid) {
        var n = BIN[nid];
        nodeEls[nid] = el('rect', {
          'class': 'bin-node', 'data-node': nid,
          x: n.cx - SQ / 2, y: n.cy - SQ / 2, width: SQ, height: SQ, rx: 4,
          fill: '#ffffff', 'stroke-width': 1.5
        }, svg);
      });

      /* slide A: per-node hexagons (fit k-DOP) + parallelograms (SOBB BVH₂) */
      if (has('hexbin')) {
        NODE_IDS.forEach(function (id) {
          var H = HEXB[id];
          hexWraps[id] = el('g', { transform: 'translate(' + H.cx + ' ' + H.cy + ')' }, svg);
          hexPolys[id] = el('polygon', {
            'class': 'kdop-proxy', 'data-node': id,
            points: ptsStr(H.pts.map(function (p) { return [p[0] - H.cx, p[1] - H.cy]; })),
            fill: PROXY_FILL, stroke: BLUE, 'stroke-width': 1.6, opacity: 0
          }, hexWraps[id]);
        });
      }
      if (has('parbin')) {
        NODE_IDS.forEach(function (id) {
          var P = PARB[id];
          parWraps[id] = el('g', { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, svg);
          parPolys[id] = el('polygon', {
            'class': 'sobb-proxy', 'data-node': id,
            points: ptsStr(P.rel),
            fill: PROXY_FILL, stroke: BLUE, 'stroke-width': 1.6, opacity: 0
          }, parWraps[id]);
        });
      }

      /* slides B/C: collapse gear */
      if (has('collapse')) {
        WIDE_ORDER.slice(0, 4).forEach(function (wid) {
          var w = WIDE[wid];
          wideLeafRects[wid] = el('rect', {
            'class': 'wide-leaf', 'data-node': wid,
            x: w.x, y: w.y, width: w.w, height: w.h, rx: 8,
            fill: '#ffffff', 'stroke-width': 1.5
          }, svg);
        });
        var R = WIDE.root;
        WIDE_ORDER.slice(0, 4).forEach(function (wid) {
          var w = WIDE[wid];
          wideEdgeEls.push(el('line', {
            'class': 'wide-edge',
            x1: R.x + R.w / 2, y1: R.y + R.h,
            x2: w.x + w.w / 2, y2: w.y, 'stroke-width': 1.5
          }, svg));
        });
        for (i = 1; i < SLOTS; i++) {
          slotLines.push(el('line', {
            'class': 'slot-line',
            x1: R.x + (R.w / SLOTS) * i, y1: R.y + 8,
            x2: R.x + (R.w / SLOTS) * i, y2: R.y + R.h - 8,
            'stroke-width': 1.2
          }, svg));
        }
      }

      /* slide C: parallelogram overlay per wide node (SOBB BVH₈) */
      if (has('parwide')) {
        WIDE_ORDER.forEach(function (id) {
          var P = PARW[id];
          parWWraps[id] = el('g', { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, svg);
          parWPolys[id] = el('polygon', {
            'class': 'sobb-proxy', 'data-node': id,
            points: ptsStr(P.rel),
            fill: PROXY_FILL, stroke: BLUE, 'stroke-width': 1.6, opacity: 0
          }, parWWraps[id]);
        });
      }

      /* slide B hand-off gear: hidden until the s3 lead-in, when the wide
       * root slides into this strip pose and the bounds region opens with
       * its eight tight child AABBs — B's final frame, pixel-equal to the
       * aligned-grid quantization slide's entry frame. Attribute-for-
       * attribute identical to js/aabbquant.js (parity via _test). */
      if (has('quantleadabb')) {
        var HS = HANDOFF.STRIP, HP = HANDOFF.P;
        var hcy = HS.y + HS.h / 2;
        for (i = 0; i < HANDOFF.SLOT_N; i++) {
          var hgx = HS.x + (HS.w / HANDOFF.SLOT_N) * (i + 0.5);
          handDots.push(el('circle', {
            'class': 'hand-dot', cx: hgx, cy: hcy, r: 2.2, fill: INK, opacity: 0
          }, svg));
          handGlyphs.push(el('rect', {
            'class': 'hand-glyph',
            x: hgx - 10, y: hcy - 19, width: 20, height: 10, rx: 2,
            fill: 'none', stroke: INK, 'stroke-width': 1.3, opacity: 0
          }, svg));
        }
        handMinicap = text(HANDOFF.MINICAP, {
          'class': 'hand-minicap',
          x: HS.x + HS.w / 2, y: HS.y + HS.h + 34,
          'text-anchor': 'middle', 'font-size': 15, fill: FAINT, opacity: 0
        }, svg);
        handConn = el('line', {
          'class': 'hand-conn',
          x1: HS.x + HS.w + 14, y1: hcy, x2: HP.x - 22, y2: hcy,
          stroke: EDGE, 'stroke-width': 1.4, 'stroke-dasharray': '4 4', opacity: 0
        }, svg);
        handHead = el('polygon', {
          'class': 'hand-head',
          points: (HP.x - 24) + ',' + (hcy - 5) + ' ' + (HP.x - 24) + ',' + (hcy + 5) + ' ' + (HP.x - 14) + ',' + hcy,
          fill: EDGE, opacity: 0
        }, svg);
        handPanel = el('rect', {
          'class': 'hand-panel',
          x: HP.x, y: HP.y, width: HP.w, height: HP.h,
          fill: 'none', stroke: INK, 'stroke-width': 1.8, opacity: 0
        }, svg);
        HANDOFF.TRIS.forEach(function (tri) {
          handTris.push(el('polygon', {
            'class': 'hand-tri',
            points: ptsStr(tri),
            fill: LIGHT, stroke: INK, 'stroke-width': 1.2,
            'stroke-linejoin': 'round', opacity: 0
          }, svg));
          var tb = D.inflate(D.aabb(tri), HANDOFF.BOX_PAD);
          handTights.push(el('rect', {
            'class': 'hand-tight',
            x: tb.x, y: tb.y, width: tb.w, height: tb.h,
            fill: 'none', stroke: INK, 'stroke-width': 1.4, opacity: 0
          }, svg));
        });
      }

      captionEl = document.getElementById(cfg.caption);
      built = true;
    }

    /* -------------------- reset -------------------- */

    function resetDom() {
      NODE_IDS.forEach(function (id) {
        var r = nodeEls[id];
        gsap.killTweensOf(r);
        var n = BIN[id];
        r.setAttribute('x', n.cx - SQ / 2);
        r.setAttribute('y', n.cy - SQ / 2);
        r.setAttribute('width', SQ);
        r.setAttribute('height', SQ);
        r.setAttribute('rx', 4);
        r.setAttribute('opacity', 0);
        r.setAttribute('stroke', INK);
        r.setAttribute('stroke-width', 1.5); // B hand-off morph fattens it
      });
      binEdgeEls.forEach(function (l) {
        gsap.killTweensOf(l);
        l.setAttribute('opacity', 0);
        l.setAttribute('stroke', EDGE);
      });
      Object.keys(wideLeafRects).forEach(function (wid) {
        var r = wideLeafRects[wid], w = WIDE[wid];
        gsap.killTweensOf(r);
        r.setAttribute('x', w.x);
        r.setAttribute('y', w.y);
        r.setAttribute('width', w.w);
        r.setAttribute('height', w.h);
        r.setAttribute('opacity', 0);
        r.setAttribute('stroke', INK);
      });
      wideEdgeEls.forEach(function (l) {
        gsap.killTweensOf(l);
        l.setAttribute('opacity', 0);
        l.setAttribute('stroke', EDGE);
      });
      slotLines.forEach(function (l, i) {
        gsap.killTweensOf(l);
        l.setAttribute('opacity', 0);
        l.setAttribute('stroke', FAINT);
        /* B's hand-off morphs the dividers with the root to the strip pose;
         * restore the post-collapse coordinates (inside the wide root) */
        var R = WIDE.root, k = i + 1;
        l.setAttribute('x1', R.x + (R.w / SLOTS) * k);
        l.setAttribute('x2', R.x + (R.w / SLOTS) * k);
        l.setAttribute('y1', R.y + 8);
        l.setAttribute('y2', R.y + R.h - 8);
      });
      Object.keys(hexWraps).forEach(function (id) {
        gsap.killTweensOf(hexWraps[id]);
        gsap.killTweensOf(hexPolys[id]);
        hexWraps[id].setAttribute('transform', 'translate(' + HEXB[id].cx + ' ' + HEXB[id].cy + ')');
        hexPolys[id].setAttribute('opacity', 0);
      });
      Object.keys(parWraps).forEach(function (id) {
        gsap.killTweensOf(parWraps[id]);
        gsap.killTweensOf(parPolys[id]);
        parWraps[id].setAttribute('transform',
          'translate(' + PARB[id].cx + ' ' + PARB[id].cy + ') rotate(' + PARB[id].theta + ')');
        parPolys[id].setAttribute('opacity', 0);
      });
      Object.keys(parWWraps).forEach(function (id) {
        gsap.killTweensOf(parWWraps[id]);
        gsap.killTweensOf(parWPolys[id]);
        parWWraps[id].setAttribute('transform',
          'translate(' + PARW[id].cx + ' ' + PARW[id].cy + ') rotate(' + PARW[id].theta + ')');
        parWPolys[id].setAttribute('opacity', 0);
        parWPolys[id].setAttribute('stroke', BLUE);
      });
      /* slide B hand-off gear hidden (geometry is static — no re-init
       * needed, only opacity back to 0) */
      [handMinicap, handConn, handHead, handPanel].forEach(function (n) {
        if (n) { gsap.killTweensOf(n); n.setAttribute('opacity', 0); }
      });
      handDots.concat(handGlyphs, handTris, handTights).forEach(function (n) {
        gsap.killTweensOf(n); n.setAttribute('opacity', 0);
      });
      for (var i = 0; i < NCH; i++) setChip(i, 'todo');
    }

    /* -------------------- beats -------------------- */

    function pad(d) { tl.to({}, { duration: d }, tl.duration()); }

    /* binary build (identical on all three slides) */
    function sBuild() {
      var at = tl.duration();
      tl.to(binEdgeEls, { attr: { opacity: 1 }, duration: 0.55, stagger: 0.03, ease: 'power1.out' }, at);
      tl.to(REVEAL.map(function (id) { return nodeEls[id]; }),
        { attr: { opacity: 1 }, duration: 0.55, stagger: 0.04, ease: 'power1.out' }, at);
    }

    /* slide A s2: every binary node transforms to its hexagon k-DOP */
    function sHexBin() {
      var at = tl.duration();
      REVEAL.slice().reverse().forEach(function (id, i) {
        var n = BIN[id], H = HEXB[id];
        var w = at + 0.1 + i * 0.045;
        /* the square shrinks into its node and gives way to the hexagon */
        tl.to(nodeEls[id], {
          attr: { x: n.cx - 3, y: n.cy - 3, width: 6, height: 6, opacity: 0 },
          duration: 0.35, ease: 'power2.in'
        }, w);
        tl.fromTo(hexWraps[id],
          { attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(0.35)' } },
          { attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(1)' }, duration: 0.45, ease: 'power2.out' },
          w + 0.12);
        tl.fromTo(hexPolys[id], { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.3 },
          w + 0.12);
      });
    }

    /* slide A s3: hexagons → independent parallelogram SOBBs */
    function sParBin() {
      var at = tl.duration();
      NODE_IDS.forEach(function (id, i) {
        var H = HEXB[id], P = PARB[id];
        var w = at + (i % 5) * 0.03 + (i < 5 ? 0 : i < 10 ? 0.1 : 0.2);
        tl.to(hexPolys[id], { attr: { opacity: 0 }, duration: 0.3 }, w);
        tl.to(hexWraps[id], {
          attr: { transform: 'translate(' + H.cx + ' ' + H.cy + ') scale(0.55)' },
          duration: 0.4, ease: 'power2.in'
        }, w);
        tl.fromTo(parWraps[id],
          { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + (P.theta - 18) + ')' } },
          { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, duration: 0.55, ease: 'power2.out' },
          w + 0.18);
        tl.fromTo(parPolys[id], { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.35 },
          w + 0.18);
      });
      /* chain complete — close the last chip */
      tlChip(2, 'done', tl.duration() + 0.6);
    }

    /* slides B/C s2: interior collapse to approximate 8-ary wide */
    function sCollapse() {
      var c0 = tl.duration();
      /* leaves fly toward their wide-leaf centers and fade (approximate merge) */
      LEAFSQ.forEach(function (s, i) {
        var W = WIDE[LEAF_TARGET[s]];
        tl.to(nodeEls[s], {
          attr: { x: W.x + W.w / 2 - SQ / 2, y: W.y + W.h / 2 - SQ / 2, opacity: 0 },
          duration: 0.65, ease: 'power2.inOut'
        }, c0 + 0.15 + i * 0.03);
      });
      /* interior mids fly into the root and fade */
      MIDS.forEach(function (id, i) {
        tl.to(nodeEls[id], {
          attr: { x: WIDE.root.x + WIDE.root.w / 2 - SQ / 2, y: WIDE.root.y + WIDE.root.h / 2 - SQ / 2, opacity: 0 },
          duration: 0.65, ease: 'power2.inOut'
        }, c0 + 0.3 + i * 0.04);
      });
      /* all binary edges fade */
      tl.to(binEdgeEls, { attr: { opacity: 0 }, duration: 0.4, stagger: 0.015 }, c0 + 0.15);
      /* binary root fatten into the wide root */
      tl.to(nodeEls.r, {
        attr: { x: WIDE.root.x, y: WIDE.root.y, width: WIDE.root.w, height: WIDE.root.h, rx: 10 },
        duration: 0.8, ease: 'power2.inOut'
      }, c0 + 0.45);
      /* wide leaves open out of nothing (schematic) */
      WIDE_ORDER.slice(0, 4).forEach(function (wid, i) {
        var W = WIDE[wid], r = wideLeafRects[wid];
        tl.fromTo(r,
          { attr: { x: W.x + W.w / 2, y: W.y + W.h / 2, width: 0, height: 0, opacity: 0 } },
          { attr: { x: W.x, y: W.y, width: W.w, height: W.h, opacity: 1 }, duration: 0.6, ease: 'power2.out' },
          c0 + 0.8 + i * 0.09);
      });
      tl.to(wideEdgeEls, { attr: { opacity: 1 }, duration: 0.4 }, c0 + 1.5);
      tl.to(slotLines, { attr: { opacity: 1 }, duration: 0.4, stagger: 0.03 }, c0 + 1.55);
    }

    /* slide C s3: skewed SOBB parallelograms overlay the wide nodes */
    function sParWide() {
      var at = tl.duration();
      WIDE_ORDER.forEach(function (id, i) {
        var P = PARW[id];
        tl.fromTo(parWWraps[id],
          { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + (P.theta - P.swing) + ')' } },
          { attr: { transform: 'translate(' + P.cx + ' ' + P.cy + ') rotate(' + P.theta + ')' }, duration: 0.55, ease: 'power2.out' },
          at + 0.1 + i * 0.09);
        tl.fromTo(parWPolys[id], { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.35 },
          at + 0.1 + i * 0.09);
      });
    }

    /* slide C final: quantization lead-in — chip ACTIVE, stage quiets
     * down to the one wide node whose quantization the next slide tells
     * (C → #slide-sharedbasis skew) */
    function sQuantLead() {
      var at = tl.duration();
      tl.to(slotLines, { attr: { opacity: 0 }, duration: 0.3 }, at);
      /* leaves fall quiet so the wide root carries the hand-off */
      WIDE_ORDER.slice(0, 4).forEach(function (wid, i) {
        tl.to(wideLeafRects[wid], { attr: { stroke: FAINT }, duration: 0.35 }, at + 0.05 + i * 0.04);
        if (has('parwide')) {
          tl.to(parWPolys[wid], { attr: { stroke: FAINT }, duration: 0.35 }, at + 0.05 + i * 0.04);
        }
      });
      tl.to(wideEdgeEls, { attr: { stroke: FAINT }, duration: 0.35 }, at + 0.1);
      /* quantization chip stays ACTIVE — hand-off to the next slide */
    }

    /* slide B final: quantization lead-in + HAND-OFF — the stage doesn't
     * just quiet, it TRAVELS: the four wide leaves and their edges fade
     * away, the wide root slides left into the stored slot-strip pose
     * (dividers ride along, dots + axis-aligned glyphs light up inside),
     * and the node-bounds region opens on the right holding the eight
     * tight child AABBs. The end frame is the aligned-grid quantization
     * slide's entry frame (js/aabbquant.js), pixel-for-pixel — the
     * data-transition="none" cut between the slides reads as one story. */
    function sQuantHandoffAabb() {
      var at = tl.duration();
      var HS = HANDOFF.STRIP, HP = HANDOFF.P;
      /* the approximate tree dissolves — only the wide root survives */
      tl.to(wideEdgeEls, { attr: { opacity: 0 }, duration: 0.35 }, at);
      WIDE_ORDER.slice(0, 4).forEach(function (wid, i) {
        tl.to(wideLeafRects[wid], { attr: { opacity: 0 }, duration: 0.4 }, at + i * 0.04);
      });
      /* the wide root slides into its stored pose: the 8-slot strip */
      tl.to(nodeEls.r, {
        attr: { x: HS.x, y: HS.y, width: HS.w, height: HS.h, rx: 8, 'stroke-width': 1.8 },
        duration: 0.85, ease: 'power2.inOut'
      }, at + 0.15);
      slotLines.forEach(function (l, i) {
        var k = i + 1, sx = HS.x + (HS.w / SLOTS) * k;
        tl.to(l, {
          attr: { x1: sx, x2: sx, y1: HS.y + 7, y2: HS.y + HS.h - 7 },
          duration: 0.85, ease: 'power2.inOut'
        }, at + 0.15);
        tl.to(l, { attr: { stroke: EDGE }, duration: 0.4 }, at + 0.4);
      });
      /* the node-bounds region opens on the right */
      tl.fromTo(handPanel,
        { attr: { x: HP.x + HP.w / 2, y: HP.y + HP.h / 2, width: 0, height: 0, opacity: 0 } },
        { attr: { x: HP.x, y: HP.y, width: HP.w, height: HP.h, opacity: 1 },
          duration: 0.55, ease: 'power2.out' }, at + 0.65);
      tl.to([handConn, handHead], { attr: { opacity: 1 }, duration: 0.35 }, at + 0.85);
      /* its stored self-description: 8 slots, axis-aligned child bounds */
      tl.to(handDots, { attr: { opacity: 1 }, duration: 0.3, stagger: 0.03 }, at + 0.85);
      tl.to(handGlyphs, { attr: { opacity: 1 }, duration: 0.3, stagger: 0.03 }, at + 0.95);
      tl.to(handMinicap, { attr: { opacity: 1 }, duration: 0.35 }, at + 1.05);
      /* and the eight tight child AABBs the next slide quantizes */
      HANDOFF.TRIS.forEach(function (tri, i) {
        var w = at + 1.0 + i * 0.05;
        tl.to(handTris[i], { attr: { opacity: 1 }, duration: 0.3 }, w);
        tl.to(handTights[i], { attr: { opacity: 1 }, duration: 0.3 }, w + 0.05);
      });
      /* quantization chip stays ACTIVE — the next slide continues here */
    }

    var STAGE_FN = {
      build: sBuild, hexbin: sHexBin, parbin: sParBin,
      collapse: sCollapse, parwide: sParWide, quantlead: sQuantLead,
      quantleadabb: sQuantHandoffAabb
    };

    /* -------------------- timeline -------------------- */

    function buildTimeline() {
      tl = gsap.timeline({ paused: true });
      pad(0.2);
      cfg.beats.forEach(function (beat, i) {
        if (i > 0) pad(0.25);
        if (i > 0) tlChip(i - 1, 'done', tl.duration());
        tlChip(i, 'active', tl.duration());
        STAGE_FN[beat]();
        tl.addLabel('s' + (i + 1), tl.duration());
      });
    }

    /* -------------------- animator -------------------- */

    var animator = {
      start: function (fragStep) {
        if (!built) build();
        animator.stop();
        resetDom();
        buildTimeline();
        captionEl.textContent = cfg.captions[fragStep] || cfg.captions[0];
        if (fragStep > 0) tl.seek(D.stopsFor(tl, NSEC)[fragStep], true);
        gsap.fromTo(svg, { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', overwrite: 'auto' });
      },
      step: function (fragStep) {
        if (!tl) return;
        captionEl.textContent = cfg.captions[fragStep] || cfg.captions[0];
        tl.tweenTo(D.stopsFor(tl, NSEC)[fragStep], { ease: 'none' });
      },
      stop: function () {
        if (tl) { tl.kill(); tl = null; }
      }
    };

    animator._test = {
      host: cfg.host, caption: cfg.caption,
      labels: cfg.chips.TXT.slice(),
      chips: { X: cfg.chips.X, W: cfg.chips.W, Y: CHIP_Y, H: CHIP_H, ARROW_X: cfg.chips.ARROW_X, STYLE: CHIP_STYLE },
      beats: cfg.beats.slice(),
      captions: cfg.captions.slice(),
      sections: NSEC,
      /* slide B only: the hand-off frame geometry, mirrored from
       * js/aabbquant.js so the join parity is machine-checkable */
      handoff: has('quantleadabb') ? HANDOFF : null
    };
    return animator;
  }

  /* ==================== register ==================== */

  var sobb2 = makeScene(CFG_SOBB2);
  var aabb8 = makeScene(CFG_AABB8);
  var sobb8 = makeScene(CFG_SOBB8);

  /* shared pure geometry for machine checks (no DOM needed) */
  var SHARED_TEST = {
    layout: {
      BIN: BIN, BIN_EDGES: BIN_EDGES, NODE_IDS: NODE_IDS,
      LEAFSQ: LEAFSQ, MIDS: MIDS, LEAF_TARGET: LEAF_TARGET, REVEAL: REVEAL, SQ: SQ,
      WIDE: WIDE, WIDE_ORDER: WIDE_ORDER, SLOTS: SLOTS
    },
    geom: {
      kSides: 6, parSides: 4,
      hexB: HEXB, parB: PARB, parW: PARW,
      sweptAbs: sweptAbs,
      viewBox: [0, 0, 1120, 520]
    }
  };
  sobb2._test.shared = SHARED_TEST;
  aabb8._test.shared = SHARED_TEST;
  sobb8._test.shared = SHARED_TEST;

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.pipesobb2 = sobb2;
  window.DeckAnimators.pipeaabb8 = aabb8;
  window.DeckAnimators.pipesobb8 = sobb8;
})();
