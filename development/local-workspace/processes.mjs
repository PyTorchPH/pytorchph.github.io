import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

export function commandInvocation(command, args, options = {}) {
  const platform = options.platform || process.platform;
  const node = options.execPath || process.execPath;
  const npm = options.npmExecPath === undefined ? process.env.npm_execpath : options.npmExecPath;
  if (platform === "win32" && ["npm", "npx"].includes(command)) {
    if (!npm) throw new Error(`${command} requires npm_execpath on Windows; run this command through npm.`);
    const cli = command === "npm" ? npm : resolve(dirname(npm), "npx-cli.js");
    return { command: node, args: [cli, ...args] };
  }
  return { command, args };
}

export function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  return spawn(invocation.command, invocation.args, { stdio: "inherit", ...options });
}

export function stopTogether(processes) {
  const stop = () => {
    for (const child of processes) {
      if (!child.killed) child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return stop;
}

export async function waitFor(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 307) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs / 1000} seconds.`);
}
