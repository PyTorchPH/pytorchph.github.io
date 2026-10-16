# PyTorch PH — managed website content plan

## Purpose and approved scope

Integrate the existing officer portal, authenticated portal gateway, Rust API and Jekyll public site. Officers manage content; current presidents approve publication. Public pages read published data at runtime. Logo changes are deferred. No live configuration, database migration or deployment is included.

## Existing capabilities

| Existing component | Reuse |
|---|---|
| Officer portal / officer-only navigation | Add a Website Content tool; link from Event Workflow |
| `/portal/api/*`, sessions, origin checks | Authenticated draft reads/writes and presidential approval |
| SQLx / SQLite migrations and transactions | Immutable content revisions, audit fields, stale-edit protection |
| Organization positions | Two equal-authority president holders; default two distinct approvals |
| Jekyll homepage, About, News, event collections | Runtime published-content renderer; retain official upstream news integration |
| Existing leadership profiles / photos | Preserve existing public profile data with uniform card styling |
| Footer include / Sass | Fix zero-width links; configurable public contact links |

## Delivery stages

1. **RBAC and footer:** two presidential seats, quorum `PRESIDENT_REQUIRED_APPROVALS=2` (allowed 1/2), revision-bound current-holder approvals; footer disclaimer occupies a separate row.
2. **Content store:** one website document with branding, five About sections, leadership, events/programs, island chapters, news/recaps and public contacts. Only plain text and validated URLs are accepted; no raw HTML or file upload endpoint.
3. **Officer editor:** grouped editable fields inside the existing portal, collection add/remove, draft save, dirty/stale state and presidential approval. Published content remains unchanged while a new draft is under review.
4. **Publication:** reject non-officers and non-presidential approvals; count unique active presidents for the same immutable revision. A draft publishes atomically when configured quorum is met. Editing requires the current revision and creates a new revision.
5. **Public integration:** fetch `/public/site-content`; inject approved homepage messaging, chronological upcoming events, About narrative, ambassadors → core team → departments, Campus Labs by Luzon/Visayas/Mindanao, and newest-first recap articles. No sample event is presented as an upcoming real event.
6. **Configuration:** allowlisted public Facebook/LinkedIn/email values are supplied at build time from environment settings; blank values are omitted. Officer-published contacts may override these defaults. Never expose unrelated environment variables.
7. **Verification:** Rust formatting/Clippy and full API suite; frontend syntax/type/lint checks; local browser tests for edit → approval → public render, escaping, stale edits, quorum, mobile footer and empty states. Record environmental blockers independently from application failures.

## Content rules

- Tagline: “Let's CONNECT, LEARN, BUILD, GROW.”
- Description: “A nationwide, community-driven network connecting researchers, universities, students, industry and government professionals, startups, and developers across Luzon, Visayas, and Mindanao to learn, collaborate, innovate, and build with PyTorch.”
- About headings: Open Source Powers AI Innovation; The Opportunity for the Philippines; Why PyTorch Philippines?; What Success Looks Like?; Everyone Has a Role.
- Events/programs: title, topic, event type, venue/platform, optional date, date status and registration URL. Confirmed dates sort ascending; unknown dates are Coming Soon or Tentative. Sheets are unavailable; officers enter verified details later.
- Leadership: name, title, affiliation, group/department and photo. All cards share dimensions and typography. Campus Labs template/deck is unavailable; its exact visual match is not claimed.
- Chapters: university, chapter name, island group, status and optional representative image. Empty groups do not invent participating institutions.
- Recaps/news: title, publication/event dates, venue, speakers, topics, highlights, takeaways, acknowledgments and optional photo. No invented past-event article.
- Publication excludes draft content and internal approval data. No browser uses `innerHTML` for officer text.

## Recovery and deferred inputs

Back up the database before any future deployment. Roll back application code together with the pre-migration database backup; do not silently discard second-president assignments or new revisions. The approved logo, Canva narrative, chapter list, photos, verified event schedule and official contact values remain operator-supplied inputs. The UI provides their entry points without fabricating them.

## Implementation entry points

- Officer editor: `/portal/admin/website/`; Event Workflow links to the same tool.
- Authenticated routes: `GET/PUT /portal/api/officer/site-content`, `POST /portal/api/officer/site-content/approve`.
- Public route: `GET /public/site-content`; public pages refresh approved data every 60 seconds while visible and when returning to the tab.
- Canonical bootstrap: `backend/api/src/tests/fixtures/site-content.json (synthetic test data only)`; generated Jekyll/browser defaults are build artifacts, not hand-maintained homepage content. Existing public leadership records are preserved.
- Migrations: `0026_dual_presidency.sql` and `0027_managed_site_content.sql`; changes remain local and require backup review before deployment.
- Contacts: `.env.example` documents the three public settings. GitHub Actions reads matching repository variables; this implementation does not modify GitHub settings.
- Photo support uses approved existing asset paths or HTTPS image URLs. Binary uploads, exact Campus Labs-template styling and logo replacement remain deferred until the approved assets/storage requirements are available.

## Verification commands

```sh
cargo fmt --manifest-path backend/api/Cargo.toml -- --check
cargo clippy --manifest-path backend/api/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/api/Cargo.toml
npm run typecheck
npm run lint
npm test
npm run test:site-content
node frontend/public-site/scripts/prepare-site-content.mjs
```

The renderer test uses isolated HTTP fixtures and a local Chromium browser; it verifies safe text rendering, chronology, empty states and newly published data without calling production. Windows may set `BROWSER_EXECUTABLE_PATH` to installed Chrome; other environments require Playwright Chromium. It complements the real API gateway tests and does not replace a full deployed-system check.

## Local verification outcome (2026-10-12)

| Check | Outcome |
|---|---|
| Rust formatting / Clippy, all targets | Passed; installed Windows GNU toolchain used because MSVC linker is unavailable |
| Full API suite | 105 passed, 0 failed |
| Frontend typecheck / lint | Passed |
| Root Node suite | Passed |
| Published renderer + built officer-editor browser tests | 2 passed; private drafts, approval UI, stale saves, safe text, chronology, refresh and mobile layout covered |
| Production-API Pages portal build | Passed |
| Full public-site Sass compilation | Passed |
| Workflow / site / navigation YAML parsing | Passed |
| Footer widths 1440 / 1024 / 768 / 390 px | Passed; no zero-width links or disclaimer overlap |
| Full Jekyll site build | Not run locally: Ruby unavailable and Docker engine stopped; CI evidence remains separate |
| Live deployment / migration | Not performed |

New test-fixture defects were corrected without weakening expectations: a malformed session token was replaced with a valid-format fixture; accessible form labels were separated from textarea values. Mobile checks wait for the existing AppShell padding transition to finish before measuring geometry. The authenticated gateway tests retain non-officer, non-president, stale-revision, revoked-holder and untrusted-origin denial checks.
