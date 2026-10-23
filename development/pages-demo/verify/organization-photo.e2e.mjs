import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { servePages, isProductionBuild } from "./serve-pages.mjs";
import { PORTAL_BASE_PATH } from "../portal-base-path.mjs";
import { mockApi } from "./mock-api.mjs";
import { careerApi } from "./career-api.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const apiOrigin = "https://api.pytorch.ph";
const portalOut = path.join(root, "frontend/portal-static/out");
const sampleFile = path.join(root, "frontend/portal/public/demo/evidence/ml-showcase.webp");

await verifyPhotoLifecycle();

// Mental model: load through the real bridge, persist/reload, reject failed mutations, then remove/reload.
async function verifyPhotoLifecycle() {
  assert.ok(isProductionBuild(portalOut, apiOrigin), "Build the production-API portal first");
  const site = await servePages({ portalOut, siteOut: path.join(root, "frontend/public-site/_site") });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem("pytorch-ph:tour:/settings:v1", "seen"));
    await context.route("**/*", route => new URL(route.request().url()).origin === site.origin ? route.continue() : route.abort());
    const fixture = careerApi();
    const api = await mockApi(context, { apiOrigin, siteOrigin: site.origin, portalHandler: fixture.answer });
    api.state.role = "member";
    const state = await installPhotoRoutes(context, site.origin);
    const page = await context.newPage();
    const pageErrors = [];
    const staticPhotoRequests = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.origin === site.origin && url.pathname.includes("/api/member/self-photo")) staticPhotoRequests.push(url.pathname);
    });
    const settingsUrl = `${site.origin}${PORTAL_BASE_PATH}/settings/`;
    await openPhotoSettings(page, settingsUrl);
    await assertDecodedPhoto(page);
    assert.ok(state.reads > 0, "Initial photo must be fetched through the authenticated API bridge");

    await page.getByLabel("Upload profile photo", { exact: true }).setInputFiles(sampleFile);
    await page.getByText("Profile photo saved.", { exact: true }).waitFor();
    assert.deepEqual(state.photo, readFileSync(sampleFile));
    const reads = state.reads;
    await openPhotoSettings(page, settingsUrl);
    await assertDecodedPhoto(page);
    assert.ok(state.reads > reads, "Reload must read the stored photo, not an optimistic preview");

    for (const method of ["PUT", "DELETE"]) {
      for (const status of [401, 403, 413, 503]) {
        await verifyRejectedMutation(page, state, method, status);
      }
    }
    state.failureStatus = 0;
    await removePhoto(page);
    await page.getByText("Profile photo removed.", { exact: true }).waitFor();
    assert.equal(state.photo, null);
    await page.getByAltText("Your profile", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByAltText("Your profile", { exact: true }).count(), 0);
    const absentRead = page.waitForResponse(response => response.url().includes("/portal/api/member/self-photo") && response.status() === 404);
    await openPhotoSettings(page, settingsUrl);
    await absentRead;
    await page.getByText("Wala pang naka-save na profile photo.", { exact: true }).waitFor();
    assert.equal(await page.getByAltText("Your profile", { exact: true }).count(), 0);
    state.photo = readFileSync(sampleFile);
    state.readFailureStatus = 503;
    await openPhotoSettings(page, settingsUrl);
    await page.getByRole("alert").filter({ hasText: "(503)" }).waitFor();
    assert.equal(await page.getByAltText("Your profile", { exact: true }).count(), 0);
    state.readFailureStatus = 0;
    await page.getByRole("button", { name: "I-load ulit ang photo", exact: true }).click();
    await assertDecodedPhoto(page);
    assert.deepEqual(staticPhotoRequests, []);
    assert.deepEqual(pageErrors, []);
    console.log("Organization photo API-bridge reads, 204 upload/removal, reload persistence, and failed-write preservation passed; all photo requests were mocked.");
  } finally {
    await browser?.close();
    await site.close();
  }
}

async function installPhotoRoutes(context, siteOrigin) {
  const state = { photo: readFileSync(sampleFile), reads: 0, failureStatus: 0, readFailureStatus: 0 };
  const headers = {
    "access-control-allow-origin": siteOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    "cache-control": "private, no-store",
  };
  await context.route(/\/portal\/api\/member\/(?:self-photo|organization-photo)(?:\?.*)?$/, async route => {
    const request = route.request();
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (method === "GET") {
      state.reads += 1;
      if (state.readFailureStatus) return route.fulfill({ status: state.readFailureStatus, headers, body: "PRIVATE_UPSTREAM_DETAIL_MUST_NOT_RENDER" });
      return state.photo
        ? route.fulfill({ status: 200, headers: { ...headers, "content-type": "image/webp" }, body: state.photo })
        : route.fulfill({ status: 404, headers });
    }
    assert.ok(["PUT", "DELETE"].includes(method));
    if (state.failureStatus) return route.fulfill({ status: state.failureStatus, headers: { ...headers, "content-type": "text/html" }, body: "PRIVATE_UPSTREAM_DETAIL_MUST_NOT_RENDER" });
    if (method === "PUT") {
      assert.equal(request.headers()["content-type"], "image/webp");
      state.photo = request.postDataBuffer();
    } else state.photo = null;
    return route.fulfill({ status: 204, headers });
  });
  return state;
}

async function openPhotoSettings(page, url) {
  await page.goto(url);
  const sections = page.locator('[aria-label="Settings sections"]');
  await sections.getByRole("button", { name: "Profile", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Settings sections"] button[aria-pressed="true"]')?.textContent === "Profile");
  await page.getByRole("button", { name: "Edit profile photo", exact: true }).waitFor();
}

async function assertDecodedPhoto(page) {
  const image = page.getByAltText("Your profile", { exact: true });
  await image.waitFor();
  assert.match(await image.getAttribute("src"), /^blob:/);
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="Your profile"]');
    return image?.complete && image.naturalWidth > 0;
  });
}

async function verifyRejectedMutation(page, state, method, status) {
  state.failureStatus = status;
  const beforeBytes = Buffer.from(state.photo);
  const image = page.getByAltText("Your profile", { exact: true });
  const beforeUrl = await image.getAttribute("src");
  const response = page.waitForResponse(reply => reply.url().includes("/portal/api/member/organization-photo") && reply.request().method() === method && reply.status() === status);
  if (method === "PUT") await page.getByLabel("Upload profile photo", { exact: true }).setInputFiles(sampleFile);
  else await removePhoto(page);
  await response;
  await page.getByRole("alert").filter({ hasText: `(${status})` }).last().waitFor();
  assert.deepEqual(state.photo, beforeBytes);
  assert.equal(await image.getAttribute("src"), beforeUrl, `${method} ${status} must preserve the current preview`);
  assert.equal(await page.getByText("PRIVATE_UPSTREAM_DETAIL_MUST_NOT_RENDER").count(), 0);
}

async function removePhoto(page) {
  const remove = page.getByRole("button", { name: "Remove photo", exact: true });
  if (!await remove.isVisible()) await page.getByRole("button", { name: "Edit profile photo", exact: true }).click();
  await remove.click();
}
