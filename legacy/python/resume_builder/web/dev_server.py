"""Development server entrypoint for Windows-friendly local previews."""

from __future__ import annotations

import asyncio
import argparse
import sys
import threading
import time

import requests

import uvicorn

from .shared_browser import open_tab


def _open_control_center_when_ready(port: int) -> None:
    health_url = f"http://127.0.0.1:{port}/healthz"
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            response = requests.get(health_url, timeout=1)
            if response.ok:
                open_tab(f"http://127.0.0.1:{port}/")
                return
        except requests.RequestException:
            pass
        time.sleep(0.1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Open the control center as a tab in the shared visible Brave/CDP session.",
    )
    args = parser.parse_args()
    loop: str | type[asyncio.AbstractEventLoop] = "auto"
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        loop = asyncio.SelectorEventLoop

    if args.open_browser:
        threading.Thread(
            target=_open_control_center_when_ready,
            args=(args.port,),
            daemon=True,
        ).start()
    uvicorn.run("resume_builder.web.app:app", host="127.0.0.1", port=args.port, loop=loop)


if __name__ == "__main__":
    main()
