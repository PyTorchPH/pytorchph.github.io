import { aiClear, aiStatus, type LocalAIStatus } from "./local-ai.js";

// The popup is the only extension page that can ask Chrome for a custom endpoint's host
// permission (it needs a click). It shows the local AI status but never the key.
const statusLine = document.getElementById("ai-status") as HTMLParagraphElement;
const grantButton = document.getElementById("ai-grant") as HTMLButtonElement;
const clearButton = document.getElementById("ai-clear") as HTMLButtonElement;

function describe(status: LocalAIStatus) {
  if (!status.configured) return "No AI connection. Set one up in the portal's Settings; your key stays in this browser.";
  const endpoint = status.baseUrl ? ` · ${new URL(status.baseUrl).host}` : "";
  return `${status.provider} · ${status.model}${endpoint} · key ${status.apiKeyPresent ? "saved in this browser" : "not set"}`;
}

async function render() {
  const status = await aiStatus();
  statusLine.textContent = describe(status);
  clearButton.hidden = !status.configured;
  grantButton.hidden = !status.permissionNeeded;
  if (status.permissionNeeded) grantButton.textContent = `Allow access to ${status.permissionNeeded.replace(/\/\*$/, "")}`;
  grantButton.dataset.origin = status.permissionNeeded ?? "";
}

grantButton.addEventListener("click", async () => {
  const origin = grantButton.dataset.origin;
  if (!origin) return;
  await chrome.permissions.request({ origins: [origin] });
  await render();
});

clearButton.addEventListener("click", async () => {
  await aiClear();
  await render();
});

void render();
