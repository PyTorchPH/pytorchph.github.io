import assert from "node:assert/strict";
import test from "node:test";
import { audienceForHost, isOfficerOnlyPath, memberDestination } from "@pytorch-ph/domain-server/identity";

test("the request host selects one portal audience and unknown hosts fail to member", () => {
  assert.equal(audienceForHost("members.ph.localhost:3100"), "member");
  assert.equal(audienceForHost("officers.ph.localhost:3100"), "officer");
  assert.equal(audienceForHost("unknown.example"), "member");
  assert.equal(audienceForHost(undefined), "member");
});

test("member navigation redirects officer-only routes without broadening access", () => {
  assert.equal(isOfficerOnlyPath("/reports"), true);
  assert.equal(isOfficerOnlyPath("/reports/open"), true);
  assert.equal(isOfficerOnlyPath("/leaderboards"), false);
  assert.equal(memberDestination("/reports/open"), "/dashboard");
  assert.equal(memberDestination("/leaderboards"), "/leaderboards");
});
