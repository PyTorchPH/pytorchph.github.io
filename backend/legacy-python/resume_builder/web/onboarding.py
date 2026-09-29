"""Layered, read-only-artifact onboarding for the main job automation UI."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from ..job_application import ApplicationProfileStore


class OnboardingService:
    """Resolve one setup step at a time without rewriting resume artifacts."""

    def __init__(self, *, artifact_dir: Path, database: Path) -> None:
        self.artifact_dir = artifact_dir
        self.store = ApplicationProfileStore(database)

    def state(self) -> dict[str, Any]:
        source = self._source_state()
        if source["errors"]:
            return {
                "phase": "error",
                "ready": False,
                "current_blocker": None,
                "source": source,
                "profile": self._profile_summary(),
                "preferences": self._preferences_payload(),
                "next_url": "/setup",
            }

        identity = self.store.verified_identity()
        if identity is None:
            blocker = self._identity_blocker(source)
            return {
                "phase": "correction",
                "ready": False,
                "current_blocker": blocker,
                "source": source,
                "profile": self._profile_summary(),
                "preferences": self._preferences_payload(),
                "next_url": "/setup",
            }

        preferences = self.store.onboarding_preferences()
        if preferences is None:
            return {
                "phase": "job_preferences",
                "ready": False,
                "current_blocker": {
                    "field": "job_preferences",
                    "title": "Choose the first safe automation goal",
                    "description": (
                        "These settings are required before the system may start read-only "
                        "discovery and draft-safe work after Indeed is connected."
                    ),
                },
                "source": source,
                "profile": self._profile_summary(),
                "preferences": None,
                "next_url": "/setup",
            }

        activation_key = hashlib.sha256(preferences.updated_at.encode("utf-8")).hexdigest()
        return {
            "phase": "ready",
            "ready": True,
            "current_blocker": None,
            "source": source,
            "profile": self._profile_summary(),
            "preferences": self._preferences_payload(),
            "activation_key": activation_key,
            "auto_started_goal_id": self.store.auto_started_goal(activation_key),
            "next_url": "/dashboard",
        }

    def save_correction(self, field: str, values: dict[str, str]) -> dict[str, Any]:
        current = self.state()
        blocker = current.get("current_blocker") or {}
        if current.get("phase") != "correction" or blocker.get("field") != field:
            raise ValueError("this correction is not the current onboarding step")
        cleaned = {key: str(value).strip() for key, value in values.items()}
        if field == "name":
            if not cleaned.get("first_name") or not cleaned.get("last_name"):
                raise ValueError("first name and last name are required")
            accepted = {
                "first_name": cleaned["first_name"],
                "last_name": cleaned["last_name"],
            }
        elif field == "country":
            if not cleaned.get("country_name"):
                raise ValueError("country name is required")
            if not re.fullmatch(r"[A-Za-z]{2}", cleaned.get("country_iso", "")):
                raise ValueError("country ISO must contain exactly two letters")
            if not re.fullmatch(r"\+\d{1,4}", cleaned.get("phone_calling_code", "")):
                raise ValueError("phone calling code must use + followed by 1-4 digits")
            accepted = {
                "country_name": cleaned["country_name"],
                "country_iso": cleaned["country_iso"].upper(),
                "phone_calling_code": cleaned["phone_calling_code"],
            }
        elif field == "phone":
            phone = cleaned.get("verified_phone", "")
            if not re.fullmatch(r"\+?[\d ()-]{7,24}", phone):
                raise ValueError("verified phone has an unsupported format")
            accepted = {"verified_phone": phone}
        else:
            raise ValueError("unsupported onboarding correction")

        self.store.save_onboarding_answer(field, accepted)
        self._finalize_identity_if_complete()
        return self.state()

    def save_preferences(
        self,
        *,
        target: int,
        target_countries: list[str],
        work_mode: str,
        employment_type: str,
        safe_auto_start: bool,
    ) -> dict[str, Any]:
        if self.state().get("phase") != "job_preferences":
            raise ValueError("job preferences are not the current onboarding step")
        if not safe_auto_start:
            raise ValueError("safe auto-start consent is required for this main-system flow")
        self._ensure_resume_routes()
        self.store.save_onboarding_preferences(
            target=target,
            target_countries=target_countries,
            work_mode=work_mode,
            employment_type=employment_type,
            safe_auto_start=safe_auto_start,
        )
        return self.state()

    def mark_auto_started(self, activation_key: str, goal_id: str) -> None:
        state = self.state()
        if not state["ready"] or activation_key != state.get("activation_key"):
            raise ValueError("onboarding activation key is stale")
        self.store.mark_auto_started(activation_key, goal_id)

    def _source_state(self) -> dict[str, Any]:
        errors: list[str] = []
        resumes: list[dict[str, Any]] = []
        fingerprint = hashlib.sha256()
        master_path = self.artifact_dir / "mega-combined-resume.json"
        master: dict[str, Any] = {}
        if not self.artifact_dir.is_dir():
            errors.append("Configured resume artifact directory is unavailable.")
        elif not master_path.is_file():
            errors.append("mega-combined-resume.json is missing.")
        else:
            master = self._load_json(master_path, errors)
            if not isinstance(master.get("profile"), dict):
                errors.append("Master resume profile is invalid.")
            if not isinstance(master.get("target_roles"), list):
                errors.append("Master resume target roles are invalid.")
            self._fingerprint_file(fingerprint, master_path)

        routes = {route.filename: route for route in self.store.resume_routes()}
        if self.artifact_dir.is_dir():
            for metadata_path in sorted(self.artifact_dir.glob("*.resume.json")):
                metadata = self._load_json(metadata_path, errors)
                pdf_path = metadata_path.with_name(
                    metadata_path.name.removesuffix(".resume.json") + ".pdf"
                )
                role = metadata.get("role") if isinstance(metadata, dict) else None
                if not isinstance(role, dict) or not str(role.get("id", "")).strip():
                    errors.append(f"{metadata_path.name} has no valid role metadata.")
                    continue
                if not pdf_path.is_file():
                    errors.append(f"{pdf_path.name} is missing for {metadata_path.name}.")
                self._fingerprint_file(fingerprint, metadata_path)
                if pdf_path.is_file():
                    self._fingerprint_file(fingerprint, pdf_path)
                resumes.append(
                    {
                        "filename": pdf_path.name,
                        "role_id": str(role.get("id", ""))[:120],
                        "label": str(role.get("label", pdf_path.stem))[:160],
                        "summary": str(metadata.get("summary", ""))[:280],
                        "skill_group_count": len(metadata.get("skill_groups", []))
                        if isinstance(metadata.get("skill_groups"), list)
                        else 0,
                        "project_count": len(metadata.get("projects", []))
                        if isinstance(metadata.get("projects"), list)
                        else 0,
                        "artifact_ready": pdf_path.is_file(),
                        "routing_ready": pdf_path.name in routes,
                    }
                )
        if not resumes:
            errors.append("No role-specific resume JSON/PDF pairs were found.")

        return {
            "kind": "seeded_json",
            "label": "Existing verified resume artifacts",
            "master_loaded": bool(master),
            "resume_count": len(resumes),
            "resumes": resumes,
            "fingerprint": fingerprint.hexdigest(),
            "errors": list(dict.fromkeys(errors)),
        }

    def _ensure_resume_routes(self) -> None:
        existing = {route.filename: route for route in self.store.resume_routes()}
        has_default = any(route.is_default for route in existing.values())
        metadata_paths = sorted(self.artifact_dir.glob("*.resume.json"))
        for metadata_path in metadata_paths:
            filename = metadata_path.name.removesuffix(".resume.json") + ".pdf"
            if filename in existing:
                continue
            errors: list[str] = []
            metadata = self._load_json(metadata_path, errors)
            role = metadata.get("role", {}) if isinstance(metadata, dict) else {}
            candidates = [
                *(role.get("must_have_skills", []) if isinstance(role, dict) else []),
                *(role.get("keywords", []) if isinstance(role, dict) else []),
            ]
            terms = [str(item).strip() for item in candidates if str(item).strip()]
            if errors or not terms:
                raise ValueError(f"{metadata_path.name} has no usable deterministic routing terms")
            role_id = str(role.get("id", "")) if isinstance(role, dict) else ""
            is_default = not has_default and role_id == "software-systems"
            self.store.replace_resume_route(
                filename=filename,
                terms=terms,
                is_default=is_default,
            )
            has_default = has_default or is_default

    def _identity_blocker(self, _source: dict[str, Any]) -> dict[str, Any]:
        answers = self.store.onboarding_answers()
        if "name" not in answers:
            full_name = self._master_profile_name()
            parts = full_name.split()
            return {
                "field": "name",
                "title": "Verify your application name",
                "description": "Use the name that application forms should receive.",
                "prefill": {
                    "first_name": " ".join(parts[:-1]) if len(parts) > 1 else full_name,
                    "last_name": parts[-1] if len(parts) > 1 else "",
                },
            }
        if "country" not in answers:
            return {
                "field": "country",
                "title": "Verify your contact country",
                "description": (
                    "Contact country is separate from the countries selected for job search."
                ),
                "prefill": {},
            }
        return {
            "field": "phone",
            "title": "Verify your phone number",
            "description": "The number is stored locally and never inferred from job geography.",
            "prefill": {},
        }

    def _finalize_identity_if_complete(self) -> None:
        answers = self.store.onboarding_answers()
        if not all(field in answers for field in ("name", "country", "phone")):
            return
        self.store.save_verified_identity(
            first_name=answers["name"]["first_name"],
            last_name=answers["name"]["last_name"],
            country_name=answers["country"]["country_name"],
            country_iso=answers["country"]["country_iso"],
            phone_calling_code=answers["country"]["phone_calling_code"],
            verified_phone=answers["phone"]["verified_phone"],
        )
        self.store.clear_onboarding_answers()

    def _profile_summary(self) -> dict[str, Any]:
        identity = self.store.verified_identity()
        return {
            "name": identity.full_name if identity else self._master_profile_name(),
            "country": identity.country_name if identity else "",
            "phone_configured": bool(identity and identity.verified_phone),
        }

    def _preferences_payload(self) -> dict[str, Any] | None:
        preferences = self.store.onboarding_preferences()
        if preferences is None:
            return None
        return {
            "target": preferences.target,
            "target_countries": list(preferences.target_countries),
            "work_mode": preferences.work_mode,
            "employment_type": preferences.employment_type,
            "safe_auto_start": preferences.safe_auto_start,
        }

    def _master_profile_name(self) -> str:
        path = self.artifact_dir / "mega-combined-resume.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        profile = value.get("profile", {}) if isinstance(value, dict) else {}
        return str(profile.get("name", "")).strip() if isinstance(profile, dict) else ""

    @staticmethod
    def _load_json(path: Path, errors: list[str]) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            errors.append(f"{path.name} is unreadable or invalid JSON.")
            return {}
        if not isinstance(value, dict):
            errors.append(f"{path.name} must contain a JSON object.")
            return {}
        return value

    @staticmethod
    def _fingerprint_file(digest: Any, path: Path) -> None:
        digest.update(path.name.encode("utf-8"))
        try:
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError:
            digest.update(b"unreadable")
