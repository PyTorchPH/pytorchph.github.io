"""Tests for org_ops.points.heap — PriorityQueue.

Covers: max-heap ordering, pop on empty queue, drain_sorted order.
"""

from __future__ import annotations

from org_ops.points.heap import PriorityQueue


def _max_int(a: int, b: int) -> bool:
    """Comparator: larger integer has higher priority."""
    return a > b


def _min_int(a: int, b: int) -> bool:
    """Comparator: smaller integer has higher priority (min-heap)."""
    return a < b


# ---------------------------------------------------------------------------
# Basic properties
# ---------------------------------------------------------------------------


def test_empty_queue_size_is_zero() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    # Act / Assert
    assert q.size == 0
    assert q.is_empty() is True


def test_single_push_increments_size() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    # Act
    q.push(42)
    # Assert
    assert q.size == 1
    assert q.is_empty() is False


def test_peek_returns_top_without_removing() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    q.push(10)
    q.push(99)
    q.push(5)
    # Act
    top = q.peek()
    # Assert
    assert top == 99
    assert q.size == 3  # unchanged


def test_peek_on_empty_returns_none() -> None:
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    assert q.peek() is None


# ---------------------------------------------------------------------------
# Max-heap ordering
# ---------------------------------------------------------------------------


def test_pop_returns_max_element_first() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    for v in [3, 1, 4, 1, 5, 9, 2, 6]:
        q.push(v)
    # Act
    result = q.pop()
    # Assert
    assert result == 9


def test_repeated_pop_yields_descending_order() -> None:
    # Arrange
    values = [7, 2, 5, 8, 1, 4]
    q: PriorityQueue[int] = PriorityQueue(_max_int, values)
    # Act
    popped = []
    while not q.is_empty():
        popped.append(q.pop())
    # Assert
    assert popped == sorted(values, reverse=True)


def test_min_heap_comparator_yields_ascending_order() -> None:
    # Arrange
    values = [7, 2, 5, 8, 1, 4]
    q: PriorityQueue[int] = PriorityQueue(_min_int, values)
    # Act
    popped = []
    while not q.is_empty():
        popped.append(q.pop())
    # Assert
    assert popped == sorted(values)


# ---------------------------------------------------------------------------
# Pop on empty queue
# ---------------------------------------------------------------------------


def test_pop_on_empty_queue_returns_none() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    # Act
    result = q.pop()
    # Assert
    assert result is None


def test_pop_on_single_element_queue_empties_it() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    q.push(42)
    # Act
    result = q.pop()
    # Assert
    assert result == 42
    assert q.is_empty() is True
    # Second pop should return None
    assert q.pop() is None


# ---------------------------------------------------------------------------
# drain_sorted
# ---------------------------------------------------------------------------


def test_drain_sorted_returns_items_highest_first() -> None:
    # Arrange
    values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
    q: PriorityQueue[int] = PriorityQueue(_max_int, values)
    # Act
    result = q.drain_sorted()
    # Assert
    assert result == sorted(values, reverse=True)


def test_drain_sorted_leaves_queue_empty() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int, [10, 20, 30])
    # Act
    q.drain_sorted()
    # Assert
    assert q.is_empty() is True
    assert q.size == 0


def test_drain_sorted_on_empty_queue_returns_empty_list() -> None:
    q: PriorityQueue[int] = PriorityQueue(_max_int)
    assert q.drain_sorted() == []


def test_seed_constructor_produces_correct_order() -> None:
    # Arrange — seed passed at construction time
    q: PriorityQueue[int] = PriorityQueue(_max_int, (5, 3, 8, 1, 9))
    # Act
    result = q.drain_sorted()
    # Assert
    assert result == [9, 8, 5, 3, 1]


def test_push_after_drain_works_correctly() -> None:
    # Arrange
    q: PriorityQueue[int] = PriorityQueue(_max_int, [1, 2, 3])
    q.drain_sorted()
    # Act — push new items after drain
    q.push(10)
    q.push(5)
    # Assert
    assert q.pop() == 10
    assert q.pop() == 5
    assert q.is_empty() is True


# ---------------------------------------------------------------------------
# Generic type: works with non-integer payloads
# ---------------------------------------------------------------------------


def test_heap_with_string_comparator() -> None:
    # Arrange — reverse-alphabetical max-heap
    q: PriorityQueue[str] = PriorityQueue(lambda a, b: a > b, ["banana", "apple", "cherry"])
    # Act
    result = q.drain_sorted()
    # Assert
    assert result == ["cherry", "banana", "apple"]
