---
logic_id: development.pages-demo
code_paths:
  - apps/pages-demo/app/demo-api.ts
  - apps/pages-demo/app/demo-identity.ts
  - apps/pages-demo/app/demo-bar.tsx
  - apps/pages-demo/app/layout.tsx
  - apps/pages-demo/next.config.mjs
  - apps/pages-demo/public/demo-api/fixtures.json
  - development/pages-demo/publish-export.mjs
tests:
  - development/pages-demo/verify.mjs
feedback_events:
  - pages_demo.export.completed
  - pages_demo.verify.completed
related_logic: []
---

# GitHub Pages demo

Purpose: publish a static, explicitly fictional preview that renders the real portal UI—the same
app shell, member dashboard, officer command center, and workspaces—without school-specific text.

- Next.js static export builds a separate application whose routes re-export the portal pages.
  `/dashboard` picks the member or officer view from the chosen example account, like the portal.
- GitHub Pages cannot run API routes, so `demo-api.ts` answers same-origin `/api/*` reads from
  `fixtures.json`, captured from the local synthetic portal for the member and officer accounts.
  Locked capabilities and offline services keep their captured 403/503 states.
- Writes never leave the browser: non-GET API calls return a read-only notice (403). The portal
  login form accepts the example accounts locally; registration and Google sign-in use a Supabase
  stub (`demo-identity.ts`, aliased only in this app) that explains the demo.
- The example account lives in `sessionStorage`; no cookies or authenticated sessions are created.
- All numbers, names, events, and roles are fictional. A persistent demo bar discloses demo status
  and switches between the example member and officer.
- Root export uses the GitHub Pages `main` / `/` source and `.nojekyll`. Only built static output,
  the portal's synthetic `/demo/` media, and flat aliases for segment-prefetch payloads are copied;
  generated ownership is recorded before later builds may overwrite a file.
- Refresh fixtures after portal data changes by capturing `/api/*` from `npm run dev` while signed in
  as each example account, then scan them for school-specific text and sensitive values.
- Browser checks cover both example accounts, portal login, read-only writes, static routes,
  school-text absence, mobile layout, cookies, external requests, and missing assets.

Reuse: existing Next.js static export, React, Tailwind, portal pages, and synthetic demo data; no new
technology selection. The installed hub lacks `tech`/`reuse`, so references are recorded here.

Sources: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports),
[official GitHub Pages example](https://github.com/vercel/next.js/tree/canary/examples/github-pages),
[GitHub publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
