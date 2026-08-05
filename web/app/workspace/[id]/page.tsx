import { notFound } from 'next/navigation';
import { WorkspaceView } from '@/components/WorkspaceView';
import { getWorkspace } from '@/lib/mock';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) notFound();
  return <WorkspaceView initial={ws} />;
}