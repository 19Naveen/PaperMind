'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceDetailOut, WorkspaceSessionOut } from '@/lib/api';
import { createSessionAction, deleteWorkspaceAction, updateWorkspaceAction } from '@/lib/session';
import { formatDate, formatTime } from '@/lib/format';
import {
  ActionButton,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Pill,
  Seg,
  Stamp,
  Tag,
  type PillTone,
} from '@/components/ui';
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDoc,
  IconLayers,
  IconMore,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@/lib/icons';

// ---------------------------------------------------------------------------
// Server-computed run rollup. One entry per session that HAS a run and whose
// run could be read; a session missing from the map has either never run or its
// run was unreadable, and those two cases must never render as zeros — a zero
// gap count reads as "clean", which is a claim we cannot make.
// ---------------------------------------------------------------------------

export interface SessionRunSummary {
  /** Run lifecycle as the engine reports it (`pending` … `failed`). */
  status: string;
  /** Stage the engine had reached, when it is still working. */
  stage: string | null;
  /** The Pack version this run pinned — provenance, and the only honest way to
   *  see that an old session ran against an older version than today's. */
  packVersion: number;
  verified: number;
  unsupported: number;
  missing: number;
  total: number;
}

export type SessionRunMap = Record<string, SessionRunSummary>;

// ---------------------------------------------------------------------------
// Status vocabulary — one closed set, rendered through `Pill` with the same
// human labels the session page uses. An unrecognised status is shown verbatim
// rather than coerced into a state we cannot vouch for.
// ---------------------------------------------------------------------------

const SESSION_STATUSES = ['draft', 'pending', 'running', 'complete', 'failed'] as const;
type SessionStatus = (typeof SESSION_STATUSES)[number];

const STATUS_TONE: Record<SessionStatus, PillTone> = {
  draft: 'neutral',
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  draft: 'Not started',
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
};

const STATUS_ICON: Record<SessionStatus, { icon: ReactNode; cls: string }> = {
  draft: { icon: <IconClock className="ic sm" />, cls: 'idle' },
  pending: { icon: <IconClock className="ic sm" />, cls: 'idle' },
  running: { icon: <IconRefresh className="ic sm" />, cls: 'run' },
  complete: { icon: <IconCheck className="ic sm" />, cls: 'done' },
  failed: { icon: <IconAlert className="ic sm" />, cls: 'warn' },
};

interface StatusView {
  tone: PillTone;
  label: string;
  icon: ReactNode;
  cls: string;
  running: boolean;
}

function statusView(raw: string): StatusView {
  const known = SESSION_STATUSES.find((value) => value === raw);
  if (known) {
    return { tone: STATUS_TONE[known], label: STATUS_LABEL[known], ...STATUS_ICON[known], running: known === 'running' };
  }
  return {
    tone: 'neutral',
    label: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown',
    icon: <IconClock className="ic sm" />,
    cls: 'idle',
    running: false,
  };
}

// ---------------------------------------------------------------------------
// What a session's run actually tells us. Four honest outcomes — never a zero
// standing in for "we don't know".
// ---------------------------------------------------------------------------

type Evidence =
  | { kind: 'never' }
  | { kind: 'unreadable' }
  | { kind: 'inflight' }
  | { kind: 'empty' }
  | { kind: 'counts'; verified: number; unsupported: number; missing: number; gaps: number; total: number };

function evidenceOf(session: WorkspaceSessionOut, runs: SessionRunMap): Evidence {
  if (!session.run_id) return { kind: 'never' };
  const run = runs[session.id];
  if (!run) return { kind: 'unreadable' };
  if (run.status === 'pending' || run.status === 'running') return { kind: 'inflight' };
  if (run.total === 0) return { kind: 'empty' };
  return {
    kind: 'counts',
    verified: run.verified,
    unsupported: run.unsupported,
    missing: run.missing,
    gaps: run.unsupported + run.missing,
    total: run.total,
  };
}

interface SessionRowModel {
  session: WorkspaceSessionOut;
  run: SessionRunSummary | undefined;
  evidence: Evidence;
  view: StatusView;
  /** A failed run, or a finished run carrying unsupported/missing findings. */
  attention: boolean;
}

// ---------------------------------------------------------------------------
// Overflow menu — one ⋯ trigger for the workspace's own admin actions.
//
// Trigger: the shared `IconButton`, using its `hasPopup`/`expanded`/`controls`
// aria pass-through. It takes no ref, so the trigger element is read back off
// the wrapper and published through `triggerRef` for focus restoration; and it
// takes no `onKeyDown`, so the arrow keys that open the menu are handled on the
// wrapper. Items are `.acc-item` buttons — the same chrome (and the same raw
// element) HomeAccountMenu's account dropdown already uses.
// ---------------------------------------------------------------------------

function OverflowMenu({
  triggerRef,
  onRename,
  onDelete,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function items(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  }

  // `IconButton` renders the element, so publish it to the caller's ref: the
  // delete dialog hands focus back here when it closes.
  useEffect(() => {
    triggerRef.current = wrapRef.current?.querySelector<HTMLButtonElement>('button.iconbtn') ?? null;
  }, [triggerRef]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Opening always lands focus on an item, so the menu is usable with the
  // keyboard alone; `edge` picks which end the caller arrived from.
  function openWith(edge: 'first' | 'last') {
    setOpen(true);
    requestAnimationFrame(() => {
      const list = items();
      (edge === 'first' ? list[0] : list[list.length - 1])?.focus();
    });
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // Tab dismisses the menu rather than cycling inside it. Focus is put back on
      // the trigger instead of left on the item that is about to unmount, which
      // would drop focus to <body> and lose the user's place.
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (list.length === 0) return;
      const next =
        event.key === 'Home' ? 0
        : event.key === 'End' ? list.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % list.length
        : (index - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  }

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      className="wk-menu"
      ref={wrapRef}
      onKeyDown={(event) => {
        // Only the closed trigger is served here; an open menu handles its own keys.
        if (open) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openWith('first');
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          openWith('last');
        }
      }}
    >
      <IconButton
        icon={<IconMore className="ic" />}
        label="Workspace actions"
        hasPopup="menu"
        expanded={open}
        controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith('first'))}
      />

      {open && (
        <div className="accmenu" id={menuId} role="menu" aria-label="Workspace actions" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" className="acc-item" onClick={() => run(onRename)}>
            <IconPencil className="ic sm" />
            <span className="lbl">Edit name &amp; goal</span>
          </button>
          <div className="acc-sep" />
          <button type="button" role="menuitem" className="acc-item dgr" onClick={() => run(onDelete)}>
            <IconTrash className="ic sm" />
            <span className="lbl">Delete workspace</span>
          </button>
          <p className="acc-foot">Deleting removes every session and run in this workspace.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation. Keeps role="alertdialog", moves focus in on open, traps
// Tab while open, and hands focus back to the ⋯ trigger on the way out.
// ---------------------------------------------------------------------------

function DeleteDialog({
  name,
  onCancel,
  onConfirm,
  pending,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-ws-title"
        aria-describedby="delete-ws-copy"
        className="modal"
        onKeyDown={onKeyDown}
      >
        <div className="modal-hd">
          <p className="eyebrow text-missing">Destructive action</p>
          <h2 id="delete-ws-title">Delete this workspace?</h2>
        </div>
        <div className="modal-bd">
          <p id="delete-ws-copy" className="cbd">
            This permanently removes “{name}”, every session in it and the runs those sessions produced. The installed
            Pack itself is not deleted. This cannot be undone.
          </p>
        </div>
        <div className="modal-ft">
          <ActionButton variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete workspace'}
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

/** The hidden-input form that posts `createSessionAction` — a session is created
 *  and the browser lands on it. */
function NewSessionForm({
  workspaceId,
  label = 'New session',
  size = 'md',
  variant = 'primary',
}: {
  workspaceId: string;
  label?: string;
  size?: 'sm' | 'md';
  /** Exactly one primary action per screen — the in-panel copies are secondary. */
  variant?: 'primary' | 'secondary';
}) {
  return (
    <form action={createSessionAction.bind(null, workspaceId)}>
      <input type="hidden" name="title" value="Untitled session" />
      <ActionButton type="submit" variant={variant} size={size} icon={<IconPlus className="ic sm" />}>
        {label}
      </ActionButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Findings cell — the same four states as `Evidence`, each said out loud.
// ---------------------------------------------------------------------------

function Findings({ evidence }: { evidence: Evidence }) {
  if (evidence.kind === 'never') return <span className="wk-find">Not run yet</span>;
  if (evidence.kind === 'inflight') return <span className="wk-find">Findings pending</span>;
  if (evidence.kind === 'unreadable') return <span className="wk-find">Findings unavailable</span>;
  if (evidence.kind === 'empty') return <span className="wk-find">No findings recorded</span>;
  if (evidence.gaps > 0) {
    return (
      <span className="wk-find">
        <Tag variant="warn">
          {evidence.gaps} to review
        </Tag>
        <span className="n">{evidence.verified}</span> verified
      </span>
    );
  }
  return (
    <span className="wk-find is-clean">
      <IconCheck className="ic sm" />
      All <span className="n">{evidence.verified}</span> verified
    </span>
  );
}

function SessionRow({
  model,
  workspaceId,
  inForce,
}: {
  model: SessionRowModel;
  workspaceId: string;
  /** The Pack version new runs pin, so a row that ran an older one can say so. */
  inForce: number | null;
}) {
  const { session, run, evidence, view } = model;
  const subject = session.subject?.trim() || 'No case subject set';
  const drift = run !== undefined && inForce !== null && run.packVersion !== inForce;
  const provenance = run
    ? drift
      ? `, ran Pack v${run.packVersion} — older than v${inForce} in force`
      : `, ran Pack v${run.packVersion}`
    : '';
  return (
    <Link
      href={`/workspace/${workspaceId}/sessions/${session.id}`}
      className="sess-row"
      aria-label={`Open session ${session.title} — ${view.label}${provenance}`}
    >
      <span className={`sess-ic ${view.cls}`}>{view.icon}</span>
      <span className="sess-main">
        <span className="sess-name">
          {session.title}
          {run && <Stamp tone={drift ? 'warn' : 'default'}>v{run.packVersion}</Stamp>}
        </span>
        <span className="sess-sub">{subject}</span>
      </span>
      <Findings evidence={evidence} />
      <span className="sess-flag">
        {formatDate(session.updated_at)}
        <span className="wk-time">{formatTime(session.updated_at)}</span>
      </span>
      <Pill tone={view.tone} dot={view.running}>
        {view.label}
      </Pill>
      <span className="sess-chev">
        <IconChevronRight className="ic sm" />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

type Filter = 'all' | 'attention' | 'active' | 'complete' | 'idle';

export function WorkspaceView({ initial, runs }: { initial: WorkspaceDetailOut; runs: SessionRunMap }) {
  const router = useRouter();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [saving, setSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [filter, setFilter] = useState<Filter>('all');
  const logRef = useRef<HTMLDivElement>(null);

  /** Filtering from the Findings card only helps if the log is on screen — on a
   *  phone that card sits well below the fold. */
  function focusAttention() {
    setFilter('attention');
    logRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const hasPack = Boolean(initial.pack_name);
  const hasVersion = initial.pack_version !== null;

  const rows: SessionRowModel[] = useMemo(
    () =>
      initial.sessions.map((session) => {
        const evidence = evidenceOf(session, runs);
        return {
          session,
          run: runs[session.id],
          evidence,
          view: statusView(session.status),
          attention: session.status === 'failed' || (evidence.kind === 'counts' && evidence.gaps > 0),
        };
      }),
    [initial.sessions, runs],
  );

  // Workspace-wide evidence: summed from finished runs only, and only from runs
  // we could actually read. `unreadable` is reported rather than absorbed.
  const totals = useMemo(() => {
    const acc = { verified: 0, unsupported: 0, missing: 0, total: 0, finished: 0, unreadable: 0, inflight: 0 };
    for (const row of rows) {
      if (row.evidence.kind === 'unreadable') acc.unreadable += 1;
      if (row.evidence.kind === 'inflight') acc.inflight += 1;
      if (row.evidence.kind !== 'counts') continue;
      acc.verified += row.evidence.verified;
      acc.unsupported += row.evidence.unsupported;
      acc.missing += row.evidence.missing;
      acc.total += row.evidence.total;
      acc.finished += 1;
    }
    return acc;
  }, [rows]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      attention: rows.filter((row) => row.attention).length,
      active: rows.filter((row) => row.session.status === 'running' || row.session.status === 'pending').length,
      complete: rows.filter((row) => row.session.status === 'complete').length,
      idle: rows.filter((row) => row.session.status === 'draft').length,
    }),
    [rows],
  );

  // Only offer a filter that has something behind it — a control that can only
  // ever return "none" is not a control.
  const options = useMemo(() => {
    const all: { value: Filter; label: string }[] = [{ value: 'all', label: `All ${counts.all}` }];
    if (counts.attention) all.push({ value: 'attention', label: `Needs review ${counts.attention}` });
    if (counts.active) all.push({ value: 'active', label: `Running ${counts.active}` });
    if (counts.complete) all.push({ value: 'complete', label: `Complete ${counts.complete}` });
    if (counts.idle) all.push({ value: 'idle', label: `Not started ${counts.idle}` });
    return all;
  }, [counts]);

  const activeFilter = options.some((option) => option.value === filter) ? filter : 'all';
  const visible = rows.filter((row) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'attention') return row.attention;
    if (activeFilter === 'active') return row.session.status === 'running' || row.session.status === 'pending';
    if (activeFilter === 'complete') return row.session.status === 'complete';
    return row.session.status === 'draft';
  });

  const verifiedRate = totals.total > 0 ? Math.round((totals.verified / totals.total) * 100) : null;

  // Focus the first field when the edit panel opens; Escape backs out of it.
  useEffect(() => {
    if (isRenaming) document.getElementById('wk-rename-name')?.focus();
  }, [isRenaming]);

  function cancelRename() {
    setName(initial.name);
    setGoal(initial.goal);
    setIsRenaming(false);
    menuTriggerRef.current?.focus();
  }

  async function saveRename() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    await updateWorkspaceAction(initial.id, { name: trimmed, goal: goal.trim() });
    setSaving(false);
    setIsRenaming(false);
    router.refresh();
  }

  const goalText = initial.goal.trim();

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace"
        title={initial.name}
        meta={
          goalText || 'No goal set yet — describe what this programme reviews from the ⋯ actions menu.'
        }
        actions={
          <>
            {hasPack ? (
              <NewSessionForm workspaceId={initial.id} label="New session" />
            ) : (
              <Button href={`/workspace/${initial.id}/pack`} variant="primary" icon={<IconPlus className="ic sm" />}>
                Build a Pack
              </Button>
            )}
            <OverflowMenu
              triggerRef={menuTriggerRef}
              onRename={() => setIsRenaming(true)}
              onDelete={() => setIsDeleteOpen(true)}
            />
          </>
        }
      />

      {isRenaming && (
        <Card className="wk-edit">
          <p className="ct">Workspace details</p>
          <p className="fineprint mt-2">
            The name identifies this review programme in the rail; the goal is what it exists to check.
          </p>
          <div
            className="mt-3"
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelRename();
            }}
          >
            <Input id="wk-rename-name" label="Name" value={name} onChange={setName} />
            <Input label="Goal" value={goal} onChange={setGoal} placeholder="What this programme reviews" />
            <div className="flbl-wrap">
              <ActionButton variant="primary" onClick={() => void saveRename()} disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
              </ActionButton>
              <ActionButton variant="ghost" onClick={cancelRename} disabled={saving}>
                Cancel
              </ActionButton>
            </div>
          </div>
        </Card>
      )}

      {!hasPack ? (
        <EmptyState
          icon={<IconLayers className="ic lg" />}
          title="No Pack installed yet"
          body="A workspace runs exactly one Knowledge Pack: the document types it expects, the fields it extracts and the rules it checks. Install one and every session here reviews a case the same way."
          action={
            <div className="flbl-wrap" style={{ justifyContent: 'center' }}>
              <Button href={`/workspace/${initial.id}/pack`} variant="primary">
                Build a Pack
              </Button>
              <Button href="/marketplace" variant="secondary">
                Browse Marketplace
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <section className="wk-brief" aria-label="Programme brief">
            <Card className="wk-col" pad={false}>
              <CardHeader
                title="Pack in force"
                icon={<IconLayers className="ic sm" />}
                action={hasVersion ? <Stamp>v{initial.pack_version}</Stamp> : <Tag variant="warn">No frozen version</Tag>}
              />
              <div className="wk-body">
                <div className="wk-pack-id">
                  <span className="wk-pack-mark">
                    <IconLayers className="ic" />
                  </span>
                  <span className="wk-pack-txt">
                    <span className="wk-pack-name">{initial.pack_name}</span>
                    <span className="wk-pack-sub">
                      {hasVersion
                        ? `Frozen — every new run pins v${initial.pack_version}`
                        : 'No version has been approved yet'}
                    </span>
                  </span>
                </div>

                {!hasVersion && (
                  <div className="callout">
                    <IconAlert className="ic" />
                    <div>
                      <b>Nothing can run yet</b>
                      <p>
                        Sessions can be created, but a run needs a frozen version of the Pack. Approve one in Pack
                        Studio and this workspace starts executing it.
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <p className="wk-sub-lbl">Reference documents in the Pack</p>
                  {initial.assets.length > 0 ? (
                    <>
                      <ul className="pack-facts">
                        {initial.assets.slice(0, 4).map((asset) => (
                          <li key={asset.id}>
                            <IconDoc className="ic sm" /> {asset.name}
                          </li>
                        ))}
                      </ul>
                      {initial.assets.length > 4 && (
                        <p className="wk-more">+{initial.assets.length - 4} more in Pack Studio</p>
                      )}
                    </>
                  ) : (
                    <p className="wk-note mt-2">
                      None attached. Policies and example documents uploaded while authoring the Pack appear here.
                    </p>
                  )}
                </div>

                <div className="wk-foot">
                  <Button href={`/workspace/${initial.id}/pack`} variant="secondary" size="sm">
                    View installed Pack
                  </Button>
                  {initial.pack_id && (
                    <Button href={`/marketplace/${initial.pack_id}/edit`} variant="ghost" size="sm">
                      Author a new version
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            <Card className="wk-col" pad={false}>
              <CardHeader
                title="Findings"
                icon={<IconCheck className="ic sm" />}
                action={
                  totals.finished > 0 ? (
                    <span className="fineprint">
                      {totals.finished} finished {totals.finished === 1 ? 'run' : 'runs'}
                    </span>
                  ) : undefined
                }
              />
              <div className="wk-body">
                {verifiedRate === null ? (
                  <div className="wk-ev-blank">
                    <span className="wk-ev-ic">
                      <IconClock className="ic" />
                    </span>
                    <p className="ct">Nothing has finished yet</p>
                    <p className="wk-note">
                      When a session completes, the share of its facts that were verified against a citation — and the
                      ones that were unsupported or missing — is summed here across the whole workspace.
                    </p>
                    <div className="wk-foot">
                      {totals.inflight > 0 ? (
                        <span className="fineprint">
                          {totals.inflight} {totals.inflight === 1 ? 'session is' : 'sessions are'} running now.
                        </span>
                      ) : (
                        <NewSessionForm workspaceId={initial.id} label="Start the first session" size="sm" variant="secondary" />
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="wk-ev-head">
                      <span className="wk-ev-rate">{verifiedRate}%</span>
                      <span className="wk-ev-of">
                        verified of {totals.total} {totals.total === 1 ? 'fact' : 'facts'}
                      </span>
                    </div>
                    <div
                      className="wk-ev-bar"
                      role="img"
                      aria-label={`${totals.verified} verified, ${totals.unsupported} unsupported, ${totals.missing} missing`}
                    >
                      {totals.verified > 0 && <i className="ok" style={{ flexGrow: totals.verified }} />}
                      {totals.unsupported > 0 && <i className="warn" style={{ flexGrow: totals.unsupported }} />}
                      {totals.missing > 0 && <i className="dgr" style={{ flexGrow: totals.missing }} />}
                    </div>
                    <ul className="wk-ev-legend">
                      <li className="ok">
                        <span className="sw" />
                        Verified — cited and checked
                        <span className="n">{totals.verified}</span>
                      </li>
                      <li className="warn">
                        <span className="sw" />
                        Unsupported — no citation held
                        <span className="n">{totals.unsupported}</span>
                      </li>
                      <li className="dgr">
                        <span className="sw" />
                        Missing — not found at all
                        <span className="n">{totals.missing}</span>
                      </li>
                    </ul>
                    <div className="wk-foot">
                      {counts.attention > 0 ? (
                        <ActionButton
                          variant="secondary"
                          size="sm"
                          icon={<IconAlert className="ic sm" />}
                          onClick={focusAttention}
                        >
                          Review {counts.attention} {counts.attention === 1 ? 'session' : 'sessions'}
                        </ActionButton>
                      ) : (
                        <span className="fineprint">Every finished run is fully cited.</span>
                      )}
                      {totals.unreadable > 0 && (
                        <span className="fineprint">
                          {totals.unreadable} {totals.unreadable === 1 ? 'run' : 'runs'} could not be read and are
                          excluded.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Card>
          </section>

          {rows.length === 0 ? (
            <EmptyState
              className="mt-6"
              icon={<IconClock className="ic lg" />}
              title="No sessions yet"
              body={`A session runs ${initial.pack_name} over one case's documents and records what it verified, what it could not support and what is missing. Sessions you start appear here with their state.`}
              action={<NewSessionForm workspaceId={initial.id} label="Start the first session" />}
            />
          ) : (
            <div ref={logRef}>
              <Card className="wk-sess" pad={false}>
                <CardHeader
                  title="Sessions"
                  count={rows.length}
                  action={
                    <div className="wk-hd-actions">
                      {options.length > 1 && (
                        <>
                          <span className="wk-filter-lbl">Show</span>
                          <Seg options={options} value={activeFilter} onChange={setFilter} />
                        </>
                      )}
                      <NewSessionForm workspaceId={initial.id} size="sm" variant="secondary" />
                    </div>
                  }
                />
                <div className="sess-thead" aria-hidden="true">
                  <span />
                  <span>Session</span>
                  <span>Findings</span>
                  <span>Last activity</span>
                  <span>Status</span>
                  <span />
                </div>
                <div className="sess-list">
                  {visible.map((model) => (
                    <SessionRow
                      key={model.session.id}
                      model={model}
                      workspaceId={initial.id}
                      inForce={initial.pack_version}
                    />
                  ))}
                  {visible.length === 0 && (
                    <div className="wk-none">
                      No session matches this filter.
                      <ActionButton variant="ghost" size="sm" onClick={() => setFilter('all')}>
                        Show all {rows.length}
                      </ActionButton>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {isDeleteOpen && (
        <DeleteDialog
          name={initial.name}
          pending={deleting}
          onCancel={() => {
            setIsDeleteOpen(false);
            menuTriggerRef.current?.focus();
          }}
          onConfirm={() =>
            startDelete(async () => {
              await deleteWorkspaceAction(initial.id);
            })
          }
        />
      )}
    </div>
  );
}
