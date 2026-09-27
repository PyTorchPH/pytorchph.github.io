import { z } from "zod";

export const memberPrivacySettingsSchema = z.object({
  hideGoogleIdentity: z.boolean(),
  hideRealName: z.boolean(),
  deviceCacheEnabled: z.boolean(),
  anonymousRanking: z.boolean(),
  automaticErrorReports: z.boolean(),
}).strict();

export type MemberPrivacySettings = z.infer<typeof memberPrivacySettingsSchema>;

export const feedbackReportSchema = z.object({
  category: z.enum(["bug", "broken_flow", "privacy", "security", "suggestion", "automatic_error"]),
  description: z.string().trim().max(1200).default(""),
  route: z.string().startsWith("/").max(240),
  uiState: z.object({
    title: z.string().max(160),
    viewport: z.string().regex(/^\d+x\d+$/),
    online: z.boolean(),
    componentMarkers: z.array(z.string().max(120)).max(40),
    error: z.string().max(300).optional(),
  }).strict(),
}).strict();

export type FeedbackReportInput = z.infer<typeof feedbackReportSchema>;
export type FeedbackReport = FeedbackReportInput & {
  id: string;
  portal: "member" | "officer";
  status: "received" | "triaged" | "in_progress" | "resolved" | "dismissed";
  severity: "low" | "medium" | "high" | "critical";
  reporterId: string;
  reporterLabel: string;
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackReportPage = {
  items: FeedbackReport[];
  nextCursor: string | null;
};

export const feedbackUpdateSchema = z.object({
  status: z.enum(["received", "triaged", "in_progress", "resolved", "dismissed"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  assignedTo: z.string().uuid().nullable(),
  resolution: z.string().trim().max(1200).nullable(),
}).strict();

export type FeedbackUpdate = z.infer<typeof feedbackUpdateSchema>;

export type MembershipStatus = {
  state: "prospective" | "payment_pending" | "active" | "rejected";
  paid: boolean;
  canEnterMemberPortal: boolean;
  paymentReference: string;
  updatedAt: string;
  demo: boolean;
};

export const operationalEventSchema = z.object({
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  component: z.string().regex(/^[a-z0-9_.-]{2,100}$/),
  stage: z.string().regex(/^[a-z0-9_.-]{2,100}$/),
  code: z.string().regex(/^[a-z0-9_.-]{2,120}$/),
  severity: z.enum(["info", "warning", "error", "critical"]),
  outcome: z.enum(["succeeded", "stopped", "failed"]),
  retryable: z.boolean(),
  occurredAt: z.string().datetime(),
  route: z.string().startsWith("/").max(240),
  appVersion: z.string().max(80).optional(),
  extensionVersion: z.string().max(80).optional(),
  sourceDomain: z.string().max(160).optional(),
  layoutFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  details: z.object({
    message: z.string().max(300).optional(),
    componentMarkers: z.array(z.string().max(120)).max(40).optional(),
  }).strict().optional(),
}).strict();
export type OperationalEventInput = z.infer<typeof operationalEventSchema>;
