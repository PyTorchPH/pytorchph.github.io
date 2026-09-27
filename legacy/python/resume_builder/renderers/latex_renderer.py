"""LaTeX renderer using Jinja2 with custom delimiters (so `{}` collisions are avoided).

Variable syntax: `<< var >>`
Block syntax: `%- ... %-`
Comment syntax: `<# ... #>`
A `tex_escape` filter sanitizes user-supplied strings.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from ..core.models import Resume
from .base import Renderer
from .formatting import compact_skills

_TEX_REPLACE = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def tex_escape(value: object) -> str:
    if value is None:
        return ""
    s = str(value)
    out: list[str] = []
    for ch in s:
        out.append(_TEX_REPLACE.get(ch, ch))
    return "".join(out)


class LatexRenderer(Renderer):
    extension = "tex"

    def __init__(self, templates_dir: Path, template_name: str = "resume.tex.j2") -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            variable_start_string="<<",
            variable_end_string=">>",
            block_start_string="(*",
            block_end_string="*)",
            comment_start_string="<#",
            comment_end_string="#>",
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False,
        )
        self._env.filters["tex_escape"] = tex_escape
        self._env.filters["compact_skills"] = compact_skills
        self._template_name = template_name

    def render(self, resume: Resume) -> str:
        template = self._env.get_template(self._template_name)
        return template.render(resume=resume)
