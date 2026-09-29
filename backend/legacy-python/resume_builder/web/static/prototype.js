(function () {
  const pageButtons = Array.from(document.querySelectorAll("[data-page-target]"));
  const panels = Array.from(document.querySelectorAll("[data-page-panel]"));
  const authLog = document.querySelector("[data-auth-log]");
  const resumeList = document.querySelector("[data-resume-list]");
  const advisorButton = document.querySelector("[data-advisor-run]");
  const advisorOutput = document.querySelector("[data-advisor-output]");
  const advisorSummary = document.querySelector("[data-advisor-summary]");

  function setPage(page) {
    const target = panels.some((panel) => panel.dataset.pagePanel === page)
      ? page
      : "dashboard";
    panels.forEach((panel) => {
      const active = panel.dataset.pagePanel === target;
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    });
    pageButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.pageTarget === target);
    });
    if (window.location.hash !== `#${target}`) {
      window.history.replaceState(null, "", `#${target}`);
    }
    if (target === "dashboard") {
      refreshAuthStatus();
    }
    if (target === "resume") {
      loadResumes();
    }
  }

  pageButtons.forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.pageTarget));
  });
  window.addEventListener("hashchange", () => setPage(window.location.hash.slice(1)));
  setPage(window.location.hash.slice(1) || "dashboard");
  refreshAuthStatus();
  loadResumes();

  document.querySelectorAll("[data-auth-refresh]").forEach((button) => {
    button.addEventListener("click", refreshAuthStatus);
  });

  document.querySelectorAll("[data-social-login]").forEach((button) => {
    button.addEventListener("click", async () => {
      const vendor = button.dataset.socialLogin;
      button.disabled = true;
      writeAuthLog(`Opening visible ${vendor} login...`);
      try {
        const response = await fetch(`/api/social-login/${vendor}`, { method: "POST" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || `Could not start ${vendor} login.`);
        }
        pollJob(payload.job_id);
      } catch (error) {
        writeAuthLog(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-disconnect-provider]").forEach((button) => {
    button.addEventListener("click", async () => {
      const provider = button.dataset.disconnectProvider;
      await postJson(`/api/auth/disconnect/${provider}`);
      refreshAuthStatus();
    });
  });

  document.querySelectorAll("[data-disconnect-social]").forEach((button) => {
    button.addEventListener("click", async () => {
      const vendor = button.dataset.disconnectSocial;
      await postJson(`/api/social-login/${vendor}/disconnect`);
      refreshAuthStatus();
    });
  });

  if (advisorButton) {
    advisorButton.addEventListener("click", runAdvisorDemo);
  }

  async function refreshAuthStatus() {
    try {
      const response = await fetch("/api/auth/status");
      const status = await response.json();
      updateIdentity(status.identity || {}, status.oauth_setup || {});
      updateSocial(status.social || {});
    } catch (error) {
      writeAuthLog(`Status refresh failed: ${error.message}`);
    }
  }

  function updateIdentity(identity, setup) {
    Object.entries(identity).forEach(([provider, state]) => {
      const node = document.querySelector(`[data-provider-status="${provider}"]`);
      const card = document.querySelector(`[data-provider-card="${provider}"]`);
      if (!node || !card) return;
      card.classList.toggle("connected", Boolean(state.connected));
      const providerSetup = setup[provider] || {};
      card.classList.toggle(
        "needs-setup",
        !state.connected && providerSetup.configured === false,
      );
      const profile = state.profile || {};
      if (state.connected) {
        node.textContent = `Connected as ${profile.email || profile.display_name || provider}`;
      } else if (providerSetup.configured === false) {
        node.textContent = `Setup needed: ${(providerSetup.missing || []).join(", ")}`;
      } else {
        node.textContent = "Not connected. Sign in to store identity for social prefill.";
      }
    });
  }

  function updateSocial(social) {
    Object.entries(social).forEach(([vendor, state]) => {
      const node = document.querySelector(`[data-social-status="${vendor}"]`);
      const card = document.querySelector(`[data-social-card="${vendor}"]`);
      if (!node || !card) return;
      card.classList.toggle("connected", Boolean(state.connected));
      node.textContent = state.connected
        ? `Connected. Storage state: ${state.has_storage_state ? "ready" : "cookies only"}`
        : "Not connected. Use visible login before scraping.";
    });
  }

  async function pollJob(jobId) {
    const response = await fetch(`/api/social-login/jobs/${jobId}`);
    const job = await response.json();
    if (!response.ok) {
      writeAuthLog(job.error || "Unknown login job.");
      return;
    }
    writeAuthLog(`${job.vendor}: ${job.status} - ${job.message}`);
    if (job.status === "queued" || job.status === "running") {
      window.setTimeout(() => pollJob(jobId), 1500);
      return;
    }
    refreshAuthStatus();
  }

  async function postJson(url) {
    const response = await fetch(url, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${url}`);
    }
    return payload;
  }

  function writeAuthLog(message) {
    if (!authLog) return;
    authLog.textContent = message;
  }

  async function loadResumes() {
    if (!resumeList || resumeList.dataset.loaded === "true") return;
    try {
      const response = await fetch("/api/resumes");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not load resumes.");
      }
      resumeList.dataset.loaded = "true";
      renderResumes(payload.items || []);
    } catch (error) {
      resumeList.textContent = error.message;
    }
  }

  function renderResumes(items) {
    if (!resumeList) return;
    if (!items.length) {
      resumeList.textContent = "No generated resumes found in out/resumes.";
      return;
    }
    resumeList.replaceChildren(
      ...items.map((item) => {
        const article = document.createElement("article");
        article.className = "row-item";

        const body = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = item.role_id;
        const detail = document.createElement("p");
        detail.textContent = Object.keys(item.formats || {}).join(", ").toUpperCase();
        body.append(title, detail);

        const actions = document.createElement("div");
        actions.className = "format-links";
        Object.entries(item.formats || {}).forEach(([format, url]) => {
          const link = document.createElement("a");
          link.className = "pill blue";
          link.href = url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = format;
          actions.append(link);
        });

        article.append(body, actions);
        return article;
      }),
    );
  }

  async function runAdvisorDemo() {
    if (!advisorOutput) return;
    const payload = readAdvisorPayload();
    advisorButton.disabled = true;
    advisorOutput.textContent = JSON.stringify({ status: "running" }, null, 2);
    try {
      const response = await fetch("/api/cdo/advisor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      advisorOutput.textContent = JSON.stringify(result, null, 2);
      if (!response.ok) {
        return;
      }
      renderAdvisorSummary(result.injection);
    } catch (error) {
      advisorOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
    } finally {
      advisorButton.disabled = false;
    }
  }

  function readAdvisorPayload() {
    const node = document.getElementById("advisor-demo-payload");
    if (!node) {
      return { achievements: [] };
    }
    return JSON.parse(node.textContent || "{}");
  }

  function renderAdvisorSummary(injection) {
    if (!advisorSummary || !injection) return;
    const scores = injection.scores || {};
    const tags = injection.tags || [];
    const questions = injection.questions || [];
    const rows = [
      {
        title: `Readiness score: ${scores.readiness_score ?? 0}%`,
        detail: `${scores.method || "deterministic scoring"}; achievement ${scores.achievement_score ?? 0}%; MCQ ${scores.mcq_score ?? "not answered"}.`,
        pill: "Math",
      },
      {
        title: `${tags.length} competency tags`,
        detail: tags.map((tag) => `${tag.competency} (${tag.category})`).join(", ") || "No tags returned.",
        pill: "Tags",
      },
      {
        title: `${questions.length} MCQ questions`,
        detail: questions.map((question) => question.prompt).join(" "),
        pill: "MCQ",
      },
    ];
    advisorSummary.replaceChildren(
      ...rows.map((row) => {
        const article = document.createElement("article");
        article.className = "row-item";
        const body = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = row.title;
        const detail = document.createElement("p");
        detail.textContent = row.detail;
        const pill = document.createElement("span");
        pill.className = "pill blue";
        pill.textContent = row.pill;
        body.append(title, detail);
        article.append(body, pill);
        return article;
      }),
    );
  }
})();
