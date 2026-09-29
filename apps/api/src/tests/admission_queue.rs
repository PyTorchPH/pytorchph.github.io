//! Request admission: RAM priority queue, disk spool, replay and recovery.
use super::*;

#[tokio::test]
async fn gate_serves_waiters_by_priority_then_arrival() {
    let gate = admission::Gate::new(1, 10);
    let admission::Admit::Now(first) = gate.enter(3, true) else {
        panic!("slot free")
    };
    let admission::Admit::Wait(mut heavy) = gate.enter(4, true) else {
        panic!("queued")
    };
    let admission::Admit::Wait(mut read) = gate.enter(2, true) else {
        panic!("queued")
    };
    let admission::Admit::Wait(mut login) = gate.enter(1, false) else {
        panic!("queued")
    };
    drop(first);
    let second = login.try_recv().expect("auth goes first");
    assert!(read.try_recv().is_err() && heavy.try_recv().is_err());
    drop(second);
    let third = read.try_recv().expect("then reads");
    drop(third);
    let fourth = heavy.try_recv().expect("heavy work last");
    drop(fourth);
    assert_eq!(gate.load(), (0, 0));
}

#[tokio::test]
async fn full_ram_queue_spills_to_disk_and_replays_as_the_same_member() {
    let (state, officer, officer_id, member_id) = fixture().await;
    let (gate, app) = admission_app(&state, tight(1 << 20));
    let admission::Admit::Now(busy) = gate.gate.enter(2, false) else {
        panic!("slot free")
    };

    let (status, headers, body, _) = send(&app, Method::POST, "/echo", &officer, "hello").await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(headers["x-queued"], "1");
    let job = body["jobId"].as_str().unwrap().to_owned();
    let (status, _, waiting, _) =
        send(&app, Method::GET, &format!("/queue/{job}"), &officer, "").await;
    assert_eq!(
        (status, waiting["status"].as_str()),
        (StatusCode::ACCEPTED, Some("queued"))
    );

    drop(busy);
    assert!(admission::run_next(&gate, &app).await.unwrap());
    let (status, _, done, _) =
        send(&app, Method::GET, &format!("/queue/{job}"), &officer, "").await;
    assert_eq!(
        (status, done["status"].as_str()),
        (StatusCode::OK, Some("done"))
    );
    let stored = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        done["response"]["body"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(stored).unwrap(),
        format!("{officer_id}:hello")
    );
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM request_spool WHERE body IS NOT NULL"
        )
        .await,
        0,
        "request bodies are dropped after replay"
    );

    let other = member_session(&state, &officer, &member_id, &"5".repeat(64)).await;
    let (status, _, _, _) = send(&app, Method::GET, &format!("/queue/{job}"), &other, "").await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "only the owner reads a spooled result"
    );
}

#[tokio::test]
async fn auth_never_spills_and_a_full_disk_budget_is_the_only_rejection() {
    let (state, officer, _, _) = fixture().await;
    let (gate, app) = admission_app(&state, tight(0));
    let admission::Admit::Now(busy) = gate.gate.enter(2, false) else {
        panic!("slot free")
    };
    let (status, headers, _, _) = send(&app, Method::POST, "/echo", &officer, "x").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(headers[axum::http::header::RETRY_AFTER], "30");

    let login = tokio::spawn({
        let app = app.clone();
        let officer = officer.clone();
        async move {
            send(&app, Method::POST, "/auth/echo", &officer, "x")
                .await
                .0
        }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(
        gate.gate.load().1,
        1,
        "auth waits in RAM instead of spilling"
    );
    drop(busy);
    assert_eq!(login.await.unwrap(), StatusCode::OK);
}

#[tokio::test]
async fn interrupted_spool_work_is_recovered_after_restart() {
    let (state, _, _, _) = fixture().await;
    sqlx::query("INSERT INTO request_spool(id,priority,method,path,status,created_at,expires_at) VALUES ('r1',2,'GET','/health','running','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')")
        .execute(&state.db).await.unwrap();
    assert_eq!(admission::recover(&state.db).await.unwrap(), 1);
    assert_eq!(
        count(
            &state.db,
            "SELECT COUNT(*) FROM request_spool WHERE status='queued'"
        )
        .await,
        1
    );
    sqlx::query("UPDATE request_spool SET status='done', expires_at='2000-01-01T00:00:00Z'")
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(admission::cleanup(&state.db).await.unwrap(), 1);
}
