# Backend Restructure Plan

Target: the architecture in `README.md`. Current backend is a Streamlit RAG demo;
this is a rewrite beside it, not a refactor of it.

## Guiding constraint

The README's own rule — *"which existing Knowledge Pack cannot be implemented
without this capability?"* — is applied to the infrastructure too. Phase 1 ships
**one datastore**. OpenSearch, MinIO, Celery, and the graph engine are deferred
until a real Pack fails without them. Each has a named swap point below.

## Target layout

```
backend/
  main.py         FastAPI app, routers, /healthz
  config.py       pydantic-settings (DB url, API keys, storage dir)
  db.py           SQLAlchemy engine + session dependency
  models.py       Pack, PackVersion, Run, Document, Chunk, Fact, Citation, Correction
  packs.py        Pydantic KnowledgePack spec + CRUD routes (the contract)
  ingest.py       upload -> store blob -> parse -> chunk -> embed
  retrieval.py    hybrid search (tsvector BM25 + pgvector cosine, RRF merge)
  runtime.py      the six stages, in order, no branching on LLM output
  studio.py       authoring: LLM conversation -> draft Pack -> human approve
  llm.py          provider abstraction (temperature=0 for runtime, >0 for studio)
  storage.py      save_blob/read_blob — local fs now, S3 later
```

Twelve files. No `services/`, `repositories/`, or `interfaces/` layer — one
implementation each, add indirection when there are two.

## Data model (the part that must be right)

Everything else is replaceable; get this wrong and audit trails are worthless.

- `packs` — identity only (id, org, name).
- `pack_versions` — `(pack_id, version)` unique, `spec JSONB`, `created_at`.
  **Append-only.** Enforce with a DB trigger rejecting UPDATE/DELETE, not app
  code. This is README principle 6 and it cannot live in Python.
- `runs` — `pack_version_id` (FK, not `pack_id`), `model_id`, `status`,
  `started_at`. Every run pins the exact spec *and* model that produced it.
- `documents` / `chunks` — chunk carries `doc_id, page, char_start, char_end,
  text, embedding vector, tsv tsvector`. Offsets are what makes a citation
  checkable rather than decorative.
- `facts` — `run_id, field, value, state ∈ {verified, unsupported, missing}`.
  A fact with `state=verified` and no citation row must be impossible: enforce
  with a CHECK/trigger. "No citation, no result" is a constraint, not a habit.
- `citations` — `fact_id, chunk_id, quote, char_start, char_end`.
- `corrections` — `run_id, fact_id, user_value, created_at`. Written, never
  applied. Feeds the v2 diff proposal in Phase 4.

## Phases

### Phase 1 — Skeleton + Packs (the contract first)

FastAPI app, Postgres via SQLAlchemy + Alembic, the schema above, and the
`KnowledgePack` Pydantic model. Routes: create pack, save version, get version,
list. No execution yet.

Doing the Pack schema first is deliberate — it's the interface every other
component codes against, and it's the cheapest thing to get wrong now and
expensive later.

**Check:** `test_packs.py` — save a version, attempt to mutate it, assert the DB
rejects it.

### Phase 2 — Ingest + Retrieval

Upload endpoint → `storage.save_blob` → parse (PyPDF) → chunk (port
`create_chunks`, keep the offset metadata, drop the rest) → embed → insert
chunks.

Retrieval is `pgvector` cosine + Postgres `ts_rank` in one query, merged with
Reciprocal Rank Fusion (~15 lines of SQL/Python). No OpenSearch, no reranker
model in Phase 1.

> `# ponytail: pgvector + ts_rank instead of OpenSearch. Swap retrieval.py's
> search() when recall on a real Pack measurably suffers — the interface is one
> function returning ranked chunk ids.`

**Check:** `test_retrieval.py` — index three known chunks, assert the
keyword-only and semantic-only queries each surface the right one and RRF keeps
both.

### Phase 3 — Runtime Engine

`runtime.py`, one function per stage, called in fixed order by one `execute(run)`:

1. **classify** — LLM, structured output, constrained to the Pack's declared doc
   types. Output is a label from a closed set, never free text.
2. **retrieve** — per field/rule, using Phase 2.
3. **extract** — structured output bound to the field's declared type. One call
   per field, not one summarizing call per document.
4. **verify** — *deterministic first*: does the returned quote actually appear in
   the cited chunk's text at the claimed offsets? String containment, no LLM.
   Fails → `unsupported`. Only entailment-shaped rules escalate to an LLM check.
   This is the cheapest possible implementation of "evidence first" and it
   catches the failure mode that matters (fabricated citations).
5. **cross_validate** — Pack-declared comparisons across facts in the same run.
   Plain Python predicates over rows; no LLM.
6. **report** — render the Pack's template over facts + citations.

Runtime LLM calls use `temperature=0` and structured output only. No tool
selection, no agent loop, no chain-of-thought over business rules — the Pack
already decided.

Execution runs in a FastAPI `BackgroundTask`; the client polls `GET /runs/{id}`.

> `# ponytail: BackgroundTasks, single process. Move to a real queue when runs
> outlive the process or need more than one worker.`

**Check:** `test_runtime.py` — one fixture doc, one 2-field Pack. Assert
verified/missing/unsupported all reachable, and that a fabricated quote lands as
`unsupported` rather than `verified`.

### Phase 4 — Studio + Surfaces

- `studio.py`: LangChain conversation that asks clarifying questions and emits a
  **draft** Pack. Drafts are rows with `status=draft`; only an explicit approve
  call writes a `pack_versions` row. The approval gate is a route, not a prompt
  instruction.
- Checklist surface = a query over `facts` for one run. Grid, rollup, diff are
  the *same query* shaped differently — they are read models, not engines. Build
  checklist only; the other three are ~20 lines each when someone asks.
- Correction endpoint: append to `corrections`. The v2-diff proposer is deferred
  until there are actual corrections to learn from.

## Not building (and the trigger to revisit)

| Deferred | Build it when |
|---|---|
| OpenSearch | pgvector+ts_rank recall measurably fails a real Pack |
| MinIO / S3 | deploying to more than one box, or local disk fills |
| Celery / Redis | a run outlives an HTTP process, or >1 worker needed |
| Reranker model | RRF ordering is the demonstrated cause of a wrong answer |
| Graph engine, Python sandbox, vision/OCR | README already gates these to Phase 2+ |
| Repository/service abstraction layer | there is a second implementation |
| Multi-tenant auth | there is a second organization |

## Old code

`App.py` and `Utilities/setup.py` are deleted, along with the `streamlit`
dependency. `Agents/` and `Utilities/Tools.py` remain only as salvage reference —
they are dead code with no importer, delete them once Phase 3 passes its check,
along with the checked-in `Embeddings/` model blobs (that belongs in a HF cache,
not git). FastAPI's `/docs` is a sufficient dev client until the Next.js front
end exists; see `frontend-plan.md`.

Salvage list, total: `create_chunks`'s offset metadata (`Utilities/Tools.py:51`)
and the `LLM` singleton shape (`Utilities/Tools.py:10`). Nothing else.

Known bugs in the current code — reasons not to port it:
- `Utilities/setup.py:21` — `os.remove(CHROMA_PATH)` targets the directory, not
  the file; also wipes all uploads and vectors at import time.
- `Agents/Wiki.py:27` — `wiki.run()` returns `str`, code subscripts it as a dict.
- `Agents/URL.py:20`, `Agents/Wiki.py:36` — pass a `str` into `create_chunks`,
  which calls `split_documents()` and requires `Document` objects.
```
