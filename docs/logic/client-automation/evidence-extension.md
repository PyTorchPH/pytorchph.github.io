---
logic_id: client-automation.evidence-extension
code_paths:
  - apps/evidence-extension
  - domains/client/client-automation
tests:
  - apps/portal/tests/extension-contracts.test.ts
  - tests/node/logic-doc-contracts.test.mjs
feedback_events:
  - extension.detected
  - extension.missing
  - scrape.blocked
  - scrape.preview_ready
  - scrape.failed
related_logic:
  - career-evidence.ingestion
  - privacy-feedback.operational-events
---
# Client Evidence Extension

The MV3 extension supplies browser access; it is never an evidence authority. The portal detects a
versioned bridge automatically, but a missing extension disables only scraper-dependent components.
Manual evidence, Resume Studio, and the manually reviewable Opportunities workspace remain
available. Their navigation and data reads never inherit the scraper capability gate.

Collection uses the user's normal visible session. Classify access before inventory and stop for
login, CAPTCHA, verification, Cloudflare, 403/429, or low confidence. Never capture credentials,
cookies, storage state, or raw HTML. Facebook and LinkedIn collect own posts or an explicitly opened
evidence link. GitHub is website-first and uses a runtime username.

Accepted rules are strict JSON and cached only by exact subdomain plus layout fingerprint. Replay is
deterministic. The user sees the normalized items and source links before submitting them.
