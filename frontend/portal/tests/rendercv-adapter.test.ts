import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildResumeSourceProfile,
  parsePortfolioEvidenceYaml,
  parseResumeSourceYaml,
  renderCvTypst,
  renderCvYaml,
} from "@pytorch-ph/domain-client/resumes";
import { parse } from "yaml";

const fixturePath = fileURLToPath(new URL("./fixtures/resume-source-example.v1.yaml", import.meta.url));
const source = parseResumeSourceYaml(readFileSync(fixturePath, "utf8"));

test("maps the verified resume profile to the official RenderCV v2.8 YAML structure", () => {
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const yaml = renderCvYaml(profile, "compact");
  const document = parse(yaml);

  assert.match(yaml, /refs\/tags\/v2\.8\/schema\.json/);
  assert.equal(document.cv.name, profile.fullName);
  assert.equal(document.cv.phone, undefined);
  assert.match(yaml, /phone was omitted because RenderCV rejected/);
  assert.equal(document.design.theme, "engineeringresumes");
  assert.equal(document.locale.language, "english");
  assert.deepEqual(Object.keys(document), ["cv", "design", "locale", "settings"]);
  assert.deepEqual(
    Object.keys(document.cv.sections),
    ["Professional Summary", ...(profile.sections || []).map((section) => section.title)],
  );
  assert.doesNotMatch(yaml, /Reduced modeled voice cost/);
  assert.equal(document.settings.render_command.dont_generate_pdf, false);
  assert.equal(document.settings.render_command.dont_generate_html, false);
  assert.equal(document.settings.render_command.dont_generate_markdown, false);
  assert.equal(document.settings.render_command.dont_generate_png, false);
});

test("uses RenderCV-native entry types without changing the profile facts", () => {
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const sections = parse(renderCvYaml(profile, "modern")).cv.sections;
  const experience = profile.sections!.find((section) => section.id === "experience")!;
  const projects = profile.sections!.find((section) => section.id === "project")!;
  const skills = profile.sections!.find((section) => section.id === "skill_group")!;
  const education = profile.sections!.find((section) => section.id === "education")!;

  assert.equal(sections[experience.title][0].company, experience.items[0].subheading);
  assert.match(sections[projects.title][0].name, /^\[.+\]\(https:\/\//);
  assert.equal(sections[skills.title][0].label, skills.items[0].heading);
  assert.equal(sections[education.title][0].institution, education.items[0].subheading);
});

test("generates browser-compilable Typst against the vendored RenderCV template", () => {
  const profile = buildResumeSourceProfile(source, "ml-engineer");
  const typst = renderCvTypst(profile, "compact");

  assert.match(typst, /#import "\/rendercv\/lib\.typ": \*/);
  assert.match(typst, /typography-font-family-body: "Source Sans 3"/);
  assert.match(typst, /section-titles-type: "with_full_line"/);
  assert.match(typst, /== Projects/);
  assert.doesNotMatch(typst, /Reduced modeled voice cost/);
});

test("accepts portfolio-evidence/v2 YAML as the upstream resume evidence contract", () => {
  const document = parsePortfolioEvidenceYaml(`
schema: portfolio-evidence/v2
generated_at: 2026-10-05T15:31:13.476Z
generator: { path: collector.ps1, version: 2.0.0, mode: read_only }
scope: {}
privacy: { credentials_exported: false }
summary: {}
projects:
  - project_name: Example
    source_presence: {}
    test_inventory: {}
    execution_evidence: {}
    measured_results: null
    evidence_gaps: {}
evidence_updates: []
`);

  assert.equal(document.schema, "portfolio-evidence/v2");
  assert.equal(document.projects[0].project_name, "Example");
});
