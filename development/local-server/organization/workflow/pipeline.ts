import type { IntakeSubmission, GeneratedDocument } from "@pytorch-ph/domain-protocol/organization/workflow";
import type { LinkIngestor } from "./ingest";
import type { RoutingRules } from "./routing";
import type { DepartmentBriefGenerator } from "./briefs";
import type { DocumentInjector } from "./documents";
import { ApprovalMiddleman } from "./approval";

/**
 * Orchestrator skeleton wiring the confirmed pipeline (docs/ORG-OPERATIONS.md §8b):
 *
 *   intake -> ingest(RAG) -> route -> per-dept briefs -> generate docs
 *          -> approval (parallel, unanimous) -> [downstream: email + posting, each HITL]
 *
 * This is the only place that knows the stage order; every stage is an interface, so concrete
 * implementations swap freely. Downstream (email/posting) is intentionally left to the caller so
 * each keeps its own HITL gate.
 */
export interface OrgOpsPipelineDeps {
  ingestor: LinkIngestor;
  routing: RoutingRules;
  briefs: DepartmentBriefGenerator;
  injector: DocumentInjector;
  approval: ApprovalMiddleman;
  /** Fallback departments when no routing rule matches (e.g. ["secretariat"]). */
  defaultDepartments: import("@pytorch-ph/domain-protocol/organization/workflow").Department[];
}

export interface PipelineOutcome {
  approved: boolean;
  documents: GeneratedDocument[];
}

export class OrgOpsPipeline {
  constructor(private readonly deps: OrgOpsPipelineDeps) {}

  async run(submission: IntakeSubmission): Promise<PipelineOutcome> {
    const context = await this.deps.ingestor.ingest(submission);

    let departments = this.deps.routing.resolve(context);
    if (departments.length === 0) departments = this.deps.defaultDepartments;

    const briefs = await this.deps.briefs.generate(context, departments);

    const documents = await Promise.all(
      briefs.map((b) =>
        this.deps.injector.render(b, { ...context.facts }, `${context.category}.${b.department}`),
      ),
    );

    // Approval is per-document, requiring its own department; all must approve to proceed.
    const results = await Promise.all(
      documents.map((doc) => this.deps.approval.requestApproval(doc, [doc.department])),
    );
    const approved = results.every((r) => r.approved);

    // NOTE: downstream (email + FB posting) is triggered by the caller only when `approved`,
    // and each downstream action keeps its own human-confirm gate. Not auto-fired here.
    return { approved, documents };
  }
}
