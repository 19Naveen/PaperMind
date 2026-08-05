'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconChevronDown, IconCheck, IconHome, IconLibrary, IconPlus, IconSettings, IconUser } from '@/lib/icons';
import type { Workspace } from '@/lib/types';
import { AuthProvider, useAuth } from './auth/AuthProvider';

function packLabel(workspace: Workspace): string {
  return workspace.pack_name && workspace.pack_version
    ? `${workspace.pack_name} ${workspace.pack_version}`
    : 'No pack';
}

/** Sidebar footer: the signed-in reviewer's identity, opening onto Profile/Settings/Sign out. */
function AccountMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <div className="border-t border-rule p-3">
        <Link
          href="/login"
          className="flex items-center justify-center border border-rule px-3 py-2 text-[12px] font-medium text-ink transition-colors hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign in
        </Link>
      </div>
    );
  }

  function handleSignOut() {
    setOpen(false);
    signOut();
    router.push('/login');
  }

  return (
    <div className="relative border-t border-rule">
      {open && (
        <div
          id="account-menu"
          className="absolute inset-x-3 bottom-[calc(100%-0.75rem)] z-20 border border-rule bg-surface py-1 shadow-[4px_4px_0_theme(colors.rule)]"
        >
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <IconUser width={14} height={14} className="text-ink-3" />
            Profile
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <IconSettings width={14} height={14} className="text-ink-3" />
            Settings
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 border-t border-rule px-3 py-2 text-left text-[12px] text-missing hover:bg-missing-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="grid size-7 shrink-0 place-items-center bg-ink font-data text-[10px] font-bold text-ground">{user.initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink">{user.name}</span>
          <span className="block truncate text-[11px] text-ink-3">{user.role === 'admin' ? 'Admin' : 'Examiner'}</span>
        </span>
        <IconChevronDown width={14} height={14} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
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

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className="size-3.5 bg-accent" />
      <span className="font-display text-[16px] font-extrabold tracking-[0.14em] text-ink">PAPERMIND</span>
    </Link>
  );
}

function HomeRail({ workspaces, pathname }: { workspaces: Workspace[]; pathname: string }) {
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

function WorkspaceRail({ workspace, workspaces, pathname }: { workspace: Workspace; workspaces: Workspace[]; pathname: string }) {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const overviewHref = `/workspace/${workspace.id}`;
  const packHref = `${overviewHref}/pack`;
  const newSessionHref = workspace.id === 'onb' ? '/workspace/onb/sessions/nord' : overviewHref;

  return (
    <>
      <div className="relative border-b border-rule p-3">
        <button
          type="button"
          onClick={() => setIsSwitcherOpen((open) => !open)}
          aria-expanded={isSwitcherOpen}
          aria-controls="workspace-switcher"
          className="flex w-full items-center gap-2 border border-rule bg-raised px-3 py-2.5 text-left transition-colors hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Workspace · all</span>
            <span className="block truncate pt-1 text-[13px] font-medium text-ink">{workspace.name}</span>
            <span className="block truncate pt-0.5 font-data text-[10.5px] text-ink-3">{packLabel(workspace)}</span>
          </span>
          <IconChevronDown width={15} height={15} className={`shrink-0 text-ink-3 transition-transform ${isSwitcherOpen ? 'rotate-180' : ''}`} />
        </button>
        {isSwitcherOpen && (
          <div id="workspace-switcher" className="absolute inset-x-3 top-[calc(100%-0.75rem)] z-20 border border-rule bg-surface py-1 shadow-[4px_4px_0_theme(colors.rule)]">
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
        <RailLink href={packHref} active={pathname === packHref}>Editing pack</RailLink>
      </nav>
      <section className="flex-1 overflow-y-auto py-4" aria-labelledby="sessions-label">
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 id="sessions-label" className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">Sessions</h2>
          <Link
            href={newSessionHref}
            className="inline-flex size-5 items-center justify-center border border-rule text-ink-2 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="New session"
          >
            <IconPlus width={13} height={13} />
          </Link>
        </div>
        <nav aria-label="Workspace sessions">
          {workspace.sessions.map((session) => {
            const href = `${overviewHref}/sessions/${session.id}`;
            const active = pathname === href;
            return (
              <Link
                key={session.id}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="group flex items-stretch transition-colors hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span className={`w-[3px] shrink-0 ${active ? 'bg-accent' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1 px-3.5 py-2">
                  <span className={`block truncate text-[13px] ${active ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{session.title}</span>
                  {session.meta && <span className="block truncate pt-0.5 font-data text-[10.5px] text-ink-3">{session.meta}</span>}
                </span>
              </Link>
            );
          })}
        </nav>
      </section>
    </>
  );
}

function MobileHeader({ workspace, pathname }: { workspace?: Workspace; pathname: string }) {
  const isWorkspace = workspace !== undefined;
  const overviewHref = workspace ? `/workspace/${workspace.id}` : '/';
  const packHref = workspace ? `${overviewHref}/pack` : '/marketplace';

  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b border-rule bg-surface px-4 md:hidden">
      <Link href="/" className="font-display text-[13px] font-extrabold tracking-[0.12em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        PAPERMIND
      </Link>
      <nav className="flex items-center gap-1" aria-label="Mobile navigation">
        <Link
          href={overviewHref}
          aria-current={(isWorkspace ? pathname === overviewHref : pathname === '/') ? 'page' : undefined}
          className="px-2 py-1 text-[12px] text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {isWorkspace ? 'Overview' : 'Home'}
        </Link>
        <Link
          href={packHref}
          aria-current={(isWorkspace ? pathname === packHref : pathname === '/marketplace') ? 'page' : undefined}
          className="px-2 py-1 text-[12px] text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {isWorkspace ? 'Pack' : 'Marketplace'}
        </Link>
      </nav>
    </header>
  );
}

export function AppShell({ workspaces, children }: { workspaces: Workspace[]; children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';
  const workspaceId = pathname.match(/^\/workspace\/([^/]+)/)?.[1];
  const workspace = workspaceId ? workspaces.find((item) => item.id === workspaceId) : undefined;

  if (isAuthRoute) return <AuthProvider>{children}</AuthProvider>;

  return (
    <AuthProvider>
      <div className="flex min-h-screen bg-ground text-ink">
        <aside className="hidden h-screen w-[266px] shrink-0 flex-col border-r border-rule bg-surface md:flex">
          <Brand />
          {workspace ? <WorkspaceRail workspace={workspace} workspaces={workspaces} pathname={pathname} /> : <HomeRail workspaces={workspaces} pathname={pathname} />}
          <AccountMenu />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader workspace={workspace} pathname={pathname} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
