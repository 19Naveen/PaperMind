# PaperMind — Backend / API

The execution half of PaperMind. A persistent, versioned home for **Knowledge Packs**
(author a Pack's spec in a conversational Studio), **Workspaces** that each mount one
Pack, and **Sessions** — a conversation *about* a run against a frozen Pack version.

Given an uploaded set of documents, the backend runs a deterministic six-stage engine —
classify, retrieve, extract, verify, cross-validate, report — that pulls evidence out of
the source text. Any fact the engine reports as `verified` is backed by a citation into a
specific page and character range; a value the model invents but the source cannot back is
marked `unsupported`, never believed. Retrieval is hybrid (pgvector cosine + Postgres
`ts_rank`, merged with Reciprocal Rank Fusion). Blobs live on local disk today via a small
`storage` swap point; LLM and embedding providers are behind an interface.

The frontend spec (documents, Pack workflow, Workspace/Session organisation, marketplace)
lives in `docs/specs.md` and `docs/backend-plan.md`; the authoritative architecture
conventions are in `/AGENTS.md`.

---

## Stack

- **API:** FastAPI
- **Validation / settings:** Pydantic v2, `pydantic-settings`
- **Database:** SQLAlchemy 2.0 (typed) + PostgreSQL with the `pgvector` extension
- **Migrations:** Alembic
- **Lint / types:** Ruff, mypy (`strict`)
- **Tests:** pytest (+ `pytest-cov`, `httpx`)
- **Packaging / env:** [uv](https://docs.astral.sh/uv/) — `pyproject.toml` + `uv.lock`

Dependencies and the developer toolchain are declared in `pyproject.toml`; reproducibility
comes from `uv.lock`. (The Conda-to-uv migration noted in `AGENTS.md` §7 is settled: the
project uses `uv` with a lockfile.)

---

## Getting started

### 1. Install dependencies

```bash
cd backend
uv sync          # installs the project + dev group (pytest, pytest-cov, mypy, ruff, httpx)
```

### 2. Configure

Create `.env` from `.env.example` (expected at `backend/.env.example`) and fill in your
values. The engine reads settings (case-insensitively) from the environment and `.env`,
all defined only in `app/core/config.py`.

Settings are loaded **only** from env / `.env` — never from code constants. A new variable
must be added to `app/core/config.py` and `.env.example` in the same change.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://papermind:papermind@localhost:5432/papermind` | Postgres (dev default; override for deployed envs) |
| `SESSION_SECRET` | `dev-only-insecure-session-secret` | `SecretStr` — signs auth cookies. **Production must override** with a random secret (e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`). |
| `GEMINI_API_KEY` | unset | `SecretStr`; required when `LLM_PROVIDER=gemini` or `EMBEDDING_PROVIDER=gemini` |
| `LLM_PROVIDER` | `gemini` | `gemini` (real) or `fake` (offline deterministic, for tests) |
| `LLM_MODEL` | `gemini-1.5-flash-latest` | |
| `EMBEDDING_PROVIDER` | `sentence-transformers` | `sentence-transformers` (offline default), `gemini`, or `fake` |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | |
| `EMBEDDING_DIM` | `384` | Must match the model; changing it requires a migration of the `chunks.embedding` vector column |
| `STORAGE_DIR` | `backend/storage` | Blob root |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowlist (never `*`; the frontend sends cookies) |

Secrets are held as `SecretStr` so they never appear in `repr` or logs. `SESSION_SECRET`
currently carries an insecure dev default; `AGENTS.md` §3.3 requires secret fields to have
**no default** — flagging this as a known deviation from the contract (see Discrepancies).

### 3. Start the database

The dev database is a Postgres with the `pgvector` image:

```bash
docker compose up -d db          # dev DB on 5432 (papermind)
docker compose up -d --wait db-test  # test DB on 5433 (papermind_test)
```

### 4. Run migrations

```bash
cd backend
uv run alembic upgrade head
```

Migrations live in `backend/alembic/versions/`. The initial schema also installs the
database triggers that enforce the Pack invariants (append-only `pack_versions`, and a
`verified` fact must carry a citation).

### 5. Run the server

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive docs at `http://localhost:8000/docs`; health check at `GET /healthz`.

### 6. Seed a demo

For a non-empty UI (a demo user, a KYC Pack, and workspaces):

```bash
uv run python seed_demo.py
```

Idempotent — re-running does nothing once the demo user exists. Credentials are printed on
first run (dev seed credentials only, never a deployed secret). This is dev scaffolding,
not a fixture library.

---

## Project layout

```
backend/
  app/
    main.py              # app factory, CORS from settings, error handlers, router registration, /healthz
    core/
      config.py          # pydantic-settings; the only place settings are defined
      db.py              # engine + session factory + declarative Base
      errors.py          # the single API error envelope + exception handlers
      security.py        # scrypt password hashing, HMAC-signed session cookies
    api/
      deps.py            # request-scoped DB + `current_user` auth dependency
      v1/routers/        # auth, packs, documents, runs, studio, workspaces
    services/
      ingest.py          # parse -> flatten with page offsets -> chunk -> embed
      retrieval.py       # hybrid pgvector + ts_rank, RRF merge (swap point)
      runtime.py         # the six-stage execution engine + preview
      llm.py             # LLM + embedder provider abstraction (gemini / sentence-transformers / fake)
      storage.py         # save/read blob on local fs (swap point)
    models/__init__.py   # SQLAlchemy ORM models + trigger SQL + install_triggers()
    schemas/__init__.py  # Pydantic API contract (mirrors web/lib/types.ts)
  alembic/               # Alembic environment + versioned migrations
  tests/                 # pytest suite
  storage/               # uploaded blobs (gitignored)
  seed_demo.py           # idempotent demo seeding
  pyproject.toml         # one source of dependency + tool config
  uv.lock
```

> Layout note: `repositories/`, `models/`, and `schemas/` are packages exposed via their
> `__init__.py`; `services/` and `api/v1/routers/` hold the per-feature modules. The
> data-model packages are empty — see the `repositories/` discrepancy below.

---

## Architecture & layering

The intended data flow is `router → service → repository → DB`. In practice `models/`,
`schemas/`, and the `services/` package carry the real modules; routers hold much of the
per-route orchestration directly (see Discrepancies on the tension with `AGENTS.md` §3.1).

- **Routers** parse/validate requests, call a service, and map results to schemas.
- **Services** own the non-trivial logic:
  - `runtime.py` is the core — six stages in fixed order, no branching on LLM output.
    Extraction uses `temperature=0` and schema-bound structured output. Verification is
    **deterministic**: `_locate_quote` requires the quote to appear verbatim in a retrieved
    chunk, so a fabricated citation lands as `unsupported`, never `verified`.
  - `ingest.py` produces page-aligned chunks whose `char_start`/`char_end` point into the
    same `text` the API serves to the evidence viewer — a citation is checkable, not
    decorative.
  - `storage.py` and `retrieval.py` are the named swap points (MinIO/S3; OpenSearch).
- **Never return ORM models from a route.** Every endpoint sets `response_model=` to a
  `schemas/` DTO.
- Invariants are enforced in the database where application code cannot bypass them:
  `pack_versions` is append-only (a `BEFORE UPDATE OR DELETE` trigger raises), and a
  `verified` fact without a citation is impossible (deferred constraint triggers).

### Routers (mounted under the app factory)

| Area | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/auth` | signup, login, logout, `/me`, password |
| `packs.py` | `/packs` | Pack CRUD + the version approval gate (`POST /packs/{id}/versions`) |
| `documents.py` | `/documents` | upload (runs the full ingest pipeline), metadata, full content |
| `runs.py` | `/runs` | run creation, polling, corrections |
| `studio.py` | `/studio` | authoring sessions, SSE streaming, draft + preview |
| `workspaces.py` | `/workspaces` | workspaces, sessions, session chat, pack install |

Runs execute in a FastAPI `BackgroundTask`; the client polls `GET /runs/{id}`. A run pins
the exact `pack_version_id` and `model_id`, so its result is reproducible.

---

## Testing

A real test database, per-test rollback, and fake (deterministic, scripted) LLM/embedding
providers. The suite owns the whole `papermind_test` database on port **5433** — it drops and
recreates the schema and installs triggers at session start (`tests/conftest.py`).

Start the test Postgres and run the suite:

```bash
docker compose up -d --wait db-test
cd backend
uv run pytest -v --cov=app --cov-fail-under=80 tests/
```

The split is deliberate (per `AGENTS.md` §3.6):

- **Service / logic tests** (e.g. `test_runtime.py`, `test_retrieval.py`) exercise the
  runtime and hybrid retrieval directly, with real DB transaction rollers.
- **Router / wiring tests** (e.g. `test_workspaces.py`, `test_sessions_runs.py`,
  `test_errors.py`) mount real routers on a `TestClient` and assert on serialization,
  auth, ownership, and the error envelope.

The single most load-bearing test pins the core guarantee:
`test_runtime.py::test_fabricated_quote_is_unsupported_not_verified`.

### Definition of done

```bash
cd backend
uv run ruff check . --fix && uv run ruff format .
uv run mypy app                       # strict; ruff does not type-check
uv run pytest -v --cov=app --cov-fail-under=80 tests/
alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

These are also exposed as repo-level `make` targets:
`make backend-install backend-run backend-test backend-lint backend-typecheck backend-migrate`
plus `make db-up db-test-up`.

---

## Error contract

Every error response — domain, framework, or validation — has one shape:

```json
{ "error": { "code": "PACK_NOT_FOUND", "message": "...", "details": {} } }
```

- `code` is a stable, machine-readable `StrEnum` (`app/core/errors.py::Code`); clients
  branch on it, never on `message`.
- `message` is user-safe prose; stack traces, SQL, and internals go to logs only.
- Registered in a single handler (`install_error_handlers(app)`) in `app/core/errors.py`,
  wired in `app/main.py`. Routers raise `ApiError(Code, message, status, details)` rather
  than hand-rolling dicts, and never a bare `HTTPException`.

---

## Configuration

- Settings are defined **only** in `app/core/config.py`, read from `.env` + environment,
  and accessed through a cached `get_settings()`.
- Secrets (`SESSION_SECRET`, `GEMINI_API_KEY`) are `SecretStr`.
- **New env var** → add it to `app/core/config.py` *and* `.env.example` in the same change.
- List endpoints are paginated (`limit`/`offset`, bounded `limit`); out-of-range limits are
  rejected as `422`, not silently clamped.