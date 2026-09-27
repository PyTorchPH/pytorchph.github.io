import json

from pydantic import BaseModel

from resume_builder.llm.google_provider import GoogleProvider


class _Schema(BaseModel):
    answer: str


class _Response:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"answer": "Yes"})}]
                    }
                }
            ]
        }


class _Session:
    def __init__(self):
        self.call = None

    def post(self, url, *, headers, json, timeout):
        self.call = {
            "url": url,
            "headers": headers,
            "json": json,
            "timeout": timeout,
        }
        return _Response()


def test_google_provider_uses_header_secret_and_native_json_schema():
    session = _Session()
    provider = GoogleProvider(
        "secret-value",
        model="gemini-test",
        session=session,
    )

    result = provider.structured("question", _Schema, system="system")

    assert result.answer == "Yes"
    assert "secret-value" not in session.call["url"]
    assert session.call["headers"]["x-goog-api-key"] == "secret-value"
    config = session.call["json"]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseJsonSchema"]["required"] == ["answer"]
