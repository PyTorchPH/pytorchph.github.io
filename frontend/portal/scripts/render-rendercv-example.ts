import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildResumeSourceProfile, parseResumeSourceYaml, renderCvTypst, renderCvYaml } from "@pytorch-ph/domain-client/resumes";

const fixturePath = fileURLToPath(new URL("../tests/fixtures/resume-source-example.v1.yaml", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../../../out/resume-example/rendercv/", import.meta.url));

async function renderExample() {
  const source = parseResumeSourceYaml(await readFile(fixturePath, "utf8"));
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const yaml = renderCvYaml(profile, "compact");
  const typst = renderCvTypst(profile, "compact");
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputDirectory}/resume.rendercv.yaml`, yaml, "utf8"),
    writeFile(`${outputDirectory}/resume.rendercv.typ`, typst, "utf8"),
  ]);
  process.stdout.write(JSON.stringify({
    renderer: "RenderCV v2.8 template through browser Typst WASM",
    sourceContract: source.contract,
    target: "ml-engineer",
    outputs: ["resume.rendercv.yaml", "resume.rendercv.typ"],
  }));
}

void renderExample();
