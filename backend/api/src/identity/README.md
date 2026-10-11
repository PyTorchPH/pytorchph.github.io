# Identity module

Status: existing account/session code; target auth/mail split is planned, not deployed.

## Purpose

This module is the website-side identity gateway. It MUST expose browser-safe signup, login,
recovery, and account lifecycle routes while delegating credential and direct-PII authority to the
private identity service on the mail/auth VPS.

## Current implementation

- `accounts.rs`, `google.rs`, `membership.rs`, and `session.rs` own local identity flows.
- `account_deletion.rs` owns current deletion behavior.
- Existing SQLite member and credential records remain authoritative until the migration cutover.

## Target ownership

The website database keeps only an opaque member ID, public handle, portal preferences, coded
profile fields, and application state. The private identity service owns:

- personal email, legal name, Google subject, password hash, and recovery factors;
- verification links, guardian contacts/consents, mailbox identity, and reserved handles;
- account disable, recovery, permanent purge, and scoped PII resolution.

An email address MUST NOT be hashed and used as a user ID. Use an independently generated opaque
identifier. Browser code MUST NOT receive the webserver-to-auth mTLS credential.

## Implementation map

| Responsibility | Implementation home |
| --- | --- |
| Browser route orchestration and secure session cookie | `session.rs` |
| Manual email-link signup and Google linking gateway | new `signup.rs` |
| Password setup/reset gateway | new `credentials.rs` |
| Guardian review state exposed to the portal | new `guardian.rs` |
| Private identity-service client | new `identity_client.rs` |
| Account deletion/recovery orchestration | `account_deletion.rs` |

Split files by concept; do not add all target behavior to `mod.rs` or `accounts.rs`.

## Required flows

### Manual signup

1. Validate CAPTCHA and a user-selected lowercase handle.
2. Ask the identity service to issue a single-use verification link with a 15-minute TTL.
3. Complete verification without revealing whether an unrelated email already exists.
4. Require a local PyTorch password before activating an adult account.
5. Provision `handle@pytorch.ph` only after the account becomes active.

### Google signup

Trust a validated Google `email_verified` claim instead of sending another link. Require a local
PyTorch password for website and IMAP/SMTP access. Existing-account linking requires a signed-in,
recently reauthenticated account; never silently merge by matching email text.

### Minors

Members below 18 remain `pending_guardian_review`. A Membership/Safeguarding officer records meeting
metadata, then the guardian completes a single-use consent link. Store no meeting recording or ID
document by default. Google login does not bypass this gate.

### Deletion

Disable access and SMTP receipt immediately, allow 30-day recovery, then purge the mailbox,
credentials, and direct-PII mapping. Retain only two-year pseudonymous audit facts. Deleted handles
remain permanently reserved and MUST NOT be reassigned.

## Security invariants

- Passwords use a memory-hard salted hash and are never logged or duplicated as plaintext.
- Web sessions are `HttpOnly`, `Secure`, and bounded; account/permission revocation invalidates them.
- Private calls use WireGuard, mTLS, request IDs, timestamps, and idempotency keys for writes.
- `identity_client.rs` is a staged, unused mTLS read client; it accepts only private-IP HTTPS URLs.
  Do not wire it to a browser route until session-derived viewer identity and a verified WireGuard
  deployment are in place. PEM credentials stay outside the repository and browser bundle.
- Identity-service failure is fail-closed for login, role changes, PII access, and mailbox actions.
- Logs contain opaque IDs and bounded outcomes, not email addresses, tokens, or guardian details.

## Tests

Cover manual and Google signup, expired/replayed links, account collision/linking, guardian approval,
password reset, deletion/recovery, permanent handle reservation, private-service failure, and PII
redaction. Integration tests must prove that one password works for the website and IMAP/SMTP.
