# Extension AI boundary

Status: local provider configuration and portal bridge exist. The target narrows configuration and
adds per-request consent for email drafting.

## Ownership

- `local-ai.ts`: validate provider configuration, store the key in `chrome.storage.local`, and call
  the selected provider.
- `popup.ts`: the only UI allowed to create/change/clear provider, model, endpoint, and API key.
- `portal-bridge.ts`: accept allowlisted status/completion requests; do not accept raw key/config
  values from the page after migration.
- `background.ts`: enforce user gesture, request nonce, origin, size, timeout, and response bounds.

## Security contract

- The API key never leaves extension storage except in the request to the selected provider.
- The website/backend never receives, logs, or synchronizes the key.
- Restrict bridge messages to the production/dev portal origins and a closed action/type schema.
- Before every email generation, show provider, model, endpoint host, and the exact bounded/redacted
  context; require explicit confirmation.
- Reject background requests without a fresh nonce, permitted tab/origin, or officer-triggered action.
- Never grant send authority or execute a returned command. Return text/structured draft content only.

## Audit response

Return provider identifier, model identifier, prompt-policy version, request ID, and generated text.
Do not return the key, authorization headers, provider raw logs, or unnecessary response metadata.
The portal stores the accepted result as an AI-labeled draft revision; the normal human confirmation
and hierarchy gates remain authoritative.

## Tests

Cover provider validation, local storage, key non-disclosure, allowlisted origins, malformed bridge
events, replayed nonces, per-request preview/denial, provider timeout/error/redaction, maximum context
size, and confirmation that no website configuration path can overwrite the extension secret.
