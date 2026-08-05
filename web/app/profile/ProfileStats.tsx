import { getWorkspace, listWorkspaces } from '@/lib/api';
import { Stat } from '@/components/ui';

/** Real activity counters for the profile page. Server component: the workspace list
 * is cookie-gated, so it cannot be fetched from the client page. */
export async function ProfileStats() {
  const workspaces = await listWorkspaces(200);
  let total = 0;
  let running = 0;
  let completed = 0;
  for (const workspace of workspaces) {
    const detail = await getWorkspace(workspace.id).catch(() => null);
    if (!detail) continue;
    total += detail.sessions.length;
    running += detail.sessions.filter((s) => s.status === 'pending' || s.status === 'running').length;
    completed += detail.sessions.filter((s) => s.status === 'complete').length;
  }
  const packVersions = workspaces.filter((w) => w.pack_version != null).length;

  return (
    <div className="grid grid-cols-2 gap-3 p-4">
      <Stat label="Workspaces" value={workspaces.length} />
      <Stat label="Packs installed" value={packVersions} tone="accent" />
      <Stat label="Sessions running" value={running} tone="running" sub={running === 0 ? 'idle' : 'live'} />
      <Stat label="Sessions completed" value={completed} />
      <p className="col-span-2 font-data text-[10px] text-ink-3">
        {total} session{total === 1 ? '' : 's'} across {workspaces.length} workspace
        {workspaces.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
