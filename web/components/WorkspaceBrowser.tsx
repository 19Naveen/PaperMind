'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkspaceDetailOut } from '@/lib/api';
import { IconArrowRight, IconClock, IconDoc, IconLayers, IconSearch } from '@/lib/icons';

export interface RecentSession {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: string;
  updatedAt: string;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function dotClass(status: string): string {
  if (status === 'failed') return 'warn';
  if (status === 'complete') return 'acc';
  return 'acc';
}

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
            const updated = dateLabel(workspace.updated_at);
            const sessions = workspace.session_count;
            const docs = workspace.assets.length;
            const completed = workspace.sessions.filter((s) => s.status === 'complete').length;
            const progress = sessions > 0 ? Math.round((completed / sessions) * 100) : 0;
            return (
              <Link key={workspace.id} href={`/workspace/${workspace.id}`} className="card ws-card">
                <div className="ws-top">
                  <h3>{workspace.name}</h3>
                  <span className={`tag ${workspace.pack_id ? 'acc' : 'out'}`}>{workspace.pack_id ? 'Active' : 'Draft'}</span>
                </div>
                <p className="ws-pack">
                  <IconLayers className="ic sm" />
                  {workspace.pack_name ?? 'No pack installed'}
                  {workspace.pack_version !== null && <span className="stamp">v{workspace.pack_version}</span>}
                </p>
                <p className="ws-desc">{workspace.goal || 'No workspace goal has been set yet.'}</p>
                <div className="ws-meta">
                  <span className="sp"><IconDoc className="ic sm" /> {docs} doc{docs === 1 ? '' : 's'}</span>
                  <span className="sp"><IconClock className="ic sm" /> {sessions} session{sessions === 1 ? '' : 's'}</span>
                  {sessions > 0 && (
                    <>
                      <span className="ws-bar" aria-label={`${progress}% executed`}><i style={{ width: `${progress}%` }} /></span>
                      <span className="mono">{progress}%</span>
                    </>
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
            <div className="card empty">
              <span className="e-ic"><IconSearch className="ic lg" /></span>
              <h3>No workspaces match “{query}”</h3>
              <p>Try a different filter, or create a new workspace.</p>
            </div>
          )}
        </div>
      </section>

      <aside className="rail" aria-label="Review queue and activity">
        <section className="card" aria-labelledby="review-heading">
          <div className="card-hd">
            <h3 id="review-heading">Needs your review</h3>
            {reviewSessions.length > 0 && <span className="tag out">{reviewSessions.length}</span>}
          </div>
          <div className="queue">
            {reviewSessions.length > 0 ? (
              reviewSessions.map((session) => (
                <Link key={`${session.workspaceId}:${session.id}`} className="q-item" href={`/workspace/${session.workspaceId}/sessions/${session.id}`}>
                  <span className={`q-dot ${dotClass(session.status)}`} />
                  <span className="q-main">
                    <b>{session.title}</b>
                    <small>{session.workspaceName} · {statusLabel(session.status)}</small>
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
                    <p>{session.workspaceName} · {statusLabel(session.status)}</p>
                  </div>
                  <time dateTime={session.updatedAt} style={{ marginLeft: 'auto' }}>{dateLabel(session.updatedAt)}</time>
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
