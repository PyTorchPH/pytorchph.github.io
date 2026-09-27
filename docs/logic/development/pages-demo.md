---
logic_id: development.pages-demo
code_paths:
  - apps/pages-demo/app/demo.tsx
  - apps/pages-demo/next.config.mjs
  - development/pages-demo/publish-export.mjs
tests:
  - development/pages-demo/verify.mjs
feedback_events:
  - pages_demo.export.completed
  - pages_demo.verify.completed
related_logic: []
---

# GitHub Pages demo

Purpose: publish a static, explicitly fictional preview using the existing PH homepage and design.

- Next.js static export builds a separate application. Production proxy, auth routes, backend
  providers, cookies, database access, and runtime observability payloads are excluded.
- Login and Create account show read-only synthetic example details. Example member/officer
  buttons navigate directly to public demo screens; they never establish authenticated sessions.
- Demo account creation, RSVP previews, filters, and navigation make no API requests or writes.
- All numbers, names, events, and roles are fictional. Persistent notices disclose demo status.
- Root export uses the existing GitHub Pages `main` / `/` source and `.nojekyll`. Only built static
  output is copied; generated ownership is recorded before later builds may overwrite a file.
- Export validation checks required routes, source exclusion, and collisions with repository files.
- Browser checks cover both example accounts, one-click account creation, deep links, mobile
  layout, filtering, and absence of application network writes.

Reuse: existing Next.js static export, React, Tailwind, PH landing page, and sample data; no new
technology selection. The installed hub lacks `tech`/`reuse`, so references are recorded here.

Sources: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports),
[official GitHub Pages example](https://github.com/vercel/next.js/tree/canary/examples/github-pages),
[GitHub publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
