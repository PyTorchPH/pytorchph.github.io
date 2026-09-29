"""Deterministic, display-only resume formatting helpers."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from ..core.models import ResumeSkillGroup

_ECOSYSTEMS = (
    ("JavaScript", ("ReactJS", "React Native", "Vue")),
    ("Python", ("PyTorch", "FastAPI")),
)


def compact_skills(skills: Iterable[str]) -> list[str]:
    """Group known language ecosystems without changing normalized source data."""

    values = [skill.strip() for skill in skills if skill and skill.strip()]
    lower_to_value = {skill.casefold(): skill for skill in values}
    consumed: set[str] = set()
    grouped_at: dict[int, str] = {}

    for parent, children in _ECOSYSTEMS:
        parent_key = parent.casefold()
        present_children = [
            lower_to_value[child.casefold()]
            for child in children
            if child.casefold() in lower_to_value
        ]
        if not present_children:
            continue
        keys = {parent_key, *(child.casefold() for child in present_children)}
        positions = [i for i, value in enumerate(values) if value.casefold() in keys]
        grouped_at[min(positions)] = f"{parent} ({', '.join(present_children)})"
        consumed.update(keys)

    output: list[str] = []
    for index, value in enumerate(values):
        if index in grouped_at:
            output.append(grouped_at[index])
        if value.casefold() not in consumed:
            output.append(value)
    return output


@dataclass(frozen=True)
class SkillLayout:
    groups: list[ResumeSkillGroup]
    columns: int


def plan_skill_layout(
    groups: Iterable[ResumeSkillGroup], *, available_width_px: float = 688.0
) -> SkillLayout:
    """Choose columns from real content width; never assume a fixed three-column grid."""

    clean = [
        ResumeSkillGroup(name=group.name.strip(), items=[item.strip() for item in group.items if item.strip()])
        for group in groups
        if group.name.strip()
    ]
    if not clean:
        return SkillLayout(groups=[], columns=1)
    longest_chars = max(len(group.name) + 2 + len(", ".join(group.items)) for group in clean)
    estimated_column_px = min(320.0, max(170.0, longest_chars * 5.2))
    columns = max(1, min(len(clean), 3, int(available_width_px // estimated_column_px)))
    return SkillLayout(groups=clean, columns=columns)
