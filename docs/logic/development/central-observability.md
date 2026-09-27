---
logic_id: development.central-observability
code_paths:
  - observability.project.toml
tests:
  - tests/node/observability-project.test.mjs
feedback_events:
  - agent.prompt.started
  - agent.tool.completed
  - agent.prompt.completed
  - application.operation.succeeded
  - application.operation.failed
related_logic:
  - privacy-feedback.operational-events
---
# Central Observability

The checked-in project UUID is the stable local-development identity used by the shared Codex
observability hub. Repository remotes, paths, and display names are mutable aliases and must not
replace that identity.

The local hub correlates project, agent session, summarized prompt intention, execution attempt,
code version, and structured events. Runtime errors may resolve through code-version attribution to
the prompt that produced the relevant change. The shared hub is development infrastructure only;
it does not replace the product's authenticated `operational_events` privacy boundary.

Raw prompts, credentials, cookies, tokens, private payloads, unrestricted tool output, scraped text,
DOM, and screenshots must not enter central telemetry. Prompt hooks retain only an HMAC and a
bounded Taglish intention/result summary. Hub failure queues bounded events locally and must never
block application or agent work.

Detailed events retain for 30 days, compressed diagnostic payloads for 7 days, and aggregates for
one year. Project identity, prompt summaries, code attribution, and error fingerprints are durable
context. Physical tables are shared and keyed by project UUID; never create one table or schema per
project.
