'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceDetailOut, WorkspaceSessionOut } from '@/lib/api';
import { createSessionAction, deleteWorkspaceAction, updateWorkspaceAction } from '@/lib/session';
import { ActionButton, Button, EmptyState, Input, PageHeader, Pill, Seg, Stat, Tag, type PillTone } from '@/components/ui';
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDoc,
  IconLayers,
  IconPlus,
  IconRefresh,
} from '@/lib/icons';

/** The statuses a workspace session actually carries (api.ts declares `status` as a
 * loose string; this union is the closed set the backend emits). */
type SessionStatus = 'draft' | 'pending' | 'running' | 'complete' | 'failed';

const STATUS_TONE: Record<SessionStatus, PillTone> = {
  draft: 'neutral',
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};

/** sess-ic tint + glyph per status. The CSS only ships `.done`/`.run`/`.warn`
 * variants, so the dormant states (draft/pending) take a muted inline chip. */
const STATUS_ICON: Record<SessionStatus, { icon: ReactNode; cls: string }> = {
  draft: { icon: <IconClock className="ic sm" />, cls: '' },
  pending: { icon: <IconClock className="ic sm" />, cls: '' },
  running: { icon: <IconRefresh className="ic sm" />, cls: 'run' },
  complete: { icon: <IconCheck className="ic sm" />, cls: 'done' },
  failed: { icon: <IconAlert className="ic sm" />, cls: 'warn' },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SessionRow({ session, workspaceId }: { session: WorkspaceSessionOut; workspaceId: string }) {
  const status = session.status as SessionStatus;
  const { icon, cls } = STATUS_ICON[status];
  const neutral = cls === '';
  const subject = session.subject?.trim() || 'No subject yet';
  return (
    <Link
      href={`/workspace/${workspaceId}/sessions/${session.id}`}
      className="sess-row"
      style={{ textDecoration: 'none', color: 'inherit' }}
      aria-label={`Open session ${session.title}`}
    >
      <span
        className={`sess-ic ${cls}`.trim()}
        style={neutral ? { background: 'var(--inset)', color: 'var(--ink-3)' } : undefined}
      >
        {icon}
      </span>
      <span className="sess-main">
        <span className="sess-name">
          {session.title}
          {session.run_id && <span className="stamp">#{session.run_id.slice(0, 8)}</span>}
        </span>
        <span className="sess-sub">{subject}</span>
      </span>
      <span className="sess-flag">{fmtDate(session.updated_at)}</span>
      <Pill tone={STATUS_TONE[status]} dot={status === 'running'}>
        {status}
      </Pill>
      <span className="sess-chev">
        <IconChevronRight className="ic sm" />
      </span>
    </Link>
  );
}

/** The hidden-input form that posts `createSessionAction` — preserved verbatim in
 * shape so a session is created and the user is redirected to it. */
function NewSessionForm({ workspaceId, label = 'New session' }: { workspaceId: string; label?: string }) {
  return (
    <form action={createSessionAction.bind(null, workspaceId)}>
      <input type="hidden" name="title" value="Untitled session" />
      <ActionButton type="submit" variant="primary" icon={<IconPlus className="ic sm" />}>
        {label}
      </ActionButton>
    </form>
  );
}

export function WorkspaceView({
  initial,
  verifiedRate,
  issues,
}: {
  initial: WorkspaceDetailOut;
  /** Verified-fact rate across this workspace's completed runs, if any. */
  verifiedRate: number | null;
  /** Non-verified facts (unsupported + missing) across completed runs. */
  issues: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'sessions' | 'rollup'>('sessions');
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [saving, setSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const hasPack = Boolean(initial.pack_name);
  const completed = initial.sessions.filter((s) => s.status === 'complete').length;
  const versionLabel = initial.pack_version !== null ? `v${initial.pack_version}` : 'Draft';

  async function saveRename() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    await updateWorkspaceAction(initial.id, { name: trimmed, goal: goal.trim() });
    setSaving(false);
    setIsRenaming(false);
    router.refresh();
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace"
        title={initial.name}
        meta={
          hasPack ? (
            <>
              <IconLayers className="ic sm" /> {initial.pack_name} {versionLabel} · one Pack per workspace, any
              number of isolated sessions.
            </>
          ) : (
            <>No Pack installed · one Pack per workspace, any number of isolated sessions.</>
          )
        }
        actions={
          <>
            {hasPack ? (
              <>
                <Button href={`/workspace/${initial.id}/pack`} variant="ghost" icon={<IconLayers className="ic sm" />}>
                  View pack
                </Button>
                <NewSessionForm workspaceId={initial.id} />
              </>
            ) : (
              <Button href={`/workspace/${initial.id}/pack`} variant="primary" icon={<IconPlus className="ic sm" />}>
                Build a pack
              </Button>
            )}
            <ActionButton variant="ghost" size="sm" onClick={() => setIsRenaming((v) => !v)}>
              {isRenaming ? 'Cancel' : 'Rename'}
            </ActionButton>
            <ActionButton variant="danger" size="sm" onClick={() => setIsDeleteOpen(true)}>
              Delete
            </ActionButton>
          </>
        }
      />

      {isRenaming && (
        <section className="card card-pad mt-4" style={{ maxWidth: 560 }}>
          <Input label="Name" value={name} onChange={(v) => setName(v)} />
          <div style={{ height: 14 }} />
          <Input label="Goal" value={goal} onChange={(v) => setGoal(v)} />
          <div className="flbl-wrap" style={{ marginTop: 14 }}>
            <ActionButton variant="primary" onClick={() => void saveRename()} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </ActionButton>
          </div>
        </section>
      )}

      {!hasPack ? (
        <EmptyState
          icon={<IconLayers className="ic lg" />}
          title="No Pack installed"
          body="A Pack gives every session the same documents, instructions and outputs. Build one from a description or install a published Pack."
          action={
            <div className="flbl-wrap" style={{ justifyContent: 'center' }}>
              <Button href={`/workspace/${initial.id}/pack`} variant="primary">
                Build a pack
              </Button>
              <Button href="/marketplace" variant="secondary">
                Browse Marketplace
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <section className="card stats" aria-label="Workspace statistics">
            <Stat bare label="Sessions" value={initial.session_count} sub={`${completed} completed`} />
            <Stat bare label="Documents" value={initial.assets.length} sub="in the Pack" />
            <Stat
              bare
              label="Verified rate"
              value={verifiedRate !== null ? `${verifiedRate}%` : '—'}
              tone={verifiedRate !== null ? 'verified' : 'default'}
              sub={verifiedRate !== null ? 'cited facts across runs' : 'no completed runs yet'}
            />
            <Stat bare label="Open issues" value={issues} sub="unsupported or missing facts" tone={issues > 0 ? 'missing' : 'default'} />
          </section>

          <div className="sec-head">
            <Seg
              options={[
                { value: 'sessions', label: 'Sessions' },
                { value: 'rollup', label: 'Rollup' },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          {tab === 'sessions' ? (
            <div className="wk-grid">
              {initial.sessions.length === 0 ? (
                <EmptyState
                  icon={<IconClock className="ic lg" />}
                  title="No sessions yet"
                  body="Start a session to run this Pack against your documents."
                  action={<NewSessionForm workspaceId={initial.id} />}
                />
              ) : (
                <div className="card" style={{ padding: 0 }}>
                  <div className="card-hd">
                    <h3>Sessions</h3>
                    <span className="chd-count">{initial.sessions.length}</span>
                  </div>
                  <div className="sess-thead" role="row" aria-hidden="true">
                    <span />
                    <span>Session</span>
                    <span>Updated</span>
                    <span>Status</span>
                    <span />
                  </div>
                  <div className="sess-list">
                    {initial.sessions.map((session) => (
                      <SessionRow key={session.id} session={session} workspaceId={initial.id} />
                    ))}
                  </div>
                </div>
              )}

              <aside className="rail">
                <div className="card">
                  <div className="card-hd">
                    <h3>Installed Pack</h3>
                    <Tag variant="accent">{versionLabel}</Tag>
                  </div>
                  <div className="pack-body">
                    <p className="pack-name">{initial.pack_name}</p>
                    <p className="fineprint" style={{ marginTop: 5 }}>
                      {initial.goal}
                    </p>
                    <ul className="pack-facts">
                      {initial.assets.map((asset) => (
                        <li key={asset.id}>
                          <IconDoc className="ic sm" /> {asset.name}
                        </li>
                      ))}
                      {initial.assets.length === 0 && <li className="muted">No assets attached.</li>}
                    </ul>
                    <div style={{ marginTop: 12 }}>
                      <Button href={`/workspace/${initial.id}/pack`} variant="secondary" className="wfull">
                        Open in Pack Studio
                      </Button>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            <div className="card">
              <div className="card-pad">
                <p className="fineprint">
                  Rollup aggregates across the portfolio; it ships once multiple sessions exist.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {isDeleteOpen && (
        <div
          className="overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', padding: 16 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setIsDeleteOpen(false); }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-ws-title"
            aria-describedby="delete-ws-copy"
            className="modal"
            onKeyDown={(event) => { if (event.key === 'Escape') setIsDeleteOpen(false); }}
          >
            <div className="modal-hd">
              <p className="eyebrow" style={{ color: 'var(--danger)' }}>Destructive action</p>
              <h2 id="delete-ws-title">Delete this workspace?</h2>
            </div>
            <div className="modal-bd">
              <p id="delete-ws-copy" className="cbd">
                This permanently removes “{initial.name}”, its sessions and runs. This cannot be undone.
              </p>
            </div>
            <div className="modal-ft" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <ActionButton variant="secondary" onClick={() => setIsDeleteOpen(false)}>Cancel</ActionButton>
              <ActionButton variant="danger" onClick={() => void deleteWorkspaceAction(initial.id)}>Delete workspace</ActionButton>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
