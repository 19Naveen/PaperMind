'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PackOut, WorkspaceOut } from '@/lib/api';
import { installPackAction } from '@/lib/session';
import { MARKETPLACE_PACKS } from '@/lib/mock';
import { ActionButton, Button, Card, CardBody, CardKicker, CardMeta, CardTitle, PageHeader, Tag } from '@/components/ui';

const CATEGORY_FILTERS = ['all', 'compliance', 'finance', 'legal', 'operations', 'research', 'others'] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: 'All',
  compliance: 'Compliance',
  finance: 'Finance',
  legal: 'Legal',
  operations: 'Operations',
  research: 'Research',
  others: 'Others',
};

function categoryFor(pack: PackOut): CategoryFilter {
  const category = MARKETPLACE_PACKS.find((item) => item.id === pack.id || item.name === pack.name)?.category.toLowerCase();
  return category === 'compliance' || category === 'finance' || category === 'legal' || category === 'operations' || category === 'research'
    ? category
    : 'others';
}

export function MarketGrid({ packs, workspaces }: { packs: PackOut[]; workspaces: WorkspaceOut[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [installingPackId, setInstallingPackId] = useState<string | null>(null);

  const filtered = packs.filter((pack) => {
    const matchesQuery = !query.trim() || pack.name.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === 'all' || categoryFor(pack) === filter);
  });

  async function install(packId: string) {
    const workspaceId = target[packId];
    if (!workspaceId || busy) return;
    setBusy(packId);
    setError((current) => ({ ...current, [packId]: '' }));
    try {
      await installPackAction(workspaceId, packId);
      setInstalled((current) => ({ ...current, [packId]: true }));
      setInstallingPackId(null);
      router.refresh();
    } catch (err) {
      setError((current) => ({
        ...current,
        [packId]: err instanceof Error ? err.message : 'Could not install the pack.',
      }));
    } finally {
      setBusy(null);
    }
  }

  const installingPack = installingPackId ? packs.find((pack) => pack.id === installingPackId) ?? null : null;
  const installingWorkspaceId = installingPack ? target[installingPack.id] : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Published packs"
        actions={
          <>
            <label className="sr-only" htmlFor="pack-search">Search packs</label>
            <input id="pack-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search packs" className="w-full border border-rule bg-surface px-2 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[260px]" />
            <Button href="/workspace/new" variant="secondary">Publish yours</Button>
          </>
        }
      />
      <nav className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-[18px] sm:px-6" aria-label="Pack filters">
        {CATEGORY_FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`border px-[10px] py-[3px] text-[11px] tracking-[0.02em] transition-colors ${filter === value ? 'border-accent-100 bg-accent-100 text-accent-800' : 'border-neutral-100 bg-neutral-100 text-neutral-800 hover:border-accent'}`}>
            {CATEGORY_LABEL[value]}
          </button>
        ))}
      </nav>
      {installingPack && (
        <section className="flex flex-wrap items-end gap-3 border-b border-rule px-6 py-4" aria-label={`Install ${installingPack.name}`}>
          <div className="mr-auto">
            <p className="eyebrow text-accent">Install pack</p>
            <p className="display mt-1 text-[16px] text-ink">{installingPack.name}</p>
          </div>
          <label className="sr-only" htmlFor="install-workspace">Workspace</label>
          <select
            id="install-workspace"
            value={installingWorkspaceId ?? ''}
            onChange={(event) => setTarget((current) => ({ ...current, [installingPack.id]: event.target.value }))}
            className="w-full border border-rule bg-surface px-2 py-2 text-[13px] text-ink outline-none focus:border-accent sm:w-52"
          >
            <option value="" disabled>Select workspace…</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <ActionButton variant="secondary" onClick={() => setInstallingPackId(null)}>Cancel</ActionButton>
          <ActionButton variant="primary" disabled={!installingWorkspaceId || busy !== null || installingPack.latest_version === 0} onClick={() => void install(installingPack.id)}>
            {busy === installingPack.id ? 'Installing…' : 'Install'}
          </ActionButton>
        </section>
      )}
      <section className="overflow-x-auto p-6">
      <div className="grid min-w-[816px] grid-cols-[repeat(3,minmax(260px,1fr))] gap-[18px]">
        {filtered.map((pack) => {
          const referencePack = MARKETPLACE_PACKS.find((item) => item.id === pack.id || item.name === pack.name);
          return (
            <Card key={pack.id} pad={false} className="flex min-h-[230px] flex-col p-5 shadow-sm transition-[border-color] duration-100 hover:border-accent">
              <CardKicker>{referencePack?.category ?? 'Knowledge Pack'}</CardKicker>
              <CardTitle className="mt-1 text-[21px]">{pack.name}</CardTitle>
              <CardBody className="mt-2">
                {referencePack?.description ?? (pack.latest_version > 0
                  ? `Version ${pack.latest_version} — frozen and runnable.`
                  : 'No frozen version yet; nothing to install.')}
              </CardBody>
              <div className="mb-3 mt-3 flex flex-wrap gap-1.5">
                <Tag>{referencePack?.nodes ?? '—'} nodes</Tag>
                <Tag>{referencePack?.assets ?? '—'} assets</Tag>
              </div>
              {error[pack.id] && <p className="mt-2 text-[12px] text-missing">{error[pack.id]}</p>}
              <CardMeta className="mt-0 pt-3">
                {installed[pack.id] ? (
                  <Tag variant="accent">Installed</Tag>
                ) : (
                  <>
                    <span className="mr-auto whitespace-nowrap">
                      {referencePack ? `${referencePack.installs} installs · by ${referencePack.author}` : '— installs · by PaperMind'}
                    </span>
                    {workspaces.length > 0 ? (
                      <ActionButton variant="primary" size="sm" disabled={pack.latest_version === 0} onClick={() => setInstallingPackId(pack.id)}>
                        Install
                      </ActionButton>
                    ) : (
                      <Button href="/workspace/new" variant="primary" size="sm" className="ml-auto">Install</Button>
                    )}
                  </>
                )}
              </CardMeta>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-10 text-center text-[13px] text-ink-2">
            No packs match “{query}”.
          </p>
        )}
      </div>
      </section>
    </>
  );
}
