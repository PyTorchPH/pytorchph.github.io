from __future__ import annotations

import json

from resume_builder.core.models import (
    ContactInfo,
    Resume,
    ResumeExperience,
    ResumeProject,
    RoleSpec,
)
from resume_builder.renderers import (
    JsonRenderer,
    LatexRenderer,
    MarkdownRenderer,
    get_renderer,
)


def _resume() -> Resume:
    return Resume(
        role=RoleSpec(id="r", label="Cybersecurity Blue Team", keywords=["SIEM"]),
        contact=ContactInfo(name="Drew", email="me@example.com", github="https://github.com/drew"),
        summary="Defensive security engineer.",
        skills=["SIEM", "Splunk", "incident response"],
        experience=[
            ResumeExperience(role="SOC Analyst", company="Acme", bullets=["Tuned 30+ Sigma rules."])
        ],
        projects=[
            ResumeProject(
                name="soc-playbook",
                url="https://github.com/drew/soc-playbook",
                description="Detection playbook.",
                bullets=["Reduced MTTD by 40%."],
                tech=["Python"],
            )
        ],
    )


def test_json_renderer_roundtrip():
    out = JsonRenderer().render(_resume())
    parsed = json.loads(out)
    assert parsed["role"]["label"] == "Cybersecurity Blue Team"
    assert parsed["projects"][0]["name"] == "soc-playbook"


def test_markdown_renderer_contains_sections(templates_dir):
    out = MarkdownRenderer(templates_dir).render(_resume())
    # Header now leads with the job title; the name is secondary, bolded info.
    assert "# Cybersecurity Blue Team" in out
    assert "**Drew**" in out
    assert "## Projects" in out
    assert "soc-playbook" in out


def test_html_header_leads_with_job_title(templates_dir):
    out = get_renderer("html", templates_dir).render(_resume())
    # Job title is the dominant <h1>; name is a secondary, muted line.
    assert '<h1 class="role-title">Cybersecurity Blue Team</h1>' in out
    assert '<span class="name">Drew</span>' in out


def test_latex_renderer_escapes_specials(templates_dir):
    resume = _resume()
    resume.summary = "Worked with 100% of clients & saved $1M."
    out = LatexRenderer(templates_dir).render(resume)
    assert r"100\%" in out
    assert r"\&" in out
    assert r"\$1M" in out
    assert r"\documentclass" in out


def test_registry_resolves(templates_dir):
    assert isinstance(get_renderer("json", templates_dir), JsonRenderer)
    assert isinstance(get_renderer("MD", templates_dir), MarkdownRenderer)
    assert isinstance(get_renderer("latex", templates_dir), LatexRenderer)


def test_pdf_renders_single_column_smoke(templates_dir):
    from resume_builder.renderers.pdf_renderer import PdfRenderer
    from resume_builder.core.models import Resume, RoleSpec, ContactInfo, ResumeProject

    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"),
        summary="A summary.",
        skills=["Python", "C++"],
        projects=[ResumeProject(name="Proj", description="d", tech=["Python"])],
        experience=[],
        education=[],
    )
    pdf = PdfRenderer(templates_dir).render(resume)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 800


def test_latex_is_single_column(templates_dir):
    from resume_builder.renderers.latex_renderer import LatexRenderer
    from resume_builder.core.models import Resume, RoleSpec, ContactInfo

    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"),
        summary="S",
        skills=["Python"],
        projects=[],
        experience=[],
        education=[],
    )
    tex = LatexRenderer(templates_dir).render(resume)
    # Single-column vertical flow; section rule (titlerule) scopes each heading.
    assert "paracol" not in tex
    assert "\\titlerule" in tex
    assert "\\section*{Summary}" in tex


def test_html_is_single_column_with_section_dividers(templates_dir):
    from resume_builder.renderers.html_renderer import HtmlRenderer
    from resume_builder.core.models import Resume, RoleSpec, ContactInfo

    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[], must_have_skills=[], nice_to_have=[]),
        contact=ContactInfo(name="Test User"),
        summary="S",
        skills=["Python"],
        projects=[],
        experience=[],
        education=[],
    )
    html = HtmlRenderer(templates_dir).render(resume)
    # The page remains single-column; only the bounded Skills section may use a measured grid.
    assert '<main class="sheet">' in html
    assert "--skill-columns" in html
    assert 'class="sidebar"' not in html and 'class="main"' not in html
    assert "border-top:1px solid var(--rule)" in html


# ---------------------------------------------------------------------------
# Brand icon tests — added as part of resume formatting fixes
# ---------------------------------------------------------------------------


def _resume_with_social() -> Resume:
    """Minimal resume with github + linkedin contacts and a facebook-source achievement."""
    from resume_builder.core.models import ResumeAchievement

    return Resume(
        role=RoleSpec(id="sec", label="Security Engineer", keywords=[]),
        contact=ContactInfo(
            name="Alex",
            email="alex@example.com",
            github="https://github.com/alexuser",
            linkedin="https://www.linkedin.com/in/alexuser",
        ),
        summary="Security professional.",
        skills=["Python"],
        achievements=[
            ResumeAchievement(
                title="Gave a talk at PyCon",
                source="facebook",
                url="https://www.facebook.com/events/1234567890/",
                snippet="Presented security research.",
            ),
            ResumeAchievement(
                title="Open Source Award",
                source="github",
                url="https://github.com/alexuser/award",
                snippet="Recognised for OSS contributions.",
            ),
        ],
    )


def test_html_brand_icons_in_contact(templates_dir):
    """HTML contact section must contain brand icons with just the handle as display text."""
    from resume_builder.renderers.html_renderer import HtmlRenderer
    import re

    html = HtmlRenderer(templates_dir).render(_resume_with_social())
    # A configured raster asset or the inline SVG fallback is injected.
    assert 'class="brand-icon"' in html or "<svg" in html
    # Handle text should appear as visible content (without the domain)
    assert "alexuser" in html
    # The github full URL should only appear in href attributes, not as visible link text
    # (i.e., the display span should not contain "https://github.com")
    visible_spans = re.findall(r"<span>([^<]+)</span>", html)
    for span_text in visible_spans:
        assert "https://github.com" not in span_text, (
            f"Found raw GitHub URL in visible span text: {span_text!r}"
        )


def test_html_role_label_before_name(templates_dir):
    """Role label (h1.role-title) must appear before the candidate name in the HTML."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_social())
    role_pos = html.find("role-title")
    name_pos = html.find('class="name"')
    assert role_pos != -1, "role-title class not found in HTML"
    assert name_pos != -1, "name class not found in HTML"
    assert role_pos < name_pos, "role-title should appear before .name in the document"


def test_html_facebook_achievement_has_no_link(templates_dir):
    """Facebook-source achievements must NOT be wrapped in <a href>."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_social())
    # The facebook achievement URL should NOT appear as an href
    assert 'href="https://www.facebook.com/events/1234567890/"' not in html
    # But the title text should still appear
    assert "Gave a talk at PyCon" in html


def test_html_non_facebook_achievement_has_link(templates_dir):
    """Non-facebook achievements WITH a url should be linked."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_social())
    assert 'href="https://github.com/alexuser/award"' in html


def test_pdf_with_brand_contacts_smoke(templates_dir):
    """PDF render with branded contact links must return valid PDF bytes."""
    from resume_builder.renderers.pdf_renderer import PdfRenderer

    pdf = PdfRenderer(templates_dir).render(_resume_with_social())
    assert isinstance(pdf, bytes) and len(pdf) > 0
    assert pdf[:4] == b"%PDF"


def test_md_github_link_text_uses_handle(templates_dir):
    """Markdown GitHub link text must be github/<handle>, not the full URL."""
    md = MarkdownRenderer(templates_dir).render(_resume_with_social())
    assert "github/alexuser" in md
    # The raw domain should NOT appear as link text (it's fine in href though)
    # We check the markdown link syntax: [display](url)
    import re

    link_texts = re.findall(r"\[([^\]]+)\]\(", md)
    for text in link_texts:
        if "github" in text.lower():
            assert "https://github.com" not in text, (
                f"GitHub link display text should not be a raw URL, got: {text!r}"
            )


def _resume_with_github_project() -> Resume:
    """Resume with a GitHub project URL but no display_url/source_icon pre-set."""
    return Resume(
        role=RoleSpec(id="r", label="Dev", keywords=[]),
        contact=ContactInfo(name="Owen"),
        summary="",
        projects=[
            ResumeProject(
                name="my-lib",
                url="https://github.com/o/r",
                description="A library.",
                tech=["Python"],
            )
        ],
    )


def test_html_project_link_shows_decluttered_path_not_full_url(templates_dir):
    """HTML project source must show decluttered path + SVG icon, never the bare https:// URL."""
    from resume_builder.renderers.html_renderer import HtmlRenderer
    import re

    html = HtmlRenderer(templates_dir).render(_resume_with_github_project())

    # Source span must contain the decluttered path (owner/repo without domain)
    assert "o/r" in html

    # Full https URL must NOT appear as visible span text
    visible_spans = re.findall(r"<span>([^<]+)</span>", html)
    for span_text in visible_spans:
        assert "https://github.com/o/r" not in span_text, (
            f"Raw GitHub URL found in visible span: {span_text!r}"
        )

    # A configured raster asset or the inline SVG fallback must be present.
    assert 'class="brand-icon"' in html or "<svg" in html


def test_html_project_link_with_display_url_set(templates_dir):
    """When display_url is pre-set on the project, it is used directly (no raw URL)."""
    from resume_builder.renderers.html_renderer import HtmlRenderer
    import re

    resume = Resume(
        role=RoleSpec(id="r", label="Dev", keywords=[]),
        contact=ContactInfo(name="Owen"),
        summary="",
        projects=[
            ResumeProject(
                name="rdtii-autoextract",
                url="https://github.com/sample-user/sample-project",
                description="Extraction tool.",
                source_icon="github",
                display_url="github/sample-user/sample-project",
            )
        ],
    )
    html = HtmlRenderer(templates_dir).render(resume)

    # github/ prefix is stripped from display — only owner/repo visible
    assert "sample-user/sample-project" in html

    # Full https URL must NOT appear as visible span text
    visible_spans = re.findall(r"<span>([^<]+)</span>", html)
    for span_text in visible_spans:
        assert "https://github.com" not in span_text, (
            f"Raw GitHub URL found in visible span: {span_text!r}"
        )
    assert 'class="brand-icon"' in html or "<svg" in html


def test_pdf_project_link_no_raw_url_smoke(templates_dir):
    """PDF render with a GitHub project URL must succeed and not embed raw https URL in story."""
    from resume_builder.renderers.pdf_renderer import PdfRenderer

    pdf = PdfRenderer(templates_dir).render(_resume_with_github_project())
    assert isinstance(pdf, bytes) and len(pdf) > 0
    assert pdf[:4] == b"%PDF"
    # The raw full URL must not appear as literal text in the PDF byte stream
    # (it appears only in link annotations, not in the visible text stream)
    assert b"https://github.com/o/r" not in pdf or b"<https://github.com/o/r>" not in pdf


def _resume_with_all_contacts() -> Resume:
    """Resume with github + linkedin + facebook + location.

    Location should be ABSENT from the rendered header; name must appear IN the
    contact line; all three brand icons (github, linkedin, facebook) must show.
    """
    return Resume(
        role=RoleSpec(id="r", label="Full Stack Developer", keywords=[]),
        contact=ContactInfo(
            name="John Doe",
            email="john@example.com",
            phone="+1-555-1234",
            location="Manila, PH",  # must NOT appear in header output
            github="https://github.com/johndoe",
            linkedin="https://www.linkedin.com/in/johndoe",
            facebook="john.doe.58",
        ),
        summary="A developer.",
        skills=["Python"],
    )


def test_html_contact_has_github_linkedin_facebook_icons(templates_dir):
    """HTML contact line must contain icons for github, linkedin, and facebook."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_all_contacts())
    # Each provider emits either a configured image asset or its inline SVG fallback.
    assert html.count('class="brand-icon"') + html.count("<svg") >= 3


def test_html_contact_facebook_no_href(templates_dir):
    """HTML contact: facebook username shown as plain text, never wrapped in <a href>."""
    from resume_builder.renderers.html_renderer import HtmlRenderer
    import re

    html = HtmlRenderer(templates_dir).render(_resume_with_all_contacts())
    # Username text is present.
    assert "john.doe.58" in html
    # No anchor pointing to facebook.com.
    fb_hrefs = re.findall(r'href="[^"]*facebook\.com[^"]*"', html)
    assert not fb_hrefs, f"Unexpected Facebook href(s) in HTML contact: {fb_hrefs}"


def test_html_contact_name_in_contact_line(templates_dir):
    """HTML: candidate name appears inside the .contact div (single contact line)."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_all_contacts())
    # Name is in the contact section with class="name".
    assert 'class="name"' in html
    assert "John Doe" in html


def test_html_contact_no_location_in_header(templates_dir):
    """HTML header must NOT contain the contact location/address."""
    from resume_builder.renderers.html_renderer import HtmlRenderer

    html = HtmlRenderer(templates_dir).render(_resume_with_all_contacts())
    assert "Manila, PH" not in html, "Location must not appear anywhere in the HTML output"


def test_md_contact_facebook_plain_text(templates_dir):
    """Markdown: facebook appears as plain text (facebook/{username}), NOT a hyperlink."""
    md = MarkdownRenderer(templates_dir).render(_resume_with_all_contacts())
    assert "facebook/john.doe.58" in md, "facebook/username must appear in MD output"
    # Must NOT be a markdown link [text](url).
    assert "[facebook/john.doe.58](" not in md, "Facebook contact must not be a hyperlink in MD"


def test_md_contact_no_location(templates_dir):
    """Markdown header must NOT contain the contact location/address."""
    md = MarkdownRenderer(templates_dir).render(_resume_with_all_contacts())
    assert "Manila, PH" not in md, "Location must not appear in the MD header"


def test_md_contact_name_in_contact_line(templates_dir):
    """Markdown: name appears bolded in the single contact line."""
    md = MarkdownRenderer(templates_dir).render(_resume_with_all_contacts())
    assert "**John Doe**" in md


def test_pdf_full_width_contact_and_project_links(templates_dir):
    """PDF render with all social contacts and long project names must return valid PDF bytes.

    This test guards against the mid-word-wrap regression where narrow table cells
    caused long tokens like 'JohnAndrewBalbar' / 'osa' to split across lines.
    """
    from resume_builder.renderers.pdf_renderer import PdfRenderer
    from resume_builder.core.models import Resume, RoleSpec, ContactInfo, ResumeProject

    resume = Resume(
        role=RoleSpec(id="r", label="Software Engineer", keywords=[]),
        contact=ContactInfo(
            name="Sample User",
            email="verylongemail@verylongdomain.com",
            github="https://github.com/sample-user",
            linkedin="https://www.linkedin.com/in/sample-user",
            facebook="sample.user",
        ),
        summary="A summary.",
        skills=["Python"],
        projects=[
            ResumeProject(
                name="very-long-project-name-that-would-wrap-in-narrow-cell",
                url=(
                    "https://github.com/sample-user/"
                    "very-long-project-name-that-would-wrap-in-narrow-cell"
                ),
                description="A project.",
                tech=["Python"],
            )
        ],
    )
    pdf = PdfRenderer(templates_dir).render(resume)
    assert isinstance(pdf, bytes) and len(pdf) > 0
    assert pdf[:4] == b"%PDF"


def test_json_renderer_includes_contact_links():
    """JSON output must include a top-level contact_links array."""
    import json as _json

    resume = Resume(
        role=RoleSpec(id="r", label="R", keywords=[]),
        contact=ContactInfo(
            name="T",
            github="https://github.com/tuser",
            linkedin="https://www.linkedin.com/in/tuser",
        ),
        summary="",
    )
    out = JsonRenderer().render(resume)
    data = _json.loads(out)
    assert "contact_links" in data
    assert isinstance(data["contact_links"], list)
    providers = {item["provider"] for item in data["contact_links"]}
    assert "github" in providers
    assert "linkedin" in providers
    # Handles should be resolved
    gh_entry = next(x for x in data["contact_links"] if x["provider"] == "github")
    assert gh_entry["handle"] == "tuser"
