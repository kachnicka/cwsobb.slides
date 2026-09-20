/* Refit slide animator — the core algorithm animation.
 *
 * Data-driven: all SVG is generated from the layout data below.
 * To extend toward the real paper figures, edit only the LAYOUT DATA
 * section (clusters, tree topology, positions) — the renderer and the
 * timeline consume those structures generically.
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: geometry moves -> stored boxes become stale (red dashed)
 *   s2: leaves re-fit  -> leaf boxes shrink-wrap moved geometry
 *   s3: parents re-fit -> internal boxes union their children
 *   s4: root re-fits   -> hierarchy valid again
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var BLUE = '#1f6fe5';
  var RED = '#d93636';
  var INK = '#14161a';
  var EDGE = '#d4d8e0';

  /* ==================== LAYOUT DATA ====================
   * Scene view coordinates (viewBox 0 0 600 600).
   * Each leaf cluster is a set of triangles; `move` is the deformation
   * applied during step s1: rotate `rot` degrees about the cluster
   * centroid, then translate by (dx, dy).
   */
  var CLUSTERS = [
    { id: 'A', move: { dx: 70, dy: 15, rot: 25 },
      tris: [
        [[90, 120], [170, 112], [130, 190]],
        [[118, 205], [190, 182], [160, 258]]
      ] },
    { id: 'B', move: { dx: -30, dy: 55, rot: -15 },
      tris: [
        [[400, 100], [478, 118], [430, 178]],
        [[452, 190], [516, 150], [500, 232]],
        [[392, 196], [446, 238], [398, 268]]
      ] },
    { id: 'C', move: { dx: 45, dy: 30, rot: 10 },
      tris: [
        [[96, 360], [176, 348], [122, 428]],
        [[150, 440], [214, 408], [222, 486]]
      ] },
    { id: 'D', move: { dx: -60, dy: -20, rot: 20 },
      tris: [
        [[404, 352], [486, 340], [452, 416]],
        [[470, 430], [530, 392], [522, 478]],
        [[398, 428], [452, 470], [410, 512]]
      ] }
  ];

  /* Tree topology: node -> children. Leaves map 1:1 to clusters.
   * Boxes of internal nodes are derived as unions of child boxes. */
  var CHILDREN = { R: ['M0', 'M1'], M0: ['A', 'B'], M1: ['C', 'D'] };
  var LEAVES = ['A', 'B', 'C', 'D'];
  var LEVELS = [LEAVES, ['M0', 'M1'], ['R']]; // bottom-up refit order

  /* Tree view coordinates (viewBox 0 0 560 600). */
  var NODE_POS = {
    R:  { x: 280, y: 86 },
    M0: { x: 150, y: 240 },
    M1: { x: 410, y: 240 },
    A:  { x: 75,  y: 394 },
    B:  { x: 225, y: 394 },
    C:  { x: 335, y: 394 },
    D:  { x: 485, y: 394 }
  };
  var NODE_W = 46, NODE_H = 32;
  var LEVEL_LABELS = [
    { text: 'root', y: 86 },
    { text: 'internal', y: 240 },
    /* leaves: raised above the row center (394) — at 394 the label's
       tail slides under leaf node A's box (A starts at x=52, the label
       extends to ~x=74). At 364 the baseline sits at 369 and the label
       clears both the box (top 378) and the M0->A edge further right.
       Tree geometry is static across all fragment steps (only node
       fill/edge stroke pulses), so this holds at every step. */
    { text: 'leaves', y: 364 }
  ];

  var BOX_PAD = 12; // visual padding around each bound

  var CAPTIONS = [
    'Static scene — every box tightly bounds its geometry.',
    'Geometry moved — the stored boxes are now stale.',
    'Leaf refit — each leaf shrink-wraps its own triangles.',
    'Parent refit — each internal box unions its children.',
    'Root refit — the hierarchy is valid again.'
  ];

  /* ==================== pure geometry helpers ==================== */

  function centroidOf(pts) {
    var sx = 0, sy = 0;
    for (var i = 0; i < pts.length; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    return [sx / pts.length, sy / pts.length];
  }

  function flatVerts(cluster) {
    var out = [];
    cluster.tris.forEach(function (t) { out = out.concat(t); });
    return out;
  }

  function movedVerts(cluster) {
    var verts = flatVerts(cluster);
    var c = centroidOf(verts);
    var rad = cluster.move.rot * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    return verts.map(function (p) {
      var x = p[0] - c[0], y = p[1] - c[1];
      return [
        c[0] + x * cos - y * sin + cluster.move.dx,
        c[1] + x * sin + y * cos + cluster.move.dy
      ];
    });
  }

  function aabb(verts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    verts.forEach(function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function unionBox(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return {
      x: x, y: y,
      w: Math.max(a.x + a.w, b.x + b.w) - x,
      h: Math.max(a.y + a.h, b.y + b.h) - y
    };
  }

  function inflate(b, p) {
    return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
  }

  function pts2str(verts) {
    return verts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  /* Compute per-node boxes (rest + moved) from cluster geometry.
   * Returns { id -> { rest:{x,y,w,h}, moved:{x,y,w,h} } }. */
  function computeBoxes() {
    var boxes = {};
    CLUSTERS.forEach(function (c) {
      boxes[c.id] = {
        rest: inflate(aabb(flatVerts(c)), BOX_PAD),
        moved: inflate(aabb(movedVerts(c)), BOX_PAD)
      };
    });
    // internal nodes bottom-up
    LEVELS.slice(1).forEach(function (level) {
      level.forEach(function (id) {
        var kids = CHILDREN[id];
        boxes[id] = {
          rest: unionBox(boxes[kids[0]].rest, boxes[kids[1]].rest),
          moved: unionBox(boxes[kids[0]].moved, boxes[kids[1]].moved)
        };
      });
    });
    return boxes;
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
  var sceneSvg, treeSvg;
  var polyEls = [];          // {el, rest, moved} in triangle order
  var boxEls = {};           // nodeId -> rect element
  var nodeEls = {};          // nodeId -> node rect element
  var edgeForChild = {};     // childId -> edge line element
  var captionEl;
  var BOXES = null;          // computed bounds
  var tl = null;             // GSAP timeline
  var panelEls = [];

  function buildScene(container) {
    sceneSvg = el('svg', {
      viewBox: '0 0 600 600', width: '100%', height: '100%'
    }, container);

    // triangles (geometry under the boxes)
    CLUSTERS.forEach(function (c) {
      var moved = movedVerts(c);
      var k = 0;
      c.tris.forEach(function (tri) {
        var restTri = tri;
        var movedTri = moved.slice(k, k + tri.length);
        k += tri.length;
        var p = el('polygon', { 'class': 'svg-tri', points: pts2str(restTri) }, sceneSvg);
        polyEls.push({ el: p, rest: restTri, moved: movedTri });
      });
    });

    // bounding boxes, deepest first so the root draws on top
    var order = LEAVES.concat(['M0', 'M1', 'R']);
    order.forEach(function (id) {
      var b = BOXES[id].rest;
      var r = el('rect', {
        'class': 'svg-box' + (id === 'R' ? ' svg-box-root' : ''),
        x: b.x, y: b.y, width: b.w, height: b.h
      }, sceneSvg);
      boxEls[id] = r;
    });
  }

  function buildTree(container) {
    treeSvg = el('svg', {
      viewBox: '0 0 560 600', width: '100%', height: '100%'
    }, container);

    LEVEL_LABELS.forEach(function (l) {
      var t = el('text', { 'class': 'svg-side-label', x: 18, y: l.y + 5 }, treeSvg);
      t.textContent = l.text.toUpperCase();
    });

    // edges first (nodes draw over the line endpoints)
    Object.keys(CHILDREN).forEach(function (parent) {
      CHILDREN[parent].forEach(function (child) {
        var a = NODE_POS[parent], b = NODE_POS[child];
        var line = el('line', {
          'class': 'svg-edge',
          x1: a.x, y1: a.y, x2: b.x, y2: b.y
        }, treeSvg);
        edgeForChild[child] = line;
      });
    });

    Object.keys(NODE_POS).forEach(function (id) {
      var p = NODE_POS[id];
      var g = el('g', {}, treeSvg);
      var rect = el('rect', {
        'class': 'svg-node', rx: 5,
        x: p.x - NODE_W / 2, y: p.y - NODE_H / 2,
        width: NODE_W, height: NODE_H
      }, g);
      nodeEls[id] = rect;
      var label = LEAVES.indexOf(id) >= 0 ? '△ ' + id : id;
      var t = el('text', {
        'class': 'svg-node-text', x: p.x, y: p.y + 5.5, 'text-anchor': 'middle'
      }, g);
      t.textContent = label;
    });
  }

  function setRect(r, b) {
    r.setAttribute('x', b.x);
    r.setAttribute('y', b.y);
    r.setAttribute('width', b.w);
    r.setAttribute('height', b.h);
  }

  function boxRestStyle(r) {
    r.setAttribute('stroke', INK);
    r.setAttribute('stroke-dasharray', 'none');
  }

  /* Flash tree nodes + incoming edges blue (transient eye candy).
   * Uses CSS fill/stroke so GSAP tweens the color; reset() clears it. */
  function pulseNodes(ids) {
    ids.forEach(function (id) {
      gsap.fromTo(nodeEls[id],
        { fill: '#bcd6f8' },
        { fill: '#ffffff', duration: 0.9, ease: 'power1.out' });
      var e = edgeForChild[id];
      if (!e) return;
      gsap.fromTo(e,
        { stroke: BLUE },
        { stroke: EDGE, duration: 0.9, ease: 'power1.out' });
    });
  }

  /* Tween a set of boxes to their moved bounds. */
  function addBoxRefit(timeline, ids, at) {
    var rects = ids.map(function (id) { return boxEls[id]; });
    timeline.set(rects, { attr: { stroke: BLUE, 'stroke-dasharray': 'none' } }, at);
    timeline.to(rects, {
      duration: 0.9,
      ease: 'power2.inOut',
      attr: {
        x: function (i) { return BOXES[ids[i]].moved.x; },
        y: function (i) { return BOXES[ids[i]].moved.y; },
        width: function (i) { return BOXES[ids[i]].moved.w; },
        height: function (i) { return BOXES[ids[i]].moved.h; }
      }
    }, at);
  }

  function stopTimes() {
    return [
      0,
      tl.labels.s1, tl.labels.s2, tl.labels.s3, tl.labels.s4
    ];
  }

  function resetDom() {
    // geometry back to rest pose
    polyEls.forEach(function (p) {
      gsap.killTweensOf(p.el);
      p.el.setAttribute('points', pts2str(p.rest));
    });
    // boxes back to rest bounds and neutral style
    Object.keys(boxEls).forEach(function (id) {
      gsap.killTweensOf(boxEls[id]);
      setRect(boxEls[id], BOXES[id].rest);
      boxRestStyle(boxEls[id]);
    });
    // tree nodes and edges neutral (clear CSS overrides from pulses)
    Object.keys(nodeEls).forEach(function (id) {
      gsap.killTweensOf(nodeEls[id]);
      gsap.set(nodeEls[id], { clearProps: 'fill' });
    });
    Object.keys(edgeForChild).forEach(function (id) {
      gsap.killTweensOf(edgeForChild[id]);
      gsap.set(edgeForChild[id], { clearProps: 'stroke' });
    });
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: geometry deforms; stored boxes go stale (red dashed)
    polyEls.forEach(function (p, i) {
      tl.to(p.el, {
        attr: { points: pts2str(p.moved) },
        duration: 1.25, ease: 'power2.inOut'
      }, i * 0.06);
    });
    var allRects = Object.keys(boxEls).map(function (id) { return boxEls[id]; });
    tl.set(allRects, { attr: { stroke: RED, 'stroke-dasharray': '7 5' } }, '>');
    tl.addLabel('s1', tl.duration());

    // s2..s4: refit wave, bottom-up one level per fragment.
    // Each section starts with a settle gap so its first zero-duration
    // change sits strictly AFTER the previous label (labels add no time,
    // and a set placed exactly at a stop time would fire at the stop).
    LEVELS.forEach(function (level, li) {
      var label = 's' + (li + 2);
      tl.to({}, { duration: 0.3 }, '>');
      tl.add(function () { pulseNodes(level); }, '>');
      addBoxRefit(tl, level, '>');
      tl.addLabel(label, tl.duration());
    });
  }

  var animator = {
    start: function (fragStep) {
      if (!built) {
        BOXES = computeBoxes();
        var sceneHost = document.getElementById('refit-scene');
        var treeHost = document.getElementById('refit-tree');
        buildScene(sceneHost);
        buildTree(treeHost);
        captionEl = document.getElementById('refit-caption');
        panelEls = [sceneSvg, treeSvg];
        built = true;
      }

      animator.stop();
      resetDom();
      buildTimeline();

      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      if (fragStep > 0) {
        tl.seek(stopTimes()[fragStep], true); // jump without firing callbacks
      }

      // gentle entrance of both panels
      gsap.fromTo(panelEls,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.08, overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      tl.tweenTo(stopTimes()[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  // expose pure helpers for headless smoke tests
  animator._test = {
    computeBoxes: computeBoxes,
    movedVerts: movedVerts,
    clusters: CLUSTERS,
    levels: LEVELS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.refit = animator;
})();
