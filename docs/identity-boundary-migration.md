# Identity boundary migration

## Current state

The website SQLite database is still the authority for `members.email`,
`members.display_name`, `members.google_sub`, `email_credentials.password_hash`,
and `pending_email_signups`. `position_reservations.email` and
`attendance_responses.normalized_email` are additional identity lookups.
`entrants.name` can contain a person's name, and `position_assignment_log`
stores `member_name` and `actor_name`. Session handlers and account search
still read identity fields from `members`. The private identity-name service
is deployed on `10.73.0.1:8443`, but its database has no imported members.
The website's mTLS client now handles organization-chart name reads and the
member's organization-name consent route. Both fail closed if the service is
unavailable; remaining identity reads and writes still require cutover.

## Target contract

- Keep stable random UUID member IDs in the website database for foreign keys,
  scoring, and permissions. They are opaque identifiers, not name hashes.
- The identity database owns email, Google subject, password hash, display name,
  account recovery, verification tokens, pending email reservations, and
  purpose-specific name/photo consent. It is the only writer for those fields.
- Browser writes go to the authenticated website API. The API derives the actor
  from its validated session and calls versioned identity-service write APIs
  over WireGuard and mTLS. The browser never receives service credentials.
- Name reads supply a session-derived viewer ID and a fixed purpose. The
  identity service checks current consent on every read. Public profile,
  organization chart, and leaderboard disclosure are distinct grants; absence
  or revocation returns a generic unavailable result. Self-read is allowed.
- No bulk name endpoint or positive cross-purpose cache exists. UI falls back
  to a public handle or initials only when that fallback is independently
  consented; otherwise it displays a neutral placeholder.
- Event entrant labels are classified as team labels or personal names at
  creation. Personal names live in the identity store. Organization history
  stores actor/member IDs and action metadata, resolving names only for an
  authorized viewer. Historical free-text names require explicit retention and
  redaction treatment.

## Cutover sequence

1. Implement and test identity-service account, lookup, consent, and
   idempotent write endpoints. Verify email/Google linking, Argon2 parameters,
   pending signups, revocation, and mailbox login compatibility with fixtures.
2. Add a website API adapter for authenticated reads and writes. Replace every
   direct PII query, including session display, organization search,
   reservations, event entrants, attendance matching, and account deletion.
   Reject identity-service failure for login, permission, and PII reads.
3. Create a restricted SQLite online backup of the live website DB and an
   identity DB backup. Check integrity, foreign keys, table counts, and a
   redacted ID-only mapping. Freeze identity writes during the final copy.
4. Import identities and credential hashes over the private channel without
   logging values. Import no implicit public consent. Reconcile counts and
   sampled opaque IDs, then exercise email/Google login, session revocation,
   consent, and mailbox authentication through the new service.
5. Switch the website API to the identity service. Monitor bounded failures
   and verify frontend flows. Only after read/write parity and rollback
   rehearsal, rebuild the website SQLite tables to remove direct PII and
   credential fields. Scan the resulting schema and data for remaining PII.
6. Re-enable writes. Keep a journal of identity operations through the
   stabilization window. A rollback after writes resume must replay that
   journal into the restored authority before traffic returns; restoring an
   old snapshot alone would lose accounts or consent changes.

## Verification and recovery

Use fixture-only comparisons and leaderboard tests; current production member
counts are not a test fixture. Test unknown/revoked consent, self access,
cross-purpose denial, duplicate write keys, stale timestamps, certificate
rotation, email collision, and Google linking without automatic email-based
account takeover. Run complete static checks, test suites, and whole-system
smoke checks before either service switch. Preserve previous binaries, units,
and database snapshots with restricted access until the stabilization window
ends. Abort the cutover on any count mismatch, failed integrity check, or
unexplained difference in authentication outcomes.
