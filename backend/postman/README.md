# PyTorch PH API Postman checks

Import `PyTorch-PH.postman_collection.json` into Postman. Set `memberPassword` and `officerPassword` locally to the approved temporary password. Run **Public smoke** and **Auth and role smoke** against `https://api.pytorch.ph`; the latter signs in with the temporary test accounts and uses Postman's cookie jar. Set `apiOrigin` and `siteOrigin` if they differ.

For server writes, set `runWrites=true` and run **Member and officer write workflow** in order. It creates a uniquely marked event and evidence claim, registers the test member, publishes a result, rejects the claim, checks saved state, and revokes the member session. The collection stores `memberId`, `eventId`, `entrantId`, and `claimId` from API responses. These records remain in the selected database for review. Set `runWrites=false` afterward.

The **Signup and Google manual**, **Entity reads manual**, and **Writes manual** folders require both `runWrites=true` and an exact `manualRequest` name. They cover admin-only operations, revisioned mail, external Google Forms, and the disabled-by-default n8n interface. Configure their required IDs, roles, and private credentials locally; they do not call AI. A passing write workflow covers its exercised member/officer endpoints, while manual requests and external integrations still require separate credentials or configuration.

The **Portal production demo contracts** folder covers the authenticated Rust `/portal/api/*` gateway and owner-only `/portal/media/{id}` reads. Log in as the member or officer first, then set `runWrites=true` and `manualRequest` to one exact request name. Set a unique `portalUsername` before saving identity. For the photo request, set `photoData` locally to a browser-generated `data:image/jpeg;base64,...` value. Event, evidence, opportunity, and feedback requests persist synthetic records. AI analysis returns static test data and never calls a provider.

Regenerate the JSON after editing the request definitions with `node postman/build-collection.mjs`. The generated collection leaves password variables empty so the temporary credential is not published in the repository. Remove the account variables when the accounts are deleted after testing.

Postman `pm.execution.skipRequest()` behavior: https://learning.postman.com/latest-v-12/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution.
