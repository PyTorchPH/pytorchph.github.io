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
//!   seed         demo fixtures and sample members
mod app;
mod events;
mod evidence;
mod feedback;
mod http;
mod identity;
mod leaderboard;
mod mail;
mod officer;
mod portal;
mod seed;
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
