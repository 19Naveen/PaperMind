'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkspaceDetailOut } from '@/lib/api';
import { Button, EmptyState, Pill, Tag, type PillTone } from '@/components/ui';
import { IconArrowRight, IconClock, IconDoc, IconLayers, IconPlus, IconSearch } from '@/lib/icons';
import { formatDate } from '@/lib/format';

export interface RecentSession {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: string;
  updatedAt: string;
}

/** One status vocabulary (Pill), shared in spirit with WorkspaceView/SessionView.
 * `status` is a loose string on the wire, so both maps fall back gracefully. */
const STATUS_TONE: Record<string, PillTone> = {
  draft: 'neutral',
  pending: 'neutral',
  running: 'running',
  complete: 'verified',
  failed: 'missing',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
};

function actClass(status: string): string {
  if (status === 'failed') return 'warn';
  if (status === 'complete') return 'ok';
  return '';
}

export function WorkspaceBrowser({
  workspaces,
  recentSessions,
}: {
  workspaces: WorkspaceDetailOut[];
  recentSessions: RecentSession[];
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((workspace) =>
      `${workspace.name} ${workspace.goal} ${workspace.pack_name ?? ''}`.toLowerCase().includes(term),
    );
  }, [query, workspaces]);
  const reviewSessions = recentSessions.filter((session) => session.status !== 'complete');

  return (
    <div className="home-grid">
      <section aria-labelledby="workspaces-heading">
        <div className="sec-head" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 id="workspaces-heading">Workspaces</h2>
            <span className="count">{workspaces.length}</span>
          </div>
          <label className="search" style={{ maxWidth: 240, flex: '0 1 240px' }}>
            <IconSearch className="ic sm" />
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter workspaces"
              aria-label="Filter workspaces"
            />
          </label>
        </div>

        <div className="ws-grid">
          {filtered.map((workspace) => {
            const updated = formatDate(workspace.updated_at, 'Unknown date');
            const sessions = workspace.session_count;
            const docs = workspace.assets.length;
            const completed = workspace.sessions.filter((s) => s.status === 'complete').length;
            const progress = sessions > 0 ? Math.round((completed / sessions) * 100) : 0;
            return (
              <Link key={workspace.id} href={`/workspace/${workspace.id}`} className="card ws-card">
                <div className="ws-top">
                  <h3>{workspace.name}</h3>
                  <Tag variant={workspace.pack_id ? 'accent' : 'outline'}>{workspace.pack_id ? 'Active' : 'Draft'}</Tag>
                </div>
                <p className="ws-pack">
                  <IconLayers className="ic sm" />
                  {workspace.pack_name ?? 'No pack installed'}
                  {workspace.pack_version !== null && <span className="stamp">v{workspace.pack_version}</span>}
                </p>
                <p className="ws-desc">{workspace.goal || 'No workspace goal has been set yet.'}</p>
                <div className="ws-meta">
                  {docs > 0 || sessions > 0 ? (
                    <>
                      <span className="sp"><IconDoc className="ic sm" /> {docs} doc{docs === 1 ? '' : 's'}</span>
                      <span className="sp"><IconClock className="ic sm" /> {sessions} session{sessions === 1 ? '' : 's'}</span>
                      {sessions > 0 && (
                        <>
                          <span className="ws-bar" aria-label={`${progress}% executed`}><i style={{ width: `${progress}%` }} /></span>
                          <span className="mono">{progress}%</span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="sp muted">Not started yet</span>
                  )}
                </div>
                <div className="ws-foot">
                  <span>{workspace.pack_id ? `Last run ${updated}` : updated}</span>
                  <span className="ws-open">{workspace.pack_id ? 'Open' : 'Continue'} <IconArrowRight className="ic sm" /></span>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              {workspaces.length === 0 ? (
                <EmptyState
                  icon={<IconLayers className="ic lg" />}
                  title="No workspaces yet"
                  body="Create a workspace to install a Pack and start running sessions against your documents."
                  action={<Button href="/workspace/new" variant="primary" icon={<IconPlus className="ic sm" />}>New workspace</Button>}
                />
              ) : (
                <EmptyState
                  icon={<IconSearch className="ic lg" />}
                  title={`No workspaces match “${query}”`}
                  body="Try a different filter, or create a new workspace."
                  action={<Button href="/workspace/new" variant="secondary">New workspace</Button>}
                />
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="rail" aria-label="Review queue and activity">
        <section className="card" aria-labelledby="review-heading">
          <div className="card-hd">
            <h3 id="review-heading">Needs your review</h3>
            {reviewSessions.length > 0 && <Tag variant="outline">{reviewSessions.length}</Tag>}
          </div>
          <div className="queue">
            {reviewSessions.length > 0 ? (
              reviewSessions.map((session) => (
                <Link key={`${session.workspaceId}:${session.id}`} className="q-item" href={`/workspace/${session.workspaceId}/sessions/${session.id}`}>
                  <span className="q-main">
                    <b>{session.title}</b>
                    <small>
                      {session.workspaceName} ·{' '}
                      <Pill tone={STATUS_TONE[session.status] ?? 'neutral'} dot={session.status === 'running'}>
                        {STATUS_LABEL[session.status] ?? session.status}
                      </Pill>
                    </small>
                  </span>
                  <span className="q-go">Review</span>
                </Link>
              ))
            ) : (
              <p className="fineprint" style={{ padding: '12px 16px' }}>No active sessions need attention.</p>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="activity-heading">
          <div className="card-hd"><h3 id="activity-heading">Recent activity</h3></div>
          {recentSessions.length > 0 ? (
            <ol className="act-list">
              {recentSessions.map((session) => (
                <li key={`${session.workspaceId}:${session.id}`} className="act">
                  <span className={`act-ic ${actClass(session.status)}`}><IconClock className="ic sm" /></span>
                  <div>
                    <Link href={`/workspace/${session.workspaceId}/sessions/${session.id}`}>{session.title}</Link>
                    <p>
                      {session.workspaceName} ·{' '}
                      <Pill tone={STATUS_TONE[session.status] ?? 'neutral'} dot={session.status === 'running'}>
                        {STATUS_LABEL[session.status] ?? session.status}
                      </Pill>
                    </p>
                  </div>
                  <time dateTime={session.updatedAt} style={{ marginLeft: 'auto' }}>{formatDate(session.updatedAt, 'Unknown date')}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="fineprint" style={{ padding: '12px 16px' }}>No session activity yet. Open a workspace to start the first review.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
