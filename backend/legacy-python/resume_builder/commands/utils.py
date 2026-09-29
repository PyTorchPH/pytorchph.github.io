import typer
from ..sources.social import build_default_aggregator

def pick_vendor_interactive() -> str:
    """Show a numbered menu of vendors; accept number or name."""
    agg = build_default_aggregator()
    vendors = agg.available_vendors()
    typer.echo("\nAvailable vendors:")
    for i, v in enumerate(vendors, 1):
        typer.echo(f"  {i}. {v}")
    while True:
        raw = typer.prompt("Pick a vendor (number or name)").strip().lower()
        if raw.isdigit() and 1 <= int(raw) <= len(vendors):
            return vendors[int(raw) - 1]
        if raw in vendors:
            return raw
        typer.secho("Invalid choice. Try again.", fg=typer.colors.YELLOW)
