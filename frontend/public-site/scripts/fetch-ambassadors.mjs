// Syncs the PyTorch Foundation Ambassadors located in the Philippines from the official directory
// (the same JSON that renders https://pytorch.org/programs/ambassadors/) into
// _data/ambassadors_directory.json, and copies their official portraits into
// assets/images/ambassadors/. The directory decides who is listed: nobody is added or kept by hand.
//
// Nothing on disk changes until the directory and every portrait have been downloaded and checked.
// A failed fetch, a malformed directory, a bad portrait, or a failed write keeps the committed
// snapshot as it is. The portrait directory belongs to this script: it is replaced as a whole.
//
// An empty result never replaces a snapshot that lists people unless AMBASSADORS_ALLOW_EMPTY=1 is
// set: a changed country field upstream must not read as "no ambassadors in the Philippines".
//
// Flow:
//   main            fetch directory → validate → stage people + portraits in memory → commit
//   ├─ fetchLimited fetch one allowlisted URL, no redirects, with a byte limit
//   ├─ portrait     validate and download one official portrait
//   └─ commit       write a complete snapshot into a private temporary directory, swap it in,
//                   and restore the previous portraits if the swap fails
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_HOST = "raw.githubusercontent.com";
const SOURCE_PATH = "/pytorch-fdn/ambassador-program/";
const DIRECTORY_URL = `https://${SOURCE_HOST}${SOURCE_PATH}main/doc/ambassadors.json`;
const COUNTRY = "Philippines";
const MIN_DIRECTORY_ENTRIES = 10; // a healthy directory lists dozens of ambassadors
const MAX_DIRECTORY_BYTES = 5_000_000;
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

// Only the Foundation's repository on raw.githubusercontent.com, never a redirect target.
function officialUrl(value) {
  const url = new URL(text(value));
  if (url.protocol !== "https:" || url.hostname !== SOURCE_HOST || !url.pathname.startsWith(SOURCE_PATH) || url.username || url.password) {
    throw new Error(`not an official directory URL: ${url.href}`);
  }
  return url;
}

async function fetchLimited(value, limit) {
  const response = await fetch(officialUrl(value), { headers: { "User-Agent": "pytorch.ph site build" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${value}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`response over ${limit} bytes for ${value}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function portrait(person, id) {
  if (person.photo_pending || !text(person.avatar)) return null;
  const bytes = await fetchLimited(person.avatar, MAX_PHOTO_BYTES);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) throw new Error(`portrait for ${id} is not a JPEG or PNG`);
  return { name: `${id}.${jpeg ? "jpg" : "png"}`, bytes };
}

async function main() {
  const directory = JSON.parse((await fetchLimited(DIRECTORY_URL, MAX_DIRECTORY_BYTES)).toString("utf8"));
  if (!Array.isArray(directory)) throw new Error("directory is not a list");
  const valid = directory.filter(person => person && typeof person === "object" && text(person.name) && text(person.country));
  // A truncated or reshaped directory must not be mistaken for "no ambassadors in the Philippines".
  if (valid.length < MIN_DIRECTORY_ENTRIES || valid.length < directory.length * 0.9) {
    throw new Error(`directory looks malformed: ${valid.length} usable of ${directory.length} entries`);
  }

  // Stage everything in memory first.
  const people = [];
  const portraits = [];
  const ids = new Set();
  for (const person of valid.filter(candidate => text(candidate.country) === COUNTRY)) {
    const id = slug(person.id || person.name);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`unusable or duplicate id for ${text(person.name)}`);
    ids.add(id);
    const photo = await portrait(person, id);
    if (photo) portraits.push(photo);
    people.push({
      id,
      name: text(person.name),
      location: text(person.location) || COUNTRY,
      region: text(person.ambassador_region),
      bio: text(person.bio).split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean),
      photo: photo ? `/assets/images/ambassadors/${photo.name}` : "",
      github: profileUrl(person.github, "github.com"),
      linkedin: profileUrl(person.linkedin, "linkedin.com"),
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "en"));

  let previous = [];
  try { previous = JSON.parse(readFileSync(dataFile, "utf8")).people ?? []; } catch { /* no snapshot yet */ }
  if (!people.length && previous.length && process.env.AMBASSADORS_ALLOW_EMPTY !== "1") {
    throw new Error(`directory lists nobody in ${COUNTRY} but the snapshot lists ${previous.length}; set AMBASSADORS_ALLOW_EMPTY=1 to accept`);
  }
  const checked = new Date().toISOString().slice(0, 10); // every successful run is a fresh check
  commit(portraits, `${JSON.stringify({ source: DIRECTORY_URL, checked, people }, null, 2)}\n`);
  console.log(JSON.stringify({ event: "site.ambassadors.written", outcome: "success", people: people.length }));
}

// The complete new snapshot is written into a directory only this run knows (mkdtemp creates it
// exclusively), then swapped in with renames on the same filesystem.
function commit(portraits, json) {
  const staging = mkdtempSync(resolve(root, ".ambassadors-"));
  const stagedPhotos = resolve(staging, "photos");
  const stagedData = resolve(staging, "directory.json");
  const previousPhotos = resolve(staging, "previous-photos");
  let movedPrevious = false;
  let installedPhotos = false;
  try {
    mkdirSync(stagedPhotos);
    for (const photo of portraits) writeFileSync(resolve(stagedPhotos, photo.name), photo.bytes, { flag: "wx" });
    writeFileSync(stagedData, json, { flag: "wx" });
    if (existsSync(photoDirectory)) { renameSync(photoDirectory, previousPhotos); movedPrevious = true; }
    renameSync(stagedPhotos, photoDirectory);
    installedPhotos = true;
    renameSync(stagedData, dataFile);
  } catch (error) {
    // Put the previous portraits back so the old data file still matches what is on disk.
    if (installedPhotos) rmSync(photoDirectory, { recursive: true, force: true });
    if (movedPrevious) renameSync(previousPhotos, photoDirectory);
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.warn(JSON.stringify({ event: "site.ambassadors.fetch_failed", outcome: "kept_snapshot", reason: error instanceof Error ? error.message : String(error) }));
}
