"""Builds backend/api/seeds/reference/schools.tsv.gz, the school directory the API loads at startup.

Sources (pinned; see SOURCES.md): the DepEd masterlist of K-12 schools, a CHED HEI list with the
CHED UII and city names, a second CHED list that adds BARMM, and the CHED list we used before
(only to keep existing school codes stable).

Module map (caller-first):
  main                  fetch pinned sources → HEIs → K-12 schools → dedupe → write the gzipped TSV
  ├─ fetch              download once into var/cache/school-directory (checked by size)
  ├─ higher_education   CHED rows: UII list first, then BARMM/extra rows from the second list
  │   ├─ legacy_codes   normalized name → the old "hei-…" code, so saved answers keep working
  │   └─ hei_region     "4" / "15 - Bangsamoro…" → our 2-digit region code
  ├─ basic_education    DepEd rows (SUC/LUC K-12 units are skipped: CHED lists them)
  │   └─ deped_region   "Region IV-A" → "04"
  ├─ tidy_name / tidy_place   ALL-CAPS → Title Case; "LUCENA CITY (Capital)" → "Lucena City"
  ├─ acronym_for        "Sacred Heart College" → "SHC"; keeps written acronyms ("STI", "(AITECH)")
  ├─ dedupe             one row per code, and one per (normalized name, city)
  └─ write_seed         header + rows, tab-separated, gzip (deterministic: mtime 0)

Output columns: code, name, acronym, level (basic|higher|technical), sector (public|private),
city, province, region_code. Unknown text is ''.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REFERENCE = ROOT / "backend" / "api" / "seeds" / "reference"
OUTPUT = REFERENCE / "schools.tsv.gz"
CACHE = ROOT / "var" / "cache" / "school-directory"
COLUMNS = ["code", "name", "acronym", "level", "sector", "city", "province", "region_code"]

SOURCES = {
    "deped": "https://raw.githubusercontent.com/darwinphi/ph-schools-dataset/v1.0.1/schools_masterlist_2020_2021.json",
    "ched_uii": "https://raw.githubusercontent.com/rgianan/event-registration-portal/b8478486dc933ce83591847919adc492b8556e26/data/hei-list.csv",
    "ched_extra": "https://raw.githubusercontent.com/cbsdan/Acadena/0f0e63c317ffce66c4ace249fa5aa3658cd82ec4/src/Acadena_frontend/public/data/ched-institutions.csv",
}

MINOR_WORDS = {"of", "the", "and", "de", "del", "ng", "sa", "for", "in", "at", "a", "an", "&"}
LOWER_IN_TITLES = {"of", "the", "and", "de", "del", "ng", "sa", "for", "in", "at", "y"}
KEEP_UPPER = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "SHS", "NHS", "ES", "CS", "MNHS", "STI", "AMA", "ICT"}
PRIVATE_HEI_TYPE = "1"
DEPED_REGIONS = {
    "region i": "01", "region ii": "02", "region iii": "03", "region iv-a": "04", "calabarzon": "04",
    "region iv-b": "17", "mimaropa": "17", "region v": "05", "region vi": "06", "region vii": "07",
    "region viii": "08", "region ix": "09", "region x": "10", "region xi": "11", "region xii": "12",
    "ncr": "13", "car": "14", "caraga": "16", "barmm": "19", "armm": "19", "nir": "18",
}


def main() -> None:
    raw = {name: fetch(name, url) for name, url in SOURCES.items()}
    heis = higher_education(raw["ched_uii"], raw["ched_extra"])
    basic = basic_education(raw["deped"])
    rows = dedupe(heis + basic)
    write_seed(rows)
    print(f"wrote {len(rows)} schools ({len(heis)} higher education, {len(basic)} basic education) to {OUTPUT.relative_to(ROOT)}")


def fetch(name: str, url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name}{Path(url).suffix}"
    if not path.exists() or path.stat().st_size == 0:
        with urllib.request.urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


# ---- higher education (CHED) ------------------------------------------------------------------

def higher_education(uii_csv: bytes, extra_csv: bytes) -> list[dict[str, str]]:
    legacy = legacy_codes()
    rows = []
    for row in csv.DictReader(io.StringIO(uii_csv.decode("utf-8-sig"))):
        if row["Status"].strip() != "Existing":
            continue
        name = tidy_name(row["HEI Name"])
        rows.append(school_row(
            code=legacy.get(normalize(name)) or f"ched-{row['UII'].strip()}", name=name, level="higher",
            sector="private" if row["HEI Type"].strip() == PRIVATE_HEI_TYPE else "public",
            city=tidy_place(row["City/Municipality"]), province=tidy_province(row["Province"]), region=hei_region(row["Region"]),
        ))
    known = {normalize(row["name"]) for row in rows}
    for row in csv.DictReader(io.StringIO(extra_csv.decode("utf-8-sig"))):
        fields = {key.strip(): (value or "").strip() for key, value in row.items() if key}
        name = tidy_name(fields.get("INSTITUTION NAME", ""))
        if not name or normalize(name) in known:
            continue
        city = tidy_place(fields.get("MUNICIPALITY/CITY", ""))
        rows.append(school_row(
            code=legacy.get(normalize(name)) or "ched-n-" + short_hash(f"{normalize(name)}|{normalize(city)}"), name=name, level="higher",
            sector="private" if fields.get("INSTITUTION TYPE", "").lower() == "private" else "public",
            city=city, province=tidy_province(fields.get("PROVINCE", "")), region=hei_region(fields.get("REGION", "")),
        ))
    return rows


def legacy_codes() -> dict[str, str]:
    """Codes from the earlier CHED list (schools.json), keyed by normalized name."""
    path = REFERENCE / "schools.json"
    if not path.exists():
        return {}
    catalog = json.loads(path.read_text(encoding="utf-8"))
    return {normalize(re.sub(r"^\d{6,}\s+", "", name)): code for code, name, _kind, _region in catalog["rows"]}


def hei_region(value: str) -> str:
    number = re.match(r"\s*(\d+)", value or "")
    if not number:
        return ""
    region = int(number.group(1))
    return "19" if region == 15 else f"{region:02d}"


# ---- basic education (DepEd) ------------------------------------------------------------------

def basic_education(masterlist_json: bytes) -> list[dict[str, str]]:
    rows = []
    for school in json.loads(masterlist_json.decode("utf-8")):
        if school.get("Sector", "").strip().lower() in {"sucs/lucs", "suc/luc", "suc", "luc"}:
            continue
        division = tidy_place(school.get("Division", ""))
        city = tidy_place(school.get("Municipality", ""))
        rows.append(school_row(
            code=f"deped-{school['BEIS School ID'].strip()}", name=tidy_name(school["School Name"]), level="basic",
            sector="private" if school.get("Sector", "").strip().lower() == "private" else "public",
            city=city, province="" if normalize(division) == normalize(city) else division, region=deped_region(school.get("Region", "")),
        ))
    return rows


def deped_region(value: str) -> str:
    key = value.strip().lower()
    return DEPED_REGIONS.get(key) or DEPED_REGIONS.get(key.split("(")[0].strip(), "")


# ---- shared shaping ---------------------------------------------------------------------------

def school_row(*, code: str, name: str, level: str, sector: str, city: str, province: str, region: str) -> dict[str, str]:
    return {"code": code, "name": name, "acronym": acronym_for(name), "level": level, "sector": sector,
            "city": city, "province": province, "region_code": region}


def tidy_name(name: str) -> str:
    name = re.sub(r"^\d{6,}\s+", "", re.sub(r"\s+", " ", name or "")).strip()
    letters = [c for c in name if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        name = title_case(name)
    return name


def title_case(text: str) -> str:
    words = re.split(r"(\s+|-|/|\()", text)
    out = []
    for index, word in enumerate(words):
        bare = re.sub(r"[^A-Za-z]", "", word)
        if bare.upper() in KEEP_UPPER or (len(bare) <= 3 and bare and not re.search(r"[AEIOU]", bare.upper())):
            out.append(word.upper())
        elif index > 0 and word.lower() in LOWER_IN_TITLES:
            out.append(word.lower())
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return "".join(out)


def tidy_place(place: str) -> str:
    place = re.sub(r"\s*\(capital\)\s*", " ", place or "", flags=re.IGNORECASE).strip()
    place = re.sub(r"\s+", " ", place)
    if place.isupper():
        place = title_case(place)
    city_of = re.match(r"(?i)^city of (.+)$", place)
    return f"{city_of.group(1)} City" if city_of else place


def tidy_province(province: str) -> str:
    return re.sub(r"(?i)\s+province$", "", tidy_place(province))


def acronym_for(name: str) -> str:
    """Written acronyms first (all-caps words, a parenthesized short form), then the initials."""
    base = re.split(r"\s+-\s+|-", name)[0]
    written = re.findall(r"\(([A-Z][A-Z0-9&-]{1,9})\)", name)
    written += [word for word in re.findall(r"[A-Za-z0-9&]+", base) if len(word) >= 2 and word.isupper() and not word.isdigit()]
    words = [word for word in re.findall(r"[A-Za-z][A-Za-z'.]*", re.sub(r"\(.*?\)", "", base)) if word.lower() not in MINOR_WORDS]
    # A written acronym ("STI", "FEU") is what people type; initials only stand in when there is none.
    initials = "".join(word[0].upper() for word in words) if len(words) >= 2 and not written else ""
    ordered: list[str] = []
    for form in [*written, initials]:
        if form and form not in ordered:
            ordered.append(form)
    return " ".join(ordered)


def normalize(text: str) -> str:
    text = re.sub(r"(?i)\bcity of ([a-z ]+)", r"\1 city", text or "")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower().replace("-", " "))).strip()


def short_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def dedupe(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    by_code: dict[str, dict[str, str]] = {}
    by_place: set[tuple[str, str]] = set()
    for row in rows:
        place = (normalize(row["name"]), normalize(row["city"]))
        if row["code"] in by_code or place in by_place:
            continue
        by_code[row["code"]] = row
        by_place.add(place)
    return sorted(by_code.values(), key=lambda row: (row["name"].lower(), row["city"].lower()))


def write_seed(rows: list[dict[str, str]]) -> None:
    lines = ["\t".join(COLUMNS)]
    for row in rows:
        lines.append("\t".join(str(row[column]).replace("\t", " ").replace("\n", " ").strip() for column in COLUMNS))
    data = ("\n".join(lines) + "\n").encode("utf-8")
    with open(OUTPUT, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as out:
        out.write(data)


if __name__ == "__main__":
    main()
