#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  MicrotaskCoalescer,
  SubmissionStore,
  applyTriggerDecision,
  automationResumeDecision,
  classifyApplyDestination,
  cleanListingIdentity,
  isExactIndeedConfirmation,
} from "./indeed_event_watcher_core.mjs";
import { enqueueExternalHandoff } from "./external_handoff_queue.mjs";

const BINDING = "__pytorchFitIndeedEvent";
const INJECT = `(() => {
  if (globalThis.__pytorchFitIndeedWatcherInstalled) return;
  globalThis.__pytorchFitIndeedWatcherInstalled = true;
  const emit = kind => {
    try { globalThis.${BINDING}(JSON.stringify({ kind })); } catch {}
  };
  const visible = element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
  };
  const applyControl = target => {
    const element = target instanceof Element
      ? target.closest("[data-testid=indeedApplyButton], button, a")
      : null;
    if (!element || !visible(element) || element.matches(":disabled, [aria-disabled=true]")) {
      return null;
    }
    const label = (element.textContent || element.getAttribute("aria-label") || "")
      .replace(/\\s+/g, " ")
      .trim();
    return /^(apply now|apply with indeed|apply on company site)$/i.test(label) ? element : null;
  };
  addEventListener("click", event => emit(applyControl(event.target) ? "apply_click" : "click"), true);
  addEventListener("change", () => emit("change"), true);
  addEventListener("input", () => emit("input"), true);
  addEventListener("focus", () => emit("focus"), true);
  new MutationObserver(() => emit("mutation")).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  emit("ready");
})()`;
const SNAPSHOT = `(() => {
  const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim();
  const visible = element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
  };
  const activeChallenge = [...document.querySelectorAll(
    "[data-testid*=challenge], form[action*=captcha], #challenge-running, .cf-challenge"
  )].some(visible);
  const blocked = activeChallenge ||
    /verify you are human|verification required|access denied|rate limited|too many requests/i.test(text);
  const titleElement = document.querySelector("h1");
  const title = (titleElement?.innerText || titleElement?.getAttribute("aria-label") || "")
    .replace(/\\s+/g, " ")
    .trim();
  const companyElement = (
    document.querySelector("[data-testid=inlineHeader-companyName]") ||
    document.querySelector("[data-company-name=true]")
  );
  const company = (
    companyElement?.innerText ||
    companyElement?.getAttribute("aria-label") ||
    ""
  ).replace(/\\s+/g, " ").trim();
  const applyCandidates = [...document.querySelectorAll(
    "[data-testid=indeedApplyButton], button, a"
  )];
  const applyElement = applyCandidates.find(element => {
    if (!visible(element) || element.matches(":disabled, [aria-disabled=true]")) return false;
    const label = (element.textContent || element.getAttribute("aria-label") || "")
      .replace(/\\s+/g, " ")
      .trim();
    return /^(apply now|apply with indeed|apply on company site)$/i.test(label);
  });
  const applyText = (applyElement?.textContent || applyElement?.getAttribute("aria-label") || "")
    .replace(/\\s+/g, " ")
    .trim();
  const applyKind = !applyElement
    ? ""
    : /company site/i.test(applyText)
      ? "company_site"
      : /indeed/i.test(applyText) || applyElement.matches("[data-testid=indeedApplyButton]")
        ? "indeed"
        : "generic";
  return {
    href: location.href,
    host: location.hostname.toLowerCase(),
    path: location.pathname,
    visibleText: text,
    accessBlocked: blocked,
    listingTitle: title,
    listingCompany: company,
    applyControl: applyElement ? { kind: applyKind, text: applyText } : null
  };
})()`;
function parseArgs(argv) {
  const values = {
    cdpUrl: "http://127.0.0.1:9222",
    database: resolve("var/state/job-applications/submissions.sqlite3"),
    state: resolve("var/state/job-applications/indeed-event-watcher.json"),
    manifest: [],
    reconnectSeconds: 5,
    maxTabs: 6,
    autoOpenApply: false,
    resumeRunner: "",
    artifactDir: "",
    queue: resolve("var/state/job-applications/verification-queue.json"),
    runnerOutput: resolve("out/indeed-event-resume"),
    phoneCountryCallingCode: "",
    phoneCountryIso: "",
    savedPhoneOriginalCallingCode: "",
    autonomousSubmit: false,
    questionAiProvider: "off",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--cdp-url") values.cdpUrl = value;
    else if (flag === "--database") values.database = resolve(value);
    else if (flag === "--state") values.state = resolve(value);
    else if (flag === "--manifest") values.manifest.push(resolve(value));
    else if (flag === "--reconnect-seconds") values.reconnectSeconds = Number(value);
    else if (flag === "--max-tabs") values.maxTabs = Number(value);
    else if (flag === "--auto-open-apply") {
      values.autoOpenApply = true;
      continue;
    }
    else if (flag === "--resume-runner") values.resumeRunner = resolve(value);
    else if (flag === "--artifact-dir") values.artifactDir = resolve(value);
    else if (flag === "--queue") values.queue = resolve(value);
    else if (flag === "--runner-output") values.runnerOutput = resolve(value);
    else if (flag === "--phone-country-calling-code") values.phoneCountryCallingCode = value;
    else if (flag === "--phone-country-iso") values.phoneCountryIso = value;
    else if (flag === "--saved-phone-original-calling-code") {
      values.savedPhoneOriginalCallingCode = value;
    }
    else if (flag === "--question-ai-provider") values.questionAiProvider = value;
    else if (flag === "--autonomous-submit") {
      values.autonomousSubmit = true;
      continue;
    }
    else if (flag === "--help") {
      console.log(
        "Usage: indeed_event_watcher.mjs [--cdp-url URL] [--database PATH] " +
          "[--state PATH] [--manifest PATH] [--reconnect-seconds N] [--max-tabs N] " +
          "[--auto-open-apply] " +
          "[--resume-runner PATH --artifact-dir PATH --phone-country-calling-code CODE " +
          "--phone-country-iso ISO] [--autonomous-submit]",
      );
      process.exit(0);
    } else continue;
    index += 1;
  }
  if (!Number.isFinite(values.reconnectSeconds) || values.reconnectSeconds < 1) {
    throw new Error("--reconnect-seconds must be at least 1");
  }
  if (!Number.isInteger(values.maxTabs) || values.maxTabs < 1 || values.maxTabs > 24) {
    throw new Error("--max-tabs must be an integer between 1 and 24");
  }
  if (values.resumeRunner) {
    if (!values.artifactDir) throw new Error("--artifact-dir is required with --resume-runner");
    if (!values.phoneCountryCallingCode || !values.phoneCountryIso) {
      throw new Error("phone country calling code and ISO are required with --resume-runner");
    }
  }
  if (values.autonomousSubmit && (!values.autoOpenApply || !values.resumeRunner)) {
    throw new Error(
      "--autonomous-submit requires both --auto-open-apply and --resume-runner",
    );
  }
  if (!["google", "off"].includes(values.questionAiProvider)) {
    throw new Error("--question-ai-provider must be google or off");
  }
  return values;
}

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function taskFromJob(job) {
  return {
    ...job,
    task_id: String(job.task_id ?? ""),
    company: String(job.company ?? "").trim(),
    job_title: String(job.job_title ?? "").trim(),
    listing_url: String(job.listing_url ?? ""),
    target_country: String(job.target_country ?? ""),
    work_mode: String(job.work_mode ?? ""),
    resume_file: String(job.resume_file ?? ""),
  };
}

function jobKey(value) {
  try {
    return new URL(value).searchParams.get("jk") ?? "";
  } catch {
    return "";
  }
}

function safeListingUrl(value) {
  try {
    const url = new URL(value);
    const key = url.searchParams.get("jk");
    return `${url.origin}${url.pathname}${key ? `?jk=${encodeURIComponent(key)}` : ""}`;
  } catch {
    return "";
  }
}

class Cdp {
  constructor(webSocketUrl) {
    this.url = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.closePromise = new Promise((resolveClose) => {
      this.socket.addEventListener("close", resolveClose, { once: true });
    });
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolveMessage, rejectMessage } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) rejectMessage(new Error(message.error.message));
        else resolveMessage(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, { resolveMessage, rejectMessage });
      this.socket.send(JSON.stringify(message));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
  }

  closed() {
    return this.closePromise;
  }

  close() {
    this.socket.close();
  }
}

class IndeedEventWatcher {
  constructor(cdp, options, store) {
    this.cdp = cdp;
    this.options = options;
    this.store = store;
    this.coalescer = new MicrotaskCoalescer();
    this.sessions = new Map();
    this.targetTasks = new Map();
    this.confirmedTargets = new Set();
    this.manifestTasks = [];
    this.consumedManifestFallbacks = new Set();
    this.automationStates = new Map();
    this.activeAutomationTargetId = "";
    this.pendingAutomationTargets = new Set();
    this.applyTransitions = new Map();
    this.destinationTimers = new Map();
    this.stateWrite = Promise.resolve();
  }

  async initialize() {
    const state = await loadJson(this.options.state, {
      target_tasks: {},
      consumed_manifest_fallbacks: [],
    });
    for (const [targetId, task] of Object.entries(state.target_tasks ?? {})) {
      this.targetTasks.set(targetId, task);
    }
    for (const taskId of state.consumed_manifest_fallbacks ?? []) {
      this.consumedManifestFallbacks.add(taskId);
    }
    await this.reloadManifests();
    let hydratedTasks = 0;
    for (const [targetId, task] of this.targetTasks.entries()) {
      const key = jobKey(task.listing_url);
      const matched = this.manifestTasks.find(
        (candidate) => key && jobKey(candidate.listing_url) === key,
      );
      if (matched) {
        this.targetTasks.set(targetId, matched);
        hydratedTasks += 1;
      }
    }
    this.cdp.onEvent((message) => this.onEvent(message));
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
    await this.cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const { targetInfos } = await this.cdp.send("Target.getTargets");
    const pageTargets = targetInfos.filter((item) => item.type === "page");
    const activeTargetIds = new Set(pageTargets.map((target) => target.targetId));
    for (const targetId of this.targetTasks.keys()) {
      if (!activeTargetIds.has(targetId)) {
        this.targetTasks.delete(targetId);
      }
    }
    await atomicWriteJson(this.options.state, {
      target_tasks: Object.fromEntries(this.targetTasks),
      consumed_manifest_fallbacks: [...this.consumedManifestFallbacks],
      updated_at: new Date().toISOString(),
    });
    if (hydratedTasks) {
      log("stored_tasks_hydrated", {
        hydratedTasks,
        activeTasks: this.targetTasks.size,
      });
    }
    for (const target of pageTargets) {
      try {
        await this.cdp.send("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
      } catch (error) {
        if (!String(error.message).includes("already attached")) throw error;
      }
    }
  }

  async reloadManifests() {
    const tasks = [];
    for (const path of this.options.manifest) {
      const payload = await loadJson(path, { jobs: [] });
      for (const job of payload.jobs ?? []) {
        const task = taskFromJob(job);
        if (task.company && task.job_title) tasks.push(task);
      }
    }
    this.manifestTasks = tasks;
  }

  async onEvent(message) {
    try {
      if (message.method === "Target.attachedToTarget") {
        await this.attach(message.params.sessionId, message.params.targetInfo);
      } else if (message.method === "Target.targetInfoChanged") {
        const session = [...this.sessions.entries()].find(
          ([, value]) => value.targetId === message.params.targetInfo.targetId,
        );
        if (session) this.schedule(session[0], "target_info_changed");
      } else if (
        message.method === "Page.frameNavigated" ||
        message.method === "Runtime.bindingCalled"
      ) {
        if (
          message.method !== "Runtime.bindingCalled" ||
          message.params.name === BINDING
        ) {
          let reason = message.method;
          if (message.method === "Runtime.bindingCalled") {
            try {
              reason = JSON.parse(message.params.payload).kind || reason;
            } catch {}
          }
          if (reason === "apply_click") {
            this.recordApplyClick(message.sessionId);
          }
          this.schedule(message.sessionId, reason);
        }
      } else if (message.method === "Target.detachedFromTarget") {
        this.sessions.delete(message.params.sessionId);
      } else if (message.method === "Target.targetDestroyed") {
        for (const [sessionId, session] of this.sessions.entries()) {
          if (session.targetId === message.params.targetId) {
            this.sessions.delete(sessionId);
          }
        }
        this.targetTasks.delete(message.params.targetId);
        this.automationStates.delete(message.params.targetId);
        this.pendingAutomationTargets.delete(message.params.targetId);
        this.clearApplyTransition(message.params.targetId);
      }
    } catch (error) {
      log("event_error", { error: error.name });
    }
  }

  async attach(sessionId, targetInfo) {
    if (targetInfo.type !== "page" || this.sessions.has(sessionId)) return;
    this.sessions.set(sessionId, {
      targetId: targetInfo.targetId,
      openerId: targetInfo.openerId ?? "",
    });
    if (!this.targetTasks.has(targetInfo.targetId) && targetInfo.openerId) {
      const openerTask = this.targetTasks.get(targetInfo.openerId);
      if (openerTask) await this.bindTask(targetInfo.targetId, openerTask);
    }
    if (targetInfo.openerId && this.applyTransitions.has(targetInfo.openerId)) {
      const transition = this.applyTransitions.get(targetInfo.openerId);
      transition.targetIds.add(targetInfo.targetId);
      transition.ambiguous = transition.targetIds.size > 2;
      this.applyTransitions.set(targetInfo.targetId, transition);
    }
    await Promise.all([
      this.cdp.send("Page.enable", {}, sessionId),
      this.cdp.send("Runtime.enable", {}, sessionId),
    ]);
    try {
      await this.cdp.send("Runtime.addBinding", { name: BINDING }, sessionId);
    } catch (error) {
      if (!String(error.message).includes("already exists")) throw error;
    }
    await this.cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: INJECT },
      sessionId,
    );
    await this.cdp.send(
      "Runtime.evaluate",
      { expression: INJECT, returnByValue: true },
      sessionId,
    );
    this.schedule(sessionId, "attached");
  }

  schedule(sessionId, reason) {
    if (!sessionId || !this.sessions.has(sessionId)) return;
    this.coalescer.schedule(sessionId, async () => {
      await this.inspect(sessionId, reason);
    });
  }

  async inspect(sessionId, reason) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    let evaluated;
    try {
      evaluated = await this.cdp.send(
        "Runtime.evaluate",
        { expression: SNAPSHOT, returnByValue: true },
        sessionId,
      );
    } catch {
      return;
    }
    const snapshot = evaluated.result?.value;
    if (!snapshot?.href) return;
    if (
      (snapshot.host === "au.indeed.com" || snapshot.host === "ca.indeed.com") &&
      snapshot.path === "/viewjob" &&
      cleanListingIdentity(snapshot.listingCompany) &&
      cleanListingIdentity(snapshot.listingTitle)
    ) {
      const listingCompany = cleanListingIdentity(snapshot.listingCompany);
      const listingTitle = cleanListingIdentity(snapshot.listingTitle);
      const key = jobKey(snapshot.href);
      const matched = this.manifestTasks.find(
        (task) => key && jobKey(task.listing_url) === key,
      );
      await this.bindTask(
        session.targetId,
        matched ?? {
          task_id: key || `${listingCompany}-${listingTitle}`,
          company: listingCompany,
          job_title: listingTitle,
          listing_url: safeListingUrl(snapshot.href),
        },
      );
    }
    if (!this.targetTasks.has(session.targetId)) {
      const key = jobKey(snapshot.href);
      const matched = this.manifestTasks.find(
        (task) => key && jobKey(task.listing_url) === key,
      );
      if (matched) await this.bindTask(session.targetId, matched);
      else if (
        snapshot.host === "smartapply.indeed.com" &&
        this.manifestTasks.length === 1 &&
        !this.consumedManifestFallbacks.has(this.manifestTasks[0].task_id)
      ) {
        this.consumedManifestFallbacks.add(this.manifestTasks[0].task_id);
        await this.bindTask(session.targetId, this.manifestTasks[0]);
      }
    }
    const mappedTask = this.targetTasks.get(session.targetId);
    const transition = this.applyTransitions.get(session.targetId);
    if (transition) {
      const destination = classifyApplyDestination(snapshot.href);
      if (destination.kind === "external_company_site") {
        if (reason !== "external_destination_settled") {
          this.armDestinationSettlement(sessionId, session.targetId);
          return;
        }
        if (transition.ambiguous) {
          log("apply_destination_ambiguous", {
            targetId: session.targetId,
            taskId: transition.task.task_id,
            candidateTargetCount: transition.targetIds.size,
          });
        } else if (!transition.handled) {
          transition.handled = true;
          const entry = await enqueueExternalHandoff(
            this.options.queue,
            transition.task,
            { url: snapshot.href, targetId: session.targetId },
          );
          log("external_application_queued", {
            targetId: session.targetId,
            taskId: transition.task.task_id,
            domain: entry.domain,
            queueEntryId: entry.id,
          });
        }
        this.clearApplyTransition(session.targetId);
        return;
      }
      if (destination.kind === "indeed_smart_apply") {
        this.clearApplyTransition(session.targetId);
      }
    }
    const automationState = this.automationStates.get(session.targetId) ?? {
      running: false,
      handledRouteKey: "",
    };
    if (snapshot.accessBlocked) {
      automationState.handledRouteKey = "";
    }
    this.automationStates.set(session.targetId, automationState);
    const resumeDecision = automationResumeDecision({
      snapshot,
      task: mappedTask,
      runnerEnabled: this.options.autoOpenApply && Boolean(this.options.resumeRunner),
      running: automationState.running,
      handledRouteKey: automationState.handledRouteKey,
    });
    if (resumeDecision.resume) {
      await this.resumeAutomation(
        session.targetId,
        mappedTask,
        resumeDecision.routeKey,
      );
    }
    if (!isExactIndeedConfirmation(snapshot)) return;
    if (this.confirmedTargets.has(session.targetId)) return;
    const task = this.targetTasks.get(session.targetId);
    if (!task) {
      log("confirmation_unmapped", { targetId: session.targetId, reason });
      return;
    }
    const result = this.store.recordConfirmed(task, snapshot.href);
    this.confirmedTargets.add(session.targetId);
    log("confirmation_persisted", {
      taskId: task.task_id,
      company: task.company,
      jobTitle: task.job_title,
      databaseResult: result.status,
      applicationId: result.applicationId,
    });
  }

  recordApplyClick(sessionId) {
    const session = this.sessions.get(sessionId);
    const task = session ? this.targetTasks.get(session.targetId) : null;
    const decision = applyTriggerDecision({
      eventKind: "apply_click",
      enabled: this.options.autoOpenApply,
      mapped: Boolean(session && task),
    });
    if (!decision.trigger) {
      if (decision.reason !== "automatic_apply_disabled") {
        log("apply_click_unmapped", { targetId: session?.targetId ?? "" });
      }
      return;
    }
    this.clearApplyTransition(session.targetId);
    const transition = {
      sourceTargetId: session.targetId,
      task,
      handled: false,
      ambiguous: false,
      targetIds: new Set([session.targetId]),
      expires: setTimeout(() => {
        if (!transition.handled) {
          log("apply_destination_ambiguous", {
            targetId: session.targetId,
            taskId: task.task_id,
          });
        }
        this.clearApplyTransition(session.targetId);
      }, 15_000),
    };
    this.applyTransitions.set(session.targetId, transition);
    for (const child of this.sessions.values()) {
      if (child.openerId === session.targetId) {
        transition.targetIds.add(child.targetId);
        this.applyTransitions.set(child.targetId, transition);
      }
    }
    transition.ambiguous = transition.targetIds.size > 2;
    log("verified_apply_click_observed", {
      targetId: session.targetId,
      taskId: task.task_id,
    });
  }

  armDestinationSettlement(sessionId, targetId) {
    const current = this.destinationTimers.get(targetId);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.destinationTimers.delete(targetId);
      this.schedule(sessionId, "external_destination_settled");
    }, 1_500);
    this.destinationTimers.set(targetId, timer);
  }

  clearApplyTransition(targetId) {
    const transition = this.applyTransitions.get(targetId);
    if (!transition) return;
    clearTimeout(transition.expires);
    for (const [candidateId, candidate] of this.applyTransitions.entries()) {
      if (candidate === transition) this.applyTransitions.delete(candidateId);
    }
    for (const [candidateId, timer] of this.destinationTimers.entries()) {
      if (candidateId === targetId || !this.applyTransitions.has(candidateId)) {
        clearTimeout(timer);
        this.destinationTimers.delete(candidateId);
      }
    }
  }

  async resumeAutomation(targetId, task, routeKey) {
    const state = this.automationStates.get(targetId) ?? {
      running: false,
      handledRouteKey: "",
    };
    if (
      this.activeAutomationTargetId &&
      this.activeAutomationTargetId !== targetId
    ) {
      this.pendingAutomationTargets.add(targetId);
      log("automation_resume_queued", {
        targetId,
        taskId: task.task_id,
        activeTargetId: this.activeAutomationTargetId,
      });
      return;
    }
    this.activeAutomationTargetId = targetId;
    state.running = true;
    state.handledRouteKey = routeKey;
    this.automationStates.set(targetId, state);
    const safeTargetId = targetId.replace(/[^a-zA-Z0-9_-]/g, "");
    const manifestPath = resolve(
      dirname(this.options.state),
      `indeed-event-resume-${safeTargetId}.json`,
    );
    await atomicWriteJson(manifestPath, { jobs: [task] });
    const runnerArgs = [
      resolve("tools/job_finder/run_indeed_unattended.py"),
      "--manifest",
      manifestPath,
      "--artifact-dir",
      this.options.artifactDir,
      "--cdp-url",
      this.options.cdpUrl,
      "--database",
      this.options.database,
      "--queue",
      this.options.queue,
      "--output",
      this.options.runnerOutput,
      "--target-submissions",
      "1",
      "--max-parallel",
      "1",
      "--max-candidates",
      "1",
      "--resource-mode",
      "auto",
      "--max-tabs",
      String(this.options.maxTabs),
      "--verification-wait-minutes",
      "1",
      "--use-saved-contact-phone",
      "--phone-country-calling-code",
      this.options.phoneCountryCallingCode,
      "--phone-country-iso",
      this.options.phoneCountryIso,
      "--questionnaire-store",
      "mongodb",
      "--question-ai-provider",
      this.options.questionAiProvider,
    ];
    if (this.options.savedPhoneOriginalCallingCode) {
      runnerArgs.push(
        "--saved-phone-original-calling-code",
        this.options.savedPhoneOriginalCallingCode,
      );
    }
    if (this.options.autonomousSubmit) {
      runnerArgs.push("--autonomous-submit");
    }
    const child = spawn(this.options.resumeRunner, runnerArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    log("automation_resume_started", {
      targetId,
      taskId: task.task_id,
      routeKey,
      autonomousSubmit: this.options.autonomousSubmit,
      childPid: child.pid,
    });
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      state.running = false;
      if (this.activeAutomationTargetId === targetId) {
        this.activeAutomationTargetId = "";
      }
      return true;
    };
    child.once("error", (error) => {
      if (!finish()) return;
      state.handledRouteKey = "";
      log("automation_resume_error", {
        targetId,
        taskId: task.task_id,
        error: error.name,
      });
      this.releaseNextAutomation();
    });
    child.once("exit", (code, signal) => {
      if (!finish()) return;
      log("automation_resume_finished", {
        targetId,
        taskId: task.task_id,
        exitCode: code,
        signal: signal ?? "",
      });
      this.releaseNextAutomation();
    });
  }

  releaseNextAutomation() {
    const nextTargetId = this.pendingAutomationTargets.values().next().value;
    if (!nextTargetId) return;
    this.pendingAutomationTargets.delete(nextTargetId);
    const state = this.automationStates.get(nextTargetId);
    if (state) {
      state.handledRouteKey = "";
    }
    const session = [...this.sessions.entries()].find(
      ([, item]) => item.targetId === nextTargetId,
    );
    if (session) {
      this.schedule(session[0], "automation_queue_released");
    }
  }

  async bindTask(targetId, task) {
    const current = this.targetTasks.get(targetId);
    if (
      current?.company === task.company &&
      current?.job_title === task.job_title
    ) {
      return;
    }
    this.targetTasks.set(targetId, task);
    this.stateWrite = this.stateWrite.then(() =>
      atomicWriteJson(this.options.state, {
        target_tasks: Object.fromEntries(this.targetTasks),
        consumed_manifest_fallbacks: [...this.consumedManifestFallbacks],
        updated_at: new Date().toISOString(),
      }),
    );
    await this.stateWrite;
    log("task_bound", {
      targetId,
      taskId: task.task_id,
      company: task.company,
      jobTitle: task.job_title,
    });
  }
}

async function browserWebSocket(cdpUrl) {
  const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`);
  if (!response.ok) throw new Error(`CDP version endpoint returned ${response.status}`);
  const payload = await response.json();
  if (!payload.webSocketDebuggerUrl) throw new Error("CDP browser WebSocket URL is unavailable");
  return payload.webSocketDebuggerUrl;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await Promise.all([
    mkdir(dirname(options.state), { recursive: true }),
    mkdir(dirname(options.database), { recursive: true }),
  ]);
  await writeFile(resolve(dirname(options.state), ".indeed-event-watcher-ready"), "", {
    flag: "a",
  });
  const store = new SubmissionStore(options.database);
  let stopping = false;
  let active;
  const stop = () => {
    stopping = true;
    active?.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try {
      active = new Cdp(await browserWebSocket(options.cdpUrl));
      await active.open();
      const watcher = new IndeedEventWatcher(active, options, store);
      await watcher.initialize();
      log("watching", { cdpUrl: options.cdpUrl, database: options.database });
      await active.closed();
    } catch (error) {
      log("connection_wait", { error: error.name });
    }
    if (!stopping) {
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, options.reconnectSeconds * 1000),
      );
    }
  }
  store.close();
}

await main();
