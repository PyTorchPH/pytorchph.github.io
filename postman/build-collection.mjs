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
];

function request(name, method, path, { body, status, test, manual = false, headers = [] } = {}) {
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
      ...(body !== undefined ? { body: { mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } } } : {}),
      description: manual ? "Manual contract check. Set required collection variables, then enable runWrites=true. Do not run against production unless the intended effect is approved." : "Automated smoke check. Uses the Postman cookie jar for the current role.",
    },
    event: [
      ...(manual ? [{ listen: "prerequest", script: { exec: ["if (pm.collectionVariables.get('runWrites') !== 'true' || pm.collectionVariables.get('manualRequest') !== pm.info.requestName) pm.execution.skipRequest();"], type: "text/javascript" } }] : []),
      { listen: "test", script: { exec: script, type: "text/javascript" } },
    ],
  };
}

const publicReads = [
  request("Health", "GET", "/health", { test: "pm.test('healthy', () => pm.expect(pm.response.json().status).to.eql('ok'));" }),
  request("Public events", "GET", "/public/events", { test: "pm.test('array', () => pm.expect(pm.response.json()).to.be.an('array'));" }),
  request("Leaderboard", "GET", "/leaderboard"),
];
const auth = [
  request("Member password login", "POST", "/auth/password", { body: { email: "{{memberEmail}}", password: "{{memberPassword}}" }, test: "pm.test('member role', () => pm.expect(pm.response.json().role).to.eql('member'));" }),
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
  request("Create event", "POST", "/events", { manual: true, body: { title: "Postman Test", category: "talk", starts_at: "2026-12-01T00:00:00Z", competitive: false } }),
  request("Add entrant", "POST", "/events/{{eventId}}/entrants", { manual: true, body: { member_ids: ["{{memberId}}"] } }),
  request("Publish results", "POST", "/events/{{eventId}}/results", { manual: true, body: { placements: [] } }),
  request("Import Google Form attendance", "POST", "/events/{{eventId}}/attendance/import", { manual: true, body: { form_id: "{{googleFormId}}" } }),
  request("Submit evidence", "POST", "/evidence", { manual: true, body: { source: "postman" } }),
  request("Submit extension envelope", "POST", "/evidence/extension", { manual: true, body: { claims: [] } }),
  request("Review evidence", "POST", "/evidence/{{claimId}}/review", { manual: true, body: { decision: "reject" } }),
  request("Set officer roles", "POST", "/members/{{memberId}}/officer-roles", { manual: true, body: { roles: [] } }),
  request("Set mail route", "POST", "/mail/routes/{{category}}", { manual: true, body: { sender_role: "officer" } }),
  request("Create mail draft", "POST", "/mail/drafts", { manual: true, body: { subject: "Postman Test", body: "Test" } }),
  request("Edit mail draft", "PATCH", "/mail/drafts/{{draftId}}", { manual: true, body: { subject: "Postman Test" }, headers: [{ key: "If-Match", value: "{{draftRevision}}" }] }),
  request("Approve mail draft", "POST", "/mail/drafts/{{draftId}}/approve", { manual: true, body: {} }),
  request("Release mail draft", "POST", "/mail/drafts/{{draftId}}/release", { manual: true, body: {} }),
  request("Reconcile mail dispatch", "POST", "/mail/drafts/{{draftId}}/reconcile", { manual: true, body: { outcome: "failed" } }),
  request("Claim mail dispatch", "POST", "/internal/mail/claim", { manual: true, body: {}, headers: [{ key: "Authorization", value: "Bearer {{internalMailKey}}" }] }),
  request("Download dispatch PDF", "GET", "/internal/mail/{{draftId}}/pdf", { manual: true, headers: [{ key: "Authorization", value: "Bearer {{internalMailKey}}" }] }),
  request("Record dispatch receipt", "POST", "/internal/mail/{{draftId}}/receipt", { manual: true, body: {}, headers: [{ key: "Authorization", value: "Bearer {{internalMailKey}}" }] }),
];

const collection = {
  info: { name: "PyTorch PH API", description: "Run Public + Auth smoke after deployment. Signup and mutation folders are manual and skipped unless runWrites=true. Member and officer sessions are sequential and use Postman's cookie jar.", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: vars.map(([key, value]) => ({ key, value })),
  item: [
    { name: "Public smoke", item: publicReads },
    { name: "Auth and role smoke", item: auth },
    { name: "Signup and Google manual", item: signup },
    { name: "Entity reads manual", item: readsWithIds },
    { name: "Writes manual", item: writes },
  ],
};
writeFileSync(new URL("./PyTorch-PH.postman_collection.json", import.meta.url), `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Generated ${collection.item.reduce((count, folder) => count + folder.item.length, 0)} API requests.`);
