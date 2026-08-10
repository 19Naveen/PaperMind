# PaperMind Frontend UI — Audit & Improvement Report (superseded)

**Date:** 2026-08-08 · **Status:** Superseded by the Premium2.0 reference-fidelity port. · **Scope:** `web/` (Next.js 16, React 19, Tailwind v4, 45 source files) · **Branch:** `enhancements/backend`

---

## TL;DR

The design *foundation* is healthy: `app/globals.css` carries the full "Modernist" token set and `components/ui.tsx` defines the right primitives (Button, PageHeader, Card, Tag, Pill, Stat, Seg…). The **drift is in the views**: every screen re-implements buttons, inputs, chips, stats and status text by hand, each with subtly different weight, padding and corner radius. The app compiles clean (`tsc` ✓, `next build` ✓) — "broken" means *visually inconsistent* plus a handful of real **UX/copy lies** (mock text describing a backend that is now real, a wizard that claims to do something it doesn't, a nav item that's permanently highlighted).

Two root causes:

1. **The hand-rolled-vs-primitive rule was never enforced.** The design system exists and is good; screens just don't use it consistently. There are **15+ hand-rolled buttons, 3 Stat implementations, 5 chip primitives, 2 input sizes, 6 rounded-full circles in a zero-radius design**.
2. **A parallel mock/type layer survived the backend migration.** `lib/mock.ts` and half of `lib/types.ts` are dead or only kept alive for display metadata, and their types duplicate `lib/api.ts` (ChatMessage, Fact, Citation, PackSpec, RunStatus are each defined twice, with different shapes).

This is a **regression**, not a one-off: project history (Aug 5) already fixed "design-system deviation" across these same views and then it came back. The durable fix is not a one-time polish — it's **one shared-input/button rule enforced by a lint guard** so drift can't return.

---

## 1. What is actually broken (P0 — bugs, lies, dead code)

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| 1 | **Marketplace nav item is permanently highlighted** — `border-b-2 border-accent` with no active-route check, so the top-nav "Marketplace" tab reads as *selected* on every page, including the Workspaces home. | `components/HomeNavbar.tsx:16-23` | Gate the underline on `usePathname() === '/marketplace'` (HomeNavbar is a client component — it can). |
| 2 | **New-workspace wizard lies.** Step 2 says "starting from {startFromLabel}" but the chosen starting Pack (blank/imported/library) is **silently discarded** — `create()` only sends name+goal to the backend (`createWorkspaceAction(name, goal)`). Comments admit it ("no backend to receive it yet"). The screen tells the user something that does not happen. | `components/NewWorkspaceWizard.tsx:77-90, 214-217` | Either ship the starting spec to the backend or change the copy to "Workspace created — the Pack authoring studio opens next" and drop the false "starting from X" claim. Honest copy is the lazy correct fix until the backend has the endpoint. |
| 3 | **Auth frame shows stale "mocked" copy.** Left panel: *"local draft — no real credentials / sign-in is mocked until the service lands"* — auth is real (Server Actions → FastAPI, session cookie). | `components/auth/AuthFrame.tsx:30-33` | Delete the block. Also `SignupScreen` eyebrow "Self-registration · draft" is stale. |
| 4 | **Login screen pre-fills a demo account** and advertises its password on the page. | `components/auth/LoginScreen.tsx:28, 84-87` | If this is a demo-only build, keep it but label it as such and drop it before any real deployment; it is a credential on the sign-in screen. |
| 5 | **"Publish yours" goes to `/workspace/new`** — that creates a *workspace*, not a published Pack. | `app/marketplace/MarketGrid.tsx:77` | Point it at the authoring flow (`/workspace/{id}/pack`) or a real publish action; disable otherwise. |
| 6 | **Marketplace category filter is fake.** `categoryFor()` maps every pack through the `MARKETPLACE_PACKS` mock; any pack not in the mock (i.e. real backend packs) silently falls to "Others", so filters claim results they don't have. | `app/marketplace/MarketGrid.tsx:23-28, 40-43` | Add a `category` field to the backend Pack model/schema, or drop the filter until it's real. |
| 7 | **Duplicate "Start run" control** in a session: a header button **and** a full-width sidebar button do the same thing. | `components/SessionView.tsx:254` and `:305-311` | Keep one (the sidebar is contextually where uploads live; remove the header one). |
| 8 | **ChatPane is dead code** — a full scripted-mock chat (GREETING/SCRIPT/FALLBACK) with zero references anywhere. | `components/ChatPane.tsx` (0 importers) | Delete it. The real studio is `PackBuilderView`. |
| 9 | **ImportPackButton is dead code** (only self-reference). | `components/ImportPackButton.tsx` | Delete, or wire it into the wizard. |
| 10 | **`lib/mock.ts` is a dead parallel world.** `getWorkspaces`/`getWorkspace`/`getWorkspaceSession`/`getMarketplacePacks` have no callers; the app uses `lib/api.ts`. Only `MARKETPLACE_PACKS` is still imported (by MarketGrid, see #6). | `lib/mock.ts:66-69`; `app/marketplace/MarketGrid.tsx:7` | Delete the mock functions; keep (or move) only the marketplace seed as an explicitly-named `marketplaceSeed.ts`. |
| 11 | **Whole-app 500 when the backend is down** — the root layout calls `getMe()` + `listWorkspaces()` server-side for *every* route including `/login`; a network failure (not `NOT_AUTHENTICATED`) throws and 500s the page. | `app/layout.tsx:19-20` | Catch non-`NOT_AUTHENTICATED` ApiError/net failures → treat as signed-out, or move workspace-fetching out of the root layout (perf win too, see P2-14). |

---

## 2. The consistency problem (P1 — visual drift)

The design contract: **Archivo 800 buttons, flush-left labels, zero radius everywhere, warm-paper surfaces, `--color-accent` for the single action, 2px rules between sections.** The views violate it in five repeatable ways.

### 2.1 Buttons — 15+ hand-rolled, wrong weight
The system button is `font-extrabold` (Archivo 800) via `BTN_BASE` (`ui.tsx:102-103`). Every hand-rolled primary button uses **`font-medium` (500)** and inline `px/py/text-[13px]` — so primary actions render visibly lighter than the design's.

- `components/WorkspaceView.tsx:40-42` ("New session") — hand-rolled, **does** use 800 (inconsistent with its siblings)
- `components/WorkspaceView.tsx:128-131` ("Add session") — hand-rolled, `font-medium`
- `components/SessionView.tsx:305-311` ("Start run") — hand-rolled, `font-medium`
- `components/auth/LoginScreen.tsx:74-81` + `SignupScreen.tsx:106-113` — hand-rolled, `font-medium`
- `app/settings/page.tsx:77-84, 151-158` — hand-rolled, `font-medium`
- `components/NewWorkspaceWizard.tsx:200, 220-231, 237-247` — three hand-rolled button styles
- `components/ImportPackButton.tsx:30-34` — hand-rolled

**Fix:** every one of these becomes `Button` (link) or `ActionButton` (button/submit). Add an `ActionButton` `block`/`fullWidth` prop rather than hand-rolling the full-width sidebar button. One pass, ~8 files, deletes ~40 lines of literal classes.

### 2.2 Inputs — two different sizes
Auth fields are `px-3.5 py-2.5` (`AuthField.tsx:26`); every other input in the app is `px-2.5 py-1.5` (WorkspaceView, SessionView, Settings, MarketGrid). Composer textareas are `p-2.5 bg-raised` (PackBuilderView, SessionView, ChatPane). Same control, three treatments.

**Fix:** promote `Field` out of `auth/` into `ui.tsx` as the one `Input` (with `variant`/`size`), use it everywhere. The auth frame already proves the pattern works.

### 2.3 Stat blocks — three implementations of the same thing
- `ui.tsx:406` `Stat` (bordered box)
- `app/page.tsx:51` local `Stat` (borderless grid strip)
- `components/WorkspaceView.tsx:9` `GridStat` (borderless grid strip, *comment says* "matches app/page.tsx's local Stat")

**Fix:** one `Stat` with a `bare` variant; delete the two local copies.

### 2.4 Chips — five overlapping primitives, used inconsistently
`ui.tsx` exports `StateBadge`, `Tag`, `Pill`, `Chip`, `Stamp` — and the views add a sixth: raw status text/colored dots (`WorkspaceView.tsx:18-24, 111-113`) that render the *same* session statuses as bare lowercase text + a dot, while `SessionView` renders them as `Pill`. Same data, two visual languages on two adjacent screens.

**Fix:** pick one status vocabulary (`Pill` already does tone + dot + uppercase) and use it for every session/run status. Delete or repurpose the near-duplicate `Tag`/`Chip`/`StateBadge` overlap.

### 2.5 Zero-radius is not respected — 6 circles
The design readme: *"Do not round a corner anywhere — `--radius-md` is 0 on purpose."* Yet:

- `components/HomeAccountMenu.tsx:20` — circular avatar (`rounded-full`) vs the square `Avatar` primitive in `ui.tsx:499`
- `components/ui.tsx:375` — EmptyState icon circle
- `components/NewWorkspaceWizard.tsx:210` — check circle
- `app/settings/page.tsx:210-218` — toggle thumb circle
- `WorkspaceView.tsx:111` + `ui.tsx:457` — status dots

**Fix:** circles to `rounded-none` squares (or `rounded-[2px]` at most). The avatar and toggle are the visible ones; status dots are the only defensible exception.

### 2.6 Styling beyond the tokens
- MarketGrid filter buttons style like **Bootstrap pills** (`accent-100`/`neutral-100` filled chips) — a different component language from `Tag`. (`MarketGrid.tsx:83`)
- `divider` used as a hairline `border-t` in some places (`ui.tsx Divider`) and `border-t-2` in others (`WorkspaceView.tsx:60, 88`) — the design's `.hr` is a strong 2px rule. Pick one.

---

## 3. Architecture smells (P2 — structural)

| # | Issue | Evidence | Fix |
|---|-------|----------|-----|
| 12 | **Two type systems.** `lib/types.ts` and `lib/api.ts` each define ChatMessage, Fact, Citation, PackSpec, RunStatus — with **different shapes** (`ChatMessage` has `id` in types.ts, not in api.ts). Anything touching both has to cast. | `lib/types.ts:25,77,127,237,251` vs `lib/api.ts:159,166,178,199,216` | Collapse to `api.ts` as the single source; delete the mock-era types from `types.ts`, keep only graph/studio helpers (`specToGraph`, `applyGraphPatch`). |
| 13 | **`initialsOf` duplicated** — defined in `AuthProvider.tsx:30` and re-implemented in `app/profile/page.tsx:7`. | both | Import from AuthProvider (or move to `lib/`). |
| 14 | **Layout fetches for every route.** `getMe()` + `listWorkspaces()` run server-side on `/login`, `/signup`, 404, error pages — where the result is discarded. | `app/layout.tsx:19-20` | Fetch workspaces only for the routes that render the rail; or cache `getMe` with a short revalidate. Login/signup shouldn't pay for the workspace list. |
| 15 | **ProfileStats N+1.** One `getWorkspace()` per workspace, serially. | `app/profile/ProfileStats.tsx:11-17` | `Promise.all` (it's already server-side). |
| 16 | **Navigation has two owners.** `HomeNavbar` (brand + Marketplace) renders on *every* page, then workspace pages add a rail (workspace switcher + Overview/Pack). Marketplace appears twice; the top bar's only nav item is the mis-highlighted one. | `AppShell.tsx:182-192` + `HomeNavbar.tsx` | Decide the owner: workspace pages could hide the top bar's Marketplace link (the rail covers it), or the top bar becomes brand + account only. |

---

## 4. Priority plan

**P0 — one focused change (½ day):** delete dead code (ChatPane, ImportPackButton, mock functions, stale types), fix the copy lies (AuthFrame, SignupScreen eyebrow, wizard step-2 claim, demo creds), fix the always-active Marketplace link, fix "Publish yours", dedupe `initialsOf`. This is the "broken" half and is mechanical.

**P1 — design pass (1 day):** one `Input` + one `Stat` + one `Pill` vocabulary in `ui.tsx`, then rewrite the hand-rolled buttons/inputs/stats/chips in all 8 view files to use them. Kill the six circles. This is the "inconsistent" half. Do it view-by-view so each diff is small and reviewable: WorkspaceView → SessionView → PackBuilderView → auth → settings/profile → marketplace → wizard.

**P2 — make it stick (½ day):** collapse the two type systems; move workspace fetching out of the root layout; then add the guard that stops recurrence.

## 5. The guard that stops recurrence (the actual lazy fix)

Project history shows this exact deviation was fixed Aug 5 (S99–S101) and has already regressed. A one-time polish will regress again. Add a cheap machine check:

- **ESLint rule** (custom, ~20 lines) or a **CI grep**: flag any `className` in `app/`/`components/` that hand-rolls a known primitive — e.g. contains `bg-accent px-` (bypassing `Button`/`ActionButton`), or `font-medium text-accent` button text, or a new `rounded-full`, or a `function Stat`/`function GridStat` definition. Fail the lint run.
- Or the *positive* version: a tiny test that asserts the only allowed corner is `rounded-none`/`rounded-2` and the only button font-weight is `font-extrabold`, scanning the source tree.

The guard is 10× cheaper than re-auditing, and it's what keeps the "Modernist" contract from drifting again.

---

## 6. What's already right (don't touch)

- `globals.css` token set — complete and faithful to the Modernist reference (`Reference/_ds/…/styles.css`).
- `ui.tsx` primitives — right components, right tokens.
- `PageHeader` usage — consistently applied across views.
- `error.tsx` / `loading.tsx` / `not-found.tsx` — on-design, use the primitives.
- `WorkspaceBrowser`, `AuthFrame` structure, `SessionView`'s run-timeline and fact rows — well-built composites that *mostly* use the system.
- Accessibility of the delete dialog (`role="alertdialog"`, Escape, focus) and the auth forms (labels, `aria-live`/`role="alert"`).

---

## Appendix — one-line inventory of the fix surface

| File | Change |
|------|--------|
| `components/HomeNavbar.tsx` | active-state on Marketplace link |
| `components/auth/AuthFrame.tsx` | delete stale "mocked" copy |
| `components/auth/SignupScreen.tsx` | drop "· draft" eyebrow |
| `components/auth/LoginScreen.tsx` | flag demo creds; route submit via `ActionButton` |
| `components/NewWorkspaceWizard.tsx` | honest step-2 copy; buttons → primitives; square check |
| `app/marketplace/MarketGrid.tsx` | fix "Publish yours"; real category or drop filter; filter chips → `Tag`; square |
| `components/SessionView.tsx` | one Start-run control; buttons → primitives |
| `components/WorkspaceView.tsx` | status text → `Pill`; buttons → primitives; use shared `Stat` |
| `app/page.tsx` | delete local `Stat` |
| `components/PackBuilderView.tsx` | input/composer consistency (minor) |
| `app/settings/page.tsx` | buttons → `ActionButton`; square toggle |
| `components/HomeAccountMenu.tsx` | avatar → square (or `Avatar`) |
| `components/ui.tsx` | EmptyState icon square; dedupe chip set; add `Input` + `Stat` bare variant |
| `lib/types.ts` / `lib/api.ts` | one type system |
| `lib/mock.ts` | delete dead functions; keep `marketplaceSeed` only |
| `components/ChatPane.tsx`, `ImportPackButton.tsx` | delete |
| `app/layout.tsx` | don't fetch workspaces for auth routes |
| `app/profile/ProfileStats.tsx` | `Promise.all` |
| ESLint config | custom no-hand-rolled-primitives rule |
