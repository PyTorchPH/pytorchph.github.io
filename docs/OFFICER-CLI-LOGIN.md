# Officer CLI login

Scope: human login creates an origin-bound officer session; MCP reuses it without returning credentials.

    npm run officer -- login
    npm run officer -- login --method email --email YOUR_EMAIL
    npm run officer -- login --method google
    npm run mcp:officer

- Interactive login offers Email or Google. Non-interactive login requires an explicit method or email.
- Google opens the default browser, not an embedded webview. Existing Google Identity Services handles sign-in/account creation.
- Enter the terminal's eight-character code on the browser page and explicitly approve. Do not approve unsolicited requests.
- Existing officer/admin access is required; Google registration never grants officer privileges.
- SHA-256 PKCE binds polling to the initiating CLI. Approval expires after five minutes and is consumed once.
- Polling waits five seconds. Pending requests are process-local, capped at 64, and cleared by expiry or restart.
- Local session permissions and API-origin binding remain unchanged. Credentials/verifiers never appear in MCP results or diagnostic logs.
- Email registration remains on the portal registration page. Email CLI login accepts existing accounts only.
- Both the auth/cli API routes and portal/cli-login page must be released before browser login works in production.
- There is no fallback that imports browser cookies or enables human-raw mode.

## SQL content cleanup

- Schema, reference configuration and backfills remain versioned.
- Production migrations no longer embed personal position reservations, website profiles or event schedules.
- Website test data lives in backend/api/src/tests/fixtures/site-content.json and is synthetic.
- Startup reconciles only explicitly audited historical checksums for migrations 11, 27 and 30.
- Unknown/failed migrations still fail normal SQLx validation. Cleanup does not remove deployed database rows.
- Rewritten history changes commit IDs. Reconcile old worktrees deliberately; never push their old tip back.
- Force-pushing does not erase external clones, cached commits or Actions artifacts.

Sources: [Google native-app guidance](https://developers.google.com/identity/protocols/oauth2/native-app), [GitHub sensitive-data removal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository), [git-filter-repo](https://github.com/newren/git-filter-repo).
