# Company directory sources

`build_directory.py` builds `backend/api/seeds/reference/companies.tsv.gz` (7,507 companies as of
2026-09-30). Rebuild: `python development/data/company-directory/build_directory.py` (downloads once
into `var/cache/company-directory/`). The API merges it into `companies` at startup when the seed's
hash changes; member-added companies stay, marked unverified, and become verified when a later seed
contains the same name.

| Source | Rows kept | Fields | Terms |
|---|---|---|---|
| Wikidata SPARQL: instances of business (Q4830453) with country Philippines (Q928), not dissolved | 6,641 | name, English aliases (acronyms, trade names), HQ city, industry, LEI, stock tickers | CC0 |
| GLEIF LEI records, legal address PH, status ACTIVE (funds, pension and retirement plans excluded) | 612 | legal name, other names, city, LEI | CC0 |
| PSE EDGE company directory (listed companies) | 209 | name, ticker, sector | public listing (facts only) |
| Curated list from migration 0011 (ids `co-…` kept) | 45 | name | project data |

Merge: strong IDs first (LEI, ticker), then the name with punctuation and legal suffixes removed
(inc, corp, co, ltd, opc, philippines, …). Earlier sources keep the id and name; later ones add
aliases, city, industry, registration.

Not available (verified 2026-09-30): no bulk list of SEC-registered companies (the SEC API
Marketplace looks up one SEC number at a time, 10 free calls per day); DTI BNRS, PSA's business
register (confidential under RA 10625), BIR, PhilGEPS, and job boards (JobStreet, Indeed, LinkedIn,
Kalibrr) offer no bulk or redistributable employer list; OpenCorporates has no PH register.
