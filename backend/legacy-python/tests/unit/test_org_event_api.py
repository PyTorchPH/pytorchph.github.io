from __future__ import annotations

import socket

import pytest

from resume_builder.web.org_event_api import (
    ExternalEventPackage,
    ExtractedFacts,
    _assert_public_url,
    execute_pipeline_node,
)


def event_payload():
    return {
        "title": "Regional PyTorch Workshop",
        "organizer": "Example University",
        "summary": "A public workshop with a published program and registration page.",
        "category": "workshops",
        "scope": "external",
        "startAt": "2026-09-10T09:00:00+08:00",
        "endAt": None,
        "timezone": "Asia/Manila",
        "venue": "Innovation Hall",
        "registrationUrl": "https://events.example/register",
        "registrationDeadline": None,
        "fee": "Free",
        "eligibility": ["Students"],
        "requirements": [],
        "sourceUrl": "https://events.example/workshop",
        "scrapedAt": "2026-08-22T00:00:00Z",
        "contentHash": f"sha256:{'a' * 64}",
        "scraperVersion": "visible-browser-v1",
        "confidence": 0.9,
        "warnings": [],
    }


def test_event_package_requires_strict_grounded_shape():
    package = ExternalEventPackage.model_validate(event_payload())
    assert package.scope == "external"


@pytest.mark.parametrize("url", ["file:///etc/passwd", "http://localhost/event", "ftp://example.com/event"])
def test_public_url_gate_rejects_unsupported_or_local_urls(url, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))])
    with pytest.raises(ValueError):
        _assert_public_url(url)


def test_public_url_gate_accepts_global_addresses(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))])
    _assert_public_url("https://events.example/workshop")


def test_email_nodes_are_dry_run_and_delivery_remains_blocked():
    draft, draft_status = execute_pipeline_node("email-draft", event_payload())
    delivery, delivery_status = execute_pipeline_node("email-send", {})

    assert draft_status == 200
    assert draft["node"]["status"] == "completed"
    assert draft["node"]["output"]["deliveryStatus"] == "not_sent"
    assert "Regional PyTorch Workshop" in draft["node"]["output"]["subject"]
    assert delivery_status == 200
    assert delivery["node"]["status"] == "blocked"
    assert delivery["node"]["output"]["allowed"] is False


def test_standalone_extract_node_exposes_the_exact_structured_ai_response(monkeypatch):
    class FakeProvider:
        name = "litellm:google"

        def structured(self, *_args, **_kwargs):
            payload = event_payload()
            for key in ("scope", "sourceUrl", "scrapedAt", "contentHash", "scraperVersion"):
                payload.pop(key)
            return ExtractedFacts.model_validate(payload)

    monkeypatch.setattr(
        "resume_builder.web.org_event_api.get_configured_provider", lambda: FakeProvider()
    )
    value, status = execute_pipeline_node(
        "extract",
        {"renderedText": "Rendered public event facts. " * 8},
    )

    assert status == 200
    assert value["node"]["output"]["provider"] == "litellm:google"
    assert value["node"]["output"]["aiResponse"]["title"] == "Regional PyTorch Workshop"
