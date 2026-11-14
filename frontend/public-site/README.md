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

The navigation follows one order: Community, News, Learn, Campus Labs, About, Member Portal. Every
dropdown link must point at a page or an `id` that exists on it. The home page is the Community page
(`/community/` redirects to it): what we do, upcoming programs, the island groups, news, and ways to get
involved. Community news, event recaps, and the PyTorch blog feed live on `/news/`.

Empty states point to a next step. Lists loaded from the API sit in a wrapper with
`data-hide-when-empty`, and a `data-show-when-all-empty="name …"` note replaces a group of empty lists
(see `assets/site-content.js`).

| To change | Edit |
|---|---|
| Navigation | `_data/navigation.yml` |
| Events and learning programs | the officer portal (`/portal/admin/website/`); see `_events/README.md` |
| Blog post | add `_posts/YYYY-MM-DD-title.md`; use category `community` or `research` to also list it under News |
| Learning path, materials, and open-source projects | `_data/learn.yml` (path stages match the program series names) |
| PyTorch Foundation Ambassadors on `/about/#ambassadors` | Nothing by hand: `node scripts/fetch-ambassadors.mjs` copies the people the [official directory](https://pytorch.org/programs/ambassadors/) places in the Philippines, with their official photos and biographies, into `_data/ambassadors_directory.json` and `assets/images/ambassadors/`. It runs on every deploy and daily. A failed fetch, a malformed directory, or a failed write keeps the committed snapshot; an empty result replaces a non-empty snapshot only with `AMBASSADORS_ALLOW_EMPTY=1`. The portrait directory belongs to the script and is replaced as a whole. |
| Campus Labs people | `_data/campus_labs.yml`, exactly as PyTorch Philippines' Campus Labs posters give them (name, university, batch, and a title only where a poster gives one); the posters are the only source. A chapter published in the officer portal replaces the entry for the same university on `/campus-labs/` and `/about/` (matched on the name or one of its `aliases`). |
| Ambassador terms on `/about/#ambassadors` | `_data/ambassador_terms.yml`, from PyTorch Philippines' ambassador poster, keyed by directory id |
| Home page background photos | `_data/photo_credits.yml`: four Manila photos (three from Wikimedia Commons, the Malacañang one from English Wikipedia) that crossfade in the home hero (in order: Rizal Monument, Malacañang Palace from the Pasig River, Fort Santiago, Manila Bay sunset), each with its source, author, license, changes, copyright status of the place, and SHA-1. The Malacañang photo is a public-domain Official Gazette photo of a building still under copyright (architect Jorge Ramos, to 2065); it is used at the site owner's decision and should be replaced if the Office of the President grants permission for another. The footer of the page credits every photo it shows. To add or swap one: crop a 2:1 `image` (2000 × 1000) and a 3:4 `image_portrait` (900 × 1200) into `assets/images/hero/` in black and white with no metadata, add an entry, list its key under `hero_photos:` in the page's front matter, and check text contrast over it. `assets/hero-slides.js` runs the crossfade (7 s per photo; off for reduced motion). `npm run test:hero-photo:built` checks the credits and files; `npm run test:hero-photo:browser` checks the crossfade. |
| Mission and principles on `/about/` | `_data/community_identity.yml`, taken from the [organization profile](https://github.com/PyTorchPH) |
| Sample code | `_includes/sample_code/*.py` |
| People bios and social links | `_members/<first-last>.md`, used only by the team-directory renderer (`assets/people/`), which no public page currently includes. |
| Page hero | front matter `hero_kicker` (a short Filipino phrase), `hero_kicker_meaning`, `hero_title`, `hero_lead`, `hero_actions`; layout `ph` or `ph_article`. `hero_style: light` (Campus Labs) gives a white hero after the PyTorch Foundation's program pages, with `hero_subtitle`, `hero_prompt`, and `hero_aside: archipelago` |
| Hero artwork | `node scripts/generate-archipelago.mjs` rewrites `assets/images/ph-network.svg` from the Natural Earth outline in `scripts/data/` |
| Section layouts | `_includes/ph/*_section.html` |
| PyTorch Philippines styles | `_sass/ph.scss`; page sections in `_sass/ph/sections.scss`; people cards in `_sass/ph/people.scss` (upstream styles stay unchanged where possible) |

PyTorch news comes from the official pytorch.org blog feed (`scripts/fetch-pytorch-news.mjs`), refreshed on
every deploy and daily. The install selector (`published_versions.json`, `releases.json`,
`assets/quick-start-module.js`) comes from the `site` branch of `pytorch/pytorch.github.io`; refresh it
when PyTorch releases a new version. The supported Python and OS versions in `_includes/quick_start_local.html`
and `_get_started/installation/*.md` are written for PyTorch 2.15 (checked against the PyPI wheels);
update them with each release. The PyTorch 2.x and Previous Versions pages redirect to pytorch.org,
which keeps them current.

### People on the site

The About page has no team directory: the "Our team" section was removed at the site owner's
request. People appear in two places, each from a single source:

- `/about/#ambassadors`: the PyTorch Foundation Ambassadors that the Foundation's directory places in
  the Philippines, with the portraits and biographies the Foundation publishes there and the terms
  from PyTorch Philippines' ambassador poster (`_data/ambassador_terms.yml`). A person who leaves the
  directory leaves this section (and their portrait is deleted) on the next deploy.
- `/campus-labs/` and `/about/#campus-labs-leads`: the Campus Labs people from PyTorch Philippines'
  posters (`_data/campus_labs.yml`), with portraits cropped from those posters
  (`assets/images/campus-labs/`, 455 × 455). `/campus-labs/` shows them in one alphabetical directory
  with a search and an island group filter (`_includes/ph/campus_directory.html`,
  `assets/campus-directory.js`); the About page groups them by island.

The officer portal still publishes the leadership roster to the API, and `assets/people/` can still
render it, but no public page includes a target for it. `_members` biographies are kept for that
renderer. Three compatibility stubs in `redirects/people/` keep old profile URLs working:
`/about/john-andrew-balbarosa/` redirects to `/campus-labs/`, and `/about/alpha-romer-coma/` and
`/about/giorgio-armani/` to `/about/#ambassadors`. The stubs are excluded from the sitemap.

## PyTorch brand and trademark rules

PyTorch is a registered trademark of The Linux Foundation. This site follows the
[Linux Foundation trademark usage policy](https://www.linuxfoundation.org/legal/trademark-usage), the
[PyTorch brand guidelines](https://pytorch.org/brand-guidelines/), and the brand book in
[pytorch-fdn/artwork](https://github.com/pytorch-fdn/artwork):

- **Do not alter the logo.** `assets/images/logo-pytorch-white.svg` is the official horizontal lockup,
  unmodified. The community name is separate text behind a divider (`_includes/ph/brand.html`), with
  at least one wordmark "P" of clear space. Never draw "Philippines" or anything else into a logo file.
  The old combined marks (`logo-ph.svg`, `logo-ph-dark.svg`) were removed from this site; the member
  portal still ships its own copies under `/portal/brand/` and should be updated the same way.
- **Attribution.** The footer carries the brand book's statement word for word: "PyTorch, the PyTorch
  logo and any related marks are trademarks of The Linux Foundation." The first prominent use of the
  name on the home page carries the ® symbol.
- **No implied endorsement.** The footer says the community is not affiliated with or otherwise
  sponsored by the PyTorch Foundation. Ambassadors are recognized as individuals.
- **Symbol size and color.** Keep the symbol at 24px or larger on screen (the symbol is 89% of the
  horizontal lockup's height, so the lockup is never shorter than 27px), in orange, white, black, or
  gray only, on a background with strong contrast. Use orange as an accent, not a fill.
- **Needs written permission from the Foundation** (not something code can fix): the trademark policy
  and brand guidelines say not to use the name in a domain or organization name, and to ask before
  using the logo on a website. Confirm permission for `pytorch.ph`, the name "PyTorch Philippines", and
  logo use with marketing@pytorch.org / trademarks@linuxfoundation.org, and keep the reply on file.

## Accessibility

Pages are checked with axe-core against WCAG 2.1 A/AA and at phone width (390px). Page heroes size to
their content; do not use the upstream fixed-height `jumbotron` for new pages. Keep text contrast at 4.5:1 or higher (use
`$orange` for orange text on light backgrounds and `$orange_on_dark` on dark ones, not the brand `#ee4c2c`; the portal uses the same value as `--accent-rgb`), keep one `h1` per page with headings in order, and
give every image and icon link a text alternative.

## Officer-managed public content

Use `/portal/admin/website/` (officer access) for leadership, upcoming events/programs, Campus Labs chapters and community news/recaps. Draft revisions are private; publication requires distinct current presidents according to `PRESIDENT_REQUIRED_APPROVALS` (default 2). Public pages fetch `/public/site-content` at load and every 60 seconds while visible. No Jekyll rebuild is needed for approved content changes. Branding and the community narrative are static in `_data/community_identity.yml`.

`node scripts/prepare-site-content.mjs` generates empty dynamic-content defaults, not a static leadership roster. It separately reads three allowlisted public contact outputs—`PUBLIC_SITE_FACEBOOK_URL`, `PUBLIC_SITE_LINKEDIN_URL`, and `PUBLIC_SITE_CONTACT_EMAIL`—and writes Jekyll build data used to render the footer. `.env` may supply them locally. Empty values are omitted. GitHub Actions must supply these build values through environment settings; a developer's local `.env` is not available on CI. Contacts never enter the managed-content API or officer editor.

The initial defaults invent no people, events, chapters, or recaps. Samples remain unpublished source fixtures. An unavailable API must not resurrect static member profiles or portraits; current API publication and privacy decisions take precedence over enrichment metadata. Logo changes remain deferred; unavailable Canva/template/event data is entered by officers later.
