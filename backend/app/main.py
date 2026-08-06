from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routers.auth import router as auth_router
from app.api.v1.routers.documents import router as documents_router
from app.api.v1.routers.packs import router as packs_router
from app.api.v1.routers.runs import router as runs_router
from app.api.v1.routers.studio import router as studio_router
from app.api.v1.routers.workspaces import router as workspaces_router
from app.core.config import get_settings
from app.core.errors import install_error_handlers

settings = get_settings()

app = FastAPI(title=settings.project_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Explicit allowlist from settings. Never "*": the frontend sends cookies, and
    # browsers reject wildcard origins on credentialed requests (CLAUDE.md §5).
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One error shape for the whole API: {"error": {"code", "message", "details"}} —
# registered here so no router hand-rolls its own envelope (CLAUDE.md §3.4).
install_error_handlers(app)

app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(packs_router)
app.include_router(documents_router)
app.include_router(runs_router)
app.include_router(studio_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "model": settings.model_id}
