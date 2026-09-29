"""MongoDB document storage for exact, user-approved questionnaire profiles."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..indeed_questionnaire import (
    ApprovedIndeedQuestionAnswerSet,
    ApprovedIndeedQuestionAnswers,
)
from ..models import ScreeningQuestion

DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017/?directConnection=true"
DEFAULT_MONGODB_DATABASE = "pytorch_ph"
QUESTIONNAIRE_COLLECTION = "indeed_question_sets"
PROFILE_COLLECTION = "application_profile"
SCHEMA_VERSION = 1


class MongoQuestionnaireRepository:
    """Persist variable questionnaire documents while retaining exact fingerprints."""

    def __init__(
        self,
        uri: str = DEFAULT_MONGODB_URI,
        *,
        database: str = DEFAULT_MONGODB_DATABASE,
        client: Any | None = None,
        server_selection_timeout_ms: int = 5_000,
    ) -> None:
        if not uri.strip():
            raise ValueError("MongoDB URI is required")
        if not database.strip():
            raise ValueError("MongoDB database name is required")
        if client is None:
            try:
                from pymongo import MongoClient
                from pymongo.server_api import ServerApi
            except ImportError as exc:
                raise RuntimeError(
                    "PyMongo is required for MongoDB questionnaire storage"
                ) from exc
            client = MongoClient(
                uri,
                server_api=ServerApi("1"),
                serverSelectionTimeoutMS=server_selection_timeout_ms,
            )
        self.client = client
        self.database = client[database]
        self.collection = self.database[QUESTIONNAIRE_COLLECTION]
        self.profile_collection = self.database[PROFILE_COLLECTION]
        self._ensure_indexes()

    def close(self) -> None:
        self.client.close()

    def ping(self) -> bool:
        return bool(self.database.command("ping").get("ok"))

    def save(
        self,
        answer_set: ApprovedIndeedQuestionAnswerSet,
        *,
        source: str = "user-approved migration",
        observed_at: datetime | None = None,
    ) -> int:
        """Upsert one document per exact question-set fingerprint."""
        timestamp = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        updated = 0
        for page in answer_set.pages:
            document = {
                "schema_version": SCHEMA_VERSION,
                "provider": "indeed",
                "domain": page.domain,
                "question_set_fingerprint": page.question_set_fingerprint,
                "answers": [
                    {"label": label, "value": value}
                    for label, value in page.answers.items()
                ],
                "source": source,
                "updated_at": timestamp,
            }
            result = self.collection.update_one(
                {
                    "domain": page.domain,
                    "question_set_fingerprint": page.question_set_fingerprint,
                },
                {
                    "$set": document,
                    "$setOnInsert": {"created_at": timestamp},
                },
                upsert=True,
            )
            updated += int(bool(result.upserted_id) or result.modified_count > 0)
        return updated

    def load(self, *, domain: str) -> ApprovedIndeedQuestionAnswerSet | None:
        documents = list(
            self.collection.find(
                {"domain": domain, "schema_version": SCHEMA_VERSION},
                {
                    "_id": 0,
                    "domain": 1,
                    "question_set_fingerprint": 1,
                    "answers": 1,
                },
            ).sort("question_set_fingerprint", 1)
        )
        if not documents:
            return None
        pages = []
        for document in documents:
            answers = {
                str(item["label"]): str(item["value"])
                for item in document.get("answers", [])
                if item.get("label") and item.get("value")
            }
            pages.append(
                ApprovedIndeedQuestionAnswers(
                    domain=document["domain"],
                    question_set_fingerprint=document["question_set_fingerprint"],
                    answers=answers,
                )
            )
        return ApprovedIndeedQuestionAnswerSet(domain=domain, pages=pages)

    def reusable_answers(
        self,
        questions: list[ScreeningQuestion],
        *,
        domain: str,
    ) -> dict[str, str]:
        """Reuse prior answers by question ID; use labels only when unambiguous."""
        wanted_by_id = {question.question_id: question for question in questions}
        wanted_by_label: dict[str, list[ScreeningQuestion]] = {}
        for question in questions:
            wanted_by_label.setdefault(
                self._normalized_label(question.label),
                [],
            ).append(question)
        if not wanted_by_id:
            return {}
        documents = self.collection.find(
            {"domain": domain, "schema_version": SCHEMA_VERSION},
            {"_id": 0, "answers": 1, "updated_at": 1},
        ).sort("updated_at", 1)
        reusable: dict[str, str] = {}
        for document in documents:
            for item in document.get("answers", []):
                question_id = str(item.get("question_id", "")).strip()
                label = str(item.get("label", "")).strip()
                value = str(item.get("value", "")).strip()
                if not value:
                    continue
                if question_id in wanted_by_id:
                    reusable[question_id] = value
                    continue
                matches = wanted_by_label.get(self._normalized_label(label), [])
                if len(matches) == 1:
                    reusable[matches[0].question_id] = value
        return reusable

    def save_observed_page(
        self,
        questions: list[ScreeningQuestion],
        answers: dict[str, str],
        *,
        domain: str,
        source: str,
        observed_at: datetime | None = None,
    ) -> None:
        """Upsert every observed question plus only the reusable validated answers."""
        from ..indeed_questionnaire import question_set_fingerprint

        timestamp = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        fingerprint = question_set_fingerprint(questions)
        label_counts: dict[str, int] = {}
        for question in questions:
            normalized = self._normalized_label(question.label)
            label_counts[normalized] = label_counts.get(normalized, 0) + 1
        stored_answers = []
        for question in questions:
            value = str(answers.get(question.question_id, "")).strip()
            if not value and label_counts[self._normalized_label(question.label)] == 1:
                value = str(answers.get(question.label, "")).strip()
            if value:
                stored_answers.append(
                    {
                        "question_id": question.question_id,
                        "label": question.label,
                        "value": value,
                    }
                )
        document = {
            "schema_version": SCHEMA_VERSION,
            "provider": "indeed",
            "domain": domain,
            "question_set_fingerprint": fingerprint,
            "questions": [
                {
                    "label": question.label,
                    "context": question.context,
                    "kind": question.kind,
                    "options": question.options,
                    "required": question.required,
                }
                for question in questions
            ],
            "answers": stored_answers,
            "source": source,
            "updated_at": timestamp,
        }
        self.collection.update_one(
            {
                "domain": domain,
                "question_set_fingerprint": fingerprint,
            },
            {
                "$set": document,
                "$setOnInsert": {"created_at": timestamp},
            },
            upsert=True,
        )

    def count(self, *, domain: str | None = None) -> int:
        query = {"domain": domain} if domain else {}
        return int(self.collection.count_documents(query))

    def set_profile_value(
        self,
        key: str,
        value: bool | str,
        *,
        source: str,
        observed_at: datetime | None = None,
    ) -> None:
        """Persist an explicit user fact/preference separately from question code."""
        clean_key = key.strip()
        if not clean_key:
            raise ValueError("profile key is required")
        timestamp = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        self.profile_collection.update_one(
            {"key": clean_key},
            {
                "$set": {
                    "schema_version": SCHEMA_VERSION,
                    "key": clean_key,
                    "value": value,
                    "source": source,
                    "updated_at": timestamp,
                },
                "$setOnInsert": {"created_at": timestamp},
            },
            upsert=True,
        )

    def profile_value(self, key: str) -> bool | str | None:
        document = self.profile_collection.find_one(
            {"key": key.strip(), "schema_version": SCHEMA_VERSION},
            {"_id": 0, "value": 1},
        )
        return None if document is None else document.get("value")

    def profile_values(self) -> dict[str, bool | str]:
        """Return all explicit reusable profile facts/preferences without question logic."""
        documents = self.profile_collection.find(
            {"schema_version": SCHEMA_VERSION},
            {"_id": 0, "key": 1, "value": 1},
        )
        return {
            str(document["key"]): document["value"]
            for document in documents
            if document.get("key") and isinstance(document.get("value"), (bool, str))
        }

    def _ensure_indexes(self) -> None:
        self.collection.create_index(
            [("domain", 1), ("question_set_fingerprint", 1)],
            unique=True,
            name="unique_domain_fingerprint",
        )
        self.collection.create_index(
            [("provider", 1), ("updated_at", -1)],
            name="provider_updated",
        )
        self.profile_collection.create_index(
            [("key", 1)],
            unique=True,
            name="unique_profile_key",
        )

    @staticmethod
    def _normalized_label(label: str) -> str:
        return " ".join(label.casefold().split()).rstrip(" ?*:,.")
