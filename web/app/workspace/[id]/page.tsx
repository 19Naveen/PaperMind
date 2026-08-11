import { notFound } from 'next/navigation';
import { WorkspaceView, type SessionRunMap } from '@/components/WorkspaceView';
import { ApiError, getRun, getWorkspace } from '@/lib/api';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });

  // Each session that has ever run points at exactly one run, so read them all
  // (bounded by the workspace's own session count) rather than only the complete
  // ones: a running session's stage and an old session's pinned Pack version are
  // both facts the overview needs. A run we cannot read is simply left out of the
  // map — the view renders that as "unavailable", never as a count of zero.
  const withRun = workspace.sessions.filter((session) => session.run_id);
  const fetched = await Promise.all(
    withRun.map((session) => getRun(session.run_id as string).catch(() => null)),
  );

  const runs: SessionRunMap = {};
  withRun.forEach((session, index) => {
    const run = fetched[index];
    if (!run) return;
    runs[session.id] = {
      status: run.status,
      stage: run.stage,
      packVersion: run.pack_version,
      verified: run.facts.filter((fact) => fact.state === 'verified').length,
      unsupported: run.facts.filter((fact) => fact.state === 'unsupported').length,
      missing: run.facts.filter((fact) => fact.state === 'missing').length,
      total: run.facts.length,
    };
  });

  return <WorkspaceView initial={workspace} runs={runs} />;
}
