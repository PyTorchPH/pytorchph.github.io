import type { ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";

export const demoPersonas = [
  { id: "demo-primary", name: "Alex Rivera", state: "job-ready", track: "Software & ML", points: 3280, streak: 5 },
  { id: "demo-new", name: "Sam #18B4A", state: "new", track: "Foundations", points: 540, streak: 1 },
  { id: "demo-developing", name: "Mika #7A82F", state: "developing", track: "Computer Vision", points: 2860, streak: 4 },
  { id: "demo-applicant", name: "Jules #29C10", state: "active-applicant", track: "Data Engineering", points: 2410, streak: 3 },
  { id: "demo-officer", name: "Ari #4D91B", state: "chapter-officer", track: "Deep Learning", points: 3890, streak: 7 },
] as const;

const events = [
  { id: "event-ignite", title: "PyTorch Ignite", date: "Aug 22, 2026", department: "Learning Programs", type: "Orientation", seats: 120, registered: true, learningObjective: "Understand what PyTorch is and how the chapter supports student growth.", output: "Personal learning pathway and chapter orientation checklist." },
  { id: "event-models", title: "Models from First Principles", date: "Aug 29, 2026", department: "Engineering", type: "Pseudo-workshop", seats: 48, registered: false, learningObjective: "Explain a model, data, training, and evaluation without assuming prior ML experience.", output: "A small hand-worked model exercise and reflection." },
  { id: "event-vision", title: "Computer Vision Build Lab", date: "Sep 12, 2026", department: "Research", type: "Workshop", seats: 36, registered: false, learningObjective: "Build and evaluate a bounded image-classification prototype.", output: "Repository, evaluation note, and demo recording." },
  { id: "event-career", title: "Evidence-to-Resume Clinic", date: "Sep 19, 2026", department: "Career Development", type: "Clinic", seats: 32, registered: false, learningObjective: "Translate verified work into role-specific resume evidence.", output: "Reviewed evidence record and one targeted resume draft." },
  { id: "event-luminapy", title: "LuminaPy Team Challenge", date: "Nov 7, 2026", department: "Competitions", type: "Hackathon", seats: 60, registered: false, learningObjective: "Apply technical, collaboration, and responsible-AI practices in a team build.", output: "Working prototype, documentation, and judged presentation." },
];

const leaderboard = [...demoPersonas]
  .sort((a, b) => b.points - a.points)
  .map((persona, index) => ({ rank: index + 1, name: persona.name, track: persona.track, points: persona.points, streak: persona.streak, badges: persona.state === "chapter-officer" ? ["Officer", "Mentor"] : persona.state === "job-ready" ? ["Builder", "Career"] : ["Learner"], currentUser: persona.id === "demo-primary" }));

const common = {
  evidence: {
    ready: true,
    phase: "ready",
    profileFacts: [
      { label: "Profile", value: "Development candidate" },
      { label: "Target", value: "Software and ML roles" },
      { label: "Evidence policy", value: "Verified sources only" },
    ],
    sources: [
      { id: "github", label: "GitHub", kind: "Projects and contributions", status: "verified" as const, maturity: "available" as const, connectionStatus: "connected" as const, connectionMethod: "website_session" as const, description: "Website-first project evidence using cached, layout-scoped extraction rules.", permissions: ["Read public projects", "Read contribution metadata"], evidenceCount: 4, lastSyncedAt: "2026-08-14T02:35:00Z" },
      { id: "linkedin", label: "LinkedIn", kind: "Professional profile and posts", status: "ready" as const, maturity: "available" as const, connectionStatus: "connected" as const, connectionMethod: "website_session" as const, description: "Uses a user-approved visible browser session and stops when verification is required.", permissions: ["Read visible profile", "Read selected posts"], evidenceCount: 2, lastSyncedAt: "2026-08-12T08:20:00Z" },
      { id: "facebook", label: "Facebook", kind: "Selected public posts", status: "blocked" as const, maturity: "available" as const, connectionStatus: "verification_required" as const, connectionMethod: "website_session" as const, description: "Collection pauses at login, CAPTCHA, or account verification.", permissions: ["Read user-selected posts"], evidenceCount: 0, lastSyncedAt: null },
      { id: "twitter", label: "Twitter / X", kind: "Public posts", status: "ready" as const, maturity: "beta" as const, connectionStatus: "disconnected" as const, connectionMethod: "website_session" as const, description: "Beta adapter with bounded DOM sampling and deterministic rule replay.", permissions: ["Read selected public posts"], evidenceCount: 0, lastSyncedAt: null },
      { id: "instagram", label: "Instagram", kind: "Public portfolio posts", status: "ready" as const, maturity: "beta" as const, connectionStatus: "disconnected" as const, connectionMethod: "website_session" as const, description: "Beta adapter; challenged sessions always require human completion.", permissions: ["Read selected public posts"], evidenceCount: 0, lastSyncedAt: null },
      { id: "website", label: "Generic website", kind: "Portfolio or project URL", status: "ready" as const, maturity: "experimental" as const, connectionStatus: "disconnected" as const, connectionMethod: "url" as const, description: "AI plans strict rules from a bounded rendered-DOM inventory, then code replays them.", permissions: ["Read the submitted URL"], evidenceCount: 0, lastSyncedAt: null },
      { id: "upload", label: "Photos & documents", kind: "Private uploads", status: "verified" as const, maturity: "available" as const, connectionStatus: "connected" as const, connectionMethod: "upload" as const, description: "Private evidence selected by the user. AI analysis requires approval every time.", permissions: ["Store selected files privately"], evidenceCount: 3, lastSyncedAt: "2026-08-14T03:05:00Z" },
      { id: "manual", label: "Manual entry", kind: "User-authored evidence", status: "verified" as const, maturity: "available" as const, connectionStatus: "connected" as const, connectionMethod: "manual" as const, description: "The user remains the source of truth and can revise any normalized achievement.", permissions: ["Save user-entered evidence"], evidenceCount: 1, lastSyncedAt: "2026-08-14T03:12:00Z" },
    ],
    skills: ["Python", "PyTorch", "React", "FastAPI", "SQL"],
    blockers: ["Connect a user-approved social session to collect additional evidence."],
    items: [
      {
        id: "evidence-ml-showcase", sourceId: "github", title: "Presented an ML project at a community showcase", organization: "University Innovation Lab", role: "Machine Learning Developer", dateLabel: "March 2026", mediaUrl: "/demo/evidence/ml-showcase.webp", mediaAlt: "Synthetic demo photo of a student presenting a machine-learning project", verificationState: "user_verified" as const, confidence: 96,
        description: "Built and presented an image-classification prototype, explaining the training workflow and evaluation results to a mixed technical audience.", quantitative: ["Evaluated the prototype on 1,200 labelled images from the approved project dataset."], qualitative: ["Translated model behavior into a clear demonstration for students and faculty."], skills: ["Python", "PyTorch", "Computer Vision"], sourceUrl: "https://github.com/example/campus-vision-demo",
      },
      {
        id: "evidence-workshop", sourceId: "linkedin", title: "Facilitated a hands-on programming workshop", organization: "AI Study Circles", role: "Workshop Facilitator", dateLabel: "May 2026", mediaUrl: "/demo/evidence/workshop-facilitation.webp", mediaAlt: "Synthetic demo photo of a student facilitating a programming workshop", verificationState: "ai_proposed" as const, confidence: 88,
        description: "Guided participants through a practical model-training exercise and helped resolve setup and debugging issues.", quantitative: [], qualitative: ["Helped participants complete the exercise by breaking down environment and training-loop errors."], skills: ["Python", "Teaching", "PyTorch"],
        aiProposal: { summary: "The selected photo and source text support a facilitation achievement, but do not prove attendance counts.", changes: [{ field: "Description", before: "Helped in a coding workshop.", after: "Facilitated a hands-on model-training workshop and resolved participant setup issues." }, { field: "Skills", before: "Python", after: "Python, PyTorch, Teaching" }], warnings: ["No verified participant count was found; no metric was added."] },
      },
      {
        id: "evidence-hackathon", sourceId: "upload", title: "Completed an ethical AI hackathon prototype", organization: "Campus AI Hack Night", role: "Prototype Team Member", dateLabel: "July 2026", mediaUrl: "/demo/evidence/hackathon-team.webp", mediaAlt: "Synthetic demo photo of a student team celebrating a prototype", verificationState: "source_matched" as const, confidence: 91,
        description: "Collaborated on a working sensor prototype and documented its intended use, limitations, and data-handling constraints.", quantitative: [], qualitative: ["Connected the prototype implementation with an explicit responsible-use review."], skills: ["Teamwork", "Prototyping", "Data Ethics"],
      },
      {
        id: "evidence-api", sourceId: "github", title: "Built a permission-gated application API", organization: "Open Systems Lab", role: "Backend Developer", dateLabel: "June 2026", mediaUrl: "/demo/evidence/manual-placeholder.svg", mediaAlt: "Synthetic placeholder for a backend project", verificationState: "user_verified" as const, confidence: 94,
        description: "Designed a FastAPI service that separates safe drafts, human approvals, and final actions.", quantitative: ["Covered 18 permission and validation scenarios in the synthetic project test suite."], qualitative: ["Made consequential actions auditable and separately authorized."], skills: ["Python", "FastAPI", "SQL", "Testing"],
      },
      {
        id: "evidence-dashboard", sourceId: "manual", title: "Created an accessible analytics dashboard", organization: "Student Technology Studio", role: "Frontend Developer", dateLabel: "April 2026", mediaUrl: "/demo/evidence/manual-placeholder.svg", mediaAlt: "Synthetic placeholder for an analytics dashboard", verificationState: "user_verified" as const, confidence: 90,
        description: "Built responsive career and program dashboards with provenance, empty states, and keyboard-accessible controls.", quantitative: [], qualitative: ["Turned fragmented operational data into reviewable decision views."], skills: ["TypeScript", "React", "Next.js", "Accessibility"],
      },
      {
        id: "evidence-data", sourceId: "upload", title: "Normalized a multi-source career dataset", organization: "Career Data Practicum", role: "Data Automation Developer", dateLabel: "February 2026", mediaUrl: "/demo/evidence/manual-placeholder.svg", mediaAlt: "Synthetic placeholder for a data automation project", verificationState: "source_matched" as const, confidence: 89,
        description: "Mapped projects, skills, education, and achievements into one validated reusable profile.", quantitative: ["Validated 6 source categories through one normalized schema."], qualitative: ["Reduced duplicate editing across role-specific career outputs."], skills: ["Python", "Data Modeling", "JSON Schema", "Automation"],
      },
    ],
  },
  resumes: [
    { id: "software-systems", label: "Software Systems", summary: "Backend, web, and automation evidence.", skillGroupCount: 4, projectCount: 5, ready: true, formats: [] },
    { id: "machine-learning", label: "Machine Learning", summary: "PyTorch, data, and model-development evidence.", skillGroupCount: 3, projectCount: 4, ready: true, formats: [] },
    { id: "automation-data", label: "Automation & Data", summary: "APIs, workflow automation, and normalized data evidence.", skillGroupCount: 4, projectCount: 5, ready: true, formats: [] },
  ],
  resumeProfile: {
    fullName: "Alex Rivera", headline: "Software & Machine Learning Developer", email: "alex.rivera@example.test", location: "Metro Manila, Philippines", summary: "Synthetic fourth-year computer-science persona focused on evidence-backed machine-learning products, reliable web systems, and practical technical education.",
    experience: [{ title: "Workshop Facilitator", organization: "AI Study Circles", dateLabel: "May 2026", bullets: ["Facilitated a hands-on model-training workshop and resolved participant setup issues."] }],
    projects: [{ title: "Campus Vision Demo", summary: "Image-classification prototype presented to a mixed technical audience.", bullets: ["Evaluated the prototype on 1,200 labelled images from the approved project dataset.", "Explained the training workflow and evaluation results during a community showcase."] }, { title: "Responsible Sensor Prototype", summary: "Collaborative hackathon prototype with documented limitations and data-handling constraints.", bullets: ["Connected implementation decisions with an explicit responsible-use review."] }],
    skillGroups: [{ name: "Python", items: ["PyTorch", "FastAPI"] }, { name: "JavaScript", items: ["React", "Next.js"] }, { name: "Data", items: ["PostgreSQL", "Supabase"] }],
    education: [],
  },
  operations: {
    goalLabel: "Reviewed applications",
    completed: 2,
    target: 8,
    activeWorkers: 0,
    reviews: [
      { id: "review-1", title: "Resume selection", detail: "Confirm the role-specific artifact before upload.", state: "waiting", humanGate: true },
      { id: "review-2", title: "Job-site verification", detail: "A visible browser session must be verified by the user.", state: "blocked", humanGate: true },
      { id: "review-3", title: "Questionnaire answers", detail: "Review evidence IDs before advancing the synthetic questionnaire.", state: "waiting", humanGate: true },
      { id: "review-4", title: "Final demo confirmation", detail: "Confirm the local simulation only; no employer receives data.", state: "waiting", humanGate: true },
    ],
  },
  opportunities: [
    { id: "opp-1", company: "Northstar Systems", title: "Junior Software Engineer", location: "Remote — Philippines", workMode: "remote", stage: "human_review", fit: 82, salaryBand: "PHP 40k–80k", nextStage: "demo_confirmed" },
    { id: "opp-2", company: "SignalForge AI", title: "Machine Learning Intern", location: "Makati", workMode: "hybrid", stage: "drafted", fit: 76, salaryBand: "PHP 20k–40k", nextStage: "human_review" },
    { id: "opp-3", company: "Harbor Data Works", title: "Data Automation Associate", location: "Remote — Philippines", workMode: "remote", stage: "discovered", fit: 79, salaryBand: "PHP 40k–80k", nextStage: "drafted" },
    { id: "opp-4", company: "Copperline Software", title: "QA Automation Intern", location: "Taguig", workMode: "hybrid", stage: "discovered", fit: 73, salaryBand: "PHP 20k–40k", nextStage: "drafted" },
    { id: "opp-5", company: "Cedar Cloud Lab", title: "Backend Engineering Trainee", location: "Quezon City", workMode: "onsite", stage: "shortlisted", fit: 68, salaryBand: "Below PHP 20k", nextStage: "drafted" },
    { id: "opp-6", company: "OpenField Research", title: "AI Research Assistant", location: "Remote — Singapore", workMode: "remote", stage: "discovered", fit: 64, salaryBand: "Unknown", nextStage: "drafted" },
  ],
  connections: [
    { id: "supabase", label: "Supabase", category: "database" as const, status: "disconnected" as const, detail: "Configure production environment variables." },
    { id: "github", label: "GitHub", category: "identity" as const, status: "connected" as const, detail: "Approved development fixture." },
    { id: "indeed", label: "Indeed", category: "job_site" as const, status: "verification_required" as const, detail: "Human verification required before automation." },
    { id: "linkedin", label: "LinkedIn evidence", category: "social" as const, status: "connected" as const, detail: "User-approved visible session; read-only evidence collection." },
    { id: "facebook", label: "Facebook evidence", category: "social" as const, status: "verification_required" as const, detail: "Open a visible browser and complete verification before collection." },
  ],
  events,
  leaderboard,
};

const headings: Record<ProductView, ProductViewData["heading"]> = {
  dashboard: { eyebrow: "Career command center", title: "Your career system, at a glance.", description: "Verified evidence, role-specific resumes, market signals, and permission-gated job operations." },
  "career-evidence": { eyebrow: "Normalized career database", title: "Career Evidence", description: "Trace approved sources through the retrieval middleman into reusable, verified career facts." },
  resumes: { eyebrow: "Generated outputs", title: "Resume Studio", description: "Review role-specific artifacts generated from the normalized career database." },
  "job-operations": { eyebrow: "Human-gated execution", title: "Job Automation", description: "Monitor safe work, explicit goals, and every item waiting for your approval." },
  opportunities: { eyebrow: "Evidence-backed market fit", title: "Opportunities & Interviews", description: "Review roles, qualification signals, and funnel progress without inventing missing evidence." },
  connections: { eyebrow: "Access and identity", title: "Connections & Sessions", description: "See sanitized connection health without exposing credentials, cookies, or browser state." },
  advisor: { eyebrow: "Grounded recommendations", title: "Career Advisor", description: "Recommendations must cite normalized evidence and abstain when support is missing." },
};

export function demoProductView(view: ProductView): ProductViewData {
  return {
    meta: { source: "demo", provider: "local", mode: "local_demo", synthetic: true, generatedAt: new Date().toISOString(), label: "Local synthetic demo" },
    heading: headings[view],
    stats: [
      { label: "Verified evidence", value: "6", detail: "Synthetic, reviewable inputs" },
      { label: "Resume artifacts", value: "3", detail: "Ready for layout testing" },
      { label: "Opportunities", value: "6", detail: "Local simulation only" },
      { label: "Human gates", value: "4", detail: "Separately approved" },
    ],
    ...common,
    analytics: {
      metrics: { state: "demo", data: [{ label: "Demo members", value: String(demoPersonas.length), delta: "5 states", trend: "up" as const }, { label: "Evidence items", value: String(common.evidence.items.length), delta: "reviewable", trend: "up" as const }, { label: "Active applications", value: "4", delta: "2 gated", trend: "up" as const }, { label: "Upcoming events", value: String(events.length), delta: "1 joined", trend: "up" as const }] },
      activity: { state: "demo", data: [{ day: "Mon", events: 1, contributions: 3 }, { day: "Tue", events: 0, contributions: 4 }, { day: "Wed", events: 1, contributions: 7 }, { day: "Thu", events: 0, contributions: 5 }, { day: "Fri", events: 2, contributions: 8 }, { day: "Sat", events: 1, contributions: 6 }, { day: "Sun", events: 0, contributions: 2 }] },
      trust: { state: "demo", data: [{ label: "Synthetic records", value: "100%", tone: "good" as const }, { label: "Human gates", value: "4", tone: "warn" as const }, { label: "External writes", value: "0", tone: "good" as const }, { label: "Seed version", value: "v1", tone: "info" as const }] },
      departments: { state: "demo", data: [{ department: "Academics", open: 3, approved: 2 }, { department: "Engineering", open: 4, approved: 3 }, { department: "Career", open: 3, approved: 2 }, { department: "Research", open: 2, approved: 1 }] },
      events: { state: "demo", data: { planning: events.slice(3).map((item) => ({ id: item.id, title: item.title, owner: item.department, seats: item.seats })), approved: events.slice(1, 3).map((item) => ({ id: item.id, title: item.title, owner: item.department, seats: item.seats })), live: events.slice(0, 1).map((item) => ({ id: item.id, title: item.title, owner: item.department, seats: item.seats })), concluded: [] } },
      approvals: { state: "demo", data: common.operations.reviews.map((item) => ({ id: item.id, title: item.title, department: "Career", status: item.state, risk: "human gate", age: "demo" })) },
      leaderboard: { state: "demo", data: leaderboard },
      skills: { state: "demo", data: [{ skill: "Software", score: 76 }, { skill: "Machine Learning", score: 68 }, { skill: "Data", score: 64 }, { skill: "Leadership", score: 58 }, { skill: "Career Readiness", score: 71 }] },
    },
    recommendations: [
      { title: "Strengthen deployment evidence", detail: "Add a verified production outcome before claiming operational experience.", evidenceIds: ["demo-github"] },
      { title: "Keep role variants focused", detail: "Use the ML artifact only where the job description contains evidenced model-development requirements.", evidenceIds: ["demo-document"] },
    ],
  };
}
