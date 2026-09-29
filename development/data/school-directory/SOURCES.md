# School directory sources

`build_directory.py` merges these into `backend/api/seeds/reference/schools.tsv.gz`
(62,544 schools: 60,677 basic education + 2,609 higher education campuses as of 2026-09-30).
Rebuild: `python development/data/school-directory/build_directory.py` (downloads once into
`var/cache/school-directory/`). The API reloads the directory at startup when the seed's hash changes.

| Key | Source (pinned) | Rows used | As of | Fields used | Terms |
|---|---|---|---|---|---|
| `deped` | DepEd Masterlist of Schools SY 2020–2021 (data.gov.ph), mirrored at `darwinphi/ph-schools-dataset` tag `v1.0.1` | 60,677 (SUC/LUC K-12 units skipped; CHED lists them) | SY 2020–2021 | BEIS School ID, name, municipality, division, region, sector | Government open data; mirror code MIT |
| `ched_uii` | CHED HEI list with UII, `rgianan/event-registration-portal@b8478486` `data/hei-list.csv` | 2,344 (`Status = Existing`) | 2026-05 | HEI name, CHED UII, region, HEI type (1 private; 2a/2b/3/4b public), province, city | CHED public listing; repo has no license (facts only) |
| `ched_extra` | CHED institutions list, `cbsdan/Acadena@0f0e63c3` `ched-institutions.csv` | rows not already present (adds BARMM) | 2025-06 | name, type, province, city, region | CHED public listing; repo has no license (facts only) |
| legacy | `backend/api/seeds/reference/schools.json` (villamorrd/ched-hei-dataset, CC0, commit cd6d4c2) | codes only | 2025-10 | earlier `hei-…` codes, kept so saved answers stay valid | CC0 1.0 |

Codes: `hei-…` (earlier list, preserved), `ched-<UII>`, `ched-n-<hash of name|city>`, `deped-<BEIS ID>`.

Known gaps:
- No newer public DepEd masterlist exists; SY 2024–2025 was only available through a pending FOI
  request (2025-10). Schools opened after SY 2020–2021 use "My school isn't listed".
- CHED publishes its list only as a Looker Studio embed; both CHED files are community scrapes.
- TESDA technical-vocational institutions have no bulk download (level `technical` is reserved).
- Source typos are kept as published (e.g. a "Dasmarifias" spelling in one list).
