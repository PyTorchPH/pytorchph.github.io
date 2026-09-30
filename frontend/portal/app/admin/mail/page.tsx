"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { CollabMailView } from "@pytorch-ph/domain-client/organization";

// Event emails reviewed part by part, then approved and sent through the officer chain.
export default function EmailDraftsPage() {
  return <AppShell><CollabMailView /></AppShell>;
}
