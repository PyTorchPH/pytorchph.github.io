from pathlib import Path

import pytest

from resume_builder.job_application.persistence import ApplicationProfileStore


def test_verified_identity_round_trips_normalized_structured_fields(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")

    stored = store.save_verified_identity(
        first_name=" John Andrew ",
        last_name=" Balbarosa ",
        country_name=" Philippines ",
        country_iso="ph",
        phone_calling_code="+63",
    )

    assert stored.full_name == "John Andrew Balbarosa"
    assert store.verified_identity() == stored
    assert stored.country_iso == "PH"
    assert stored.verified_phone == ""


def test_resume_routes_are_replaceable_without_code_changes(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")
    store.replace_resume_route(
        filename="software.pdf",
        terms=["backend", " API ", "backend"],
        is_default=True,
    )
    store.replace_resume_route(
        filename="data.pdf",
        terms=["warehouse", "analytics"],
    )
    store.replace_resume_route(
        filename="software.pdf",
        terms=["distributed systems"],
        is_default=True,
    )

    routes = store.resume_routes()

    assert [(route.filename, route.terms) for route in routes] == [
        ("data.pdf", ("warehouse", "analytics")),
        ("software.pdf", ("distributed systems",)),
    ]
    assert [route.filename for route in routes if route.is_default] == ["software.pdf"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("country_iso", "PHL"),
        ("phone_calling_code", "63"),
        ("first_name", ""),
    ],
)
def test_verified_identity_rejects_invalid_required_fields(
    tmp_path: Path,
    field: str,
    value: str,
):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")
    values = {
        "first_name": "John Andrew",
        "last_name": "Balbarosa",
        "country_name": "Philippines",
        "country_iso": "PH",
        "phone_calling_code": "+63",
    }
    values[field] = value

    with pytest.raises(ValueError):
        store.save_verified_identity(**values)


def test_resume_route_rejects_paths_and_empty_terms(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")

    with pytest.raises(ValueError):
        store.replace_resume_route(filename="../resume.pdf", terms=["backend"])
    with pytest.raises(ValueError):
        store.replace_resume_route(filename="resume.pdf", terms=[])


def test_onboarding_preferences_and_activation_are_durable(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")

    preferences = store.save_onboarding_preferences(
        target=3,
        target_countries=["Australia", "Canada", "Australia"],
        work_mode="remote",
        employment_type="contract",
        safe_auto_start=True,
    )
    store.mark_auto_started("revision-1", "goal-1")

    assert preferences.target_countries == ("Australia", "Canada")
    assert preferences.safe_auto_start is True
    assert store.onboarding_preferences() == preferences
    assert store.auto_started_goal("revision-1") == "goal-1"
    assert store.auto_started_goal("revision-2") == ""


def test_onboarding_answers_are_local_structured_staging(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")
    store.save_onboarding_answer("name", {"first_name": "Ada", "last_name": "Lovelace"})

    assert store.onboarding_answers() == {
        "name": {"first_name": "Ada", "last_name": "Lovelace"}
    }

    store.clear_onboarding_answers()
    assert store.onboarding_answers() == {}


def test_empty_country_selection_defaults_to_philippines(tmp_path: Path):
    store = ApplicationProfileStore(tmp_path / "application.sqlite3")

    preferences = store.save_onboarding_preferences(
        target=3,
        target_countries=[],
        work_mode="remote",
        employment_type="contract",
        safe_auto_start=True,
    )

    assert preferences.target_countries == ("Philippines",)
