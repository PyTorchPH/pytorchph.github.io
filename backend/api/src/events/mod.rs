//! Organization events: creation, entrants, official results, attendance and officer reads.
//!
//! Module map:
//!   create      create_event: a talk, workshop, hackathon, competition or mini contest
//!   entrants    add_entrant: a person or team registered in a competitive event
//!   results     publish_results: versioned placements that award (and correct) points
//!   reads       read_event, list_events, list_entrants
//!   attendance  import_google_form, read_attendance: points for verified form responses
//!   records     shared Created reply, audit rows and point-ledger entries
//!   delete      delete_event (President, admin, or creator) with a surviving audit snapshot
pub(crate) mod attendance;
mod create;
pub(crate) mod delete;
mod entrants;
mod reads;
mod records;
mod results;

pub use create::create_event;
pub use entrants::add_entrant;
pub use reads::{list_entrants, list_events, read_event};
pub use results::publish_results;
// Request bodies the tests build directly.
#[cfg(test)]
pub use {
    create::NewEvent,
    entrants::NewEntrant,
    results::{Placement, ResultInput},
};
