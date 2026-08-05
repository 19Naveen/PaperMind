import Link from 'next/link';
import {
  Button,
  Card,
  CardBody,
  CardKicker,
  CardMeta,
  CardTitle,
  Pill,
  Tag,
  Td,
  Th,
} from '@/components/ui';
import { getWorkspaces } from '@/lib/mock';

export default async function HomePage() {
  const workspaces = await getWorkspaces();
  const sessionCount = workspaces.reduce((total, workspace) => total + workspace.sessions.length, 0);
  const recent = workspaces.flatMap((workspace) =>
    workspace.sessions.map((session) => ({ workspace, session })),
  );

  return (
    <div className="min-h-full">
      <header className="border-b-2 border-rule bg-surface px-6 py-[18px]">
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="mr-auto">
            <p className="eyebrow text-accent">Home</p>
            <h1 className="display mt-1 text-[21px] font-extrabold leading-tight text-ink">Mara Ostwald</h1>
          </div>
          <Button href="/marketplace" variant="secondary">Marketplace</Button>
          <Button href="/workspace/vendor" variant="primary">New workspace</Button>
        </div>
      </header>

      <section className="grid gap-6 border-b-2 border-rule px-6 py-7 md:grid-cols-[1.2fr_1fr] md:gap-0">
        <div className="md:border-r md:border-rule md:pr-8">
          <h2 className="display max-w-[20ch] text-[32px] font-extrabold leading-tight text-ink">
            One Pack per workspace. Every run identical.
          </h2>
          <p className="mt-3.5 max-w-[52ch] text-[14px] leading-relaxed text-ink">
            A workspace holds a single Pack - the workflow, prompts, templates and reference documents your automation needs.
            Open a workspace to run it against new documents; edit the Pack from the workspace overview when the process itself changes.
          </p>
        </div>
        <div className="md:pl-8">
          <p className="eyebrow">Across all workspaces</p>
          <div className="mt-2.5 grid grid-cols-2 border-t border-rule">
            <Stat value={workspaces.length} label="Workspaces" />
            <Stat value={sessionCount} label="Sessions" className="pl-3" />
            <Stat value="142" label="Runs this month" />
            <Stat value="1,038" label="Documents processed" className="pl-3" />
          </div>
        </div>
      </section>

      <section className="px-6 py-6">
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <p className="mr-auto eyebrow">Workspaces · {workspaces.length}</p>
          <label className="sr-only" htmlFor="workspace-filter">Filter workspaces</label>
          <input
            id="workspace-filter"
            type="search"
            placeholder="Filter workspaces"
            className="w-full border border-rule bg-surface px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent sm:w-[220px]"
          />
        </div>
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => {
            const sessions = workspace.sessions.length;
            const lastRun = workspace.id === 'onb' ? 'Last run 4 min ago' : workspace.id === 'invoice' ? 'Last run yesterday' : 'Never run';
            const packKicker = workspace.pack_name && workspace.pack_version
              ? `${workspace.pack_name} ${workspace.pack_version}`
              : 'No pack installed';

            return (
              <Card key={workspace.id} pad={false} className="flex min-h-[212px] flex-col border border-rule p-5 transition-colors hover:border-accent">
                <CardKicker>{packKicker}</CardKicker>
                <CardTitle className="mt-1 text-[21px]">{workspace.name}</CardTitle>
                <CardBody className="mt-2">{workspace.goal}</CardBody>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Tag>{sessions} session{sessions === 1 ? '' : 's'}</Tag>
                  <Tag variant="outline">{lastRun}</Tag>
                </div>
                <CardMeta>
                  <Button href={`/workspace/${workspace.id}/pack`} variant="ghost" size="sm">Edit pack</Button>
                  <Button href={`/workspace/${workspace.id}`} variant="primary" size="sm" className="ml-auto">Open</Button>
                </CardMeta>
              </Card>
            );
          })}
          <Link href="/workspace/vendor" className="flex min-h-[212px] flex-col justify-end gap-1.5 border border-dashed border-rule p-[18px] transition-colors hover:border-accent">
            <span className="display text-[21px] font-extrabold leading-tight text-ink">New workspace</span>
            <span className="max-w-[34ch] text-[13px] leading-relaxed text-ink-2">Start from a blank Pack, or install one from the Marketplace.</span>
          </Link>
        </div>
      </section>

      <section className="px-6 pb-8">
        <div className="border-t border-rule" />
        <div className="my-3 flex items-baseline gap-3">
          <p className="mr-auto eyebrow">Recent activity</p>
          <Button href="/marketplace" variant="ghost" size="sm">Browse Marketplace</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><Th>Session</Th><Th>Workspace</Th><Th>Status</Th><Th>Updated</Th><Th align="right">Open</Th></tr></thead>
            <tbody>
              {recent.map(({ workspace, session }) => (
                <tr key={`${workspace.id}:${session.id}`}>
                  <Td className="font-semibold text-ink">{session.title}</Td>
                  <Td className="text-ink-2">{workspace.name}</Td>
                  <Td><Pill tone="neutral">{session.status === 'complete' ? 'Complete' : 'Draft'}</Pill></Td>
                  <Td className="text-ink-2">{session.meta}</Td>
                  <Td align="right"><Button href={`/workspace/${workspace.id}/sessions/${session.id}`} variant="ghost" size="sm">Open</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, className = '' }: { value: string | number; label: string; className?: string }) {
  return (
    <div className={`border-b border-rule py-3 ${className}`}>
      <p className="display text-[26px] font-extrabold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[11px] text-ink-2">{label}</p>
    </div>
  );
}
