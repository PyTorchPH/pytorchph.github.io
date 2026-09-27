---
logic_id: community.website-preview
code_paths:
  - apps/portal/app/dashboard/community
  - apps/portal/app/community-preview
  - domains/client/navigation/render-shell.tsx
tests:
  - apps/portal/tests/community-demo.test.ts
feedback_events: []
related_logic:
  - leaderboards.verification-views
---
# Community Website Preview

The member and officer portals link to `/dashboard/community`, and `/community-preview` shows the
same synthetic content publicly without requiring website login. It previews the proposed PyTorch PH
Discord experience with five named sample profiles, seven default channels, optional learning and
voice spaces, and the existing leaderboard rank function for display.

Changing a sample profile changes its predefined preview roles, channels, and event paths. Interest
choices only highlight relevant channels already available to that sample profile; they never
unlock a channel. Staff channels are absent. The page labels sample data and does not read a real
member, persist choices, call Discord, assign roles, or enforce access.

Verification checks the seven default channels, absence of staff channels, interest-only
recommendations, and the credential-based mentor sample. A later integration must replace the
sample data with reviewed server-side access decisions; this page is not an authorization source.
