import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
import { servePages, isProductionBuild } from "./serve-pages.mjs";
import { PORTAL_BASE_PATH } from "../portal-base-path.mjs";
import { mockApi } from "./mock-api.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const apiOrigin = "https://api.pytorch.ph";
const privateDetail = "PRIVATE_UPSTREAM_DETAIL_TOKEN_MUST_NOT_RENDER";
const signup = { name: "Synthetic Member", username: "synthetic_member", email: "new-member@example.test", password: "Fixture#Pass9" };

await verifyAuthServiceHandling();

// Mental model: every credential request is mocked; reject outages without advancing, then exercise successful retries.
async function verifyAuthServiceHandling() {
  const portalOut = path.join(root, "frontend/portal-static/out");
  assert.ok(isProductionBuild(portalOut, apiOrigin), "Build the production-API portal first");
  const site = await servePages({ portalOut, siteOut: path.join(root, "frontend/public-site/_site") });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === site.origin ? route.continue() : route.abort());
    const api = await mockApi(context, { apiOrigin, siteOrigin: site.origin });
    const state = await installAuthRoutes(context, site.origin, api.state);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await verifySignupRetries(page, `${site.origin}${PORTAL_BASE_PATH}`, state);
    await verifyCodeRetries(page, `${site.origin}${PORTAL_BASE_PATH}`, state);
    api.state.role = null;
    await verifyPasswordRetries(page, `${site.origin}${PORTAL_BASE_PATH}`, state);
    assert.deepEqual(api.unexpected, []);
    assert.deepEqual(pageErrors, []);
    assert.ok(state.calls.signup >= 7 && state.calls.verification >= 5 && state.calls.password >= 6);
    console.log("Mocked signup, verification, and password sign-in preserve input, reject HTTP/network/invalid-success failures, sanitize diagnostics, and retry successfully.");
  } finally {
    await browser?.close();
    await site.close();
  }
}

async function installAuthRoutes(context, siteOrigin, session) {
  const state = { mode: { signup: "html503", verification: "http400", password: "http401" }, calls: { signup: 0, verification: 0, password: 0 } };
  const headers = { "access-control-allow-origin": siteOrigin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS", "cache-control": "private, no-store" };
  await context.route(/\/auth\/(?:email\/start|email\/verify|password)$/, async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    assert.equal(request.method(), "POST");
    const endpoint = new URL(request.url()).pathname;
    const operation = endpoint === "/auth/email/start" ? "signup" : endpoint === "/auth/email/verify" ? "verification" : "password";
    state.calls[operation]++;
    const payload = request.postDataJSON();
    if (operation === "signup") assert.deepEqual(payload, signup);
    else assert.deepEqual(Object.keys(payload).sort(), operation === "verification" ? ["code", "email"] : ["email", "password"]);
    const mode = state.mode[operation];
    if (mode === "network") return route.abort("failed");
    if (mode === "legacy503" || mode === "current503") {
      const error = mode === "legacy503" ? "Email verification is unavailable" : "Registration verification service is temporarily unavailable. Please try again later.";
      return route.fulfill({ status: 503, headers, contentType: "application/json", body: JSON.stringify({ error }) });
    }
    if (mode === "html503" || mode === "html200") return route.fulfill({ status: mode === "html503" ? 503 : 200, headers, contentType: "text/html", body: `<html>${privateDetail}</html>` });
    if (mode.startsWith("http")) return route.fulfill({ status: Number(mode.slice(4)), headers, contentType: "application/json", body: JSON.stringify({ error: privateDetail }) });
    assert.equal(mode, "success");
    if (operation !== "signup") session.role = "member";
    const reply = operation === "signup" ? { message: "If this address can register, a verification code has been sent." } : { id: "member-id", display_name: "Synthetic Member", role: "member" };
    return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(reply) });
  });
  return state;
}

async function verifySignupRetries(page, baseUrl, state) {
  await page.goto(`${baseUrl}/register/`);
  await page.getByPlaceholder("Full name", { exact: true }).fill(signup.name);
  await page.getByPlaceholder("Leaderboard username", { exact: true }).fill(signup.username);
  await page.getByPlaceholder("you@example.com", { exact: true }).fill(signup.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(signup.password);
  await page.getByPlaceholder("Confirm password", { exact: true }).fill(signup.password);
  await page.getByRole("checkbox").check();
  for (const [mode, expected] of [
    ["legacy503", /unavailable.*\(503\)/], ["current503", /unavailable.*\(503\)/],
    ["html503", /unavailable.*\(503\)/], ["network", /Hindi makakonekta/],
    ["http429", /\(429\).*Maghintay/], ["html200", /Hindi makumpirma.*\(200\)/],
  ]) {
    state.mode.signup = mode;
    await submitAuthAttempt(page, "/auth/email/start", mode, page.getByRole("button", { name: "Create account", exact: true }));
    await assertSafeFailure(page, expected, "signup");
    assert.equal(await page.getByPlaceholder("Verification code", { exact: true }).count(), 0);
    assert.equal(await page.getByPlaceholder("Full name", { exact: true }).inputValue(), signup.name);
    assert.equal(await page.getByPlaceholder("you@example.com", { exact: true }).inputValue(), signup.email);
    assert.equal(await page.getByPlaceholder("Password", { exact: true }).inputValue(), signup.password);
    if (["legacy503", "current503", "html503", "network"].includes(mode)) {
      await page.getByText(/Hindi ito nangangahulugang invalid o taken ang email mo/).waitFor();
    }
  }
  state.mode.signup = "success";
  await submitAuthAttempt(page, "/auth/email/start", "success", page.getByRole("button", { name: "Create account", exact: true }));
  await page.getByPlaceholder("Verification code", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `${PORTAL_BASE_PATH}/register/`);
}

async function assertSafeFailure(page, expected, operation) {
  // Verification owns a visible accessible alert; the hidden registration form retains the same text.
  const failure = operation === "verification"
    ? page.getByRole("alert").filter({ hasText: expected })
    : page.locator("form").filter({ has: page.getByPlaceholder(operation === "signup" ? "Full name" : "you@example.com", { exact: true }) }).getByText(expected);
  await failure.waitFor();
  assert.equal(await failure.count(), 1, `${operation} must expose exactly one error in its owning surface`);
  assert.equal(await page.getByText(privateDetail).count(), 0);
}

async function submitAuthAttempt(page, endpoint, mode, button) {
  const completed = mode === "network"
    ? page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === endpoint && request.method() === "POST" })
    : page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === "POST");
  await button.click();
  await completed;
}

async function verifyCodeRetries(page, baseUrl, state) {
  await page.getByPlaceholder("Verification code", { exact: true }).fill("12345678");
  for (const [mode, expected] of [["http400", /Hindi tinanggap ang verification code.*\(400\)/], ["html503", /unavailable.*\(503\)/], ["network", /Hindi makakonekta/], ["http429", /\(429\).*Maghintay/]]) {
    state.mode.verification = mode;
    await submitAuthAttempt(page, "/auth/email/verify", mode, page.getByRole("button", { name: "Verify email and enter", exact: true }));
    await assertSafeFailure(page, expected, "verification");
    assert.equal(await page.getByPlaceholder("Verification code", { exact: true }).inputValue(), "12345678");
    assert.equal(page.url(), `${baseUrl}/register/`);
  }
  state.mode.verification = "success";
  await submitAuthAttempt(page, "/auth/email/verify", "success", page.getByRole("button", { name: "Verify email and enter", exact: true }));
  await page.waitForURL("**/onboarding/");
}

async function verifyPasswordRetries(page, baseUrl, state) {
  await page.goto(`${baseUrl}/login/`);
  const email = page.getByPlaceholder("you@example.com", { exact: true });
  const password = page.getByPlaceholder("Password", { exact: true });
  await email.fill("member@example.test");
  await password.fill(signup.password);
  for (const [mode, expected] of [["http401", /Hindi tama ang email o password.*\(401\)/], ["html503", /unavailable.*\(503\)/], ["network", /Hindi makakonekta/], ["http429", /\(429\).*Maghintay/], ["html200", /Hindi makumpirma.*\(200\)/]]) {
    state.mode.password = mode;
    await submitAuthAttempt(page, "/auth/password", mode, page.getByRole("button", { name: /^Sign in$/ }));
    await assertSafeFailure(page, expected, "password");
    assert.equal(await email.inputValue(), "member@example.test");
    assert.equal(await password.inputValue(), signup.password);
    assert.equal(page.url(), `${baseUrl}/login/`);
  }
  state.mode.password = "success";
  await submitAuthAttempt(page, "/auth/password", "success", page.getByRole("button", { name: /^Sign in$/ }));
  await page.waitForURL("**/dashboard/");
}
