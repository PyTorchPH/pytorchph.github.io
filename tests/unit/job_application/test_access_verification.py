import json

from resume_builder.job_application import (
    AccessGateResult,
    AccessGateState,
    HumanVerificationQueue,
    InterventionAction,
    VerificationQueueGroup,
    VerificationQueueState,
    sanitize_application_url,
)


def test_sanitize_application_url_removes_query_and_fragment():
    assert (
        sanitize_application_url(
            "https://apply.example.com/review?token=secret&email=a@example.com#submit"
        )
        == "https://apply.example.com/review"
    )


def test_queue_deduplicates_and_does_not_store_url_secrets(tmp_path):
    path = tmp_path / "verification.json"
    queue = HumanVerificationQueue(path)
    result = AccessGateResult(
        state=AccessGateState.HUMAN_REQUIRED,
        reason="captcha",
        evidence="visible incomplete reCAPTCHA",
    )

    first = queue.enqueue(
        application_reference="Backend Developer",
        url="https://apply.example.com/review?token=secret",
        result=result,
    )
    second = queue.enqueue(
        application_reference="Backend Developer",
        url="https://apply.example.com/review?token=another-secret",
        result=result,
    )

    assert first.id == second.id
    assert second.occurrences == 2
    assert second.status == VerificationQueueState.PENDING
    stored = path.read_text(encoding="utf-8")
    assert "secret" not in stored
    assert json.loads(stored)[first.id]["url"] == "https://apply.example.com/review"


def test_url_fallback_reference_does_not_store_query_values(tmp_path):
    path = tmp_path / "verification.json"
    queue = HumanVerificationQueue(path)
    url = "https://apply.example.com/review?token=private-session"

    queue.enqueue(
        application_reference=url,
        url=url,
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="captcha",
        ),
    )

    assert "private-session" not in path.read_text(encoding="utf-8")


def test_clear_recheck_resolves_matching_queue_item(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    blocked = AccessGateResult(
        state=AccessGateState.HUMAN_REQUIRED,
        reason="verification_required",
    )
    queue.enqueue(
        application_reference="AI Engineer",
        url="https://apply.example.com/review?session=private",
        result=blocked,
    )

    resolved = queue.resolve_if_clear(
        application_reference="AI Engineer",
        url="https://apply.example.com/review?session=private",
        result=AccessGateResult(state=AccessGateState.CLEAR),
    )

    assert resolved is not None
    assert resolved.status == VerificationQueueState.RESOLVED
    assert queue.pending() == []


def test_queue_preserves_browser_target_for_exact_human_resume(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    blocked = AccessGateResult(
        state=AccessGateState.HUMAN_REQUIRED,
        reason="captcha",
    )

    queued = queue.enqueue(
        application_reference="Company — Backend Engineer",
        url="https://smartapply.indeed.com/form?token=secret",
        result=blocked,
        browser_target_id="target-123",
    )

    assert queued.browser_target_id == "target-123"
    assert queue.pending()[0].browser_target_id == "target-123"
    assert "secret" not in queue.path.read_text(encoding="utf-8")


def test_queue_does_not_redact_numeric_looking_goal_id(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    goal_id = "100057994f244276839da9fb0793fe0e"

    queued = queue.enqueue_handoff(
        application_reference="Company — Engineer",
        url="https://ph.indeed.com/viewjob?jk=abc123",
        reason="verification_required",
        goal_id=goal_id,
        task_id="company-engineer-abc123",
    )

    assert queued.goal_id == goal_id
    assert json.loads(queue.path.read_text(encoding="utf-8"))[queued.id]["goal_id"] == goal_id


def test_queue_reattaches_pending_entry_to_new_browser_target(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    queued = queue.enqueue_handoff(
        application_reference="Company — Engineer",
        url="https://ph.indeed.com/viewjob?jk=abc123",
        reason="verification_required",
        browser_target_id="old-target",
    )

    updated = queue.reattach_target(
        queued.id,
        browser_target_id="new-target",
        goal_id="100057994f244276839da9fb0793fe0e",
    )

    assert updated.browser_target_id == "new-target"
    assert updated.goal_id == "100057994f244276839da9fb0793fe0e"


def test_resume_gate_approval_is_exact_and_consumed_once(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    queued = queue.enqueue_handoff(
        application_reference="Company — Engineer",
        url="https://smartapply.indeed.com/resume-module",
        reason="resume_upload",
        action=InterventionAction.RESUME_UPLOAD,
    )

    approved = queue.approve_action(queued.id)

    assert approved.status == VerificationQueueState.RESOLVED
    assert (
        queue.approved_action(
            application_reference="Company — Engineer",
            action=InterventionAction.RESUME_UPLOAD,
        )
        is not None
    )
    queue.consume_action(queued.id)
    assert (
        queue.approved_action(
            application_reference="Company — Engineer",
            action=InterventionAction.RESUME_UPLOAD,
        )
        is None
    )


def test_queue_groups_company_site_apply_as_human_intervention(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")

    queued = queue.enqueue(
        application_reference="Company — Backend Engineer",
        url="https://careers.example.com/apply?token=secret",
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="apply_on_company_site",
        ),
        browser_target_id="company-site-target",
        group=VerificationQueueGroup.HUMAN_INTERVENTION,
        task_id="job-1",
        company="Company",
        job_title="Backend Engineer",
        goal_id="goal-1",
        resume_file="software-systems.pdf",
    )

    assert queued.group == VerificationQueueGroup.HUMAN_INTERVENTION
    assert queue.pending()[0].reason == "apply_on_company_site"
    assert queued.task_id == "job-1"
    assert queued.company == "Company"
    assert queued.job_title == "Backend Engineer"
    assert queued.goal_id == "goal-1"
    assert queued.resume_file == "software-systems.pdf"
    assert "secret" not in queue.path.read_text(encoding="utf-8")


def test_only_blocked_results_can_be_enqueued(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")

    try:
        queue.enqueue(
            application_reference="AI Engineer",
            url="https://apply.example.com/review",
            result=AccessGateResult(state=AccessGateState.CLEAR),
        )
    except ValueError as error:
        assert "human-required" in str(error)
    else:
        raise AssertionError("clear access result was queued")


def test_distinct_human_actions_can_coexist_for_one_application(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    common = {
        "application_reference": "Company — Backend Engineer",
        "url": "https://smartapply.indeed.com/form?token=secret",
        "browser_target_id": "target-123",
    }

    captcha = queue.enqueue(
        **common,
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="captcha",
        ),
    )
    question = queue.enqueue_handoff(
        **common,
        reason="unknown_question",
        action=InterventionAction.UNKNOWN_QUESTION,
        question_labels=["Describe your Python experience."],
    )

    assert captcha.id != question.id
    assert {entry.action for entry in queue.pending()} == {
        InterventionAction.CAPTCHA,
        InterventionAction.UNKNOWN_QUESTION,
    }
    assert question.question_labels == ["Describe your Python experience."]


def test_question_approval_is_exact_and_consumed_once(tmp_path):
    queue = HumanVerificationQueue(tmp_path / "verification.json")
    question = queue.enqueue_handoff(
        application_reference="Company — Backend Engineer",
        url="https://smartapply.indeed.com/questions-module",
        reason="unknown_question",
        browser_target_id="target-123",
        action=InterventionAction.UNKNOWN_QUESTION,
    )
    fingerprint = "a" * 40

    approved = queue.approve_question(question.id, question_fingerprint=fingerprint)

    assert approved.status == VerificationQueueState.RESOLVED
    assert queue.pending() == []
    assert (
        queue.approved_question(
            application_reference="Company — Backend Engineer",
            browser_target_id="target-123",
            question_fingerprint=fingerprint,
        )
        is not None
    )
    queue.consume_question_approval(question.id)
    assert (
        queue.approved_question(
            application_reference="Company — Backend Engineer",
            browser_target_id="target-123",
            question_fingerprint=fingerprint,
        )
        is None
    )
    assert "answer" not in queue.path.read_text(encoding="utf-8")


def test_legacy_queue_entry_is_classified_without_rewrite(tmp_path):
    path = tmp_path / "verification.json"
    path.write_text(
        json.dumps(
            {
                "legacy": {
                    "id": "legacy",
                    "application_reference": "Company — Role",
                    "domain": "apply.example.com",
                    "url": "https://apply.example.com/review",
                    "reason": "verification_required",
                    "status": "pending",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            }
        ),
        encoding="utf-8",
    )

    entry = HumanVerificationQueue(path).pending()[0]

    assert entry.action == InterventionAction.HUMAN_VERIFICATION
    assert "action" not in json.loads(path.read_text(encoding="utf-8"))["legacy"]


def test_enqueue_reuses_matching_legacy_identity(tmp_path):
    path = tmp_path / "verification.json"
    domain = "apply.example.com"
    reference = "Company — Role"
    legacy_id = HumanVerificationQueue._legacy_entry_id(domain, reference)
    path.write_text(
        json.dumps(
            {
                legacy_id: {
                    "id": legacy_id,
                    "application_reference": reference,
                    "domain": domain,
                    "url": f"https://{domain}/review",
                    "reason": "captcha",
                    "status": "pending",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            }
        ),
        encoding="utf-8",
    )

    entry = HumanVerificationQueue(path).enqueue(
        application_reference=reference,
        url=f"https://{domain}/review?token=secret",
        result=AccessGateResult(
            state=AccessGateState.HUMAN_REQUIRED,
            reason="captcha",
        ),
    )

    assert entry.id == legacy_id
    assert entry.occurrences == 2
    assert list(json.loads(path.read_text(encoding="utf-8"))) == [legacy_id]
