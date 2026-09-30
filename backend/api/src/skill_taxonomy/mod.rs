//! Community skills: a normalized skill list compiled client-side by Technology officers with their
//! own AI key, and the tally of how many members show each normalized skill.
//!
//! Module map:
//!   raw_skills   every raw skill word on members' verified achievements, with member counts
//!   access       who may compile and publish: holders of Technology department positions
//!   publish      validate and store a taxonomy version (skills, categories, raw→skill aliases)
//!   tally        members per normalized skill under the newest version, most common first
pub(crate) mod access;
pub(crate) mod publish;
pub(crate) mod raw_skills;
pub(crate) mod tally;

pub(crate) use access::can_compile;
pub(crate) use publish::publish_taxonomy;
pub(crate) use raw_skills::raw_skill_counts;
pub(crate) use tally::skill_tally;
