import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicJobs, summarizePublicJobs, type PublicJob } from "../../features/job-discovery/public-jobs";

const job: PublicJob = { id: 1, title: "Software engineer", company_name: "Fixture company", candidate_required_location: "Worldwide", url: "https://remotive.com/remote-jobs/software-dev/fixture-1", publication_date: "2026-10-01T00:00:00Z" };

test("public job summaries preserve unknown requirements and source attribution", () => {
  const summary = summarizePublicJobs([job, { ...job, id: 2, candidate_required_location: "Canada" }], ["Philippines"], "software");
  assert.equal(summary.sample_size, 1);
  assert.equal(summary.unknown_degree_count, 1);
  assert.equal(summary.unknown_experience_count, 1);
  assert.deepEqual(summary.skill_demand, []);
  assert.deepEqual(summary.personal_comparison, []);
  assert.equal(summary.sources[0].label, "Remotive");
  assert.equal(summary.hiring_layoff_series[0].layoffs, null);
  assert.match(summary.warnings.join(" "), /24 hours/);
});

test("job fetch validates source URLs, encodes search, and forwards cancellation", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (input: URL, options: RequestInit) => {
    assert.equal(input.hostname, "remotive.com");
    assert.equal(input.searchParams.get("search"), "C++ & Python");
    assert.equal(options.signal, controller.signal);
    return Response.json({ jobs: [job, { ...job, url: "https://example.test/unsafe" }, null] });
  });
  assert.deepEqual(await fetchPublicJobs(" C++ & Python ", controller.signal), [job]);
});

test("malformed source responses become explicit failures", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(null));
  await assert.rejects(fetchPublicJobs("software"), /invalid job list/);
});
