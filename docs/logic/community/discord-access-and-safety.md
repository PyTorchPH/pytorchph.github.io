---
logic_id: community.discord-access-and-safety
code_paths:
  - domains/protocol/discord-community
  - domains/server/discord-community
tests:
  - apps/portal/tests/discord-community.test.ts
feedback_events:
  - discord.role_sync.planned
  - discord.role_sync.held
  - discord.role_sync.applied
  - discord.role_sync.failed
related_logic:
  - leaderboards.verification-views
  - identity.manual-first-workspaces
---
# Discord Community Access and Safety

The PyTorch PH Discord server uses Discord-native Community Onboarding, Server Guide, AutoMod,
Raid Protection, Scheduled Events, and forum channels plus one first-party application. No
third-party bot is required at launch. The default onboarding surface has seven channels, only two
of which are read-only; optional learning, voice, and staff spaces remain hidden until relevant.

## Authority boundaries

- The website is authoritative only for linked-member, product-tier, verified-point,
  verified-credential, sanction, and revocation facts.
- Discord remains authoritative for `Administrator`, `Moderator`, and `Event Host`. Automation MUST
  NOT grant, remove, or infer these roles.
- Member-selected interest and notification roles MUST NOT unlock tier-gated spaces.
- Pending points MUST NOT grant Discord access. Rank roles use the existing verified-point rank
  function and collapse divisions into Bronze, Silver, Gold, Platinum, Diamond, or Master.
- Access bands use the highest verified result: Builder requires 750 points or one credential;
  Advanced requires 2,250 points or three credentials; Mentor requires 3,000 points or five
  credentials. Beginner access requires only a current linked account.

## Synchronization states

`apply` computes an idempotent add/remove plan for the fixed website-managed role allowlist.
`revoke` removes that allowlist after an authoritative unlink, sanction, or revocation. `hold`
performs no mutation when analytics are missing or stale. Unknown, manual, system, and self-selected
roles remain untouched in every state.

The runtime bot has `Manage Roles` only and sits below every privileged manual role. A provisioner
may temporarily receive `Manage Guild`, `Manage Channels`, and `Manage Events`; these permissions
must be removed after bootstrap. Tokens, OAuth codes, webhook URLs, raw profile data, and message
contents must never enter logs.

Every sync emits one bounded event with operation, outcome, reason, and role counts. A failed
Discord API request emits `discord.role_sync.failed` and remains retryable; partial success must not
be reported as complete. Discord rate limits and retry timestamps are authoritative.

## Human verification

Before live provisioning, a human reviews the role hierarchy, channel overwrites, AutoMod false
positives, moderator 2FA, bot permissions, onboarding preview, event gates, and rollback export.
Live OAuth, persistence, API clients, and server mutations are outside this business-logic phase.
