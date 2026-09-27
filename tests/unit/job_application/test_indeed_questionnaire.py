from resume_builder.job_application import (
    ApprovedIndeedQuestionAnswerSet,
    ApprovedIndeedQuestionAnswers,
    ScreeningQuestion,
    build_approved_indeed_question_plan,
    question_set_fingerprint,
)


def _questions() -> list[ScreeningQuestion]:
    return [
        ScreeningQuestion(
            question_id="country",
            label="Where do you currently live?",
            selector='[data-testid="country"]',
            kind="select",
            options=["Australia", "Philippines"],
            required=True,
        ),
        ScreeningQuestion(
            question_id="sponsorship",
            label="Do you require Visa sponsorship to work in your location?",
            selector='[data-testid="sponsorship"]',
            kind="radio",
            options=["No", "Yes, sponsorship is required"],
            required=True,
        ),
        ScreeningQuestion(
            question_id="availability",
            label="What is your availability?",
            selector='[name="availability"]',
            kind="text",
            required=True,
        ),
    ]


def _approved(**overrides: str) -> ApprovedIndeedQuestionAnswers:
    questions = _questions()
    answers = {
        "Where do you currently live?": "Philippines",
        "Do you require Visa sponsorship to work in your location?": (
            "Yes, sponsorship is required"
        ),
        "What is your availability?": "6 months — available to start as soon as possible",
    }
    answers.update(overrides)
    return ApprovedIndeedQuestionAnswers(
        question_set_fingerprint=question_set_fingerprint(questions),
        answers=answers,
    )


def test_exact_approved_answers_create_deterministic_steps():
    result = build_approved_indeed_question_plan(_questions(), _approved())

    assert result.unresolved == []
    assert [step.action for step in result.steps] == ["select", "select", "fill"]
    assert all(
        step.value_source == "runtime user-approved Indeed answer profile"
        for step in result.steps
    )


def test_missing_or_non_option_answer_fails_closed():
    result = build_approved_indeed_question_plan(
        _questions(),
        _approved(**{"Where do you currently live?": "Canada"}),
    )

    assert result.unresolved == ["country"]
    assert [step.value for step in result.steps] == [
        "Yes, sponsorship is required",
        "6 months — available to start as soon as possible",
    ]


def test_virtualized_select_option_mounting_does_not_change_fingerprint():
    approved = _approved()
    changed = _questions()
    changed[0].options.append("Canada")

    result = build_approved_indeed_question_plan(changed, approved)

    assert result.unresolved == []
    assert [step.value for step in result.steps] == [
        "Philippines",
        "Yes, sponsorship is required",
        "6 months — available to start as soon as possible",
    ]


def test_missing_optional_answer_does_not_block_required_answers():
    questions = _questions()
    questions.append(
        ScreeningQuestion(
            question_id="language-3",
            label="Language 3",
            selector='[data-testid="language-3"]',
            kind="select",
            required=False,
        )
    )
    approved = ApprovedIndeedQuestionAnswers(
        question_set_fingerprint=question_set_fingerprint(questions),
        answers=_approved().answers,
    )

    result = build_approved_indeed_question_plan(questions, approved)

    assert result.unresolved == []
    assert [step.value for step in result.steps] == [
        "Philippines",
        "Yes, sponsorship is required",
        "6 months — available to start as soon as possible",
    ]
    assert result.answers[-1].abstain is True


def test_answer_set_selects_only_the_exact_question_page():
    page = _approved()
    answer_set = ApprovedIndeedQuestionAnswerSet(pages=[page])

    assert answer_set.matching(_questions()) == page
    changed = _questions()
    changed[0].label = "Which country do you live in?"
    assert answer_set.matching(changed) is None
