// Updates the static demo fixtures without a running portal:
//   - member copies of views that members may now read, made member-safe with the server's own function
// Run from the repository root: npx tsx development/pages-demo/patch-fixtures.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { memberSafeProductData } from "../../development/local-server/career-evidence/read-diagnostics";

type Fixture = { status: number; body: unknown };
type Fixtures = Record<"member" | "officer", Record<string, Fixture>>;

const path = resolve(import.meta.dirname, "../../backend/api/seeds/demo-fixtures.json");
const fixtures = JSON.parse(readFileSync(path, "utf8")) as Fixtures;
const jobMarket = Object.keys(fixtures.officer).find((key) => key.startsWith("/api/job-market/summary"));
if (!jobMarket) throw new Error("The officer job-market fixture is missing.");
const operations = fixtures.officer["/api/product/job-operations"];
if (operations?.status !== 200) throw new Error("The officer job-operations fixture is missing.");

fixtures.member["/api/product/job-operations"] = { status: 200, body: memberSafeProductData("job-operations", operations.body as ProductViewData) };
fixtures.member[jobMarket] = fixtures.officer[jobMarket];

writeFileSync(path, JSON.stringify(fixtures));
console.log(JSON.stringify({ event: "pages_demo.fixtures.patched", outcome: "success" }));
