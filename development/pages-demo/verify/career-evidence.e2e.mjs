import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { servePages, isProductionBuild } from "./serve-pages.mjs";
import { PORTAL_BASE_PATH } from "../portal-base-path.mjs";
import { mockApi } from "./mock-api.mjs";
import { careerApi } from "./career-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../frontend/portal");
const repository = path.resolve(root, "../..");
const apiOrigin = "https://api.pytorch.ph";
const portalOut = path.join(repository, "frontend/portal-static/out");
assert.ok(isProductionBuild(portalOut, apiOrigin), "Build the supported portal: npm run build:pages -- --production-api");
const site = await servePages({ portalOut, siteOut: path.join(repository, "frontend/public-site/_site") });
const baseUrl = `${site.origin}${PORTAL_BASE_PATH}`;
const title = `Persistent evidence ${Date.now()}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fixture = careerApi();
  const external = [];
  await context.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === site.origin || origin === apiOrigin) return route.continue();
    if (!/fonts\.(googleapis|gstatic)\.com|accounts\.google\.com/.test(origin)) external.push(route.request().url());
    return route.abort();
  });
  const api = await mockApi(context, { apiOrigin, siteOrigin: site.origin, portalHandler: fixture.answer });
  api.state.role = "member";
  await context.addInitScript(() => {
    localStorage.setItem("pytorch-ph:tour:/career/evidence:v1", "seen");
    localStorage.setItem("pytorch-ph:tour:/career/resumes:v1", "seen");
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/career/evidence`);
  await page.getByRole("button", { name: "Manual entry", exact: true }).waitFor();
  const metadata = await page.evaluate(async () => (await (await fetch("/api/product/career-evidence", { cache: "no-store" })).json()).meta);
  assert.equal(metadata.mode, "local_demo");
  assert.equal(metadata.synthetic, true);
  assert.equal(api.state.role, "member");

  const manual = page.getByRole("button", { name: "Manual entry", exact: true });
  await manual.waitFor();
  await manual.click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Achievement title").fill(title);
  await editor.getByLabel("Organization").fill("Owner verified organization");
  await editor.getByLabel("Evidence type").selectOption("experience");
  await editor.getByLabel("Professional position").fill("Developer");
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

  await page.getByRole("button", { name: "Automatic (AI)", exact: true }).click();
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
  assert.ok(Number.isFinite(Date.parse(sourceState.lastSyncedAt)), "Current source contract timestamps connection updates");

  const simulatedSync = await page.evaluate(async () => {
    const response = await fetch("/api/product/sources/website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(simulatedSync.status, 200);
  assert.equal(simulatedSync.payload.source.connectionStatus, "connected");
  assert.ok(simulatedSync.payload.source.lastSyncedAt);

  const simulatedConnection = await page.evaluate(async () => {
    const response = await fetch("/api/product/sources/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect" }) });
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(simulatedConnection.status, 200);
  assert.equal(simulatedConnection.payload.source.connectionStatus, "connected");

  await page.goto(`${baseUrl}/career/resumes`);
  await page.goto(`${baseUrl}/career/resume-viewer/?template=https://remote.example/resume.pdf`);
  await page.getByRole("alert").filter({ hasText: "Hindi valid ang resume template." }).waitFor();
  await page.goto(`${baseUrl}/career/resumes/`);
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
    const bytes = readFileSync(await download.path());
    if (extension === ".pdf") assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    if (extension === ".docx") assert.equal(bytes.subarray(0, 2).toString(), "PK");
    if (extension === ".html") { assert.match(bytes.toString(), /Synthetic Owner/); assert.match(bytes.toString(), /\+639123456789/); }
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
  assert.deepEqual(external, [], "No external collection or delivery is allowed in the synthetic harness");
  assert.deepEqual(api.unexpected, []);
  await verifyProfilePrivacy(page, fixture, api, baseUrl);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(api.unexpected, []);
  await context.close();
  console.log("Career Evidence persistence, upload, actual-PDF fit controls, exports, and mobile checks passed.");
} finally {
  await browser?.close();
  await site.close();
}

async function verifyProfilePrivacy(page, fixture, api, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  fixture.state.resume.resumeProfile = null;
  fixture.state.resume.meta.mode = "live";
  fixture.state.career.evidence.items = [];
  await page.goto(`${baseUrl}/career/resumes/`);
  await page.getByRole("button", { name: /Classic/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(/\d+-page PDF generated/).waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "HTML", exact: true }).click()]);
  const html = readFileSync(await download.path()).toString();
  assert.match(html, /Synthetic Owner/);
  assert.match(html, /\+639123456789/);
  assert.ok(!download.suggestedFilename().startsWith("DEMO-"));

  fixture.state.resume.resumeProfile = { ...structuredClone(fixture.state.career.resumeProfile), fullName: "Forbidden stale name" };
  fixture.state.unavailable = true;
  await page.reload();
  await page.getByRole("heading", { name: "Profile unavailable" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Classic/ }).count(), 0);
  await page.goto(`${baseUrl}/career/resume-viewer/?template=classic`);
  await page.getByText("PDF preview unavailable", { exact: true }).waitFor();
  assert.equal(await page.locator("canvas").count(), 0);
  fixture.state.unavailable = false;

  await page.goto(`${baseUrl}/settings/`);
  await page.getByRole("button", { name: "Skip tour", exact: true }).click();
  const visible = page.getByRole("checkbox", { name: /Show my real name/ });
  await visible.check();
  await page.getByRole("button", { name: "Save privacy choices", exact: true }).click();
  await page.getByText("Privacy settings saved.", { exact: true }).waitFor();
  await page.reload();
  await visible.waitFor();
  assert.equal(await visible.isChecked(), true);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+639987654321");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await page.getByText("Contact details saved.", { exact: true }).waitFor();
  await page.getByLabel("Upload profile photo", { exact: true }).setInputFiles(path.join(root, "public/demo/evidence/ml-showcase.webp"));
  await page.getByText("Profile photo saved.", { exact: true }).waitFor();
  const photo = page.getByAltText("Your profile", { exact: true });
  assert.match(await photo.getAttribute("src"), /^blob:/);
  await page.waitForFunction(() => { const img = document.querySelector('img[alt="Your profile"]'); return img?.complete && img.naturalWidth > 0; });
  const persisted = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
  assert.ok(!/Synthetic Owner|639123456789|639987654321/.test(persisted));

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login/");
  fixture.state.private = { displayName: "Second Synthetic Owner", phoneNumber: null };
  await page.locator('input[type="email"]').first().fill("member@example.test");
  await page.locator('input[type="password"]').first().fill("Sample#Pass9");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL("**/dashboard/");
  await page.getByRole("link", { name: "Settings & Privacy", exact: true }).first().click();
  await page.waitForURL("**/settings/");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByText(/Second Synthetic Owner · visible/).waitFor();
  assert.equal(await page.getByLabel("Phone number", { exact: true }).inputValue(), "");
  assert.equal(api.state.role, "member");
}
