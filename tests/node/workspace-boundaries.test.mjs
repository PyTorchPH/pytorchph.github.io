import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { assertDevelopmentRuntime, assertLocalUrl, developmentBrowserOptions } from "../../development/local-access/policy.mjs";
import { commandInvocation } from "../../development/local-workspace/processes.mjs";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".next")) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".mjs"].includes(extname(path)) ? [path] : [];
  });
}

function importsFrom(directory, forbidden) {
  return sourceFiles(directory).flatMap((path) => {
    const content = readFileSync(path, "utf8");
    return forbidden.some((value) => content.includes(value))
      ? [relative(root, path).replaceAll("\\", "/")]
      : [];
  });
}

test("client and protocol packages never import server implementation", () => {
  assert.deepEqual(importsFrom(join(root, "domains/client"), ["@pytorch-ph/domain-server"]), []);
  assert.deepEqual(importsFrom(join(root, "domains/protocol"), ["@pytorch-ph/domain-server", "@pytorch-ph/domain-client"]), []);
});

test("browser domain code uses Supabase only for authentication", () => {
  const offenders = importsFrom(join(root, "domains/client"), ["@supabase/"])
    .filter((path) => path !== "domains/client/identity/session/create-browser-client.ts");
  assert.deepEqual(offenders, []);
});

test("production packages never import development tooling or dummy identities", () => {
  const production = ["apps/portal", "domains", "design-system"].flatMap((path) => sourceFiles(join(root, path)));
  const offenders = production.filter((path) => {
    const content = readFileSync(path, "utf8");
    return content.includes("development/") || content.includes("demo.owner@fit.edu.ph") || content.includes("demo-password");
  });
  assert.deepEqual(offenders.map((path) => relative(root, path)), []);
});

test("workspace packages expose concepts, not implementation filenames", () => {
  for (const directory of ["domains/client", "domains/server", "domains/protocol"]) {
    const manifest = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"));
    assert.ok(Object.keys(manifest.exports).every((name) => name.split("/").length <= 3 && !/\.(?:ts|tsx|js|mjs)$/.test(name)));
  }
});

test("local automatic access accepts only loopback HTTP origins", () => {
  assert.equal(assertLocalUrl("http://members.ph.localhost:3100", "portal", ["localhost"]).hostname, "members.ph.localhost");
  assert.equal(assertLocalUrl("http://127.0.0.1:54321", "Supabase", ["localhost", "127.0.0.1"]).hostname, "127.0.0.1");
  assert.throws(() => assertLocalUrl("https://members.ph.localhost:3100", "portal", ["localhost"]), /loopback/);
  assert.throws(() => assertLocalUrl("http://example.com", "portal", ["localhost"]), /loopback/);
  assert.throws(() => assertLocalUrl("http://preview.127.0.0.1:3100", "portal", ["127.0.0.1"]), /loopback/);
});

test("local automatic access refuses production, Vercel, and CI", () => {
  assert.doesNotThrow(() => assertDevelopmentRuntime({}));
  assert.throws(() => assertDevelopmentRuntime({ NODE_ENV: "production" }), /unavailable/);
  assert.throws(() => assertDevelopmentRuntime({ VERCEL: "1" }), /unavailable/);
  assert.throws(() => assertDevelopmentRuntime({ CI: "true" }), /unavailable/);
});

test("local automatic access uses the native maximized browser viewport", () => {
  const options = developmentBrowserOptions("/browser");
  assert.equal(options.executablePath, "/browser");
  assert.equal(options.headless, false);
  assert.equal(options.viewport, null);
  assert.ok(options.args.includes("--start-maximized"));
});

test("integrated development always uses local synthetic product data", () => {
  const launcher = readFileSync(join(root, "development/local-workspace/start.mjs"), "utf8");
  assert.match(launcher, /const supabaseProvider = process\.argv\.includes\(["']--supabase["']\)/);
  assert.match(launcher, /PYTORCH_PH_DATA_PROVIDER:\s*supabaseProvider \? ["']supabase["'] : ["']local["']/);
});

test("local auto-login retains a real event-loop handle", () => {
  const watcher = readFileSync(join(root, "development/local-access/watch-login.mjs"), "utf8");
  assert.match(watcher, /const keepAlive = setInterval\(/);
  assert.match(watcher, /clearInterval\(keepAlive\)/);
  assert.doesNotMatch(watcher, /await new Promise\(\(\) => \{\}\)/);
});

test("local workspace resolves package-manager launchers for each platform", () => {
  const options = { platform: "win32", execPath: "C:/node.exe", npmExecPath: "C:/npm/bin/npm-cli.js" };
  assert.deepEqual(commandInvocation("npm", ["install"], options), {
    command: "C:/node.exe",
    args: ["C:/npm/bin/npm-cli.js", "install"],
  });
  assert.deepEqual(commandInvocation("npx", ["tool"], options), {
    command: "C:/node.exe",
    args: [resolve("C:/npm/bin/npx-cli.js"), "tool"],
  });
  assert.deepEqual(commandInvocation("npm", ["install"], { platform: "linux" }), {
    command: "npm",
    args: ["install"],
  });
  assert.throws(() => commandInvocation("npm", [], { platform: "win32", npmExecPath: "" }), /npm_execpath/);
});
