# Organization authority

Status: an organization tree and assignments already exist; the contract below defines the required
authority, proposal, and migration behavior.

## Mental model

The organization is a rooted authority tree. Upper positions are rigid. A Department Head is the
lowest mandatory manager and owns a flexible operational subtree. Work and approvals always retain
the position and hierarchy version that authorized them.

## Persistence boundary

- Versioned JSON: role definitions, rigid hierarchy, permission bundles, flexible position
  definitions, and role-specific eligibility rules.
- Auth database: active position assignments, assignment history, and scoped alias grants.
- Web database: proposals, tickets, handoffs, deliverables, revisions, contribution facts, and signed
  authorization references.

The `president` position has exactly two available equal-authority seats, displayed as
President / PyTorch Ambassador. Other single-seat positions have at most one active holder. One user may hold several positions. `is_filled` is
derived from an active assignment and MUST NOT be stored as an independent boolean.

## Existing files and target changes

| File | Responsibility |
| --- | --- |
| `tree.rs` | Read and validate the hierarchy; add versioned JSON provider abstraction. |
| `assignments.rs` | Position appointment, revocation, history, and one-active-holder invariant. |
| `role_sync.rs` | Transitional compatibility only; stop treating `members.role` as authority. |
| `reservations.rs` | Keep bounded invitation/reservation behavior separate from appointments. |
| `chart.rs` | Organization view; expose only fields allowed for the viewer. |
| new `authorization.rs` | Resolve actor, position, resource scope, hierarchy path, and decision ID. |
| new `proposals.rs` | Department proposal state machine and upward approval chain. |
| new `tickets.rs` | Direct-child delegation, deliverables, and non-delegable enforcement. |
| new `handoffs.rs` | Sibling-branch message/assignment routing and accept/reject decisions. |
| new `eligibility.rs` | Category-biased role eligibility from verified contribution facts. |

## Authorization rules

- Officer status is derived from at least one active position assignment.
- Losing the last assignment removes officer access immediately.
- Every action derives its acting position from its proposal, ticket, mailbox grant, or event scope.
- If no single authority path can be proven, deny the action; do not union unrelated positions.
- Department Heads create/reparent definitions inside their flexible subtree through the validated
  authority writer. Other holders delegate work only through existing child nodes.
- Shared alias grants are explicit and may contain `read`, `draft`, `approve`, `send_as`, and
  `manage`, plus resource scope and expiry.

## Proposals and work

Every new department initiative is a `proposal`. It moves one direct parent at a time until the
President or Acting President approves or rejects it. Events, sponsorships, partnerships, and major
technology initiatives use the same envelope with department-specific payloads.

An approved initiative produces tickets. Each ticket has one accountable assignee, one assigned
position, expected deliverable, due date, scope, and a `delegable` flag. A delegable ticket may be
decomposed only into direct-child tickets. Review does not confer authorship; revision diffs identify
the actual editor.

For cross-subtree work, ascend until a sibling branch containing the target is reachable. Create a
handoff to that sibling. The target holder accepts, rejects, or requests clarification, then delegates
inside the target subtree. The source cannot assign directly to a deep descendant of another branch.

## Contribution eligibility

Use a vector of categorized contribution facts, not a universal score. Examples include
`event_organizing.hackathon`, `outreach.partner_verified`, and `engineering.infrastructure`.
Role definitions declare relevant weights, minimum evidence, thresholds, and optional recency.
Attendance may contribute strongly within its category but cannot satisfy unrelated specialized
roles. Appointment requires the configured gate plus direct-parent judgment and a recorded reason.

Signed-in members may see public-handle rankings. Private evidence, exact profile data, and minor
rankings remain hidden; minors require guardian/member opt-in before appearing.

## Audit contract

Record actor ID, position snapshot, hierarchy/policy version, resource, action, decision, timestamp,
and correlation ID. The private audit service signs canonical decision metadata. Revocation tests
must demonstrate that cached capabilities and alias grants stop working within the configured bound.

## Dual presidency and approval quorum

- `PRESIDENT_REQUIRED_APPROVALS` defaults to `2`; only exact values `1` and `2` are accepted. Invalid configuration prevents startup before database initialization.
- Startup stores the validated policy in the API database; all processes sharing that database MUST use the same setting. Changes take effect on restart.
- Existing `president` authority applies equally to both holders. A sitting president may appoint another member to the second seat; self-appointment and a third holder are refused. The existing developer-controlled migration bootstrap remains available for the first seat.
- SQLite insert/update triggers enforce the two-seat cap for invitations, reservations and direct writes. Existing assignments and approvals are preserved by migration `0026_dual_presidency.sql`.
- Collaborative mail requires the configured number of distinct current presidents for the exact assembled content. Duplicate approvals are idempotent; content changes invalidate prior approvals. Send recomputes authority/quorum, including after holder removal or policy changes.
- Routed mail `executive` approval requires the configured number of current presidential holders. Vice-presidential executive role membership alone does not supply a presidential vote. Other routed roles retain their one-current-holder approval requirement.
- `foundation_ambassador` remains a separate existing position; it is not silently elevated to president. No new named individuals or unrelated roles are assigned.
- Migration review: back up the database before any future deployment. No live migration is performed by this change. Roll back code together with the pre-migration database backup; do not discard a second holder or newer approval rows via an ad-hoc reverse migration. Under default quorum 2, drafts remain blocked until both seats are filled.
- Reuse: existing SQLx/SQLite transactions and role checks; no new dependency. References: https://www.sqlite.org/lang_createtable.html and https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html.
