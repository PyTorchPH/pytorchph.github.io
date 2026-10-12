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

## Normalized v2 graph

`evidence-backed-resume/v2` separates optional resume entries, quantitative claims, shared test
evidence, environments, artifacts, and claim-to-evidence links. One test record can support many
claims without copying its method, workload, environment, limitations, or artifacts. Claims contain
only measured statements; qualitative project or experience descriptions remain on their entries.

Only `fullName`, `email`, `phone`, and `location` are required before draft promotion. Personal
website, LinkedIn, and every resume section are optional. When a section entry exists, its own
section-specific fields become required. Projects without tests remain valid and render without
quantitative bullets.

The executable parser is `../evidence-graph.ts`. The complete synthetic input is
`frontend/portal/tests/fixtures/evidence-resume-example.v2.json`; run `npm run example:resume` from
the repository root to generate the parsed profile, HTML, and PDF under `out/resume-example/`.

## Semantic source v1

`resume-source/v1` is the broader source contract used by deterministic injection and resume
analysis. It keeps identity, arbitrary resume records, normalized skills, quantitative claims,
shared evidence, provenance, targets, and renderer-neutral presentation hints in one document.
The injector derives a `ResumeProfile`; the analyzer derives a separate report, so analysis never
mutates the career source of truth.

The model borrows common section vocabulary from JSON Resume while retaining the stricter v2
evidence graph. The canonical synthetic fixture is
`frontend/portal/tests/fixtures/resume-source-example.v1.yaml`; the adjacent JSON file remains only
for the client-bundled demo until Next.js can load YAML as a static module. It uses the section
hierarchy of a private one-page reference resume without copying identity or contact data.
`npm run example:resume` emits the source YAML, analysis, projected profile, HTML, and PDF under
`out/resume-example/`.
