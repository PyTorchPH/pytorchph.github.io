/* Campus Labs directory (_includes/ph/campus_directory.html): everyone in alphabetical order, a
   filter by island group, and a search by name or university. site-content.js renders the chapters
   officers publish into its chapters-<island> targets on every load and refresh, and hides listed
   entries they replace; after each render this script moves those cards into the one list and
   reorders it, so the page reads (also with a screen reader) in the order it shows. Never interprets
   text as HTML. */
(() => {
  "use strict";
  const grid = document.querySelector("[data-campus-directory]");
  const list = grid?.querySelector("[data-campus-list]");
  const tools = document.querySelector("[data-campus-filters]");
  if (!grid || !list || !tools) return;
  const search = tools.querySelector("[data-campus-search]");
  const count = document.querySelector("[data-campus-count]");
  const none = document.querySelector("[data-campus-none]");
  const collator = new Intl.Collator("en-PH", { sensitivity: "base" });
  let island = "";

  // Case, accents, and spacing do not matter: "mapua" finds "Mapúa University".
  const fold = value => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-PH").replace(/\s+/g, " ").trim();
  const nameOf = card => card.querySelector(".ph-lead-name")?.textContent.trim() ?? "";
  const isInvite = card => card.classList.contains("ph-lead-invite");
  const isPerson = card => !isInvite(card) && !card.classList.contains("ph-lead-pending");
  const cards = () => [...list.children].filter(node => node.classList.contains("ph-lead"));

  // Published cards arrive in the chapters-<island> targets, freshly built on every render: they
  // replace the ones moved into the list before (so withdrawn chapters leave), and take the list's
  // heading level.
  function collect() {
    const arrivals = [...grid.querySelectorAll("[data-site-content^='chapters-'] > .ph-lead")];
    list.querySelectorAll(":scope > [data-published]").forEach(card => card.remove());
    for (const card of arrivals) {
      card.dataset.island = card.parentElement.dataset.island;
      card.dataset.published = "";
      const name = card.querySelector("h4.ph-lead-name");
      if (name) {
        const heading = document.createElement("h3");
        heading.className = name.className;
        heading.append(...name.childNodes);
        name.replaceWith(heading);
      }
      list.append(card);
    }
  }

  // One alphabetical order; "start the first one" invitations go last. Moves cards only when the
  // order changed, and keeps keyboard focus where it was.
  function sort() {
    const current = cards();
    const sorted = [...current].sort((a, b) => (isInvite(a) - isInvite(b)) || collator.compare(nameOf(a), nameOf(b)));
    if (sorted.every((card, index) => card === current[index])) return;
    const focused = document.activeElement;
    sorted.forEach(card => list.append(card));
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  function filter() {
    const query = fold(search.value);
    const people = new Map();
    let shownPeople = 0;
    let shownCards = 0;
    // Cards site-content.js hid (a listed entry that gave way to the same published university) stay hidden.
    for (const card of cards().filter(node => !node.hidden)) {
      const where = card.dataset.island;
      if (isPerson(card)) people.set(where, (people.get(where) ?? 0) + 1);
      const matches = (!island || where === island) && (isInvite(card) ? !query : !query || fold(card.textContent).includes(query));
      card.toggleAttribute("data-filtered-out", !matches);
      if (matches) shownCards++;
      if (matches && isPerson(card)) shownPeople++;
    }
    document.querySelectorAll("[data-island-people]").forEach(node => { node.textContent = String(people.get(node.dataset.islandPeople) ?? 0); });
    document.querySelectorAll("button[data-island-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.islandFilter === island)));
    count.textContent = `Showing ${shownPeople} ${shownPeople === 1 ? "person" : "people"}`;
    none.hidden = shownCards > 0;
    // A control that just disappeared (a filtered card's link, the no-match "Clear filters") hands
    // keyboard focus to the search instead of dropping it.
    const active = document.activeElement;
    if (active instanceof HTMLElement && (grid.contains(active) || none.contains(active)) && !active.getClientRects().length) search.focus({ preventScroll: true });
  }

  function update() {
    collect();
    sort();
    filter();
  }

  function choose(value, { reveal = false } = {}) {
    island = value;
    filter();
    if (reveal) grid.closest("section")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // Links to an island group (/campus-labs/#campus-luzon) filter the list to it.
  function linkedIsland() {
    const match = /^#campus-(luzon|visayas|mindanao)$/.exec(location.hash.toLowerCase());
    return match ? match[1][0].toUpperCase() + match[1].slice(1) : null;
  }

  // Island buttons, and the island labels on the map (which also bring the list into view).
  document.addEventListener("click", event => {
    const target = event.target.closest("[data-island-filter]");
    if (target) choose(target.dataset.islandFilter, { reveal: !target.matches("button") });
  });
  document.querySelectorAll("[data-campus-clear]").forEach(button => button.addEventListener("click", () => {
    search.value = "";
    choose("");
    search.focus();
  }));
  search.addEventListener("input", filter);
  document.addEventListener("site-content:rendered", update);
  // An island link filters; going back to the address without a fragment shows everyone again, as a
  // reload would. Other in-page links (#start) leave the filter alone.
  window.addEventListener("hashchange", () => {
    const linked = linkedIsland();
    if (linked) choose(linked, { reveal: true });
    else if (!location.hash) choose("");
  });

  const linked = linkedIsland();
  island = linked ?? "";
  tools.hidden = false;
  count.hidden = false;
  update();
  if (linked) grid.closest("section")?.scrollIntoView();
})();
