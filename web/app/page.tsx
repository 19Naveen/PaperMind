import { redirect } from 'next/navigation';
import { getMe, getWorkspace, listWorkspaces } from '@/lib/api';
import { WorkspaceBrowser, type RecentSession } from '@/components/WorkspaceBrowser';
import { Button, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { IconAlert, IconPlus } from '@/lib/icons';

/**
 * The portfolio overview.
 *
 * No greeting and no welcome copy: this is the first screen of a working day for a
 * reviewer or a compliance lead, and it should answer what is running, what has
 * failed, and what is waiting on them — in that order — before it says anything
 * else. The counters below lead with the exceptions for the same reason; the
 * totals are context, not news.
 */
export default async function HomePage() {
  const user = await getMe();
  if (!user) redirect('/login');

  // The workspace list IS this page. If it can't be read, say so — rendering the
  // shell with zeros would report an empty portfolio, a different and untrue claim.
  const workspaces = await listWorkspaces().catch(() => null);
  if (!workspaces) {
    return (
      <section className="page">
        <div className="ops-head">
          <div>
            <h1 className="ops-title">Overview</h1>
          </div>
        </div>
        <div className="mt-6">
          <EmptyState
            icon={<IconAlert className="ic lg" />}
            title="Your workspaces couldn’t be loaded"
            body="The service didn’t answer. Nothing has been changed — reload to try again."
            action={<Button href="/" variant="primary">Reload</Button>}
          />
        </div>
      </section>
    );
  }

  // One unreadable workspace must not take down the whole overview.
  const settled = await Promise.all(workspaces.map((workspace) => getWorkspace(workspace.id).catch(() => null)));
  const details = settled.filter((workspace): workspace is NonNullable<typeof workspace> => workspace !== null);
  const unreadable = settled.length - details.length;

  const allSessions: RecentSession[] = details.flatMap((workspace) =>
    workspace.sessions.map((session) => ({
      id: session.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      title: session.title,
      status: session.status,
      updatedAt: session.updated_at,
    })),
  );
  const recentSessions = [...allSessions]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);

  const sessionCount = workspaces.reduce((total, workspace) => total + workspace.session_count, 0);
  const inFlight = allSessions.filter((s) => s.status === 'running' || s.status === 'pending').length;
  const failed = allSessions.filter((s) => s.status === 'failed').length;
  const notStarted = allSessions.filter((s) => s.status === 'draft').length;
  const packsInForce = workspaces.filter((workspace) => workspace.pack_id).length;
  const lastActivity = recentSessions[0]?.updatedAt ?? null;

  // Exceptions first: a number the reader must act on shouldn't compete with three
  // that are merely true.
  const metrics: { label: string; value: number; qualifier?: string; tone?: 'attention' | 'failed' }[] = [
    { label: 'In flight', value: inFlight, qualifier: inFlight === 1 ? 'session' : 'sessions', tone: 'attention' },
    { label: 'Failed', value: failed, qualifier: 'need a retry', tone: 'failed' },
    { label: 'Not started', value: notStarted, qualifier: 'awaiting documents' },
    { label: 'Workspaces', value: workspaces.length, qualifier: `${packsInForce} with a Pack` },
    { label: 'Sessions', value: sessionCount, qualifier: 'all time' },
  ];

  return (
    <section className="page">
      <div className="ops-head">
        <div>
          <h1 className="ops-title">Overview</h1>
          <p className="ops-sub">
            {lastActivity ? `Last activity ${formatDateTime(lastActivity)} SGT` : 'No sessions have run yet'}
            {unreadable > 0 && ` · ${unreadable} workspace${unreadable === 1 ? '' : 's'} could not be read and are excluded`}
          </p>
        </div>
        <div className="ops-actions">
          <Button href="/workspace/new" variant="primary" icon={<IconPlus className="ic sm" />}>New workspace</Button>
        </div>
      </div>

      <div className="ops-metrics" role="group" aria-label="Portfolio status">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={`ops-metric${metric.value === 0 ? ' is-zero' : metric.tone ? ` is-${metric.tone}` : ''}`}
          >
            <span className="m-l">{metric.label}</span>
            <span className="m-v">
              {metric.value}
              {metric.qualifier && <span className="m-q">{metric.qualifier}</span>}
            </span>
          </div>
        ))}
      </div>

      <WorkspaceBrowser workspaces={details} recentSessions={recentSessions} />
    </section>
  );
}
