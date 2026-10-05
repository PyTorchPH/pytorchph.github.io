# Email workspace

Status: reserved implementation home. Existing officer draft UI remains in `../collab-mail/` until
the migration is complete.

## Purpose

Replace the narrow “Email Drafts” surface with one role-aware Email workspace without recreating a
general webmail client.

## Officer views

- Inbox: shared aliases and assigned threads allowed by alias grants.
- Sent: released role/committee messages with delivery outcomes.
- Drafts: manual and AI-assisted revisions, event links, and required confirmations.
- Assignments: related proposals, handoffs, tickets, and unresolved deliverables.

The visible alias and actions come from server capabilities. The frontend MUST NOT infer permission
from a role label or expose hidden recipients in search results.

## Member views

The member Inbox contains released event communications only. It has:

- `Internal` and `External Partner` checkboxes;
- Talks, Workshops, Hackathons, Competitions, and Mini Contests tabs;
- Active and Archived filters;
- subscription controls for portal follows and push email.

There is no General tab. Members see all released events for which they satisfy hard eligibility.
Following another category or region cannot bypass invitation, guardian, age, or registration rules.

## Implementation map

| Concern | Target file/folder |
| --- | --- |
| Route shell and capability loading | `render-workspace.tsx` |
| Officer Inbox/Sent/Drafts tabs | `officer/` |
| Member event Inbox and archive | `member/` |
| Category/provenance/filter state | `filters/` |
| Shared composer and recipient search | `composer/` |
| Proposal/ticket context | `workflow/` |
| Typed network contract | `api.ts` |

Migrate reusable draft rendering from `../collab-mail/`; do not duplicate it. Remove the old route
only after equivalent create/edit/review/release tests pass.

## Recipient picker

This is a searchable hierarchy-aware list, not drag-and-drop. It shows only server-authorized targets:
direct parent, children, descendants in the sender's subtree, reachable siblings, and explicitly
granted aliases. Cross-subtree assignments arrive as accept/reject handoffs. Global officer/member
release is visible only to President/Acting President.

## AI interaction

“Draft with AI” asks the extension for status, shows the exact bounded context/provider/model preview,
and requires a browser-extension confirmation. The page never reads, stores, or configures the API
key. Returned text is merely a draft revision and always requires the normal human send gate.

## Accessibility and safety

Render sanitized mail HTML in a restrictive sandbox with a plain-text alternative. Do not load remote
images automatically. Show attachment scan state, message size, audience count, suppressions, final
content hash, and accountable internal actor before confirmation.
