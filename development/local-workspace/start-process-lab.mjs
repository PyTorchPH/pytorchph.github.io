import { resolve } from "node:path";
import { run } from "./processes.mjs";
import { runtimePath, workspaceRoot as root } from "./runtime-paths.mjs";

const lab = runtimePath("environments", "process-lab", process.platform === "win32" ? "Scripts/pytorch-ph-process-lab.exe" : "bin/pytorch-ph-process-lab");
const child = run(lab, ["up"], { cwd: root, env: process.env });
child.once("exit", (code) => process.exit(code || 0));
