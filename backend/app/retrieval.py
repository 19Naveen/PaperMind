"""Hybrid retrieval: pgvector cosine + Postgres ts_rank, merged with Reciprocal Rank
Fusion. One function (`search`) returns ranked chunk ids — the swap point for OpenSearch
is this file, and only once recall on a real Pack measurably suffers."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.llm import get_providers
from app.models import Chunk

RRF_K = 60
TOP_K = 8
LIMIT_EACH = 30


def _semantic_ids(
    db: Session, query_vec: list[float], doc_ids: list[uuid.UUID], k: int
) -> list[uuid.UUID]:
    stmt = (
        select(Chunk.id)
        .where(or_(*[Chunk.document_id == d for d in doc_ids]))
        .order_by(Chunk.embedding.cosine_distance(query_vec))
        .limit(k)
    )
    return list(db.scalars(stmt).all())


def _keyword_ids(db: Session, query: str, doc_ids: list[uuid.UUID], k: int) -> list[uuid.UUID]:
    q = func.plainto_tsquery("english", query)
    stmt = (
        select(Chunk.id)
        .where(or_(*[Chunk.document_id == d for d in doc_ids]), Chunk.tsv.op("@@")(q))
        .order_by(func.ts_rank(Chunk.tsv, q).desc())
        .limit(k)
    )
    return list(db.scalars(stmt).all())


def _rrf(ranked_lists: list[list[uuid.UUID]]) -> list[uuid.UUID]:
    scores: dict[uuid.UUID, float] = {}
    for ranked in ranked_lists:
        for rank, chunk_id in enumerate(ranked, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank)
    return sorted(scores, key=lambda c: scores[c], reverse=True)


def search(
    db: Session, query: str, document_ids: list[uuid.UUID], k: int = TOP_K
) -> list[uuid.UUID]:
    """Ranked chunk ids by RRF over the semantic and keyword channels."""
    if not document_ids or not query.strip():
        return []
    q_vec = get_providers().embedder.embed_query(query)
    semantic = _semantic_ids(db, q_vec, document_ids, LIMIT_EACH)
    keyword = _keyword_ids(db, query, document_ids, LIMIT_EACH)
    return _rrf([semantic, keyword])[:k]
