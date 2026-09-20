# AGENTS.md — cwsobb.slides

Reveal.js 6 slide deck. No build system, no package manager, no tests. Static `index.html` + browser JS + GSAP. Serve or open directly; verify in browser.

## Layout
- `index.html` — slides, one `<section>` per slide.
- `js/` — `common.js` (DeckSVG helpers, one sanctioned global), one animator module per animated slide, `deck.js` (Reveal init + event dispatch) loads last.
- `css/deck.css` — single theme + layout file.
- `vendor/` — reveal.js 6, gsap. Never edit.

## Rules
- Plain ES5-style IIFEs, no modules, no bundler. Keep it that way.
- New animated slide: add `<section data-animator="name">` + empty `<span class="fragment">` per step; register `window.DeckAnimators[name]` with `start(fragStep)` / `step(fragStep)` / `stop()`; build SVG lazily on first `start()`; sync GSAP timeline to fragment labels `s1..sN` via `DeckSVG.stopsFor`.
- Slide layout is a fixed flex chrome, not per-slide centering: every content section is a flex column — `.slide-head` pinned top, caption footer pinned bottom, middle region `flex: 1; min-height: 0`. Sections are pinned to the 1280×720 logical space in CSS (Reveal transform-scales it to any screen). Title/closing slides re-center via `justify-content`.
- `display: 'flex'` in `Reveal.initialize` is load-bearing — Reveal writes it as an inline style on each loaded slide. Never add a CSS display rule for sections (un-hides hidden slides) and never `!important` on section display (fights Reveal's inline display management).
- Canvas sizing is fluid: animators build `<svg>` with a `viewBox` and `width/height: '100%'`; host divs get their definite size from the flex slot (definite before the lazy SVG build, so no post-build shift). Never pin px sizes on hosts or SVGs — px stacks overflow the 720 logical px and clip.
- Generated or randomized diagram geometry (point clouds, padded boxes, rotated corners) must be normalized to fit inside its `viewBox` with margin — SVG clips at the viewBox edge silently.
- Vendor theme CSS (`.reveal h2`, `.reveal p`, `.reveal ol`, …) outranks bare class selectors in `deck.css`. Lift specificity (`.reveal .slides .foo`) for rules that touch tag-styled elements, and never place a comment between selector tokens — it silently parses into a dead descendant-chain selector.
- GSAP-animated SVG paint properties (stroke, fill, opacity...) = SVG attributes, never CSS rules. CSS beats presentation attributes, freezes tweens. Only never-animated paint props go in CSS.
- Edit only `index.html`, `js/*.js`, `css/*.css`. Keep JS globals limited to `DeckSVG` and `DeckAnimators`.

## Verification
No test suite in-repo. A layout harness lives outside the repo (`../cwsobb.slides-tools/`, Playwright + headless Chromium): `node verify.mjs` checks chrome position, overflow, viewport fit at three aspect ratios and dumps per-slide screenshots to `shots/`. Run it after any layout change. Layout passes still don't cover animation feel — finish with a browser pass: step through every slide forward and backward, check fragments and transitions.

## Repository Map

A locally generated `codemap.md` (root + per-folder) may exist, state in `.slim/codemap.json`. It is local tooling output, not part of the repo. If present, consult it for orientation; if absent, this file plus the source tree is the reference.
