"""Human-selected country boundaries for job search and application batches."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, model_validator


def _country_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


class CountrySelectionPolicy(BaseModel):
    """Allow only explicitly human-selected target countries."""

    selected_countries: tuple[str, ...]
    home_country: str = ""
    home_country_aliases: tuple[str, ...] = Field(default_factory=tuple)
    exclude_home_country: bool = False
    require_remote: bool = True

    @model_validator(mode="after")
    def validate_selection(self) -> CountrySelectionPolicy:
        home = self.home_country.strip()
        selected = tuple(dict.fromkeys(country.strip() for country in self.selected_countries))
        if not selected or any(not country for country in selected):
            raise ValueError("at least one explicit target country is required")
        if self.exclude_home_country:
            if not home:
                raise ValueError("home_country must be explicit when exclusion is enabled")
            blocked = {
                _country_key(country)
                for country in (home, *self.home_country_aliases)
                if country.strip()
            }
            overlap = [country for country in selected if _country_key(country) in blocked]
            if overlap:
                raise ValueError(
                    "country selection includes an excluded home country: "
                    + ", ".join(overlap)
                )
        self.home_country = home
        self.selected_countries = selected
        return self

    def require_allowed(self, *, target_country: str, work_mode: str) -> None:
        selected = {_country_key(country) for country in self.selected_countries}
        if _country_key(target_country) not in selected:
            raise ValueError("target country was not explicitly selected by the human")
        if self.require_remote and work_mode.casefold() != "remote":
            raise ValueError("foreign-country policy requires remote work mode")

    def planner_constraint(self) -> str:
        countries = ", ".join(self.selected_countries)
        constraints = [f"human-selected target countries only: {countries}"]
        if self.require_remote:
            constraints.append("required work mode: remote")
        if self.exclude_home_country:
            constraints.append(f"exclude home country: {self.home_country}")
        return "\n".join(constraints)


class ForeignCountryPolicy(CountrySelectionPolicy):
    """Compatibility policy for runs that explicitly exclude the home country."""

    exclude_home_country: bool = True
