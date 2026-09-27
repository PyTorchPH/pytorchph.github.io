# Org Delegation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python core of the Org Delegation Pipeline — a drill-down delegation tree with per-level AI responsibility-chopping, HITL review, a separate dependency layer, e-signature on agree, drill-up requests, a change-control board, and an interim tree store.

**Architecture:** A new `legacy/python/org_ops/delegation/` package. A `DelegationTree` of `DelegationNode`s (root → exec → director → JO-leaf). A `ResponsibilityChopper` (LLM, parallel per child) proposes a node's children; `LevelReview` gates approve/correct; `package_node` emits the checked JSON contract; `sign_node` stamps the e-signature on agree; `DependencyAnalyzer` adds a separate, human-checkmarked prerequisite overlay; `CascadeOrchestrator` drills down to JO leaves; `DrillUp`/`ChangeControlBoard` handle upward requests and parent-gated tree mutation; `TreeStore` persists (interim in-memory + JSON, Supabase later). Platform UI / real backend are out of scope (Backlog).

**Tech Stack:** Python 3.11+, pydantic v2, `concurrent.futures.ThreadPoolExecutor` (stdlib), pytest. Reuses `resume_builder.llm.base.LLMProvider` (the LLM seam, mockable) and the P3 parallel pattern.

## Global Constraints

- Python `>=3.11`; pydantic `>=2.7`; line-length 100; `from __future__ import annotations` at top of every module (production AND test).
- **No new dependencies.** stdlib + pydantic only. Concurrency via `ThreadPoolExecutor`.
- The only LLM-touching units are `ResponsibilityChopper` and `DependencyAnalyzer`, behind `LLMProvider` (mockable). No live network in tests.
- HITL at every level: AI proposes; a human approves/corrects before anything cascades or signs. No silent tree mutation — changes only via approved CCB requests.
- Levels: `root` → `exec` (department) → `director` (field) → `task` (JO leaf). Leaf = `task`.
- Inject any wall-clock via a `now` callable (default `datetime.now(timezone.utc)`) so tests are deterministic — never call `datetime.now()` directly in logic that tests assert on.
- Interim `TreeStore` is explicitly temporary; keep it behind a thin interface so a Supabase backend swaps in later.

---

## File Structure

| File | Responsibility |
|---|---|
| `legacy/python/org_ops/delegation/__init__.py` | public exports |
| `legacy/python/org_ops/delegation/models.py` | enums + `DelegationNode`, `DelegationTree`, `Agreement`, `DependencyEdge`, `DrillUpRequest`, `ChangeRequest` |
| `legacy/python/org_ops/delegation/store.py` | `TreeStore` (in-memory + JSON, interim) |
| `legacy/python/org_ops/delegation/agreement.py` | `sign_node` (AgreeToSign) |
| `legacy/python/org_ops/delegation/chopper.py` | `ResponsibilityChopper` (parallel per-child AI breakdown) |
| `legacy/python/org_ops/delegation/review.py` | `LevelReview` (approve / correct → re-chop) |
| `legacy/python/org_ops/delegation/dependency.py` | `DependencyAnalyzer` + independent/blocked task helpers |
| `legacy/python/org_ops/delegation/cascade.py` | `CascadeOrchestrator` (drill-down to JO leaves) |
| `legacy/python/org_ops/delegation/requests.py` | `DrillUp` + `ChangeControlBoard` |
| `tests/unit/delegation/test_*.py` | one per module |
| `tools/board_export.py` | board_tasks.json → CSV export |

---

### Task 1: Core models

**Files:**
- Create: `legacy/python/org_ops/delegation/__init__.py`, `legacy/python/org_ops/delegation/models.py`
- Test: `tests/unit/delegation/__init__.py`, `tests/unit/delegation/test_models.py`

**Interfaces:**
- Produces: enums `Level("root"|"exec"|"director"|"task")`, `NodeStatus("pending"|"in_progress"|"done")`, `EdgeType("cross_sibling"|"parent_child"|"intra_node")`; models `Agreement(signed_by: str | None = None, e_signature: str | None = None, signed_at: str | None = None)`, `DelegationNode(id: str, level: Level, owner_role: str = "", title: str = "", responsibilities: list[str] = [], children: list[str] = [], status: NodeStatus = pending, agreement: Agreement = Agreement())` with `.is_leaf` (level == task) and `.to_contract() -> dict`; `DependencyEdge(src: str, dst: str, kind: EdgeType, confirmed: bool | None = None)`; `DelegationTree(event: str, nodes: dict[str, DelegationNode] = {}, edges: list[DependencyEdge] = [])` with `.children_of(id)`, `.add(node)`; `DrillUpRequest(from_id: str, to_id: str, kind: "idea"|"problem", message: str)`; `ChangeRequest(node_id: str, parent_id: str, kind: "change"|"add", payload: dict, status: "pending"|"approved"|"rejected" = pending, reason: str = "")`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_models.py
from org_ops.delegation.models import (
    Agreement, DelegationNode, DelegationTree, DependencyEdge, Level, NodeStatus,
)


def test_node_leaf_and_contract():
    n = DelegationNode(id="d.f.t", level=Level.TASK, owner_role="JO", title="Do X",
                       responsibilities=["x"])
    assert n.is_leaf is True
    c = n.to_contract()
    assert c["id"] == "d.f.t" and c["responsibilities"] == ["x"] and "agreement" not in c


def test_tree_children_and_defaults():
    t = DelegationTree(event="Hackathon")
    root = DelegationNode(id="root", level=Level.ROOT, children=["a"])
    a = DelegationNode(id="a", level=Level.EXEC)
    t.add(root); t.add(a)
    assert [n.id for n in t.children_of("root")] == ["a"]
    assert a.status == NodeStatus.PENDING and a.agreement.signed_by is None


def test_dependency_edge_unconfirmed_by_default():
    e = DependencyEdge(src="a", dst="b", kind="cross_sibling")  # type: ignore[arg-type]
    assert e.confirmed is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: org_ops.delegation`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/__init__.py
"""Org Delegation Pipeline — engine core."""
from __future__ import annotations

from .models import (
    Agreement, ChangeRequest, DelegationNode, DelegationTree, DependencyEdge,
    DrillUpRequest, EdgeType, Level, NodeStatus,
)

__all__ = [
    "Agreement", "ChangeRequest", "DelegationNode", "DelegationTree", "DependencyEdge",
    "DrillUpRequest", "EdgeType", "Level", "NodeStatus",
]
```

```python
# legacy/python/org_ops/delegation/models.py
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Level(str, Enum):
    ROOT = "root"
    EXEC = "exec"
    DIRECTOR = "director"
    TASK = "task"


class NodeStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class EdgeType(str, Enum):
    CROSS_SIBLING = "cross_sibling"
    PARENT_CHILD = "parent_child"
    INTRA_NODE = "intra_node"


class Agreement(BaseModel):
    signed_by: str | None = None
    e_signature: str | None = None
    signed_at: str | None = None  # ISO timestamp


class DelegationNode(BaseModel):
    id: str
    level: Level
    owner_role: str = ""
    title: str = ""
    responsibilities: list[str] = Field(default_factory=list)
    children: list[str] = Field(default_factory=list)
    status: NodeStatus = NodeStatus.PENDING
    agreement: Agreement = Field(default_factory=Agreement)

    @property
    def is_leaf(self) -> bool:
        return self.level == Level.TASK

    def to_contract(self) -> dict:
        """The checked-by-parent JSON handed to the level below (no agreement state)."""
        return {
            "id": self.id, "level": self.level.value, "owner_role": self.owner_role,
            "title": self.title, "responsibilities": list(self.responsibilities),
            "children": list(self.children),
        }


class DependencyEdge(BaseModel):
    src: str
    dst: str               # src depends on dst (dst is the prerequisite)
    kind: EdgeType
    confirmed: bool | None = None  # human checkmark: None=unreviewed, True/False=verdict


class DrillUpRequest(BaseModel):
    from_id: str
    to_id: str
    kind: Literal["idea", "problem"]
    message: str


class ChangeRequest(BaseModel):
    node_id: str
    parent_id: str
    kind: Literal["change", "add"]
    payload: dict = Field(default_factory=dict)
    status: Literal["pending", "approved", "rejected"] = "pending"
    reason: str = ""


class DelegationTree(BaseModel):
    event: str
    nodes: dict[str, DelegationNode] = Field(default_factory=dict)
    edges: list[DependencyEdge] = Field(default_factory=list)

    def add(self, node: DelegationNode) -> None:
        self.nodes[node.id] = node

    def children_of(self, node_id: str) -> list[DelegationNode]:
        parent = self.nodes.get(node_id)
        if parent is None:
            return []
        return [self.nodes[c] for c in parent.children if c in self.nodes]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_models.py -v`
Expected: PASS (3 passed). Also create empty `tests/unit/delegation/__init__.py`.

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/__init__.py legacy/python/org_ops/delegation/models.py tests/unit/delegation/__init__.py tests/unit/delegation/test_models.py
git commit -m "feat(delegation): core models (tree, node, agreement, edges, requests)"
```

---

### Task 2: `TreeStore` (interim in-memory + JSON)

**Files:**
- Create: `legacy/python/org_ops/delegation/store.py`
- Test: `tests/unit/delegation/test_store.py`

**Interfaces:**
- Consumes: `DelegationTree` (Task 1).
- Produces: `TreeStore(path: Path | None = None)` with `.save(tree) -> None`, `.load(event: str) -> DelegationTree | None`, `.update_status(event, node_id, status) -> None`. JSON file when `path` given, else in-memory.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_store.py
from org_ops.delegation.models import DelegationNode, DelegationTree, Level, NodeStatus
from org_ops.delegation.store import TreeStore


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="a", level=Level.TASK))
    return t


def test_in_memory_roundtrip_and_status():
    s = TreeStore()
    s.save(_tree())
    s.update_status("E", "a", NodeStatus.DONE)
    loaded = s.load("E")
    assert loaded is not None and loaded.nodes["a"].status == NodeStatus.DONE


def test_json_file_persistence(tmp_path):
    s = TreeStore(path=tmp_path)
    s.save(_tree())
    again = TreeStore(path=tmp_path).load("E")  # fresh instance reads the file
    assert again is not None and "a" in again.nodes


def test_load_missing_returns_none():
    assert TreeStore().load("nope") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_store.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/store.py
from __future__ import annotations

import json
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_store.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/store.py tests/unit/delegation/test_store.py
git commit -m "feat(delegation): interim TreeStore (in-memory + JSON)"
```

---

### Task 3: `sign_node` (AgreeToSign)

**Files:**
- Create: `legacy/python/org_ops/delegation/agreement.py`
- Test: `tests/unit/delegation/test_agreement.py`

**Interfaces:**
- Consumes: `DelegationNode`, `Agreement` (Task 1).
- Produces: `sign_node(node: DelegationNode, signer: str, e_signature: str, now=None) -> DelegationNode` — returns a copy with `agreement` stamped (`signed_by`, `e_signature`, `signed_at` ISO). `now` is an injectable `() -> datetime`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_agreement.py
from datetime import datetime, timezone

from org_ops.delegation.agreement import sign_node
from org_ops.delegation.models import DelegationNode, Level


def test_sign_stamps_signature_and_timestamp():
    n = DelegationNode(id="a", level=Level.EXEC, owner_role="Exec")
    fixed = datetime(2026, 6, 30, 12, 0, tzinfo=timezone.utc)
    signed = sign_node(n, signer="Juan", e_signature="JUAN-SIG", now=lambda: fixed)
    assert signed.agreement.signed_by == "Juan"
    assert signed.agreement.e_signature == "JUAN-SIG"
    assert signed.agreement.signed_at == fixed.isoformat()
    assert n.agreement.signed_by is None  # original untouched (immutable)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_agreement.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/agreement.py
from __future__ import annotations

from datetime import datetime, timezone

from .models import Agreement, DelegationNode


def sign_node(node: DelegationNode, signer: str, e_signature: str, now=None) -> DelegationNode:
    """AgreeToSign: clicking 'Agree' stamps the signer's e-signature + timestamp on the node."""
    clock = now or (lambda: datetime.now(timezone.utc))
    stamped = Agreement(signed_by=signer, e_signature=e_signature, signed_at=clock().isoformat())
    return node.model_copy(update={"agreement": stamped})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_agreement.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/agreement.py tests/unit/delegation/test_agreement.py
git commit -m "feat(delegation): sign_node (Agree = e-signature + timestamp)"
```

---

### Task 4: `ResponsibilityChopper` (parallel per-child AI breakdown)

**Files:**
- Create: `legacy/python/org_ops/delegation/chopper.py`
- Test: `tests/unit/delegation/test_chopper.py`

**Interfaces:**
- Consumes: `DelegationNode`, `Level` (Task 1); `LLMProvider` (`resume_builder.llm.base`).
- Produces: `ResponsibilityChopper(llm: LLMProvider, max_workers: int = 6)` with `.chop(parent: DelegationNode, child_titles: list[str], child_level: Level, owner_role: str) -> list[DelegationNode]` — one parallel LLM call per child title, each returning that child's responsibilities; never raises (a failed child yields an empty-responsibilities node). Inner schema `_Responsibilities(items: list[str] = [])`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_chopper.py
from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import DelegationNode, Level


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["draft agenda", "book venue"])


def test_chop_returns_one_node_per_child_with_responsibilities():
    parent = DelegationNode(id="root", level=Level.ROOT, title="Event")
    out = ResponsibilityChopper(_FakeLLM()).chop(
        parent, child_titles=["Logistics", "Marketing"], child_level=Level.EXEC, owner_role="Exec")
    assert [n.id for n in out] == ["root.Logistics", "root.Marketing"]
    assert all(n.level == Level.EXEC and n.owner_role == "Exec" for n in out)
    assert out[0].responsibilities == ["draft agenda", "book venue"]


def test_chop_degrades_on_llm_error():
    class _Boom:
        def structured(self, *a, **k):
            raise RuntimeError("down")

    out = ResponsibilityChopper(_Boom()).chop(
        DelegationNode(id="r", level=Level.ROOT), ["A"], Level.EXEC, "Exec")
    assert out[0].responsibilities == [] and out[0].id == "r.A"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_chopper.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/chopper.py
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from resume_builder.llm.base import LLMProvider

from .models import DelegationNode, Level

log = logging.getLogger(__name__)

_SYSTEM = (
    "You break a parent responsibility into concrete responsibilities for ONE child unit "
    "(department, field, or task owner) in a student-org delegation tree. Be specific and "
    "action-oriented; return only this child's responsibilities. No numbering, no preamble."
)


class _Responsibilities(BaseModel):
    items: list[str] = Field(default_factory=list)


class ResponsibilityChopper:
    """Per-level AI breakdown: one parallel LLM call per child. Never raises."""

    def __init__(self, llm: LLMProvider, max_workers: int = 6) -> None:
        self._llm = llm
        self._max_workers = max(1, max_workers)

    def _one(self, parent: DelegationNode, title: str, child_level: Level, owner_role: str) -> DelegationNode:
        prompt = (
            f"Event/parent: {parent.title}\nParent responsibilities: {parent.responsibilities}\n"
            f"Child unit: {title} (level={child_level.value})\n\n"
            "List this child's responsibilities."
        )
        try:
            resp = self._llm.structured(prompt, schema=_Responsibilities, system=_SYSTEM, max_tokens=1024)
            items = list(resp.items)
        except Exception as exc:  # noqa: BLE001 — a failed child degrades to empty, never breaks the batch
            log.warning("chop failed for %s/%s: %s", parent.id, title, exc)
            items = []
        return DelegationNode(
            id=f"{parent.id}.{title}", level=child_level, owner_role=owner_role,
            title=title, responsibilities=items,
        )

    def chop(self, parent: DelegationNode, child_titles: list[str], child_level: Level,
             owner_role: str) -> list[DelegationNode]:
        if not child_titles:
            return []
        with ThreadPoolExecutor(max_workers=self._max_workers) as pool:
            results = list(pool.map(
                lambda t: self._one(parent, t, child_level, owner_role), child_titles))
        return results  # pool.map preserves input order
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_chopper.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/chopper.py tests/unit/delegation/test_chopper.py
git commit -m "feat(delegation): ResponsibilityChopper (parallel per-child AI breakdown)"
```

---

### Task 5: `LevelReview` (approve / correct → re-chop)

**Files:**
- Create: `legacy/python/org_ops/delegation/review.py`
- Test: `tests/unit/delegation/test_review.py`

**Interfaces:**
- Consumes: `DelegationNode` (Task 1); `ResponsibilityChopper` (Task 4).
- Produces: `LevelReview(chopper: ResponsibilityChopper)` with `.review(parent, children, decision: "approve" | "correct", child_level, owner_role, correction: str = "") -> tuple[str, list[DelegationNode]]` — on `approve` returns `("approved", children)`; on `correct` re-chops the parent (only this subtree) with the correction folded into the parent context and returns `("rechopped", new_children)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_review.py
from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import DelegationNode, Level
from org_ops.delegation.review import LevelReview


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["corrected item"] if "CORRECTION" in prompt else ["orig"])


def _parent():
    return DelegationNode(id="root", level=Level.ROOT, title="Event")


def test_approve_passes_children_through():
    review = LevelReview(ResponsibilityChopper(_FakeLLM()))
    kids = [DelegationNode(id="root.A", level=Level.EXEC)]
    verdict, out = review.review(_parent(), kids, "approve", Level.EXEC, "Exec")
    assert verdict == "approved" and out == kids


def test_correct_rechops_only_this_subtree_with_correction():
    review = LevelReview(ResponsibilityChopper(_FakeLLM()))
    kids = [DelegationNode(id="root.A", level=Level.EXEC, title="A")]
    verdict, out = review.review(_parent(), kids, "correct", Level.EXEC, "Exec",
                                 correction="add CORRECTION")
    assert verdict == "rechopped"
    assert out[0].responsibilities == ["corrected item"]  # the correction reached the chopper
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_review.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/review.py
from __future__ import annotations

from .chopper import ResponsibilityChopper
from .models import DelegationNode, Level


class LevelReview:
    """HITL gate: approve the AI proposal, or correct it (re-chop only this subtree)."""

    def __init__(self, chopper: ResponsibilityChopper) -> None:
        self._chopper = chopper

    def review(
        self,
        parent: DelegationNode,
        children: list[DelegationNode],
        decision: str,
        child_level: Level,
        owner_role: str,
        correction: str = "",
    ) -> tuple[str, list[DelegationNode]]:
        if decision == "approve":
            return "approved", children
        # correct → fold the correction into the parent context and re-chop ONLY this subtree
        amended = parent.model_copy(update={
            "responsibilities": [*parent.responsibilities, f"CORRECTION: {correction}"],
        })
        titles = [c.title or c.id.rsplit(".", 1)[-1] for c in children]
        return "rechopped", self._chopper.chop(amended, titles, child_level, owner_role)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_review.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/review.py tests/unit/delegation/test_review.py
git commit -m "feat(delegation): LevelReview (approve / correct -> re-chop subtree)"
```

---

### Task 6: `DependencyAnalyzer` + scheduling helpers (separate layer)

**Files:**
- Create: `legacy/python/org_ops/delegation/dependency.py`
- Test: `tests/unit/delegation/test_dependency.py`

**Interfaces:**
- Consumes: `DelegationTree`, `DependencyEdge`, `EdgeType` (Task 1); `LLMProvider`.
- Produces: `DependencyAnalyzer(llm)` with `.suggest(tree) -> list[DependencyEdge]` (AI-suggested edges, `confirmed=None`); module fns `confirmed_edges(edges)`, `blocked_nodes(tree, edges)` (nodes whose confirmed prerequisite isn't done), `independent_nodes(tree, edges)` (nodes with no confirmed incoming prereq → side-tasks). Inner schema `_EdgeList(items: list[DependencyEdge] = [])`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_dependency.py
from org_ops.delegation.dependency import (
    DependencyAnalyzer, blocked_nodes, independent_nodes,
)
from org_ops.delegation.models import (
    DelegationNode, DelegationTree, DependencyEdge, EdgeType, Level, NodeStatus,
)


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=[DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING)])


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="a", level=Level.TASK, status=NodeStatus.PENDING))
    t.add(DelegationNode(id="b", level=Level.TASK))
    return t


def test_suggest_returns_unconfirmed_edges():
    edges = DependencyAnalyzer(_FakeLLM()).suggest(_tree())
    assert edges[0].src == "b" and edges[0].dst == "a" and edges[0].confirmed is None


def test_blocked_and_independent_use_confirmed_edges_only():
    t = _tree()
    confirmed = [DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING, confirmed=True)]
    # a is pending → b (which depends on a) is blocked; a has no incoming prereq → independent
    assert blocked_nodes(t, confirmed) == ["b"]
    assert independent_nodes(t, confirmed) == ["a"]
    # unconfirmed edges are ignored
    unconfirmed = [DependencyEdge(src="b", dst="a", kind=EdgeType.CROSS_SIBLING)]
    assert blocked_nodes(t, unconfirmed) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_dependency.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/dependency.py
from __future__ import annotations

from pydantic import BaseModel, Field

from resume_builder.llm.base import LLMProvider

from .models import DelegationTree, DependencyEdge, NodeStatus

_SYSTEM = (
    "You analyze a delegation tree and SUGGEST prerequisite dependencies between units: "
    "cross_sibling (dept/field needs another's output), parent_child (level needs the level above), "
    "and intra_node (a task needs another task in the same unit). Return edges as src depends on dst "
    "(dst is the prerequisite). This is a SUGGESTION for human review, not final."
)


class _EdgeList(BaseModel):
    items: list[DependencyEdge] = Field(default_factory=list)


class DependencyAnalyzer:
    """AI-suggested prerequisite overlay (separate layer; humans checkmark each edge)."""

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    def suggest(self, tree: DelegationTree) -> list[DependencyEdge]:
        listing = "\n".join(f"{n.id} ({n.level.value}): {n.title}" for n in tree.nodes.values())
        prompt = f"Event: {tree.event}\nNodes:\n{listing}\n\nReturn suggested dependency edges."
        try:
            result = self._llm.structured(prompt, schema=_EdgeList, system=_SYSTEM, max_tokens=1024)
        except Exception:  # noqa: BLE001
            return []
        for e in result.items:
            e.confirmed = None  # always unreviewed when freshly suggested
        return result.items


def confirmed_edges(edges: list[DependencyEdge]) -> list[DependencyEdge]:
    return [e for e in edges if e.confirmed is True]


def blocked_nodes(tree: DelegationTree, edges: list[DependencyEdge]) -> list[str]:
    """Nodes with a CONFIRMED prerequisite (dst) that is not done yet."""
    out: list[str] = []
    for e in confirmed_edges(edges):
        dst = tree.nodes.get(e.dst)
        if dst is not None and dst.status != NodeStatus.DONE and e.src not in out:
            out.append(e.src)
    return out


def independent_nodes(tree: DelegationTree, edges: list[DependencyEdge]) -> list[str]:
    """Nodes with no CONFIRMED incoming prerequisite — safe side-tasks to do anytime."""
    has_prereq = {e.src for e in confirmed_edges(edges)}
    return [nid for nid in tree.nodes if nid not in has_prereq]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_dependency.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/dependency.py tests/unit/delegation/test_dependency.py
git commit -m "feat(delegation): DependencyAnalyzer + blocked/independent helpers (separate layer)"
```

---

### Task 7: `CascadeOrchestrator` (drill-down to JO leaves)

**Files:**
- Create: `legacy/python/org_ops/delegation/cascade.py`
- Test: `tests/unit/delegation/test_cascade.py`

**Interfaces:**
- Consumes: `DelegationTree`, `DelegationNode`, `Level` (Task 1); `ResponsibilityChopper` (Task 4).
- Produces: `CascadeOrchestrator(chopper)` with `.build(event: str, plan: dict) -> DelegationTree` where `plan` maps a parent title → `{child_titles, child_level, owner_role}` per level; it chops level by level from the root down to JO `task` leaves, wiring `children` ids, and returns the assembled tree. (Auto-approve is assumed for the build helper; real HITL approval happens via LevelReview before each level in production.)

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_cascade.py
from org_ops.delegation.cascade import CascadeOrchestrator
from org_ops.delegation.chopper import ResponsibilityChopper
from org_ops.delegation.models import Level


class _FakeLLM:
    def structured(self, prompt, schema, system=None, max_tokens=2048):
        return schema(items=["r1"])


def test_build_drills_down_to_task_leaves():
    plan = {
        "root": {"children": ["Logistics"], "level": "exec", "owner_role": "Exec"},
        "root.Logistics": {"children": ["Venue"], "level": "director", "owner_role": "Director"},
        "root.Logistics.Venue": {"children": ["Book hall"], "level": "task", "owner_role": "JO"},
    }
    tree = CascadeOrchestrator(ResponsibilityChopper(_FakeLLM())).build("Hackathon", plan)
    assert tree.nodes["root"].children == ["root.Logistics"]
    leaf = tree.nodes["root.Logistics.Venue.Book hall"]
    assert leaf.level == Level.TASK and leaf.is_leaf and leaf.owner_role == "JO"
    # every non-leaf has its children wired
    assert tree.nodes["root.Logistics"].children == ["root.Logistics.Venue"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_cascade.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/cascade.py
from __future__ import annotations

from collections import deque

from .chopper import ResponsibilityChopper
from .models import DelegationNode, DelegationTree, Level


class CascadeOrchestrator:
    """Drill-down: chop each node into its children, level by level, down to JO task leaves."""

    def __init__(self, chopper: ResponsibilityChopper) -> None:
        self._chopper = chopper

    def build(self, event: str, plan: dict) -> DelegationTree:
        tree = DelegationTree(event=event)
        root = DelegationNode(id="root", level=Level.ROOT, title=event)
        tree.add(root)
        queue: deque[str] = deque(["root"])
        while queue:
            node_id = queue.popleft()
            spec = plan.get(node_id)
            if not spec:  # no expansion plan → leaf
                continue
            child_level = Level(spec["level"])
            children = self._chopper.chop(
                tree.nodes[node_id], spec["children"], child_level, spec["owner_role"])
            tree.nodes[node_id].children = [c.id for c in children]
            for c in children:
                tree.add(c)
                if not c.is_leaf:
                    queue.append(c.id)
        return tree
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_cascade.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/cascade.py tests/unit/delegation/test_cascade.py
git commit -m "feat(delegation): CascadeOrchestrator (drill-down to JO leaves)"
```

---

### Task 8: `DrillUp` + `ChangeControlBoard`

**Files:**
- Create: `legacy/python/org_ops/delegation/requests.py`
- Test: `tests/unit/delegation/test_requests.py`

**Interfaces:**
- Consumes: `DelegationTree`, `DelegationNode`, `DrillUpRequest`, `ChangeRequest` (Task 1).
- Produces: `submit_drill_up(from_id, to_id, kind, message) -> DrillUpRequest`; `ChangeControlBoard(tree)` with `.submit(node_id, parent_id, kind, payload) -> ChangeRequest` and `.decide(req, approve, reason="") -> ChangeRequest` — on approve it mutates the tree (`change` updates the node's responsibilities from `payload["responsibilities"]`; `add` inserts a new child node from `payload`), on reject it records the reason and does NOT mutate.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/delegation/test_requests.py
from org_ops.delegation.models import DelegationNode, DelegationTree, Level
from org_ops.delegation.requests import ChangeControlBoard, submit_drill_up


def _tree():
    t = DelegationTree(event="E")
    t.add(DelegationNode(id="root", level=Level.ROOT, children=["root.A"]))
    t.add(DelegationNode(id="root.A", level=Level.EXEC, responsibilities=["old"]))
    return t


def test_drill_up_request_records_idea():
    r = submit_drill_up("root.A.x", "root.A", "idea", "let's add a sponsor track")
    assert r.kind == "idea" and r.to_id == "root.A"


def test_ccb_approve_change_mutates_tree():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A", "root", "change", {"responsibilities": ["new"]})
    done = ccb.decide(req, approve=True)
    assert done.status == "approved"
    assert ccb.tree.nodes["root.A"].responsibilities == ["new"]


def test_ccb_reject_does_not_mutate():
    ccb = ChangeControlBoard(_tree())
    req = ccb.submit("root.A", "root", "change", {"responsibilities": ["new"]})
    done = ccb.decide(req, approve=False, reason="out of scope")
    assert done.status == "rejected" and done.reason == "out of scope"
    assert ccb.tree.nodes["root.A"].responsibilities == ["old"]  # unchanged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_requests.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Write minimal implementation**

```python
# legacy/python/org_ops/delegation/requests.py
from __future__ import annotations

from typing import Literal

from .models import ChangeRequest, DelegationNode, DelegationTree, DrillUpRequest, Level


def submit_drill_up(from_id: str, to_id: str, kind: Literal["idea", "problem"],
                    message: str) -> DrillUpRequest:
    """Upward request: a node escalates an idea or a problem to a higher node."""
    return DrillUpRequest(from_id=from_id, to_id=to_id, kind=kind, message=message)


class ChangeControlBoard:
    """Any change/add from below routes to the parent for approval before it mutates the tree."""

    def __init__(self, tree: DelegationTree) -> None:
        self.tree = tree

    def submit(self, node_id: str, parent_id: str, kind: Literal["change", "add"],
               payload: dict) -> ChangeRequest:
        return ChangeRequest(node_id=node_id, parent_id=parent_id, kind=kind, payload=payload)

    def decide(self, req: ChangeRequest, approve: bool, reason: str = "") -> ChangeRequest:
        if not approve:
            return req.model_copy(update={"status": "rejected", "reason": reason})
        if req.kind == "change":
            node = self.tree.nodes.get(req.node_id)
            if node is not None and "responsibilities" in req.payload:
                node.responsibilities = list(req.payload["responsibilities"])
        elif req.kind == "add":
            new = DelegationNode(
                id=req.payload["id"], level=Level(req.payload.get("level", "task")),
                title=req.payload.get("title", ""), owner_role=req.payload.get("owner_role", ""),
            )
            self.tree.add(new)
            parent = self.tree.nodes.get(req.parent_id)
            if parent is not None and new.id not in parent.children:
                parent.children.append(new.id)
        return req.model_copy(update={"status": "approved", "reason": reason})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/test_requests.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add legacy/python/org_ops/delegation/requests.py tests/unit/delegation/test_requests.py
git commit -m "feat(delegation): DrillUp requests + ChangeControlBoard (parent-gated mutation)"
```

---

### Task 9: Board → CSV export tool

**Files:**
- Create: `tools/board_export.py`
- Test: `tests/unit/test_board_export.py`

**Interfaces:**
- Consumes: nothing (reads a tasks list).
- Produces: `tasks_to_csv(tasks: list[dict], fields: list[str] | None = None) -> str` (CSV text, header + rows; default fields `["title","stage","role","group","department","priority","estimate","target"]`); `export_board(json_path, csv_path, event=None)` writes a CSV from `board_tasks.json` (filter by `event` substring in title when given).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_board_export.py
from tools.board_export import tasks_to_csv


def test_tasks_to_csv_header_and_rows():
    tasks = [{"title": "A,b", "stage": "Todo", "role": "AI"},
             {"title": "B", "stage": "Done", "role": "QA"}]
    csv = tasks_to_csv(tasks, fields=["title", "stage", "role"])
    lines = csv.splitlines()
    assert lines[0] == "title,stage,role"
    assert '"A,b",Todo,AI' in lines[1]   # comma-containing field is quoted
    assert "B,Done,QA" in lines[2]


def test_tasks_to_csv_missing_field_is_blank():
    csv = tasks_to_csv([{"title": "X"}], fields=["title", "stage"])
    assert csv.splitlines()[1] == "X,"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_board_export.py -v`
Expected: FAIL with `ModuleNotFoundError: tools.board_export` (ensure `tools/__init__.py` exists; create it if missing).

- [ ] **Step 3: Write minimal implementation**

```python
# tools/board_export.py
from __future__ import annotations

import csv
import io
import json
from pathlib import Path

_DEFAULT_FIELDS = ["title", "stage", "role", "group", "department", "priority", "estimate", "target"]


def tasks_to_csv(tasks: list[dict], fields: list[str] | None = None) -> str:
    cols = fields or _DEFAULT_FIELDS
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(cols)
    for t in tasks:
        writer.writerow([t.get(c, "") for c in cols])
    return buf.getvalue()


def export_board(json_path: str | Path, csv_path: str | Path, event: str | None = None) -> Path:
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    tasks = data["tasks"] if isinstance(data, dict) and "tasks" in data else data
    if event:
        tasks = [t for t in tasks if event.lower() in t.get("title", "").lower()]
    out = Path(csv_path)
    out.write_text(tasks_to_csv(tasks), encoding="utf-8")
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/test_board_export.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the full delegation suite + commit**

Run: `.venv/Scripts/python.exe -m pytest tests/unit/delegation/ tests/unit/test_board_export.py -q`
Expected: PASS (all green).

```bash
git add tools/board_export.py tests/unit/test_board_export.py
git commit -m "feat(tools): board -> CSV export (filterable by event)"
```

---

## Notes for the implementer

- **Platform UI / Supabase backend are out of scope (Backlog).** This plan builds the testable Python engine only; the general-board real-time UI, the Supabase-backed `TreeStore`, the DocumentInjector HTML/PDF rendering, and the e-signature audit UI come later (`domains/server/organization/workflow/` + Supabase).
- **Live runs use the session model:** with no API key, the chopper/analyzer run behind a `claude-session`/file-bridge `LLMProvider` (the same stand-in used elsewhere) — the engine code needs no change.
- **Excel:** `tasks_to_csv` emits CSV (opens directly in Excel). A native `.xlsx` writer would need a new dependency (`openpyxl`); keep CSV for now per the no-new-deps rule.
