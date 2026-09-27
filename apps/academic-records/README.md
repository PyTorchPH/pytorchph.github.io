# FEU Tech grades integration

Thin command app for the deterministic FEU SOLAR integration. Shared record shapes live in
`domains/protocol/career-evidence`; scraping, calculation, and injection logic live in
`domains/server/career-evidence/academic-records`.

- `session-login.ts`: visible, human-completed authentication and session persistence.
- `run.ts`: headless scrape using the fixed FEU SOLAR adapter.
- `inject-run.ts`: opt-in injection of provenance-bearing academic highlights.
- No LLM or DOM-learning planner is used because FEU SOLAR is a known integration.

If authentication expires, the headless scraper stops with `FeuSessionRequiredError`. Refresh the
legitimate Playwright storage state visibly, then rerun headlessly. Verification is never bypassed.

`session-login.ts` attaches to a user-visible Chrome/Chromium instance through Chrome DevTools
Protocol (`CHROME_CDP_URL`, default `http://127.0.0.1:9222`) and saves storage state after the
legitimate Microsoft/FEU login completes. Its default state path is
`var/sessions/feu-solar/storage-state.json`.

Run the entry points through the root `grades:*` workspace scripts. `run.ts` writes a normalized,
reviewable snapshot under `out/` by default.
