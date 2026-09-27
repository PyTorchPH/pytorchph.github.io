import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { scrapeFeuGrades } from "@pytorch-ph/domain-server/academic-records";

async function main(): Promise<void> {
  const storageStatePath = process.argv[2];
  const outputPath = process.argv[3] ?? "out/feu-academic-snapshot.json";
  const totalCurriculumUnits = process.argv[4] ? Number(process.argv[4]) : undefined;
  if (!storageStatePath) throw new Error("Usage: run.ts <storage-state> [output] [curriculum-units]");
  const snapshot = await scrapeFeuGrades({ storageStatePath, totalCurriculumUnits, headless: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`FEU academic snapshot saved to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
