import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loginSchema, registerSchema, canSeeAdmin, hasAdvancedAnalytics, hasPriorityEnrollment } from "@pytorch-ph/domain-protocol/identity";
import { authenticationProvider, audienceForHost, isOfficerOnlyPath, memberDestination } from "@pytorch-ph/domain-server/identity";

const validRegistration = { name: "Community Contributor", username: "community_builder", email: "builder@gmail.com", password: "valid-passphrase", confirm: "valid-passphrase", terms: true };

test("nationwide login and registration accept school and non-school email domains", () => {
  for (const email of ["builder@gmail.com", "researcher@example.org", "mentor@outlook.com", "student@fit.edu.ph", "student@feutech.edu.ph"]) {
    assert.equal(loginSchema.safeParse({ email, password: validRegistration.password, remember: false }).success, true);
    assert.equal(registerSchema.safeParse({ ...validRegistration, email }).success, true);
  }
  assert.equal(registerSchema.parse({ ...validRegistration, email: "  builder@gmail.com  " }).email, "builder@gmail.com");
});

test("nationwide eligibility retains email, password, confirmation, consent, and username validation", () => {
  for (const email of ["", "not-an-email", "builder@", "@gmail.com", "builder@gmail.com.evil invalid"]) {
    assert.equal(registerSchema.safeParse({ ...validRegistration, email }).success, false);
    assert.equal(loginSchema.safeParse({ email, password: validRegistration.password, remember: false }).success, false);
  }
  for (const invalid of [{ password: "short" }, { confirm: "different-passphrase" }, { terms: false }, { username: "" }]) {
    assert.equal(registerSchema.safeParse({ ...validRegistration, ...invalid }).success, false);
  }
  assert.equal(loginSchema.safeParse({ email: "builder@gmail.com", password: "short", remember: false }).success, false);
});

test("nationwide eligibility does not elevate member tiers or officer routes", () => {
  for (const tier of ["general", "active", "leaderboard"] as const) assert.equal(canSeeAdmin(tier), false);
  assert.equal(canSeeAdmin("admin"), true);
  assert.equal(hasPriorityEnrollment("general"), false);
  assert.equal(hasAdvancedAnalytics("general"), false);
  assert.equal(audienceForHost("members.ph.localhost:3100"), "member");
  assert.equal(audienceForHost("officers.ph.localhost:3100"), "officer");
  assert.equal(audienceForHost("officers.ph.localhost.attacker.example:3100"), "member");
  assert.equal(isOfficerOnlyPath("/admin/dashboard"), true);
  assert.equal(memberDestination("/admin/dashboard"), "/dashboard");
  assert.equal(authenticationProvider("public.example.org"), "supabase");
});

test("public website and authentication copy are nationwide and do not claim format validates ownership", () => {
  const landing = readFileSync("app/page.tsx", "utf8");
  const credentials = readFileSync("../../domains/client/identity/session/collect-credentials.tsx", "utf8");
  const shell = readFileSync("../../domains/client/identity/session/render-shell.tsx", "utf8");
  assert.match(landing, /PyTorch Philippines/);
  assert.match(landing, /nationwide/i);
  assert.doesNotMatch([landing, credentials, shell].join("\n"), /FEU|FIT-email|FIT-VERIFIED|school email verified|@fit\.edu\.ph|@feutech\.edu\.ph|Campus Engine|student chapter/i);
  assert.match(credentials, /Valid email format/);
  assert.match(credentials, /Check your email to confirm/);
});
