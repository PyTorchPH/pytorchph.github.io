# FEU local completion

Scope: finish the inherited portal/API changes locally on `main`; no production deployment or external data writes.

- Quarterly scoring snapshots retain per-season pair uniqueness, anonymous comparison labels, officer eligibility, and rotation after expired assignments.
- Verified members with equal points receive equal season-relative tiers across board/profile views; unreviewed comparison scores use a consistent neutral value.
- Identity-service photo/consent failures remain closed; identity response bodies have streaming size limits.
- Public jobs retain Remotive provenance, bounded results, response validation, and cancellable browser queries.
- Production Pages now uses the existing browser PDF viewer, including sample rendering and fit controls; sample links preserve the portal base path.
- Pages verifier changes follow the user-approved inquiry `docs/inquiries/2026-10-11-pages-verifier.md`. Connections assertions open the existing settings tab. The local Pages server serves `.mjs` workers as JavaScript.

## Verification

- Rust: `cargo fmt`, locked `cargo check`, all-target Clippy with `-D warnings`, and complete API tests. Use installed toolchain `1.98.0-x86_64-pc-windows-gnu`; the default MSVC environment lacks `link.exe`.
- Frontend: workspace typecheck/lint, complete `npm test`, portal leaderboard tests, and JavaScript syntax checks.
- Production: `npm run build:pages -- --production-api` and `npm run test:pages`. The browser verifier includes actual PDF canvas rendering, fit controls, member/officer permissions, session lifecycle, mobile layout, known API routes, asset availability, and JavaScript errors.
- Legacy Next-only local-demo E2E targets removed Next `/api` handlers and returns 404. It does not verify the current Rust API/static Pages architecture; the supported checks above cover those components separately. Pages E2E uses bounded synthetic API fixtures and does not prove live production integration.

## Delivery and recovery

- Save the inherited source changes and local fixes in a local commit. Leave generated `frontend/portal/next-env.d.ts` and existing `frontend/portal/var/` logs out of that commit.
- Migration `0025_quarterly_comparisons.sql` is verified against temporary test databases only; it has not been applied to production by this continuation.
- Recovery: revert the local completion commit through normal Git history; retain local logs and unrelated working-tree data. Production rollback is unnecessary because this continuation does not deploy.
