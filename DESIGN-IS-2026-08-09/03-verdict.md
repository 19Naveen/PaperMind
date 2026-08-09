# Verdict — REDESIGN

**REDESIGN:** PaperMind scores **15/30**; although the core API-backed workflow exists and the visual language has a viable base, primary-task usefulness, clarity, honesty, accessibility detail, and restraint are below the refinement threshold, so this needs a purpose-led product redesign rather than another visual overlay.

## Why redesign rather than refine

The issue is structural, not merely aesthetic: users encounter product-shaped controls that do nothing, select tabs that deliberately end in locked stubs, cannot rely on corrections or chat to persist, and must decode internal workflow terminology before they can make reliable progress. Decorating the existing information architecture would preserve those failures.

## Preserve

- The sober visual basis: light neutral content canvas, dark navigation rail, limited indigo accent, simple cards and controls (`web/app/globals.css:663-766`).
- The API-connected primary backbone: auth → workspace → pack → session → run → cited review (`web/lib/session.ts:84-191`; `web/components/SessionView.tsx:191-249`).
- Honest empty/error/loading patterns and destructive confirmations (`web/app/loading.tsx:3-9`; `web/app/error.tsx:7-17`; `web/components/WorkspaceView.tsx:291-320`; `web/components/SessionView.tsx:590-624`).
- Versioned, append-only workflow intent (`web/app/workspace/[id]/pack/page.tsx:129-131`; `web/app/marketplace/[packId]/page.tsx:147`).

## Discard or consolidate

- Inert search/notification chrome and fake `⌘K` interaction. Evidence: `web/components/HomeNavbar.tsx:31-39`. Caused failures on #4 Understandable and #6 Honest.
- Visible roadmap tabs (Grid, Diff, Explorer, Rollup) until each has a complete user outcome. Evidence: `web/components/SessionView.tsx:465-471,564-586`; `web/components/WorkspaceView.tsx:211-218,279-287`. Caused failures on #2 Useful, #4 Understandable, and #10 Less design.
- Duplicate graph/canvas projection and associated type/model translations. Evidence: `web/components/GraphCanvas.tsx:27-294`; `web/components/PackBuilderView.tsx:43-63,91-139`; `web/lib/types.ts:80-119,179-223`. Caused failure on #10 Less design.
- The legacy visual layer and unused controls/styles. Evidence: `web/app/globals.css:52-72,96-97,603-611,663-698`. Caused failures on #3 Aesthetic and #10 Less design.

## Highest-leverage moves

1. **#2 Useful — build one complete review loop before exposing secondary surfaces:** session creation → document upload → run → cited checklist → correction history → persistent run chat must survive refresh, while incomplete Grid/Diff/Explorer/Rollup stay absent. Evidence: `web/components/SessionView.tsx:163,207-249,549-586`; `web/components/WorkspaceView.tsx:279-287`.
2. **#4 Understandable — make the product speak in user goals, not implementation nouns:** rename or explain Pack, Studio, Ports, Ledger, Frozen, Rollup, UUID, Promote and stage jargon; distinguish creating a workspace from opening one. Evidence: `web/components/PackBuilderView.tsx:424-459,518,532,630-637`; `web/components/NewWorkspaceWizard.tsx:188-195`; `web/app/marketplace/[packId]/ReleasePanel.tsx:175-182`.
3. **#6 Honest — remove every affordance without a working outcome:** remove Search/Notifications/⌘K, gate draft-pack install, re-label “Correct” as “Propose correction” until applied/readable, and eliminate the unreachable imported-spec option. Evidence: `web/components/HomeNavbar.tsx:31-39`; `web/app/marketplace/[packId]/MarketplaceInstall.tsx:9-17,76-78`; `web/components/SessionView.tsx:130-145,549-558`; `web/components/NewWorkspaceWizard.tsx:38-50,139-141`.
4. **#8 Thorough — make interaction state accessible and recoverable:** add a skip link, proper button/tab/disclosure semantics, modal focus management, visible disabled rationale, associated labels, live announcements for run/chat/upload/save changes, and repair contrast failures. Evidence: `web/app/globals.css:96-97,761-763`; `web/components/AppShell.tsx:90`; `web/components/ui.tsx:254-260`; `web/components/SessionView.tsx:191-256,590-624`; `web/components/NewWorkspaceWizard.tsx:119,157`.
5. **#10 Less design / #9 Efficient — collapse redundant system layers and remove needless repeated requests:** retain one workflow graph, one PackSpec type, one status map/SSE parser/delete dialog, one active CSS layer, and deduplicate/cache dashboard data while making run polling visibility-aware and backoff-capable. Evidence: `web/components/GraphCanvas.tsx:27-294`; `web/lib/api.ts:85-98,216-221`; `web/lib/types.ts:70-75`; `web/app/layout.tsx:19-20`; `web/app/page.tsx:15-19`; `web/components/SessionView.tsx:191-205`.
