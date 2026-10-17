//! Mailbox provisioning is optional enrichment after authentication, never an identity check.
use super::session::{Viewer, issue_session};
use crate::{ApiResult, AppState, internal};
use axum::{http::HeaderValue, response::Response};
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Mental model: attempt bounded provisioning, report a retryable outage, then issue the
/// normal session (including reserved-seat claiming). Retry pending provisioning next sign-in.
pub(crate) async fn issue_login_session(state: &AppState, viewer: Viewer) -> ApiResult<Response> {
    let status = provision_login_mailbox(state, &viewer).await?;
    let mut response = issue_session(state, viewer).await?;
    response.headers_mut().insert(
        "x-organization-mailbox-status",
        HeaderValue::from_static(status),
    );
    Ok(response)
}

async fn provision_login_mailbox(state: &AppState, viewer: &Viewer) -> ApiResult<&'static str> {
    let Some(client) = state.identity_client.as_deref() else {
        return Ok("not-configured");
    };
    let member_id = Uuid::parse_str(&viewer.id).map_err(internal)?;
    let started = Instant::now();
    let correlation_id = Uuid::new_v4();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        client.provision_mailbox(member_id, &viewer.display_name),
    )
    .await;
    let status = match result {
        Ok(Ok(_)) => "ready",
        _ => "pending",
    };
    if status == "pending" {
        tracing::warn!(
            component = "identity", operation = "login_mailbox_provisioning",
            %correlation_id, duration_ms = started.elapsed().as_millis() as u64,
            outcome = "pending", retry = "next_sign_in",
            "auth.organization_mailbox_pending"
        );
    } else {
        tracing::info!(
            component = "identity", operation = "login_mailbox_provisioning",
            %correlation_id, duration_ms = started.elapsed().as_millis() as u64,
            outcome = "ready", "auth.organization_mailbox_ready"
        );
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::identity_client::IdentityClient;
    use axum::{Json, Router, http::StatusCode, routing::post};
    use std::sync::Arc;

    #[tokio::test]
    async fn unavailable_mailbox_does_not_block_member_or_officer_sessions() {
        for officer in [false, true] {
            let (mut state, _, officer_id, member_id) = crate::tests::fixture().await;
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}/", listener.local_addr().unwrap());
            let app = Router::new().fallback(|| async { StatusCode::SERVICE_UNAVAILABLE });
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            Arc::get_mut(&mut state).unwrap().identity_client =
                Some(Arc::new(IdentityClient::test_loopback(&base)));
            let role = if officer { "officer" } else { "member" };
            let viewer = Viewer {
                id: if officer { officer_id } else { member_id },
                display_name: "Test Member".into(),
                role: role.into(),
            };
            let response = issue_login_session(&state, viewer).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()["x-organization-mailbox-status"],
                "pending"
            );
            assert!(response.headers().get("set-cookie").is_some());
            let bytes = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["role"], role);
            server.abort();
        }
    }

    #[tokio::test]
    async fn mailbox_retry_becomes_ready_without_changing_identity() {
        let (mut state, _, _, member_id) = crate::tests::fixture().await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let path = format!("/v1/identities/{member_id}/organization-mailbox");
        let app = Router::new().route(
            &path,
            post(|| async { Json(serde_json::json!({"address":"fictional@pytorch.ph"})) }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Arc::get_mut(&mut state).unwrap().identity_client =
            Some(Arc::new(IdentityClient::test_loopback(&base)));
        let viewer = Viewer {
            id: member_id,
            display_name: "Test Member".into(),
            role: "member".into(),
        };
        let response = issue_login_session(&state, viewer).await.unwrap();
        assert_eq!(response.headers()["x-organization-mailbox-status"], "ready");
        server.abort();
    }

    #[tokio::test]
    async fn mailbox_timeout_is_bounded_and_invalid_password_still_fails() {
        use crate::identity::email_signup;
        use axum::{extract::State, http::HeaderMap};
        let (mut state, _, _, member_id) = crate::tests::fixture().await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let app = Router::new().fallback(|| async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            StatusCode::SERVICE_UNAVAILABLE
        });
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Arc::get_mut(&mut state).unwrap().identity_client =
            Some(Arc::new(IdentityClient::test_loopback(&base)));
        sqlx::query(
            "INSERT INTO email_credentials(member_id,password_hash,verified_at) VALUES (?,?,?)",
        )
        .bind(&member_id)
        .bind(email_signup::password_hash("Synthetic#Pass9").unwrap())
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
        let email = format!("{member_id}@example.test");
        let mut headers = HeaderMap::new();
        headers.insert("origin", HeaderValue::from_static("https://pytorch.ph"));
        let before: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
            .fetch_one(&state.db)
            .await
            .unwrap();
        let rejected = email_signup::password_login(
            State(state.clone()),
            headers.clone(),
            Json(email_signup::PasswordLogin {
                email: email.clone(),
                password: "Incorrect#Pass9".into(),
            }),
        )
        .await;
        assert!(matches!(
            rejected,
            Err(crate::ApiError(StatusCode::UNAUTHORIZED, _))
        ));
        let after: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(before, after);
        let started = Instant::now();
        let response = email_signup::password_login(
            State(state.clone()),
            headers,
            Json(email_signup::PasswordLogin {
                email,
                password: "Synthetic#Pass9".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            response.headers()["x-organization-mailbox-status"],
            "pending"
        );
        assert!(response.headers().get("set-cookie").is_some());
        assert!(started.elapsed() < Duration::from_secs(8));
        server.abort();
    }
}
