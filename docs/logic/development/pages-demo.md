---
logic_id: development.pages-demo
code_paths:
  - apps/pages-demo/app/demo-api.ts
  - apps/pages-demo/app/demo-identity.ts
  - apps/pages-demo/app/demo-accounts.tsx
  - apps/pages-demo/app/layout.tsx
  - apps/pages-demo/next.config.mjs
  - apps/api/seeds/demo-fixtures.json
  - development/pages-demo/build-portal-demo.mjs
  - development/pages-demo/portal-base-path.mjs
  - development/pages-demo/finalize-out.mjs
  - .github/workflows/deploy-pages.yml
tests:
  - development/pages-demo/verify.mjs
feedback_events:
  - pages_demo.out.finalized
  - pages_demo.verify.completed
related_logic: []
---

# GitHub Pages demo

Purpose: publish a static, explicitly fictional member portal preview beside the public site that renders the real portal UI—the same
app shell, member dashboard, officer command center, and workspaces—without school-specific text.

- Next.js static export builds a separate application whose routes re-export the portal pages.
  `/dashboard` picks the member or officer view from the chosen example account, like the portal.
- GitHub Pages cannot run API routes, so `demo-api.ts` maps same-origin `/api/*` reads to the
  Rust API's `/demo/fixtures` snapshot. SQLite stores the captured fictional member and officer
  responses; the seed file initializes it only when no snapshot exists.
  Locked capabilities and offline services keep their captured 403/503 states.
- Writes never leave the browser: non-GET API calls return a read-only notice (403). The portal
  login form accepts the example accounts locally; registration and Google sign-in use a Supabase
  stub (`demo-identity.ts`, aliased only in this app) that explains the demo.
- The example account lives in `sessionStorage`; no cookies or authenticated sessions are created.
- All numbers, names, events, and roles are fictional. The login page labels the example accounts
  and offers member and officer view controls without fixed banners.
- The build finishes `apps/pages-demo/out` with the portal's public files (synthetic media, setup
  illustrations, the web manifest, and app icons), flat aliases
  for segment-prefetch payloads, and `.nojekyll`, so any static host can serve it unchanged.
- The demo is built with `PAGES_BASE_PATH=/portal` (`npm run build:pages`) and prefixes its
  navigation and media with that base path. Set `NEXT_PUBLIC_AUTH_API_ORIGIN` to the Rust API origin
  at build time; `/portal/` itself forwards to the portal login.
- `.github/workflows/deploy-pages.yml` builds the public Jekyll site (`site/`) at `/`, copies the demo
  to `/portal/`, and deploys one Pages artifact. No generated files are committed to the repository.
- Refresh fixtures after portal data changes by capturing `/api/*` from `npm run dev` while signed in
  as each example account, then scan them for school-specific text and sensitive values.
- Browser checks cover both example accounts, portal login, read-only writes, static routes,
  school-text absence, mobile layout, cookies, external requests, and missing assets.

Reuse: existing Next.js static export, React, Tailwind, portal pages, and synthetic demo data; no new
technology selection. The installed hub lacks `tech`/`reuse`, so references are recorded here.

Sources: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports),
[official GitHub Pages example](https://github.com/vercel/next.js/tree/canary/examples/github-pages),
[GitHub publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
