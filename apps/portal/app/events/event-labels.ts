import type { ExternalEvent } from "@pytorch-ph/domain-protocol/organization";

export const statusLabel: Record<ExternalEvent["status"], string> = {
  not_sado_approved: "Not yet approved",
  department_review: "Department review",
  email_review: "Final email review",
  submitted_to_sado: "Submitted for approval",
  sado_approved: "Approved",
  rejected: "Rejected",
};

export const departmentLabel = (value: string) => value.replaceAll("_", " ");
