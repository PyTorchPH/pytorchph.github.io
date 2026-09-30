//! Deleting events: who may, what cascades away, and the audit snapshot that stays.
use super::*;
use crate::events::delete::{delete_event, officer_event_list};

async fn officer(db: &sqlx::SqlitePool, name: &str, role: &str) -> session::Viewer {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO members(id,google_sub,email,display_name,public_handle,role,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(&id).bind(&id).bind(format!("{name}@example.test")).bind(name).bind(format!("{name}-{}", &id[..6]))
        .bind(role).bind(chrono::Utc::now().to_rfc3339()).execute(db).await.unwrap();
    session::Viewer {
        id,
        display_name: name.into(),
        role: role.into(),
    }
}

// A competitive event by `creator` with one entrant who earned 50 points.
async fn scored_event(
    db: &sqlx::SqlitePool,
    creator: &session::Viewer,
    winner: &session::Viewer,
) -> String {
    let event = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO events(id,title,category,starts_at,competitive,entrant_kind,last_place,created_by,created_at) VALUES (?,'Hack','hackathon','2026-10-01',1,'individual',3,?,?)")
        .bind(&event).bind(&creator.id).bind(&now).execute(db).await.unwrap();
    sqlx::query("INSERT INTO entrants(id,event_id,name,kind) VALUES (?,?,'Solo','individual')")
        .bind(format!("en-{event}"))
        .bind(&event)
        .execute(db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO point_ledger(id,member_id,event_id,place,delta,result_revision,reason,created_at) VALUES (?,?,?,1,50,1,'place',?)")
        .bind(Uuid::new_v4().to_string()).bind(&winner.id).bind(&event).bind(&now).execute(db).await.unwrap();
    event
}

fn status_of(result: crate::ApiResult<serde_json::Value>) -> StatusCode {
    match result {
        Ok(_) => StatusCode::OK,
        Err(ApiError(status, _)) => status,
    }
}

#[tokio::test]
async fn the_creator_deletes_their_event_and_its_points_and_a_snapshot_stays() {
    let (state, ..) = fixture().await;
    let creator = officer(&state.db, "creator", "officer").await;
    let winner = officer(&state.db, "winner", "member").await;
    let event = scored_event(&state.db, &creator, &winner).await;

    let reply = delete_event(&state.db, &creator, &event).await.unwrap();

    assert_eq!(reply["pointsRevoked"], 50);
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM events").await, 0);
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM point_ledger").await,
        0
    );
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM entrants").await, 0);
    assert_eq!(count(&state.db, "SELECT COUNT(*) FROM event_deletion_log WHERE entrants = 1 AND points_revoked = 50 AND members_affected = 1").await, 1);
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM jobs WHERE kind = 'leaderboard_refresh' AND status = 'pending'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn only_the_president_an_admin_or_the_creator_may_delete() {
    let (state, ..) = fixture().await;
    let creator = officer(&state.db, "creator", "officer").await;
    let other = officer(&state.db, "other", "officer").await;
    let president = officer(&state.db, "president", "officer").await;
    sqlx::query("INSERT INTO member_positions(member_id, position_slug, assigned_at) VALUES (?, 'president', '2026-09-30')").bind(&president.id).execute(&state.db).await.unwrap();
    let admin = officer(&state.db, "admin", "admin").await;

    let first = scored_event(&state.db, &creator, &other).await;
    assert_eq!(
        status_of(delete_event(&state.db, &other, &first).await),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status_of(delete_event(&state.db, &president, &first).await),
        StatusCode::OK
    );
    let second = scored_event(&state.db, &creator, &other).await;
    assert_eq!(
        status_of(delete_event(&state.db, &admin, &second).await),
        StatusCode::OK
    );
    assert_eq!(
        status_of(delete_event(&state.db, &admin, "missing").await),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn deletion_records_are_visible_to_the_creator_the_deleter_and_admins_only() {
    let (state, ..) = fixture().await;
    let creator = officer(&state.db, "creator", "officer").await;
    let bystander = officer(&state.db, "bystander", "officer").await;
    let admin = officer(&state.db, "admin", "admin").await;
    let event = scored_event(&state.db, &creator, &bystander).await;
    delete_event(&state.db, &admin, &event).await.unwrap();

    for (viewer, visible) in [(&creator, 1), (&admin, 1), (&bystander, 0)] {
        let view = officer_event_list(&state.db, viewer).await.unwrap();
        assert_eq!(
            view["deletions"].as_array().unwrap().len(),
            visible,
            "{}",
            viewer.display_name
        );
    }
}
