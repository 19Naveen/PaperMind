import { notFound } from 'next/navigation';
import { PackBuilderView } from '@/components/PackBuilderView';
import { ApiError, getWorkspace } from '@/lib/api';
import { Button, Card, CardBody, CardKicker, CardTitle, PageHeader, Tag } from '@/components/ui';

export default async function PackBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getWorkspace(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'WORKSPACE_NOT_FOUND') notFound();
    throw error;
  });

  // A workspace claims exactly one Pack; when it has one, authoring is closed and the
  // overview of the frozen version replaces the studio.
  if (workspace.pack_id) {
    return (
      <main className="min-h-full bg-ground text-ink">
        <PageHeader
          eyebrow="Pack"
          title={workspace.pack_name ?? 'Installed Pack'}
          actions={
            <>
              <Tag variant="accent">
                {workspace.pack_version != null ? `v${workspace.pack_version}` : 'installed'}
              </Tag>
              <Button href={`/workspace/${workspace.id}`} variant="secondary" size="sm">
                Back to workspace
              </Button>
            </>
          }
        />
        <div className="mx-auto max-w-2xl px-6 py-10">
          <Card>
            <CardKicker>Installed pack</CardKicker>
            <CardTitle className="mt-1 text-[24px] text-accent">{workspace.pack_name}</CardTitle>
            <CardBody className="mt-2">
              {workspace.goal ||
                'This workspace runs a single frozen Pack — every session executes the same version, so results stay comparable.'}
            </CardBody>
            <div className="mt-4 flex flex-wrap gap-2">
              <Tag>
                {workspace.pack_version != null ? `Version ${workspace.pack_version}` : 'Draft'}
              </Tag>
              <Tag variant="outline">{workspace.session_count} sessions</Tag>
              <Tag variant="outline">{workspace.assets.length} assets</Tag>
            </div>
          </Card>
          <p className="mt-6 text-[12.5px] leading-relaxed text-ink-2">
            A Pack version is append-only: to change behaviour, author a new version and
            approve it — the workspace keeps running the version each session pinned.
          </p>
        </div>
      </main>
    );
  }

  return <PackBuilderView workspaceId={workspace.id} workspaceName={workspace.name} />;
}
