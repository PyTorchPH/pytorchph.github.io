import { ProductWorkspace } from "@pytorch-ph/domain-client/career-evidence";

// Approving your own manual evidence also queues it for officer review, so the page needs no
// separate official submission form.
export default function Page() {
  return <ProductWorkspace capabilityKey="evidence_read" view="career-evidence" safety="All sources pass through the retrieval middleman; generated displays never overwrite source evidence. Approving your own evidence sends it to officer review before it earns leaderboard points." />;
}
