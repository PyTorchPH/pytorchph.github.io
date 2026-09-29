from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import lxml.html


OUTPUT_DIR = Path("out/rule-visualizer")

ACTION_LABELS = {
    "ignore": "IGNORE",
    "crawl": "CRAWL",
    "extract": "EXTRACT",
    "extract_and_crawl": "EXTRACT + CRAWL",
}


@dataclass(frozen=True)
class VisualRule:
    selector: str
    action: str
    source_role: str
    reason: str


@dataclass(frozen=True)
class VisualSample:
    slug: str
    title: str
    description: str
    html: str
    rules: tuple[VisualRule, ...]


def _matches(el, selector: str) -> bool:
    selector = selector.strip()
    if not selector or not isinstance(el.tag, str):
        return False
    tag = str(el.tag).lower()
    id_match = re.fullmatch(r"([\w-]+)?#([\w-]+)", selector)
    if id_match:
        return (not id_match.group(1) or tag == id_match.group(1).lower()) and (
            el.get("id") == id_match.group(2)
        )
    class_match = re.fullmatch(r"([\w-]+)?\.([\w-]+)", selector)
    if class_match:
        return (not class_match.group(1) or tag == class_match.group(1).lower()) and (
            class_match.group(2) in (el.get("class") or "").split()
        )
    attr_match = re.fullmatch(r"([\w-]+)?\[([\w:-]+)=['\"]?([^'\"]+)['\"]?\]", selector)
    if attr_match:
        return (not attr_match.group(1) or tag == attr_match.group(1).lower()) and (
            el.get(attr_match.group(2)) == attr_match.group(3)
        )
    return tag == selector.lower()


def _select(root, selector: str):
    selectors = [part.strip() for part in selector.split(",") if part.strip()]
    matches = []
    for el in root.iter():
        if any(_matches(el, part) for part in selectors):
            matches.append(el)
    return matches


def _append_class(el, class_name: str) -> None:
    classes = (el.get("class") or "").split()
    if class_name not in classes:
        classes.append(class_name)
    el.set("class", " ".join(classes))


def _annotate_sample(sample: VisualSample) -> str:
    root = lxml.html.fromstring(sample.html)
    annotations: list[dict[str, str]] = []
    for rule in sample.rules:
        for el in _select(root, rule.selector):
            _append_class(el, "rule-tagged")
            _append_class(el, f"rule-{rule.action}")
            el.set("data-rule-action", rule.action)
            el.set("data-rule-role", rule.source_role)
            el.set("data-rule-reason", rule.reason)
            el.set("data-rule-badge", ACTION_LABELS[rule.action])
            annotations.append(
                {
                    "selector": rule.selector,
                    "action": rule.action,
                    "source_role": rule.source_role,
                    "tag": str(el.tag),
                    "text": " ".join(part.strip() for part in el.itertext() if part.strip())[:120],
                    "reason": rule.reason,
                }
            )

    body = lxml.html.tostring(root, encoding="unicode")
    return _wrap_visual_page(sample, body, annotations)


def _wrap_visual_page(sample: VisualSample, body: str, annotations: list[dict[str, str]]) -> str:
    rows = "\n".join(
        "<tr>"
        f"<td><code>{item['selector']}</code></td>"
        f"<td><span class='legend-pill rule-{item['action']}'>{ACTION_LABELS[item['action']]}</span></td>"
        f"<td>{item['source_role']}</td>"
        f"<td>{item['reason']}</td>"
        "</tr>"
        for item in annotations
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{sample.title}</title>
  <style>
    :root {{
      --ignore: #d64545;
      --crawl: #246bfe;
      --extract: #168a4a;
      --both: #8a4ce8;
      --ink: #1f2937;
      --paper: #f7f7fb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Arial, sans-serif;
      color: var(--ink);
      background: var(--paper);
    }}
    .debug-shell {{
      padding: 24px;
      max-width: 1220px;
      margin: 0 auto;
    }}
    .debug-title {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
      margin-bottom: 18px;
    }}
    h1 {{ margin: 0 0 8px; font-size: 28px; }}
    .debug-title p {{ margin: 0; line-height: 1.5; }}
    .legend {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }}
    .legend-pill {{
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 8px;
      border: 2px solid currentColor;
      background: white;
      font-size: 12px;
      font-weight: 700;
      color: var(--ink);
    }}
    .rule-ignore {{ --rule-color: var(--ignore); color: var(--ignore); }}
    .rule-crawl {{ --rule-color: var(--crawl); color: var(--crawl); }}
    .rule-extract {{ --rule-color: var(--extract); color: var(--extract); }}
    .rule-extract_and_crawl {{ --rule-color: var(--both); color: var(--both); }}
    .sample-frame {{
      background: white;
      border: 1px solid #d7dce5;
      padding: 20px;
      margin: 16px 0 20px;
    }}
    .rule-tagged {{
      position: relative;
      outline: 3px solid var(--rule-color);
      outline-offset: 3px;
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--rule-color) 14%, transparent);
    }}
    .rule-tagged::before {{
      content: attr(data-rule-badge);
      position: absolute;
      z-index: 50;
      top: -17px;
      left: 8px;
      padding: 2px 6px;
      background: var(--rule-color);
      color: white;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      border-radius: 2px;
      letter-spacing: 0;
      pointer-events: none;
      white-space: nowrap;
    }}
    .sample-site header,
    .sample-site footer,
    .sample-site nav,
    .sample-site main,
    .sample-site aside,
    .sample-site article,
    .sample-site section,
    .sample-site form {{
      margin-bottom: 14px;
    }}
    .sample-site header,
    .sample-site footer {{
      background: #eef1f6;
      padding: 12px;
    }}
    .sample-site nav a,
    .sample-site a.button {{
      display: inline-block;
      margin: 4px 8px 4px 0;
      color: #174ea6;
      text-decoration: none;
      font-weight: 700;
    }}
    .sample-site main {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: 18px;
    }}
    .sample-site .card,
    .sample-site .job-card,
    .sample-site .post-card {{
      border: 1px solid #cbd5e1;
      padding: 14px;
      margin-bottom: 12px;
      background: #fff;
    }}
    .sample-site .thumb {{
      width: 92px;
      height: 58px;
      background: #dfe7f4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 8px;
      font-size: 12px;
      color: #475569;
    }}
    .sample-site input,
    .sample-site select,
    .sample-site button {{
      min-height: 34px;
      margin: 4px 6px 4px 0;
      padding: 6px 8px;
    }}
    .annotation-table {{
      width: 100%;
      border-collapse: collapse;
      background: white;
      font-size: 13px;
    }}
    .annotation-table th,
    .annotation-table td {{
      border: 1px solid #d7dce5;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }}
    @media (max-width: 860px) {{
      .debug-title {{ grid-template-columns: 1fr; }}
      .legend {{ justify-content: flex-start; }}
      .sample-site main {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="debug-shell">
    <div class="debug-title">
      <div>
        <h1>{sample.title}</h1>
        <p>{sample.description}</p>
      </div>
      <div class="legend">
        <span class="legend-pill rule-ignore">IGNORE</span>
        <span class="legend-pill rule-crawl">CRAWL</span>
        <span class="legend-pill rule-extract">EXTRACT</span>
        <span class="legend-pill rule-extract_and_crawl">EXTRACT + CRAWL</span>
      </div>
    </div>
    <div class="sample-frame sample-site">
      {body}
    </div>
    <table class="annotation-table">
      <thead><tr><th>Selector</th><th>Visual Tag</th><th>Source Role</th><th>Reason</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  </div>
</body>
</html>
"""


def _scraper_sample() -> VisualSample:
    html = """
<div class="sample-site">
  <header class="shell">
    <strong>Drew Portfolio</strong>
    <nav class="primary">
      <a href="/projects">Projects</a>
      <a href="/achievements">Achievements</a>
      <a href="/posts">Posts</a>
      <a href="/logout">Logout</a>
    </nav>
  </header>
  <main>
    <section class="content-feed">
      <article class="post-card">
        <span class="thumb">image</span>
        <h2><a href="/posts/ai-agent-crawler">AI Agent Crawler</a></h2>
        <p>Built a layout-learning scraper that turns rendered HTML into reusable rules.</p>
      </article>
      <article class="achievement-card">
        <h2>Hackathon Finalist</h2>
        <p>Shipped an AI-assisted regulatory extraction system with validated outputs.</p>
      </article>
      <section class="profile">
        <h2>Profile Summary</h2>
        <p>Software, automation, AI systems, and evidence-backed project delivery.</p>
      </section>
    </section>
    <aside class="sidebar">
      <h3>Sponsored links</h3>
      <a href="/ads">Promoted course</a>
    </aside>
  </main>
  <footer>Copyright, privacy, cookie settings, and repeated boilerplate.</footer>
</div>
"""
    return VisualSample(
        slug="scraper-posts-achievements",
        title="Post/Achievement Scraper Rule Tags",
        description=(
            "Temporary visual check for the generic scraper. The final scraper remains headless; "
            "this page only shows how learned rules would label the rendered DOM."
        ),
        html=html,
        rules=(
            VisualRule(
                "header.shell, footer, aside.sidebar", "ignore", "ignore", "site chrome/noise"
            ),
            VisualRule("nav.primary", "crawl", "crawl", "navigation links can reveal useful pages"),
            VisualRule(
                "article.post-card",
                "extract_and_crawl",
                "extract_and_crawl",
                "post text is useful and its detail link should be followed",
            ),
            VisualRule(
                "article.achievement-card",
                "extract",
                "extract",
                "achievement text is already complete on this page",
            ),
            VisualRule(
                "section.profile", "extract", "extract", "profile summary is useful context"
            ),
        ),
    )


def _job_sample() -> VisualSample:
    html = """
<div class="sample-site">
  <header class="topbar">
    <strong>Sample Careers PH</strong>
    <a href="/candidate/login">Login</a>
  </header>
  <section class="search-panel">
    <input name="keywords" placeholder="Job title, keyword, or company">
    <input name="where" placeholder="Location">
    <select name="workType"><option>Any work type</option><option>Full time</option></select>
    <button class="search-submit">Search</button>
  </section>
  <main>
    <section class="job-results">
      <article class="job-card">
        <h2><a class="job-title" href="/job/backend-engineer">Backend Engineer</a></h2>
        <p><strong>MangoByte PH</strong> · Hybrid · Full time · Makati City</p>
        <p>Own Python services, integrations, and production dashboards.</p>
      </article>
      <article class="job-card">
        <h2><a class="job-title" href="/job/data-engineer">Data Engineer</a></h2>
        <p><strong>MangoByte PH</strong> · Remote · Contract · Philippines</p>
        <p>Build ETL jobs and analytics warehouse models.</p>
      </article>
      <a class="next-page" href="/jobs?page=2">Next page</a>
    </section>
    <aside class="recommendations">
      <h3>People also searched</h3>
      <a href="/salary-guide">Salary guide</a>
    </aside>
  </main>
  <footer>About, terms, privacy, and repeated site links.</footer>
</div>
"""
    return VisualSample(
        slug="job-listing",
        title="Job Finder Rule Tags",
        description=(
            "Temporary visual check for job listing rules. Job cards are treated as "
            "extract_and_crawl because their summary text is useful and their detail links should "
            "be followed. The final job finder should run headlessly."
        ),
        html=html,
        rules=(
            VisualRule(
                "header.topbar, footer, aside.recommendations",
                "ignore",
                "ignore",
                "site chrome/noise",
            ),
            VisualRule(
                "section.search-panel",
                "ignore",
                "filter_control/search_input",
                "controls affect search but are not listing evidence",
            ),
            VisualRule(
                "article.job-card",
                "extract_and_crawl",
                "job_card",
                "listing text is useful and title link should be crawled",
            ),
            VisualRule("a.next-page", "crawl", "next_page", "pagination exposes more listings"),
        ),
    )


def _write_outputs(samples: Iterable[VisualSample], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    html_paths: list[Path] = []
    summary = []
    for sample in samples:
        html = _annotate_sample(sample)
        path = output_dir / f"{sample.slug}.html"
        path.write_text(html, encoding="utf-8")
        html_paths.append(path)
        summary.append(
            {
                "slug": sample.slug,
                "html": str(path),
                "rules": [rule.__dict__ for rule in sample.rules],
            }
        )
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return html_paths


def _screenshot_with_playwright(paths: Iterable[Path], output_dir: Path) -> list[Path]:
    from playwright.sync_api import sync_playwright

    screenshots: list[Path] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1200}, device_scale_factor=1)
            for path in paths:
                page.goto(path.resolve().as_uri(), wait_until="load")
                screenshot = output_dir / f"{path.stem}.png"
                page.screenshot(path=str(screenshot), full_page=True)
                screenshots.append(screenshot)
        finally:
            browser.close()
    return screenshots


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Playwright screenshots for temporary web-rule visual checks."
    )
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--no-screenshot", action="store_true")
    args = parser.parse_args()

    samples = (_scraper_sample(), _job_sample())
    html_paths = _write_outputs(samples, args.output_dir)
    screenshot_paths: list[Path] = []
    if not args.no_screenshot:
        screenshot_paths = _screenshot_with_playwright(html_paths, args.output_dir)

    for path in html_paths:
        print(f"html: {path}")
    for path in screenshot_paths:
        print(f"screenshot: {path}")


if __name__ == "__main__":
    main()
