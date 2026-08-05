'use client';

import Link from 'next/link';
import type { WorkspaceDetailOut, WorkspaceSessionOut } from '@/lib/api';
import { createSessionAction } from '@/lib/session';
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

const sessionState: Record<WorkspaceSessionOut['status'], string> = {
  draft: 'bg-raised text-ink-2',
  pending: 'bg-raised text-ink-2',
  running: 'bg-running-soft text-running',
  complete: 'bg-verified-soft text-verified',
  failed: 'bg-missing-soft text-missing',
};

export function WorkspaceView({ initial }: { initial: WorkspaceDetailOut }) {
  const hasPack = Boolean(initial.pack_name);
  const completed = initial.sessions.filter((session) => session.status === 'complete').length;

  return (
    <main className="min-h-full bg-ground text-ink">
      <PageHeader eyebrow="Workspace" title={initial.name} />

      {!hasPack ? (
        <div className="mx-auto flex min-h-[calc(100vh-89px)] max-w-2xl flex-col justify-center px-6 py-16">
          <EmptyState
            title="No Pack installed"
            body="A Pack gives every session the same documents, instructions and outputs. Browse the Marketplace to install one for this workspace."
            action={
              // ponytail: Pack authoring (chat + graph) has no backend yet — only
              // installing a published Pack is a real flow, so that's the one link.
              <Button href="/marketplace" variant="primary">Browse Marketplace</Button>
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
                <Tag variant="outline">{initial.pack_version !== null ? `v${initial.pack_version}` : 'Draft'}</Tag>
              </div>
              <CardTitle className="mt-2 text-[28px]">{initial.pack_name}</CardTitle>
              <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-2">{initial.goal}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Tag>Versioned workflow</Tag>
                <Tag>Repeatable output</Tag>
                <Tag>Audit ready</Tag>
              </div>
            </div>
            <div className="border-l-0 border-rule lg:border-l lg:pl-6">
              <CardKicker>Pack assets</CardKicker>
              <div className="mt-3 divide-y divide-rule border-y border-rule">
                {initial.assets.map((asset) => (
                  <div key={asset.id} className="py-2.5">
                    <p className="truncate font-data text-[12px]">{asset.name}</p>
                  </div>
                ))}
                {initial.assets.length === 0 && <p className="py-2.5 text-[12px] text-ink-2">No assets attached.</p>}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 border-l border-t-2 border-rule sm:grid-cols-4">
            <GridStat label="Version" value={initial.pack_version !== null ? `v${initial.pack_version}` : 'Draft'} />
            <GridStat label="Assets" value={initial.assets.length} />
            <GridStat label="Sessions" value={initial.session_count} />
            <GridStat label="Visibility" value="Private" />
          </section>

          <section className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <CardKicker>Sessions</CardKicker>
              <div className="mt-4 divide-y divide-rule border-y border-rule">
                {initial.sessions.map((session) => (
                  <Link
                    key={session.id}
                    href={`/workspace/${initial.id}/sessions/${session.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className={`h-2 w-2 rounded-full ${sessionState[session.status] ?? 'bg-raised text-ink-2'}`} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{session.title}</span>
                    <span className="font-data text-[10px] text-ink-3">{session.status}</span>
                  </Link>
                ))}
                {initial.sessions.length === 0 && <p className="py-5 text-[12px] text-ink-2">No sessions yet.</p>}
              </div>
              <form action={createSessionAction.bind(null, initial.id)} className="mt-4 flex gap-2">
                <label className="sr-only" htmlFor="session-title">Session title</label>
                <input
                  id="session-title"
                  name="title"
                  type="text"
                  placeholder="New session title"
                  required
                  className="w-full border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110"
                >
                  Add session
                </button>
              </form>
            </div>
          </section>

          <Divider className="mt-10" />
          <section className="mt-4 grid grid-cols-2 border-l border-t-2 border-rule md:grid-cols-3">
            <GridStat label="Sessions run" value={initial.session_count} />
            <GridStat label="Completed" value={completed} />
            <GridStat label="Assets attached" value={initial.assets.length} />
          </section>
        </div>
      )}
    </main>
  );
}
