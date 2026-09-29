# Org Activity Operations Layer — approved pilot specification

> **STATUS: v1 pilot implementation in human review.** The pipeline decisions in §8b are approved.
> The official SADO document template, production Gmail credentials/recipient rules, and any real
> external send remain separately blocked and human-gated.

This layer extends the PyTorch PH System from a personal career platform into an **operations
platform for the PyTorch Philippines chapter** — running the org's real activities (emails,
documents, posting, officer accountability).

---

## 1. Activity / documentation taxonomy

All documentation is organized by **category × audience scope**:

| Category | Internal | External |
|---|---|---|
| Events | ✓ | ✓ |
| Workshops | ✓ | ✓ |
| Hackathons | ✓ | ✓ |
| Competitive Programming | ✓ | ✓ |

- **Internal** = for officers/members of the chapter.
- **External** = for outside parties (partners, sponsors, other orgs, the public).
- Each document is tagged with `category` + `scope` so pipelines route correctly.

```mermaid
flowchart TD
    Doc[Document] --> Cat{Category}
    Cat --> E[Events]
    Cat --> W[Workshops]
    Cat --> H[Hackathons]
    Cat --> C[Competitive Programming]
    E & W & H & C --> Scope{Scope}
    Scope --> Int[Internal]
    Scope --> Ext[External]
```

---

## 2. Intake → pipeline trigger

**Anyone** can start a pipeline by submitting a link or details about an (e.g. external) event.

```mermaid
flowchart LR
    Anyone[Any member submits link/details] --> Intake[Intake form/endpoint]
    Intake --> Classify[AI: classify category + scope]
    Classify --> Route[Route to the right pipeline]
    Route --> DocPipe[Document pipeline]
    Route --> EmailPipe[Email pipeline]
    Route --> PostPipe[Posting pipeline]
```

Open question: who can submit (any member vs authenticated only), and what's the minimum payload
(just a URL? URL + notes?).

---

## 3. Document injector (scaffold needed)

Generate documents from structured data — **JSON or SQL** (the platform will have a database) —
into a **user-provided template**.

- Input: a record (JSON now; SQL rows once the DB exists) + a template.
- Output: a rendered document (format TBD — DOCX? PDF? Google Doc? — awaiting template).
- This mirrors the legacy `renderers/` pattern (data + template → file), now for org docs.

> **Blocked on:** the template the user will provide. Until then, scaffold only the injector
> shape (input schema + template slot + renderer interface), not the concrete template.

---

## 4. Email pipeline (HITL required)

Pipelined sending of emails tied to activities.

```mermaid
flowchart LR
    Trigger[Activity / intake] --> Draft[AI drafts email]
    Draft --> Recipients[Resolve WHO to email]
    Recipients --> Review[[Human validator confirms]]
    Review -->|approve| Send[Send]
    Review -->|edit| Draft
```

- **AI only drafts/generates** — a human **must confirm before send** (hard gate).
- Needs a way to determine **recipients** ("kung sino-sino ang ee-email") — per category/scope,
  or derived from the intake submission.
- Open: which email surface (Gmail API already connected? org mailing lists?).

---

## 5. Social posting pipeline (Facebook page)

Pipelined posting to the chapter's **Facebook page** — e.g. "happening now" announcements.

```mermaid
flowchart LR
    Event[Activity update] --> Gen[AI drafts post + media]
    Gen --> Approve[[Human validator confirms]]
    Approve -->|ok| Post[Publish to FB page]
```

- Same principle: **AI generates, human validates** before publishing.
- Open: FB Page Graph API access + page token; reuse anything from the legacy scraper? (No —
  posting needs the Pages API, different from scraping.)

---

## 6. Officer scoring / accountability

Score officers on the tasks they complete.

- **Speed**: how fast they respond / close a task.
- **Quality**: **vote-based** (peers/officers vote), not auto-judged by AI.
- Ties into the board: a "Done" task by an officer feeds their score.
- Open: scoring formula, who can vote, anti-gaming, visibility (private vs leaderboard).

---

## 7. Human-in-the-loop principle (reaffirmed)

> The AI **only generates and eases document/communication work**. It never sends an email,
> publishes a post, or finalizes a quality score on its own. A human validator confirms:
> - every **email** before send,
> - every **quality** score (vote-based).

---

## 8. Open questions to resolve before building

1. Document **template(s)** + target output format(s). *(user will provide)*
2. Email surface (Gmail API / org mail) + recipient resolution rules.
3. Facebook **Page** API access + token for posting.
4. Intake: who can submit, minimum payload, auth.
5. Officer scoring formula + voting rules + visibility.
6. "meron pa" — remaining requirements from the user.

---

## 8b. CONFIRMED pipeline design (v1) — reverse-prompted & approved

> Locked with the user. Decisions below drive the eventual build.

**The flow (corrected — RAG = ingest the submitted link, not classify):**

```mermaid
flowchart TD
    A[Member submits a LINK or details<br/>e.g. a competition to join] --> B[Ingest / RAG:<br/>extract + understand the link's context]
    B --> C[Router: configurable rules table<br/>doc type + scope -> required departments]
    C --> D[Per-department brief generator:<br/>compacted context + prompt PER paper<br/>e.g. secretary: to whom + what content]
    D --> E[Each department/officer generates<br/>+ finalizes its paper AI-assisted]
    E --> F[Approval middleman dispatches to<br/>all required departments in PARALLEL]
    F -->|all must approve - unanimous| G[Approved]
    F -->|edit/reject| D
    G --> H[Auto-trigger downstream:<br/>email + FB posting pipelines]
    H --> I[[each still has its own HITL<br/>confirm before send/post]]
```

**Locked decisions:**

1. **Ingestion (RAG):** the AI's RAG step is to **read the submitted link** (e.g. a competition
   page) and extract its context — sometimes this is needed because it must be endorsed/approved
   by community officers. RAG is *content ingestion*, not pipeline classification.
2. **Per-department brief generation:** using that context, the system produces a **compacted
   brief + prompt for each concerned department / each paper** (e.g. the secretary gets: for whom
   the paper is, what its content should be). Officers still generate/finalize the actual papers,
   AI-assisted.
3. **Routing source = configurable rules table** (admin-editable: doc type/scope → required
   approvers). Changeable without a code change.
4. **Approval semantics = parallel, unanimous** — all required departments see it at once and
   ALL must approve before proceeding.
5. **Post-approval = auto-trigger downstream** (email + FB posting), but **each downstream action
   keeps its own HITL** confirm before send/post.

**Code shape (separation of concern):**
- `LinkIngestor` (RAG over the submitted URL/details) → `ActivityContext`
- `DepartmentBriefGenerator` → per-department `{recipient, required_content, draft}`
- `RoutingRules` (config/DB table) → `required_departments`
- `ApprovalMiddleman` + registry of `DepartmentApprover` (secretariat, treasurer, …) — parallel dispatch, collect verdicts
- Downstream `EmailSender` / `Poster` behind interfaces, each HITL-gated

### 8c. Officer operations review slice (ORG.19)

This is a bounded, reviewable increment of the confirmed pipeline rather than the whole ORG v1
implementation. It covers feedback triage, evidence-claim review, and external-event intake through
SADO proof. Configurable routing administration, department briefs/documents, recipient discovery,
and Facebook publishing remain separate backlog work.

External-event intake is available to authenticated members. A member supplies a public event URL;
the loopback FastAPI companion opens it in a normal visible browser, stops on access verification or
login, and asks the configured provider-neutral HTTP model to extract a strict JSON package. The
package is a proposal, not approval. Publishing it creates an event labelled **Not SADO approved**.

```mermaid
stateDiagram-v2
    [*] --> NotSadoApproved: member publishes validated JSON
    NotSadoApproved --> DepartmentReview: first required department approves
    DepartmentReview --> EmailReview: every required department approves this revision
    EmailReview --> SubmittedToSado: Gmail receipt or officer-confirmed manual delivery reference
    SubmittedToSado --> SadoApproved: officer records a SADO response reference
```

- Required departments come from the category + scope routing rules. Each department has one vote
  per revision; repeat approval is idempotent. Every required department must approve.
- The schema is revision-ready; event editing and approval invalidation UI remain follow-up work.
  This slice does not generate department papers.
- `copy_export` is the default mail mode. It freezes and exports the reviewed immutable draft
  without contacting an external provider. A separate manual-delivery reference is required before
  the event is marked submitted.
- `gmail` is opt-in. It requires configured credentials and an allowlisted SADO recipient, stores an
  idempotency key/provider receipt, and never marks an ambiguous or failed request as delivered.
- `sado_approved` requires a human-entered response reference. Email delivery alone is not approval.
- Manual evidence claims are approved only by the responsible department against the exact content
  hash. Scraped evidence needs deterministic provenance; AI output alone is never verified evidence.
- Feedback diagnostics remain allowlisted and privacy-bounded. Only officers can assign, prioritize,
  resolve, or dismiss reports; every material workflow change is audited.

Runtime configuration for this slice:

| Setting | Meaning |
|---|---|
| `NEXT_PUBLIC_PYTORCH_PH_LOCAL_COMPANION_URL` | Loopback FastAPI origin; defaults to `http://127.0.0.1:8000` in development |
| `PYTORCH_PH_EVENT_MAIL_MODE` | `copy_export` (default) or `gmail` |
| `PYTORCH_PH_SADO_EMAIL` | Single allowlisted SADO recipient used by Gmail mode |
| `PYTORCH_PH_GMAIL_ACCESS_TOKEN` | Server-only Gmail access token; never returned to the client |

All four settings are deployment configuration, not user-submitted values. Gmail mode must remain
disabled until chapter leadership verifies the sender account and recipient.

## 9. Folder rename note

User wants the local folder renamed to **`pytorch`**. This can't be done safely from inside the
running session (Windows locks the current working directory). Steps for the user — see the chat
summary; the GitHub repo is already `pytorch-ph-system`.

---

## 10. Points · Leaderboard · Merit & Growth — CONFIRMED (v1)

> ✅ **STATUS: CONFIRMED** with the user. This belongs to the **Org-Ops layer** and is tied to the
> chapter activity pipeline (§8b). It sits on top of the platform's analytics layer
> (SPECIFICATION §5 Layer 5: `leaderboards` · `career_scores`). Detailed engine spec lives in
> [`POINTS-ENGINE.md`](POINTS-ENGINE.md).

### 10.1 What this is (and is NOT)

The chapter runs **two parallel tracks** off the same points data — and they are deliberately
*not* the same thing:

| Track | Nature | Audience | Goal |
|---|---|---|---|
| **Leaderboard (Merit)** | **Cut-throat competition** — raw points, head-to-head ranking | Everyone, top achievers surfaced | Decide who wins **opportunities** (slots, endorsements, competition seats) |
| **Growth Track** | **Diagnostic / recommendation engine** — NOT a competing ranking | The **low-point bracket** | Show each student which lessons/events/hackathons will help them *climb* |

> **Framing (lock this, kasi madaling ma-misread):** this is **merit competition for opportunities
> + a development pathway for everyone else**. It is explicitly **NOT equity-by-points** — walang
> points redistribution, walang handouts. The org gives everyone the *chance* to grow; the actual
> opportunities are still **awarded to high-pointers** on raw merit.

### 10.2 Where points come from

Members earn points from **achievements, grades, and projects** (the highest-priority signals),
plus a **referral system** (points for referring others). Priority among signals is expressed as a
**priority queue (heap)** — achievements/grades/projects float to the top.

```mermaid
flowchart TD
    subgraph Sources[Point sources]
        ACH[Achievements]
        GRD[Grades]
        PRJ[Projects]
        REF[Referrals]
    end
    ACH & GRD & PRJ --> PQ[[Priority queue / heap<br/>highest-priority signals first]]
    REF --> PQ
    PQ --> SCORE[Member points total<br/>career_scores]
    SCORE --> LB[Leaderboard — cut-throat merit]
    SCORE --> GT[Growth track — diagnostic only]
```

### 10.3 Leaderboard → clustered opportunity graph

The leaderboard connects to a **clustered graph**. Each **cluster** is a domain (academics,
tutorial, competitive programming, etc.) and points at **tangible projects/competitions** a member
can choose from. Ranking ties are broken by a dedicated **tiebreaker node** concept.

```mermaid
flowchart TD
    LB[Leaderboard ranking<br/>raw points, head-to-head] --> TIE{Tie?}
    TIE -->|yes| TB[[Tiebreaker node<br/>secondary criteria]]
    TIE -->|no| RANK[Final rank]
    TB --> RANK
    RANK --> CG[Clustered graph]
    CG --> C1[Cluster: Academics]
    CG --> C2[Cluster: Tutorial]
    CG --> C3[Cluster: Competitive Programming]
    C1 & C2 & C3 --> OPP[Tangible projects /<br/>competitions to choose from]
```

### 10.4 Growth track — pretest vs posttest GAIN

The growth track is a **recommendation engine** for the low-point bracket. It uses **GAIN** — a
member's points **before** an activity vs **after** (pretest → posttest) — to diagnose which
**lessons, events, and hackathons** that specific student needs to climb toward the high-point
level. It never ranks students against each other.

```mermaid
flowchart LR
    PRE[Pretest points<br/>before activity] --> GAIN[Compute GAIN<br/>= posttest - pretest]
    POST[Posttest points<br/>after activity] --> GAIN
    GAIN --> DIAG[Diagnostic engine]
    DIAG --> REC[Recommend lessons /<br/>events / hackathons]
    REC --> CLIMB[Pathway toward<br/>high-point level]
```

### 10.5 Entry / ingestion — link → structured JSON package

A member submits a **LINK**; an **ingestion step (RAG/scrape)** turns it into a structured JSON
**"package"** that flows through the pipeline (same shape as the activity pipeline in §8b). The
scraper can be **deterministic** (regex/rules) or **non-deterministic** (AI/LLM) — this mirrors the
legacy engine's `static` vs `ai` modes (`backend/legacy-python/resume_builder/models.py` `Mode.STATIC` / `Mode.AI`).

```mermaid
flowchart LR
    L[Member submits LINK] --> ING{Ingestion mode}
    ING -->|deterministic| DET[Regex / rules scraper<br/>= legacy 'static' mode]
    ING -->|non-deterministic| AI[AI / LLM scraper<br/>= legacy 'ai' mode]
    DET & AI --> PKG[Structured JSON package]
    PKG --> PIPE[Points pipeline →<br/>achievement / project credit]
```

> Detail and code shape: [`POINTS-ENGINE.md`](POINTS-ENGINE.md). Personal-achievement scraping
> (Facebook/GitHub) runs **client-side** — see [`CLIENT-SCRAPING.md`](CLIENT-SCRAPING.md).

### 10.6 Email invites driven by points/segments

Points and segments drive **AI-drafted email invites** to events. A guest who responds becomes a
**candidate participant**. The **HITL gate from §4 still applies** — AI drafts, a human confirms
before anything is sent.

```mermaid
flowchart LR
    SEG[Points / segments] --> DRAFT[AI drafts invite email]
    DRAFT --> HITL[[Human validator confirms<br/>see §4 hard gate]]
    HITL -->|approve| SEND[Send invite]
    SEND --> RESP{Guest responds?}
    RESP -->|yes| CAND[Candidate participant]
```

### 10.7 Open questions / blocked-on

1. **Point weights & formula** — exact weight per source (achievement vs grade vs project vs
   referral); how grades map to points without leaking private grade data (cross-ref
   SPECIFICATION §6 privacy).
2. **Heap priority semantics** — is the priority queue for *display ordering*, *processing order*,
   or *tie-influence*? Confirm with user.
3. **Tiebreaker criteria** — what the tiebreaker node actually compares (recency? gain? referrals?).
4. **Cluster taxonomy** — final list of clusters and how a cluster maps to concrete opportunities.
5. **Growth bracket cutoff** — what point threshold defines the "low-point bracket".
6. **Pretest/posttest capture** — how/when points are snapshotted around an activity to compute GAIN.
7. **Referral anti-gaming** — preventing self-referral / fake-account farming.
8. **Opportunity awarding** — is awarding to high-pointers automatic or officer-confirmed (HITL)?

## 11. Reports, evidence authority, and external-event pilot

The current web pilot adds three connected operational loops:

- Officers use `/reports` to search, filter, paginate, inspect, assign, and transition privacy-safe
  member/officer reports. Members may view only their own receipts. Report diagnostics exclude raw
  HTML, form values, cookies, tokens, cache contents, screenshots, and full stack traces.
- AI may extract Facebook/LinkedIn evidence, but only deterministic server provenance checks or an
  authorized officer from the responsible department can make a claim leaderboard-eligible. Editing
  verified content creates a new manual revision; it never inherits verification.
- Members and officers may submit an external event link to the localhost companion. It uses a
  normal visible browser, stops at access challenges, returns a strict JSON package, and publishes
  the reviewed package as **Not SADO approved**. Required departments approve in parallel. Email is
  sent only after exact-payload human approval and configured credentials. Successful delivery means
  `submitted_to_sado`; only a separately recorded SADO response/reference means `sado_approved`.

The standalone developer inspector is `/developer/event-pipeline`. It validates and normalizes event
JSON without placing development controls in product navigation.
