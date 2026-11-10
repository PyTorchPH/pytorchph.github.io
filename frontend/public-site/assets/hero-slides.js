// Crossfades the hero background photos (see _includes/ph/hero.html and _data/photo_credits.yml).
//
// The first photo is part of the page. After the page has loaded, the others are downloaded at the
// size the screen uses (wide or portrait) and decoded; the crossfade starts only then, so it never
// fades to an empty frame, and a photo that fails to load is left out. If the screen crosses the
// breakpoint later, the crossfade waits until the other size has loaded too.
//
// Visitors who prefer reduced motion keep the first photo and get no crossfade; if they switch that
// preference on during a visit, the crossfade stops on the first photo. Nothing advances while the
// tab is hidden. There is no pause button, at the site owner's request (2026-11-10).
(() => {
  const root = document.querySelector("[data-hero-slides]");
  if (!root) return;
  const slides = [...root.querySelectorAll(".ph-hero-slide")];
  if (slides.length < 2) return;

  const SHOW_MS = 7000; // time each photo stays before the next fades in (the fade is 1.6 s, in CSS)
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wide = window.matchMedia("(min-width: 768px)"); // the `desktop` breakpoint in _sass/_variables.scss
  const variant = () => (wide.matches ? "image" : "imagePortrait");
  const usable = {}; // per variant: a promise of which slides loaded at that size
  let rotation = [slides[0]];
  let ready = false; // the current variant has loaded
  let timer = 0;
  let started = false;

  const active = () => slides.find(slide => slide.classList.contains("is-active")) ?? slides[0];
  const show = slide => {
    for (const other of slides) other.classList.toggle("is-active", other === slide);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    if (!ready || reducedMotion.matches || rotation.length < 2) return;
    timer = window.setTimeout(() => {
      if (!document.hidden) show(rotation[(rotation.indexOf(active()) + 1) % rotation.length]);
      schedule();
    }, SHOW_MS);
  };

  const load = url => new Promise(resolve => {
    const image = new Image();
    image.onload = () => (image.decode ? image.decode() : Promise.resolve()).then(() => resolve(true), () => resolve(true));
    image.onerror = () => resolve(false);
    image.src = url;
  });
  const prepare = async () => {
    const key = variant();
    usable[key] ??= Promise.all(slides.slice(1).map(slide => load(slide.dataset[key])));
    ready = false;
    window.clearTimeout(timer);
    const loaded = await usable[key];
    if (key !== variant()) return false; // the screen changed again; that call takes over
    rotation = [slides[0], ...slides.slice(1).filter((_, index) => loaded[index])];
    if (!rotation.includes(active())) show(slides[0]);
    ready = true;
    schedule();
    return true;
  };

  async function start() {
    if (started || reducedMotion.matches) return;
    started = true;
    if (!(await prepare()) || rotation.length < 2) { started = false; return; }
    root.classList.add("is-playing");
  }

  wide.addEventListener?.("change", () => { if (started) prepare(); });
  reducedMotion.addEventListener?.("change", () => {
    if (!reducedMotion.matches) { if (started) schedule(); else start(); return; }
    window.clearTimeout(timer);
    show(slides[0]);
  });

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
