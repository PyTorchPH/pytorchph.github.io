import { copyFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const compilerSource = `${workspaceRoot}/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm`;
const renderCvSource = `${workspaceRoot}/frontend/portal/public/vendor/rendercv`;
const publicRoots = [
  `${workspaceRoot}/frontend/portal/public`,
  `${workspaceRoot}/frontend/portal-static/public`,
];

await Promise.all(publicRoots.map(async (publicRoot) => {
  const compilerTarget = `${publicRoot}/vendor/typst/0.7.0/typst_ts_web_compiler_bg.wasm`;
  await mkdir(`${publicRoot}/vendor/typst/0.7.0`, { recursive: true });
  await copyFile(compilerSource, compilerTarget);
  if (publicRoot.includes("portal-static")) {
    await cp(renderCvSource, `${publicRoot}/vendor/rendercv`, { recursive: true, force: true });
  }
}));

process.stdout.write(JSON.stringify({ renderer: "Typst WASM 0.7.0", targets: publicRoots.length }));
