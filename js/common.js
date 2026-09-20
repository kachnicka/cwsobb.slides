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

  window.DeckSVG = {
    NS: NS,
    el: el, text: text,
    aabb: aabb, inflate: inflate, union: union, setRect: setRect,
    stopsFor: stopsFor,
    BLUE: '#1f6fe5',
    RED: '#d93636',
    INK: '#14161a',
    EDGE: '#d4d8e0',
    FAINT: '#9aa1ad',
    LIGHT: '#edf0f7'
  };
})();
