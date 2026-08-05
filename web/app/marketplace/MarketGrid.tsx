'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PackOut, WorkspaceOut } from '@/lib/api';
import { installPackAction } from '@/lib/session';
import { ActionButton, Button, Card, CardBody, CardKicker, CardMeta, CardTitle, Tag } from '@/components/ui';

export function MarketGrid({ packs, workspaces }: { packs: PackOut[]; workspaces: WorkspaceOut[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<Record<string, boolean>>({});

  const filtered = query.trim()
    ? packs.filter((pack) => pack.name.toLowerCase().includes(query.trim().toLowerCase()))
    : packs;

  async function install(packId: string) {
    const workspaceId = target[packId];
    if (!workspaceId || busy) return;
    setBusy(packId);
    setError((current) => ({ ...current, [packId]: '' }));
    try {
      await installPackAction(workspaceId, packId);
      setInstalled((current) => ({ ...current, [packId]: true }));
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

  return (
    <section className="p-6">
      <label className="sr-only" htmlFor="pack-search">
        Search packs
      </label>
      <input
        id="pack-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search packs"
        className="mb-4 w-full border border-rule bg-surface px-2 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[260px]"
      />
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((pack) => {
          const updated = new Date(pack.updated_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
          const workspaceId = target[pack.id];
          return (
            <Card key={pack.id} pad={false} className="flex min-h-[230px] flex-col border border-rule p-5 transition-colors hover:border-accent">
              <CardKicker>Knowledge Pack</CardKicker>
              <CardTitle className="mt-1 text-[21px]">{pack.name}</CardTitle>
              <CardBody className="mt-2">
                {pack.latest_version > 0
                  ? `Version ${pack.latest_version} — frozen and runnable.`
                  : 'No frozen version yet; nothing to install.'}
              </CardBody>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Tag>{pack.latest_version > 0 ? `v${pack.latest_version}` : 'draft'}</Tag>
                <Tag variant="outline">Updated {updated}</Tag>
              </div>
              {error[pack.id] && <p className="mt-2 text-[12px] text-missing">{error[pack.id]}</p>}
              <CardMeta>
                {installed[pack.id] ? (
                  <Tag variant="accent">Installed</Tag>
                ) : (
                  <div className="ml-auto flex items-center gap-2">
                    {workspaces.length > 0 ? (
                      <>
                        <label className="sr-only" htmlFor={`target-${pack.id}`}>
                          Workspace for {pack.name}
                        </label>
                        <select
                          id={`target-${pack.id}`}
                          value={workspaceId ?? ''}
                          onChange={(event) =>
                            setTarget((current) => ({ ...current, [pack.id]: event.target.value }))
                          }
                          className="w-40 border border-rule bg-surface px-1.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                        >
                          <option value="" disabled>
                            Workspace…
                          </option>
                          {workspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </option>
                          ))}
                        </select>
                        <ActionButton
                          variant="primary"
                          size="sm"
                          disabled={!workspaceId || busy !== null || pack.latest_version === 0}
                          onClick={() => void install(pack.id)}
                        >
                          {busy === pack.id ? 'Installing…' : 'Install'}
                        </ActionButton>
                      </>
                    ) : (
                      <Button href="/workspace/new" variant="secondary" size="sm" className="ml-auto">
                        Create a workspace first
                      </Button>
                    )}
                  </div>
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
  );
}
