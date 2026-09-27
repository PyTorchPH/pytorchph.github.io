# `job_finder/` — Reusable Job Listing Rules

This package is separate from the resume scraper and from the job-application
form filler. It learns reusable, machine-readable rules for job listing pages:

1. observe a rendered job-search/listing page,
2. build a compact DOM inventory,
3. ask an AI to emit strict JSON rules for this layout,
4. cache those rules by domain + layout fingerprint,
5. reuse the cached rules deterministically on later pages with the same layout.

The goal is token amortization: one model call per stable domain/layout, then
zero-token extraction for repeated runs.

This package only handles job discovery/listing extraction. Application form
analysis and form filling belong in `job_application/`.

## Routing

All routes pass the access gate before search or extraction:

1. Resolve the current hostname against the code-specific adapter registry.
2. For Indeed or JobStreet, execute the adapter's fixed rules only when they produce a valid
   deterministic result for the rendered layout.
3. If a known layout has drifted, discard the stale adapter result and use the bounded inventory +
   AI planning path.
4. Unknown sites enter the bounded inventory + AI planning path directly.
5. Cache accepted learned rules by `subdomain + layout fingerprint`; never share rules across
   domains just because their fingerprints collide.

`site_adapters.py` also builds strict search plans. Work mode is never inferred or substituted:

- Indeed `remote`: fill the location control with `remote` only when its live placeholder advertises
  remote support.
- Indeed `hybrid`: requires a separately observed filter; the remote placeholder is insufficient.
- JobStreet `remote|hybrid`: select the requested value only when it exists in the rendered
  work-mode options.
- `onsite`: requires an explicit location.
- `any`: adds no work-mode constraint.

Search plans contain ordered `fill`, `select_option`, and `click` steps. Browser execution remains
separate so callers can pause for human review before submission.

Country targeting uses a human-selected allowlist that is independent of contact data. A truthful
Philippines phone country code remains `+63`; it never selects or rewrites the job country. Every
target comes from repeated `--target-country` values and remote mode remains mandatory for this
policy. Philippines may be selected like any other country. Add `--foreign-only` only when the
human also wants to exclude the configured home country and aliases. Application batches may use
the same `CountrySelectionPolicy`, preventing a worker or site locale from silently replacing the
selected country.

## Live CDP development test

Use `tools/job_finder/cdp_tag.py` with a normal Chrome instance already opened with local CDP.
The human signs in and completes any verification. The harness then runs in two explicit phases:

```bash
python tools/job_finder/cdp_tag.py inventory --url "https://example.com/jobs?q=python"
# Development only: current-session AI writes strict rules.json from inventory.txt.
python tools/job_finder/cdp_tag.py apply --rules out/live-job-model/rules.json
```

`inventory` runs the access gate first and stops on sign-out, CAPTCHA, Cloudflare, 403/429, or other
verification. It saves only a sanitized DOM, compact inventory, access decision, and screenshot
under `/out/`; it never exports cookies or credentials. `apply` validates the domain + layout
fingerprint, executes the same rules used by the deterministic extractor, and writes
`annotated.html`, `annotated.png`, and strict JSON results.

For production-style model execution, use `api-plan`. It calls only the configured provider-neutral
HTTP model API; that endpoint may be remote or locally hosted:

```bash
python tools/job_finder/cdp_tag.py api-plan --preferences "remote Python roles"
```

Pass work arrangement separately so it remains a strict constraint rather than free-form text:

```bash
python tools/job_finder/cdp_tag.py api-plan --work-mode hybrid
```

For a reviewed multi-country remote run:

```bash
python tools/job_finder/cdp_tag.py api-plan \
  --target-country Australia --target-country Canada --work-mode remote
```

Add `--foreign-only --home-country Philippines --home-country-alias PH` only for a run where the
human explicitly wants Philippines excluded.
No command implements access-control bypass, fingerprint spoofing, proxy/identity rotation, or
CAPTCHA solving.
