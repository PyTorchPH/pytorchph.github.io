import { chromium, type BrowserContext, type Page } from "playwright";

import { computeCgpa, evaluateHonors, sortTermLabels } from "./logic";
import type { AcademicSnapshot, CourseGrade } from "@pytorch-ph/domain-protocol/career-evidence";

export const FEU_SOLAR = {
  gradesUrl: "https://solar.feutech.edu.ph/student/grades",
  loginHost: "login.microsoftonline.com",
  termSelect: "select",
  submitButton: { role: "button" as const, name: "Submit" },
  gradeRows: "table tbody tr"
};

export class FeuSessionRequiredError extends Error {}

export async function scrapeFeuGrades(options: {
  storageStatePath: string;
  totalCurriculumUnits?: number;
  headless?: boolean;
}): Promise<AcademicSnapshot> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ storageState: options.storageStatePath });
    const page = await context.newPage();
    await gotoWithRetry(page, FEU_SOLAR.gradesUrl);
    if (new URL(page.url()).hostname === FEU_SOLAR.loginHost) {
      throw new FeuSessionRequiredError("FEU/Microsoft session expired; refresh storage state visibly");
    }

    const labels = await page.locator(`${FEU_SOLAR.termSelect} option`).allTextContents();
    const termLabels = sortTermLabels(labels.map((label) => label.trim()).filter((label) => label && label !== "--"));
    const courses: CourseGrade[] = [];
    for (const termLabel of termLabels) courses.push(...(await scrapeTerm(page, termLabel)));
    const { cgpa, completedUnits } = computeCgpa(courses);
    return {
      source: "feu-tech-solar",
      scrapedAt: new Date().toISOString(),
      courses,
      termLabels,
      cgpa,
      completedUnits,
      totalCurriculumUnits: options.totalCurriculumUnits,
      honors: evaluateHonors(cgpa, completedUnits, options.totalCurriculumUnits)
    };
  } finally {
    await context?.close();
    await browser.close();
  }
}

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800 * (attempt + 1));
    }
  }
  throw lastError;
}

async function scrapeTerm(page: Page, termLabel: string): Promise<CourseGrade[]> {
  await page.locator(FEU_SOLAR.termSelect).first().selectOption({ label: termLabel });
  await page.getByRole(FEU_SOLAR.submitButton.role, { name: FEU_SOLAR.submitButton.name }).click();
  await page.waitForLoadState("domcontentloaded");
  return page.locator(FEU_SOLAR.gradeRows).evaluateAll((rows, label) =>
    rows.flatMap((row) => {
      const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "");
      const units = Number(cells[3]);
      const finalGrade = Number(cells[5]);
      if (cells.length < 6 || !Number.isFinite(units) || !Number.isFinite(finalGrade)) return [];
      return [{ termLabel: label, courseCode: cells[0], courseTitle: cells[1], units, finalGrade }];
    }), termLabel);
}
