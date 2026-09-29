from __future__ import annotations

from pathlib import Path

from resume_builder.sources.social import load_scrape_config


def test_load_scrape_config_round_trip(tmp_path: Path):
    yaml_text = """
full_name: "Jane Doe"
enabled_vendors: [twitter, instagram]
handles:
  twitter: jdoe
cache_ttl_seconds: 600
per_vendor_limit: 10
"""
    p = tmp_path / "social.yaml"
    p.write_text(yaml_text, encoding="utf-8")
    cfg = load_scrape_config(str(p))
    assert cfg.full_name == "Jane Doe"
    assert cfg.enabled_vendors == ("twitter", "instagram")
    assert cfg.handles["twitter"] == "jdoe"
    assert cfg.cache_ttl_seconds == 600
