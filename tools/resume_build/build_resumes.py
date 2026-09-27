"""Build one role-targeted resume per role (static mode), enriched with the
structured LinkedIn profile (contact + education) and the vision-extracted FB +
LinkedIn achievements that the live social scraper can't reliably produce.

Why this harness instead of `resume-build build --social`:
- The static synthesizer only parses contact/education from LaTeX `\\name{}`/`\\section{}`
  markup; our input is a PDF, so those come up empty. We fill them from out/data/linkedin.json.
- The pipeline's `--social` path re-scrapes live and overwrites achievements with a flaky
  result; we inject our curated achievements directly instead.

Run: python tools/resume_build/build_resumes.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

# --- bootstrap: locate repo root, make src/ and tools/ importable ---
ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "legacy" / "python"))
from social_scraping.common.paths import DATA, RESUMES  # noqa: E402

# Personal values come from the environment / .env (gitignored), never hardcoded.
GH_USER = os.environ.get("RESUME_GH_USER") or "your-github-username"
DOCS = Path(os.environ.get("RESUME_DOCS") or (ROOT / "private" / "cv.pdf"))
# Render the design formats; the PDF is produced from the polished HTML via headless
# Chromium (print CSS / A4) instead of the basic reportlab path.
FORMATS = ["html", "latex", "md", "json"]
ROLES = ["cybersecurity-redteam", "cybersecurity-blueteam", "fullstack-web", "ml-engineer"]

FB = DATA / "facebook.json"
LI = DATA / "linkedin.json"


def _say(m: str) -> None:
    print(m, flush=True)


def _combined_achievements():
    from resume_builder.core.models import ResumeAchievement

    items: list[ResumeAchievement] = []
    if FB.exists():
        d = json.loads(FB.read_text(encoding="utf-8"))
        for p in d.get("posts", []):
            if not p.get("is_achievement"):
                continue
            text = (p.get("text") or "").strip()
            title = text.split(".")[0][:120] if text else "Facebook post"
            items.append(
                ResumeAchievement(
                    title=title,
                    source="facebook",
                    url=p.get("url", ""),
                    date=None,
                    snippet=text[:400],
                )
            )
    if LI.exists():
        d = json.loads(LI.read_text(encoding="utf-8"))
        for h in d.get("honors_awards", []):
            snippet = h.get("note", "") or ""
            cred = h.get("credential_id")
            if cred:
                snippet = (snippet + f" (Credential ID: {cred})").strip()
            items.append(
                ResumeAchievement(
                    title=h.get("title", "")[:120],
                    source="linkedin",
                    url=d.get("url", ""),
                    date=h.get("date"),
                    snippet=snippet[:400] or h.get("issuer", ""),
                )
            )
    return items


def _linkedin_profile() -> dict:
    return json.loads(LI.read_text(encoding="utf-8")) if LI.exists() else {}


def _html_to_pdf(html_pdf_pairs: list[tuple[Path, Path]]) -> None:
    """Convert each polished resume.html to resume.pdf via headless Chromium, honoring
    the template's print CSS (@page A4 + margins). One browser for all resumes."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for html_path, pdf_path in html_pdf_pairs:
            if not html_path.exists():
                _say(f"[pdf] skip (no html): {html_path}")
                continue
            page.goto(html_path.resolve().as_uri(), wait_until="networkidle")
            page.emulate_media(media="print")
            page.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True)
            _say(f"[pdf] {pdf_path.relative_to(ROOT).as_posix()}")
        browser.close()


def _enrich_contact(resume, li: dict) -> None:
    """Fill contact gaps from LinkedIn (the PDF parse yields no name)."""
    c = resume.contact
    if not c.name and li.get("name"):
        c.name = li["name"]
    if not c.linkedin and li.get("url"):
        c.linkedin = li["url"]
    if not c.github:
        c.github = f"https://github.com/{GH_USER}"
    if not c.location and li.get("location"):
        c.location = li["location"]


def _education_from_li(li: dict):
    from resume_builder.core.models import ResumeEducation

    out = []
    for e in li.get("education", []):
        degree = e.get("degree", "") or ""
        out.append(
            ResumeEducation(
                school=e.get("school", ""),
                degree=degree,
                start=e.get("start"),
                end=e.get("end"),
            )
        )
    return out


def main() -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    from resume_builder.core.models import Mode
    from resume_builder.orchestration.pipeline import BuildInputs, Pipeline

    achievements = _combined_achievements()
    li = _linkedin_profile()
    li_education = _education_from_li(li)
    _say(
        f"[build] injecting {len(achievements)} achievements + "
        f"{len(li_education)} LinkedIn education entries into every resume"
    )

    summary = []
    html_pdf_pairs: list[tuple[Path, Path]] = []
    for role in ROLES:
        out_dir = RESUMES / role
        out_dir.mkdir(parents=True, exist_ok=True)
        _say(f"\n[build] === role: {role} ===")
        try:
            pipeline = Pipeline(mode=Mode.STATIC)
            inputs = BuildInputs(
                gh_user=GH_USER,
                role_selection=role,
                docs_path=DOCS if DOCS.exists() else None,
                formats=FORMATS,
                output_dir=out_dir,
                social_config_path=None,  # no live scrape — we inject instead
            )
            result = pipeline.run(inputs)
            resume = result.resume
            # Enrich with structured LinkedIn data + curated achievements, then re-render.
            _enrich_contact(resume, li)
            if li_education and not resume.education:
                resume.education = li_education
            resume.achievements = achievements
            paths = pipeline.render_only(resume, FORMATS, out_dir)
            _say(
                f"[build] {role}: name={resume.contact.name!r}, "
                f"{len(resume.projects)} projects, {len(resume.education)} education, "
                f"{len(achievements)} achievements"
            )
            for pth in paths:
                _say(f"[build]    -> {pth}")
            html_pdf_pairs.append((out_dir / "resume.html", out_dir / "resume.pdf"))
            summary.append((role, len(resume.projects), len(paths)))
        except Exception as exc:  # noqa: BLE001
            _say(f"[build] {role} FAILED: {exc!r}")
            summary.append((role, -1, 0))

    # Produce the polished PDF for every resume directly from its HTML (Chromium print).
    _say("\n[build] rendering polished PDFs from HTML (headless Chromium)...")
    try:
        _html_to_pdf(html_pdf_pairs)
    except Exception as exc:  # noqa: BLE001
        _say(f"[build] HTML->PDF conversion failed: {exc!r}")

    _say("\n[build] DONE")
    for role, proj, n in summary:
        status = "OK" if proj >= 0 else "FAIL"
        _say(f"[build]   {status:4} {role}: projects={proj} files={n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
