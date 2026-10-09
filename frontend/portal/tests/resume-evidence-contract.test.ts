import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessClaimEvidence,
  evidenceBackedResumeSchema,
  previewOfficerSelectedPoints,
  promoteResumeDraft,
  requiredProfileGaps,
  resumeEvidenceDraftSchema,
} from "@pytorch-ph/domain-protocol/resumes";
import {
  buildRenderableResume,
  resumeEvidenceExtractionSystemPrompt,
  resumeHtml,
  resumePdfBytes,
  resumePdfPageCount,
} from "@pytorch-ph/domain-client/resumes";

const v2Path = fileURLToPath(new URL("./fixtures/evidence-resume-example.v2.json", import.meta.url));
const v1Path = fileURLToPath(new URL("../../contracts/resumes/evidence-backed/template.v1.json", import.meta.url));
const v2Example = JSON.parse(readFileSync(v2Path, "utf8"));
const v1Template = JSON.parse(readFileSync(v1Path, "utf8"));

test("normalized evidence graph reuses one test across multiple claims", () => {
  const document = resumeEvidenceDraftSchema.parse(v2Example);
  const queueEvidenceLinks = document.claimEvidenceLinks.filter((link) =>
    link.evidenceId === "evidence-queueguard-load"
  );

  assert.equal(document.evidence.filter((item) => item.id === "evidence-queueguard-load").length, 1);
  assert.equal(queueEvidenceLinks.length, 3);
  assert.deepEqual(queueEvidenceLinks.map((link) => link.measurementIds[0]), [
    "metric-throughput",
    "metric-latency-p95",
    "metric-http-error-rate",
  ]);
});

test("normalized contract builds a targeted backend resume without requiring project tests", () => {
  const profile = buildRenderableResume(v2Example, "backend-engineer");

  assert.equal(profile.fullName, "Samira Reyes");
  assert.equal(profile.phone, "+63 900 000 0000");
  assert.equal(profile.experience.length, 1);
  assert.deepEqual(profile.projects.map((project) => project.title), [
    "QueueGuard",
    "Personal CLI Tool",
  ]);
  assert.equal(profile.projects[0]?.bullets.length, 3);
  assert.equal(profile.projects[1]?.bullets.length, 0);
  assert.doesNotMatch(JSON.stringify(profile), /900%/);
});

test("classification and test preferences create a distinct product resume", () => {
  const profile = buildRenderableResume(v2Example, "product-engineer");

  assert.deepEqual(profile.projects.map((project) => project.title), ["Accessible Operations Dashboard"]);
  assert.match(profile.projects[0]?.bullets[0] || "", /eight dashboard routes/i);
  assert.equal(profile.experience.length, 0);
  assert.doesNotMatch(JSON.stringify(profile), /QueueGuard/);
});

test("draft promotion reports missing barebones identity fields", () => {
  const draftInput = structuredClone(v2Example);
  draftInput.profile.email = null;
  draftInput.profile.phone = null;
  const draft = resumeEvidenceDraftSchema.parse(draftInput);

  assert.deepEqual(requiredProfileGaps(draft), ["profile.email", "profile.phone"]);
  assert.throws(() => promoteResumeDraft(draft), /profile\.email, profile\.phone/);
});

test("barebones profile renders contact details and omits every empty optional section", () => {
  const barebones = structuredClone(v2Example);
  barebones.entries = [];
  barebones.claims = [];
  barebones.evidence = [];
  barebones.claimEvidenceLinks = [];
  barebones.narratives = [];
  barebones.environments = [];
  barebones.artifacts = [];
  const profile = buildRenderableResume(barebones, "backend-engineer");
  const html = resumeHtml(profile, "modern");

  assert.match(html, /Samira Reyes/);
  assert.match(html, /\+63 900 000 0000/);
  assert.doesNotMatch(html, /<h2>/);
});

test("final HTML and PDF contain only verified, role-relevant quantitative claims", async () => {
  const profile = buildRenderableResume(v2Example, "backend-engineer");
  const html = resumeHtml(profile, "modern");
  const pdf = await resumePdfBytes(profile, "modern");

  assert.match(html, /238\.4 requests per second/);
  assert.match(html, /112 ms p95/);
  assert.doesNotMatch(html, /900%/);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.equal(await resumePdfPageCount(profile, "modern"), 1);
});

test("AI extraction prompt requires normalization and prohibits invented metrics", () => {
  assert.match(resumeEvidenceExtractionSystemPrompt, /Never invent contact data/);
  assert.match(resumeEvidenceExtractionSystemPrompt, /store each test once/);
  assert.match(resumeEvidenceExtractionSystemPrompt, /Claims are quantitative by definition/);
  assert.match(resumeEvidenceExtractionSystemPrompt, /does not imply certification/);
});

test("v1 browser assessment remains backward compatible", () => {
  const claim = evidenceBackedResumeSchema.parse(v1Template).entries[0].claims[0];

  assert.equal(assessClaimEvidence(claim).grade, "measured");
  assert.equal(previewOfficerSelectedPoints(claim, "contributor", "github"), null);
});

test("v1 point preview still requires officer verification and a selected level", () => {
  const payload = structuredClone(v1Template);
  payload.entries[0].claims[0].evidence.status = "officer_verified";
  const claim = evidenceBackedResumeSchema.parse(payload).entries[0].claims[0];

  assert.equal(assessClaimEvidence(claim).pointEligible, true);
  assert.equal(previewOfficerSelectedPoints(claim, undefined, "github"), null);
  assert.equal(previewOfficerSelectedPoints(claim, "contributor", "github"), 40);
});
