"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { CollabMailView } from "@pytorch-ph/domain-client/organization";
import { MailWorkflow } from "../events/mail-workflow";

// Event emails reviewed part by part, then approved and sent through the officer chain.
export default function EmailDraftsPage() {
  return <AppShell><div className="space-y-8"><CollabMailView /><MailWorkflow /></div></AppShell>;
}
