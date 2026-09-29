import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { PORTAL_BASE_PATH } from "./portal-base-path.mjs";
import { ACCOUNTS, TEST_PASSWORD, mockApi } from "./verify/mock-api.mjs";
import { isProductionBuild, servePages } from "./verify/serve-pages.mjs";

// End-to-end check of the deployed Pages portal: the production build (official API origin) against
// a mocked API. Build first with `npm run build:pages -- --production-api`.
// Module map (caller-first):
//   main flow           entry redirect → first visit tour → registration → sign-in failures →
//                       first-timer onboarding → member → unavailable data → officer →
//                       settings → routes/mobile → session restore → sign out
//   signIn / heading    shared page helpers

const API_ORIGIN = "https://api.pytorch.ph";
const root = resolve(import.meta.dirname, "../..");
const portalOut = resolve(root, "frontend/portal-static/out");
const siteOut = resolve(root, "frontend/public-site/_site");
assert.ok(existsSync(resolve(portalOut, ".nojekyll")), "Run npm run build:pages -- --production-api first.");
assert.ok(isProductionBuild(portalOut, API_ORIGIN), `The portal build must target ${API_ORIGIN}. Rebuild with npm run build:pages -- --production-api.`);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const schoolText = /\b(?:FEU|Far Eastern|Tamaraw|SADO|campus|students?|university|faculty|college)\b|fit\.edu/i;
const memberHeading = "My performance";
const officerHeading = "Community intelligence dashboard for chapter operations.";
const MEMBER_EMAIL = Object.keys(ACCOUNTS).find(email => ACCOUNTS[email] === "member");
const OFFICER_EMAIL = Object.keys(ACCOUNTS).find(email => ACCOUNTS[email] === "officer");
const allowedExternal = request => /fonts\.(googleapis|gstatic)\.com|accounts\.google\.com/.test(request) || request.startsWith(API_ORIGIN);

const site = await servePages({ portalOut, siteOut });
const url = `${site.origin}${PORTAL_BASE_PATH}`;
const checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PH_DEMO_BROWSER || (existsSync(chrome) ? chrome : undefined) });

  // The product tour opens on a member's first visit and closes with Escape.
  const firstVisit = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const firstApi = await mockApi(firstVisit, { apiOrigin: API_ORIGIN, siteOrigin: site.origin });
  firstApi.state.role = "member";
  const tourPage = await firstVisit.newPage();
  await tourPage.goto(`${url}/dashboard/`, { waitUntil: "networkidle" });
  await tourPage.getByText("Your performance dashboard", { exact: true }).waitFor();
  await tourPage.keyboard.press("Escape");
  await tourPage.getByText("Your performance dashboard", { exact: true }).waitFor({ state: "detached" });
  await firstVisit.close();
  checks.push("product-tour");

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const api = await mockApi(context, { apiOrigin: API_ORIGIN, siteOrigin: site.origin });
  // Keep the run hermetic: Google's sign-in script would contact Google and set its own g_state cookie.
  await context.route("https://accounts.google.com/**", route => route.abort());
  await context.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) { return String(key).startsWith("pytorch-ph:tour:") ? "seen" : read.call(this, key); };
  });
  const page = await context.newPage();
  const errors = [], externalRequests = [], missingAssets = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== site.origin) externalRequests.push(request.url()); });
  page.on("response", response => {
    const { pathname } = new URL(response.url());
    if (response.status() >= 400 && new URL(response.url()).origin === site.origin && pathname !== "/favicon.ico" && pathname.startsWith(PORTAL_BASE_PATH)) missingAssets.push(`${response.status()} ${pathname}`);
  });
  const heading = name => page.getByRole("heading", { name, exact: true }).first().waitFor();
  const signIn = async (email, password) => {
    await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /^Sign in/ }).click();
  };

  // Signed out, the portal root forwards to sign in; the production build shows no example accounts.
  await page.goto(`${url}/`, { waitUntil: "networkidle" });
  await page.waitForURL(`**${PORTAL_BASE_PATH}/login/`);
  assert.match(await page.title(), /PyTorch Philippines/);
  assert.equal(await page.getByRole("region", { name: "Example accounts" }).count(), 0, "Example accounts are for offline builds only");
  checks.push("portal-entry-redirect", "no-example-accounts-in-production");

  // Registration: Terms and Privacy open as modals, "I agree" ticks consent, and the password checklist ticks live.
  await page.goto(`${url}/register/?email=first.timer%40example.test`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('input[type="email"]').first().inputValue(), "first.timer@example.test", "The email from a failed sign-in is prefilled");
  await page.getByRole("button", { name: "Terms and Conditions" }).click();
  await page.getByRole("dialog", { name: "Terms and Conditions" }).waitFor();
  await page.getByRole("button", { name: "I agree" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator("#register-terms").isChecked(), true, "I agree must tick the consent box");
  await page.getByRole("button", { name: "Privacy Notice" }).click();
  await page.getByRole("dialog", { name: "Privacy Notice" }).getByRole("heading", { name: "3. Sensitive personal information" }).waitFor();
  await page.keyboard.press("Escape");
  const requirements = page.getByRole("list", { name: "Password requirements" });
  await page.getByPlaceholder("Password", { exact: true }).fill("short");
  assert.equal(await requirements.getByText("✓", { exact: false }).count(), 1, "Only the lowercase rule is met by 'short'");
  await page.getByPlaceholder("Password", { exact: true }).fill(TEST_PASSWORD);
  assert.equal(await requirements.getByText("○", { exact: false }).count(), 0, "A compliant password meets every rule");
  checks.push("terms-privacy-modals", "password-requirements", "register-email-prefill");

  // A failed sign-in never reveals whether the email exists, and offers sign-up with that email.
  await signIn("first.timer@example.test", "Wrong#Pass9");
  await page.getByText("Invalid email or password").waitFor();
  const createLink = page.getByRole("link", { name: /Create one with this email/ });
  assert.match(await createLink.getAttribute("href"), /register\/?\?email=first\.timer%40example\.test/);
  checks.push("failed-sign-in-create-account-hint");

  // A first-timer (profile not complete) lands on onboarding before anything else.
  api.state.profileComplete = false;
  await signIn(MEMBER_EMAIL, TEST_PASSWORD);
  await page.waitForURL(`**${PORTAL_BASE_PATH}/onboarding/`);
  await page.getByText("Welcome! Finish creating your account").waitFor();
  // Programs come from the catalog: senior high strands in a dropdown, college degrees by search.
  await page.locator("#profile-status").selectOption("student");
  await page.locator("#profile-school-level").selectOption("senior_high");
  await page.locator("#profile-program option", { hasText: "STEM — Science, Technology, Engineering, and Mathematics" }).first().waitFor({ state: "attached" });
  await page.getByText("Grade (11–12)").waitFor();
  await page.locator("#profile-school-level").selectOption("undergraduate");
  await page.locator("#profile-program").fill("bscs");
  await page.getByRole("option", { name: /Bachelor of Science in Computer Science/ }).first().waitFor();
  api.state.profileComplete = true;
  checks.push("first-timer-onboarding-gate", "program-catalog-dropdown-and-search");

  // Members see their performance, peers, and the ranking guide, but no officer tools.
  await page.goto(`${url}/dashboard/`, { waitUntil: "networkidle" });
  await heading(memberHeading);
  await page.getByRole("link", { name: "Career Evidence" }).first().waitFor();
  await page.getByRole("columnheader", { name: "Peer median" }).waitFor();
  await page.getByRole("button", { name: "How ranking works" }).click();
  await page.getByText("How to raise your rank", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("heading", { name: "Officer desk", exact: true }).count(), 0, "Members must not see the officer desk");
  assert.equal(await page.getByRole("link", { name: "Command Center" }).count(), 0, "Members must not see officer tools");
  assert.ok(new URL(page.url()).pathname.startsWith(PORTAL_BASE_PATH), "Navigation must stay under the portal base path");
  checks.push("member-dashboard", "peer-scorecard", "ranking-guide", "member-hides-officer-tools", "base-path");

  // Career section tabs sit under the hero; job analytics and automation live there.
  await page.goto(`${url}/career/resumes/`, { waitUntil: "networkidle" });
  const tabsFollowHero = await page.evaluate(() => {
    const hero = document.querySelector("header.page-hero");
    const tabs = document.querySelector('[aria-label="Career workspace section"]');
    return Boolean(hero && tabs && hero.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(tabsFollowHero, "Section tabs must render below the hero");
  await page.getByRole("button", { name: "Job analytics", exact: true }).click();
  await heading("Job Market Analytics");
  await page.getByRole("button", { name: "Job automation", exact: true }).waitFor();
  checks.push("career-tabs-below-hero", "member-job-tools");

  // Missing data keeps every panel on screen, each stamped, instead of one blocking card.
  api.state.failingPaths.add("/api/product/career-evidence");
  await page.goto(`${url}/career/evidence/`, { waitUntil: "networkidle" });
  await heading("Career Evidence");
  await page.locator("[data-panels-unavailable] [data-card]").first().waitFor();
  assert.equal(await page.getByText("Product data unavailable").count(), 0);
  assert.equal(await page.getByText("Loading workspace…").count(), 0);
  api.state.failingPaths.clear();
  checks.push("unavailable-data-keeps-layout");

  // Officers share My performance and add the officer desk and the officer tools.
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(`**${PORTAL_BASE_PATH}/login/`);
  await signIn(OFFICER_EMAIL, TEST_PASSWORD);
  await heading(memberHeading);
  await heading("Officer desk");
  await page.reload({ waitUntil: "networkidle" });
  await heading("Officer desk");
  await page.getByRole("link", { name: "Command Center" }).first().click();
  await heading(officerHeading);
  assert.equal(await page.getByText("Elite node rank", { exact: true }).count(), 0, "The command center must not repeat the leaderboard");
  await page.getByRole("link", { name: "Event Workflow" }).first().click();
  await heading("Event workflow");
  for (const section of ["Internal events and competitions", "Email and PDF human review"]) await heading(section);
  checks.push("officer-desk", "officer-persists-reload", "shared-dashboard", "event-workflow");

  // Settings holds account binding and privacy; binding needs the browser extension.
  await page.goto(`${url}/settings/`, { waitUntil: "networkidle" });
  await page.getByText("Connected accounts", { exact: true }).waitFor();
  await page.getByText("Not installed", { exact: true }).waitFor();
  await page.getByRole("link", { name: "How to install" }).first().click();
  await heading("Install the Evidence Collector");
  assert.equal(await page.getByRole("link", { name: "PyTorch PH: go to the pytorch.ph home page" }).first().getAttribute("href"), "https://pytorch.ph/");
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(manifest.display, "standalone");
  checks.push("account-binding", "logo-landing", "installable-app");

  const routes = ["/login/", "/register/", "/onboarding/", "/dashboard/", "/dashboard/profile/", "/dashboard/community/", "/community-preview/", "/career/evidence/", "/career/resumes/", "/jobs/opportunities/", "/jobs/analytics/", "/jobs/automation/", "/events/", "/leaderboards/", "/membership/", "/trust/", "/settings/", "/setup/evidence-extension/"];
  for (const path of routes) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.locator('aside[aria-label="Demo notice"], .on-dark.fixed.inset-x-0.top-0').count(), 0, `Fixed demo banner on ${path}`);
    // Onboarding asks for the member's own school and student status, so only it may name them.
    if (path !== "/onboarding/") assert.doesNotMatch(await page.locator("body").innerText(), schoolText, `School-specific text on ${path}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/login/", "/register/", "/dashboard/", "/events/", "/leaderboards/"]) {
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Mobile overflow: ${path}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("static-routes", "no-fixed-demo-banners", "no-school-text", "mobile");

  // A live session skips sign in; signing out revokes it and clears the cached view.
  api.state.role = "member";
  await page.goto(`${url}/`, { waitUntil: "networkidle" });
  await heading(memberHeading);
  assert.equal(await page.locator('input[type="password"]').count(), 0, "A restored member session must skip sign in");
  api.state.role = "officer";
  await page.goto(`${url}/login/`, { waitUntil: "networkidle" });
  await heading("Officer desk");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(`**${PORTAL_BASE_PATH}/login/`);
  await page.locator('input[type="password"]').waitFor();
  assert.equal(api.state.role, null, "Sign out must revoke the official session");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("pytorch-ph-demo-audience")), null, "Sign out must clear the cached view");
  assert.deepEqual(await context.cookies(), []);
  checks.push("session-restore-member", "session-restore-officer", "signout-revokes-session", "no-auth-cookies");

  assert.ok(api.state.portalRequests > 0, "Portal views must read through the API gateway");
  assert.deepEqual(api.unexpected, [], "Every API call the portal makes must be a known route");
  assert.deepEqual(externalRequests.filter(request => !allowedExternal(request)), []);
  assert.deepEqual(missingAssets, []);
  assert.deepEqual(errors, []);
  checks.push("api-gateway-reads", "known-api-routes", "no-unapproved-external-requests", "no-missing-assets", "no-page-errors");
  console.log(JSON.stringify({ event: "pages_demo.verify.completed", outcome: "success", checks }));
} finally {
  await browser?.close();
  await site.close();
}
