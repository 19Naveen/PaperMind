import { notFound, redirect } from 'next/navigation';
import { ApiError, getMe, getPack, getWorkspace } from '@/lib/api';
import { PackBuilderView } from '@/components/PackBuilderView';

/**
 * Authoring a new version of a workspace's installed Pack.
 *
 * This route exists so the URL matches how the user actually got here. Editing was
 * previously reached from a workspace but landed on `/marketplace/{packId}/edit`,
 * which made the breadcrumb read "Marketplace" and offered a back link into a
 * catalogue the user was never browsing. The marketplace route stays for editing a
 * Pack you reached from the catalogue; this one keeps workspace context.
 *
 * Both render the same Studio: the pack plus its latest frozen version seed the
 * studio session (`pack_id` + `base_pack_version_id`), so the workflow is on screen
 * before the first chat turn.
 */
export default async function WorkspacePackEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getMe();
  if (!user) redirect('/login');

  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });

  // No Pack installed yet → the workspace's own pack page owns that empty state.
  if (!workspace.pack_id) redirect(`/workspace/${workspace.id}/pack`);

  const detail = await getPack(workspace.pack_id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'PACK_NOT_FOUND') notFound();
    throw error;
  });
  const latest = detail.versions[detail.versions.length - 1] ?? null;

  return (
    <PackBuilderView
      packId={detail.pack.id}
      packName={detail.pack.name}
      basePackVersionId={latest?.id ?? undefined}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
    />
  );
}
