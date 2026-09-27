# Logic and Test Catalog

This directory routes agents to the smallest complete behavioral specification for a change. Read
the document whose `code_paths` match the implementation; follow its `related_logic` links only
when the change crosses that boundary.

| Logic ID | Decision boundary | Document |
|---|---|---|
| `identity.nationwide-membership` | Nationwide email eligibility with existing authorization gates | [`identity/nationwide-membership.md`](identity/nationwide-membership.md) |
| `client-automation.evidence-extension` | MV3 presence, access gate, inventory, replay, preview | [`client-automation/evidence-extension.md`](client-automation/evidence-extension.md) |
| `community.discord-access-and-safety` | Discord roles, tier gates, compact onboarding, safety, sync failure policy | [`community/discord-access-and-safety.md`](community/discord-access-and-safety.md) |
| `career-evidence.ingestion` | Untrusted evidence envelope, dedupe, rubric, point authority | [`career-evidence/ingestion.md`](career-evidence/ingestion.md) |
| `career-evidence.resume-injection` | Evidence-kind classification and resume section injection | [`career-evidence/resume-injection.md`](career-evidence/resume-injection.md) |
| `career-evidence.integrity-review` | Officer flash cards, sanctions, appeals, audit | [`career-evidence/integrity-review-and-appeals.md`](career-evidence/integrity-review-and-appeals.md) |
| `privacy-feedback.operational-events` | Automatic minimal telemetry and opt-in details | [`privacy-feedback/operational-events.md`](privacy-feedback/operational-events.md) |
| `leaderboards.verification-views` | Verified/provisional projections and points-only ordering | [`leaderboards/verification-views.md`](leaderboards/verification-views.md) |
| `development.local-auto-access` | Local-only synthetic sign-in and native visible-browser viewport | [`development/local-auto-access.md`](development/local-auto-access.md) |
| `development.local-production-preview` | Optimized local portal startup from an existing Next.js build | [`development/local-production-preview.md`](development/local-production-preview.md) |
| `development.central-observability` | Local project identity and privacy-safe agent/runtime correlation | [`development/central-observability.md`](development/central-observability.md) |
| `identity.manual-first-workspaces` | Manual workspace access versus separately gated automation | [`identity/manual-first-workspaces.md`](identity/manual-first-workspaces.md) |

Every registered document begins with YAML front matter containing `logic_id`, `code_paths`,
`tests`, `feedback_events`, and `related_logic`. Paths are repository-relative and must exist.
