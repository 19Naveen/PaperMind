/**
 * MOCK session store — replaced by real auth.
 *
 * A client-only, localStorage-backed identity. Every access is guarded by a
 * `typeof window` check and wrapped in a try/catch so this module is safe to
 * import from anywhere and never throws, even in SSR or when storage is full.
 * No backend is wired — the store is the whole of the auth system for now.
 */

export interface User {
  name: string;
  email: string;
  role: 'examiner' | 'admin';
  initials: string;
}

export const DEMO_USER: User = {
  name: 'Ada Lovelace',
  email: 'ada@papermind.io',
  role: 'examiner',
  initials: 'AL',
};

const SESSION_KEY = 'pm:user';

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** Build a User from form input — signup has no server to mint one. */
export function makeUser(name: string, email: string, role: User['role'] = 'examiner'): User {
  return { name, email, role, initials: initialsOf(name) };
}

export function getClientUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed.name || typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      role: parsed.role === 'admin' ? 'admin' : 'examiner',
      initials: typeof parsed.initials === 'string' ? parsed.initials : initialsOf(parsed.name),
    };
  } catch {
    return null;
  }
}

export function setClientUser(u: User | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (u === null) {
      window.localStorage.removeItem(SESSION_KEY);
    } else {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    }
  } catch {
    // Storage unavailable or full — the in-memory store still carries on.
  }
}

export interface Preferences {
  emailDigest: boolean;
  runNotifications: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  emailDigest: true,
  runNotifications: true,
};

const PREFS_KEY = 'pm:preferences';

export function getClientPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      emailDigest: typeof parsed.emailDigest === 'boolean' ? parsed.emailDigest : DEFAULT_PREFERENCES.emailDigest,
      runNotifications:
        typeof parsed.runNotifications === 'boolean' ? parsed.runNotifications : DEFAULT_PREFERENCES.runNotifications,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function setClientPreferences(p: Preferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable or full — the setting just won't persist across reloads.
  }
}