from __future__ import annotations

import re

import lxml.html

from ..classification.industry import ExtractionRule
from ..llm.base import LLMProvider
from .skeleton import build_skeleton, template_fingerprint

_SEL_RE = re.compile(
    r"^(?P<tag>[a-zA-Z0-9]+)?(?:#(?P<id>[\w-]+))?(?:\.(?P<cls>[\w-]+))?(?:\[role=(?P<role>[\w-]+)\])?$"
)


def _parse(html: str):
    try:
        return lxml.html.fromstring(html)
    except Exception:
        return None


def _matches(el, selector: str) -> bool:
    m = _SEL_RE.match(selector.strip())
    if not m or not isinstance(el.tag, str):
        return False
    g = m.groupdict()
    if not any(g.values()):
        return False
    if g["tag"] and el.tag.lower() != g["tag"].lower():
        return False
    if g["id"] and el.get("id") != g["id"]:
        return False
    if g["cls"] and g["cls"] not in (el.get("class") or "").split():
        return False
    if g["role"] and el.get("role") != g["role"]:
        return False
    return True


_BLOCK_TAGS = {
    "p", "div", "li", "ul", "ol", "section", "article", "header", "footer",
    "main", "nav", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
    "blockquote", "table", "tr", "td",
}


def _el_text(el) -> str:
    return " ".join(t.strip() for t in el.itertext() if t.strip())


def _block_lines(root) -> list[str]:
    """One de-duplicated line of visible text per block element, in document order."""
    lines: list[str] = []
    seen: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str) or el.tag not in _BLOCK_TAGS:
            continue
        txt = _el_text(el)
        if txt and txt not in seen:  # dedupe parent/child blocks that repeat the same text
            lines.append(txt)
            seen.add(txt)
    return lines


def apply_rules(html: str, rule: ExtractionRule) -> str:
    """Deterministically reduce HTML to text using an ExtractionRule. Never raises."""
    root = _parse(html)
    if root is None:
        return ""
    for el in list(root.iter()):
        if isinstance(el.tag, str) and any(_matches(el, s) for s in rule.drop_selectors):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    if rule.keep_selectors:
        kept = [
            el for el in root.iter()
            if isinstance(el.tag, str) and any(_matches(el, s) for s in rule.keep_selectors)
        ]
        text = "\n".join(t for t in (_el_text(el) for el in kept) if t)
    else:
        text = "\n".join(_block_lines(root))
    if rule.keep_regex:
        pats = []
        for pattern in rule.keep_regex:
            try:
                pats.append(re.compile(pattern))
            except re.error:
                continue  # skip malformed patterns; never raise
        if pats:
            text = "\n".join(ln for ln in text.splitlines() if any(p.search(ln) for p in pats))
    return text.strip()


_ENGINE_SYSTEM = (
    "You reduce a web page to its main content for downstream resume tagging. Given a DOM "
    "SKELETON (tags + #id/.class/[role], text stripped), return keep_selectors, drop_selectors, "
    "and keep_regex that retain the primary article/project/README content and DROP headers, "
    "navbars, footers, cookie/CTA banners, and repeated site chrome. Selectors use a simple "
    "subset only: tag, .class, #id, [role=value], or tag.class. Be concise."
)


class ExtractionRuleEngine:
    """AI rule generator with a per-template-fingerprint cache."""

    def __init__(self, llm: LLMProvider, cache: dict | None = None) -> None:
        self._llm = llm
        self._cache: dict = cache if cache is not None else {}

    def rules_for(self, source_id: str, html: str) -> ExtractionRule:
        fp = template_fingerprint(html)
        cached = self._cache.get(fp)
        if cached is not None:
            return cached.model_copy(update={"source_id": source_id})
        skeleton = build_skeleton(html)
        prompt = (
            f"source_id: {source_id}\n\nDOM SKELETON:\n{skeleton}\n\n"
            "Return the extraction rule."
        )
        try:
            rule = self._llm.structured(
                prompt, schema=ExtractionRule, system=_ENGINE_SYSTEM, max_tokens=1024
            )
            rule.source_id = source_id
        except Exception:
            rule = ExtractionRule(source_id=source_id)
        self._cache[fp] = rule
        return rule
