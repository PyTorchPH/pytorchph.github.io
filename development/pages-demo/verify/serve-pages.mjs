// Serves the Pages layout locally: the public site (frontend/public-site/_site, when built) at /
// and the static portal under PORTAL_BASE_PATH.
// Module map (caller-first):
//   servePages        start the server → { origin, close }
//   └─ fileFor        request path → file on disk (no traversal)
//   isProductionBuild true when the portal build talks to the official API origin

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { PORTAL_BASE_PATH } from "../portal-base-path.mjs";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };

export async function servePages({ portalOut, siteOut }) {
  const server = createServer((request, response) => {
    const path = fileFor(decodeURIComponent(new URL(request.url, "http://localhost").pathname), portalOut, siteOut);
    if (!path) { response.writeHead(404); response.end("Not found"); return; }
    response.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    response.end(readFileSync(path));
  });
  await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}

function fileFor(pathname, portalOut, siteOut) {
  const [dir, rest] = pathname.startsWith(`${PORTAL_BASE_PATH}/`) ? [portalOut, pathname.slice(PORTAL_BASE_PATH.length + 1)] : [siteOut, pathname.slice(1)];
  if (rest.includes("..")) return null;
  for (const candidate of [rest, `${rest}index.html`, `${rest}/index.html`]) {
    const path = resolve(dir, candidate);
    if (path.startsWith(dir) && existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

// The deployed portal is built with the official API origin; a local .env.local build is not.
export function isProductionBuild(portalOut, apiOrigin) {
  const chunks = join(portalOut, "_next", "static", "chunks");
  return existsSync(chunks) && readdirSync(chunks).some(name => name.endsWith(".js") && readFileSync(join(chunks, name), "utf8").includes(apiOrigin));
}
