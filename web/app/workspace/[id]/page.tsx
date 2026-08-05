import { notFound } from 'next/navigation';
import { WorkspaceView } from '@/components/WorkspaceView';
import { ApiError, getWorkspace } from '@/lib/api';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });
  return <WorkspaceView initial={workspace} />;
}