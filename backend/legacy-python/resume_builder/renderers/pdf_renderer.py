"""PDF renderer.

Strategy:
1. If `pdflatex` is on PATH, render via the LaTeX template and compile.
2. Else, fall back to a direct reportlab layout from the Resume model.

This keeps the dependency surface optional — no LaTeX install required.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from ..core.models import Resume
from .base import Renderer
from .latex_renderer import LatexRenderer
from .formatting import compact_skills


class PdfRenderer(Renderer):
    extension = "pdf"

    def __init__(self, templates_dir: Path) -> None:
        self._latex = LatexRenderer(templates_dir)

    def render(self, resume: Resume) -> bytes:
        if shutil.which("pdflatex"):
            tex_source = self._latex.render(resume)
            pdf_bytes = self._compile_latex(tex_source)
            if pdf_bytes:
                return pdf_bytes
        return self._render_reportlab(resume)

    @staticmethod
    def _compile_latex(tex_source: str) -> bytes | None:
        with tempfile.TemporaryDirectory() as td:
            tex_path = Path(td) / "resume.tex"
            tex_path.write_text(tex_source, encoding="utf-8")
            try:
                subprocess.run(
                    ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "resume.tex"],
                    cwd=td,
                    capture_output=True,
                    check=True,
                )
            except (subprocess.CalledProcessError, FileNotFoundError):
                return None
            pdf_path = Path(td) / "resume.pdf"
            return pdf_path.read_bytes() if pdf_path.exists() else None

    @staticmethod
    def _render_reportlab(resume: Resume) -> bytes:
        from io import BytesIO

        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            HRFlowable,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
        )

        from .brand_icons import (
            badge_png_path as bi_badge_png_path,
            declutter as bi_declutter,
        )

        accent = HexColor("#243b6b")
        rule = HexColor("#c7ccd6")
        muted = HexColor("#5b6270")

        buf = BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=letter,
            leftMargin=0.6 * inch,
            rightMargin=0.6 * inch,
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
        )
        styles = getSampleStyleSheet()

        # Role label is the dominant H1; name is secondary info in the header.
        h1 = ParagraphStyle("h1", parent=styles["Heading1"], spaceAfter=2, fontSize=17)
        h2 = ParagraphStyle(
            "h2",
            parent=styles["Heading2"],
            spaceBefore=0,
            spaceAfter=3,
            fontSize=11,
            textColor=accent,
        )
        body = ParagraphStyle(
            "body", parent=styles["BodyText"], fontSize=9, leading=12, spaceAfter=1
        )
        contact_style = ParagraphStyle(
            "contact_style",
            parent=styles["BodyText"],
            fontSize=8,
            leading=10,
            spaceAfter=0,
            textColor=muted,
        )

        story: list = []
        state = {"first": True}

        def section(title: str) -> None:
            if state["first"]:
                state["first"] = False
            else:
                story.append(Spacer(1, 5))
                story.append(HRFlowable(width="100%", thickness=0.6, color=rule, spaceAfter=4))
            story.append(Paragraph(title, h2))

        # ------------------------------------------------------------------ header
        # Role label → H1 (dominant heading)
        role_label = (resume.role.label if resume.role and resume.role.label else "") or "Resume"
        story.append(Paragraph(role_label, h1))

        # Single full-width contact Paragraph: no narrow cells → no mid-word wrap.
        # Location/address is intentionally omitted from the header.

        def _badge_img(provider: str, w: int = 9, h: int = 9) -> str:
            """Return an <img> tag for the provider badge, or empty string."""
            path = bi_badge_png_path(provider, px=h * 3)
            if not path:
                return ""
            # Escape backslashes for Windows paths inside XML attribute
            safe = path.replace("\\", "/")
            return f'<img src="{safe}" width="{w}" height="{h}" valign="middle"/>'

        contact_parts: list[str] = []

        if resume.contact.name:
            contact_parts.append(f"<b>{resume.contact.name}</b>")

        if resume.contact.email:
            contact_parts.append(resume.contact.email)

        if resume.contact.phone:
            contact_parts.append(resume.contact.phone)

        def _linked_part(provider: str, raw_val: str, default_base: str) -> str | None:
            _, handle = bi_declutter(raw_val, provider)
            if not handle:
                return None
            href = raw_val if raw_val.startswith("http") else default_base + handle
            img = _badge_img(provider)
            return f'{img}<link href="{href}">{handle}</link>'

        if resume.contact.github:
            part = _linked_part("github", resume.contact.github, "https://github.com/")
            if part:
                contact_parts.append(part)

        if resume.contact.linkedin:
            part = _linked_part("linkedin", resume.contact.linkedin, "https://www.linkedin.com/in/")
            if part:
                contact_parts.append(part)

        if resume.contact.facebook and resume.contact.facebook.strip():
            img = _badge_img("facebook")
            contact_parts.append(f"{img}{resume.contact.facebook}")

        if resume.contact.website:
            part = _linked_part("website", resume.contact.website, "https://")
            if part:
                contact_parts.append(part)

        if contact_parts:
            contact_markup = " &middot; ".join(contact_parts)
            story.append(Paragraph(contact_markup, contact_style))

        story.append(
            HRFlowable(width="100%", thickness=1.2, color=accent, spaceBefore=3, spaceAfter=4)
        )

        # ------------------------------------------------------------------ sections

        if resume.summary:
            section("Summary")
            story.append(Paragraph(resume.summary, body))

        if resume.skill_groups or resume.skills:
            section("Skills")
            if resume.skill_groups:
                skill_text = " &middot; ".join(
                    f"<b>{group.name}:</b> {', '.join(group.items)}"
                    for group in resume.skill_groups
                )
            else:
                skill_text = " &middot; ".join(compact_skills(resume.skills))
            story.append(Paragraph(skill_text, body))

        if resume.experience:
            section("Experience")
            for x in resume.experience:
                head = f"<b>{x.role}</b> &mdash; {x.company}"
                if x.start or x.end:
                    head += f" <i>({x.start or ''} – {x.end or 'Present'})</i>"
                story.append(Paragraph(head, body))
                for b in x.bullets:
                    story.append(Paragraph(f"&bull; {b}", body))
                story.append(Spacer(1, 2))

        if resume.projects:
            section("Projects")
            for p in resume.projects:
                story.append(Paragraph(f"<b>{p.name}</b>", body))
                if p.url:
                    if p.display_url:
                        provider = p.source_icon or "website"
                        path = (
                            p.display_url.replace("github/", "")
                            if provider == "github"
                            else p.display_url
                        )
                    else:
                        provider, path = bi_declutter(p.url)
                        provider = provider or "website"
                    if path:
                        # Full-width Paragraph prevents mid-word wrap in long paths.
                        proj_badge = bi_badge_png_path(provider, px=24)
                        if proj_badge:
                            safe_proj = proj_badge.replace("\\", "/")
                            proj_img = (
                                f'<img src="{safe_proj}" width="8" height="8" valign="middle"/>'
                            )
                        else:
                            proj_img = ""
                        proj_markup = f'{proj_img}<link href="{p.url}">{path}</link>'
                        story.append(Paragraph(proj_markup, contact_style))
                if p.tech:
                    story.append(Paragraph(f"<i>{' &middot; '.join(p.tech)}</i>", body))
                # Bullet order: quantitative_impact first, then description,
                # then qualitative_impact, then component bullets.
                for q in p.quantitative_impact:
                    story.append(Paragraph(f"&bull; {q}", body))
                if p.description:
                    story.append(Paragraph(f"&bull; {p.description}", body))
                for ql in p.qualitative_impact:
                    story.append(Paragraph(f"&bull; {ql}", body))
                for b in p.bullets:
                    story.append(Paragraph(f"&bull; {b}", body))
                story.append(Spacer(1, 2))

        if resume.achievements:
            section("Achievements")
            for a in resume.achievements:
                line = f"<b>{a.title}</b>"
                if a.date:
                    line += f" ({a.date})"
                story.append(Paragraph(line, body))
                if a.snippet:
                    story.append(Paragraph(a.snippet, body))

        if resume.certifications:
            section("Certifications")
            for c in resume.certifications:
                line = f"<b>{c.name}</b>"
                if c.issuer:
                    line += f" &mdash; {c.issuer}"
                if c.date:
                    line += f" ({c.date})"
                story.append(Paragraph(line, body))

        # Education last — basic supporting info at the bottom of the resume.
        if resume.education:
            section("Education")
            for e in resume.education:
                line = f"<b>{e.school}</b>"
                if e.degree:
                    line += f" &mdash; {e.degree}"
                if e.field:
                    line += f" in {e.field}"
                story.append(Paragraph(line, body))
                for note in e.notes:
                    story.append(Paragraph(f"&bull; {note}", body))

        doc.build(story)
        return buf.getvalue()
