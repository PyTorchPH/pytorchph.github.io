"""The DEBUG TRACE records which divs the scraper walked — diagnostic only.

Contract under test:
- `record` rejects unknown decisions and unknown descriptor fields.
- `to_dict` carries run metadata + visited list and omits None fields.
- `write` lands under the gitignored out/_debug/ by default.
- the recorder reproduces the committed fixture shape.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from resume_builder.sources.social.trace import TraceRecorder

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "social"


def _recorder() -> TraceRecorder:
    rec = TraceRecorder(
        vendor="facebook",
        url="https://www.facebook.com/feutechpytorch",
        post_selector="div:has(a[href*='/posts/'])",
    )
    rec.record(
        post=1, role="post", decision="SCRAPED", tag="div",
        css_path="div>div:nth-of-type(3)>div",
        text_preview="Spoke at the FEU Tech PyTorch chapter on training CNNs",
        rect={"x": 0, "y": 120, "w": 500, "h": 640},
    )
    rec.record(post=1, role="comment", decision="SKIPPED", tag="div", aria_label="Comment by Juan Dela Cruz")
    rec.record(post=1, role="media", decision="RETRIEVED_PICTURE", tag="img", src="https://scontent.fmnl.example/image1.jpg")
    rec.record(
        post=1, role="text", decision="RETRIEVED_TEXT", tag="div",
        text_preview="Spoke at the FEU Tech PyTorch chapter on training CNNs",
    )
    rec.record(post=1, role="shared", decision="PRESERVED", tag="div", aria_label="Original post by PyTorch")
    return rec


def test_record_rejects_unknown_decision():
    rec = TraceRecorder(vendor="facebook")
    with pytest.raises(ValueError):
        rec.record(post=1, role="post", decision="MAYBE")


def test_record_rejects_unknown_descriptor_field():
    rec = TraceRecorder(vendor="facebook")
    with pytest.raises(ValueError):
        rec.record(post=1, role="post", decision="SCRAPED", color="red")


def test_to_dict_omits_none_fields():
    rec = TraceRecorder(vendor="facebook")
    rec.record(post=1, role="comment", decision="SKIPPED", tag="div", aria_label="Comment by X")
    entry = rec.to_dict()["visited"][0]
    assert "src" not in entry and "rect" not in entry and "css_path" not in entry
    assert entry["decision"] == "SKIPPED"


def test_write_defaults_to_gitignored_out_debug(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    path = _recorder().write()
    assert path == Path("out") / "_debug" / "facebook.trace.json"
    assert path.exists()


def test_recorder_matches_committed_fixture():
    produced = _recorder().to_dict()
    expected = json.loads((FIXTURES / "trace" / "facebook.trace.json").read_text(encoding="utf-8"))
    assert produced == expected
