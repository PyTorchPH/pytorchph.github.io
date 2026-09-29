"""Builds backend/api/seeds/reference/companies.tsv.gz, the verified company directory the API
merges into its companies table at startup (member-added companies stay, marked unverified).

No free bulk list of every SEC-registered company exists (see SOURCES.md), so this combines the
open sources that are legally reusable: Wikidata (businesses in the Philippines), GLEIF (entities
with a Legal Entity Identifier and their SEC/BIR registration), and the PSE listed-company directory.

Module map (caller-first):
  main                 fetch → normalize each source → merge by strong IDs, then by name → write
  ├─ wikidata_rows     SPARQL: businesses with country = Philippines, not dissolved
  ├─ gleif_rows        GLEIF API, legal address PH, active, excluding funds and pension plans
  ├─ pse_rows          PSE EDGE company directory pages (name, ticker, sector)
  ├─ curated_rows      the hand-picked seed already in migration 0011 (keeps its co-… ids)
  ├─ merge             one record per company: QID ↔ LEI ↔ ticker, then normalized name
  │   └─ name_key      lowercase, no punctuation, no legal suffixes ("inc", "corp", …)
  └─ write_seed        header + rows, tab-separated, gzip (deterministic)

Output columns: id, name, aliases ("|"-separated: acronyms, trade names, tickers), city, industry,
registration (LEI or SEC number when published), origin (directory|curated).
"""
from __future__ import annotations

import gzip
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "backend" / "api" / "seeds" / "reference" / "companies.tsv.gz"
CACHE = ROOT / "var" / "cache" / "company-directory"
MIGRATION = ROOT / "backend" / "api" / "migrations" / "0011_organization_and_member_profiles.sql"
COLUMNS = ["id", "name", "aliases", "city", "industry", "registration", "origin"]
# Identifies the tool without any personal data (Wikimedia asks for a descriptive User-Agent).
USER_AGENT = "PyTorchPH-directory-builder/1.0 (+https://pytorch.ph)"

WIKIDATA_QUERY = """
SELECT ?item ?name (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
       (SAMPLE(?cityName) AS ?city) (SAMPLE(?industryName) AS ?industry)
       (SAMPLE(?lei) AS ?leiCode) (GROUP_CONCAT(DISTINCT ?ticker; separator="|") AS ?tickers) WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453; wdt:P17 wd:Q928.
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  ?item rdfs:label ?name FILTER(LANG(?name) = "en")
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) = "en") }
  OPTIONAL { ?item wdt:P159 ?hq. ?hq rdfs:label ?cityName FILTER(LANG(?cityName) = "en") }
  OPTIONAL { ?item wdt:P452 ?ind. ?ind rdfs:label ?industryName FILTER(LANG(?industryName) = "en") }
  OPTIONAL { ?item wdt:P1278 ?lei }
  OPTIONAL { ?item p:P414 ?listing. ?listing pq:P249 ?ticker }
} GROUP BY ?item ?name
"""
GLEIF_URL = "https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D=PH&filter%5Bentity.status%5D=ACTIVE&page%5Bsize%5D=200&page%5Bnumber%5D={page}"
PSE_URL = "https://edge.pse.com.ph/companyDirectory/search.ax"
NOT_EMPLOYERS = re.compile(r"(?i)\b(retirement|pension|provident|fund|trust|plan)\b")
LEGAL_SUFFIXES = re.compile(r"\b(incorporated|inc|corporation|corp|company|co|limited|ltd|opc|philippines|phils|phil|the)\b")


def main() -> None:
    records = merge([*curated_rows(), *wikidata_rows(), *gleif_rows(), *pse_rows()])
    write_seed(records)
    print(f"wrote {len(records)} companies to {OUTPUT.relative_to(ROOT)}")


# ---- fetching -----------------------------------------------------------------------------

def fetch(name: str, url: str, data: bytes | None = None, accept: str = "application/json") -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(request, timeout=180) as response:
        body = response.read()
    path.write_bytes(body)
    time.sleep(0.5)  # be gentle with public endpoints
    return body


# ---- sources ------------------------------------------------------------------------------

def wikidata_rows() -> list[dict]:
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": WIKIDATA_QUERY, "format": "json"})
    bindings = json.loads(fetch("wikidata.json", url, accept="application/sparql-results+json"))["results"]["bindings"]
    value = lambda row, key: row.get(key, {}).get("value", "")
    rows = []
    for row in bindings:
        name = value(row, "name")
        if not name or re.fullmatch(r"Q\d+", name):
            continue
        rows.append(record(
            id="wd-" + value(row, "item").rsplit("/", 1)[-1], name=name,
            aliases=[*value(row, "aliases").split("|"), *value(row, "tickers").split("|")],
            city=value(row, "city"), industry=value(row, "industry"), registration=value(row, "leiCode"),
            keys={value(row, "leiCode"), *value(row, "tickers").split("|")},
        ))
    return rows


def gleif_rows() -> list[dict]:
    rows, page = [], 1
    while True:
        payload = json.loads(fetch(f"gleif-{page}.json", GLEIF_URL.format(page=page)))
        for item in payload["data"]:
            entity = item["attributes"]["entity"]
            name = entity["legalName"]["name"]
            if entity.get("category") == "FUND" or NOT_EMPLOYERS.search(name) or (entity.get("legalForm") or {}).get("other") == "Pension":
                continue
            others = [other["name"] for other in entity.get("otherNames") or []]
            rows.append(record(
                id="lei-" + item["id"], name=tidy_caps(name), aliases=others,
                city=tidy_caps(entity["legalAddress"].get("city") or ""), industry="",
                registration=item["id"], keys={item["id"], entity.get("registeredAs") or ""},
            ))
        if page >= payload["meta"]["pagination"]["lastPage"]:
            return rows
        page += 1


def pse_rows() -> list[dict]:
    rows, page = [], 1
    while True:
        form = urllib.parse.urlencode({"pageNo": page, "companyId": "", "keyword": "", "sortType": "", "dateSortType": "DESC",
                                       "cmpySortType": "ASC", "symbolSortType": "ASC", "sector": "ALL", "subsector": "ALL"}).encode()
        text = fetch(f"pse-{page}.html", PSE_URL, data=form, accept="text/html").decode("utf-8", "replace")
        found = 0
        for cells in (re.findall(r"<td[^>]*>(.*?)</td>", row, re.S) for row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S)):
            if len(cells) < 4:
                continue
            name, ticker, sector = (html.unescape(re.sub(r"<[^>]+>", "", cell)).strip() for cell in cells[:3])
            if not name or not ticker:
                continue
            found += 1
            rows.append(record(id="pse-" + ticker, name=name, aliases=[ticker], city="", industry=sector, registration="", keys={ticker}))
        if found == 0 or page >= 20:
            return rows
        page += 1


def curated_rows() -> list[dict]:
    """The companies seeded by migration 0011 keep their ids so saved answers stay valid."""
    sql = MIGRATION.read_text(encoding="utf-8")
    block = sql[sql.index("INSERT INTO companies"):]
    return [record(id=code, name=name.replace("''", "'"), aliases=[], city="", industry="", registration="", keys=set(), origin="curated")
            for code, name in re.findall(r"\('(co-[a-z0-9-]+)',\s*'((?:[^']|'')+)'", block)]


# ---- shaping and merging ------------------------------------------------------------------

def record(*, id: str, name: str, aliases: list[str], city: str, industry: str, registration: str, keys: set[str], origin: str = "directory") -> dict:
    return {"id": id, "name": re.sub(r"\s+", " ", name).strip(), "aliases": {a.strip() for a in aliases if a and a.strip()},
            "city": city.strip(), "industry": industry.strip(), "registration": registration.strip(),
            "keys": {key for key in keys if key}, "origin": origin}


def merge(rows: list[dict]) -> list[dict]:
    """Earlier sources win the id and name; later ones add aliases, city, industry, registration."""
    merged: list[dict] = []
    by_key: dict[str, dict] = {}
    for row in rows:
        target = next((by_key[key] for key in [*sorted(row["keys"]), "name:" + name_key(row["name"])] if key in by_key), None)
        if target is None:
            target = {**row, "aliases": set(row["aliases"]), "keys": set(row["keys"])}
            merged.append(target)
        else:
            target["aliases"] |= row["aliases"] | ({row["name"]} if row["name"] != target["name"] else set())
            for field in ("city", "industry", "registration"):
                target[field] = target[field] or row[field]
        for key in [*row["keys"], "name:" + name_key(row["name"])]:
            by_key.setdefault(key, target)
    return sorted(merged, key=lambda item: item["name"].lower())


def name_key(name: str) -> str:
    plain = re.sub(r"[^a-z0-9 ]", " ", name.lower().replace("&", " and "))
    return re.sub(r"\s+", " ", LEGAL_SUFFIXES.sub(" ", plain)).strip()


def tidy_caps(text: str) -> str:
    return text.title() if text.isupper() else text


def write_seed(records: list[dict]) -> None:
    lines = ["\t".join(COLUMNS)]
    seen_names: set[str] = set()
    for item in records:
        folded = item["name"].casefold()
        if folded in seen_names:  # companies.name is unique (NOCASE)
            continue
        seen_names.add(folded)
        aliases = "|".join(sorted(alias for alias in item["aliases"] if alias.casefold() != folded))
        values = [item["id"], item["name"], aliases, item["city"], item["industry"], item["registration"], item["origin"]]
        lines.append("\t".join(value.replace("\t", " ").replace("\n", " ") for value in values))
    with open(OUTPUT, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as out:
        out.write(("\n".join(lines) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
