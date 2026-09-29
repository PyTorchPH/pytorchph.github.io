"use client";

import { useSyncExternalStore } from "react";

// The static export reads fictional demo responses from the official API.
export type DemoAudience = "member" | "officer";
type Fixture = { status: number; body: unknown };
type Fixtures = Record<DemoAudience, Record<string, Fixture>>;

const AUDIENCE_KEY = "pytorch-ph-demo-audience";
// Empty on the root PH site; set for project sites served under a path.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? "").replace(/\/$/, "");
const FIXTURES_URL = `${API_ORIGIN}/demo/fixtures`;
const READ_ONLY_MESSAGE = "This is a read-only demo, so your changes were not saved.";
const listeners = new Set<() => void>();

function withDemoBasePath(text: string) {
  return BASE_PATH ? text.replaceAll("\"/demo/", `"${BASE_PATH}/demo/`) : text;
}

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


const QUEUE_POLL_START_MS = 1000;
const QUEUE_POLL_MAX_MS = 5000;
const QUEUE_GIVE_UP_MS = 15 * 60 * 1000;

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// When the API is busy it stores a request on disk and answers 202 + x-queued. Follow the job
// until it finishes and hand back its stored response, so pages see an ordinary (slower) reply.
async function settleQueued(response: Response, originalFetch: typeof fetch): Promise<Response> {
  if (response.status !== 202 || response.headers.get("x-queued") !== "1") return response;
  const { jobId } = await response.clone().json() as { jobId?: string };
  if (!jobId) return response;
  const started = Date.now();
  let delay = QUEUE_POLL_START_MS;
  while (Date.now() - started < QUEUE_GIVE_UP_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(QUEUE_POLL_MAX_MS, Math.round(delay * 1.5));
    const poll = await originalFetch(`${API_ORIGIN}/queue/${jobId}`, { credentials: "include", cache: "no-store" }).catch(() => null);
    if (!poll || poll.status === 202) continue;
    if (!poll.ok) return poll;
    const result = await poll.json() as { status: string; response?: { status: number; contentType: string | null; body: string } };
    if (result.status !== "done" || !result.response) return json({ error: "The queued request could not be completed." }, 502);
    return new Response(result.response.status === 204 ? null : decodeBase64(result.response.body), { status: result.response.status, headers: result.response.contentType ? { "Content-Type": result.response.contentType } : {} });
  }
  return json({ error: "The server is still busy; your request is queued. Try again later." }, 504);
}

function installDemoApi() {
  if (typeof window === "undefined" || (window as { __phDemoApi?: boolean }).__phDemoApi) return;
  (window as { __phDemoApi?: boolean }).__phDemoApi = true;
  const originalFetch = window.fetch.bind(window);
  let fixtures: Promise<Fixtures> | undefined;
  let session: Promise<DemoAudience> | undefined;
  const verifiedAudience = () => (session ??= originalFetch(`${API_ORIGIN}/auth/me`, { credentials: "include", cache: "no-store" })
    .then(async response => {
      if (!response.ok) throw new Error(`Session check returned ${response.status}`);
      const viewer = await response.json() as { role: string };
      const audience: DemoAudience = viewer.role === "officer" || viewer.role === "admin" ? "officer" : "member";
      try { sessionStorage.setItem(AUDIENCE_KEY, audience); } catch { /* Session still authorizes API data. */ }
      listeners.forEach(listener => listener());
      return audience;
    })
    .catch(error => { session = undefined; throw error; }));
  // Captured data links synthetic media as "/demo/..."; project sites serve it under the base path.
  const loadFixtures = () => (fixtures ??= originalFetch(FIXTURES_URL, { cache: "no-store", credentials: "include" })
    .then(response => {
      if (!response.ok) throw new Error(`Demo API returned ${response.status}`);
      return response.text();
    })
    .then(text => JSON.parse(withDemoBasePath(text)) as Fixtures)
    .catch(error => { fixtures = undefined; throw error; }));

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (API_ORIGIN && url.origin === new URL(API_ORIGIN).origin) return settleQueued(await originalFetch(input, init), originalFetch);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const method = requestMethod(input, init);
    if (method === "POST" && url.pathname === "/api/auth/signout") {
      if (API_ORIGIN) {
        const response = await originalFetch(`${API_ORIGIN}/auth/signout`, { method: "POST", credentials: "include", cache: "no-store" });
        if (!response.ok) return response;
      }
      try { sessionStorage.removeItem(AUDIENCE_KEY); } catch { /* Storage may be unavailable. */ }
      session = undefined;
      listeners.forEach(listener => listener());
      return json({ ok: true });
    }
    if (API_ORIGIN) {
      try { await verifiedAudience(); }
      catch { return json({ error: "Sign in to access the member portal." }, 401); }
      const target = `${API_ORIGIN}/portal${url.pathname}${url.search}`;
      const response = await settleQueued(await originalFetch(target, { ...(input instanceof Request ? { method: input.method, headers: input.headers, body: input.body } : {}), ...init, credentials: "include", cache: "no-store" }), originalFetch);
      const contentType = response.headers.get("content-type");
      if (method === "GET" && BASE_PATH && url.pathname.startsWith("/api/product/") && response.ok && contentType?.includes("application/json")) {
        return new Response(withDemoBasePath(await response.text()), { status: response.status, headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" } });
      }
      return response;
    }
    // Official auth calls use AUTH_API_ORIGIN directly. Demo views retain their
    // existing response contracts, now supplied by the Rust service.
    if (method !== "GET" && method !== "HEAD") return json({ error: READ_ONLY_MESSAGE }, 403);
    try {
      const fixture = lookup(await loadFixtures(), url);
      return fixture ? json(fixture.body, fixture.status) : json({ error: "This view is not available in the demo." }, 404);
    } catch (error) {
      console.error("Demo API unavailable", error);
      return json({ error: "Demo data is temporarily unavailable." }, 503);
    }
  };
}

installDemoApi();

// Keep the demo API active on every exported route without rendering a banner.
export function DemoApiProvider() { return null; }
