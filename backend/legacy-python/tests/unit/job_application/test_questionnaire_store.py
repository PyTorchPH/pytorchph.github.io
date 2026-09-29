from copy import deepcopy

from resume_builder.job_application import (
    ApprovedIndeedQuestionAnswerSet,
    ApprovedIndeedQuestionAnswers,
    MongoQuestionnaireRepository,
    ScreeningQuestion,
)


class _Result:
    def __init__(self, *, inserted: bool, modified: bool):
        self.upserted_id = "new" if inserted else None
        self.modified_count = int(modified)


class _Cursor(list):
    def sort(self, field, direction):
        reverse = direction < 0
        return _Cursor(sorted(self, key=lambda item: item[field], reverse=reverse))


class _Collection:
    def __init__(self):
        self.documents = []
        self.indexes = []

    def create_index(self, keys, **kwargs):
        self.indexes.append((keys, kwargs))

    def update_one(self, selector, update, *, upsert):
        existing = next(
            (
                item
                for item in self.documents
                if all(item.get(key) == value for key, value in selector.items())
            ),
            None,
        )
        if existing is None:
            assert upsert is True
            document = deepcopy(update["$setOnInsert"])
            document.update(deepcopy(update["$set"]))
            self.documents.append(document)
            return _Result(inserted=True, modified=False)
        changed = any(existing.get(key) != value for key, value in update["$set"].items())
        existing.update(deepcopy(update["$set"]))
        return _Result(inserted=False, modified=changed)

    def find(self, query, projection):
        documents = []
        for item in self.documents:
            if all(item.get(key) == value for key, value in query.items()):
                documents.append(
                    {
                        key: deepcopy(value)
                        for key, value in item.items()
                        if key != "_id" and projection.get(key)
                    }
                )
        return _Cursor(documents)

    def find_one(self, query, projection):
        documents = self.find(query, projection)
        return documents[0] if documents else None

    def count_documents(self, query):
        return sum(
            all(item.get(key) == value for key, value in query.items())
            for item in self.documents
        )


class _Database:
    def __init__(self):
        self.collections = {
            "indeed_question_sets": _Collection(),
            "application_profile": _Collection(),
        }
        self.collection = self.collections["indeed_question_sets"]

    def __getitem__(self, name):
        return self.collections[name]

    def command(self, name):
        assert name == "ping"
        return {"ok": 1}


class _Client:
    def __init__(self):
        self.database = _Database()
        self.closed = False

    def __getitem__(self, name):
        assert name == "pytorch_ph"
        return self.database

    def close(self):
        self.closed = True


def _answer_set():
    return ApprovedIndeedQuestionAnswerSet(
        pages=[
            ApprovedIndeedQuestionAnswers(
                question_set_fingerprint="a" * 40,
                answers={
                    "Where do you currently live?": "Philippines",
                    "Language 1": "Filipino",
                },
            ),
            ApprovedIndeedQuestionAnswers(
                question_set_fingerprint="b" * 40,
                answers={"Which location are you applying for?": "Australia, Sydney"},
            ),
        ]
    )


def test_mongodb_repository_round_trips_and_upserts_exact_profiles():
    client = _Client()
    repository = MongoQuestionnaireRepository(client=client)

    assert repository.ping() is True
    assert repository.save(_answer_set(), source="unit test") == 2
    assert repository.save(_answer_set(), source="unit test") == 2
    assert repository.count(domain="smartapply.indeed.com") == 2
    assert repository.load(domain="smartapply.indeed.com") == _answer_set()
    assert any(
        options.get("unique") is True
        for _, options in client.database.collection.indexes
    )

    repository.close()
    assert client.closed is True


def test_mongodb_repository_returns_none_for_unknown_domain():
    repository = MongoQuestionnaireRepository(client=_Client())

    assert repository.load(domain="apply.example.com") is None


def test_mongodb_repository_persists_explicit_profile_values_separately():
    client = _Client()
    repository = MongoQuestionnaireRepository(client=client)

    assert repository.profile_value("willing_to_relocate") is None
    repository.set_profile_value(
        "willing_to_relocate",
        True,
        source="explicit user instruction",
    )

    assert repository.profile_value("willing_to_relocate") is True
    assert repository.profile_values() == {"willing_to_relocate": True}
    assert repository.count(domain="smartapply.indeed.com") == 0


def test_mongodb_repository_saves_observed_questions_without_private_answer():
    client = _Client()
    repository = MongoQuestionnaireRepository(client=client)
    questions = [
        ScreeningQuestion(
            question_id="q1",
            label="Mobile number",
            selector="#q1",
            required=True,
        )
    ]

    repository.save_observed_page(
        questions,
        {},
        domain="smartapply.indeed.com",
        source="unit test",
    )

    document = client.database.collection.documents[0]
    assert document["questions"] == [
        {
            "label": "Mobile number",
            "context": "",
            "kind": "text",
            "options": [],
            "required": True,
        }
    ]
    assert document["answers"] == []


def test_mongodb_repository_keeps_duplicate_labels_distinct_by_question_id():
    client = _Client()
    repository = MongoQuestionnaireRepository(client=client)
    questions = [
        ScreeningQuestion(
            question_id="spoken_language_1",
            label="Language 1",
            selector="#spoken",
            kind="select",
            required=True,
        ),
        ScreeningQuestion(
            question_id="programming_language_1",
            label="Language 1",
            selector="#programming",
            kind="select",
            required=True,
        ),
    ]

    repository.save_observed_page(
        questions,
        {"spoken_language_1": "English", "programming_language_1": "Python"},
        domain="smartapply.indeed.com",
        source="unit test",
    )

    assert repository.reusable_answers(
        questions,
        domain="smartapply.indeed.com",
    ) == {
        "spoken_language_1": "English",
        "programming_language_1": "Python",
    }


def test_mongodb_repository_does_not_reuse_legacy_duplicate_label():
    client = _Client()
    repository = MongoQuestionnaireRepository(client=client)
    repository.save(_answer_set(), source="legacy unit test")
    questions = [
        ScreeningQuestion(question_id="spoken", label="Language 1", selector="#spoken"),
        ScreeningQuestion(
            question_id="programming",
            label="Language 1",
            selector="#programming",
        ),
    ]

    assert repository.reusable_answers(
        questions,
        domain="smartapply.indeed.com",
    ) == {}
