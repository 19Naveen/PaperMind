# PaperMind frontend — honest review (2026-08-09)

Reviewed by driving the **live app** (logged in as `ada@papermind.io`) through every
route with Playwright (HTTP ≥400, render errors, console errors) and reading each
component/page. Prioritized so agents can take slices.

---

## P0 — functional bugs

1. ✅ **Profile page threw at runtime** — `initialsOf` was imported from the client
   `AuthProvider` into a server component. **Fixed**: local server-safe `initialsOf`
   in `app/profile/page.tsx`. Verified: console error gone.

## P0 — the real reason it "doesn't look like the reference"

2. **Sparse seed data.** `backend/seed_demo.py` creates 1 user, 1 pack, 2 workspaces,
   2 **draft** sessions — no completed runs, no facts, no citations, few marketplace
   packs. Concrete effects across the app:
   - Home workspace cards: `0 docs · 0 sessions · 0%` (progress bar hidden).
   - Workspace analytics: Verified rate shows `—`.
   - Session Checklist/Grid/Diff/Explorer: only the "no run yet" state is reachable.
   - Home "Needs your review" + "Recent activity" rails: empty.
   - Marketplace: very few packs.
   The reference HTML looks rich because it is full of sample data; the app is truthful
   but empty. **Fix (backend, owner — not haiku)**: enrich `seed_demo.py` to create
   more workspaces with packs, sessions whose runs are **complete** with a realistic
   spread of verified/unsupported/missing **facts + citations**, and several
   marketplace packs. This single change makes home / workspace / session / marketplace
   look like the reference with real data.

---

## Per-route critique

### Login / Signup  — P1
- Matches the reference `.login` two-panel layout. **Brand panel is bare vs the
  reference**: missing the 3 value-prop bullets (`.lb-points`) and a clearly-labeled
  dev demo-credentials helper (`.lb-demo`). Adding them matches the reference and adds
  density without fabricating features. Isolated to `components/auth/AuthFrame.tsx` +
  `LoginScreen.tsx`. (haiku)

### Home — good, gated by seed
- Cards now show pack + version stamp, docs, sessions, execution-progress bar (done).
- Stats card + review/activity rails are real but empty until seed is enriched.

### Marketplace — good, gated by seed
- Grid + cards match reference. Sparse until seed adds packs.
- Pack detail + edit (Studio) not re-verified this pass (the rich workspace links to
  `/workspace/{id}/pack`, not a marketplace href) — verify after seed enrichment.

### Workspace — good
- Analytics strip = Sessions / Documents / Verified rate / Open issues (done).
- **Rename + Delete** added (done): header buttons → inline rename; delete confirm modal.
- Sessions table + installed-pack rail render. Sparse until seeded.
- "Rollup" tab is an honest unavailable state (correct).

### Session (flagship) — structure good, gated by seed
- Matches reference: `.sess-head` + 3-card rail (Pipeline w/ progress+stages, Documents,
  Ask) + Checklist/Grid/Diff/Explorer surfaces.
- Only the "no run yet" state is reachable without a completed run. Needs a seeded
  completed run to show the real checklist (summary strip + grouped checks + evidence +
  correction ledger). Grid/Diff/Explorer are honest unavailable states (correct).

### Pack Studio — works, visual friction (P2)
- Back link added (navigation trap fixed).
- Header is crowded: Seg (6 tabs) + status Tag + Submit-for-review + Publish in one row
  — the user called it "shit". Tighten: wrap/stack actions, give the title room.
  Isolated to the header region of `components/PackBuilderView.tsx`. (haiku, careful —
  stateful; do not touch the send/approve logic)

### Profile / Settings — good
- Profile: fixed; honest contributions feed.
- Settings: 3-card layout, honest API-key ("not available yet"), working `.switch`
  toggles (browser-local prefs). Good.

---

## Polish / friction (P2)
- Workspaces named "Debug Install Ws / Ws2" from manual testing clutter the sidebar —
  gone once the seeder is rewritten/reset.
- Mobile (≤980 / ≤640) not exercised this pass; reference breakpoints exist in CSS and
  should hold, but verify after seed.
- `IconLock` in `SessionView` is an inline SVG (acceptable; add to `icons.tsx` if reused).

---

## Agent assignments (this iteration)
- **haiku → Login brand panel** (AuthFrame + LoginScreen): add `.lb-points` (3 honest
  value props) + a clearly-labeled dev demo-credential helper wired to the real fields.
  No fabricated features.
- **owner (next iteration) → seed enrichment** (`seed_demo.py`): completed runs + facts +
  citations + more packs/workspaces. This is the biggest lever.
- **haiku → Studio header declutter** (PackBuilderView header only): stack/wrap actions.

## Verification done this iteration
- `npx tsc --noEmit` clean · `npm run lint` (ui-guard) clean · `npm run build` clean ·
  route crawl: all routes render without errors after the Profile fix.
