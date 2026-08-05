# CLAUDE.md — Architecture & Conventions

**Binding contract for all generated code.**

- If a rule here conflicts with existing code, **follow the existing code and flag the conflict** in your response.
- If a rule is ambiguous for the task at hand, **ask before guessing**.
- Never introduce a dependency, service, or pattern not listed here without asking first.
- Keep this file under ~350 lines. It is loaded on every request; unused prose costs context.

---

## 1. Repository map

> ⚠️ **REPLACE this tree with the real one.** An agent that does not know where things live will invent a structure. This is the most important section in the file.

```
backend/
  app/
    main.py              # app factory + router registration ONLY
    core/                # config, security, logging, exception handlers
    api/v1/routers/      # HTTP layer only
    api/deps.py          # shared FastAPI dependencies
    services/            # business logic (framework-agnostic)
    repositories/        # data access
    models/              # SQLAlchemy ORM models
    schemas/             # Pydantic request/response DTOs
  migrations/            # Alembic
  tests/                 # mirrors app/ structure
web/
  app/                   # Next.js App Router routes — thin, fetch + render a *View
  components/ui.tsx      # design-system primitives (Button, PageHeader, Card, Tag,
                          # Seg, Pill, Stat, ...) — the ONLY source of spacing/type/
                          # color for headers, buttons, cards. Every page-level
                          # `*View.tsx` MUST import and use these, never hand-roll a
                          # `<header>`/`<button className="...">` with literal
                          # px/color values — that's how screens drift from the
                          # "Modernist" design tokens in app/globals.css.
  components/*View.tsx   # page-level composites (e.g. WorkspaceView, SessionView,
                          # PackBuilderView), built from components/ui.tsx
  lib/                   # types, mock data, icons
```

**Placement rules**

- Code goes in the layer that owns it. Do **not** create `utils/`, `helpers/`, `common/`, or `misc/` dumping grounds.
- Shared code is promoted out of a feature slice only on the **third** use, not the second.
- New env var → add to `app/core/config.py` **and** `.env.example` in the same change.

---

## 2. Non-negotiables

1. **Typed at every boundary.** No `Any`, `unknown`, `# type: ignore`, or `as` casts without an adjacent comment justifying it.
2. **Validate at the edge, trust inward.** Parse untrusted input once into a typed model; downstream code assumes validity.
3. **Fail loudly.** Never swallow exceptions. Never return HTTP 200 with an error body.
4. **YAGNI, bounded by rule-of-three.** No speculative abstraction; no third copy-paste either.
5. **No secrets in code, logs, or error messages.** Secrets are `SecretStr` / server-only env, never in `NEXT_PUBLIC_*`.
6. **Don't touch unrelated files.** No drive-by reformatting or refactoring in a focused change.

---

## 3. Backend (Python)

**Stack:** FastAPI · Pydantic v2 · `pydantic-settings` · SQLAlchemy 2.0 (typed) · Alembic · Ruff · mypy (strict) · pytest
**Env/packages:** Conda — *see §7, migration to `uv` under review*

### 3.1 Layering (strict, one direction)

```
router → service → repository → DB
```

- **Router:** parse/validate, call one service, map result to a response schema. No business logic, no ORM queries, no cross-service orchestration.
- **Service:** all business logic. Must not import `fastapi` or raise `HTTPException` — raise domain exceptions instead; `core/` maps them to HTTP.
- **Repository:** all query construction. Returns domain objects or DTOs.
- **Never return ORM models from an endpoint.** Always a `schemas/` response model. `response_model=` is required on every route.

### 3.2 Async

- Never call blocking I/O inside `async def` (sync DB drivers, `requests`, `time.sleep`, file reads, CPU-bound work). It stalls the event loop.
- Either make the whole path async, or declare the endpoint `def` (FastAPI runs it in a threadpool), or wrap with `run_in_threadpool`. Do not mix.
- One DB session per request, injected via `Depends`. Never a module-level session.

### 3.3 Configuration

Settings live only in `app/core/config.py`. Secrets are **required** (`...`) — never give a secret a default fallback.

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    API_V1_STR: str = "/api/v1"

    DATABASE_URL: SecretStr = Field(...)   # no default — fail at boot if absent
    SECRET_KEY: SecretStr = Field(...)

settings = Settings()  # import this; never re-instantiate Settings()
```

### 3.4 Error contract (single shape, whole API)

```json
{ "error": { "code": "INVOICE_ALREADY_PAID", "message": "...", "details": {} } }
```

- `code` is a stable machine-readable enum — clients branch on it, never on `message`.
- `message` is user-safe. Stack traces, SQL, and internals go to logs only.
- Registered in one exception handler in `core/`. Do not hand-roll error dicts in routers.

### 3.5 Data & migrations

- Every schema change ships with an Alembic migration in the same PR. Migrations must be reversible or explicitly marked irreversible.
- Never `alembic revision --autogenerate` without reading the diff — it misses type changes and drops columns.
- All queries parameterized. No f-string SQL, ever.
- Paginate every list endpoint (`limit`/`cursor`). No unbounded `SELECT *`.

### 3.6 Testing

- Test **services** for logic, **routers** for wiring/auth/serialization. Don't duplicate coverage.
- Use a real test database with per-test transaction rollback. Do not mock the ORM.
- Fixtures/factories over inline literals. One assertion concern per test.
- A bug fix requires a regression test that fails before the fix.

---

## 4. Frontend (TypeScript / React)

**Stack:** Next.js App Router · TypeScript (`strict`) · TanStack Query · Tailwind · Radix/Headless UI · Vitest + Testing Library · Playwright
**Package manager:** npm (`npm ci` in CI)

### 4.1 The API contract — single source of truth

- TS types are **generated** from FastAPI's OpenAPI schema into `src/lib/api/`. Never hand-write a type that mirrors a backend model; regenerate instead.
- Auth tokens live in httpOnly cookies. Browser code never holds a backend token; the Next.js server layer proxies. No secret in `NEXT_PUBLIC_*`.

### 4.2 RSC vs TanStack Query — decision table

RSC-first and React Query overlap. Use this split, not judgment:

| Case | Use |
|---|---|
| Initial page/route data | **Server Component**, fetch directly |
| SEO-relevant content | **Server Component** |
| Data keyed off client state (typed filters, tabs) | **TanStack Query** |
| Polling / live data | **TanStack Query** |
| Infinite scroll / paginated interactive lists | **TanStack Query** (`useInfiniteQuery`) |
| Mutations | Server Action (+`revalidateTag`) or `useMutation` — one per feature, not both |
| Data needed by a client component on first paint | RSC prefetch → `dehydrate` → `HydrationBoundary` |

- **Never fetch in `useEffect`.**
- `"use client"` only for hooks, DOM listeners, or local view state. Push it to the leaves — a client boundary near the root makes RSC pointless.

### 4.3 Mutations & optimistic updates

Optimistic updates are **opt-in**, not the default. Permitted only when **all** hold:

1. The mutation is idempotent or safely retryable.
2. The client can compute the resulting state **exactly**.
3. Failure is cheap and fully reversible.
4. No server-derived value is displayed as truth.

**Forbidden** for: monetary or ledger values, totals/balances/statuses computed server-side, entities whose server-generated ID is used immediately, anything gated by server-side business validation, multi-step workflows.

Otherwise: pending state + inline spinner on the control. Always invalidate the affected query keys on settle, and roll back on error with a visible, non-dismissive message.

### 4.4 Forms

- Validate on `onBlur` or debounced change. Never surface an error before first blur.
- Preserve field values on network failure. Never clear a form on error.
- Disable submit during flight and render an inline indicator — this is the duplicate-submission guard.
- Server-side validation errors map back to the offending fields by `code`, not by string matching.

### 4.5 Loading, feedback, hierarchy

- **Skeletons matching the final layout** for page/section loads (prevents CLS). Spinners only for small inline actions.
- Non-destructive actions: inline state change or an unobtrusive toast. **Modals only for destructive, irreversible operations**, and the confirm button names the action ("Delete invoice", not "OK").
- Spacing on a strict 4/8px scale. Signal actionability through weight, contrast, and elevation — not color alone.
- Every list has a designed empty state and a designed error state. An empty state invites an action; an error state says what happened and how to fix it.

### 4.6 Accessibility (quality floor, not a feature)

- Full keyboard operability: Tab / Esc / Enter, `Cmd+K` palette where one exists.
- Visible focus always (`focus-visible:ring-2`). Never remove outlines without a replacement.
- Use Radix/Headless primitives for anything with focus management (dialogs, menus, comboboxes). Do not hand-roll them.
- Respect `prefers-reduced-motion`. Responsive to mobile.

### 4.7 Interface copy

- Active voice, sentence case, user vocabulary — "Save changes", not "Submit"; "Notifications", not "Webhook config".
- An action keeps its name through the whole flow: a "Publish" button produces a "Published" toast.
- Errors state what happened and the next step. They don't apologize and they aren't vague.

---

## 5. Cross-cutting

- **Naming:** Python `snake_case` / `PascalCase` classes; TS `camelCase` / `PascalCase` components; files kebab-case in `web/`, snake_case in `backend/`. Booleans read as predicates (`is_active`, `hasAccess`).
- **Logging:** structured JSON, request-ID correlated. Never log secrets, tokens, or PII. `print()`/`console.log` never reaches main.
- **Security defaults:** deny-by-default auth dependency on routers; explicit CORS allowlist (no `*`); rate limit auth and write endpoints; validate upload type and size server-side.
- **Git:** conventional commits; one logical change per PR; PR description states what changed, why, and how it was verified.

---

## 6. Anti-patterns — do not do these

- Business logic in a router or a React component.
- `useEffect` for data fetching.
- Returning ORM models or leaking DB column names to clients.
- Broad `except Exception:` that swallows or re-raises without context.
- Blocking I/O inside `async def`.
- Hand-written duplicates of generated API types.
- A new `utils.ts` / `helpers.py`.
- Adding a library to solve something the existing stack already solves.
- Client-side-only authorization checks.
- Optimistic UI on server-computed values.
- Reformatting or refactoring files unrelated to the change.
- Hand-rolling a header, button, or card with literal Tailwind px/color classes in `web/` when `components/ui.tsx` already has `PageHeader`/`Button`/`ActionButton`/`Card`/`Tag` — this is what caused the pack-builder/workspace/session views to drift from the design system prototype.

---

## 7. Pending decisions

- **Conda → uv.** For a pure-Python service, `uv` + `pyproject.toml` + `uv.lock` gives real lockfile reproducibility and far faster CI. Conda is justified only if binary/scientific dependencies require it. Until decided, `environment.yml` **must** be paired with `conda-lock` — an unlocked `environment.yml` is not reproducible.
- **Mutations: Server Actions vs. route handlers + `useMutation`.** Pick one per feature and stay consistent; document the choice here once settled.

---

## 8. Definition of done

Run all of it. A change is not done until every command passes.

```bash
# Backend
conda activate backend-env
ruff check . --fix && ruff format .
mypy app                              # strict; ruff does NOT type-check
pytest -v --cov=app --cov-fail-under=80 tests/
alembic upgrade head && alembic downgrade -1 && alembic upgrade head

# Frontend
npm ci
npm run lint
npx tsc --noEmit                      # type errors are build failures
npm run test
npm run build
```

Required config: mypy `strict = true`; `tsconfig` `"strict": true`, `"noUncheckedIndexedAccess": true`; Ruff `select = ["E","F","I","UP","B","SIM","ANN","ASYNC","S","RUF"]`.

**Before declaring done, state:** what changed, which commands you ran, and any rule in this file you had to bend and why.