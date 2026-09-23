/* SOBB refit — the problem. Follow-up to the refit slide: same scene, same
 * tree, but every node bound is a SOBB — a parallelogram in the node's own
 * skew basis (BASIS, in degrees; e1/e2 are the two EDGE directions of the
 * parallelogram; slab normals are perpendicular to them).
 *
 * Timeline sections (one per reveal.js fragment step):
 *   s1: invalidation      -> geometry moves; every SOBB bound goes stale
 *                            (red dashed) — the hierarchy is invalid
 *   s2: leaves re-fit     -> each leaf re-derives its own (new-skew)
 *                            SOBB from its triangles; the triangles fade
 *                            — leaves are self-sufficient
 *   s3: the problem       -> parent M0: its children now have DIFFERENT
 *                            bases (basis arrows + colored glyphs); the
 *                            dashed "?" parallelogram shows the parent can
 *                            not pick a basis from its children's bounds
 *   s4: EG25 fix, level 2 -> the full k-DOP travels child -> parent; M0 and
 *                            M1 each do a complete k-DOP -> SOBB refit
 *   s5: EG25 at the root  -> same again: every node, bottom-up, every frame
 *   s6: cost              -> red badge: 4.4-4.7x an AABB refit, ~60 MB
 */
(function () {
  'use strict';

  var D = window.DeckSVG;
  var SVGNS = D.NS;
  var BLUE = D.BLUE;
  var RED = D.RED;
  var INK = D.INK;
  var EDGE = D.EDGE;
  var ROSE = D.ROSE;

  /* ==================== LAYOUT DATA ====================
   * Scene view coordinates (viewBox 0 0 600 600) — same clusters and
   * deformation as the refit slide, so the two slides read as the same
   * world with a different bound type.
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

  var CHILDREN = { R: ['M0', 'M1'], M0: ['A', 'B'], M1: ['C', 'D'] };
  var LEAVES = ['A', 'B', 'C', 'D'];
  var NODES = ['A', 'B', 'C', 'D', 'M0', 'M1', 'R'];
  /* leaves feeding each internal node (k-DOP extent inputs; internal
   * SOBBs are fitted over child SOBB corners — see nodeShapeVerts) */
  var NODE_LEAVES = {
    A: ['A'], B: ['B'], C: ['C'], D: ['D'],
    M0: ['A', 'B'], M1: ['C', 'D'], R: ['A', 'B', 'C', 'D']
  };

  /* Tree view coordinates (viewBox 0 0 560 600) — same as refit. */
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
    /* leaves row label raised to 364: clears leaf A's box and the M0->A
       edge (same argument as the refit slide; tree geometry is static). */
    { text: 'leaves', y: 364 }
  ];

  /* Per-node SOBB basis at rest: edge directions e1/e2 in degrees.
   * Leaves/internals keep a visible skew (angle e1->e2 in [68,82]); the
   * root over the whole wide scene is near-rectangular (0/90) — anything
   * leaner blows past the viewBox once it must contain its child bounds. */
  var BASIS = {
    A: { e1: 12, e2: 80 },
    B: { e1: -18, e2: 55 },
    C: { e1: 30, e2: 105 },
    D: { e1: -5, e2: 70 },
    M0: { e1: 0, e2: 82 },
    M1: { e1: -6, e2: 70 },
    R: { e1: 0, e2: 90 }
  };
  /* Full SOBB refit picks a NEW basis: leaves get theirs from the
   * deformation itself (basis follows the cluster rotation); internal
   * nodes get a visibly different rotation after their k-DOP -> SOBB refit.
   * (Bases + rotations chosen so every rest/moved parallelogram clears the
   * viewBox edge by >= 24 units — checked by the geometry smoke test.) */
  var MOVED_ROT = { M0: 12, M1: 8, R: 4 };
  /* s3: the parent's imagined new basis — matches neither child. */
  var Q_BASIS = { e1: 3, e2: 74 };

  /* k-DOP fan the EG25 refit propagates (same 12 directions as the kdop
   * slides: slab normals at 10 + 30k degrees). */
  var FAN_OFF = 10, FAN_N = 12;

  var TRI_FADE = 0.15;   // triangles stay faintly visible after s2
  var GLYPH_LEN = 7;     // tree basis-glyph half-length (px)
  var ARROW_LEN = 22;    // scene basis-arrow half-length (px)

  /* k-DOP overlay tags in the tree panel (M1 mirrored to the left edge
   * of its overlay so it stays clear of M0's). */
  var KDOP_TAG = {
    M0: { x: 190, y: 222, anchor: 'start' },
    M1: { x: 370, y: 222, anchor: 'end' },
    R:  { x: 280, y: 52,  anchor: 'middle' }
  };

  /* s6: red cost badge beside the root. */
  var COST_BADGE = { x: 311, y: 74, w: 170, h: 26, text: '4.4–4.7× · ~60 MB' };

  var CAPTIONS = [
    'SOBBs — every node wraps its geometry in its own skew basis.',
    'Geometry moved — every SOBB is stale; the hierarchy is invalid.',
    'Leaves re-fit from their triangles — new skew: fine; above them, still stale.',
    'The parent’s turn: its children have different bases — no cheap union.',
    'EG25: hand the full k-DOP up — refit each parent k-DOP → SOBB.',
    'Same again at the root — every node, bottom-up, every frame.',
    '4.4–4.7× slower than AABB refit · ~60 MB scratch.'
  ];

  /* ==================== pure geometry helpers ==================== */

  function rad(d) { return d * Math.PI / 180; }
  function perp(v) { return [-v[1], v[0]]; }
  function bvec(deg) { var r = rad(deg); return [Math.cos(r), Math.sin(r)]; }

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
    var r = rad(cluster.move.rot);
    var cos = Math.cos(r), sin = Math.sin(r);
    return verts.map(function (p) {
      var x = p[0] - c[0], y = p[1] - c[1];
      return [
        c[0] + x * cos - y * sin + cluster.move.dx,
        c[1] + x * sin + y * cos + cluster.move.dy
      ];
    });
  }

  function clusterById(id) {
    for (var i = 0; i < CLUSTERS.length; i++) {
      if (CLUSTERS[i].id === id) return CLUSTERS[i];
    }
    return null;
  }

  function nodeVerts(id, moved) {
    var out = [];
    NODE_LEAVES[id].forEach(function (lid) {
      var c = clusterById(lid);
      out = out.concat(moved ? movedVerts(c) : flatVerts(c));
    });
    return out;
  }

  function slabExtents(pts, n) {
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    });
    return [lo, hi];
  }

  /* Sutherland-Hodgman: clip polygon by half-plane n·p <= m. */
  function clipHalf(poly, n, m) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var dp = p[0] * n[0] + p[1] * n[1];
      var dq = q[0] * n[0] + q[1] * n[1];
      if (dp <= m) out.push(p);
      if ((dp < m && dq > m) || (dp > m && dq < m)) {
        var t = (m - dp) / (dq - dp);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return out;
  }

  function dedupe(poly) {
    return poly.filter(function (p, i) {
      var q = poly[(i + 1) % poly.length];
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.5;
    });
  }

  /* Sort a quad's corners CCW by angle around its centroid so a
   * corners->corners points tween never twists through itself. */
  function sortCorners(poly) {
    var c = centroidOf(poly);
    return poly.slice().sort(function (p, q) {
      return Math.atan2(p[1] - c[1], p[0] - c[0]) -
             Math.atan2(q[1] - c[1], q[0] - c[0]);
    });
  }

  /* Parallelogram from 2 slab directions: clip a huge rect by the 4
   * half-planes of the two tight slabs over `verts` (same machinery as
   * kdopfan's candidate pairs). Guaranteed to contain every input vert. */
  function paraCorners(verts, e1deg, e2deg) {
    var poly = [[-1e5, -1e5], [1e5, -1e5], [1e5, 1e5], [-1e5, 1e5]];
    [perp(bvec(e1deg)), perp(bvec(e2deg))].forEach(function (n) {
      var ext = slabExtents(verts, n);
      poly = clipHalf(poly, n, ext[1]);
      poly = clipHalf(poly, [-n[0], -n[1]], -ext[0]);
    });
    return sortCorners(dedupe(poly));
  }

  /* k-DOP over the 12 fan directions, same construction as kdopfan. */
  function kdopCorners(verts) {
    var poly = [[-1e5, -1e5], [1e5, -1e5], [1e5, 1e5], [-1e5, 1e5]];
    for (var i = 0; i < FAN_N; i++) {
      var n = bvec(FAN_OFF + i * 30);
      var ext = slabExtents(verts, n);
      poly = clipHalf(poly, n, ext[1]);
      poly = clipHalf(poly, [-n[0], -n[1]], -ext[0]);
    }
    return dedupe(poly);
  }

  /* Rotate quad b's (cyclic, same winding) corner list so its first
   * corner lies nearest to a's first corner — keeps morphs untwisted. */
  function alignQuad(a, b) {
    var bi = 0, bd = Infinity;
    for (var i = 0; i < b.length; i++) {
      var d = Math.abs(b[i][0] - a[0][0]) + Math.abs(b[i][1] - a[0][1]);
      if (d < bd) { bd = d; bi = i; }
    }
    return b.slice(bi).concat(b.slice(0, bi));
  }

  function pts2str(verts) {
    return verts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  function topmost(pts) {
    return pts.reduce(function (a, p) { return p[1] < a[1] ? p : a; });
  }

  /* Node's basis for the given pose. Moved leaves re-derive theirs from
   * the deformation (basis follows the cluster rotation); moved internal
   * nodes get their post-refit rotation. */
  function basisDeg(id, moved) {
    var b = BASIS[id], rot = 0;
    if (moved) {
      rot = LEAVES.indexOf(id) >= 0 ? clusterById(id).move.rot : MOVED_ROT[id];
    }
    return { e1: b.e1 + rot, e2: b.e2 + rot };
  }

  /* Extents for internal nodes: measured over the CHILD SOBB corners
   * (already computed — NODES is ordered leaves-first), not over raw
   * triangle verts. A parent SOBB then visibly contains its child bounds,
   * as a BVH reader expects; the child corners enclose the geometry anyway. */
  function nodeShapeVerts(id, moved, shapes) {
    if (LEAVES.indexOf(id) >= 0) return nodeVerts(id, moved);
    var out = [];
    CHILDREN[id].forEach(function (k) {
      out = out.concat(shapes[k][moved ? 'moved' : 'rest']);
    });
    return out;
  }

  /* Per-node SOBB corners in both poses. */
  function computeShapes() {
    var shapes = {};
    NODES.forEach(function (id) {
      var rest = paraCorners(nodeShapeVerts(id, false, shapes), BASIS[id].e1, BASIS[id].e2);
      var mb = basisDeg(id, true);
      var moved = alignQuad(rest,
        paraCorners(nodeShapeVerts(id, true, shapes), mb.e1, mb.e2));
      shapes[id] = { rest: rest, moved: moved };
    });
    return shapes;
  }

  /* s3: the parent's attempted new bound over its children's (moved)
   * bounds in the foreign Q_BASIS — contains them, visibly wrong-skewed. */
  function computeQ(shapes) {
    return paraCorners(shapes.A.moved.concat(shapes.B.moved), Q_BASIS.e1, Q_BASIS.e2);
  }

  /* k-DOP polygons the EG25 refit walks up (over moved geometry). */
  function computeKdops() {
    var k = {};
    ['M0', 'M1', 'R'].forEach(function (id) { k[id] = kdopCorners(nodeVerts(id, true)); });
    return k;
  }

  /* ==================== DOM helpers ==================== */

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function text(str, attrs, parent) {
    var t = el('text', attrs, parent);
    t.textContent = str;
    return t;
  }
  /* ==================== animator ==================== */

  var built = false;
  var sceneSvg, treeSvg;
  var polyEls = [];          // {el, rest, moved} triangles in order
  var paraEls = {};          // nodeId -> {el, restStr, movedStr}
  var nodeEls = {};          // nodeId -> tree node rect
  var edgeForChild = {};     // childId -> edge line
  var glyphG = {};           // nodeId -> {g, x, y}
  var glyphLines = {};       // nodeId -> [line, line]
  var kdopSceneEls = {};     // M0/M1/R -> scene k-DOP polygon
  var kdopLens = {};         // M0/M1/R -> outline length
  var kdopEls = {};          // M0/M1/R -> tree overlay group
  var pingEls = {};          // A..D -> tree k-DOP ping group
  var overlayEls = {};       // A/B -> scene emphasis polygon
  var arrowGs = {};          // A/B -> scene basis-arrow group
  var qPoly, qAux, qLen = 0; // s3 "?" parallelogram + its arrows/tag
  var costBadgeG;
  var captionEl;
  var SHAPES = null, KDOPS = null, Q = null;
  var tl = null;
  var panelEls = [];

  function glyphTransform(id, rot) {
    return 'translate(' + glyphG[id].x + ' ' + glyphG[id].y + ') rotate(' + rot + ')';
  }

  function paraRestStyle(p) {
    p.setAttribute('stroke', INK);
    p.setAttribute('stroke-dasharray', 'none');
  }

  function buildScene(container) {
    sceneSvg = el('svg', {
      viewBox: '0 0 600 600', width: '100%', height: '100%'
    }, container);

    // arrowhead markers for the basis arrows (mismatch beat)
    var defs = el('defs', {}, sceneSvg);
    [['sb-ar-b', BLUE], ['sb-ar-r', ROSE], ['sb-ar-k', INK]].forEach(function (m) {
      var mk = el('marker', {
        id: m[0], viewBox: '0 0 8 8', refX: 6, refY: 4,
        markerWidth: 6.5, markerHeight: 6.5, orient: 'auto'
      }, defs);
      el('path', { d: 'M0,0 L8,4 L0,8 z', fill: m[1] }, mk);
    });

    // triangles
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

    // SOBB parallelograms, deepest first so the root draws on top.
    // No CSS class: all paint lives on attributes (GSAP-tweened).
    var order = LEAVES.concat(['M0', 'M1', 'R']);
    order.forEach(function (id) {
      var p = el('polygon', {
        points: pts2str(SHAPES[id].rest),
        fill: 'none', stroke: INK,
        'stroke-width': id === 'R' ? 2.2 : 1.6,
        'stroke-linejoin': 'round'
      }, sceneSvg);
      paraEls[id] = {
        el: p,
        restStr: pts2str(SHAPES[id].rest),
        movedStr: pts2str(SHAPES[id].moved)
      };
    });

    // k-DOP polygons the EG25 refit walks up (swept on via dashoffset)
    ['M0', 'M1', 'R'].forEach(function (id) {
      var p = el('polygon', {
        points: pts2str(KDOPS[id]),
        fill: '#dcebfd', 'fill-opacity': 0.55,
        stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round',
        opacity: 0
      }, sceneSvg);
      // round to 6dp so forward/backward seeks re-serialize identically
      kdopLens[id] = Math.round(p.getTotalLength() * 1000000) / 1000000;
      p.setAttribute('stroke-dasharray', kdopLens[id]);
      p.setAttribute('stroke-dashoffset', kdopLens[id]);
      kdopSceneEls[id] = p;
    });

    // s3 emphasis overlays on the quarreling children (A blue, B rose)
    ['A', 'B'].forEach(function (id) {
      overlayEls[id] = el('polygon', {
        points: pts2str(SHAPES[id].moved),
        fill: 'none', 'stroke-width': 3, 'stroke-linejoin': 'round',
        stroke: id === 'A' ? BLUE : ROSE, opacity: 0
      }, sceneSvg);
    });

    // s3 "?" parallelogram: the parent's attempted new bound, third basis
    qPoly = el('polygon', {
      points: pts2str(Q),
      fill: 'none', stroke: INK, 'stroke-width': 1.6,
      'stroke-dasharray': '6 5', 'stroke-linejoin': 'round', opacity: 0
    }, sceneSvg);
    qLen = Math.round(qPoly.getTotalLength() * 1000000) / 1000000;
    qPoly.setAttribute('stroke-dasharray', qLen);
    qPoly.setAttribute('stroke-dashoffset', qLen);

    // s3 basis arrows: children in their colors, the "?" in dashed ink
    function arrows(center, basis, color, marker, dash) {
      var g = el('g', { opacity: 0 }, sceneSvg);
      [bvec(basis.e1), bvec(basis.e2)].forEach(function (v) {
        el('line', {
          x1: center[0] - ARROW_LEN * v[0], y1: center[1] - ARROW_LEN * v[1],
          x2: center[0] + ARROW_LEN * v[0], y2: center[1] + ARROW_LEN * v[1],
          stroke: color, 'stroke-width': 2.2, 'stroke-dasharray': dash,
          'marker-end': 'url(#' + marker + ')'
        }, g);
      });
      return g;
    }
    ['A', 'B'].forEach(function (id) {
      arrowGs[id] = arrows(
        centroidOf(movedVerts(clusterById(id))), basisDeg(id, true),
        id === 'A' ? BLUE : ROSE, id === 'A' ? 'sb-ar-b' : 'sb-ar-r', 'none');
    });
    qAux = el('g', { opacity: 0 }, sceneSvg);
    var qc = centroidOf(Q), qt = topmost(Q);
    [bvec(Q_BASIS.e1), bvec(Q_BASIS.e2)].forEach(function (v) {
      el('line', {
        x1: qc[0] - ARROW_LEN * v[0], y1: qc[1] - ARROW_LEN * v[1],
        x2: qc[0] + ARROW_LEN * v[0], y2: qc[1] + ARROW_LEN * v[1],
        stroke: INK, 'stroke-width': 2, 'stroke-dasharray': '5 4',
        'marker-end': 'url(#sb-ar-k)'
      }, qAux);
    });
    text('?', {
      x: qt[0], y: qt[1] - 12, 'text-anchor': 'middle',
      'font-size': 22, 'font-weight': 650, fill: INK
    }, qAux);
  }

  function buildTree(container) {
    treeSvg = el('svg', {
      viewBox: '0 0 560 600', width: '100%', height: '100%'
    }, container);

    LEVEL_LABELS.forEach(function (l) {
      text(l.text.toUpperCase(), { 'class': 'svg-side-label', x: 18, y: l.y + 5 }, treeSvg);
    });

    Object.keys(CHILDREN).forEach(function (parent) {
      CHILDREN[parent].forEach(function (child) {
        var a = NODE_POS[parent], b = NODE_POS[child];
        edgeForChild[child] = el('line', {
          'class': 'svg-edge',
          x1: a.x, y1: a.y, x2: b.x, y2: b.y
        }, treeSvg);
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
      text(LEAVES.indexOf(id) >= 0 ? '△ ' + id : id, {
        'class': 'svg-node-text', x: p.x, y: p.y + 5.5, 'text-anchor': 'middle'
      }, g);
    });

    // basis glyph per node: two skew segments under the node box,
    // rotated to the node's current basis as the refit progresses
    Object.keys(NODE_POS).forEach(function (id) {
      var p = NODE_POS[id];
      glyphG[id] = { g: null, x: p.x, y: p.y + NODE_H / 2 + 10 };
      var g = el('g', {
        transform: 'translate(' + glyphG[id].x + ' ' + glyphG[id].y + ') rotate(0)',
        opacity: 0.85
      }, treeSvg);
      glyphG[id].g = g;
      glyphLines[id] = [bvec(BASIS[id].e1), bvec(BASIS[id].e2)].map(function (v) {
        return el('line', {
          x1: -GLYPH_LEN * v[0], y1: -GLYPH_LEN * v[1],
          x2: GLYPH_LEN * v[0], y2: GLYPH_LEN * v[1],
          stroke: INK, 'stroke-width': 1.4
        }, g);
      });
    });

    // k-DOP ping frames on the leaves (child -> parent handoff)
    LEAVES.forEach(function (id) {
      var p = NODE_POS[id];
      var g = el('g', { opacity: 0 }, treeSvg);
      el('rect', {
        x: p.x - 28, y: p.y - 22, width: 56, height: 44, rx: 7,
        fill: '#dcebfd', 'fill-opacity': 0.5,
        stroke: BLUE, 'stroke-width': 1.8
      }, g);
      pingEls[id] = g;
    });

    // k-DOP overlays on the internal nodes + root
    ['M0', 'M1', 'R'].forEach(function (id) {
      var p = NODE_POS[id];
      var g = el('g', { opacity: 0 }, treeSvg);
      el('rect', {
        x: p.x - 34, y: p.y - 25, width: 68, height: 50, rx: 8,
        fill: '#dcebfd', 'fill-opacity': 0.6,
        stroke: BLUE, 'stroke-width': 2.4
      }, g);
      var tagPos = KDOP_TAG[id];
      text('k-DOP', {
        x: tagPos.x, y: tagPos.y, 'text-anchor': tagPos.anchor,
        'font-size': 17, fill: BLUE
      }, g);
      kdopEls[id] = g;
    });

    // s6: red cost badge beside the root
    costBadgeG = el('g', { opacity: 0 }, treeSvg);
    el('rect', {
      x: COST_BADGE.x, y: COST_BADGE.y,
      width: COST_BADGE.w, height: COST_BADGE.h, rx: 6,
      fill: '#fbeaea', stroke: RED, 'stroke-width': 1.8
    }, costBadgeG);
    text(COST_BADGE.text, {
      x: COST_BADGE.x + COST_BADGE.w / 2, y: COST_BADGE.y + 17.5,
      'text-anchor': 'middle', 'font-size': 18, fill: RED, 'font-weight': 650
    }, costBadgeG);
  }

  /* Flash tree nodes + incoming edges blue (transient eye candy). */
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

  /* Morph node SOBBs to their (aligned) moved corners, blue. */
  function addParaRefit(ids, at, dur) {
    ids.forEach(function (id) {
      tl.set(paraEls[id].el, { attr: { stroke: BLUE, 'stroke-dasharray': 'none' } }, at);
      tl.to(paraEls[id].el, {
        duration: dur, ease: 'power2.inOut',
        attr: { points: paraEls[id].movedStr }
      }, at);
    });
  }

  /* Rotate the tree basis glyphs to a node's post-refit skew. */
  function addGlyphRot(ids, rotFn, at, dur) {
    ids.forEach(function (id) {
      tl.to(glyphG[id].g, {
        duration: dur, ease: 'power2.inOut',
        attr: { transform: glyphTransform(id, rotFn(id)) }
      }, at);
    });
  }
  function resetDom() {
    // triangles back to rest pose, fully visible
    polyEls.forEach(function (p) {
      gsap.killTweensOf(p.el);
      p.el.setAttribute('points', pts2str(p.rest));
      p.el.setAttribute('opacity', 1);
    });
    // parallelograms back to rest corners and neutral ink
    NODES.forEach(function (id) {
      gsap.killTweensOf(paraEls[id].el);
      paraEls[id].el.setAttribute('points', paraEls[id].restStr);
      paraEls[id].el.setAttribute('opacity', 1);
      paraRestStyle(paraEls[id].el);
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
    // basis glyphs: rest rotation, neutral ink
    NODES.forEach(function (id) {
      gsap.killTweensOf(glyphG[id].g);
      glyphG[id].g.setAttribute('transform', glyphTransform(id, 0));
      glyphLines[id].forEach(function (l) {
        gsap.killTweensOf(l);
        l.setAttribute('stroke', INK);
        l.setAttribute('stroke-width', 1.4);
        l.setAttribute('stroke-dasharray', 'none');
      });
    });
    // story elements hidden/neutral
    [qAux, costBadgeG].forEach(function (g) {
      gsap.killTweensOf(g);
      g.setAttribute('opacity', 0);
    });
    gsap.killTweensOf(qPoly);
    qPoly.setAttribute('opacity', 0);
    qPoly.setAttribute('stroke-dashoffset', qLen);
    ['A', 'B'].forEach(function (id) {
      [overlayEls[id], arrowGs[id]].forEach(function (g) {
        gsap.killTweensOf(g);
        g.setAttribute('opacity', 0);
      });
    });
    ['M0', 'M1', 'R'].forEach(function (id) {
      gsap.killTweensOf(kdopSceneEls[id]);
      kdopSceneEls[id].setAttribute('opacity', 0);
      kdopSceneEls[id].setAttribute('stroke-dashoffset', kdopLens[id]);
      gsap.killTweensOf(kdopEls[id]);
      kdopEls[id].setAttribute('opacity', 0);
    });
    LEAVES.forEach(function (id) {
      gsap.killTweensOf(pingEls[id]);
      pingEls[id].setAttribute('opacity', 0);
    });
  }

  /* One branch of the EG25 walk: children hand their k-DOPs up, the
   * parent's k-DOP sweeps on in the scene, and the SOBB is re-fit from
   * it (new corners, new basis glyph). */
  function addKdopRefit(id, kids, t0) {
    var pings = kids.map(function (k) { return pingEls[k]; });
    tl.fromTo(pings,
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.22, ease: 'power1.out', stagger: 0.06 }, t0);
    tl.fromTo(kdopEls[id],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.3, ease: 'power1.out' }, t0 + 0.28);
    tl.to(pings,
      { attr: { opacity: 0 }, duration: 0.3, ease: 'power1.in' }, t0 + 0.34);
    tl.set(kdopSceneEls[id], { attr: { opacity: 1 } }, t0 + 0.28);
    tl.fromTo(kdopSceneEls[id],
      { attr: { 'stroke-dashoffset': kdopLens[id] } },
      { attr: { 'stroke-dashoffset': 0 }, duration: 0.8, ease: 'power1.inOut' }, t0 + 0.3);
    addParaRefit([id], t0 + 0.55, 0.9);
    addGlyphRot([id], function () { return MOVED_ROT[id]; }, t0 + 0.55, 0.9);
    tl.to(kdopSceneEls[id],
      { attr: { opacity: 0.12 }, duration: 0.5, ease: 'power1.out' }, t0 + 1.5);
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });

    // s1: geometry deforms — every SOBB in the hierarchy is now stale
    // (red dashed). The invalid state is the end point of this step;
    // nothing re-fits yet.
    polyEls.forEach(function (p, i) {
      tl.to(p.el, {
        attr: { points: pts2str(p.moved) },
        duration: 1.25, ease: 'power2.inOut'
      }, i * 0.06);
    });
    var allParas = NODES.map(function (id) { return paraEls[id].el; });
    tl.set(allParas, { attr: { stroke: RED, 'stroke-dasharray': '7 5' } }, '>');
    tl.addLabel('s1', tl.duration());

    // s2: leaves re-fit in their NEW skews (basis glyphs rotate with
    // them); the triangles fade — leaves are self-sufficient, their
    // parents are not. The spacer keeps the s1 label clear of the
    // refit stroke .set.
    tl.to({}, { duration: 0.3 }, '>');
    tl.add(function () { pulseNodes(LEAVES); }, '>');
    var leafAt = tl.duration();
    addParaRefit(LEAVES, '>', 0.9);
    addGlyphRot(LEAVES, function (id) { return clusterById(id).move.rot; }, leafAt, 0.9);
    tl.to(polyEls.map(function (p) { return p.el; }), {
      attr: { opacity: TRI_FADE },
      duration: 0.8, ease: 'power1.inOut'
    }, leafAt + 0.6);
    tl.addLabel('s2', tl.duration());

    // s3: the problem — parent M0's children have different bases.
    // Emphasis overlays + basis arrows A (blue) vs B (rose); the dashed
    // "?" parallelogram sweeps on in a third, wrong basis.
    tl.to({}, { duration: 0.35 }, '>');
    var s3a = tl.duration();
    tl.fromTo([overlayEls.A, overlayEls.B],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.35, ease: 'power1.out' }, s3a);
    tl.fromTo([arrowGs.A, arrowGs.B],
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.3, ease: 'power1.out', stagger: 0.12 }, s3a + 0.15);
    tl.to(glyphLines.A, { attr: { stroke: BLUE, 'stroke-width': 2.2 }, duration: 0.3 }, s3a + 0.15);
    tl.to(glyphLines.B, { attr: { stroke: ROSE, 'stroke-width': 2.2 }, duration: 0.3 }, s3a + 0.15);
    tl.set(qPoly, { attr: { opacity: 1 } }, s3a + 0.5);
    tl.fromTo(qPoly,
      { attr: { 'stroke-dashoffset': qLen } },
      { attr: { 'stroke-dashoffset': 0 }, duration: 0.9, ease: 'power1.inOut' }, s3a + 0.5);
    tl.to(glyphLines.M0, { attr: { 'stroke-dasharray': '3 2' }, duration: 0.2 }, s3a + 0.5);
    tl.fromTo(qAux,
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.3, ease: 'power1.out' }, s3a + 1.15);
    tl.addLabel('s3', tl.duration());

    // s4: the EG25 fix at the internal level — full k-DOPs travel up to
    // M0, then M1; each parent re-fits its SOBB from the k-DOP.
    tl.to({}, { duration: 0.3 }, '>');
    tl.to([overlayEls.A, overlayEls.B, arrowGs.A, arrowGs.B, qAux, qPoly],
      { attr: { opacity: 0 }, duration: 0.35, ease: 'power1.in' }, '>');
    tl.to(glyphLines.A.concat(glyphLines.B),
      { attr: { stroke: INK, 'stroke-width': 1.4 }, duration: 0.3 }, '<');
    tl.to(glyphLines.M0, { attr: { 'stroke-dasharray': 'none' }, duration: 0.2 }, '<');
    addKdopRefit('M0', ['A', 'B'], tl.duration());
    addKdopRefit('M1', ['C', 'D'], tl.duration());
    tl.addLabel('s4', tl.duration());

    // s5: same again at the root — every node, bottom-up, every frame.
    tl.to({}, { duration: 0.3 }, '>');
    addKdopRefit('R', [], tl.duration());
    tl.add(function () { pulseNodes(['R']); }, '>');
    tl.addLabel('s5', tl.duration());

    // s6: cost — 4.4–4.7× an AABB refit, ~60 MB scratch.
    tl.to({}, { duration: 0.25 }, '>');
    tl.fromTo(costBadgeG,
      { attr: { opacity: 0 } },
      { attr: { opacity: 1 }, duration: 0.4, ease: 'power1.out' }, '>');
    tl.addLabel('s6', tl.duration());
  }

  var animator = {
    start: function (fragStep) {
      if (!built) {
        SHAPES = computeShapes();
        KDOPS = computeKdops();
        Q = computeQ(SHAPES);
        buildScene(document.getElementById('sobbrefit-scene'));
        buildTree(document.getElementById('sobbrefit-tree'));
        captionEl = document.getElementById('sobbrefit-caption');
        panelEls = [sceneSvg, treeSvg];
        built = true;
      }

      animator.stop();
      resetDom();
      buildTimeline();

      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      if (fragStep > 0) {
        tl.seek(D.stopsFor(tl, 6)[fragStep], true); // no callbacks fired
      }

      // gentle entrance of both panels
      gsap.fromTo(panelEls,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.08, overwrite: 'auto' });
    },

    step: function (fragStep) {
      if (!tl) return;
      captionEl.textContent = CAPTIONS[fragStep] || CAPTIONS[0];
      tl.tweenTo(D.stopsFor(tl, 6)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
    }
  };

  // expose pure geometry for headless smoke tests
  animator._test = {
    computeShapes: computeShapes,
    computeKdops: computeKdops,
    computeQ: computeQ,
    paraCorners: paraCorners,
    kdopCorners: kdopCorners,
    nodeVerts: nodeVerts,
    basis: BASIS,
    qBasis: Q_BASIS,
    clusters: CLUSTERS
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.sobbrefit = animator;
})();
