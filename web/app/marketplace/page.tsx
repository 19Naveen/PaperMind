import { getMe, listPacks } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { MarketGrid } from './MarketGrid';

export default async function MarketplacePage() {
  const user = await getMe();
  if (!user) redirect('/login');
  const packs = await listPacks(100);

  if (packs.length === 0) {
    return (
      <section className="page">
        <PageHeader eyebrow="Marketplace" title="Published packs" />
        <div className="card empty">
          <span className="e-ic">📭</span>
          <h3>No packs to install yet</h3>
          <p>Author a Pack from any workspace, approve it, and it becomes installable here.</p>
        </div>
      </section>
    );
  }

  return <MarketGrid packs={packs} />;
}
