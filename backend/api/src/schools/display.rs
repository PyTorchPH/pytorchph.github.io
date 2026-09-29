//! How a school appears in the dropdown: the full name with its campus, then a short detail line
//! (acronym · city · level) instead of region codes.
//!
//! Module map (caller-first):
//!   school_label     "Sacred Heart College - Lucena" (campus added only when the name lacks it)
//!   └─ campus_name   "Lucena City" → "Lucena"
//!   school_detail    "SHC · Lucena City, Quezon · College"
use super::School;

pub(crate) fn school_label(school: &School) -> String {
    let campus = campus_name(&school.city);
    if campus.is_empty() || names_campus(&school.name, campus) {
        return school.name.clone();
    }
    format!("{} - {campus}", school.name)
}

pub(crate) fn school_detail(school: &School) -> String {
    let place = [school.city.as_str(), school.province.as_str()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    [
        school.acronym.as_str(),
        place.as_str(),
        level_label(&school.level),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ")
}

fn campus_name(city: &str) -> &str {
    let city = city.trim();
    city.strip_prefix("City of ")
        .or_else(|| city.strip_suffix(" City"))
        .unwrap_or(city)
}

#[inline]
fn names_campus(name: &str, campus: &str) -> bool {
    name.to_lowercase().contains(&campus.to_lowercase())
}

#[inline]
fn level_label(level: &str) -> &'static str {
    match level {
        "basic" => "Basic education",
        "higher" => "College / university",
        "technical" => "Technical-vocational",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn school(name: &str, acronym: &str, city: &str) -> School {
        School {
            code: "x".into(),
            name: name.into(),
            acronym: acronym.into(),
            level: "higher".into(),
            sector: "private".into(),
            city: city.into(),
            province: "Quezon".into(),
        }
    }

    #[test]
    fn adds_the_campus_only_when_the_name_lacks_it() {
        assert_eq!(
            school_label(&school("Sacred Heart College", "SHC", "Lucena City")),
            "Sacred Heart College - Lucena"
        );
        assert_eq!(
            school_label(&school("STI College - Lucena", "STI", "Lucena City")),
            "STI College - Lucena"
        );
    }

    #[test]
    fn detail_line_shows_acronym_place_and_level() {
        assert_eq!(
            school_detail(&school("Sacred Heart College", "SHC", "Lucena City")),
            "SHC · Lucena City, Quezon · College / university"
        );
    }
}
