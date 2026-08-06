"""Hybrid retrieval: the keyword channel and the semantic channel each surface the right
chunk, and RRF keeps both in the final ranking."""

from __future__ import annotations

from app.services.retrieval import search
from tests.util import ingest_text

DOC_A = ["The corporate governance report mentions zephyr and quarterly projections."]
DOC_B = ["Vendor application form. Extraordinary clause in zebra-pattern indemnities."]
DOC_C = ["Nothing but tax filings and receipts, mostly dubious."]


def test_semantic_channel_surfaces_the_identical_chunk(db):
    a = ingest_text(db, "a.txt", DOC_A)
    b = ingest_text(db, "b.txt", DOC_B)
    c = ingest_text(db, "c.txt", DOC_C)
    ids = [a.id, b.id, c.id]

    exact_phrase = DOC_A[0]
    ranked = search(db, exact_phrase, ids, k=1)
    assert ranked == [a.chunks[0].id], "semantic-only query must retrieve the matching chunk"


def test_keyword_channel_surfaces_the_unique_term(db):
    a = ingest_text(db, "a.txt", DOC_A)
    b = ingest_text(db, "b.txt", DOC_B)
    c = ingest_text(db, "c.txt", DOC_C)
    ids = [a.id, b.id, c.id]

    ranked = search(db, "zebra-patterned", ids, k=1)
    assert ranked == [b.chunks[0].id]


def test_rrf_keeps_both_channels_present(db):
    a = ingest_text(db, "a.txt", DOC_A)
    b = ingest_text(db, "b.txt", DOC_B)
    c = ingest_text(db, "c.txt", DOC_C)
    ids = [a.id, b.id, c.id]

    ranked = search(db, "governance zebra", ids, k=5)
    # "governance" lives in A, "zebra" in B — RRF must surface both, not just one.
    assert {a.chunks[0].id, b.chunks[0].id} <= set(ranked)


def test_search_without_documents_returns_nothing(db):
    assert search(db, "anything", [], k=5) == []


def search_query(db, query, ids, k):
    from app.services.retrieval import search

    return search(db, query, ids, k=k)
