# P2 — Website-Agnostic Extraction (Design)

> **Status:** APPROVED (design) — 2026-06-30. Awaiting written-spec review before planning.
> **Owner:** PyTorch Philippines Student Chapter
> **Sub-spec of:** the industry-first, project-based resume-generation system (see _Parent decomposition_).

---

## 0. Parent decomposition (where P2 sits)

The resume system is decomposed into 5 pipelines + 1 cross-cutting concern. Each gets its own
spec → plan → implementation cycle.

| # | Pipeline | Purpose | Depends on |
|---|----------|---------|------------|
| P1 | **Collection** | Pull raw evidence: GitHub repos + READMEs (with traversal), arbitrary websites, social handoff | — |
| **P2** | **Website-Agnostic Extraction** *(this spec)* | AI learns a site's generalized DOM structure → extraction rules → minimal token-lean cleaned text | P1 |
| P3 | **Interpretation & Tagging** | AI tags each project/post by **industry** (multi-industry, free-form, normalized), **skill subtags**, separated quantitative/qualitative + component-level bullets; no confidence scoring, no manual overrides | P2 |
| P4 | **Industry Planning & Assembly** | Group by industry → per-industry resume JSON; achievements included by **skill-relevance**; link→`<logo>/<path>` formatting; quantitative-first ordering | P3 |
| P5 | **Bleed-Proof Render** | Inject JSON into a word-wrapping, top→bottom template; keep `check-bounds` as a safety net | P4 |
| S | **Profile Storage** (cross-cutting) | Persist only **skills + industry-tags** to the user profile DB. No resume cache, no stored GitHub links | P3/P4 |

**Carried-forward notes for later specs (locked, not P2):**
- P4/P5 heading hierarchy: the **job/industry title is the main heading**; the candidate name is small/secondary.
- P4/P5 links: for FB/LinkedIn/GitHub render **logo + path only** (no `https://`, no `www`). In PDF the
  decluttered text is a **clickable hyperlink**.
- P3: tags are **industry names**, never skills; skills live in `skill_subtags`. Multi-industry allowed
  (e.g. a web app with security features → web **and** cybersecurity **and** devops). No project → no
  resume for that industry (project-based; avoids empty resumes).

---

## 1. Purpose

Turn raw sources into **minimal, clean, token-lean text** for P3 (tagging), in a way that is
**agnostic to any website or platform** — no hardcoded per-site selectors. P2 is the cost-control
layer: it ensures the tagging model sees the *project/article content* (especially READMEs), not
headers, navbars, footers, CTAs, or site chrome.

Non-goals: P2 does **not** tag, classify industries, or assemble resumes (that is P3/P4). It does
**not** scrape social media (that is the separate `PROFILE-SCRAPER-AGENT`, fed in at P1).

## 2. Sources and modes

| Source | Mode | Behavior |
|---|---|---|
| **GitHub repo** | **README-only (default)** | Traverse the repo git-tree via `gh api`; collect **all `README.*` + `docs/*.md`** (recursive). Markdown is already clean — light-normalize only: strip badges, HTML comments, base64/inline images, raw `<...>` noise. |
| **GitHub repo** | **Deep, code-aware (optional)** | **Broad source sweep** within a token budget, prioritized by importance; skip vendored/build/generated/lockfile dirs. Token-hungry; off by default. *Design-only in this spec — not executed during design.* |
| **Arbitrary website / HTML** | **Structure-skeleton pass** | Full agnostic pipeline (§3). Applies to **all HTML sources**. |

Default scan depth is README-only with traversal. Deep mode is an explicit opt-in (its UX surface —
end-user toggle vs developer/CLI — is deferred to the consuming pipeline; P2 only exposes a `deep`
flag on its API).

## 3. Structure-skeleton pass (HTML)

The core agnostic mechanism. The AI never sees the full HTML — only a cheap structural skeleton.

```
fetch(url) ──static-first──> html
   │  thin/JS-rendered? ──> headless render (reuse Playwright) ──> html
   │  still failing?     ──> readability/truncate (final fallback)
   ▼
DomSkeleton(html) ──> outline: tag + id/class/role attrs, text stripped/truncated
   ▼
ExtractionRuleEngine
   │  fingerprint = hash(DOM shape)
   │  cache hit? ──> reuse cached ExtractionRule
   │  miss?      ──> AI(skeleton) ──> keep/drop selectors + keep_regex  ──> cache by fingerprint
   ▼
RuleApplier(rules, full html) ──> minimal text (deterministic)
   ▼
CleanedSource { source_id, kind, title, text, section_hints }  ──token cap──> P3
```

1. **Fetch** — static HTTP first. If the returned content is thin (heuristic: little body text vs
   markup, or an SPA shell), escalate to a **headless render** reusing the existing Playwright stack.
   Final fallback: deterministic readability extraction, then truncate.
2. **DomSkeleton** — build a compact outline: element `tag` + `id`/`class`/`role` attributes, with
   text content stripped or hard-truncated. This is what the AI sees (small, structural, cheap).
3. **ExtractionRuleEngine** — compute a **template-fingerprint** (a hash of the DOM shape). On a cache
   hit, reuse the stored `ExtractionRule`; on a miss, send the skeleton to the AI, which returns
   `keep_selectors`, `drop_selectors`, and `keep_regex`, then cache the rule **by fingerprint** (so
   same-layout pages on a site reuse one analysis; different layouts get their own).
4. **RuleApplier** — deterministically apply the rules to the full DOM and emit only the kept content
   as text. No AI in this step.
5. **Output** — a normalized `CleanedSource`, capped at a configurable **hard token limit** per
   source (default ~3k tokens).

## 4. Output contract

```python
class CleanedSource(BaseModel):
    source_id: str            # repo full_name, url, or doc path
    kind: str                 # "github_readme" | "github_code" | "website"
    title: str = ""
    text: str = ""            # minimal, token-lean content for P3
    section_hints: list[str] = []   # optional ("readme", "docs/ARCHITECTURE", page section labels)
    truncated: bool = False   # true if the token cap clipped content
    degraded: bool = False    # true if a fallback path produced this (thin/failed extraction)
```

P3 consumes a `list[CleanedSource]`. P2 never returns raw HTML or vendor quirks upstream.

## 5. Components (small, isolated units)

| Unit | Responsibility | Depends on |
|---|---|---|
| `SourceFetcher` | static fetch + headless fallback + readability fallback; thinness heuristic | Playwright (social stack), `http` |
| `DomSkeleton` | full HTML → compact structural outline (tags + id/class/role, text stripped) | an HTML parser |
| `ExtractionRuleEngine` | fingerprint DOM shape; cache rules; AI rule-gen on miss | LLM provider, `ExtractionRule` (reused from `industry.py`) |
| `RuleApplier` | deterministically apply keep/drop selectors + regex → minimal text | parser |
| `GithubReadmeTraversal` | git-tree walk → collect `README.*` + `docs/*.md`; deep budgeted source sweep | `gh api` |
| `CleanedSource` | normalized output model | pydantic |

Each unit is independently testable: given an input it produces a deterministic output (the only
AI-touching unit is `ExtractionRuleEngine`, behind a mockable LLM seam).

## 6. Error handling

- **Bounded everything** — fetch timeouts, capped retries, capped headless waits, capped scroll/expand.
- **Fallback cascade** — static → headless → readability/truncate; each step degrades, never crashes.
- **Token cap** — hard per-source limit; on overflow set `truncated=True` and keep the highest-value
  content first (README/main content before peripheral docs).
- **Total failure** — emit a short/empty `CleanedSource` with `degraded=True` rather than raising, so
  one bad source never breaks a batch.
- **AI rule-gen failure** — fall back to readability extraction for that source (rules optional, not
  required).

## 7. Testing

- **Golden HTML fixture** — a saved page → assert the skeleton shape, the AI-returned rules (mocked
  LLM), and the deterministic extracted text. No live network.
- **Markdown traversal** — a fixture repo-tree (mock `gh api` git-tree) → assert all `README.*` +
  `docs/*.md` are collected and normalized (badges/comments stripped).
- **Fingerprint cache** — two pages with the same layout → one AI rule-gen call, second is a cache hit;
  a third page with a different layout → a new rule-gen call.
- **Fallback paths** — thin/SPA fixture triggers the headless path; a broken fixture triggers
  readability/truncate with `degraded=True`.
- **Token cap** — an oversized source → `truncated=True` and content within the cap.

## 8. Reuses (do not reinvent)

- `ExtractionRule` model — already in `legacy/python/resume_builder/industry.py`.
- Playwright / headless browser runtime — already in `legacy/python/resume_builder/sources/social/`.
- `gh api` git-tree access — pattern already in `legacy/python/resume_builder/sources/github.py`.

## 9. Open / deferred

- Exact thinness heuristic threshold (tune against real fixtures).
- Deep-mode UX surface (end-user toggle vs developer/CLI) — decided by the consuming pipeline, not P2.
- Token-cap default value — start ~3k, revisit with real measurements.
- The user requested a **working test ("test mo lang if working")** of the structure-detection + a
  later reverse-prompt; tracked for the implementation plan, not the design.
