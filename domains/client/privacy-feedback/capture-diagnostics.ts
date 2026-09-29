// Diagnostics a member can choose to attach to a bug report: recent console messages,
// a sanitized snapshot of the page, and a compressed screenshot. Everything is redacted
// in the browser before it leaves the device.

export type LogEntry = { level: "error" | "warn" | "info"; message: string; at: string };

const MAX_LOG_ENTRIES = 50;
const MAX_LOG_MESSAGE = 500;
const MAX_PAGE_STATE = 120_000;
const MAX_SCREENSHOT_BYTES = 250_000;
const SCREENSHOT_WIDTH = 1280;

const logBuffer: LogEntry[] = [];
let consoleCaptureInstalled = false;

export function redactText(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]")
    .replace(/https?:\/\/\S+/g, "[url redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[secret redacted]");
}

function remember(level: LogEntry["level"], parts: unknown[]) {
  const message = parts.map((part) => part instanceof Error ? `${part.name}: ${part.message}` : typeof part === "string" ? part : (() => { try { return JSON.stringify(part); } catch { return String(part); } })()).join(" ");
  logBuffer.push({ level, message: redactText(message).slice(0, MAX_LOG_MESSAGE), at: new Date().toISOString() });
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
}

/** Keeps the last console errors and warnings (and page errors) in memory only. */
export function installConsoleCapture() {
  if (consoleCaptureInstalled || typeof window === "undefined") return;
  consoleCaptureInstalled = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]) => { remember(level, parts); original(...parts); };
  }
  window.addEventListener("error", (event) => remember("error", [event.message]));
  window.addEventListener("unhandledrejection", (event) => remember("error", [event.reason instanceof Error ? event.reason : "Unhandled promise rejection"]));
}

export function recentLogs(): LogEntry[] {
  return logBuffer.map((entry) => ({ ...entry }));
}

/** The visible page without scripts, form values, event handlers, or the report dialog. */
export function pageStateSnapshot(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, noscript, iframe, object, embed, template, [role='dialog'], [data-radix-portal]").forEach((node) => node.remove());
  clone.querySelectorAll("input, textarea, select").forEach((node) => {
    node.removeAttribute("value");
    if (node instanceof HTMLTextAreaElement) node.textContent = "";
    node.querySelectorAll("option").forEach((option) => option.removeAttribute("selected"));
  });
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith("on") || attribute.name === "srcdoc" || /^(href|src)$/i.test(attribute.name) && /^javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    }
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) text.textContent = redactText(text.textContent ?? "");
  const html = `<!-- ${window.location.pathname} · ${new Date().toISOString()} -->\n${clone.innerHTML}`;
  return html.length > MAX_PAGE_STATE ? `${html.slice(0, MAX_PAGE_STATE)}\n<!-- truncated -->` : html;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Screenshot could not be read."));
    image.src = source;
  });
}

/** Re-encodes a screenshot data URL as a JPEG that fits the upload limit. */
export async function compressScreenshot(dataUrl: string): Promise<string | null> {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, SCREENSHOT_WIDTH / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.7, 0.55, 0.4, 0.3]) {
    const encoded = canvas.toDataURL("image/jpeg", quality);
    if (Math.floor((encoded.length - encoded.indexOf(",") - 1) * 3 / 4) <= MAX_SCREENSHOT_BYTES) return encoded;
  }
  return null;
}
