from __future__ import annotations

from pathlib import Path
from typing import Callable

from .base import Renderer
from .html_renderer import HtmlRenderer
from .json_renderer import JsonRenderer
from .latex_renderer import LatexRenderer
from .markdown_renderer import MarkdownRenderer
from .pdf_renderer import PdfRenderer

RendererFactory = Callable[[Path], Renderer]

RENDERERS: dict[str, RendererFactory] = {
    "json": lambda _templates_dir: JsonRenderer(),
    "md": lambda templates_dir: MarkdownRenderer(templates_dir),
    "markdown": lambda templates_dir: MarkdownRenderer(templates_dir),
    "latex": lambda templates_dir: LatexRenderer(templates_dir),
    "tex": lambda templates_dir: LatexRenderer(templates_dir),
    "pdf": lambda templates_dir: PdfRenderer(templates_dir),
    "html": lambda templates_dir: HtmlRenderer(templates_dir),
}


def get_renderer(format_name: str, templates_dir: Path) -> Renderer:
    key = format_name.lower().strip()
    if key not in RENDERERS:
        raise ValueError(f"Unknown format {format_name!r}. Available: {sorted(set(RENDERERS))}")
    return RENDERERS[key](templates_dir)
