import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function clean(value, limit) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

export function sanitizeExternalApplicationUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("external application URL must use HTTP(S)");
  }
  return `${url.protocol}//${url.host}${url.pathname || "/"}`;
}

function entryId(domain, applicationReference) {
  return createHash("sha256")
    .update(`${domain}\n${applicationReference}\nexternal_application`)
    .digest("hex")
    .slice(0, 20);
}

async function loadQueue(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function enqueueExternalHandoff(path, task, destination) {
  const safeUrl = sanitizeExternalApplicationUrl(destination.url);
  const domain = new URL(safeUrl).hostname.toLowerCase();
  const company = clean(task.company, 160);
  const jobTitle = clean(task.job_title, 200);
  if (!company || !jobTitle) throw new Error("external handoff requires company and job title");
  const applicationReference = clean(
    task.application_reference || `${company} — ${jobTitle}`,
    200,
  );
  const id = entryId(domain, applicationReference);
  const payload = await loadQueue(path);
  const existing = payload[id];
  const now = new Date().toISOString();
  payload[id] = {
    id,
    application_reference: applicationReference,
    domain,
    url: safeUrl,
    reason: "apply_on_company_site",
    status: "pending",
    created_at: existing?.created_at || now,
    updated_at: now,
    occurrences: Number(existing?.occurrences || 0) + 1,
    browser_target_id: clean(destination.targetId, 160) || existing?.browser_target_id || "",
    group: "human_intervention",
    action: "external_application",
    question_labels: [],
    task_id: clean(task.task_id, 160),
    company,
    job_title: jobTitle,
    goal_id: clean(task.goal_id, 160),
    resume_file: clean(task.resume_file, 160).split(/[\\/]/).pop() || "",
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return payload[id];
}
