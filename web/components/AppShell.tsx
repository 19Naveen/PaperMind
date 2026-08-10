'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconChevronRight, IconDoc, IconHome, IconLibrary, IconPlus, IconSettings } from '@/lib/icons';
import type { User, WorkspaceOut } from '@/lib/api';
import { AuthProvider } from './auth/AuthProvider';
import { HomeNavbar } from './HomeNavbar';

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * Application shell — emits the canonical prototype DOM
 * (`.app > .sidebar + .scrim + .main > .topbar + .content`) so the verbatim
 * reference CSS in globals.css renders it pixel-faithfully.
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
        <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Primary navigation">
          <Link href="/" className="brand" aria-label="PaperMind home">
            <span className="brand-mark"><IconDoc className="ic sm" /></span>
            <span className="brand-name">PaperMind</span>
          </Link>
          <nav className="nav">
            <Link href="/" className={`nav-item${pathname === '/' ? ' is-active' : ''}`} aria-current={pathname === '/' ? 'page' : undefined}>
              <IconHome className="ic" />Home
            </Link>
            <Link href="/marketplace" className={`nav-item${pathname.startsWith('/marketplace') ? ' is-active' : ''}`} aria-current={pathname.startsWith('/marketplace') ? 'page' : undefined}>
              <IconLibrary className="ic" />Marketplace
            </Link>
            <div className="nav-cap">
              <span>Workspaces</span>
              <Link href="/workspace/new" aria-label="New workspace"><IconPlus className="ic sm" /></Link>
            </div>
            {workspaces.map((ws) => (
              <Link
                key={ws.id}
                href={`/workspace/${ws.id}`}
                className={`nav-item${activeWsId === ws.id ? ' is-active' : ''}`}
                aria-current={activeWsId === ws.id ? 'page' : undefined}
              >
                <span className="ws-name">{ws.name}</span>
                <span className={`ws-dot${ws.pack_id ? ' on' : ' draft'}`} />
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <Link href="/settings" className={`nav-item${pathname === '/settings' ? ' is-active' : ''}`}>
              <IconSettings className="ic" />Settings
            </Link>
            {user && (
              <Link href="/profile" className={`user${pathname === '/profile' ? ' is-active' : ''}`}>
                <span className="avatar">{initials(user.name)}</span>
                <span className="user-meta">
                  <b>{user.name}</b>
                  <small>{user.email}</small>
                </span>
                <IconChevronRight className="ic sm" />
              </Link>
            )}
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
