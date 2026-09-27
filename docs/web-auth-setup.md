# Web Auth Setup

CareerLens can sign in with GitHub, Google, or Microsoft. The app code is already
wired for OAuth; each provider still needs a developer app/client ID and secret.

The local default base URL is:

```text
http://127.0.0.1:8010
```

If you run the web app on another host or port, set `CAREERLENS_BASE_URL` to that
exact origin before starting the server.

## Redirect URLs

Register these callback URLs in the provider dashboards:

```text
http://127.0.0.1:8010/auth/github/callback
http://127.0.0.1:8010/auth/google/callback
http://127.0.0.1:8010/auth/microsoft/callback
```

## Environment Variables

PowerShell example:

```powershell
$env:CAREERLENS_BASE_URL="http://127.0.0.1:8010"

$env:GITHUB_CLIENT_ID="..."
$env:GITHUB_CLIENT_SECRET="..."

$env:GOOGLE_CLIENT_ID="..."
$env:GOOGLE_CLIENT_SECRET="..."

$env:MICROSOFT_CLIENT_ID="..."
$env:MICROSOFT_CLIENT_SECRET="..."
$env:MICROSOFT_TENANT="common"

python -m resume_builder.web.dev_server 8010
```

`MICROSOFT_TENANT` is optional. Use `common` for personal/school/work accounts,
or use a tenant ID if the app should be restricted to one organization.

## GitHub

1. Go to GitHub Developer settings, then OAuth Apps.
2. Create a new OAuth App.
3. Set Homepage URL to `http://127.0.0.1:8010`.
4. Set Authorization callback URL to `http://127.0.0.1:8010/auth/github/callback`.
5. Copy the Client ID and Client Secret into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Scopes requested by CareerLens:

```text
read:user user:email
```

## Google

1. Go to Google Cloud Console.
2. Create or select a project.
3. Configure OAuth consent screen.
4. Create OAuth Client ID credentials for a Web application.
5. Add Authorized JavaScript origin: `http://127.0.0.1:8010`.
6. Add Authorized redirect URI: `http://127.0.0.1:8010/auth/google/callback`.
7. Copy the Client ID and Client Secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Scopes requested by CareerLens:

```text
openid email profile
```

## Microsoft

1. Go to Microsoft Entra admin center, then App registrations.
2. Create a new registration.
3. Select supported account type. For broad local testing, use personal/work/school accounts.
4. Add Web redirect URI: `http://127.0.0.1:8010/auth/microsoft/callback`.
5. Create a client secret.
6. Copy the Application client ID and client secret into `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.

Scopes requested by CareerLens:

```text
openid email profile User.Read
```

## What This Does Not Do

This identity login does not bypass Facebook or LinkedIn login. It stores a reusable
identity profile and email, then uses that email to prefill the visible Facebook or
LinkedIn login window. The social website session is still user-approved and saved
separately through the Dashboard.
