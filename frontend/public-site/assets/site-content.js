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

  function renderEvents(rows) {
    latestEvents = Array.isArray(rows) ? rows : [];
    const today = startOfToday();
    const upcoming = latestEvents.filter(row => isUpcomingSchedule(row, today)).sort(byStart);
    // Offer a series filter only for series that still have upcoming sessions.
    const activeSeries = new Set(upcoming.map(row => row.series).filter(Boolean));
    seriesButtons().forEach(button => { if (button.dataset.eventSeries) button.hidden = !activeSeries.has(button.dataset.eventSeries); });
    document.querySelectorAll("[data-event-filters]").forEach(group => { group.hidden = activeSeries.size < 2; });
    if (selectedEventSeries() && !activeSeries.has(selectedEventSeries())) selectSeries("");
    const series = selectedEventSeries();
    const shown = upcoming.filter(row => !series || row.series === series);
    replace("events", shown.map(eventCard), series ? "No upcoming events match this learning series." : "No upcoming programs are published right now. New sessions are announced here and on our community pages.");
    renderPastSessions(today);
  }

  function renderPastSessions(today) {
    const earliest = new Date(today.getTime() - PAST_SESSION_DAYS * 86400000);
    const past = latestEvents
      .filter(row => row.dateStatus === "confirmed" && /^\d{4}-\d{2}-\d{2}$/.test(row.startsAt) && !isUpcomingSchedule(row, today) && scheduleEnd(row) >= earliest)
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
    seriesButtons().forEach(button => button.addEventListener("click", () => { selectSeries(button.dataset.eventSeries); renderEvents(latestEvents); }));
  }

  function renderChapters(rows) {
    for (const island of ["Luzon", "Visayas", "Mindanao"]) {
      replace(`chapters-${island}`, rows.filter(row => row.island === island).map(row => {
        const node = card(row.university, "ph-chapter");
        const photo = image(row.photoUrl, row.chapter);
        if (photo) node.prepend(photo);
        paragraph(node, "Chapter", row.chapter);
        paragraph(node, "Lead", row.leadName);
        paragraph(node, "Status", humanize(row.status));
        return node;
      }), "No participating chapters published yet.");
      const count = counts.get(`chapters-${island}`);
      document.querySelectorAll(`[data-chapter-count="${island}"]`).forEach(node => { node.textContent = count ? `· ${count}` : ""; });
    }
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
