"""Migrate an approved Indeed questionnaire JSON profile into MongoDB."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_application.indeed_questionnaire import (  # noqa: E402
    ApprovedIndeedQuestionAnswerSet,
)
from resume_builder.job_application.persistence.questionnaire_store import (  # noqa: E402
    DEFAULT_MONGODB_DATABASE,
    DEFAULT_MONGODB_URI,
    MongoQuestionnaireRepository,
)


def migrate(args: argparse.Namespace) -> int:
    answer_set = ApprovedIndeedQuestionAnswerSet.model_validate_json(
        args.source.read_text(encoding="utf-8")
    )
    repository = MongoQuestionnaireRepository(args.mongodb_uri, database=args.database)
    try:
        repository.ping()
        upserted = repository.save(
            answer_set,
            source=f"approved JSON migration: {args.source.name}",
        )
        stored = repository.load(domain=answer_set.domain)
        source_pages = {page.question_set_fingerprint: page.answers for page in answer_set.pages}
        stored_pages = (
            {page.question_set_fingerprint: page.answers for page in stored.pages}
            if stored is not None
            else {}
        )
        if any(stored_pages.get(fingerprint) != answers for fingerprint, answers in source_pages.items()):
            print("STOP: MongoDB read-after-write verification did not match the source profile")
            return 2
        print(
            f"mongodb=healthy domain={answer_set.domain} "
            f"documents={repository.count(domain=answer_set.domain)} upserted={upserted}"
        )
        return 0
    finally:
        repository.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--mongodb-uri", default=DEFAULT_MONGODB_URI)
    parser.add_argument("--database", default=DEFAULT_MONGODB_DATABASE)
    return parser


if __name__ == "__main__":
    raise SystemExit(migrate(_parser().parse_args()))
