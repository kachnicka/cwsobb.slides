/* Shared helpers for deck animator modules.
 * One sanctioned global: window.DeckSVG (SVG creation + 2D box math + palette).
 * Palette note: any attribute that GSAP animates (stroke, fill, opacity...)
 * must be set as an SVG ATTRIBUTE, not via CSS — CSS rules beat
 * presentation attributes and would freeze the animation.
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function text(str, attrs, parent) {
    var t = el('text', attrs, parent);
    t.textContent = str;
    return t;
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

  function inflate(b, p) {
    return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
  }

  function union(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return {
      x: x, y: y,
      w: Math.max(a.x + a.w, b.x + b.w) - x,
      h: Math.max(a.y + a.h, b.y + b.h) - y
    };
  }

  function setRect(r, b) {
    r.setAttribute('x', b.x);
    r.setAttribute('y', b.y);
    r.setAttribute('width', b.w);
    r.setAttribute('height', b.h);
  }

  /* Fragment stop times for a timeline labelled s1..sN. */
  function stopsFor(tl, count) {
    var a = [0];
    for (var i = 1; i <= count; i++) a.push(tl.labels['s' + i]);
    return a;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rad(d) { return d * Math.PI / 180; }

  /* Shared deterministic triangle cluster — L2 (sobbmorph) and L3
   * (kdopfan) MUST render the same cluster so triangle placement is
   * identical across both slides. Skewed basis: e1 at 10°, e2 at 70°,
   * 4x2 jittered grid (half-extents S=190, T=105), triangle radius 15,
   * fixed seed. n1/n2 are the SOBB frame slab normals (100° / 160°,
   * perpendicular to e1/e2) — the pair that yields the minimum-area
   * parallelogram over the k-DOP fan. */
  function makeCluster(cx, cy) {
    var rand = mulberry32(20260919);
    var e1 = [Math.cos(rad(10)), Math.sin(rad(10))];
    var e2 = [Math.cos(rad(70)), Math.sin(rad(70))];
    var S = 190, T = 105, TRI = 15;
    var tris = [];
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 2; j++) {
        var s = -S + (2 * S) * i / 3 + (rand() - 0.5) * 0.06 * S;
        var t = -T + (2 * T) * j + (rand() - 0.5) * 0.06 * T;
        var px = cx + s * e1[0] + t * e2[0];
        var py = cy + s * e1[1] + t * e2[1];
        var a0 = rand() * 2 * Math.PI;
        var rr = TRI * (0.75 + rand() * 0.5);
        var tri = [];
        for (var k = 0; k < 3; k++) {
          var a = a0 + k * 2 * Math.PI / 3;
          tri.push([px + rr * Math.cos(a), py + rr * Math.sin(a)]);
        }
        tris.push(tri);
      }
    }
    return {
      tris: tris,
      e1: e1, e2: e2,
      n1: [-e1[1], e1[0]],   // slab normal at 100°
      n2: [-e2[1], e2[0]]    // slab normal at 160°
    };
  }

  window.DeckSVG = {
    NS: NS,
    el: el, text: text,
    aabb: aabb, inflate: inflate, union: union, setRect: setRect,
    stopsFor: stopsFor, makeCluster: makeCluster,
    BLUE: '#1f6fe5',
    RED: '#d93636',
    INK: '#14161a',
    EDGE: '#d4d8e0',
    FAINT: '#9aa1ad',
    LIGHT: '#edf0f7',
    /* Slab identity colors, keyed by fan angle (k-DOP directions at
     * 10 + 30k degrees). The winning SOBB pair is 100/160 (teal/amber)
     * — sobbmorph uses the same two for its SOBB slabs. CSS vars
     * --teal/--amber in deck.css must match. */
    TEAL: '#0e9494',
    AMBER: '#e08a00',
    VIOLET: '#8d6fc4',
    ROSE: '#c25d7e',
    SLATE: '#6b7f96'
  };
})();
