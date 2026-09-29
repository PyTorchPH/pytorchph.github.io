---
logic_id: development.local-production-preview
code_paths:
  - package.json
  - frontend/portal/package.json
tests:
  - tests/node/production-preview.test.mjs
feedback_events:
  - production_preview.started
  - production_preview.failed
related_logic:
  - development.local-auto-access
---
# Local Production Preview

The workspace exposes `npm start` as the local entry point for serving an already-created Next.js
production build. The root script delegates to the portal workspace, whose start script uses the
documented `next start` command.

## States and contract

The preview moves through `starting -> ready` or `failed`. It requires a successful `npm run build`
and serves the generated portal without changing source files. A missing or incomplete build, or an
occupied port, must fail visibly through the Next.js process output.

## Invariants

- `npm start` delegates to `@pytorch-ph/portal` rather than duplicating framework commands.
- The portal uses `next start`, which serves the optimized production output created by `next build`.
- Production preview does not run the development orchestrator, local auto-login launcher, or
  Rust API lifecycle; those remain separately managed local services.
- Startup failures remain visible and must not silently fall back to `next dev`.

## Acceptance tests

- The root manifest exposes a start script that delegates to the portal workspace.
- The portal manifest exposes `next start`.
