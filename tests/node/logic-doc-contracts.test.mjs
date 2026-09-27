import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const index = readFileSync(join(root, "docs/logic/README.md"), "utf8");
const docs = [...index.matchAll(/^\| `([^`]+)` \|.*\| \[[^\]]+\]\(([^)]+\.md)\) \|$/gm)]
  .map(([, id, path]) => ({ id, path: join(root, "docs/logic", path) }));

test("logic catalog has unique ids and valid paths", () => {
  assert.ok(docs.length >= 5);
  assert.equal(new Set(docs.map((item) => item.id)).size, docs.length);
  for (const item of docs) {
    assert.ok(existsSync(item.path), `${item.path} must exist`);
    const source = readFileSync(item.path, "utf8");
    assert.match(source, new RegExp(`logic_id: ${item.id.replaceAll(".", "\\.")}`));
    for (const heading of ["code_paths:", "tests:", "feedback_events:", "related_logic:"]) assert.ok(source.includes(heading));
    const frontMatter = source.split("---")[1];
    const paths = [...frontMatter.matchAll(/^  - (.+)$/gm)].map((match) => match[1]);
    for (const path of paths.filter((value) => /^(apps|domains|supabase|tests)\//.test(value))) {
      assert.ok(existsSync(join(root, path)), `${path} referenced by ${item.id} must exist`);
    }
  }
});
