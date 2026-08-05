from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.documents import router as documents_router
from app.packs import router as packs_router
from app.runs import router as runs_router
from app.studio import router as studio_router

settings = get_settings()

app = FastAPI(title=settings.project_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(packs_router)
app.include_router(documents_router)
app.include_router(runs_router)
app.include_router(studio_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "model": settings.model_id}
