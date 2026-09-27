"""Small persistent cache for reproducible job-market snapshots."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class JobMarketSnapshotStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save(self, *, key: str, source: str, kind: str, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        now = datetime.now(UTC).isoformat()
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                """
                INSERT INTO job_market_snapshots
                    (cache_key, source, snapshot_kind, retrieved_at, record_hash, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key, source) DO UPDATE SET
                    snapshot_kind=excluded.snapshot_kind,
                    retrieved_at=excluded.retrieved_at,
                    record_hash=excluded.record_hash,
                    payload_json=excluded.payload_json
                """,
                (key, source, kind, now, hashlib.sha256(encoded.encode()).hexdigest(), encoded),
            )

    def load(self, *, key: str, source: str) -> dict[str, Any] | None:
        with sqlite3.connect(self.path) as connection:
            row = connection.execute(
                "SELECT payload_json, retrieved_at, snapshot_kind FROM job_market_snapshots "
                "WHERE cache_key=? AND source=?",
                (key, source),
            ).fetchone()
        if row is None:
            return None
        return {"payload": json.loads(row[0]), "retrieved_at": row[1], "kind": row[2]}

    def _initialize(self) -> None:
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_market_snapshots (
                    cache_key TEXT NOT NULL,
                    source TEXT NOT NULL,
                    snapshot_kind TEXT NOT NULL,
                    retrieved_at TEXT NOT NULL,
                    record_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (cache_key, source)
                )
                """
            )
