import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { FEU_SOLAR } from "@pytorch-ph/domain-server/academic-records";

const output = process.argv[2] ?? "var/sessions/feu-solar/storage-state.json";

async function main(): Promise<void> {
  const endpoint = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`No Chrome context available at ${endpoint}`);
  const page = context.pages()[0] ?? await context.newPage();

  console.log("Complete the FEU/Microsoft login in the browser window.");
  await page.goto(FEU_SOLAR.gradesUrl, { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.hostname === "solar.feutech.edu.ph", {
    timeout: 10 * 60_000
  });
  await page.goto(FEU_SOLAR.gradesUrl, { waitUntil: "networkidle" });
  await mkdir(dirname(output), { recursive: true });
  await context.storageState({ path: output });
  console.log(`FEU session saved to ${output}`);
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
