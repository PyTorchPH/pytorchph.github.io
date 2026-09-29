// Writes _data/pytorch_news.json from the official pytorch.org blog feed for the News section.
// A failed fetch writes an empty list so the site still builds and links to pytorch.org/blog instead.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const FEED_URL = "https://pytorch.org/blog/feed/";
const MAX_ITEMS = 6;
const EXCERPT_WORDS = 32;
const output = resolve(import.meta.dirname, "../_data/pytorch_news.json");

const entities = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = text => text
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
const unwrap = text => decode(text.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const field = (item, tag) => unwrap(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
const excerpt = text => {
  const words = text.split(" ");
  return words.length > EXCERPT_WORDS ? `${words.slice(0, EXCERPT_WORDS).join(" ")}…` : text;
};

function parse(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_ITEMS).map(([, item]) => ({
    title: field(item, "title"),
    url: field(item, "link"),
    date: new Date(field(item, "pubDate")).toISOString(),
    categories: [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(([, value]) => unwrap(value)).filter(name => name !== "Blog"),
    excerpt: excerpt(field(item, "description").replace(/The post .* appeared first on .*$/, "").trim()),
  })).filter(item => item.title && item.url.startsWith("https://pytorch.org/"));
}

let items = [];
try {
  const response = await fetch(FEED_URL, { headers: { "User-Agent": "pytorch.ph site build" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  items = parse(await response.text());
} catch (error) {
  console.warn(JSON.stringify({ event: "site.pytorch_news.fetch_failed", outcome: "fallback", reason: error instanceof Error ? error.message : String(error) }));
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(items, null, 2)}\n`);
console.log(JSON.stringify({ event: "site.pytorch_news.written", outcome: "success", items: items.length }));
