# Local runtime data

`var/` is the single repository-local home for replaceable caches and durable local state. Only
this README is tracked; the child directories are ignored.

- `cache/`: rebuildable tool and dependency caches
- `environments/`: generated Python environments
- `state/`: SQLite databases, queues, manifests, and other durable local state
- `sessions/`: browser profiles and authenticated storage state; treat as secret-bearing
- `log/`: runtime logs
- `run/`: process IDs, sockets, and temporary coordination files
- `quarantine/`: short-lived recovery holding area before reviewed deletion

Use `PYTORCH_PH_VAR_ROOT` to relocate the whole tree. Human-reviewable screenshots, reports, and
exports remain under `out/`, configurable with `PYTORCH_PH_ARTIFACT_ROOT`.
