import type { ActivityContext, DepartmentBrief, Department } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * Step 3 — turn the activity context into a compacted brief + draft PER department/paper.
 * e.g. for the secretariat: who the paper is for, what its content must be, and a draft to edit.
 * The officer still finalizes the actual paper — the AI only eases the work.
 */
export interface DepartmentBriefGenerator {
  generate(
    context: ActivityContext,
    departments: Department[],
  ): Promise<DepartmentBrief[]>;
}

/** Stub — wire to the AI adapter (spec §15). One compacted brief per department. */
export class LlmDepartmentBriefGenerator implements DepartmentBriefGenerator {
  async generate(
    _context: ActivityContext,
    _departments: Department[],
  ): Promise<DepartmentBrief[]> {
    throw new Error(
      "not implemented: LlmDepartmentBriefGenerator.generate — needs the AI adapter layer",
    );
  }
}
