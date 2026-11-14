// The moving parts of an event's page. All of them compare with Philippine time, as the page states
// its dates, and without this script the page reads the same, only still.
(() => {
  const manilaDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

  // The countdown under the hero ([data-countdown], an ISO date and time: the event's start, or the
  // start of its day in the Philippines when no time is stated): weeks, days, hours, minutes and
  // seconds, each ring filled by its share. It hides once that moment has come. People who ask for
  // less motion get no seconds ring, so the row changes once a minute at most.
  const countdown = document.querySelector("[data-countdown]");
  const show = (name, value, of) => {
    const node = countdown.querySelector(`[data-unit="${name}"]`);
    if (!node || node.textContent === String(value)) return;
    node.textContent = String(value);
    node.parentElement.style.setProperty("--part", String(Math.min(value / of, 1)));
  };
  const count = () => {
    const target = Date.parse(countdown?.dataset.countdown ?? "");
    if (!Number.isFinite(target)) return false;
    let left = Math.floor((target - Date.now()) / 1000);
    countdown.hidden = !(left > 0);
    if (countdown.hidden) return false;
    for (const [name, size, of] of [["weeks", 604800, 52], ["days", 86400, 7], ["hours", 3600, 24], ["minutes", 60, 60], ["seconds", 1, 60]]) {
      const value = Math.floor(left / size);
      left -= value * size;
      show(name, value, of);
    }
    return true;
  };
  if (countdown && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const seconds = countdown.querySelector('[data-unit="seconds"]')?.closest("li");
    if (seconds) seconds.hidden = true;
  }
  if (count()) {
    const timer = setInterval(() => { if (!count()) clearInterval(timer); }, 1000);
  }

  // What depends on the day. Dates to remember (.ph-key-dates): the ones that have passed step back
  // with a check mark in place of the chevron, and the next one is tagged "Next": in shapes and words,
  // not by color alone. A date stays next through its own day.
  // Gates ([data-gate], with data-opens and data-closes): a button that leads somewhere only during
  // a window, as the home page's tile does for the call for proposals. Outside the window the
  // button gives way to a plain label (data-before, data-after), or to nothing where there is none:
  // "Registration not yet open", "Registration closed", "CFP closed".
  const mark = today => {
    let next = false;
    document.querySelectorAll(".ph-key-dates li").forEach(item => {
      const day = item.querySelector("time")?.getAttribute("datetime");
      if (!isDay(day)) return;
      item.querySelectorAll("[data-date-note]").forEach(note => note.remove());
      const past = day < today, upcoming = !past && !next;
      if (upcoming) next = true;
      item.classList.toggle("is-past", past);
      item.classList.toggle("is-next", upcoming);
      if (!past && !upcoming) return;
      const note = document.createElement("span");
      note.dataset.dateNote = "";
      note.className = past ? "ph-visually-hidden" : "ph-date-tag";
      note.textContent = past ? " (passed)" : "Next";
      item.append(note);
    });
    document.querySelectorAll("[data-gate]").forEach(node => {
      const before = isDay(node.dataset.opens) && today < node.dataset.opens;
      const after = isDay(node.dataset.closes) && today > node.dataset.closes;
      const label = before ? node.dataset.before : after ? node.dataset.after : "";
      node.querySelectorAll("a").forEach(link => { link.hidden = before || after; });
      let chip = node.querySelector(".ph-event-chip");
      if (label && !chip) {
        chip = document.createElement("span");
        chip.className = "ph-event-chip";
        node.append(chip);
      }
      if (chip) { chip.textContent = label || ""; chip.hidden = !label; }
      node.hidden = (before || after) && !label;
    });
  };
  // Kept current while the page stays open: checked again twice a minute and when the tab returns.
  let marked = null;
  const refresh = () => {
    const today = manilaDay();
    if (today === marked) return;
    marked = today;
    mark(today);
  };
  refresh();
  setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); count(); } });

  // The section menu: the site's anchor script scrolls to a section but leaves keyboard focus in the
  // menu, so the section takes focus here and Tab goes on from what was just opened.
  document.querySelectorAll('.ph-cfp-nav a[href^="#"]').forEach(link => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (!target) return;
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });
})();
