"""Twitter / nitter vendor parses RSS into SocialPost / SocialMention shapes."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from resume_builder.sources.social.vendors.twitter import TwitterVendor

_RSS = """<?xml version="1.0"?>
<rss>
<channel>
<item>
<title><![CDATA[Test tweet]]></title>
<link>https://nitter.net/jab/status/12345#m</link>
<description><![CDATA[<p>Won the hackathon today!</p>]]></description>
<pubDate>Mon, 12 May 2025 10:00:00 GMT</pubDate>
<dc:creator>jab</dc:creator>
</item>
</channel>
</rss>"""

_SEARCH_RSS = """<?xml version="1.0"?>
<rss><channel>
<item>
<title><![CDATA[shoutout]]></title>
<link>https://nitter.net/friend/status/9999</link>
<description><![CDATA[Big congrats to Jane Doe]]></description>
<pubDate>Tue, 13 May 2025 12:00:00 GMT</pubDate>
<dc:creator>friend</dc:creator>
</item>
</channel></rss>"""


def _resp(body: str) -> MagicMock:
    r = MagicMock()
    r.text = body
    return r


def test_fetch_own_posts_parses_nitter_rss():
    vendor = TwitterVendor()
    with patch.object(vendor._client, "get", return_value=_resp(_RSS)):
        posts = vendor.fetch_own_posts("jab")
    assert len(posts) == 1
    assert posts[0].post_id == "12345"
    assert "hackathon" in posts[0].text.lower()
    assert posts[0].url.startswith("https://x.com/")


def test_search_mentions_filters_by_name():
    vendor = TwitterVendor()
    with patch.object(vendor._client, "get", return_value=_resp(_SEARCH_RSS)):
        mentions = vendor.search_mentions("Jane Doe")
    assert len(mentions) == 1
    assert mentions[0].author_name == "friend"


def test_empty_rss_returns_empty():
    vendor = TwitterVendor()
    with patch.object(vendor._client, "get", return_value=_resp("<rss/>")):
        assert vendor.fetch_own_posts("jab") == []
