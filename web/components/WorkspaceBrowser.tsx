'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkspaceDetailOut } from '@/lib/api';
import { Button, EmptyState, Stamp } from '@/components/ui';
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSearch,
} from '@/lib/icons';
import { formatDate, formatDateTime } from '@/lib/format';

export interface RecentSession {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: string;
  updatedAt: string;
}

/** Session statuses as the backend spells them, with the glyph and tone each is
 * read by. Colour is never the only signal — the glyph and the word carry it too. */
const STATE: Record<string, { label: string; glyph: 'ok' | 'run' | 'warn' | 'dgr' | 'idle' }> = {
  draft: { label: 'Not started', glyph: 'idle' },
  pending: { label: 'Queued', glyph: 'idle' },
  running: { label: 'Running', glyph: 'run' },
  complete: { label: 'Complete', glyph: 'ok' },
  failed: { label: 'Failed', glyph: 'dgr' },
};

function stateOf(status: string) {
  return STATE[status] ?? { label: status, glyph: 'idle' as const };
}

function Glyph({ kind }: { kind: 'ok' | 'run' | 'warn' | 'dgr' | 'idle' }) {
  const icon =
    kind === 'ok' ? <IconCheck className="ic sm" />
    : kind === 'run' ? <IconRefresh className="ic sm" />
    : kind === 'dgr' ? <IconAlert className="ic sm" />
    : kind === 'warn' ? <IconAlert className="ic sm" />
    : <IconClock className="ic sm" />;
  return <span className={`g ${kind}`} aria-hidden="true">{icon}</span>;
}

/** A count cell. Zero is muted: a fresh workspace is a row of legitimate zeros and
 * should not read as a row of problems. */
function Count({ value, tone }: { value: number; tone?: 'warn' | 'danger' }) {
  if (value === 0) return <span className="z">0</span>;
  return <span className={tone === 'danger' ? 'd' : tone === 'warn' ? 'w' : undefined}>{value}</span>;
}

interface Row {
  ws: WorkspaceDetailOut;
  inFlight: number;
  complete: number;
  failed: number;
}

export function WorkspaceBrowser({
  workspaces,
  recentSessions,
}: {
  workspaces: WorkspaceDetailOut[];
  recentSessions: RecentSession[];
}) {
  const [query, setQuery] = useState('');

  const rows: Row[] = useMemo(
    () =>
      workspaces.map((ws) => ({
        ws,
        inFlight: ws.sessions.filter((s) => s.status === 'running' || s.status === 'pending').length,
        complete: ws.sessions.filter((s) => s.status === 'complete').length,
        failed: ws.sessions.filter((s) => s.status === 'failed').length,
      })),
    [workspaces],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(({ ws }) =>
      `${ws.name} ${ws.goal} ${ws.pack_name ?? ''}`.toLowerCase().includes(term),
    );
  }, [query, rows]);

  // Two lists that must not be the same list. `attention` is work outstanding;
  // `completed` is the audit trail of work finished. Showing "recent activity"
  // alongside "needs attention" printed the same four rows twice.
  const attention = recentSessions.filter((s) => s.status !== 'complete');
  const completed = recentSessions.filter((s) => s.status === 'complete');

  return (
    <>
      <section className="ops-panel" aria-labelledby="ops-workspaces">
        <div className="ops-panel-hd">
          <h2 id="ops-workspaces">Workspaces</h2>
          <span className="count">{filtered.length === rows.length ? rows.length : `${filtered.length}/${rows.length}`}</span>
          <label className="ops-filter">
            <IconSearch className="ic sm" />
            <span className="sr-only">Filter workspaces</span>
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
            />
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<IconLayers className="ic lg" />}
            title="No workspaces yet"
            body="A workspace holds one Knowledge Pack and every session you run with it. Create one to install a Pack and review your first document set."
            action={<Button href="/workspace/new" variant="primary" icon={<IconPlus className="ic sm" />}>New workspace</Button>}
          />
        ) : filtered.length === 0 ? (
          <p className="ops-empty">
            Nothing matches “{query}”. Clear the filter to see all {rows.length} workspaces.
          </p>
        ) : (
          <div className="ops-tablewrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col" className="t">Pack in force</th>
                <th scope="col" className="n">Sessions</th>
                <th scope="col" className="n">In flight</th>
                <th scope="col" className="n">Complete</th>
                <th scope="col" className="n">Failed</th>
                <th scope="col" className="t">Last activity</th>
                <th scope="col" className="t"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ ws, inFlight, complete, failed }) => (
                <tr key={ws.id}>
                  <td>
                    <span className="ops-name">
                      <Link href={`/workspace/${ws.id}`}>{ws.name}</Link>
                      {ws.goal && <span className="ops-goal">{ws.goal}</span>}
                    </span>
                  </td>
                  <td className="t" data-label="Pack">
                    {ws.pack_id ? (
                      <span className="ops-pack">
                        <IconLayers className="ic sm" />
                        {ws.pack_name}
                        {ws.pack_version !== null && <Stamp>v{ws.pack_version}</Stamp>}
                      </span>
                    ) : (
                      <span className="ops-nopack">No Pack installed</span>
                    )}
                  </td>
                  <td className="n" data-label="Sessions"><Count value={ws.session_count} /></td>
                  <td className="n" data-label="In flight"><Count value={inFlight} tone="warn" /></td>
                  <td className="n" data-label="Complete"><Count value={complete} /></td>
                  <td className="n" data-label="Failed"><Count value={failed} tone="danger" /></td>
                  <td className="t" data-label="Last activity">
                    <time className="ops-when" dateTime={ws.updated_at}>{formatDate(ws.updated_at, '—')}</time>
                  </td>
                  <td className="t chev"><IconChevronRight className="ic sm ops-chev" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <div className="ops-split">
        <section className="ops-panel" aria-labelledby="ops-attention">
          <div className="ops-panel-hd">
            <h2 id="ops-attention">Needs attention</h2>
            <span className="count">{attention.length}</span>
          </div>
          {attention.length > 0 ? (
            <ul className="ops-list">
              {attention.map((session) => {
                const state = stateOf(session.status);
                return (
                  <li key={`${session.workspaceId}:${session.id}`}>
                    <Link className="ops-row" href={`/workspace/${session.workspaceId}/sessions/${session.id}`}>
                      <Glyph kind={state.glyph} />
                      <span>
                        <b>{session.title}</b>
                        <small>{session.workspaceName} · {state.label}</small>
                      </span>
                      <time dateTime={session.updatedAt}>{formatDate(session.updatedAt, '—')}</time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ops-empty">Nothing is waiting on you. Every session has finished.</p>
          )}
        </section>

        <section className="ops-panel" aria-labelledby="ops-completed">
          <div className="ops-panel-hd">
            <h2 id="ops-completed">Recently completed</h2>
            <span className="count">{completed.length}</span>
          </div>
          {completed.length > 0 ? (
            <ul className="ops-list">
              {completed.map((session) => (
                <li key={`${session.workspaceId}:${session.id}`}>
                  <Link className="ops-row" href={`/workspace/${session.workspaceId}/sessions/${session.id}`}>
                    <Glyph kind="ok" />
                    <span>
                      <b>{session.title}</b>
                      <small>{session.workspaceName} · findings ready to read</small>
                    </span>
                    <time dateTime={session.updatedAt} title={`${formatDateTime(session.updatedAt)} SGT`}>
                      {formatDate(session.updatedAt, '—')}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-empty">
              No run has finished yet. A completed session lists every field it checked with the sentence that
              supports it.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
