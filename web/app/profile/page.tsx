import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { signOutAction } from '@/lib/session';
import { ActionButton, Avatar } from '@/components/ui';
import { ProfileStats } from './ProfileStats';

// Server-safe initials (AuthProvider's initialsOf is client-only).
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default async function ProfilePage() {
  const user = await getMe();
  if (!user) redirect('/login');

  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="page-title">Profile</h1>
        </div>
        <div className="page-actions">
          <form action={signOutAction}>
            <ActionButton type="submit" variant="danger">Sign out</ActionButton>
          </form>
        </div>
      </div>

      <div className="set-grid">
        <div className="card set-card">
          <div className="prof-head">
            <Avatar initials={initialsOf(user.name)} className="xl" />
            <div className="prof-id">
              <h1>
                {user.name} <span className="tag acc">{roleLabel}</span>
              </h1>
              <p>{user.email}</p>
            </div>
          </div>
          <hr className="divider" />
          <div className="kv">
            <span>Role</span>
            <b>{roleLabel}</b>
          </div>
          <div className="kv">
            <span>Email</span>
            <b>{user.email}</b>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h3>Your contributions</h3>
          </div>
          <ProfileStats />
          <p className="fineprint px-4 py-3">
            Per-pack contribution history isn&rsquo;t available yet — your published packs and runs will appear
            here once the API exposes them.
          </p>
        </div>
      </div>
    </div>
  );
}
