# Indeed event watcher

`tools/job_finder/indeed_event_watcher.mjs` is a dependency-free Node.js daemon that attaches to
the normal user-approved Chrome CDP session. It does not poll page content. Chrome navigation,
click, input, change, and DOM-mutation events enqueue a coalesced microtask.

The daemon learns exact job identity from a visible `au.indeed.com/viewjob` or
`ca.indeed.com/viewjob` page and carries that identity across same-tab navigation or a popup.
It reads visible labels (not raw descendant text) and rejects oversized or CSS-contaminated
company/title snapshots, waiting for a clean rendered identity before binding the task.
By default the watcher is confirmation-only and never starts the Python application runner. When
explicitly started with `--auto-open-apply`, it observes an actual user click on a visible, enabled
`Apply with Indeed`, `Apply now`, or `Apply on company site` control. It does not synthesize a second
click. Routing is based only on the resulting browser destination: `smartapply.indeed.com` enters
the Indeed flow, while a settled non-Indeed domain is queued as an `external_application` under
`human_intervention`. Focus, mutation, input, and unrelated page clicks never trigger this flow.
External pages are not parsed or filled with Indeed selectors.

The watcher never blocks or repeats the user's click. `--max-tabs` (default `6`) remains the ceiling
passed to the deterministic runner for automation-owned pages; it does not close a user-opened
external tab.
The source target/opener relationship correlates same-tab and popup destinations to the exact job.
Transient `about:blank` and redirect URLs are allowed to settle before classification, and queue
identity keeps repeated observations idempotent.

## Automatic continuation after human verification

The watcher can bridge a clear Smart Apply page into the deterministic Python form runner. This is
an explicit opt-in: pass `--auto-open-apply`, `--resume-runner`, `--artifact-dir`, and phone-country
arguments. The
mapped manifest job must contain `target_country`, `work_mode`, and `resume_file`; live title text
alone is intentionally insufficient.

On a clear `smartapply.indeed.com` module, the watcher writes a one-job manifest and starts one
bounded worker. Other verified targets queue behind the active worker, preserving the global
resource limit even when several pages clear together. Event bursts cannot start a second worker
for the same target and route. If a later module becomes blocked, the watcher clears that route
latch; completing the human verification causes the blocked-to-clear event to resume the worker.
When a worker stops for missing human-provided form data, it waits for the browser's committed
`change` event and retries automatically; individual keystrokes and field values are never sent to
the watcher or written to its log. Post-apply routes never launch a worker.

Final Submit remains a separate domain-scoped permission. Add `--autonomous-submit` only when the
runtime user has explicitly approved autonomous submission on Indeed. Without it, the bridge fills
the validated draft and stops at the final gate.

Sensitive contact data stays outside manifests and the reusable question bank. The Python runner
reads `PYTORCH_PH_VERIFIED_PHONE` from its private process environment when `--verified-phone` is
not supplied. The systemd unit loads it from `%h/.config/pytorch-ph/indeed-private.env`; keep that
file mode `0600` and never commit it.

Example:

```bash
node --no-warnings tools/job_finder/indeed_event_watcher.mjs \
  --manifest out/indeed-unattended/candidate-manifest-latest.json \
  --auto-open-apply \
  --resume-runner .venv/bin/python \
  --artifact-dir /path/to/reviewed/resume-artifacts \
  --phone-country-calling-code +63 \
  --phone-country-iso PH \
  --saved-phone-original-calling-code +63 \
  --autonomous-submit
```

An optional single-job manifest supplies identity once after a watcher restart when the application
page was already open. That fallback is persisted as consumed so it cannot label a later unrelated
application. It writes SQLite only when all three conditions hold:

1. the page host is `smartapply.indeed.com`;
2. the route ends in `/post-apply`;
3. visible text contains `Your application has been submitted` and no access blocker is present.

Cookie values, storage state, credentials, form values, and URL query values are never logged or
stored. The SQL operation is idempotent and retains the exact company/title duplicate policy.

Submission identity is normalized without collapsing distinct openings:

- `companies` stores one normalized company identity.
- `job_postings` stores many postings for that company and uses Indeed's non-secret `jk` job ID
  when the rendered Applied page exposes it.
- `job_title_aliases` preserves earlier or expanded titles for the same posting.
- `applications` remains the confirmation ledger and points to both the company and posting.

This means one company can own many jobs, while a renamed posting such as a title with an added
technology suffix reconciles in place instead of creating a second application. Query parameters
are still removed from stored source URLs; only the validated alphanumeric Indeed job ID is retained
as provider identity.

Run in the foreground:

```bash
node --no-warnings tools/job_finder/indeed_event_watcher.mjs \
  --manifest var/state/job-applications/binance-current-manifest.json \
  --max-tabs 6
```

The checked-in user-service unit is confirmation-only. It keeps the observer alive and reconnects
when the visible Chrome CDP session becomes available, but it cannot click Apply, launch a form
worker, or submit. Installation is still explicit:

```bash
mkdir -p ~/.config/systemd/user
cp config/systemd/indeed-event-watcher.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now indeed-event-watcher.service
```

Always make background state visible before and after changing it:

```bash
systemctl --user status indeed-event-watcher.service --no-pager
systemctl --user disable --now indeed-event-watcher.service
```

Do not add `--auto-open-apply`, `--resume-runner`, or `--autonomous-submit` to an enabled service
without a separate, explicit user decision acknowledging that it will mutate browser state in the
background. Prefer a foreground command or a bounded transient unit for application runs.

The watcher state contains only task identity, Chrome target IDs, and consumed manifest task IDs:
`var/state/job-applications/indeed-event-watcher.json`.
