//! Turning one Google Forms response into an attendance outcome.
//!
//! Module map (caller-first):
//!   record_response               classifies one response and records it (and its points)
//!   ├─ is_complete_response       has an id of sane length and a submission time
//!   ├─ submission_time
//!   ├─ submitted_after_start
//!   ├─ normalized_email           trimmed, lower-case, one '@', no whitespace
//!   ├─ find_approved_member
//!   ├─ is_already_recorded        a non-"unmatched" row for this response exists
//!   ├─ has_attendance_award       the member already earned points for this event
//!   ├─ attendance_status          unmatched / duplicate_member / awarded
//!   ├─ upsert_attendance_response inserts, or upgrades an earlier unmatched row
//!   └─ award_attendance_points
//!   Tally::count                  adds one outcome to the import totals
use super::google_forms::FormResponse;
use crate::{ApiResult, internal};
use chrono::{DateTime, FixedOffset};
use uuid::Uuid;

pub(super) type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

const MAX_RESPONSE_ID: usize = 256;
const MAX_EMAIL: usize = 320;

/// What one import is doing: which event, form, point value, officer and timestamp.
pub(super) struct ImportContext<'a> {
    pub event_id: &'a str,
    pub form_id: &'a str,
    pub points: i64,
    pub actor_id: &'a str,
    pub now: &'a str,
    pub starts_at: DateTime<FixedOffset>,
}

pub(super) enum Outcome {
    Awarded,
    Unmatched,
    Duplicate,
    DuplicateMember,
}

#[derive(Default)]
pub(super) struct Tally {
    pub awarded: usize,
    pub unmatched: usize,
    pub duplicates: usize,
    pub duplicate_members: usize,
}

impl Tally {
    pub(super) fn count(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Awarded => self.awarded += 1,
            Outcome::Unmatched => self.unmatched += 1,
            Outcome::Duplicate => self.duplicates += 1,
            Outcome::DuplicateMember => self.duplicate_members += 1,
        }
    }
}

// Mental model: a response is ignored (unmatched) unless it is complete and submitted after
// the event started; a response already recorded is a duplicate; otherwise it is stored with
// its member (if any) and the member earns points once per event.
pub(super) async fn record_response(
    tx: &mut Tx<'_>,
    import: &ImportContext<'_>,
    response: &FormResponse,
) -> ApiResult<Outcome> {
    if !is_complete_response(response) {
        return Ok(Outcome::Unmatched);
    }
    let submitted_at = submission_time(response);
    if !submitted_after_start(submitted_at, import.starts_at) {
        return Ok(Outcome::Unmatched);
    }
    let email = normalized_email(response);
    let member_id = find_approved_member(tx, email.as_deref()).await?;
    if is_already_recorded(tx, import.form_id, &response.response_id).await? {
        return Ok(Outcome::Duplicate);
    }
    let already_awarded = has_attendance_award(tx, import.event_id, member_id.as_deref()).await?;
    let status = attendance_status(member_id.as_deref(), already_awarded);
    let changed = upsert_attendance_response(
        tx,
        import,
        response,
        submitted_at,
        email.as_deref(),
        member_id.as_deref(),
        status,
    )
    .await?;
    if changed == 0 {
        return Ok(Outcome::Duplicate);
    }
    if status == "duplicate_member" {
        return Ok(Outcome::DuplicateMember);
    }
    match member_id {
        Some(member_id) => {
            award_attendance_points(tx, import, &member_id, &response.response_id).await?;
            Ok(Outcome::Awarded)
        }
        None => Ok(Outcome::Unmatched),
    }
}

#[inline]
fn is_complete_response(response: &FormResponse) -> bool {
    !response.response_id.is_empty()
        && response.response_id.len() <= MAX_RESPONSE_ID
        && response.last_submitted_time.is_some()
}

#[inline]
fn submission_time(response: &FormResponse) -> &str {
    response
        .last_submitted_time
        .as_deref()
        .unwrap_or(&response.create_time)
}

#[inline]
fn submitted_after_start(submitted_at: &str, starts_at: DateTime<FixedOffset>) -> bool {
    DateTime::parse_from_rfc3339(submitted_at).is_ok_and(|time| time >= starts_at)
}

pub(super) fn normalized_email(response: &FormResponse) -> Option<String> {
    let raw = response.respondent_email.as_deref()?;
    let email = raw.trim().to_ascii_lowercase();
    if is_plausible_email(&email) {
        Some(email)
    } else {
        None
    }
}

#[inline]
fn is_plausible_email(email: &str) -> bool {
    email.len() <= MAX_EMAIL
        && email.split('@').count() == 2
        && email.split('@').all(|part| !part.is_empty())
        && !email.bytes().any(|byte| byte.is_ascii_whitespace())
}

async fn find_approved_member(tx: &mut Tx<'_>, email: Option<&str>) -> ApiResult<Option<String>> {
    let Some(email) = email else {
        return Ok(None);
    };
    sqlx::query_scalar("SELECT id FROM members WHERE email=? AND role!='pending'")
        .bind(email)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)
}

async fn is_already_recorded(tx: &mut Tx<'_>, form_id: &str, response_id: &str) -> ApiResult<bool> {
    let prior: Option<(String,)> =
        sqlx::query_as("SELECT status FROM attendance_responses WHERE form_id=? AND response_id=?")
            .bind(form_id)
            .bind(response_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(internal)?;
    Ok(prior.as_ref().is_some_and(|row| row.0 != "unmatched"))
}

async fn has_attendance_award(
    tx: &mut Tx<'_>,
    event_id: &str,
    member_id: Option<&str>,
) -> ApiResult<bool> {
    let Some(member_id) = member_id else {
        return Ok(false);
    };
    let awarded: Option<(String,)> = sqlx::query_as("SELECT response_id FROM attendance_responses WHERE event_id=? AND member_id=? AND status='awarded'")
        .bind(event_id).bind(member_id).fetch_optional(&mut **tx).await.map_err(internal)?;
    Ok(awarded.is_some())
}

#[inline]
fn attendance_status(member_id: Option<&str>, already_awarded: bool) -> &'static str {
    if member_id.is_none() {
        "unmatched"
    } else if already_awarded {
        "duplicate_member"
    } else {
        "awarded"
    }
}

// Returns how many rows changed: 0 means the response was already recorded as matched.
#[allow(clippy::too_many_arguments)]
async fn upsert_attendance_response(
    tx: &mut Tx<'_>,
    import: &ImportContext<'_>,
    response: &FormResponse,
    submitted_at: &str,
    email: Option<&str>,
    member_id: Option<&str>,
    status: &str,
) -> ApiResult<u64> {
    Ok(sqlx::query("INSERT INTO attendance_responses(form_id,response_id,event_id,submitted_at,normalized_email,member_id,status,imported_by,imported_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(form_id,response_id) DO UPDATE SET normalized_email=excluded.normalized_email,member_id=excluded.member_id,status=excluded.status,imported_by=excluded.imported_by,imported_at=excluded.imported_at WHERE attendance_responses.status='unmatched'")
        .bind(import.form_id).bind(&response.response_id).bind(import.event_id).bind(submitted_at)
        .bind(email).bind(member_id).bind(status).bind(import.actor_id).bind(import.now)
        .execute(&mut **tx).await.map_err(internal)?.rows_affected())
}

async fn award_attendance_points(
    tx: &mut Tx<'_>,
    import: &ImportContext<'_>,
    member_id: &str,
    response_id: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO point_ledger(id,member_id,source_type,source_id,event_id,delta,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(member_id).bind("attendance")
        .bind(format!("{}:{}", import.form_id, response_id)).bind(import.event_id)
        .bind(import.points).bind(import.actor_id).bind("google_forms_attendance").bind(import.now)
        .execute(&mut **tx).await.map_err(internal)?;
    Ok(())
}
