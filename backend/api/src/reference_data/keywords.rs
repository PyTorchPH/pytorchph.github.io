//! Member-typed text → an FTS5 query where every word is its own prefix keyword.
//!
//! "college lucena sti" becomes `"college"* AND "lucena"* AND "sti"*`: each word must prefix-match
//! some word of the record, in any order and any indexed column. Matching is case- and
//! accent-insensitive (FTS5 unicode61 with remove_diacritics).
//!
//! Module map (caller-first):
//!   fts_query   text → quoted prefix terms joined by AND (None when there are no words)
//!   └─ keywords lowercase alphanumeric words, capped in count and length

const MAX_KEYWORDS: usize = 8;
const MAX_KEYWORD_LENGTH: usize = 40;

/// Each keyword becomes a quoted prefix term, so no member input is read as FTS5 syntax.
pub(crate) fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = keywords(text)
        .iter()
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

pub(crate) fn keywords(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.chars().take(MAX_KEYWORD_LENGTH).collect())
        .take(MAX_KEYWORDS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::fts_query;

    #[test]
    fn every_word_becomes_a_quoted_prefix_keyword() {
        assert_eq!(
            fts_query("College  LUCENA sti").unwrap(),
            r#""college"* AND "lucena"* AND "sti"*"#
        );
    }

    #[test]
    fn punctuation_and_fts_syntax_are_treated_as_separators() {
        assert_eq!(
            fts_query("STI-Calamba \"OR\" (x)*").unwrap(),
            r#""sti"* AND "calamba"* AND "or"* AND "x"*"#
        );
        assert_eq!(fts_query(" - * "), None);
    }
}
