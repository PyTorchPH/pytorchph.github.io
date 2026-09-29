(function () {
  const stateNode = document.querySelector("#onboarding-state");
  const decision = document.querySelector("[data-decision-card]");
  const errorNode = document.querySelector("[data-error]");
  let state = JSON.parse(stateNode.textContent);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    if (state.ready) {
      window.location.replace(state.next_url || "/dashboard");
      return;
    }
    renderSteps();
    renderSource();
    decision.replaceChildren();
    errorNode.textContent = "";
    if (state.phase === "error") return renderSystemError();
    if (state.phase === "job_preferences") return renderPreferences();
    renderCorrection(state.current_blocker || {});
  }

  function renderSteps() {
    const order = ["resume_source", "correction", "job_preferences", "ready"];
    const current = Math.max(0, order.indexOf(state.phase));
    document.querySelectorAll("[data-step]").forEach((node, index) => {
      node.classList.toggle("active", index === current);
      node.classList.toggle("complete", index < current || state.phase === "ready");
    });
  }

  function renderSource() {
    const source = state.source || {};
    document.querySelector("[data-source-label]").textContent = source.label || "Resume source";
    const profile = state.profile || {};
    document.querySelector("[data-profile-summary]").textContent = [
      profile.name || "Profile name awaiting verification",
      profile.country || "Contact country awaiting verification",
      profile.phone_configured ? "verified phone available" : "phone awaiting verification",
    ].join(" · ");
    const cards = (source.resumes || []).map((resume) => {
      const card = element("article", "resume-card");
      card.append(
        element("strong", "", resume.label),
        element("span", "", `${resume.project_count} projects · ${resume.skill_group_count} skill groups`),
      );
      return card;
    });
    document.querySelector("[data-resume-grid]").replaceChildren(...cards);
  }

  function renderSystemError() {
    decision.append(
      element("p", "eyebrow", "System attention required"),
      element("h2", "", "Resume artifacts could not be loaded"),
      element("p", "", "The dashboard remains blocked because its evidence source is incomplete."),
    );
    const list = element("ul", "system-errors");
    (state.source?.errors || []).forEach((message) => list.append(element("li", "", message)));
    decision.append(list);
  }

  function renderCorrection(blocker) {
    decision.append(
      element("p", "eyebrow", "Required correction"),
      element("h2", "", blocker.title || "Verify profile information"),
      element("p", "", blocker.description || "This fact is required for safe automation."),
    );
    const form = element("form", "decision-form");
    const grid = element("div", "form-grid");
    const prefill = blocker.prefill || {};
    const fields = {
      name: [["first_name", "First name"], ["last_name", "Last name"]],
      country: [["country_name", "Contact country"], ["country_iso", "Country ISO (for example PH)"], ["phone_calling_code", "Calling code (for example +63)"]],
      phone: [["verified_phone", "Verified phone number"]],
    }[blocker.field] || [];
    fields.forEach(([name, labelText]) => {
      const label = element("label", "");
      const input = element("input", "");
      input.name = name;
      input.required = true;
      input.value = prefill[name] || "";
      input.autocomplete = name === "verified_phone" ? "tel" : "off";
      label.append(element("span", "", labelText), input);
      grid.append(label);
    });
    const button = element("button", "", "Save and continue");
    button.type = "submit";
    form.append(grid, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      await submit(`/api/onboarding/corrections/${encodeURIComponent(blocker.field)}`, "POST", { values }, button);
    });
    decision.append(form);
  }

  function renderPreferences() {
    decision.append(
      element("p", "eyebrow", "Final setup decision"),
      element("h2", "", "Choose the first safe automation goal"),
      element("p", "", "The system will wait for a verified Indeed session, then start this bounded goal once."),
    );
    const form = element("form", "decision-form");
    form.innerHTML = `
      <div class="form-grid">
        <label><span>Applications needed</span><input name="target" type="number" min="1" max="100" value="3" required></label>
        <label><span>Work mode</span><select name="work_mode"><option value="remote">Remote</option></select></label>
        <label><span>Job type</span><select name="employment_type"><option value="contract">Contract</option></select></label>
      </div>
      <fieldset><legend>Target countries (optional — defaults to Philippines)</legend>
        <label><input name="target_countries" type="checkbox" value="Philippines"> Philippines</label>
        <label><input name="target_countries" type="checkbox" value="Australia"> Australia</label>
        <label><input name="target_countries" type="checkbox" value="Canada"> Canada</label>
      </fieldset>
      <label class="consent"><input name="safe_auto_start" type="checkbox" required> Start safe automation after a verified Indeed connection. Stop before sensitive fields, resume upload, questionnaires, Review, and Submit.</label>
      <button type="submit">Save goal and open dashboard</button>`;
    const button = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const countries = data.getAll("target_countries");
      await submit("/api/onboarding/job-preferences", "PUT", {
        target: Number(data.get("target")),
        target_countries: countries,
        work_mode: data.get("work_mode"),
        employment_type: data.get("employment_type"),
        safe_auto_start: data.get("safe_auto_start") === "on",
      }, button);
    });
    decision.append(form);
  }

  async function submit(url, method, payload, button) {
    button.disabled = true;
    errorNode.textContent = "";
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The setup step could not be saved.");
      state = result;
      render();
    } catch (error) {
      showError(error.message);
      button.disabled = false;
    }
  }

  function showError(message) {
    errorNode.textContent = message;
  }

  render();
}());
