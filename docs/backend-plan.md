# Backend — Status Report & Plan

**Last verified:** 2026-08-05, against `backend/` at `enhancements/backend`.

The original rewrite plan (Phases 1–4) is **substantially built**. This document is now
half status report, half forward plan: what exists and was verified, where it diverges
from the frontend that has since been built, and what Phase 5 has to close.

---

## 1. Verification snapshot

Everything below was executed, not assumed.

| Check | Command | Result |
|---|---|---|
| Type safety | `uv run mypy app` | **Pass** — no issues in 15 source files, `strict = true` |
| Lint | `uv run ruff check .` | **Pass** — all checks passed |
| Tests | `uv run pytest -q` | **Pass** — 10/10 |
| Coverage gate | `uv run pytest --cov=app --cov-fail-under=80` | **Broken** — `pytest-cov` not installed, see §5.1 |
| Migration | `alembic/versions/1230e1bd1593` | Creates all 11 tables **and installs the triggers** (line 238) |

Running the suite requires a Postgres on **5433** holding `papermind_test`, which
`docker-compose.yml` does not provide (§5.2). It was created manually to verify.

**Size:** 15 modules, ~2,100 LOC in `app/`, ~350 LOC in `tests/`.

---

## 2. Guiding constraint (unchanged)

The README's rule — *"which existing Knowledge Pack cannot be implemented without this
capability?"* — still governs the infrastructure. Phase 1 ships **one datastore**.
OpenSearch, MinIO, Celery, and the graph engine remain deferred behind named swap points
(§7). That constraint held: the retrieval layer is 60 lines of pgvector + `ts_rank` + RRF,
and nothing has yet demonstrated it insufficient.

---

## 3. As-built architecture

### 3.1 Modules

```
backend/app/
  main.py        FastAPI app, CORS, 4 routers, /healthz
  config.py      pydantic-settings; DB url, provider selection, storage dir
  db.py          engine + session dependency
  models.py      11 SQLAlchemy models + TRIGGERS_SQL_SOURCE + install_triggers()
  schemas.py     Pydantic API contract — mirrors web/lib/types.ts
  packs.py       pack CRUD + the version approval gate
  documents.py   upload, metadata, full content (for the evidence viewer)
  runs.py        run creation, polling, corrections
  runtime.py     the six stages — the core
  studio.py      authoring sessions, SSE streaming, draft, preview
  retrieval.py   hybrid search: pgvector cosine + ts_rank, RRF merge
  ingest.py      parse → flatten pages → chunk with offsets → embed
  llm.py         provider abstraction: Gemini | SentenceTransformers | Fake
  storage.py     save_blob/read_blob — local fs
```

Twelve planned files became fifteen. Still no `services/` or `repositories/` layer —
see the conflict note in §6.

### 3.2 Data model — built as specified

The part the plan said "must be right" is right, and the invariants are in the database
rather than in Python:

- **`pack_versions` is append-only.** A `BEFORE UPDATE OR DELETE` trigger raises. README
  principle 6 is enforced where application code cannot bypass it.
- **"No citation, no result" is a constraint.** Two `DEFERRABLE INITIALLY DEFERRED`
  constraint triggers: one rejects a `verified` fact with no citation rows, the other
  rejects deleting citations out from under a verified fact. Deferred so a fact and its
  citations can land in one transaction.
- **`runs` pins `pack_version_id` *and* `model_id`.** A result is reproducible back to the
  exact spec and the exact model that produced it.
- **Chunks carry `page`, `char_start`, `char_end`.** This is what makes a citation
  checkable rather than decorative — and it is what stage 4 verifies against.

Tables: `packs`, `pack_versions`, `runs`, `cases`, `documents`, `run_documents`, `chunks`,
`facts`, `citations`, `corrections`, `studio_sessions`.

Indexes: HNSW (`vector_cosine_ops`) on `chunks.embedding`, GIN on `chunks.tsv`, plus
`(run_id, case_id, field)` on facts.

### 3.3 Runtime — the deterministic core

`execute_run()` calls six stages in fixed order with no branching on LLM output:

1. **classify** — structured output constrained to an `enum` of the Pack's declared doc
   types. Anything not in the closed set becomes `null`, never a guess.
2. **retrieve** — RRF over semantic + keyword channels, scoped to the case's documents.
3. **extract** — one call per field, `temperature=0`, schema-bound `{found, value, quote}`.
4. **verify** — **deterministic, no LLM.** `_locate_quote` normalizes whitespace and case,
   then requires the quote to appear verbatim in a retrieved chunk. Found → `verified`
   with real offsets. Not found → `unsupported`, even when the value looks plausible.
   This is the cheapest implementation of "evidence first" and it catches the failure
   mode that actually matters: fabricated citations.
5. **cross-validate** — plain Python predicates over fact rows. No LLM.
6. **report** — aggregate counts per state, per case.

`test_runtime.py::test_fabricated_quote_is_unsupported_not_verified` pins stage 4's
guarantee. That test is the single most valuable one in the suite.

### 3.4 API surface (16 routes)

| Method | Path | Returns |
|---|---|---|
| GET | `/healthz` | status + active `model_id` |
| POST | `/packs` | `PackOut` |
| GET | `/packs` | `list[PackOut]` |
| GET | `/packs/{id}` | `PackDetailOut` |
| GET | `/packs/{id}/versions/{version}` | `PackVersionOut` |
| POST | `/packs/{id}/versions` | `PackVersionOut` — **the approval gate** |
| POST | `/documents` | `DocumentOut` |
| GET | `/documents/{id}` | `DocumentOut` |
| GET | `/documents/{id}/content` | `DocumentContent` — text + page offsets |
| POST | `/runs` | `RunOut`, schedules a `BackgroundTask` |
| GET | `/runs/{id}` | `RunOut` — poll target |
| POST | `/runs/{id}/corrections` | `CorrectionOut` — appended, never applied |
| POST | `/studio/sessions` | `StudioSessionOut` |
| GET | `/studio/sessions/{id}` | `StudioSessionOut` |
| POST | `/studio/sessions/{id}/messages` | SSE stream |
| POST | `/studio/sessions/{id}/preview` | `StudioPreviewOut` — dry-run before approve |

The approval gate is a route, exactly as planned: `studio` accrues a draft spec on a
`studio_sessions` row; only `POST /packs/{id}/versions` writes an immutable version.

---

## 4. The frontend gap — the main finding

`web/` is now UI-complete (see `web/README.md`). It is organised around a model the
backend does not have:

```
frontend:   Workspace ──(1:1)── Pack ──(1:N)── Session
backend:                        Pack ──(1:N)── Run
```

**There is no `workspace` anywhere in `backend/app/` — zero matches.** Nor any user,
org, or tenancy column. The frontend's navigation spine has no persistence layer.

### 4.1 Type-by-type mapping

| `web/lib/types.ts` | Backend equivalent | Gap |
|---|---|---|
| `Run`, `Fact`, `Citation`, `Case`, `RunDocument`, `DocumentContent` | `schemas.py` | **Exact match.** Deliberately mirrored. |
| `PackSpec`, `PackField`, `PackRule`, `PackVersion`, `Pack` | `schemas.py` | **Match.** |
| `ChatMessage`, `Chat` | `studio_sessions.messages` JSONB | Partial — no per-chat identity |
| `Workspace` | — | **Missing entirely** |
| `WorkspaceSession` | `Run` (closest) | Missing title, chat thread, file list, `updated`, `subject` |
| `PackAsset` (`name`, `meta`) | — | **Missing.** A Pack can't carry template/policy files |
| `PackNode` (`num`, `kicker`, `in`, `out`, `asset`, `prompt`) | — | **Missing.** The 7-node pipeline is pure frontend fixture |
| `FlowNode` / `FlowEdge` | derived client-side by `specToGraph()` | Not persisted; node positions are recomputed, never stored |
| `MarketplacePack` (`category`, `installs`, `author`) | — | **Missing.** No publishing/registry model |

### 4.2 What this means

The frontend is 100% driven by `web/lib/mock.ts`. Wiring it up is **not** a matter of
swapping fetch calls in — roughly half its screens describe concepts with no server
representation. Phase 5 has to add them before integration is meaningful.

The honest framing: the backend built the *execution* half of the README correctly, and
the frontend built the *organisation* half. They have not yet met.

---

## 5. Defects and drift (verified)

### 5.1 `make backend-test` cannot pass — dependency declaration

`pytest-cov` is not installed, so the Makefile's
`uv run pytest -v --cov=app --cov-fail-under=80 tests/` fails with
`unrecognized arguments: --cov=app`. CLAUDE.md §8 lists that exact command as the
definition of done.

Root cause: `backend/pyproject.toml` has **no `[project]` table at all** — only tool
config. Dependencies live in `requirements.txt`, but the Makefile runs `uv sync`, which
reads `pyproject.toml`. Hence uv's warning on every invocation:
`No requires-python value found in the workspace`.

**Fix:** move `requirements.txt` into `[project].dependencies`, add a dev group carrying
`pytest`, `pytest-cov`, `mypy`, `ruff`. This also settles the CLAUDE.md §7 "conda → uv"
pending decision in uv's favour, with `uv.lock` as the reproducibility story.

### 5.2 No test database service

`tests/conftest.py` binds to `postgresql+psycopg://…@localhost:5433/papermind_test`.
`docker-compose.yml` defines only the dev DB on 5432. A clean checkout cannot run the
suite.

**Fix:** add a `db-test` service on 5433 plus a `make db-test-up` target.

### 5.3 Blocking I/O inside `async def` — CLAUDE.md §3.2

Two routes are `async def` but do only synchronous work, stalling the event loop:

- `documents.py:28 upload_document` — `store_document()` runs the sync DB session **and**
  SentenceTransformers inference. This is the worst offender; embedding a large PDF
  blocks every other request on the worker.
- `runs.py:100 create_run` — sync `db.get` / `db.commit` throughout.

**Fix:** drop `async` (FastAPI will run them in a threadpool), or wrap the blocking span
in `run_in_threadpool`. Do not mix.

### 5.4 No error contract — CLAUDE.md §3.4

Routes raise bare `HTTPException(404, "pack not found")`, producing FastAPI's
`{"detail": …}`. CLAUDE.md mandates one shape API-wide:
`{"error": {"code": "…", "message": "…", "details": {}}}` with a stable machine-readable
`code`, registered in a single handler.

Worth fixing **before** the frontend integrates — clients that branch on `detail` strings
will have to be rewritten otherwise.

### 5.5 Unpaginated list endpoints — CLAUDE.md §3.5

`GET /packs` returns every row. Needs `limit`/`cursor` before any real dataset.

### 5.6 Uploaded blobs committed to git

Three files under `backend/storage/d2bedfb1cea2e6da/` are tracked. There is no
`backend/.gitignore`.

**Fix:** add one covering `storage/`, `.env`, `__pycache__`, `.venv`; `git rm --cached`
the blobs.

### 5.7 Configuration hygiene

- CORS origin is hardcoded to `http://localhost:3000` in `main.py`. Move to settings —
  it will be wrong in every deployed environment.
- `backend/.env.example` is untracked. It is the only documentation of required env
  vars; it should be committed.
- No secret is currently `SecretStr` — `gemini_api_key` is a plain `str | None`
  (CLAUDE.md §3.3).

### 5.8 Rule interpreter is keyword-matching

`runtime._evaluate_rule` decides rule shape by scanning the description for `"must"`,
`"required"`, `"at least"`, and a currency regex. It is honestly labelled *"a deliberately
small rule interpreter"*, and keeping the LLM out of rule evaluation is correct. But rule
semantics currently depend on English phrasing — `"liability cap ≥ $250,000"` fails where
`"at least $250,000"` succeeds.

**Fix path:** give `PackRule` a structured predicate (`{field, op, operand}`) authored by
the studio, and keep the prose as a human-readable label. Don't grow the regex set.

### 5.9 Studio conversation is partly scripted

`_assistant_tokens` returns canned text; `_draft_spec` falls back to `_heuristic_draft`
whenever the provider is fake *or* the LLM call raises. Fine for a demo, but the studio
is the one place the README wants real LLM reasoning, so the fallback silently hides
provider failures. It should surface them.

---

## 6. Conflict with CLAUDE.md to resolve

CLAUDE.md §3.1 mandates a strict `router → service → repository → DB` layering, and §6
forbids business logic in a router. The backend is deliberately flat: `packs.py` and
`runs.py` construct queries directly, and this plan's original §"Target layout" argued
for it — *"one implementation each, add indirection when there are two."*

Per CLAUDE.md's own precedence rule (*follow the existing code and flag the conflict*),
the flat structure stands. **Decide explicitly and record it:** either relax §3.1 for
this service, or schedule the extraction. Leaving both documents contradicting each other
is the worst option, because every future change has to re-litigate it.

Recommendation: relax §3.1. `runtime.py` already *is* the service layer for the only
non-trivial logic; a repository layer over 11 tables with one caller each would be pure
ceremony.

---

## 7. Revised phases

Phases 1–4 are built. What follows is scoped by what the frontend now demonstrably needs.

### Phase 5 — Workspaces, Sessions, Identity *(next)*

The integration blocker. In dependency order:

1. **`users` + auth.** Minimum: `users(id, email, name, password_hash, role)`, a session
   or JWT dependency, and a deny-by-default router dependency (CLAUDE.md §5). The
   frontend's `/login`, `/signup`, `/profile`, `/settings` are all `localStorage` stubs
   today — nothing behind them.
2. **`workspaces`.** `(id, owner_id, name, goal, pack_id NULL, created_at)`. The 1:1
   Workspace→Pack rule is a `UNIQUE` constraint on `pack_id`, not a convention.
3. **`workspace_sessions`.** Wrap `runs`: `(id, workspace_id, title, run_id NULL, status,
   messages JSONB, created_at, updated_at)`. A session is a *conversation about* a run —
   which is why it can exist in `draft` before any run does, exactly as the UI shows.
4. **`pack_assets`.** `(id, pack_version_id, name, blob_path, meta)`. Assets must be
   versioned **with** the spec or the immutability guarantee leaks: a Pack whose template
   file can change under it is not reproducible.
5. **Routes:** `/workspaces` CRUD, `/workspaces/{id}/sessions` CRUD, session→run linking.

**Check:** create a workspace, install a Pack, open two sessions, run both, assert both
resolve to the same `pack_version_id` and that mutating the Pack mid-flight cannot change
a completed session's result.

### Phase 6 — Contract hardening

The §5 list: error envelope, pagination, `async` correctness, `SecretStr`, CORS from
settings, `.gitignore`, dependency declarations, test-DB service. Small individually;
all of them are cheaper now than after a client depends on the current shapes.

### Phase 7 — Marketplace

Only once §4 is closed and a second workspace wants a Pack the first one authored:
`pack_publications(pack_version_id, category, author_id, published_at)` plus install
counts. Installing = copying a `pack_version` reference into a workspace. The frontend
`/marketplace` screen already defines the required fields.

### Phase 8 — Corrections → v2 proposal

`corrections` rows accumulate today and nothing reads them. The v2-diff proposer stays
deferred until there is a real correction corpus to learn from — that ordering was right
and hasn't changed.

---

## 8. Not building (and the trigger to revisit)

| Deferred | Build it when |
|---|---|
| OpenSearch | pgvector + `ts_rank` recall measurably fails a real Pack |
| MinIO / S3 | deploying to more than one box, or local disk fills |
| Celery / Redis | a run outlives an HTTP process, or >1 worker is needed |
| Reranker model | RRF ordering is the demonstrated cause of a wrong answer |
| Graph engine, Python sandbox, vision/OCR | README gates these to Phase 2+ |
| Repository/service layer | there is a second implementation (see §6) |
| Multi-tenant orgs | there is a second organization — note Phase 5 adds *users*, not tenancy |

The `BackgroundTask` executor keeps its original note: single process, no retry, a run
dies with the worker. Acceptable while runs are minutes and users are few; the swap point
is `runs.run_task`.

---

## 9. Old code

Complete. `App.py`, `Agents/`, `Utilities/`, and the checked-in `Embeddings/` blobs are
deleted from the working tree, along with the `streamlit` dependency. The salvage list
(`create_chunks` offset metadata, the `LLM` singleton shape) was absorbed into
`ingest.py` and `llm.py`. Nothing remains to port.
