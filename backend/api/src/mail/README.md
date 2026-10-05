# Mail workflow

Status: collaborative drafts, revisions, approvals, assembly, release, and dispatch exist. The target
extends them into shared Inbox/Sent/Drafts, campaigns, member event Inbox, and signed delivery audit.

## Ownership

The web API owns workflow state and opaque references. The private mail service owns SMTP/IMAP
integration, mailbox content access, delivery, bounce processing, recipient address resolution, and
encrypted portal blobs. Browser code never receives the private service credential.

## Existing files and target changes

| File | Responsibility |
| --- | --- |
| `drafts.rs` and `revisions.rs` | Draft lifecycle and immutable revisions; retain actual editor diffs. |
| `approvals.rs` | Human confirmation and event/global presidential release gates. |
| `assembled.rs` | Deterministic assembly and content digest. |
| `routes.rs` and `roles.rs` | Replace coarse roles with scoped alias authorization decisions. |
| `dispatch.rs` | Idempotent private mail-service campaign dispatch and receipt reconciliation. |
| `attachment.rs` and `content.rs` | Attachment metadata, content safety, and body normalization. |
| `release.rs` | Freeze audience and content revision before release. |
| new `inbox.rs` | Shared inbound threads, assignments, archive state, and sanitized content. |
| new `campaigns.rs` | Single-body mass-mail record, template tokens, and release state. |
| new `audiences.rs` | Eligibility resolution, subscription suppression, and exact snapshot. |
| new `deliveries.rs` | Opaque recipient ledger, retries, bounces, and rendered-message hashes. |
| new `subscriptions.rs` | Append-only internal/external portal and push preferences. |
| new `audit.rs` | Signed audit-envelope verification and chain references. |

## Shared inbox

Configured aliases such as `events@`, `membership@`, `inquiry@`, and `partnerships@` appear only to
positions with `read` access. `draft`, `approve`, `send_as`, and `manage` are separate grants. New
inbound messages are ingested idempotently from the private mail service and retain their original
mailbox/UID and RFC message identity.

Production aliases MUST NOT autorespond. External recipients see only the shared alias. Internally,
store the authenticated actor, acting position, contributors, authorization decision, linked event or
ticket, revision digest, and send result.

## Campaign representation

Store one immutable template/body revision. Do not store one body per recipient. Resolve approved
tokens such as `{{name}}` and `{{email}}` inside the identity/mail boundary. Freeze:

- approved event version and message kind;
- audience definition and exact opaque-member snapshot;
- subscription/suppression result;
- per-recipient delivery state and rendered SHA-256 digest.

The opaque member ID permits retries and bounce investigation without putting plaintext addresses in
the web database. Arbitrary external CSV imports are prohibited.

## Release authority

- Authorized senders confirm ordinary one-to-one and department mail.
- President/Acting President alone releases all-officer or all-member campaigns.
- Event messages reuse the approved event category and provenance.
- Internal event push defaults on with opt-out; external-partner promotions require explicit opt-in.
- SMTP release never overrides a suppression, hard eligibility rule, or account disable.

## Member Inbox

Member-facing records are curated released event communications, not a full IMAP mirror. Queries use
normalized event category, provenance, active/archive state, and eligibility. A portal read/archive
state does not mutate the member's Gmail/Outlook/IMAP copy.

## AI drafting

The browser extension owns the user's provider key and performs generation. The API supplies only a
bounded context request and accepts the returned draft revision. Mark AI revisions with provider,
model, prompt-policy version, and confirmation event. Never accept an AI response as authority to
send, invent facts, or change the approved audience.

## Integrity and retention

Canonical audit metadata is hashed and signed by the private audit service using Ed25519, then linked
to the preceding audit entry. DKIM remains the external signature on the delivered message.

Portal bodies and attachments retain for two years. Maximum message size is 25 MiB and each attachment
is limited to 10 MiB. The mail/auth VPS portal store has a 10 GiB cap with 70/85/95 percent alerts.
Offsite backup is deferred and the system MUST NOT claim disaster-resilient retention until a restore
test passes.

## Tests

Cover alias ACLs, MIME ingestion, duplicate/missing notifications, thread reconstruction, sanitization,
malware/size rejection, single-copy campaigns, personalization, audience freezing, unsubscribe,
bounces, retry idempotency, presidential release, signed audit verification, and two-year deletion.
