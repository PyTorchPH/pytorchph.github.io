# Login mailbox resilience

Scope: verified Google sign-in and existing email/password sign-in. Organization-mailbox provisioning is enrichment, not an authentication or authorization requirement.

- Google signature, issuer, audience and verified-email checks remain required. Password verification, rate limits, origin checks, session security and reserved officer-seat claiming remain unchanged.
- Provisioning has a two-second deadline. Outage, malformed response or timeout returns normal authenticated login with `x-organization-mailbox-status: pending`; success returns `ready`, absent integration returns `not-configured`.
- Pending provisioning is retried at the next successful sign-in. No durable retry queue or automatic background retry is claimed.
- Structured `auth.organization_mailbox_pending` and `auth.organization_mailbox_ready` events include correlation ID and duration, never credentials, email, display name or response payload.
- Email registration still requires verification delivery; this change does not bypass signup verification or create passwords for Google accounts.
- Migration 26 accepts only its exact historical CRLF checksum: SQL content is identical to the CI LF migration. Unknown or unsuccessful migration checksums still fail validation.

Verification: backend tests cover member/officer sessions during outages, successful provisioning, bounded timeout, invalid password/token rejection, new verified Google member creation without privilege escalation, and migration checksum allowlist/unknown-checksum rejection. Full static checks, suites and browser E2E precede deployment. Deployment preserves server-side SQLite backup and old binary; rollback restores only expected checksum metadata, not live user data.
