'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconSettings } from '@/lib/icons';
import { changePasswordAction, updateMeAction, type ProfileFailure } from '@/lib/session';

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-[11.5px] text-missing">
      {message}
    </p>
  );
}

function AccountCard() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ProfileFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await updateMeAction({ name: name.trim(), email: email.trim() });
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    setMessage('Profile updated.');
  }

  return (
    <Card pad={false}>
      <CardHeader title="Account" />
      <div className="px-4 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="account-name" className="block text-[12px] font-medium text-ink-2">
              Name
            </label>
            <input
              id="account-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
              className="mt-1 w-full border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
            <FieldError message={error?.fields.name} />
          </div>
          <div>
            <label htmlFor="account-email" className="block text-[12px] font-medium text-ink-2">
              Email
            </label>
            <input
              id="account-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage(null);
              }}
              className="mt-1 w-full border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
            <FieldError message={error?.fields.email} />
          </div>
        </div>
        {error && !error.fields.name && !error.fields.email && (
          <p className="mt-2 text-[11.5px] text-missing">{error.message}</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {message && (
            <p role="status" className="text-[12px] text-verified">
              {message}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ProfileFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || !current || next.length < 8) return;
    setBusy(true);
    setError(null);
    const result = await changePasswordAction({ currentPassword: current, newPassword: next });
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    setCurrent('');
    setNext('');
    setMessage('Password changed.');
  }

  return (
    <Card pad={false}>
      <CardHeader title="Password" />
      <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
        <div>
          <label htmlFor="password-current" className="block text-[12px] font-medium text-ink-2">
            Current password
          </label>
          <input
            id="password-current"
            type="password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              setMessage(null);
            }}
            className="mt-1 w-full border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <FieldError message={error?.code === 'WRONG_PASSWORD' ? error.message : undefined} />
        </div>
        <div>
          <label htmlFor="password-new" className="block text-[12px] font-medium text-ink-2">
            New password (8+ characters)
          </label>
          <input
            id="password-new"
            type="password"
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
              setMessage(null);
            }}
            className="mt-1 w-full border border-rule bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <FieldError message={error?.fields.new_password} />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-rule px-4 py-3">
        <button
          onClick={() => void save()}
          disabled={busy || !current || next.length < 8}
          className="border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-all hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Changing…' : 'Change password'}
        </button>
        {message && <p className="text-[12px] text-verified">{message}</p>}
      </div>
    </Card>
  );
}

/**
 * Notification preferences are browser-local until the API grows an endpoint for
 * them; they moved here from the deleted mock session store because this page is
 * their only consumer. Every access is guarded so SSR and a full storage quota
 * both stay silent.
 */
interface Preferences {
  emailDigest: boolean;
  runNotifications: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { emailDigest: true, runNotifications: true };
const PREFS_KEY = 'pm:preferences';

function getClientPreferences(): Preferences {
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

function setClientPreferences(p: Preferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable or full — the setting just won't persist across reloads.
  }
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 px-4 py-3.5">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center border border-rule bg-raised transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
        />
        <span className="ml-0.5 size-3.5 bg-surface transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  // One-time read from localStorage after mount — same pattern as AuthProvider.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPrefs(getClientPreferences()), []);

  function update(next: Partial<Preferences>) {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      setClientPreferences(merged);
      return merged;
    });
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <PageHeader eyebrow="Account" title="Settings" />
        <div className="mt-6">
          <EmptyState
            icon={<IconSettings width={20} height={20} />}
            title="You are not signed in"
            body="Notification and workspace preferences appear here once you sign in."
            action={
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-none bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink shadow-xs transition-all hover:brightness-110"
              >
                Sign in
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <PageHeader eyebrow="Account" title="Settings" meta={<span className="font-data text-[11.5px] text-ink-3">{user.email}</span>} />

      <div className="mt-6 space-y-3">
        <AccountCard />
        <PasswordCard />
        <Card pad={false}>
          <CardHeader title="Notifications" />
          <div className="divide-y divide-rule">
            <Toggle
              label="Weekly digest emails"
              description="A summary of runs, flags and Pack changes across your workspaces."
              checked={prefs.emailDigest}
              onChange={(v) => update({ emailDigest: v })}
            />
            <Toggle
              label="Run completion notices"
              description="Notify when a session finishes running its Pack, success or failure."
              checked={prefs.runNotifications}
              onChange={(v) => update({ runNotifications: v })}
            />
          </div>
        </Card>
        <p className="font-data text-[10px] text-ink-3">
          notification preferences are browser-local until the API grows an endpoint for them
        </p>
      </div>
    </div>
  );
}
