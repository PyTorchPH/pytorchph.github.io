---
logic_id: identity.nationwide-membership
code_paths:
  - frontend/contracts/identity/credential-shape.ts
  - frontend/features/identity/session/collect-credentials.tsx
  - frontend/portal/app/page.tsx
tests:
  - frontend/portal/tests/nationwide-membership.test.ts
feedback_events:
  - local_auth.session_created
  - local_auth.session_rejected
related_logic: []
---

# Nationwide membership

PyTorch Philippines serves learners, practitioners, researchers, educators, and contributors
throughout the Philippines, independently of any school affiliation.

- Login and registration accept a syntactically valid email from any domain. Input is trimmed;
  malformed addresses, weak passwords, mismatched confirmation, and missing consent remain invalid.
- Email-format validation never claims ownership verification. The Rust API email verification code establishes
  ownership; authentication errors remain visible without logging credentials.
- Removing the school-domain allowlist never grants membership, officer status, or administrative
  access. Existing server-side role checks, membership gates, and database RLS remain authoritative.
- Local synthetic accounts remain loopback-only; production and CI authenticate through the Rust API.
- PH uses its own package namespace, runtime paths, local session cookie, and `PYTORCH_PH_*`
  settings. Existing FIT runtime data, credentials, and deployment configuration are not copied.
- Public branding, signup instructions, and synthetic community examples do not imply school
  affiliation. Optional academic-evidence adapters describe their source, not membership eligibility.

Acceptance checks cover non-school addresses, malformed input, password/consent enforcement,
unchanged tier and host-based authorization decisions, and school-neutral public copy.
