# Program and strand sources

`build_directory.py` builds `backend/api/seeds/reference/programs.tsv.gz` (2,480 programs as of
2026-09-30). Rebuild: `python development/data/program-directory/build_directory.py` (downloads once
into `var/cache/program-directory/`). The API reloads it at startup when the seed's hash changes.

| Level | Source | Rows | Notes |
|---|---|---|---|
| junior_high | DepEd special curricular programs: DO 46 s. 2012 (SCP guidelines), DO 55 s. 2010 (STE), DO 25 s. 2015 (SPS); kept by DO 10 s. 2024 (MATATAG) | 7 | Regular + STE, SPA, SPS, SPJ, SPFL, SPTVE. No machine-readable file; listed in the script. |
| senior_high | K to 12 tracks and strands (DO 21 s. 2019); SHS Maritime (Joint DepEd–MARINA Memorandum 1 s. 2016); Strengthened SHS clusters (DM 48 s. 2025 pilot, DM 12 s. 2026) | 26 | Legacy strands and the new Academic/TechPro clusters, grouped by track. |
| undergraduate / graduate | PSA PSCED 2017 detailed fields, "Examples of programs" (https://psa.gov.ph/classification/psced/detailedfield) | 975 / 1,041 | Levels 5–6 undergraduate, 7–8 graduate; grouped by PSCED detailed field. CHED publishes no bulk program list; PSCED examples are not exhaustive. |
| technical_vocational | TESDA promulgated Training Regulations (https://tesda.gov.ph/Download/Training_Regulations), superseded entries skipped; PSCED level 4 | 431 | Qualifications such as "Computer Systems Servicing NC II". |

Terms: Philippine government works (RA 8293 §176: no copyright; prior approval is required only for
use for profit). Codes: `jhs-…`, `shs-…`/`sshs-…` (readable), `ug-`/`gr-`/`tv-` + hash of level and
name (stable across rebuilds). Short names are acronyms members type (BSCS, STEM, CSS NC II).

Members whose program is missing choose "My program isn't listed"; those answers are kept apart
from the catalog so analytics stay consistent.
