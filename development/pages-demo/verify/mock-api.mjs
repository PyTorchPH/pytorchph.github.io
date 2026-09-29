// A stand-in for https://api.pytorch.ph inside Playwright, so the production portal build can be
// exercised without the real server: password sign-in, sessions, the portal gateway (answered
// from the demo fixtures), the member profile gate, and the public reference lists.
// Module map (caller-first):
//   mockApi              install the route handler → controls { state, unexpected }
//   ├─ answerAuth        /auth/password · /auth/me · /auth/signout
//   ├─ answerPortal      /portal/api/* → profile gate, forced failures, fixtures
//   │   └─ fixtureFor    exact path+query, then path, then same endpoint
//   ├─ answerReference   /reference/profile-options · schools · programs · companies
//   └─ answerDirectReads /public/events · /events · /members (empty lists)

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

export const TEST_PASSWORD = "Sample#Pass9";
export const ACCOUNTS = { "member@example.test": "member", "officer@example.test": "officer" };

const root = resolve(import.meta.dirname, "../../..");
const fixtures = JSON.parse(readFileSync(resolve(root, "backend/api/seeds/demo-fixtures.json"), "utf8"));
const profileOptions = JSON.parse(readFileSync(resolve(root, "backend/api/seeds/reference/profile-options.json"), "utf8"));
const schools = JSON.parse(readFileSync(resolve(root, "backend/api/seeds/reference/schools.json"), "utf8")).rows;
// code, level, name, short_name, group_name — the same catalog the API loads.
const programs = gunzipSync(readFileSync(resolve(root, "backend/api/seeds/reference/programs.tsv.gz"))).toString("utf8").trim().split("\n").slice(1).map(line => line.split("\t"));
const WHOLE_LIST_LEVELS = new Set(["junior_high", "senior_high"]);

// Mental model: one mutable session per browser context; each test step flips `state` to shape
// what the next page load sees (who is signed in, whether their profile is complete, what fails).
export async function mockApi(context, { apiOrigin, siteOrigin }) {
  const state = { role: null, profileComplete: true, failingPaths: new Set(), portalRequests: 0 };
  const unexpected = [];
  const cors = { "access-control-allow-origin": siteOrigin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type, if-match", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE" };
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  await context.route(`${apiOrigin}/**`, async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const answer = answerAuth(state, request, url) ?? answerPortal(state, request, url) ?? answerReference(url) ?? answerDirectReads(state, url);
    if (answer) return reply(route, answer.status, answer.body);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return reply(route, 404, { error: "Not mocked" });
  });
  return { state, unexpected };
}

const viewerFor = role => ({ id: `${role}-id`, display_name: role === "officer" ? "Test Officer" : "Test Member", role });

function answerAuth(state, request, url) {
  if (url.pathname === "/auth/password" && request.method() === "POST") {
    const { email, password } = request.postDataJSON();
    const role = ACCOUNTS[String(email).toLowerCase()];
    if (!role || password !== TEST_PASSWORD) return { status: 401, body: { error: "Invalid email or password" } };
    state.role = role;
    return { status: 200, body: viewerFor(role) };
  }
  if (url.pathname === "/auth/me") return state.role ? { status: 200, body: viewerFor(state.role) } : { status: 401, body: { error: "Authentication required" } };
  if (url.pathname === "/auth/signout") { state.role = null; return { status: 200, body: { ok: true } }; }
  return null;
}

function answerPortal(state, request, url) {
  if (!url.pathname.startsWith("/portal/api/")) return null;
  state.portalRequests += 1;
  if (!state.role) return { status: 401, body: { error: "Authentication required" } };
  const path = url.pathname.slice("/portal".length);
  if (state.failingPaths.has(path)) return { status: 503, body: { error: "Service temporarily unavailable" } };
  if (path === "/api/member/profile") return answerProfile(state, request);
  if (request.method() !== "GET") return { status: 403, body: { error: "Writes are not part of this check." } };
  const fixture = fixtureFor(state.role === "officer" ? "officer" : "member", path, url.search);
  return fixture ? { status: fixture.status, body: fixture.body } : { status: 404, body: { error: "View not found" } };
}

function answerProfile(state, request) {
  if (request.method() === "PUT") state.profileComplete = true;
  return { status: 200, body: { complete: state.profileComplete, profile: null } };
}

function fixtureFor(audience, path, search) {
  const views = fixtures[audience];
  const exact = views[path + search] ?? views[path];
  if (exact) return exact;
  const sameEndpoint = Object.keys(views).find(key => key.split("?")[0] === path);
  return sameEndpoint ? views[sameEndpoint] : undefined;
}

function programsFor(level, query) {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0 && !WHOLE_LIST_LEVELS.has(level)) return [];
  return programs
    .filter(([, rowLevel, name, short, group]) => rowLevel === level && words.every(word => `${name} ${short} ${group}`.toLowerCase().split(/[^a-z0-9]+/).some(token => token.startsWith(word))))
    .slice(0, words.length ? 20 : 200)
    .map(([code, , name, shortName, group]) => ({ code, label: name, shortName, group }));
}

// Pages that read the Rust API directly (events, member lists) get empty lists: layout, not data, is under test.
function answerDirectReads(state, url) {
  if (url.pathname === "/public/events") return { status: 200, body: [] };
  if (url.pathname === "/events" || url.pathname === "/members") return state.role ? { status: 200, body: [] } : { status: 401, body: { error: "Authentication required" } };
  return null;
}

function answerReference(url) {
  if (url.pathname === "/reference/profile-options") return { status: 200, body: profileOptions };
  const query = (url.searchParams.get("q") ?? "").toLowerCase();
  if (url.pathname === "/reference/schools") {
    const rows = schools.filter(([, name]) => name.toLowerCase().includes(query)).slice(0, 10);
    return { status: 200, body: rows.map(([code, label, type, region]) => ({ code, label, type, region })) };
  }
  if (url.pathname === "/reference/companies") return { status: 200, body: [{ id: "co-globe", label: "Globe Telecom", detail: "GLO · Manila", aliases: "GLO", city: "Manila", verified: true }].filter(item => item.label.toLowerCase().includes(query)) };
  if (url.pathname === "/reference/programs") return { status: 200, body: programsFor(url.searchParams.get("level") ?? "", query) };
  return null;
}
