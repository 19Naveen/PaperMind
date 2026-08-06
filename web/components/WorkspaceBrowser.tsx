'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkspaceOut } from '@/lib/api';
import { Button, Card, CardBody, CardKicker, CardMeta, CardTitle, Tag, Td, Th } from '@/components/ui';

export interface RecentSession {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: string;
  updatedAt: string;
}

export function WorkspaceBrowser({
  workspaces,
  recentSessions,
}: {
  workspaces: WorkspaceOut[];
  recentSessions: RecentSession[];
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((workspace) =>
      `${workspace.name} ${workspace.goal} ${workspace.pack_name ?? ''}`.toLowerCase().includes(term),
    );
  }, [query, workspaces]);

  return (
    <>
      <section className="px-4 pb-8 pt-6 sm:px-6">
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <p className="eyebrow mr-auto font-bold text-ink">Workspaces · {workspaces.length}</p>
          <label className="sr-only" htmlFor="workspace-filter">Filter workspaces</label>
          <input
            id="workspace-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter workspaces"
            className="w-full border border-rule bg-surface px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[220px]"
          />
        </div>
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((workspace) => {
            const packKicker = workspace.pack_name && workspace.pack_version
              ? `${workspace.pack_name} · v${workspace.pack_version}`
              : 'No pack installed';
            const updated = new Date(workspace.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return (
              <Card key={workspace.id} pad={false} className="flex min-h-[212px] flex-col p-5 shadow-sm transition-shadow hover:shadow-md">
                <CardKicker className="text-accent">{packKicker}</CardKicker>
                <CardTitle className="mt-1 text-[21px]">{workspace.name}</CardTitle>
                <CardBody className="mt-2">{workspace.goal}</CardBody>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Tag>{workspace.session_count} session{workspace.session_count === 1 ? '' : 's'}</Tag>
                  <Tag variant="outline">Updated {updated}</Tag>
                </div>
                <CardMeta className="mt-3">
                  <Button href={`/workspace/${workspace.id}/pack`} variant="ghost" size="sm">{workspace.pack_id ? 'View pack' : 'Build pack'}</Button>
                  <Button href={`/workspace/${workspace.id}`} variant="primary" size="sm" className="ml-auto">Open</Button>
                </CardMeta>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full border border-dashed border-rule px-6 py-10 text-center text-[13px] text-ink-2">
              No workspaces match “{query}”.
            </div>
          )}
          {!query && (
            <Link href="/workspace/new" className="group flex min-h-[212px] flex-col justify-between border-2 border-dashed border-accent/70 bg-accent-soft p-5 shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
              <span className="flex size-9 items-center justify-center border border-accent bg-ground text-[24px] leading-none text-accent transition-colors group-hover:border-accent-ink group-hover:bg-accent group-hover:text-accent-ink" aria-hidden>+</span>
              <span>
                <span className="eyebrow block text-accent">Workspace</span>
                <span className="display mt-1 block text-[21px] font-extrabold leading-tight text-accent transition-colors group-hover:text-accent-ink">New workspace</span>
                <span className="mt-1 block max-w-[34ch] text-[13px] leading-relaxed text-ink-2 transition-colors group-hover:text-accent-ink">Create a blank workspace, then build or install the Pack it will run.</span>
              </span>
            </Link>
          )}
        </div>
      </section>

      <div className="mx-4 border-t-2 border-rule sm:mx-6" />

      <section className="px-4 pb-6 pt-10 sm:px-6">
          <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
            <p className="eyebrow mr-auto font-bold text-ink">Recent activity</p>
          </div>
          {recentSessions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead><tr><Th>Session</Th><Th>Workspace</Th><Th>Status</Th><Th>Updated</Th><Th><span className="sr-only">Action</span></Th></tr></thead>
                <tbody>
                  {recentSessions.map((session) => (
                    <tr key={`${session.workspaceId}:${session.id}`}>
                      <Td className="font-semibold">{session.title}</Td>
                      <Td>{session.workspaceName}</Td>
                      <Td><Tag>{session.status}</Tag></Td>
                      <Td>{new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Td>
                      <Td align="right"><Button href={`/workspace/${session.workspaceId}/sessions/${session.id}`} variant="ghost" size="sm">Open</Button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="border border-dashed border-rule p-6 text-[13px] text-ink-2">No session activity yet. Open a workspace to start the first review.</p>
          )}
      </section>
    </>
  );
}
