# Collaborative mail migration

Status: implemented officer event-draft feature. Reuse this code while migrating to the broader
Email workspace documented in `../email/README.md`.

## Current files

- `api.ts`: typed calls to `/api/officer/mail-collab`.
- `compose.ts`: builds manual/extension-AI draft requests and section ownership suggestions.
- `render-composer.tsx`: creates a collaborative draft.
- `render-draft.tsx`: edits, confirms, approves, and releases a draft.

## Migration rules

- Preserve the current create/edit/confirm/approve/release behavior until replacement tests pass.
- Move reusable revision and rendering components into the new Email feature; do not fork copies.
- Replace free recipient arrays with server-resolved audience snapshots and hierarchy-aware targets.
- Replace inferred/coarse officer roles with authorization decisions and scoped alias grants.
- Treat section ownership as work assignment only. Authorship comes from actual revision diffs.
- AI output remains a draft; extension confirmation and normal human release gates are required.
- Event/global releases require the approved event version and President/Acting President authority.

## Removal gate

Delete this feature and `/api/officer/mail-collab` only after the new Email workspace passes parity
tests for manual drafts, extension AI drafts, optimistic revision conflicts, contributor diffs,
confirmation, approval, dispatch reconciliation, and event linkage.
