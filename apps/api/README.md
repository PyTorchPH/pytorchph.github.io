# PyTorch PH API (code-first draft)

Rust/Axum service for server-authoritative member access, internal competitive-event results, points ledger, leaderboard cache, durable jobs, and revision-bound mail approvals. The existing external-event pipeline remains separate. No VPS deployment or live mail is authorized by this code.

## Boundaries

- Browser/extension may collect evidence and prepare drafts; it cannot write points, results, roles, approvals, or sent status directly.
- Google ID tokens are verified against Google's JWK set, issuer, audience, expiry, and `email_verified`. Session is an opaque HttpOnly/Secure cookie. Mutation requests require the configured portal `Origin`.
- Bootstrap admin is the configured, Google-verified email; everyone else begins `pending`. Admin approves members/officers. Admin manages officer roles and per-category mail routes.
- Officer creates an event with optional placement points. For a competitive event, registered approved members form individual/team entrants. An authorized officer publishes ordered, unique placements after the event starts. Corrections append reversal and replacement ledger entries.
- Personal-project and external-activity claims remain `pending` until an officer other than the claimant verifies them. Client-provided content hashes are deduplication hints, not proof. Grade and referral point sources are intentionally inactive.
- Public leaderboard reads a bounded SQLite snapshot, not browser-supplied scores. SQLite jobs refresh it asynchronously.
- Attendance import reads Google Forms through a server-side OAuth refresh token. It checks the Form setting is `VERIFIED`, matches only Google's signed-in `respondentEmail` to an approved member, and awards at most once per member per event. Earlier submissions and unmatched emails receive no points. Form ID and points are immutable after the first successful import.
- Mail draft content and routing roles are frozen per immutable revision. Edits require `If-Match`, invalidate previous approvals, and cannot change released drafts. Only the configured sender role can release after all required role approvals. The n8n claim endpoint is disabled unless `ENABLE_LIVE_EMAIL=true` and `N8N_SHARED_KEY` are supplied. PDF-bearing drafts additionally fail closed until a PDF renderer is configured.

## Main API contracts

| Endpoint | Role | Result |
|---|---|---|
| `POST /auth/google`, `GET /auth/me` | Google user | Establish/read session |
| `GET /members`, `POST /members/{id}/approve` | Officer/admin | Eligible members and onboarding |
| `POST /events`, `GET /events` | Officer | Create/list internal events |
| `POST /events/{id}/entrants`, `GET /events/{id}/entrants` | Officer | Register/list eligible entrants |
| `POST /events/{id}/results`, `GET /events/{id}/results` | Officer | Publish/read versioned results |
| `POST /evidence`, `GET /evidence/me` | Approved member | Submit/read pending evidence |
| `GET /evidence/pending`, `POST /evidence/{id}/review` | Officer | Verify or reject claim |
| `GET /leaderboard`, `GET /jobs/{id}` | Public/authorized user | Cached ranking and job status |
| `GET /public/events` | Public | Internal event listing |
| `GET /events/{id}/attendance`, `POST /events/{id}/attendance/import` | Officer | Attendance summary and manual Google Forms import |
| `POST /mail/routes/{category}`, `POST /members/{id}/officer-roles` | Admin | Routing and role assignment |
| `POST /mail/drafts`, `PATCH /mail/drafts/{id}`, `GET /mail/drafts/{id}` | Involved officer | Draft/revision/preview data |
| `POST /mail/drafts/{id}/approve`, `POST /mail/drafts/{id}/release` | Required role/sender role | Human gate and outbox release |
| `/internal/mail/*` | n8n key; live flag | Claim approved dispatch and record receipt |

The n8n workflow JSON is a **disabled template**. It has no credentials and must not be activated until version compatibility, Gmail configuration, resource load, duplicate-send recovery, and live-send approval are verified. Claimed mail is never automatically retried after an ambiguous Gmail outcome.

Attendance import requires `GOOGLE_FORMS_CLIENT_ID`, `GOOGLE_FORMS_CLIENT_SECRET`, and `GOOGLE_FORMS_REFRESH_TOKEN` on the API server. The token needs `forms.body.readonly` and `forms.responses.readonly` scopes and access to the target Form. Keep these values out of the portal build and logs. Import is officer initiated; it has a 10,000-response pagination ceiling and fails without partial writes when Google access or verification fails. The portal's `NEXT_PUBLIC_API_ORIGIN` enables direct read-only official events and leaderboard views plus officer workflows; its origin must match `ALLOWED_ORIGIN`. These views remain separate from the existing synthetic/Supabase product ladder.

## Verification status

At the user's request, compilation and runtime deployment are deferred. Rust formatting, TSX syntax parsing, JSON parsing, and execution of the SQLite migration in an in-memory database do **not** establish that the Rust crate compiles, Google Forms OAuth works, or n8n imports/executes the template. The UI shows saved PDF text for review; server-side PDF rendering remains fail-closed.
