import json
import logging
from pathlib import Path
from datetime import datetime

from .auth import _default_session_dir

log = logging.getLogger(__name__)


class ScrapeStateStore:
    def __init__(self, base_dir: Path | None = None) -> None:
        self._dir = base_dir or _default_session_dir()
        self._dir.mkdir(parents=True, exist_ok=True)

    def path(self, vendor: str) -> Path:
        return self._dir / f"{vendor}.scrape_state.json"

    def record_scrape(self, vendor: str) -> None:
        p = self.path(vendor)
        data = {"last_scrape": datetime.now().isoformat()}
        try:
            p.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except OSError as exc:
            log.warning("scrape state save failed for %s: %s", vendor, exc)

    def get_last_scrape(self, vendor: str) -> str | None:
        p = self.path(vendor)
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return data.get("last_scrape")
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("scrape state load failed for %s: %s", vendor, exc)
            return None
