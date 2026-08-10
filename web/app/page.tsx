import { redirect } from 'next/navigation';
import { getMe, getWorkspace, listWorkspaces } from '@/lib/api';
import { WorkspaceBrowser, type RecentSession } from '@/components/WorkspaceBrowser';
import { Button, PageHeader, Stat } from '@/components/ui';
import { IconPlus } from '@/lib/icons';

function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function HomePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const workspaces = await listWorkspaces();
  const sessionCount = workspaces.reduce((total, workspace) => total + workspace.session_count, 0);
  const details = await Promise.all(workspaces.map((workspace) => getWorkspace(workspace.id)));
  const allSessions: RecentSession[] = details.flatMap((workspace) => workspace.sessions.map((session) => ({
    id: session.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    title: session.title,
    status: session.status,
    updatedAt: session.updated_at,
  })));
  const recentSessions = [...allSessions]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 5);
  const completedCount = allSessions.filter((session) => session.status === 'complete').length;
  const activeCount = allSessions.filter((session) => session.status === 'pending' || session.status === 'running').length;

  return (
    <section className="page">
      <PageHeader
        eyebrow="Overview"
        title={`${greetingFor()}, ${user.name.split(/\s+/)[0]}`}
        meta={
          activeCount > 0
            ? `${activeCount} session${activeCount === 1 ? '' : 's'} in progress · every result below traces to a cited source.`
            : 'Every result below traces to a cited source.'
        }
        actions={<Button href="/workspace/new" variant="primary" icon={<IconPlus className="ic sm" />}>New workspace</Button>}
      />

      <div className="card stats" role="group" aria-label="Portfolio statistics">
        <Stat bare label="Workspaces" value={workspaces.length} sub="Portfolio total" />
        <Stat bare label="Sessions" value={sessionCount} sub="Across all workspaces" />
        <Stat bare label="Completed" value={completedCount} sub="Recorded in your workspaces" />
        <Stat bare label="Packs installed" value={workspaces.filter((workspace) => workspace.pack_id).length} sub="Ready to run" />
      </div>

      <WorkspaceBrowser workspaces={details} recentSessions={recentSessions} />
    </section>
  );
}
