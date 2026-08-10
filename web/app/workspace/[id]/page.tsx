import { notFound } from 'next/navigation';
import { WorkspaceView } from '@/components/WorkspaceView';
import { ApiError, getRun, getWorkspace } from '@/lib/api';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });

  // Verified-rate + open-issues are computed from completed runs' facts, so the
  // analytics strip shows real numbers (and '—' when nothing has run yet).
  const completedRuns = await Promise.all(
    workspace.sessions
      .filter((s) => s.status === 'complete' && s.run_id)
      .map((s) => getRun(s.run_id as string).catch(() => null)),
  );
  const facts = completedRuns.flatMap((r) => (r ? r.facts : []));
  const verified = facts.filter((f) => f.state === 'verified').length;
  const verifiedRate = facts.length ? Math.round((verified / facts.length) * 100) : null;
  const issues = facts.length - verified;

  return <WorkspaceView initial={workspace} verifiedRate={verifiedRate} issues={issues} />;
}
