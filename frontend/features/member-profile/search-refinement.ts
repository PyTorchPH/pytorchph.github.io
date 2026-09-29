// Narrowing search results locally while the member keeps typing, with the server's matching rule.
//
// The server matches every typed word as a prefix of some word in the record (any order), and each
// keyword must claim its own word: "science science" needs two "science" words, so "Bachelor of
// Science in Computer Engineering" does not match "computer science science". If an earlier answer
// was complete (fewer rows than the limit) and the new text only adds or extends words, every new
// match must already be in that answer, so it is filtered here with no request. A truncated answer
// might be missing the right row, so it is never narrowed; the server is asked again.
//
// Module map (caller-first):
//   narrowFromSnapshot   snapshot + new text → locally narrowed rows, or null (ask the server)
//   ├─ refines           does the new text only add or extend the old words?
//   └─ matchesKeywords   every keyword claims its own record word (bipartite matching)
//       └─ claim         Kuhn's augmenting path for one keyword
//   searchKeywords       text → lowercase, accent-free words (same split as the server)

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
  const owner: Array<number | null> = recordWords.map(() => null);
  return keywords.every((_, keyword) => claim(keyword, keywords, recordWords, owner, new Set()));
}

// Take a free word this keyword prefixes, or move that word's current keyword to another word.
function claim(keyword: number, keywords: string[], recordWords: string[], owner: Array<number | null>, visited: Set<number>): boolean {
  for (let word = 0; word < recordWords.length; word += 1) {
    if (visited.has(word) || !recordWords[word].startsWith(keywords[keyword])) continue;
    visited.add(word);
    const current = owner[word];
    if (current === null || claim(current, keywords, recordWords, owner, visited)) {
      owner[word] = keyword;
      return true;
    }
  }
  return false;
}

export function searchKeywords(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
