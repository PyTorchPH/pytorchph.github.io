import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const collection = JSON.parse(readFileSync(new URL("./PyTorch-PH.postman_collection.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../api/src/app/routes.rs", import.meta.url), "utf8");
const routes = [...source.matchAll(/\.route\(\s*"([^"]+)"/g)].map(match => match[1]);
const requests = [];
function visit(items) {
  for (const item of items) item.item ? visit(item.item) : requests.push(item);
}
visit(collection.item);
for (const route of routes) {
  const pattern = new RegExp(`^${route.replace(/\{[^}]+\}/g, "[^/]+")}$`);
  assert.ok(requests.some(item => pattern.test(item.request.url.raw.replace(/^\{\{apiOrigin\}\}/, "").replace(/\{\{[^}]+\}\}/g, "example").replace(/\?.*$/, ""))), `Missing Postman route: ${route}`);
}
for (const item of requests) {
  for (const event of item.event ?? []) new Script(event.script.exec.join("\n"), { filename: item.name });
  const raw = item.request.body?.raw;
  if (raw) {
    const value = raw.replaceAll("{{draftRevision}}", "1").replace(/\{\{[^}]+\}\}/g, "example");
    assert.doesNotThrow(() => JSON.parse(value), `Invalid JSON body: ${item.name}`);
  }
}
console.log(JSON.stringify({ status: "ok", routes: routes.length, requests: requests.length }));
