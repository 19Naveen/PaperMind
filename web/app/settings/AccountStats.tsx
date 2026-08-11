import { getWorkspace, listWorkspaces } from '@/lib/api';
import { Stat } from '@/components/ui';

/**
 * Real activity counters for the account page. A server component: the workspace
 * list is cookie-gated, so it cannot be fetched from the client cards beside it.
 *
 * Every workspace's detail is needed for the completed-session count, so they are
 * fetched together rather than in series; one failing workspace degrades to a
 * lower count instead of taking the page down.
 */
export async function AccountStats() {
  const workspaces = await listWorkspaces(200);
  const details = await Promise.all(workspaces.map((w) => getWorkspace(w.id).catch(() => null)));
  const completed = details.flatMap((d) => d?.sessions ?? []).filter((s) => s.status === 'complete').length;
  const packVersions = workspaces.filter((w) => w.pack_version != null).length;

  return (
    <div className="stats acct-stats">
      <Stat bare label="Workspaces" value={workspaces.length} />
      <Stat bare label="Packs installed" value={packVersions} />
      <Stat bare label="Sessions completed" value={completed} />
    </div>
  );
}
