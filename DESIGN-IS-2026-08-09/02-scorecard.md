# Dieter Rams scorecard — PaperMind frontend

Scoring rule applied: the lower score wins on ambiguity; representative weakest instances determine each principle. See `01-evidence.md` for source citations and qualification.

1. **Good design is innovative — Score: 2/3**  
   **Evidence:** Pack authoring turns a conversational draft into versioned workflow contracts and a governed release lifecycle (`web/components/PackBuilderView.tsx:424-459`; `web/app/marketplace/[packId]/ReleasePanel.tsx:1-249`).  
   **Justification:** This usefully combines familiar AI drafting and versioned workflow controls, but the surrounding patterns are conventional and duplicate graph mechanisms dilute the distinctive idea.

2. **Good design makes a product useful — Score: 1/3**  
   **Evidence:** The core flow exists (`web/lib/session.ts:84-191`), but Grid/Diff/Explorer/Rollup are task-ending placeholders (`web/components/SessionView.tsx:564-586`; `WorkspaceView.tsx:279-287`); corrections have no read-back (`SessionView.tsx:549-558`) and chat does not persist (`SessionView.tsx:163,207-249`).  
   **Justification:** A user can complete a first run, but essential review continuity and several visible destinations require detours or end without delivering their implied value.

3. **Good design is aesthetic — Score: 2/3**  
   **Evidence:** The active 2.0 layer consistently uses a restrained light neutral/indigo system (`web/app/globals.css:663-766`) with coherent cards, controls, and responsive rules (`:835-1013`), but 1,079 lines include an overridden older palette (`:52-72`) and a large range of near-adjacent spacing/type sizes (`:77-182`, `:712-764`).  
   **Justification:** The visible direction is polished and mostly coherent, but the accumulated CSS layers and overly granular scale keep it one cleanup short of a singular visual system.

4. **Good design makes a product understandable — Score: 1/3**  
   **Evidence:** Search/⌘K and Notifications look actionable but are inert spans (`web/components/HomeNavbar.tsx:31-39`); the imported-spec option lacks a producer (`NewWorkspaceWizard.tsx:38-50,139-141`); technical terms appear directly in the primary workflow (`PackBuilderView.tsx:424-459`; `ReleasePanel.tsx:182`).  
   **Justification:** First-time users cannot correctly name the behavior of several highly visible controls, and the pack flow asks them to decode internal vocabulary instead of leading with their goal.

5. **Good design is unobtrusive — Score: 1/3**  
   **Evidence:** The studio header packs six tabs, a state tag, title, and two actions into one band (`web/components/PackBuilderView.tsx:424-459`); the application shell retains non-working global chrome (`HomeNavbar.tsx:31-39`); sidebar, top bar, rails and card layers are always present (`globals.css:795-835`).  
   **Justification:** The product’s chrome is attractive but often competes with the research/review task, especially in the authoring experience.

6. **Good design is honest — Score: 1/3**  
   **Evidence:** Roadmap states are candid (`SessionView.tsx:564-586`; `settings/page.tsx:195-199`), yet fake global affordances (`HomeNavbar.tsx:31-39`), a never-produced import choice (`NewWorkspaceWizard.tsx:139-141`), and lost chat/correction histories (`SessionView.tsx:163,207-249,549-558`) leave labels and durable behavior misaligned.  
   **Justification:** No payment or scarcity deception is present, but multiple offered/recorded capabilities do not behave as a user would reasonably infer.

7. **Good design is long-lasting — Score: 2/3**  
   **Evidence:** Inter, neutral surfaces, practical 8–12px radii, and limited indigo status accents form a durable visual vocabulary (`web/app/globals.css:663-766`); product state is versioned append-only in visible copy (`web/app/marketplace/[packId]/page.tsx:147`).  
   **Justification:** The visual base should age well, but decorative premium-SaaS styling and layered legacy source prevent the stronger “deliberately timeless” score.

8. **Good design is thorough down to the last detail — Score: 1/3**  
   **Evidence:** Loading, error, focus, disabled, and reduced-motion states exist (`web/app/loading.tsx:3-9`; `app/error.tsx:7-17`; `globals.css:654-656,704-705`), but non-auth updates are not announced (`SessionView.tsx:191-256`; `settings/page.tsx:103-190`); dialogs lack focus management (`WorkspaceView.tsx:291-320`; `SessionView.tsx:590-624`); contrast fails for inactive segments (`globals.css:761-763`).  
   **Justification:** Several states are visibly designed, but a cluster of keyboard, contrast, dialogue, labeling, and live-feedback gaps means the details do not yet express consistent user care.

9. **Good design is environmentally friendly — Score: 2/3**  
   **Evidence:** Home initial transfer is estimated around 310KB gzip, idle home has no infinite animation, and reduced motion is honored (`01-evidence.md §5`; `globals.css:654-656`). No dark scheme is supported (`globals.css:53,663-698`), every API request is `no-store` (`web/lib/api.ts:85-98`), and active runs poll every 2 seconds (`SessionView.tsx:191-205`).  
   **Justification:** Artifact size is reasonable and motion is gated, but light-only rendering and repetitive uncached network work prevent a more efficient score.

10. **Good design is as little design as possible — Score: 1/3**  
    **Evidence:** Shared primitives and an enforced UI guard are strengths (`web/components/ui.tsx:1-363`; `web/scripts/ui-guard.mjs:12-28`), while duplicate canvases/types, dead mock/import key, old CSS layer, unused skip/toast CSS, roadmap tabs, and fake header controls remain (`GraphCanvas.tsx:27-294`; `PackBuilderView.tsx:91-139`; `lib/mock.ts:1-16`; `globals.css:52-72,96-97,603-611`; `HomeNavbar.tsx:31-39`).  
    **Justification:** More than five visible or technical elements can be removed, completed, or consolidated without harming—and often improving—the primary task.

## Total: **15/30**
