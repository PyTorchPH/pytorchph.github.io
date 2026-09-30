//! PyTorch PH API.
//!
//! Module map:
//!   app          startup, shared state, errors, routes, background jobs, public reads
//!   http         request admission: RAM priority queue with a disk spool
//!   identity     sessions, Google and email sign-in, verified accounts, account deletion
//!   evidence     claim submission, officer review, sanctions and appeals
//!   leaderboard  season standings, member overview, achievements
//!   events       organization events, entrants, results, attendance
//!   mail         approval-routed mail drafts and their PDF attachments
//!   portal       the /portal/api gateway behind the member portal
//!   feedback     bug-report attachments
//!   officer      Command Center analytics
//!   organization departments, positions, reporting lines, reserved officer seats
//!   member_profile  onboarding profile, reference catalogs, consented demographics
//!   schools      PH school directory (DepEd, CHED) with multi-keyword FTS5 search
//!   programs     program/strand catalog (DepEd, PSA PSCED, TESDA) per school level
//!   companies    company directory (Wikidata, GLEIF, PSE, curated) plus member-added companies
//!   reference_data  shared seed versioning and keyword search for the directories above
//!   seed         demo fixtures and sample members
//!   skill_taxonomy  client-compiled normalized skills (Technology dept) and the community tally
mod app;
mod companies;
mod events;
mod evidence;
mod feedback;
mod http;
mod identity;
mod leaderboard;
mod mail;
mod member_profile;
mod officer;
mod organization;
mod portal;
mod programs;
mod reference_data;
mod schools;
mod seed;
mod skill_taxonomy;
#[cfg(test)]
mod tests;

pub(crate) use app::{
    errors::{ApiError, ApiResult, bad, check_origin, internal},
    state::AppState,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    app::startup::run().await
}
