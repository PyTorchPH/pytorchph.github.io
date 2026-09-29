"""Industry-first resume planning.

This module keeps the new automatic resume path separate from the older
role-targeted flow. The AI classifies source evidence into normalized industry
tags, then the planner creates resumes only for industries backed by GitHub
projects.
"""

from __future__ import annotations

import re
from collections import defaultdict

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..llm import LLMProvider
from ..llm.null_provider import NullProvider
from ..core.models import Repo, ResumeAchievement, ResumeProject, RoleSpec
from ..core.principles import HARVARD_PRINCIPLES

_MAX_README_CHARS = 1800
_MAX_SOCIAL_CHARS = 600
_MAX_WEB_CHARS = 2500


class WebPageInput(BaseModel):
    """Arbitrary website content supplied to the industry classifier."""

    model_config = ConfigDict(extra="ignore")

    id: str
    url: str | None = None
    title: str = ""
    html_or_text: str = ""


class ExtractionRule(BaseModel):
    """AI-guided selector/rule for reducing arbitrary HTML before tagging."""

    source_id: str
    keep_selectors: list[str] = Field(default_factory=list)
    drop_selectors: list[str] = Field(default_factory=list)
    keep_regex: list[str] = Field(default_factory=list)
    rationale: str = ""


class ImpactResults(BaseModel):
    """Evidence-backed results: verbose meaning, compact structure."""

    quantitative: list[str] = Field(
        default_factory=list,
        description=(
            "Measured results copied from evidence. Each item explains metric, value, context, "
            "or practical meaning. Keep an existing result sentence intact; add context as the "
            "next short item instead of lengthening it. Never infer a missing number."
        ),
    )
    qualitative: list[str] = Field(
        default_factory=list,
        description=(
            "Non-numeric results: what improved, who benefited, problem solved, technical "
            "difficulty, ownership, or capability demonstrated. Add context as a separate short "
            "item; do not inflate an already complete sentence."
        ),
    )


class TaggedProject(BaseModel):
    repo_full_name: str
    industries: list[str] = Field(default_factory=list)
    skill_subtags: list[str] = Field(default_factory=list)
    summary: str = ""
    results: ImpactResults = Field(default_factory=ImpactResults)
    conclusion: str = Field(
        default="",
        description="Evidence-grounded takeaway: value created + strongest demonstrated capability.",
    )

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_impact_fields(cls, data):
        if isinstance(data, dict) and "results" not in data:
            data = dict(data)
            data["results"] = {
                "quantitative": data.pop("quantitative_impact", []),
                "qualitative": data.pop("qualitative_impact", []),
            }
        return data

    @property
    def quantitative_impact(self) -> list[str]:
        return self.results.quantitative

    @property
    def qualitative_impact(self) -> list[str]:
        return self.results.qualitative


class TaggedAchievement(BaseModel):
    source_id: str
    industries: list[str] = Field(default_factory=list)
    skill_subtags: list[str] = Field(default_factory=list)
    focused_snippet: str = ""
    results: ImpactResults = Field(default_factory=ImpactResults)
    conclusion: str = ""
    include_reason: str = ""

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_impact_fields(cls, data):
        if isinstance(data, dict) and "results" not in data:
            data = dict(data)
            data["results"] = {
                "quantitative": data.pop("quantitative_impact", []),
                "qualitative": data.pop("qualitative_impact", []),
            }
        return data

    @property
    def quantitative_impact(self) -> list[str]:
        return self.results.quantitative

    @property
    def qualitative_impact(self) -> list[str]:
        return self.results.qualitative


class IndustryClassification(BaseModel):
    normalized_industries: list[str] = Field(default_factory=list)
    extraction_rules: list[ExtractionRule] = Field(default_factory=list)
    projects: list[TaggedProject] = Field(default_factory=list)
    achievements: list[TaggedAchievement] = Field(default_factory=list)


class IndustryResumePlan(BaseModel):
    industry: str
    role: RoleSpec
    projects: list[ResumeProject] = Field(default_factory=list)
    achievements: list[ResumeAchievement] = Field(default_factory=list)


_SYSTEM = (
    "ROLE: industry-first resume intelligence. OUTPUT: structured JSON only.\n"
    "INDUSTRIES: Discover and normalize industry names freely; domain names; merge overlaps; "
    "multi-industry only when evidenced.\n"
    "SKILLS: skill_subtags only; atomic/canonical for matching (JavaScript, ReactJS, Vue); "
    "never place skills in industries.\n"
    "RESULTS.quantitative: evidence numbers only; metric + value; context/meaning = next short item; no invented, "
    "estimated, altered, extrapolated numbers.\n"
    "RESULTS.qualitative: specific non-numeric outcome; beneficiary/system/technical context = next "
    "short item when evidenced.\n"
    "CONCLUSION: 1 evidence-grounded takeaway; value + strongest demonstrated capability; no hype.\n"
    "WEB: keep main project/article; drop header/nav/footer/chrome/CTA/wrappers. SOCIAL: post text only.\n"
    "EXCLUDE: generic communication/leadership/public speaking/promotion unless domain-relevant.\n"
    "STYLE: keep good source sentences unchanged; add context as a new short sentence/item; plain "
    "language; compact clauses; lists; : - , (); minimal filler.\n\n"
) + HARVARD_PRINCIPLES


class IndustryClassifier:
    def __init__(self, llm: LLMProvider | None) -> None:
        self._llm = llm

    def classify(
        self,
        repos: list[Repo],
        achievements: list[ResumeAchievement],
        web_pages: list[WebPageInput] | None = None,
    ) -> IndustryClassification:
        web_pages = web_pages or []
        if self._llm is not None and not isinstance(self._llm, NullProvider):
            try:
                return self._classify_with_ai(repos, achievements, web_pages)
            except Exception:
                pass
        return _classify_static(repos, achievements)

    def _classify_with_ai(
        self,
        repos: list[Repo],
        achievements: list[ResumeAchievement],
        web_pages: list[WebPageInput],
    ) -> IndustryClassification:
        prompt = _build_prompt(repos, achievements, web_pages)
        result = self._llm.structured(
            prompt,
            schema=IndustryClassification,
            system=_SYSTEM,
            max_tokens=4096,
        )
        return _normalize_classification(result)


def plan_industry_resumes(
    classification: IndustryClassification,
    repos: list[Repo],
    achievements: list[ResumeAchievement],
) -> list[IndustryResumePlan]:
    """Create one plan per normalized industry with at least one GitHub project."""

    repos_by_full_name = {repo.full_name: repo for repo in repos}
    achievements_by_id = {str(i): item for i, item in enumerate(achievements)}

    projects_by_industry: dict[str, list[ResumeProject]] = defaultdict(list)
    project_skills_by_industry: dict[str, set[str]] = defaultdict(set)
    for tagged in classification.projects:
        repo = repos_by_full_name.get(tagged.repo_full_name)
        if repo is None:
            continue
        project = _project_from_tag(repo, tagged)
        for industry in tagged.industries:
            industry_name = _clean_tag(industry)
            if not industry_name:
                continue
            projects_by_industry[industry_name].append(project)
            project_skills_by_industry[industry_name].update(
                s.lower() for s in tagged.skill_subtags if s.strip()
            )

    achievements_by_industry: dict[str, list[ResumeAchievement]] = defaultdict(list)
    for tagged in classification.achievements:
        source = achievements_by_id.get(tagged.source_id)
        if source is None:
            continue
        tagged_skills = {s.lower() for s in tagged.skill_subtags if s.strip()}
        explicit_industries = {_clean_tag(i) for i in tagged.industries}
        for industry, projects in projects_by_industry.items():
            if not projects:
                continue
            industry_match = industry in explicit_industries
            skill_match = bool(tagged_skills & project_skills_by_industry[industry])
            if not industry_match and not skill_match:
                continue
            achievements_by_industry[industry].append(_achievement_from_tag(source, tagged))

    plans: list[IndustryResumePlan] = []
    for industry in sorted(projects_by_industry):
        projects = projects_by_industry[industry]
        if not projects:
            continue
        plans.append(
            IndustryResumePlan(
                industry=industry,
                role=_role_from_industry(industry, projects),
                projects=projects,
                achievements=achievements_by_industry.get(industry, []),
            )
        )
    return plans


def compact_source_display(url: str | None, source: str = "") -> tuple[str | None, str | None]:
    """Return (icon, display_text) without noisy full URLs."""

    if not url:
        return (None, None)
    cleaned = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^www\.", "", cleaned, flags=re.IGNORECASE).rstrip("/")
    low = cleaned.lower()
    source_low = source.lower()
    if "github.com/" in low:
        path = cleaned.split("github.com/", 1)[1]
        return ("github", f"github/{path}")
    if "linkedin.com/in/" in low:
        path = cleaned.split("linkedin.com/in/", 1)[1]
        return ("linkedin", path)
    if "facebook.com/" in low or source_low == "facebook":
        return ("facebook", None)
    return (source_low or None, cleaned)


def _build_prompt(
    repos: list[Repo],
    achievements: list[ResumeAchievement],
    web_pages: list[WebPageInput],
) -> str:
    repo_blob = "\n\n---\n\n".join(_format_repo(repo) for repo in repos if not repo.archived)
    achievement_blob = "\n".join(
        f"[{i}] source={a.source}\ntitle={a.title}\ntext={(a.snippet or '')[:_MAX_SOCIAL_CHARS]}"
        for i, a in enumerate(achievements)
    ) or "(none)"
    web_blob = "\n\n---\n\n".join(
        f"id={page.id}\nurl={page.url or ''}\ntitle={page.title}\ncontent:\n{page.html_or_text[:_MAX_WEB_CHARS]}"
        for page in web_pages
    ) or "(none)"
    return (
        "Classify this candidate evidence for automatic industry-specific resume generation.\n\n"
        f"GitHub repositories:\n{repo_blob or '(none)'}\n\n"
        f"Social post text / achievements:\n{achievement_blob}\n\n"
        f"Arbitrary website content:\n{web_blob}\n\n"
        "Important output rules: create normalized industries from the evidence; tag GitHub "
        "projects by industry; tag achievements only when they are real supporting evidence; "
        "use achievement source_id equal to its input bracket index; provide extraction_rules "
        "for each arbitrary website source."
    )


def _format_repo(repo: Repo) -> str:
    return (
        f"full_name: {repo.full_name}\n"
        f"url: {repo.url}\n"
        f"description: {repo.description or ''}\n"
        f"languages: {', '.join(repo.languages)}\n"
        f"topics: {', '.join(repo.topics)}\n"
        f"readme_excerpt:\n{(repo.readme or '')[:_MAX_README_CHARS]}"
    )


def _project_from_tag(repo: Repo, tagged: TaggedProject) -> ResumeProject:
    icon, display = compact_source_display(repo.url, "github")
    description = tagged.summary or repo.description or ""
    return ResumeProject(
        name=repo.name,
        url=repo.url,
        description=description,
        tech=list(repo.languages),
        industry_tags=list(tagged.industries),
        skill_subtags=list(tagged.skill_subtags),
        quantitative_impact=list(tagged.quantitative_impact),
        qualitative_impact=list(tagged.qualitative_impact),
        source_icon=icon,
        display_url=display,
    )


def _achievement_from_tag(
    source: ResumeAchievement,
    tagged: TaggedAchievement,
) -> ResumeAchievement:
    icon, display = compact_source_display(source.url, source.source)
    snippet = tagged.focused_snippet.strip() or source.snippet
    return source.model_copy(
        update={
            "snippet": snippet,
            "industry_tags": list(tagged.industries),
            "skill_subtags": list(tagged.skill_subtags),
            "quantitative_impact": list(tagged.quantitative_impact),
            "qualitative_impact": list(tagged.qualitative_impact),
            "source_icon": icon,
            "display_url": display,
        }
    )


def _role_from_industry(industry: str, projects: list[ResumeProject]) -> RoleSpec:
    skills: list[str] = []
    seen: set[str] = set()
    for project in projects:
        for skill in [*project.skill_subtags, *project.tech]:
            key = skill.strip().lower()
            if key and key not in seen:
                seen.add(key)
                skills.append(skill.strip())
    label = f"{industry.title()} Specialist"
    return RoleSpec(
        id=_slugify(industry),
        label=label,
        keywords=[industry, *skills[:8]],
        must_have_skills=skills[:6],
        nice_to_have=skills[6:12],
        summary_hint=f"Project-backed {industry} resume built from GitHub evidence.",
    )


def _normalize_classification(result: IndustryClassification) -> IndustryClassification:
    normalized = [_clean_tag(tag) for tag in result.normalized_industries]
    normalized = [tag for tag in normalized if tag]
    result.normalized_industries = _dedupe(normalized)
    for project in result.projects:
        project.industries = _dedupe(_clean_tag(tag) for tag in project.industries)
        project.skill_subtags = _dedupe(s.strip() for s in project.skill_subtags if s.strip())
    for achievement in result.achievements:
        achievement.industries = _dedupe(_clean_tag(tag) for tag in achievement.industries)
        achievement.skill_subtags = _dedupe(
            s.strip() for s in achievement.skill_subtags if s.strip()
        )
    return result


def _classify_static(
    repos: list[Repo],
    achievements: list[ResumeAchievement],
) -> IndustryClassification:
    project_tags = [_tag_repo_static(repo) for repo in repos if not repo.archived]
    industries = _dedupe(tag for p in project_tags for tag in p.industries)
    achievement_tags = [
        _tag_achievement_static(str(i), achievement, industries)
        for i, achievement in enumerate(achievements)
    ]
    return IndustryClassification(
        normalized_industries=industries,
        projects=[p for p in project_tags if p.industries],
        achievements=[a for a in achievement_tags if a.industries or a.skill_subtags],
    )


def _tag_repo_static(repo: Repo) -> TaggedProject:
    # Static mode cannot normalize industries intelligently. It uses only labels
    # already present on the repo instead of carrying a hardcoded taxonomy.
    industries = _dedupe(_clean_static_label(topic) for topic in repo.topics)
    skills = _dedupe([*repo.languages, *repo.topics])
    return TaggedProject(
        repo_full_name=repo.full_name,
        industries=industries,
        skill_subtags=skills,
        summary=repo.description or "",
        qualitative_impact=[f"Built {repo.name} with {', '.join(skills[:5])} components."] if skills else [],
    )


def _tag_achievement_static(
    source_id: str,
    achievement: ResumeAchievement,
    industries: list[str],
) -> TaggedAchievement:
    text = f"{achievement.title}\n{achievement.snippet}".lower()
    matched_industries = [industry for industry in industries if _term_in_text(industry, text)]
    return TaggedAchievement(
        source_id=source_id,
        industries=matched_industries,
        skill_subtags=[],
        focused_snippet=achievement.snippet,
    )


def _clean_tag(tag: str) -> str:
    cleaned = re.sub(r"\s+", " ", tag.strip().lower())
    return cleaned


def _clean_static_label(label: str) -> str:
    cleaned = re.sub(r"[-_]+", " ", label.strip().lower())
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _term_in_text(term: str, text: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])", text) is not None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-") or "industry"


def _dedupe(values) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = str(value).strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            out.append(item)
    return out
