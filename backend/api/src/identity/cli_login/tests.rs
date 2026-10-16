use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request},
};
use tower::ServiceExt;

async fn call(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    path: &str,
    value: Value,
) -> (StatusCode, HeaderMap, Value) {
    let app = Router::new()
        .route("/auth/cli/start", axum::routing::post(start))
        .route("/auth/cli/approve", axum::routing::post(approve))
        .route("/auth/cli/poll", axum::routing::post(poll))
        .with_state(state.clone());
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap();
    request.headers_mut().extend(headers.clone());
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    (
        status,
        headers.clone(),
        if headers
            .get("content-type")
            .is_some_and(|value| value.to_str().unwrap().starts_with("application/json"))
        {
            serde_json::from_slice(&body).unwrap()
        } else {
            assert!(
                status.is_client_error(),
                "Only framework validation rejections may be plain text"
            );
            json!({"rejection":String::from_utf8_lossy(&body)})
        },
    )
}

async fn begin(state: &Arc<AppState>, headers: &HeaderMap) -> (Value, String) {
    let verifier = "v".repeat(43);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let (status, _, value) = call(
        state,
        headers,
        "/auth/cli/start",
        json!({"challenge":challenge}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (value, verifier)
}

#[tokio::test]
async fn browser_approval_pkce_single_use_and_role_recheck_are_enforced() {
    let (state, headers, officer, _) = crate::tests::fixture().await;
    let (flow, verifier) = begin(&state, &headers).await;
    let id = flow["requestId"].as_str().unwrap();
    let input = json!({"requestId":id,"verifier":verifier});
    assert_eq!(
        call(&state, &headers, "/auth/cli/poll", input.clone())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&state, &headers, "/auth/cli/poll", input.clone())
            .await
            .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/poll",
            json!({"requestId":id,"verifier":"w".repeat(43)})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/approve",
            json!({"requestId":id,"userCode":"WRONG"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let approval = json!({"requestId":id,"userCode":flow["userCode"]});
    assert_eq!(
        call(&state, &headers, "/auth/cli/approve", approval.clone())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&state, &headers, "/auth/cli/approve", approval)
            .await
            .0,
        StatusCode::CONFLICT
    );
    PENDING.lock().await.get_mut(id).unwrap().last_poll = None;
    let (status, response_headers, viewer) =
        call(&state, &headers, "/auth/cli/poll", input.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(viewer["role"], "officer");
    let cookie = response_headers["set-cookie"].to_str().unwrap();
    assert!(
        cookie.contains("HttpOnly") && cookie.contains("Secure") && cookie.contains("SameSite=Lax")
    );
    assert_eq!(response_headers["cache-control"], "no-store");
    assert_eq!(
        call(&state, &headers, "/auth/cli/poll", input).await.0,
        StatusCode::GONE
    );
    let (flow, verifier) = begin(&state, &headers).await;
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/approve",
            json!({"requestId":flow["requestId"],"userCode":flow["userCode"]})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE members SET role='member' WHERE id=?")
        .bind(officer)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/poll",
            json!({"requestId":flow["requestId"],"verifier":verifier})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn origin_membership_expiry_and_guess_limit_fail_closed() {
    let (state, headers, _, member) = crate::tests::fixture().await;
    let response = session::issue_session(
        &state,
        Viewer {
            id: member,
            display_name: "Test member".into(),
            role: "member".into(),
        },
    )
    .await
    .unwrap();
    let mut member_headers = headers.clone();
    member_headers.insert(
        "cookie",
        response.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .parse()
            .unwrap(),
    );
    let (flow, verifier) = begin(&state, &headers).await;
    let id = flow["requestId"].as_str().unwrap();
    let approval = json!({"requestId":id,"userCode":flow["userCode"]});
    assert_eq!(
        call(
            &state,
            &member_headers,
            "/auth/cli/approve",
            approval.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut anonymous = headers.clone();
    anonymous.remove("cookie");
    assert_eq!(
        call(&state, &anonymous, "/auth/cli/approve", approval)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let mut foreign = headers.clone();
    foreign.insert("origin", "https://example.invalid".parse().unwrap());
    assert_eq!(
        call(
            &state,
            &foreign,
            "/auth/cli/start",
            json!({"challenge":"a".repeat(43)})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for _ in 0..6 {
        assert_eq!(
            call(
                &state,
                &headers,
                "/auth/cli/approve",
                json!({"requestId":id,"userCode":"BAD"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/poll",
            json!({"requestId":id,"verifier":verifier})
        )
        .await
        .0,
        StatusCode::GONE
    );
    let (flow, verifier) = begin(&state, &headers).await;
    PENDING
        .lock()
        .await
        .get_mut(flow["requestId"].as_str().unwrap())
        .unwrap()
        .expires = Instant::now();
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/poll",
            json!({"requestId":flow["requestId"],"verifier":verifier})
        )
        .await
        .0,
        StatusCode::GONE
    );
    assert_eq!(
        call(
            &state,
            &headers,
            "/auth/cli/start",
            json!({"challenge":"bad","unexpected":true})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
