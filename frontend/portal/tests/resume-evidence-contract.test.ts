import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { renderDocxSections } from "../../features/resumes/render-docx-sections";

import {
  assessClaimEvidence,
  evidenceBackedResumeSchema,
  previewOfficerSelectedPoints,
  promoteResumeDraft,
  requiredProfileGaps,
  resumeEvidenceDraftSchema,
  resumeSourceDocumentSchema,
} from "@pytorch-ph/domain-protocol/resumes";
import {
  analyzeResumeSource,
  buildResumeSourceProfile,
  buildRenderableResume,
  parseResumeSourceYaml,
  resumeEvidenceExtractionSystemPrompt,
  resumeHtml,
  resumePdfBytes,
  resumePdfPageCount,
  resumeSourceExtractionSystemPrompt,
} from "@pytorch-ph/domain-client/resumes";

const v2Path = fileURLToPath(new URL("./fixtures/evidence-resume-example.v2.json", import.meta.url));
const v1Path = fileURLToPath(new URL("../../contracts/resumes/evidence-backed/template.v1.json", import.meta.url));
const sourcePath = fileURLToPath(new URL("./fixtures/resume-source-example.v1.yaml", import.meta.url));
const v2Example = JSON.parse(readFileSync(v2Path, "utf8"));
const v1Template = JSON.parse(readFileSync(v1Path, "utf8"));
const sourceExample = parseResumeSourceYaml(readFileSync(sourcePath, "utf8"));

test("source injection groups metrics by shared verified test without changing the AST", () => {
  const source = resumeSourceDocumentSchema.parse(sourceExample);
  const throughput = source.claims.find((claim) => claim.id === "claim-load-throughput")!;
  throughput.statement = "Sustained 245 requests per second under 200 virtual users.";
  source.claims.push({ ...throughput, id: "claim-load-latency", statement: "Measured 108 ms p95 latency under the same workload." });
  source.claimEvidenceLinks.push({ claimId: "claim-load-latency", evidenceId: "evidence-rust-load", measurementIds: ["metric-p95"], relationship: "supports" });
  source.records.find((record) => record.id === "project-rust-serving")!.claimIds.push("claim-load-latency");
  const before = JSON.stringify(source);
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const bullets = profile.sections!.find((section) => section.id === "project")!.items[0].bullets;
  assert.deepEqual(bullets, ["Sustained 245 requests per second under 200 virtual users; Measured 108 ms p95 latency under the same workload."]);
  assert.deepEqual(profile.projects[0].bullets, bullets);
  assert.equal(JSON.stringify(source), before);
});

test("different test runs remain separate and unverified results stay out of condensed bullets", () => {
  const source = resumeSourceDocumentSchema.parse(sourceExample);
  const claim = source.claims.find((item) => item.id === "claim-load-throughput")!;
  const evidence = source.evidence.find((item) => item.id === "evidence-rust-load")!;
  source.evidence.push({ ...evidence, id: "evidence-second-run" }, { ...evidence, id: "evidence-unverified-run", verification: { status: "unverified", verifiedBy: "unreviewed fixture" } });
  source.claims.push({ ...claim, id: "claim-second-run", statement: "A separate run reached 240 requests per second." }, { ...claim, id: "claim-unverified-run", statement: "An unverified run reached 999 requests per second." });
  source.claimEvidenceLinks.push(
    { claimId: "claim-second-run", evidenceId: "evidence-second-run", measurementIds: ["metric-rps"], relationship: "supports" },
    { claimId: "claim-unverified-run", evidenceId: "evidence-unverified-run", measurementIds: ["metric-rps"], relationship: "supports" },
  );
  source.records.find((record) => record.id === "project-rust-serving")!.claimIds.push("claim-second-run", "claim-unverified-run");
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  assert.equal(profile.projects[0].bullets.length, 2);
  assert.match(profile.projects[0].bullets[1], /separate run/);
  assert.doesNotMatch(JSON.stringify(profile), /999 requests/);
});

test("sample titles are clickable without link styling and awards occupy one paragraph", async () => {
  const profile = buildResumeSourceProfile(sourceExample, "ml-engineer");
  const html = resumeHtml(profile, "compact");
  assert.match(html, /<a class="entry-title" href="https:\/\/example\.com\/projects\/paperbridge">PaperBridge<\/a>/);
  assert.match(html, /\.entry-title\{color:inherit;text-decoration:none\}/);
  assert.match(html, /class="entry-description">, Provenance-first MCP service/);
  assert.match(html, /<span class="date">08\/2026 – Present<\/span>/);
  const awards = html.match(/<section><h2>Awards<\/h2>(.*?)<\/section>/s)![1];
  assert.equal((awards.match(/<p /g) || []).length, 1);
  assert.doesNotMatch(awards, /<article|<ul|<li/);
  assert.match(awards, /Top 10 Finalist/);
  assert.match(awards, /Grand Winner/);
  const bytes = await resumePdfBytes(profile, "compact");
  assert.match(new TextDecoder().decode(bytes), /\/URI \(https:\/\/example\.com\/projects\/paperbridge\)/);
});

test("DOCX keeps title hyperlinks, right-aligned dates, and one awards paragraph", async () => {
  const profile = buildResumeSourceProfile(sourceExample, "ml-engineer");
  const document = new Document({ sections: [{ children: renderDocxSections(profile.sections!, 10206) }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const xml = await zip.file("word/document.xml")!.async("string");
  const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
  assert.match(relationships, /Target="https:\/\/example\.com\/projects\/paperbridge"/);
  const project = xml.match(/<w:p>(?:(?!<\/w:p>).)*PaperBridge(?:(?!<\/w:p>).)*<\/w:p>/s)![0];
  assert.match(project, /<w:hyperlink/);
  assert.match(project, /w:val="right" w:pos="10206"/);
  assert.match(project, /08\/2026 – Present/);
  assert.match(project, /w:color w:val="172033"/);
  assert.match(project, /w:u w:val="none"/);
  const awards = xml.match(/<w:p>(?:(?!<\/w:p>).)*Top 10 Finalist(?:(?!<\/w:p>).)*<\/w:p>/s)![0];
  assert.match(awards, /Grand Winner/);
  assert.doesNotMatch(awards, /w:numPr/);
});

test("broad source contract preserves the reference resume section inventory", () => {
  const document = resumeSourceDocumentSchema.parse(sourceExample);

  assert.deepEqual(document.presentationHints.sectionOrder, [
    "skill_group", "experience", "project", "organization", "certificate", "award", "education",
  ]);
  assert.equal(document.person.profiles.length, 3);
  assert.equal(document.records.filter((record) => record.kind === "award").length, 2);
  assert.equal(document.records.filter((record) => record.kind === "certificate").length, 2);
});

test("one source document drives deterministic injection and analysis", () => {
  const profile = buildResumeSourceProfile(sourceExample, "ml-engineer");
  const analysis = analyzeResumeSource(sourceExample);

  assert.deepEqual(profile.sections?.map((section) => section.id), [
    "skill_group", "experience", "project", "organization", "certificate", "award", "education",
  ]);
  assert.equal(profile.links?.length, 4);
  assert.match(JSON.stringify(profile), /245 requests per second/);
  assert.doesNotMatch(JSON.stringify(profile), /Reduced modeled voice cost/);
  assert.equal(analysis.evidenceCoverage.verifiedClaims, 4);
  assert.deepEqual(analysis.evidenceCoverage.unsupportedClaimIds, ["claim-voice-cost"]);
  assert.equal(analysis.readiness, "review_required");
});

test("source resume renders extended sections to HTML and PDF", async () => {
  const profile = buildResumeSourceProfile(sourceExample, "ml-engineer");
  const html = resumeHtml(profile, "compact");
  const pdf = await resumePdfBytes(profile, "compact");

  assert.match(html, /Organisations/);
  assert.match(html, /Certificates/);
  assert.match(html, /Awards/);
  assert.match(html, /grid-template-columns:repeat/);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(await resumePdfPageCount(profile, "compact") <= 2);
});

test("source extraction prompt protects provenance and quantitative evidence", () => {
  assert.match(resumeSourceExtractionSystemPrompt, /Never invent identity/);
  assert.match(resumeSourceExtractionSystemPrompt, /Store each test once/);
  assert.match(resumeSourceExtractionSystemPrompt, /absolute PDF coordinates/);
  assert.match(resumeSourceExtractionSystemPrompt, /never imply certification/);
});

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
