/* The header over the home page hero, after PyTorch Korea's (pytorch.kr): a light tint over the photo
   at the top of the page, where a dark band in the photo (ph.scss) keeps the white menu readable.
   Once the page scrolls, that band moves away and anything can pass behind the menu (the headline,
   white sections), so the header is at least READABLE opaque, enough to keep white text at 4.5:1 over
   pure white with some margin (#262626 at 0.68 over white is about 5.3:1), and darkens to solid as
   the hero scrolls away. The tint is the --ph-header-alpha custom property; without this script a <noscript>
   style in head.html keeps the header solid. */
(() => {
  "use strict";
  const header = document.querySelector(".ph-header");
  const hero = document.querySelector(".ph-hero");
  if (!header || !hero) return;
  const LIGHT = 0.165;
  const READABLE = 0.68;
  let queued = false;

  function update() {
    queued = false;
    const travel = hero.offsetHeight - header.offsetHeight;
    const progress = travel > 0 ? Math.min(1, window.scrollY / travel) : 1;
    const alpha = window.scrollY < 1 ? LIGHT : READABLE + (1 - READABLE) * progress;
    header.style.setProperty("--ph-header-alpha", alpha.toFixed(3));
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  update();
})();
