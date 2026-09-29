//! Keyword-to-word matching after the FTS5 prefilter. FTS5's `"science"* AND "science"*` is
//! satisfied by a single "Science", so a record like "Bachelor of Science in Computer Engineering"
//! would match "science computer science". Here every typed keyword must claim its own word in the
//! record (a bipartite matching): two "science" keywords need two "science" words.
//!
//! Module map (caller-first):
//!   rank_matches      keep candidates whose keywords all claim distinct words; best coverage first
//!   └─ match_quality  None if some keyword finds no free word; else the share of name words claimed
//!       ├─ claim      augmenting-path step (Kuhn's algorithm) for one keyword
//!       └─ words      lowercase, accent-folded words (the same split FTS5 unicode61 uses)
use super::keywords::keywords;

/// One searchable record: its name and the other indexed fields (acronym, city, aliases, …).
pub(crate) struct Searchable<'a> {
    pub(crate) name: &'a str,
    pub(crate) other_fields: Vec<&'a str>,
}

// Mental model: FTS5 already ranked the candidates by bm25; this drops the ones that only matched
// by reusing a word, then puts records whose name the query covers most completely first
// (a stable sort, so bm25 order breaks ties).
pub(crate) fn rank_matches<T>(
    candidates: Vec<T>,
    text: &str,
    limit: usize,
    searchable: impl Fn(&T) -> Searchable<'_>,
) -> Vec<T> {
    let wanted = keywords(text)
        .iter()
        .map(|word| fold(word))
        .collect::<Vec<_>>();
    let mut scored: Vec<(f32, T)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            match_quality(&searchable(&candidate), &wanted).map(|score| (score, candidate))
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored
        .into_iter()
        .take(limit)
        .map(|(_, candidate)| candidate)
        .collect()
}

/// Share of the name's words claimed by keywords (1.0 = the query covers the whole name).
pub(crate) fn match_quality(record: &Searchable<'_>, wanted: &[String]) -> Option<f32> {
    let name_words = words(record.name);
    let mut all_words = name_words.clone();
    for field in &record.other_fields {
        all_words.extend(words(field));
    }
    let mut owner: Vec<Option<usize>> = vec![None; all_words.len()];
    for keyword in 0..wanted.len() {
        let mut visited = vec![false; all_words.len()];
        if !claim(keyword, wanted, &all_words, &mut owner, &mut visited) {
            return None;
        }
    }
    let claimed_name_words = owner[..name_words.len()]
        .iter()
        .filter(|owner| owner.is_some())
        .count();
    Some(claimed_name_words as f32 / name_words.len().max(1) as f32)
}

// Kuhn's augmenting path: take a free word this keyword prefixes, or move its current owner to
// another word it prefixes.
fn claim(
    keyword: usize,
    wanted: &[String],
    record_words: &[String],
    owner: &mut [Option<usize>],
    visited: &mut [bool],
) -> bool {
    for word in 0..record_words.len() {
        if visited[word] || !record_words[word].starts_with(wanted[keyword].as_str()) {
            continue;
        }
        visited[word] = true;
        let free = match owner[word] {
            None => true,
            Some(other) => claim(other, wanted, record_words, owner, visited),
        };
        if free {
            owner[word] = Some(keyword);
            return true;
        }
    }
    false
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(fold)
        .collect()
}

/// Lowercase and fold the accents Philippine names use, as FTS5 remove_diacritics does.
fn fold(word: &str) -> String {
    word.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quality(name: &str, text: &str) -> Option<f32> {
        let wanted = keywords(text)
            .iter()
            .map(|word| fold(word))
            .collect::<Vec<_>>();
        match_quality(
            &Searchable {
                name,
                other_fields: vec![],
            },
            &wanted,
        )
    }

    #[test]
    fn a_repeated_keyword_needs_its_own_word() {
        let query = "Bachelor of Science in Compute Science";
        assert!(quality("Bachelor of Science in Computer Science", query).is_some());
        assert!(quality("Bachelor of Science in Computer Engineering", query).is_none());
    }

    #[test]
    fn keyword_order_does_not_matter() {
        assert_eq!(
            quality(
                "Bachelor of Science in Computer Science",
                "computer science science bachelor of in"
            ),
            Some(1.0)
        );
    }

    #[test]
    fn a_short_prefix_moves_to_a_free_word_when_a_longer_keyword_needs_its_word() {
        // "s" first takes "science"; "sci" then needs it, so "s" moves to "studies".
        assert!(quality("Science Studies", "s sci").is_some());
    }

    #[test]
    fn accents_fold_like_the_index() {
        assert!(quality("Dasmariñas City", "dasmarinas").is_some());
    }

    #[test]
    fn full_name_queries_rank_the_exact_record_first() {
        let names = vec![
            "Bachelor of Science in Computer Science Major in Data Science",
            "Bachelor of Science in Computer Science",
        ];
        let ranked = rank_matches(
            names,
            "bachelor of science in computer science",
            10,
            |name| Searchable {
                name,
                other_fields: vec![],
            },
        );
        assert_eq!(ranked[0], "Bachelor of Science in Computer Science");
    }
}
