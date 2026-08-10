import { notFound, redirect } from 'next/navigation';
import { ApiError, getMe, getPack } from '@/lib/api';
import { PackBuilderView } from '@/components/PackBuilderView';

export default async function PackEditPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const user = await getMe();
  if (!user) redirect('/login');
  const detail = await getPack(packId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'PACK_NOT_FOUND') notFound();
    throw error;
  });
  // Editing an existing Pack seeds its studio session from the latest frozen version
  // (pack_id + base_pack_version_id), so the workflow is present before the first turn.
  const latest = detail.versions[detail.versions.length - 1] ?? null;
  return (
    <PackBuilderView
      packId={detail.pack.id}
      packName={detail.pack.name}
      basePackVersionId={latest?.id ?? undefined}
    />
  );
}
