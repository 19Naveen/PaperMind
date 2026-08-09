```
/make-plan Redesign PaperMind’s authenticated research-review workspace, session-review, and workflow-authoring experience. Current design failed audit at 15/30 with critical gaps in principles #2 useful, #4 understandable, #6 honest, #8 thorough, and #10 as little design as possible.

Primary user: A knowledge worker or reviewer who needs to run a reusable document-review workflow, examine cited findings, and manage workflow versions without learning internal system vocabulary.
Primary task: Create/select a workspace, choose or author one reusable workflow, upload documents, run a review, inspect cited results, and record durable corrections with clear feedback.
Constraints: Implement in the existing Next.js 16 / React 19 / TypeScript / FastAPI-server-action stack under `web/`; preserve existing PaperMind light-neutral/dark-rail/indigo brand tokens; meet WCAG 2.2 AA keyboard, focus, labeling, contrast and live-feedback basics; no new feature surface until the core review loop works end-to-end.

Verdict paragraph (quoted from 03-verdict.md):
> REDESIGN: PaperMind scores 15/30; although the core API-backed workflow exists and the visual language has a viable base, primary-task usefulness, clarity, honesty, accessibility detail, and restraint are below the refinement threshold, so this needs a purpose-led product redesign rather than another visual overlay.

Why redesign and not refine: The defects are structural rather than cosmetic: the current information architecture exposes fake global controls and task-ending roadmap tabs, while correction and chat histories cannot support a durable review loop.

Preserve from current design (MUST be non-empty):
- The sober visual basis—light neutral canvas, dark navigation rail, limited indigo accent, simple cards and controls—from `web/app/globals.css:663-766`.
- The API-connected backbone auth → workspace → pack → session → run → cited review from `web/lib/session.ts:84-191` and `web/components/SessionView.tsx:191-249`.
- Honest loading/error/empty states and destructive confirmations from `web/app/loading.tsx:3-9`, `web/app/error.tsx:7-17`, `web/components/WorkspaceView.tsx:291-320`, and `web/components/SessionView.tsx:590-624`.
- Append-only workflow versioning from `web/app/workspace/[id]/pack/page.tsx:129-131` and `web/app/marketplace/[packId]/page.tsx:147`.

Discard (MUST be non-empty):
- Inert Search/Notifications/⌘K chrome. Evidence: `web/components/HomeNavbar.tsx:31-39`. Caused failure on principle #4 and #6.
- Clickable Grid/Diff/Explorer/Rollup roadmap placeholders. Evidence: `web/components/SessionView.tsx:465-471,564-586`; `web/components/WorkspaceView.tsx:211-218,279-287`. Caused failure on principle #2, #4, and #10.
- Duplicate workflow graph/canvas projections and translations. Evidence: `web/components/GraphCanvas.tsx:27-294`; `web/components/PackBuilderView.tsx:43-63,91-139`; `web/lib/types.ts:80-119,179-223`. Caused failure on principle #10.
- The overridden legacy visual layer and unused controls/styles. Evidence: `web/app/globals.css:52-72,96-97,603-611,663-698`. Caused failure on principle #3 and #10.

Top 3–5 moves from the audit (verbatim):
1. #2 Useful — build one complete review loop before exposing secondary surfaces: session creation → document upload → run → cited checklist → correction history → persistent run chat must survive refresh, while incomplete Grid/Diff/Explorer/Rollup stay absent. Evidence: `web/components/SessionView.tsx:163,207-249,549-586`; `web/components/WorkspaceView.tsx:279-287`.
2. #4 Understandable — make the product speak in user goals, not implementation nouns: rename or explain Pack, Studio, Ports, Ledger, Frozen, Rollup, UUID, Promote and stage jargon; distinguish creating a workspace from opening one. Evidence: `web/components/PackBuilderView.tsx:424-459,518,532,630-637`; `web/components/NewWorkspaceWizard.tsx:188-195`; `web/app/marketplace/[packId]/ReleasePanel.tsx:175-182`.
3. #6 Honest — remove every affordance without a working outcome: remove Search/Notifications/⌘K, gate draft-pack install, re-label “Correct” as “Propose correction” until applied/readable, and eliminate the unreachable imported-spec option. Evidence: `web/components/HomeNavbar.tsx:31-39`; `web/app/marketplace/[packId]/MarketplaceInstall.tsx:9-17,76-78`; `web/components/SessionView.tsx:130-145,549-558`; `web/components/NewWorkspaceWizard.tsx:38-50,139-141`.
4. #8 Thorough — make interaction state accessible and recoverable: add a skip link, proper button/tab/disclosure semantics, modal focus management, visible disabled rationale, associated labels, live announcements for run/chat/upload/save changes, and repair contrast failures. Evidence: `web/app/globals.css:96-97,761-763`; `web/components/AppShell.tsx:90`; `web/components/ui.tsx:254-260`; `web/components/SessionView.tsx:191-256,590-624`; `web/components/NewWorkspaceWizard.tsx:119,157`.
5. #10 Less design / #9 Efficient — collapse redundant system layers and remove needless repeated requests: retain one workflow graph, one PackSpec type, one status map/SSE parser/delete dialog, one active CSS layer, and deduplicate/cache dashboard data while making run polling visibility-aware and backoff-capable. Evidence: `web/components/GraphCanvas.tsx:27-294`; `web/lib/api.ts:85-98,216-221`; `web/lib/types.ts:70-75`; `web/app/layout.tsx:19-20`; `web/app/page.tsx:15-19`; `web/components/SessionView.tsx:191-205`.

Redesign principles in priority order:
1. Principle #2 — Useful: a reviewer completes the core loop without a dead end, unsupported action, or lost review context.
2. Principle #4 — Understandable: each visible control has a single, plain-language purpose that a first-time user can correctly predict.
3. Principle #6 — Honest: no visible action, badge, result, keyboard shortcut, or status promise exists without its actual user outcome.

Deliverables for the plan:
- New information architecture, not derived from the old tabs and chrome.
- New primary flow, low-fi and labelled, compared side-by-side with the current one.
- States checklist for empty, loading, error, success, focus, disabled, including screen-reader announcements and recoverable failures.
- Migration path for users currently relying on existing workspace/session/pack URLs and stored sessions.
- Cutover criteria that retire the legacy tabs, fake controls, duplicate graph implementation and old CSS layer only after the replacement core loop passes build, lint, integration, keyboard, and responsive checks.

Anti-patterns to guard against:
- Porting the old navigation and tab structure under a new visual skin.
- Keeping incomplete surfaces, fake keyboard shortcuts, or roadmap tabs behind a flag indefinitely.
- Redesigning to follow a trend instead of making document review faster, clearer, and evidence-led.
- Treating the Preserve list as optional; keep those brand and API foundations while changing the user experience around them.
```
