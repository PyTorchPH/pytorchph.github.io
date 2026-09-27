# PyTorch Philippines website adaptation

## Scope and provenance

- Base: FIT worktree at commit `ab06d11f53344dc0fc37ab1c056205a53635bc4c`, including existing
  implementation changes. Original FIT files and Git repository remain untouched.
- Destination: existing `PyTorchPH/PyTorchPH.github.io` repository. Remote, branch, history,
  and observability UUID remain unchanged.
- Previous PH demo and original Git state: `../.backups/website-before-national-20260927-173614/website-original.zip`.
- Excluded: FIT agent/board governance, installed dependencies, caches, credentials, local databases,
  personal artifacts, and deployment linkage.

## Behavior

- PyTorch Philippines is nationwide, community-led, and school-independent.
- Any valid email domain is eligible. Password, consent, ownership confirmation, membership,
  officer authorization, and RLS requirements remain separate and unchanged.
- Package scope: `@pytorch-ph`. Application settings: `PYTORCH_PH_*`.
- Local cookie: `pytorch_ph_local_session`. State: this repository's `var/`.
- Local port: 3100. Hosts: `members.ph.localhost` and `officers.ph.localhost`.
- The default launcher starts the website only; inherited automation tools remain optional.
- Academic-evidence adapters describe their source; they are not school affiliations or access gates.

## Reuse and verification

Reused the existing Next.js, React, Zod, and Supabase stack with its lockfile. No replacement
framework or authentication provider was introduced. The installed observability CLI has no
`tech` or `reuse` command; source selection is recorded here and through `obs change plan`.

The inherited observability test's FIT slug was obsolete for this existing PH repository. Its PH
adaptation checks the original PH slug and retains UUID, syntax, and secret-exclusion assertions.
Inherited tests use the PH package/config namespaces and local origins. Nationwide tests add
eligible domains and rejection cases without weakening existing checks.

Sources:

- [Next.js deployment reference](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/17-deploying.mdx): full framework support requires a server; static export supports a subset.
- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords): email/password signup and ownership confirmation.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): database authorization is distinct from email eligibility.

## Deployment and rollback

Use Node.js-compatible hosting for server routes, cookies, and APIs. The repository name does not
make this application a static GitHub Pages site. No live deployment, account change, database
operation, or schema migration was performed. Production needs a separately configured PH
Supabase project and approved environment values.

To restore the prior demo, stop the PH process, retain subsequent work, and extract the backup
into a separate folder for comparison before replacing this worktree. Original FIT remains available.
