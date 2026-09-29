// Narrowing search results locally while the member keeps typing.
//
// The server matches every typed word as a prefix of some word in the record (any order). If an
// earlier answer was complete (fewer rows than the limit) and the new text only adds or extends
// words, every new match must already be in that answer, so it can be filtered here with no
// request. A truncated answer (limit reached) might be missing the right row, so it is never
// narrowed; the server is asked again.
//
// Module map (caller-first):
//   narrowFromSnapshot   snapshot + new text → locally narrowed rows, or null (ask the server)
//   ├─ refines           does the new text only add or extend the old words?
//   └─ matchesKeywords   every keyword prefixes some word of the record (the server's rule)
//   searchKeywords       text → lowercase words (same split as the server)

export type SearchSnapshot<T> = { query: string; items: T[]; complete: boolean };

export function narrowFromSnapshot<T>(snapshot: SearchSnapshot<T> | null, text: string, wordsOf: (item: T) => string): T[] | null {
  if (!snapshot || !snapshot.complete || !refines(snapshot.query, text)) return null;
  const keywords = searchKeywords(text);
  return snapshot.items.filter((item) => matchesKeywords(searchKeywords(wordsOf(item)), keywords));
}

export function refines(previous: string, next: string): boolean {
  const before = searchKeywords(previous);
  const after = searchKeywords(next);
  if (before.length === 0 || after.length < before.length) return false;
  // Each earlier word must still be there, possibly longer ("colle" → "college").
  return before.every((word, index) => after[index]?.startsWith(word));
}

export function matchesKeywords(recordWords: string[], keywords: string[]): boolean {
  return keywords.every((keyword) => recordWords.some((word) => word.startsWith(keyword)));
}

export function searchKeywords(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
