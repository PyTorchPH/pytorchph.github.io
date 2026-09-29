import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityManifest } from "@pytorch-ph/domain-protocol/identity";

const base = {
  developmentOwner: true,
  identityConnected: false,
  socialConnected: true,
  jobSiteConnected: true,
  evidenceReady: true,
  normalizedProfileReady: true,
  resumeArtifactsReady: true,
  aiConfigured: true,
};

test("development owner receives only prerequisite-backed capabilities", () => {
  const manifest = buildCapabilityManifest(base);
  assert.equal(manifest.capabilities.evidence_scrape.state, "available");
  assert.equal(manifest.capabilities.resume_generate.state, "available");
  assert.equal(manifest.capabilities.job_discovery.state, "available");
  assert.equal(manifest.capabilities.application_draft.state, "available");
  assert.equal(manifest.capabilities.analytics_read.state, "read_only");
  assert.equal(manifest.capabilities.analytics_write.state, "locked");
});

test("development ownership never substitutes missing external prerequisites", () => {
  const manifest = buildCapabilityManifest({
    ...base,
    jobSiteConnected: false,
    normalizedProfileReady: false,
    resumeArtifactsReady: false,
    aiConfigured: true,
  });
  assert.equal(manifest.capabilities.job_discovery.state, "locked");
  assert.equal(manifest.capabilities.application_draft.state, "locked");
  assert.equal(manifest.capabilities.resume_generate.state, "locked");
  assert.equal(manifest.capabilities.evidence_read.state, "available");
  assert.equal(manifest.capabilities.resume_read.state, "available");
  assert.equal(manifest.capabilities.opportunities_read.state, "available");
});

test("non-owner state fails closed while analytics remains read-only", () => {
  const manifest = buildCapabilityManifest({ ...base, developmentOwner: false });
  assert.equal(manifest.capabilities.connections.state, "locked");
  assert.equal(manifest.capabilities.evidence_scrape.state, "locked");
  assert.equal(manifest.capabilities.job_discovery.state, "locked");
  assert.equal(manifest.capabilities.application_draft.state, "locked");
  assert.equal(manifest.capabilities.analytics_read.state, "read_only");
  assert.equal(manifest.capabilities.analytics_write.state, "locked");
});

test("authenticated users may edit only their own career evidence", () => {
  const manifest = buildCapabilityManifest({
    developmentOwner: false,
    authenticatedUser: true,
    identityConnected: false,
    socialConnected: false,
    jobSiteConnected: false,
    evidenceReady: true,
    normalizedProfileReady: true,
    resumeArtifactsReady: false,
    aiConfigured: false,
  });
  assert.equal(manifest.capabilities.evidence_write.state, "available");
  assert.equal(manifest.capabilities.evidence_read.state, "available");
  assert.equal(manifest.capabilities.resume_read.state, "available");
  assert.equal(manifest.capabilities.opportunities_read.state, "available");
  assert.equal(manifest.capabilities.evidence_scrape.state, "locked");
  assert.equal(manifest.capabilities.resume_generate.state, "locked");
  assert.equal(manifest.capabilities.job_discovery.state, "locked");
  assert.equal(manifest.capabilities.application_draft.state, "locked");
});

test("anonymous users cannot use manual career workspaces", () => {
  const manifest = buildCapabilityManifest({
    ...base,
    developmentOwner: false,
    authenticatedUser: false,
    evidenceReady: false,
    resumeArtifactsReady: false,
    aiConfigured: false,
    jobSiteConnected: false,
  });
  assert.equal(manifest.capabilities.evidence_read.state, "locked");
  assert.equal(manifest.capabilities.resume_read.state, "locked");
  assert.equal(manifest.capabilities.opportunities_read.state, "locked");
});
