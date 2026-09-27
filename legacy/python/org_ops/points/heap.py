"""Generic binary heap (priority queue) — the "heap priority queue" the leaderboard runs on.

Comparator returns True when `a` has HIGHER priority than `b` (should come out first).
A max-leaderboard passes a comparator that ranks higher points first, then applies tiebreakers.

Pure data structure: no I/O, no clock. All mutating operations work in-place on the internal
list; the public API never exposes that list by reference.

Python port of domains/server/organization/workflow/points/heap.ts (PriorityQueue class).
"""

from __future__ import annotations

from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class PriorityQueue(Generic[T]):
    """Generic binary max-heap backed by a comparator.

    Args:
        has_higher_priority: Returns True when ``a`` should come out before ``b``.
        seed: Optional initial items — each is pushed (heapified) in order.
    """

    def __init__(
        self,
        has_higher_priority: Callable[[T, T], bool],
        seed: list[T] | tuple[T, ...] = (),
    ) -> None:
        self._has_higher_priority = has_higher_priority
        self._items: list[T] = []
        for item in seed:
            self.push(item)

    @property
    def size(self) -> int:
        return len(self._items)

    def is_empty(self) -> bool:
        return len(self._items) == 0

    def peek(self) -> T | None:
        """Return the highest-priority item without removing it, or None when empty."""
        return self._items[0] if self._items else None

    def push(self, item: T) -> None:
        """Insert ``item`` and restore the heap property."""
        self._items.append(item)
        self._bubble_up(len(self._items) - 1)

    def pop(self) -> T | None:
        """Remove and return the highest-priority item, or None when empty."""
        if not self._items:
            return None
        top = self._items[0]
        last = self._items.pop()  # removes the last element
        if self._items:           # guard: list not empty after pop
            self._items[0] = last
            self._bubble_down(0)
        return top

    def drain_sorted(self) -> list[T]:
        """Drain the queue into a new list, highest priority first. Leaves the queue empty."""
        out: list[T] = []
        item = self.pop()
        while item is not None:
            out.append(item)
            item = self.pop()
        return out

    # ------------------------------------------------------------------
    # Internal heap maintenance
    # ------------------------------------------------------------------

    def _bubble_up(self, index: int) -> None:
        child = index
        while child > 0:
            parent = (child - 1) >> 1
            if not self._has_higher_priority(self._items[child], self._items[parent]):
                break
            self._items[child], self._items[parent] = self._items[parent], self._items[child]
            child = parent

    def _bubble_down(self, index: int) -> None:
        n = len(self._items)
        parent = index
        while True:
            left = parent * 2 + 1
            right = left + 1
            best = parent
            if left < n and self._has_higher_priority(self._items[left], self._items[best]):
                best = left
            if right < n and self._has_higher_priority(self._items[right], self._items[best]):
                best = right
            if best == parent:
                break
            self._items[parent], self._items[best] = self._items[best], self._items[parent]
            parent = best
