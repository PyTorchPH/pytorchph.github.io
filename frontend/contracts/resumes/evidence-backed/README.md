# Evidence-backed resume contract

Ang `schema.v1.json` ang portable JSON contract; ang `template.v1.json` ang parseable GabayBigkas
example. Ang Zod implementation sa `../evidence-contract.ts` ang runtime contract ng frontend, at
ang Python model sa backend ang deterministic adapter ng existing resume pipeline.

Iisang claim record ang nagmamay-ari ng canonical fact, test method, measured metrics, artifacts,
verification, limitations, rendered resume text, target roles, at injection destinations. Walang
separate evidence catalog o claim-binding join.

Ang ISO classification ay taxonomy lamang, hindi certification. Ang evidence assessment ay
`unsupported`, `documented`, `measured`, o `verified`; hindi nito ini-infer kung participation,
contributor, finalist/lead, o winner/top-award ang achievement.

Ang browser ay MAY magpakita ng point preview kapag officer-verified na ang evidence at may explicit
rubric level. Hindi ito authority: Rust review workflow at append-only point events pa rin ang
nakakapag-award ng points.
