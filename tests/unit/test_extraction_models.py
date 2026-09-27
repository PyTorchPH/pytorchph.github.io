from resume_builder.extraction.models import CleanedSource, DEFAULT_CAP_CHARS, apply_token_cap


def test_cleaned_source_defaults():
    cs = CleanedSource(source_id="owner/repo:README.md", kind="github_readme")
    assert cs.text == ""
    assert cs.section_hints == []
    assert cs.truncated is False and cs.degraded is False


def test_cap_chars_constant():
    assert DEFAULT_CAP_CHARS == 12000


def test_apply_token_cap_under_and_over():
    assert apply_token_cap("hello", 100) == ("hello", False)
    clipped, truncated = apply_token_cap("x" * 50, 10)
    assert clipped == "x" * 10 and truncated is True
