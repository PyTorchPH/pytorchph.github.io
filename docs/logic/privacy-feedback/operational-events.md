---
logic_id: privacy-feedback.operational-events
code_paths:
  - domains/protocol/privacy-feedback
  - domains/server/privacy-feedback
  - domains/client/privacy-feedback
tests:
  - apps/portal/tests/operational-events.test.ts
  - apps/portal/tests/trust-center.test.ts
feedback_events:
  - operation.succeeded
  - operation.stopped
  - operation.failed
related_logic:
  - client-automation.evidence-extension
---
# Operational Events

Minimal allowlisted lifecycle events are automatic so silent failures remain observable. Detailed
redacted messages and component markers require the existing automatic-error-report opt-in. Manual
reports remain available and may share a correlation ID with an operational event.

Never collect raw DOM, scraped text, form values, screenshots, credentials, cookies, tokens, full
stack traces, or storage contents as telemetry. Use a bounded local queue, idempotent event IDs,
deduplication, exponential backoff, and recursion protection. Record success and stop outcomes as
well as failures, and retain operational rows for no more than 30 days.
