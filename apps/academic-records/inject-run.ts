import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { injectAcademicHighlights } from "@pytorch-ph/domain-server/academic-records";
import type { AcademicSnapshot } from "@pytorch-ph/domain-protocol/career-evidence";

async function main(): Promise<void> {
  const resumePath = process.argv[2];
  const snapshotPath = process.argv[3];
  const outputPath = process.argv[4] ?? "out/resume-with-grades.json";
  if (!resumePath || !snapshotPath) {
    throw new Error("Usage: inject-run.ts <resume-json> <academic-snapshot-json> [output]");
  }
  const resume = JSON.parse(await readFile(resumePath, "utf8"));
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as AcademicSnapshot;
  const injected = injectAcademicHighlights(resume, snapshot);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(injected, null, 2), "utf8");
  console.log(`Grade-enriched resume saved to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
