import { createHash } from "node:crypto";
import { eventPackageSchema, requiredDepartmentsByCategory, type EventPackage, type ExternalEvent } from "@pytorch-ph/domain-protocol/organization";

// Fictional events for the static demo, one at each stage of the officer event workflow.
type Sample = Pick<EventPackage, "title" | "organizer" | "summary" | "category" | "startAt" | "venue" | "fee"> & {
  slug: string;
  status: ExternalEvent["status"];
  approvals: number;
  interestCount: number;
  emailStatus?: "pending" | "exported";
  approvalReference?: string;
};

const CAPTURED_AT = "2026-09-27T00:00:00.000Z";

const samples: Sample[] = [
  { slug: "vision-build-night", title: "Computer Vision Build Night", organizer: "Sample Makers Guild", summary: "An evening build session where teams train and compare small image classifiers on a public dataset.", category: "workshops", startAt: "2026-11-14T10:00:00.000Z", venue: "Sample Hub, Cebu City", fee: "Free", status: "department_review", approvals: 1, interestCount: 18 },
  { slug: "model-serving-hackathon", title: "Model Serving Hackathon", organizer: "Sample Developers Circle", summary: "A one-day hackathon on packaging and serving PyTorch models, judged on reliability and clear documentation.", category: "hackathons", startAt: "2026-11-28T01:00:00.000Z", venue: "Sample Innovation Center, Davao City", fee: "Free", status: "email_review", approvals: 3, interestCount: 42, emailStatus: "pending" },
  { slug: "ml-systems-meetup", title: "Machine Learning Systems Meetup", organizer: "Sample Engineering Community", summary: "Lightning talks on data pipelines, evaluation, and monitoring for machine learning systems in production.", category: "workshops", startAt: "2026-12-05T09:00:00.000Z", venue: "Sample Co-working Space, Quezon City", fee: "Free", status: "submitted_to_sado", approvals: 2, interestCount: 27, emailStatus: "exported" },
  { slug: "intro-to-pytorch-day", title: "Introduction to PyTorch Day", organizer: "Sample Learning Network", summary: "A beginner-friendly day of guided notebooks that covers tensors, datasets, and a first training loop.", category: "workshops", startAt: "2026-10-24T01:00:00.000Z", venue: "Online", fee: "Free", status: "sado_approved", approvals: 2, interestCount: 65, emailStatus: "exported", approvalReference: "DEMO-APPROVAL-0001" },
];

function toEvent(sample: Sample): ExternalEvent {
  const sourceUrl = `https://example.org/events/${sample.slug}`;
  const details = { title: sample.title, organizer: sample.organizer, summary: sample.summary, category: sample.category, startAt: sample.startAt, venue: sample.venue, fee: sample.fee, sourceUrl };
  const eventPackage = eventPackageSchema.parse({
    ...details,
    scope: "external",
    endAt: null,
    timezone: "Asia/Manila",
    registrationUrl: sourceUrl,
    registrationDeadline: null,
    eligibility: [],
    requirements: [],
    scrapedAt: CAPTURED_AT,
    contentHash: `sha256:${createHash("sha256").update(JSON.stringify(details)).digest("hex")}`,
    scraperVersion: "manual-entry",
    confidence: 1,
    warnings: ["Entered manually by the submitter."],
  });
  const requiredDepartments = requiredDepartmentsByCategory[sample.category];
  const approvedDepartments = requiredDepartments.slice(0, Math.min(sample.approvals, requiredDepartments.length));
  return {
    ...eventPackage,
    id: `demo-event-${sample.slug}`,
    submittedBy: "demo-member",
    submitterLabel: "Sample Member",
    status: sample.status,
    interested: false,
    interestCount: sample.interestCount,
    revision: 1,
    requiredDepartments,
    approvedDepartments,
    departmentApprovals: approvedDepartments.length,
    departmentTotal: requiredDepartments.length,
    emailDraft: sample.emailStatus ? {
      subject: `Endorsement request: ${sample.title}`,
      body: `Good day,\n\nPyTorch Philippines requests endorsement for "${sample.title}" organized by ${sample.organizer}.\n\nDate: ${new Date(sample.startAt).toUTCString()}\nVenue: ${sample.venue}\nFee: ${sample.fee}\n\n${sample.summary}\n\nEvent page: ${sourceUrl}\n\nThank you.`,
      revisionHash: createHash("sha256").update(sample.slug).digest("hex").slice(0, 16),
      deliveryMode: "copy_export",
      deliveryStatus: sample.emailStatus,
    } : null,
    sadoReference: sample.approvalReference ?? null,
    createdAt: CAPTURED_AT,
  };
}

export const demoExternalEvents: ExternalEvent[] = samples.map(toEvent);
