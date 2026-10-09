import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildRenderableResume, resumeHtml, resumePdfBytes } from "@pytorch-ph/domain-client/resumes";
import { resumeEvidenceDraftSchema } from "@pytorch-ph/domain-protocol/resumes";

const fixturePath = fileURLToPath(new URL("../tests/fixtures/evidence-resume-example.v2.json", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../../../out/resume-example/", import.meta.url));

async function renderExample() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const evidenceResume = resumeEvidenceDraftSchema.parse(fixture);
  const profile = buildRenderableResume(evidenceResume, "backend-engineer");
  const html = resumeHtml(profile, "modern");
  const pdf = await resumePdfBytes(profile, "modern");

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputDirectory}/profile.json`, `${JSON.stringify(profile, null, 2)}\n`, "utf8"),
    writeFile(`${outputDirectory}/resume.html`, html, "utf8"),
    writeFile(`${outputDirectory}/resume.pdf`, pdf),
  ]);

  process.stdout.write(JSON.stringify({
    contract: evidenceResume.contract,
    target: "backend-engineer",
    projects: profile.projects.length,
    experience: profile.experience.length,
    outputDirectory,
  }));
}

void renderExample();
