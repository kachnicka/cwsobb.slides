/* Related-work slide animator — auto-advance the four research-line
 * fragments on slide entry; the fifth ("this work") stays manual.
 *
 * Registered as DeckAnimators.related for #slide-related. deck.js calls:
 *   start(fragStep) on slide entry, step(fragStep) on fragment show/hide,
 *   stop() on leaving the slide.
 *
 * Auto-advance drives the SAME Reveal fragments a presenter would
 * (Reveal.next()), so progress/hash/fragment events stay consistent.
 * It yields to the user: any manual backward step cancels pending
 * timers, and each timer re-checks the live fragment count so a fast
 * forward press cannot overshoot into the next slide.
 */
(function () {
  'use strict';

  var timers = [];
  var lastCount = 0;

  /* Number of fragments the auto-run may reveal (everything except
   * "this work", the last fragment on the slide). */
  var AUTO_STEPS = 4;

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  function advance() {
    var slide = document.getElementById('slide-related');
    if (!slide || Reveal.getCurrentSlide() !== slide) return;
    /* Re-check the live count: if the user already got here (or further),
     * do nothing — never let a stale timer push past AUTO_STEPS or,
     * worse, into the next slide. */
    var visible = slide.querySelectorAll('.fragment.visible').length;
    if (visible < AUTO_STEPS) Reveal.next();
  }

  window.DeckAnimators = window.DeckAnimators || {};
  window.DeckAnimators.related = {
    start: function (fragStep) {
      clearTimers();
      lastCount = fragStep;
      /* Already at (or past) the manual step: nothing to automate. */
      if (fragStep >= AUTO_STEPS) return;
      var delay = 700; /* let the slide transition settle first */
      for (var f = fragStep; f < AUTO_STEPS; f++) {
        (function (d) {
          timers.push(setTimeout(advance, d));
        })(delay);
        delay += 550;
      }
    },

    step: function (fragStep) {
      /* Count went down → the user stepped backward: cancel the
       * auto-run and hand over full control. */
      if (fragStep < lastCount) clearTimers();
      lastCount = fragStep;
    },

    stop: function () {
      clearTimers();
    }
  };
})();
