from __future__ import annotations

STATES: tuple[str, ...] = (
    "Search",
    "Open",
    "AnalyzeRequirements",
    "Eligibility",
    "Ineligible",
    "Login",
    "ResumeUpload",
    "ProfileParsing",
    "Questionnaires",
    "CoverLetter",
    "Portfolio",
    "SupportingDocs",
    "Review",
    "Submit",
    "Confirmation",
    "HumanHandoff",
)

_TERMINAL_STATES: frozenset[str] = frozenset({"Ineligible", "Confirmation", "HumanHandoff"})

_BASE_TRANSITIONS: dict[str, set[str]] = {
    "Search": {"Open"},
    "Open": {"AnalyzeRequirements"},
    "AnalyzeRequirements": {"Eligibility"},
    "Eligibility": {"Ineligible", "Login", "ResumeUpload"},
    "Ineligible": set(),
    "Login": {"ResumeUpload", "HumanHandoff"},
    "ResumeUpload": {"ProfileParsing", "Questionnaires"},
    "ProfileParsing": {"Questionnaires"},
    "Questionnaires": {"CoverLetter"},
    "CoverLetter": {"Portfolio"},
    "Portfolio": {"SupportingDocs"},
    "SupportingDocs": {"Review"},
    "Review": {"Submit", "Questionnaires"},
    "Submit": {"Confirmation", "HumanHandoff"},
    "Confirmation": set(),
    "HumanHandoff": set(),
}

# Add HumanHandoff as a valid transition from every non-terminal state
TRANSITIONS: dict[str, set[str]] = {}
for _state, _targets in _BASE_TRANSITIONS.items():
    if _state not in _TERMINAL_STATES:
        TRANSITIONS[_state] = _targets | {"HumanHandoff"}
    else:
        TRANSITIONS[_state] = set(_targets)


class WorkflowStateMachine:
    def next_states(self, state: str) -> set[str]:
        return set(TRANSITIONS.get(state, set()))

    def can_transition(self, a: str, b: str) -> bool:
        return b in TRANSITIONS.get(a, set())

    def transition(self, current: str, target: str, *, human_approved: bool = False) -> str:
        # HumanHandoff is always reachable from any non-terminal state
        if target == "HumanHandoff" and current not in _TERMINAL_STATES:
            return target

        if not self.can_transition(current, target):
            raise ValueError(
                f"Illegal transition: '{current}' -> '{target}'. "
                f"Allowed from '{current}': {self.next_states(current)}"
            )

        # Review -> Submit requires human approval
        if current == "Review" and target == "Submit" and not human_approved:
            raise ValueError(
                "Transition 'Review' -> 'Submit' requires human_approved=True (HITL gate)."
            )

        return target
