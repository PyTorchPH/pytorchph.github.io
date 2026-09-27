(function () {
  const PROVIDERS = [
    { id: "github", name: "GitHub", kind: "identity" },
    { id: "google", name: "Google", kind: "identity" },
    { id: "microsoft", name: "Microsoft", kind: "identity" },
    { id: "facebook", name: "Facebook", kind: "social" },
    { id: "linkedin", name: "LinkedIn", kind: "social" },
    { id: "indeed", name: "Indeed", kind: "job_site" },
  ];
  const ACTIONS = [
    ["captcha", "CAPTCHA"],
    ["human_verification", "Are you human?"],
    ["unknown_question", "Unknown questions"],
    ["sign_in", "Sign in required"],
    ["resume_upload", "Resume upload approvals"],
    ["resume_continue", "Resume Continue approvals"],
    ["layout_review", "Application layout review"],
    ["submission_review", "Submission confirmation"],
    ["external_application", "External applications"],
    ["other", "Other manual work"],
  ];
  const preferenceKey = "jobFinder.disconnectPreference";
  const VALID_VIEWS = new Set(["overview", "automation", "analytics", "opportunities", "resumes", "connections"]);
  const sessionsNode = document.querySelector("[data-sessions]");
  const automaticNode = document.querySelector("[data-automatic-list]");
  const interventionsNode = document.querySelector("[data-intervention-groups]");
  const toastNode = document.querySelector("[data-toast]");
  const livePagesNode = document.querySelector("[data-live-pages]");
  const goalItemsNode = document.querySelector("[data-goal-items]");
  const goalInterventionItemsNode = document.querySelector("[data-goal-intervention-items]");
  const resumeRoutesNode = document.querySelector("[data-resume-routes]");
  const marketCampaignForm = document.querySelector("[data-market-campaign-form]");
  const marketOpportunityForm = document.querySelector("[data-market-opportunity-form]");
  const marketOpportunitiesNode = document.querySelector("[data-market-opportunities]");
  const marketDetailNode = document.querySelector("[data-market-detail]");
  const disconnectDialog = document.querySelector("[data-disconnect-dialog]");
  const settingsDialog = document.querySelector("[data-settings-dialog]");
  let pendingDisconnect = "";
  let activeGoalId = "";
  let livePagesSignature = "";
  let toastTimer;
  let marketCampaign = null;
  let selectedMarketOpportunity = "";
  let marketSignature = "";
  let autoStartInFlight = false;
  let autoStartSettled = false;
  let latestState = {};
  const autoRecheckedAt = new Map();

  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => navigateView(button.dataset.viewLink));
  });
  document.querySelector("[data-view-back]").addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else navigateView("overview", "", true);
  });
  window.addEventListener("popstate", applyLocationView);

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  document.querySelector("[data-refresh]").addEventListener("click", refresh);
  document.querySelector("[data-goal-form]").addEventListener("submit", startGoal);
  document.querySelector("[data-resume-goal]").addEventListener("click", resumeGoal);
  document.querySelector("[data-cancel-goal]").addEventListener("click", cancelGoal);
  document.querySelector("[data-open-settings]").addEventListener("click", openSettings);
  document.querySelector("[data-disconnect-form]").addEventListener("submit", confirmDisconnect);
  document.querySelector("[data-disconnect-setting]").addEventListener("change", (event) => {
    const value = event.target.value;
    if (value === "ask") localStorage.removeItem(preferenceKey);
    else localStorage.setItem(preferenceKey, value);
    showToast("Disconnect preference updated.");
  });
  marketCampaignForm.addEventListener("submit", saveMarketCampaign);
  marketOpportunityForm.addEventListener("submit", addMarketOpportunity);
  document.querySelector("[data-market-sync]").addEventListener("click", syncMarketSubmissions);
  document.querySelector("[data-market-refresh]").addEventListener("click", refreshMarketOutcomes);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });

  function selectTab(name) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  function locationView() {
    const value = new URLSearchParams(window.location.search).get("view") || "overview";
    return VALID_VIEWS.has(value) ? value : "overview";
  }

  function navigateView(view, segment = "", replace = false) {
    const url = new URL(window.location.href);
    if (view === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    if (segment) url.searchParams.set("segment", segment);
    else url.searchParams.delete("segment");
    window.history[replace ? "replaceState" : "pushState"]({ view, segment }, "", url);
    applyLocationView();
  }

  function applyLocationView() {
    const view = locationView();
    document.querySelectorAll("[data-view]").forEach((node) => {
      const active = node.dataset.view === view;
      node.classList.toggle("active", active);
      node.hidden = !active;
    });
    document.querySelectorAll("[data-view-link]").forEach((node) => {
      node.classList.toggle("active", node.dataset.viewLink === view);
    });
    document.querySelector("[data-view-back]").hidden = view === "overview";
    if (view === "analytics") renderAnalyticsDetail(latestState);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function refresh() {
    try {
      const response = await fetch("/api/job-finder/control-state", { cache: "no-store" });
      const state = await response.json();
      if (!response.ok) throw new Error(state.error || "Control state is unavailable.");
      render(state);
      await refreshMarketFit();
      await maybeAutoStart(state);
      const connection = document.querySelector("[data-connection]");
      connection.classList.add("online");
      connection.lastChild.textContent = " Connected";
    } catch (error) {
      const connection = document.querySelector("[data-connection]");
      connection.classList.remove("online");
      connection.lastChild.textContent = " Offline";
      showToast(error.message);
    }
  }

  async function maybeAutoStart(state) {
    const status = state.goal?.status || "";
    const active = ["active", "waiting_for_human", "waiting_for_candidates"].includes(status);
    if (active || !state.sessions?.job_sites?.indeed?.connected || autoStartInFlight || autoStartSettled) return;
    autoStartInFlight = true;
    try {
      const result = await post("/api/job-finder/auto-start");
      if (result.started) {
        autoStartSettled = true;
        showToast("Safe automation started from your verified setup.");
        window.setTimeout(refresh, 250);
      } else if (result.reason?.includes("already")) {
        autoStartSettled = true;
      }
    } catch (error) {
      if (!error.message.includes("Onboarding is not ready")) showToast(error.message);
    } finally {
      autoStartInFlight = false;
    }
  }

  async function refreshMarketFit() {
    const response = await fetch("/api/job-finder/market-fit", { cache: "no-store" });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || "Market-fit state is unavailable.");
    renderMarketFit(state);
  }

  function renderMarketFit(state) {
    const campaign = state.campaign || {};
    marketCampaign = campaign;
    if (!marketCampaignForm.contains(document.activeElement)) {
      setFormValue(marketCampaignForm, "name", campaign.name);
      setFormValue(marketCampaignForm, "start_date", campaign.start_date);
      setFormValue(marketCampaignForm, "end_date", campaign.end_date);
      setFormValue(marketCampaignForm, "ghost_after_days", campaign.ghost_after_days);
      setFormValue(marketCampaignForm, "full_time_mix", campaign.track_mix?.full_time);
      setFormValue(marketCampaignForm, "contract_mix", campaign.track_mix?.contract_project);
      setFormValue(marketCampaignForm, "freelance_mix", campaign.track_mix?.freelance);
      setFormValue(marketCampaignForm, "automated_mix", campaign.application_mode_mix?.automated);
      setFormValue(marketCampaignForm, "manual_mix", campaign.application_mode_mix?.manual_tailored);
    }
    const analytics = state.analytics || {};
    const goals = document.querySelector("[data-market-goals]");
    goals.replaceChildren(
      marketGoal("HR interviews", `${analytics.stage_counts?.hr_interview || 0} / ${campaign.hr_interview_min || 0}–${campaign.hr_interview_max || 0}`),
      marketGoal("Technical interviews", `${analytics.stage_counts?.technical_interview || 0} / ${campaign.technical_interview_min || 0}–${campaign.technical_interview_max || 0}`),
      marketGoal("Offers", `${analytics.stage_counts?.offer || 0} / ${campaign.offer_target || 0}`),
      marketGoal("Ghosted", analytics.stale_count || 0),
      marketGoal("Actual A / B / C", mixText(analytics.track_counts, ["full_time", "contract_project", "freelance"])),
      marketGoal("Actual automated / manual", mixText(analytics.application_mode_counts, ["automated", "manual_tailored"])),
    );
    const conversions = document.querySelector("[data-market-conversions]");
    conversions.replaceChildren(...(analytics.conversions || []).map(conversionCard));
    const analyticsConversions = document.querySelector("[data-analytics-conversions]");
    analyticsConversions.replaceChildren(...(analytics.conversions || []).map(conversionCard));
    const segments = document.querySelector("[data-market-segments]");
    segments.replaceChildren(...Object.entries(analytics.conversion_segments || {}).map(([key, metrics]) => {
      const first = metrics[0] || {};
      return conversionCard({
        ...first,
        name: `${key.replaceAll("_", " ")} · application → response`,
      });
    }));
    setText("[data-market-recommendation]", (analytics.recommendations || []).join(" "));
    const signature = JSON.stringify((state.opportunities || []).map((item) => [
      item.id, item.updated_at, item.current_stage, item.demand_verified, item.fit_assessment?.assessed_at,
    ]));
    if (signature !== marketSignature) {
      marketSignature = signature;
      renderMarketOpportunities(state.opportunities || []);
      if (selectedMarketOpportunity) openMarketOpportunity(selectedMarketOpportunity, false);
    }
  }

  function mixText(counts = {}, keys = []) {
    const total = keys.reduce((sum, key) => sum + (counts[key] || 0), 0);
    return keys.map((key) => {
      const count = counts[key] || 0;
      return `${count}${total ? ` (${Math.round(count / total * 100)}%)` : ""}`;
    }).join(" / ");
  }

  function marketGoal(label, value) {
    const card = element("article");
    card.append(element("span", "", label), element("strong", "", String(value)));
    return card;
  }

  function conversionCard(metric) {
    const card = element("article", "conversion-card");
    const percent = metric.rate == null ? "Insufficient data" : `${Math.round(metric.rate * 100)}%`;
    const interval = metric.interval_low == null
      ? `${metric.pending || 0} pending`
      : `95% interval ${Math.round(metric.interval_low * 100)}–${Math.round(metric.interval_high * 100)}% · n=${metric.resolved}`;
    card.append(
      element("span", "", metric.name),
      element("strong", "", percent),
      element("small", "", `${metric.successes}/${metric.resolved} resolved · ${interval}`),
    );
    return card;
  }

  function renderMarketOpportunities(items) {
    if (!items.length) {
      marketOpportunitiesNode.replaceChildren(element("div", "empty", "No tracked opportunities yet."));
      return;
    }
    marketOpportunitiesNode.replaceChildren(...items.map((item) => {
      const card = element("article", `market-opportunity${item.id === selectedMarketOpportunity ? " active" : ""}`);
      card.append(element("h3", "", item.job_title), element("p", "", item.company));
      const tags = element("div", "market-opportunity-tags");
      tags.append(
        element("span", "pill", item.track.replaceAll("_", " ")),
        element("span", "pill", item.application_mode.replaceAll("_", " ")),
        element("span", "pill", item.current_stage?.replaceAll("_", " ") || "not applied"),
        element("span", `pill ${item.demand_verified ? "submitted" : ""}`, item.demand_verified ? "demands verified" : "demands unverified"),
      );
      if (item.fit_assessment) tags.append(element("span", "pill", item.fit_assessment.demands_abilities));
      card.append(tags);
      card.addEventListener("click", () => openMarketOpportunity(item.id));
      return card;
    }));
  }

  async function saveMarketCampaign(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = structuredClone(marketCampaign);
    payload.name = form.get("name");
    payload.start_date = form.get("start_date");
    payload.end_date = form.get("end_date");
    payload.ghost_after_days = Number(form.get("ghost_after_days"));
    payload.track_mix = {
      full_time: Number(form.get("full_time_mix")),
      contract_project: Number(form.get("contract_mix")),
      freelance: Number(form.get("freelance_mix")),
    };
    payload.application_mode_mix = {
      automated: Number(form.get("automated_mix")),
      manual_tailored: Number(form.get("manual_mix")),
    };
    try {
      await putJSON("/api/job-finder/market-fit/campaign", payload);
      showToast("Market-fit campaign saved.");
      refreshMarketFit();
    } catch (error) { showToast(error.message); }
  }

  async function addMarketOpportunity(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const item = await postJSON("/api/job-finder/market-fit/opportunities", payload);
      event.currentTarget.reset();
      selectedMarketOpportunity = item.id;
      showToast("Opportunity added. Verify its job demands before assessing fit.");
      await refreshMarketFit();
    } catch (error) { showToast(error.message); }
  }

  async function syncMarketSubmissions() {
    try {
      const result = await post("/api/job-finder/market-fit/sync-submissions");
      showToast(`${result.created} confirmed application(s) imported.`);
      refreshMarketFit();
    } catch (error) { showToast(error.message); }
  }

  async function refreshMarketOutcomes() {
    try {
      const result = await post("/api/job-finder/market-fit/refresh");
      showToast(`${result.ghosted} application(s) crossed the configured ghosting window.`);
      refreshMarketFit();
    } catch (error) { showToast(error.message); }
  }

  async function openMarketOpportunity(id, showErrors = true) {
    selectedMarketOpportunity = id;
    try {
      const response = await fetch(`/api/job-finder/market-fit/opportunities/${encodeURIComponent(id)}`, { cache: "no-store" });
      const detail = await response.json();
      if (!response.ok) throw new Error(detail.error || "Opportunity is unavailable.");
      renderMarketDetail(detail);
    } catch (error) {
      if (showErrors) showToast(error.message);
    }
  }

  function renderMarketDetail(detail) {
    const item = detail.opportunity;
    const heading = element("div");
    heading.append(element("p", "eyebrow", "Opportunity evidence file"), element("h2", "", item.job_title), element("p", "lede", `${item.company} · ${item.resume_file || "No resume selected"}`));
    const metadata = document.createElement("form");
    metadata.className = "opportunity-form";
    metadata.innerHTML = `
      <label><span>Track</span><select name="track"><option value="full_time">A · Full-time</option><option value="contract_project">B · Contract / Project</option><option value="freelance">C · Freelance</option></select></label>
      <label><span>Application mode</span><select name="application_mode"><option value="automated">Automated</option><option value="manual_tailored">Manual-tailored</option></select></label>
      <label><span>Resume filename</span><input name="resume_file"></label>
      <label class="wide"><span>Saved job description</span><textarea name="description" rows="5"></textarea></label>
      <button class="button" type="submit">Save opportunity evidence</button>`;
    setFormValue(metadata, "track", item.track);
    setFormValue(metadata, "application_mode", item.application_mode);
    setFormValue(metadata, "resume_file", item.resume_file);
    setFormValue(metadata, "description", item.description);
    metadata.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(metadata).entries());
        await putJSON(`/api/job-finder/market-fit/opportunities/${item.id}`, values);
        showToast("Opportunity evidence saved.");
        openMarketOpportunity(item.id);
        refreshMarketFit();
      } catch (error) { showToast(error.message); }
    });
    const eventControls = element("div", "market-detail-actions");
    const stage = document.createElement("select");
    ["applied", "recruiter_response", "hr_interview", "technical_interview", "offer", "rejected", "withdrawn", "ghosted"].forEach((value) => {
      const option = document.createElement("option"); option.value = value; option.textContent = value.replaceAll("_", " "); stage.append(option);
    });
    const addEvent = element("button", "button ghost", "Record outcome"); addEvent.type = "button";
    addEvent.addEventListener("click", async () => {
      await marketAction(`/api/job-finder/market-fit/opportunities/${item.id}/events`, { stage: stage.value }, "Outcome recorded.");
    });
    eventControls.append(stage, addEvent);
    const timeline = element("ul", "timeline");
    (detail.events || []).forEach((event) => timeline.append(element("li", "", `${event.stage.replaceAll("_", " ")} · ${new Date(event.occurred_at).toLocaleDateString()}${event.note ? ` · ${event.note}` : ""}`)));

    const demandSection = element("section", "market-detail-section");
    demandSection.append(element("h3", "", "Verified job demands"));
    const draftButton = element("button", "button ghost", detail.demands ? "Redraft with AI" : "Draft demands with AI"); draftButton.type = "button";
    const approveButton = element("button", "button", "Approve edited demands"); approveButton.type = "button";
    const demandActions = element("div", "market-detail-actions"); demandActions.append(draftButton, approveButton);
    const demandJSON = document.createElement("textarea"); demandJSON.className = "market-json";
    demandJSON.value = JSON.stringify(stripDemandMetadata(detail.demands) || { requirements: [], constraints: [], warnings: [], confidence: 0 }, null, 2);
    draftButton.addEventListener("click", async () => {
      try {
        const result = await post(`/api/job-finder/market-fit/opportunities/${item.id}/demands/draft`);
        demandJSON.value = JSON.stringify(stripDemandMetadata(result), null, 2);
        showToast("AI demand draft ready for human review.");
      } catch (error) { showToast(error.message); }
    });
    approveButton.addEventListener("click", async () => {
      try {
        const value = JSON.parse(demandJSON.value);
        await putJSON(`/api/job-finder/market-fit/opportunities/${item.id}/demands`, value);
        showToast("Job demands verified.");
        openMarketOpportunity(item.id);
      } catch (error) { showToast(error.message); }
    });
    demandSection.append(demandActions, demandJSON);

    const fitSection = element("section", "market-detail-section");
    fitSection.append(element("h3", "", "Market-fit evidence profile"));
    const assessButton = element("button", "button ghost", "Assess verified fit"); assessButton.type = "button";
    assessButton.addEventListener("click", () => marketAction(`/api/job-finder/market-fit/opportunities/${item.id}/assessment`, null, "Fit assessment updated."));
    fitSection.append(assessButton, renderFit(detail.assessment));

    const prepSection = element("section", "market-detail-section");
    prepSection.append(element("h3", "", "Evidence-backed interview prep"));
    const prepButton = element("button", "button ghost", "Generate cited prep"); prepButton.type = "button";
    prepButton.addEventListener("click", () => marketAction(`/api/job-finder/market-fit/opportunities/${item.id}/interview-prep`, null, "Interview prep generated."));
    const approvePrep = element("button", "button", detail.interview_prep?.approved ? "Preparation approved" : "Approve preparation"); approvePrep.type = "button";
    approvePrep.disabled = !detail.interview_prep || detail.interview_prep.approved;
    approvePrep.addEventListener("click", async () => {
      try {
        await putJSON(`/api/job-finder/market-fit/opportunities/${item.id}/interview-prep/approve`, {});
        showToast("Interview preparation approved.");
        openMarketOpportunity(item.id);
      } catch (error) { showToast(error.message); }
    });
    const prepText = element("pre", "market-json", JSON.stringify(detail.interview_prep || { status: "Not generated" }, null, 2));
    const prepActions = element("div", "market-detail-actions"); prepActions.append(prepButton, approvePrep);
    prepSection.append(prepActions, prepText);
    marketDetailNode.replaceChildren(heading, metadata, eventControls, timeline, demandSection, fitSection, prepSection);
  }

  function renderFit(assessment) {
    if (!assessment) return element("div", "empty", "No verified fit assessment yet.");
    const grid = element("div", "fit-dimensions");
    [["Eligibility", assessment.eligibility], ["Demands–abilities", assessment.demands_abilities], ["Needs–supplies", assessment.needs_supplies]].forEach(([label, value]) => {
      const card = element("article"); card.append(element("span", "", label), element("strong", "", value)); grid.append(card);
    });
    return grid;
  }

  function stripDemandMetadata(value) {
    if (!value) return null;
    return { requirements: value.requirements || [], constraints: value.constraints || [], warnings: value.warnings || [], confidence: value.confidence || 0 };
  }

  async function marketAction(url, value, message) {
    try {
      if (value == null) await post(url); else await postJSON(url, value);
      showToast(message);
      await openMarketOpportunity(selectedMarketOpportunity);
      refreshMarketFit();
    } catch (error) { showToast(error.message); }
  }

  function setFormValue(form, name, value) {
    const field = form.elements.namedItem(name);
    if (field && value != null) field.value = value;
  }

  function render(state) {
    latestState = state;
    const counts = state.counts || {};
    setText("[data-count-automatic]", counts.automatic || 0);
    setText("[data-count-interventions]", counts.interventions || 0);
    setText("[data-tab-automatic-count]", counts.automatic || 0);
    setText("[data-tab-intervention-count]", counts.interventions || 0);
    setText("[data-access-intervention-count]", counts.access_interventions || 0);
    setText("[data-question-intervention-count]", counts.question_interventions || 0);
    const goal = state.goal || {};
    activeGoalId = goal.id || "";
    setText("[data-goal-target]", goal.target || 0);
    setText("[data-count-confirmed]", goal.confirmed || 0);
    setText("[data-goal-remaining]", goal.remaining || 0);
    setText("[data-goal-reserved]", goal.reserved || 0);
    setText("[data-run-status]", String(goal.status || state.run?.status || "not started").replaceAll("_", " "));
    setText("[data-process-status]", goal.process?.running ? "Running" : "Stopped");
    setText("[data-goal-id]", goal.id ? `Goal ${goal.id} · ${goal.sites.join(", ")}` : "No active goal.");
    const inventory = goal.search_inventory || {};
    const inventorySource = inventory.source?.host
      ? `${inventory.source.host}${inventory.source.safe_path || ""}`
      : "no open search source";
    const appliedSync = inventory.applied_sync?.status === "synced"
      ? ` · ${inventory.applied_sync.cards || 0} Applied-page confirmations synced`
      : "";
    setText(
      "[data-search-inventory]",
      inventory.status
        ? `Candidate scan: ${String(inventory.status).replaceAll("_", " ")} · ${inventorySource} · ${inventory.observed || 0} observed · ${inventory.eligible || 0} eligible · ${inventory.already_applied || 0} already applied · ${inventory.attempted || 0} attempted${appliedSync}${inventory.warning ? ` · ${inventory.warning}` : ""}`
        : "No candidate inventory yet. Open one Indeed search-results tab before scanning.",
    );
    const planner = state.planner_status || {};
    setText(
      "[data-planner-status]",
      "Dynamic layout planner: " + (planner.status || "configuration deferred")
        + " · " + (planner.provider || "provider not selected"),
    );
    const resumeButton = document.querySelector("[data-resume-goal]");
    resumeButton.textContent = goal.status === "waiting_for_candidates"
      ? "Scan current results"
      : "Resume current work";
    const siteSummary = Object.entries(goal.site_counts || {}).map(([site, counts]) =>
      `${site}: ${counts.confirmed} confirmed · ${counts.reserved} reserved · ${counts.human} human · ${counts.skipped} skipped`,
    ).join(" | ");
    setText("[data-site-counts]", siteSummary);
    renderSalaryAnalytics(goal, state.goal_items || []);
    setText(
      "[data-run-detail]",
      state.run?.error || state.run?.artifact || "No run artifact yet.",
    );
    renderSessions(state.sessions || {});
    const bank = state.question_bank || {};
    setText(
      "[data-question-bank-status]",
      bank.source
        ? `Question bank: ${bank.source} · ${bank.pages || 0} exact page set(s) · ${bank.status || "ready"}`
        : "Question bank: no approved source available",
    );
    renderResumeRoutes(state.resume_catalog || [], state.resume_artifact_directory || "");
    renderAutomatic(state.automatic || []);
    const workItems = state.work_items || state.interventions || [];
    renderInterventions(workItems);
    autoRecheck(workItems);
    renderLivePages(state.live_pages || []);
    const goalItems = state.goal_items || [];
    renderGoalItems(
      goalItemsNode,
      goalItems.filter((item) => !["reserved", "human_handoff"].includes(item.state)),
      goal,
    );
    goalInterventionItemsNode.replaceChildren();
  }

  function renderSalaryAnalytics(goal, items) {
    const grid = document.querySelector("[data-salary-analytics]");
    const bands = goal.salary_analytics || [];
    if (!bands.length) {
      grid.replaceChildren(element("div", "empty", "Start the 20-application goal to activate salary analytics."));
    } else {
      grid.replaceChildren(...bands.map((band) => {
        const card = element("button", `salary-card band-${band.band}`);
        card.type = "button";
        card.dataset.salaryBand = band.band;
        card.append(element("span", "salary-label", band.label));
        card.append(element("strong", "salary-progress", band.band === "unknown"
          ? `${band.discovered} found`
          : `${band.confirmed + band.reserved} / ${band.target}`));
        card.append(element("p", "", band.band === "unknown"
          ? "Review only · does not count"
          : `${band.mix_percent}% target · ${band.remaining} slots open`));
        const progress = element("span", "progress-track");
        const fill = element("i", "progress-fill");
        fill.style.width = `${band.target ? Math.min(100, ((band.confirmed + band.reserved) / band.target) * 100) : 0}%`;
        progress.append(fill);
        card.append(progress, element("small", "", `${band.confirmed} confirmed · ${band.reserved} reserved · ${band.discovered} discovered`));
        card.addEventListener("click", () => navigateView("analytics", band.band));
        return card;
      }));
    }
    const levels = goal.job_level_counts || {};
    const levelNode = document.querySelector("[data-level-analytics]");
    levelNode.replaceChildren(
      levelCard("Junior / entry-level", levels.junior || 0),
      levelCard("Internship", levels.intern || 0),
      levelCard("Needs level review", levels.unknown || 0),
    );
    renderAnalyticsDetail({ goal, goal_items: items });
  }

  function levelCard(label, count) {
    const card = element("article", "metric-card");
    card.append(element("strong", "", count), element("span", "", label));
    return card;
  }

  function renderAnalyticsDetail(state) {
    const node = document.querySelector("[data-analytics-detail]");
    if (!node) return;
    const segment = new URLSearchParams(window.location.search).get("segment") || "";
    if (!segment) {
      node.replaceChildren(element("div", "empty", "Select a salary band to inspect its jobs and funnel state."));
      return;
    }
    const band = (state.goal?.salary_analytics || []).find((item) => item.band === segment);
    const matches = (state.goal_items || []).filter((item) => {
      const itemBand = item.salary_band === "legacy_unclassified" ? "unknown" : item.salary_band;
      return itemBand === segment;
    });
    const heading = element("div", "section-heading compact");
    const title = element("div");
    title.append(element("p", "eyebrow", "Salary sub-analytics"), element("h2", "", band?.label || segment));
    heading.append(title, element("small", "", band ? `${band.confirmed} confirmed · ${band.remaining} quota slots remaining` : "Review segment"));
    const list = element("div", "work-list");
    list.replaceChildren(...(matches.length ? matches.map((item) => {
      const card = element("article", "work-card");
      const body = element("div");
      body.append(element("h3", "", item.job_title), element("p", "", `${item.company} · ${String(item.job_level || "unknown").replaceAll("_", " ")}`));
      body.append(element("p", "detail", item.salary_signal || "No reliable PHP salary evidence."));
      card.append(body, element("span", `pill ${item.state}`, String(item.state).replaceAll("_", " ")));
      return card;
    }) : [element("div", "empty", "No jobs have been classified in this salary band yet.")]));
    node.replaceChildren(heading, list);
  }

  async function startGoal(event) {
    event.preventDefault();
    const target = Number(document.querySelector("[data-goal-input]").value);
    const targetCountries = [...document.querySelectorAll("[data-country]:checked")].map((node) => node.value);
    try {
      await postJSON("/api/job-finder/goals", {
        target,
        target_countries: targetCountries,
        work_mode: "remote",
        employment_type: "full_time",
        employment_types: ["full_time", "contract", "internship"],
        job_levels: ["junior", "intern"],
        salary_target_mix: {
          below_20k: 35,
          php_20k_40k: 50,
          php_40k_80k: 10,
          php_80k_plus: 5,
        },
        unknown_salary_policy: "review_only",
      });
      showToast(`Started a goal for ${target} confirmed applications.`);
      refresh();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function resumeGoal() {
    const id = currentGoalId();
    if (!id) return showToast("No goal is available to resume.");
    try {
      await post(`/api/job-finder/goals/${encodeURIComponent(id)}/resume`);
      showToast("One current-results scan started. It will stop after this inventory cycle.");
      refresh();
    } catch (error) { showToast(error.message); }
  }

  async function cancelGoal() {
    const id = currentGoalId();
    if (!id) return showToast("No goal is available to cancel.");
    try {
      await post(`/api/job-finder/goals/${encodeURIComponent(id)}/cancel`);
      showToast("Owned automation process tree stopped.");
      refresh();
    } catch (error) { showToast(error.message); }
  }

  function currentGoalId() {
    return activeGoalId;
  }

  function providerState(provider, sessions) {
    if (provider.kind === "identity") return sessions.identity?.[provider.id] || {};
    if (provider.kind === "social") return sessions.social?.[provider.id] || {};
    return sessions.job_sites?.[provider.id] || {};
  }

  function renderSessions(sessions) {
    sessionsNode.replaceChildren(...PROVIDERS.map((provider) => {
      const state = providerState(provider, sessions);
      const configured = sessions.oauth_setup?.[provider.id]?.configured !== false;
      const connected = Boolean(state.connected);
      const card = element("article", "session-card");
      const meta = element("div", "session-meta");
      const heading = element("div");
      heading.append(element("h3", "", provider.name));
      const description = connected
        ? provider.kind === "identity"
          ? state.profile?.email || state.profile?.display_name || "Connected"
          : state.status || "Reusable session ready"
        : configured ? "Not connected" : "OAuth setup required";
      heading.append(element("p", "", description));
      meta.append(heading, element("span", `pill ${connected ? "connected" : ""}`, connected ? "Connected" : "Signed out"));
      const actions = element("div", "session-actions");
      const signIn = element("button", "button", "Sign in");
      signIn.type = "button";
      signIn.disabled = provider.kind === "identity" && !configured;
      signIn.addEventListener("click", () => signInProvider(provider));
      const disconnect = element("button", "button ghost", "Sign out / Disconnect");
      disconnect.type = "button";
      disconnect.addEventListener("click", () => requestDisconnect(provider));
      actions.append(signIn, disconnect);
      card.append(meta, actions);
      return card;
    }));
  }

  async function signInProvider(provider) {
    if (provider.kind === "identity") {
      window.open(`/auth/${provider.id}/start`, "_blank", "noopener");
      showToast(`${provider.name} OAuth opened in a separate tab.`);
      return;
    }
    const url = provider.kind === "social"
      ? `/api/social-login/${provider.id}`
      : `/api/job-finder/sessions/${provider.id}/sign-in`;
    try {
      await post(url);
      showToast(`${provider.name} sign-in opened in the visible browser.`);
      window.setTimeout(refresh, 1500);
    } catch (error) {
      showToast(error.message);
    }
  }

  function requestDisconnect(provider) {
    const preference = localStorage.getItem(preferenceKey);
    if (preference === "local" || preference === "website") {
      runDisconnect(provider, preference === "website");
      return;
    }
    pendingDisconnect = provider.id;
    document.querySelector("[data-disconnect-name]").textContent = provider.name;
    document.querySelector("[data-remember-disconnect]").checked = false;
    disconnectDialog.showModal();
  }

  function confirmDisconnect(event) {
    const submitter = event.submitter;
    if (!submitter || submitter.value !== "confirm" || !pendingDisconnect) return;
    event.preventDefault();
    const mode = new FormData(event.currentTarget).get("disconnect-mode") || "local";
    if (document.querySelector("[data-remember-disconnect]").checked) {
      localStorage.setItem(preferenceKey, mode);
    }
    const provider = PROVIDERS.find((item) => item.id === pendingDisconnect);
    pendingDisconnect = "";
    disconnectDialog.close();
    runDisconnect(provider, mode === "website");
  }

  async function runDisconnect(provider, websiteLogout) {
    if (!provider) return;
    try {
      await post(`/api/job-finder/sessions/${provider.id}/disconnect?website_logout=${websiteLogout}`);
      showToast(`${provider.name} disconnected${websiteLogout ? "; logout page opened" : ""}.`);
      refresh();
    } catch (error) {
      showToast(error.message);
    }
  }

  function openSettings() {
    document.querySelector("[data-disconnect-setting]").value = localStorage.getItem(preferenceKey) || "ask";
    settingsDialog.showModal();
  }

  function renderAutomatic(items) {
    if (!items.length) {
      automaticNode.replaceChildren(element("div", "empty", "No automatic work is active."));
      return;
    }
    automaticNode.replaceChildren(...items.map((item) => {
      const card = element("article", "work-card");
      const title = element("div");
      title.append(element("h3", "", item.job_title || "Untitled job"));
      title.append(element("p", "", `${item.company || "Unknown company"} · ${item.site}`));
      appendResumeTag(title, item.resume_file);
      card.append(title, element("span", `pill ${item.status}`, item.status.replaceAll("_", " ")));
      card.append(element("p", "detail", item.detail || "Working."));
      return card;
    }));
  }

  function renderResumeRoutes(items, directory) {
    setText("[data-resume-directory]", directory || "No artifact directory configured.");
    if (!items.length) {
      resumeRoutesNode.replaceChildren(element("div", "empty", "No generated resume artifacts found."));
      return;
    }
    resumeRoutesNode.replaceChildren(...items.map((item) => {
      const card = element("article", "resume-route-card");
      const heading = element("div", "resume-route-heading");
      heading.append(element("h3", "", item.label || item.filename));
      const state = item.artifact_ready && item.routing_ready ? "ready" : "needs setup";
      heading.append(element("span", `pill ${state === "ready" ? "submitted" : "failed"}`, state));
      card.append(heading, element("p", "resume-filename", item.filename));
      card.append(element(
        "p",
        "detail",
        item.terms?.length ? `Search matches: ${item.terms.join(" · ")}` : "No search terms configured; this resume will not be selected automatically.",
      ));
      if (item.is_default) card.append(element("span", "pill queued", "default fallback"));
      return card;
    }));
  }

  function appendResumeTag(node, filename) {
    if (!filename) return;
    node.append(element("p", "resume-tag", `Resume to use: ${filename}`));
  }

  function renderInterventions(items) {
    if (!items.length) {
      interventionsNode.replaceChildren(element("div", "empty", "Nothing needs human intervention."));
      return;
    }
    const groups = ACTIONS.map(([action, label]) => {
      const actionItems = items.filter((item) => item.action === action);
      if (!actionItems.length) return null;
      const section = element("section", "action-group");
      const heading = element("div", "action-heading");
      heading.append(element("h3", "", label), element("span", "", actionItems.length));
      section.append(heading);
      [...new Set(actionItems.map((item) => item.site))].forEach((site) => {
        const siteGroup = element("div", "site-group");
        siteGroup.append(element("h4", "site-heading", site));
        actionItems.filter((item) => item.site === site).forEach((item) => siteGroup.append(interventionCard(item)));
        section.append(siteGroup);
      });
      return section;
    }).filter(Boolean);
    interventionsNode.replaceChildren(...groups);
  }

  function renderLivePages(items) {
    const signature = JSON.stringify(items.map((item) => [
      item.target_id, item.page_role, item.group, item.action, item.status, item.title, item.safe_path,
    ]));
    if (signature === livePagesSignature) return;
    livePagesSignature = signature;
    if (!items.length) {
      livePagesNode.replaceChildren(element("div", "empty", "No registered job-search or application pages are open."));
      return;
    }
    const groups = [["search", "Search tabs"], ["application", "Application tabs"]].map(([role, label]) => {
      const matching = items.filter((item) => item.page_role === role);
      if (!matching.length) return null;
      const section = element("section", "live-group");
      section.append(element("h3", "live-group-title", label));
      const grid = element("div", "preview-grid");
      matching.forEach((item) => grid.append(liveCard(item)));
      section.append(grid);
      return section;
    }).filter(Boolean);
    livePagesNode.replaceChildren(...groups);
  }

  function liveCard(item) {
    const card = element("article", "preview-card");
    const body = element("div", "preview-body");
    body.append(element("h3", "", item.application_reference || item.title || "Indeed page"));
    body.append(element("p", "", `${item.site} · ${item.safe_path}`));
    body.append(element("span", `pill ${item.status}`, String(item.action || item.status).replaceAll("_", " ")));
    body.append(element("span", `pill ${item.group}`, item.group === "human_intervention" ? "needs human" : "automatic"));
    if (item.question_labels?.length) {
      body.append(element("p", "detail", item.question_labels.join(" · ")));
    }
    const focus = element("button", "button ghost", "Open / Focus tab");
    focus.type = "button";
    focus.addEventListener("click", () => focusTarget(item.target_id));
    body.append(focus);
    if (item.preview_url) {
      const image = document.createElement("img");
      image.alt = `Live preview: ${item.title || item.site}`;
      image.loading = "lazy";
      image.dataset.previewUrl = item.preview_url;
      image.src = `${item.preview_url}?revision=${Date.now()}`;
      image.addEventListener("click", () => focusTarget(item.target_id));
      card.append(image);
    }
    card.append(body);
    return card;
  }

  async function focusTarget(targetId) {
    try {
      await post(`/api/job-finder/targets/${encodeURIComponent(targetId)}/focus`);
      showToast("Browser tab focused.");
    } catch (error) { showToast(error.message); }
  }

  function renderGoalItems(node, items, goal) {
    if (!items.length) {
      node.replaceChildren();
      return;
    }
    node.replaceChildren(...items.map((item) => {
      const card = element("article", "work-card goal-item");
      const body = element("div");
      body.append(element("h3", "", item.job_title));
      body.append(element("p", "", `${item.company} · ${item.site}`));
      appendResumeTag(body, item.resume_file);
      body.append(element("p", "detail", item.detail || "Goal item updated."));
      const badge = element("span", `pill ${item.state}`, item.state.replaceAll("_", " "));
      card.append(body, badge);
      if (item.state === "reserved") {
        const actions = element("div", "work-actions");
        const confirm = element("button", "button", "Confirm submitted");
        confirm.type = "button";
        confirm.addEventListener("click", () => goalItemAction(goal.id, item.task_id, "confirm"));
        const release = element("button", "button ghost", "Abandon / Release token");
        release.type = "button";
        release.addEventListener("click", () => goalItemAction(goal.id, item.task_id, "release"));
        actions.append(confirm, release);
        card.append(actions);
      } else if (item.state === "human_handoff" && item.can_review_in_control_center) {
        const actions = element("div", "work-actions review-actions");
        const approve = element("button", "button", "Looks right — continue safely");
        approve.type = "button";
        approve.addEventListener("click", () => goalItemAction(goal.id, item.task_id, "review-approve"));
        const skip = element("button", "button ghost", "Skip job");
        skip.type = "button";
        skip.addEventListener("click", () => goalItemAction(goal.id, item.task_id, "release"));
        actions.append(approve, skip);
        card.append(actions);
      }
      return card;
    }));
  }

  async function goalItemAction(goalId, taskId, action) {
    try {
      await post(`/api/job-finder/goals/${encodeURIComponent(goalId)}/items/${encodeURIComponent(taskId)}/${action}`);
      const message = action === "confirm"
        ? "Submission confirmed; quota decremented."
        : action === "review-approve"
          ? "Review accepted; safe replay started. Unknown salary still does not count toward quota."
          : "Job skipped and token released.";
      showToast(message);
      refresh();
    } catch (error) { showToast(error.message); }
  }

  function interventionCard(item) {
    const card = element("article", "work-card");
    const body = element("div");
    body.append(element("h3", "", item.application_reference || "Application"));
    body.append(element("p", "", item.instruction || item.reason));
    if (item.action === "external_application" && item.domain) {
      body.append(element("p", "detail", `Destination: ${item.domain}`));
    }
    appendResumeTag(body, item.resume_file);
    if (item.question_labels?.length) {
      const list = element("ul", "question-list");
      item.question_labels.forEach((label) => list.append(element("li", "", label)));
      body.append(list);
    }
    if (item.layout_fingerprint) {
      body.append(element("p", "detail", "Layout fingerprint: " + item.layout_fingerprint));
    }
    if (item.artifact_path) {
      body.append(element("p", "detail", "Review artifact: " + item.artifact_path));
    }
    const actions = element("div", "work-actions");
    (item.actions || []).forEach((action) => {
      const labels = {
        focus: "Focus tab",
        reopen: "Reopen in Brave",
        recheck: "Recheck",
        approve_question: "Save answers & continue",
        approve_resume: item.action === "resume_upload" ? "Approve resume upload" : "Approve resume Continue",
        confirm_external: "Confirm submitted",
        confirm: "Confirm submitted",
        review_approve: "Looks right — continue safely",
        retry: "Retry safely",
        release: "Skip / Release",
      };
      const className = action === "release" ? "button ghost" : "button";
      const button = element("button", className, labels[action] || action.replaceAll("_", " "));
      button.type = "button";
      button.disabled = ["recheck", "approve_question", "approve_resume"].includes(action) && !item.can_focus;
      button.addEventListener("click", () => workItemAction(item, action));
      actions.append(button);
    });
    card.append(body, actions);
    return card;
  }

  async function workItemAction(item, action) {
    if (["confirm", "confirm_external"].includes(action)) {
      const accepted = window.confirm(
        "Confirm that you submitted the application for " + item.company + " — " + item.job_title + "?",
      );
      if (!accepted) return;
    }
    if (item.source === "goal") {
      const goalAction = action === "review_approve" ? "review-approve" : action;
      await goalItemAction(latestState.goal.id, item.task_id, goalAction);
      return;
    }
    if (action === "approve_question") return approveQuestionAnswers(item.id);
    if (action === "approve_resume") return approveResumeGate(item.id);
    const endpointAction = action === "confirm_external" ? "confirm-submitted" : action;
    try {
      await post("/api/job-finder/interventions/" + encodeURIComponent(item.id) + "/" + endpointAction);
      showToast(action === "release"
        ? "Job skipped and token released."
        : String(action).replaceAll("_", " ") + " completed.");
      refresh();
    } catch (error) { showToast(error.message); }
  }

  function autoRecheck(items) {
    const now = Date.now();
    items.filter((item) => item.can_focus && ["captcha", "human_verification", "sign_in"].includes(item.action))
      .forEach((item) => {
        const previous = autoRecheckedAt.get(item.id) || 0;
        if (now - previous < 10000) return;
        autoRecheckedAt.set(item.id, now);
        post(`/api/job-finder/interventions/${encodeURIComponent(item.id)}/recheck`)
          .then((result) => { if (result.resolved) refresh(); })
          .catch(() => {});
      });
  }

  async function approveQuestionAnswers(id) {
    try {
      const result = await post(`/api/job-finder/interventions/${encodeURIComponent(id)}/approve-question-answers`);
      showToast(`${result.saved_answers || 0} safe answer(s) saved; deterministic replay started.`);
      refresh();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function approveResumeGate(id) {
    try {
      const result = await post(`/api/job-finder/interventions/${encodeURIComponent(id)}/approve-resume-gate`);
      showToast(`${String(result.action || "resume").replaceAll("_", " ")} approved; replay started.`);
      refresh();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function interventionAction(id, action) {
    try {
      const result = await post(`/api/job-finder/interventions/${encodeURIComponent(id)}/${action}`);
      showToast(
        action === "focus"
          ? "Browser tab focused."
          : action === "reopen"
            ? "Verification page reopened in Brave."
            : result.reason || "Intervention rechecked.",
      );
      window.setTimeout(refresh, 600);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function post(url) {
    const response = await fetch(url, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  async function postJSON(url, value) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  async function putJSON(url, value) {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail?.[0]?.msg || "Request failed.");
    return payload;
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.classList.add("show");
    toastTimer = window.setTimeout(() => toastNode.classList.remove("show"), 3500);
  }

  applyLocationView();
  post("/api/job-finder/market-fit/refresh").catch(() => {}).finally(refresh);
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 2000);
  window.setInterval(() => {
    if (document.hidden) return;
    document.querySelectorAll("img[data-preview-url]").forEach((image) => {
      image.src = `${image.dataset.previewUrl}?revision=${Date.now()}`;
    });
  }, 15000);
})();
