/* Published community content. Never interpret officer-authored text as HTML. */
(() => {
  "use strict";
  const script = document.currentScript;
  const api = script.dataset.api;
  const defaultsUrl = script.dataset.defaults;
  const PAST_SESSION_DAYS = 120;
  let renderPeople;
  let latestEvents = [];
  const counts = new Map();

  const targets = name => [...document.querySelectorAll(`[data-site-content="${name}"]`)];
  function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
  function safeUrl(value) { if (!value) return ""; try { const url = new URL(value, /^\/public\/organization-photos\/[a-f0-9]{64}$/.test(value) ? api : location.origin); return url.protocol === "https:" || (value.startsWith("/assets/") && !value.startsWith("//")) ? url.href : ""; } catch { return ""; } }
  function image(url, label) { const src = safeUrl(url); if (!src) return null; const img = element("img"); img.src = src; img.alt = label; img.loading = "lazy"; img.width = 240; img.height = 240; img.className = "ph-managed-photo"; return img; }
  function paragraph(parent, label, value, className) { if (value) parent.append(element("p", label ? `${label}: ${value}` : value, className)); }
  function card(title, className) { const node = element("article", null, className ? `ph-card ${className}` : "ph-card"); node.append(element("h3", title)); return node; }
  function link(text, href, className) { const url = safeUrl(href); if (!url) return null; const node = element("a", text, className); node.href = url; node.rel = "noopener noreferrer"; return node; }
  function humanize(value) { const text = String(value ?? "").replace(/[_-]+/g, " ").trim(); return text ? text[0].toLocaleUpperCase("en-PH") + text.slice(1) : ""; }

  // Every published list renders into its targets. A wrapper marked data-hide-when-empty disappears
  // when its list is empty, and data-show-when-all-empty shows one shared message instead.
  function replace(name, nodes, empty) {
    counts.set(name, nodes.length);
    targets(name).forEach(target => {
      target.replaceChildren(...nodes.map(node => node.cloneNode(true)));
      if (!nodes.length && empty) target.append(element("p", empty, "ph-empty"));
      const wrapper = target.closest("[data-hide-when-empty]");
      if (wrapper) wrapper.hidden = !nodes.length;
    });
    updateSharedEmptyStates();
  }
  function updateSharedEmptyStates() {
    document.querySelectorAll("[data-show-when-all-empty]").forEach(node => {
      const names = node.dataset.showWhenAllEmpty.split(/\s+/).filter(Boolean);
      node.hidden = !names.every(key => counts.get(key) === 0);
    });
  }

  function date(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  function displayDate(value) { return date(value)?.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" }) ?? ""; }

  // Month-only schedules ("2026-11") stay upcoming through the end of that month.
  function scheduleEnd(row) {
    if (/^\d{4}-\d{2}$/.test(row.startsAt)) return new Date(Number(row.startsAt.slice(0, 4)), Number(row.startsAt.slice(5, 7)), 0, 23, 59, 59, 999);
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.startsAt)) return new Date(Number(row.startsAt.slice(0, 4)), Number(row.startsAt.slice(5, 7)) - 1, Number(row.startsAt.slice(8, 10)), 23, 59, 59, 999);
    return date(row.startsAt);
  }
  function isUpcomingSchedule(row, today) { const end = scheduleEnd(row); return !end || end >= today; }
  function scheduleDateLabel(row) { return row.scheduleLabel || (row.dateStatus === "coming_soon" ? "Coming Soon" : displayDate(row.startsAt)); }
  function startOfToday() { const today = new Date(); today.setHours(0, 0, 0, 0); return today; }
  function byStart(a, b) { return (date(a.startsAt)?.getTime() ?? Infinity) - (date(b.startsAt)?.getTime() ?? Infinity); }

  function eventCard(row) {
    const node = element("article", null, "ph-card ph-event");
    node.id = `event-${row.id}`;
    const photo = image(row.photoUrl, row.title);
    if (photo) node.append(photo);
    const when = element("p", null, "ph-event-when");
    if (row.dateStatus === "tentative") when.append(element("span", "Tentative", "ph-status"), " ");
    when.append(element("span", scheduleDateLabel(row), "ph-event-date"));
    node.append(when, element("h3", row.title));
    if (row.isDemo) node.append(element("p", "Demo/Test event — sample data", "ph-demo-label"));
    if (row.series && row.series !== row.title) paragraph(node, "", row.series, "ph-event-series");
    paragraph(node, "", row.description);
    const modules = String(row.modules || row.topic || "").split(";").map(item => item.trim()).filter(Boolean);
    if (modules.length) {
      const list = element("ul", null, "ph-event-modules");
      modules.forEach(item => list.append(element("li", item)));
      node.append(list);
    }
    const facts = [humanize(row.eventType), row.venue].filter(Boolean).join(" · ");
    paragraph(node, "", facts, "ph-event-facts");
    const registration = link("Registration details", row.registrationUrl, "ph-profile-link");
    if (registration) node.append(registration);
    return node;
  }

  function seriesButtons() { return [...document.querySelectorAll("[data-event-series]")]; }
  function selectedEventSeries() { return document.querySelector("[data-event-series][aria-pressed='true']")?.dataset.eventSeries ?? ""; }
  function selectSeries(series) { seriesButtons().forEach(button => button.setAttribute("aria-pressed", String(button.dataset.eventSeries === series))); }
  function seriesLabel(series) { return series.replace(/^PyTorch\s+/, ""); }

  // One button per published series that still has upcoming sessions, in order of the next session.
  // Existing buttons are kept (and reordered), so focus and selection survive a refresh; a focused
  // button whose series was withdrawn hands focus to "All programs".
  function syncSeriesButtons(activeSeries) {
    const key = JSON.stringify([...activeSeries]);
    document.querySelectorAll("[data-event-filters]").forEach(group => {
      if (group.dataset.series === key) return;
      group.dataset.series = key;
      const focused = group.contains(document.activeElement) ? document.activeElement : null;
      const existing = new Map([...group.querySelectorAll("[data-event-series]")].filter(button => button.dataset.eventSeries).map(button => [button.dataset.eventSeries, button]));
      for (const [series, button] of existing) if (!activeSeries.has(series)) button.remove();
      for (const series of activeSeries) {
        let button = existing.get(series);
        if (!button) {
          button = element("button", seriesLabel(series));
          button.type = "button";
          button.dataset.eventSeries = series;
          button.setAttribute("aria-pressed", "false");
        }
        group.append(button);
      }
      if (focused && document.activeElement !== focused) (focused.isConnected ? focused : group.querySelector('[data-event-series=""]'))?.focus();
    });
  }

  function renderEvents(rows) {
    latestEvents = Array.isArray(rows) ? rows : [];
    const today = startOfToday();
    const upcoming = latestEvents.filter(row => isUpcomingSchedule(row, today)).sort(byStart);
    // Offer a series filter only for series that still have upcoming sessions.
    const activeSeries = new Set(upcoming.map(row => row.series).filter(Boolean));
    const showFilters = activeSeries.size >= 2;
    const previous = selectedEventSeries();
    syncSeriesButtons(activeSeries);
    document.querySelectorAll("[data-event-filters]").forEach(group => {
      // Hiding the filter must not leave keyboard focus on a hidden button.
      if (!showFilters && group.contains(document.activeElement)) {
        const list = document.querySelector('[data-site-content="events"]');
        list?.setAttribute("tabindex", "-1");
        list?.focus({ preventScroll: true });
      }
      group.hidden = !showFilters;
    });
    // A hidden filter or a withdrawn series must never keep excluding published events, and exactly
    // one button is always marked as selected.
    const series = showFilters && activeSeries.has(previous) ? previous : "";
    selectSeries(series);
    const shown = upcoming.filter(row => !series || row.series === series);
    replace("events", shown.map(eventCard), series ? "No upcoming events match this learning series." : "No upcoming programs are published right now. New sessions are announced here and on our community pages.");
    renderPastSessions(today);
  }

  function renderPastSessions(today) {
    const earliest = new Date(today.getTime() - PAST_SESSION_DAYS * 86400000);
    const past = latestEvents
      // Exact dates only: a date ("2026-10-25") or a timestamp ("2026-10-25T08:00:00Z"), never a month.
      .filter(row => row.dateStatus === "confirmed" && !/^\d{4}-\d{2}$/.test(row.startsAt) && scheduleEnd(row) && !isUpcomingSchedule(row, today) && scheduleEnd(row) >= earliest)
      .sort((a, b) => byStart(b, a));
    replace("events-past", past.map(row => {
      const item = element("li");
      item.append(element("span", scheduleDateLabel(row), "ph-past-date"), element("span", row.title, "ph-past-title"));
      const detail = String(row.modules || row.topic || "").split(";").map(value => value.trim()).filter(Boolean).join(", ");
      if (detail && detail !== row.title) item.append(element("span", detail, "ph-past-detail"));
      return item;
    }));
  }

  function setupEventFilters() {
    document.querySelectorAll("[data-event-filters]").forEach(group => group.addEventListener("click", event => {
      const button = event.target.closest("[data-event-series]");
      if (!button) return;
      selectSeries(button.dataset.eventSeries);
      renderEvents(latestEvents);
    }));
  }

  // Entries listed in the page itself (_data/campus_labs.yml) give way to the same university once
  // officers publish it, so a Campus Lab never appears twice. Names are compared on their letters
  // and digits only, so case, accents, spacing, and punctuation do not matter ("St. Mary's" =
  // "St Marys", "MSU-IIT" = "MSU IIT", "Co-Op" = "Coop"), and through the aliases each entry declares.
  function universityKey(value) { return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  // First letter of the first word and of the last word of the surname, skipping a suffix ("Jr.").
  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    let last = words.length - 1;
    if (words.length > 2 && /^(jr|sr|ii|iii|iv)$/.test(words[last].toLowerCase().replace(/[.,]/g, ""))) last--;
    return (words[0][0] + (last > 0 ? words[last][0] : "")).toLocaleUpperCase("en-PH");
  }
  // A published chapter as the same card the page uses for listed entries: the lead first (an
  // officer-published photo when there is one, initials otherwise), then the university.
  function chapterCard(row) {
    const node = element("article", null, row.leadName ? "ph-lead" : "ph-lead ph-lead-pending");
    const photo = row.leadName ? image(row.photoUrl, row.leadName) : null;
    const badge = element("span", photo ? null : (row.leadName ? initials(row.leadName) : null), "ph-lead-badge");
    badge.setAttribute("aria-hidden", "true");
    if (photo) { photo.className = "ph-lead-photo"; photo.width = 56; photo.height = 56; photo.alt = ""; badge.append(photo); }
    const body = element("div", null, "ph-lead-body");
    body.append(element("h4", row.leadName || row.university, "ph-lead-name"));
    body.append(element("p", row.leadName ? "Campus Labs Lead" : "Lead not announced yet", "ph-lead-role"));
    if (row.leadName) body.append(element("p", row.university, "ph-lead-school"));
    if (row.chapter && row.chapter !== row.university) body.append(element("p", row.chapter, "ph-lead-place"));
    if (row.status && row.status !== "active") body.append(element("p", humanize(row.status), "ph-lead-place"));
    node.append(badge, body);
    return node;
  }
  function renderChapters(rows) {
    const published = new Set(rows.map(row => universityKey(row.university)).filter(Boolean));
    const canonical = new Map();
    document.querySelectorAll("[data-static-chapter]").forEach(node => {
      const names = [node.dataset.staticChapter, ...(node.dataset.aliases ?? "").split("|")].map(universityKey).filter(Boolean);
      names.forEach(name => canonical.set(name, names[0]));
      node.hidden = names.some(name => published.has(name));
    });
    let totalUniversities = 0;
    let totalPeople = 0;
    for (const island of ["Luzon", "Visayas", "Mindanao"]) {
      const listedNodes = [...document.querySelectorAll(`[data-static-chapter][data-island="${island}"]:not([hidden])`)];
      // A university with two leads has two cards; it still counts once.
      const listed = new Set(listedNodes.map(node => universityKey(node.dataset.staticChapter))).size;
      const own = rows.filter(row => row.island === island);
      replace(`chapters-${island}`, own.map(chapterCard), listed ? "" : "No participating chapters published yet.");
      // Published names that are aliases of a listed university count as that university.
      const count = new Set(own.map(row => canonical.get(universityKey(row.university)) ?? universityKey(row.university)).filter(Boolean)).size + listed;
      document.querySelectorAll(`[data-chapter-count="${island}"]`).forEach(node => { node.textContent = count ? `· ${count}` : ""; });
      document.querySelectorAll(`[data-island-count="${island}"]`).forEach(node => { node.textContent = count ? `${count} ${count === 1 ? "university" : "universities"}` : ""; });
      document.querySelectorAll(`[data-island-total="${island}"]`).forEach(node => { node.textContent = String(count); });
      totalUniversities += count;
      totalPeople += listedNodes.filter(node => !node.classList.contains("ph-lead-pending")).length + own.filter(row => row.leadName).length;
    }
    // The total across all island groups: universities count once each, people once per card.
    document.querySelectorAll("[data-campus-total]").forEach(node => { node.hidden = totalUniversities === 0; });
    document.querySelectorAll("[data-campus-total-universities]").forEach(node => { node.textContent = String(totalUniversities); });
    document.querySelectorAll("[data-campus-total-universities-label]").forEach(node => { node.textContent = totalUniversities === 1 ? "university" : "universities"; });
    document.querySelectorAll("[data-campus-total-people]").forEach(node => { node.textContent = String(totalPeople); });
    document.querySelectorAll("[data-campus-total-people-label]").forEach(node => { node.textContent = totalPeople === 1 ? "person" : "people"; });
  }

  function article(row) {
    const node = card(row.title);
    node.id = `article-${row.id}`;
    const photo = image(row.photoUrl, row.title);
    if (photo) node.prepend(photo);
    paragraph(node, "", displayDate(row.publishedAt), "ph-card-meta");
    for (const [label, key] of [["Event date", "eventDate"], ["Venue / platform", "venue"], ["Speakers", "speakers"], ["Topics", "topics"], ["Highlights", "highlights"], ["Takeaways", "takeaways"], ["Acknowledgments", "acknowledgments"]]) {
      paragraph(node, label, key === "eventDate" ? displayDate(row[key]) : row[key]);
    }
    return node;
  }

  function renderArticles(rows) {
    const sorted = [...rows].sort((a, b) => (date(b.publishedAt)?.getTime() ?? 0) - (date(a.publishedAt)?.getTime() ?? 0));
    replace("news", sorted.filter(row => row.kind === "news").map(article), "No community news published yet.");
    replace("recaps", sorted.filter(row => row.kind === "recap").map(article), "Past-event recaps will appear here with verified details and documentation.");
  }

  // The pytorch.org feed appends "The post … appeared first on PyTorch." to every excerpt.
  function cleanExcerpt(value) { return String(value ?? "").replace(/\s*The post [\s\S]*? appeared first on PyTorch\.?\s*$/, "").trim(); }
  // An empty or missing feed keeps the copy built into the page from _data/pytorch_news.json.
  function renderOfficialNews(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const nodes = rows.map(row => {
      const node = element("article", null, "ph-card");
      const meta = [displayDate(row.publishedAt), ...(Array.isArray(row.categories) ? row.categories : [])].filter(Boolean).join(" · ");
      if (meta) node.append(element("p", meta, "ph-card-meta"));
      const heading = element("h3");
      const title = link(row.title, row.url, "ph-card-link");
      heading.append(title ?? row.title);
      node.append(heading);
      paragraph(node, "", cleanExcerpt(row.excerpt));
      return node;
    });
    targets("pytorch-news").forEach(target => {
      const limit = Number(target.dataset.limit) || nodes.length;
      target.replaceChildren(...nodes.slice(0, limit).map(node => node.cloneNode(true)));
    });
  }

  function renderLeadership(rows) {
    renderPeople?.(targets("people"), rows, { api, scope: document });
    replace("campus-leads", rows.filter(row => row.position === "campus_labs_lead").map(row => {
      const node = card(row.name);
      const photo = image(row.photoUrl, row.name);
      if (photo) node.prepend(photo);
      paragraph(node, "", row.title);
      return node;
    }), "No Campus Labs lead currently listed.");
  }

  function render(content, officialNews) {
    renderLeadership(content.leadership);
    renderEvents(content.events);
    renderChapters(content.chapters);
    renderArticles(content.articles);
    renderOfficialNews(officialNews);
  }

  async function refresh() {
    try {
      const response = await fetch(api, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const value = await response.json();
      render(value.document, value.officialPytorchNews);
      document.documentElement.dataset.siteContentRevision = String(value.revision);
      document.documentElement.dataset.siteContentStatus = "published";
    } catch (error) {
      document.documentElement.dataset.siteContentStatus = "fallback";
      console.warn("site_content.refresh_failed", { message: String(error) });
    }
  }

  async function start() {
    try {
      if (targets("people").length) ({ renderPeople } = await import("./people/view.mjs"));
      setupEventFilters();
      const response = await fetch(defaultsUrl, { credentials: "omit" });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const baseline = await response.json();
      // Bundled content cannot publish people; only the current API directory owns the roster.
      render({ ...baseline, leadership: [] });
      await refresh();
      setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
    } catch (error) {
      console.warn("site_content.defaults_failed", { message: String(error) });
    }
  }
  void start();
})();
