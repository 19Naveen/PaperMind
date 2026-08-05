import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { ActionButton, Avatar, Card, CardHeader, Kv, PageHeader, Pill } from '@/components/ui';
import { signOutAction } from '@/lib/session';
import { ProfileStats } from './ProfileStats';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default async function ProfilePage() {
  const user = await getMe();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        meta={<span className="font-data text-[11.5px] text-ink-3">reviewer identity</span>}
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
              <Kv k="Role" v={<span className="text-ink-3">{user.role}</span>} />
              <Kv k="Account id" v={<span className="truncate text-ink-3">{user.id}</span>} />
            </dl>
          </Card>
        </div>

        <Card pad={false}>
          <CardHeader title="Activity" />
          <ProfileStats />
        </Card>
      </div>
    </div>
  );
}
