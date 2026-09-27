"use client";

import { useSyncExternalStore } from "react";

// Static GitHub Pages cannot run the portal API, so the demo answers /api/* from fixtures
// captured from the local synthetic portal. Writes never leave the browser.
export type DemoAudience = "member" | "officer";
type Fixture = { status: number; body: unknown };
type Fixtures = Record<DemoAudience, Record<string, Fixture>>;

const AUDIENCE_KEY = "pytorch-ph-demo-audience";
// Empty on the root PH site; "/pytorch-fit-system" on the FIT project site.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const FIXTURES_URL = `${BASE_PATH}/demo-api/fixtures.json`;
const READ_ONLY_MESSAGE = "This is a static demo, so nothing was saved. Explore freely—no data leaves your browser.";
const listeners = new Set<() => void>();

export function readAudience(): DemoAudience {
  try {
    return sessionStorage.getItem(AUDIENCE_KEY) === "officer" ? "officer" : "member";
  } catch {
    return "member";
  }
}

export function enterAs(audience: DemoAudience, path = "/dashboard/") {
  try {
    sessionStorage.setItem(AUDIENCE_KEY, audience);
  } catch {
    // Storage can be unavailable in private windows; the member view is the fallback.
  }
  listeners.forEach(listener => listener());
  // A full navigation resets cached capabilities for the newly chosen example account.
  window.location.assign(`${BASE_PATH}${path}`);
}

export function useDemoAudience(): DemoAudience | null {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    readAudience,
    () => null,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return new URL(input, window.location.href);
  return new URL(input instanceof URL ? input.href : input.url, window.location.href);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function lookup(fixtures: Fixtures, url: URL) {
  const byAudience = fixtures[readAudience()];
  const exact = byAudience[url.pathname + url.search] ?? byAudience[url.pathname];
  if (exact) return exact;
  const sameEndpoint = Object.keys(byAudience).find(key => key.split("?")[0] === url.pathname);
  return sameEndpoint ? byAudience[sameEndpoint] : undefined;
}

function login(init?: RequestInit) {
  let email = "";
  try {
    email = String(JSON.parse(String(init?.body ?? "{}")).email ?? "");
  } catch {
    // Malformed demo input falls back to the member example.
  }
  const audience: DemoAudience = email.toLowerCase().includes("officer") ? "officer" : "member";
  try { sessionStorage.setItem(AUDIENCE_KEY, audience); } catch { /* member fallback */ }
  return json({ provider: "local", role: audience === "officer" ? "admin" : "member" });
}

function installDemoApi() {
  if (typeof window === "undefined" || (window as { __phDemoApi?: boolean }).__phDemoApi) return;
  (window as { __phDemoApi?: boolean }).__phDemoApi = true;
  const originalFetch = window.fetch.bind(window);
  let fixtures: Promise<Fixtures> | undefined;
  // Captured data links synthetic media as "/demo/..."; project sites serve it under the base path.
  const loadFixtures = () => (fixtures ??= originalFetch(FIXTURES_URL)
    .then(response => response.text())
    .then(text => JSON.parse(BASE_PATH ? text.replaceAll("\"/demo/", `"${BASE_PATH}/demo/`) : text) as Fixtures));

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const method = requestMethod(input, init);
    if (method === "POST" && url.pathname === "/api/auth/login") return login(init);
    if (method === "POST" && url.pathname === "/api/auth/signout") return json({ ok: true });
    if (method !== "GET" && method !== "HEAD") return json({ error: READ_ONLY_MESSAGE }, 403);
    const fixture = lookup(await loadFixtures(), url);
    return fixture ? json(fixture.body, fixture.status) : json({ error: "This view is not available in the static demo." }, 404);
  };
}

installDemoApi();
