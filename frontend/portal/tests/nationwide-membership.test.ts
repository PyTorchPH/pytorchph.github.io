import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loginSchema, registerSchema, canSeeAdmin, hasAdvancedAnalytics, hasPriorityEnrollment } from "@pytorch-ph/domain-protocol/identity";
import { authenticationProvider, audienceForHost, isOfficerOnlyPath, memberDestination } from "@pytorch-ph/domain-server/identity";

const moduleFiles = (directory: string) =>
  readdirSync(directory).filter((name) => /\.tsx?$/.test(name)).map((name) => join(directory, name));

const validRegistration ={ name: "Community Contributor", username: "community_builder", email: "builder@gmail.com", password: "Valid#Passphrase9", confirm: "Valid#Passphrase9", terms: true };

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
  for (const invalid of [{ password: "short" }, { password: "alllowercase#9", confirm: "alllowercase#9" }, { password: "NoSymbolHere9", confirm: "NoSymbolHere9" }, { password: "NoDigits#Here", confirm: "NoDigits#Here" }, { confirm: "different-passphrase" }, { terms: false }, { username: "" }]) {
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
  assert.equal(authenticationProvider("public.example.org"), "rust-api");
});

test("public website and authentication copy are nationwide and do not claim format validates ownership", () => {
  // The landing page and the credential forms are composed from per-section modules.
  const landing = ["app/page.tsx", ...moduleFiles("app/_landing")].map((path) => readFileSync(path, "utf8")).join("\n");
  const credentials = moduleFiles("../features/identity/session/credentials").map((path) => readFileSync(path, "utf8")).join("\n");
  const shell = readFileSync("../features/identity/session/render-shell.tsx", "utf8");
  assert.match(landing, /PyTorch Philippines/);
  assert.match(landing, /nationwide/i);
  assert.doesNotMatch([landing, credentials, shell].join("\n"), /FEU|FIT-email|FIT-VERIFIED|school email verified|@fit\.edu\.ph|@feutech\.edu\.ph|Campus Engine|student chapter/i);
  assert.match(credentials, /Valid email format/);
  assert.match(credentials, /Enter the 8-digit code sent to/);
});
