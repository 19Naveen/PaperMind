'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconSettings } from '@/lib/icons';
import { DEFAULT_PREFERENCES, getClientPreferences, setClientPreferences, type Preferences } from '@/lib/session';

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
        <p className="font-data text-[10px] text-ink-3">mock preferences — stored locally, no backend yet</p>
      </div>
    </div>
  );
}
