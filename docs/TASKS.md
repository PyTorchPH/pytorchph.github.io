# Delegation Backlog — PyTorch PH System

> **Live board:** https://github.com/JohnAndrewBalbarosa/pytorch-ph-system/projects (Project #11)
> **Source of truth:** [`scripts/board_tasks.json`](../scripts/board_tasks.json) — edit it, then run
> `python scripts/sync_board.py --prune` to make the board match (idempotent, no duplicates).
> Every AI-produced artifact passes a **human-in-the-loop (HITL)** gate before it reaches Done.

## Board fields

- **Stage** (kanban): `Backlog · Todo · In Progress · In Review · Blocked · Done`
- **Role**: Architect · Database · AI · Frontend · Security · Analytics · QA · DevOps
- **Group**: Legacy Engine · Docs & Ops · Foundation · Profiles & Analytics · Intelligence · Scale · Model Training · Quality & Security
- **Start / Target**: schedule (date fields → roadmap view)

## Schedule (optimistic 1 week, 1 week slack)

| Bucket | Start | Target |
|---|---|---|
| Done (already shipped) | 2026-06-27 | 2026-06-27 |
| Todo (immediate — Foundation + quick wins) | 2026-06-27 | **2026-07-03** (best case, this week) |
| Backlog (later phases) | 2026-07-04 | **2026-07-17** (worst case, week after next) |

> Best case: most of it lands this week. Worst case with slack: the later phases finish by 2026-07-17.
> Assignees: none yet — assign on the board when owners are picked.

---

## ✅ Done — completed across the whole codebase (26 items)

Grounded in real modules + passing tests (172 tests green; 2 legacy test imports tracked as Q.30).

**Legacy Engine (reference for the new platform):** pipeline orchestrator · domain models · role
picker (static+AI) · extractors (regex+AI) · synthesizers (static+AI) · role-aware filtering
(Harvard) · review orchestrator · LLM adapter+registry (4 providers) · GitHub+Document sources ·
social aggregator · social vendors (FB/LI/X/IG) · social auth+sessions+browser login · cookie
fallbacks · headless browser+scroll-collect · visual scraper debugger · clean export + debug
trace · renderers (5 formats) · FastAPI web prototype + OAuth · CDO advisor · Typer CLI +
commands · config-driven roles/regex/templates · unit+integration suite (172 passing).

**Docs & Ops:** per-folder READMEs + Mermaid · department docs + PlantUML · master specification
(NotebookLM) · delegation backlog + board sync automation.

---

## 🔲 Delegated work (by Group) — 30 items

> Full context (goal, scope, acceptance, HITL, dependencies) lives in each board card and in
> `scripts/board_tasks.json`.

- **Foundation** (Todo, this week): P1.1 architecture+ADRs · P1.2 normalized schema+ERD ·
  P1.3 migrations+seed · P1.4 RLS policies · P1.5 Supabase auth · P1.6 Next.js scaffold ·
  P1.7 raw-input UI · P1.8 AI extraction · P1.9 normalized extraction · P1.10 resume generator.
- **Profiles & Analytics** (Backlog): P2.11 public profile · P2.12 career score · P2.13 platform
  analytics+leaderboards · P2.14 resume templates.
- **Intelligence** (Backlog): P3.15 portfolio · P3.16 job matching · P3.17 recommendations+roadmap.
- **Scale** (Backlog): P4.18 backend API · P4.19 scraping → background jobs.
- **Model Training** (Backlog): ML.20 define tasks · ML.21 dataset · ML.22 train · ML.23 evaluate
  · ML.24 serve behind adapter.
- **Quality & Security**: Q.25 AI adapter layer · Q.26 test suite (AI/DB/RLS) · Q.27 regression
  harness · Q.28 threat model · Q.29 CI/CD · **Q.30 fix 2 broken legacy test imports** (Todo, quick win).

---

## 👤 Human-in-the-loop policy

AI proposes, humans dispose. No extracted data, generated resume, trained-model output, or
recommendation reaches **Done** until a human reviewer in the owning Role approves it. Untested
or unvalidated work stays in **In Review / Blocked**, never Done.

## 🔁 Keeping the board in sync (lazy path)

1. Edit [`scripts/board_tasks.json`](../scripts/board_tasks.json) (titles, stage, role, group, dates, body).
2. Run `python scripts/sync_board.py --prune`.
3. The board now matches the file exactly. Field/option IDs are discovered by name, so it keeps
   working even if the project is recreated.

> The kanban/roadmap **view layout** is the one thing the API can't create — set it once in the
> UI: `+ New view → Board` (group by Stage), and `+ New view → Roadmap` (Start/Target).
