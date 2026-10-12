# Automatic public community content

Approved local scope: role-derived leadership/photos, assigned Campus Labs chapters, canonical public events, event-linked news/recaps, editor tabs and tests. No live database writes or deployment.

- Public profiles derive only from current `member_positions` joined to existing active officer/admin accounts. President seats render as Ambassadors; unassigned/manual profiles never render.
- Identity service owns names, organization photos and effective public-role visibility. Missing explicit preferences default visible for assigned public roles; audited owner saves/consents override defaults. Explicit false remains false. Hidden names omit profiles; hidden/unavailable photos return null. No email or provider photo is exposed.
- Public photo URLs use opaque references; each byte request rechecks current assignment and identity consent. Profile/photo responses use no-store. Public-role Settings show effective defaults separately from general privacy controls.
- Historical direct identity DB edits without audit cannot be distinguished from seeded defaults: review before activation. No stored preferences are overwritten.
- Campus Labs uses normalized `campus_chapters` + `campus_chapter_leads` FK assignments; only current Campus Labs leads/Campus Lab Ambassadors qualify. University/island are explicit public chapter facts, never private education inference. Current President/Campus Labs Lead assignments manage chapters; generic admin/officer status grants no bypass. Paused/unassigned/hidden-name chapters are omitted.
- Event permissions have a separate position-linked matrix; mailbox capabilities stay mail-specific. Presidents/Head of Learning Programs create/edit/publish; Learning Programs Officers create private events/edit their own private drafts; Communications Officers/CMO edit public content without changing publication flags. Revoked assignments lose access immediately; generic officer/admin status grants no event-write permission.
- Canonical events are already relational: events, scoring, skill tags, entrants, member links and results. Migration 0032 adds one-to-one `event_publication`; public/demo flags are independent of result publication. New events default private. Officer chooses public visibility explicitly; Demo/Test events reject registration URLs.
- Event descriptions live in canonical publication metadata, required before public publication (private drafts may be incomplete), limited to 2,000 characters. Create/Edit Event owns description and public content; no separate CMS event description. Existing saved events support publication/description editing in the event workspace.
- Public bundle and `/public/events` read canonical saved public events, sorted by start date. CMS/featured curriculum seed rows remain historical data and stop serving public upcoming-event lists. Existing Create Event remains the write path; publication can change via `PUT /events/{id}/publication`.
- Website editor: Events & Programs is a canonical read view; News & Recaps edits retain revision/quorum workflow. Optional `eventId` must reference a public event when saved. Switching tabs preserves unsaved edits.
- Public pages query backend projections on load and every 60 seconds while visible. No duplicated event copy, callback, new standby process or extra port. No placeholders are restored when backend/identity is unavailable.
- Migration 0033 adds only chapter tables. New migrations require LF bytes; preserve all previously applied migration checksums. Review/backup DB, identity/API binaries and configs before later deployment. Rollback requires matching pre-upgrade snapshots.

Reuse: existing SQLx/SQLite relations, portal RBAC, pinned mTLS identity transport, owner consent audit, existing public-site refresh and DOM text rendering. No added dependencies. References: [SQLite foreign-key support](https://www.sqlite.org/foreignkeys.html), [OWASP property-level authorization](https://api-security.owasp.org/editions/2023/en/0xa3-broken-object-property-level-authorization/).

Synthetic event fixtures/tests stay local; no real server data or model calls are used.

## Verification

- Website API: all-target Rust Clippy `-D warnings`; full suite 119 tests passed, none skipped.
- Commit scope verified independently from pending AI-privacy work: staged backend Clippy and all 113 staged tests passed.
- Identity service: all-target Rust Clippy and full library/binary/doc test pass.
- Frontend: typecheck, lint, root test suite, managed-site content/editor tests and production Pages build passed.
- Browser: canonical events/descriptions and Demo/Test label, no manual directory fallback, tabs preserve unsaved recap, save/quorum/stale-revision outcomes and mobile layout passed. Existing AI privacy browser flow also passed.
- Screenshots: `var/test-artifacts/site-content-editor-desktop.png`, `site-content-editor-mobile.png`.
- No live migration, dummy records, role assignments, preference changes or deployment.
