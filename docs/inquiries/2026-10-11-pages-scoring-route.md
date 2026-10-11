# Pages verification: scoring skills route

## Failing test

`npm run test:pages` fails at `development/pages-demo/verify.mjs:218`: the API mock records two unexpected `GET /scoring/skills` requests.

## Evidence

`frontend/portal/app/admin/events/competitive-event.tsx` calls `/scoring/skills` to populate event skill tags. `backend/api/src/app/routes.rs` registers that GET route. The Pages verifier visits `/admin/events/` twice; its `development/pages-demo/verify/mock-api.mjs` direct-read fixture lists `/events` and `/members` but lacks `/scoring/skills`. The production static build succeeds.

## Expected behavior

The verifier should recognize the real scoring skills route and return a bounded list of skills. Its unknown-route assertion must continue rejecting unrecognized API requests.

## Proposed resolution

Add `GET /scoring/skills` to the mock API's direct reads with a small valid skill list. Keep the `api.unexpected === []` assertion and all other checks. Then rerun Pages verification.
