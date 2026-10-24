# PyTorch Philippines public site

Jekyll site served at the root of <https://pytorch.ph>. The member portal demo is built from
`frontend/portal-static` and served under `/portal/` by the same GitHub Pages workflow
(`.github/workflows/deploy-pages.yml`). See [`NOTICE.md`](NOTICE.md) for attribution.

## Local preview

Ruby 3.4.5 and Node.js are required. Without a local Ruby install, use Docker:

```sh
npm ci
make vendor
node scripts/prepare-site-content.mjs
docker run --rm -p 4000:4000 -v "$PWD:/srv/site" -v ph-jekyll-bundle-345:/usr/local/bundle \
  -w /srv/site ruby:3.4.5 bash -lc "bundle install && bundle exec jekyll serve --host 0.0.0.0"
```

Open http://localhost:4000. `/portal/` links resolve only in the deployed site or after copying
`frontend/portal-static/out` (built with `npm run build:pages` at the repository root) to `_site/portal`.

## Content

The navigation follows one order: Community, News & Blog, Learn, About. The home page is the Community
page: one page read from top to bottom, with a section per event type (`/community/` redirects to
it). News and blog posts live on `/news/`.

| To change | Edit |
|---|---|
| Navigation | `_data/navigation.yml` |
| Event types (workshops, hackathons, ...) | `_data/event_groups.yml` |
| An event | add `_events/<date>-<name>.md` (fields in `_events/README.md`); delete the `sample: true` placeholder events once real ones exist |
| Blog post | add `_posts/YYYY-MM-DD-title.md`; use category `community` or `research` to also list it under News |
| Learning materials and open-source projects | `_data/learn.yml` |
| Sample code | `_includes/sample_code/*.py` |
| People bios and social links | `_members/<first-last>.md`: `name`, optional `person_key` (`member:<64-hex token suffix from leadership.id>`), `link_github`, `link_linkedin`, `link_homepage`; the body is the bio. These enrich matching API-published people on `/about/`, not individual profile pages. |
| Page hero | front matter `hero_kicker` (a short Filipino phrase), `hero_kicker_meaning`, `hero_title`, `hero_lead`, `hero_actions`; layout `ph` or `ph_article` |
| Hero artwork | `node scripts/generate-archipelago.mjs` rewrites `assets/images/ph-network.svg` from the Natural Earth outline in `scripts/data/` |
| Section layouts | `_includes/ph/*_section.html` |
| PyTorch Philippines styles | `_sass/ph.scss`; people cards live in `_sass/ph/people.scss` (upstream styles stay unchanged where possible) |

PyTorch news comes from the official pytorch.org blog feed (`scripts/fetch-pytorch-news.mjs`), refreshed on
every deploy and daily. Get Started and the install selector come from `pytorch/pytorch.github.io`;
refresh them from upstream when PyTorch releases a new version.

### Shared people directory

`/about/` shows each published person once, combining their current roles. The public API owns the roster,
roles, group labels, and photo visibility. `_members` supplies only optional biography text and validated
GitHub, LinkedIn, and Website links through the inert `community-people-details` template. Metadata needs
an exact identity-key match or an unambiguous name match; it cannot publish a person, override current
roles, or restore a withheld or removed photo. Keep bios independent of changing organization titles.

There are no individual person pages: the `members` collection uses `output: false` and has no redirect
defaults, preserving its original biographies for About metadata. Three declarative compatibility stubs in
`redirects/people/` use the existing `jekyll-redirect-from` plugin: `/about/john-andrew-balbarosa/`,
`/about/alpha-romer-coma/`, and `/about/giorgio-armani/` all redirect to `/about/#team`. The stubs are excluded
from the sitemap. The `#ambassadors` and `#departments` anchors remain in the shared directory intro.

## Accessibility

Pages are checked with axe-core against WCAG 2.1 A/AA and at phone width (390px). Page heroes size to
their content; do not use the upstream fixed-height `jumbotron` for new pages. Keep text contrast at 4.5:1 or higher (use
`$orange` for orange text on light backgrounds and `$orange_on_dark` on dark ones, not the brand `#ee4c2c`; the portal uses the same value as `--accent-rgb`), keep one `h1` per page with headings in order, and
give every image and icon link a text alternative.

## Officer-managed public content

Use `/portal/admin/website/` (officer access) for leadership, upcoming events/programs, Campus Labs chapters and community news/recaps. Draft revisions are private; publication requires distinct current presidents according to `PRESIDENT_REQUIRED_APPROVALS` (default 2). Public pages fetch `/public/site-content` at load and every 60 seconds while visible. No Jekyll rebuild is needed for approved content changes. Branding and the community narrative are static in `_data/community_identity.yml`.

`node scripts/prepare-site-content.mjs` generates empty dynamic-content defaults, not a static leadership roster. It separately reads three allowlisted public contact outputs—`PUBLIC_SITE_FACEBOOK_URL`, `PUBLIC_SITE_LINKEDIN_URL`, and `PUBLIC_SITE_CONTACT_EMAIL`—and writes Jekyll build data used to render the footer. `.env` may supply them locally. Empty values are omitted. GitHub Actions must supply these build values through environment settings; a developer's local `.env` is not available on CI. Contacts never enter the managed-content API or officer editor.

The initial defaults invent no people, events, chapters, or recaps. Samples remain unpublished source fixtures. An unavailable API must not resurrect static member profiles or portraits; current API publication and privacy decisions take precedence over enrichment metadata. Logo changes remain deferred; unavailable Canva/template/event data is entered by officers later.
