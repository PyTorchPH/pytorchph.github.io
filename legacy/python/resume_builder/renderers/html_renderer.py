"""HTML renderer — a self-contained, print-ready resume page.

Uses standard Jinja2 delimiters with autoescape ON so any user-supplied text is
HTML-escaped (the inline CSS in the template is literal template text and is not
escaped). The output is a single .html file with embedded styles — open it in a
browser and print to PDF for a polished, text-based resume.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from ..core.models import Resume
from .base import Renderer
from . import brand_icons
from .formatting import compact_skills, plan_skill_layout


def _brand_svg_safe(provider: str, size: int = 12) -> Markup:
    """Jinja global: return brand icon HTML so autoescape won't double-escape it."""
    return Markup(brand_icons.html(provider, size))


class HtmlRenderer(Renderer):
    extension = "html"

    def __init__(self, templates_dir: Path, template_name: str = "resume.html.j2") -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(enabled_extensions=("html", "j2"), default=True),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        # Register brand icon helpers as template globals
        self._env.globals["brand_svg"] = _brand_svg_safe
        self._env.globals["declutter_link"] = brand_icons.declutter
        self._env.filters["compact_skills"] = compact_skills
        self._env.globals["plan_skill_layout"] = plan_skill_layout
        self._template_name = template_name

    def render(self, resume: Resume) -> str:
        template = self._env.get_template(self._template_name)
        return template.render(resume=resume)
