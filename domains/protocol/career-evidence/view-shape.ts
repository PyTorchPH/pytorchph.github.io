export const productViews = [
  "dashboard",
  "career-evidence",
  "resumes",
  "job-operations",
  "opportunities",
  "connections",
  "advisor",
] as const;

export type ProductView = (typeof productViews)[number];
export type ProductProvider = "local" | "supabase";
export type ProductSource = "live" | "demo";
export type AnalyticsState = "live" | "demo" | "unavailable";

export type AnalyticsModule<T> = {
  state: AnalyticsState;
  data: T;
};

export type DashboardAnalytics = {
  metrics: AnalyticsModule<Array<{ label: string; value: string; delta: string; trend: "up" | "down" }>>;
  activity: AnalyticsModule<Array<{ day: string; events: number | null; contributions: number | null }>>;
  trust: AnalyticsModule<Array<{ label: string; value: string; tone: "good" | "warn" | "info" }>>;
  departments: AnalyticsModule<Array<{ department: string; open: number | null; approved: number | null }>>;
  events: AnalyticsModule<Record<"planning" | "approved" | "live" | "concluded", Array<{ id: string; title: string; owner: string; seats: number }>>>;
  approvals: AnalyticsModule<Array<{ id: string; title: string; department: string; status: string; risk: string; age: string }>>;
  leaderboard: AnalyticsModule<Array<{ rank: number; name: string; track: string; points: number }>>;
  skills: AnalyticsModule<Array<{ skill: string; score: number | null }>>;
};

export type ProductMeta = {
  source: ProductSource;
  provider: ProductProvider;
  mode: "local_demo" | "production";
  synthetic: boolean;
  generatedAt: string;
  label: string;
};

export type EvidenceSource = {
  id: string;
  label: string;
  kind: string;
  status: "verified" | "ready" | "blocked";
  maturity?: "available" | "beta" | "experimental";
  connectionStatus?: "connected" | "disconnected" | "verification_required";
  connectionMethod?: "website_session" | "url" | "upload" | "manual";
  description?: string;
  permissions?: string[];
  evidenceCount?: number;
  lastSyncedAt?: string | null;
  configuredUrl?: string | null;
};

export type EvidenceItem = {
  id: string;
  sourceId: string;
  evidenceKind?: "experience" | "project";
  collectionOrigin?: "manual" | "upload" | "automated_scrape" | "legacy_unknown";
  title: string;
  organization: string;
  role: string;
  dateLabel: string;
  description: string;
  quantitative: string[];
  qualitative: string[];
  skills: string[];
  mediaUrl: string;
  mediaAlt: string;
  verificationState: "draft" | "ai_proposed" | "source_matched" | "user_verified";
  confidence?: number;
  sourceUrl?: string;
  aiProposal?: {
    summary: string;
    changes: Array<{ field: string; before: string; after: string }>;
    warnings: string[];
  };
};

export type ResumeProfile = {
  fullName: string;
  headline: string;
  email: string;
  location: string;
  summary: string;
  experience: Array<{ title: string; organization: string; dateLabel: string; bullets: string[] }>;
  projects: Array<{ title: string; summary: string; bullets: string[] }>;
  skillGroups: Array<{ name: string; items: string[] }>;
  education: Array<{ school: string; program: string; dateLabel: string }>;
};

export type ResumeArtifact = {
  id: string;
  label: string;
  summary: string;
  skillGroupCount: number;
  projectCount: number;
  ready: boolean;
  formats: Array<{ label: string; url: string }>;
};

export type ReviewItem = {
  id: string;
  title: string;
  detail: string;
  state: string;
  humanGate: boolean;
};

export type Opportunity = {
  id: string;
  company: string;
  title: string;
  location: string;
  workMode: string;
  stage: string;
  fit: number | null;
  salaryBand?: string;
  nextStage?: string | null;
  recordOrigin?: "manual" | "automated_scrape" | "legacy_unknown";
};

export type ChapterEvent = {
  id: string;
  title: string;
  date: string;
  department: string;
  type: string;
  seats: number;
  registered: boolean;
  learningObjective: string;
  output: string;
};

export type LeaderboardEntry = {
  rank: number;
  name: string;
  track: string;
  points: number;
  streak: number;
  badges: string[];
  currentUser?: boolean;
};

export type Connection = {
  id: string;
  label: string;
  category: "identity" | "social" | "job_site" | "database";
  status: "connected" | "disconnected" | "verification_required";
  detail: string;
};

export type DeveloperDiagnostics = {
  schemaVersion: "1";
  build: { version: string; commit: string };
  request: { route: string; view: ProductView; audience: "officer" };
  authorization: { role: string; isOfficer: true; diagnostics: true };
  data: {
    provider: ProductProvider;
    mode: ProductMeta["mode"];
    source: ProductSource;
    synthetic: boolean;
    generatedAt: string;
  };
  performance: { repositoryReadMs: number };
  warnings: string[];
};

export type ProductViewData = {
  meta: ProductMeta;
  heading: { eyebrow: string; title: string; description: string };
  stats: Array<{ label: string; value: string; detail: string }>;
  evidence?: {
    ready: boolean;
    phase: string;
    profileFacts: Array<{ label: string; value: string }>;
    sources: EvidenceSource[];
    skills: string[];
    blockers: string[];
    items?: EvidenceItem[];
  };
  resumes?: ResumeArtifact[];
  resumeProfile?: ResumeProfile;
  operations?: {
    goalLabel: string;
    completed: number;
    target: number;
    activeWorkers: number;
    reviews: ReviewItem[];
  };
  opportunities?: Opportunity[];
  events?: ChapterEvent[];
  leaderboard?: LeaderboardEntry[];
  connections?: Connection[];
  recommendations?: Array<{ title: string; detail: string; evidenceIds: string[] }>;
  analytics?: DashboardAnalytics;
  diagnostics?: DeveloperDiagnostics;
};

export interface ProductRepository {
  readonly provider: ProductProvider;
  read(view: ProductView, userId: string): Promise<ProductViewData>;
}

const unavailable = <T>(data: T): AnalyticsModule<T> => ({ state: "unavailable", data });

export function unavailableDashboardAnalytics(): DashboardAnalytics {
  return {
    metrics: unavailable([]),
    activity: unavailable([]),
    trust: unavailable([]),
    departments: unavailable([]),
    events: unavailable({ planning: [], approved: [], live: [], concluded: [] }),
    approvals: unavailable([]),
    leaderboard: unavailable([]),
    skills: unavailable([]),
  };
}

export function isProductView(value: string): value is ProductView {
  return productViews.includes(value as ProductView);
}
