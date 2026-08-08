'use client';

import Link from 'next/link';
import { useAuth, initialsOf } from '@/components/auth/AuthProvider';
import { signOutAction } from '@/lib/session';
import { IconChevronDown, IconSettings, IconUser } from '@/lib/icons';

/** Compact account menu for the standalone dashboard header. */
export function HomeAccountMenu() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <details className="relative">
      <summary
        aria-label="Open account menu"
        aria-haspopup="menu"
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left transition-colors hover:bg-[#f0f1f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bd6]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-data text-[10px] font-bold text-accent">{initialsOf(user.name)}</span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-36 truncate text-[12.5px] font-semibold leading-tight text-ink">{user.name}</span>
          <span className="block text-[10.5px] leading-tight text-ink-3">{user.role === 'admin' ? 'Administrator' : 'Workspace member'}</span>
        </span>
        <IconChevronDown width={14} height={14} className="hidden shrink-0 text-ink-3 sm:block" />
      </summary>
      <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-64 overflow-hidden rounded-xl border border-[#dedee3] bg-white shadow-lg">
        <div className="flex items-center gap-3 border-b border-rule px-4 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center bg-ink font-data text-[10px] font-bold text-ground">{initialsOf(user.name)}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-ink">{user.name}</span>
            <span className="block truncate font-data text-[10.5px] text-ink-3">{user.email}</span>
          </span>
        </div>
        <nav className="p-1.5" aria-label="Account navigation">
          <Link href="/profile" className="flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            <IconUser width={15} height={15} className="text-ink-3" />
            Your profile
          </Link>
          <Link href="/settings" className="flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            <IconSettings width={15} height={15} className="text-ink-3" />
            Settings
          </Link>
        </nav>
        <form action={signOutAction} className="border-t border-rule p-1.5">
          <button type="submit" className="flex w-full px-3 py-2.5 text-left text-[12.5px] font-medium text-missing transition-colors hover:bg-missing-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
