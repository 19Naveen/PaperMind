'use client';

import { useEffect, useState } from 'react';
import { initialsOf, useAuth } from '@/components/auth/AuthProvider';
import { ActionButton, Button, EmptyState, Input, PageHeader } from '@/components/ui';
import { IconAlert, IconSettings } from '@/lib/icons';
import { changePasswordAction, updateMeAction, type ProfileFailure } from '@/lib/session';

// `.switch` is styled by globals.css via `[aria-checked]` — the correct
// attribute for role="switch".
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

// `Input` is a closed primitive that renders its own `.field`, and `.ferr` is
// scoped under `.field` in globals.css, so the error is rendered just outside
// with the same visual treatment inline.
function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p style={{ display: 'flex', gap: 5, alignItems: 'center', color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>
      <IconAlert className="ic sm" />
      <span>{message}</span>
    </p>
  );
}

function ProfileCard() {
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
    <div className="card set-card">
      <h3>Profile</h3>
      <p className="sub">How you appear across workspaces and published packs.</p>
      <div className="avatar-row">
        <span className="avatar xl">{initialsOf(user?.name ?? '?')}</span>
        <div>
          <b style={{ fontSize: '13.5px' }}>{user?.name}</b>
          <div className="muted" style={{ fontSize: '11.5px', textTransform: 'capitalize' }}>
            {user?.role}
          </div>
        </div>
      </div>
      <Input
        id="pf-name"
        label="Full name"
        value={name}
        size="sm"
        onChange={(v) => {
          setName(v);
          setMessage(null);
        }}
      />
      <FieldError message={error?.fields.name} />
      <Input
        id="pf-email"
        label="Email"
        type="email"
        value={email}
        size="sm"
        onChange={(v) => {
          setEmail(v);
          setMessage(null);
        }}
      />
      <FieldError message={error?.fields.email} />
      {error && !error.fields.name && !error.fields.email && (
        <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error.message}</p>
      )}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <ActionButton onClick={() => void save()} disabled={busy} variant="primary">
          {busy ? 'Saving…' : 'Save changes'}
        </ActionButton>
        {message && <span style={{ color: 'var(--ok)', fontSize: 12 }}>{message}</span>}
      </div>
    </div>
  );
}

function SecurityCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ProfileFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const noMatch = confirm.length > 0 && next !== confirm;
  const canSave = !!current && next.length >= 8 && next === confirm && !busy;

  async function save() {
    if (!canSave) return;
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
    setConfirm('');
    setMessage('Password changed.');
  }

  return (
    <div className="card set-card">
      <h3>Security</h3>
      <p className="sub">Password and API access for the PaperMind service.</p>
      <Input
        id="pw-cur"
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        size="sm"
        onChange={(v) => {
          setCurrent(v);
          setMessage(null);
        }}
      />
      <FieldError message={error?.code === 'WRONG_PASSWORD' ? error.message : undefined} />
      <Input
        id="pw-new"
        label="New password (8+ characters)"
        type="password"
        autoComplete="new-password"
        value={next}
        size="sm"
        onChange={(v) => {
          setNext(v);
          setMessage(null);
        }}
      />
      <FieldError message={error?.fields.new_password ?? (tooShort ? 'Use at least 8 characters.' : undefined)} />
      <Input
        id="pw-conf"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        size="sm"
        onChange={(v) => {
          setConfirm(v);
          setMessage(null);
        }}
      />
      <FieldError message={noMatch ? 'Passwords do not match.' : undefined} />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <ActionButton onClick={() => void save()} disabled={!canSave} variant="primary">
          {busy ? 'Updating…' : 'Update password'}
        </ActionButton>
        {message && <span style={{ color: 'var(--ok)', fontSize: 12 }}>{message}</span>}
      </div>
      <hr className="divider" style={{ margin: '18px 0 14px' }} />
      <div className="field" style={{ marginBottom: 6 }}>
        <label>API key</label>
        {/* Honest unavailable state: the app has no API-key feature yet, so no
            fabricated key and no "Regenerate" button that implies one exists. */}
        <div className="api-key">
          <span className="muted">API keys are not available yet</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Notification preferences are browser-local until the API grows an endpoint for
 * them; this page is their only consumer. Every access is guarded so SSR and a
 * full storage quota both stay silent.
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

function NotificationsCard() {
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

  return (
    <div className="card set-card" style={{ gridColumn: '1 / -1' }}>
      <h3>Notifications</h3>
      <p className="sub">Choose what reaches you. Runs themselves are never interrupted.</p>
      <div className="notif-row">
        <div>
          <b>Weekly digest emails</b>
          <p>A summary of runs, flags and Pack changes across your workspaces.</p>
        </div>
        <Switch checked={prefs.emailDigest} onChange={(v) => update({ emailDigest: v })} label="Weekly digest emails" />
      </div>
      <div className="notif-row">
        <div>
          <b>Run completion notices</b>
          <p>Notify when a session finishes running its Pack, success or failure.</p>
        </div>
        <Switch
          checked={prefs.runNotifications}
          onChange={(v) => update({ runNotifications: v })}
          label="Run completion notices"
        />
      </div>
      <p className="muted" style={{ fontSize: 10.5, marginTop: 12, fontFamily: 'var(--f-mono)' }}>
        notification preferences are browser-local until the API grows an endpoint for them
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="page">
        <PageHeader eyebrow="Settings" title="Account & preferences" />
        <EmptyState
          icon={<IconSettings width={20} height={20} />}
          title="You are not signed in"
          body="Notification and workspace preferences appear here once you sign in."
          action={<Button href="/login" variant="primary">Sign in</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Settings" title="Account & preferences" meta={user.email} />
      <div className="set-grid">
        <ProfileCard />
        <SecurityCard />
        <NotificationsCard />
      </div>
    </div>
  );
}
