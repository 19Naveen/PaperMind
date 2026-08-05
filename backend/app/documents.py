"""Document upload and source-text endpoints. Upload runs the full ingest pipeline
(parse -> chunk -> embed -> store) so a run never touches a blob."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, File, UploadFile
from sqlalchemy.orm import Session

import app.schemas as s
from app.db import DB
from app.errors import ApiError, Code
from app.ingest import store_document
from app.models import Document
from app.storage import save_blob

router = APIRouter(prefix="/documents", tags=["documents"])
log = logging.getLogger(__name__)


def _get_document(db: Session, document_id: uuid.UUID) -> Document:
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError(Code.DOCUMENT_NOT_FOUND, "Document not found.", 404)
    return doc


# Plain `def`, not `async def`: the whole body is blocking (sync SQLAlchemy session plus
# embedding inference). FastAPI runs it in its threadpool instead of stalling the event
# loop for every other request on the worker (CLAUDE.md §3.2).
@router.post("", response_model=s.DocumentOut, status_code=201)
def upload_document(db: DB, file: UploadFile = File(...)) -> s.DocumentOut:  # noqa: B008 # FastAPI injects the UploadFile; File(...) must be a default
    data = file.file.read()
    if not data:
        raise ApiError(Code.EMPTY_FILE, "The uploaded file is empty.", 422)
    blob_path = save_blob(data, file.filename or "upload")
    doc = Document(
        name=file.filename or "upload.pdf",
        content_type=file.content_type,
        blob_path=blob_path,
    )
    try:
        store_document(db, doc, data, file.content_type)
    except Exception as exc:
        # The parser's message can carry file internals — log it, don't return it.
        log.exception("document parse failed: name=%s type=%s", doc.name, file.content_type)
        raise ApiError(
            Code.DOCUMENT_PARSE_FAILED,
            "The document could not be read. Upload a valid PDF or text file.",
            422,
        ) from exc
    return s.DocumentOut(id=doc.id, name=doc.name, content_type=doc.content_type)


@router.get("/{document_id}", response_model=s.DocumentOut)
def get_document(document_id: uuid.UUID, db: DB) -> s.DocumentOut:
    doc = _get_document(db, document_id)
    return s.DocumentOut(id=doc.id, name=doc.name, content_type=doc.content_type)


@router.get("/{document_id}/content", response_model=s.DocumentContent)
def get_document_content(document_id: uuid.UUID, db: DB) -> s.DocumentContent:
    """Source text + page offsets — everything the EvidenceViewer highlight needs."""
    doc = _get_document(db, document_id)
    return s.DocumentContent(id=doc.id, name=doc.name, text=doc.text, pages=doc.pages)
