"""Typer CLI entrypoint.

Examples:
    resume-build list-roles
    resume-build build --mode static --gh-user JohnDoe --role cybersecurity-blueteam \
        --docs ./my-resume.tex --output ./out --formats latex,md,json
    resume-build build --mode ai --gh-user JohnDoe --role-prompt "blue team SOC analyst" \
        --docs ./my-resume.pdf --output ./out
"""

from __future__ import annotations

import logging
from pathlib import Path

import typer

from .classification.industry import WebPageInput
from .commands import auth_cmd as _auth_cmd
from .commands import crawl_cmd as _crawl_cmd
from .commands import scrape_cmd as _scrape_cmd
from .core.config import get_settings
from .core.models import Mode
from .llm import get_provider
from .llm.local_config import get_configured_provider
from .orchestration.pipeline import BuildIndustryInputs, BuildInputs, Pipeline
from .review.review_orchestrator import review_resume_text
from .role import StaticRolePicker
from .sources.document import DocumentSource
from .sources.social import build_default_aggregator

app = typer.Typer(help="GitHub-aware role-targeted resume builder.", no_args_is_help=True)

_VENDOR_COOKIES = _auth_cmd._VENDOR_COOKIES
masked_input = _auth_cmd.masked_input
_apply_visual_env = _scrape_cmd._apply_visual_env
scrape = _scrape_cmd.scrape
scrape_all = _scrape_cmd.scrape_all
crawl_site = _crawl_cmd.crawl_site


def _collect_manual_cookies(vendor: str) -> dict[str, str]:
    _auth_cmd.masked_input = masked_input
    return _auth_cmd._collect_manual_cookies(vendor)


def login() -> None:
    _auth_cmd.masked_input = masked_input
    _auth_cmd.login()


def logout() -> None:
    _auth_cmd.logout()


app.command()(login)
app.command()(logout)
app.command()(scrape)
app.command("scrape-all")(scrape_all)
app.command("crawl-site")(crawl_site)


def _parse_formats(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@app.command()
def list_roles() -> None:
    """List role ids available in config/roles.json."""
    settings = get_settings()
    picker = StaticRolePicker(settings.roles_path)
    for role in picker.list_available():
        typer.echo(f"  {role.id:30}  {role.label}")


@app.command()
def build(
    mode: Mode = typer.Option(Mode.STATIC, "--mode", help="ai | static"),
    gh_user: str = typer.Option(..., "--gh-user", help="GitHub username/org to scan."),
    role: str | None = typer.Option(None, "--role", help="Role id (static mode)."),
    role_prompt: str | None = typer.Option(
        None, "--role-prompt", help="Free-form role description (AI mode)."
    ),
    docs: Path | None = typer.Option(
        None, "--docs", help="Path to a resume file (PDF/DOCX/TEX) or a folder."
    ),
    formats: str = typer.Option(
        "latex,md,json,pdf",
        "--formats",
        help="Comma-separated output formats: latex, md, json, pdf.",
    ),
    output: Path = typer.Option(Path("./out"), "--output", help="Output directory."),
    social: Path | None = typer.Option(
        None,
        "--social",
        help="Path to a social.yaml describing handles + enabled vendors for the "
        "scraping middleman. Optional — pipeline runs fine without it.",
    ),
    llm_provider: str | None = typer.Option(
        None,
        "--llm-provider",
        help="Override LLM provider (anthropic | openai | claude-session | null). "
        "Use `claude-session` to drive AI mode interactively via stdin/stdout — "
        "no API key required.",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Build a role-targeted resume."""
    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    selection = role_prompt if mode == Mode.AI else role
    if not selection:
        flag = "--role-prompt" if mode == Mode.AI else "--role"
        raise typer.BadParameter(f"{flag} is required in {mode.value} mode.")

    llm = get_provider(llm_provider) if (llm_provider and mode == Mode.AI) else None
    pipeline = Pipeline(mode=mode, llm=llm)
    inputs = BuildInputs(
        gh_user=gh_user,
        role_selection=selection,
        docs_path=docs,
        formats=_parse_formats(formats),
        output_dir=output,
        social_config_path=social,
    )
    result = pipeline.run(inputs)
    typer.echo(f"\nGenerated for role: {result.resume.role.label}")
    typer.echo(f"Projects included: {len(result.resume.projects)}")
    for path in result.output_paths:
        typer.echo(f"  -> {path}")


@app.command("build-industries")
def build_industries(
    mode: Mode = typer.Option(Mode.AI, "--mode", help="ai | static"),
    gh_user: str = typer.Option(..., "--gh-user", help="GitHub username/org to scan."),
    docs: Path | None = typer.Option(
        None, "--docs", help="Path to a resume file (PDF/DOCX/TEX) or a folder."
    ),
    formats: str = typer.Option(
        "html,latex,md,json,pdf",
        "--formats",
        help="Comma-separated output formats: html, latex, md, json, pdf.",
    ),
    output: Path = typer.Option(Path("./out/resumes"), "--output", help="Output root."),
    social: Path | None = typer.Option(
        None,
        "--social",
        help="Path to social.yaml. Resume generation bypasses the social scrape cache.",
    ),
    web: list[Path] | None = typer.Option(
        None,
        "--web",
        help="Optional HTML/text file from an arbitrary website to include in AI extraction.",
    ),
    llm_provider: str | None = typer.Option(
        None,
        "--llm-provider",
        help="Override LLM provider (anthropic | openai | claude-session | null).",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Developer command: auto-build one GitHub-backed resume per discovered industry."""

    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    llm = get_provider(llm_provider) if (llm_provider and mode == Mode.AI) else None
    pipeline = Pipeline(mode=mode, llm=llm)
    result = pipeline.run_industry_auto(
        BuildIndustryInputs(
            gh_user=gh_user,
            docs_path=docs,
            formats=_parse_formats(formats),
            output_dir=output,
            social_config_path=social,
            web_pages=_load_web_pages(web or []),
        )
    )

    typer.echo(f"\nGenerated {len(result.resumes)} industry resume(s).")
    for industry, resume in zip(result.industries, result.resumes, strict=False):
        typer.echo(f"  {industry}: {len(resume.projects)} project(s), {len(resume.achievements)} achievement(s)")
    for path in result.output_paths:
        typer.echo(f"  -> {path}")


@app.command()
def review(
    docs: Path = typer.Option(..., "--docs", help="Resume file or folder to review."),
    llm_provider: str | None = typer.Option(
        None,
        "--llm-provider",
        help="LLM provider for findings-only review: anthropic | openai | claude-session.",
    ),
    output: Path | None = typer.Option(None, "--output", help="Optional file for review output."),
) -> None:
    """Review a resume using the findings-only Resume Review Orchestrator prompt."""
    documents = DocumentSource().collect(docs)
    resume_text = "\n\n".join(d.text for d in documents if d.text.strip())
    if not resume_text.strip():
        raise typer.BadParameter("No readable resume text found in --docs.")

    llm = get_provider(llm_provider) if llm_provider else get_configured_provider()
    findings = review_resume_text(llm, resume_text)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(findings + "\n", encoding="utf-8")
        typer.echo(f"Wrote review findings to {output}")
        return
    typer.echo(findings)


def _load_web_pages(paths: list[Path]) -> list[WebPageInput]:
    pages: list[WebPageInput] = []
    for path in paths:
        if not path.is_file():
            raise typer.BadParameter(f"Not a file: {path}")
        pages.append(
            WebPageInput(
                id=path.stem,
                url=None,
                title=path.stem.replace("-", " ").replace("_", " "),
                html_or_text=path.read_text(encoding="utf-8", errors="replace"),
            )
        )
    return pages


@app.command("list-vendors")
def list_vendors() -> None:
    """List registered social-media vendor handlers."""
    agg = build_default_aggregator()
    for name in agg.available_vendors():
        typer.echo(f"  {name}")


@app.command("mine-metrics")
def mine_metrics(
    gh_user: str = typer.Option(..., "--gh-user", help="GitHub username/org to scan."),
    metrics_path: Path | None = typer.Option(
        None, "--metrics", help="metrics.csv to write/merge into (default: settings)."
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="List candidates without prompting."),
    accept_high: bool = typer.Option(
        False, "--accept-high", help="Auto-accept high-confidence candidates without asking."
    ),
) -> None:
    """Mine repos for measurable-impact metrics; confirm/edit/skip into metrics.csv."""
    from .metrics import load_metrics, merge_metrics, save_metrics
    from .metrics.miner import mine_repo
    from .metrics.models import ProjectMetric
    from .sources import GitHubSource

    out_path = metrics_path or get_settings().metrics_path
    repos = GitHubSource().collect(user=gh_user, include_readme=True)
    existing = load_metrics(out_path)
    accepted: list[ProjectMetric] = []

    for repo in repos:
        candidates = mine_repo(repo)
        if not candidates:
            continue
        typer.echo(f"\n=== {repo.name} ({len(candidates)} candidate(s)) ===")
        for c in candidates:
            line = f"  [{c.confidence}] {c.metric_label} = {c.value}  · {c.context}"
            if dry_run:
                typer.echo(line)
                continue
            if accept_high and c.confidence == "high":
                typer.echo(f"{line}  -> auto-accepted")
                accepted.append(ProjectMetric(repo=c.repo, metric_label=c.metric_label, value=c.value, context=c.context))
                continue
            typer.echo(line)
            choice = typer.prompt("    (a)ccept / (e)dit / (s)kip", default="a").strip().lower()
            if choice.startswith("s"):
                continue
            label, value, context = c.metric_label, c.value, c.context
            if choice.startswith("e"):
                label = typer.prompt("    metric_label", default=label)
                value = typer.prompt("    value", default=value)
                context = typer.prompt("    context", default=context)
            accepted.append(ProjectMetric(repo=c.repo, metric_label=label, value=value, context=context))

    if dry_run:
        typer.echo(f"\n(dry run — nothing written to {out_path})")
        return
    if not accepted:
        typer.echo("\nNo metrics accepted; metrics.csv unchanged.")
        return
    merged = merge_metrics(existing, accepted)
    save_metrics(out_path, merged)
    typer.echo(f"\nWrote {len(merged)} metric(s) ({len(accepted)} new/updated) to {out_path}")


@app.command("check-bounds")
def check_bounds(
    html: Path = typer.Argument(..., help="Path to a rendered resume .html file."),
    margin_mm: float = typer.Option(14.0, "--margin-mm", help="Symmetric @page margin in mm."),
) -> None:
    """Report whether a rendered HTML resume bleeds past the printed page."""
    from .layout import analyze_html_bounds

    if not html.is_file():
        raise typer.BadParameter(f"Not a file: {html}")

    report = analyze_html_bounds(html.read_text(encoding="utf-8"), margin_mm=margin_mm)
    typer.echo(report.summary())
    typer.echo(f"  pages: {report.page_count}  (content {report.content_height_px:.0f}px / page {report.page_height_px:.0f}px)")
    for b in report.oversized_blocks:
        typer.echo(f"  ! too tall ({b.height_px:.0f}px) [{b.section}] {b.label}")
    for b in report.straddling_blocks:
        typer.echo(f"  ~ break before [{b.section}] {b.label}")
    if not report.fits_one_page and not report.oversized_blocks:
        typer.echo("  (multi-page, but every entry stays whole - no mid-bleed)")


if __name__ == "__main__":
    app()
