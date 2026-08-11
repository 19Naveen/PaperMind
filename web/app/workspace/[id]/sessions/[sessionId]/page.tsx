import { notFound } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { ApiError, getPack, getRun, getWorkspace, getWorkspaceSession } from '@/lib/api';
import type { PackSpec } from '@/lib/api';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });
  const session = await getWorkspaceSession(id, sessionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'SESSION_NOT_FOUND') notFound();
    throw error;
  });
  const run = session.run_id
    ? await getRun(session.run_id).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'RUN_NOT_FOUND') return null;
        throw error;
      })
    : null;

  // The frozen spec of the version this run actually executed — it carries the field
  // descriptions and rule text that make each check legible. Matched on `version`, with no
  // fallback to the pack's latest: attributing today's rules to an older run is exactly the
  // misattribution immutable pack versions exist to prevent. A failure here costs the
  // descriptions, never the results, so it degrades to null.
  let spec: PackSpec | null = null;
  if (run) {
    const detail = await getPack(run.pack_id).catch(() => null);
    spec = detail?.versions.find((version) => version.version === run.pack_version)?.spec ?? null;
  }

  // Gated on `pack_id`, which is the exact precondition the API enforces (it raises
  // PACK_NOT_INSTALLED when `workspace.pack_id is None`). The name is only the label —
  // gating on it would disagree with the backend for a Pack that has no name.
  const installedPack = workspace.pack_id
    ? {
        name: workspace.pack_name ?? `Pack ${workspace.pack_id.slice(0, 8)}`,
        version: workspace.pack_version,
      }
    : null;

  return (
    <SessionView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      installedPack={installedPack}
      session={session}
      run={run}
      spec={spec}
    />
  );
}
