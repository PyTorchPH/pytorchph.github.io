---
logic_id: development.local-auto-access
code_paths:
  - development/local-access
  - development/prefect-dashboard/build-dashboard.mjs
  - development/local-workspace/processes.mjs
  - development/local-workspace/setup.mjs
  - development/local-workspace/start.mjs
  - domains/server/identity/session
  - domains/client/identity/session
  - apps/portal/app/api/auth
  - apps/portal/proxy.ts
tests:
  - tests/node/workspace-boundaries.test.mjs
  - apps/portal/tests/product-gateway.test.ts
feedback_events:
  - local_access.role_ready
  - local_access.failed
  - local_auth.session_created
  - local_auth.session_rejected
related_logic: []
---
# Local Automatic Access

The local workspace opens separate visible member and officer browser profiles and authenticates
deterministic synthetic accounts against the local SQLite database. Non-loopback and production
requests use Supabase. Local authentication is unavailable in production, Vercel, and CI.

## States and contract

Each role moves through `launching -> authenticating -> ready` or `failed`. Inputs are an approved
loopback portal origin, the local SQLite database, a synthetic account, a persistent
role-specific browser profile, and an installed browser executable. A ready role produces a visible
browser on its role destination and logs the final URL; a failure throws with a bounded local error
and leaves the other production boundaries unchanged.

## Invariants

- The visible browser uses the native window viewport (`viewport: null`); it must not retain
  Playwright's fixed `1280x720` emulation after the window is maximized.
- Launch requests a maximized window while remaining usable when the window manager ignores that
  hint. Resizing the visible browser must resize the page viewport, keep the page scrollbar at the
  browser content edge, and avoid an unused black strip.
- Member and officer sessions use separate persistent profiles and cookies scoped to their exact
  loopback origins. Hostname selection never grants officer authority.
- After both roles are ready, the watcher retains an active event-loop handle until `SIGINT` or
  `SIGTERM`; it must not rely on an unresolved top-level promise that Node may terminate as an
  unsettled module evaluation.
- Missing local auth state, an unavailable browser, or a non-loopback/production runtime fails
  closed. Credentials, cookies, and tokens are never written to feedback output.
- Provider selection requires both a non-production runtime and an exact loopback hostname.
  Client-controlled host text alone never activates local authentication in production or Vercel.
- `npm run dev` defaults to local SQLite for product data, credentials, and sessions. It does not
  start Supabase. `npm run dev -- --supabase` explicitly starts and selects Supabase.
- Local sessions use opaque random tokens. SQLite stores only token hashes; browser cookies are
  `HttpOnly`, `SameSite=Lax`, host-scoped, and expire deterministically.
- Local account lookup, session creation, session validation, revocation, and role authorization
  remain behind the server identity provider boundary. Client code never reads SQLite.
- Local workspace child processes resolve Node package-manager launchers for the host platform.
  Windows invokes npm's JavaScript entry points through Node, avoiding unsupported direct batch-file
  spawning; POSIX hosts retain `npm`/`npx`.
- Supabase startup and key discovery execute only in explicit Supabase mode. Its status payload is
  never copied to local logs.
- The Prefect local state directory is created before its server starts, so a clean workspace can
  initialize its SQLite metadata without a manual filesystem step.
- Python child processes use UTF-8 output on Windows so Prefect/process-lab diagnostics cannot fail
  on Unicode console output under the host `cp1252` code page.
- The pinned Prefect dashboard is rebuilt only when its validated cache is absent; repeated local
  starts reuse the existing patched output and avoid unnecessary compilation.

## Feedback and failure modes

`local_access.role_ready` is represented by the existing bounded `<role> ready: <url> (<email>)`
local console line. Authentication, browser launch, and navigation failures surface as
`local_access.failed` through the thrown local launcher error; they must never silently disappear or
fall back to a production identity or URL.

Local login records `local_auth.session_created` or bounded `local_auth.session_rejected` without
passwords or session tokens. Missing/expired/revoked sessions produce an anonymous viewer.

## Acceptance tests

- The browser option contract sets `headless: false`, `viewport: null`, and includes
  `--start-maximized` without weakening the local-runtime and loopback gates.
- A maximized headed-browser probe reports a page `innerWidth` that follows the browser content
  width instead of remaining at Playwright's default `1280px`.
- Existing workspace-boundary tests continue to reject production, Vercel, CI, HTTPS, and
  non-loopback automatic access.
- The auto-login watcher uses a referenced keepalive handle and closes both browser contexts when
  the process receives a stop signal.
- The integrated development launcher pins `PYTORCH_PH_DATA_PROVIDER` to `local`.
- The default launcher mode is local, and the Supabase product provider requires an explicit flag.
- Loopback development selects SQLite auth; production, Vercel, CI, and non-loopback hosts select
  Supabase regardless of caller-controlled headers.
- Local login verifies seeded member/officer accounts, persists only a token hash, authorizes each
  portal by role, and deletes both cookie and SQLite session on sign-out.
- Workspace setup and startup resolve npm-family commands to executable Windows Node entry points.
- Prefect dashboard build commands follow the same cross-platform npm launcher contract.
- Prefect startup creates its configured local SQLite state directory before launching the server.
- Prefect and process-lab child commands inherit UTF-8 Python I/O settings on Windows.
- Repeated startup reuses a valid pinned Prefect dashboard cache instead of rebuilding it.
