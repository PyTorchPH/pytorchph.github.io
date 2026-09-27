# PyTorch Philippines

Nationwide, community-led PyTorch learning, research, career development, and community operations.
Open to learners, educators, researchers, engineers, and contributors without school affiliation.
This website adapts the FIT system; the original FIT project remains separate.

## Local website

Requires Node.js 22.13–24.x and npm.

```powershell
npm run setup
npm run dev
```

Open http://localhost:3100. Member and officer views use http://members.ph.localhost:3100
and http://officers.ph.localhost:3100. The launcher creates synthetic local data and starts the
website without Python, Prefect, or Supabase services.

Local-only demo accounts: `demo.member@example.org` and `demo.officer@example.org`, password
`demo-password`. These synthetic fixtures are unavailable in production. Preview statistics
and testimonials are sample data, not verified community metrics.

```powershell
npm run typecheck
npm run test:nationwide
npm test
npm run build
```

## GitHub Pages

https://pytorchph.github.io serves the public site from `site/` and a static member portal demo at
`/portal/`, built and deployed by `.github/workflows/deploy-pages.yml` on every push to `main`.
See [`site/README.md`](site/README.md) for local preview.

## Production

The Next.js application needs Node.js-compatible hosting; GitHub Pages cannot run its server routes.
Configure a separate PH Supabase project using `.env.example` in hosting or `apps/portal/.env.local`;
retain email confirmation and RLS.
Use `npm run build` and `npm start`. Production never uses local demo authentication.
No live deployment or data migration is included in this adaptation.

## Layout

| Path | Purpose |
|---|---|
| `site` | Public website (Jekyll fork of the PyTorch Korea and pytorch.org sites) |
| `apps/portal` | Member/officer portals |
| `apps/pages-demo` | Static portal demo served under `/portal/` on GitHub Pages |
| `domains` | Shared protocols, server decisions, and client features |
| `design-system` | Shared visual components |
| `development` | Local launchers and optional automation tools |
| `supabase` | Existing database definitions; not applied automatically |
| `docs/PH-MIGRATION.md` | Provenance, sources, scope, and rollback |
| `observability.project.toml` | Existing PH identity in the shared Codex harness |

The organization profile stays in `../org-profile`.
See [nationwide membership rules](docs/logic/identity/nationwide-membership.md) for access invariants.
