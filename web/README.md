# PaperMind — Web Frontend

The reviewer's console for PaperMind: author a **Pack** once, then run it against document sets from isolated **Sessions**. This package is the Next.js App Router frontend.

> **Status: wired to the FastAPI backend.** Pages read from the service through `lib/api.ts` (server-only) and auth is real (httpOnly cookie, Server Actions). The only remaining fixtures are static **Marketplace** reference metadata in `lib/mock.ts` (`MARKETPLACE_PACKS`), used to enrich real pack cards. See [Known gaps](#known-gaps).

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router; Turbopack is the default bundler), React 19 |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v4 — CSS-first `@theme` block, no `tailwind.config.js` |
| Design system | Local (`components/ui.tsx`) — no UI framework dependency |
| Data fetching | Server Components + `lib/api.ts` + Server Actions; no TanStack Query |
| Graph canvas | `@xyflow/react` (the Pack Studio's diagram view) |
| Icons | Local inline SVG set (`lib/icons.tsx`) — no icon package |
| Fonts | Archivo (display + body), JetBrains Mono (data), via `next/font` |

> ⚠️ Read [`../AGENTS.md`](../AGENTS.md) before writing code. The API contract, layering, RSC-vs-Query decision table, and "no `useEffect` data fetching" rule all apply here.

---

## Getting started

The frontend needs the FastAPI service running (it proxies every data call and re-issues the auth cookie). Point it at the backend with `web/.env.local`, which already exists:

```
PAPERMIND_API_URL=http://localhost:8000
```

```bash
npm ci
npm run dev          # http://localhost:3000
```

From the repository root, the `Makefile` wraps the same commands:

```bash
make frontend-install   # npm ci
make frontend-dev       # npm run dev
make frontend-build     # npm run build
make frontend-lint      # eslint
make frontend-typecheck # tsc --noEmit
```

Note the Make targets must be run **from the repository root**, not from `web/`.

### Before you push

All three must pass — type errors are build failures:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Sign in with the demo account (`ada@papermind.io` / `papermind123`) after seeding a backend user.

---

## Routes

| Route | Screen | Component |
|---|---|---|
| `/` | Home — workspace grid, aggregate stats, recent-activity ledger | `app/page.tsx` + `WorkspaceBrowser` |
| `/marketplace` | Published Packs, search + category filters, install picker | `app/marketplace/page.tsx` + `MarketGrid` |
| `/workspace/new` | New-workspace wizard (objective → start-from → open) | `NewWorkspaceWizard` |
| `/workspace/[id]` | Workspace overview — installed Pack, assets, stat strip, sessions | `WorkspaceView` |
| `/workspace/[id]/pack` | Pack Studio — conversation, Draft→Publish gate; or read-only installed Pack | `PackBuilderView` |
| `/workspace/[id]/sessions/[sessionId]` | Session — upload, SSE chat, stage timeline, facts + corrections | `SessionView` |
| `/login`, `/signup` | Real auth against the backend | `LoginScreen`, `SignupScreen` |
| `/profile` | Account identity, role, API access, real activity stats | `app/profile/page.tsx` + `ProfileStats` |
| `/settings` | Account + password (backend), notification prefs (browser-local) | `app/settings/page.tsx` |

**Route handlers (proxy the browser → FastAPI, keeping the cookie server-side):**

- `…/pack/chat` and `…/sessions/[sessionId]/chat` — SSE proxies for the streaming studio/session chat.
- `…/sessions/[sessionId]/run` — the 2s poll endpoint while a run is in flight.

**Guards:** `app/workspace/layout.tsx` redirects signed-out visitors to `/login`. The root `layout.tsx` resolves the user + workspace list and supplies the `AppShell`. `app/error.tsx`, `app/loading.tsx` (skeleton), and `app/not-found.tsx` are the shared load/error/404 primitives.

**Model:** one Workspace holds exactly one Pack (either author it in the studio, or install one from the Marketplace). Sessions are isolated executions of that Pack — different documents, identical logic.

---

## Layout

```
app/
  layout.tsx          # fonts + AppShell; the only place globals.css is imported
  globals.css         # design tokens (@theme) + utility classes — see below
  page.tsx            # home — fetch from lib/api, render WorkspaceBrowser
  <route>/page.tsx    # thin: fetch from lib/api, render a *View
  workspace/layout.tsx  # auth gate for all workspace routes
  error.tsx · loading.tsx · not-found.tsx  # shared error / skeleton / 404
components/
  ui.tsx              # design-system primitives — the single styling source of truth
  AppShell.tsx        # fixed shell: HomeNavbar + workspace rail/switcher + account menu
  *View.tsx           # page-level composites (Workspace, PackBuilder, Session)
  auth/               # AuthProvider (context) + login/signup screens
  graph/              # @xyflow node renderers used by GraphCanvas
  GraphCanvas.tsx     # React Flow canvas (read-only in the current Pack Studio)
  HomeNavbar.tsx      # standalone dashboard header + account chip
  WorkspaceBrowser.tsx, NewWorkspaceWizard.tsx, MarketGrid.tsx …
lib/
  api.ts              # server-only typed client for the FastAPI service (cookie-forwarding)
  session.ts          # Server Actions: auth, runs, sessions, packs, studio
  types.ts            # domain types + pure helpers (specToGraph, countByState, locator, …)
  mock.ts             # static Marketplace reference metadata for the grid
  icons.tsx           # inline SVG icon set
```

**Placement rule:** routes stay thin — fetch and render. Logic lives in the `*View` composite or in `lib/`. Do not add a `utils.ts`. `lib/api.ts` is server-only by construction: it imports `next/headers` and forwards the httpOnly `papermind_session` cookie, so a client import fails at build time.

---

## Design system — "Modernist"

Ported from the canonical prototype `Reference/PaperMind.dc.html` (see `../docs/frontend-revamp-spec.md`). Flat and architectural: a warm paper ground, ink hairline rules, one display face, and a single red accent reserved for action and state.

**Non-negotiables:**

- **Zero border radius.** `--radius-*` is `0px` on purpose. Do not round a corner.
- **Accent is not decoration.** `--color-accent` (#ec3013) marks the *one* primary action per screen, active nav state, and eyebrows. Everything else is ink on ground.
- **2px rules divide sections, 1px rules divide rows.** Alignment and rule weight do the organising — not shadows, not whitespace alone.
- **Stat strips are flush modular grids** — shared top rule, per-cell bottom rule — not boxed cards.
- **Light theme only.** The canonical palette is light; the previous auto-dark ramp was removed per the revamp spec. Dark mode, if ever added, must be explicit, complete, and separately reviewed.

### Use the primitives

Everything visual comes from `components/ui.tsx`. **Never hand-roll a `<header>`, `<button>`, or card with literal `px`/color classes** — that is precisely how the earlier screens drifted from the prototype and had to be rewritten.

| Primitive | Use for |
|---|---|
| `PageHeader` | Every screen header (eyebrow + title + actions). Owns its own padding. |
| `Button` (link) / `ActionButton` (handler) | Actions. `primary` = accent fill, one per screen; `secondary`/`outline`/`ghost`/`danger` for the rest. |
| `Card`, `CardKicker`, `CardTitle`, `CardBody`, `CardMeta` | Content cards (flat paper, no border). |
| `Panel`, `CardHeader` | Titled sections with an optional right-aligned action. |
| `Tag` | Small chips — `accent`, `neutral`, `outline`. |
| `Pill`, `StateBadge` | Operational status / fact state. Both pair color with a glyph or dot — color is never the only signal. |
| `Seg` | Segmented control (e.g. Diagram · Ports · Ledger). |
| `Stat`, `Kv`, `Chip`, `Stamp` | Data readouts and the bates-style locator stamp. |
| `EmptyState` | Every list needs a designed empty state that invites an action. |
| `Th`, `Td`, `Divider`, `Progress`, `Avatar` | Tables and chrome. |

Tokens live in `app/globals.css` under `@theme`: surfaces (`ground`, `surface`, `raised`, `inset`), ink (`ink`, `ink-2`, `ink-3`), rules (`rule`, `rule-2`), `accent` + a 100–900 ramp plus `accent-ink`/`accent-soft`, a warm `neutral` ramp, and fact/operation states (`verified`, `unsupported`, `missing`, `running`), plus `focus` and `highlight`. Global utility classes: `.display`, `.eyebrow`, `.stamp`, `.kbd`, `.readout`, `.evidence-span`, `.sweep`.

Take colors and fonts from the tokens (`text-ink-2`, `bg-surface`, `border-rule`, `font-data`) — never hard-code a hex or a font name.

### Accessibility floor

Not a feature — a quality bar. Full keyboard operability, visible `:focus-visible` rings (never removed without replacement), `aria-current` on active nav, `aria-expanded`/`aria-controls` on disclosures, `role="status"`/`role="alert"` where async success/errors land, destructive-confirmation dialogs that name the action and close on Escape, and `prefers-reduced-motion` respected globally.

---

## Known gaps

- **Marketplace display metadata is static.** `lib/mock.ts` contributes `MARKETPLACE_PACKS` (category, description, node/asset counts, installs, author) so the grid can present cards, keyed to real Packs by name/id. There is no backend field for these yet; cards would render bare with fewer attributes if the list grows beyond those names.
- **No span-level evidence viewer yet.** `SessionView` renders each fact's citations as quoted blockquote text (`lib/api.ts` `Citation` carries `char_start`/`char_end`/`page`, and `globals.css` has the `.evidence-span`/`.highlight` tokens), but nothing highlights the span in the source document yet.
- **Chat transcripts are not replayed.** The Pack Studio keeps its draft across reloads (session id in `sessionStorage`), but the conversation history and the run/SSE streams are not re-scripted on reload.
- **Notification preferences are browser-local.** `/settings` persists them to `localStorage`; account + password are real API calls.
- **Orphaned components.** `ChatPane.tsx` and `ImportPackButton.tsx` are unreferenced — the live Pack Studio (`PackBuilderView`) has its own inline chat and `GraphCanvas`. Delete or re-wire before shipping.