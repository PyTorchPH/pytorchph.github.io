//! Every HTTP route and the middleware stack around them.
use crate::{
    AppState,
    app::{jobs, public},
    events::{self, attendance},
    evidence::submission,
    http::admission::{self, Admission},
    identity::{email_signup, session},
    mail,
    member_profile::reference,
    portal,
};
use axum::{
    Router,
    http::{HeaderName, HeaderValue, Method, header},
    routing::{any, delete, get, post, put},
};
use std::sync::Arc;
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};

const MAX_REQUEST_BODY: usize = 384 * 1024;

// Mental model: routes are grouped by domain; every request then passes, outermost first,
// tracing → CORS → body limit → admission (bouncer) → session refresh → handler.
pub(crate) fn router(
    state: Arc<AppState>,
    gate: Arc<Admission>,
) -> Result<Router, Box<dyn std::error::Error>> {
    let cors = cors_layer(&state.allowed_origin)?;
    Ok(Router::new()
        .merge(platform_routes())
        .merge(identity_routes())
        .merge(event_routes())
        .merge(scoring_routes())
        .merge(evidence_routes())
        .merge(mail_routes())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            session::refresh_session,
        ))
        .layer(axum::middleware::from_fn_with_state(gate, admission::admit))
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_BODY))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state))
}

// The browser must see x-queued to follow a spooled request.
fn cors_layer(allowed_origin: &str) -> Result<CorsLayer, Box<dyn std::error::Error>> {
    Ok(CorsLayer::new()
        .allow_origin(allowed_origin.parse::<HeaderValue>()?)
        .allow_credentials(true)
        .allow_headers([header::CONTENT_TYPE, header::IF_MATCH])
        .expose_headers([HeaderName::from_static("x-queued")])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ]))
}

fn platform_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(public::health))
        .route(
            "/public/ai-projection/verify",
            post(crate::ai_privacy::verify_ticket),
        )
        .route("/queue/{id}", get(admission::queue_status))
        .route("/jobs/{id}", get(jobs::read_job))
        .route("/leaderboard", get(public::public_leaderboard))
        .route("/public/events", get(public::public_events))
        .route("/events/{id}/publication", put(events::update_publication))
        .route("/events/permissions", get(events::read_permissions))
        .route(
            "/public/organization-photos/{token}",
            get(crate::site_content::directory::photo),
        )
        .route(
            "/public/site-content",
            get(crate::site_content::public_content),
        )
        .route("/portal/api/{*path}", any(portal::gateway))
        .route("/portal/media/{id}", get(portal::media))
        .route(
            "/reference/profile-options",
            get(reference::profile_options),
        )
        .route("/reference/schools", get(reference::schools))
        .route("/reference/companies", get(reference::companies))
        .route("/reference/programs", get(reference::programs))
}

fn identity_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/google", post(session::google_login))
        .route("/auth/email/start", post(email_signup::start_signup))
        .route("/auth/email/verify", post(email_signup::verify_signup))
        .route("/auth/password", post(email_signup::password_login))
        .route("/auth/me", get(session::me))
        .route("/auth/signout", post(session::signout))
        .route("/members", get(session::list_members))
        .route("/members/me", delete(session::delete_account))
        .route("/members/{id}/approve", post(session::approve_member))
}

fn event_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/events",
            post(events::create_public_event).get(events::list_events),
        )
        .route(
            "/events/{id}/entrants",
            post(events::add_entrant).get(events::list_entrants),
        )
        .route(
            "/events/{id}/results",
            post(events::publish_results).get(events::read_event),
        )
        .route("/events/{id}/attendance", get(attendance::read_attendance))
        .route(
            "/events/{id}/attendance/import",
            post(attendance::import_google_form),
        )
}

fn scoring_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/scoring/skills", get(crate::scoring::skills))
        .route("/scoring/progress", get(crate::scoring::season_progress))
        .route(
            "/scoring/suggestion",
            post(crate::scoring::suggest_for_event),
        )
        .route(
            "/scoring/validators",
            post(crate::scoring::assign_validator),
        )
        .route(
            "/scoring/comparisons",
            post(crate::scoring::create_comparison),
        )
        .route(
            "/scoring/comparisons/pending",
            get(crate::scoring::comparison_queue),
        )
        .route(
            "/scoring/comparisons/review-required",
            get(crate::scoring::review_required_comparisons),
        )
        .route(
            "/scoring/comparisons/{id}/vote",
            post(crate::scoring::cast_vote),
        )
        .route(
            "/scoring/comparisons/{id}/summary",
            get(crate::scoring::comparison_summary),
        )
}

fn evidence_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/evidence", post(submission::submit_claim))
        .route("/evidence/extension", post(submission::submit_extension))
        .route("/evidence/me", get(submission::my_claims))
        .route("/evidence/pending", get(submission::pending_claims))
        .route("/evidence/{id}/review", post(submission::review_claim))
}

fn mail_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/members/{id}/officer-roles", post(mail::set_officer_roles))
        .route("/mail/routes/{category}", post(mail::set_route))
        .route("/mail/drafts", post(mail::create_draft))
        .route(
            "/mail/drafts/{id}",
            get(mail::read_draft).patch(mail::edit_draft),
        )
        .route("/mail/drafts/{id}/approve", post(mail::approve_draft))
        .route("/mail/drafts/{id}/release", post(mail::release_draft))
        .route(
            "/mail/drafts/{id}/reconcile",
            post(mail::reconcile_dispatch),
        )
        .route("/mail/drafts/{id}/pdf", get(mail::preview_pdf))
        .route("/internal/mail/claim", post(mail::claim_dispatch))
        .route("/internal/mail/{id}/pdf", get(mail::dispatch_pdf))
        .route("/internal/mail/{id}/receipt", post(mail::record_receipt))
}
