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

  /* Slide number is hidden on the title slide only. reveal's slide-number
     module writes inline display:block on the element, so deck.css hides
     it via a .hide-number class with !important. */
  function syncSlideNumber() {
    var sn = document.querySelector('.slide-number');
    if (sn) sn.classList.toggle('hide-number', Reveal.getIndices().h === 0);
  }

  Reveal.initialize({
    width: 1280,
    height: 720,
    margin: 0.04,
    hash: true,
    center: false,
    /* Reveal's slideContent.load() writes this value as an INLINE
       display style on every loaded slide — an inline style beats any
       stylesheet display rule, so the config value itself must be flex
       for the fixed-chrome flex column in deck.css to apply. */
    display: 'flex',
    slideNumber: 'c/t',
    controls: false,
    progress: true,
    transition: 'fade',
    transitionSpeed: 'default',
    fragments: true
  }).then(function () {
    enter(Reveal.getCurrentSlide());
    syncSlideNumber();
  });

  Reveal.on('slidechanged', function (event) {
    leave(event.previousSlide);
    enter(event.currentSlide);
    syncSlideNumber();
  });

  Reveal.on('fragmentshown', function () {
    step(Reveal.getCurrentSlide());
  });

  Reveal.on('fragmenthidden', function () {
    step(Reveal.getCurrentSlide());
  });
})();
