from __future__ import annotations

from resume_builder.job_finder import AccessGuard, AccessPolicy, AccessState, DomainThrottle


def test_access_guard_allows_normal_job_page():
    guard = AccessGuard()

    decision = guard.classify(
        url="https://careers.example.com/jobs",
        html="<html><body><article class='job-card'>Backend Engineer</article></body></html>",
        status_code=200,
    )

    assert decision.state == AccessState.OK
    assert decision.should_continue is True


def test_access_guard_allows_verifying_as_ordinary_job_description_text():
    decision = AccessGuard().classify(
        url="https://ca.indeed.com/jobs?q=developer&l=remote",
        html=(
            "<html><body><article class='job-card'>"
            "Responsibilities include verifying customer requests and data quality."
            "</article></body></html>"
        ),
        status_code=200,
    )

    assert decision.state == AccessState.OK
    assert decision.should_continue is True


def test_access_guard_stops_on_indeed_verification_page():
    guard = AccessGuard()

    decision = guard.classify(
        url="https://ph.indeed.com/rc/clk",
        html="""
        <html><body>
          <h1>Additional Verification Required</h1>
          <p>Your Ray ID for this request is abc123.</p>
          <div>Cloudflare verifying...</div>
        </body></html>
        """,
        status_code=200,
    )

    assert decision.state == AccessState.VERIFICATION_REQUIRED
    assert decision.should_continue is False
    assert "human handoff" in decision.reason


def test_access_guard_allows_passive_recaptcha_footer_disclosure():
    html = """
    <main><h1>Add your location</h1><label>Postal code<input name="postal"></label></main>
    <footer>This site is protected by reCAPTCHA, and the Google Privacy Policy and
    Terms of Service apply.</footer>
    """

    decision = AccessGuard().classify(url="https://smartapply.indeed.com/form", html=html)

    assert decision.state == AccessState.OK
    assert decision.should_continue is True


def test_access_guard_stops_on_jobstreet_sign_in_modal():
    guard = AccessGuard()

    decision = guard.classify(
        url="https://ph.jobstreet.com/",
        html="""
        <html><body>
          <div role="dialog">
            <h2>Sign in to find jobs matched to you</h2>
            <button>Continue with Google</button>
            <button>Continue with Email</button>
          </div>
        </body></html>
        """,
        status_code=200,
    )

    assert decision.state == AccessState.SIGNED_OUT
    assert decision.should_continue is False


def test_access_guard_uses_bounded_backoff_for_rate_limits():
    guard = AccessGuard(AccessPolicy(retry_backoff_seconds=(5.0, 20.0), max_retries=1))

    first = guard.classify(
        url="https://jobs.example.com",
        html="<html>Too many requests. Try again later.</html>",
        status_code=429,
        attempt=0,
    )
    exhausted = guard.classify(
        url="https://jobs.example.com",
        html="<html>Too many requests. Try again later.</html>",
        status_code=429,
        attempt=1,
    )

    assert first.state == AccessState.RATE_LIMITED
    assert first.retry_after_seconds == 5.0
    assert "bounded backoff" in first.reason
    assert exhausted.retry_after_seconds is None
    assert "retry budget exhausted" in exhausted.reason


def test_domain_throttle_prevents_repeated_fast_access():
    throttle = DomainThrottle(AccessPolicy(min_domain_gap_seconds=10.0))
    guard = AccessGuard(throttle=throttle)
    url = "https://jobs.example.com/search"

    guard.mark_access(url, now=100.0)
    decision = guard.classify(
        url=url,
        html="<html><body><article class='job-card'>Backend Engineer</article></body></html>",
        status_code=200,
        now=104.0,
    )

    assert decision.state == AccessState.RATE_LIMITED
    assert decision.evidence == ("domain_throttle",)
    assert decision.retry_after_seconds == 6.0
