# PyTorch Philippines public site

Jekyll site served at the root of <https://pytorch.ph>. The member portal demo is built from
`apps/pages-demo` and served under `/portal/` by the same GitHub Pages workflow
(`.github/workflows/deploy-pages.yml`). See [`NOTICE.md`](NOTICE.md) for attribution.

## Local preview

Ruby 3.4.5 and Node.js are required. Without a local Ruby install, use Docker:

```sh
npm ci
make vendor
docker run --rm -p 4000:4000 -v "$PWD:/srv/site" -v ph-jekyll-bundle-345:/usr/local/bundle \
  -w /srv/site ruby:3.4.5 bash -lc "bundle install && bundle exec jekyll serve --host 0.0.0.0"
```

Open http://localhost:4000. `/portal/` links resolve only in the deployed site or after copying
`apps/pages-demo/out` (built with `npm run build:pages` at the repository root) to `_site/portal`.

## Content

The home page and navigation follow one order: Community, News, Learn, About.

| To change | Edit |
|---|---|
| Navigation | `_data/navigation.yml` |
| Event types (workshops, hackathons, ...) | `_data/event_groups.yml` |
| An event | add `_events/<name>.md` with `title`, `type` (an event type key), `date`, and optional `location`, `link` |
| Blog post | add `_posts/YYYY-MM-DD-title.md`; use category `community` or `research` to also list it under News |
| Learning materials and open-source projects | `_data/learn.yml` |
| Sample code | `_includes/sample_code/*.py` |
| Team profile | add `_members/<id>.md` and `assets/images/maintainers/<id>.png` |
| Section layouts | `_includes/ph/*_section.html` |
| PyTorch Philippines styles | `_sass/ph.scss` (upstream styles stay unchanged where possible) |

PyTorch news comes from the official pytorch.org blog feed (`scripts/fetch-pytorch-news.mjs`), refreshed on
every deploy and daily. Get Started and the install selector come from `pytorch/pytorch.github.io`;
refresh them from upstream when PyTorch releases a new version.

## Accessibility

Pages are checked with axe-core against WCAG 2.1 A/AA. Keep text contrast at 4.5:1 or higher (use
`$orange` for orange text, not the brand `#ee4c2c`), keep one `h1` per page with headings in order, and
give every image and icon link a text alternative.
