# Prefect operations for beginners

Run `npm run dev`, then use the in-dashboard **Start tour** button. The dashboard is built from the
pinned Prefect 3.8.3 source and served only by the local Process Lab.

| Section | Meaning in this project |
|---|---|
| Runs | One execution, with states, logs, timing, retries, and its DAG. |
| Flows | Reusable workflow definitions, including the major member experience. |
| Work Pools | The local process executor. |
| Work queues | `interactive`, `pipeline`, and `diagnostics` priority lanes. |
| Blocks | Typed local endpoints and the non-secret safety policy. |
| Variables | Non-secret defaults such as safe mode and page limits. |
| Concurrency | Collision limits for browsers, model planning, scraping, API reads, and artifacts. |
| Automations | Failure events that trigger bounded diagnostics. |
| Event Feed | Sanitized route, artifact, flow, and human-gate activity. |

Configuration is idempotent. Restarting the workspace updates Process Lab-owned resources without
requiring developers to re-enter them. The local seed creates accounts once; login never signs up a
new account.

If the Prefect patch no longer matches the pinned commit, the build fails instead of modifying an
unknown upstream UI. Remove only `var/cache/process-lab/prefect-ui-source` to rebuild the recoverable
checkout from the tracked patch.

The dashboard tour does not alter Prefect Cloud and is not shipped with the member/officer portal.
