//! Saving and reading a member profile across its normalized tables.
//!
//! Module map (caller-first):
//!   save_profile                 PUT /api/member/profile
//!   ├─ write_core                member_profiles (keeps the first completion time)
//!   ├─ replace_optional_rows     clears the answer rows that may no longer apply
//!   ├─ write_gender_description / write_consent / write_interests
//!   ├─ write_education
//!   └─ write_employment
//!       └─ resolve_company       an existing company, or a new one added to the shared list
//!   read_profile                 GET /api/member/profile
//!   └─ profile_view              rows → the same shape the form submits
use super::input::{
    CompanyChoice, Education, Employment, Profile, ProgramChoice, SchoolChoice, parse_profile,
};
use crate::{
    ApiError, ApiResult,
    identity::session::Viewer,
    internal,
    programs::{UNLISTED_PROGRAM, program_fits_level},
    schools::{display::school_label, find_school},
};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

type Tx<'a> = Transaction<'a, Sqlite>;

/// school_code, level, program (absent for elementary / junior high), year_level, unlisted school name.
/// school_code, level, year_level, unlisted school name, program_code, catalog program name,
/// unlisted program name (program columns are absent for elementary).
type EducationRow = (
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Today's age from the age given on `recorded_on` (whole years since then are added).
pub(crate) const CURRENT_AGE: &str =
    "CAST(age + (julianday('now') - julianday(recorded_on)) / 365.2425 AS INTEGER)";

// Mental model: validate everything first, then rewrite the member's answer rows in one
// transaction so a profile is never half saved.
pub(crate) async fn save_profile(
    db: &SqlitePool,
    actor: &Viewer,
    input: &Value,
) -> ApiResult<Value> {
    let profile = parse_profile(input)?;
    let mut tx = db.begin().await.map_err(internal)?;
    write_core(&mut tx, &actor.id, &profile).await?;
    replace_optional_rows(&mut tx, &actor.id).await?;
    write_gender_description(&mut tx, &actor.id, &profile).await?;
    write_age(&mut tx, &actor.id, profile.age).await?;
    write_consent(&mut tx, &actor.id, profile.analytics_consent).await?;
    write_interests(&mut tx, &actor.id, &profile.interests).await?;
    if let Some(education) = &profile.education {
        write_education(&mut tx, &actor.id, education).await?;
    }
    if let Some(employment) = &profile.employment {
        write_employment(&mut tx, &actor.id, employment).await?;
    }
    tx.commit().await.map_err(internal)?;
    tracing::info!(
        component = "member_profile",
        operation = "save_profile",
        status = profile.status.code(),
        "member.profile_saved"
    );
    read_profile(db, actor).await
}

async fn write_core(tx: &mut Tx<'_>, member_id: &str, profile: &Profile) -> ApiResult<()> {
    let now = now();
    sqlx::query("INSERT INTO member_profiles(member_id,gender,region_code,status,channel,completed_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET gender=excluded.gender, region_code=excluded.region_code, status=excluded.status, channel=excluded.channel, updated_at=excluded.updated_at")
        .bind(member_id).bind(&profile.gender).bind(&profile.region_code)
        .bind(profile.status.code()).bind(&profile.channel).bind(&now).bind(&now)
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

async fn replace_optional_rows(tx: &mut Tx<'_>, member_id: &str) -> ApiResult<()> {
    for table in [
        "member_gender_descriptions",
        "member_ages",
        "member_analytics_consents",
        "member_interests",
        "member_education",
        "member_employment",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE member_id = ?"
        )))
        .bind(member_id)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    }
    Ok(())
}

async fn write_gender_description(
    tx: &mut Tx<'_>,
    member_id: &str,
    profile: &Profile,
) -> ApiResult<()> {
    let Some(description) = &profile.gender_description else {
        return Ok(());
    };
    sqlx::query("INSERT INTO member_gender_descriptions(member_id, description) VALUES (?, ?)")
        .bind(member_id)
        .bind(description)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

// The age is kept with the day it was given, so reports can compute today's age.
async fn write_age(tx: &mut Tx<'_>, member_id: &str, age: Option<i64>) -> ApiResult<()> {
    let Some(age) = age else {
        return Ok(());
    };
    sqlx::query("INSERT INTO member_ages(member_id, age, recorded_on) VALUES (?, ?, ?)")
        .bind(member_id)
        .bind(age)
        .bind(chrono::Utc::now().format("%Y-%m-%d").to_string())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn write_consent(tx: &mut Tx<'_>, member_id: &str, consented: bool) -> ApiResult<()> {
    if !consented {
        return Ok(());
    }
    sqlx::query("INSERT INTO member_analytics_consents(member_id, consented_at) VALUES (?, ?)")
        .bind(member_id)
        .bind(now())
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn write_interests(tx: &mut Tx<'_>, member_id: &str, interests: &[String]) -> ApiResult<()> {
    for interest in interests {
        sqlx::query("INSERT INTO member_interests(member_id, interest_code) VALUES (?, ?)")
            .bind(member_id)
            .bind(interest)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

// A listed school must exist in the directory; the member picked it from the search results.
async fn listed_school<'a>(tx: &mut Tx<'_>, code: &'a str) -> ApiResult<&'a str> {
    let found: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM schools WHERE code = ?")
        .bind(code)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)?;
    found.map(|_| code).ok_or(ApiError(
        StatusCode::UNPROCESSABLE_ENTITY,
        "Choose your school from the list",
    ))
}

// A listed program must belong to the chosen level; an unlisted one keeps its typed name apart.
async fn write_program(
    tx: &mut Tx<'_>,
    member_id: &str,
    level: &str,
    program: &ProgramChoice,
) -> ApiResult<()> {
    let code = match program {
        ProgramChoice::Listed(code) if program_fits_level(tx, code, level).await? => code.as_str(),
        ProgramChoice::Listed(_) => {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Choose your program or strand from the list",
            ));
        }
        ProgramChoice::Unlisted(_) => UNLISTED_PROGRAM,
    };
    sqlx::query("INSERT INTO member_education_programs(member_id, program_code) VALUES (?, ?)")
        .bind(member_id)
        .bind(code)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    if let ProgramChoice::Unlisted(name) = program {
        sqlx::query("INSERT INTO member_unlisted_programs(member_id, program_name) VALUES (?, ?)")
            .bind(member_id)
            .bind(name)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

async fn write_education(tx: &mut Tx<'_>, member_id: &str, education: &Education) -> ApiResult<()> {
    let school_code = match &education.school {
        SchoolChoice::Listed(code) => listed_school(tx, code).await?,
        SchoolChoice::Unlisted(_) => super::catalog::UNLISTED_SCHOOL,
    };
    sqlx::query("INSERT INTO member_education(member_id, school_code, level, year_level) VALUES (?, ?, ?, ?)")
        .bind(member_id).bind(school_code).bind(&education.level).bind(education.year_level)
        .execute(&mut **tx).await.map_err(internal)?;
    if let Some(program) = &education.program {
        write_program(tx, member_id, &education.level, program).await?;
    }
    if let SchoolChoice::Unlisted(name) = &education.school {
        sqlx::query("INSERT INTO member_unlisted_schools(member_id, school_name) VALUES (?, ?)")
            .bind(member_id)
            .bind(name)
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    Ok(())
}

async fn write_employment(
    tx: &mut Tx<'_>,
    member_id: &str,
    employment: &Employment,
) -> ApiResult<()> {
    let company_id = resolve_company(tx, &employment.company).await?;
    sqlx::query("INSERT INTO member_employment(member_id, company_id, industry_code, job_role, experience_range) VALUES (?, ?, ?, ?, ?)")
        .bind(member_id).bind(&company_id).bind(&employment.industry).bind(&employment.job_role).bind(&employment.experience_range)
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}

// A new company name joins the shared list (case-insensitively unique) for the next member.
async fn resolve_company(tx: &mut Tx<'_>, company: &CompanyChoice) -> ApiResult<String> {
    match company {
        CompanyChoice::Existing(id) => {
            let found: Option<(String,)> = sqlx::query_as("SELECT id FROM companies WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut **tx)
                .await
                .map_err(internal)?;
            found.map(|(id,)| id).ok_or(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Choose your company from the list",
            ))
        }
        CompanyChoice::New(name) => {
            sqlx::query("INSERT OR IGNORE INTO companies(id, name, created_at) VALUES (?, ?, ?)")
                .bind(format!("co-{}", Uuid::new_v4()))
                .bind(name)
                .bind(now())
                .execute(&mut **tx)
                .await
                .map_err(internal)?;
            let (id,): (String,) =
                sqlx::query_as("SELECT id FROM companies WHERE name = ? COLLATE NOCASE")
                    .bind(name)
                    .fetch_one(&mut **tx)
                    .await
                    .map_err(internal)?;
            Ok(id)
        }
    }
}

// Mental model: `complete` is simply whether the core row exists; the rest is read back into
// the same shape the form submits so it can be edited in place.
pub(crate) async fn read_profile(db: &SqlitePool, actor: &Viewer) -> ApiResult<Value> {
    let core: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT gender, region_code, status, channel FROM member_profiles WHERE member_id = ?",
    )
    .bind(&actor.id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    let Some(core) = core else {
        return Ok(json!({"complete": false, "profile": null}));
    };
    Ok(json!({"complete": true, "profile": profile_view(db, &actor.id, core).await?}))
}

async fn profile_view(
    db: &SqlitePool,
    member_id: &str,
    core: (String, String, String, String),
) -> ApiResult<Value> {
    let (gender, region_code, status, channel) = core;
    let age: Option<(i64,)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {CURRENT_AGE} FROM member_ages WHERE member_id = ?"
    )))
    .bind(member_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    let description: Option<(String,)> =
        sqlx::query_as("SELECT description FROM member_gender_descriptions WHERE member_id = ?")
            .bind(member_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    let consent: Option<(String,)> =
        sqlx::query_as("SELECT consented_at FROM member_analytics_consents WHERE member_id = ?")
            .bind(member_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    let interests: Vec<(String,)> = sqlx::query_as(
        "SELECT interest_code FROM member_interests WHERE member_id = ? ORDER BY interest_code",
    )
    .bind(member_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    let education: Option<EducationRow> = sqlx::query_as(
        "SELECT e.school_code, e.level, e.year_level, u.school_name, p.program_code, c.name, up.program_name          FROM member_education e          LEFT JOIN member_unlisted_schools u ON u.member_id = e.member_id          LEFT JOIN member_education_programs p ON p.member_id = e.member_id          LEFT JOIN programs c ON c.code = p.program_code          LEFT JOIN member_unlisted_programs up ON up.member_id = e.member_id          WHERE e.member_id = ?",
    ).bind(member_id).fetch_optional(db).await.map_err(internal)?;
    let employment: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT e.company_id, c.name, e.industry_code, e.job_role, e.experience_range FROM member_employment e JOIN companies c ON c.id = e.company_id WHERE e.member_id = ?",
    ).bind(member_id).fetch_optional(db).await.map_err(internal)?;
    let mut view = json!({
        "gender": gender, "regionCode": region_code, "status": status, "channel": channel,
        "interests": interests.into_iter().map(|(code,)| code).collect::<Vec<_>>(),
        "analyticsConsent": consent.is_some(),
    });
    match age {
        Some((age,)) => view["age"] = json!(age),
        None => view["agePreferNotToSay"] = json!(true),
    }
    if let Some((description,)) = description {
        view["genderDescription"] = json!(description);
    }
    if let Some((code, level, year_level, unlisted, program_code, program_name, unlisted_program)) =
        education
    {
        let label = find_school(db, &code)
            .await?
            .map(|school| school_label(&school))
            .or(unlisted.clone());
        view["schoolLabel"] = json!(label);
        view["programLabel"] = json!(program_name.or(unlisted_program.clone()));
        view["school"] = json!({"code": code, "unlistedName": unlisted, "level": level, "yearLevel": year_level, "programCode": program_code, "unlistedProgram": unlisted_program});
    }
    if let Some((company_id, company_name, industry, job_role, experience)) = employment {
        view["companyLabel"] = json!(company_name);
        view["employment"] = json!({"companyId": company_id, "industry": industry, "jobRole": job_role, "experienceRange": experience});
    }
    Ok(view)
}

#[inline]
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
