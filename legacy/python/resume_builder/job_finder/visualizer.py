"""Local-only DOM overlay for inspecting AI-authored job-finder rules."""

from __future__ import annotations

import html as html_lib
import re

import lxml.html

from .models import JobListingAction, JobListingRule, LearnedJobListingLayout
from .rule_executor import _select

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)

_ROLE_VISUALS: dict[JobListingAction, tuple[str, str]] = {
    JobListingAction.IGNORE: ("ignore", "IGNORE"),
    JobListingAction.JOB_CARD: ("extract-crawl", "EXTRACT + CRAWL"),
    JobListingAction.JOB_DETAIL_LINK: ("crawl", "CRAWL"),
    JobListingAction.NEXT_PAGE: ("crawl", "CRAWL NEXT"),
    JobListingAction.FILTER_CONTROL: ("interact", "INTERACT"),
    JobListingAction.SEARCH_INPUT: ("interact", "FILL"),
    JobListingAction.SUBMIT_SEARCH: ("click", "CLICK"),
    JobListingAction.JOB_DESCRIPTION: ("extract", "EXTRACT"),
    JobListingAction.APPLY_LINK: ("human", "HUMAN GATE"),
    JobListingAction.SIGN_IN_STATUS: ("auth", "AUTH CHECK"),
    JobListingAction.OPEN_DETAIL: ("click", "CLICK DETAIL"),
    JobListingAction.DETAIL_PANEL: ("extract", "EXTRACT PANEL"),
    JobListingAction.INTERACT: ("click", "CLICK"),
}


def _visual_for(rule: JobListingRule) -> tuple[str, str]:
    visual, label = _ROLE_VISUALS[rule.role]
    if rule.role == JobListingAction.JOB_CARD and not (
        rule.extract and rule.extract.detail_url
    ):
        return "extract", "EXTRACT"
    return visual, label


def sanitize_debug_dom(html: str) -> str:
    """Remove executable and sensitive form state before writing a debug snapshot."""

    try:
        root = lxml.html.fromstring(html)
    except Exception:
        return ""
    for node in list(
        root.xpath(
            "//script|//noscript|//iframe|//object|//embed|"
            "//svg[@aria-hidden='true']|//img[@alt='']"
        )
    ):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)
    for node in root.iter():
        if not isinstance(node.tag, str):
            continue
        for attribute in list(node.attrib):
            lowered = attribute.lower()
            if lowered.startswith("on") or lowered in {
                "value",
                "action",
                "formaction",
                "srcdoc",
                "integrity",
                "nonce",
            }:
                del node.attrib[attribute]
            else:
                node.attrib[attribute] = _EMAIL.sub("[redacted-email]", node.attrib[attribute])
        if node.text:
            node.text = _EMAIL.sub("[redacted-email]", node.text)
        if node.tail:
            node.tail = _EMAIL.sub("[redacted-email]", node.tail)
    return lxml.html.tostring(root, encoding="unicode")


def render_rule_overlay(html: str, layout: LearnedJobListingLayout) -> str:
    """Render the captured DOM with badges from the exact executable rule set."""

    sanitized = sanitize_debug_dom(html)
    try:
        root = lxml.html.fromstring(sanitized)
    except Exception:
        root = lxml.html.fromstring("<main><p>Rendered DOM was unavailable.</p></main>")

    rows: list[str] = []
    for rule in layout.rules:
        visual, label = _visual_for(rule)
        matches = _select(root, rule.selector)
        for node in matches:
            classes = (node.get("class") or "").split()
            classes.extend(name for name in ("codex-tagged", f"codex-{visual}") if name not in classes)
            node.set("class", " ".join(classes))
            node.set("data-codex-label", label)
            node.set("data-codex-role", rule.role.value)
            node.set("data-codex-reason", rule.reason)
        rows.append(
            "<tr>"
            f"<td><span class='legend-pill codex-{visual}'>{html_lib.escape(label)}</span></td>"
            f"<td><code>{html_lib.escape(rule.selector)}</code></td>"
            f"<td>{html_lib.escape(rule.role.value)}</td>"
            f"<td>{len(matches)}</td>"
            f"<td>{html_lib.escape(rule.reason)}</td>"
            "</tr>"
        )

    body = lxml.html.tostring(root, encoding="unicode")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
:root{{--ignore:#dc2626;--crawl:#2563eb;--extract:#15803d;--extract-crawl:#7c3aed;--interact:#d97706;--click:#c2410c;--human:#be123c;--auth:#475569}}
*{{box-sizing:border-box}}body{{margin:0;padding:18px;background:#f8fafc;color:#172033;font-family:Arial,sans-serif}}
.overlay-header{{position:sticky;top:0;z-index:9999;margin:-18px -18px 22px;padding:14px 18px;background:#111827;color:white;box-shadow:0 3px 12px #0004}}
.overlay-header h1{{margin:0 0 8px;font-size:18px}}.legend{{display:flex;flex-wrap:wrap;gap:6px}}
.legend-pill{{display:inline-flex;padding:3px 7px;border:2px solid currentColor;background:white;font-size:10px;font-weight:800}}
.codex-ignore{{--codex-color:var(--ignore);color:var(--ignore)}}.codex-crawl{{--codex-color:var(--crawl);color:var(--crawl)}}
.codex-extract{{--codex-color:var(--extract);color:var(--extract)}}.codex-extract-crawl{{--codex-color:var(--extract-crawl);color:var(--extract-crawl)}}
.codex-interact{{--codex-color:var(--interact);color:var(--interact)}}.codex-click{{--codex-color:var(--click);color:var(--click)}}
.codex-human{{--codex-color:var(--human);color:var(--human)}}.codex-auth{{--codex-color:var(--auth);color:var(--auth)}}
.codex-tagged{{position:relative;outline:3px solid var(--codex-color)!important;outline-offset:2px;box-shadow:0 0 0 6px color-mix(in srgb,var(--codex-color) 15%,transparent)!important}}
.codex-tagged::before{{content:attr(data-codex-label);position:absolute;z-index:9998;top:-17px;left:5px;padding:2px 6px;border-radius:2px;background:var(--codex-color);color:white;font:800 10px/1.25 Arial;white-space:nowrap;pointer-events:none}}
.source-dom{{padding:12px;background:white;border:1px solid #cbd5e1}}table{{width:100%;margin-top:24px;border-collapse:collapse;background:white;font-size:12px}}th,td{{padding:8px;border:1px solid #cbd5e1;text-align:left;vertical-align:top}}th{{background:#e2e8f0}}
</style></head><body>
<header class="overlay-header"><h1>AI DOM decisions · {html_lib.escape(layout.domain)}</h1><div class="legend">
<span class="legend-pill codex-click">CLICK</span><span class="legend-pill codex-interact">FILL / INTERACT</span><span class="legend-pill codex-extract">EXTRACT</span><span class="legend-pill codex-crawl">CRAWL</span><span class="legend-pill codex-extract-crawl">EXTRACT + CRAWL</span><span class="legend-pill codex-ignore">IGNORE</span><span class="legend-pill codex-human">HUMAN GATE</span>
</div></header><main class="source-dom">{body}</main>
<table><thead><tr><th>Decision</th><th>Selector</th><th>Rule role</th><th>Matches</th><th>Reason</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
</body></html>"""
