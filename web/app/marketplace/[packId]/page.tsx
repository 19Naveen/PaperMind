import { notFound, redirect } from 'next/navigation';
import {
  ApiError,
  getMe,
  getPack,
  listPackAudit,
  listPackReleases,
  listPackReviews,
  listWorkspaces,
} from '@/lib/api';
import { Button, Card, CardHeader, CardKicker, CardTitle, PageHeader, Tag } from '@/components/ui';
import { MarketplaceInstall } from './MarketplaceInstall';
import { ReleasePanel } from './ReleasePanel';

async function safeFetch<T>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Request failed.' };
  }
}

function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="rows">{children}</ul>;
}

export default async function PackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ packId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { packId } = await params;
  const user = await getMe();
  if (!user) redirect('/login');
  const detail = await getPack(packId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'PACK_NOT_FOUND') notFound();
    throw error;
  });
  const workspaces = await listWorkspaces(200);
  const latest = detail.versions[detail.versions.length - 1] ?? null;
  const spec = latest?.spec ?? null;

  const qp = await searchParams;
  const revisionId = typeof qp.revision === 'string' ? qp.revision : null;

  const reviewsState = await safeFetch(() => listPackReviews(packId));
  const releasesState = await safeFetch(() => listPackReleases(packId));
  const auditState = await safeFetch(() => listPackAudit(packId));

  return (
    <section className="page">
      <PageHeader
        eyebrow="Marketplace"
        title={detail.pack.name}
        meta="Knowledge Pack"
        actions={
          <>
            <Button href={`/marketplace/${detail.pack.id}/edit`} variant="primary">Edit pack</Button>
            <Button href="/marketplace" variant="ghost">← Back</Button>
          </>
        }
      />

      <div className="wk-grid">
        <div className="stack">
          <Card>
            <div className="flbl-wrap">
              <CardKicker>Latest version</CardKicker>
              <Tag variant="outline">v{detail.pack.latest_version}</Tag>
            </div>
            <CardTitle className="mt-2">{detail.pack.name}</CardTitle>
            <p className="cbd mt-2">
              {detail.pack.latest_version > 0
                ? 'Frozen and runnable — every session executes this exact version, so results stay comparable.'
                : 'No frozen version yet; this Pack is not installable until one is approved.'}
            </p>
          </Card>

          {spec && (
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
                <CardHeader title="Fields extracted" />
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
                <CardHeader title="Rules" />
                <div className="card-pad">
                  <RowList>
                    {spec.rules.map((rule) => <li key={rule.id}>{rule.description}</li>)}
                    {spec.rules.length === 0 && <li className="muted">No rules defined.</li>}
                  </RowList>
                </div>
              </Card>
            </>
          )}

          <Card pad={false}>
            <CardHeader title="Version history" />
            <div className="card-pad">
              <RowList>
                {[...detail.versions].reverse().map((version) => (
                  <li key={version.id} className="row-2">
                    <span className="mono">Version {version.version}</span>
                    <span className="row-sub">{new Date(version.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
                {detail.versions.length === 0 && <li className="muted">No versions yet.</li>}
              </RowList>
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card>
            <CardKicker>Install</CardKicker>
            <div className="mt-3">
              <MarketplaceInstall packId={detail.pack.id} packName={detail.pack.name} workspaces={workspaces} />
            </div>
          </Card>
          <p className="fineprint">
            A Pack version is append-only. To change behaviour, edit the Pack to author and approve a new version.
          </p>
        </aside>
      </div>

      <div className="mt-6">
        <ReleasePanel
          packId={detail.pack.id}
          latestVersionId={latest?.id ?? null}
          latestVersion={detail.pack.latest_version}
          revisionId={revisionId}
          reviews={reviewsState.data}
          reviewsError={reviewsState.error}
          releases={releasesState.data}
          releasesError={releasesState.error}
          audit={auditState.data}
          auditError={auditState.error}
        />
      </div>
    </section>
  );
}
