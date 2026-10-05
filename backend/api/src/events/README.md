# Event lifecycle

Status: event creation, entrants, results, deletion, and reads exist. Proposal gates, provenance,
communications, and amendments are target additions.

## Domain boundary

A draft initiative is an `event_proposal`, not yet a canonical event. The lifecycle is:

```text
event_proposal
  -> presidentially_approved
  -> planning
  -> ready_for_release
  -> published
  -> ended
  -> archived | cancelled
```

Members of the Events subtree may originate a proposal only through an assigned proposal task. The
proposal travels direct-parent-by-direct-parent to the President or Acting President. Approval creates
the event identity and downward planning tickets; publication occurs only after required deliverables
and the final announcement are approved.

## Normalized classification

Reference tables and API enums MUST define:

- category: `talk`, `workshop`, `hackathon`, `competitive`, `mini_contest`;
- provenance: `internal`, `external_partner`;
- message kind: `announcement`, `update`, `reminder`, `results`, `cancellation`.

Keep `competitive` as the stored/API identifier for compatibility and render “Competition” in the
UI. A PyTorch co-hosted event is internal. `external_partner` means an approved partner-led event;
arbitrary third-party listings are prohibited.

## Implementation map

| File | Responsibility |
| --- | --- |
| `create.rs` | Create proposals instead of directly publishing canonical events. |
| `records.rs` | Read canonical events and their current approved version. |
| `reads.rs` | Member-safe event views and structured eligibility explanation. |
| `delete.rs` | Replace unsafe removal with lifecycle cancellation/archive rules. |
| `entrants.rs` and `results.rs` | Preserve competition behavior under approved event versions. |
| new `proposals.rs` | Proposal revisions and upward approval state. |
| new `versions.rs` | Approved event versions and amendment promotion. |
| new `eligibility.rs` | Membership, registration, age, education, and region predicates. |
| new `communications.rs` | Link released message revisions to event versions. |

## Immutability and amendments

Proposal metadata is editable with revision diffs. After presidential approval, category, provenance,
eligibility, and core identity cannot be silently edited. Corrections create an amendment and pass
through the applicable approval chain. Previously sent messages keep their signed send-time metadata;
future messages use the new approved version.

## Member delivery

An approved event alone does not create a member Inbox message. A member item appears when the final
campaign revision is released. Portal visibility and push-email subscription are separate. Hard
eligibility restrictions cannot be bypassed by following a category or region.

When an event ends, its portal communications move automatically to Archived. This does not move or
delete messages from a member's personal IMAP mailbox.

## Tests

Test proposal promotion, parent-chain authorization, required deliverables, publication authority,
internal/external-partner classification, amendment history, structured eligibility, competition
compatibility, campaign linkage, cancellation, and automatic archival.
