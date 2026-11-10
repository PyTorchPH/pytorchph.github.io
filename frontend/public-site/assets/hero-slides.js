// Crossfades the hero background photos (see _includes/ph/hero.html and _data/photo_credits.yml).
//
// The first photo is part of the page. After the page has loaded, the others are downloaded at the
// size the screen uses and decoded; the crossfade starts only then, so it never fades to an empty
// frame, and a photo that fails to load is left out. Visitors who prefer reduced motion keep the
// first photo, and the crossfade stops if they switch that preference on. The "Pause photos" button
// stops and resumes it (WCAG 2.2.2), and it does not advance while the tab is hidden.
(() => {
  const root = document.querySelector("[data-hero-slides]");
  const toggle = document.querySelector("[data-hero-slides-toggle]");
  if (!root || !toggle) return;
  const slides = [...root.querySelectorAll(".ph-hero-slide")];
  if (slides.length < 2) return;

  const SHOW_MS = 7000; // time each photo stays before the next fades in (the fade is 1.6 s, in CSS)
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wide = window.matchMedia("(min-width: 768px)"); // the `desktop` breakpoint in _sass/_variables.scss
  let rotation = [slides[0]];
  let current = 0;
  let timer = 0;
  let paused = false;
  let started = false;

  const show = index => {
    rotation[current].classList.remove("is-active");
    current = index;
    rotation[current].classList.add("is-active");
  };
  const schedule = () => {
    window.clearTimeout(timer);
    if (paused || reducedMotion.matches || rotation.length < 2) return;
    timer = window.setTimeout(() => {
      if (!document.hidden) show((current + 1) % rotation.length);
      schedule();
    }, SHOW_MS);
  };
  const label = () => { toggle.textContent = paused ? "Play photos" : "Pause photos"; };

  const load = slide => new Promise(resolve => {
    const image = new Image();
    image.onload = () => (image.decode ? image.decode() : Promise.resolve()).then(() => resolve(true), () => resolve(true));
    image.onerror = () => resolve(false);
    image.src = wide.matches ? slide.dataset.image : slide.dataset.imagePortrait;
  });

  async function start() {
    if (started || reducedMotion.matches) return;
    started = true;
    const loaded = await Promise.all(slides.slice(1).map(load));
    rotation = [slides[0], ...slides.slice(1).filter((_, index) => loaded[index])];
    if (rotation.length < 2 || reducedMotion.matches) { started = false; return; }
    root.classList.add("is-playing");
    toggle.hidden = false;
    label();
    schedule();
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    label();
    schedule();
  });

  reducedMotion.addEventListener?.("change", () => {
    if (reducedMotion.matches) {
      window.clearTimeout(timer);
      toggle.hidden = true;
    } else if (started) {
      toggle.hidden = false;
      schedule();
    } else {
      start();
    }
  });

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
