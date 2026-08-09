# Evidence — PaperMind full frontend audit

> **Audit location correction.** This audit worktree predates the active frontend and contains only the legacy Streamlit snapshot. Evidence was therefore collected read-only from the active checkout at `/home/naveen/Projects/PaperMind/web`. Remediation must target `web/`; this audit directory is the report container.

## Evidence confidence

- **Source inspection:** High confidence for component structure, labels, reachable code paths, semantic markup, tokens, and route/API wiring.
- **Live validation:** `http://127.0.0.1:3000/` returned HTTP 200 and `<title>PaperMind</title>`. `npm run lint` passed (`ui-guard: clean`) and `npm run build` compiled, type-checked, and generated all declared routes.
- **Browser limitation:** Chromium is unavailable in this environment, so no screenshot, tab walk, or browser network waterfall was captured. All visual, focus, performance, and request-count measurements below are source/artifact-derived where marked.

## 1. Structural and flow evidence

### Route and workflow coverage

The application has real routes for `/`, `/login`, `/signup`, workspace creation/detail/pack/session, marketplace detail/edit, profile, and settings (`web/app/**/page.tsx`; route inventory in `web/README.md:65-88`). Primary task flow is implemented as sign-in → workspace → installed/authored pack → create session → upload documents → start run → cited result review → run chat (`web/lib/session.ts:84-191`; `web/components/NewWorkspaceWizard.tsx:27-80`; `web/components/SessionView.tsx:191-249`).

Production safety checks pass, but they prove compilation—not user-complete flows: `web/package.json:5-11`; only a 13-line Playwright smoke test is present in `web/e2e/smoke.spec.ts:1-13`.

### Functional completeness and friction

- Start run is correctly disabled without documents and run state is polled every two seconds (`web/components/SessionView.tsx:191-205,341-349`). The empty/disabled relationship is not communicated programmatically.
- Session chat is streamed but then calls `router.refresh()`, losing the ephemeral conversation transcript after a reload (`web/components/SessionView.tsx:163,207-249`; known limitation `web/README.md:154`).
- Corrections can be written but cannot be read back: UI explicitly says a read-back view is coming (`web/components/SessionView.tsx:549-558`; write action `web/lib/session.ts:138-150`).
- Grid, Diff, Explorer, and workspace Rollup are explicitly locked/roadmap surfaces (`web/components/SessionView.tsx:564-586`; `web/components/WorkspaceView.tsx:279-287`). This is honest, but it creates tabs with no task completion.
- Marketplace and pack lifecycle routes are real (`web/app/marketplace/[packId]/page.tsx:27-168`, `ReleasePanel.tsx:1-249`); draft packs are clearly non-installable (`web/app/marketplace/MarketGrid.tsx:10-17,53`).
- Inert header controls: the Search/⌘K and Notifications surfaces are styled spans, not controls (`web/components/HomeNavbar.tsx:31-39`).
- A wizard option claims imported-spec support, but no code writes `IMPORT_SPEC_KEY` (`web/components/NewWorkspaceWizard.tsx:38-50,139-141`; `web/lib/types.ts:27`).

### Structural redundancy and avoidable complexity

- Two canvas implementations (`web/components/GraphCanvas.tsx:27-294`; inline `WorkflowDiagram` at `PackBuilderView.tsx:91-139`) and three graph transformations (`web/lib/types.ts:80-119,179-223`; `PackBuilderView.tsx:43-63`).
- Duplicate `PackSpec` types (`web/lib/api.ts:216-221`; `web/lib/types.ts:70-75`), dead mock surface (`web/lib/mock.ts:1-16`), dead import key, 2-line AuthField re-export (`web/components/auth/AuthField.tsx:1-2`), and unused legacy CSS (see Visual).
- Studio header places a six-tab segment, status, title and two actions together (`web/components/PackBuilderView.tsx:424-459`), producing a dense high-cognitive-load control strip.

## 2. Visual system evidence — INFERRED from source

### System and scales

- Typography: Inter display/body and JetBrains Mono data font (`web/app/globals.css:12-15`); active values include 9.5, 10, 10.5, 11, 11.5, 11.75, 12, 12.5, 12.75, 13, 13.5, 14, 14.5, 15, 19, 21–26px (`globals.css:77,105-182,712-764,839-844`). The density comes from many near-adjacent sizes rather than a disciplined short scale.
- Spacing: visible values include 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 20, 22, 24, 26, 28, 32, 36, 48, 56, 64, 72, 80px (`globals.css:113-181,282-305,835-847`). This is much wider than a compact design token scale.
- Active 2.0 palette has 19 key named colors/tokens: ground/surface/inset/ink trio/rules/accent trio/status colors/highlight (`web/app/globals.css:663-688`).
- The base 1.0 “Soft Paper” palette is still shipped at `globals.css:52-72` and fully overridden by 2.0 at `663-698`. Component CSS is also layered twice across 1,079 global lines.
- The primary visual system is coherent in its final layer—light neutral canvas, dark sidebar, restrained indigo accent, 8–12px radii—though it inherits dead and contradictory source styles.

### State coverage

- Empty: present with shared `EmptyState` and factual unavailable states (`web/components/ui.tsx`; `SessionView.tsx:564-586`; `WorkspaceView.tsx:279-287`).
- Loading: global pulse skeleton with `aria-busy` (`web/app/loading.tsx:3-9`).
- Error: root error boundary with retry/home (`web/app/error.tsx:7-17`) and auth error alerts (`web/components/auth/LoginScreen.tsx:50`; `SignupScreen.tsx:62`).
- Success: inline save/process states, but most are not announced (`web/app/settings/page.tsx:103-109,159-190`; `SessionView.tsx:207-249`).
- Focus: global focus-visible rule (`web/app/globals.css:704-705`) is present.
- Disabled: controls use native `disabled` in shared primitives (`web/components/ui.tsx:53-76,129-145`) and flow-specific actions (`SessionView.tsx:341-349`).
- Reduced motion: honored globally (`web/app/globals.css:654-656`). Dark mode is absent: `color-scheme: light` is set at `:53`, and final tokens are fixed light values at `663-698`.

## 3. Accessibility and interaction evidence

### Keyboard and semantics

- Signed-in shell exposes five landmarks (main, sidebar/complementary, nav, header, breadcrumb nav) (`web/components/AppShell.tsx:46-97`; `HomeNavbar.tsx:24-44`). Auth has main plus aside (`AuthFrame.tsx:11-12`). No skip link is rendered although CSS exists (`globals.css:96-97`).
- The invisible desktop scrim button is in tab order (`web/components/AppShell.tsx:90`; CSS only suppresses interaction/opacity at `globals.css:275-276`).
- Delete dialogues declare `alertdialog` and `aria-modal`, but do not move focus in, trap it, or restore it (`WorkspaceView.tsx:291-320`; `SessionView.tsx:590-624`).
- Mobile navigation has no `aria-expanded` and no Escape handling (`HomeNavbar.tsx:25`; `AppShell.tsx:90`).
- The account disclosure uses `role=menu/menuitem` without the required menu keyboard model (`web/components/HomeAccountMenu.tsx:14-34`). Segments declare a `tablist` but use `aria-pressed` without tab roles, selected state, panels, or arrow navigation (`web/components/ui.tsx:254-260`; `SessionView.tsx:465-471`).
- Primary actions are normally native buttons/links and keyboard reachable; notable exceptions are the fake Search/Notification controls (`HomeNavbar.tsx:31-39`), graph-node rename being double-click-based (`web/components/graph/EditableLabel.tsx:50-55`), and label-less text inputs at `NewWorkspaceWizard.tsx:119,157`, `PackBuilderView.tsx:491-496`, and `graph/EditableLabel.tsx:30`.

### Contrast (calculated against referenced backgrounds)

Passes: ink #18181b on white 16.5–17.7:1; ink-2 #52525b on white 7.7:1; ink-3 #6f6f78 on ground 4.64:1; accent #5b5bd6 on white 5.37:1; status colors 4.85–5.83:1 (`web/app/globals.css:663-688,723-764`).

Fails: muted #6f6f78 on studio inset #f0f1f4 ≈4.41:1 (`globals.css:23,710`); inactive segment #777782 on #efeff2 ≈3.86:1 (`:761-763`); small sidebar email/plan metadata #7e7e89 on #151519 ≈4.54:1 but used at 10.5–11px (`:816,819`).

### Feedback announcements

Only authentication errors use `role=alert` (`LoginScreen.tsx:50`; `SignupScreen.tsx:62`). Streaming chat, run status, upload results, save success, and non-auth errors have no `aria-live`, `role=log`, or equivalent announcement (`SessionView.tsx:191-256`; `MarketplaceInstall.tsx:81`; `ReleasePanel.tsx:246`; `NewWorkspaceWizard.tsx:191`; `settings/page.tsx:103-190`).

## 4. Copy and honesty evidence

The review is mostly forthright about unfinished features: roadmap tabs (`SessionView.tsx:564-586`), unavailable API keys (`settings/page.tsx:195-199`), browser-local notifications (`settings/page.tsx:280-282`), unavailable contribution history (`profile/page.tsx:58-61`), and non-installable draft packs (`MarketGrid.tsx:10-17,53`).

However, honesty breaks where an affordance implies function: `⌘K` on non-interactive Search and a non-interactive Notifications bell (`HomeNavbar.tsx:31-39`); impossible “Imported spec” selection (`NewWorkspaceWizard.tsx:139-141`); a source channel that does not replay conversations (`SessionView.tsx:163,207-249`). Developer credentials are rendered in the auth UI, even though labelled development-only (`web/components/auth/AuthFrame.tsx:44-51`).

Unclear technical copy persists: “RAG,” “Studio,” “spec,” “freeze,” “promote,” and “governance” surface directly in flow labels (`PackBuilderView.tsx:424-459`; `marketplace/[packId]/page.tsx:147`; `ReleasePanel.tsx:182`). The design needs progressive disclosure of these terms—plain language first, technical vocabulary secondary.

## 5. Weight and friction evidence — measured/estimated

- Runtime dependencies are restrained: only Next, React, React DOM, and React Flow (`web/package.json:13-18`).
- Production artifacts measure **649,137 raw bytes / ~192,992 gzip JS** for home; CSS is **94,435 raw / 18,674 gzip**; fonts 79,772 bytes. Initial transfer estimate is **~310KB gzip plus HTML/favicon**. (`web/.next` build-manifest and client-reference manifests; build measured 2026-08-09.) This meets the Rams under-500KB score band, not the under-100KB band.
- Estimated initial home requests: ~17 (HTML, 9 JS, CSS, 2 fonts, 3 manifests, favicon). Home performs **4 + N** server API requests because `getMe` and `listWorkspaces` are duplicated in layout/page and each workspace gets a full `getWorkspace` request (`web/app/layout.tsx:19-20`; `app/page.tsx:15-19`; `web/lib/api.ts:85-98,426-428`).
- TTI is estimated at **1.5–3.0 seconds** on desktop, driven primarily by uncached serial backend work; no browser measurement was possible.
- Idle homepage animation count is 0; loading has six pulse elements and active runs have spinner/pulse indicators (`web/app/loading.tsx:5-9`; `globals.css:132,151,483`). Reduced motion is respected.
- Every API request uses `cache: no-store`, without React/cache/ISR strategy (`web/lib/api.ts:85-98`). Polling runs every two seconds with no backoff or visibility check (`SessionView.tsx:191-205`).

## 6. Evidence synthesis

The core product is a real, compilable, API-connected workflow system with a controlled visual language, meaningful run states, preserved failure boundaries, and responsible destructive confirmations. It is **not yet fully working or professionally finished** because productive routes contain deliberately locked destinations, chat/correction continuity gaps, fake global controls, misleading semantics, accessibility defects, an incomplete feedback model, no color-scheme support, and a performance architecture that repeats avoidable backend work.
