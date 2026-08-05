'use client';

import Link from 'next/link';
import { initialsOf, useAuth } from '@/components/auth/AuthProvider';
import { ActionButton, Avatar, Card, CardHeader, EmptyState, Kv, PageHeader, Pill, Stat } from '@/components/ui';
import { IconUser } from '@/lib/icons';
import { signOutAction } from '@/lib/session';

export default function ProfilePage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <PageHeader eyebrow="Account" title="Profile" />
        <div className="mt-6">
          <EmptyState
            icon={<IconUser width={20} height={20} />}
            title="You are not signed in"
            body="Your reviewer identity, activity log, and access details appear here once you sign in."
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
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        meta={<span className="font-data text-[11.5px] text-ink-3">reviewer identity · {user.id}</span>}
        actions={
          <form action={signOutAction}>
            <ActionButton variant="danger" type="submit">
              Sign out
            </ActionButton>
          </form>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar initials={initialsOf(user.name)} className="h-12 w-12 text-[15px]" />
              <div className="min-w-0 flex-1">
                <p className="display text-[18px] leading-tight text-ink">{user.name}</p>
                <p className="mt-0.5 truncate font-data text-[12px] text-ink-2">{user.email}</p>
              </div>
              <Pill tone={user.role === 'admin' ? 'verified' : 'neutral'} dot={user.role === 'admin'}>
                {user.role}
              </Pill>
            </div>
          </Card>

          <Card pad={false}>
            <CardHeader title="API access" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2">
              <Kv k="API endpoint" v={<span className="text-ink-3">https://api.papermind.io/v0</span>} />
              <Kv k="Last executed" v={<span className="text-ink-3">—</span>} />
            </dl>
          </Card>
        </div>

        <Card pad={false}>
          <CardHeader title="Evidence instrument · activity" />
          <div className="grid grid-cols-2 gap-3 p-4">
            <Stat label="Pack versions authored" value={3} tone="accent" />
            <Stat label="Workspaces" value={2} />
            <Stat label="Runs today" value={0} sub="none started" />
            <Stat label="Sessions running" value={0} tone="running" sub="idle" />
          </div>
          <p className="border-t border-rule-2 px-4 py-3 font-data text-[10px] text-ink-3">
            mock ledger — counts are static until a backend reports them
          </p>
        </Card>
      </div>
    </div>
  );
}