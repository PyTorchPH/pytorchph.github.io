# Canonical PyTorch PH frontend

`frontend/portal` is the source of truth for all product-facing entry points. It uses Next.js, the shared
obsidian/off-white/PyTorch-orange design system, and a provider-neutral server data gateway.
Do not add new product pages to the legacy Jinja templates.

## Local development

From the repository root:

```bash
npm run setup
npm run dev
```

The launcher first ensures the versioned synthetic scenario in `var/state/demo/product.sqlite3`, then
starts one Next.js process for `members.ph.localhost:3100` and `officers.ph.localhost:3100`. These mirror
two local hostnames. Role data from the Rust API enforces access; hostname selection never grants
officer authority. Automatic synthetic sign-in lives under `development/`, outside this package.

Local mode is an editable demo with one primary synthetic student and four supporting lifecycle
personas. Deployed portals read the Rust API and never fall back to demo records. Inspect or restore the
local scenario with `npm run demo:status` and `npm run demo:reset`; reset creates a timestamped
backup under `var/state/demo/backups/` before restoring the canonical seed.

Copy `.env.example` to `.env.local` only when running the services separately. Keep API keys and
the developer token server-side.

## Frontend boundaries

The privacy, feedback, membership, local-device, and proposed officer-replica trust model is
documented in [`docs/HYBRID-TRUST-ARCHITECTURE.md`](../../docs/HYBRID-TRUST-ARCHITECTURE.md).

- Product routes live in `app/` and use `AppShell` plus shared UI components.
- `PYTORCH_PH_MEMBER_HOSTS` and `PYTORCH_PH_OFFICER_HOSTS` select the server-owned shell. Member APIs
  omit diagnostics and officer payloads; production officer access additionally requires
  `member_profiles.is_officer` or an admin role.
- Next.js route handlers proxy only allowlisted FastAPI endpoints to a fixed loopback base URL.
- `development/process-lab` can start the local product services and exercise normal sign-in externally through
  Playwright/CDP. Product routes contain no test session or sign-in bypass.
- FastAPI owns ingestion, persistent snapshots, job automation, and permission enforcement.
- The local product store (development only) normalizes
  the existing FastAPI/SQLite services; the deployed static portal uses the Rust API gateway.
- React never queries storage tables directly. `/api/product/*` returns stable visual view models.
- `PYTORCH_PH_DATA_PROVIDER=local` selects the labeled, synthetic, external-write-disabled demo.
  the Rust API serves production data and never falls back to fixtures.
- Command Center analytics keep fixed chart/card dimensions when a series is missing and render a
  centered `Data unavailable` watermark; unavailable data is never replaced with fixture values.
- The Rust API issues an HttpOnly `ph_session` cookie. Production ignores the local sign-in bypass.
- The canonical browser UI reads a sanitized development capability manifest. Missing provider
  sessions or artifacts stay visible but locked; analytics filters read existing snapshots only.
- Career evidence enters resume and analytics processing through `RetrievalMiddleman`; analytics
  reads its normalized `user_profile.json`, never a generated resume as source evidence.
- `/developer/*` visualizers remain separate development aids and are never embedded as product UI.
- `/reports` is an officer-only, paginated feedback-triage workspace. `/events` exposes public
  unapproved external-event intake, department review, exact email approval, and separate SADO proof.
- The localhost FastAPI companion owns visible-browser event extraction and the standalone
  `/developer/event-pipeline` JSON inspector. Access challenges stop for human action; no bypass is attempted.
- Job analytics labels live, cached, and synthetic data distinctly and always exposes provenance,
  geography, freshness, unknown coverage, and sample size.

## UI foundation

The frontend uses documented, composable libraries instead of maintaining custom interaction
infrastructure:

- shadcn-compatible components in `components/ui/`, backed by Radix primitives for dialogs,
  sheets, tabs, tooltips, progress, focus handling, portals, and keyboard behavior.
- TanStack Query for server-state caching and mutation invalidation; local display state remains in
  React components.
- React Hook Form plus Zod for form state and validation, TanStack Table for sortable data grids,
  Recharts through the shared chart wrapper, and Sonner for action feedback.
- PDF.js for the same-origin resume viewer. It opens in whole-page fit, supports fit-width and
  bounded zoom, and exposes separate open/download actions. The preview route returns the actual
  generated PDF rather than an HTML imitation.

Use `components.json` when adding shadcn components, preserve the existing design tokens, and put
product-specific composition outside `components/ui/`. Run `npm run test:ui:e2e` for the Radix
dialog keyboard and automated accessibility smoke test.
