# Inquiry: obsolete manual event editor expectation

- Failing test: `tests/node/managed-site-editor.test.mjs`, `built officer editor saves drafts, shows pending approval and handles stale writes`, line 37.
- Observed: timeout locating the title editor under the `PyTorch Fundamentals` fieldset.
- Previous expectation: upcoming events are edited as website JSON drafts.
- Accepted requirement: canonical event storage/Create/Edit Event owns descriptions/publication; the website Events tab is read-only. News/Recaps retains versioned drafts and presidential quorum.
- Evidence: new `render-editor.tsx` renders canonical event cards; manual event fields are intentionally absent. No backend publication or stale-write assertion is invalidated.
- Proposed resolution: move existing save/approval/stale-revision exercises to an article/recap fixture; preserve every outcome/security assertion; add assertions that events use the canonical read and expose no duplicate event editor. Keep real browser execution and backend error responses; no skips or broad mocks.
- Approval: user explicitly approved the bounded test update on 2026-10-13. Scenario now edits a recap, preserves all save/quorum/stale/mobile assertions, checks canonical read-only events and verifies event records stay unchanged by article saves.
