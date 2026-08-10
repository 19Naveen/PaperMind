import { getMe, listPacks } from '@/lib/api';
import { redirect } from 'next/navigation';
import { EmptyState, PageHeader } from '@/components/ui';
import { IconLibrary } from '@/lib/icons';
import { MarketGrid } from './MarketGrid';

export default async function MarketplacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const packs = await listPacks(100);

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
