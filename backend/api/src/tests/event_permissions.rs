//! Position-scoped event mutation, independently from mailbox and generic account roles.
use super::*;
use serde_json::{Value, json};

async fn assign(state: &Arc<AppState>, member: &str, position: &str) {
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,?,?)")
        .bind(member)
        .bind(position)
        .bind("2026-10-13T00:00:00Z")
        .execute(&state.db)
        .await
        .unwrap();
}

fn body(public: bool) -> Value {
    json!({"title":"Position test workshop","category":"workshop","startsAt":"2027-02-01T08:00:00Z",
        "parentId":null,"entrantKind":null,"placePoints":null,"skillTags":[{"skillSlug":"pytorch","allocationBps":10000}],
        "weightMilli":1000,"weightReason":"Approved organizer weight",
        "publication":{"isPublic":public,"description":"Canonical workshop content"}})
}

async fn create(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    public: bool,
) -> Result<String, ApiError> {
    events::create_public_event(State(state.clone()), headers.clone(), Json(body(public)))
        .await
        .map(|(_, Json(value))| value.id)
}

async fn update(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    id: &str,
    public: bool,
    demo: bool,
) -> Result<(), ApiError> {
    events::update_publication(
        State(state.clone()),
        headers.clone(),
        Path(id.into()),
        Json(json!({"isPublic":public,"isDemo":demo,"description":"Changed canonical content"})),
    )
    .await
    .map(|_| ())
}

#[tokio::test]
async fn account_roles_do_not_supply_event_authority_and_revocation_takes_effect() {
    let (state, headers, officer, _) = fixture().await;
    assert_eq!(
        create(&state, &headers, false).await.unwrap_err().0,
        StatusCode::FORBIDDEN
    );
    assign(&state, &officer, "treasurer").await;
    assert_eq!(
        create(&state, &headers, false).await.unwrap_err().0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE members SET role='admin' WHERE id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create(&state, &headers, true).await.unwrap_err().0,
        StatusCode::FORBIDDEN
    );
    assign(&state, &officer, "head_learning_programs").await;
    let id = create(&state, &headers, true).await.unwrap();
    let Json(detail) = events::read_event(State(state.clone()), headers.clone(), Path(id.clone()))
        .await
        .unwrap();
    assert_eq!(detail["publicationPermissions"]["canPublish"], true);
    sqlx::query("DELETE FROM member_positions WHERE member_id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        update(&state, &headers, &id, false, false)
            .await
            .unwrap_err()
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        crate::site_content::programs::canonical_public(&state.db)
            .await
            .unwrap()
            .len(),
        1
    );
    let Json(detail) = events::read_event(State(state.clone()), headers.clone(), Path(id))
        .await
        .unwrap();
    assert_eq!(detail["publicationPermissions"]["canEdit"], false);
    assign(&state, &officer, "president").await;
    assert!(create(&state, &headers, true).await.is_ok());
    sqlx::query("UPDATE members SET role='pending' WHERE id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        create(&state, &headers, true).await.unwrap_err().0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn learning_officer_may_edit_only_owned_private_drafts() {
    let (state, headers, officer, member) = fixture().await;
    assign(&state, &officer, "learning_programs_officer").await;
    let Json(permission) = events::read_permissions(State(state.clone()), headers.clone())
        .await
        .unwrap();
    assert_eq!(permission["canCreate"], true);
    assert_eq!(permission["canPublish"], false);
    assert_eq!(
        create(&state, &headers, true).await.unwrap_err().0,
        StatusCode::FORBIDDEN
    );
    let own = create(&state, &headers, false).await.unwrap();
    update(&state, &headers, &own, false, false).await.unwrap();
    assert_eq!(
        update(&state, &headers, &own, true, false)
            .await
            .unwrap_err()
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE members SET role='officer' WHERE id=?")
        .bind(&member)
        .execute(&state.db)
        .await
        .unwrap();
    assign(&state, &member, "head_learning_programs").await;
    let peer = member_session(&state, &headers, &member, &"b".repeat(64)).await;
    let peer_private = create(&state, &peer, false).await.unwrap();
    let public = create(&state, &peer, true).await.unwrap();
    assert_eq!(
        update(&state, &headers, &peer_private, false, false)
            .await
            .unwrap_err()
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        update(&state, &headers, &public, true, false)
            .await
            .unwrap_err()
            .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn communications_positions_edit_public_content_without_changing_flags() {
    let (state, headers, officer, member) = fixture().await;
    assign(&state, &officer, "head_learning_programs").await;
    let public = create(&state, &headers, true).await.unwrap();
    let private = create(&state, &headers, false).await.unwrap();
    sqlx::query("UPDATE members SET role='officer' WHERE id=?")
        .bind(&member)
        .execute(&state.db)
        .await
        .unwrap();
    let editor = member_session(&state, &headers, &member, &"c".repeat(64)).await;
    for position in ["communications_officer", "cmo"] {
        assign(&state, &member, position).await;
        assert_eq!(
            create(&state, &editor, false).await.unwrap_err().0,
            StatusCode::FORBIDDEN
        );
        update(&state, &editor, &public, true, false).await.unwrap();
        assert_eq!(
            update(&state, &editor, &public, false, false)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            update(&state, &editor, &public, true, true)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            update(&state, &editor, &private, false, false)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        let Json(detail) =
            events::read_event(State(state.clone()), editor.clone(), Path(public.clone()))
                .await
                .unwrap();
        assert_eq!(detail["publicationPermissions"]["canEdit"], true);
        assert_eq!(detail["publicationPermissions"]["canChangeFlags"], false);
        sqlx::query("DELETE FROM member_positions WHERE member_id=?")
            .bind(&member)
            .execute(&state.db)
            .await
            .unwrap();
    }
}
