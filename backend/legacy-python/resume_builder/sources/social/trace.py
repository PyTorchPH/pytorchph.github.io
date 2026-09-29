"""Debug-only DOM traversal trace for the social scraper.

This is a **diagnostic artifact, NOT part of the system**. The pipeline never reads it. It
is written under the gitignored ``out/_debug/`` directory so a human can verify the scraper
walked exactly the right nodes — i.e. *anong mga div ang dinaanan ng system* and what it
decided to do with each.

One entry per visited node. Decisions:

- ``SCRAPED``           — the post container that was collected.
- ``SKIPPED``           — a node deliberately not collected (e.g. a comment).
- ``RETRIEVED_PICTURE`` — a media node read as a picture.
- ``RETRIEVED_TEXT``    — a caption text node read as text.
- ``PRESERVED``         — a shared post kept as one unit.

The :data:`DESCRIBE_NODE_JS` snippet returns a compact descriptor for a live Playwright
element; the pure-Python :class:`TraceRecorder` is what the test suite exercises offline.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

#: Allowed decision labels. Recording anything else is a programming error.
DECISIONS: frozenset[str] = frozenset(
    {"SCRAPED", "SKIPPED", "RETRIEVED_PICTURE", "RETRIEVED_TEXT", "PRESERVED"}
)

#: JS evaluated against a live element to build one trace descriptor. Returns a plain
#: object; the caller merges it into a :class:`TraceEntry`. Kept here so the selector
#: logic lives next to the trace schema it feeds.
DESCRIBE_NODE_JS = """
el => {
  const cssPath = (n) => {
    const parts = [];
    while (n && n.nodeType === 1 && parts.length < 8) {
      let sel = n.nodeName.toLowerCase();
      if (n.id) { sel += '#' + n.id; parts.unshift(sel); break; }
      const parent = n.parentNode;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.nodeName === n.nodeName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      }
      parts.unshift(sel);
      n = n.parentNode;
    }
    return parts.join('>');
  };
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    css_path: cssPath(el),
    aria_label: el.getAttribute ? el.getAttribute('aria-label') : null,
    src: el.getAttribute ? (el.getAttribute('src') || null) : null,
    text_preview: (el.innerText || '').trim().slice(0, 80) || null,
    rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
  };
}
"""


@dataclass
class TraceEntry:
    """One visited node. ``None`` fields are dropped on serialization."""

    post: int
    role: str
    decision: str
    tag: str | None = None
    css_path: str | None = None
    aria_label: str | None = None
    src: str | None = None
    text_preview: str | None = None
    rect: dict | None = None


@dataclass
class TraceRecorder:
    """Accumulates :class:`TraceEntry` records and serializes them to a debug file."""

    vendor: str
    url: str = ""
    post_selector: str = ""
    visited: list[TraceEntry] = field(default_factory=list)

    def record(self, *, post: int, role: str, decision: str, **descriptor) -> TraceEntry:
        """Append one node. ``descriptor`` may carry tag/css_path/aria_label/src/etc."""
        if decision not in DECISIONS:
            raise ValueError(f"unknown decision {decision!r}; expected one of {sorted(DECISIONS)}")
        allowed = {"tag", "css_path", "aria_label", "src", "text_preview", "rect"}
        unknown = set(descriptor) - allowed
        if unknown:
            raise ValueError(f"unknown descriptor field(s): {sorted(unknown)}")
        entry = TraceEntry(post=post, role=role, decision=decision, **descriptor)
        self.visited.append(entry)
        return entry

    def to_dict(self) -> dict:
        return {
            "run": {
                "vendor": self.vendor,
                "url": self.url,
                "post_selector": self.post_selector,
            },
            "visited": [
                {k: v for k, v in asdict(e).items() if v is not None} for e in self.visited
            ],
        }

    def write(self, out_dir: str | Path | None = None) -> Path:
        """Write ``<vendor>.trace.json``. Defaults to the gitignored ``out/_debug/``."""
        target = Path(out_dir) if out_dir is not None else Path("out") / "_debug"
        target.mkdir(parents=True, exist_ok=True)
        path = target / f"{self.vendor}.trace.json"
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        return path
