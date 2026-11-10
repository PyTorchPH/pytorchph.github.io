// Crossfades the hero background photos (see _includes/ph/hero.html and _data/photo_credits.yml).
//
// The first photo is part of the page. After the page has loaded, the others are downloaded at the
// size the screen uses (wide or portrait) and decoded; the crossfade starts only then, so it never
// fades to an empty frame, and a photo that fails to load is left out. If the screen crosses the
// breakpoint later, every slide keeps the photo it has until the other size has loaded, and the
// crossfade waits for that too.
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
  let generation = 0; // only the latest preparation may change what shows
  let timer = 0;
  let started = false;
  const hasImage = new Set(); // slides whose photo has loaded at some size
  const place = (slide, key) => {
    slide.style.backgroundImage = `url("${slide.dataset[key]}")`;
    hasImage.add(slide);
  };
  // Pin the first photo at its current size, so the stylesheet's breakpoint switch cannot blank it
  // before a new size has loaded (also for visitors who prefer reduced motion).
  slides[0].style.backgroundImage = `url("${slides[0].dataset[variant()]}")`;

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
  // Loads every photo at the size the screen uses, then sets each loaded one as its slide's
  // background. Until then the slides keep the photos they show, so crossing the breakpoint never
  // blanks the photo on screen (the stylesheet only places the first photo before this runs).
  const prepare = async () => {
    const run = ++generation;
    const key = variant();
    usable[key] ??= Promise.all(slides.map(slide => load(slide.dataset[key])));
    ready = false;
    window.clearTimeout(timer);
    const loaded = await usable[key];
    if (run !== generation) return; // a later preparation takes over
    slides.forEach((slide, index) => { if (loaded[index]) place(slide, key); });
    // A photo that failed at this size stays if it still shows another size; one that never
    // loaded (the first photo included) is left out.
    rotation = slides.filter(slide => hasImage.has(slide));
    if (rotation.length && !rotation.includes(active())) show(rotation[0]);
    root.classList.toggle("is-playing", rotation.length > 1);
    ready = true;
    schedule();
  };

  function start() {
    if (started || reducedMotion.matches) return;
    started = true;
    prepare();
  }

  wide.addEventListener?.("change", () => {
    if (started) { prepare(); return; }
    // Not crossfading (yet, or reduced motion): swap the first photo once its new size has loaded.
    const key = variant();
    load(slides[0].dataset[key]).then(ok => { if (ok && key === variant()) place(slides[0], key); });
  });
  reducedMotion.addEventListener?.("change", () => {
    if (!reducedMotion.matches) { if (started) schedule(); else start(); return; }
    window.clearTimeout(timer);
    show(rotation[0] ?? slides[0]);
  });

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
