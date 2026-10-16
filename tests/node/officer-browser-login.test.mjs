import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { servePages } from "../../development/pages-demo/verify/serve-pages.mjs";

test("exported CLI browser page requires Google sign-in and explicit matching-code approval", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const site = await servePages({ portalOut: resolve(root, "frontend/portal-static/out"), siteOut: resolve(root, "frontend/public-site/_site") });
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    const page = await browser.newPage();
    let approvals = 0;
    await page.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "application/javascript", body: "let connect;window.google={accounts:{id:{initialize:options=>{connect=options.callback;},renderButton:element=>{const button=document.createElement('button');button.textContent='Test Google sign-in';button.onclick=()=>connect({credential:'isolated-test-id-token'});element.append(button);}}}};" }));
    await page.route("https://api.pytorch.ph/auth/google", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ role: "officer" }) }));
    await page.route("https://api.pytorch.ph/auth/cli/approve", route => {
      assert.deepEqual(route.request().postDataJSON(), { requestId: id, userCode: "ABCDEF12" });
      approvals++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ approved: true }) });
    });
    await page.goto(site.origin + "/portal/cli-login/?request=" + id);
    await page.getByRole("button", { name: "Test Google sign-in", exact: true }).click();
    const approve = page.getByRole("button", { name: "Aprubahan ang CLI login", exact: true });
    assert.equal(await approve.isDisabled(), true);
    assert.equal(approvals, 0);
    await page.getByLabel("Code mula sa sarili mong terminal").fill("abcdef12");
    await approve.click();
    await page.getByRole("status").filter({ hasText: "Aprubado na." }).waitFor();
    assert.equal(approvals, 1);
    assert.equal(await approve.count(), 0);
  } finally { await browser.close(); await site.close(); }
});
