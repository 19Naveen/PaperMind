# Next.js Frontend + FastAPI Split

Companion to `backend-plan.md`. Streamlit is deleted (`App.py`,
`Utilities/setup.py`, the `streamlit` dep).

**Status:** v1 of the screens exists in `web/` and is being rebuilt. The scaffold
(Next 16, Tailwind v4, zero runtime deps beyond React) and the mock-driven
approach stay. The screen layer does not — see "What v1 got wrong".

## Repo layout

```
backend/     FastAPI (see backend-plan.md)
web/         Next.js App Router + TypeScript + Tailwind
docker-compose.yml   postgres+pgvector only
```

Postgres runs in Docker; `uvicorn` and `next dev` run natively — containerizing
your own dev loop buys nothing and costs a rebuild on every edit.

## What v1 got wrong

Three failures, all worth stating so the rebuild doesn't repeat them.

1. **No document viewer.** Citations carry `page`, `char_start`, `char_end`
   precisely so the span can be highlighted *in the source*. v1 rendered the
   quote as a string in a drawer. PaperMind's central claim — "know exactly
   which sentence justified this" — was decorative.
2. **No `Case` layer.** The README's real workload is 412 vendors, not one
   3-document file. Without Run → Case → Fact, Checklist / Grid / Rollup look
   like three features to build separately. With it, they are three renderings
   of one payload and the second and third are nearly free.
3. **Wireframe visual craft.** Correct data on screen, no hierarchy, no density,
   no considered type scale. It read as scaffolding because it was.

## Data model change this requires

`lib/types.ts` gains one layer. Everything else stays:

```ts
export interface Case { id: string; subject: string; document_ids: string[] }
// Fact gains: case_id: string
// Run gains:  cases: Case[]
```

A Case is one subject under review — one vendor, one customer, one lease.
This is the single change that makes the review surfaces collapse into one
engine. Mirror it in `backend-plan.md`'s `facts` table before building it.

## Features, by job

Three jobs, not five pages.

### Author
- Conversational drafting; assistant asks clarifying questions
- Upload policy / example documents to ground the draft
- Draft spec accretes visibly beside the conversation
- **Preview the draft against a sample document before approving** — missing in
  v1 and load-bearing. Approving a spec you have never seen execute is
  rubber-stamping, which defeats README principle 3.
- Approve → frozen v1
- Later: review a proposed v2 diff from correction patterns, promote or reject

### Execute
- Pick pack version, attach documents, group into cases
- **Per-stage progress** (classify → retrieve → extract → verify →
  cross-validate → report). When a run spans 400 documents, "pending" is not an
  acceptable answer for twenty minutes.
- Partial failure is normal and must be representable — one bad document does
  not fail a portfolio

### Review
One Run payload, five renderings:

| Surface | Shape | Answers | Phase |
|---|---|---|---|
| Checklist | one case, all fields | "is this file complete?" | 1 |
| Grid | cases × fields | "how do these compare?" | 1 |
| Rollup | aggregate counts | "where is my portfolio broken?" | 1 |
| Diff | two versions of one doc | "what changed?" | 2 |
| Explorer | verified facts + relations | "how do these connect?" | 2 |

Cross-cutting, present in all of them:
- **Evidence inspection** — any value → source document, span highlighted
- **Correction** — logged, never applied; the UI must never imply the value changed

## Routing

Surfaces are a route segment, not a page each.

```
/                              packs library (home)
/packs/[id]                    overview: versions + recent runs
/packs/[id]/v/[n]              read-only spec
/studio/[draftId]              authoring + preview + approve gate
/packs/[id]/runs/new           run setup, scoped to the pack
/runs/[id]                     progress + case list
/runs/[id]/checklist/[caseId]  one case
/runs/[id]/grid                cases × fields
/runs/[id]/rollup              aggregate
```

Run setup lives under the pack because you never start a run without already
having chosen a Pack — a global `/runs/new` forces a pack picker that the
navigation already answered.

## Component layers

- **Primitives** (~6): badge, data table, drawer, empty state, stat, field row.
  Boring by design.
- **Domain** — where the product lives, and where design effort goes:
  `EvidenceViewer`, `FactRow`, `CitationLink`, `SpecViewer`, `StageProgress`,
  `CorrectionInput`, `VersionLedger`.
- **Screens** — thin: layout, data fetching, composition.

**`EvidenceViewer` is built first and built well.** If clicking any value
anywhere puts the source sentence in front of you with the span lit, the product
feels trustworthy; if it doesn't, polish elsewhere does not compensate.

## Visual direction

The failure mode to avoid is "generic AI SaaS": gradient hero, rounded card
soup, generous whitespace, one accent color doing all the work. This is an
evidence tool used for hours by people auditing things.

- **Density over air.** Data-dense tables, tight leading, a compact type scale.
  Closer to a terminal or a spreadsheet than a landing page.
- **Hierarchy from weight, size, and rule lines** — not from color and not from
  drop shadows. One elevation level, reserved for overlays.
- **Color is reserved for state.** verified / unsupported / missing are the only
  saturated things on screen. If everything is colored, the exceptions stop
  being visible, which is the one job the screen has.
- **Evidence gets typographic weight.** Quoted source text renders in the mono
  face and reads as a citation, not a tooltip.
- **Gaps are designed.** `missing` and `null` must look deliberate, never like a
  rendering bug. This is the visual expression of "never fill a gap with a guess".
- Light and dark both real, via `prefers-color-scheme`.

## The seam: API contract

The only thing both plans must agree on.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/studio/sessions` | start an authoring session |
| `POST` | `/studio/sessions/{id}/messages` | send turn → **SSE stream** of tokens + a final `draft_spec` event |
| `POST` | `/studio/sessions/{id}/preview` | dry-run the draft against a sample doc |
| `POST` | `/packs` | create pack identity |
| `POST` | `/packs/{id}/versions` | approve a draft → immutable version (the gate) |
| `GET` | `/packs` · `/packs/{id}/versions/{v}` | list / read spec |
| `POST` | `/documents` | multipart upload → `document_id` |
| `GET` | `/documents/{id}/content` | source text + page offsets, for `EvidenceViewer` |
| `POST` | `/runs` | `{pack_version_id, cases}` → `run_id`, status `pending` |
| `GET` | `/runs/{id}` | status, stage, cases, facts, citations |
| `POST` | `/runs/{id}/corrections` | append a correction (never mutates the fact) |

Note what's **absent**: no endpoint mutates a saved version, and none lets the
client pick a model, prompt, or retrieval strategy. The client chooses only
*which frozen Pack to run*. The determinism guarantee is expressed as an API
surface, not as a policy someone has to remember.

## Types

`openapi-typescript` against `/openapi.json`, one npm script, checked in:

```json
"gen:api": "openapi-typescript http://localhost:8000/openapi.json -o lib/api.d.ts"
```

No tRPC, no GraphQL, no hand-maintained mirror of the Pydantic models.

## Data fetching

- **Reads**: Server Components calling `fetch`, `cache: 'no-store'`. No React
  Query / SWR — the App Router already does that job.
- **Writes**: Server Actions + `revalidatePath`, keeping the API base URL server-side.
- **Run progress**: one `setInterval(3000)` client component, cleared when status
  settles. Not websockets — a run finishing is a once-per-run event.
- **Studio chat**: the one genuinely streaming surface (SSE).

## Rebuild order

1. **Tokens + primitives + `EvidenceViewer`.** Nothing else until a citation can
   be seen highlighted in its source. Mock document text is fine.
2. **Checklist** on top of it, then **Grid** and **Rollup** from the same payload.
3. **Run setup + `StageProgress`.**
4. **Packs library + version ledger.**
5. **Studio**, including preview-before-approve.

Evidence first, literally — it is both the product principle and the build order.

**Check:** one Playwright spec once a backend exists — upload fixture, start run,
poll to completion, assert a verified field and its highlighted citation render.

## Skipped

| Skipped | Add when |
|---|---|
| Auth / sessions | second user or second org exists |
| React Query / Redux / Zustand | Server Components measurably don't cover a case |
| Component library (shadcn et al.) | a third screen repeats the same custom widget |
| assistant-ui | the SSE endpoint exists to design against |
| Websockets | polling latency is an actual complaint |
| Diff + Explorer surfaces | Phase 2, per README gating |
| Storybook, component unit tests | a component has logic worth isolating |
| i18n, PWA | asked for |
