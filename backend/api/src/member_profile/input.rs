//! A submitted profile, parsed into typed choices and checked against the catalogs.
//!
//! Module map (caller-first):
//!   parse_profile              whole submission → Profile (or the first problem found)
//!   ├─ parse_gender            gender plus the self-description it may require
//!   ├─ parse_age               exact age 1–120 (every age may join), or "prefer not to say"
//!   ├─ parse_status            student / professional / both / seeking / other
//!   ├─ parse_interests         up to MAX_INTERESTS known interest codes
//!   ├─ parse_education         required while studying; the level sets grade/year range and program
//!   │   ├─ level_rule          elementary 1–6 · junior high 7–10 · senior high 11–12 · college 1–8
//!   │   └─ parse_program_choice a catalog program/strand code, or an unlisted program's name
//!   │   └─ parse_school_choice  a CHED school code, or an unlisted school's name
//!   └─ parse_employment        required while working
//!       └─ parse_company_choice an existing company id, or a new company name
use super::catalog::{self, UNLISTED_SCHOOL};
use crate::{ApiResult, bad, programs::UNLISTED_PROGRAM};
use serde_json::Value;

const MAX_INTERESTS: usize = 10;
const MAX_TEXT: usize = 120;
const MAX_GENDER_DESCRIPTION: usize = 60;
const MAX_SCHOOL_NAME: usize = 160;
const MAX_SCHOOL_CODE: usize = 40;
// Every age may join; the bounds only catch typos.
const MIN_AGE: i64 = 1;
const MAX_AGE: i64 = 120;

pub(crate) struct Profile {
    pub(crate) gender: String,
    pub(crate) gender_description: Option<String>,
    /// None when the member prefers not to say.
    pub(crate) age: Option<i64>,
    pub(crate) region_code: String,
    pub(crate) status: Status,
    pub(crate) channel: String,
    pub(crate) interests: Vec<String>,
    pub(crate) analytics_consent: bool,
    pub(crate) education: Option<Education>,
    pub(crate) employment: Option<Employment>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Status {
    Student,
    Professional,
    StudentProfessional,
    Seeking,
    Other,
}

impl Status {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Status::Student => "student",
            Status::Professional => "professional",
            Status::StudentProfessional => "student_professional",
            Status::Seeking => "seeking",
            Status::Other => "other",
        }
    }

    #[inline]
    pub(crate) fn is_studying(self) -> bool {
        matches!(self, Status::Student | Status::StudentProfessional)
    }

    #[inline]
    pub(crate) fn is_working(self) -> bool {
        matches!(self, Status::Professional | Status::StudentProfessional)
    }
}

pub(crate) struct Education {
    pub(crate) school: SchoolChoice,
    pub(crate) level: String,
    /// Strand or program; None for elementary, which has none.
    pub(crate) program: Option<ProgramChoice>,
    pub(crate) year_level: i64,
}

/// What each school level asks for: its grade/year range and whether it has a program.
struct LevelRule {
    years: std::ops::RangeInclusive<i64>,
    has_program: bool,
    year_message: &'static str,
}

fn level_rule(level: &str) -> LevelRule {
    match level {
        "elementary" => LevelRule {
            years: 1..=6,
            has_program: false,
            year_message: "Choose a grade from 1 to 6",
        },
        "junior_high" => LevelRule {
            years: 7..=10,
            has_program: true,
            year_message: "Choose a grade from 7 to 10",
        },
        "senior_high" => LevelRule {
            years: 11..=12,
            has_program: true,
            year_message: "Choose grade 11 or 12",
        },
        _ => LevelRule {
            years: 1..=8,
            has_program: true,
            year_message: "Choose a year level from 1 to 8",
        },
    }
}

/// A catalog program or strand, or a program the catalog lacks (kept apart for analytics).
pub(crate) enum ProgramChoice {
    Listed(String),
    Unlisted(String),
}

pub(crate) enum SchoolChoice {
    Listed(String),
    Unlisted(String),
}

pub(crate) struct Employment {
    pub(crate) company: CompanyChoice,
    pub(crate) industry: String,
    pub(crate) job_role: String,
    pub(crate) experience_range: String,
}

pub(crate) enum CompanyChoice {
    Existing(String),
    New(String),
}

// Mental model: required answers always have a value (with "prefer not to say" where it
// matters); study and work details are required only when the chosen status implies them.
pub(crate) fn parse_profile(input: &Value) -> ApiResult<Profile> {
    let (gender, gender_description) = parse_gender(input)?;
    let status = parse_status(input)?;
    Ok(Profile {
        gender,
        gender_description,
        age: parse_age(input)?,
        region_code: known_option(input, "regionCode", "regions", "Choose a region")?,
        status,
        channel: known_option(
            input,
            "channel",
            "channels",
            "Choose how you heard about us",
        )?,
        interests: parse_interests(input)?,
        analytics_consent: input
            .get("analyticsConsent")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        education: if status.is_studying() {
            Some(parse_education(input.get("school"))?)
        } else {
            None
        },
        employment: if status.is_working() {
            Some(parse_employment(input.get("employment"))?)
        } else {
            None
        },
    })
}

fn parse_gender(input: &Value) -> ApiResult<(String, Option<String>)> {
    let gender = known_option(input, "gender", "genders", "Choose a gender option")?;
    if !is_self_described(&gender) {
        return Ok((gender, None));
    }
    let description = bounded_text(input.get("genderDescription"), MAX_GENDER_DESCRIPTION)
        .ok_or_else(|| bad("Describe your gender in up to 60 characters"))?;
    Ok((gender, Some(description)))
}

// An exact age, or an explicit "prefer not to say"; a missing answer is an error, not a default.
fn parse_age(input: &Value) -> ApiResult<Option<i64>> {
    if input.get("agePreferNotToSay").and_then(Value::as_bool) == Some(true) {
        return Ok(None);
    }
    input
        .get("age")
        .and_then(Value::as_i64)
        .filter(|age| is_accepted_age(*age))
        .map(Some)
        .ok_or_else(|| bad("Enter your age (1 to 120) or choose prefer not to say"))
}

fn parse_status(input: &Value) -> ApiResult<Status> {
    match text(input, "status") {
        "student" => Ok(Status::Student),
        "professional" => Ok(Status::Professional),
        "student_professional" => Ok(Status::StudentProfessional),
        "seeking" => Ok(Status::Seeking),
        "other" => Ok(Status::Other),
        _ => Err(bad("Choose your current status")),
    }
}

fn parse_interests(input: &Value) -> ApiResult<Vec<String>> {
    let codes: Vec<String> = input
        .get("interests")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if codes.len() > MAX_INTERESTS
        || !codes
            .iter()
            .all(|code| catalog::has_option("interests", code))
    {
        return Err(bad("Choose up to 10 listed interests"));
    }
    Ok(dedupe(codes))
}

// Mental model: the level decides the rest: which grade/year range is valid and whether a
// strand or program is asked for (elementary and junior high have none).
fn parse_education(school: Option<&Value>) -> ApiResult<Education> {
    let school = school.ok_or_else(|| bad("Tell us about your school"))?;
    let level = known_option(school, "level", "schoolLevels", "Choose your school level")?;
    let rule = level_rule(&level);
    let year_level = school
        .get("yearLevel")
        .and_then(Value::as_i64)
        .filter(|year| rule.years.contains(year))
        .ok_or_else(|| bad(rule.year_message))?;
    let program = if rule.has_program {
        Some(parse_program_choice(school)?)
    } else {
        None
    };
    Ok(Education {
        school: parse_school_choice(school)?,
        level,
        program,
        year_level,
    })
}

// The code is checked against the catalog (and this level) when the profile is saved.
fn parse_program_choice(school: &Value) -> ApiResult<ProgramChoice> {
    let code = text(school, "programCode");
    if code == UNLISTED_PROGRAM {
        return bounded_text(school.get("unlistedProgram"), MAX_TEXT)
            .map(ProgramChoice::Unlisted)
            .ok_or_else(|| bad("Type your program or strand"));
    }
    (!code.is_empty() && code.len() <= MAX_SCHOOL_CODE)
        .then(|| ProgramChoice::Listed(code.to_owned()))
        .ok_or_else(|| bad("Choose your program or strand from the list"))
}

fn parse_school_choice(school: &Value) -> ApiResult<SchoolChoice> {
    let code = text(school, "code");
    if is_unlisted_school(code) {
        return bounded_text(school.get("unlistedName"), MAX_SCHOOL_NAME)
            .map(SchoolChoice::Unlisted)
            .ok_or_else(|| bad("Enter your school's name"));
    }
    // The code is checked against the school directory when the profile is saved.
    (!code.is_empty() && code.len() <= MAX_SCHOOL_CODE)
        .then(|| SchoolChoice::Listed(code.to_owned()))
        .ok_or_else(|| bad("Choose your school from the list"))
}

fn parse_employment(employment: Option<&Value>) -> ApiResult<Employment> {
    let employment = employment.ok_or_else(|| bad("Tell us about your work"))?;
    Ok(Employment {
        company: parse_company_choice(employment)?,
        industry: known_option(employment, "industry", "industries", "Choose an industry")?,
        job_role: bounded_text(employment.get("jobRole"), MAX_TEXT)
            .ok_or_else(|| bad("Enter your job role"))?,
        experience_range: known_option(
            employment,
            "experienceRange",
            "experienceRanges",
            "Choose your years of experience",
        )?,
    })
}

fn parse_company_choice(employment: &Value) -> ApiResult<CompanyChoice> {
    let existing = employment
        .get("companyId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let new = bounded_text(employment.get("newCompanyName"), MAX_TEXT);
    match (existing, new) {
        (Some(id), None) => Ok(CompanyChoice::Existing(id.to_owned())),
        (None, Some(name)) => Ok(CompanyChoice::New(name)),
        _ => Err(bad("Choose your company or add it")),
    }
}

fn known_option(
    input: &Value,
    field: &str,
    list: &str,
    message: &'static str,
) -> ApiResult<String> {
    let code = text(input, field);
    if catalog::has_option(list, code) {
        Ok(code.to_owned())
    } else {
        Err(bad(message))
    }
}

fn bounded_text(value: Option<&Value>, max: usize) -> Option<String> {
    let trimmed = value.and_then(Value::as_str)?.trim();
    (!trimmed.is_empty() && trimmed.chars().count() <= max).then(|| trimmed.to_owned())
}

fn dedupe(mut codes: Vec<String>) -> Vec<String> {
    codes.sort();
    codes.dedup();
    codes
}

#[inline]
fn text<'a>(input: &'a Value, field: &str) -> &'a str {
    input.get(field).and_then(Value::as_str).unwrap_or("")
}

#[inline]
fn is_self_described(gender: &str) -> bool {
    gender == "self_describe"
}

#[inline]
fn is_unlisted_school(code: &str) -> bool {
    code == UNLISTED_SCHOOL
}

#[inline]
fn is_accepted_age(age: i64) -> bool {
    (MIN_AGE..=MAX_AGE).contains(&age)
}
