# Department 05 — Web / SaaS ("CareerLens")

> **Functional module:** the browser-facing prototype that wraps the CLI pipeline in a UI, with
> OAuth identity and assisted social-login.
> **One-line mandate:** make the engine usable from a browser — without reinventing the engine.

📊 Diagram: [`web-saas.puml`](web-saas.puml)

---

## What this department is responsible for

The future product surface, branded **CareerLens**. It is a thin-ish FastAPI layer that:

1. Serves the prototype UI (landing, prototype, developer scraping view, build form).
2. Handles **OAuth identity** (GitHub / Google / Microsoft) — `read:user`, `user:email`.
3. Drives **assisted social-login** jobs (kick off a visible-browser login, poll job status).
4. Exposes the **build** endpoint that calls Dept 01's `Pipeline`.
5. Hosts the **CDO Advisor** analysis endpoint (resume injection/compliance check).

> ⚠️ This is a **prototype**. There is **no user database, no billing, no rate limiting yet**.
> Those are the gaps to close if this becomes a real SaaS — flag them, don't silently fake them.

---

## Files owned

```
legacy/python/resume_builder/web/
├── app.py            # FastAPI routes (see endpoint map below)
├── auth.py           # WebAuthSettings — GitHub/Google/Microsoft OAuth
├── cdo_advisor.py    # resume analysis (injection / compliance)
├── mock_data.py      # prototype fixtures
├── dev_server.py     # local dev server
├── templates/        # Jinja2 HTML
└── static/           # CSS / JS
docs/web-auth-setup.md # OAuth client-ID setup guide
```

---

## Endpoint map (the public surface)

```
Pages
  GET  /                              landing
  GET  /prototype                     prototype UI
  GET  /developer/scraping            scraper dev view
  GET  /build-form                    build form
  POST /build                         → calls Dept 01 Pipeline.run()
  GET  /healthz                       liveness

Auth (identity)
  GET  /api/auth/status
  GET  /auth/{provider}/start
  GET  /auth/{provider}/callback
  POST /api/auth/disconnect/{provider}

Resumes + Advisor
  GET  /api/resumes
  POST /api/cdo/advisor/analyze       → cdo_advisor

Assisted social login
  POST /api/social-login/{vendor}            → starts a job (Dept 02 browser_login)
  GET  /api/social-login/jobs/{job_id}       → poll job status
  POST /api/social-login/{vendor}/disconnect
```

---

## Critical design rules

### 1. Don't fork the engine — call it
The web layer **must reuse** Dept 01's `Pipeline` and Dept 02's social-login flows. Do not
reimplement extraction, synthesis, or scraping here. `/build` is a thin adapter:
HTTP request → `BuildInputs` → `Pipeline.run()` → serve result.

### 2. OAuth is identity, not authorization-to-act
Scopes are `read:user` / `user:email`. Purpose: identify the user and pre-fill their social
login email. We are **not** acting on the user's behalf via OAuth. Keep it that way unless the
product explicitly decides otherwise.

### 3. Secrets via env only
OAuth client IDs/secrets come from settings/env (`WebAuthSettings`), never hardcoded. See
`docs/web-auth-setup.md`.

### 4. Async + long jobs
Social login is slow and interactive. It runs as a **job** (`POST` to start, `GET .../jobs/{id}`
to poll). Don't block a request thread on a browser login.

---

## Security checklist (this dept handles user input + auth — treat as sensitive)

- [ ] Validate all request bodies (pydantic) before use.
- [ ] OAuth `state` param checked on callback (CSRF on the OAuth flow).
- [ ] No secrets in code, logs, or templates.
- [ ] CDO Advisor input treated as untrusted (it's literally an injection check surface).
- [ ] File uploads (resume docs) size-limited and type-checked before handing to Dept 02.
- [ ] Error responses don't leak stack traces / internal paths.

---

## Dos & Don'ts

✅ Keep `app.py` thin — routing + adapting, delegate logic to Dept 01–04.
✅ Surface honest "not implemented yet" for missing SaaS pieces (accounts, billing).
✅ Reuse `get_renderer` / `Pipeline` exactly as the CLI does.

🚫 Don't duplicate pipeline/scraper logic in the web layer.
🚫 Don't expand OAuth scopes without a product decision.
🚫 Don't store sessions/secrets in the repo.

---

## Depends on

Wraps **Dept 01** (`Pipeline`), uses **Dept 02** (social-login/browser auth), and serves
**Dept 04** outputs. It sits on top of the whole stack.
