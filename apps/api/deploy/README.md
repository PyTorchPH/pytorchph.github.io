# API deployment

Target: Ubuntu 24.04, `api.pytorch.ph`, systemd service, Caddy reverse proxy, SQLite WAL at `/var/lib/pytorch-ph-api/portal.db`.

Install Caddy using `install-caddy.sh` on the VPS, then copy `Caddyfile` to `/etc/caddy/Caddyfile` and validate with `caddy validate --config /etc/caddy/Caddyfile` before reloading. Caddy's automatic HTTPS requires public inbound ports 80 and 443. Source: https://caddyserver.com/docs/install and https://caddyserver.com/docs/automatic-https.

Required `/etc/pytorch-ph-api.env` settings:

```text
DATABASE_URL=sqlite:///var/lib/pytorch-ph-api/portal.db
APP_BIND=127.0.0.1:8787
ALLOWED_ORIGIN=https://pytorch.ph
GOOGLE_CLIENT_ID=<Google OAuth client ID, or unconfigured until available>
BOOTSTRAP_ADMIN_EMAIL=<verified Google admin email, or unconfigured@example.invalid>
EMAIL_CODE_SECRET=<random 32+ byte value, private>
MAIL_RELAY_URL=https://<relay host>:443/<send path>
MAIL_RELAY_TOKEN=<private bearer token>
```

`MAIL_RELAY_*` may be omitted together. In that case `POST /auth/email/start` returns 503; no verification email is sent. The API POSTs JSON `{ "to": "address", "subject": "text", "text": "message" }` with `Authorization: Bearer <token>` over HTTPS port 443. The relay must return a 2xx response with JSON `{ "accepted": true }`; any other response fails closed. Configure a verified sender on the relay side. Do not expose this environment file in source control or logs.

The two temporary test accounts are seeded only when `SEED_TEMP_TEST_ACCOUNTS=true` and `TEMP_TEST_PASSWORD` are set during startup. Set the password to the approved temporary value in the private environment file, then remove both settings after the first successful start so later account deletion is durable. The seeder creates `member@admin.ph` as `member` and `officer@admin.ph` as `officer`. They bypass email verification only for the explicitly approved production test.

Before deploying a new binary or migration, back up the SQLite database using its online backup API or `sqlite3 .backup` and preserve the prior binary. Check `GET /health`, role-specific `/auth/me`, and the Postman smoke folder. Roll back by stopping the service, restoring the prior binary and compatible database backup, and restarting. Never roll back a migrated database with an older binary without the matching backup.

The public Pages build sets `NEXT_PUBLIC_AUTH_API_ORIGIN=https://api.pytorch.ph`. Its login and signup forms use the Rust API. Other Pages demo views still use synthetic read-only fixtures until their API contracts have been migrated; they must not be represented as persisted production data. `NEXT_PUBLIC_API_ORIGIN` remains reserved for the separately integrated official event/leaderboard views.

Measured latency and the bounded public benchmark procedure are in `../docs/PERFORMANCE.md`.
