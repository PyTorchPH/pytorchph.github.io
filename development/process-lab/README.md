# PyTorch PH Process Lab

The Process Lab is developer-only. It uses Prefect for observable DAGs and local operational
resources; no production package imports this directory.

## Beginner setup

From the repository root:

```bash
npm run setup
npm run dev
```

`npm run dev` starts one Next.js process, Prefect, and separate member/officer
browser profiles. The profiles use the deterministic accounts from `development/local-access/accounts.mjs` and sign in
through the local sign-in form.

- Member: `http://members.ph.localhost:3100`
- Officer: `http://officers.ph.localhost:3100`
- Prefect: `http://127.0.0.1:4200`

Use `npm run dev:manual-login` when you explicitly want to test the visible login form. The automatic
helper refuses production, CI, remote APIs, and non-loopback portal URLs.

## Prefect dashboard

The local dashboard is a pinned Prefect 3.8.3 build with a Process Lab Joyride patch. The tour starts
once for a fresh profile and always exposes a **Start tour** replay button. It explains the major
member DAG, Runs, Flows, Work Pools, Blocks, Variables, Automations, Event Feed, and Concurrency.

The major-member DAG is documentation and observation. Account creation, event registration,
feedback delivery, evidence approval, points awards, uploads, Continue, and final submission remain
visible human gates and are never executed by the lab.

You do not need to configure those sections by hand; `npm run dev` runs the idempotent workspace
configuration before opening the fresh DAG. See [PREFECT-OPERATIONS.md](PREFECT-OPERATIONS.md).

## Direct commands

```bash
npm run dev:process-lab
var/environments/process-lab/bin/pytorch-ph-process-lab doctor
var/environments/process-lab/bin/pytorch-ph-process-lab up
var/environments/process-lab/bin/pytorch-ph-process-lab list
var/environments/process-lab/bin/pytorch-ph-process-lab open --workflow member-experience
```

Browser traces and reports stay under `out/process-lab/`. The Prefect database, source checkout, UI
build caches, state, environments, and browser sessions stay under `var/`.

## Release boundary

```bash
var/environments/process-lab/bin/pytorch-ph-process-lab guard-artifact PATH_TO_ARTIFACT
```

Vercel and Docker ignore all of `development/`, Python sources, tests, traces, and Prefect files.
