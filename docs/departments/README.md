# Departments — Engineering Ownership Map

> **Audience:** developers contributing to `resume-build-chopper`.
> **Purpose:** this folder splits the codebase into **5 departments**, each owning a
> distinct module of functionality. Use it to know *what you own*, *what contract you must
> not break*, and *who you hand off to*.

This index is organized **by modularity of functionality** — not by file location.
Each department has its own folder under `docs/departments/<nn-name>/` containing:

- a `README.md` (responsibilities, public contract, files owned, dos & don'ts)
- a `*.puml` PlantUML diagram (render it with any PlantUML viewer or the VS Code extension)

---

## The One Principle (read this first)

> **One person, many roles — one truth, many resumes.**

A single generic resume fails because recruiters and ATS bots filter by **role-specific
keywords**. This product automates **role specialization**: collect everything true about a
candidate (GitHub, documents, social posts), then *chop* it down to a single **target role** so
only relevant evidence survives. That's why it's called **Chopper**.

Everything in the system is a **5-stage pipeline**, and every stage has **two interchangeable
implementations** (`static` = regex/offline, `ai` = LLM-driven) behind one interface:

```
ROLE  →  COLLECT  →  EXTRACT  →  SYNTHESIZE  →  RENDER
```

---

## The Golden Contract (every department obeys this)

The file `legacy/python/resume_builder/core/models.py` is the **constitution**. Every stage produces and
consumes the same pydantic models (`RoleSpec`, `Repo`, `Evidence`, `Resume`, ...).

**This is what lets us delegate by department.** You can rewrite the entire `static` extractor
or add a 6th renderer without touching another team — as long as you honor the model shapes and
the abstract base class for your stage.

> 🚫 Changing `models.py` is a **cross-department event**. It is owned by Dept. 01 and any
> change must be announced to all departments.

---

## The 5 Departments (by functional module)

| # | Department | Functional module | Owns (folders) | Hands off to |
|---|------------|-------------------|----------------|--------------|
| **01** | [Core / Orchestration](01-core-pipeline/README.md) | Domain models + pipeline wiring + role picking + config | `core/` (`models.py`, `config.py`, `principles.py`), `orchestration/pipeline.py`, `role/`, `cli.py` | drives all others |
| **02** | [Sources / Data Collection](02-sources/README.md) | Pull raw evidence in (GitHub, documents, social scraper) | `sources/` (incl. `sources/social/`) | → 03 |
| **03** | [Intelligence](03-intelligence/README.md) | Role-aware filtering + resume assembly + LLM providers | `extractors/`, `synthesizers/`, `llm/` | → 04 |
| **04** | [Rendering / Output](04-rendering/README.md) | Turn the `Resume` model into files (LaTeX/PDF/HTML/MD/JSON) | `renderers/`, `config/templates/` | final output |
| **05** | [Web / SaaS](05-web-saas/README.md) | "CareerLens" prototype: FastAPI UI, OAuth, social-login | `web/` | wraps 01–04 |

---

## Data flow at a glance

```
        ┌──────────── Dept 01: Core / Orchestration ────────────┐
        │  Pipeline.run(BuildInputs)  —  the ONLY mode-aware code │
        └───┬───────────────┬───────────────┬──────────────┬────┘
            │ role          │ collect       │ extract+build │ render
            ▼               ▼               ▼               ▼
      RoleSpec       Repo[] / Docs[] /   Evidence[] →    files in out/
      (Dept 01)      CollectResult        Resume         (Dept 04)
                     (Dept 02)            (Dept 03)

      Dept 05 (Web) calls into Dept 01's pipeline + social-login flows.
```

All arrows carry **`models.py` shapes**. That is the contract.

---

## Two build modes (why every stage is doubled)

| Mode | How it works | When |
|------|--------------|------|
| `static` | regex / keyword scoring, `NullProvider`, no API key | offline, deterministic, fast, cheap |
| `ai` | LLM evaluates each repo/achievement/project for role fit | higher quality filtering + written bullets |

Both modes output the **identical `Resume` object**, so Dept 04 never knows which mode ran.
The cost: every new capability must be supported in **both** implementations.

---

## How to use this in delegation (for the architect)

1. Give a developer exactly one department folder. Its `README.md` is their self-contained brief.
2. The diagram (`.puml`) shows their classes + the interface boundary they must not cross.
3. The "Contract you must NOT break" section is the acceptance gate for their PR.
4. Cross-department changes (anything touching `models.py` or an abstract `base.py`) escalate to
   Dept 01 first.
