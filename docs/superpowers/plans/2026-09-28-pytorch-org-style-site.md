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
- **Information order** (site navigation and home page): Community (events grouped by type, blog),
  News (community, research, PyTorch), Learn (materials, sample code, open-source projects), About (team).
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
