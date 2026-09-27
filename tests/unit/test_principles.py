"""The Harvard Resume philosophy fragment is pinned and wired into every
generation system prompt (and reaches the provider at call time)."""

from __future__ import annotations

import pytest

from resume_builder.extractors.ai_extractor import _SYSTEM as EXTRACT_SYS
from resume_builder.extractors import AIExtractor
from resume_builder.core.models import Repo, RoleSpec
from resume_builder.orchestration.pipeline import _ACHIEVEMENT_SYSTEM, _PROJECT_SYSTEM
from resume_builder.core.principles import HARVARD_PRINCIPLES
from resume_builder.role.ai_picker import _SYSTEM as PICKER_SYS
from resume_builder.role import AIRolePicker
from resume_builder.synthesizers.ai_synth import _SYSTEM as SYNTH_SYS

from .test_ai_stages import _ScriptedLLM


# Anchor phrases — one per principle — so future edits to the fragment are intentional.
_ANCHORS = [
    "seconds per resume",
    "value, not activity",
    "specific, not generic",
    "marketing document",
    "cognitive load",
    "Demonstrate skills",
]


@pytest.mark.parametrize("anchor", _ANCHORS)
def test_fragment_contains_each_principle(anchor):
    assert anchor in HARVARD_PRINCIPLES


@pytest.mark.parametrize(
    "system_prompt",
    [SYNTH_SYS, EXTRACT_SYS, PICKER_SYS, _ACHIEVEMENT_SYSTEM, _PROJECT_SYSTEM],
)
def test_fragment_injected_into_generation_prompts(system_prompt):
    assert HARVARD_PRINCIPLES in system_prompt


def test_fragment_reaches_provider_via_role_picker():
    llm = _ScriptedLLM(
        '{"id": "r", "label": "Role", "keywords": ["x"], '
        '"must_have_skills": ["y"], "nice_to_have": ["z"], "summary_hint": "h"}'
    )
    AIRolePicker(llm).pick("some role")
    assert llm.last_system is not None
    assert HARVARD_PRINCIPLES in llm.last_system


def test_fragment_reaches_provider_via_extractor():
    llm = _ScriptedLLM('{"items": []}')
    AIExtractor(llm).extract(
        [Repo(name="a", full_name="me/a", url="u")], RoleSpec(id="r", label="Role")
    )
    assert llm.last_system is not None
    assert HARVARD_PRINCIPLES in llm.last_system
