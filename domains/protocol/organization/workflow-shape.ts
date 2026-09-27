/**
 * Shared domain types for the Org Activity Operations pipeline.
 * These are the contracts every stage produces/consumes (see README.md).
 */

export type ActivityCategory =
  | "events"
  | "workshops"
  | "hackathons"
  | "competitive-programming";

export type Scope = "internal" | "external";

/** A department that can be required to approve a generated paper. */
export type Department =
  | "secretariat"
  | "treasurer"
  | "external-relations"
  | "academics"
  | "executive";

/** Step 0 — what a member submits to start a pipeline. Anyone may submit. */
export interface IntakeSubmission {
  submittedBy: string; // user id
  url?: string; // e.g. a competition page
  details?: string; // free-text fallback when there's no link
  submittedAt: string; // ISO timestamp (pass in; never generated here)
}

/** Step 1 — what the LinkIngestor (RAG) extracts from the submission. */
export interface ActivityContext {
  category: ActivityCategory;
  scope: Scope;
  title: string;
  summary: string;
  sourceUrl?: string;
  /** Anything structured the ingestor pulled out (dates, org, prizes, requirements...). */
  facts: Record<string, unknown>;
}

/** Step 3 — a compacted brief handed to ONE department to produce ONE paper. */
export interface DepartmentBrief {
  department: Department;
  /** Who the paper is for (e.g. "FEU Tech school officials"). */
  recipient: string;
  /** What the paper must contain — the officer/secretary finalizes it. */
  requiredContent: string;
  /** An AI-generated draft the human edits. Never sent without approval. */
  draft: string;
}

/** Step 4 — a generated document ready for approval. */
export interface GeneratedDocument {
  department: Department;
  category: ActivityCategory;
  scope: Scope;
  /** Rendered output (format depends on the template the user provides). */
  content: string;
  templateId: string;
}

/** A single department's verdict in the approval gate. */
export interface ApprovalVerdict {
  department: Department;
  approverUserId: string;
  decision: "approve" | "edit" | "reject";
  note?: string;
  decidedAt: string; // ISO
}

/** One row of the configurable routing table (admin-editable). */
export interface RoutingRule {
  category: ActivityCategory;
  scope: Scope;
  /** All of these departments must approve (parallel + unanimous). */
  requiredDepartments: Department[];
}
