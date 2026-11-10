// Syncs the PyTorch Foundation Ambassadors located in the Philippines from the official directory
// (the same JSON that renders https://pytorch.org/programs/ambassadors/) into
// _data/ambassadors_directory.json, and copies their official portraits into
// assets/images/ambassadors/. The directory decides who is listed: nobody is added or kept by hand.
//
// A failed fetch keeps the committed snapshot, so the site still builds with the last known list.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIRECTORY_URL = "https://raw.githubusercontent.com/pytorch-fdn/ambassador-program/main/doc/ambassadors.json";
const PHOTO_PREFIX = "https://raw.githubusercontent.com/pytorch-fdn/ambassador-program/";
const COUNTRY = "Philippines";
const MAX_PHOTO_BYTES = 2_000_000;
const root = resolve(import.meta.dirname, "..");
const dataFile = resolve(root, "_data/ambassadors_directory.json");
const photoDirectory = resolve(root, "assets/images/ambassadors");

const text = value => (typeof value === "string" ? value.trim() : "");
const slug = value => text(value).normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-");
const profileUrl = (value, host) => {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && (url.hostname === host || url.hostname === `www.${host}`) ? url.href : "";
  } catch { return ""; }
};
const fetchOptions = () => ({ headers: { "User-Agent": "pytorch.ph site build" }, signal: AbortSignal.timeout(20_000) });

async function portrait(person, id) {
  const source = text(person.avatar);
  if (person.photo_pending || !source.startsWith(PHOTO_PREFIX)) return "";
  const response = await fetch(source, fetchOptions());
  if (!response.ok) throw new Error(`photo HTTP ${response.status} for ${id}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  if ((!jpeg && !png) || bytes.length > MAX_PHOTO_BYTES) throw new Error(`unexpected photo for ${id}`);
  const name = `${id}.${jpeg ? "jpg" : "png"}`;
  writeFileSync(resolve(photoDirectory, name), bytes);
  return `/assets/images/ambassadors/${name}`;
}

try {
  const response = await fetch(DIRECTORY_URL, fetchOptions());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const directory = await response.json();
  if (!Array.isArray(directory)) throw new Error("directory is not a list");
  const local = directory.filter(person => text(person?.country) === COUNTRY && text(person?.name));
  mkdirSync(photoDirectory, { recursive: true });
  const people = [];
  for (const person of local) {
    const id = slug(person.id || person.name);
    if (!id) continue;
    people.push({
      id,
      name: text(person.name),
      location: text(person.location) || COUNTRY,
      region: text(person.ambassador_region),
      bio: text(person.bio).split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean),
      photo: await portrait(person, id),
      github: profileUrl(person.github, "github.com"),
      linkedin: profileUrl(person.linkedin, "linkedin.com"),
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "en"));
  // Portraits of people who left the directory are removed with them.
  const kept = new Set(people.map(person => person.photo.split("/").pop()).filter(Boolean));
  for (const file of readdirSync(photoDirectory)) if (!kept.has(file)) rmSync(resolve(photoDirectory, file));
  // Every successful run is a fresh check against the directory.
  const checked = new Date().toISOString().slice(0, 10);
  writeFileSync(dataFile, `${JSON.stringify({ source: DIRECTORY_URL, checked, people }, null, 2)}\n`);
  console.log(JSON.stringify({ event: "site.ambassadors.written", outcome: "success", people: people.length }));
} catch (error) {
  console.warn(JSON.stringify({ event: "site.ambassadors.fetch_failed", outcome: "kept_snapshot", reason: error instanceof Error ? error.message : String(error) }));
}
