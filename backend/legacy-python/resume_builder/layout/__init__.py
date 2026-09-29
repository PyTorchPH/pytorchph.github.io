"""Layout-awareness helpers.

The renderers emit *flowing* documents (HTML/LaTeX) that have no inherent notion
of "did this overflow the page". This package adds a measurement pass so callers
can know — deterministically — how many pages a rendered resume occupies and
whether any block bleeds across a page boundary.
"""

from .bounds import (
    A4_HEIGHT_MM,
    A4_WIDTH_MM,
    BlockBounds,
    BoundsReport,
    analyze_html_bounds,
    page_content_height_px,
    straddles_boundary,
)

__all__ = [
    "A4_HEIGHT_MM",
    "A4_WIDTH_MM",
    "BlockBounds",
    "BoundsReport",
    "analyze_html_bounds",
    "page_content_height_px",
    "straddles_boundary",
]
