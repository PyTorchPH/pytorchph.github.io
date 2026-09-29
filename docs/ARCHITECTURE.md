# Repository architecture

Top level splits by runtime: everything the server runs is in `backend/`, everything the browser
runs is in `frontend/`, and local-only tooling is in `development/`. Inside each, folders are feature-first.

```text
backend/api/                    Rust API: auth, sessions, SQLite migrations, evidence, leaderboards, profiles
backend/config/                 shared data read by the backend and legacy engine
backend/postman/                API collection and its route validator
backend/legacy-python/          retained Python reference engine, operator tools, and their tests
frontend/public-site/           public Jekyll website served at https://pytorch.ph
frontend/portal/                Next.js member/officer portal entry points
frontend/portal-static/         static export of the portal served under /portal/ on GitHub Pages
frontend/extension/             Chrome MV3 evidence extension (local AI keys stay here)
frontend/features/              browser-visible feature components and interactions
frontend/contracts/             shared request, response, event, and validation shapes
frontend/design-system/         reusable visual primitives
development/local-server/       local-only feature operations behind the dev launcher
development/academic-records/   thin FEU SOLAR login, scrape, and resume-injection commands
development/                    local access, Process Lab, launchers, and patched Prefect dashboard
tests/node/                     cross-package verification
docs/                           architecture and operating guidance
scripts/                        repo automation
var/                            ignored local cache, state, sessions, environments, logs, and run files
out/                            ignored human-reviewable reports, captures, and exports
```

## Naming

Folders provide context; filenames state the action or artifact without repeating their parents:

```text
frontend/features/events/registration/collect-input.tsx
development/local-server/events/registration/validate-request.ts
frontend/contracts/events/registration/request-shape.ts
```

Formal names are used only when the behavior fits: `status-transitions`, `dependency-graph`,
`questionnaire-tree`, `capability-set`, and `confirmation-ledger`.

## Dependency direction

```text
frontend/portal    -> features + contracts + design-system
features           -> contracts + design-system
local-server       -> contracts
contracts          -> no features/server implementation
production         -X-> development
```

The three domain branches are private npm workspace packages. Their exports expose feature names,
not implementation files. This is a build boundary, not three deployments.

## Web topology

One Next.js build serves two hostnames. The hostname selects the presentation; the authenticated
member role in the Rust API decides permission. A member cannot gain officer access by opening the officer
hostname. Unknown hosts default to member behavior.

Browser code talks only to the Rust API, authenticated by its HttpOnly session cookie. Application database
reads and writes use same-origin Vercel route handlers; privileged keys remain server-only and RLS
remains mandatory.

The existing Python package stays in place until all feature-by-feature TypeScript replacements pass
parity tests. Prefect Python is a development-only exception and never enters the Vercel artifact.
