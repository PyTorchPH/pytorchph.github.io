# Pages verifier: scoring access and new source coverage

Purpose: resolve a disputed E2E expectation before changing the verifier.

- Failing test: `development/pages-demo/verify.mjs:135`; `npm run test:pages` times out waiting for the member sidebar link `Skill comparisons`.
- Expected by the test: members see and open `/admin/scoring`; the heading is `Blind skill comparisons`. Event workflow also contains the mail review panel.
- Observed: `frontend/features/navigation/render-shell.tsx` places the link in officer navigation. The existing scoring page restricts comparison review to officers/admins; its new heading is `Blind round robin`. The event list heading is `Events`.
- Officer navigation is now the accessible group `Officer tools`, rather than a heading `Officer desk`; the verifier checks that group is absent for members and survives reload for officers.
- Evidence: the production Pages build passes; the verifier reaches member sign-in and fails at the member scoring link. Backend queue/vote routes enforce officer permissions.
- Proposed resolution: assert that members do not see officer scoring navigation; assert the `Blind round robin` heading for officers; verify mail review on `/admin/mail` after its move out of Event workflow. Preserve authentication, onboarding, route, mobile, and unexpected-request assertions.
- Fixture coverage required by the implemented changes: bounded `/scoring/progress` response; denied photo reads and consent reads; exact Remotive job-list interception with attributed synthetic listings. Permit only the exact Remotive API endpoint in the external-request assertion; continue rejecting other destinations.
- Approval: user explicitly approved the test updates on 2026-10-12; the verifier and bounded fixtures now follow the proposed resolution.
- Verification: rerun static checks, complete local tests, integrated browser flows, and the Pages verifier after approval.
- Recovery: revert only these verifier/fixture edits; preserve inherited production changes and local data.
