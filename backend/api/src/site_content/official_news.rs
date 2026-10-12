//! Bounded official PyTorch RSS retrieval with a short cache and stale-on-error fallback.
use crate::AppState;
use chrono::{DateTime, Duration, Utc};
use quick_xml::de::from_str;
use serde::Deserialize;
use serde_json::{Value, json};

const FEED_URL: &str = "https://pytorch.org/blog/feed/";
const MAX_FEED_BYTES: usize = 512 * 1024;
const MAX_ITEMS: usize = 6;
const MAX_TEXT_CHARS: usize = 600;

#[derive(Deserialize)]
struct Rss {
    channel: Channel,
}

#[derive(Deserialize)]
struct Channel {
    #[serde(default, rename = "item")]
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(default, rename = "pubDate")]
    published_at: String,
    #[serde(default)]
    description: String,
    #[serde(default, rename = "category")]
    categories: Vec<String>,
}

pub(super) async fn load(state: &AppState) -> Value {
    let now = Utc::now();
    let cached: Option<(String, String, String)> = sqlx::query_as(
        "SELECT items_json,fetched_at,expires_at FROM official_news_cache WHERE source='pytorch_blog'",
    )
    .fetch_optional(&state.db)
    .await
    .unwrap_or_else(|error| {
        tracing::warn!(component="site_content", operation="official_news_cache_read", error=%error, "site_content.official_news_cache_read_failed");
        None
    });
    if let Some((body, fetched_at, expires_at)) = cached.as_ref()
        && expires_at > &now.to_rfc3339()
        && let Ok(items) = serde_json::from_str::<Value>(body)
    {
        return bundle(items, "cache", Some(fetched_at));
    }
    match fetch_items(state).await {
        Ok(items) => {
            let body = Value::Array(items);
            let fetched_at = now.to_rfc3339();
            let expires_at = (now + Duration::minutes(15)).to_rfc3339();
            if let Err(error) = sqlx::query("INSERT INTO official_news_cache(source,items_json,fetched_at,expires_at) VALUES ('pytorch_blog',?,?,?) ON CONFLICT(source) DO UPDATE SET items_json=excluded.items_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at")
                .bind(body.to_string()).bind(&fetched_at).bind(expires_at).execute(&state.db).await
            {
                tracing::warn!(component="site_content", operation="official_news_cache_write", error=%error, "site_content.official_news_cache_write_failed");
            }
            tracing::info!(
                component = "site_content",
                operation = "official_news_fetch",
                items = body.as_array().map_or(0, Vec::len),
                "site_content.official_news_refreshed"
            );
            bundle(body, "live", Some(&fetched_at))
        }
        Err(reason) => {
            tracing::warn!(
                component = "site_content",
                operation = "official_news_fetch",
                reason,
                "site_content.official_news_fetch_failed"
            );
            cached
                .and_then(|(body, fetched_at, _)| {
                    serde_json::from_str(&body)
                        .ok()
                        .map(|items| bundle(items, "stale", Some(&fetched_at)))
                })
                .unwrap_or_else(|| bundle(Value::Array(Vec::new()), "fallback", None))
        }
    }
}

async fn fetch_items(state: &AppState) -> Result<Vec<Value>, String> {
    let response = state
        .http
        .get(FEED_URL)
        .header("User-Agent", "pytorch.ph public-content/2")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_FEED_BYTES as u64)
    {
        return Err("feed exceeds 512 KiB".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_FEED_BYTES {
        return Err("feed exceeds 512 KiB".into());
    }
    parse(std::str::from_utf8(&bytes).map_err(|_| "feed is not UTF-8")?)
}

fn parse(xml: &str) -> Result<Vec<Value>, String> {
    let rss: Rss = from_str(xml).map_err(|error| error.to_string())?;
    Ok(rss
        .channel
        .items
        .into_iter()
        .filter_map(item_value)
        .take(MAX_ITEMS)
        .collect())
}

fn item_value(item: Item) -> Option<Value> {
    let url = reqwest::Url::parse(item.link.trim()).ok()?;
    let domain = url.domain()?;
    if url.scheme() != "https" || (domain != "pytorch.org" && !domain.ends_with(".pytorch.org")) {
        return None;
    }
    let title = plain_text(&item.title);
    if title.is_empty() {
        return None;
    }
    let published_at = DateTime::parse_from_rfc2822(&item.published_at)
        .ok()?
        .to_rfc3339();
    let categories = item
        .categories
        .into_iter()
        .map(|value| plain_text(&value))
        .filter(|value| !value.is_empty() && value != "Blog")
        .take(5)
        .collect::<Vec<_>>();
    Some(
        json!({"title":title,"url":url.as_str(),"publishedAt":published_at,"excerpt":plain_text(&item.description),"categories":categories}),
    )
}

fn plain_text(input: &str) -> String {
    let mut output = String::new();
    let mut inside_tag = false;
    for character in input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .chars()
    {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag && output.chars().count() < MAX_TEXT_CHARS => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn bundle(items: Value, status: &str, fetched_at: Option<&str>) -> Value {
    json!({"items":items,"source":{"name":"Official PyTorch Blog","feedUrl":FEED_URL,"status":status,"fetchedAt":fetched_at}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_bounded_official_plain_text_items() {
        let xml = r#"<rss><channel><item><title><![CDATA[Safe &amp; useful]]></title><link>https://pytorch.org/blog/safe/</link><pubDate>Thu, 08 Oct 2026 18:13:46 +0000</pubDate><description><![CDATA[<b>News</b> without scripts]]></description><category>Blog</category><category>Community</category></item><item><title>Wrong host</title><link>https://example.org/post</link><pubDate>Thu, 08 Oct 2026 18:13:46 +0000</pubDate></item></channel></rss>"#;
        let items = parse(xml).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["title"], "Safe & useful");
        assert_eq!(items[0]["excerpt"], "News without scripts");
        assert_eq!(items[0]["categories"], json!(["Community"]));
    }
}
