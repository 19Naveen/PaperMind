'use client';

import { useEffect, useState } from 'react';
import { initialsOf, useAuth } from '@/components/auth/AuthProvider';
import { useTheme, type ThemeChoice } from '@/components/theme';
import { ActionButton, Button, EmptyState, Input, PageHeader } from '@/components/ui';
import { IconAlert, IconCheck, IconSettings } from '@/lib/icons';
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
// scoped under `.field` in globals.css, so the error carries `.auth-error` —
// the same icon + danger-text treatment the sign-in form uses.
function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="auth-error" role="alert">
      <IconAlert className="ic sm" />
      <span>{message}</span>
    </p>
  );
}

// Saved/updated confirmations, in the interface's voice: past tense, matching
// the verb on the button that produced them.
function SavedNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span className="text-xs" style={{ color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
      <IconCheck className="ic sm" />
      {message}
    </span>
  );
}

const THEME_OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Follows your OS' },
];

function AppearanceCard() {
  const { choice, setChoice } = useTheme();

  return (
    <div className="card set-card">
      <h3>Appearance</h3>
      <p className="sub">Applies to this browser only, and takes effect immediately.</p>
      <div className="theme-opts" role="group" aria-label="Colour theme">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="theme-opt"
            aria-pressed={choice === option.value}
            onClick={() => setChoice(option.value)}
          >
            <span className={`theme-swatch ${option.value}`} aria-hidden="true">
              <i className="sw-rail" />
              <i className="sw-body" />
            </span>
            <span className="theme-lbl">
              {choice === option.value && <IconCheck className="ic sm" />}
              {option.label}
            </span>
            <span className="fineprint">{option.hint}</span>
          </button>
        ))}
      </div>
    </div>
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
          <b className="text-base">{user?.name}</b>
          <div className="muted text-xs" style={{ textTransform: 'capitalize' }}>
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
      {error && !error.fields.name && !error.fields.email && <FieldError message={error.message} />}
      <div className="flbl-wrap mt-3">
        <ActionButton onClick={() => void save()} disabled={busy} variant="primary">
          {busy ? 'Saving…' : 'Save changes'}
        </ActionButton>
        <SavedNote message={message} />
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
      <div className="flbl-wrap mt-3">
        <ActionButton onClick={() => void save()} disabled={!canSave} variant="primary">
          {busy ? 'Updating…' : 'Update password'}
        </ActionButton>
        <SavedNote message={message} />
      </div>
      <hr className="divider" />
      <div className="field">
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
      <p className="stamp mt-3">Saved in this browser only</p>
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
        <AppearanceCard />
        <NotificationsCard />
      </div>
    </div>
  );
}
