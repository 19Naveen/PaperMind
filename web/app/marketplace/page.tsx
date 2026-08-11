import { getMe, listPacks } from '@/lib/api';
import { redirect } from 'next/navigation';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import { IconAlert, IconLibrary } from '@/lib/icons';
import { MarketGrid } from './MarketGrid';

export default async function MarketplacePage() {
  const user = await getMe();
  if (!user) redirect('/login');

  // `null` means the catalogue could not be read; `[]` means there is genuinely
  // nothing published. They are different statements and must not share a screen.
  const packs = await listPacks(100).catch(() => null);

  if (!packs) {
    return (
      <section className="page">
        <PageHeader eyebrow="Marketplace" title="Published packs" />
        <EmptyState
          icon={<IconAlert className="ic lg" />}
          title="The catalogue couldn’t be loaded"
          body="The service didn’t answer. Reload to try again — nothing has been changed."
          action={<Button href="/marketplace" variant="primary">Reload</Button>}
        />
      </section>
    );
  }

  if (packs.length === 0) {
    return (
      <section className="page">
        <PageHeader eyebrow="Marketplace" title="Published packs" />
        <EmptyState
          icon={<IconLibrary className="ic lg" />}
          title="No packs to install yet"
          body="Author a Pack from any workspace, approve it, and it becomes installable here."
        />
      </section>
    );
  }

  return <MarketGrid packs={packs} />;
}
