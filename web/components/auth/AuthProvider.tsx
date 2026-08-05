'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/lib/session';
import { getClientUser, setClientUser } from '@/lib/session';

interface AuthState {
  user: User | null;
  signIn: (u: User) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * One shared auth store for the whole shell. Mounted inside AppShell (a client
 * component) so the header account chip, the sidebar footer readout, and the
 * profile page all read the same mock identity. Mirrors to localStorage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // One-time read from localStorage (an external system) after mount, so SSR
  // and the first client render agree on the signed-out state first — exactly
  // the "sync with an external system" case an effect exists for, not a
  // subscription.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setUser(getClientUser()), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      signIn: (u: User) => {
        setUser(u);
        setClientUser(u);
      },
      signOut: () => {
        setUser(null);
        setClientUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}