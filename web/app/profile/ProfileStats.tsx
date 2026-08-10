import { getWorkspace, listWorkspaces } from '@/lib/api';
import { Stat } from '@/components/ui';

/** Real activity counters for the profile page. Server component: the workspace list
 * is cookie-gated, so it cannot be fetched from the client page. */
export async function ProfileStats() {
  const workspaces = await listWorkspaces(200);
  const details = await Promise.all(workspaces.map((w) => getWorkspace(w.id).catch(() => null)));
  const completed = details.flatMap((d) => d?.sessions ?? []).filter((s) => s.status === 'complete').length;
  const packVersions = workspaces.filter((w) => w.pack_version != null).length;

  return (
    <div
      className="stats"
      style={{ gridTemplateColumns: 'repeat(3,1fr)', borderBottom: '1px solid var(--line)', borderRadius: 0 }}
    >
      <Stat bare label="Workspaces" value={workspaces.length} />
      <Stat bare label="Packs installed" value={packVersions} />
      <Stat bare label="Sessions completed" value={completed} />
    </div>
  );
}
