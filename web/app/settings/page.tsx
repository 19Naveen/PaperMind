import { getMe } from '@/lib/api';
import { signOutAction } from '@/lib/session';
import { ActionButton, Button, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconSettings } from '@/lib/icons';
import { AccountStats } from './AccountStats';
import { AppearanceCard, NotificationsCard, ProfileCard, SecurityCard } from './AccountPanels';

/**
 * The account surface — identity, security, appearance, notifications and activity
 * on ONE page. `/profile` used to hold the first and last of those and redirects here.
 *
 * `/settings` is canonical rather than `/profile` because `updateMeAction` calls
 * `revalidatePath('/settings')` (lib/session.ts) — pointing the identity form at a
 * route that is never revalidated would leave a saved name stale on screen.
 *
 * A server component, because the activity counters are cookie-gated and read on the
 * server (`./AccountStats`); the stateful cards live in ./AccountPanels as client
 * components. Sign-out is the page's one destructive action, so it sits in the header.
 */
export default async function AccountPage() {
  const user = await getMe();

  if (!user) {
    return (
      <div className="page">
        <PageHeader eyebrow="Account" title="Account & preferences" />
        <EmptyState
          icon={<IconSettings width={20} height={20} />}
          title="You are not signed in"
          body="Your profile, notification and workspace preferences appear here once you sign in."
          action={<Button href="/login" variant="primary">Sign in</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Account"
        title="Account & preferences"
        meta={user.email}
        actions={
          <form action={signOutAction}>
            <ActionButton type="submit" variant="danger">Sign out</ActionButton>
          </form>
        }
      />
      <div className="set-grid">
        <ProfileCard />
        <section className="card">
          <CardHeader title="Your activity" />
          <AccountStats />
          <p className="fineprint px-4 py-3">
            Per-pack contribution history isn&rsquo;t available yet — your published packs and runs will appear
            here once the API exposes them.
          </p>
        </section>
        <SecurityCard />
        <AppearanceCard />
        <NotificationsCard />
      </div>
    </div>
  );
}
