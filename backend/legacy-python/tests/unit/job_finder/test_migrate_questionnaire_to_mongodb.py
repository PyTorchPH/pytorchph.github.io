from tools.job_finder import migrate_questionnaire_to_mongodb as migration


def test_migration_verification_allows_unrelated_existing_question_sets(monkeypatch, tmp_path):
    source = tmp_path / "approved.json"
    source.write_text(
        """
        {
          "pages": [
            {
              "domain": "smartapply.indeed.com",
              "question_set_fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "answers": {"Authorized to work?": "Yes"}
            }
          ]
        }
        """,
        encoding="utf-8",
    )

    class Repository:
        def __init__(self, *_args, **_kwargs):
            pass

        def ping(self):
            return True

        def save(self, *_args, **_kwargs):
            return 1

        def load(self, **_kwargs):
            return migration.ApprovedIndeedQuestionAnswerSet.model_validate(
                {
                    "pages": [
                        {
                            "domain": "smartapply.indeed.com",
                            "question_set_fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "answers": {"Authorized to work?": "Yes"},
                        },
                        {
                            "domain": "smartapply.indeed.com",
                            "question_set_fingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "answers": {"Years of Python?": "3"},
                        },
                    ]
                }
            )

        def count(self, **_kwargs):
            return 2

        def close(self):
            pass

    monkeypatch.setattr(migration, "MongoQuestionnaireRepository", Repository)
    args = type(
        "Args",
        (),
        {"source": source, "mongodb_uri": "mongodb://local", "database": "test"},
    )()

    assert migration.migrate(args) == 0
