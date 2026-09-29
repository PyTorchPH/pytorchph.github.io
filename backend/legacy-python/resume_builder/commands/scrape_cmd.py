import os
import json
from pathlib import Path

import typer

from ..sources.social import build_default_aggregator, load_scrape_config
from .utils import pick_vendor_interactive
from ..sources.social.state import ScrapeStateStore


def _apply_visual_env(visual: bool, delay_ms: int | None) -> None:
    if visual:
        os.environ["RESUME_BUILD_PLAYWRIGHT_VISUAL"] = "1"
    if delay_ms is not None:
        os.environ["RESUME_BUILD_PLAYWRIGHT_DELAY_MS"] = str(delay_ms)
        os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_HIGHLIGHT_MS", str(delay_ms))


def _apply_step_env(step: bool, step_limit: int | None) -> None:
    """Turn on the slow, visible per-post step-through (non-destructive overlay).

    Uses ``setdefault`` for the tunables so explicit env vars / flags still win, and
    keeps the long step pause separate from the global slow-mo so scrolling stays
    watchable but not glacial.
    """
    if not step:
        return
    os.environ["RESUME_BUILD_PLAYWRIGHT_VISUAL"] = "1"
    os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT", str(step_limit or 3))
    os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_STEP_DELAY_MS", "5000")


def scrape(
    visual: bool = typer.Option(
        False,
        "--visual",
        help="Watch the scrape in a real Chromium window: highlights each focused "
        "element and pauses between steps.",
    ),
    delay_ms: int | None = typer.Option(
        None,
        "--delay-ms",
        help="Slow-motion delay (ms) between Playwright steps. Implies --visual. "
        "Default visual delay is 700ms.",
    ),
    step: bool = typer.Option(
        False,
        "--step",
        help="Slow, visible step-through: walk the first few posts one at a time "
        "(~5s/step), painting overlay highlights (post / comments / images / text / "
        "shared) plus a live HUD so you can verify what the scraper focuses on. "
        "Non-destructive — the page DOM is never changed. Implies --visual. Tune with "
        "RESUME_BUILD_PLAYWRIGHT_STEP_LIMIT (default 3) and _STEP_DELAY_MS (default 5000).",
    ),
    step_limit: int | None = typer.Option(
        None,
        "--step-limit",
        help="How many posts to step through when --step is on. Default 3.",
    ),
) -> None:
    """Run a single vendor and dump posts + mentions as JSON. Answer the prompts."""
    _apply_visual_env(visual or delay_ms is not None, delay_ms)
    _apply_step_env(step, step_limit)
    vendor = pick_vendor_interactive()
    
    state_store = ScrapeStateStore()
    last_scrape = state_store.get_last_scrape(vendor)
    if last_scrape:
        typer.secho(f"Last scrape for {vendor}: {last_scrape}", fg=typer.colors.CYAN)
    else:
        typer.secho(f"No previous scrape recorded for {vendor}.", fg=typer.colors.CYAN)
        
    agg = build_default_aggregator()
    handle = typer.prompt(
        "Your handle on that vendor (leave blank to skip own-posts)", default=""
    )
    full_name = typer.prompt(
        "Full name for mention search (leave blank to skip)", default=""
    )
    limit = int(typer.prompt("Max results per call", default="50"))

    factory = agg._registry[vendor]
    impl = factory()
    
    typer.secho(f"\nStarting scrape for {vendor}...", fg=typer.colors.GREEN)
    
    posts = impl.fetch_own_posts(handle, limit=limit) if handle else []
    mentions = impl.search_mentions(full_name, limit=limit) if full_name else []
    
    state_store.record_scrape(vendor)
    
    payload = {
        "vendor": vendor,
        "posts": [p.model_dump(mode="json") for p in posts],
        "mentions": [m.model_dump(mode="json") for m in mentions],
    }
    text = json.dumps(payload, indent=2, default=str)

    if typer.confirm("Save output to a file?", default=False):
        raw = typer.prompt("Output path", default=f"out/{vendor}.json")
        out_path = Path(raw)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        typer.secho(
            f"Wrote {out_path} ({len(posts)} posts, {len(mentions)} mentions)",
            fg=typer.colors.GREEN,
        )
    else:
        typer.echo(text)


def scrape_all(
    config: Path = typer.Option(..., "--config", help="Path to social.yaml."),
    output: Path | None = typer.Option(None, "--output", help="Write merged JSON."),
) -> None:
    """Run every enabled vendor through the aggregator and dump merged JSON."""
    scrape_config = load_scrape_config(str(config))
    agg = build_default_aggregator()
    
    typer.secho("\nStarting scrape for all enabled vendors...", fg=typer.colors.GREEN)
    result = agg.collect(scrape_config)
    
    state_store = ScrapeStateStore()
    for vendor in scrape_config.vendors.keys():
        state_store.record_scrape(vendor)
        
    payload = {
        "posts": [p.model_dump(mode="json") for p in result.posts],
        "mentions": [m.model_dump(mode="json") for m in result.mentions],
        "failures": result.failures,
    }
    text = json.dumps(payload, indent=2, default=str)
    if output:
        output.write_text(text, encoding="utf-8")
        typer.echo(f"Wrote {output} ({len(result.posts)} posts, {len(result.mentions)} mentions)")
    else:
        typer.echo(text)
