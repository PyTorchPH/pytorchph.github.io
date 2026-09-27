from pathlib import Path

from resume_builder.job_application.shared import (
    ResumeArtifactProfile,
    evaluate_final_submit_gate,
    select_resume_artifact,
)


class _Locator:
    def __init__(
        self,
        *,
        count=1,
        visible=True,
        enabled=True,
        text="",
        attributes=None,
    ):
        self._count = count
        self._visible = visible
        self._enabled = enabled
        self._text = text
        self._attributes = attributes or {}

    @property
    def first(self):
        return self

    def nth(self, _index):
        return self

    def count(self):
        return self._count

    def is_visible(self):
        return self._visible

    def is_enabled(self):
        return self._enabled

    def inner_text(self):
        return self._text

    def get_attribute(self, name):
        return self._attributes.get(name)


class _Page:
    def __init__(self, *, submit=None, body="", captcha=None):
        self.submit = submit or _Locator()
        self.body = body
        self.captcha = captcha or _Locator(count=0)

    def locator(self, selector):
        if selector == "#submit":
            return self.submit
        if selector == "body":
            return _Locator(text=self.body)
        if selector == 'iframe[src*="recaptcha"]':
            return self.captcha
        return _Locator(count=0)


def test_submit_gate_is_shared_across_enabled_and_disabled_controls():
    assert evaluate_final_submit_gate(_Page(), "#submit").allowed
    blocked = evaluate_final_submit_gate(
        _Page(submit=_Locator(enabled=False)),
        "#submit",
    )
    assert not blocked.allowed
    assert blocked.reason == "final submit control is disabled"


def test_submit_gate_stops_on_generic_access_marker_before_control_check():
    result = evaluate_final_submit_gate(
        _Page(body="Access denied"),
        "#submit",
    )
    assert not result.allowed
    assert result.access.reason == "blocked"


def test_submit_gate_stops_on_indeed_cloudflare_verification_page():
    result = evaluate_final_submit_gate(
        _Page(
            body=(
                "Additional Verification Required. "
                "Troubleshooting Cloudflare Errors. Ray ID abc123."
            )
        ),
        "#submit",
    )

    assert not result.allowed
    assert result.access.reason == "verification_required"


def test_submit_gate_stops_on_cloudflare_human_verification_copy():
    result = evaluate_final_submit_gate(
        _Page(body="Verify you are human. Performing security verification."),
        "#submit",
    )

    assert not result.allowed
    assert result.access.reason == "verification_required"


def test_submit_gate_stops_on_visible_cloudflare_turnstile():
    class _CloudflarePage(_Page):
        def locator(self, selector):
            if "cf-turnstile" in selector:
                return _Locator(count=1, visible=True)
            return super().locator(selector)

    result = evaluate_final_submit_gate(_CloudflarePage(), "#submit")

    assert not result.allowed
    assert result.access.evidence == "visible Cloudflare challenge"


def test_resume_matcher_accepts_arbitrary_website_profiles(tmp_path: Path):
    backend = tmp_path / "backend.pdf"
    data = tmp_path / "data.pdf"
    backend.write_bytes(b"%PDF")
    data.write_bytes(b"%PDF")
    profiles = (
        ResumeArtifactProfile("backend.pdf", ("backend", "api")),
        ResumeArtifactProfile("data.pdf", ("sql", "warehouse")),
    )

    selected = select_resume_artifact(
        "Platform Developer",
        tmp_path,
        profiles,
        job_description="Build backend API services",
    )

    assert selected == backend.resolve()


def test_resume_matcher_does_not_guess_when_no_profile_matches(tmp_path: Path):
    fallback = tmp_path / "general.pdf"
    fallback.write_bytes(b"%PDF")
    profiles = (ResumeArtifactProfile("general.pdf", ("software",)),)

    assert select_resume_artifact("Account Manager", tmp_path, profiles) is None
    assert (
        select_resume_artifact(
            "Account Manager",
            tmp_path,
            profiles,
            default_filename="general.pdf",
        )
        == fallback.resolve()
    )
