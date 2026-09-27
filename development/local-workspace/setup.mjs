import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./processes.mjs";
import { runtimePath, workspaceRoot as root } from "./runtime-paths.mjs";

const venv = runtimePath("environments", "process-lab");
const python = process.platform === "win32" ? "python" : "python3";

function complete(child) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Setup command exited with ${code}.`)));
  });
}

await complete(run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root }));
if (!existsSync(venv)) await complete(run(python, ["-m", "venv", venv], { cwd: root }));
const pip = resolve(venv, process.platform === "win32" ? "Scripts/pip.exe" : "bin/pip");
await complete(run(pip, ["install", "-e", root, "-e", resolve(root, "development/process-lab")], { cwd: root }));
console.log("Local workspace dependencies are ready. Run: npm run dev");
