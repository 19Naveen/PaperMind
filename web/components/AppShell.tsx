'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconChevronDown, IconCheck, IconHome, IconLibrary, IconPlus } from '@/lib/icons';
import type { User, WorkspaceOut } from '@/lib/api';
import { AuthProvider } from './auth/AuthProvider';
import { HomeNavbar } from './HomeNavbar';

function packLabel(workspace: WorkspaceOut): string {
  return workspace.pack_name && workspace.pack_version
    ? `${workspace.pack_name} ${workspace.pack_version}`
    : 'No pack';
}

function RailLink({
  href,
  active,
  children,
  icon,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="group flex min-h-10 items-stretch transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className={`w-[3px] shrink-0 ${active ? 'bg-accent' : 'bg-transparent'}`} />
      <span className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2 text-[13px]">
        {icon}
        <span className={`truncate ${active ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{children}</span>
      </span>
    </Link>
  );
}

function HomeRail({ workspaces, pathname }: { workspaces: WorkspaceOut[]; pathname: string }) {
  return (
    <>
      <nav className="border-y border-rule py-1.5" aria-label="Main navigation">
        <RailLink href="/" active={pathname === '/'} icon={<IconHome width={15} height={15} strokeWidth={1.6} />}>
          Workspaces
        </RailLink>
        <RailLink
          href="/marketplace"
          active={pathname === '/marketplace'}
          icon={<IconLibrary width={15} height={15} strokeWidth={1.6} />}
        >
          Marketplace
        </RailLink>
      </nav>
      <section className="flex-1 overflow-y-auto py-4" aria-labelledby="workspaces-label">
        <h2 id="workspaces-label" className="px-4 pb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
          Your workspaces
        </h2>
        <nav aria-label="Your workspaces">
          {workspaces.map((workspace) => {
            const active = pathname.startsWith(`/workspace/${workspace.id}`);
            return (
              <Link
                key={workspace.id}
                href={`/workspace/${workspace.id}`}
                aria-current={active ? 'page' : undefined}
                className="group flex items-stretch transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span className={`w-[3px] shrink-0 ${active ? 'bg-accent' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1 px-3.5 py-2">
                  <span className="block truncate text-[13px] font-medium text-ink">{workspace.name}</span>
                  <span className="block truncate pt-0.5 font-data text-[10.5px] text-ink-3">{packLabel(workspace)}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </section>
    </>
  );
}

function WorkspaceRail({ workspace, workspaces, pathname }: { workspace: WorkspaceOut; workspaces: WorkspaceOut[]; pathname: string }) {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const overviewHref = `/workspace/${workspace.id}`;
  const packHref = `${overviewHref}/pack`;

  return (
    <>
      <div className="relative border-b border-rule">
        <button
          type="button"
          onClick={() => setIsSwitcherOpen((open) => !open)}
          aria-expanded={isSwitcherOpen}
          aria-controls="workspace-switcher"
          className="flex w-full items-center gap-2 bg-transparent px-4 py-3 text-left transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Workspace · all</span>
            <span className="display block truncate pt-1 text-[15px] font-extrabold leading-tight text-ink">{workspace.name}</span>
            <span className="block truncate pt-0.5 font-data text-[10.5px] text-ink-3">{packLabel(workspace)}</span>
          </span>
          <IconChevronDown width={15} height={15} className={`shrink-0 text-ink-3 transition-transform ${isSwitcherOpen ? 'rotate-180' : ''}`} />
        </button>
        {isSwitcherOpen && (
          <div id="workspace-switcher" className="absolute inset-x-2 top-full z-20 max-h-[260px] overflow-auto border border-rule bg-surface py-1 shadow-lg">
            <Link
              href="/"
              onClick={() => setIsSwitcherOpen(false)}
              className="block px-3 py-2 text-[12px] text-ink-2 hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              All workspaces
            </Link>
            {workspaces.map((item) => {
              const active = item.id === workspace.id;
              return (
                <Link
                  key={item.id}
                  href={`/workspace/${item.id}`}
                  onClick={() => setIsSwitcherOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                  {active && <IconCheck width={14} height={14} className="shrink-0 text-accent" />}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <nav className="border-b border-rule py-1.5" aria-label="Workspace navigation">
        <RailLink href={overviewHref} active={pathname === overviewHref}>Overview</RailLink>
        <RailLink href={packHref} active={pathname === packHref}>Pack</RailLink>
      </nav>
      <section className="flex-1 overflow-y-auto py-4" aria-labelledby="sessions-label">
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 id="sessions-label" className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Sessions</h2>
          <Link
            href={overviewHref}
            className="inline-flex size-5 items-center justify-center border border-rule text-ink-2 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="New session"
          >
            <IconPlus width={13} height={13} />
          </Link>
        </div>
        {/* ponytail: per-session sidebar nav needs the workspace's full session
            list, which only the overview page fetches — link there instead of
            re-fetching per workspace at the root layout. */}
        <Link href={overviewHref} className="block px-4 py-2 text-[13px] text-ink-2 hover:text-ink">
          {workspace.session_count} session{workspace.session_count === 1 ? '' : 's'}
        </Link>
      </section>
    </>
  );
}

export function AppShell({
  workspaces,
  user,
  children,
}: {
  workspaces: WorkspaceOut[];
  user: User | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';
  const isHomeRoute = pathname === '/';
  const workspaceId = pathname.match(/^\/workspace\/([^/]+)/)?.[1];
  const workspace = workspaceId ? workspaces.find((item) => item.id === workspaceId) : undefined;

  // The auth screens stand alone — no rail, no account chip.
  if (isAuthRoute) return children;

  return (
    <AuthProvider user={user}>
      <div className="flex h-dvh flex-col overflow-hidden bg-ground text-ink">
        <HomeNavbar />
        <div className="flex min-h-0 flex-1">
          {!isHomeRoute && (
          <aside className="hidden h-full w-[266px] shrink-0 flex-col overflow-hidden border-r-2 border-rule bg-ground md:flex">
            {workspace ? <WorkspaceRail workspace={workspace} workspaces={workspaces} pathname={pathname} /> : <HomeRail workspaces={workspaces} pathname={pathname} />}
          </aside>
        )}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
        </div>
      </div>
    </AuthProvider>
  );
}
