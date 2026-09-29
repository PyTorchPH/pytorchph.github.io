"""Subdomain-aware, learn-once planner for dynamic job-application websites."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit

import lxml.html

from resume_builder.extraction.crawler_dom import fingerprint
from resume_builder.llm.base import LLMProvider

from .models import DynamicApplicationPlan, WebsitePageSample

_COMMON_SECOND_LEVEL_SUFFIXES = {"co.uk", "com.au", "com.ph", "co.nz", "co.jp"}

_SYSTEM = """ROLE: dynamic job-application website planner. OUTPUT: strict JSON only.
ACCESS FIRST: classify CAPTCHA/Cloudflare/403/429/login/verification; blocked => human handoff; no bypass.
SAMPLES: compare page roles, subdomains, and layout fingerprints before planning.
INTERACTIONS: emit ordered steps for links AND non-link controls: button, clickable div, role=button,
tab, accordion, expander, modal opener, same-page panel. Every click needs selector + purpose +
expected_change + wait_for_selector when observable. Never invent selectors absent from inventory.
SAFETY: read-only discovery clicks may be replayed. Login and access verification always hand off.
Sensitive judgment, upload confirmation, and final submit require an explicit scoped permission;
final_submit remains marked requires_human=true in the portable plan and may only be bypassed by
the runtime ApplicationPermissionPolicy for the current domain.
FORMS: inventory fields, required documents, validation, SPA state changes, recovery, and page transitions.
DOM RULES: classify the whole form/questionnaire container and every nested field/control. A company
may render one question per component, multiple questions inside one div, or nested sub-divs; emit a
questionnaire_container rule for the reusable parent and question_field rules for every visible
input/select/textarea/radio/checkbox group. Do not assume a fixed question count or fixed wording.
RESUMES: detect saved-resume choices, selected resume state, upload/replace controls, and whether the
site requires a fresh upload. Never invent a saved option. Resume selection/upload is sensitive_write
and requires human preview/approval; final submit always remains a separate human gate.
WORK MODE: preserve the user's explicit remote/hybrid/onsite/any preference as a constraint. Tag any
work-mode choice separately; never infer a different preference from job text.
ACTION CLASSES: classify every step as read_only, draft_write, sensitive_write, or irreversible.
Use click/expand/open to reveal hidden content before inventory-dependent fill steps. Draft writes must
include value_source; never place credentials or cookies in a plan. Permission policy decides execution.
CACHE: plan is reusable only for the same subdomain + layout fingerprint.
"""


def _site_root(hostname: str) -> str:
    parts = hostname.lower().split(".")
    if len(parts) <= 2:
        return hostname.lower()
    suffix2 = ".".join(parts[-2:])
    return ".".join(parts[-3:]) if suffix2 in _COMMON_SECOND_LEVEL_SUFFIXES else suffix2


def _selector(el) -> str:
    tag = str(el.tag).lower()
    if el.get("id"):
        return f"{tag}#{el.get('id')}"
    classes = (el.get("class") or "").split()
    if classes:
        return f"{tag}.{classes[0]}"
    if el.get("name"):
        return f"{tag}[name='{el.get('name')}']"
    if el.get("role"):
        return f"{tag}[role='{el.get('role')}']"
    return tag


def build_application_dom_inventory(html: str, base_url: str, max_nodes: int = 600) -> str:
    """Rendered DOM inventory with explicit click/interact candidates."""

    try:
        root = lxml.html.fromstring(html)
    except Exception:
        return ""
    lines: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        role = (el.get("role") or "").lower()
        classes = " ".join((el.get("class") or "").lower().split())
        attrs = []
        for name in (
            "id", "class", "role", "name", "type", "placeholder", "aria-label",
            "aria-expanded", "aria-controls", "tabindex", "data-testid", "data-automation",
        ):
            if el.get(name):
                attrs.append(f"{name}={el.get(name)!r}")
        clickable = (
            tag in {"a", "button", "summary"}
            or role in {"button", "tab", "option", "menuitem", "treeitem"}
            or el.get("onclick") is not None
            or el.get("aria-expanded") is not None
            or el.get("aria-controls") is not None
            or (el.get("tabindex") or "") in {"0", "1"}
            or any(token in classes for token in ("click", "card", "tab", "accordion", "expand"))
        )
        text = re.sub(r"\s+", " ", el.text_content()).strip()[:140]
        line = f"selector={_selector(el)!r} tag={tag!r}"
        if clickable:
            line += " interaction='click_candidate'"
        if tag in {"input", "select", "textarea"}:
            line += " interaction='field_candidate'"
        if attrs:
            line += " " + " ".join(attrs)
        if text:
            line += f" text={text!r}"
        if tag == "a" and el.get("href"):
            line += f" href={urljoin(base_url, el.get('href'))!r}"
        lines.append(line)
        if len(lines) >= max_nodes:
            break
    return "\n".join(lines)


def sample_subdomain_layouts(
    pages: list[tuple[str, str]], *, max_subdomains: int = 6, max_layouts_per_subdomain: int = 3
) -> list[WebsitePageSample]:
    """Select bounded unique layouts across the seed site's subdomains."""

    if not pages:
        return []
    seed_host = (urlsplit(pages[0][0]).hostname or "").lower()
    root_domain = _site_root(seed_host)
    counts: dict[str, int] = {}
    seen: set[tuple[str, str]] = set()
    samples: list[WebsitePageSample] = []
    for url, html in pages:
        host = (urlsplit(url).hostname or "").lower()
        if _site_root(host) != root_domain:
            continue
        fp = fingerprint(html)
        key = (host, fp)
        if key in seen or counts.get(host, 0) >= max_layouts_per_subdomain:
            continue
        if host not in counts and len(counts) >= max_subdomains:
            continue
        seen.add(key)
        counts[host] = counts.get(host, 0) + 1
        samples.append(
            WebsitePageSample(
                url=url,
                subdomain=host,
                layout_fingerprint=fp,
                dom_inventory=build_application_dom_inventory(html, url),
            )
        )
    return samples


class ApplicationWebsitePlanner:
    def __init__(self, llm: LLMProvider) -> None:
        self.llm = llm

    def plan(self, pages: list[tuple[str, str]], *, objective: str = "fill application draft") -> DynamicApplicationPlan:
        samples = sample_subdomain_layouts(pages)
        prompt = (
            f"OBJECTIVE: {objective}\n"
            "SAMPLED SUBDOMAIN LAYOUTS:\n"
            + "\n\n".join(sample.model_dump_json(indent=2) for sample in samples)
        )
        plan = self.llm.structured(prompt, schema=DynamicApplicationPlan, system=_SYSTEM, max_tokens=4096)
        plan.samples = samples
        if not plan.root_domain and samples:
            plan.root_domain = _site_root(samples[0].subdomain)
        return plan
