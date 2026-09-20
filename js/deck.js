/* Deck wiring: reveal.js init + animator dispatch.
 *
 * Each animated slide declares data-animator="name" and registers an
 * animator object at window.DeckAnimators[name] with:
 *   start(fragStep) — enter slide; build/reset state, sync to fragStep
 *   step(fragStep)  — fragment count changed (forward or backward)
 *   stop()          — leave slide; kill timelines
 * fragStep = number of visible fragments on the current slide.
 */
(function () {
  'use strict';

  /* ---------- tiny entrance animators (title / closing) ---------- */

  function makeEntranceAnimator(selector, opts) {
    var played = false;
    return {
      start: function () {
        var lines = document.querySelectorAll(selector + ' .t-line');
        if (!lines.length) return;
        gsap.killTweensOf(lines);
        gsap.fromTo(lines,
          { opacity: 0, y: 26 },
          {
            opacity: 1, y: 0, duration: 0.8, ease: 'power3.out',
            stagger: 0.14, overwrite: 'auto',
            delay: played ? 0 : (opts && opts.firstDelay) || 0.15
          });
        var rule = document.querySelector(selector + ' .rule');
        if (rule) {
          gsap.fromTo(rule,
            { scaleX: 0 },
            { scaleX: 1, duration: 0.9, ease: 'power2.inOut', delay: 0.5, overwrite: 'auto' });
        }
        played = true;
      },
      step: function () {},
      stop: function () {
        var lines = document.querySelectorAll(selector + ' .t-line');
        gsap.killTweensOf(lines);
      }
    };
  }

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.title = makeEntranceAnimator('#slide-title');
  window.DeckAnimators.closing = makeEntranceAnimator('#slide-thanks', { firstDelay: 0 });

  /* ---------- dispatch ---------- */

  function animatorFor(slide) {
    if (!slide) return null;
    var name = slide.getAttribute('data-animator');
    return (name && window.DeckAnimators[name]) || null;
  }

  function fragCount(slide) {
    return slide ? slide.querySelectorAll('.fragment.visible').length : 0;
  }

  function enter(slide) {
    var a = animatorFor(slide);
    if (a && a.start) a.start(fragCount(slide));
  }

  function leave(slide) {
    var a = animatorFor(slide);
    if (a && a.stop) a.stop();
  }

  function step(slide) {
    var a = animatorFor(slide);
    if (a && a.step) a.step(fragCount(slide));
  }

  Reveal.initialize({
    width: 1280,
    height: 720,
    margin: 0.04,
    hash: true,
    center: true,
    controls: false,
    progress: true,
    transition: 'fade',
    transitionSpeed: 'default',
    fragments: true
  }).then(function () {
    enter(Reveal.getCurrentSlide());
  });

  Reveal.on('slidechanged', function (event) {
    leave(event.previousSlide);
    enter(event.currentSlide);
  });

  Reveal.on('fragmentshown', function () {
    step(Reveal.getCurrentSlide());
  });

  Reveal.on('fragmenthidden', function () {
    step(Reveal.getCurrentSlide());
  });
})();
