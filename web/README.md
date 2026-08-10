# PaperMind — Web Frontend

The reviewer's console for PaperMind: author a **Pack** once, then run it against document sets from isolated **Sessions**. This package is the Next.js App Router frontend.

> **Status: wired to the FastAPI backend.** Pages read from the service through `lib/api.ts` (server-only) and auth is real (httpOnly cookie, Server Actions). Marketplace cards are driven by real backend data (install counts, latest-version document/field/rule summaries); `lib/mock.ts` holds only a small static catalogue-copy seed (`MARKETPLACE_PACKS`) for display blurb. See [Known gaps](#known-gaps).

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
| `/marketplace` | Published Packs — searchable grid; each card opens the pack detail | `app/marketplace/page.tsx` + `MarketGrid` |
| `/marketplace/[packId]` | Pack detail — documents/fields/rules/version history + install into a workspace | `app/marketplace/[packId]/page.tsx` + `MarketplaceInstall` |
| `/marketplace/[packId]/edit` | Edit a published Pack — Studio that approves a new version | `app/marketplace/[packId]/edit/page.tsx` + `PackBuilderView` |
| `/workspace/new` | New-workspace wizard (objective → start-from → open); a chosen Pack installs on create | `NewWorkspaceWizard` |
| `/workspace/[id]` | Workspace overview — installed Pack, assets, stat strip, sessions | `WorkspaceView` |
| `/workspace/[id]/pack` | Pack Studio (author → Publish, or Edit → Approve new version); read-only when a Pack is installed | `PackBuilderView` |
| `/workspace/[id]/sessions/[sessionId]` | Session — upload, SSE chat, stage timeline, facts + corrections | `SessionView` |
| `/login`, `/signup` | Real auth against the backend | `LoginScreen`, `SignupScreen` |
| `/profile` | Account identity, role, API access, real activity stats | `app/profile/page.tsx` + `ProfileStats` |
| `/settings` | Account + password (backend), notification prefs (browser-local) | `app/settings/page.tsx` |

**Route handlers (proxy the browser → FastAPI, keeping the cookie server-side):**

- `…/pack/chat` (workspace authoring), `…/marketplace/[packId]/edit/chat` (published-Pack editing), and `…/sessions/[sessionId]/chat` — SSE proxies for the streaming studio/session chat. (The two studio proxies are slated to consolidate into one shared handler as part of the engine work.)
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

## Design system — Premium2.0

The effective cascade at `../papermind-single.html:624-979` is the visual source of truth: a cool `#f6f7f9` ground, indigo `#5b5bd6` active state, `#151519` sidebar, 60px frosted topbar, Inter display/body, JetBrains Mono metadata, 8px controls, and 12px cards.

**Use the primitives:** `components/ui.tsx` owns `PageHeader`, `Button`/`ActionButton`, `Card`, `Panel`, `Tag`, `Pill`, `Seg`, `Stat`, `Input`, and `EmptyState`. Pages must reuse those APIs instead of hand-rolling controls or surfaces. Tokens live in `app/globals.css`; use semantic token utilities, never literal colors or fonts.

### Accessibility floor

Not a feature — a quality bar. Full keyboard operability, visible `:focus-visible` rings (never removed without replacement), `aria-current` on active nav, `aria-expanded`/`aria-controls` on disclosures, `role="status"`/`role="alert"` where async success/errors land, destructive-confirmation dialogs that name the action and close on Escape, and `prefers-reduced-motion` respected globally.

### Layout & responsive rules

Canonical geometry from the prototype, to keep the fixed console shell intact:

- **Desktop shell is a fixed `100dvh` viewport with hidden root overflow.** The 266px rail and content column stay fixed; each page pane owns its vertical scrolling. Every flex/grid ancestor of an internal scroller must carry `min-height: 0`.
- **Gutters:** 24px main content gutter (may reduce to 16px at narrow widths); 18px card gaps; 18×24px page headers.
- **Pane widths:** Pack Studio = 360px conversation, ≥520px canvas, 312px inspector; Session = 452px state/conversation rail. Horizontal overflow is acceptable before collapsing an authoring tool to unusable width.
- **Grids:** stat strips are flush modular grids (shared top rule, per-cell bottom rule), never boxed cards.
- **Responsive:** design and test at 320, 375, 768, 1024, 1280, and 1440px; account for the 266px rail (1024px viewport leaves ~758px for content); use `dvh` not `vh`; wrap action rows, inputs go full-width on mobile, wide tables scroll horizontally with labels; touch targets ≥40px where possible, never below 32px.
- **Motion:** transitions 100–150ms, animating state change not decoration.

### Interface copy

Active voice, sentence case, user vocabulary — "Save changes", not "Submit". An action keeps its name through the whole flow. Errors state what happened and the next step; they don't apologize and they aren't vague.

---

## Known gaps

- **Marketplace copy is still display-only seed.** Cards render real backend data (install count, latest version's documents/fields/rules), but `lib/mock.ts` still holds a small `MARKETPLACE_PACKS` blurb seed (category, description). A backend metadata field replaces it when catalogue copy needs to be editable.
- **No span-level evidence viewer yet.** `SessionView` renders each fact's citations as quoted blockquote text (`lib/api.ts` `Citation` carries `char_start`/`char_end`/`page`, and `globals.css` has the `.evidence-span`/`.highlight` tokens), but nothing highlights the span in the source document yet.
- **Chat transcripts are not replayed.** The Pack Studio keeps its draft across reloads (session id in `sessionStorage`), but the conversation history and the run/SSE streams are not re-scripted on reload. The enterprise engine's persistent Studio revisions will make the full transcript + draft authoritative on the server.
- **Notification preferences are browser-local.** `/settings` persists them to `localStorage`; account + password are real API calls.

## Tests & guards

- **Lint guard.** `npm run lint` runs ESLint **and** `scripts/ui-guard.mjs`, a small drift guard that fails on `rounded-full` outside `components/ui.tsx`, local `Stat`/`GridStat` definitions, and hand-rolled `bg-accent` buttons — the patterns that caused the earlier design-system regression.
- **Type/build gates.** `npx tsc --noEmit` and `npx next build` must pass (type errors are build failures).
- **E2E.** Playwright is wired (`playwright.config.ts`, chromium-only, reuses a running dev server); `npm run test:e2e` runs `e2e/*.spec.ts`. Coverage expands as the engine work lands.