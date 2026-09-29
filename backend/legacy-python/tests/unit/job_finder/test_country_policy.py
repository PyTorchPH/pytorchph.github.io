import pytest
from pydantic import ValidationError

from resume_builder.job_finder import CountrySelectionPolicy, ForeignCountryPolicy


def test_foreign_policy_excludes_home_country_and_aliases():
    with pytest.raises(ValidationError, match="home country"):
        ForeignCountryPolicy(
            home_country="Philippines",
            home_country_aliases=("PH", "PHL"),
            selected_countries=("Australia", "PH"),
        )


def test_foreign_policy_requires_remote_and_human_selected_country():
    policy = ForeignCountryPolicy(
        home_country="Philippines",
        selected_countries=("Australia", "Canada"),
    )

    policy.require_allowed(target_country="Australia", work_mode="remote")
    with pytest.raises(ValueError, match="remote"):
        policy.require_allowed(target_country="Australia", work_mode="onsite")
    with pytest.raises(ValueError, match="explicitly selected"):
        policy.require_allowed(target_country="United States", work_mode="remote")


def test_general_country_selection_may_include_home_country():
    policy = CountrySelectionPolicy(
        home_country="Philippines",
        selected_countries=("Philippines", "Australia"),
    )

    policy.require_allowed(target_country="Philippines", work_mode="remote")
