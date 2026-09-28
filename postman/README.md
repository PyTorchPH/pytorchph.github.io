# PyTorch PH API Postman checks

Import `PyTorch-PH.postman_collection.json` into Postman. Set `memberPassword` and `officerPassword` locally to the approved temporary password, then run **Public smoke** and **Auth and role smoke** in that order against `https://api.pytorch.ph`; the latter signs in with the two temporary test accounts and uses Postman's cookie jar. The collection checks status and role assertions. Set collection variables if the API origin or site origin differs.

The **Signup and Google manual**, **Entity reads manual**, and **Writes manual** folders are skipped unless `runWrites=true` and `manualRequest` exactly matches one request name. They need real email ownership, a Google ID token, existing entity IDs, or deliberate mutations. Set the required variables and review that request body before enabling it. A passing smoke run proves only its exercised endpoints; it does not prove all 38 contracts or unavailable external services.

Regenerate the JSON after editing the request definitions with `node postman/build-collection.mjs`. The generated collection leaves password variables empty so the temporary credential is not published in the repository. Remove the account variables when the accounts are deleted after testing.

Postman `pm.execution.skipRequest()` behavior: https://learning.postman.com/latest-v-12/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution.
