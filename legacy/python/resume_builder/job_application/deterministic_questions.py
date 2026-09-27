"""Deterministic answers for standard application questions.

Only normalized resume data and explicitly verified runtime profile values are
eligible sources. Unknown employer-specific questions may be handed to the
evidence-grounded AI answerer; sensitive judgments and missing identity data may
not.
"""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime

from pydantic import BaseModel

from resume_builder.core.models import Resume

from .field_taxonomy import is_judgment_field, normalize_label
from .models import QuestionAnswer, ScreeningQuestion


class VerifiedApplicationProfile(BaseModel):
    """Runtime-verified private facts that are intentionally absent from resume JSON."""

    email: str = ""
    phone: str = ""
    address_line: str = ""
    city: str = ""
    region: str = ""
    postal_code: str = ""
    country: str = ""


class DeterministicQuestionDecision(BaseModel):
    answer: QuestionAnswer | None = None
    value_source: str = ""
    allow_ai: bool = False
    unresolved_reason: str = ""


_HUMAN_ONLY = re.compile(
    r"\b("
    r"salary|compensation|desired pay|work authori[sz]ation|right to work|"
    r"visa|sponsorship|relocat\w*|shift|schedule|notice period|start date|"
    r"background check|drug test|criminal|disabilit|gender|race|ethnicity|"
    r"veteran|consent|terms and conditions"
    r")\b",
    re.IGNORECASE,
)
_SPECIFIC_EXPERIENCE = re.compile(
    r"\bexperience\s+(?:with|in|using|on)\b|\b(?:with|in|using)\s+.+\s+experience\b",
    re.IGNORECASE,
)
_MONTH_FORMATS = ("%b %Y", "%B %Y", "%Y-%m", "%Y")


def _parse_month(value: str | None, *, end: bool = False) -> date | None:
    if not value:
        return None
    cleaned = value.strip()
    if cleaned.lower() in {"present", "current", "now"}:
        return date.today()
    for pattern in _MONTH_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, pattern)
        except ValueError:
            continue
        day = calendar.monthrange(parsed.year, parsed.month)[1] if end else 1
        return date(parsed.year, parsed.month, day)
    return None


def _split_name(value: str) -> tuple[str, str]:
    parts = value.split()
    if len(parts) < 2:
        return value, ""
    return " ".join(parts[:-1]), parts[-1]


def _option_value(value: str, question: ScreeningQuestion) -> str | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if not question.options:
        return cleaned
    exact = next(
        (option for option in question.options if option.casefold() == cleaned.casefold()),
        None,
    )
    if exact:
        return exact
    aliases = {
        "yes": {"yes", "y", "true"},
        "no": {"no", "n", "false"},
    }
    wanted = aliases.get(cleaned.casefold(), {cleaned.casefold()})
    return next(
        (option for option in question.options if option.strip().casefold() in wanted),
        None,
    )


class DeterministicQuestionResolver:
    """Resolve standard fields without a model call and classify safe AI fallbacks."""

    def __init__(
        self,
        resume: Resume,
        *,
        verified_profile: VerifiedApplicationProfile | None = None,
        today: date | None = None,
    ) -> None:
        self.resume = resume
        self.profile = verified_profile or VerifiedApplicationProfile()
        self.today = today or date.today()

    def resolve(self, question: ScreeningQuestion) -> DeterministicQuestionDecision:
        label = re.sub(r"\s+", " ", question.label).strip()
        lowered = label.casefold()
        canonical = normalize_label(label)

        if _HUMAN_ONLY.search(label) or (canonical and is_judgment_field(canonical)):
            return self._unresolved(
                "sensitive or judgment question requires human input",
                allow_ai=False,
            )

        first_name, last_name = _split_name(self.resume.contact.name)
        if re.search(r"\b(first|given)\s+name\b", lowered):
            return self._fact(question, first_name, "resume.contact.name")
        if re.search(r"\b(last|family|sur)\s*name\b", lowered):
            return self._fact(question, last_name, "resume.contact.name")
        if re.search(r"\b(full|legal)\s+name\b", lowered):
            return self._fact(question, self.resume.contact.name, "resume.contact.name")
        if canonical == "full_name":
            return self._fact(question, self.resume.contact.name, "resume.contact.name")
        if re.search(r"\b(e-?mail)\b", lowered):
            return self._verified_fact(question, self.profile.email, "verified_profile.email")
        if re.search(r"\b(phone|mobile|contact\s*(?:number|#)|cell|telephone)\b", lowered):
            return self._verified_fact(question, self.profile.phone, "verified_profile.phone")

        if re.search(r"\bpostal\s*code\b|\bzip\s*code\b", lowered):
            return self._verified_fact(
                question,
                self.profile.postal_code,
                "verified_profile.postal_code",
            )
        if re.search(r"\b(city|municipality)\b", lowered):
            return self._verified_fact(question, self.profile.city, "verified_profile.city")
        if re.search(r"\b(state|province|region)\b", lowered):
            return self._verified_fact(question, self.profile.region, "verified_profile.region")
        if re.search(r"\bcountry\b", lowered):
            country = self.profile.country or (self.resume.contact.location or "")
            source = (
                "verified_profile.country"
                if self.profile.country
                else "resume.contact.location"
            )
            return self._fact(question, country, source)
        if re.search(r"\b(current\s+)?location\b|\bwhere are you located\b", lowered):
            location = self.profile.country or (self.resume.contact.location or "")
            source = (
                "verified_profile.country"
                if self.profile.country
                else "resume.contact.location"
            )
            return self._fact(question, location, source)
        if re.search(r"\b(street|address line|home address|full address)\b", lowered):
            return self._verified_fact(
                question,
                self.profile.address_line,
                "verified_profile.address_line",
            )
        if canonical == "address":
            return self._verified_fact(
                question,
                self.profile.address_line,
                "verified_profile.address_line",
            )

        education = self.resume.education[0] if self.resume.education else None
        education_end = _parse_month(education.end, end=True) if education else None
        if re.search(r"\b(expected\s+)?graduation\s+date\b|\bcompletion\s+date\b", lowered):
            return self._fact(
                question,
                education.end if education else "",
                "resume.education[0].end",
            )
        if re.search(
            r"\b(have you|already)\s+graduated\b|\bare you (?:a )?graduate\b|"
            r"\bdegree\s+completed\b|\bcompleted\s+(?:bachelor'?s?|master'?s?|"
            r"doctoral|college|university)?\s*degree\b",
            lowered,
        ):
            if education_end is None:
                return self._unresolved("graduation status is not evidenced", allow_ai=False)
            return self._fact(
                question,
                "Yes" if education_end < self.today else "No",
                "resume.education[0].end",
            )
        if re.search(
            r"\b(currently|still)\s+(?:a\s+)?student\b|\bcurrently enrolled\b|"
            r"\bare you (?:currently )?(?:a )?student\b|\bcurrently studying\b",
            lowered,
        ):
            if education_end is None:
                return self._unresolved("student status is not evidenced", allow_ai=False)
            return self._fact(
                question,
                "Yes" if education_end >= self.today else "No",
                "resume.education[0].end",
            )
        if re.search(r"\b(school|college|university|institution)\b", lowered):
            return self._fact(
                question,
                education.school if education else "",
                "resume.education[0].school",
            )
        if re.search(r"\b(degree|highest qualification|educational attainment)\b", lowered):
            return self._fact(
                question,
                education.degree if education else "",
                "resume.education[0].degree",
            )

        experience = self.resume.experience[0] if self.resume.experience else None
        if re.search(r"\b(company|employer)\s+name\b|\bmost recent employer\b", lowered):
            return self._fact(
                question,
                experience.company if experience else "",
                "resume.experience[0].company",
                missing_reason="professional employer is not in the selected resume",
            )
        if re.search(r"\b(job|position)\s+title\b|\bcurrent role\b", lowered):
            return self._fact(
                question,
                experience.role if experience else "",
                "resume.experience[0].role",
                missing_reason="professional job title is not in the selected resume",
            )
        if _SPECIFIC_EXPERIENCE.search(label):
            return self._unresolved(
                "technology- or domain-specific experience needs evidence-grounded interpretation",
                allow_ai=True,
            )
        if re.search(r"\byears?\s+of\s+(?:professional\s+|work\s+|employment\s+)?experience\b", lowered):
            years = self._professional_years()
            return self._fact(
                question,
                str(int(years)) if years.is_integer() else str(years),
                "resume.experience",
            )
        if re.search(r"\b(?:have|do)\s+you\s+have\s+(?:professional|work|employment)\s+experience\b", lowered):
            return self._fact(
                question,
                "Yes" if self.resume.experience else "No",
                "resume.experience",
            )

        if re.search(r"\bgithub\b", lowered):
            return self._fact(question, self.resume.contact.github or "", "resume.contact.github")
        if re.search(r"\blinkedin\b", lowered):
            return self._fact(
                question,
                self.resume.contact.linkedin or "",
                "resume.contact.linkedin",
            )
        if re.search(r"\b(portfolio|website|personal site)\b", lowered):
            return self._fact(
                question,
                self.resume.contact.website or "",
                "resume.contact.website",
            )

        return self._unresolved(
            "non-standard employer question requires bounded career-evidence interpretation",
            allow_ai=True,
        )

    def _professional_years(self) -> float:
        spans: list[tuple[date, date]] = []
        for item in self.resume.experience:
            start = _parse_month(item.start)
            end = _parse_month(item.end, end=True) or self.today
            if start and end > start:
                spans.append((start, min(end, self.today)))
        if not spans:
            return 0.0
        spans.sort()
        merged: list[tuple[date, date]] = []
        for start, end in spans:
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        days = sum((end - start).days for start, end in merged)
        return round(days / 365.25, 1)

    def _verified_fact(
        self,
        question: ScreeningQuestion,
        value: str,
        source: str,
    ) -> DeterministicQuestionDecision:
        return self._fact(
            question,
            value,
            source,
            missing_reason=f"{source} is unavailable; verified human input is required",
        )

    def _fact(
        self,
        question: ScreeningQuestion,
        value: str,
        source: str,
        *,
        missing_reason: str = "standard value is absent from the selected resume",
    ) -> DeterministicQuestionDecision:
        selected = _option_value(value, question)
        if selected is None:
            reason = (
                "evidenced value does not match an observed option"
                if value.strip()
                else missing_reason
            )
            return self._unresolved(reason, allow_ai=False)
        if question.max_length and len(selected) > question.max_length:
            return self._unresolved(
                "evidenced value exceeds the field limit and requires human review",
                allow_ai=False,
            )
        return DeterministicQuestionDecision(
            answer=QuestionAnswer(
                question_id=question.question_id,
                answer=selected,
                confidence=1.0,
                evidence_ids=[source],
                rationale="deterministic normalized resume/runtime evidence",
            ),
            value_source=source,
        )

    @staticmethod
    def _unresolved(reason: str, *, allow_ai: bool) -> DeterministicQuestionDecision:
        return DeterministicQuestionDecision(
            allow_ai=allow_ai,
            unresolved_reason=reason,
        )
