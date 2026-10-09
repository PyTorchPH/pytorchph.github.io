import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  analyzeResumeSource,
  buildResumeSourceProfile,
  resumeHtml,
  resumePdfBytes,
  resumePdfPageCount,
} from "@pytorch-ph/domain-client/resumes";
import { resumeSourceDocumentSchema } from "@pytorch-ph/domain-protocol/resumes";

const fixturePath = fileURLToPath(new URL("../tests/fixtures/resume-source-example.v1.json", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../../../out/resume-example/", import.meta.url));

async function renderExample() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const source = resumeSourceDocumentSchema.parse(fixture);
  const analysis = analyzeResumeSource(source);
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const html = resumeHtml(profile, "compact");
  const pdf = await resumePdfBytes(profile, "compact");
  const pageCount = await resumePdfPageCount(profile, "compact");

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputDirectory}/source.json`, `${JSON.stringify(source, null, 2)}\n`, "utf8"),
    writeFile(`${outputDirectory}/analysis.json`, `${JSON.stringify(analysis, null, 2)}\n`, "utf8"),
    writeFile(`${outputDirectory}/profile.json`, `${JSON.stringify(profile, null, 2)}\n`, "utf8"),
    writeFile(`${outputDirectory}/resume.html`, html, "utf8"),
    writeFile(`${outputDirectory}/resume.pdf`, pdf),
  ]);

  process.stdout.write(JSON.stringify({
    contract: source.contract,
    target: "ml-engineer",
    readiness: analysis.readiness,
    pages: pageCount,
    sections: profile.sections?.length || 0,
    projects: profile.projects.length,
    experience: profile.experience.length,
    outputDirectory,
  }));
}

void renderExample();
