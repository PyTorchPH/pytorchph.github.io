import argparse
import importlib.util
import json
from pathlib import Path
from threading import Lock
import time
from types import SimpleNamespace

from resume_builder.core.models import ContactInfo, Resume, RoleSpec
from resume_builder.job_application import (
    ApplicationGoalStore,
    ApprovedIndeedQuestionAnswerSet,
    ApprovedIndeedQuestionAnswers,
    BatchApplicationOutcome,
    BatchApplicationStatus,
    ScreeningQuestion,
)


_SCRIPT = Path(__file__).parents[3] / "tools" / "job_finder" / "run_indeed_unattended.py"
_SPEC = importlib.util.spec_from_file_location("run_indeed_unattended", _SCRIPT)
assert _SPEC and _SPEC.loader
runner = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(runner)


def _manifest(path: Path, count: int) -> None:
    jobs = [
        {
            "task_id": f"job-{index}",
            "company": f"Company {index}",
            "job_title": f"Backend Engineer {index}",
            "listing_url": f"https://ca.indeed.com/viewjob?jk={index}",
            "target_country": "Canada",
            "work_mode": "remote",
        }
        for index in range(count)
    ]
    path.write_text(json.dumps({"jobs": jobs}), encoding="utf-8")


def _args(tmp_path: Path, *, count: int, target: int = 3) -> argparse.Namespace:
    manifest = tmp_path / "manifest.json"
    _manifest(manifest, count)
    return argparse.Namespace(
        manifest=manifest,
        output=tmp_path / "run",
        max_candidates=12,
        max_parallel=3,
        target_submissions=target,
        verification_wait_minutes=1,
        verification_retry_seconds=0.01,
    )


def _outcome(job, status):
    return BatchApplicationOutcome(task=job.batch_task(), status=status)


def test_safe_draft_only_disables_sensitive_writes_and_resume_approvals():
    policy, approvals = runner._application_permissions(
        SimpleNamespace(safe_draft_only=True, autonomous_submit=False)
    )

    assert policy.autonomous_draft_writes is True
    assert policy.autonomous_sensitive_writes is False
    assert policy.autonomous_submit is False
    assert approvals.resume_upload is False
    assert approvals.resume_continue is False
    assert approvals.final_submit is False


def test_assisted_apply_allows_verified_writes_but_keeps_resume_and_submit_gates():
    policy, approvals = runner._application_permissions(
        SimpleNamespace(
            safe_draft_only=False,
            assisted_apply=True,
            autonomous_submit=False,
        )
    )

    assert policy.autonomous_draft_writes is True
    assert policy.autonomous_sensitive_writes is True
    assert policy.autonomous_submit is False
    assert approvals.resume_upload is False
    assert approvals.resume_continue is False
    assert approvals.final_submit is False


def test_submitted_goal_outcome_consumes_one_token(tmp_path):
    database = tmp_path / "history.sqlite3"
    store = ApplicationGoalStore(database)
    goal = store.create(target=2)
    manifest = tmp_path / "manifest.json"
    _manifest(manifest, 1)
    job = runner.IndeedUnattendedManifest.model_validate_json(manifest.read_text()).jobs[0]

    runner._record_goal_outcome(
        SimpleNamespace(goal_id=goal.id, database=database),
        _outcome(job, BatchApplicationStatus.SUBMITTED),
    )

    updated = store.get(goal.id)
    assert updated.confirmed == 1
    assert updated.remaining == 1


def test_runner_loads_approved_questions_from_mongodb_when_required(monkeypatch):
    expected = ApprovedIndeedQuestionAnswerSet(
        pages=[
            ApprovedIndeedQuestionAnswers(
                question_set_fingerprint="a" * 40,
                answers={"Where do you currently live?": "Philippines"},
            )
        ]
    )
    observed = {}

    class _Repository:
        def __init__(self, uri, *, database):
            observed.update(uri=uri, database=database)

        def ping(self):
            observed["pinged"] = True

        def load(self, *, domain):
            observed["domain"] = domain
            return expected

        def close(self):
            observed["closed"] = True

    monkeypatch.setattr(runner, "MongoQuestionnaireRepository", _Repository)

    loaded = runner._load_approved_questions(
        SimpleNamespace(
            questionnaire_store="mongodb",
            mongodb_uri="mongodb://localhost:27017",
            mongodb_database="pytorch_ph",
            approved_answers=None,
        )
    )

    assert loaded == expected
    assert observed == {
        "uri": "mongodb://localhost:27017",
        "database": "pytorch_ph",
        "pinged": True,
        "domain": "smartapply.indeed.com",
        "closed": True,
    }


def test_runner_falls_back_to_approved_json_when_mongodb_is_unavailable(
    tmp_path, monkeypatch
):
    expected = ApprovedIndeedQuestionAnswerSet(
        pages=[
            ApprovedIndeedQuestionAnswers(
                question_set_fingerprint="b" * 40,
                answers={"Gender": "Prefer not to say"},
            )
        ]
    )
    fallback = tmp_path / "approved.json"
    fallback.write_text(expected.model_dump_json(), encoding="utf-8")

    monkeypatch.setattr(
        runner,
        "_open_questionnaire_repository",
        lambda _args, required=False: None,
    )

    loaded = runner._load_approved_questions(
        SimpleNamespace(
            questionnaire_store="auto",
            approved_answers=None,
            questionnaire_json_fallback=fallback,
        )
    )

    assert loaded == expected


def test_scheduler_replenishes_skips_and_stops_at_exact_target(tmp_path):
    args = _args(tmp_path, count=6)
    started: list[str] = []
    active = 0
    peak = 0
    lock = Lock()

    def worker(job, _args):
        nonlocal active, peak
        with lock:
            started.append(job.task_id)
            active += 1
            peak = max(peak, active)
        time.sleep(0.01)
        with lock:
            active -= 1
        status = (
            BatchApplicationStatus.SKIPPED
            if job.task_id == "job-0"
            else BatchApplicationStatus.SUBMITTED
        )
        return _outcome(job, status)

    assert runner.run(args, worker=worker) == 0
    payload = json.loads((args.output / "run.json").read_text(encoding="utf-8"))
    assert payload["status"] == "target_reached"
    assert payload["confirmed_submissions"] == 3
    assert payload["candidates_started"] == 4
    assert set(started) == {"job-0", "job-1", "job-2", "job-3"}
    assert peak == 3


def test_captcha_retry_reuses_candidate_while_replacements_continue(tmp_path):
    args = _args(tmp_path, count=4)
    calls: dict[str, int] = {}
    order: list[str] = []

    def worker(job, _args):
        calls[job.task_id] = calls.get(job.task_id, 0) + 1
        order.append(job.task_id)
        if job.task_id == "job-0" and calls[job.task_id] == 1:
            return _outcome(job, BatchApplicationStatus.VERIFICATION_PENDING)
        if job.task_id == "job-1":
            return _outcome(job, BatchApplicationStatus.SKIPPED)
        return _outcome(job, BatchApplicationStatus.SUBMITTED)

    assert runner.run(args, worker=worker) == 0
    payload = json.loads((args.output / "run.json").read_text(encoding="utf-8"))
    assert payload["confirmed_submissions"] == 3
    assert calls["job-0"] == 2
    assert order.index("job-3") < len(order) - 1
    assert order[-1] == "job-0"


def test_scheduler_honors_candidate_bound_when_target_is_not_reached(tmp_path):
    args = _args(tmp_path, count=6)
    args.max_candidates = 2

    def worker(job, _args):
        return _outcome(job, BatchApplicationStatus.SKIPPED)

    assert runner.run(args, worker=worker) == 2
    payload = json.loads((args.output / "run.json").read_text(encoding="utf-8"))
    assert payload["status"] == "bounded_without_target"
    assert payload["candidates_started"] == 2


def test_unresolved_validation_is_parked_then_reentered(tmp_path):
    args = _args(tmp_path, count=1, target=1)
    calls = 0

    def worker(job, _args):
        nonlocal calls
        calls += 1
        if calls == 1:
            return BatchApplicationOutcome(
                task=job.batch_task(),
                status=BatchApplicationStatus.HUMAN_HANDOFF,
                detail="module validation remains unresolved: Enter a valid location",
            )
        return _outcome(job, BatchApplicationStatus.SUBMITTED)

    assert runner.run(args, worker=worker) == 0
    assert calls == 2


class _ContactLocator:
    def __init__(self, *, value="", data_value="", text=""):
        self.value = value
        self.data_value = data_value
        self.text = text
        self.first = self

    def count(self):
        return 1

    def input_value(self):
        return self.value

    def get_attribute(self, name):
        return self.data_value if name == "data-value" else None

    def inner_text(self):
        return self.text


class _ContactPage:
    url = "https://smartapply.indeed.com/beta/indeedapply/form/contact-info-module"

    def __init__(self, phone, country, country_text=""):
        self.phone = _ContactLocator(value=phone)
        self.country = _ContactLocator(data_value=country, text=country_text)

    def locator(self, selector):
        return self.country if "combobox" in selector else self.phone


def test_runtime_phone_uses_saved_value_only_for_matching_country():
    args = SimpleNamespace(
        verified_phone="",
        phone_country_iso="PH",
    )

    assert runner._runtime_verified_phone(_ContactPage("9000000000", "PH"), args) == "9000000000"
    assert runner._runtime_verified_phone(_ContactPage("9000000000", "AU"), args) == ""


def test_runtime_phone_can_use_explicitly_approved_saved_value_before_country_reconcile():
    args = SimpleNamespace(
        verified_phone="",
        phone_country_iso="PH",
        use_saved_contact_phone=True,
    )

    assert runner._runtime_verified_phone(_ContactPage("9000000000", "AU"), args) == "9000000000"


def test_runtime_phone_strips_observed_original_calling_code():
    args = SimpleNamespace(
        verified_phone="",
        phone_country_iso="PH",
        use_saved_contact_phone=True,
        saved_phone_original_calling_code="+61",
    )

    assert (
        runner._runtime_verified_phone(_ContactPage("+61 900 000 0000", "PH"), args)
        == "9000000000"
    )


def test_runtime_phone_strips_calling_code_observed_from_foreign_country_control():
    args = SimpleNamespace(
        verified_phone="",
        phone_country_iso="PH",
        use_saved_contact_phone=True,
        saved_phone_original_calling_code="",
    )

    assert (
        runner._runtime_verified_phone(
            _ContactPage("+1 900 000 0000", "CA", "+1"),
            args,
        )
        == "9000000000"
    )


def test_runtime_phone_prefers_explicit_verified_value():
    args = SimpleNamespace(
        verified_phone="+63 900 000 0000",
        phone_country_iso="PH",
    )

    assert (
        runner._runtime_verified_phone(_ContactPage("different", "AU"), args)
        == "+63 900 000 0000"
    )


def test_runtime_phone_uses_private_environment_value(monkeypatch):
    monkeypatch.setenv("PYTORCH_PH_VERIFIED_PHONE", "+63 900 000 0000")
    args = SimpleNamespace(
        verified_phone="",
        phone_country_iso="PH",
    )

    assert (
        runner._runtime_verified_phone(_ContactPage("", "PH"), args)
        == "+63 900 000 0000"
    )


def test_process_all_mode_does_not_stop_at_submission_target(tmp_path):
    args = _args(tmp_path, count=4, target=1)
    args.process_all_candidates = True
    started = []

    def worker(job, _args):
        started.append(job.task_id)
        status = (
            BatchApplicationStatus.SKIPPED
            if job.task_id == "job-1"
            else BatchApplicationStatus.SUBMITTED
        )
        return _outcome(job, status)

    assert runner.run(args, worker=worker) == 0
    payload = json.loads((args.output / "run.json").read_text(encoding="utf-8"))
    assert payload["status"] == "all_candidates_processed"
    assert payload["confirmed_submissions"] == 3
    assert set(started) == {"job-0", "job-1", "job-2", "job-3"}


class _ClosablePage:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def test_terminal_skip_and_submission_retire_page():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    for status in (
        BatchApplicationStatus.SKIPPED,
        BatchApplicationStatus.SUBMITTED,
    ):
        page = _ClosablePage()
        outcome = _outcome(job, status)
        assert runner._retire_if_terminal(page, outcome) is outcome
        assert page.closed is True


def test_human_handoff_keeps_page_open():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    page = _ClosablePage()
    outcome = _outcome(job, BatchApplicationStatus.HUMAN_HANDOFF)

    assert runner._retire_if_terminal(page, outcome) is outcome
    assert page.closed is False


def test_pending_human_handoff_resumes_exact_browser_target(monkeypatch):
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    listing = SimpleNamespace(url=job.listing_url)
    verification = SimpleNamespace(
        url="https://smartapply.indeed.com/beta/indeedapply/form/verification"
    )
    context = SimpleNamespace(pages=[verification, listing])
    queue = SimpleNamespace(
        pending=lambda: [
            SimpleNamespace(
                application_reference=job.batch_task().application_reference,
                browser_target_id="verification-target",
            )
        ]
    )
    monkeypatch.setattr(
        runner,
        "_browser_target_id",
        lambda page: "verification-target" if page is verification else "listing-target",
    )

    page, is_application_page = runner._matching_existing_page(context, job, queue)

    assert page is verification
    assert is_application_page is True


def test_pending_listing_challenge_resumes_listing_flow(monkeypatch):
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    listing = SimpleNamespace(url=job.listing_url)
    context = SimpleNamespace(pages=[listing])
    queue = SimpleNamespace(
        pending=lambda: [
            SimpleNamespace(
                application_reference=job.batch_task().application_reference,
                browser_target_id="listing-target",
            )
        ]
    )
    monkeypatch.setattr(runner, "_browser_target_id", lambda _page: "listing-target")

    page, is_application_page = runner._matching_existing_page(context, job, queue)

    assert page is listing
    assert is_application_page is False


def test_access_check_rebinds_stale_target_after_browser_restart(monkeypatch):
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    page = SimpleNamespace(url=job.listing_url)
    queued = []
    blocked = runner.AccessGateResult(
        state=runner.AccessGateState.HUMAN_REQUIRED,
        reason="verification_required",
    )
    queue = SimpleNamespace(
        pending=lambda: [
            SimpleNamespace(
                application_reference=job.batch_task().application_reference,
                domain="ca.indeed.com",
                browser_target_id="stale-target",
            )
        ],
        enqueue=lambda **kwargs: queued.append(kwargs),
    )
    monkeypatch.setattr(runner, "check_access_gate", lambda _page: blocked)
    monkeypatch.setattr(runner, "_browser_target_id", lambda _page: "restarted-target")

    assert runner._check_access(page, job, queue, goal_id="current-goal") is blocked
    assert queued[0]["browser_target_id"] == "restarted-target"
    assert queued[0]["task_id"] == "job"
    assert queued[0]["company"] == "Company"
    assert queued[0]["job_title"] == "Backend Engineer"
    assert queued[0]["goal_id"] == "current-goal"


def test_qualification_evidence_includes_exact_remote_title():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="AI Agent Engineer (Fully Remote)",
        listing_url="https://au.indeed.com/viewjob?jk=job",
        target_country="Australia",
    )

    evidence = runner._qualification_evidence(job, "Build reliable AI agents.")

    assert "Fully Remote" in evidence
    assert "Build reliable AI agents." in evidence


def test_resume_selection_loads_editable_sqlite_routes(tmp_path):
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    selected = artifacts / "custom-platform.pdf"
    selected.write_bytes(b"%PDF")
    database = tmp_path / "applications.sqlite3"
    store = runner.ApplicationProfileStore(database)
    store.replace_resume_route(
        filename=selected.name,
        terms=["event streaming", "distributed systems"],
        is_default=True,
    )
    args = SimpleNamespace(
        artifact_dir=artifacts,
        database=database,
        profile_database=None,
    )
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Platform Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )

    assert (
        runner._select_resume(job, args, "Build event streaming services.")
        == selected.resolve()
    )


def test_sqlite_identity_overlays_runtime_resume_contact_consistently():
    resume = Resume(
        role=RoleSpec(id="software", label="Software Engineer"),
        contact=ContactInfo(
            name="Old Resume Name",
            location="Old Location",
            phone="old phone",
        ),
    )
    identity = SimpleNamespace(
        full_name="John Andrew Balbarosa",
        country_name="Philippines",
        verified_phone="+63 9669772854",
    )

    updated = runner._resume_with_verified_identity(resume, identity)

    assert updated.contact.name == identity.full_name
    assert updated.contact.location == identity.country_name
    assert updated.contact.phone == identity.verified_phone
    assert resume.contact.name == "Old Resume Name"


def test_empty_database_phone_preserves_reviewed_resume_phone():
    resume = Resume(
        role=RoleSpec(id="software", label="Software Engineer"),
        contact=ContactInfo(phone="reviewed resume phone"),
    )
    identity = SimpleNamespace(
        full_name="John Andrew Balbarosa",
        country_name="Philippines",
        verified_phone="",
    )

    updated = runner._resume_with_verified_identity(resume, identity)

    assert updated.contact.phone == "reviewed resume phone"


def test_tab_budget_prevents_another_application_transition_at_limit():
    context = SimpleNamespace(pages=[object(), object(), object()])

    assert runner._tab_budget_available(
        context, SimpleNamespace(max_tabs=1, baseline_tabs=3)
    ) is True
    context.pages.append(object())
    assert runner._tab_budget_available(
        context, SimpleNamespace(max_tabs=1, baseline_tabs=3)
    ) is False
    assert runner._tab_budget_available(context, SimpleNamespace(max_tabs=0)) is True


def test_application_location_comes_from_exact_smart_apply_job_header():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Binance",
        job_title="AI Engineer",
        listing_url="https://au.indeed.com/viewjob?jk=job",
        target_country="Australia",
    )
    page = _HydratingListingPage()
    page.waited_ms = 500
    page.text_at = lambda selector: (
        "AI Engineer\nBinance - Australia, Brisbane"
        if selector == ".ia-JobHeader"
        else ""
    )

    assert runner._application_location(page, job) == "Australia, Brisbane"


def test_runtime_question_profile_overrides_static_location_with_job_location():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Binance",
        job_title="AI Engineer",
        listing_url="https://au.indeed.com/viewjob?jk=job",
        target_country="Australia",
    )
    page = _HydratingListingPage()
    page.waited_ms = 500
    page.text_at = lambda selector: (
        "AI Engineer\nBinance - Australia, Melbourne"
        if selector == ".ia-JobHeader"
        else ""
    )
    questions = [
        ScreeningQuestion(
            question_id="location",
            label="Which location are you applying for?",
            selector="[role=combobox]",
            kind="select",
        ),
        ScreeningQuestion(
            question_id="current",
            label="Current Location",
            selector="[name=current]",
            kind="text",
        ),
    ]
    fingerprint = runner.question_set_fingerprint(questions)
    approved = ApprovedIndeedQuestionAnswerSet(
        pages=[
            ApprovedIndeedQuestionAnswers(
                question_set_fingerprint=fingerprint,
                answers={
                    "Which location are you applying for?": "Australia, Brisbane",
                    "Current Location": "Philippines",
                },
            )
        ]
    )

    runtime = runner._runtime_question_profile(page, job, questions, approved)

    assert runtime is not None
    assert runtime.answers == {
        "Which location are you applying for?": "Australia, Melbourne",
        "Current Location": "Philippines",
    }


class _TextLocator:
    def __init__(self, page, selector):
        self.page = page
        self.selector = selector
        self.first = self

    def count(self):
        return 1

    def is_visible(self):
        return True

    def inner_text(self):
        return self.page.text_at(self.selector)


class _HydratingListingPage:
    def __init__(self):
        self.waited_ms = 0

    def locator(self, selector):
        return _TextLocator(self, selector)

    def text_at(self, selector):
        if self.waited_ms < 500:
            return "Loading..." if selector == "body" else ""
        if selector == "body":
            return "Company — Backend Engineer"
        return "Build APIs with Python."

    def wait_for_timeout(self, milliseconds):
        self.waited_ms += milliseconds


def test_listing_evidence_waits_for_hydrated_identity_and_description():
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    page = _HydratingListingPage()

    body, description = runner._wait_for_listing_evidence(
        page,
        job,
        timeout_ms=1_000,
        poll_ms=250,
    )

    assert body == "Company — Backend Engineer"
    assert description == "Build APIs with Python."
    assert page.waited_ms == 500


class _ApplyLocator:
    def __init__(self, page):
        self.page = page
        self.first = self

    def count(self):
        return 1

    def is_visible(self):
        return self.page.waited_ms >= self.page.control_visible_after_ms

    def click(self):
        self.page.clicks += 1
        self.page.on_click()


class _ApplyPage:
    def __init__(self, *, url, control_visible_after_ms=0):
        self.url = url
        self.control_visible_after_ms = control_visible_after_ms
        self.waited_ms = 0
        self.clicks = 0
        self.on_click = lambda: None
        self._locator = _ApplyLocator(self)
        self.on_wait = lambda: None

    def locator(self, _selector):
        return self._locator

    def wait_for_timeout(self, milliseconds):
        self.waited_ms += milliseconds
        self.on_wait()


def test_open_apply_destination_waits_for_delayed_visible_apply_control():
    page = _ApplyPage(
        url="https://ca.indeed.com/viewjob?jk=job",
        control_visible_after_ms=500,
    )
    context = SimpleNamespace(pages=[page])
    page.on_click = lambda: setattr(
        page,
        "url",
        "https://smartapply.indeed.com/beta/indeedapply/form/contact-info-module",
    )

    application_page, error = runner._open_apply_destination(
        page,
        context,
        control_timeout_ms=1_000,
        navigation_timeout_ms=1_000,
        poll_ms=250,
    )

    assert application_page is page
    assert error == ""
    assert page.clicks == 1
    assert page.waited_ms == 500


def test_open_apply_destination_waits_for_about_blank_popup_navigation():
    listing_page = _ApplyPage(url="https://au.indeed.com/viewjob?jk=job")
    popup = SimpleNamespace(url="about:blank")
    context = SimpleNamespace(pages=[listing_page])

    def open_popup():
        context.pages.append(popup)

    def navigate_popup():
        if listing_page.waited_ms >= 500:
            popup.url = (
                "https://smartapply.indeed.com/"
                "beta/indeedapply/form/profile-location"
            )

    listing_page.on_click = open_popup
    listing_page.on_wait = navigate_popup

    application_page, error = runner._open_apply_destination(
        listing_page,
        context,
        control_timeout_ms=0,
        navigation_timeout_ms=1_000,
        poll_ms=250,
    )

    assert application_page is popup
    assert error == ""
    assert listing_page.clicks == 1
    assert listing_page.waited_ms == 500


def test_open_apply_destination_returns_external_company_site_for_human_intervention():
    listing_page = _ApplyPage(url="https://ca.indeed.com/viewjob?jk=job")
    popup = SimpleNamespace(url="https://careers.example.com/jobs/backend-engineer?token=secret")
    context = SimpleNamespace(pages=[listing_page])
    listing_page.on_click = lambda: context.pages.append(popup)

    application_page, error = runner._open_apply_destination(
        listing_page,
        context,
        control_timeout_ms=0,
        navigation_timeout_ms=1_000,
        poll_ms=250,
    )

    assert application_page is popup
    assert error == "apply on company site: careers.example.com"
    assert listing_page.clicks == 1


def test_company_site_handoff_is_grouped_and_kept_open(monkeypatch):
    job = runner.IndeedUnattendedJob(
        task_id="job",
        company="Company",
        job_title="Backend Engineer",
        listing_url="https://ca.indeed.com/viewjob?jk=job",
        target_country="Canada",
    )
    page = _ClosablePage()
    page.url = "https://careers.example.com/apply?token=secret"
    captured = {}

    class _Queue:
        def enqueue(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(runner, "_browser_target_id", lambda _page: "external-target")

    outcome = runner._retire_if_terminal(
        page,
        runner._queue_company_site_handoff(page, job, _Queue(), goal_id="goal-1"),
    )

    assert outcome.status == BatchApplicationStatus.HUMAN_HANDOFF
    assert outcome.detail == "human intervention required: apply on company site"
    assert captured["result"].reason == "apply_on_company_site"
    assert captured["group"].value == "human_intervention"
    assert captured["browser_target_id"] == "external-target"
    assert captured["task_id"] == "job"
    assert captured["company"] == "Company"
    assert captured["job_title"] == "Backend Engineer"
    assert captured["goal_id"] == "goal-1"
    assert page.closed is False


def test_open_apply_destination_does_not_click_when_control_never_becomes_visible():
    page = _ApplyPage(
        url="https://ca.indeed.com/viewjob?jk=job",
        control_visible_after_ms=2_000,
    )
    context = SimpleNamespace(pages=[page])

    application_page, error = runner._open_apply_destination(
        page,
        context,
        control_timeout_ms=1_000,
        navigation_timeout_ms=1_000,
        poll_ms=250,
    )

    assert application_page is None
    assert error == "no verified visible Indeed Apply control"
    assert page.clicks == 0
