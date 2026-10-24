import { readFile } from "node:fs/promises";

// The renderer test server exposes only these first-party module files, never arbitrary repository paths.
export async function peopleModuleSources() {
  const modules = new Map();
  for (const name of ["model.mjs", "metadata.mjs", "view.mjs"]) {
    const source = await readFile(new URL(`../../../frontend/public-site/assets/people/${name}`, import.meta.url), "utf8");
    modules.set(`/people/${name}`, source);
    modules.set(`/assets/people/${name}`, source);
  }
  return modules;
}
