"""Tests for brand_icons module."""
from __future__ import annotations

from resume_builder.renderers.brand_icons import badge_png_path, declutter, drawing, html, svg


def test_svg_github_contains_svg_tag():
    result = svg("github")
    assert "<svg" in result
    assert "<path" in result
    assert "#181717" in result


def test_svg_linkedin_contains_color():
    result = svg("linkedin")
    assert "<svg" in result
    assert "#0A66C2" in result


def test_svg_unknown_returns_empty():
    assert svg("nope") == ""


def test_svg_size_is_applied():
    result = svg("github", size=20)
    assert 'width="20"' in result
    assert 'height="20"' in result


def test_html_prefers_svg_asset(monkeypatch, tmp_path):
    asset = tmp_path / "github-icon.svg"
    asset.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path d="M0 0h24v24H0z"/></svg>',
        encoding="utf-8",
    )
    monkeypatch.setenv("RESUME_ASSETS_DIR", str(tmp_path))
    result = html("github", size=16)
    assert "<img" in result
    assert "data:image/svg+xml;base64," in result
    assert 'width="16"' in result
    assert 'height="16"' in result


def test_badge_png_path_prefers_raster_asset(monkeypatch, tmp_path):
    from PIL import Image

    asset = tmp_path / "fb-icon.png"
    Image.new("RGBA", (64, 32), (24, 119, 242, 255)).save(asset)
    monkeypatch.setenv("RESUME_ASSETS_DIR", str(tmp_path))
    result = badge_png_path("facebook", px=18)
    assert result is not None
    assert result.lower().endswith(".png")


def test_drawing_github_returns_drawing():
    d = drawing("github")
    assert d is not None
    assert hasattr(d, "width")
    assert hasattr(d, "height")


def test_drawing_linkedin_returns_drawing():
    d = drawing("linkedin")
    assert d is not None
    assert hasattr(d, "width")


def test_drawing_website_returns_drawing():
    d = drawing("website")
    assert d is not None


def test_drawing_unknown_returns_none():
    assert drawing("unknown") is None


def test_drawing_size_matches():
    d = drawing("github", size=12)
    assert d is not None
    assert d.width == 12
    assert d.height == 12


def test_declutter_github_full_url():
    provider, handle = declutter("https://github.com/sample-user")
    assert provider == "github"
    assert handle == "sample-user"


def test_declutter_github_bare_handle():
    provider, handle = declutter("drew", "github")
    assert provider == "github"
    assert handle == "drew"


def test_declutter_github_url_with_www():
    provider, handle = declutter("https://www.github.com/myuser")
    assert provider == "github"
    assert handle == "myuser"


def test_declutter_linkedin():
    provider, handle = declutter("https://www.linkedin.com/in/sample-user")
    assert provider == "linkedin"
    assert handle == "sample-user"


def test_declutter_linkedin_bare_handle():
    provider, handle = declutter("sample-user", "linkedin")
    assert provider == "linkedin"
    assert handle == "sample-user"


def test_declutter_facebook_profile():
    provider, handle = declutter("https://www.facebook.com/johndoe")
    assert provider == "facebook"
    assert handle == "johndoe"


def test_declutter_facebook_post_returns_none_handle():
    # Facebook post URLs have posts/ or long numeric IDs → handle is None
    provider, handle = declutter("https://www.facebook.com/permalink/12345678")
    assert provider == "facebook"
    assert handle is None


def test_declutter_facebook_posts_path_returns_none_handle():
    provider, handle = declutter("https://www.facebook.com/johndoe/posts/9876543210")
    assert provider == "facebook"
    assert handle is None


def test_declutter_facebook_hint():
    provider, handle = declutter("https://www.facebook.com/mypage", "facebook")
    assert provider == "facebook"


def test_declutter_website():
    provider, handle = declutter("https://example.com/portfolio")
    assert provider == "website"
    assert "example.com" in handle
    assert "https://" not in handle


def test_declutter_website_strips_scheme():
    _, handle = declutter("https://mysite.io/projects")
    assert handle is not None
    assert not handle.startswith("https://")
    assert not handle.startswith("http://")


def test_declutter_none_url():
    provider, handle = declutter(None)
    assert provider is None
    assert handle is None


def test_declutter_empty_string():
    provider, handle = declutter("")
    assert provider is None
    assert handle is None


# ---------------------------------------------------------------------------
# badge_png_path tests
# ---------------------------------------------------------------------------

def test_badge_png_path_github_returns_existing_nonempty_png():
    import os
    result = badge_png_path("github")
    assert result is not None, "badge_png_path('github') should return a path, not None"
    assert os.path.exists(result), f"Badge file does not exist: {result}"
    assert os.path.getsize(result) > 0, "Badge file is empty"
    assert result.lower().endswith(".png"), "Badge file should be a PNG"


def test_badge_png_path_unknown_provider_returns_none():
    assert badge_png_path("unknown_provider_xyz") is None


def test_badge_png_path_is_idempotent():
    """Calling twice returns the same path and the file still exists."""
    import os
    first = badge_png_path("linkedin")
    second = badge_png_path("linkedin")
    assert first == second
    if first is not None:
        assert os.path.exists(first)
