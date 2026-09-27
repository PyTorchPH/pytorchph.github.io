from __future__ import annotations

import re

CANONICAL_FIELDS: dict[str, list[str]] = {
    "full_name": ["full name", "legal name", "name"],
    "first_name": ["first name", "given name", "first"],
    "last_name": ["last name", "family name", "surname", "last"],
    "email": ["contact email", "email address", "e-mail", "email"],
    "phone": ["contact number", "contact #", "mobile no", "mobile", "phone", "cell", "tel"],
    "address": ["address", "location", "city", "country", "postal", "zip"],
    "education": ["highest qualification", "educational attainment", "education", "degree", "school"],
    "experience": ["years of experience", "work history", "employment", "experience"],
    "skills": ["competencies", "tech stack", "skills", "tools"],
    "languages": ["language proficiency", "languages"],
    "certifications": ["certifications", "credentials", "licenses", "certs"],
    "portfolio": ["personal site", "portfolio", "behance", "dribbble"],
    "linkedin": ["linkedin profile", "linkedin url", "linkedin"],
    "github": ["github profile", "git profile", "repository", "github"],
    "website": ["personal url", "website", "blog", "url"],
    "salary": ["expected salary", "desired pay", "compensation", "salary"],
    "availability": ["notice period", "availability", "start date"],
    "work_authorization": [
        "work authorization", "right to work", "eligibility to work", "authorized to work"
    ],
    "visa_sponsorship": [
        "visa sponsorship", "require sponsorship", "visa required", "sponsorship"
    ],
}

JUDGMENT_FIELDS: frozenset[str] = frozenset({"salary", "work_authorization", "visa_sponsorship"})


def _normalize_text(text: str) -> str:
    """Lowercase and collapse whitespace/punctuation to spaces (keep alphanumeric and #)."""
    text = text.lower()
    text = re.sub(r"[^\w\s#]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_label(label: str) -> str | None:
    """Return the canonical key whose variant substring is found in the label, else None.
    Prefers the longest/most-specific matching variant."""
    normalized = _normalize_text(label)
    best_canonical: str | None = None
    best_length: int = 0

    for canonical, variants in CANONICAL_FIELDS.items():
        for variant in variants:
            norm_variant = _normalize_text(variant)
            if norm_variant in normalized and len(norm_variant) > best_length:
                best_length = len(norm_variant)
                best_canonical = canonical

    return best_canonical


def is_judgment_field(canonical: str) -> bool:
    return canonical in JUDGMENT_FIELDS
