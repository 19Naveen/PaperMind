import { notFound } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { ApiError, getRun, getWorkspace, getWorkspaceSession } from '@/lib/api';

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

  return (
    <SessionView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      session={session}
      run={run}
    />
  );
}
