// Turning the community's raw skill words into one normalized skill list with the officer's own AI.
// The AI reply is untrusted: only raw words that really exist are kept, each maps to one skill,
// and anything the AI dropped is reported instead of silently lost.
//
// Module map (caller-first):
//   compilePrompt       system + user prompt asking for {skills:[{name, category, aliases}]}
//   parseCompiledSkills reply text → validated skills + raw words left unmapped
//   ├─ extractJson      tolerate a ```json fence around the object
//   └─ cleanText        trimmed, single-spaced, length-capped text

export type RawSkill = { raw: string; members: number };
export type CompiledSkill = { name: string; category: string; aliases: string[] };
export type CompileResult = { skills: CompiledSkill[]; unmapped: string[] };

const MAX_NAME = 80;
export const MAX_RAW_WORDS = 1500;

export function compilePrompt(raw: RawSkill[]) {
  const words = raw.slice(0, MAX_RAW_WORDS).map((item) => item.raw);
  return {
    system: "You normalize skill names for a PyTorch and AI community. Answer with JSON only.",
    prompt: `Group these raw skill words (lowercased, from members' verified achievements) into normalized skills.
Rules:
- Merge tools and spellings into the capability they show (e.g. "beautifulsoup", "playwright", "selenium" -> "Web scraping and automation"; "pytorch", "torch" -> "PyTorch").
- Keep a well-known framework as its own skill when it is a skill people list on a resume (PyTorch, Docker, SQL).
- Give each skill a short category (e.g. "Machine learning", "Data", "Web", "Cloud and DevOps", "Soft skills").
- Every raw word must appear in exactly one skill's "aliases", spelled exactly as given.
Return {"skills": [{"name": string, "category": string, "aliases": string[]}]}.

Raw words:
${JSON.stringify(words)}`,
  };
}

export function parseCompiledSkills(reply: string, raw: RawSkill[]): CompileResult {
  const known = new Set(raw.map((item) => item.raw));
  const parsed = extractJson(reply) as { skills?: unknown };
  if (!Array.isArray(parsed?.skills)) throw new Error("The AI reply had no skill list. Try again.");
  const claimed = new Set<string>();
  const names = new Set<string>();
  const skills: CompiledSkill[] = [];
  for (const entry of parsed.skills as Array<Record<string, unknown>>) {
    const name = cleanText(entry?.name);
    if (!name || names.has(name.toLowerCase())) continue;
    const aliases = (Array.isArray(entry.aliases) ? entry.aliases : [])
      .map((alias) => cleanText(alias).toLowerCase())
      .filter((alias) => known.has(alias) && !claimed.has(alias));
    if (!aliases.length) continue;
    aliases.forEach((alias) => claimed.add(alias));
    names.add(name.toLowerCase());
    skills.push({ name, category: cleanText(entry.category) || "Other", aliases: [...new Set(aliases)] });
  }
  return { skills, unmapped: [...known].filter((word) => !claimed.has(word)) };
}

function extractJson(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The AI reply was not valid JSON. Try again.");
  }
}

const cleanText = (value: unknown) => typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_NAME) : "";
