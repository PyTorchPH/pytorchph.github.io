// Updates the static demo fixtures without a running portal:
//   - sample external events for every stage of the officer event workflow
//   - member copies of views that members may now read, made member-safe with the server's own function
// Run from the repository root: npx tsx development/pages-demo/patch-fixtures.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { memberSafeProductData } from "../../domains/server/career-evidence/read-diagnostics";
import { demoExternalEvents } from "./demo-events";

type Fixture = { status: number; body: unknown };
type Fixtures = Record<"member" | "officer", Record<string, Fixture>>;

const path = resolve(import.meta.dirname, "../../apps/pages-demo/public/demo-api/fixtures.json");
const fixtures = JSON.parse(readFileSync(path, "utf8")) as Fixtures;
const jobMarket = Object.keys(fixtures.officer).find((key) => key.startsWith("/api/job-market/summary"));
if (!jobMarket) throw new Error("The officer job-market fixture is missing.");
const operations = fixtures.officer["/api/product/job-operations"];
if (operations?.status !== 200) throw new Error("The officer job-operations fixture is missing.");

for (const audience of ["member", "officer"] as const) fixtures[audience]["/api/events"] = { status: 200, body: demoExternalEvents };
fixtures.member["/api/product/job-operations"] = { status: 200, body: memberSafeProductData("job-operations", operations.body as ProductViewData) };
fixtures.member[jobMarket] = fixtures.officer[jobMarket];

writeFileSync(path, JSON.stringify(fixtures));
console.log(JSON.stringify({ event: "pages_demo.fixtures.patched", outcome: "success", externalEvents: demoExternalEvents.length, stages: demoExternalEvents.map((item) => item.status) }));
