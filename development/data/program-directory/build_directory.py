"""Builds backend/api/seeds/reference/programs.tsv.gz: every program or strand a member can pick,
so profile answers share one spelling and analytics group cleanly.

Sources (see SOURCES.md):
  junior high   DepEd special curricular programs (DO 46 s. 2012, DO 55 s. 2010, DO 25 s. 2015)
  senior high   K to 12 tracks and strands (DO 21 s. 2019; SHS Maritime, JMC 1 s. 2016) and the
                Strengthened SHS clusters (DM 48 s. 2025, DM 12 s. 2026)
  college       PSA PSCED 2017 detailed fields, "Examples of programs" (levels 5-8)
  tech-voc      TESDA promulgated Training Regulations (current, not superseded) + PSCED level 4

Module map (caller-first):
  main                    basic education lists → PSCED → TESDA → dedupe → write
  ├─ basic_education_rows the DepEd lists above (readable codes: jhs-ste, shs-stem, …)
  ├─ psced_rows           parse each "Examples of programs" table with its field name and code
  ├─ tesda_rows           every Training Regulations page, superseded entries skipped
  ├─ program_acronym      "Bachelor of Science in Computer Science" → "BSCS"
  ├─ program_code         stable code from level + normalized name
  └─ write_seed           header + rows, tab-separated, gzip (deterministic)

Output columns: code, level, name, short_name, group_name.
Levels: junior_high, senior_high, undergraduate, graduate, technical_vocational.
"""
from __future__ import annotations

import gzip
import hashlib
import html
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "backend" / "api" / "seeds" / "reference" / "programs.tsv.gz"
CACHE = ROOT / "var" / "cache" / "program-directory"
COLUMNS = ["code", "level", "name", "short_name", "group_name"]
USER_AGENT = "PyTorchPH-directory-builder/1.0 (+https://pytorch.ph)"
PSCED_URL = "https://psa.gov.ph/classification/psced/detailedfield"
TESDA_URL = "https://tesda.gov.ph/Download/Training_Regulations?page={page}"
PSCED_LEVELS = {"4": "technical_vocational", "5": "undergraduate", "6": "undergraduate", "7": "graduate", "8": "graduate"}
MINOR_WORDS = {"of", "in", "and", "the", "for", "with", "major", "&", "on", "to", "a"}

JUNIOR_HIGH = [
    ("jhs-regular", "Regular program (K to 12 / MATATAG)", "Regular", "Basic curriculum"),
    ("jhs-ste", "Science, Technology, and Engineering", "STE", "Special curricular program"),
    ("jhs-spa", "Special Program in the Arts", "SPA", "Special curricular program"),
    ("jhs-sps", "Special Program in Sports", "SPS", "Special curricular program"),
    ("jhs-spj", "Special Program in Journalism", "SPJ", "Special curricular program"),
    ("jhs-spfl", "Special Program in Foreign Language", "SPFL", "Special curricular program"),
    ("jhs-sptve", "Special Program in Technical-Vocational Education", "SPTVE", "Special curricular program"),
]
SENIOR_HIGH = [
    ("shs-stem", "Science, Technology, Engineering, and Mathematics", "STEM", "Academic track"),
    ("shs-abm", "Accountancy, Business, and Management", "ABM", "Academic track"),
    ("shs-humss", "Humanities and Social Sciences", "HUMSS", "Academic track"),
    ("shs-gas", "General Academic Strand", "GAS", "Academic track"),
    ("shs-tvl-he", "TVL - Home Economics", "TVL-HE", "Technical-Vocational-Livelihood track"),
    ("shs-tvl-ict", "TVL - Information and Communications Technology", "TVL-ICT", "Technical-Vocational-Livelihood track"),
    ("shs-tvl-ia", "TVL - Industrial Arts", "TVL-IA", "Technical-Vocational-Livelihood track"),
    ("shs-tvl-afa", "TVL - Agri-Fishery Arts", "TVL-AFA", "Technical-Vocational-Livelihood track"),
    ("shs-sports", "Sports track", "Sports", "Sports track"),
    ("shs-arts-design", "Arts and Design track", "Arts and Design", "Arts and Design track"),
    ("shs-maritime", "SHS Maritime Program", "Maritime", "Academic track"),
    ("sshs-ashss", "Arts, Social Sciences, and Humanities", "ASSH", "Strengthened SHS - Academic"),
    ("sshs-business", "Business and Entrepreneurship", "Business", "Strengthened SHS - Academic"),
    ("sshs-stem", "Science, Technology, Engineering, and Mathematics (Strengthened SHS)", "STEM", "Strengthened SHS - Academic"),
    ("sshs-sports", "Sports, Health, and Wellness", "SHW", "Strengthened SHS - Academic"),
    ("sshs-field", "Field Experience", "Field Experience", "Strengthened SHS - Academic"),
    ("sshs-care", "Aesthetic, Wellness, and Human Care", "AWHC", "Strengthened SHS - TechPro"),
    ("sshs-agri", "Agri-Fishery Business and Food Innovation", "AFBFI", "Strengthened SHS - TechPro"),
    ("sshs-artisanry", "Artisanry and Creative Enterprise", "ACE", "Strengthened SHS - TechPro"),
    ("sshs-automotive", "Automotive and Small Engine Technologies", "ASET", "Strengthened SHS - TechPro"),
    ("sshs-construction", "Construction and Building Technologies", "CBT", "Strengthened SHS - TechPro"),
    ("sshs-creative", "Creative Arts and Design Technologies", "CADT", "Strengthened SHS - TechPro"),
    ("sshs-hospitality", "Hospitality and Tourism", "HT", "Strengthened SHS - TechPro"),
    ("sshs-ict", "ICT Support and Computer Programming Technologies", "ICT", "Strengthened SHS - TechPro"),
    ("sshs-industrial", "Industrial Technologies", "IT", "Strengthened SHS - TechPro"),
    ("sshs-maritime", "Maritime Transport", "Maritime", "Strengthened SHS - TechPro"),
]


def main() -> None:
    rows = dedupe([*basic_education_rows(), *psced_rows(), *tesda_rows()])
    write_seed(rows)
    counts = {level: sum(1 for row in rows if row["level"] == level) for level in dict.fromkeys(row["level"] for row in rows)}
    print(f"wrote {len(rows)} programs {counts} to {OUTPUT.relative_to(ROOT)}")


def fetch(name: str, url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists() or path.stat().st_size == 0:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=180) as response:
            path.write_bytes(response.read())
        time.sleep(0.5)
    return path.read_text(encoding="utf-8", errors="replace")


def basic_education_rows() -> list[dict[str, str]]:
    return [row(code=code, level=level, name=name, short=short, group=group)
            for level, items in (("junior_high", JUNIOR_HIGH), ("senior_high", SENIOR_HIGH))
            for code, name, short, group in items]


def psced_rows() -> list[dict[str, str]]:
    """Each examples table sits inside its detailed field's cell; the field code follows the cell."""
    page = fetch("psced-detailed.html", PSCED_URL)
    rows = []
    for match in re.finditer(r"<table id='psced'>(.*?)</table>\s*</td>\s*<td>\s*(\d{5})\s*</td>", page, re.S):
        body, code = match.groups()
        level = PSCED_LEVELS.get(code[0])
        if not level:
            continue
        before = page[:match.start()]
        headings = [clean(text) for text in re.findall(r"<strong>(.*?)</strong>", before[-6000:], re.S)]
        field = next((text for text in reversed(headings) if not re.match(r"(?i)examples? of programs", text)), "")
        for cell in re.findall(r"<tr>\s*<td>(.*?)</td>", body, re.S):
            name = clean(cell)
            if name and name.lower() != "program":
                rows.append(row(code=program_code(level, name), level=level, name=name, short=program_acronym(name), group=field))
    return rows


def tesda_rows() -> list[dict[str, str]]:
    rows, page = [], 1
    while page <= 60:
        text = fetch(f"tesda-{page}.html", TESDA_URL.format(page=page))
        names = [clean(name) for name in re.findall(r'<td class="uppercase"[^>]*>(.*?)</td>', text, re.S)]
        names = [name for name in names if name]
        if not names:
            break
        for name in names:
            if "superseded" not in name.lower():
                rows.append(row(code=program_code("technical_vocational", name), level="technical_vocational", name=name,
                                short=program_acronym(name), group="TESDA qualification"))
        page += 1
    return rows


def row(*, code: str, level: str, name: str, short: str, group: str) -> dict[str, str]:
    return {"code": code, "level": level, "name": name, "short_name": short, "group_name": group}


def clean(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text)).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip(" ;,")
    return text.title() if text.isupper() and len(text) > 6 else text


def program_acronym(name: str) -> str:
    """Initials of the significant words; a TESDA level stays spelled out ("CSS NC II")."""
    level = re.search(r"\bNC\s+(I{1,3}|IV)\b", name)
    base = name[:level.start()] + name[level.end():] if level else name
    words = [word for word in re.findall(r"[A-Za-z]+", base) if word.lower() not in MINOR_WORDS]
    initials = "".join(word[0].upper() for word in words) if 2 <= len(words) <= 8 else ""
    return f"{initials} NC {level.group(1)}".strip() if level else initials


def program_code(level: str, name: str) -> str:
    prefix = {"undergraduate": "ug", "graduate": "gr", "technical_vocational": "tv"}[level]
    return f"{prefix}-" + hashlib.sha1(f"{level}|{name.casefold()}".encode("utf-8")).hexdigest()[:10]


def dedupe(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: dict[tuple[str, str], dict[str, str]] = {}
    for item in rows:
        seen.setdefault((item["level"], item["name"].casefold()), item)
    unique_codes: dict[str, dict[str, str]] = {}
    for item in seen.values():
        unique_codes.setdefault(item["code"], item)
    return sorted(unique_codes.values(), key=lambda item: (item["level"], item["group_name"].lower(), item["name"].lower()))


def write_seed(rows: list[dict[str, str]]) -> None:
    lines = ["\t".join(COLUMNS)] + ["\t".join(item[column].replace("\t", " ") for column in COLUMNS) for item in rows]
    with open(OUTPUT, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as out:
        out.write(("\n".join(lines) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
