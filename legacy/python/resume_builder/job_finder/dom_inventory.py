from __future__ import annotations

import hashlib
import re
from urllib.parse import urljoin

import lxml.html

from resume_builder.extraction.skeleton import _stable_dom_token


def _parse(html: str):
    try:
        return lxml.html.fromstring(html)
    except Exception:
        return None


def _selector(el) -> str:
    tag = str(el.tag).lower()
    if el.get("id"):
        return f"{tag}#{el.get('id')}"
    classes = (el.get("class") or "").split()
    if classes:
        return f"{tag}.{classes[0]}"
    if el.get("name"):
        return f"{tag}[name={el.get('name')}]"
    if el.get("role"):
        return f"{tag}[role={el.get('role')}]"
    return tag


def _clean_text(value: str, limit: int = 140) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit]


def _label_for(root, el) -> str:
    element_id = el.get("id")
    if element_id:
        labels = root.xpath(f"//label[@for={element_id!r}]")
        if labels:
            return _clean_text(labels[0].text_content(), 80)
    parent = el.getparent()
    while parent is not None:
        if getattr(parent, "tag", "").lower() == "label":
            return _clean_text(parent.text_content(), 80)
        parent = parent.getparent()
    return ""


def build_listing_dom_inventory(html: str, base_url: str, max_nodes: int = 500) -> str:
    """Compact observation for job-listing pages.

    This is intentionally separate from the resume scraper inventory. Job
    discovery needs listing-card, pagination, filter, and search-control signals
    rather than generic extraction/crawl regions.
    """

    root = _parse(html)
    if root is None:
        return ""
    lines: list[str] = []
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        attrs: list[str] = []
        for name in (
            "id",
            "class",
            "role",
            "name",
            "type",
            "placeholder",
            "aria-label",
            "data-testid",
            "data-automation",
            "tabindex",
            "onclick",
            "aria-expanded",
            "aria-controls",
            "data-url",
        ):
            if el.get(name):
                attrs.append(f"{name}={el.get(name)!r}")
        if tag in {"input", "select", "textarea", "button"}:
            label = _label_for(root, el)
            if label:
                attrs.append(f"label={label!r}")
        if tag == "select":
            options = [_clean_text(option.text_content(), 40) for option in el.iter("option")]
            if options:
                attrs.append(f"options={options[:8]!r}")

        text = _clean_text(el.text_content())
        role = (el.get("role") or "").lower()
        class_tokens = " ".join((el.get("class") or "").lower().split())
        click_signal = (
            tag in {"button", "summary"}
            or role in {"button", "tab", "option", "menuitem", "treeitem"}
            or el.get("onclick") is not None
            or el.get("aria-expanded") is not None
            or el.get("aria-controls") is not None
            or (el.get("tabindex") or "") in {"0", "1"}
            or any(token in class_tokens for token in ("click", "card", "tab", "accordion", "expand"))
        )
        anchors = [el] if tag == "a" else list(el.iterdescendants("a"))
        link_samples: list[str] = []
        for anchor in anchors[:8]:
            href = anchor.get("href")
            if href:
                name = _clean_text(anchor.text_content(), 80) or "(no text)"
                link_samples.append(f"{name!r}->{urljoin(base_url, href)}")

        line = f"selector={_selector(el)!r} tag={tag!r}"
        if click_signal and tag != "a":
            line += " interaction='click_candidate'"
        if attrs:
            line += " " + " ".join(attrs)
        if text:
            line += f" text={text!r}"
        if link_samples:
            line += f" descendant_links={len(link_samples)} samples=[{', '.join(link_samples)}]"
        lines.append(line)
        if len(lines) >= max_nodes:
            break
    return "\n".join(lines)


def fingerprint(html: str) -> str:
    """Stable layout cache key for job-listing pages."""

    root = _parse(html)
    if root is None:
        return "empty"
    vocab: set[str] = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        element_id = el.get("id") or ""
        if _stable_dom_token(element_id):
            vocab.add(f"{tag}#{element_id}")
        for cls in (el.get("class") or "").split():
            if _stable_dom_token(cls):
                vocab.add(f"{tag}.{cls}")
        for attr in ("role", "name", "type", "data-testid", "data-automation"):
            value = el.get(attr) or ""
            if _stable_dom_token(value):
                vocab.add(f"{tag}[{attr}={value}]")
    if not vocab:
        vocab = {el.tag.lower() for el in root.iter() if isinstance(el.tag, str)}
    return hashlib.sha1("|".join(sorted(vocab)).encode("utf-8")).hexdigest()
