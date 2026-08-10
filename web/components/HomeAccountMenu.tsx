'use client';

import Link from 'next/link';
import { useAuth, initialsOf } from '@/components/auth/AuthProvider';
import { signOutAction } from '@/lib/session';
import { IconSettings, IconUser } from '@/lib/icons';

/** Top-bar account menu — the reference `.avatar.top` trigger + `.accmenu`. */
export function HomeAccountMenu() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <details className="accwrap">
      <summary className="avatar top" aria-label="Open account menu" aria-haspopup="menu">
        {initialsOf(user.name)}
      </summary>
      <div className="accmenu" role="menu">
        <div className="acc-hd">
          <b>{user.name}</b>
          <small>{user.email}</small>
        </div>
        <Link className="acc-item" href="/profile" role="menuitem">
          <IconUser className="ic sm" />Profile
        </Link>
        <Link className="acc-item" href="/settings" role="menuitem">
          <IconSettings className="ic sm" />Settings
        </Link>
        <div className="acc-sep" />
        <form action={signOutAction}>
          <button className="acc-item dgr" type="submit" role="menuitem">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
