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
website without Python, Prefect, or the Rust API.

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

https://pytorch.ph serves the public site from `frontend/public-site/` and a static member portal demo at
`/portal/`, built and deployed by `.github/workflows/deploy-pages.yml` on every push to `main`.
See [`frontend/public-site/README.md`](frontend/public-site/README.md) for local preview.

## Production

The Next.js application needs Node.js-compatible hosting; GitHub Pages cannot run its server routes.
Configure the portal build (`NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_AUTH_API_ORIGIN`) using `.env.example` in hosting or `frontend/portal/.env.local`;
retain email confirmation and RLS.
Use `npm run build` and `npm start`. Production never uses local demo authentication.
No live deployment or data migration is included in this adaptation.

## Staging performance and cost efficiency

Assessment: **2026-10-12**, `pytorch-ph-ec2-assessment-2026-10-12`.
Public GET workload: `/public/events` and `/leaderboard`; no live database writes.
The API ran on a shared **Lightsail 2-vCPU host with 412.27 MiB OS-visible RAM**. A separate
**m7i-flex.large (2 vCPU, 8 GiB), ap-southeast-1** generated the requests.

| Measurement | Observed result |
|---|---|
| Highest clean tested load | 500 requests/second; two 15-second stages, each 7,500 HTTP 200 responses and zero errors |
| Latency at 500 requests/second | Phase 1: p95 3.19 ms / p99 40.31 ms; phase 2: p95 2.21 ms / p99 157.31 ms |
| Peak host CPU / minimum available RAM | 97.52% / 52.05 MiB across valid monitored stages |
| Higher offered rates | 1,000–8,000 requests/second produced extensive timeouts; offered rate differs from achieved throughput |
| Recovery | API healthy; zero observed API restarts and cgroup OOM kills |
| Repository checks | 21 passed, 8 failed; not all tests passed |

Stages lasted 15 seconds, with 256 connections at 500 requests/second and up to
4,096 at higher rates; request timeout was 3 seconds. Returned-response latency
includes scheduling correction and excludes failures. Brief CPU utilization exceeded
95%, but neither the two-consecutive-sample CPU stop condition nor 99% was reached.
High I/O wait accompanied timeouts. One phase-1 stage lost host telemetry when the
operator IP changed; its client results were recovered separately. These measurements
do not establish maximum sustainable throughput, human-user capacity, or spare capacity
for a second website.

**Lightsail cost/performance:** the Linux public-IPv4 **0.5 GB / 2-vCPU bundle
(`nano_3_0`) costs US$5/month**, including 20 GB SSD and 1 TB transfer allowance.
The Singapore Lightsail bundle API and [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing/)
were checked on 2026-10-12. These specifications match the tested host's size;
the target instance's bundle assignment and actual invoice have not been verified.

Using that plan price, **500 tested requests/second / US$5 monthly base cost =
100 requests/second per US$1 of monthly base cost**. This normalizes short-test
throughput against the hosting plan price; it does not establish a monthly request
volume, long-term throughput, or an SLA. The price covers the shared host, so this
comparison assigns its entire base cost to the API. Transfer overages, snapshots,
other services, taxes, and credits can change the actual cost. The EC2 instance
served only as the load generator and is excluded from this hosting ratio.

Detailed results, source manifest, failure reasons, cleanup, and artifact hashes are
stored locally in `../portfolio-evidence-artifacts/2026-10-12/ec2/assessment-evidence.json`
and the parent Projects `portfolio-evidence.json`. Evidence maps to ISO/IEC/IEEE 29119
test processes/documentation; full conformance and certification are unverified.

## Layout

| Path | Purpose |
|---|---|
| `backend/api` | Rust API (auth, portal gateway, evidence, leaderboards, profiles) |
| `backend/legacy-python` | Retained Python engine, operator tools, and tests |
| `frontend/public-site` | Public website (Jekyll fork of the PyTorch Korea and pytorch.org sites) |
| `frontend/portal` | Member/officer portals |
| `frontend/portal-static` | Static portal demo served under `/portal/` on GitHub Pages |
| `extension` | Chrome evidence extension |
| `frontend/features`, `frontend/contracts` | Client features and shared request/response shapes |
| `frontend/design-system` | Shared visual components |
| `development` | Local launchers, local server, and optional automation tools |
| `docs/PH-MIGRATION.md` | Provenance, sources, scope, and rollback |
| `observability.project.toml` | Existing PH identity in the shared Codex harness |

The organization profile stays in `../org-profile`.
See [nationwide membership rules](docs/logic/identity/nationwide-membership.md) for access invariants.
