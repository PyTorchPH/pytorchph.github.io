"""Local debug overlay for executable application DOM rules."""

from __future__ import annotations

import html as html_lib

import lxml.html

from resume_builder.job_finder.rule_executor import _select
from resume_builder.job_finder.visualizer import sanitize_debug_dom

from .models import ApplicationDomRule, DynamicApplicationPlan

_VISUALS = {
    "questionnaire_container": ("container", "QUESTIONNAIRE"),
    "question_field": ("field", "QUESTION FIELD"),
    "resume_choice": ("resume", "RESUME CHOICE"),
    "resume_upload": ("human", "RESUME UPLOAD · HUMAN"),
    "work_mode_choice": ("choice", "WORK MODE"),
    "extract": ("extract", "EXTRACT"),
    "click": ("click", "CLICK"),
    "continue_review": ("review", "REVIEW BEFORE CONTINUE"),
    "final_submit": ("human", "FINAL SUBMIT · HUMAN"),
    "ignore": ("ignore", "IGNORE"),
    "auth_check": ("auth", "AUTH CHECK"),
}


def _annotate(root, rule: ApplicationDomRule) -> int:
    visual, label = _VISUALS[rule.role]
    matches = _select(root, rule.selector)
    for node in matches:
        classes = (node.get("class") or "").split()
        classes.extend(name for name in ("app-tagged", f"app-{visual}") if name not in classes)
        node.set("class", " ".join(classes))
        node.set("data-app-label", label)
        node.set("data-app-role", rule.role)
        node.set("data-app-human", str(rule.requires_human).lower())
        node.set("data-app-purpose", rule.purpose)
        if rule.include_descendants:
            for descendant in node.iterdescendants():
                if not isinstance(descendant.tag, str):
                    continue
                descendant_classes = (descendant.get("class") or "").split()
                if "app-contained" not in descendant_classes:
                    descendant_classes.append("app-contained")
                descendant.set("class", " ".join(descendant_classes))
    return len(matches)


def render_application_overlay(html: str, plan: DynamicApplicationPlan) -> str:
    sanitized = sanitize_debug_dom(html)
    root = lxml.html.fromstring(sanitized or "<main><p>DOM unavailable.</p></main>")
    rows = []
    for rule in plan.dom_rules:
        visual, label = _VISUALS[rule.role]
        count = _annotate(root, rule)
        rows.append(
            "<tr>"
            f"<td><span class='pill app-{visual}'>{html_lib.escape(label)}</span></td>"
            f"<td><code>{html_lib.escape(rule.selector)}</code></td>"
            f"<td>{count}</td><td>{html_lib.escape(rule.purpose)}</td>"
            "</tr>"
        )
    body = lxml.html.tostring(root, encoding="unicode")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
:root{{--container:#7c3aed;--field:#d97706;--resume:#0369a1;--human:#be123c;--choice:#0f766e;--extract:#15803d;--click:#c2410c;--review:#b45309;--ignore:#dc2626;--auth:#475569}}
*{{box-sizing:border-box}}body{{margin:0;padding:18px;background:#f8fafc;color:#172033;font-family:Arial,sans-serif}}.bar{{position:sticky;top:0;z-index:9999;margin:-18px -18px 22px;padding:14px 18px;background:#111827;color:#fff}}.bar h1{{margin:0 0 8px;font-size:18px}}.legend{{display:flex;flex-wrap:wrap;gap:6px}}.pill{{display:inline-flex;padding:3px 7px;border:2px solid currentColor;background:#fff;font-size:10px;font-weight:800}}.app-container{{--app-color:var(--container);color:var(--container)}}.app-field{{--app-color:var(--field);color:var(--field)}}.app-resume{{--app-color:var(--resume);color:var(--resume)}}.app-human{{--app-color:var(--human);color:var(--human)}}.app-choice{{--app-color:var(--choice);color:var(--choice)}}.app-extract{{--app-color:var(--extract);color:var(--extract)}}.app-click{{--app-color:var(--click);color:var(--click)}}.app-review{{--app-color:var(--review);color:var(--review)}}.app-ignore{{--app-color:var(--ignore);color:var(--ignore)}}.app-auth{{--app-color:var(--auth);color:var(--auth)}}.app-tagged{{position:relative;outline:3px solid var(--app-color)!important;outline-offset:2px;box-shadow:0 0 0 6px color-mix(in srgb,var(--app-color) 14%,transparent)!important}}.app-tagged::before{{content:attr(data-app-label);position:absolute;z-index:9998;top:-17px;left:5px;padding:2px 6px;background:var(--app-color);color:#fff;font:800 10px Arial;white-space:nowrap}}.app-contained{{border-left:1px dashed color-mix(in srgb,var(--container) 45%,transparent)}}.dom{{padding:12px;background:#fff;border:1px solid #cbd5e1}}table{{width:100%;margin-top:24px;border-collapse:collapse;background:#fff;font-size:12px}}th,td{{padding:8px;border:1px solid #cbd5e1;text-align:left;vertical-align:top}}th{{background:#e2e8f0}}
</style></head><body><header class="bar"><h1>Application DOM decisions · {html_lib.escape(plan.root_domain)}</h1><div class="legend"><span class="pill app-container">QUESTIONNAIRE</span><span class="pill app-field">QUESTION FIELD</span><span class="pill app-resume">RESUME CHOICE</span><span class="pill app-human">HUMAN GATE</span><span class="pill app-choice">WORK MODE</span></div></header><main class="dom">{body}</main><table><thead><tr><th>Decision</th><th>Selector</th><th>Matches</th><th>Purpose</th></tr></thead><tbody>{''.join(rows)}</tbody></table></body></html>"""
