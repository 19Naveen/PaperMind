import { notFound } from 'next/navigation';
import { PackBuilderView } from '@/components/PackBuilderView';
import { ApiError, getPack, getWorkspace } from '@/lib/api';
import { Button, Card, CardHeader, PageHeader, Tag } from '@/components/ui';
import { formatDate } from '@/lib/format';

function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="rows">{children}</ul>;
}

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

  // No Pack yet → the authoring Studio.
  if (!workspace.pack_id) {
    return <PackBuilderView workspaceId={workspace.id} workspaceName={workspace.name} />;
  }

  // Installed Pack → a read-only view of the frozen version. Edit opens the Studio.
  const detail = await getPack(workspace.pack_id).catch(() => null);
  const latest = detail ? detail.versions[detail.versions.length - 1] : null;
  const spec = latest?.spec ?? null;
  const versionLabel = workspace.pack_version != null ? `v${workspace.pack_version}` : 'installed';

  return (
    <div className="page">
      <PageHeader
        eyebrow="Installed Pack"
        title={workspace.pack_name ?? 'Pack'}
        meta={
          <>
            <Tag variant="accent">{versionLabel}</Tag> Frozen — every session runs this exact version. Edit authors a new
            version; the installed one stays put until you promote.
          </>
        }
        actions={
          <>
            <Button href={`/workspace/${workspace.id}`} variant="ghost">← Workspace</Button>
            <Button href={`/marketplace/${workspace.pack_id}/edit`} variant="primary">Edit pack</Button>
          </>
        }
      />

      <div className="wk-grid mt-6">
        <div className="stack">
          {spec ? (
            <>
              <Card pad={false}>
                <CardHeader title="Documents reviewed" />
                <div className="card-pad">
                  <RowList>
                    {spec.document_types.map((doc) => <li key={doc}>{doc}</li>)}
                    {spec.document_types.length === 0 && <li className="muted">No document types defined.</li>}
                  </RowList>
                </div>
              </Card>
              <Card pad={false}>
                <CardHeader title="Fields extracted" count={spec.fields.length} />
                <div className="card-pad">
                  <RowList>
                    {spec.fields.map((field) => (
                      <li key={field.name} className="row-2">
                        <span>
                          <span className="mono">{field.name}</span>
                          <span className="row-sub">{field.description}</span>
                        </span>
                        <Tag>{field.type}</Tag>
                      </li>
                    ))}
                    {spec.fields.length === 0 && <li className="muted">No fields defined.</li>}
                  </RowList>
                </div>
              </Card>
              <Card pad={false}>
                <CardHeader title="Rules" count={spec.rules.length} />
                <div className="card-pad">
                  <RowList>
                    {spec.rules.map((rule) => <li key={rule.id}>{rule.description}</li>)}
                    {spec.rules.length === 0 && <li className="muted">No rules defined.</li>}
                  </RowList>
                </div>
              </Card>
            </>
          ) : (
            <Card pad={false}>
              <CardHeader title="Pack spec" />
              <div className="card-pad">
                <p className="muted">The spec for this installed version isn&apos;t available to read back here. Open Edit to view it in the Studio.</p>
              </div>
            </Card>
          )}

          {detail && detail.versions.length > 0 && (
            <Card pad={false}>
              <CardHeader title="Version history" count={detail.versions.length} />
              <div className="card-pad">
                <RowList>
                  {[...detail.versions].reverse().map((version) => (
                    <li key={version.id} className="row-2">
                      <span className="mono">Version {version.version}{version.version === workspace.pack_version ? ' · installed' : ''}</span>
                      <span className="row-sub">{formatDate(version.created_at)}</span>
                    </li>
                  ))}
                </RowList>
              </div>
            </Card>
          )}
        </div>

        <aside className="stack">
          <Card>
            <div className="flbl-wrap" style={{ justifyContent: 'space-between' }}>
              <span className="chd-title">In this workspace</span>
              <Tag variant="outline">{versionLabel}</Tag>
            </div>
            <div className="mt-3">
              <ul className="rows">
                <li className="row-2"><span>Sessions</span><b className="mono">{workspace.session_count}</b></li>
                <li className="row-2"><span>Assets</span><b className="mono">{workspace.assets.length}</b></li>
              </ul>
            </div>
            <p className="fineprint mt-3">
              A Pack version is append-only. Editing authors a new version for review — sessions already running finish on the version they pinned.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
