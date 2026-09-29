# API deployment

Target: Ubuntu 24.04, `api.pytorch.ph`, systemd service, Caddy reverse proxy, SQLite WAL at `/var/lib/pytorch-ph-api/portal.db`.

Install Caddy using `install-caddy.sh` on the VPS, then copy `Caddyfile` to `/etc/caddy/Caddyfile` and validate with `caddy validate --config /etc/caddy/Caddyfile` before reloading. Caddy's automatic HTTPS requires public inbound ports 80 and 443. Source: https://caddyserver.com/docs/install and https://caddyserver.com/docs/automatic-https.

Required `/etc/pytorch-ph-api.env` settings:

```text
DATABASE_URL=sqlite:///var/lib/pytorch-ph-api/portal.db
APP_BIND=127.0.0.1:8787
ALLOWED_ORIGIN=https://pytorch.ph
APP_PUBLIC_ORIGIN=https://api.pytorch.ph
GOOGLE_CLIENT_ID=<Google OAuth client ID, or unconfigured until available>
BOOTSTRAP_ADMIN_EMAIL=<verified Google admin email, or unconfigured@example.invalid>
EMAIL_CODE_SECRET=<random 32+ byte value, private>
MAIL_RELAY_URL=https://<relay host>:443/<send path>
MAIL_RELAY_TOKEN=<private bearer token>
```

`MAIL_RELAY_*` may be omitted together. In that case `POST /auth/email/start` returns 503; no verification email is sent. The API POSTs JSON `{ "to": "address", "subject": "text", "text": "message" }` with `Authorization: Bearer <token>` over HTTPS port 443. The relay must return a 2xx response with JSON `{ "accepted": true }`; any other response fails closed. Configure a verified sender on the relay side. Do not expose this environment file in source control or logs.

The two temporary test accounts are seeded only when `SEED_TEMP_TEST_ACCOUNTS=true` and `TEMP_TEST_PASSWORD` are set during startup. Set the password to the approved temporary value in the private environment file, then remove both settings after the first successful start so later account deletion is durable. The seeder creates `member@admin.ph` as `member` and `officer@admin.ph` as `officer`. They bypass email verification only for the explicitly approved production test.

Before deploying a new binary or migration, back up the SQLite database using its online backup API or `sqlite3 .backup` and preserve the prior binary. Check `GET /health`, role-specific `/auth/me`, and the Postman smoke folder. Roll back by stopping the service, restoring the prior binary and compatible database backup, and restarting. Never roll back a migrated database with an older binary without the matching backup.

The public Pages build sets both `NEXT_PUBLIC_AUTH_API_ORIGIN` and `NEXT_PUBLIC_API_ORIGIN` to `https://api.pytorch.ph`. Login/signup, officer competitive events, entrants, results, attendance import, mail drafts, officer evidence review, and member evidence submission use the Rust API. Authenticated legacy portal views use `/portal/api/*` with member-scoped synthetic state in SQLite; shared external events and feedback use the organization scope. Uploaded demo JPEGs use owner-only `/portal/media/{id}` reads. The seeded fixtures and static AI responses remain synthetic and must not be represented as real member records or live AI output. AI provider settings are intentionally rejected until separately configured. `POST /api/job-market/refresh` remains disabled because ingestion is controlled by the backend.

`postman/PyTorch-PH.postman_collection.json` covers all Rust routes, including the portal gateway and media read. Its opt-in member/officer write workflow persists marked synthetic records and verifies role boundaries; the manual portal folder tests additional synthetic writes. `deploy/smoke-officer-member.py` can exercise the deployed core API on loopback without exposing test passwords; it creates a verified SQLite backup first, uses disposable sessions for the existing temporary accounts, and revokes those sessions in `finally`. It leaves marked event and evidence rows for inspection. Production core smoke on 2026-09-29 passed 20 bounded checks; backup: `/var/lib/pytorch-ph-api/backups/portal.before-officer-smoke.20260929T091515Z.db`.

An authenticated request, including the demo fixture fetch, renews a valid session through the end of the seventh UTC calendar day after the request. The API updates SQLite and returns a matching `Secure; HttpOnly; SameSite=Lax` cookie with `Expires` and `Max-Age`; an expired session is never renewed. Browser requests must use `credentials: "include"`. Existing unexpired sessions renew on their next request without a database migration.

The portal entry and login page check `GET /auth/me` before displaying sign in. A valid member session opens the member demo view; an officer/admin session opens the officer demo view. `POST /auth/signout` requires the portal `Origin`, deletes the server-side session, and expires the cookie. The Pages demo also clears its fictional audience selection. An API error leaves sign in available and never treats a browser-stored demo choice as authentication.

Measured latency and the bounded public benchmark procedure are in `../docs/PERFORMANCE.md`.
