import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const config = readFileSync(join(root, "observability.project.toml"), "utf8");

test("central observability project identity is stable and non-secret", () => {
  assert.match(config, /^\[project\]$/m);
  assert.match(config, /^id = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"$/m);
  assert.match(config, /^slug = "pytorchph.github.io"$/m);
  assert.match(config, /^schema_version = 1$/m);
  assert.doesNotMatch(config, /password|secret|token|cookie|api[_-]?key/i);
});
