import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workspace = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const portal = JSON.parse(readFileSync(resolve(root, "frontend/portal/package.json"), "utf8"));

test("workspace exposes the portal production preview", () => {
  assert.equal(workspace.scripts.start, "npm run start --workspace @pytorch-ph/portal");
  assert.equal(portal.scripts.start, "next start");
});
