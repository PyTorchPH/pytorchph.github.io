# PyTorch Philippines public site

Jekyll site served at the root of <https://pytorchph.github.io>. The member portal demo is built from
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

- Navigation: `_data/navigation.yml`
- Pages: `index.html`, `about.html`, `events.html`, `code-of-conduct.md`, `blog.html` (posts in `_posts/`)
- PyTorch Philippines styles: `_sass/ph.scss` (upstream styles stay unchanged where possible)
- Get Started and the install selector come from `pytorch/pytorch.github.io`; refresh them from upstream
  when PyTorch releases a new version.
