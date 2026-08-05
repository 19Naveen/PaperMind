"""Shared helpers for building documents in tests (no API, straight to the DB)."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ingest import chunk_text, flatten_pages
from app.llm import get_providers
from app.models import Chunk, Document


def ingest_text(db: Session, name: str, page_texts: list[str]) -> Document:
    """Index a text document the way upload would, with the fake embedder."""
    text, pages = flatten_pages(page_texts)
    chunks = chunk_text(text, pages)
    embeds = get_providers().embedder.embed_documents([c[3] for c in chunks])

    doc = Document(
        name=name, content_type="text/plain", blob_path="test-blob", text=text, pages=pages
    )
    db.add(doc)
    db.flush()
    for i, (page, start, end, window) in enumerate(chunks):
        db.add(
            Chunk(
                document_id=doc.id,
                position=i,
                page=page,
                char_start=start,
                char_end=end,
                text=window,
                embedding=embeds[i],
                tsv=func.to_tsvector("english", window),
            )
        )
    db.commit()
    db.refresh(doc)
    return doc


def make_spec(
    name: str, document_types: list[str], fields: list[dict], rules: list[dict] | None = None
):
    from app.schemas import PackField, PackRule, PackSpec

    return PackSpec(
        name=name,
        document_types=document_types,
        fields=[PackField(**f) for f in fields],
        rules=[PackRule(**r) for r in (rules or [])],
    )
