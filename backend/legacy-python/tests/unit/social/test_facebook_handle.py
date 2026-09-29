"""Unit tests for the pure extract_handle_from_url helper in the Facebook vendor.

Only the pure function is tested here — live Playwright navigation is not unit-tested.
"""

from __future__ import annotations


from resume_builder.sources.social.vendors.facebook import extract_handle_from_url


def test_vanity_username_extracted():
    assert (
        extract_handle_from_url("https://www.facebook.com/johnandrew.balbarosa.58")
        == "johnandrew.balbarosa.58"
    )


def test_short_vanity_username():
    assert extract_handle_from_url("https://www.facebook.com/johndoe") == "johndoe"


def test_numeric_profile_php_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/profile.php?id=100000123456") is None


def test_profile_php_without_id_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/profile.php") is None


def test_trailing_slash_stripped():
    assert extract_handle_from_url("https://www.facebook.com/johndoe/") == "johndoe"


def test_query_string_stripped():
    assert extract_handle_from_url("https://www.facebook.com/johndoe?ref=home") == "johndoe"


def test_hash_fragment_stripped():
    assert extract_handle_from_url("https://www.facebook.com/johndoe#timeline") == "johndoe"


def test_posts_path_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/johndoe/posts/987654321") is None


def test_permalink_path_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/permalink/1234567890") is None


def test_events_path_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/events/1234567890") is None


def test_numeric_only_path_returns_none():
    assert extract_handle_from_url("https://www.facebook.com/100000123456") is None


def test_non_facebook_url_returns_none():
    assert extract_handle_from_url("https://www.twitter.com/johndoe") is None


def test_empty_string_returns_none():
    assert extract_handle_from_url("") is None


def test_none_input_returns_none():
    assert extract_handle_from_url(None) is None  # type: ignore[arg-type]


def test_story_php_returns_none():
    assert (
        extract_handle_from_url("https://www.facebook.com/story.php?story_fbid=12345&id=67890")
        is None
    )


def test_dotted_username_with_numbers():
    """Dotted usernames with numbers (common FB format) are valid vanity handles."""
    result = extract_handle_from_url("https://www.facebook.com/john.doe.58")
    assert result == "john.doe.58"
