//! Live data layered over a product view before it is returned.
//!
//! Module map (caller-first):
//!   overlay_if_product          only product/* views get overlays
//!   └─ overlay_view
//!       ├─ overlay_saved_sections   the member's saved sections replace the template's
//!       └─ analytics::overlay_dashboard   officers' dashboard gets live Command Center figures
use super::{is_officer, store::stored};
use crate::{ApiResult, identity::session::Viewer, officer::analytics};
use serde_json::Value;
use sqlx::SqlitePool;

// Each saved view contributes one section to every product view that shows it.
const SAVED_SECTIONS: [(&str, &str); 4] = [
    ("/api/product/opportunities", "opportunities"),
    ("/api/product/career-evidence", "evidence"),
    ("/api/product/dashboard", "events"),
    ("/api/product/job-operations", "operations"),
];

pub(crate) async fn overlay_if_product(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    view: &mut Value,
) -> ApiResult<()> {
    if is_product_view(path) {
        overlay_view(db, actor, path, view).await?;
    }
    Ok(())
}

#[inline]
fn is_product_view(path: &str) -> bool {
    path.starts_with("product/")
}

// Mental model: the template view is filled with the member's own saved sections first;
// an officer's dashboard then also gets live Command Center analytics.
async fn overlay_view(
    db: &SqlitePool,
    actor: &Viewer,
    path: &str,
    view: &mut Value,
) -> ApiResult<()> {
    overlay_saved_sections(db, &actor.id, view).await?;
    if path == "product/dashboard" && is_officer(&actor.role) {
        analytics::overlay_dashboard(db, view).await?;
    }
    Ok(())
}

async fn overlay_saved_sections(
    db: &SqlitePool,
    member_id: &str,
    view: &mut Value,
) -> ApiResult<()> {
    for (key, property) in SAVED_SECTIONS {
        if let Some(saved) = stored(db, member_id, key).await?
            && let Some(value) = saved.get(property)
        {
            view[property] = value.clone();
        }
    }
    Ok(())
}
