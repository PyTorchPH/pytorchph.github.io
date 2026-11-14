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

  // One event as an open column, after PyTorch Korea's home page: a meta line (type, date, place),
  // the title, what it covers, and a link to register when there is one.
  // The dot is hidden from screen readers; the spaces around it stay, so the words do not run together.
  function separator() { const node = element("span", "·", "ph-event-separator"); node.setAttribute("aria-hidden", "true"); return node; }
  function eventCard(row) {
    const node = element("article", null, "ph-event");
    node.id = `event-${row.id}`;
    const photo = image(row.photoUrl, row.title);
    if (photo) node.append(photo);
    const meta = element("p", null, "ph-event-meta");
    const type = humanize(row.eventType);
    if (type) meta.append(element("span", type, "ph-event-type"), " ", separator(), " ");
    if (row.dateStatus === "tentative") meta.append(element("span", "Tentative", "ph-status"), " ");
    meta.append(element("span", scheduleDateLabel(row), "ph-event-date"));
    if (row.venue) meta.append(" ", separator(), " ", element("span", row.venue, "ph-event-venue"));
    node.append(meta, element("h3", row.title));
    if (row.isDemo) node.append(element("p", "Demo/Test event — sample data", "ph-demo-label"));
    if (row.series && row.series !== row.title) paragraph(node, "", row.series, "ph-event-series");
    paragraph(node, "", row.description, "ph-event-description");
    const modules = String(row.modules || row.topic || "").split(";").map(item => item.trim()).filter(Boolean);
    if (modules.length) {
      const list = element("ul", null, "ph-event-modules");
      modules.forEach(item => list.append(element("li", item)));
      node.append(list);
    }
    const registration = link("Registration details", row.registrationUrl, "ph-event-link");
    if (registration) {
      const arrow = element("span", " →");
      arrow.setAttribute("aria-hidden", "true");
      registration.append(arrow);
      node.append(registration);
    }
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
    renderHomeEvents(today);
    const shown = upcoming.filter(row => !series || row.series === series);
    replace("events", shown.map(eventCard), series ? "No upcoming events match this learning series." : "No upcoming programs are published right now. New sessions are announced here and on our community pages.");
    renderPastSessions(today);
  }

  // The home page's events, in two parts of equal weight. Community events: three equal dark tiles, one
  // per series, each with its next session: a published one for that series when there is one, else
  // the planned one from _data/community_events.yml (embedded in the page). Training:
  // a line per upcoming course (published sessions sharing a title), with its modules one click away,
  // and recently finished courses behind a small toggle. Nothing is shown that the data does not say:
  // no date means no date line, and module names appear as published.
  function communityEventsConfig() {
    const node = document.querySelector("[data-community-events]");
    if (!node) return null;
    try { const value = JSON.parse(node.textContent); return value && typeof value === "object" ? value : null; } catch { return null; }
  }
  const hasDay = row => /^\d{4}-\d{2}-\d{2}/.test(String(row.startsAt ?? "")) && Boolean(date(row.startsAt));
  const isMonth = row => /^\d{4}-\d{2}$/.test(String(row.startsAt ?? ""));
  const manila = (value, options) => value.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", ...options });
  const monthStart = row => new Date(Number(row.startsAt.slice(0, 4)), Number(row.startsAt.slice(5, 7)) - 1, 1);
  // "A", "A and B", "A, B, and C".
  function joinList(items) {
    if (items.length < 3) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  }
  // One phrase for a column's dates, each date once: "Saturday, January 16, 2027", "October 25 and
  // November 8, 2026", "November and December 2026".
  function datesPhrase(rows) {
    if (rows.length === 1 && hasDay(rows[0])) return manila(date(rows[0].startsAt), { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const label = (row, year) => (isMonth(row) ? monthStart(row).toLocaleDateString("en-PH", { month: "long", ...(year && { year: "numeric" }) })
      : hasDay(row) ? manila(date(row.startsAt), { month: "long", day: "numeric", ...(year && { year: "numeric" }) }) : scheduleDateLabel(row));
    const dated = rows.every(row => isMonth(row) || hasDay(row));
    const years = new Set(rows.map(row => (isMonth(row) ? row.startsAt.slice(0, 4) : hasDay(row) ? manila(date(row.startsAt), { year: "numeric" }) : "")));
    const sameKind = rows.every(isMonth) || rows.every(hasDay);
    if (dated && sameKind && years.size === 1) {
      const parts = [...new Set(rows.map(row => label(row, false)))];
      return `${joinList(parts)}${rows.every(hasDay) ? "," : ""} ${[...years][0]}`;
    }
    return joinList([...new Set(rows.map(row => label(row, true)))]);
  }
  function arrowLink(text, href) {
    const node = link(text, href, "ph-event-link");
    if (!node) return null;
    const arrow = element("span", " →");
    arrow.setAttribute("aria-hidden", "true");
    node.append(arrow);
    return node;
  }
  function addPoster(node, rows, title) {
    const poster = image(rows.find(row => row.photoUrl)?.photoUrl, `Poster: ${title}`);
    if (!poster) return;
    poster.className = "ph-event-poster";
    node.append(poster);
  }
  // A course card: its title and dates. It opens to its sessions, which are separate events: each with
  // its own date, its modules as published (the list numbers them through the course, so "Module N:" is
  // dropped; none twice), and its registration link.
  function courseRow(rows, today) {
    const [first] = rows;
    const body = element("div", null, "ph-course-body");
    const sessions = element("div", null, "ph-course-sessions");
    const seen = new Set();
    for (const row of rows) {
      const modules = String(row.modules || row.topic || "").split(";").map(value => value.trim().replace(/^Module\s+\d+\s*:\s*/i, "")).filter(item => item && !seen.has(item) && Boolean(seen.add(item)));
      const more = isUpcomingSchedule(row, today) ? arrowLink("Learn more", row.registrationUrl) : null;
      if (!modules.length && !more) continue;
      const session = element("div", null, "ph-session");
      session.append(element("p", `${datesPhrase([row]).replace(/^\w+day, /, "")}${row.dateStatus === "tentative" ? " (tentative)" : ""}`, "ph-session-when"));
      if (modules.length) {
        const list = element("ol", null, "ph-event-modules");
        modules.forEach(item => list.append(element("li", item)));
        session.append(list);
      }
      if (more) session.append(more);
      sessions.append(session);
    }
    if (sessions.childNodes.length) body.append(sessions);
    const expandable = body.childNodes.length > 0;
    const node = element(expandable ? "details" : "div", null, "ph-course");
    const head = element(expandable ? "summary" : "div", null, "ph-course-head");
    head.append(element("h4", first.title));
    if (rows.some(row => row.isDemo)) head.append(element("span", "Demo/Test", "ph-demo-label"));
    head.append(element("span", `${datesPhrase(rows)}${rows.some(row => row.dateStatus === "tentative") ? " (tentative)" : ""}`, "ph-course-when"));
    node.append(head);
    if (expandable) node.append(body);
    return node;
  }
  // The Manila calendar day as "2026-11-20", to compare with the data file's dates.
  const manilaDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  function callForProposals(cfp) {
    if (!cfp?.opens || !cfp?.closes) return null;
    const day = manilaDay();
    if (day > cfp.closes) return null;
    const monthDay = value => new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))).toLocaleDateString("en-PH", { month: "long", day: "numeric" });
    const node = element("p", day < cfp.opens ? `Call for proposals opens ${monthDay(cfp.opens)}.` : `Call for proposals open until ${monthDay(cfp.closes)}.`, "ph-event-note");
    const submit = day >= cfp.opens ? arrowLink("Submit a talk", cfp.url) : null;
    if (submit) node.append(" ", submit);
    return node;
  }
  // A community event as a dark tile, after the Linux Foundation's event pages: the kind (and place),
  // the name, one sentence, the call for proposals, a link, and at the foot the date, large, said once.
  // A series with no date shows none.
  function eventTile(item, sessions) {
    const [next] = sessions;
    const title = next?.title || item.name;
    const node = element("article", null, "ph-tile");
    const poster = image(next?.photoUrl, `Poster: ${title}`);
    if (poster) {
      poster.className = "ph-tile-poster";
      node.append(poster);
    }
    const kind = element("p", null, "ph-tile-kind");
    [item.kind, next?.venue].filter(Boolean).forEach((part, index) => {
      if (index) kind.append(" ", separator(), " ");
      kind.append(part);
    });
    node.append(kind, element("h4", title));
    if (next?.isDemo) node.append(element("p", "Demo/Test event — sample data", "ph-demo-label"));
    paragraph(node, "", next?.description || item.blurb, "ph-tile-blurb");
    const cfp = callForProposals(item.cfp);
    if (cfp) node.append(cfp);
    const more = next ? arrowLink("Learn more", next.registrationUrl) : null;
    if (more) node.append(more);
    if (next) {
      // A small line (the weekday, or "Tentative"), then the date, large: the dates line up across tiles.
      const when = element("p", null, "ph-tile-date");
      const note = [hasDay(next) ? manila(date(next.startsAt), { weekday: "long" }) : "", next.dateStatus === "tentative" ? "Tentative" : ""].filter(Boolean).join(", ");
      when.append(element("span", note || "\u00a0", "ph-tile-weekday"), " ");
      // A month-only date stays a month: never an invented day.
      when.append(element("span", hasDay(next) ? manila(date(next.startsAt), { month: "long", day: "numeric", year: "numeric" })
        : isMonth(next) ? monthStart(next).toLocaleDateString("en-PH", { month: "long", year: "numeric" }) : scheduleDateLabel(next), "ph-tile-day"));
      node.append(when);
    }
    return node;
  }
  let homeEventsKey = null;
  function renderHomeEvents(today) {
    const config = communityEventsConfig();
    if (!config) return;
    // An unchanged refresh leaves everything alone, so keyboard focus and opened courses stay as they are.
    const key = JSON.stringify([latestEvents, manilaDay(), today.getTime()]);
    if (key === homeEventsKey) return;
    homeEventsKey = key;
    const upcoming = row => isUpcomingSchedule(row, today);
    const recent = row => hasDay(row) && row.dateStatus === "confirmed" && scheduleEnd(row) >= new Date(today.getTime() - PAST_SESSION_DAYS * 86400000);
    const trainingType = config.training?.event_type;
    const groupBy = (rows, name) => {
      const groups = new Map();
      for (const row of rows) {
        const group = name(row);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(row);
      }
      return [...groups.values()].map(list => list.sort(byStart)).sort((a, b) => byStart(a[0], b[0]));
    };
    const show = (program, visible) => document.querySelectorAll(`[data-program="${program}"]`).forEach(node => { node.hidden = !visible; });

    // Community events: the named series, then any other published series, one tile each. A planned
    // session gives way to a published one with the same title, also after that one has passed.
    const community = latestEvents.filter(row => row.eventType !== trainingType);
    const configured = Array.isArray(config.events?.series) ? config.events.series : [];
    const entries = configured.map(item => {
      const published = community.filter(row => row.series === item.name);
      const titles = new Set(published.map(row => row.title));
      const planned = (Array.isArray(item.sessions) ? item.sessions : []).filter(row => !titles.has(row.title));
      return { item, sessions: [...published, ...planned].filter(upcoming).sort(byStart) };
    });
    const named = new Set(configured.map(item => item.name));
    for (const rows of groupBy(community.filter(row => !named.has(row.series) && upcoming(row)), row => row.series || row.title)) {
      entries.push({ item: { name: rows[0].series || rows[0].title, kind: humanize(rows[0].eventType), blurb: "" }, sessions: rows });
    }
    replace("program-events", entries.map(entry => eventTile(entry.item, entry.sessions)));
    show("events", entries.length > 0);

    // Training: upcoming courses as lines; recently finished ones behind the toggle.
    const courses = groupBy(latestEvents.filter(row => trainingType && row.eventType === trainingType), row => `${row.series ?? ""}\u0000${row.title ?? ""}`);
    const ahead = courses.filter(rows => rows.some(upcoming));
    const finished = courses.filter(rows => !rows.some(upcoming) && rows.some(recent));
    replace("program-training", ahead.map(rows => courseRow(rows, today)));
    replace("program-previous", finished.map(rows => courseRow(rows, today)));
    document.querySelectorAll("[data-previous-count]").forEach(node => { node.textContent = finished.length ? `(${finished.length})` : ""; });
    show("training", ahead.length + finished.length > 0);
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

  // The pytorch.org feed writes punctuation as numeric character references ("kernel&#8217;s"). The API
  // decodes the named ones (&amp;, &lt;, ...) but passes these through, so decode only these here: decoding
  // a named one again would turn a post's literal "&lt;" into "<". The result is only ever set as text,
  // never parsed as HTML. References outside Unicode, or to a lone surrogate, stay as written.
  function decodeReferences(value) {
    return String(value ?? "").replace(/&#(?:(\d+)|x([0-9a-f]+));/gi, (match, decimal, hex) => {
      const code = decimal ? Number(decimal) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    });
  }
  // The pytorch.org feed appends "The post … appeared first on PyTorch." to every excerpt.
  function cleanExcerpt(value) { return String(value ?? "").replace(/\s*The post [\s\S]*? appeared first on PyTorch\.?\s*$/, "").trim(); }
  // An empty or missing feed keeps the copy built into the page from _data/pytorch_news.json.
  function renderOfficialNews(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const nodes = rows.map(row => {
      const node = element("article", null, "ph-card");
      const categories = Array.isArray(row.categories) ? row.categories.map(decodeReferences) : [];
      const meta = [displayDate(row.publishedAt), ...categories].filter(Boolean).join(" · ");
      if (meta) node.append(element("p", meta, "ph-card-meta"));
      const heading = element("h3");
      const name = decodeReferences(row.title);
      const title = link(name, row.url, "ph-card-link");
      heading.append(title ?? name);
      node.append(heading);
      paragraph(node, "", cleanExcerpt(decodeReferences(row.excerpt)));
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
    // Pages that rearrange rendered content (assets/campus-directory.js) pick up each render here.
    document.dispatchEvent(new Event("site-content:rendered"));
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
