'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/lib/api';

/**
 * The server-resolved identity, shared with every client component under the
 * shell. There is no client-side store: the root layout resolves the user from
 * the httpOnly session cookie and passes it down as a prop, so the header chip,
 * the profile page and the settings page can never disagree with the server.
 *
 * Signing out is a Server Action (`signOutAction`), not a context method — the
 * cookie only exists on the server.
 */
const AuthContext = createContext<{ user: User | null } | null>(null);

export function AuthProvider({ user, children }: { user: User | null; children: ReactNode }) {
  const value = useMemo(() => ({ user }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): { user: User | null } {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/** Two-letter monogram for the avatar chip — the API returns a name, not initials. */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
