"""ShadowGuard AI — FastAPI application.

Route → role matrix (OWASP A01, Broken Access Control):

    GET  /api/health                              public (no data, no DB detail)
    GET  /api/v1/dashboard                        viewer, admin
    GET  /api/v1/apps                             viewer, admin
    GET  /api/v1/vendors/{id}                     viewer, admin
    POST /api/v1/telemetry                        ingest, admin
    POST /api/v1/vendors/{id}/analyze             admin  (persist=false → dry run, no writes)
    POST /api/v1/apps/{id}/block-proposals        admin  (queues a proposal; never blocks by itself)
    POST /api/v1/remediations/{id}/decision       admin
    POST /api/v1/remediations/{id}/advance        admin
    GET  /api/v1/audit                            admin
    GET  /api/v1/audit/verify                     admin
    POST /api/v1/pipeline/recompute               admin
    POST /api/v1/rate-limit                       viewer, admin  (the dashboard server's shared sign-in limits)
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from . import __version__, service
from . import repository as repo
from .config import get_settings
from .db import DatabaseNotConfigured, get_connection
from .fetcher import FetchError, UnsafeURLError, fetch_policy_text
from .models import (AdvanceRemediationRequest, AnalyseRequest, BlockProposalRequest, DecisionRequest,
                     RateLimitRequest, Severity, SortKey, TelemetryBatch)
from .scoring import severity_for
from .security import SECURITY_HEADERS, Principal, require_role

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("shadowguard.api")

settings = get_settings()

# OWASP A05: interactive docs expose the whole attack surface; off unless asked for.
app = FastAPI(
    title="ShadowGuard AI API",
    version=__version__,
    docs_url="/api/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
)

if settings.allowed_origins:
    # The dashboard calls this API server-to-server, so CORS is off by default.
    # Only explicit https origins from ALLOWED_ORIGINS are ever allowed.
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["X-API-Key", "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )

MAX_BODY_BYTES = 1_000_000  # 1 MB; the largest legitimate body is a 200k-char policy


def _harden(response: Response, request_id: str) -> Response:
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def hardening(request: Request, call_next):
    request_id = uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            length = int(declared)
        except ValueError:
            return _harden(JSONResponse({"detail": "Invalid Content-Length"}, status_code=400), request_id)
        if length < 0:
            return _harden(JSONResponse({"detail": "Invalid Content-Length"}, status_code=400), request_id)
        if length > MAX_BODY_BYTES:
            return _harden(JSONResponse({"detail": "Request body too large"}, status_code=413), request_id)
    elif request.method == "POST" and "chunked" in request.headers.get("transfer-encoding", "").lower():
        # Refuse unbounded streamed bodies; legitimate clients send a length.
        return _harden(JSONResponse({"detail": "Content-Length required"}, status_code=411), request_id)
    return _harden(await call_next(request), request_id)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Return field locations and messages, but never echo the submitted values
    # back (avoids reflecting attacker-controlled input).
    errors = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()][:20]
    return JSONResponse({"detail": "Validation failed", "errors": jsonable_encoder(errors)}, status_code=422)


@app.exception_handler(DatabaseNotConfigured)
async def db_not_configured(request: Request, exc: DatabaseNotConfigured):
    log.error("Database configuration error: %s", exc)
    return JSONResponse({"detail": "Service not configured"}, status_code=503)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    # OWASP A05/A09: log the full error server-side, return nothing internal.
    request_id = getattr(request.state, "request_id", "unknown")
    log.exception("Unhandled error (request %s)", request_id)
    # This handler runs outside the hardening middleware, so it adds the headers itself.
    return _harden(JSONResponse({"detail": "Internal error", "request_id": request_id}, status_code=500), request_id)


Id = Annotated[int, Path(ge=1, le=2_147_483_647)]
viewer = require_role("viewer", "admin")
ingestor = require_role("ingest", "admin")
admin = require_role("admin")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/v1/dashboard")
def get_dashboard(_: Principal = Depends(viewer)):
    with get_connection() as conn:
        return service.dashboard(conn)


@app.get("/api/v1/live")
def get_live(
    _: Principal = Depends(viewer),
    after_id: Annotated[int, Query(ge=0, le=9_000_000_000_000_000_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """Cheap enough to poll every few seconds: the newest traffic, and a revision that says when to refetch the rest."""
    with get_connection() as conn:
        return repo.live_feed(conn, after_id, limit)


@app.get("/api/v1/apps")
def list_apps(
    _: Principal = Depends(viewer),
    severity: Severity | None = None,
    sort: SortKey = "exposure",
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    with get_connection() as conn:
        apps = repo.shadow_apps(conn, severity=severity, sort=sort, limit=limit,
                                window_days=get_settings().exposure_window_days)
    for a in apps:
        a["severity"] = severity_for(a["max_score"])
    return {"apps": apps}


@app.get("/api/v1/vendors/{vendor_id}")
def get_vendor(vendor_id: Id, _: Principal = Depends(viewer)):
    with get_connection() as conn:
        try:
            detail = service.vendor_detail(conn, vendor_id)
        except service.NotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found") from None
    detail.pop("policy_text", None)
    return detail


@app.post("/api/v1/telemetry", status_code=status.HTTP_202_ACCEPTED)
def ingest(batch: TelemetryBatch, principal: Principal = Depends(ingestor)):
    with get_connection() as conn:
        result = service.ingest_telemetry(conn, batch.events)
        repo.audit(conn, principal.role, principal.key_fingerprint, "telemetry.ingest", "telemetry_events",
                   {"accepted": result["accepted"], "pairs": result["pairs_rescored"]})
        return result


@app.post("/api/v1/vendors/{vendor_id}/analyze")
def analyse(vendor_id: Id, body: AnalyseRequest, principal: Principal = Depends(admin)):
    with get_connection() as conn:
        try:
            policy_url, stored_text = service.vendor_policy_source(conn, vendor_id)
        except service.NotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found") from None

    if body.policy_text:
        text, source = body.policy_text, "submitted"
    elif body.fetch:
        if not policy_url:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vendor has no policy URL")
        try:
            # Fetched outside any DB transaction so a slow site cannot hold a connection.
            text, source = fetch_policy_text(policy_url), "fetched"
        except UnsafeURLError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Policy URL failed the SSRF safety check") from None
        except FetchError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not fetch policy: {exc}") from None
    elif stored_text:
        text, source = stored_text, "stored"
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No policy text available; submit policy_text")

    with get_connection() as conn:
        if body.persist:
            result = service.analyse_vendor(conn, vendor_id, text)
        else:
            result = service.preview_policy(conn, vendor_id, text)
        repo.audit(conn, principal.role, principal.key_fingerprint,
                   "vendor.analyse" if body.persist else "vendor.analyse.dry_run", f"vendor:{vendor_id}",
                   {"source": source, "posture": result["posture_score"],
                    "injection_flags": len(result["injection_flags"])})
    result["source"] = source
    return result


@app.post("/api/v1/apps/{app_id}/block-proposals", status_code=status.HTTP_201_CREATED)
def propose_block(app_id: Id, body: BlockProposalRequest, principal: Principal = Depends(admin)):
    """An administrator queues a block proposal by hand. Deciding it is a separate call, below."""
    actor = f"admin:{principal.key_fingerprint[:8]}"
    with get_connection() as conn:
        try:
            result = service.propose_block(conn, app_id, body.department, body.reason, actor)
        except service.NotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
        except service.Conflict as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
        repo.audit(conn, principal.role, principal.key_fingerprint, "remediation.propose",
                   f"app:{app_id}", {"remediation_id": result["id"], "department": result["department"],
                                     "reason_len": len(body.reason)})
        return result


@app.post("/api/v1/remediations/{action_id}/decision")
def decide(action_id: Id, body: DecisionRequest, principal: Principal = Depends(admin)):
    actor = f"admin:{principal.key_fingerprint[:8]}"
    with get_connection() as conn:
        try:
            result = service.decide_remediation(conn, action_id, body.decision, actor, body.note)
        except service.NotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation action not found") from None
        except service.Forbidden as exc:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from None
        except service.Conflict as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
        repo.audit(conn, principal.role, principal.key_fingerprint, f"remediation.{body.decision}",
                   f"remediation:{action_id}", {"note_len": len(body.note)})
        return result


@app.post("/api/v1/remediations/{action_id}/advance")
def advance_remediation(action_id: Id, body: AdvanceRemediationRequest, principal: Principal = Depends(admin)):
    actor = f"admin:{principal.key_fingerprint[:8]}"
    with get_connection() as conn:
        try:
            result = service.advance_remediation(conn, action_id, body.stage, actor, body.note)
        except service.NotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Remediation action not found") from None
        except service.Conflict as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
        repo.audit(conn, principal.role, principal.key_fingerprint, f"remediation.{body.stage}",
                   f"remediation:{action_id}", {"note_len": len(body.note)})
        return result


@app.get("/api/v1/audit")
def list_audit(
    _: Principal = Depends(admin),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    with get_connection() as conn:
        return {
            "entries": repo.list_audit(conn, limit),
            "verification": service.verify_audit(conn),
        }


@app.get("/api/v1/audit/verify")
def verify_audit(_: Principal = Depends(admin)):
    with get_connection() as conn:
        return service.verify_audit(conn)


@app.post("/api/v1/pipeline/recompute")
def recompute(principal: Principal = Depends(admin)):
    with get_connection() as conn:
        result = service.recompute_all(conn)
        repo.audit(conn, principal.role, principal.key_fingerprint, "pipeline.recompute", "all", result)
        return result


@app.post("/api/v1/rate-limit")
def rate_limit(body: RateLimitRequest, _: Principal = Depends(viewer)):
    """Sign-in limits shared by every instance of the dashboard's server (OWASP A07).

    Not audited: it moves counters, not decisions. Buckets arrive hashed, so no IP is stored.
    """
    with get_connection() as conn:
        allowed = service.shared_rate_limit(conn, [(c.bucket, c.limit, c.window_seconds) for c in body.checks])
    return {"allowed": allowed}
