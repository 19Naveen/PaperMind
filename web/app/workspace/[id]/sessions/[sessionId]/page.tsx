import { notFound } from 'next/navigation';
import { SessionView } from '@/components/SessionView';
import { getWorkspaceSession } from '@/lib/mock';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const found = await getWorkspaceSession(id, sessionId);
  if (!found) notFound();
  const { workspace, session } = found;

  return (
    <SessionView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      session={session}
      runReady={session.status === 'complete'}
      counts={{ verified: 0, unsupported: 0, missing: 0 }}
      docs={[]}
      facts={[]}
    />
  );
}
