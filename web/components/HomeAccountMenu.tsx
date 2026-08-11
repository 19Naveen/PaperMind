'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useAuth, initialsOf } from '@/components/auth/AuthProvider';
import { signOutAction } from '@/lib/session';
import { Avatar } from '@/components/ui';
import { IconChevronRight, IconSettings } from '@/lib/icons';

/**
 * The application's ONE account affordance: the rail-footer identity chip, which
 * doubles as the account menu trigger. The top bar used to carry a second avatar
 * dropdown for the same account — one account, one place to reach it.
 *
 * Collapsed rail: app/shell.css hides the name/email and the chevron, leaving the
 * avatar as the trigger. The menu itself is unchanged in either state, so sign-out
 * stays two interactions away from anywhere in the app.
 */
export function AccountMenu() {
  const details = useRef<HTMLDetailsElement>(null);
  const { user } = useAuth();

  // A <details> panel has no dismissal behaviour of its own, and this one opens
  // upward OVER the page (and past the rail's edge when collapsed), so a stray
  // click outside it has to close it — otherwise it hangs over the content with
  // no obvious way out. Escape does the same, as any menu should. Touching the
  // DOM node directly keeps the open/closed state where <details> already holds
  // it, with no second copy in React state to fall out of sync.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = details.current;
      if (el?.open && event.target instanceof Node && !el.contains(event.target)) el.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const el = details.current;
      if (event.key === 'Escape' && el?.open) {
        el.open = false;
        el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!user) return null;

  // A <details> menu also stays open across a client-side navigation, so the item
  // that navigates closes it on the way out.
  const close = () => {
    if (details.current) details.current.open = false;
  };

  return (
    <details className="accwrap rail-acc" ref={details}>
      <summary
        className="user"
        aria-haspopup="menu"
        aria-label={`Account: ${user.name}`}
        title={`${user.name} · ${user.email}`}
      >
        <Avatar initials={initialsOf(user.name)} />
        <span className="user-meta">
          <b>{user.name}</b>
          <small>{user.email}</small>
        </span>
        <IconChevronRight className="ic sm rail-acc-chev" />
      </summary>
      <div className="accmenu" role="menu">
        <div className="acc-hd">
          <b>{user.name}</b>
          <small>{user.email}</small>
        </div>
        <Link className="acc-item" href="/settings" role="menuitem" onClick={close}>
          <IconSettings className="ic sm" />
          Account &amp; settings
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
