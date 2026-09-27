import { resolve } from "node:path";

export const workspaceRoot = resolve(import.meta.dirname, "../..");
export const varRoot = resolve(process.env.PYTORCH_PH_VAR_ROOT || resolve(workspaceRoot, "var"));
export const artifactRoot = resolve(
  process.env.PYTORCH_PH_ARTIFACT_ROOT || resolve(workspaceRoot, "out"),
);

export function runtimePath(...parts) {
  return resolve(varRoot, ...parts);
}

export function artifactPath(...parts) {
  return resolve(artifactRoot, ...parts);
}
