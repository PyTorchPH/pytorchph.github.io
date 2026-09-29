"""Minimal FastAPI UI on top of the Pipeline.

Routes:
    GET  /           — form (mode, gh user, role, docs upload)
    POST /build      — runs the pipeline, returns links to generated files
    GET  /files/...  — serves the generated files
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import threading
import traceback
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from ..core.config import get_settings
from ..core.models import Mode
from ..job_application import (
    DEFAULT_MONGODB_DATABASE,
    DEFAULT_MONGODB_URI,
    DevelopmentQuestionBridge,
    DevelopmentQuestionResponse,
    FunnelEventCreate,
    JobDemandDraft,
    MarketFitCampaign,
    MarketOpportunityCreate,
    MarketOpportunityUpdate,
    MongoQuestionnaireRepository,
)
from ..job_finder import JobScrapeArtifactStore
from ..llm import LLMUnavailableError
from ..llm.local_config import get_configured_provider, local_ai_status
from ..metrics.usage_counter import add_pages_scraped, bump_download, read_counters
from ..orchestration.pipeline import BuildInputs, Pipeline
from ..role import StaticRolePicker
from ..sources.social.auth import SessionStore
from ..sources.social.browser_login import PlaywrightNotInstalled, open_login_window
from .auth import (
    IDENTITY_PROVIDERS,
    SOCIAL_VENDORS,
    IdentityStore,
    OAuthExchangeError,
    OAuthSetupError,
    OAuthStateError,
    auth_status,
    build_authorize_url,
    clear_social_session,
    complete_oauth_callback,
    preferred_identity_email,
    provider_configuration_status,
)
from .cdo_advisor import AdvisorAnalyzeRequest, analyze_for_injection
from .job_finder_control import (
    approve_question_answers,
    capture_target_preview,
    confirm_external_intervention,
    focus_intervention,
    recheck_intervention,
)
from .job_finder_control import (
    approve_resume_intervention as approve_job_finder_resume_intervention,
)
from .job_finder_control import (
    control_state as job_finder_control_state,
)
from .job_finder_control import (
    disconnect_provider as disconnect_job_finder_provider,
)
from .job_finder_control import (
    focus_target as focus_job_finder_target,
)
from .job_finder_control import (
    release_intervention as release_job_finder_intervention,
)
from .job_finder_control import (
    reopen_goal_item as reopen_job_finder_goal_item,
)
from .job_finder_control import (
    reopen_intervention as reopen_job_finder_intervention,
)
from .job_finder_control import (
    retry_intervention as retry_job_finder_intervention,
)
from .job_finder_control import (
    start_session as start_job_site_session,
)
from .job_finder_supervisor import (
    DEFAULT_ARTIFACT_DIR,
    DEFAULT_DATABASE,
    retry_resolved_intervention,
)
from .job_finder_supervisor import (
    approve_item_review as approve_job_finder_item_review,
)
from .job_finder_supervisor import (
    confirm_item as confirm_job_finder_item,
)
from .job_finder_supervisor import (
    goal_store as job_finder_goal_store,
)
from .job_finder_supervisor import (
    launch_goal as launch_job_finder_goal,
)
from .job_finder_supervisor import (
    release_item as release_job_finder_item,
)
from .job_finder_supervisor import (
    retry_item as retry_job_finder_item,
)
from .job_finder_supervisor import (
    start_goal as create_job_finder_goal,
)
from .job_finder_supervisor import (
    stop_goal as stop_job_finder_goal,
)
from .job_market_api import router as job_market_router
from .local_ai_api import router as local_ai_router
from .market_fit_control import (
    approve_demands as approve_market_fit_demands,
)
from .market_fit_control import (
    assess_opportunity as assess_market_fit_opportunity,
)
from .market_fit_control import (
    draft_demands as draft_market_fit_demands,
)
from .market_fit_control import (
    prepare_interview as prepare_market_fit_interview,
)
from .market_fit_control import (
    state as market_fit_state,
)
from .market_fit_control import (
    store as market_fit_store,
)
from .market_fit_control import (
    update_campaign as update_market_fit_campaign,
)
from .mock_data import PROTOTYPE_DATA
from .onboarding import OnboardingService
from .org_event_api import router as org_event_router

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

app = FastAPI(
    title="resume-build-chopper",
    description=(
        "Production service API for resume generation, evidence processing, job automation, "
        "organization events, analytics, and provider-neutral AI configuration."
    ),
)
app.include_router(job_market_router)
app.include_router(org_event_router)
app.include_router(local_ai_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3100",
        "http://localhost:3100",
        "http://members.ph.localhost:3100",
        "http://officers.ph.localhost:3100",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_STATIC_DIR = Path(__file__).resolve().parent / "static"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_ARTIFACT_ROOT = _REPO_ROOT / "out"
_OUTPUT_ROOT = Path(tempfile.gettempdir()) / "resume-build-chopper-out"
_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
_ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
# Aggregate usage counters (downloads, pages scraped). See metrics/usage_counter.py.
_COUNTERS_PATH = _ARTIFACT_ROOT / "usage-counters.json"

templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
app.mount("/files", StaticFiles(directory=str(_OUTPUT_ROOT)), name="files")
app.mount("/artifacts", StaticFiles(directory=str(_ARTIFACT_ROOT)), name="artifacts")

_LOGIN_JOBS: dict[str, dict[str, str]] = {}
_LOGIN_JOBS_LOCK = threading.Lock()
_AUTO_START_LOCK = threading.RLock()


def _onboarding_service() -> OnboardingService:
    return OnboardingService(artifact_dir=DEFAULT_ARTIFACT_DIR, database=DEFAULT_DATABASE)


def _ai_setup_required_response() -> JSONResponse | None:
    if local_ai_status()["configured"]:
        return None
    return JSONResponse(
        {
            "error": "AI setup is required before resume and scraper pipelines can run.",
            "setupRequired": True,
            "settingsPath": "/settings",
        },
        status_code=409,
    )


def _canonical_frontend(path: str) -> RedirectResponse | None:
    base = os.environ.get("PYTORCH_PH_FRONTEND_URL", "").strip().rstrip("/")
    if not base:
        return None
    return RedirectResponse(f"{base}{path}", status_code=307)


@app.get("/")
def main_entry() -> RedirectResponse:
    frontend = _canonical_frontend("/login")
    if frontend:
        return frontend
    state = _onboarding_service().state()
    return RedirectResponse(state["next_url"], status_code=303)


@app.get("/prototype", response_class=HTMLResponse)
def prototype(request: Request) -> HTMLResponse:
    frontend = _canonical_frontend("/dashboard")
    if frontend:
        return frontend
    return templates.TemplateResponse(
        request,
        "prototype.html",
        {"data": PROTOTYPE_DATA},
    )


def _latest_job_scrape_artifact():
    store = JobScrapeArtifactStore(_ARTIFACT_ROOT / "job-finder-runs")
    return store.latest()


@app.get("/setup", response_class=HTMLResponse)
def setup(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "onboarding.html",
        {"initial_state": _onboarding_service().state()},
    )


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    frontend = _canonical_frontend("/jobs/automation")
    if frontend:
        return frontend
    if not _onboarding_service().state()["ready"]:
        return RedirectResponse("/setup", status_code=303)
    return templates.TemplateResponse(request, "job_finder_control.html", {})


@app.get("/job-finder-control")
def job_finder_control() -> RedirectResponse:
    return RedirectResponse("/dashboard", status_code=307)


class OnboardingCorrectionRequest(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)


class OnboardingPreferencesRequest(BaseModel):
    target: int = Field(ge=1, le=100)
    target_countries: list[str]
    work_mode: str
    employment_type: str
    safe_auto_start: bool


@app.get("/api/onboarding/state")
def api_onboarding_state() -> dict:
    return _onboarding_service().state()


@app.post("/api/onboarding/corrections/{field}")
def api_onboarding_correction(field: str, request: OnboardingCorrectionRequest):
    try:
        return _onboarding_service().save_correction(field, request.values)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.put("/api/onboarding/job-preferences")
def api_onboarding_preferences(request: OnboardingPreferencesRequest):
    try:
        return _onboarding_service().save_preferences(**request.model_dump())
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.post("/api/job-finder/auto-start")
def api_job_finder_auto_start():
    with _AUTO_START_LOCK:
        service = _onboarding_service()
        onboarding = service.state()
        if not onboarding["ready"]:
            return JSONResponse({"error": "Onboarding is not ready."}, status_code=409)
        preferences = onboarding.get("preferences") or {}
        if not preferences.get("safe_auto_start"):
            return {"started": False, "reason": "safe auto-start is disabled"}
        sessions = job_finder_control_state().get("sessions", {})
        indeed = sessions.get("job_sites", {}).get("indeed", {})
        if not indeed.get("connected"):
            return {"started": False, "reason": "verified Indeed session is not connected"}
        active = job_finder_goal_store().active()
        if active is not None:
            return {"started": False, "reason": "goal already active", "goal_id": active.id}
        activation_key = str(onboarding["activation_key"])
        prior_goal_id = str(onboarding.get("auto_started_goal_id", ""))
        if prior_goal_id:
            return {
                "started": False,
                "reason": "this onboarding revision already started a goal",
                "goal_id": prior_goal_id,
            }
        goal = create_job_finder_goal(
            target=int(preferences["target"]),
            target_countries=list(preferences["target_countries"]),
            work_mode=str(preferences["work_mode"]),
            employment_type=str(preferences["employment_type"]),
            employment_types=["full_time", "contract", "internship"],
            job_levels=["junior", "intern"],
            salary_target_mix={
                "below_20k": 35,
                "php_20k_40k": 50,
                "php_40k_80k": 10,
                "php_80k_plus": 5,
            },
            unknown_salary_policy="review_only",
        )
        service.mark_auto_started(activation_key, goal.id)
        return {"started": True, "goal_id": goal.id, "mode": "safe_draft_only"}


@app.get("/api/job-finder/control-state")
def api_job_finder_control_state() -> dict:
    return job_finder_control_state()


@app.get("/api/job-finder/market-fit")
def api_market_fit_state():
    return market_fit_state()


@app.put("/api/job-finder/market-fit/campaign")
def api_update_market_fit_campaign(request: MarketFitCampaign):
    return update_market_fit_campaign(request).model_dump(mode="json")


@app.post("/api/job-finder/market-fit/opportunities")
def api_create_market_fit_opportunity(request: MarketOpportunityCreate):
    return market_fit_store().create_opportunity(request).model_dump(mode="json")


@app.get("/api/job-finder/market-fit/opportunities/{opportunity_id}")
def api_market_fit_opportunity(opportunity_id: str):
    try:
        return market_fit_store().detail(opportunity_id)
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)


@app.put("/api/job-finder/market-fit/opportunities/{opportunity_id}")
def api_update_market_fit_opportunity(opportunity_id: str, request: MarketOpportunityUpdate):
    try:
        return (
            market_fit_store().update_opportunity(opportunity_id, request).model_dump(mode="json")
        )
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)


@app.post("/api/job-finder/market-fit/sync-submissions")
def api_sync_market_fit_submissions():
    created = market_fit_store().sync_confirmed_submissions()
    return {"created": created}


@app.post("/api/job-finder/market-fit/refresh")
def api_refresh_market_fit():
    repository = market_fit_store()
    return {"ghosted": repository.apply_ghosting()}


@app.post("/api/job-finder/market-fit/opportunities/{opportunity_id}/demands/draft")
def api_draft_market_fit_demands(opportunity_id: str):
    try:
        return draft_market_fit_demands(opportunity_id, get_configured_provider()).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)
    except (ValueError, LLMUnavailableError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.put("/api/job-finder/market-fit/opportunities/{opportunity_id}/demands")
def api_approve_market_fit_demands(opportunity_id: str, request: JobDemandDraft):
    try:
        return approve_market_fit_demands(opportunity_id, request).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)


@app.post("/api/job-finder/market-fit/opportunities/{opportunity_id}/assessment")
def api_assess_market_fit_opportunity(opportunity_id: str):
    try:
        return assess_market_fit_opportunity(opportunity_id).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/market-fit/opportunities/{opportunity_id}/events")
def api_add_market_fit_event(opportunity_id: str, request: FunnelEventCreate):
    try:
        return market_fit_store().add_event(opportunity_id, request).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)


@app.post("/api/job-finder/market-fit/opportunities/{opportunity_id}/interview-prep")
def api_prepare_market_fit_interview(opportunity_id: str):
    try:
        return prepare_market_fit_interview(opportunity_id, get_configured_provider()).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)
    except (ValueError, LLMUnavailableError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.put("/api/job-finder/market-fit/opportunities/{opportunity_id}/interview-prep/approve")
def api_approve_market_fit_interview(opportunity_id: str):
    try:
        return market_fit_store().approve_prep(opportunity_id).model_dump(mode="json")
    except KeyError:
        return JSONResponse({"error": "Unknown market-fit opportunity."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


class JobFinderGoalRequest(BaseModel):
    target: int = Field(ge=1)
    target_countries: list[str] = Field(default_factory=list)
    work_mode: str = "remote"
    employment_type: str = "contract"
    employment_types: list[str] = Field(
        default_factory=lambda: ["full_time", "contract", "internship"]
    )
    job_levels: list[str] = Field(default_factory=lambda: ["junior", "intern"])
    salary_target_mix: dict[str, int] = Field(
        default_factory=lambda: {
            "below_20k": 35,
            "php_20k_40k": 50,
            "php_40k_80k": 10,
            "php_80k_plus": 5,
        }
    )
    unknown_salary_policy: str = "review_only"


@app.post("/api/job-finder/goals")
def api_create_job_finder_goal(request: JobFinderGoalRequest):
    setup_error = _ai_setup_required_response()
    if setup_error:
        return setup_error
    try:
        goal = create_job_finder_goal(**request.model_dump())
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - local process/CDP failures are user-facing
        return JSONResponse({"error": f"Could not start goal: {exc}"}, status_code=503)
    return {**goal.model_dump(mode="json"), "remaining": goal.remaining}


@app.post("/api/job-finder/goals/{goal_id}/resume")
def api_resume_job_finder_goal(goal_id: str):
    setup_error = _ai_setup_required_response()
    if setup_error:
        return setup_error
    try:
        return launch_job_finder_goal(goal_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/goals/{goal_id}/cancel")
def api_cancel_job_finder_goal(goal_id: str):
    try:
        return stop_job_finder_goal(goal_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal."}, status_code=404)
    except Exception as exc:  # noqa: BLE001 - owned process cleanup must surface
        return JSONResponse({"error": f"Could not stop owned process tree: {exc}"}, status_code=503)


@app.post("/api/job-finder/goals/{goal_id}/items/{task_id}/confirm")
def api_confirm_job_finder_item(goal_id: str, task_id: str):
    try:
        goal = confirm_job_finder_item(goal_id, task_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal item."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    return {**goal.model_dump(mode="json"), "remaining": goal.remaining}


@app.post("/api/job-finder/goals/{goal_id}/items/{task_id}/release")
def api_release_job_finder_item(goal_id: str, task_id: str):
    try:
        goal = release_job_finder_item(goal_id, task_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal item."}, status_code=404)
    return {**goal.model_dump(mode="json"), "remaining": goal.remaining}


@app.post("/api/job-finder/goals/{goal_id}/items/{task_id}/review-approve")
def api_approve_job_finder_item_review(goal_id: str, task_id: str):
    try:
        goal = approve_job_finder_item_review(goal_id, task_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal item."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    return {**goal.model_dump(mode="json"), "remaining": goal.remaining}


@app.post("/api/job-finder/goals/{goal_id}/items/{task_id}/reopen")
def api_reopen_job_finder_goal_item(goal_id: str, task_id: str):
    try:
        return reopen_job_finder_goal_item(goal_id, task_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal item."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/goals/{goal_id}/items/{task_id}/retry")
def api_retry_job_finder_goal_item(goal_id: str, task_id: str):
    try:
        goal = retry_job_finder_item(goal_id, task_id)
    except KeyError:
        return JSONResponse({"error": "Unknown application goal item."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    return {**goal.model_dump(mode="json"), "remaining": goal.remaining}


@app.post("/api/job-finder/interventions/{entry_id}/confirm-submitted")
def api_confirm_external_intervention(entry_id: str):
    try:
        return confirm_external_intervention(entry_id)
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/development-questions/answers")
def api_accept_development_question_answer(response: DevelopmentQuestionResponse):
    bridge = DevelopmentQuestionBridge(_ARTIFACT_ROOT / "development-question-bridge")
    repository = None
    try:
        repository = MongoQuestionnaireRepository(
            DEFAULT_MONGODB_URI,
            database=DEFAULT_MONGODB_DATABASE,
        )
        repository.ping()
        accepted = bridge.accept(response, repository=repository)
    except KeyError:
        return JSONResponse({"error": "Unknown development question request."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - local development dependency failures are visible
        return JSONResponse(
            {"error": f"Could not accept development answer: {exc}"}, status_code=503
        )
    finally:
        if repository is not None:
            repository.close()
    from .job_finder_supervisor import goal_store, process_status

    goal = goal_store().active()
    if goal is not None and not process_status(goal.id)["running"]:
        launch_job_finder_goal(goal.id)
    return {"accepted": accepted, "request_id": response.request_id}


@app.get("/api/job-finder/targets/{target_id}/preview")
def api_job_finder_target_preview(target_id: str):
    try:
        image = capture_target_preview(target_id)
    except KeyError:
        return JSONResponse({"error": "Unknown or closed browser target."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - live CDP failures are user-facing
        return JSONResponse({"error": f"Could not capture preview: {exc}"}, status_code=503)
    return Response(image, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/job-finder/targets/{target_id}/focus")
def api_focus_job_finder_target(target_id: str):
    try:
        focus_job_finder_target(target_id)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - live CDP failures are user-facing
        return JSONResponse({"error": f"Could not focus browser target: {exc}"}, status_code=503)
    return {"focused": True}


@app.post("/api/job-finder/interventions/{entry_id}/focus")
def api_focus_job_finder_intervention(entry_id: str):
    try:
        focus_intervention(entry_id)
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - CDP/browser failures are user-facing state
        return JSONResponse({"error": f"Could not focus browser tab: {exc}"}, status_code=503)
    return {"focused": True}


@app.post("/api/job-finder/interventions/{entry_id}/reopen")
def api_reopen_job_finder_intervention(entry_id: str):
    try:
        return reopen_job_finder_intervention(entry_id)
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - browser launch failures are user-facing
        return JSONResponse({"error": f"Could not reopen browser tab: {exc}"}, status_code=503)


@app.post("/api/job-finder/interventions/{entry_id}/recheck")
def api_recheck_job_finder_intervention(entry_id: str):
    try:
        result = recheck_intervention(entry_id)
        if result.get("resolved"):
            from .job_finder_supervisor import goal_store, process_status

            retry_resolved_intervention(str(result.get("application_reference", "")))
            goal = goal_store().active()
            if goal is not None and not process_status(goal.id)["running"]:
                launch_job_finder_goal(goal.id)
        return result
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except Exception as exc:  # noqa: BLE001 - browser drift must surface without resolving
        return JSONResponse({"error": f"Could not recheck browser tab: {exc}"}, status_code=503)


@app.post("/api/job-finder/interventions/{entry_id}/release")
def api_release_job_finder_intervention(entry_id: str):
    try:
        return release_job_finder_intervention(entry_id)
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/interventions/{entry_id}/retry")
def api_retry_job_finder_intervention(entry_id: str):
    try:
        return retry_job_finder_intervention(entry_id)
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/interventions/{entry_id}/approve-question-answers")
def api_approve_job_finder_question_answers(entry_id: str):
    try:
        result = approve_question_answers(entry_id)
        retry_resolved_intervention(str(result.get("application_reference", "")))
        from .job_finder_supervisor import goal_store, process_status

        goal = goal_store().active()
        if goal is not None and not process_status(goal.id)["running"]:
            launch_job_finder_goal(goal.id)
        return result
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    except Exception as exc:  # noqa: BLE001 - local browser/storage failures are visible
        return JSONResponse(
            {"error": f"Could not approve questionnaire answers: {exc}"}, status_code=503
        )


@app.post("/api/job-finder/interventions/{entry_id}/approve-resume-gate")
def api_approve_job_finder_resume_gate(entry_id: str):
    try:
        result = approve_job_finder_resume_intervention(entry_id)
        retry_resolved_intervention(str(result.get("application_reference", "")))
        from .job_finder_supervisor import goal_store, process_status

        goal = goal_store().active()
        if goal is not None and not process_status(goal.id)["running"]:
            launch_job_finder_goal(goal.id)
        return result
    except KeyError:
        return JSONResponse({"error": "Unknown intervention."}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@app.post("/api/job-finder/sessions/{provider}/sign-in")
def api_start_job_site_session(provider: str):
    try:
        return start_job_site_session(provider)
    except KeyError:
        return JSONResponse({"error": f"Unsupported job-site session: {provider}"}, status_code=404)
    except Exception as exc:  # noqa: BLE001 - visible Chrome may be unavailable
        return JSONResponse({"error": f"Could not open sign-in tab: {exc}"}, status_code=503)


@app.post("/api/job-finder/sessions/{provider}/disconnect")
def api_disconnect_job_finder_session(provider: str, website_logout: bool = False):
    try:
        return disconnect_job_finder_provider(provider, website_logout=website_logout)
    except KeyError:
        return JSONResponse({"error": f"Unknown provider: {provider}"}, status_code=404)
    except Exception as exc:  # noqa: BLE001 - visible Chrome may be unavailable
        return JSONResponse({"error": f"Could not disconnect provider: {exc}"}, status_code=503)


@app.get("/api/job-scraping/latest")
def api_latest_job_scraping():
    artifact = _latest_job_scrape_artifact()
    if artifact is None:
        return JSONResponse({"error": "No real job-scraping artifact is available."}, status_code=404)
    return artifact.model_dump(mode="json")


@app.get("/api/auth/status")
def api_auth_status() -> dict:
    status = auth_status()
    status["oauth_setup"] = provider_configuration_status()
    with _LOGIN_JOBS_LOCK:
        status["jobs"] = dict(_LOGIN_JOBS)
    return status


@app.get("/auth/{provider}/start")
def auth_start(provider: str):
    if provider not in IDENTITY_PROVIDERS:
        return JSONResponse({"error": f"Unknown provider: {provider}"}, status_code=404)
    try:
        return RedirectResponse(build_authorize_url(provider), status_code=302)
    except OAuthSetupError as exc:
        return JSONResponse(
            {
                "error": str(exc),
                "provider": provider,
                "setup_required": True,
            },
            status_code=400,
        )


@app.get("/auth/{provider}/callback")
def auth_callback(provider: str, code: str = "", state: str = ""):
    if provider not in IDENTITY_PROVIDERS:
        return JSONResponse({"error": f"Unknown provider: {provider}"}, status_code=404)
    if not code or not state:
        return JSONResponse({"error": "Missing OAuth code or state."}, status_code=400)
    try:
        complete_oauth_callback(provider, code, state)
    except OAuthSetupError as exc:
        return JSONResponse({"error": str(exc), "setup_required": True}, status_code=400)
    except OAuthStateError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except OAuthExchangeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    except Exception as exc:  # noqa: BLE001 - OAuth providers can fail in many ways
        return JSONResponse({"error": f"OAuth callback failed: {exc}"}, status_code=502)
    return RedirectResponse("/#dashboard", status_code=302)


@app.get("/api/resumes")
def api_resumes() -> dict[str, list[dict[str, object]]]:
    return {"items": _list_generated_resumes()}


@app.get("/api/metrics")
def api_metrics() -> dict[str, int]:
    """Read the aggregate usage counters (downloads, pages scraped)."""
    return read_counters(_COUNTERS_PATH).model_dump()


@app.post("/api/metrics/download")
def api_metrics_download() -> dict[str, int]:
    """Frontend hook: +1 each time a resume is downloaded/exported.

    NOTE: read-modify-write, so concurrent calls can lose an update. Accepted for
    now; the atomic fix is tracked in the GitHub Projects backlog.
    """
    return bump_download(_COUNTERS_PATH).model_dump()


@app.post("/api/metrics/pages")
def api_metrics_pages(pages: int = 1) -> dict[str, int]:
    """Frontend hook: +N pages scraped (defaults to +1). Same race caveat applies."""
    if pages < 0:
        return JSONResponse({"error": "pages must be >= 0"}, status_code=400)
    return add_pages_scraped(pages, _COUNTERS_PATH).model_dump()


@app.post("/api/cdo/advisor/analyze")
def api_cdo_advisor_analyze(payload: AdvisorAnalyzeRequest):
    try:
        result = analyze_for_injection(payload, get_configured_provider())
    except LLMUnavailableError as exc:
        return JSONResponse(
            {
                "error": str(exc),
                "setup_required": True,
                "hint": "Set LLM_PROVIDER plus the provider API key before running AI tagging.",
            },
            status_code=503,
        )
    except Exception as exc:  # noqa: BLE001 - API should surface provider/schema failures
        return JSONResponse({"error": f"CDO advisor analysis failed: {exc}"}, status_code=502)
    return result.model_dump(mode="json")


@app.post("/api/auth/disconnect/{provider}")
def disconnect_identity(provider: str) -> dict[str, object]:
    if provider not in IDENTITY_PROVIDERS:
        return JSONResponse({"error": f"Unknown provider: {provider}"}, status_code=404)
    cleared = IdentityStore().clear_profile(provider)
    return {"provider": provider, "cleared": cleared}


@app.post("/api/social-login/{vendor}")
def start_social_login(vendor: str) -> dict[str, str]:
    if vendor not in SOCIAL_VENDORS:
        return JSONResponse({"error": f"Unknown vendor: {vendor}"}, status_code=404)
    job_id = uuid.uuid4().hex
    _set_job(
        job_id,
        {
            "id": job_id,
            "vendor": vendor,
            "status": "queued",
            "message": "Waiting to open visible browser login.",
        },
    )
    thread = threading.Thread(
        target=_run_social_login_job,
        args=(job_id, vendor),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/social-login/jobs/{job_id}")
def social_login_job(job_id: str):
    with _LOGIN_JOBS_LOCK:
        job = _LOGIN_JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "Unknown job."}, status_code=404)
    return job


@app.post("/api/social-login/{vendor}/disconnect")
def disconnect_social(vendor: str) -> dict[str, object]:
    if vendor not in SOCIAL_VENDORS:
        return JSONResponse({"error": f"Unknown vendor: {vendor}"}, status_code=404)
    cleared = clear_social_session(vendor)
    return {"vendor": vendor, "cleared": cleared}


@app.get("/build-form", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    settings = get_settings()
    roles = StaticRolePicker(settings.roles_path).list_available()
    return templates.TemplateResponse(
        request,
        "index.html",
        {"roles": roles},
    )


@app.post("/build", response_class=HTMLResponse)
async def build_view(
    request: Request,
    mode: Annotated[str, Form()],
    gh_user: Annotated[str, Form()],
    role: Annotated[str, Form()] = "",
    role_prompt: Annotated[str, Form()] = "",
    formats: Annotated[str, Form()] = "latex,md,json,pdf",
    docs: Annotated[UploadFile | None, File()] = None,
) -> HTMLResponse:
    if not local_ai_status()["configured"]:
        return templates.TemplateResponse(
            request,
            "result.html",
            {
                "error": "AI setup is required in Settings before the resume builder can run.",
                "files": [],
            },
            status_code=409,
        )
    mode_enum = Mode(mode)
    selection = role_prompt if mode_enum == Mode.AI else role
    if not selection:
        return templates.TemplateResponse(
            request,
            "result.html",
            {"error": "Role selection is required.", "files": []},
            status_code=400,
        )

    job_dir = _OUTPUT_ROOT / f"job-{abs(hash((gh_user, selection, formats)))}"
    if job_dir.exists():
        shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True)

    docs_path: Path | None = None
    if docs and docs.filename:
        docs_path = job_dir / docs.filename
        with open(docs_path, "wb") as fp:
            fp.write(await docs.read())

    try:
        pipeline = Pipeline(mode=mode_enum)
        result = pipeline.run(
            BuildInputs(
                gh_user=gh_user,
                role_selection=selection,
                docs_path=docs_path,
                formats=[f.strip() for f in formats.split(",") if f.strip()],
                output_dir=job_dir,
            )
        )
    except Exception as exc:
        return templates.TemplateResponse(
            request,
            "result.html",
            {"error": str(exc), "files": []},
            status_code=500,
        )

    files = [
        {"name": p.name, "url": f"/files/{job_dir.name}/{p.name}"} for p in result.output_paths
    ]
    return templates.TemplateResponse(
        request,
        "result.html",
        {
            "files": files,
            "resume": result.resume,
            "error": None,
        },
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def _list_generated_resumes() -> list[dict[str, object]]:
    resumes_root = _ARTIFACT_ROOT / "resumes"
    if not resumes_root.exists():
        return []
    items: list[dict[str, object]] = []
    for role_dir in sorted(path for path in resumes_root.iterdir() if path.is_dir()):
        formats: dict[str, str] = {}
        newest = 0.0
        for ext in ("html", "json", "md", "pdf", "tex"):
            file_path = role_dir / f"resume.{ext}"
            if not file_path.exists():
                continue
            formats[ext] = f"/artifacts/resumes/{role_dir.name}/resume.{ext}"
            newest = max(newest, file_path.stat().st_mtime)
        if formats:
            items.append(
                {
                    "role_id": role_dir.name,
                    "formats": formats,
                    "updated_at": newest,
                }
            )
    return sorted(items, key=lambda item: float(item["updated_at"]), reverse=True)


def _set_job(job_id: str, payload: dict[str, str]) -> None:
    with _LOGIN_JOBS_LOCK:
        _LOGIN_JOBS[job_id] = payload


def _run_social_login_job(job_id: str, vendor: str) -> None:
    _set_job(
        job_id,
        {
            "id": job_id,
            "vendor": vendor,
            "status": "running",
            "message": "Visible browser login is open. Complete sign-in in Chrome.",
        },
    )
    os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_VISUAL", "1")
    os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_DELAY_MS", "700")
    os.environ.setdefault("RESUME_BUILD_PLAYWRIGHT_CDP_URL", "http://127.0.0.1:9222")
    os.environ.setdefault("RESUME_BUILD_LINKEDIN_GOOGLE_LOGIN", "1")
    store = SessionStore()
    try:
        result = open_login_window(
            vendor,
            prefill_username=preferred_identity_email(),
            on_twofa_detected=lambda v: _set_job(
                job_id,
                {
                    "id": job_id,
                    "vendor": v,
                    "status": "running",
                    "message": "Two-factor prompt detected. Enter the code in the open browser.",
                },
            ),
        )
        store.save(vendor, result.cookies)
        if result.storage_state is not None:
            store.save_storage_state(vendor, result.storage_state)
    except PlaywrightNotInstalled as exc:
        _set_job(
            job_id,
            {"id": job_id, "vendor": vendor, "status": "failed", "message": str(exc)},
        )
        return
    except Exception as exc:  # noqa: BLE001 - surfaced as job state to the UI
        message = str(exc).strip() or repr(exc)
        _set_job(
            job_id,
            {
                "id": job_id,
                "vendor": vendor,
                "status": "failed",
                "message": f"{vendor} login failed ({type(exc).__name__}): {message}",
                "traceback": traceback.format_exc(limit=6),
            },
        )
        return
    _set_job(
        job_id,
        {
            "id": job_id,
            "vendor": vendor,
            "status": "success",
            "message": f"{vendor} session saved for future scraping.",
        },
    )
