import { redirect } from 'next/navigation';
import { getMe, getWorkspace, listWorkspaces } from '@/lib/api';
import { WorkspaceBrowser, type RecentSession } from '@/components/WorkspaceBrowser';

export default async function HomePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const workspaces = await listWorkspaces();
  const sessionCount = workspaces.reduce((total, workspace) => total + workspace.session_count, 0);
  const details = await Promise.all(workspaces.map((workspace) => getWorkspace(workspace.id)));
  const recentSessions: RecentSession[] = details
    .flatMap((workspace) => workspace.sessions.map((session) => ({
      id: session.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      title: session.title,
      status: session.status,
      updatedAt: session.updated_at,
    })))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 5);
  const completedCount = recentSessions.filter((session) => session.status === 'complete').length;

  return (
    <div className="min-h-full">
      <section className="grid gap-6 border-b-2 border-rule px-6 py-7 md:grid-cols-[1.2fr_1fr] md:gap-0">
        <div className="md:border-r md:border-rule md:pr-8">
          <h2 className="display max-w-[20ch] text-[32px] font-extrabold leading-tight text-ink">
            One Pack per workspace. Every run identical.
          </h2>
          <p className="mt-3.5 max-w-[52ch] text-[14px] leading-relaxed text-ink">
            A workspace holds a single Pack - the workflow, prompts, templates and reference documents your automation needs.
            Open a workspace to run it against new documents; edit the Pack from the workspace overview when the process itself changes.
          </p>
        </div>
        <div className="md:pl-8">
          <p className="eyebrow font-bold text-ink">Across all workspaces</p>
          <div className="mt-2.5 grid grid-cols-2 border-t border-rule">
            <Stat value={workspaces.length} label="Workspaces" />
            <Stat value={sessionCount} label="Sessions" className="pl-3" />
            <Stat value={completedCount} label="Recently completed" />
            <Stat value={workspaces.filter((workspace) => workspace.pack_id).length} label="Packs installed" className="pl-3" />
          </div>
        </div>
      </section>
      <WorkspaceBrowser workspaces={workspaces} recentSessions={recentSessions} />
    </div>
  );
}

function Stat({ value, label, className = '' }: { value: string | number; label: string; className?: string }) {
  return (
    <div className={`border-b border-rule py-3 ${className}`}>
      <p className="display text-[26px] font-extrabold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[11px] text-ink-2">{label}</p>
    </div>
  );
}
