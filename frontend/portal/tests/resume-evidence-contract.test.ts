import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessClaimEvidence,
  evidenceBackedResumeSchema,
  previewOfficerSelectedPoints,
} from "@pytorch-ph/domain-protocol/resumes";
import { buildRenderableResume } from "@pytorch-ph/domain-client/resumes";

const templatePath = fileURLToPath(new URL("../../contracts/resumes/evidence-backed/template.v1.json", import.meta.url));
const template = JSON.parse(readFileSync(templatePath, "utf8"));

test("canonical contract builds the existing render profile", () => {
  const document = evidenceBackedResumeSchema.parse(template);
  const profile = buildRenderableResume(document, "backend-engineer");

  assert.equal(profile.projects[0]?.title, "GabayBigkas");
  assert.match(profile.projects[0]?.bullets[0] || "", /8,628 authenticated reads/);
});

test("browser assessment cannot award points without officer verification and level", () => {
  const claim = evidenceBackedResumeSchema.parse(template).entries[0].claims[0];

  assert.equal(assessClaimEvidence(claim).grade, "measured");
  assert.equal(previewOfficerSelectedPoints(claim, "contributor", "github"), null);
});

test("point preview mirrors the rubric only after officer verification and selection", () => {
  const payload = structuredClone(template);
  payload.entries[0].claims[0].evidence.status = "officer_verified";
  const claim = evidenceBackedResumeSchema.parse(payload).entries[0].claims[0];

  assert.equal(assessClaimEvidence(claim).pointEligible, true);
  assert.equal(previewOfficerSelectedPoints(claim, undefined, "github"), null);
  assert.equal(previewOfficerSelectedPoints(claim, "contributor", "github"), 40);
});
