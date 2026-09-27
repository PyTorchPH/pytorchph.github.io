from __future__ import annotations

from pathlib import Path

import typer

from ..extraction.crawler import DEFAULT_OBJECTIVE, AgenticCrawler, PlaywrightPageFetcher
from ..extraction.crawler_store import LayoutStore
from ..llm import get_provider
from ..llm.local_config import get_configured_provider


def crawl_site(
    seed_url: str = typer.Argument(..., help="Main-page seed URL; crawling stays on this domain."),
    objective: str = typer.Option(DEFAULT_OBJECTIVE, "--objective", help="Evidence objective."),
    provider: str | None = typer.Option(None, "--provider", help="Configured LLM provider."),
    output_dir: Path = typer.Option(
        Path("out/crawler-rules"), "--output-dir", help="Local learned-layout/run JSON directory."
    ),
    max_depth: int = typer.Option(3, "--max-depth", min=0, help="Hard crawl safety boundary."),
    max_pages: int = typer.Option(25, "--max-pages", min=1, help="Hard crawl safety boundary."),
    visible: bool = typer.Option(False, "--visible", help="Show rendered browser navigation."),
) -> None:
    """Learn HTML-tag actions, validate/revise them, then crawl an adaptive sample."""
    crawler = AgenticCrawler(
        llm=get_provider(provider) if provider else get_configured_provider(),
        fetch_page=PlaywrightPageFetcher(headless=not visible),
        store=LayoutStore(output_dir=output_dir),
        max_depth=max_depth,
        max_pages=max_pages,
    )
    run = crawler.crawl(seed_url, objective=objective)
    typer.echo(
        f"Visited {len(run.visited_urls)} page(s); extracted {len(run.extracted_pages)}; "
        f"failed {len(run.failed_urls)}; learned {len(run.learned_layouts)} layout(s)."
    )
    typer.echo(f"JSON: {output_dir / 'latest-run.json'}")
