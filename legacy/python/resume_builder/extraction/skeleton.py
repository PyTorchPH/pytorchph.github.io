from __future__ import annotations

import hashlib
import re

import lxml.html

_SKELETON_TEXT_MAX = 40


def _parse(html: str):
    try:
        return lxml.html.fromstring(html)
    except Exception:
        return None


def build_skeleton(html: str, max_nodes: int = 400) -> str:
    """Compact structural outline: tag + #id/.class/[role], text stripped/truncated."""
    root = _parse(html)
    if root is None:
        return ""
    lines: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        token = el.tag
        if el.get("id"):
            token += f"#{el.get('id')}"
        cls = el.get("class")
        if cls:
            token += "." + ".".join(cls.split()[:3])
        if el.get("role"):
            token += f"[role={el.get('role')}]"
        text = (el.text or "").strip()
        if text:
            snippet = text[:_SKELETON_TEXT_MAX] + ("…" if len(text) > _SKELETON_TEXT_MAX else "")
            token += f"  «{snippet}»"
        lines.append(token)
        if len(lines) >= max_nodes:
            break
    return "\n".join(lines)


def template_fingerprint(html: str, max_nodes: int = 200) -> str:
    """Hash stable template landmarks, ignoring page-specific DOM variation."""
    root = _parse(html)
    if root is None:
        return "empty"
    parts: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        depth = len(list(el.iterancestors()))
        structural = depth <= 1 or tag in {"body", "header", "nav", "main", "article", "footer"}
        if not structural:
            continue
        parts.add(tag)
        element_id = el.get("id") or ""
        if _stable_dom_token(element_id):
            parts.add(f"{tag}#{element_id}")
        for cls in (el.get("class") or "").split():
            if _stable_dom_token(cls):
                parts.add(f"{tag}.{cls}")
        role = el.get("role") or ""
        if role:
            parts.add(f"{tag}[role={role}]")
        if len(parts) >= max_nodes:
            break
    return hashlib.sha1("|".join(sorted(parts)).encode("utf-8")).hexdigest()


_VOLATILE_DOM_TOKEN = re.compile(
    r"(?:^|[-_])(active|current|selected|open|closed|focus|hover|page-id|postid|parent-pageid)"
    r"(?:$|[-_])|^[0-9]+$|[0-9a-f]{8}-[0-9a-f-]{27,}$|[0-9]{4,}",
    re.IGNORECASE,
)


def _stable_dom_token(value: str) -> bool:
    return bool(value) and len(value) <= 80 and not _VOLATILE_DOM_TOKEN.search(value)
