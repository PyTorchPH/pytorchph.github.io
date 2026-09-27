from __future__ import annotations

from resume_builder.extraction.skeleton import build_skeleton, template_fingerprint

_HTML_A = """
<html><body>
  <header id="top" class="site-nav">Logo Home About</header>
  <main role="main"><article class="post">Real project content here.</article></main>
  <footer>copyright</footer>
</body></html>
"""

# same shape (tags + id/class), different text → identical fingerprint
_HTML_A2 = _HTML_A.replace("Real project content here.", "Totally different words.")
# different shape → different fingerprint
_HTML_B = "<html><body><div class='x'><p>hi</p></div></body></html>"


def test_skeleton_keeps_structure_drops_long_text():
    sk = build_skeleton(_HTML_A)
    assert "header#top.site-nav" in sk
    assert "article.post" in sk
    assert "[role=main]" in sk
    # text is truncated/stripped, not dumped wholesale
    assert "Real project content here." not in sk or "«Real project content" in sk


def test_fingerprint_ignores_text_but_tracks_shape():
    assert template_fingerprint(_HTML_A) == template_fingerprint(_HTML_A2)
    assert template_fingerprint(_HTML_A) != template_fingerprint(_HTML_B)


def test_skeleton_handles_garbage():
    assert build_skeleton("") == ""
    assert template_fingerprint("") == "empty"


def test_fingerprint_ignores_volatile_state_and_content_length():
    short = """
    <html><body class="single-post postid-1234 active"><main id="content">
      <article class="article"><p>Short.</p></article></main></body></html>
    """
    long = """
    <html><body class="single-post postid-9876 current"><main id="content">
      <article class="article"><p>Different.</p><p>More content.</p><p>More.</p></article>
    </main></body></html>
    """
    assert template_fingerprint(short) == template_fingerprint(long)
