"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { CampusChapterAssignments, OrganizationView } from "@pytorch-ph/domain-client/organization";

// Officers assign positions down the org chart; the API enforces the one-level delegation rule.
export default function OrganizationPage() {
  return <AppShell><div className="space-y-6"><OrganizationView /><CampusChapterAssignments /></div></AppShell>;
}
