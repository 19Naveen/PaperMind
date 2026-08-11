'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconHome, IconDoc, IconLibrary, IconPlus } from '@/lib/icons';
import type { User, WorkspaceOut } from '@/lib/api';
import { AuthProvider } from './auth/AuthProvider';
import { AccountMenu } from './HomeAccountMenu';
import { HomeNavbar } from './HomeNavbar';

/** Collapsed-rail stand-in for a workspace name, so an icon-only rail is still navigable. */
function monogram(value: string): string {
  const first = value.trim().charAt(0);
  return first ? first.toUpperCase() : '#';
}

/**
 * Application shell — emits the canonical prototype DOM
 * (`.app > .sidebar + .scrim + .main > .topbar + .content`) so the reference CSS
 * in globals.css renders it faithfully.
 *
 * Two independent rail states, deliberately kept apart:
 *   · ≤980px the rail is an off-canvas drawer, opened by `.menuBtn` (`open` below);
 *   · >980px it can be collapsed to icons only, persisted in localStorage and
 *     projected onto `<html data-rail>` (see components/rail.ts). Every collapsed
 *     rule in app/shell.css is gated to `min-width: 981px`, so a collapsed desktop
 *     choice cannot follow the user into the mobile drawer.
 */
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
  const [open, setOpen] = useState(false);

  // The auth screens stand alone — no rail, no account chip.
  if (pathname === '/login' || pathname === '/signup') return children;

  const activeWsId = pathname.match(/^\/workspace\/([^/]+)/)?.[1];

  return (
    <AuthProvider user={user}>
      <div className="app">
        {/* RAIL_BOOTSTRAP now runs from <head> in app/layout.tsx, beside
            THEME_BOOTSTRAP — one paint earlier than it could from here, and with no
            hidden host to carry it. shell.css styles only the collapsed attribute,
            so if the script is ever stripped the rail simply renders expanded. */}
        <aside id="app-sidebar" className={`sidebar${open ? ' open' : ''}`} aria-label="Primary navigation">
          <Link href="/" className="brand" aria-label="PaperMind home" title="PaperMind">
            <span className="brand-mark"><IconDoc className="ic sm" /></span>
            <span className="brand-name">PaperMind</span>
          </Link>
          <nav className="nav">
            <Link
              href="/"
              className={`nav-item${pathname === '/' ? ' is-active' : ''}`}
              aria-current={pathname === '/' ? 'page' : undefined}
              title="Home"
            >
              <IconHome className="ic" />
              <span className="nav-lbl">Home</span>
            </Link>
            <Link
              href="/marketplace"
              className={`nav-item${pathname.startsWith('/marketplace') ? ' is-active' : ''}`}
              aria-current={pathname.startsWith('/marketplace') ? 'page' : undefined}
              title="Marketplace"
            >
              <IconLibrary className="ic" />
              <span className="nav-lbl">Marketplace</span>
            </Link>
            <div className="nav-cap">
              <span>Workspaces</span>
              <Link href="/workspace/new" aria-label="New workspace" title="New workspace"><IconPlus className="ic sm" /></Link>
            </div>
            {workspaces.map((ws) => (
              <Link
                key={ws.id}
                href={`/workspace/${ws.id}`}
                className={`nav-item ws-item${activeWsId === ws.id ? ' is-active' : ''}`}
                aria-current={activeWsId === ws.id ? 'page' : undefined}
                title={ws.name}
              >
                <span className="ws-mono" aria-hidden="true">{monogram(ws.name)}</span>
                <span className="ws-name">{ws.name}</span>
                <span className={`ws-dot${ws.pack_id ? ' on' : ' draft'}`} />
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            {/* One account affordance for the whole app: identity + menu (settings,
                sign out). The top bar carries breadcrumbs and utilities only. */}
            <AccountMenu />
          </div>
        </aside>
        <button className={`scrim${open ? ' on' : ''}`} aria-label="Close navigation" onClick={() => setOpen(false)} />
        <div className="main">
          <HomeNavbar onOpenNavigation={() => setOpen(true)} />
          <main className="content">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
