from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from ..core.models import Resume
from .base import Renderer
from . import brand_icons
from .formatting import compact_skills


class MarkdownRenderer(Renderer):
    extension = "md"

    def __init__(self, templates_dir: Path, template_name: str = "resume.md.j2") -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(disabled_extensions=("j2",), default=False),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        # Register brand icon helpers as template globals
        self._env.globals["declutter_link"] = brand_icons.declutter
        self._env.filters["compact_skills"] = compact_skills
        self._template_name = template_name

    def render(self, resume: Resume) -> str:
        template = self._env.get_template(self._template_name)
        return template.render(resume=resume)
