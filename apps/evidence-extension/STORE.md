# Chrome Web Store listing — PyTorch PH Evidence Collector

## Single purpose
Lets a PyTorch PH member send evidence of their own work (their GitHub, LinkedIn or Facebook profile) to the PyTorch PH member portal, attach a screenshot of the portal page to a bug report they file, and run the portal's AI features with their own AI provider key kept only in their browser.

## Permission justifications
| Permission | Why it is needed |
|---|---|
| `tabs` | Opens a background tab on the member's own profile (`github.com/`, `linkedin.com/in/me/`, `facebook.com/me`) to read which account is signed in and collect that profile; the tab is closed right after. Also finds the source tab for manual collection. |
| `activeTab` | Screenshot of the portal tab when the member ticks "attach screenshot" in a bug report. |
| `storage` | Keeps the member's own AI connection (provider, model, endpoint, API key) in `chrome.storage.local` on this device. No browsing data is stored. |
| Host `github.com`, `*.linkedin.com`, `*.facebook.com` | Runs the collector content script that reads the member's own profile text on request. |
| Host `pytorch.ph`, `*.pytorch.ph` | Runs the portal bridge content script and allows `tabs.captureVisibleTab` on the portal page only. |
| Host `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`, `openrouter.ai` | Sends the member's AI requests, with their own key, to the AI provider they chose (Google Gemini, Anthropic, OpenAI, OpenRouter). |
| Optional host `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Requested only from the extension popup, for the one custom endpoint the member configures (OpenAI-compatible server, Azure, Ollama, other). Never granted by default. |

## Data use disclosure
- Collects page text only from the member's own signed-in profile, and only when the member presses "Verify" or "Sync my profile" in the portal. The signed-in account is re-checked before every collection; a different profile is refused.
- Takes a screenshot only of the PyTorch PH portal tab, only when the member ticks "attach screenshot" in a bug report.
- Sends collected evidence and screenshots only back to the PyTorch PH portal page that asked for it; keeps no copies and never reads passwords, cookies or messages.
- The AI API key is stored only in `chrome.storage.local` and sent only to the AI provider the member chose, in requests the member starts in the portal. It is never returned to web pages and never sent to PyTorch PH servers. "Remove AI key" in the popup deletes it.
- Stops and hands control back to the member at login walls, CAPTCHAs, checkpoints and rate limits.

## Upload steps
1. `npm run package --workspace @pytorch-ph/evidence-extension` → `apps/evidence-extension/dist/pytorch-ph-evidence-collector-<version>.zip`.
2. Chrome Web Store Developer Dashboard → Items → Upload new item (or Package → Upload new package for an update) → choose the zip.
3. Store listing: use this file's single purpose and data-use text; 128px icon is `icons/icon-128.png`; add at least one 1280×800 screenshot of the portal's Settings → connected accounts.
4. Privacy practices: declare "Website content" and "Authentication information" (the member's own AI API key, stored locally and sent only to their chosen AI provider); certify data is used only for the single purpose and not sold or transferred.
5. Submit for review. Bump `version` in `manifest.json` and `package.json` for every update.
