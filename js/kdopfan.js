/* Animator: L3 "Fitting SOBBs — EG25 in one slide".
 *
 * How a SOBB is fitted from a k-DOP, told as a search over slab-pair
 * candidates:
 *   entry:  the slide opens PIXEL-IDENTICAL to slide L2.5 (kdopintro)'s
 *           final frame at scale 1.0 — colored slab lines at 1.3/0.5,
 *           solid 2.2 ink k-DOP, side label "K-DOP = SLAB PAIRS". The
 *           section has data-transition="none", so the L2.5→L3 hand-off
 *           is a hard cut between identical frames, and the ONLY
 *           entrance choreography is a 1.3s zoom-out (proxy {z} tween
 *           1.0 → Z about the cluster center, NOT part of the fragment
 *           timeline) plus the side-label crossfade to
 *           "SOBB = SLAB PAIRS (2D) | SLAB TRIPLETS (3D)". No svg
 *           fade/rise — the first frame must not pop.
 *   base:   zoomed diagram at rest (all six slab pairs visible)
 *   s1:     first candidate (slabs 10°/40° — the BIGGEST parallelogram):
 *           its 4 boundary lines brighten and thicken, the other pairs
 *           recede, and the candidate parallelogram appears (neutral
 *           fill/stroke). Its corners reach ±914 viewBox units above/
 *           below the cluster center — this is the "previously clipped"
 *           region the zoom-out exists to reveal.
 *   s2:     the search: the parallelogram morphs through the remaining
 *           candidates in descending area order (10/160 → 10/70 →
 *           AABB → 10/100 → 100/160), brightening each candidate's slab
 *           pairs as it goes. Only the two named beats carry a tag —
 *           the axis-aligned pair "AABB" and the orthogonal pair
 *           "OBB" — landing with their morph and PERSISTING at full
 *           opacity until the next tag replaces them (AABB → OBB
 *           hand-off; OBB goes out as the final SOBB morph lands, no
 *           successor). The fan candidates and the final SOBB carry no
 *           text: morph + slab highlights carry those beats. The axis
 *           slabs' 4 ink boundary lines (L2's AABB color) fade in only
 *           for the AABB beat, since axis slabs are not in the fan and
 *           the base must keep kdopintro parity.
 *           1.2s morphs with 0.5–1.0s holds: s1→s2 ≈ 9.5s. Ends on the
 *           minimum-area pair = the SOBB (100°/160°, teal/amber)
 *   s3:     SOBB settles: teal + amber strip fills fade in (plus-lighter
 *           blend inside an isolated group — the blend overlap IS the
 *           SOBB), the solid SOBB outline sweeps on via
 *           stroke-dashoffset; fan lines and k-DOP recede. The settled
 *           SOBB is intentionally unlabeled.
 *   s4:     promise beat — fills #kdop-promise and fades it in
 *
 * Geometry is fixed and precomputed: slab extents measured on all
 * cluster vertices, candidate parallelograms = ±1e5 rect clipped by the
 * 4 half-planes of the two slabs (clean 4-gons, corners sorted CCW by
 * angle around the centroid so GSAP points morphs stay sane). Areas
 * (viewBox units): 10/40 → 541416, 10/160 → 369747, 10/70 → 250711,
 * 0/90 → 139147 (the AABB, identical to L2's aabbC), 10/100 → 111054
 * (the OBB), 100/160 → 91110 (the SOBB).
 *
 * Zoom depth: Z = 0.26 — the largest value at which the biggest
 * candidate (10/40, world half-extents ±418..422 x / −913..+914 y about
 * the cluster center) lands FULLY inside the screen frame (margin rect
 * 30..1010 x 30..530, insets L331 R430 T18 B7). Exact-fit is 0.2680
 * (bottom corner kisses the frame edge) — 0.26 keeps a slim clean
 * inset. Everything else shrinks with it: that wide shot is the point.
 *
 * The clip-path'd frame: the clipPath is in user space INSIDE the world
 * group, so it would scale down with the world and chop the big
 * candidates to a small central box. Instead the clip rect is the
 * world-space PRE-IMAGE of the screen frame (center + (frame - center)
 * / Z): at the end zoom the on-screen clip window IS exactly the margin
 * rect, and during the entrance the window grows past the viewBox —
 * the zoom literally reveals the previously clipped regions. The slab
 * strips are clipped to the same pre-image rect (exact half-plane ∩
 * rect, no 2000-chords) so they fill the whole end-state frame.
 *
 * Stroke compensation (world-unit widths scale by Z on screen; at
 * Z=0.26, 2.2 ink → 0.57px, illegible):
 *   - lines, k-DOP, triangles: vector-effect="non-scaling-stroke" — an
 *     ATTRIBUTE (never a CSS rule, never GSAP-tweened), so on-screen
 *     weights stay exactly 1.3/0.5/2.2/1.2 at any z. At entry z=1 the
 *     transform is identity, so kdopintro parity holds pixel-for-pixel.
 *     Line-state widths (LS_*) keep their meaning as screen px.
 *   - candidate + SOBB outlines (both invisible at entry, so parity is
 *     moot): world width / Z (1.3/Z, 2.2/Z) and dasharray / Z, so the
 *     end-state screen weights are the deck-standard 1.3 dashed / 2.2
 *     solid. Dash lengths stay in local units so the SOBB
 *     stroke-dashoffset sweep math is untouched.
 *
 * Text labels (side label, OBB, AABB) live OUTSIDE the world group at
 * screen coordinates — they never scale, so their px sizes stay in
 * deck range regardless of Z; candidate tags are placed at the scaled
 * screen position of their world anchor (toScreen uses ZOOM).
 * Host: #kdop-canvas. Fragments: 4 (s1..s4).
 */
(function () {
  'use strict';

  var D = window.DeckSVG;

  /* ==================== LAYOUT DATA ==================== */

  var VB_W = 1040, VB_H = 560;
  var CENTER = [470, 285];
  var FAN_OFF = 10;              // fan: directions at 10 + 30k degrees
  var FAN_N = 12;
  var PAIR_ANGLES = [10, 40, 70, 100, 130, 160];  // 6 unique slab pairs
  var MARGIN = 30;               // screen frame: margin rect inside the viewBox
  var ZOOM = 0.26;               // entrance zoom-out end scale (10/40 fully in-frame)

  // slab identity colors, keyed by fan angle (DeckSVG constants)
  var PAIR_COLOR = {
    10: null /* filled in build from D */, 40: null, 70: null,
    100: null, 130: null, 160: null
  };

  // candidate sequence, descending area; last = minimum = the SOBB.
  // [0,90] = the AABB: axis-aligned normals, NOT in the 6-line fan —
  // its 4 boundary lines live in a separate ink group that fades in
  // only for the AABB beat, so the base keeps kdopintro parity.
  var CANDIDATES = [[10, 40], [10, 160], [10, 70], [0, 90], [10, 100], [100, 160]];
  var AABB_INDEX = 3;            // [0,90]: ink, matches L2's AABB color
  var OBB_INDEX = 4;             // 10/100: the orthogonal candidate
  var SOBB_INDEX = 5;            // 100/160: teal + amber, matches L2

  function isAabbPair(pair) { return pair[0] === 0 && pair[1] === 90; }

  var PROMISE_TEXT = 'This talk: static scenes first, then what changes when they move.';

  /* ==================== pure helpers ==================== */

  function rad(d) { return d * Math.PI / 180; }

  function perp(v) { return [-v[1], v[0]]; }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }

  function flatVerts(tris) {
    var out = [];
    tris.forEach(function (t) { out = out.concat(t); });
    return out;
  }

  function slabExtents(pts, n) {
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      var d = p[0] * n[0] + p[1] * n[1];
      lo = Math.min(lo, d); hi = Math.max(hi, d);
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

  /* drop consecutive duplicates from degenerate clips */
  function dedupe(poly) {
    return poly.filter(function (p, i) {
      var q = poly[(i + 1) % poly.length];
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 0.5;
    });
  }

  /* Clip segment a→b to rect [x0,y0,x1,y1]; null if fully outside. */
  function clipSegRect(a, b, r) {
    var t0 = 0, t1 = 1;
    var d = [b[0] - a[0], b[1] - a[1]];
    var edges = [
      { n: [1, 0], m: r.x1 }, { n: [-1, 0], m: -r.x0 },
      { n: [0, 1], m: r.y1 }, { n: [0, -1], m: -r.y0 }
    ];
    for (var i = 0; i < edges.length; i++) {
      var dn = d[0] * edges[i].n[0] + d[1] * edges[i].n[1];
      var an = a[0] * edges[i].n[0] + a[1] * edges[i].n[1];
      if (Math.abs(dn) < 1e-9) { if (an > edges[i].m) return null; }
      else {
        var t = (edges[i].m - an) / dn;
        if (dn > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
      }
    }
    if (t0 > t1) return null;
    return [
      [a[0] + t0 * d[0], a[1] + t0 * d[1]],
      [a[0] + t1 * d[0], a[1] + t1 * d[1]]
    ];
  }

  function polyArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  /* Sort a quad's corners CCW by angle around its centroid, so a
   * corners→corners points tween never twists through itself. */
  function sortCorners(poly) {
    var c = centroid(poly);
    return poly.slice().sort(function (p, q) {
      return Math.atan2(p[1] - c[1], p[0] - c[0]) -
             Math.atan2(q[1] - c[1], q[0] - c[0]);
    });
  }

  /* Candidate parallelogram: clip a huge rect by the 4 half-planes of
   * slabs a and b. Every candidate comes out a clean 4-gon. */
  function pairCorners(a, b) {
    var poly = [[-1e5, -1e5], [1e5, -1e5], [1e5, 1e5], [-1e5, 1e5]];
    poly = clipHalf(poly, a.n, a.hi);
    poly = clipHalf(poly, [-a.n[0], -a.n[1]], -a.lo);
    poly = clipHalf(poly, b.n, b.hi);
    poly = clipHalf(poly, [-b.n[0], -b.n[1]], -b.lo);
    return sortCorners(poly);
  }

  /* Slab strip polygon (region between a slab's two boundary planes),
   * clipped to the frame rect: exactly rect ∩ {lo <= n·p <= hi}. No
   * finite chords — the pre-image frame is ~3700x1900 world units, so
   * chord-based construction could under-reach its corners. */
  function stripPoly(s, r) {
    var poly = [
      [r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]
    ];
    poly = clipHalf(poly, s.n, s.hi);
    poly = clipHalf(poly, [-s.n[0], -s.n[1]], -s.lo);
    return poly;
  }

  function pts2str(pts) {
    return pts.map(function (p) {
      return Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10;
    }).join(' ');
  }

  function topmost(pts) {
    return pts.reduce(function (a, p) { return p[1] < a[1] ? p : a; });
  }

  /* world → screen: the entrance zoom maps world coords by Z about the
   * cluster center; tags/labels outside the world group live in screen
   * coordinates, so their anchors go through this. */
  function toScreen(p) {
    return [
      CENTER[0] + (p[0] - CENTER[0]) * ZOOM,
      CENTER[1] + (p[1] - CENTER[1]) * ZOOM
    ];
  }

  /* ==================== animator ==================== */

  var built = false;
  var svg, worldG, kdopEl, candEl, sobbEl, candTagEls, candTagAt, stripsG;
  var labelOldEl, labelNewG, promiseEl;
  var allLines, linesByAng, aabbLines;
  var sobbPathLen = 0;
  var kdopPts = null, candidates = null;
  var tl = null;
  var proxy = { z: 1 };          // entrance zoom proxy (NOT in tl)

  /* Line states. Lines keep their slab color at all times; activity is
   * expressed only through opacity + width (attributes, GSAP-tweened).
   * Lines have vector-effect="non-scaling-stroke", so widths below are
   * SCREEN px at any zoom. LS_BASE is kdopintro's final frame
   * (0.5 / 1.3) so the slides match pixel-for-pixel at the hard cut. */
  var LS_BASE = { opacity: 0.5, width: 1.3 };
  var LS_DIM = { opacity: 0.15, width: 1.1 };
  var LS_ACTIVE = { opacity: 1, width: 2.6 };
  var LS_GONE = { opacity: 0.12, width: 1 };

  function updateWorld() {
    worldG.setAttribute('transform',
      'translate(' + CENTER[0] + ' ' + CENTER[1] + ') scale(' + proxy.z + ') ' +
      'translate(' + (-CENTER[0]) + ' ' + (-CENTER[1]) + ')');
  }

  function build() {
    PAIR_COLOR[10] = D.BLUE;
    PAIR_COLOR[40] = D.VIOLET;
    PAIR_COLOR[70] = D.ROSE;
    PAIR_COLOR[100] = D.TEAL;
    PAIR_COLOR[130] = D.SLATE;
    PAIR_COLOR[160] = D.AMBER;

    var cl = D.makeCluster(CENTER[0], CENTER[1]);
    var tris = cl.tris;
    var pts = flatVerts(tris);

    var host = document.getElementById('kdop-canvas');
    svg = D.el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: '100%', height: '100%'
    }, host);

    var RECT = { x0: MARGIN, y0: MARGIN, x1: VB_W - MARGIN, y1: VB_H - MARGIN };

    // The end-state frame lives on screen (the margin rect in viewBox
    // coords). Elements inside the world group see the world user space,
    // so the world-space pre-image of that screen frame is what they
    // must be clipped to: center + (frame - center) / Z. At entry (z=1)
    // the on-screen clip window is this huge rect (~off-slide) — parity
    // safe, because everything clipped (candidate, strips) starts
    // invisible; at z=Z the window shrinks to exactly the margin rect.
    var FRAME = {
      x0: CENTER[0] + (MARGIN - CENTER[0]) / ZOOM,
      y0: CENTER[1] + (MARGIN - CENTER[1]) / ZOOM,
      x1: CENTER[0] + (VB_W - MARGIN - CENTER[0]) / ZOOM,
      y1: CENTER[1] + (VB_H - MARGIN - CENTER[1]) / ZOOM
    };

    // One shared frame as a user-space clipPath inside the world group.
    // Render-only — the candidate corner points still tween unclipped.
    var CLIP_ID = 'kdop-frame-clip';
    var defs = D.el('defs', {}, svg);
    var clip = D.el('clipPath', { id: CLIP_ID }, defs);
    D.el('rect', {
      x: FRAME.x0, y: FRAME.y0,
      width: FRAME.x1 - FRAME.x0, height: FRAME.y1 - FRAME.y0
    }, clip);

    // ALL diagram geometry lives in the world group; text stays outside
    worldG = D.el('g', {}, svg);

    // unique slab pairs, cluster-tight extents over all triangle verts;
    // + the two AABB slabs (normals 0°/90°) for the AABB candidate —
    // same clip machinery, but they get no fan lines
    var i, ang;
    var slabs = {};
    PAIR_ANGLES.concat([0, 90]).forEach(function (a) {
      var n = [Math.cos(rad(a)), Math.sin(rad(a))];
      var ext = slabExtents(pts, n);
      slabs[a] = { ang: a, n: n, lo: ext[0], hi: ext[1] };
    });

    // slab-pair boundary lines (behind everything), clipped to the
    // margin rect; two lines per pair, each pair in its own color.
    // 2000-long chords before clipping — matches kdopintro end-to-end.
    allLines = [];
    linesByAng = {};
    PAIR_ANGLES.forEach(function (a) {
      var s = slabs[a];
      linesByAng[a] = [];
      [s.lo, s.hi].forEach(function (m) {
        var pt = [s.n[0] * m, s.n[1] * m];
        var t = perp(s.n);
        var seg = clipSegRect(
          [pt[0] - 2000 * t[0], pt[1] - 2000 * t[1]],
          [pt[0] + 2000 * t[0], pt[1] + 2000 * t[1]],
          RECT
        );
        if (!seg) return;
        // non-scaling-stroke: screen weight = LS_* value at any zoom z;
        // at entry (z=1, identity transform) identical to kdopintro
        var line = D.el('line', {
          x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1],
          stroke: PAIR_COLOR[a],
          'stroke-width': LS_BASE.width, opacity: LS_BASE.opacity,
          'vector-effect': 'non-scaling-stroke'
        }, worldG);
        linesByAng[a].push(line);
        allLines.push(line);
      });
    });

    // AABB boundary lines (x/y slabs, 2 pairs = 4 segments), ink like
    // L2's AABB — INVISIBLE at base (opacity 0) for kdopintro parity;
    // faded in only while the AABB candidate is on stage, receded after.
    // Same margin-rect clipping + non-scaling-stroke as the fan.
    aabbLines = [];
    [slabs[0], slabs[90]].forEach(function (s) {
      [s.lo, s.hi].forEach(function (m) {
        var pt = [s.n[0] * m, s.n[1] * m];
        var t = perp(s.n);
        var seg = clipSegRect(
          [pt[0] - 2000 * t[0], pt[1] - 2000 * t[1]],
          [pt[0] + 2000 * t[0], pt[1] + 2000 * t[1]],
          RECT
        );
        if (!seg) return;
        var line = D.el('line', {
          x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1],
          stroke: D.INK, 'stroke-width': LS_BASE.width, opacity: 0,
          'vector-effect': 'non-scaling-stroke'
        }, worldG);
        aabbLines.push(line);
        allLines.push(line);
      });
    });

    // triangles — same non-scaling-stroke treatment for their CSS 1.2
    // ink edges (vector-effect is an attribute here, not a CSS rule, so
    // it survives the deck.css paint rules; at z=1 rendering is
    // identical to kdopintro's)
    tris.forEach(function (tri) {
      D.el('polygon', {
        'class': 'svg-tri', points: pts2str(tri),
        'vector-effect': 'non-scaling-stroke'
      }, worldG);
    });

    // k-DOP: intersection of all 12 half-planes, construction identical
    // to kdopintro (margin-rect seed, per-direction extents, dedupe) so
    // the outline matches its final frame exactly. Solid ink 2.2, no
    // dash — it must read as the SAME polygon across the slide fade.
    var kdop = [
      [RECT.x0, RECT.y0], [RECT.x1, RECT.y0],
      [RECT.x1, RECT.y1], [RECT.x0, RECT.y1]
    ];
    for (i = 0; i < FAN_N; i++) {
      var ak = FAN_OFF + i * 30;
      var nk = [Math.cos(rad(ak)), Math.sin(rad(ak))];
      var ek = slabExtents(pts, nk);
      kdop = clipHalf(kdop, nk, ek[1]);
      kdop = clipHalf(kdop, [-nk[0], -nk[1]], -ek[0]);
    }
    kdopPts = dedupe(kdop);
    kdopEl = D.el('polygon', {
      points: pts2str(kdopPts),
      fill: 'none', stroke: D.INK, 'stroke-width': 2.2,
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke'
    }, worldG);

    // candidate parallelograms, descending area
    candidates = CANDIDATES.map(function (pair) {
      var corners = pairCorners(slabs[pair[0]], slabs[pair[1]]);
      return { a: pair[0], b: pair[1], corners: corners, area: polyArea(corners) };
    });

    // slab-intersection strips for the winning pair: soft teal + amber
    // fills in an isolated group, each plus-lighter, so their additive
    // overlap — and only the overlap — is the SOBB. Blend/isolation are
    // static inline styles; GSAP animates only the group opacity attr.
    stripsG = D.el('g', {
      style: 'isolation:isolate', opacity: 0,
      'clip-path': 'url(#' + CLIP_ID + ')'
    }, worldG);
    [[100, D.TEAL], [160, D.AMBER]].forEach(function (cfg) {
      D.el('polygon', {
        points: pts2str(stripPoly(slabs[cfg[0]], FRAME)),
        fill: cfg[1], 'fill-opacity': 0.24,
        style: 'mix-blend-mode: plus-lighter'
      }, stripsG);
    });

    // the candidate parallelogram: neutral fill + thin dashed ink so
    // the shape change reads while the slab colors come from the lines.
    // Fill 0.09 (not 0.05): splits the active candidate's tone from the
    // #edf0f7 triangle fills beneath it, same ink family, still light.
    // Invisible at entry, so world-unit width/dash are /Z-compensated
    // (screen: 1.3 wide, 5/4 dash) instead of non-scaling-stroke.
    candEl = D.el('polygon', {
      points: pts2str(candidates[0].corners),
      fill: D.INK, 'fill-opacity': 0.09,
      stroke: D.INK, 'stroke-width': 1.3 / ZOOM,
      'stroke-dasharray': (5 / ZOOM) + ' ' + (4 / ZOOM),
      'stroke-linejoin': 'round',
      opacity: 0,
      'clip-path': 'url(#' + CLIP_ID + ')'
    }, worldG);

    // the SOBB outline: swept on at s3 via stroke-dashoffset;
    // getTotalLength is in local units, unaffected by the world zoom.
    // Same /Z width trick — invisible at entry, dash sweep math stays
    // in local units (screen weight: 2.2 at end zoom).
    sobbEl = D.el('polygon', {
      points: pts2str(candidates[SOBB_INDEX].corners),
      fill: 'none',
      stroke: D.INK, 'stroke-width': 2.2 / ZOOM, 'stroke-linejoin': 'round',
      opacity: 0
    }, worldG);
    // Round to 6dp: at the label stop GSAP re-serializes the dashoffset
    // start value with 6-decimal precision when approached backward,
    // while forward it stays the untouched initial attribute. Rounding
    // here makes both directions bit-identical.
    sobbPathLen = Math.round(sobbEl.getTotalLength() * 1000000) / 1000000;
    sobbEl.setAttribute('stroke-dasharray', sobbPathLen);
    sobbEl.setAttribute('stroke-dashoffset', sobbPathLen);

    // ---- text, all OUTSIDE the world group (never scales) ----

    // entry label: EXACTLY kdopintro's final frame (748, 88, class).
    // Crossfaded to the new label during the zoom-out entrance.
    labelOldEl = D.text('K-DOP = SLAB PAIRS', {
      'class': 'svg-side-label', x: 748, y: 88
    }, svg);

    // permanent label, stacked in two lines so it stays inside the
    // right margin (~190px and ~150px wide from x=748)
    labelNewG = D.el('g', { opacity: 0 }, svg);
    D.text('SOBB = SLAB PAIRS (2D)', {
      'class': 'svg-side-label', x: 748, y: 88
    }, labelNewG);
    D.text('SLAB TRIPLETS (3D)', {
      'class': 'svg-side-label', x: 748, y: 108
    }, labelNewG);

    // candidate tags: ONLY the two named beats carry text — the axis
    // pair "AABB", the orthogonal pair "OBB". The fan candidates and
    // the final SOBB get no label (morph + slab highlights carry the
    // beat). Tags anchor above their shape, screen-space (toScreen) so
    // they never scale with the world zoom. Timeline behaviour: each
    // tag lands with its candidate's morph, then PERSISTS at full
    // opacity until the next tag replaces it (AABB → OBB hand-off;
    // OBB goes out as the SOBB morph lands, with no successor).
    candTagEls = [];
    candTagAt = {};
    [AABB_INDEX, OBB_INDEX].forEach(function (i) {
      var ci = candidates[i];
      var anchor;
      if (i === AABB_INDEX) {
        // AABB is a rectangle: anchor above the midpoint of the top
        // edge (the two corners sharing min y), not above a corner
        // like the pointed candidates — else the tag overlaps the
        // top line
        var ac = ci.corners;
        var acMinY = Math.min(ac[0][1], ac[1][1], ac[2][1], ac[3][1]);
        var acTop = ac.filter(function (p) { return Math.abs(p[1] - acMinY) < 0.01; });
        anchor = [(acTop[0][0] + acTop[1][0]) / 2, acMinY];
      } else {
        anchor = topmost(ci.corners);
      }
      var s = toScreen(anchor);
      var el = D.text(i === AABB_INDEX ? 'AABB' : 'OBB', {
        x: s[0], y: s[1] - 12, 'text-anchor': 'middle',
        fill: i === OBB_INDEX ? D.BLUE : D.INK,
        'font-size': 15, 'font-weight': 600, opacity: 0
      }, svg);
      candTagEls.push(el);
      candTagAt[i] = el;
    });

    promiseEl = document.getElementById('kdop-promise');
    updateWorld();
    built = true;
  }

  function applyLineState(ang, st) {
    linesByAng[ang].forEach(function (l) {
      l.setAttribute('opacity', st.opacity);
      l.setAttribute('stroke-width', st.width);
    });
  }

  function resetState() {
    gsap.killTweensOf(allLines);
    gsap.killTweensOf([kdopEl, candEl, sobbEl, stripsG, promiseEl]);
    gsap.killTweensOf(candTagEls);
    // entrance tweens: kill before re-armering any start() path
    gsap.killTweensOf(proxy);
    gsap.killTweensOf([labelOldEl, labelNewG]);
    proxy.z = 1;
    updateWorld();
    labelOldEl.setAttribute('opacity', 1);
    labelNewG.setAttribute('opacity', 0);
    PAIR_ANGLES.forEach(function (ang) { applyLineState(ang, LS_BASE); });
    aabbLines.forEach(function (l) {
      l.setAttribute('opacity', 0);
      l.setAttribute('stroke-width', LS_BASE.width);
    });
    kdopEl.setAttribute('opacity', 1);
    candEl.setAttribute('points', pts2str(candidates[0].corners));
    candEl.setAttribute('opacity', 0);
    sobbEl.setAttribute('opacity', 0);
    sobbEl.setAttribute('stroke-dashoffset', sobbPathLen);
    candTagEls.forEach(function (t) { t.setAttribute('opacity', 0); });
    stripsG.setAttribute('opacity', 0);
    promiseEl.textContent = PROMISE_TEXT;
    gsap.set(promiseEl, { opacity: 0 });
  }

  /* One tween per pair per step, active or dim — never both — so
   * consecutive candidates that share a slab never fight over lines. */
  function tweenPairStates(activeA, activeB, at, dur) {
    PAIR_ANGLES.forEach(function (ang) {
      var active = (ang === activeA || ang === activeB);
      tl.to(linesByAng[ang], {
        attr: active
          ? { opacity: LS_ACTIVE.opacity, 'stroke-width': LS_ACTIVE.width }
          : { opacity: LS_DIM.opacity, 'stroke-width': LS_DIM.width },
        duration: dur, ease: 'power1.out'
      }, at);
    });
  }

  function buildTimeline() {
    tl = gsap.timeline({ paused: true });
    var i, tau;

    // ---- section 1 (0 → s1): first candidate (10/40, the biggest) ----
    var c0 = candidates[0];
    tweenPairStates(c0.a, c0.b, 0, 0.7);
    tl.to(kdopEl, { attr: { opacity: 0.35 }, duration: 0.7 }, 0);
    tl.to(candEl, { attr: { opacity: 1 }, duration: 0.7, ease: 'power1.out' }, 0.15);
    // no tag: the first candidate is a fan pair, unlabeled by design
    tl.addLabel('s1', 1.0);

    // ---- section 2 (s1 → s2): the search over the remaining
    // candidates, descending area — deliberately slow: 1.2s morphs,
    // 0.5s holds (~1.5-2x the previous 0.7/0.3), an 0.8s hold on the
    // AABB (its ink lines fade in/out around the beat) and a 1.0s hold
    // on the OBB so both tags land and hold at rest.
    // 5 morphs + 5 holds: s1→s2 = 9.5s. ----
    var MORPH = 1.2, HOLD = 0.5, AABB_HOLD = 0.8, OBB_HOLD = 1.0;
    tau = 1.0 + 0.2;                     // first morph shortly after s1
    for (i = 1; i < candidates.length; i++) {
      var ci = candidates[i];
      var aabbNow = isAabbPair([ci.a, ci.b]);
      var aabbPrev = isAabbPair([candidates[i - 1].a, candidates[i - 1].b]);
      // AABB step: no fan pair is active — all six recede; the ink
      // AABB lines take the active state instead (and recede after)
      tweenPairStates(aabbNow ? -1 : ci.a, aabbNow ? -1 : ci.b, tau, 0.65);
      if (aabbNow || aabbPrev) {
        tl.to(aabbLines, {
          attr: aabbNow
            ? { opacity: LS_ACTIVE.opacity, 'stroke-width': LS_ACTIVE.width }
            : { opacity: LS_DIM.opacity, 'stroke-width': LS_DIM.width },
          duration: 0.65, ease: 'power1.out'
        }, tau);
      }
      tl.to(candEl, {
        attr: { points: pts2str(ci.corners) },
        duration: MORPH, ease: 'power2.inOut'
      }, tau);
      // tags: only AABB (i=3) and OBB (i=4) have elements. A tag fades
      // out exactly as the next candidate's morph lands — the AABB →
      // OBB hand-off, and the OBB tag going out as the final SOBB morph
      // lands (no successor: the SOBB stays unlabeled). Fan candidates
      // add no tweens at all, so nothing dead/orphaned is left behind.
      if (candTagAt[i - 1]) {
        tl.to(candTagAt[i - 1], {
          attr: { opacity: 0 }, duration: 0.3
        }, tau + MORPH - 0.1);
      }
      if (candTagAt[i]) {
        tl.to(candTagAt[i], {
          attr: { opacity: 1 }, duration: 0.3
        }, tau + MORPH - 0.1);
      }
      tau += MORPH +
        (i === OBB_INDEX ? OBB_HOLD : i === AABB_INDEX ? AABB_HOLD : HOLD);
    }
    tl.addLabel('s2', tau);

    // ---- section 3 (s2 → s3): the SOBB settles ----
    tl.to(allLines, {
      attr: { opacity: LS_GONE.opacity, 'stroke-width': LS_GONE.width },
      duration: 0.7, ease: 'power1.inOut'
    }, 's2+=0.3');
    tl.to(kdopEl, { attr: { opacity: 0.15 }, duration: 0.7 }, 's2+=0.3');
    tl.to(candEl, { attr: { opacity: 0 }, duration: 0.5 }, 's2+=0.3');
    tl.to(stripsG, { attr: { opacity: 1 }, duration: 0.8, ease: 'power1.inOut' }, 's2+=0.4');
    tl.to(sobbEl, {
      attr: { opacity: 1, 'stroke-dashoffset': 0 },
      duration: 1.1, ease: 'power2.inOut'
    }, 's2+=0.45');
    // no label: the settled SOBB (strips + outline) reads on its own
    tl.addLabel('s3', 's2+=1.65');

    // ---- section 4 (s3 → s4): promise beat (HTML caption element) ----
    tl.fromTo(promiseEl,
      { opacity: 0 },
      { opacity: 1, duration: 0.55, ease: 'power1.out', immediateRender: false },
      's3+=0.2');
    tl.addLabel('s4', 's3+=0.85');
  }

  var animator = {
    start: function (fragStep) {
      if (!built) build();
      animator.stop();
      resetState();
      buildTimeline();
      if (fragStep > 0) {
        // deep entry: snap straight to the post-entrance state
        proxy.z = ZOOM;
        updateWorld();
        labelOldEl.setAttribute('opacity', 0);
        labelNewG.setAttribute('opacity', 1);
        tl.seek(D.stopsFor(tl, 4)[fragStep], true);
      } else {
        // entrance choreography (NOT the fragment timeline), and the
        // ONLY entrance: zoom out about the cluster center while the
        // side label crossfades. No svg fade/rise — the section has
        // data-transition="none", and the first frame pixel-matches
        // kdopintro's last frame, so any pop would read as a glitch.
        gsap.to(proxy, {
          z: ZOOM, duration: 1.3, ease: 'power2.inOut',
          onUpdate: updateWorld
        });
        gsap.to(labelOldEl, {
          attr: { opacity: 0 }, duration: 0.65, ease: 'power1.inOut', delay: 0.3
        });
        gsap.to(labelNewG, {
          attr: { opacity: 1 }, duration: 0.65, ease: 'power1.inOut', delay: 0.55
        });
      }
    },

    step: function (fragStep) {
      if (!tl) return;
      tl.tweenTo(D.stopsFor(tl, 4)[fragStep], { ease: 'none' });
    },

    stop: function () {
      if (tl) { tl.kill(); tl = null; }
      gsap.killTweensOf(proxy);
      gsap.killTweensOf([labelOldEl, labelNewG]);
    }
  };

  // expose pure geometry + tag state for headless smoke/probe tests
  animator._test = {
    kdopPts: function () { return kdopPts; },
    sobbCorners: function () { return candidates[SOBB_INDEX].corners; },
    candidates: function () { return candidates; },
    zoom: function () { return ZOOM; },
    tags: function () { return candTagEls; },   // [AABB, OBB] only
    tl: function () { return tl; }
  };

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.kdopfan = animator;
})();
