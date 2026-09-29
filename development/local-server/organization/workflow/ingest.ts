import type { ActivityContext, IntakeSubmission } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * Step 1 — read and understand the submitted link/details (RAG).
 *
 * RAG here = ingest the CONTENT of the submitted URL (e.g. a competition page) plus any org
 * knowledge needed to make sense of it. It is NOT pipeline classification — it produces the
 * context everything downstream is generated from.
 */
export interface LinkIngestor {
  ingest(submission: IntakeSubmission): Promise<ActivityContext>;
}

/** Stub — wire to a retriever (fetch the URL + vector store over org knowledge) + an LLM. */
export class RagLinkIngestor implements LinkIngestor {
  async ingest(_submission: IntakeSubmission): Promise<ActivityContext> {
    throw new Error(
      "not implemented: RagLinkIngestor.ingest — needs RAG infra (fetch URL + retrieval + LLM extraction)",
    );
  }
}
