import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.MEMBER_BASE_URL ?? process.env.WEB_BASE_URL ?? "http://127.0.0.1:3100";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const title = `Persistent evidence ${Date.now()}`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem("pytorch-ph:tour:/career/evidence:v1", "seen");
    localStorage.setItem("pytorch-ph:tour:/career/resumes:v1", "seen");
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/career/evidence`);
  await page.waitForTimeout(1_000);
  await page.getByText(/Local member demo · Synthetic data · External actions disabled/i).waitFor();

  const manual = page.getByRole("button", { name: "Manual entry", exact: true });
  await manual.waitFor();
  await manual.click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Achievement title").fill(title);
  await editor.getByLabel("Organization").fill("Owner verified organization");
  await editor.getByLabel("Role").fill("Developer");
  await editor.getByLabel("Date").fill("August 2026");
  await editor.getByLabel("Description").fill("Saved through the authenticated product command gateway.");
  await editor.getByLabel("Skills").fill("Python, FastAPI");
  await editor.getByRole("button", { name: "Save & approve" }).click();
  await editor.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: new RegExp(title) }).waitFor();

  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).waitFor();

  const upload = page.locator('input[type="file"]');
  await upload.setInputFiles(path.join(root, "public/demo/evidence/ml-showcase.webp"));
  const uploadEditor = page.getByRole("dialog");
  await uploadEditor.getByRole("heading", { name: "ml-showcase" }).waitFor();
  assert.equal(await uploadEditor.locator('img[src*="/api/product/evidence/media/"]').count(), 1);
  await uploadEditor.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await page.getByRole("button", { name: /ml-showcase/ }).waitFor();

  await page.getByRole("button", { name: /Generic website/ }).click();
  const sourceDialog = page.getByRole("dialog");
  await sourceDialog.getByLabel("Portfolio URL").fill("https://example.test/portfolio");
  await sourceDialog.getByRole("button", { name: "Connect source" }).click();
  await sourceDialog.getByText("Source connection saved.").waitFor();
  await sourceDialog.getByRole("button", { name: "Close", exact: true }).click();
  const sourceState = await page.evaluate(async () => {
    const response = await fetch("/api/product/career-evidence", { cache: "no-store" });
    const payload = await response.json();
    return payload.evidence.sources.find((source) => source.id === "website");
  });
  assert.equal(sourceState.connectionStatus, "connected");
  assert.equal(sourceState.configuredUrl, "https://example.test/portfolio");
  assert.equal(sourceState.lastSyncedAt, null);

  const simulatedSync = await page.evaluate(async () => {
    const response = await fetch("/api/product/sources/website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(simulatedSync.status, 200);
  assert.match(simulatedSync.payload.source.description, /Synthetic local simulation/);
  assert.ok(simulatedSync.payload.source.lastSyncedAt);

  const simulatedConnection = await page.evaluate(async () => {
    const response = await fetch("/api/product/sources/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect" }) });
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(simulatedConnection.status, 200);
  assert.equal(simulatedConnection.payload.source.connectionStatus, "connected");

  await page.goto(`${baseUrl}/career/resumes`);
  const previewResponse = await page.request.get(`${baseUrl}/api/product/resume-preview?template=classic`);
  assert.equal(previewResponse.status(), 200);
  assert.match(previewResponse.headers()["content-type"], /^application\/pdf/);
  assert.match(previewResponse.headers()["content-disposition"], /^inline;.*DEMO-/);
  assert.equal((await previewResponse.body()).subarray(0, 4).toString(), "%PDF");
  const invalidPreview = await page.request.get(`${baseUrl}/api/product/resume-preview?template=https://remote.example/resume.pdf`);
  assert.equal(invalidPreview.status(), 400);
  await page.getByRole("button", { name: /Classic/ }).click();
  const resumeDialog = page.getByRole("dialog");
  await resumeDialog.getByText(/\d+-page PDF generated/).waitFor();
  const viewer = page.frameLocator('[data-testid="resume-pdf-frame"]');
  await viewer.locator('main[data-fit-mode="page"]').waitFor({ timeout: 15_000 });
  await viewer.locator("canvas").waitFor();
  const fit = await viewer.locator("main").evaluate(() => {
    const canvas = document.querySelector("canvas").getBoundingClientRect();
    const surface = document.querySelector('[data-testid="pdf-surface"]').getBoundingClientRect();
    return { canvasWidth: canvas.width, canvasHeight: canvas.height, surfaceWidth: surface.width, surfaceHeight: surface.height };
  });
  assert.ok(fit.canvasWidth <= fit.surfaceWidth, `fit-page width overflow: ${fit.canvasWidth} > ${fit.surfaceWidth}`);
  assert.ok(fit.canvasHeight <= fit.surfaceHeight, `fit-page height overflow: ${fit.canvasHeight} > ${fit.surfaceHeight}`);
  await viewer.getByRole("button", { name: "Fit page width" }).click();
  await viewer.locator('main[data-fit-mode="width"]').waitFor();
  await viewer.getByRole("button", { name: "Fit whole page" }).click();
  await viewer.locator('main[data-fit-mode="page"]').waitFor();
  for (const [label, extension] of [["HTML", ".html"], ["Editable DOCX", ".docx"], ["PDF", ".pdf"]]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      resumeDialog.getByRole("button", { name: label, exact: true }).click(),
    ]);
    assert.ok(download.suggestedFilename().startsWith("DEMO-"), `${label} export must be clearly demo-labeled`);
    assert.ok(download.suggestedFilename().endsWith(extension), `${label} export filename is incorrect`);
  }
  assert.deepEqual(pageErrors, []);

  await resumeDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/career/resumes`);
  await page.getByRole("button", { name: /Classic/ }).click();
  const mobileViewer = page.frameLocator('[data-testid="resume-pdf-frame"]');
  await mobileViewer.locator('main[data-fit-mode="page"]').waitFor({ timeout: 15_000 });
  await mobileViewer.locator("canvas").waitFor();
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client, `mobile overflow: ${dimensions.scroll} > ${dimensions.client}`);
  await context.close();
  console.log("Career Evidence persistence, upload, actual-PDF fit controls, exports, and mobile checks passed.");
} finally {
  await browser.close();
}
