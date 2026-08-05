# PaperMind — Web Frontend

The reviewer's console for PaperMind: author a **Pack** once, then run it against document sets from isolated **Sessions**. This package is the Next.js App Router frontend.

> **Status: UI-complete, mock-driven.** Every screen renders from fixtures in `lib/mock.ts`. There are no `fetch` calls to the FastAPI backend yet, and auth is a `localStorage` stub. See [Known gaps](#known-gaps).

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack), React 19 |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v4 — CSS-first `@theme` block, no `tailwind.config.js` |
| Components | Local (`components/ui.tsx`) — no UI framework dependency |
| Icons | Local inline SVG set (`lib/icons.tsx`) — no icon package |
| Fonts | Archivo (display + body), JetBrains Mono (data), via `next/font` |

> ⚠️ Read [`AGENTS.md`](./AGENTS.md) before writing code. This Next.js major has breaking changes from what you may expect — consult `node_modules/next/dist/docs/` rather than assuming older App Router conventions.

---

## Getting started

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

All four must pass — type errors are build failures:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

---

## Routes

| Route | Screen | Component |
|---|---|---|
| `/` | Home — workspace grid, stats, recent activity | `app/page.tsx` |
| `/marketplace` | Published Packs, filterable by category | `app/marketplace/page.tsx` |
| `/workspace/new` | New-workspace wizard | `NewWorkspaceWizard` |
| `/workspace/[id]` | Workspace overview — installed Pack, assets, usage, sessions | `WorkspaceView` |
| `/workspace/[id]/pack` | Pack builder — chat, diagram/ports/ledger, inspector | `PackBuilderView` |
| `/workspace/[id]/sessions/[sessionId]` | Session — files, execution steps, chat, artifacts, report | `SessionView` |
| `/login`, `/signup` | Mock auth | `LoginScreen`, `SignupScreen` |
| `/profile` | Account identity + activity | `app/profile/page.tsx` |
| `/settings` | Notification preferences | `app/settings/page.tsx` |

**Model:** one Workspace holds exactly one Pack. Sessions are isolated executions of that Pack — different documents, identical logic — which is what makes two runs comparable.

---

## Layout

```
app/
  layout.tsx          # fonts + AppShell; the only place globals.css is imported
  globals.css         # design tokens (@theme) + utility classes — see below
  <route>/page.tsx    # thin: fetch from lib/mock, render a *View
components/
  ui.tsx              # design-system primitives — the single styling source of truth
  AppShell.tsx        # sidebar rail, workspace switcher, account menu
  *View.tsx           # page-level composites (Workspace, PackBuilder, Session)
  auth/               # AuthProvider (context) + login/signup screens
lib/
  types.ts            # domain types + pure helpers (specToGraph, countByState, …)
  mock.ts             # all fixture data and the async accessors pages call
  session.ts          # localStorage-backed mock user + preferences
  icons.tsx           # inline SVG icon set
```

**Placement rule:** routes stay thin — fetch and render. Logic lives in the `*View` composite or in `lib/`. Do not add a `utils.ts`.

---

## Design system — "Modernist"

Ported from the static prototype in `../Workspace pack builder prototype/`. Flat and architectural: a warm paper ground, ink hairline rules, one display face, and a single red accent reserved for action and state.

**Non-negotiables:**

- **Zero border radius.** `--radius-*` is `0px` on purpose. Do not round a corner.
- **Accent is not decoration.** `--color-accent` (#ec3013) marks the *one* primary action per screen, active nav state, and eyebrows. Everything else is ink on ground.
- **2px rules divide sections, 1px rules divide rows.** Alignment and rule weight do the organising — not shadows, not whitespace alone.
- **Stat strips are flush modular grids** — shared top rule, per-cell bottom rule — not boxed cards.

### Use the primitives

Everything visual comes from `components/ui.tsx`. **Never hand-roll a `<header>`, `<button>`, or card with literal `px`/color classes** — that is precisely how the Workspace, Pack-builder, and Session screens drifted from the prototype and had to be rewritten.

| Primitive | Use for |
|---|---|
| `PageHeader` | Every screen header (eyebrow + title + actions). Owns its own padding. |
| `Button` (link) / `ActionButton` (handler) | Actions. `primary` = accent fill, one per screen; `secondary`/`outline` for the rest. |
| `Card`, `CardKicker`, `CardTitle`, `CardBody`, `CardMeta` | Content cards. |
| `Panel`, `CardHeader` | Titled sections with an optional right-aligned action. |
| `Tag` | Small chips — `accent`, `neutral`, `outline`. |
| `Pill`, `StateBadge` | Operational status / fact state. Both pair color with a glyph or dot — color is never the only signal. |
| `Seg` | Segmented control (e.g. Diagram · Ports · Ledger). |
| `Stat`, `Kv`, `Chip`, `Stamp` | Data readouts. |
| `EmptyState` | Every list needs a designed empty state that invites an action. |
| `Th`, `Td`, `Divider`, `Progress`, `Avatar` | Tables and chrome. |

Tokens live in `app/globals.css` under `@theme`: surfaces (`ground`, `surface`, `raised`, `inset`), ink (`ink`, `ink-2`, `ink-3`), rules (`rule`, `rule-2`), `accent` + a 100–900 ramp, and fact states (`verified`, `unsupported`, `missing`, `running`). A full dark ramp is defined under `prefers-color-scheme: dark`. Global utility classes: `.display`, `.eyebrow`, `.stamp`, `.kbd`, `.readout`, `.evidence-span`, `.sweep`.

Take colors and fonts from the tokens (`text-ink-2`, `bg-surface`, `border-rule`, `font-data`) — never hard-code a hex or a font name.

### Accessibility floor

Not a feature — a quality bar. Full keyboard operability, visible `:focus-visible` rings (never removed without replacement), `aria-current` on active nav, `aria-expanded`/`aria-controls` on disclosures, and `prefers-reduced-motion` respected globally.

---

## Known gaps

- **No backend integration.** Pages call `lib/mock.ts`. Wiring to the FastAPI service in `../backend/` is the next milestone (see [`../docs/frontend-plan.md`](../docs/frontend-plan.md)).
- **Auth is a stub.** `lib/session.ts` writes a user to `localStorage`; the password is never checked. Not a security boundary.
- **Pack creation is local-only.** "Create Pack draft" and the builder chat mutate component state; nothing persists across a reload.
- **Orphaned graph code.** `GraphCanvas.tsx`, `ChatPane.tsx`, `ImportPackButton.tsx`, and `components/graph/` are unreferenced, and `@xyflow/react` is a dependency only for them — the live Pack builder draws its own SVG diagram. Delete or re-wire before shipping.
- **`components/auth/AuthFrame.tsx` uses rounded corners** (`rounded-[10px]`), violating the zero-radius rule. Known deviation, not yet fixed.
