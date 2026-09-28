import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

// Completes apps/pages-demo/out so any static host (root site or a path-based project site) can serve it as-is.
const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "apps/pages-demo/out");
const portalPublic = resolve(root, "apps/portal/public");
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in the Pages artifact.");
  return entry.isDirectory() ? walk(path) : [path];
});
const copy = (from, name) => {
  const to = resolve(output, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};
if (!existsSync(output)) throw new Error("Build apps/pages-demo before finalizing the export.");

// The portal UI references its own public files: synthetic evidence media, setup illustrations,
// the web manifest, and app icons.
let media = 0;
for (const path of walk(portalPublic)) { copy(path, relative(portalPublic, path).split(sep).join("/")); media += 1; }

// Next writes segment prefetch payloads as `__next.<segment>/<file>.txt`, but the client requests
// the flat `__next.<segment>.<file>.txt`; static hosts have no rewrite, so publish both spellings.
let aliases = 0;
for (const path of walk(output)) {
  const parts = relative(output, path).split(sep);
  const start = parts.findIndex((part, index) => part.startsWith("__next.") && index < parts.length - 1);
  if (start === -1) continue;
  const flat = [...parts.slice(0, start), parts.slice(start).join(".")].join("/");
  if (!existsSync(resolve(output, flat))) { copy(path, flat); aliases += 1; }
}
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(JSON.stringify({ event: "pages_demo.out.finalized", outcome: "success", media, prefetchAliases: aliases }));
