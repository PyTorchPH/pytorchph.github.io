import { writeFileSync } from "node:fs";

const origin = "{{apiOrigin}}";
const siteOrigin = "{{siteOrigin}}";
const vars = [
  ["apiOrigin", "https://api.pytorch.ph"], ["siteOrigin", "https://pytorch.ph"],
  ["memberEmail", "member@admin.ph"], ["memberPassword", ""],
  ["officerEmail", "officer@admin.ph"], ["officerPassword", ""],
  ["newEmail", ""], ["newPassword", ""], ["verificationCode", ""],
  ["memberId", ""], ["eventId", ""], ["claimId", ""], ["draftId", ""],
  ["jobId", ""], ["runWrites", "false"], ["manualRequest", ""],
  ["runId", ""], ["contentHash", ""], ["entrantId", ""], ["draftRevision", ""],
  ["category", "postman_test"], ["googleFormId", ""], ["internalMailKey", ""],
  ["portalEventId", ""], ["portalOpportunityId", ""], ["portalEvidenceId", ""], ["portalFeedbackId", ""], ["portalMediaId", ""], ["portalUsername", "postman_demo"], ["photoData", ""],
];

function request(name, method, path, { body, status, test, before, manual = false, headers = [] } = {}) {
  const expected = status ?? (manual ? null : 200);
  const script = [
    expected === null
      ? `pm.test("${name}: success status", () => pm.expect(pm.response.code).to.be.within(200, 299));`
      : `pm.test("${name}: HTTP ${expected}", () => pm.response.to.have.status(${expected}));`,
    ...(test ? [test] : []),
  ];
  const header = [{ key: "Origin", value: siteOrigin }, ...headers];
  if (body !== undefined) header.push({ key: "Content-Type", value: "application/json" });
  return {
    name,
    request: {
      method,
      header,
      url: { raw: `${origin}${path}`, host: [origin], path: path.replace(/^\//, "").split("/") },
      ...(body !== undefined ? { body: { mode: "raw", raw: JSON.stringify(body, null, 2).replaceAll('"{{draftRevision}}"', '{{draftRevision}}'), options: { raw: { language: "json" } } } } : {}),
      description: manual ? "Manual contract check. Set required collection variables, then enable runWrites=true. Do not run against production unless the intended effect is approved." : "Automated smoke check. Uses the Postman cookie jar for the current role.",
    },
    event: [
      ...((manual || before) ? [{ listen: "prerequest", script: { exec: [
        ...(manual ? ["if (pm.collectionVariables.get('runWrites') !== 'true' || pm.collectionVariables.get('manualRequest') !== pm.info.requestName) pm.execution.skipRequest();"] : []),
        ...(before ? [before] : []),
      ], type: "text/javascript" } }] : []),
      { listen: "test", script: { exec: script, type: "text/javascript" } },
    ],
  };
}

const publicReads = [
  request("Health", "GET", "/health", { test: "pm.test('healthy', () => pm.expect(pm.response.json().status).to.eql('ok'));" }),
  request("Demo fixtures", "GET", "/demo/fixtures", { test: "pm.test('synthetic member and officer views', () => { const body = pm.response.json(); pm.expect(body).to.have.keys('member', 'officer'); });" }),
  request("Public events", "GET", "/public/events", { test: "pm.test('array', () => pm.expect(pm.response.json()).to.be.an('array'));" }),
  request("Leaderboard", "GET", "/leaderboard"),
];
const auth = [
  request("Member password login", "POST", "/auth/password", { body: { email: "{{memberEmail}}", password: "{{memberPassword}}" }, test: "pm.test('member role', () => pm.expect(pm.response.json().role).to.eql('member')); pm.collectionVariables.set('memberId', pm.response.json().id);" }),
  request("Member session", "GET", "/auth/me", { test: "pm.test('member role', () => pm.expect(pm.response.json().role).to.eql('member'));" }),
  request("Member claims", "GET", "/evidence/me"),
  request("Officer password login", "POST", "/auth/password", { body: { email: "{{officerEmail}}", password: "{{officerPassword}}" }, test: "pm.test('officer role', () => pm.expect(pm.response.json().role).to.eql('officer'));" }),
  request("Officer session", "GET", "/auth/me", { test: "pm.test('officer role', () => pm.expect(pm.response.json().role).to.eql('officer'));" }),
  request("Eligible members", "GET", "/members"),
  request("Internal events", "GET", "/events"),
  request("Pending evidence", "GET", "/evidence/pending"),
];
const signup = [
  request("Start signup and email code", "POST", "/auth/email/start", { manual: true, body: { email: "{{newEmail}}", password: "{{newPassword}}", name: "Postman Test", username: "postman_test" }, test: "pm.test('generic confirmation', () => pm.expect(pm.response.json().message).to.be.a('string'));" }),
  request("Verify email code", "POST", "/auth/email/verify", { manual: true, body: { email: "{{newEmail}}", code: "{{verificationCode}}" }, test: "pm.test('new member', () => pm.expect(pm.response.json().role).to.eql('member'));" }),
  request("Google sign in", "POST", "/auth/google", { manual: true, body: { id_token: "{{googleIdToken}}" } }),
];
const readsWithIds = [
  request("Event entrants", "GET", "/events/{{eventId}}/entrants", { manual: true }),
  request("Event results", "GET", "/events/{{eventId}}/results", { manual: true }),
  request("Attendance", "GET", "/events/{{eventId}}/attendance", { manual: true }),
  request("Job status", "GET", "/jobs/{{jobId}}", { manual: true }),
  request("Mail draft", "GET", "/mail/drafts/{{draftId}}", { manual: true }),
  request("Mail PDF", "GET", "/mail/drafts/{{draftId}}/pdf", { manual: true, test: "pm.test('PDF content type', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('pdf'));" }),
];
const writes = [
  request("Approve member", "POST", "/members/{{memberId}}/approve", { manual: true, body: { role: "member" }, status: 204 }),
  request("Create event", "POST", "/events", { manual: true, status: 201, body: { title: "Postman Test", category: "competitive", startsAt: "2020-01-01T00:00:00Z", entrantKind: "individual", placePoints: [10] }, test: "pm.collectionVariables.set('eventId', pm.response.json().id);" }),
  request("Add entrant", "POST", "/events/{{eventId}}/entrants", { manual: true, status: 201, body: { name: "Postman member", memberIds: ["{{memberId}}"] }, test: "pm.collectionVariables.set('entrantId', pm.response.json().id);" }),
  request("Publish results", "POST", "/events/{{eventId}}/results", { manual: true, body: { expectedRevision: 0, placements: [{ place: 1, entrantId: "{{entrantId}}" }], reason: "Postman test result" } }),
  request("Import Google Form attendance", "POST", "/events/{{eventId}}/attendance/import", { manual: true, body: { formId: "{{googleFormId}}", points: 10 } }),
  request("Submit evidence", "POST", "/evidence", { manual: true, status: 201, body: { kind: "personal_project", title: "Postman test evidence", sourceUrl: "https://github.com/pytorch-ph/postman-test", contentHash: "{{contentHash}}" }, test: "pm.collectionVariables.set('claimId', pm.response.json().id);" }),
  request("Submit extension envelope", "POST", "/evidence/extension", { manual: true, status: 201, body: { schemaVersion: 1, source: "github", origin: "extension_scrape", pageUrl: "https://github.com/pytorch-ph/postman-test", contentHash: "sha256:{{contentHash}}", items: [{ title: "Postman extension test", text: "Static validation data", sourceUrl: "https://github.com/pytorch-ph/postman-test", evidenceKind: "project" }] } }),
  request("Review evidence", "POST", "/evidence/{{claimId}}/review", { manual: true, body: { decision: "reject", reason: "Postman test rejection" }, status: 204 }),
  request("Set officer roles", "POST", "/members/{{memberId}}/officer-roles", { manual: true, body: { roles: [] } }),
  request("Set mail route", "POST", "/mail/routes/{{category}}", { manual: true, body: { requiredRoles: ["secretariat"], senderRole: "secretariat" }, status: 204 }),
  request("Create mail draft", "POST", "/mail/drafts", { manual: true, status: 201, body: { category: "{{category}}", recipients: ["postman@example.invalid"], subject: "Postman Test", body: "Static test draft, never send", pdfText: null }, test: "const body = pm.response.json(); pm.collectionVariables.set('draftId', body.id); pm.collectionVariables.set('draftRevision', body.revision);" }),
  request("Edit mail draft", "PATCH", "/mail/drafts/{{draftId}}", { manual: true, body: { subject: "Postman Test revised" }, headers: [{ key: "If-Match", value: "{{draftRevision}}" }], test: "pm.collectionVariables.set('draftRevision', pm.response.json().revision);" }),
  request("Approve mail draft", "POST", "/mail/drafts/{{draftId}}/approve", { manual: true, body: { revision: "{{draftRevision}}", role: "secretariat" }, status: 204 }),
  request("Release mail draft", "POST", "/mail/drafts/{{draftId}}/release", { manual: true, body: { revision: "{{draftRevision}}" }, status: 204 }),
  request("Reconcile mail dispatch", "POST", "/mail/drafts/{{draftId}}/reconcile", { manual: true, body: { status: "failed", reason: "Postman test reconciliation", externalMessageId: null }, status: 204 }),
  request("Claim mail dispatch", "POST", "/internal/mail/claim", { manual: true, headers: [{ key: "x-workflow-key", value: "{{internalMailKey}}" }] }),
  request("Download dispatch PDF", "GET", "/internal/mail/{{draftId}}/pdf", { manual: true, headers: [{ key: "x-workflow-key", value: "{{internalMailKey}}" }] }),
  request("Record dispatch receipt", "POST", "/internal/mail/{{draftId}}/receipt", { manual: true, body: { status: "failed", externalMessageId: null }, status: 204, headers: [{ key: "x-workflow-key", value: "{{internalMailKey}}" }] }),
];

// Explicitly opt in: these requests persist marked synthetic records in the selected API.
const writeGuard = "if (pm.collectionVariables.get('runWrites') !== 'true') pm.execution.skipRequest();";
const workflow = [
  request("01 Member login", "POST", "/auth/password", { before: `${writeGuard} const id = pm.variables.replaceIn('{{$guid}}').replaceAll('-', ''); pm.collectionVariables.set('runId', id); pm.collectionVariables.set('contentHash', id + pm.variables.replaceIn('{{$guid}}').replaceAll('-', ''));`, body: { email: "{{memberEmail}}", password: "{{memberPassword}}" }, test: "pm.test('member role', () => pm.expect(pm.response.json().role).to.eql('member')); pm.collectionVariables.set('memberId', pm.response.json().id);" }),
  request("02 Member cannot create event", "POST", "/events", { before: writeGuard, status: 403, body: { title: "Postman denied {{runId}}", category: "competitive", startsAt: "2020-01-01T00:00:00Z", entrantKind: "individual", placePoints: [10] } }),
  request("03 Member submits evidence", "POST", "/evidence", { before: writeGuard, status: 201, body: { kind: "personal_project", title: "Postman test {{runId}}", sourceUrl: "https://github.com/pytorch-ph/postman-test", contentHash: "{{contentHash}}" }, test: "pm.collectionVariables.set('claimId', pm.response.json().id);" }),
  request("04 Member reads own evidence", "GET", "/evidence/me", { before: writeGuard, test: "pm.test('submitted claim is visible', () => pm.expect(pm.response.json().some(item => item.id === pm.collectionVariables.get('claimId'))).to.eql(true));" }),
  request("05 Officer login", "POST", "/auth/password", { before: writeGuard, body: { email: "{{officerEmail}}", password: "{{officerPassword}}" }, test: "pm.test('officer role', () => pm.expect(pm.response.json().role).to.eql('officer'));" }),
  request("06 Officer sees member", "GET", "/members", { before: writeGuard, test: "pm.test('member is eligible', () => pm.expect(pm.response.json().some(item => item.id === pm.collectionVariables.get('memberId'))).to.eql(true));" }),
  request("07 Officer creates competitive event", "POST", "/events", { before: writeGuard, status: 201, body: { title: "Postman test {{runId}}", category: "competitive", startsAt: "2020-01-01T00:00:00Z", entrantKind: "individual", placePoints: [10] }, test: "pm.collectionVariables.set('eventId', pm.response.json().id);" }),
  request("08 Officer adds entrant", "POST", "/events/{{eventId}}/entrants", { before: writeGuard, status: 201, body: { name: "Postman test entrant", memberIds: ["{{memberId}}"] }, test: "pm.collectionVariables.set('entrantId', pm.response.json().id);" }),
  request("09 Officer publishes results", "POST", "/events/{{eventId}}/results", { before: writeGuard, body: { expectedRevision: 0, placements: [{ place: 1, entrantId: "{{entrantId}}" }], reason: "Postman test result" }, test: "pm.test('result revision advanced', () => pm.expect(pm.response.json().revision).to.eql(1));" }),
  request("10 Officer reads results", "GET", "/events/{{eventId}}/results", { before: writeGuard, test: "pm.test('result persisted', () => pm.expect(pm.response.json().revision).to.eql(1));" }),
  request("11 Officer sees pending evidence", "GET", "/evidence/pending", { before: writeGuard, test: "pm.test('member claim is pending', () => pm.expect(pm.response.json().some(item => item.id === pm.collectionVariables.get('claimId'))).to.eql(true));" }),
  request("12 Officer rejects test evidence", "POST", "/evidence/{{claimId}}/review", { before: writeGuard, status: 204, body: { decision: "reject", reason: "Synthetic Postman test claim" } }),
  request("13 Member login again", "POST", "/auth/password", { before: writeGuard, body: { email: "{{memberEmail}}", password: "{{memberPassword}}" }, test: "pm.test('member role restored', () => pm.expect(pm.response.json().role).to.eql('member'));" }),
  request("14 Member sees reviewed claim", "GET", "/evidence/me", { before: writeGuard, test: "pm.test('review persisted', () => pm.expect(pm.response.json().find(item => item.id === pm.collectionVariables.get('claimId'))?.status).to.eql('rejected'));" }),
  request("15 Member signout", "POST", "/auth/signout", { before: writeGuard, status: 200 }),
];

// These calls use the same authenticated browser contracts as the exported portal.
// Select a single manualRequest after logging in as the matching role.
const portal = [
  request("Portal privacy read", "GET", "/portal/api/member/privacy", { manual: true }),
  request("Portal privacy save", "PUT", "/portal/api/member/privacy", { manual: true, body: { hideGoogleIdentity: true, hideRealName: false, deviceCacheEnabled: true, anonymousRanking: false, automaticErrorReports: true } }),
  request("Portal leaderboard identity", "GET", "/portal/api/member/leaderboard-identity", { manual: true }),
  request("Portal username availability", "GET", "/portal/api/member/leaderboard-identity?username={{portalUsername}}", { manual: true }),
  request("Portal identity save", "PUT", "/portal/api/member/leaderboard-identity", { manual: true, body: { username: "{{portalUsername}}", mode: "nickname", realNameConsent: false } }),
  request("Portal opportunities", "GET", "/portal/api/product/opportunities", { manual: true }),
  request("Portal demo event toggle", "POST", "/portal/api/product/demo-action", { manual: true, body: { action: "toggle_event", id: "event-ignite" } }),
  request("Portal opportunity create", "POST", "/portal/api/product/opportunities", { manual: true, status: 201, body: { company: "Postman test", title: "Synthetic role", location: "Remote", workMode: "remote", stage: "discovered", fit: 70 }, test: "pm.collectionVariables.set('portalOpportunityId', pm.response.json().opportunity.id);" }),
  request("Portal opportunity update", "PATCH", "/portal/api/product/opportunities/{{portalOpportunityId}}", { manual: true, body: { company: "Postman test", title: "Synthetic role", location: "Remote", workMode: "remote", stage: "drafted", fit: 70 } }),
  request("Portal career evidence", "GET", "/portal/api/product/career-evidence", { manual: true }),
  request("Portal evidence source connect", "POST", "/portal/api/product/sources/github", { manual: true, body: { action: "connect", url: "https://github.com/pytorch-ph" } }),
  request("Portal evidence create", "POST", "/portal/api/product/evidence", { manual: true, status: 201, body: { item: { title: "Synthetic Postman evidence", description: "Static test data" } }, test: "pm.collectionVariables.set('portalEvidenceId', pm.response.json().item.id);" }),
  request("Portal evidence update", "PATCH", "/portal/api/product/evidence/{{portalEvidenceId}}", { manual: true, body: { item: { title: "Synthetic Postman evidence", description: "Revised static test data" }, approve: true } }),
  request("Portal photo upload", "POST", "/portal/api/product/evidence", { manual: true, status: 201, body: { title: "Synthetic Postman photo", photoData: "{{photoData}}" }, test: "pm.collectionVariables.set('portalMediaId', pm.response.json().item.mediaUrl.split('/').pop());" }),
  request("Portal private photo", "GET", "/portal/media/{{portalMediaId}}", { manual: true, test: "pm.test('JPEG content type', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('image/jpeg'));" }),
  request("Portal external events", "GET", "/portal/api/events", { manual: true }),
  request("Portal external event submit", "POST", "/portal/api/events", { manual: true, status: 201, body: { title: "Synthetic Postman event", organizer: "PyTorch PH", summary: "Synthetic external event used to verify production writes.", category: "workshops", scope: "external", startAt: "2026-10-01T09:00:00+08:00", endAt: null, timezone: "Asia/Manila", venue: "Online", registrationUrl: null, registrationDeadline: null, fee: "Free", eligibility: [], requirements: [], sourceUrl: "https://example.com/postman-event", scrapedAt: "2026-09-29T00:00:00Z", contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", scraperVersion: "postman", confidence: 1, warnings: [] }, test: "pm.collectionVariables.set('portalEventId', pm.response.json().id);" }),
  request("Portal event interest", "PATCH", "/portal/api/events/{{portalEventId}}", { manual: true, body: { action: "interest" } }),
  request("Portal feedback read", "GET", "/portal/api/feedback", { manual: true }),
  request("Portal feedback submit", "POST", "/portal/api/feedback", { manual: true, status: 201, body: { category: "suggestion", description: "Synthetic Postman feedback", route: "/dashboard/", uiState: { title: "Dashboard", viewport: "1280x720", online: true, componentMarkers: [] } }, test: "pm.collectionVariables.set('portalFeedbackId', pm.response.json().id);" }),
  request("Portal feedback update (officer)", "PATCH", "/portal/api/feedback/{{portalFeedbackId}}", { manual: true, body: { status: "triaged", severity: "low", assignedTo: null, resolution: null } }),
  request("Portal feedback note (officer)", "POST", "/portal/api/feedback/{{portalFeedbackId}}/notes", { manual: true, status: 201, body: { body: "Synthetic Postman review note" } }),
  request("Portal AI status (static)", "GET", "/portal/api/backend/local-ai/status", { manual: true, test: "pm.test('static AI', () => pm.expect(pm.response.json().configured).to.eql(false));" }),
  request("Portal AI analysis (static)", "POST", "/portal/api/product/evidence/analyze", { manual: true, body: { consent: true, evidenceId: "{{portalEvidenceId}}", current: { title: "Synthetic Postman evidence", description: "Static data" } } }),
  request("Portal AI upskill (static)", "POST", "/portal/api/backend/local-ai/upskill", { manual: true, body: { role: "developer", skills: ["Python"] } }),
];

const collection = {
  info: { name: "PyTorch PH API", description: "Run Public + Auth smoke first. The Member and officer write workflow requires runWrites=true and persists synthetic records. Manual folders cover admin and external integrations. Uses Postman's cookie jar.", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: vars.map(([key, value]) => ({ key, value })),
  item: [
    { name: "Public smoke", item: publicReads },
    { name: "Auth and role smoke", item: auth },
    { name: "Member and officer write workflow", item: workflow },
    { name: "Signup and Google manual", item: signup },
    { name: "Entity reads manual", item: readsWithIds },
    { name: "Writes manual", item: writes },
    { name: "Portal production demo contracts", item: portal },
  ],
};
writeFileSync(new URL("./PyTorch-PH.postman_collection.json", import.meta.url), `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Generated ${collection.item.reduce((count, folder) => count + folder.item.length, 0)} API requests.`);
