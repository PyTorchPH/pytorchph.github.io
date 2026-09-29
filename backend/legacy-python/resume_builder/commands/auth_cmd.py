import typer

from ..sources.social.auth import (
    ConsolePrompt,
    Credentials,
    LoginError,
    SessionStore,
    masked_input,
    parse_curl_command,
)
from ..sources.social.browser_login import (
    PlaywrightNotInstalled,
    open_login_window,
)
from ..sources.social.browser_cookies import import_cookies_report
from .utils import pick_vendor_interactive

_LOGIN_REGISTRY = {
    "twitter": "resume_builder.sources.social.vendors.twitter:login_twitter",
    "linkedin": "resume_builder.sources.social.vendors.linkedin:login_linkedin",
    "facebook": "resume_builder.sources.social.vendors.facebook:login_facebook",
    "instagram": "resume_builder.sources.social.vendors.instagram:login_instagram",
}

# Per-vendor cookie names users will see in DevTools.
_VENDOR_COOKIES: dict[str, tuple[str, ...]] = {
    "facebook": ("c_user", "xs"),
    "linkedin": ("li_at",),
    "instagram": ("sessionid",),
    "twitter": ("auth_token", "ct0"),
}

_DEVTOOLS_HINTS: dict[str, str] = {
    "facebook": "Open facebook.com signed in -> F12 -> Application tab -> Cookies -> https://www.facebook.com",
    "linkedin": "Open linkedin.com signed in -> F12 -> Application tab -> Cookies -> https://www.linkedin.com",
    "instagram": "Open instagram.com signed in -> F12 -> Application tab -> Cookies -> https://www.instagram.com",
    "twitter": "Open x.com signed in -> F12 -> Application tab -> Cookies -> https://x.com",
}


def _collect_manual_cookies(vendor: str) -> dict[str, str]:
    needed = _VENDOR_COOKIES.get(vendor, ())
    if not needed:
        typer.secho(f"No cookie schema for vendor {vendor}", fg=typer.colors.RED)
        return {}
    typer.echo("")
    typer.secho(
        f"How to grab the cookies for {vendor}:",
        fg=typer.colors.CYAN,
        bold=True,
    )
    typer.echo(f"  {_DEVTOOLS_HINTS.get(vendor, '(see browser DevTools cookie panel)')}")
    typer.echo(f"  You will need: {', '.join(needed)}")
    typer.echo("  Tip: click the cookie row, then double-click the Value cell to select it.\n")

    out: dict[str, str] = {}
    for name in needed:
        value = masked_input(f"Paste value of `{name}`: ")
        value = value.strip().strip('"').strip("'")
        if value:
            out[name] = value
    return out


def _read_curl_paste() -> str:
    typer.echo(
        "\nPaste the curl command below. Press Enter on an EMPTY line when done.\n"
        "(In Chrome DevTools: Network tab -> right-click a request -> Copy -> 'Copy as cURL (bash)')\n"
    )
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line.strip():
            if lines:
                break
            continue
        lines.append(line)
    return "\n".join(lines)


def _collect_curl_command(vendor: str) -> dict[str, str]:
    raw = _read_curl_paste()
    if not raw:
        return {}
    try:
        extract = parse_curl_command(raw)
    except LoginError as exc:
        typer.secho(f"Curl parse failed: {exc}", fg=typer.colors.RED)
        return {}

    typer.echo(f"\nParsed {len(extract.cookies)} cookies from the curl command.")
    required = _VENDOR_COOKIES.get(vendor, ())
    missing = [name for name in required if name not in extract.cookies]
    if missing:
        typer.secho(
            f"Warning: missing required cookies for {vendor}: {', '.join(missing)}. "
            "The session may not authenticate properly.",
            fg=typer.colors.YELLOW,
        )
    if extract.url:
        typer.echo(f"  Request URL was: {extract.url}")
    return dict(extract.cookies)


def _resolve_login(vendor: str):
    target = _LOGIN_REGISTRY.get(vendor)
    if not target:
        raise typer.BadParameter(f"No login flow registered for vendor: {vendor}")
    module_path, attr = target.split(":")
    import importlib

    mod = importlib.import_module(module_path)
    return getattr(mod, attr)


def login() -> None:
    """Sign in to a social vendor. No flags — just answer the prompts."""
    store = SessionStore()
    vendor = pick_vendor_interactive()

    typer.echo("\nHow do you want to sign in?")
    typer.echo("  1. Open a sign-in window — just log in like normal (Recommended)")
    typer.echo("  2. Type my username and password here in the terminal")
    typer.echo("  3. Advanced options")
    choice = typer.prompt("Pick (1, 2, or 3)", default="1").strip()

    if choice == "1":
        ok = _run_playwright_login(vendor, store)
        raise typer.Exit(code=0 if ok else 1)

    if choice == "3":
        _run_advanced_submenu(vendor, store)
        return

    username = typer.prompt(f"{vendor} username or email")
    password = masked_input(f"{vendor} password (shown as *): ")
    if not password:
        typer.secho("Empty password — aborting.", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    creds = Credentials(username=username, password=password)
    login_fn = _resolve_login(vendor)
    try:
        cookies = login_fn(creds, ConsolePrompt())
    except LoginError as exc:
        typer.secho(f"\nLogin failed: {exc}", fg=typer.colors.RED)
        typer.echo(
            "Tip: try option 1 (sign-in window) — you can complete 2FA/CAPTCHA manually, "
            "then the legitimate session is saved."
        )
        raise typer.Exit(code=1) from exc
    store.save(vendor, cookies)
    typer.secho(
        f"\nSigned in. {len(cookies)} cookies saved to {store.path(vendor)}",
        fg=typer.colors.GREEN,
    )


def _run_playwright_login(vendor: str, store: SessionStore) -> bool:
    typer.echo(
        "\nA browser window will open. Sign in like you normally would — "
        "username, password, and any 2FA codes. When you reach your home page, "
        "the window will close automatically and your session is saved."
    )
    prefill = typer.prompt(
        f"\n(Optional) Pre-fill your {vendor} username/email so you only have to type the password",
        default="",
    ).strip() or None

    def _twofa_hint(v: str) -> None:
        typer.secho(
            f"  ↪ {v} is asking for a 2FA code — enter it in the open window.",
            fg=typer.colors.CYAN,
        )

    try:
        result = open_login_window(
            vendor, prefill_username=prefill, on_twofa_detected=_twofa_hint
        )
    except PlaywrightNotInstalled as exc:
        typer.secho(f"\n{exc}", fg=typer.colors.RED)
        return False
    except TimeoutError as exc:
        typer.secho(f"\n{exc}", fg=typer.colors.RED)
        return False
    except Exception as exc:
        typer.secho(f"\nBrowser login failed: {exc}", fg=typer.colors.RED)
        return False
    store.save(vendor, result.cookies)
    if result.storage_state is not None:
        store.save_storage_state(vendor, result.storage_state)
    typer.secho(
        f"\nSigned in. {len(result.cookies)} cookies saved to {store.path(vendor)}",
        fg=typer.colors.GREEN,
    )
    return True


def _run_advanced_submenu(vendor: str, store: SessionStore) -> None:
    typer.echo("\nAdvanced options:")
    typer.echo("  a. Read cookies from my installed browser jar (Chrome v127+ usually fails)")
    typer.echo("  b. Paste cookie values individually")
    typer.echo("  c. Paste a `curl` command from DevTools")
    adv = typer.prompt("Pick (a, b, or c)", default="c").strip().lower()

    if adv == "a":
        _legacy_browser_jar_login(vendor, store)
        return
    if adv == "b":
        cookies = _collect_manual_cookies(vendor)
        if not cookies:
            typer.secho("No cookies entered.", fg=typer.colors.RED)
            raise typer.Exit(code=1)
        store.save(vendor, cookies)
        typer.secho(f"\nSaved {len(cookies)} cookies -> {store.path(vendor)}", fg=typer.colors.GREEN)
        return
    if adv == "c":
        cookies = _collect_curl_command(vendor)
        if not cookies:
            typer.secho("No cookies in curl.", fg=typer.colors.RED)
            raise typer.Exit(code=1)
        store.save(vendor, cookies)
        typer.secho(f"\nSaved {len(cookies)} cookies -> {store.path(vendor)}", fg=typer.colors.GREEN)
        return
    typer.secho(f"Unknown option: {adv}", fg=typer.colors.RED)
    raise typer.Exit(code=1)


def _legacy_browser_jar_login(vendor: str, store: SessionStore) -> None:
    typer.echo("\nWhich browser?  1.Chrome  2.Edge  3.Firefox  4.Brave  5.Opera  6.Auto")
    b_raw = typer.prompt("Pick (1-6)", default="6").strip()
    b_map = {"1": "chrome", "2": "edge", "3": "firefox", "4": "brave", "5": "opera", "6": "auto"}
    browser = b_map.get(b_raw, "auto")
    report = import_cookies_report(vendor, browser=browser)
    typer.echo("\nBrowser cookie probe:")
    for name, status in report.attempts:
        typer.echo(f"  {name:<10} {status}")
    if not report.ok:
        app_bound = any(
            "unable to get key" in status.lower() or "app-bound" in status.lower()
            for _, status in report.attempts
        )
        requires_admin = any(
            "requiresadmin" in status.lower() for _, status in report.attempts
        )
        typer.echo("")
        if app_bound:
            typer.secho(
                "Chrome v127+ uses app-bound encryption that browser_cookie3 cannot "
                "read. Try option 1 (sign-in window) instead — it always works.",
                fg=typer.colors.RED,
            )
        elif requires_admin:
            typer.secho(
                "Chrome cookies are DPAPI-encrypted at user scope. Run PowerShell as "
                "administrator, or use option 1 (sign-in window) — no admin needed.",
                fg=typer.colors.RED,
            )
        else:
            typer.secho(
                f"No {vendor} cookies recovered. Sign in on that browser first, "
                "or use option 1 (sign-in window).",
                fg=typer.colors.RED,
            )
        raise typer.Exit(code=1)
    store.save(vendor, report.cookies)
    typer.secho(
        f"\nSaved {len(report.cookies)} cookies -> {store.path(vendor)}",
        fg=typer.colors.GREEN,
    )


def logout() -> None:
    """Clear the persisted session for a vendor — no flags, just answer the prompt."""
    vendor = pick_vendor_interactive()
    SessionStore().clear(vendor)
    typer.secho(f"Cleared session for {vendor}.", fg=typer.colors.GREEN)
