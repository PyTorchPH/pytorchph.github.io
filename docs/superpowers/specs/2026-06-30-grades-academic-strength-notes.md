# Grades Scraper + Academic-Strength — design notes (user feedback, 2026-06-30)

Captured for a future spec → plan → build cycle. Not implemented yet.

## Goal
Scrape the user's grades from the **FEU SOLAR portal** and compute **academic strength per area**
(e.g. "strong in security", "strong in AI") to enrich the resume and a standalone report.

## Decisions (reverse-prompted)
1. **Source / auth — browser login (Playwright), like the user's `GradesFeu` repo.**
   - Reuse the existing browser/CDP login + scrape stack (same family as the social Profile Scraper
     Agent). Live login; **CAPTCHA / login = human handoff (HITL)**, never auto-solve.
   - `GradesFeu` already does FEU Tech SOLAR scraping (grades/honors analysis, schedule, PNG reports)
     — fold its approach in rather than reinventing.
2. **Strength method — map courses → industries/skills via P3 tagging, GPA-weighted.**
   - Each course is tagged by industry/skill (reuse the P3 `ProjectTagger`/tagging path treating a
     course as a `RetrievedSource` of kind `document`/`course`), then a **GPA-weighted** roll-up gives
     a strength score per industry/skill area.
   - Aligns with the industry-first system: academic strength becomes another tagged-evidence signal,
     not a separate taxonomy.
3. **Output — TWO sinks (multi-select):**
   - **Resume (Education strengths):** surface academically-backed strengths in the Education section
     (or a compact "Academic Strengths" block) — only the role-relevant ones per the target industry.
   - **Standalone strength report:** a separate per-area academic-strength report/dashboard (not in
     the resume) for the user's own diagnostic use.

## Where it sits
- A new **grades/academic** ingestion source feeding the P3 retrieval middleman (course = `document`-
  like source) + a small **strength roll-up** (GPA-weighted aggregation per tagged area).
- Maps loosely to the existing `GradesFeu` work and the board's data-collection theme.

## Open (for the future spec)
- SOLAR DOM specifics / auth flow (reuse GradesFeu selectors as a golden trace; prefer agnostic).
- GPA scale + weighting formula (per-unit credit weighting? honors thresholds?).
- Privacy: grades are sensitive personal data → Layer-2 Private (same model as scraped posts).
- Course→area tagging confidence + how many areas to surface on the resume.

> Status: notes only. Spin a dedicated spec when prioritized (its own brainstorm → plan → build).
