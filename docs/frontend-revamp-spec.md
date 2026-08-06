# PaperMind frontend specification

## Objectives

PaperMind uses the Modernist interface in `Reference/PaperMind.dc.html` as its visual and compositional source of truth. New frontend work must preserve that design language while keeping the production application's real API integration, authentication, streaming, evidence correction, loading feedback, and responsive accessibility.

Priority order is visual correctness, maintainability, then enhancement. Changes must not introduce a second visual language or replace the current framework.

## Scope

This specification covers the Next.js application in `web/`: the application shell, authentication, home, marketplace, workspace creation and overview, Pack Studio, sessions, profile, settings, shared primitives, responsive behavior, navigation, interaction feedback, and accessibility.

The HTML prototype does not define production API behavior, authentication, profile, settings, or failure handling. In those areas, follow the same tokens and geometry while retaining the target application's stronger functional behavior.

## Design principles

- Paper is the canvas: use the warm ground for the shell and primary page surfaces.
- Ink establishes hierarchy; red-orange is reserved for actions, active location, and meaningful emphasis.
- Use sharp corners. Rounded cards, inputs, menus, and buttons are outside the design language.
- Use 1px rules for local grouping and 2px rules for structural boundaries.
- Prefer a modular ledger grid over floating dashboard tiles.
- Type, spacing, weight, rules, and alignment establish hierarchy before color or shadow.
- Display real states and metrics. Never add prototype-only numbers that the API cannot support.
- Preserve useful production improvements when they do not conflict with these principles.

## Reference project guidelines

`Reference/PaperMind.dc.html` is canonical for:

- the 266px desktop rail;
- fixed-viewport desktop shell and pane-owned scrolling;
- 18px by 24px page headers;
- 24px content gutters and 18px card gaps;
- page and panel composition;
- Pack Studio's conversation, canvas, and inspector hierarchy;
- 452px session conversation/state rail;
- typography, button, card, tag, table, and segmented-control treatment;
- active navigation bars and workspace/session hierarchy.

Reference inline state and sample numbers are illustrative, not data contracts. Production state, API types, safe mutations, error handling, and accessibility take precedence over prototype scripting.

## Component conventions

Page routes in `web/app/` fetch, authorize, and render a page-level view. Repeated visual patterns belong in `web/components/ui.tsx`; page views must use those primitives instead of duplicating literal headers, buttons, cards, tags, tables, or status treatments.

Use:

- `PageHeader` for the eyebrow/title/action row;
- `Button` for links and `ActionButton` for mutations;
- `Card`, `CardKicker`, `CardTitle`, `CardBody`, and `CardMeta` for card content;
- `Tag` for neutral metadata and `Pill` for operational state;
- `Seg` for mutually exclusive view controls;
- `Th` and `Td` for ledger tables;
- `EmptyState` for actionable empty collections.

Only promote a feature pattern into the shared design system after repeated use. Avoid feature-neutral `utils` or `common` directories.

## Styling conventions

Tokens live in `web/app/globals.css`. Components consume semantic Tailwind names such as `ground`, `surface`, `raised`, `ink`, `ink-2`, `rule`, and `accent`; do not duplicate hex values in components.

- Body: Archivo, 15px, 1.55 line height.
- Display: Archivo 800 with tight tracking.
- Data: JetBrains Mono for identifiers, timestamps, states, and locator stamps.
- Eyebrow: 10px uppercase with 0.1em tracking.
- Structural spacing follows a 4/8px rhythm, with reference exceptions at 10, 14, 18, 20, 24, 28, and 32px.
- Cards use flat paper surfaces and restrained elevation. Add borders only when the composition calls for a ledger cell or interactive boundary.
- Transitions should be brief, usually 100–150ms. Animate state change, not decoration.
- The canonical palette is light. A future dark theme must be explicit, complete, and separately reviewed rather than inferred automatically from the operating system.

## Layout rules

Desktop uses a fixed `100dvh` shell with hidden root overflow. The 266px rail and the content column remain fixed; individual page panes own vertical scrolling. Every flex/grid ancestor of an internal scroller must carry `min-height: 0`.

The main desktop content gutter is 24px. At narrow widths it may reduce to 16px. Primary headers and structural rules stay full width; avoid arbitrary centered wrappers that detach body alignment from the header.

- Home: header, two-column introduction/stat block, workspace grid, recent-activity ledger.
- Marketplace: search in the header, filter rail, responsive Pack grid.
- Workspace: header actions, installed-Pack hero with contents rail, five-cell stat strip, live sessions/activity.
- Pack Studio: 360px conversation, canvas of at least 520px, 312px inspector. Horizontal overflow is acceptable before collapsing the authoring tool into an unusable width.
- Session: 452px state/conversation rail plus flexible results pane on wide screens; stack only when the remaining report width would be unusable.

## Navigation rules

- Use `next/link` for internal navigation and preserve client-side transitions.
- Desktop navigation follows Home/Marketplace, workspace switcher, Overview/Pack, Sessions, then account controls.
- The active location uses both `aria-current="page"` and the 3px accent bar. Do not rely on color alone.
- Workspace session entries should link directly to their session and expose title plus useful state or updated metadata when available.
- “New session” creates the session and opens it; it must not masquerade as a link back to Overview.
- Mobile navigation must retain access to Home, Marketplace, the current workspace and Pack, Profile, Settings, and sign-out. Active state must remain visible.
- Disclosures close on Escape and outside interaction, return focus to their trigger, and expose correct expanded state.
- Protected routes redirect signed-out visitors to `/login` consistently.

## Responsive guidelines

- Design and test at 320px, 375px, 768px, 1024px, 1280px, and 1440px widths.
- Account for the desktop rail when selecting breakpoints; a 1024px viewport leaves only 758px for application content.
- Wrap action rows and install controls. Inputs may become full width on mobile.
- Wide tables use a labeled horizontal scroll container rather than crushing columns.
- Wizard steppers wrap or scroll without clipping at 320px.
- Prefer `dvh` to `vh` for mobile browser chrome.
- Touch targets should be at least 40px where space permits and never below 32px.

## Accessibility requirements

- All interactive controls are keyboard reachable and have a visible focus state.
- Use semantic buttons, links, navigation landmarks, headings, lists, tables, and form labels.
- Do not communicate active, verified, missing, running, or failed state through color alone; pair it with text, a glyph, or both.
- Menus, dialogs, and comboboxes require robust focus management. Use an installed accessible primitive when one exists; otherwise implement the complete keyboard behavior.
- Escape closes transient overlays. Destructive confirmation buttons name the action.
- Async success uses `role="status"`; actionable errors use `role="alert"` and connect field errors with `aria-describedby`.
- Streaming chat and run updates use stable polite live regions.
- Preserve input values after server errors and disable submissions in flight.
- Respect `prefers-reduced-motion`; no information may depend on animation.

## Directory structure

```text
web/
  app/
    layout.tsx                 root data and shell
    page.tsx                   home route
    marketplace/              marketplace route and filters
    workspace/
      new/                     creation wizard
      [id]/                    overview, Pack, and session routes
    login/ signup/             authentication routes
    profile/ settings/         account routes
    globals.css                canonical tokens and global behavior
  components/
    ui.tsx                     design-system primitives
    AppShell.tsx               responsive application navigation
    *View.tsx                  page-level interactive composites
    auth/                      authentication-only components
    graph/                     Pack graph node components
  lib/
    api.ts                     typed API boundary
    session.ts                 server actions
    icons.tsx                  shared icons
    types.ts                   frontend-only domain/view types
```

## Reusable component strategy

Keep the shared layer small and semantic. A primitive owns its type, color, spacing, borders, states, and focus treatment. Feature components own data and layout composition. Prefer composition over adding many boolean props.

When a visual rule changes, update the primitive first and review every consumer. When the same page pattern appears for a third time, promote it deliberately. Remove an older component only after confirming it has no route, import, or planned parity role.

## Audit baseline and resolved direction

The restoration audit identified these primary regressions:

- unbounded document scrolling replaced the fixed console shell;
- rail/header surfaces and structural rule weights drifted;
- workspace actions and the authoring path disappeared;
- the Pack Studio lost its three-pane and three-view architecture;
- Home lost recent activity and two aggregate cells;
- Marketplace search/filter composition moved away from the reference;
- desktop session navigation and several mobile destinations became incomplete;
- automatic dark mode introduced an unreviewed second palette;
- repeated headers, buttons, stats, and inputs bypassed shared primitives;
- narrow wizard and install controls could overflow.

Future work should treat this list as a regression checklist, not an invitation to reproduce reference-only mock data.

## Future maintenance guidelines

For each frontend change:

1. Compare the affected page with the reference at desktop width.
2. Verify the fixed shell and every pane's scroll ownership.
3. Check shared primitives before adding literal styling.
4. Exercise route links, active states, browser back/forward, and direct URLs.
5. Test empty, loading, error, pending, success, and populated states.
6. Test keyboard navigation, focus return, live announcements, and reduced motion.
7. Test the responsive widths listed above.
8. Run ESLint, TypeScript, tests when present, and the production build.
9. Update this specification when a deliberate design-system decision changes.

Do not silently preserve a divergence. Either restore the reference behavior, or document why the production behavior is safer, more accessible, more truthful, or more maintainable.
