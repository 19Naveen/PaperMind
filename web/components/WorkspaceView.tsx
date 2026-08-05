'use client';

import Link from 'next/link';
import type { Workspace, WorkspaceSession } from '@/lib/types';
import { PACK_NODES } from '@/lib/mock';
import { PageHeader, Button, CardKicker, CardTitle, Tag, Divider, EmptyState } from '@/components/ui';

/** A flush modular-grid stat cell — shared top rule, per-cell bottom rule, no box/shadow. Matches the prototype's stat strips (see app/page.tsx's local Stat). */
function GridStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-b border-r border-rule py-3.5 pl-3 first:pl-0">
      <p className="display text-[24px] font-extrabold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[11px] text-ink-2">{label}</p>
    </div>
  );
}

const sessionState: Record<WorkspaceSession['status'], string> = {
  pending: 'bg-raised text-ink-2',
  running: 'bg-running-soft text-running',
  complete: 'bg-verified-soft text-verified',
  failed: 'bg-missing-soft text-missing',
};

export function WorkspaceView({ initial }: { initial: Workspace }) {
  const hasPack = Boolean(initial.pack_name);
  const assets = initial.pack_assets ?? [];
  const usage = initial.usage ?? Array.from({ length: 14 }, () => 0);
  const completed = initial.sessions.filter((session) => session.status === 'complete').length;

  return (
    <main className="min-h-full bg-ground text-ink">
      <PageHeader
        eyebrow="Workspace"
        title={initial.name}
        actions={
          <>
            <Button href={`/workspace/${initial.id}/pack`} variant="outline" size="sm">
              Edit pack
            </Button>
            <Button href={`/workspace/${initial.id}/sessions/nord`} variant="primary" size="sm">
              New session
            </Button>
          </>
        }
      />

      {!hasPack ? (
        <div className="mx-auto flex min-h-[calc(100vh-89px)] max-w-2xl flex-col justify-center px-6 py-16">
          <EmptyState
            title="No Pack installed"
            body="A Pack gives every session the same documents, instructions and outputs. Build one for this workspace or install a published Pack to begin."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button href={`/workspace/${initial.id}/pack`} variant="primary">Build a Pack</Button>
                <Button href="/library" variant="outline">Browse Packs</Button>
              </div>
            }
          />
          <div className="mt-12 border-t-2 border-rule pt-4 text-[12px] leading-relaxed text-ink-2">
            Sessions stay empty until a Pack is installed. Once installed, every run remains comparable because it follows the same versioned workflow.
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-7">
          <section className="grid gap-6 border-b-2 border-rule pb-7 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardKicker>Installed pack</CardKicker>
                <Tag variant="outline">{initial.pack_version ?? 'Draft'}</Tag>
              </div>
              <CardTitle className="mt-2 text-[28px]">{initial.pack_name}</CardTitle>
              <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-2">{initial.pack_description ?? initial.goal}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Tag>Versioned workflow</Tag>
                <Tag>Repeatable output</Tag>
                <Tag>Audit ready</Tag>
              </div>
            </div>
            <div className="border-l-0 border-rule lg:border-l lg:pl-6">
              <CardKicker>Pack assets</CardKicker>
              <div className="mt-3 divide-y divide-rule border-y border-rule">
                {assets.map((asset) => (
                  <div key={asset.name} className="py-2.5">
                    <p className="truncate font-data text-[12px]">{asset.name}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">{asset.meta}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 border-l border-t-2 border-rule sm:grid-cols-5">
            <GridStat label="Version" value={initial.pack_version ?? 'Draft'} />
            <GridStat label="Nodes" value={PACK_NODES.length} />
            <GridStat label="Assets" value={assets.length} />
            <GridStat label="Sessions" value={initial.sessions.length} />
            <GridStat label="Visibility" value="Private" />
          </section>

          <section className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <div className="flex items-baseline justify-between">
                <CardKicker>Usage</CardKicker>
                <p className="font-data text-[10px] text-ink-3">LAST 14 DAYS</p>
              </div>
              <div className="mt-4 flex h-44 items-end gap-1.5 border-b-2 border-rule px-1">
                {usage.map((value, index) => (
                  <div key={`${value}-${index}`} className="group flex flex-1 flex-col justify-end">
                    <span className="mb-1 hidden text-center font-data text-[9px] text-ink-3 group-hover:block">{value}</span>
                    <div className="min-h-[3px] bg-accent/80" style={{ height: `${Math.max(value, 3)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between font-data text-[10px] text-ink-3"><span>14 days ago</span><span>Today</span></div>
            </div>
            <div>
              <CardKicker>Sessions</CardKicker>
              <div className="mt-4 divide-y divide-rule border-y border-rule">
                {initial.sessions.slice(0, 4).map((session) => (
                  <Link key={session.id} href={`/workspace/${initial.id}/sessions/${session.id}`} className="flex items-center gap-3 py-3 hover:bg-raised">
                    <span className={`h-2 w-2 rounded-full ${sessionState[session.status]}`} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{session.title}</span>
                    <span className="font-data text-[10px] text-ink-3">{session.updated ?? session.meta}</span>
                  </Link>
                ))}
                {initial.sessions.length === 0 && <p className="py-5 text-[12px] text-ink-2">No sessions yet.</p>}
              </div>
            </div>
          </section>

          <Divider className="mt-10" />
          <section className="mt-4 grid grid-cols-2 border-l border-t-2 border-rule md:grid-cols-4">
            <GridStat label="Sessions run" value={initial.sessions.length} />
            <GridStat label="Completed" value={completed} />
            <GridStat label="Pack nodes" value={PACK_NODES.length} />
            <GridStat label="Assets attached" value={assets.length} />
          </section>
        </div>
      )}
    </main>
  );
}
