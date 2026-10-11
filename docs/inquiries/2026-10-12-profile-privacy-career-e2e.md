# Profile/privacy continuation: disputed Career Evidence E2E

Status: proposed test adaptation explicitly approved by the user after this inquiry on 2026-10-12.

## Scope

Reconcile the inherited profile/privacy implementation with the supported Rust API/static Pages
architecture. Implementation/review and this inquiry were approved on 2026-10-12. That approval
does not authorize the disputed test rewrite. No deployment, live identity import, or production
database mutation is included. The subsequent explicit test-adaptation approval is recorded above.

## Failing expectation and evidence

- `frontend/portal/tests/career-evidence.e2e.mjs:22` waits for
  `Local member demo · Synthetic data · External actions disabled`.
- The previous run reported by the user timed out at that expectation. No fresh passing E2E
  result is claimed. Read-only probes on this continuation found port 3100 unavailable.
- An exact-string source search found the banner only in `career-evidence.e2e.mjs` and
  `local-demo-workflows.e2e.mjs`, not the searched frontend/development application source.
- The Career Evidence test also expects `/api/product/resume-preview` to return a server PDF.
  The current resume studio opens the browser PDF viewer. Changing only the banner assertion
  would leave an obsolete transport expectation.
- `docs/inquiries/2026-10-12-feu-local-completion.md` records that legacy Next-only tests target
  removed handlers; the supported browser harness is `development/pages-demo/verify.mjs`.
- The existing Pages mock rejects most writes. It cannot replace the Career Evidence test
  unchanged or substantiate evidence-write persistence without additional coverage.
- Correlated observability error group: `01a12cbf-e283-725f-8eaf-dd83e552a39b`;
  trace: `e04dd17ea447915afb7bee029f4cce15`.

## Proposed resolution requiring approval

1. Adapt the Career Evidence E2E to the supported static portal and isolated synthetic API
   harness. Assert authenticated test identity and explicit synthetic-data/external-action
   boundaries through current API/UI contracts rather than a removed banner.
2. Retain coverage of manual-entry save, reload persistence, image upload/preview, source
   connection, bounded synthetic sync behavior, and external-action restrictions. Extend the
   isolated fixture harness where necessary; retain real Rust API tests for backend persistence
   and authorization. Label fixture-based browser checks separately from real service integration.
3. Replace the removed server-preview transport assertion with actual browser-generated PDF
   validation: rendered canvas, page/width fit controls, invalid template behavior, export content
   and filenames, and mobile layout. Preserve the security meaning of the old assertions.
4. Add profile/privacy browser scenarios: owner name/phone, no persistent browser storage of
   private fields, session cache isolation, consent persistence, immediate saved-photo refresh,
   resume without achievements, and live-mode denial when the identity package is unavailable.
5. Do not skip or delete scenarios, reduce assertions to existence-only checks, or substitute
   the generic Pages smoke test for the Career Evidence workflow. Inspect any further mismatch
   before changing an expectation.

## Implementation review and required verification

- The maintained Career E2E runner moves to `development/pages-demo/verify/career-evidence.e2e.mjs`;
  `npm run test:career:e2e --workspace @pytorch-ph/portal` retains its entry command. This preserves
  the existing production-package prohibition on importing development tooling; that test is unchanged.
- Professional position is conditional on evidence type `experience`; the E2E selects that type
  and fills the current `Professional position` field instead of the obsolete unconditional `Role` field.
- Auth-backed achievement reads recheck current sharing consent before exposing another member's
  profile, preventing stale website projections from overriding an auth-service revocation.

- The source connection contract now sets `lastSyncedAt` on connection as well as sync
  (`backend/api/src/portal/product/sources.rs`, `apply_source_action`). Assert a valid timestamp
  and unchanged configured URL instead of the obsolete null-on-connect expectation. Assert
  no collection/delivery requests leave the isolated harness; a descriptive string is not proof.

- The current resume studio and PDF viewer restrict the old resume-snapshot fallback to
  `local_demo`; review cached/refetch-error and account-switch paths as well.
- Identity settings persist six booleans. Private sharing defaults off; new identities have
  analytics opt-out false. Existing identities migrate with analytics opt-out true.
- Analytics inclusion by default requires legal/DPO review before deployment. No legal
  compliance determination is made here.
- Run Rust formatting, GNU 1.98.0 all-target check/Clippy/tests for both services, website
  TypeScript/ESLint/full npm tests, supported builds and complete applicable E2E, then
  `git diff --check`. Keep output bounded through the shared supervisor.
- Do not commit or claim completion while a required check fails. Commit only attributed
  website changes; exclude `frontend/portal/next-env.d.ts` and `frontend/portal/var/`.
- Preserve inherited work; recover new edits independently. Use isolated test databases and
  retain local-only identity service status. No push or deployment is authorized.

## Additional implementation findings

- The resume iframe omitted the Pages `/portal` base path. Use `NEXT_PUBLIC_BASE_PATH`
  for its URL; retain the real browser PDF, fit controls, export and mobile assertions.
- Recheck auth-owned achievement consent before exposing another member's detail; deny
  access when the current consent is revoked or cannot be retrieved.
- Close the identity database pool on incomplete-schema rejection so Windows can release
  the failed-startup database. Require both private-profile migration tables at startup.
- The privacy E2E dismisses the settings tour through its normal `Skip tour` action and
  uses the current `Settings & Privacy` navigation label. It does not force-click controls.
