'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { IconChevronDown, IconCheck, IconHome, IconLibrary, IconPlus } from '@/lib/icons';
import { IconClose } from '@/lib/icons';
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
      className="group flex min-h-9 items-stretch rounded-lg transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5b5bd6]"
    >
      <span className={`w-0.5 shrink-0 rounded-r ${active ? 'bg-[#8585ef]' : 'bg-transparent'}`} />
      <span className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.75px] ${active ? 'bg-[#5b5bd6]/[0.17]' : ''}`}>
        {icon}
        <span className={`truncate ${active ? 'font-semibold text-[#dadaff]' : 'text-[#a7a7b1] group-hover:text-white'}`}>{children}</span>
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
                className="group flex items-stretch rounded-lg transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5b5bd6]"
              >
                <span className={`w-0.5 shrink-0 rounded-r ${active ? 'bg-[#8585ef]' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1 px-2.5 py-2">
                  <span className="block truncate text-[12.75px] font-medium text-[#f4f4f5]">{workspace.name}</span>
                  <span className="block truncate pt-0.5 font-data text-[10px] text-[#8a8a95]">{packLabel(workspace)}</span>
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
            <span className="block truncate pt-0.5 font-data text-[10px] text-[#8a8a95]">{packLabel(workspace)}</span>
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
  const [isRailOpen, setIsRailOpen] = useState(false);
  useEffect(() => setIsRailOpen(false), [pathname]);
  const isAuthRoute = pathname === '/login' || pathname === '/signup';
  const isHomeRoute = pathname === '/';
  const workspaceId = pathname.match(/^\/workspace\/([^/]+)/)?.[1];
  const workspace = workspaceId ? workspaces.find((item) => item.id === workspaceId) : undefined;

  // The auth screens stand alone — no rail, no account chip.
  if (isAuthRoute) return children;

  return (
    <AuthProvider user={user}>
      <div className="flex h-dvh flex-col overflow-hidden bg-[#f6f7f9] text-[#18181b]">
        <HomeNavbar onMenu={() => setIsRailOpen(true)} />
        <div className="flex min-h-0 flex-1">
          {!isHomeRoute && (
            <>
              <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] shrink-0 flex-col overflow-hidden bg-[#151519] text-white shadow-2xl transition-transform md:relative md:z-auto md:translate-x-0 md:shadow-none ${isRailOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="hidden h-[60px] shrink-0 items-center border-b border-white/[0.06] px-[17px] md:flex">
                  <span className="grid size-[29px] place-items-center rounded-lg bg-[#5b5bd6] text-white">P</span>
                  <span className="ml-2.5 text-[15px] font-semibold">PaperMind</span>
                </div>
                <div className="flex h-[60px] shrink-0 items-center border-b border-white/[0.06] px-[17px] md:hidden">
                  <span className="grid size-[29px] place-items-center rounded-lg bg-[#5b5bd6] text-white">P</span>
                  <span className="ml-2.5 text-[15px] font-semibold">PaperMind</span>
                  <button type="button" aria-label="Close navigation" onClick={() => setIsRailOpen(false)} className="ml-auto rounded-md p-1 text-[#a7a7b1] hover:bg-white/[0.06]"><IconClose width={18} height={18} /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-3">
                  {workspace ? <WorkspaceRail workspace={workspace} workspaces={workspaces} pathname={pathname} /> : <HomeRail workspaces={workspaces} pathname={pathname} />}
                </div>
              </aside>
              {isRailOpen && <button type="button" aria-label="Close navigation overlay" onClick={() => setIsRailOpen(false)} className="fixed inset-0 z-40 bg-black/30 md:hidden" />}
            </>
          )}
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
