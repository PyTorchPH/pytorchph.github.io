import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "apps/pages-demo/out");
const manifestPath = resolve(import.meta.dirname, "artifacts.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in the Pages artifact.");
  return entry.isDirectory() ? walk(path) : [path];
});
const allowed = name => /^(?:index\.html|index\.txt|404\.html|\.nojekyll|__next\.[\w.-]+\.txt)$/.test(name)
  || /^(?:404|_not-found|login|register|dashboard|admin|events|leaderboards|career|connections|jobs|membership|reports|settings|trust|demo-api|demo)\//.test(name)
  || name.startsWith("_next/static/");
function destination(name) {
  const path = resolve(root, name);
  if (!allowed(name) || !path.startsWith(root + sep) || name.includes("..")) throw new Error(`Refusing unexpected export path: ${name}`);
  return path;
}

const files = new Map(walk(output).map(path => [relative(output, path).split(sep).join("/"), readFileSync(path)]));
files.set(".nojekyll", Buffer.alloc(0));
// The portal UI references its synthetic evidence media from /demo/; publish it without copying source files.
const portalDemoMedia = resolve(root, "apps/portal/public/demo");
for (const path of walk(portalDemoMedia)) files.set(`demo/${relative(portalDemoMedia, path).split(sep).join("/")}`, readFileSync(path));
// Next writes segment prefetch payloads as `__next.<segment>/<file>.txt`, but the client requests
// the flat `__next.<segment>.<file>.txt`; static hosts have no rewrite, so publish both spellings.
const flatPrefetchName = name => {
  const parts = name.split("/");
  const start = parts.findIndex((part, index) => part.startsWith("__next.") && index < parts.length - 1);
  return start === -1 ? null : [...parts.slice(0, start), parts.slice(start).join(".")].join("/");
};
for (const [name, bytes] of [...files]) {
  const flat = flatPrefetchName(name);
  if (flat && !files.has(flat)) files.set(flat, bytes);
}
for (const required of ["index.html", "login/index.html", "register/index.html", "dashboard/index.html", "dashboard/profile/index.html", "admin/dashboard/index.html", "events/index.html", "leaderboards/index.html", "career/evidence/index.html", "career/resumes/index.html", "jobs/opportunities/index.html", "membership/index.html", "trust/index.html", "settings/index.html", "demo-api/fixtures.json"]) {
  if (!files.has(required)) throw new Error(`Missing static demo route: ${required}`);
}
// Verify the entire plan before changing any repository file.
for (const name of new Set([...Object.keys(previous), ...files.keys()])) {
  const path = destination(name);
  if (existsSync(path) && hash(readFileSync(path)) !== previous[name]) throw new Error(`Refusing to overwrite a file not owned by this export: ${name}`);
}
for (const name of Object.keys(previous)) {
  if (!files.has(name) && existsSync(destination(name))) rmSync(destination(name));
}
const manifest = {};
for (const [name, bytes] of files) {
  const path = destination(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  manifest[name] = hash(bytes);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ event: "pages_demo.export.completed", outcome: "success", files: files.size, source: "apps/pages-demo/out", destination: "repository root", publishingSource: "main:/" }));
