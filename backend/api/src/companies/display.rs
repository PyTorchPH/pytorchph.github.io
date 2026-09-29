//! How a company appears in the dropdown: its name, then "BDO · Makati City · Banking"
//! (up to two short aliases, city, industry), and whether it is verified.
//!
//! Module map (caller-first):
//!   company_detail   short aliases · city · industry
//!   └─ short_aliases acronyms and tickers first (the forms people type), at most two
//!   is_verified      from the directory or the curated list, not added by a member
use super::Company;

const MAX_SHOWN_ALIASES: usize = 2;
const SHORT_ALIAS: usize = 12;

pub(crate) fn company_detail(company: &Company) -> String {
    let aliases = short_aliases(&company.aliases);
    [
        aliases.as_str(),
        company.city.as_str(),
        company.industry.as_str(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ")
}

fn short_aliases(aliases: &str) -> String {
    aliases
        .split('|')
        .filter(|alias| !alias.is_empty() && alias.chars().count() <= SHORT_ALIAS)
        .take(MAX_SHOWN_ALIASES)
        .collect::<Vec<_>>()
        .join(", ")
}

#[inline]
pub(crate) fn is_verified(company: &Company) -> bool {
    company.origin != "member"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detail_shows_short_aliases_city_and_industry() {
        let company = Company {
            id: "wd-1".into(),
            name: "BDO Unibank".into(),
            aliases: "BDO|BDOUY|Banco de Oro Universal Bank".into(),
            city: "Makati City".into(),
            industry: "banking".into(),
            origin: "directory".into(),
        };
        assert_eq!(
            company_detail(&company),
            "BDO, BDOUY · Makati City · banking"
        );
        assert!(is_verified(&company));
    }
}
