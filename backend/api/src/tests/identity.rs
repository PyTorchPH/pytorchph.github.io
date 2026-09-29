//! Sessions, email sign-up, account deletion and verified external accounts.
use super::*;

#[tokio::test]
async fn member_can_delete_their_own_account_with_confirmation() {
    let (state, officer_headers, _, member_id) = fixture().await;
    let token = "d".repeat(64);
    sqlx::query("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES (?,?,?)")
        .bind(hex::encode(Sha256::digest(token.as_bytes())))
        .bind(&member_id)
        .bind((chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339())
        .execute(&state.db)
        .await
        .unwrap();
    let mut member_headers = officer_headers.clone();
    member_headers.insert("cookie", format!("ph_session={token}").parse().unwrap());

    let unconfirmed = session::delete_account(
        State(state.clone()),
        member_headers.clone(),
        Json(serde_json::from_value(serde_json::json!({"confirm": "yes"})).unwrap()),
    )
    .await;
    assert!(matches!(
        unconfirmed,
        Err(ApiError(StatusCode::BAD_REQUEST, _))
    ));

    let mut foreign = member_headers.clone();
    foreign.insert("origin", "https://evil.test".parse().unwrap());
    let cross_site = session::delete_account(
        State(state.clone()),
        foreign,
        Json(serde_json::from_value(serde_json::json!({"confirm": "DELETE"})).unwrap()),
    )
    .await;
    assert!(matches!(
        cross_site,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));

    let deleted = session::delete_account(
        State(state.clone()),
        member_headers.clone(),
        Json(serde_json::from_value(serde_json::json!({"confirm": "DELETE"})).unwrap()),
    )
    .await
    .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);
    assert!(
        deleted.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    assert_eq!(
        count(
            &state.db,
            &format!("SELECT COUNT(*) FROM members WHERE id='{member_id}'")
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &state.db,
            &format!("SELECT COUNT(*) FROM sessions WHERE member_id='{member_id}'")
        )
        .await,
        0
    );
    assert!(session::viewer(&state, &member_headers).await.is_err());
}

#[tokio::test]
async fn authenticated_requests_extend_session_to_seventh_calendar_day() {
    let (state, headers, _, _) = fixture().await;
    let token = "a".repeat(64);
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let app = Router::new()
        .route("/auth/me", get(session::me))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            session::refresh_session,
        ))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let response = client
        .get(format!("http://{address}/auth/me"))
        .header("cookie", headers.get("cookie").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age="));
    assert!(cookie.contains("Expires="));
    let expiry: String = sqlx::query_scalar("SELECT expires_at FROM sessions WHERE token_hash = ?")
        .bind(&hash)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let expected_date = (chrono::Utc::now().date_naive() + chrono::Days::new(7)).to_string();
    assert!(expiry.starts_with(&expected_date));
    assert!(expiry.contains("T23:59:59"));

    sqlx::query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
        .bind((chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339())
        .bind(&hash)
        .execute(&state.db)
        .await
        .unwrap();
    let expired = client
        .get(format!("http://{address}/auth/me"))
        .header("cookie", headers.get("cookie").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(expired.status(), StatusCode::UNAUTHORIZED);
    assert!(expired.headers().get("set-cookie").is_none());
    server.abort();
}

#[tokio::test]
async fn signout_revokes_server_session_and_clears_cookie() {
    let (state, headers, _, _) = fixture().await;
    assert!(session::viewer(&state, &headers).await.is_ok());
    let mut wrong_origin = headers.clone();
    wrong_origin.insert("origin", "https://elsewhere.example".parse().unwrap());
    assert!(matches!(
        session::signout(State(state.clone()), wrong_origin).await,
        Err(ApiError(StatusCode::FORBIDDEN, _))
    ));
    assert!(session::viewer(&state, &headers).await.is_ok());
    let response = session::signout(State(state.clone()), headers.clone())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.starts_with("ph_session=;"));
    assert!(cookie.contains("Max-Age=0"));
    assert!(response.headers().get("cache-control").is_some());
    assert!(matches!(
        session::viewer(&state, &headers).await,
        Err(ApiError(StatusCode::UNAUTHORIZED, _))
    ));
}

#[tokio::test]
async fn email_signup_requires_the_current_code_and_creates_one_member() {
    let (state, headers, _, _) = fixture().await;
    let email = "new@example.test";
    let code = "12345678";
    sqlx::query("INSERT INTO pending_email_signups(email,display_name,public_handle,password_hash,code_hash,expires_at,sent_at) VALUES (?,?,?,?,?,?,?)")
        .bind(email).bind("New Member").bind("new_member")
        .bind(email_signup::password_hash("strong-password").unwrap())
        .bind(email_signup::code_hash(&state.email_code_secret, email, code))
        .bind((chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339())
        .bind(chrono::Utc::now().to_rfc3339()).execute(&state.db).await.unwrap();
    let wrong = email_signup::verify_signup(
        State(state.clone()),
        headers.clone(),
        Json(email_signup::SignupVerify {
            email: email.into(),
            code: "00000000".into(),
        }),
    )
    .await;
    assert!(matches!(wrong, Err(ApiError(StatusCode::BAD_REQUEST, _))));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM members WHERE email=?")
        .bind(email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let response = email_signup::verify_signup(
        State(state.clone()),
        headers.clone(),
        Json(email_signup::SignupVerify {
            email: email.into(),
            code: code.into(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get("set-cookie").is_some());
    let replay = email_signup::verify_signup(
        State(state.clone()),
        headers.clone(),
        Json(email_signup::SignupVerify {
            email: email.into(),
            code: code.into(),
        }),
    )
    .await;
    assert!(matches!(replay, Err(ApiError(StatusCode::BAD_REQUEST, _))));
    let logged_in = email_signup::password_login(
        State(state),
        headers,
        Json(email_signup::PasswordLogin {
            email: email.into(),
            password: "strong-password".into(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(logged_in.status(), StatusCode::OK);
}

#[tokio::test]
async fn temporary_test_accounts_keep_member_and_officer_roles() {
    let (state, headers, _, _) = fixture().await;
    email_signup::seed_test_accounts(&state.db, "Sample#Pass9")
        .await
        .unwrap();
    for (email, role) in [
        ("member@admin.ph", "member"),
        ("officer@admin.ph", "officer"),
    ] {
        let response = email_signup::password_login(
            State(state.clone()),
            headers.clone(),
            Json(email_signup::PasswordLogin {
                email: email.into(),
                password: "Sample#Pass9".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let actual: String = sqlx::query_scalar("SELECT role FROM members WHERE email=?")
            .bind(email)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(actual, role);
    }
}

#[tokio::test]
async fn verified_accounts_are_canonical_unique_and_cascade() {
    let (state, officer, _, member_id) = fixture().await;
    let member = member_session(&state, &officer, &member_id, &"3".repeat(64)).await;
    let (status, _) = portal_call(
        &state,
        &member,
        Method::PUT,
        "/portal/api/member/accounts/github",
        serde_json::json!({"handle": "Octo", "profileUrl": "https://github.com/someone-else"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "URL must match the handle"
    );
    let (status, saved) = portal_call(
        &state,
        &member,
        Method::PUT,
        "/portal/api/member/accounts/github",
        serde_json::json!({"handle": "Octo", "profileUrl": "https://github.com/octo"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["profileUrl"], "https://github.com/octo");
    let (status, _) = portal_call(
        &state,
        &officer,
        Method::PUT,
        "/portal/api/member/accounts/github",
        serde_json::json!({"handle": "octo", "profileUrl": "https://github.com/octo"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "one member per external account"
    );
    let (_, list) = portal_call(
        &state,
        &member,
        Method::GET,
        "/portal/api/member/accounts",
        serde_json::json!(null),
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (status, _) = portal_call(&state, &member, Method::PUT, "/portal/api/member/accounts/facebook",
        serde_json::json!({"handle": "id:12345", "profileUrl": "https://www.facebook.com/profile.php?id=12345"})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = portal_call(
        &state,
        &member,
        Method::DELETE,
        "/portal/api/member/accounts/facebook",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("DELETE FROM members WHERE id = ?")
        .bind(&member_id)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(
        count(&state.db, "SELECT COUNT(*) FROM member_accounts").await,
        0
    );
}

#[tokio::test]
async fn reseeding_test_accounts_rotates_their_password() {
    let (state, headers, _, _) = fixture().await;
    email_signup::seed_test_accounts(&state.db, "Sample#Pass9")
        .await
        .unwrap();
    email_signup::seed_test_accounts(&state.db, "Rotated#Pass7")
        .await
        .unwrap();
    let login = |password: &str| {
        email_signup::password_login(
            State(state.clone()),
            headers.clone(),
            Json(email_signup::PasswordLogin {
                email: "member@admin.ph".into(),
                password: password.into(),
            }),
        )
    };
    assert!(login("Sample#Pass9").await.is_err());
    assert_eq!(
        login("Rotated#Pass7").await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn weak_test_account_password_is_rejected() {
    let (state, _, _, _) = fixture().await;
    assert!(
        email_signup::seed_test_accounts(&state.db, "test-password")
            .await
            .is_err()
    );
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM members WHERE email LIKE '%@admin.ph'"
        )
        .await,
        0
    );
}
