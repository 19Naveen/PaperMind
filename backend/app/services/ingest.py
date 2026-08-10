"""Ingestion pipeline: upload -> parse -> flatten (with page offsets) -> chunk -> embed.

The `text` column on chunks and the DocumentContent returned by the API both use the
*same* flattened text, so a citation's char_start/char_end always point into the text the
EvidenceViewer renders. Page boundaries are recorded as offsets into that text, and a
window never crosses a page boundary, so a citation's page number is authoritative.
"""

from __future__ import annotations

import io

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Chunk, Document
from app.services.llm import get_providers

PAGE_BREAK = "\n\n"
CHUNK_SIZE = 900
CHUNK_OVERLAP = 150


def parse_pdf(data: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("[page text could not be decoded]")
    return pages


def parse_document(data: bytes, content_type: str | None) -> list[str]:
    if content_type == "application/pdf":
        return parse_pdf(data)
    return [data.decode("utf-8", errors="replace")]


def flatten_pages(page_texts: list[str]) -> tuple[str, list[dict[str, int]]]:
    text = ""
    pages: list[dict[str, int]] = []
    for i, page_text in enumerate(page_texts):
        pages.append({"page": i + 1, "char_start": len(text)})
        text += page_text
        if i < len(page_texts) - 1:
            text += PAGE_BREAK
    return text, pages


def chunk_text(text: str, pages: list[dict[str, int]]) -> list[tuple[int, int, int, str]]:
    """Split the flattened text into fixed-size, page-aligned windows.

    Returns (page, char_start, char_end, text) with offsets into `text` (the same string
    returned by /documents/{id}/content).
    """
    page_bounds = [p["char_start"] for p in pages] + [len(text)]
    out: list[tuple[int, int, int, str]] = []
    for idx, page in enumerate(pages):
        page_start = page_bounds[idx]
        page_end = page_bounds[idx + 1] - 2 if idx + 1 < len(page_bounds) else len(text)
        if page_end < page_start:
            page_end = page_start
        window_start = page_start
        while window_start < page_end:
            window_end = min(window_start + CHUNK_SIZE, page_end)
            out.append((page["page"], window_start, window_end, text[window_start:window_end]))
            step = CHUNK_SIZE - CHUNK_OVERLAP
            if step <= 0:
                break
            window_start += step
    return [c for c in out if c[3].strip()]


def store_document(db: Session, document: Document, data: bytes, content_type: str | None) -> None:
    """Parse, chunk, embed, and insert. Everything is computed up front so a run never
    touches a document blob again."""
    page_texts = parse_document(data, content_type)
    text, pages = flatten_pages(page_texts)
    chunks = chunk_text(text, pages)
    embeds = get_providers().embedder.embed_documents([c[3] for c in chunks])

    document.text = text
    document.pages = pages
    db.add(document)
    db.flush()

    for i, (page, start, end, window) in enumerate(chunks):
        db.add(
            Chunk(
                document_id=document.id,
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
