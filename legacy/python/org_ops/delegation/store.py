from __future__ import annotations

from pathlib import Path

from .models import DelegationTree, NodeStatus

# INTERIM store (in-memory + JSON file). To be replaced by a Supabase-backed store once
# the real backend exists — keep callers depending only on this small interface.


class TreeStore:
    def __init__(self, path: Path | None = None) -> None:
        self._dir = Path(path) if path else None
        if self._dir:
            self._dir.mkdir(parents=True, exist_ok=True)
        self._mem: dict[str, DelegationTree] = {}

    def _file(self, event: str) -> Path:
        safe = "".join(c if c.isalnum() else "_" for c in event)
        return self._dir / f"tree_{safe}.json"  # type: ignore[union-attr]

    def save(self, tree: DelegationTree) -> None:
        if self._dir:
            self._file(tree.event).write_text(tree.model_dump_json(indent=2), encoding="utf-8")
        else:
            self._mem[tree.event] = tree

    def load(self, event: str) -> DelegationTree | None:
        if self._dir:
            p = self._file(event)
            if not p.exists():
                return None
            return DelegationTree.model_validate_json(p.read_text(encoding="utf-8"))
        return self._mem.get(event)

    def update_status(self, event: str, node_id: str, status: NodeStatus) -> None:
        tree = self.load(event)
        if tree is None or node_id not in tree.nodes:
            return
        tree.nodes[node_id].status = status
        self.save(tree)
