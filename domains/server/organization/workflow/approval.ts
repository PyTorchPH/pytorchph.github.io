import type { ApprovalVerdict, Department, GeneratedDocument } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * One department's approval surface (HITL). In production this is backed by a UI where an
 * officer of that department approves/edits/rejects — it is NOT decided by AI.
 */
export interface DepartmentApprover {
  readonly department: Department;
  /** Resolves when a human in this department has decided on the document. */
  review(document: GeneratedDocument): Promise<ApprovalVerdict>;
}

export interface ApprovalResult {
  approved: boolean;
  verdicts: ApprovalVerdict[];
}

/**
 * The middleman (separation of concern). Holds a registry of department approvers and dispatches
 * a document to all REQUIRED departments in PARALLEL. Approval is UNANIMOUS: every required
 * department must approve, else the result is not approved.
 *
 * This is the same middleman shape as the legacy SocialAggregator: the orchestrator never talks
 * to a concrete department directly — only through this registry.
 */
export class ApprovalMiddleman {
  private readonly registry = new Map<Department, DepartmentApprover>();

  register(approver: DepartmentApprover): void {
    this.registry.set(approver.department, approver);
  }

  async requestApproval(
    document: GeneratedDocument,
    required: Department[],
  ): Promise<ApprovalResult> {
    const missing = required.filter((d) => !this.registry.has(d));
    if (missing.length) {
      throw new Error(`no approver registered for: ${missing.join(", ")}`);
    }

    // Parallel dispatch — all required departments review at once.
    const verdicts = await Promise.all(
      required.map((d) => this.registry.get(d)!.review(document)),
    );

    const approved = verdicts.every((v) => v.decision === "approve");
    return { approved, verdicts };
  }
}
