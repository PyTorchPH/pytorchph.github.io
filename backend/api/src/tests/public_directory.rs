//! Public directory has no manual/PII fallback; chapters require current appointed leads.
use super::*;
use axum::body::to_bytes;
use serde_json::json;

#[tokio::test]
async fn missing_identity_never_publishes_legacy_profiles_or_private_member_names() {
    let (state, _, officer, _) = fixture().await;
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,'president','2026-10-13')").bind(&officer).execute(&state.db).await.unwrap();
    let response = crate::site_content::public_content(State(state.clone()))
        .await
        .unwrap();
    assert_eq!(
        response.headers().get("cache-control").unwrap(),
        "private, no-store"
    );
    let value: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 256 * 1024).await.unwrap()).unwrap();
    assert_eq!(value["document"]["leadership"], json!([]));
    assert_eq!(value["document"]["chapters"], json!([]));
    assert_eq!(value["document"]["events"], json!([]));
    let result = crate::site_content::directory::photo(State(state), Path("0".repeat(64))).await;
    assert!(matches!(result, Err(ApiError(StatusCode::NOT_FOUND, _))));
}

#[tokio::test]
async fn chapter_management_rejects_unappointed_members_and_retains_explicit_public_facts() {
    let (state, headers, officer, member) = fixture().await;
    let input = json!({"university":"Public Test University","chapter":"Test Campus Labs","island":"Luzon","status":"active","leadId":officer});
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/officer/campus-chapters",
        input.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    sqlx::query("INSERT INTO member_positions(member_id,position_slug,assigned_at) VALUES (?,'campus_labs_lead','2026-10-13')").bind(&officer).execute(&state.db).await.unwrap();
    let mut invalid = input.clone();
    invalid["leadId"] = json!(member);
    let (status, _) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/officer/campus-chapters",
        invalid,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, value) = portal_call(
        &state,
        &headers,
        Method::PUT,
        "/portal/api/officer/campus-chapters",
        input,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["chapters"][0]["university"], "Public Test University");
    assert_eq!(value["eligibleLeads"][0]["id"], officer);
    assert!(!value.to_string().contains("email"));
    let id = value["chapters"][0]["id"].clone();
    let (status,_)=portal_call(&state,&headers,Method::PUT,"/portal/api/officer/campus-chapters",json!({"id":id,"university":"Public Test University","chapter":"Test Campus Labs","island":"Other","status":"active","leadId":officer})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    sqlx::query("DELETE FROM member_positions WHERE member_id=?")
        .bind(&officer)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, value) = portal_call(
        &state,
        &headers,
        Method::GET,
        "/portal/api/officer/campus-chapters",
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["canManage"], false);
    assert_eq!(value["eligibleLeads"], json!([]));
}
