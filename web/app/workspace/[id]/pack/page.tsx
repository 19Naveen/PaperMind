import { notFound } from 'next/navigation';
import { PackBuilderView } from '@/components/PackBuilderView';
import { getWorkspace } from '@/lib/mock';

export default async function PackBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace(id);
  if (!workspace) notFound();
  return <PackBuilderView initial={workspace} />;
}
