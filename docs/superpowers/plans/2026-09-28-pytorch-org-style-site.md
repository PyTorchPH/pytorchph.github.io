# PyTorch PH website: pytorch.org-style redesign

Status: Phases 1 and 2 shipped 2026-09-28; free API pages are future work
Owner decision: full pytorch.org visual style for both the public site and the member/officer portal,
built by reusing open-source PyTorch community websites instead of designing from scratch.

## Decisions

- **Base the public site on a fork of [`PyTorchKR/pytorch.kr`](https://github.com/PyTorchKR/pytorch.kr)**,
  itself a clone of the official [`pytorch/pytorch.github.io`](https://github.com/pytorch/pytorch.github.io).
  This is the proven path other regional PyTorch user groups use. Both repos are BSD-3-Clause:
  keep their LICENSE and copyright notice in the fork and record the source commit.
- **Fonts:** do not ship FreightSans (commercial; its files in those repos are not covered by the
  BSD license). Use Montserrat (headings) + Open Sans (body), which the current pytorch.org uses and
  which are free Google Fonts.
- **Palette (from pytorch.org):** white `#ffffff`, light section `#f3f4f7`, text `#262626`, dark navigation
  bar. Orange text and fills use `#be2c10` (the brand `#ee4c2c` fails WCAG AA for text); logos keep the brand color.
- **Information order** (site navigation): Community (events grouped by type), News & Blog (community,
  research, blog, PyTorch news on their own page), Learn (materials, sample code, open-source projects),
  About (team, with a profile page per member). The home page is the Community page, all on one
  page read from top to bottom; sample events fill it until real events are listed.
- **Filipino identity, kept subtle:** one short Filipino phrase per page with its meaning (for example
  "Mabuhay!", "Bayanihan", "Tuloy po kayo"), and hero artwork of the Philippine archipelago drawn as a
  connected network in PyTorch orange.
- **Accessibility:** WCAG 2.1 A/AA checked with axe-core on the public site and the portal demo.
- **PyTorch FIT stays separate.** FIT is the school chapter project; nothing PH-related is published
  from the FIT repo, and no FIT/school wording appears on the PH site.
- **Trademark:** the PyTorch name and logo follow PyTorch Foundation brand guidelines; confirm the
  community's usage before a public launch (PyTorch Korea operates under the same arrangement).

## Architecture

- `site/`: Jekyll 4 + Bootstrap 5 + Sass fork of pytorch.kr, English content for the Philippines.
- `apps/portal`: the existing Next.js member/officer portal, restyled with the same tokens.
- Deployment: GitHub Actions builds the Jekyll site to `/` and the static portal demo
  (`PAGES_BASE_PATH=/portal`) to `/portal/`, then deploys one Pages artifact. The generated static
  files committed at the repository root today are removed once the workflow deploys.
- Local preview without installing Ruby on Windows: `docker run ruby:3.4.5` with a cached bundle volume.

## Phases

### Phase 1: public site (fork)
1. Import pytorch.kr at a pinned commit into `site/` (no submodules: drop `_hub` Korean model hub and
   `_coc`; link to pytorch.org/hub and write a PH code of conduct page).
2. Remove Korea-specific content: blog posts and their assets, members, Korean translations,
   Naver verification file, Korean analytics/tag IDs.
3. Translate layouts, includes, navigation, and footer to English; set `_config.yml` for PyTorch PH.
4. Swap FreightSans for Montserrat/Open Sans in `_sass/fonts.scss` and variables.
5. PH pages: Home, Get Started (from upstream English `_get_started`), Learn, Events, Blog,
   Community (Discord preview + join), About/Code of Conduct, and a Portal link.
6. GitHub Actions workflow for Jekyll + portal demo; switch Pages from branch to workflow source.

### Phase 2: portal restyle (done)
The portal keeps its app layout and uses the site's palette, fonts (Montserrat, Open Sans), and square
cards through semantic tokens in `apps/portal/app/globals.css`; dark mode remains available via `.dark`.
Original steps:
1. Replace hard-coded dark hex values in portal/domain components with semantic tokens.
2. Define light pytorch.org token values; keep charts and status colors legible.
3. Screenshot review of member dashboard, officer command center, and workspaces; fix contrast.

### Phase 3: portal information architecture (done 2026-09-28)
Member navigation: My Performance, Leaderboards, Career Evidence, Resumes & Opportunities, Community
Events, Community Preview, My Profile, Settings & Privacy.
- **My Performance** replaces the personal dashboard: no counter tiles; a season rank card and a stat
  line that compares the member with the peer median and the leader (`summarizePeers`), then grouped
  personal-development visuals. "How ranking works" stays hidden in a popover until opened and uses the
  officer review rubric (participation x1, contributor x2, finalist or lead x3, winner x4).
- **Career Evidence**: one "Add evidence" card with Manual and Automatic (AI) modes; Automatic lists the
  sources AI can read. Counter tiles were removed from all product workspaces.
- **Community Events**: community events first; "Add an external event" sits at the bottom with
  "Fill in the details" or "Use AI". AI retrieval accepts Luma and Meetup links only
  (`automaticEventSource`); an info popover explains this.
- **Resumes & Opportunities** share one page (`CareerWorkspace`).
- **My Profile** holds identity QR codes: one for the PyTorch PH profile (the member's place on the
  leaderboard) and one per connected account that has a profile link. A single code cannot work inside
  LinkedIn or Facebook, because each platform only accepts its own codes.
- **Membership is free.** The page only reports account status and is no longer in the navigation.
  The backend still uses the `paid` and `payment_pending` fields and `paymentReference`; renaming them
  needs a database migration and is not part of this change.
- **Privacy controls** moved under Settings; `/trust` remains for details and for officers.
- **Community Preview** adds sample peer-to-peer tutorials.
- The product tour (React Joyride) now runs on static hosting, where routes end with a slash.

### Phase 4: one structure for members and officers (done 2026-09-28)
Officers have everything members have, plus officer tools. Nothing is shown twice.
- **Shared pages:** My Performance, Leaderboards, Career Evidence, Resumes & Opportunities (with Job
  analytics and Job automation as sections), Community Events, Community Preview, My Profile,
  Settings & Privacy.
- **Officer tools** (a separate menu group): Command Center (`/admin/dashboard`), Event Workflow
  (`/admin/events`), Evidence Review (`/admin/evidence`), Reports & Feedback, Connections, Integrity
  Console.
- **My Performance** is the dashboard for both; officers also see an officer desk with the work that
  is waiting for them.
- **Command Center** exists once and no longer repeats the leaderboard or the career pages.
- **Event Workflow:** 1. create an event, 2. department approval, 3. auto emailer (review the exact
  email before it is sent or exported), 4. final approval. It reuses the existing event actions.
- **Access rules changed:** members may read their own job operations and the job-market summary
  (`officerOnlyViews`, `officerOnlyPrefixes`, `memberApiError`). Connections, the career advisor,
  reports, and everything under `/admin` stay officer-only.
- Demo data for these pages is produced without a running portal by
  `npx tsx development/pages-demo/patch-fixtures.ts` (typed sample events, member-safe copies).

### Phase 5: account binding in Settings and an installable app (done 2026-09-28)
- **Settings & Privacy** is the same for members and officers and holds: Connected accounts, leaderboard
  identity, Privacy & integrity (the integrity page is linked from here and left the officer menu), and
  the AI connection.
- **Connected accounts** binds accounts for evidence collection. It reuses the existing client-side
  design (`docs/CLIENT-SCRAPING.md`): collection runs in the member's own browser through the evidence
  extension (`apps/evidence-extension`), with a preview, the member's review, and officer verification.
  It works on the **website in a desktop browser only**; phones and the installed app cannot run a
  browser extension, and the section says so.
- The extension's portal bridge now also matches `https://pytorch.ph/*`; before, it matched localhost only.
- **Still needed to ship binding to members:** a packaged extension (Chrome Web Store listing or a signed
  download). The setup page still describes the developer install (build and load unpacked). The legacy
  Python headless scraper (`legacy/python/resume_builder/sources/social/`) remains the blueprint for
  vendor logic; it is not run by the website.
- **Installable app (PWA), step 1:** web manifest and icons, so the portal installs from the browser on
  Android, iOS, and desktop. No offline cache or push notifications yet.

### Future: mobile app (after the installable app)
The portal is already responsive, and members and officers share one structure, so the same screens
can move to a phone. Options, from least to most work:
1. **Installable web app (PWA):** add a web manifest, icons, and offline caching to the portal. One
   codebase; installs from the browser on Android and iOS; no app store listing.
2. **Store app that wraps the portal (Capacitor):** the same web code inside a native shell, published
   to Google Play and the App Store, with access to native features such as push notifications and a
   QR scanner.
3. **Native app (Kotlin Multiplatform or React Native):** separate screens that call the portal API.
   Most work; best native feel. Shared logic in `domains/protocol` (ranking, peer summary, event
   sources) can be reused from TypeScript only with React Native.
Decide first whether store presence and a camera QR scanner are required; that choice separates option
1 from options 2 and 3. Any option needs the portal API hosted (GitHub Pages serves only the demo).

### Future: free API pages (like pytorch.kr "Domain API" and "Developer resources")
PyTorch Korea lists libraries on `/domains` (cards with description and link) and developer
information on `/resources`. PyTorch PH wants similar pages where people can discover and use the
community's **free APIs**. To plan when Phase 1–2 land:
- Inventory which PH APIs are public/free (for example job-market summary, evidence analysis,
  local-AI endpoints) versus member-only, and who operates each.
- An API catalog page (card per API: purpose, auth, rate limits, status, docs link) built on the
  fork's `domains` layout.
- Per-API docs (request/response examples, OpenAPI spec if available), terms of use, and abuse
  limits; keys or anonymous access decided per API.
- Hosting: Pages is static, so live "try it" calls must target the real API host with CORS and
  rate limiting configured.

## Open inputs needed from the team
- Final logo/wordmark for PyTorch PH, social links, Discord invite, contact email.
- Real events, organizers/team list for About, and first blog post (if any).
